param(
    [Alias("EquicordPath")]
    [string]$ClientPath,

    [ValidateSet("Auto", "Cli", "Gui")]
    [string]$Mode = "Auto",

    [ValidateSet("Auto", "Stable", "Canary", "Both", "None")]
    [string]$DiscordBranch = "Auto",

    [string]$StableDiscordPath,
    [string]$CanaryDiscordPath,

    [bool]$Build = $true,
    [bool]$Inject = $true
)

$ErrorActionPreference = "Stop"
$pluginSource = Join-Path $PSScriptRoot "discordE2ee"

function Test-ClientCheckout {
    param([string]$Candidate)
    if (-not $Candidate -or -not (Test-Path -LiteralPath $Candidate -PathType Container)) {
        return $false
    }
    return (
        (Test-Path -LiteralPath (Join-Path $Candidate "package.json") -PathType Leaf) -and
        (Test-Path -LiteralPath (Join-Path $Candidate "src") -PathType Container) -and
        (Test-Path -LiteralPath (Join-Path $Candidate "scripts\runInstaller.mjs") -PathType Leaf)
    )
}

function Get-ClientKind {
    param([string]$Checkout)
    $package = Get-Content -LiteralPath (Join-Path $Checkout "package.json") -Raw | ConvertFrom-Json
    switch -Regex ([string]$package.name) {
        "equicord" { return "Equicord" }
        "vencord" { return "Vencord" }
        default { throw "That folder is not an Equicord or Vencord checkout: $Checkout" }
    }
}

function Get-DetectedCheckouts {
    $candidateNames = @("Equicord", "equicord", "Vencord", "vencord")
    $searchParents = @(
        $env:USERPROFILE,
        (Join-Path $env:USERPROFILE "Documents"),
        (Join-Path $env:USERPROFILE "Desktop"),
        (Join-Path $env:USERPROFILE "Downloads"),
        (Split-Path -Parent $PSScriptRoot)
    ) | Select-Object -Unique
    $matches = foreach ($parent in $searchParents) {
        foreach ($name in $candidateNames) {
            $candidate = Join-Path $parent $name
            if (Test-ClientCheckout $candidate) {
                (Resolve-Path -LiteralPath $candidate).Path
            }
        }
    }
    return @($matches | Select-Object -Unique)
}

function Select-ClientPathGui {
    param([string]$InitialPath)
    Add-Type -AssemblyName System.Windows.Forms
    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description = "Choose your Equicord or Vencord source folder. It should contain package.json and src."
    $dialog.ShowNewFolderButton = $false
    if ($InitialPath) {
        $dialog.SelectedPath = $InitialPath
    }
    if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) {
        throw "No source folder was chosen. Nothing was installed."
    }
    return $dialog.SelectedPath
}

function Test-DiscordInstall {
    param([string]$Candidate)
    if (-not $Candidate -or -not (Test-Path -LiteralPath $Candidate -PathType Container)) {
        return $false
    }
    if (Test-Path -LiteralPath (Join-Path $Candidate "Update.exe") -PathType Leaf) {
        return $true
    }
    return $null -ne (Get-ChildItem -LiteralPath $Candidate -Directory -Filter "app-*" -ErrorAction SilentlyContinue |
        Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName "Discord.exe") -PathType Leaf } |
        Select-Object -First 1)
}

function Get-DiscordInstallations {
    $stable = if ($StableDiscordPath) { $StableDiscordPath } else { Join-Path $env:LOCALAPPDATA "Discord" }
    $canary = if ($CanaryDiscordPath) { $CanaryDiscordPath } else { Join-Path $env:LOCALAPPDATA "DiscordCanary" }
    $results = @()
    if (Test-DiscordInstall $stable) {
        $results += [PSCustomObject]@{ Branch = "stable"; Label = "Discord Stable"; Path = (Resolve-Path -LiteralPath $stable).Path }
    }
    if (Test-DiscordInstall $canary) {
        $results += [PSCustomObject]@{ Branch = "canary"; Label = "Discord Canary"; Path = (Resolve-Path -LiteralPath $canary).Path }
    }
    return $results
}

