# NICU Histogram Tracking Digital Binder — Netlify deploy

Static app (index.html + support.js) + one serverless function (/api/data) that stores
all entries in Netlify Blobs, so everyone with the URL sees the same live data
(the board polls every 5 seconds).

## Features
- 20-room unit board; rooms color-coded by respiratory support severity
  (HFOV purple, SIMV red, NAVA/CPAP orange, HFNC yellow, NC blue, RA green).
- Entries capture support mode + settings, FiO2 range, target SpO2
  (Standard 90-95, BPD 94-98, PPHN 92-97, ROP 97-99, or Custom — remembered per room),
  saturation histogram (below / in / above target), and tachypnea
  (% RR>60 optional, % RR>70 required, % RR>80 optional).
- Sprint mode: two support modalities on a schedule (e.g. CPAP 6h / RA 6h from 07:00).
  The app imputes time on each mode within the entry's histogram interval; the room
  card background splits proportionally (earlier mode left, later mode right) and the
  mode badge shows the intended schedule split.
- Comparison scrubbing: two sliders (or clicking log rows) pick ANY two entries to
  compare — aqua = newer, purple = older — with paired vertical bars and horizontal
  stacked bars (blue = below target / hypoxia, green = in target, red = above / hyperoxia).
- Archive: "Archive & clear room" bundles a discharged patient's log by room + date.
  The header's Archive tab views, restores, exports, or deletes bundles.
- Reports: Current NICU Snapshot and Complete Histogram Log (print to PDF),
  plus full JSON backup/import.

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
Branches and deploy contexts), keep the SAME data.mjs in every branch, and share
the `branch--` URL with demo users. Verify which store a URL uses with
`/api/data?whoami`. Seed a demo with production data via Backup on production ->
Import on the demo URL (writes only to the demo store).

## Important
- Drag-and-drop upload in the Netlify UI will NOT work — it skips installing the
  function's database dependency. Use Option A or B.
- No database setup needed: Netlify Blobs is built into every Netlify account.
- The URL is the only access control. Anyone with it can enter/edit data, so avoid
  real patient identifiers unless you add authentication (e.g. Netlify password
  protection on paid plans, or ask me to add a shared PIN).
- Without the backend (e.g. opening index.html locally) the app still works,
  saving to that browser only ("This device only" badge).
