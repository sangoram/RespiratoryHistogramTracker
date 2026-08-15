import { getStore } from '@netlify/blobs';

// OWL data API.
//
// Every unit lives under its own key: `unit-<CODE>`. The code is both the address and
// the password — there is no shared default board, so two units on the same deployment
// can never see each other's data.
//
// OWL-KSLN (San Leandro) is the production home unit and inherits the pre-code data
// that used to live under the `store` key. It does not exist on branch/demo deploys.

const HOME = 'OWL-KSLN';
const LEGACY = 'store';
const DIR = 'directory';

const fnv = (s) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
};

const blank = () => ({ rooms: {}, meta: {}, archives: {} });

const summarize = (code, d) => {
  const rooms = (d && d.rooms) || {};
  let entries = 0, lastTs = null;
  Object.keys(rooms).forEach(k => (rooms[k] || []).forEach(e => {
    entries++;
    if (e && e.ts && (!lastTs || e.ts > lastTs)) lastTs = e.ts;
  }));
  const L = (d && d.layout) || null;
  return {
    id: fnv(code),
    name: (L && L.name) || '',
    beds: L && L.beds ? L.beds.length : 0,
    occupied: Object.keys(rooms).filter(k => (rooms[k] || []).length).length,
    entries,
    lastTs,
    locked: !!(L && L.locked),
    listed: !!(L && L.listed === true),
    updatedAt: (L && L.updatedAt) || null
  };
};

