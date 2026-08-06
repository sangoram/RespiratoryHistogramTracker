import { getStore } from '@netlify/blobs';

const KEY = 'store';

export default async (req) => {
  // Branch/preview deploys get their own sandbox store; only the production
  // deploy touches the live 'nicu-resp' data.
  const ctx = process.env.CONTEXT || 'production';
  const storeName = ctx === 'production' ? 'nicu-resp' : `nicu-resp-${ctx === 'branch-deploy' ? (process.env.BRANCH || 'branch') : ctx}`;
  const store = getStore({ name: storeName, consistency: 'strong' });
  const load = async () => (await store.get(KEY, { type: 'json' })) || { rooms: {}, meta: {}, archives: {} };

  if (req.method === 'GET') return Response.json(await load());

  if (req.method === 'POST') {
    let op;
    try { op = await req.json(); } catch (e) { return new Response('Bad JSON', { status: 400 }); }
    const d = await load();
    d.rooms = d.rooms || {}; d.meta = d.meta || {}; d.archives = d.archives || {};
    if (op.op === 'import' && op.data && typeof op.data === 'object') {
      const nd = { rooms: op.data.rooms || {}, meta: op.data.meta || {}, archives: op.data.archives || {} };
      await store.setJSON(KEY, nd);
      return Response.json(nd);
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
      await store.setJSON(KEY, d);
      return Response.json(d);
    }
    if (op.op === 'delArchive' && op.id) {
      delete d.archives[op.id];
      await store.setJSON(KEY, d);
      return Response.json(d);
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
    await store.setJSON(KEY, d);
    return Response.json(d);
  }
  return new Response('Method not allowed', { status: 405 });
};

export const config = { path: '/api/data' };
