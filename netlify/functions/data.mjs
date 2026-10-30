import { getStore } from '@netlify/blobs';
import { pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';

// OWL data API — three fixed NICUs on one deployment.
//
// Each NICU's data lives under its own key (`unit-<CODE>`) so units never see each
// other's boards. Every read and write needs that NICU's password (sent in the
// `x-unit-pass` header) or admin credentials. Passwords are set by the admin in the
// admin tool and stored only as salted PBKDF2 hashes in the `auth` blob.
//
// Layouts are built in the admin tool and made permanent there; units cannot change
// their own layout. No patient identifiers: bed labels only.
//
// SANLEANDRO on the production deploy inherits the earlier live data (first from the
// OWL demo's `unit-OWL-KSLN`, else the original single-board `store` key).

const UNITS = {
  THIMPHU: 'Thimphu',
  WALNUTCREEK: 'Walnut Creek',
  SANLEANDRO: 'San Leandro'
};
const ORDER = ['THIMPHU', 'WALNUTCREEK', 'SANLEANDRO'];
const LEGACY_KEYS = ['unit-OWL-KSLN', 'store'];
const AUTH = 'auth';
const MAX_FAILS = 8;          // wrong passwords before a cool-down
const COOL_MS = 2 * 60 * 1000;

const blank = () => ({ rooms: {}, meta: {}, archives: {} });

const hashPass = (pw, salt) => pbkdf2Sync(String(pw), salt, 120000, 32, 'sha256').toString('hex');
const checkPass = (pw, rec) => {
  if (!rec || !rec.salt || !rec.hash || !pw) return false;
  const a = Buffer.from(hashPass(pw, rec.salt), 'hex');
  const b = Buffer.from(rec.hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
};

const summarize = (code, d, authRec) => {
  const rooms = (d && d.rooms) || {};
  let entries = 0, lastTs = null;
  Object.keys(rooms).forEach(k => (rooms[k] || []).forEach(e => {
    entries++;
    if (e && e.ts && (!lastTs || e.ts > lastTs)) lastTs = e.ts;
  }));
  const L = (d && d.layout) || null;
  return {
    code,
    name: UNITS[code],
    beds: L && L.beds ? L.beds.length : 0,
    occupied: Object.keys(rooms).filter(k => (rooms[k] || []).length).length,
    entries,
    lastTs,
    hasLayout: !!(L && L.beds && L.beds.length),
    permanent: !!(L && L.permanent),
    layoutUpdatedAt: (L && L.updatedAt) || null,
    hasPassword: !!(authRec && authRec.hash),
    passwordSetAt: (authRec && authRec.setAt) || null
  };
};

// Strip patient identifiers from anything a unit writes or imports.
const scrubMeta = (meta) => {
  const out = {};
  Object.keys(meta || {}).forEach(k => {
    const m = { ...(meta[k] || {}) };
    delete m.name; delete m.mrn;
    if (Object.keys(m).length) out[k] = m;
  });
  return out;
};

export default async (req) => {
  const url = new URL(req.url);
  const host = url.hostname;
  const m = host.match(/^([^.]+?)--/);
  const label = m ? m[1].toLowerCase() : null;
  const isProd = !label;
  const storeName = label ? `nicu-resp-${label}` : 'nicu-resp';
  const store = getStore({ name: storeName, consistency: 'strong' });

  const unit = (url.searchParams.get('unit') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 16);
  const known = !!UNITS[unit];
  const KEY = 'unit-' + unit;

  // Admin: URL token AND, when configured, a 6-digit PIN (both Netlify env vars).
  const token = process.env.OWL_ADMIN_TOKEN || '';
  const envPin = process.env.OWL_ADMIN_PIN || '';
  const tokenOk = !!token && url.searchParams.get('admin') === token;
  const pinOk = !envPin || url.searchParams.get('pin') === envPin;
  const admin = tokenOk && pinOk;

  const authRead = async () => (await store.get(AUTH, { type: 'json' })) || {};

  const load = async () => {
    let d = await store.get(KEY, { type: 'json' });
    if (!d && isProd && unit === 'SANLEANDRO') {
      for (const lk of LEGACY_KEYS) {
        const legacy = await store.get(lk, { type: 'json' });
        if (legacy && legacy.rooms) {
          d = { rooms: legacy.rooms || {}, meta: scrubMeta(legacy.meta), archives: legacy.archives || {} };
          if (legacy.layout) d.layout = legacy.layout;
          await store.setJSON(KEY, d);   // copy forward; the legacy key is left untouched
          break;
        }
      }
    }
    return d;
  };

  // Unit password check with a per-unit cool-down after repeated misses.
  const unitAuth = async () => {
    if (admin) return { ok: true, admin: true };
    const auth = await authRead();
    const rec = auth[unit];
    if (!rec || !rec.hash) return { ok: false, status: 403, error: 'not_ready', message: `${UNITS[unit]} is not open yet — the administrator has not set its password.` };
    const failKey = 'fails-' + unit;
    const f = (await store.get(failKey, { type: 'json' })) || { n: 0, until: 0 };
    if (f.until && Date.now() < f.until) {
      return { ok: false, status: 429, error: 'cooldown', message: 'Too many wrong passwords — wait a couple of minutes and try again.' };
    }
    const pw = req.headers.get('x-unit-pass') || '';
    if (checkPass(pw, rec)) {
      if (f.n) await store.setJSON(failKey, { n: 0, until: 0 });
      return { ok: true };
    }
    const n = (f.n || 0) + 1;
    await store.setJSON(failKey, n >= MAX_FAILS ? { n: 0, until: Date.now() + COOL_MS } : { n, until: 0 });
    return { ok: false, status: 401, error: 'bad_password', message: 'That password is not right for ' + UNITS[unit] + '.' };
  };
  const deny = (a) => Response.json({ error: a.error, message: a.message }, { status: a.status });

  if (req.method === 'GET') {
    if (url.searchParams.has('whoami')) {
      return Response.json({ host, deployLabel: label, store: storeName, units: ORDER, unit: known ? unit : null, adminConfigured: !!token, pinRequired: !!envPin, tokenOk, admin });
    }

    // Public list of the three NICUs: names and whether they are open — never data.
    if (url.searchParams.has('units')) {
      const auth = await authRead();
      return Response.json({
        units: ORDER.map(c => ({ code: c, name: UNITS[c], open: !!(auth[c] && auth[c].hash) }))
      });
    }

    // Admin directory: full status for each NICU.
    if (url.searchParams.has('directory')) {
      if (!admin) {
        if (tokenOk) return Response.json({ units: [], admin: false, pinRequired: true }, { status: 401 });
        return new Response('Forbidden', { status: 403 });
      }
      const auth = await authRead();
      const units = [];
      for (const c of ORDER) {
        let d = await store.get('unit-' + c, { type: 'json' });
        if (!d && isProd && c === 'SANLEANDRO') {
          for (const lk of LEGACY_KEYS) { const lg = await store.get(lk, { type: 'json' }); if (lg && lg.rooms) { d = lg; break; } }
        }
        units.push(summarize(c, d, auth[c]));
      }
      return Response.json({ units, admin: true });
    }

    if (!known) return Response.json({ error: 'unknown_unit', message: 'Choose Thimphu, Walnut Creek or San Leandro.' }, { status: 404 });
    const a = await unitAuth();
    if (!a.ok) return deny(a);
    const d = (await load()) || blank();
    return Response.json(d);
  }

  if (req.method === 'POST') {
    if (!known) return new Response('Unknown unit', { status: 404 });
    let op;
    try { op = await req.json(); } catch (e) { return new Response('Bad JSON', { status: 400 }); }

    // Admin-only operations.
    if (op.op === 'setPassword') {
      if (!admin) return new Response('Forbidden', { status: 403 });
      const pw = String(op.password || '');
      if (pw.length < 4 || pw.length > 64) return new Response('Password must be 4–64 characters', { status: 400 });
      const auth = await authRead();
      const salt = randomBytes(16).toString('hex');
      auth[unit] = { salt, hash: hashPass(pw, salt), setAt: new Date().toISOString() };
      await store.setJSON(AUTH, auth);
      await store.setJSON('fails-' + unit, { n: 0, until: 0 });
      return Response.json({ ok: true, setAt: auth[unit].setAt });
    }

    const a = await unitAuth();
    if (!a.ok) return deny(a);
    const d = (await load()) || blank();
    d.rooms = d.rooms || {}; d.meta = d.meta || {}; d.archives = d.archives || {};
    const done = async (payload) => { await store.setJSON(KEY, payload); return Response.json(payload); };

    if (op.op === 'layout' && op.layout && typeof op.layout === 'object') {
      if (!a.admin) return new Response('Layouts are set in the admin tool', { status: 403 });
      d.layout = op.layout;
      return done(d);
    }
    if (op.op === 'import' && op.data && typeof op.data === 'object') {
      const nd = { rooms: op.data.rooms || {}, meta: scrubMeta(op.data.meta), archives: op.data.archives || {} };
      // Units keep their permanent layout; only the admin can import one.
      if (a.admin && op.data.layout) nd.layout = op.data.layout; else if (d.layout) nd.layout = d.layout;
      return done(nd);
    }
    if (op.op === 'restoreArchive' && op.id) {
      const ar = d.archives[op.id];
      if (!ar) return new Response('No such archive', { status: 404 });
      const to = String(op.to || '');
      if (!to) return new Response('Missing target room', { status: 400 });
      if (d.rooms[to] && d.rooms[to].length) return new Response('Target room occupied', { status: 409 });
      d.rooms[to] = ar.entries || [];
      delete d.archives[op.id];
      return done(d);
    }
    if (op.op === 'delArchive' && op.id) {
      delete d.archives[op.id];
      return done(d);
    }
    const k = String(op.room || '');
    if (!k) return new Response('Missing room', { status: 400 });

    if (op.op === 'add' && op.entry && typeof op.entry === 'object') {
      d.rooms[k] = d.rooms[k] || [];
      if (!d.rooms[k].some(e => e.id === op.entry.id)) d.rooms[k].push(op.entry);
    } else if (op.op === 'del' && op.id) {
      d.rooms[k] = (d.rooms[k] || []).filter(e => e.id !== op.id);
      if (!d.rooms[k].length) delete d.rooms[k];
    } else if (op.op === 'reset') {
      delete d.rooms[k]; delete d.meta[k];
    } else if (op.op === 'archive') {
      if (d.rooms[k] && d.rooms[k].length) {
        const id = String(op.aid || (Date.now() + '' + Math.floor(Math.random() * 1000)));
        const es = d.rooms[k].slice().sort((x, y) => (x.ts < y.ts ? 1 : -1));
        d.archives[id] = { id, room: k, archivedAt: new Date().toISOString(), lastTs: es[0] ? es[0].ts : null, entries: d.rooms[k], meta: {} };
      }
      delete d.rooms[k]; delete d.meta[k];
    } else if (op.op === 'edit' && op.entry && typeof op.entry === 'object' && op.entry.id) {
      d.rooms[k] = (d.rooms[k] || []).map(e => (e.id === op.entry.id ? op.entry : e));
    } else if (op.op === 'move' && op.to) {
      const to = String(op.to);
      if (d.rooms[to] && d.rooms[to].length) return new Response('Target room occupied', { status: 409 });
      if (d.rooms[k]) { d.rooms[to] = d.rooms[k]; delete d.rooms[k]; }
      if (d.meta[k]) { d.meta[to] = d.meta[k]; delete d.meta[k]; }
    } else if (op.op === 'meta') {
      return new Response('Patient identifiers are not stored', { status: 400 });
    } else {
      return new Response('Bad op', { status: 400 });
    }
    return done(d);
  }

  return new Response('Method not allowed', { status: 405 });
};

export const config = { path: '/api/data' };
