# Install discord e2ee

The installer copies the plugin into an Equicord or Vencord source checkout, builds that client, and installs it into Discord.

## Files you need

Keep this layout after extracting the release ZIP:

```text
discord-e2ee/
├── discordE2ee/
│   ├── index.tsx
│   ├── protocol.ts
│   └── state.ts
├── INSTALL-GUIDE.md
├── Install-GUI.cmd
├── LICENSE
├── README.md
├── VERSION
└── install.ps1
```

## Before installing

Install [Git for Windows](https://git-scm.com/download/win) and [Node.js LTS](https://nodejs.org/). Then open PowerShell without administrator rights and install pnpm:

```powershell
npm install -g pnpm
```

Clone one client source tree if you do not already have one.

Equicord:

```powershell
cd "$HOME\Documents"
git clone https://github.com/Equicord/Equicord
cd "$HOME\Documents\Equicord"
pnpm install --no-frozen-lockfile
```

Vencord:

```powershell
cd "$HOME\Documents"
git clone https://github.com/Vendicated/Vencord
cd "$HOME\Documents\Vencord"
pnpm install --no-frozen-lockfile
```

## Install with the window

1. Extract the release ZIP.
2. Double-click `Install-GUI.cmd`.
3. Choose the Equicord or Vencord source folder.
4. Check Discord Stable, Canary, or both.
5. Click `Continue`.
6. Wait for the build and installer to finish.
7. Close Discord completely and reopen it.
8. Open Plugins and turn on `discord e2ee`.

Do not run the installer as administrator.

## Install from PowerShell

Let the script find the source tree and Discord installs:

```powershell
.\install.ps1 -Mode Cli
```

Install Equicord into Stable:

```powershell
.\install.ps1 `
  -ClientPath "$HOME\Documents\Equicord" `
  -DiscordBranch Stable
```

Install Vencord into Canary:

```powershell
.\install.ps1 `
  -ClientPath "$HOME\Documents\Vencord" `
  -DiscordBranch Canary
```

Install the selected client into both:

```powershell
.\install.ps1 `
  -ClientPath "$HOME\Documents\Equicord" `
  -DiscordBranch Both
```

Copy the source without building or changing Discord:

```powershell
.\install.ps1 `
  -ClientPath "$HOME\Documents\Equicord" `
  -Build:$false `
  -Inject:$false
```

Use custom Discord folders:

```powershell
.\install.ps1 `
  -ClientPath "D:\Source\Vencord" `
  -DiscordBranch Both `
  -StableDiscordPath "D:\DiscordStable" `
  -CanaryDiscordPath "D:\DiscordCanary"
```

The normal folders are `%LOCALAPPDATA%\Discord` and `%LOCALAPPDATA%\DiscordCanary`.

## Use the plugin

For a DM, right-click the other person and click `Set shared code`. Both people must save the same 12 digits for each other.

For a group DM, right-click its icon and click `Set group code`. Everyone using the plugin must save the same number there.

For a server, right-click the server icon and click `Set server code`. That code covers every text channel in the server. A code set directly on one channel takes priority over the server code.

The lock button beside Gift and GIF opens the current code. The modal shows the saved digits and lets you save a replacement, remove the code, or pause it. Pausing stops encoding for your outgoing messages without deleting the code. Incoming messages still get restored.

Use `Change or remove shared code` or `Change or remove channel code` when you want to replace or remove one.

GIF picker posts are allowed. HTTP and HTTPS links stay visible so Discord can show embeds from YouTube, Tenor, Imgur, Giphy, Twitch, Streamable, and other supported sites. Uploaded files and stickers are blocked by default.

## Fix common errors

### No source folder was found

Pass the real folder with `-ClientPath`. `C:\path\to\Equicord` is example text and will not work.

### PowerShell cannot find pnpm

Install Node.js LTS, reopen PowerShell, and run:

```powershell
npm install -g pnpm
```

### The plugin is missing

Check for these files in the source checkout:

```text
src\userplugins\discordE2ee\index.tsx
src\userplugins\discordE2ee\protocol.ts
src\userplugins\discordE2ee\state.ts
```

Build that checkout again, then restart the Discord version where you installed it.

### Someone sees an EC3E string

Their plugin is off, or they have not saved the same user or channel code.

### An embed does not appear

Send a normal `http://` or `https://` link. Discord decides which sites produce an embed. The plugin leaves those links visible but cannot force Discord to embed them.

## Update

Extract the new ZIP and run the installer again. It removes the old `e2eeOverlay` user-plugin folder, keeps saved codes, and installs the current `discordE2ee` folder.
