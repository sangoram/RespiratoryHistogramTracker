# OWL — Oxygen With Love

A free tool for NICUs to aid precision delivery and decision support around that
precious molecule of life.

Static app (index.html + support.js) plus one serverless function (`/api/data`) that
stores entries in Netlify Blobs, so everyone with the URL sees the same live board
(it polls every 5 seconds).

## Three NICUs, one site

The site serves three fixed NICUs, each with its own private board, password and
permanent bed layout:

| NICU | Code |
|---|---|
| Thimphu | `THIMPHU` |
| Walnut Creek | `WALNUTCREEK` |
| San Leandro | `SANLEANDRO` |

- **Home page** — three tiles. Pick your NICU, enter its password, and the device
  remembers it. A bookmark like `/?unit=SANLEANDRO` opens straight to that NICU's
  password box. **Unit → Switch NICU / sign out** forgets it on that device.
- **Passwords** are set by the admin in the admin tool and stored only as salted
  PBKDF2 hashes (blob `auth`). A NICU stays closed until it has one. Changing a
  password signs out every device using the old one. Eight wrong tries trigger a
  two-minute cool-down for that NICU.
- **No patient identifiers** — bed labels only. The server refuses name/MRN writes and
  strips them from imports.

## Admin tool (layouts + passwords)

Set two environment variables in Netlify (Site configuration -> Environment variables,
all deploy contexts):

    OWL_ADMIN_TOKEN   any long random string
    OWL_ADMIN_PIN     six digits

Open `/?admin=<token>` and enter the PIN (three wrong tries locks that device out for
five minutes). One card per NICU:

- **Build / Edit layout** — the grid layout builder: drag runs of beds, rename by
  double-click, group open bays, trace over a floorplan image, starters, undo/redo.
- **Save draft** keeps it in the admin tool only. **Make permanent** publishes it: the
  NICU's board, reports, archives and unit map follow it, and the unit cannot change
  it. Re-open it here any time to adjust.
- **Set / Change password**, **Open board** (purple ADMIN VIEW; saves are stamped
  ADMIN), **Export JSON**.

Moving or renaming a bed keeps its history (beds have stable internal keys). Erasing a
bed and drawing a new one does not.

## San Leandro keeps its history

On the production deploy, `SANLEANDRO` is seeded on first use from the earlier live
data (the original single-board `store` key; or `unit-OWL-KSLN` if the demo ever ran in
production), with any names/MRNs stripped. The old key is left untouched as a backup.
Until its layout is made permanent, San Leandro shows the standard 20 beds (ICN-1 to
ICN-20). Build its layout by moving and renaming those 20 beds.

## Clinical features
- Beds colour-coded by respiratory support severity (HFOV purple, SIMV red,
  NAVA/CPAP orange, HFNC yellow, NC blue, RA green).
- Entries capture support mode + settings, FiO2 range, target SpO2
  (Standard 90-95, BPD 94-98, PPHN 92-97, ROP 97-99, or Custom — remembered per bed),
  saturation histogram (below / in / above target), and tachypnea
  (% RR>60 optional, % RR>70 required, % RR>80 optional).
- **Cumulative oxygenation** — every card shows a running interval-weighted tally of
  all histograms entered (blue under-target / green in-target / red over-target),
  agnostic of each entry's absolute target values. Repeated in full at the top of the
  bed detail view.
- Sprint mode: two support modalities on a schedule (e.g. CPAP 6h / RA 6h from 07:00).
  The app imputes time on each mode within the entry's interval; the card background
  splits proportionally and the mode badge shows the intended split.
- Comparison scrubbing: two sliders (or clicking log rows) pick ANY two entries to
  compare — aqua = newer, purple = older — with paired vertical bars and horizontal
  stacked bars (blue = below target, green = in target, red = above target).
- Archive: "Archive & clear bed" bundles a discharged patient's log by bed + date.
  The header's Archive tab views, restores, exports, or deletes bundles.
- Reports: Current NICU Snapshot and Complete Histogram Log (print to PDF), plus
  full JSON backup/import.

## Deploy — Option A: GitHub (recommended)
1. Put this folder in a GitHub repo (repo root = this folder).
2. On netlify.com: Add new site -> Import an existing project -> pick the repo.
3. Accept defaults (netlify.toml configures everything) and deploy.
4. Open the site URL — the header should show "Shared - live".

## Deploy — Option B: Netlify CLI
    cd netlify-deploy
    npm install
    npx netlify-cli login
    npx netlify-cli deploy --prod

(First deploy: choose "Create & configure a new project"; publish directory = ".")

## Demo / branch deploys — isolated data
Branch deploys get their own sandbox data store, so a shared demo can't touch
production entries. The function keys the Blobs store off the request hostname:

- Production URL (yoursite.netlify.app or custom domain) -> store `nicu-resp`
- Branch deploy (e.g. demo--yoursite.netlify.app) -> store `nicu-resp-demo`

Setup: enable branch deploys in Netlify (Site configuration -> Build & deploy ->
Branches and deploy contexts), keep the SAME data.mjs in every branch, and share the
`branch--` URL with trial units. Verify which store and unit key a URL is using with
`/api/data?whoami`. Seed a demo with production data via Backup on production ->
Import on the demo URL (writes only to the demo store).

Preview and branch deploys use their own store, so San Leandro starts empty there and
the admin sets that deploy's passwords separately.

## Important
- Drag-and-drop upload in the Netlify UI will NOT work — it skips installing the
  function's dependency. Use Option A or B.
- No database setup needed: Netlify Blobs is built into every Netlify account.
- Each NICU's password is a light gate, not a medical-record login. Keep to bed labels
  only — the tool does not accept patient identifiers.
- Without the backend (e.g. opening index.html locally) the app still works, saving
  to that browser only ("This device only" badge).
