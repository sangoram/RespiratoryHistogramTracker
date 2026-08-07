# NICU Respiratory Tracker — Netlify deploy

Static app (index.html + support.js) + one serverless function (/api/data) that stores
all entries in Netlify Blobs, so everyone with the URL sees the same live data
(the board polls every 5 seconds).

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

## Important
- Drag-and-drop upload in the Netlify UI will NOT work — it skips installing the
  function's database dependency. Use Option A or B.
- No database setup needed: Netlify Blobs is built into every Netlify account.
- The URL is the only access control. Anyone with it can enter/edit data, so avoid
  real patient identifiers unless you add authentication (e.g. Netlify password
  protection on paid plans, or ask me to add a shared PIN).
- Without the backend (e.g. opening index.html locally) the app still works,
  saving to that browser only ("This device only" badge).