export default async (req) => {
  const url = new URL(req.url);
  const host = url.hostname;
  const m = host.match(/^([^.]+?)--/);
  const label = m ? m[1].toLowerCase() : null;
  const isProd = !label;
  const storeName = label ? `nicu-resp-${label}` : 'nicu-resp';
  const store = getStore({ name: storeName, consistency: 'strong' });

  const unit = (url.searchParams.get('unit') || '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 16);
  const KEY = 'unit-' + unit;
  // Admin needs the URL token AND, when configured, a 6-digit PIN.
  const token = process.env.OWL_ADMIN_TOKEN || '';
  const envPin = process.env.OWL_ADMIN_PIN || '';
  const tokenOk = !!token && url.searchParams.get('admin') === token;
  const pinOk = !envPin || url.searchParams.get('pin') === envPin;
  const admin = tokenOk && pinOk;

  const dirRead = async () => (await store.get(DIR, { type: 'json' })) || { units: {} };
  const dirTouch = async (code, d) => {
    try {
      const dir = await dirRead();
      dir.units = dir.units || {};
      dir.units[code] = { code, ...summarize(code, d), seenAt: new Date().toISOString() };
      await store.setJSON(DIR, dir);
    } catch (e) { /* directory is a convenience index; never block a write on it */ }
  };

  // A branch/demo deploy has no home unit.
  if (unit === HOME && !isProd) {
    return Response.json({ error: 'unknown_unit', message: 'OWL-KSLN does not exist on this deployment.' }, { status: 404 });
  }

  const load = async () => {
    let d = await store.get(KEY, { type: 'json' });
    if (!d && isProd && unit === HOME) {
      const legacy = await store.get(LEGACY, { type: 'json' });
      if (legacy && legacy.rooms) {
        d = legacy;
        await store.setJSON(KEY, d);
        await dirTouch(unit, d);
      }
    }
    return d;
  };

  if (req.method === 'GET') {
    if (url.searchParams.has('whoami')) {
      return Response.json({ host, deployLabel: label, store: storeName, home: isProd ? HOME : null, unit: unit || null, key: unit ? KEY : null, adminConfigured: !!token, pinRequired: !!envPin, tokenOk, admin });
    }

    if (url.searchParams.has('directory')) {
      const dir = await dirRead();
      const all = Object.values(dir.units || {});
      if (admin) return Response.json({ units: all, admin: true });
      if (tokenOk) return Response.json({ units: [], admin: false, pinRequired: true }, { status: 401 });
      // Public directory: only units that opted in, and never their codes.
      const pub = all
        .filter(u => u.listed === true && (u.beds > 0 || u.entries > 0))
        .map(u => ({ id: u.id, name: u.name, beds: u.beds, occupied: u.occupied }));
      return Response.json({ units: pub });
    }

    if (!unit) {
      return Response.json({ error: 'unit_required', message: 'Join a unit with its code.' }, { status: 400 });
    }

    const d = await load();
    if (!d) return Response.json({ error: 'unknown_unit', message: 'No unit with that code.' }, { status: 404 });
    return Response.json(d);
  }

  if (req.method === 'POST') {
    if (!unit) return new Response('Missing unit code', { status: 400 });
    let op;
    try { op = await req.json(); } catch (e) { return new Response('Bad JSON', { status: 400 }); }
    const d = (await load()) || blank();
    d.rooms = d.rooms || {}; d.meta = d.meta || {}; d.archives = d.archives || {};
    const done = async (payload) => { await store.setJSON(KEY, payload); await dirTouch(unit, payload); return Response.json(payload); };

    if (op.op === 'import' && op.data && typeof op.data === 'object') {
      const nd = { rooms: op.data.rooms || {}, meta: op.data.meta || {}, archives: op.data.archives || {} };
      if (op.data.layout) nd.layout = op.data.layout;
      return done(nd);
    }
    if (op.op === 'layout' && op.layout && typeof op.layout === 'object') {
      d.layout = op.layout;
      return done(d);
    }
    if (op.op === 'restoreArchive' && op.id) {
      const ar = d.archives[op.id];
      if (!ar) return new Response('No such archive', { status: 404 });
      const to = String(op.to || '');
      if (!to) return new Response('Missing target room', { status: 400 });
      if (d.rooms[to] && d.rooms[to].length) return new Response('Target room occupied', { status: 409 });
      d.rooms[to] = ar.entries || [];
      if (ar.meta && Object.keys(ar.meta).length) d.meta[to] = ar.meta;
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
        const es = d.rooms[k].slice().sort((a, b) => (a.ts < b.ts ? 1 : -1));
        d.archives[id] = { id, room: k, archivedAt: new Date().toISOString(), lastTs: es[0] ? es[0].ts : null, entries: d.rooms[k], meta: d.meta[k] || {} };
      }
      delete d.rooms[k]; delete d.meta[k];
    } else if (op.op === 'edit' && op.entry && typeof op.entry === 'object' && op.entry.id) {
      d.rooms[k] = (d.rooms[k] || []).map(e => (e.id === op.entry.id ? op.entry : e));
    } else if (op.op === 'move' && op.to) {
      const to = String(op.to);
      if (d.rooms[to] && d.rooms[to].length) return new Response('Target room occupied', { status: 409 });
      if (d.rooms[k]) { d.rooms[to] = d.rooms[k]; delete d.rooms[k]; }
      if (d.meta[k]) { d.meta[to] = d.meta[k]; delete d.meta[k]; }
    } else if (op.op === 'meta' && op.patch && typeof op.patch === 'object') {
      const patch = {};
      if ('name' in op.patch) patch.name = String(op.patch.name).slice(0, 80);
      if ('mrn' in op.patch) patch.mrn = String(op.patch.mrn).slice(0, 40);
      d.meta[k] = { ...(d.meta[k] || {}), ...patch };
    } else {
      return new Response('Bad op', { status: 400 });
    }
    return done(d);
  }

  if (req.method === 'DELETE') {
    if (!admin) return new Response('Forbidden', { status: 403 });
    if (!unit) return new Response('Missing unit code', { status: 400 });
    await store.delete(KEY);
    const dir = await dirRead();
    if (dir.units) delete dir.units[unit];
    await store.setJSON(DIR, dir);
    return Response.json({ deleted: unit });
  }

  return new Response('Method not allowed', { status: 405 });
};

export const config = { path: '/api/data' };