function Select-DiscordInstallationsGui {
    param([array]$Detected)
    Add-Type -AssemblyName System.Drawing
    Add-Type -AssemblyName System.Windows.Forms

    $form = New-Object System.Windows.Forms.Form
    $form.Text = "Install discord e2ee"
    $form.StartPosition = "CenterScreen"
    $form.Size = New-Object System.Drawing.Size(620, 280)
    $form.FormBorderStyle = "FixedDialog"
    $form.MaximizeBox = $false
    $form.MinimizeBox = $false

    $label = New-Object System.Windows.Forms.Label
    $label.Text = "Where should this build be installed?"
    $label.AutoSize = $true
    $label.Location = New-Object System.Drawing.Point(20, 20)
    $form.Controls.Add($label)

    $list = New-Object System.Windows.Forms.CheckedListBox
    $list.CheckOnClick = $true
    $list.Location = New-Object System.Drawing.Point(20, 55)
    $list.Size = New-Object System.Drawing.Size(565, 110)
    foreach ($entry in $Detected) {
        [void]$list.Items.Add("$($entry.Label) - $($entry.Path)", $true)
    }
    $form.Controls.Add($list)

    $ok = New-Object System.Windows.Forms.Button
    $ok.Text = "Continue"
    $ok.DialogResult = [System.Windows.Forms.DialogResult]::OK
    $ok.Location = New-Object System.Drawing.Point(405, 185)
    $ok.Size = New-Object System.Drawing.Size(85, 32)
    $form.Controls.Add($ok)
    $form.AcceptButton = $ok

    $cancel = New-Object System.Windows.Forms.Button
    $cancel.Text = "Cancel"
    $cancel.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
    $cancel.Location = New-Object System.Drawing.Point(500, 185)
    $cancel.Size = New-Object System.Drawing.Size(85, 32)
    $form.Controls.Add($cancel)
    $form.CancelButton = $cancel

    if ($form.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) {
        throw "Nothing was installed."
    }
    $selected = @()
    for ($index = 0; $index -lt $Detected.Count; $index++) {
        if ($list.GetItemChecked($index)) {
            $selected += $Detected[$index]
        }
    }
    return $selected
}

function Invoke-CheckedCommand {
    param(
        [string]$Program,
        [string[]]$Arguments
    )
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "This command stopped with exit code $LASTEXITCODE`: $Program $($Arguments -join ' ')"
    }
}

$isAdministrator = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator
)
if ($isAdministrator) {
    throw "Close this window and run the installer without administrator rights."
}

if ($Mode -eq "Auto") {
    $Mode = "Cli"
}

$detectedCheckouts = Get-DetectedCheckouts
if ($ClientPath) {
    if (-not (Test-ClientCheckout $ClientPath)) {
        throw "That folder is not an Equicord or Vencord source checkout: $ClientPath"
    }
    $resolvedClient = (Resolve-Path -LiteralPath $ClientPath).Path
} elseif ($Mode -eq "Gui") {
    $initial = if ($detectedCheckouts.Count) { $detectedCheckouts[0] } else { Join-Path $env:USERPROFILE "Documents" }
    $resolvedClient = (Resolve-Path -LiteralPath (Select-ClientPathGui $initial)).Path
    if (-not (Test-ClientCheckout $resolvedClient)) {
        throw "That folder is not an Equicord or Vencord source checkout: $resolvedClient"
    }
} elseif ($detectedCheckouts.Count -eq 1) {
    $resolvedClient = $detectedCheckouts[0]
} elseif ($detectedCheckouts.Count -gt 1) {
    Write-Host "Found these source folders:"
    for ($index = 0; $index -lt $detectedCheckouts.Count; $index++) {
        Write-Host "[$($index + 1)] $($detectedCheckouts[$index])"
    }
    $choice = Read-Host "Enter a folder number"
    if ($choice -notmatch "^\d+$" -or [int]$choice -lt 1 -or [int]$choice -gt $detectedCheckouts.Count) {
        throw "That is not one of the listed numbers."
    }
    $resolvedClient = $detectedCheckouts[[int]$choice - 1]
} else {
    throw "No Equicord or Vencord source folder was found. Clone one into Documents, or pass its real path with -ClientPath."
}

$clientKind = Get-ClientKind $resolvedClient
$userPlugins = Join-Path $resolvedClient "src\userplugins"
$destination = Join-Path $userPlugins "discordE2ee"
New-Item -ItemType Directory -Path $destination -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $pluginSource "index.tsx") -Destination $destination -Force
Copy-Item -LiteralPath (Join-Path $pluginSource "protocol.ts") -Destination $destination -Force
$legacyDestination = Join-Path $userPlugins "e2eeOverlay"
if (Test-Path -LiteralPath $legacyDestination -PathType Container) {
    foreach ($legacyFile in @("index.tsx", "protocol.ts")) {
        $legacyPath = Join-Path $legacyDestination $legacyFile
        if (Test-Path -LiteralPath $legacyPath -PathType Leaf) {
            Remove-Item -LiteralPath $legacyPath -Force
        }
    }
    if (-not (Get-ChildItem -LiteralPath $legacyDestination -Force | Select-Object -First 1)) {
        Remove-Item -LiteralPath $legacyDestination -Force
    }
}
Write-Host "Copied discord e2ee to $destination ($clientKind)"

