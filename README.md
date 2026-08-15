# OWL — Oxygen With Love

A free tool for NICUs to aid precision delivery and decision support around that
precious molecule of life.

Static app (index.html + support.js) plus one serverless function (`/api/data`) that
stores entries in Netlify Blobs, so everyone with the URL sees the same live board
(it polls every 5 seconds).

## Any NICU, its own layout

A unit that arrives with no layout is asked to build one. The layout builder is a
grid canvas:

- **Add** — drag across cells to drop a run of beds, auto-numbered from the prefix
  and next-number fields (free text, so `12A`, `Bay 3-2` or bare numbers all work).
- **Arrange** — drag any bed to move it; click to select, drag a box to multi-select,
  double-click to rename in place, Delete to remove. Undo/redo and ⌘Z.
- **Bay** — drag a dashed outline around beds that share an open bay.
- **Erase** — drag over beds to remove them.
- **Floorplan underlay** — drop in a PNG or JPG of the unit sketch and trace beds
  over it with an opacity slider. The image is a guide only.
- **Starters** — U-shape around a central core, single row, double row, or pods.
- Gaps are allowed anywhere, so corridors, walls and cores stay empty.

**Save & lock** asks for a 4-digit PIN. The builder then disappears and the locked
layout informs the whole app — cards, logs, reports, archives and the unit map all
use the unit's own bed labels. It stays editable from **Unit** in the header with
that PIN.

The header carries a slim colour strip that expands to the full unit map: beds
coloured by the support in use, grey for empty. Clicking an empty bed admits a baby
and starts its first histogram.

## The home page

There is no shared default board. The home page is a unit directory:

- Units are **private by default**. A unit appears on the directory only if it turns on
  *Home page listing* in Unit settings, and even then a visitor sees just the unit name
  and a bed-occupancy bar — never the code, entry counts or dates.
- Clicking a listed unit asks for its code (5 wrong tries triggers a 60-second cooldown).
- Anyone with a code for an unlisted unit joins directly.
- A "What OWL does" panel explains the tool; the italic paragraph is a placeholder for
  copy coming from the OWL website.
- A **Give feedback** button mails sangoram+histogram@gmail.com with the unit code in
  the subject.

## Admin console

Set two environment variables in Netlify (Site configuration -> Environment variables):

    OWL_ADMIN_TOKEN   any long random string
    OWL_ADMIN_PIN     six digits

Visit `/?admin=<token>`, then enter the PIN (three wrong attempts locks that device out
for five minutes). The console lists every unit on the deployment — code, name, beds,
occupied, entries, last entry — and can **Open** a unit (joins it on this device),
export its **JSON**, or **Delete** it. While you are inside another unit a purple
ADMIN VIEW banner shows, and anything you save is stamped `ADMIN` in that unit's log.

Without the env vars the admin console is unreachable, and `/api/data?whoami` reports
`adminConfigured: false`.

## Multiple NICUs on one deployment

Each new unit gets a shareable code (`OWL-LJFC4` style — five characters). Anyone joining with that code
lands on the same board; the function keys the Blobs store by code
(`unit-OWL-LJF`), so units on the same deployment never see each other's data.
`OWL-KSLN` is the production home unit (San Leandro) and inherits the pre-code data that
used to live under the `store` key; it does not exist on branch/demo deploys. It keeps
full features including patient identifiers.

A link carrying the code — `https://yoursite.netlify.app/?unit=OWL-KSLN` — joins and
saves that unit on the device automatically, so a unit can bookmark one URL on every
workstation and iPad instead of typing the code.

Trial units — any code-generated unit other than the home unit — behave conservatively:
- **TRIAL** badge in the header with a 30-day idle countdown.
- No patient identifiers at all: bed labels only.
- "Fill with sample entries" in Unit settings, to see it populated before typing
  real numbers.

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

Trial units set up their own layouts on the demo fork. If a unit wants to keep going,
give them their own deployment of this same folder and have them Import the JSON
backup exported from the trial.

## Important
- Drag-and-drop upload in the Netlify UI will NOT work — it skips installing the
  function's dependency. Use Option A or B.
- No database setup needed: Netlify Blobs is built into every Netlify account.
- The URL (plus unit code) is the only access control. The layout PIN protects the
  layout, not the data. Avoid real patient identifiers unless you add authentication
  — trial units already suppress them.
- Without the backend (e.g. opening index.html locally) the app still works, saving
  to that browser only ("This device only" badge).
