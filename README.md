# discord e2ee

`e2ee` in this case means end to end encoding.

The plugin scrambles Discord text with a shared 12-digit code. People using the same code see the original message. Everyone else sees an `EC3E:` string.

The number is not a secure encryption key. Anyone who gets it can read the messages and make messages that the plugin accepts. Discord still receives message metadata and the scrambled text.
discord is never able to read the unencrypted message on their end, making ur messages much more secure.

## What works

- Direct messages, group DMs, and server channels
- One code for an entire server
- A message-box button for viewing, changing, pausing, or removing the current code
- Equicord and Vencord source builds
- Discord Stable and Discord Canary on Windows
- GIF picker posts
- Web embeds from Tenor, YouTube, Imgur, Giphy, Twitch, Streamable, and other sites using normal HTTP or HTTPS links

Web links stay visible in the raw Discord message so Discord can build the embed. The plugin still restores the full original message for people with the code. Uploaded files and stickers are blocked by default because their contents are not scrambled.

## Install from source on Windows

You need [Git for Windows](https://git-scm.com/download/win), [Node.js](https://nodejs.org/), pnpm, and an Equicord or Vencord source checkout. Open PowerShell without administrator rights and install pnpm:

```powershell
npm install -g pnpm
```

Clone Equicord or Vencord into your Documents folder. You only need one of them.

Equicord:

```powershell
cd "$HOME\Documents"
git clone https://github.com/Equicord/Equicord.git
cd Equicord
pnpm install --no-frozen-lockfile
```

Vencord:

```powershell
cd "$HOME\Documents"
git clone https://github.com/Vendicated/Vencord.git
cd Vencord
pnpm install --no-frozen-lockfile
```

Clone this repo and start its installer:

```powershell
cd "$HOME\Documents"
git clone https://github.com/itzzzryze/discord-e2ee.git
cd "discord-e2ee"
.\install.ps1 -Mode Gui
```

Choose the Equicord or Vencord folder you cloned. The next window lists the Discord Stable and Canary installations found on your computer. Check the ones you want and click `Continue`.

The script copies `discordE2ee` into the client's `src\userplugins` folder, builds the client, and installs that build into the Discord versions you selected. When it finishes, close Discord completely, open it again, go to Plugins, and turn on `discord e2ee`.

If PowerShell blocks local scripts, run this command from the repo folder:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -Mode Gui
```

The installer also has a text mode:

```powershell
.\install.ps1 -Mode Cli
```

See [INSTALL-GUIDE.md](INSTALL-GUIDE.md) for path options, manual source copying, and fixes for common errors.

## Install a release build

Download the ZIP from the [public releases page](https://github.com/itzzzryze/discord-e2ee-releases/releases/latest), extract it, and double-click `Install-GUI.cmd`. The ZIP contains the same plugin source and installer stored in this repo.

## Set up a DM

1. Open the Equicord or Vencord toolbox.
2. Click `Make and copy a new 12-digit code`.
3. Send the number to the other person.
4. Right-click that person and click `Set shared code`.
5. Have them save the same number for you.

Remove the shared code when you want that DM to send normal text again.

## Use the message-box button

The lock button sits on the right side of the message box beside Discord's Gift and GIF buttons. Click it to open the code used in the current place.

The saved 12-digit code is shown in the input. You can replace it, remove it, or click `Pause here`. Pausing stops your outgoing messages from being encoded but keeps the code saved. Incoming messages still get restored. Click `Resume here` when you want to use it again.

The button is green when encoding is on and yellow with a slash when it is paused.

## Set up a group DM

Right-click the group DM icon and click `Set group code`. Everyone who needs to read the messages must save the same number in that group.

## Set up a server

Right-click the server icon and click `Set server code`. The code applies to your outgoing messages in every text channel in that server. Other plugin users must save the same server code on their clients.

Right-clicking one server channel still lets you set a channel-only code. A channel code takes priority over the server code.

## How messages are handled

The plugin derives a new pattern from the shared number every 30 seconds. It applies 50 reversible byte operations and adds a random nonce to each message. Old messages keep the time window needed to restore them.

HTTP and HTTPS links are copied after the encoded envelope. This leaves them available to Discord's embed system. The original links also remain inside the scrambled payload.

## Source files

- `discordE2ee/index.tsx` contains the Discord menus, message-bar button, settings, message hooks, and saved-code handling.
- `discordE2ee/protocol.ts` contains the reversible message format.
- `discordE2ee/state.ts` chooses the code for a DM, group DM, channel, or server.
- `install.ps1` copies, builds, and installs the plugin on Windows.
- `tests` contains the protocol and code-selection tests.

Everything needed to build the plugin is tracked in this repo. Generated ZIP files and client build output are left out.

## Test the source

Use Node.js 24 or newer:

```powershell
node --test .\tests\protocol.test.ts .\tests\state.test.ts
```

To check the plugin inside an Equicord or Vencord checkout, copy the `discordE2ee` folder into `src\userplugins\discordE2ee`, then run:

```powershell
pnpm build
pnpm testTsc
```

## Update a source install

Pull the current files and run the installer again:

```powershell
cd "$HOME\Documents\discord-e2ee"
git pull
.\install.ps1 -Mode Gui
```

Saved codes are stored by Equicord or Vencord. Reinstalling the plugin does not remove them.

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).
