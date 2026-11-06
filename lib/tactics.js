// Taktyki drużyny (map i ustawienia). Zapisywane w prywatnym Vercel Blob (exomaly-tactics.json).
const FILE = 'exomaly-tactics.json';
const MAX = 100;

async function readStream(stream) {
  const chunks = [];
  for await (const c of stream) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks).toString('utf8');
}

async function read() {
  try {
    const { get } = await import('@vercel/blob');
    const r = await get(FILE, { access: 'private', useCache: false });
    if (!r || r.statusCode !== 200 || !r.stream) return [];
    const j = JSON.parse(await readStream(r.stream));
    return Array.isArray(j.tactics) ? j.tactics : [];
  } catch (e) {
    return [];
  }
}

async function write(list) {
  const { put } = await import('@vercel/blob');
  await put(FILE, JSON.stringify({ tactics: list.slice(-MAX) }), {
    access: 'private',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0,
  });
}

const norm = (s) => String(s || '').trim().toLowerCase();

async function list() {
  return read();
}

async function find(name) {
  const key = norm(name);
  return (await read()).find((t) => norm(t.name) === key) || null;
}

// Dodaje lub nadpisuje taktykę o tej samej nazwie.
async function save({ name, map, text, by }) {
  const all = await read();
  const key = norm(name);
  const item = {
    name: String(name).trim().slice(0, 60),
    map: String(map || '').trim().slice(0, 40),
    text: String(text || '').trim().slice(0, 3000),
    by: String(by || ''),
    at: new Date().toISOString(),
  };
  const idx = all.findIndex((t) => norm(t.name) === key);
  if (idx >= 0) all[idx] = item; else all.push(item);
  await write(all);
  return idx >= 0 ? 'updated' : 'added';
}

async function remove(name) {
  const all = await read();
  const key = norm(name);
  const left = all.filter((t) => norm(t.name) !== key);
  if (left.length === all.length) return false;
  await write(left);
  return true;
}

module.exports = { list, find, save, remove };
