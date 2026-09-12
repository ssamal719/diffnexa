# Putting DiffNexa Stage 1 into your GitHub repository

Your repository: **https://github.com/ssamal719/diffnexa**

Everything is already prepared inside the zip:

- All files are committed, on a branch called `main`.
- Your repository is already set as the destination ("remote"), so no address needs typing.
- Nothing secret is included. There are no keys, no passwords, and no documents.

You only need to sign in with your GitHub account and press publish. Pick one of
the two methods below. **Method A is the recommended one.**

---

## Method A — GitHub Desktop (recommended, no typing)

GitHub Desktop is a normal app with buttons. It signs you in through your
browser, so no password or token is ever copied or pasted.

1. **Unzip the project.** Put the folder somewhere you'll keep it, for example
   `Documents/diffnexa`. You should see folders named `apps`, `docs`, `golden`
   and `packages` inside it.
2. **Download GitHub Desktop** from https://desktop.github.com and install it.
3. **Sign in.** Open it, choose *Sign in to GitHub.com*, and complete the sign-in
   in your browser when it opens.
4. **Add the project.** From the menu choose *File → Add Local Repository*,
   then select your `diffnexa` folder and click *Add Repository*.
   - It will recognise the existing project and history. If it offers to create a
     repository instead, you selected the wrong folder — go up one level and
     choose the folder that directly contains `apps` and `docs`.
5. **Publish.** Click the **Publish repository** button at the top.
   - Uncheck *Keep this code private* only if you want the code public. Leave it
     checked to stay private.
   - If it asks which repository, choose the existing `ssamal719/diffnexa`.
6. **Check it worked.** Open https://github.com/ssamal719/diffnexa in your
   browser. Use the checklist at the bottom of this page.

That's it. From then on, GitHub Desktop shows every change as a list, and
publishing an update is the same two clicks.

---

## Method B — Claude Code (you'll be installing this anyway for Stage 2)

1. Unzip the project as in step 1 above.
2. Install Claude Code from https://claude.ai/download.
3. Open the `diffnexa` folder in Claude Code.
4. Ask it, in plain English:

   > Sign me in to GitHub, then push this project to my repository
   > ssamal719/diffnexa on the main branch. Do not change any files.

   It will open a browser window for you to approve the GitHub sign-in. Your
   password and token stay between your browser and GitHub.
5. Check the result with the checklist below.

---

## Why I could not do this for you

I can reach GitHub from my sandbox, but I have no way to prove I'm you. The only
way to give me that proof through this chat would be pasting a personal access
token, which is the same as a password — and it would be stored permanently in
the conversation. Both methods above sign you in through your own browser
instead, so nothing sensitive is ever written down.

---

## Checklist: is everything there?

Open https://github.com/ssamal719/diffnexa and confirm:

- [ ] The file count is **95 files** across the folders `apps`, `docs`, `golden`,
      `packages`, `.github`.
- [ ] `README.md` is displayed on the front page.
- [ ] The **Actions** tab shows two workflows running or finished: *Engine* and
      *Web*. Green ticks mean all 123 engine tests, 29 website tests and the
      accuracy suite passed on GitHub's own computers, not just mine.
- [ ] `apps/engine/diffnexa_engine/contracts/changes.py` exists (the evidence rule).
- [ ] `golden/baseline.json` exists (the accuracy ratchet).
- [ ] There is **no** `.env` file, no `node_modules` folder, and no PDF files.
      Only `.env.example`, which contains placeholders.

If the Actions tab shows a red cross, send me the name of the failed step and
I'll fix it before Stage 2.

---

## What must never be committed later

The `.gitignore` file already blocks these, but for your own awareness:

| Never publish | Why |
|---|---|
| `.env` files | They will hold your real API keys |
| Any real API key, token or password | Leaked keys are the most common cause of large surprise bills |
| Confidential PDFs | Test documents must be public or ones you may store |
| `node_modules`, `.next`, `reports/`, `golden/.generated/` | Rebuilt automatically; they would bloat the repository |

If a key is ever exposed by accident, treat it as compromised: delete it at the
provider and create a new one. Removing it from GitHub afterwards is not enough.
