# Grand Jeu Fanar

A small website for the grand jeu. It runs on Google Apps Script and uses a Google Sheet as its database.

## This fork

This copy uses the Apps Script URL in `index.html` for the shared Sheet, accounts
and challenge statuses. Image riddles require the matching updated backend and
the private image file described below; the site refuses an older backend.

- Written-out `https://`, `http://` and `www.` links in challenge text are clickable
  for both patrols and admins. They open in a new tab. Keep writing URLs directly
  in the Défis cells; links attached only to words are not returned by the current backend.
- The site includes a phone viewport, touch controls, wrapping admin controls and
  scrollable patrol tabs.
- Locations appear as image riddles. Only admin responses include their names.
  Patrol responses contain image bytes only after the threshold is met. Pictures
  have generic alternative text and no descriptive filenames or image URLs.

### Private image setup

1. Place source PNGs in the project folder, named exactly like the Lieux cells.
2. Install Pillow locally if needed, then run `python tools/build-private-images.py`.
3. In the Sheet's Apps Script project, create a script file named `LocationImages`
   and paste the generated `.private/LocationImages.gs`. This file contains the
   answers and must stay private. Neither source PNGs nor `.private/` are committed.
4. Update `Code.gs` and `Index` from this repository, save, and deploy a new version
   of the existing deployment. Check `/exec?ping=1` returns `riddleVersion: 1`.

Alternatively, paste `.private/DeployCode.gs` into Apps Script's `Code.gs`; this
combines the backend and private images into one file, so no separate
`LocationImages` script is needed. Never copy the combined file into this repository.

Images are re-encoded without original metadata. The public repository contains
no answer mapping, image bundle or source images. The private helper ends in `_`,
so Apps Script does not expose it through `google.script.run`; the JSON API also
allows only login, getData and setStatus. Missing images show a generic message,
never a location name. The same Sheet remains the source of unlock thresholds.

Every accessible deployment of the old backend must be updated or retired: an
old deployment can still return location names even if the new frontend hides them.
Keep the Sheet itself restricted to organizers, since its Lieux tab contains answers.

For this fork, configure GitHub Pages to publish `main` from `/ (root)`. Its site
address is `https://chrs-005.github.io/grandjeufanar/`.

- **Admin** (one account) sees a page for each patrol (Requin, Faucon, Bison, Leops, Panda) and marks each challenge **À faire**, **Validé** or **Refusé**.
- **Each patrol** logs in and sees only its own page, read-only: its remaining, rejected and accepted challenges.
- Each time a patrol reaches the number of accepted challenges set in the sheet (4, 8, 12… by default), the next location appears on its screen. Patrol screens refresh on their own every 15 seconds.

## The Google Sheet

The sheet has three tabs. Tab names and column headers must stay as they are, but rows can be added or removed freely.

| Tab | Contents |
|---|---|
| **Défis** | Column A holds the challenge text, with one column per patrol. Each cell is empty (à faire), `Validé` or `Refusé`. The website writes these values, and you can also change them directly in the sheet with the dropdown. |
| **Lieux** | Column A holds the number of accepted challenges needed. Each patrol column holds the location that patrol sees once it reaches that number. A blank cell means no location for that patrol at that step. |
| **Comptes** | Each row has an `Identifiant`, a `Mot de passe` and a `Patrouille` (a patrol name, or `Admin`). Changing a password logs that account out everywhere. |

Logins aren't case-sensitive; passwords are. Passwords are kept only in the sheet, never in this repository.

## Setup (once)

### 1. Attach the script to the sheet

1. Open the Google Sheet, then go to **Extensions → Apps Script**.
2. Replace everything in `Code.gs` with this repo's [`Code.gs`](Code.gs).
3. Click **+ → HTML**, name the file `Index` (no extension), and paste in [`index.html`](index.html).
4. Click **Save**, then **Deploy → New deployment**. Click the gear icon, choose **Web app**, and set:
   - **Execute as:** Me
   - **Who has access:** Anyone
5. Click **Deploy** and authorize the script. Google warns that the app isn't verified; click **Advanced → Go to … (unsafe)**. That warning is normal for your own script, and the script only has access to this one spreadsheet.
6. Copy the **Web app URL** (it ends in `/exec`). If it differs from `API_URL` near the top of the script in `index.html`, put the new URL there.

### 2. Publish the website on GitHub Pages

In this repository on GitHub, go to **Settings → Pages**. Under **Build and deployment**, choose **Deploy from a branch**, pick the branch that holds these files and the `/ (root)` folder, then click **Save**. After a minute or two, the site is at **https://charbels07.github.io/grandjeufanar/**, and that is the link to give to the patrols.

The `/exec` link from step 1 shows the same website too. The GitHub link is shorter, has no Google banner, and isn't affected by Google's "unable to open the file" error when a browser is signed into several Google accounts.

## Updating the code later

Paste the new `Code.gs` into Apps Script, then go to **Deploy → Manage deployments**, click the pencil, set **Version** to **New version**, and click **Deploy**. The `/exec` URL stays the same. If you create a *new* deployment instead, you get a new URL and must update `API_URL` in `index.html`.

You don't need to redeploy after editing challenges, locations or passwords in the sheet. The website reads the sheet live.

## Changing the patrols

The patrol names are listed in `PATROLS` at the top of `Code.gs`. They must match the column headers in **Défis** and **Lieux** and the `Patrouille` column in **Comptes**. Accents and capital letters don't matter.