$detectedDiscord = @(Get-DiscordInstallations)
if ($detectedDiscord.Count) {
    Write-Host "Found these Discord installs:"
    $detectedDiscord | ForEach-Object { Write-Host "- $($_.Label): $($_.Path)" }
} else {
    Write-Warning "Discord Stable and Canary were not found. The build can continue, but it will not be installed into Discord."
}

$targets = @()
if ($Inject -and $DiscordBranch -ne "None") {
    switch ($DiscordBranch) {
        "Stable" { $targets = @($detectedDiscord | Where-Object Branch -eq "stable") }
        "Canary" { $targets = @($detectedDiscord | Where-Object Branch -eq "canary") }
        "Both" { $targets = @($detectedDiscord | Where-Object { $_.Branch -in @("stable", "canary") }) }
        "Auto" {
            $targets = if ($Mode -eq "Gui" -and $detectedDiscord.Count) {
                @(Select-DiscordInstallationsGui $detectedDiscord)
            } else {
                $detectedDiscord
            }
        }
    }
    if (-not $targets.Count) {
        Write-Warning "The selected Discord version was not found, so it will not be changed."
    }
}

if ($Build) {
    if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
        throw "pnpm was not found. Install Node.js LTS, then run: npm install -g pnpm"
    }
    Push-Location $resolvedClient
    try {
        if (-not (Test-Path -LiteralPath (Join-Path $resolvedClient "node_modules") -PathType Container)) {
            Invoke-CheckedCommand "pnpm" @("install", "--no-frozen-lockfile")
        }
        Invoke-CheckedCommand "pnpm" @("build")

        $installerName = if ($clientKind -eq "Equicord") { "EquilotlCli.exe" } else { "VencordInstallerCli.exe" }
        $installerPath = Join-Path $resolvedClient "dist\Installer\$installerName"
        if ($targets.Count -and -not (Test-Path -LiteralPath $installerPath -PathType Leaf)) {
            Invoke-CheckedCommand "node" @("scripts\runInstaller.mjs", "--", "--version")
        }
        if ($targets.Count -and -not (Test-Path -LiteralPath $installerPath -PathType Leaf)) {
            throw "$clientKind's installer could not be downloaded to $installerPath"
        }

        $savedEnvironment = @{
            VENCORD_USER_DATA_DIR = $env:VENCORD_USER_DATA_DIR
            VENCORD_DEV_INSTALL = $env:VENCORD_DEV_INSTALL
            EQUICORD_USER_DATA_DIR = $env:EQUICORD_USER_DATA_DIR
            EQUICORD_DIRECTORY = $env:EQUICORD_DIRECTORY
            EQUICORD_DEV_INSTALL = $env:EQUICORD_DEV_INSTALL
        }
        try {
            if ($clientKind -eq "Vencord") {
                $env:VENCORD_USER_DATA_DIR = $resolvedClient
                $env:VENCORD_DEV_INSTALL = "1"
            } else {
                $env:EQUICORD_USER_DATA_DIR = $resolvedClient
                $env:EQUICORD_DIRECTORY = Join-Path $resolvedClient "dist\desktop"
                $env:EQUICORD_DEV_INSTALL = "1"
            }

            foreach ($target in $targets) {
                Write-Host "Installing this $clientKind build into $($target.Label)..."
                Invoke-CheckedCommand $installerPath @("-install", "-location", $target.Path)
            }
        } finally {
            foreach ($name in $savedEnvironment.Keys) {
                $value = $savedEnvironment[$name]
                if ($null -eq $value) {
                    Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue
                } else {
                    Set-Item -LiteralPath "Env:$name" -Value $value
                }
            }
        }
    } finally {
        Pop-Location
    }
} elseif ($Inject) {
    Write-Warning "Discord was not changed because the source was not built. Run again with -Build:`$true, or build and install it yourself."
}

$summary = "discord e2ee was copied into $clientKind.`nSource folder: $resolvedClient"
if ($Build) { $summary += "`nBuild finished." }
if ($targets.Count) { $summary += "`nInstalled into: $($targets.Label -join ', ')" }
$summary += "`n`nClose Discord completely and open it again. Then turn on discord e2ee in Plugins."
Write-Host $summary

if ($Mode -eq "Gui") {
    Add-Type -AssemblyName System.Windows.Forms
    [void][System.Windows.Forms.MessageBox]::Show(
        $summary,
        "discord e2ee",
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Information
    )
}
