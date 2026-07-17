# discord e2ee 1.1.0

This release adds controls beside Discord's Gift and GIF buttons. The lock button shows the code used in the current DM, group DM, or server. It can replace or remove the code and pause or resume outgoing encoding without deleting anything.

Server-wide codes are now available from the server icon's right-click menu. Group DMs have their own right-click entry. A server code covers every text channel in that server, while a channel-only code takes priority when one is set.

Saved codes from 1.0.0 are migrated on first load. Incoming messages still get restored while outgoing encoding is paused.

The Windows ZIP contains the plugin source, GUI launcher, PowerShell installer, setup guide, license, and version file. It supports Equicord and Vencord source checkouts and can target Discord Stable, Canary, or both.

`e2ee` means end-to-end encoding in this project. The 12-digit shared number does not provide end-to-end encryption.
