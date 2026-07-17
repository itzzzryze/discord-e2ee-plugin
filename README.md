# discord e2ee

`e2ee` means end-to-end encoding in this project. It does not mean end-to-end encryption.

The plugin scrambles Discord text with a shared 12-digit code. People using the same code see the original message. Everyone else sees an `EC3E:` string.

The number is not a secure encryption key. Anyone who gets it can read the messages and make messages that the plugin accepts. Discord still receives message metadata and the scrambled text.

## What works

- Direct messages, group DMs, and server channels
- Equicord and Vencord source builds
- Discord Stable and Discord Canary on Windows
- GIF picker posts
- Web embeds from Tenor, YouTube, Imgur, Giphy, Twitch, Streamable, and other sites using normal HTTP or HTTPS links

Web links stay visible in the raw Discord message so Discord can build the embed. The plugin still restores the full original message for people with the code. Uploaded files and stickers are blocked by default because their contents are not scrambled.

## Install

Download the ZIP from the [public releases page](https://github.com/itzzzryze/discord-e2ee-releases/releases/latest) and extract it. Double-click `Install-GUI.cmd`, choose an Equicord or Vencord source checkout, then choose Discord Stable, Canary, or both.

You can also run the installer from PowerShell:

```powershell
.\install.ps1 -Mode Cli
```

Close Discord completely after the build finishes. Open it again, go to Plugins, and turn on `discord e2ee`.

The full setup steps and CLI options are in [INSTALL-GUIDE.md](INSTALL-GUIDE.md).

## Set up a DM

1. Open the Equicord or Vencord toolbox.
2. Click `Make and copy a new 12-digit code`.
3. Send the number to the other person.
4. Right-click that person and click `Set shared code`.
5. Have them save the same number for you.

Remove the shared code when you want that DM to send normal text again.

## Set up a group or channel

Right-click the group DM or server channel and click `Set channel code`. Everyone who needs to read the messages must save the same number in that channel.

## How messages are handled

The plugin derives a new pattern from the shared number every 30 seconds. It applies 50 reversible byte operations and adds a random nonce to each message. Old messages keep the time window needed to restore them.

HTTP and HTTPS links are copied after the encoded envelope. This leaves them available to Discord's embed system. The original links also remain inside the scrambled payload.

## Tests

Use Node.js 24 or newer:

```powershell
node --test .\tests\protocol.test.ts
```

## Equicord submission

The files in `discordE2ee` are ready for local Equicord and Vencord builds. Read [EQUICORD-SUBMISSION.md](EQUICORD-SUBMISSION.md) before opening an official Equicord pull request.

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).
