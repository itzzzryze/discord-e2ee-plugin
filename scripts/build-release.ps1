param(
    [string]$Version = (Get-Content -LiteralPath (Join-Path (Split-Path -Parent $PSScriptRoot) "VERSION") -Raw).Trim()
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$outputFolder = Join-Path $projectRoot "dist"
$archiveName = "discord-e2ee-v$Version-windows.zip"
$archivePath = Join-Path $outputFolder $archiveName
$checksumPath = "$archivePath.sha256"
$tempRoot = [IO.Path]::GetTempPath().TrimEnd([IO.Path]::DirectorySeparatorChar)
$stagingRoot = Join-Path $tempRoot ("discord-e2ee-release-" + [Guid]::NewGuid().ToString("N"))
$packageRoot = Join-Path $stagingRoot "discord-e2ee"

try {
    New-Item -ItemType Directory -Path $packageRoot -Force | Out-Null
    New-Item -ItemType Directory -Path $outputFolder -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $packageRoot "discordE2ee") -Force | Out-Null

    foreach ($file in @("README.md", "INSTALL-GUIDE.md", "Install-GUI.cmd", "install.ps1", "LICENSE", "VERSION")) {
        Copy-Item -LiteralPath (Join-Path $projectRoot $file) -Destination (Join-Path $packageRoot $file) -Force
    }
    Copy-Item -LiteralPath (Join-Path $projectRoot "discordE2ee\index.tsx") -Destination (Join-Path $packageRoot "discordE2ee\index.tsx") -Force
    Copy-Item -LiteralPath (Join-Path $projectRoot "discordE2ee\protocol.ts") -Destination (Join-Path $packageRoot "discordE2ee\protocol.ts") -Force

    Compress-Archive -LiteralPath $packageRoot -DestinationPath $archivePath -CompressionLevel Optimal -Force
    $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $archivePath).Hash.ToLowerInvariant()
    Set-Content -LiteralPath $checksumPath -Value "$hash *$archiveName" -Encoding utf8NoBOM
    Write-Host "Built $archivePath"
    Write-Host "SHA-256: $hash"
} finally {
    if (Test-Path -LiteralPath $stagingRoot -PathType Container) {
        $resolvedStaging = (Resolve-Path -LiteralPath $stagingRoot).Path
        $resolvedTemp = (Resolve-Path -LiteralPath $tempRoot).Path
        if (-not $resolvedStaging.StartsWith($resolvedTemp, [StringComparison]::OrdinalIgnoreCase) -or
            -not (Split-Path -Leaf $resolvedStaging).StartsWith("discord-e2ee-release-")) {
            throw "Refusing to remove an unexpected staging folder: $resolvedStaging"
        }
        Remove-Item -LiteralPath $resolvedStaging -Recurse -Force
    }
}
