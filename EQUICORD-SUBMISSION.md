# Prepare an Equicord submission

Do not open the pull request from this repository. Equicord accepts plugin changes through its own repository.

1. Check Equicord's open pull requests and plugin request tracker.
2. Ask for feedback on the plugin request before writing the submission.
3. Fork Equicord and create a branch from `dev`.
4. Copy `discordE2ee` to `src/equicordplugins/discordE2ee` in the Equicord checkout.
5. Add this entry inside `EquicordDevs` in `src/utils/constants.ts`:

```ts
itzzzryze: {
    name: "itzzzryze",
    id: 845275368352251935n
},
```

6. Add this import to the plugin's `index.tsx`:

```ts
import { EquicordDevs } from "@utils/constants";
```

7. Replace the local author object with:

```ts
authors: [EquicordDevs.itzzzryze],
```

8. Run the repository checks:

```powershell
pnpm test
```

9. Commit the plugin folder and the constants change. Push the branch and open a pull request against `dev`.

Call the plugin end-to-end encoding in the request. Do not describe it as encryption. The shared 12-digit number is not a cryptographic key.
