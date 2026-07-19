import { getStore } from '@netlify/blobs';

const KEY = 'store';

export default async (req) => {
  const store = getStore({ name: 'nicu-resp', consistency: 'strong' });
  const load = async () => (await store.get(KEY, { type: 'json' })) || { rooms: {}, meta: {} };

  if (req.method === 'GET') return Response.json(await load());

  if (req.method === 'POST') {
    let op;
    try { op = await req.json(); } catch (e) { return new Response('Bad JSON', { status: 400 }); }
    const d = await load();
    d.rooms = d.rooms || {}; d.meta = d.meta || {};
    if (op.op === 'import' && op.data && typeof op.data === 'object') {
      const nd = { rooms: op.data.rooms || {}, meta: op.data.meta || {} };
      await store.setJSON(KEY, nd);
      return Response.json(nd);
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
