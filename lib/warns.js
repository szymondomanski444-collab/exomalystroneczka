// Ostrzeżenia graczy (/warn). Zapisywane w prywatnym Vercel Blob (exomaly-warns.json).
const FILE = 'exomaly-warns.json';
const MAX_PER_USER = 200;

async function readStream(stream) {
  const chunks = [];
  for await (const c of stream) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks).toString('utf8');
}

async function read() {
  try {
    const { get } = await import('@vercel/blob');
    const r = await get(FILE, { access: 'private', useCache: false });
    if (!r || r.statusCode !== 200 || !r.stream) return { users: {} };
    const j = JSON.parse(await readStream(r.stream));
    return j && j.users && typeof j.users === 'object' ? j : { users: {} };
  } catch (e) {
    return { users: {} };
  }
}

async function write(data) {
  const { put } = await import('@vercel/blob');
  await put(FILE, JSON.stringify(data), {
    access: 'private',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0,
  });
}

// Dodaje ostrzeżenie. Zwraca łączną liczbę ostrzeżeń gracza.
async function addWarn(userId, { reason, by }) {
  const data = await read();
  const list = Array.isArray(data.users[userId]) ? data.users[userId] : [];
  list.push({ id: Date.now().toString(36), reason: String(reason || 'brak powodu').slice(0, 300), by: String(by || ''), at: new Date().toISOString() });
  data.users[userId] = list.slice(-MAX_PER_USER);
  await write(data);
  return data.users[userId].length;
}

async function listWarns(userId) {
  const data = await read();
  return Array.isArray(data.users[userId]) ? data.users[userId] : [];
}

module.exports = { addWarn, listWarns };
