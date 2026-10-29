// Konta administratorów: ID generowane przez stronę + hasło (bez zewnętrznych usług).
// Dane kont w prywatnym Vercel Blob. Hasła są haszowane (scrypt), a token sesji podpisany HMAC.
// Właściciel (ADMIN_PASSWORD) zawsze ma dostęp i może zapraszać adminów.

const crypto = require('crypto');

const FILE = 'exomaly-admins.json';
const SESSION_HOURS = 12;
const INVITE_DAYS = 7;

function ownerPassword() {
  return process.env.ADMIN_PASSWORD || '';
}

async function readStream(stream) {
  const chunks = [];
  for await (const c of stream) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks).toString('utf8');
}

async function readStore() {
  const { get } = await import('@vercel/blob');
  try {
    const r = await get(FILE, { access: 'private', useCache: false });
    if (!r || r.statusCode !== 200 || !r.stream) return { admins: [] };
    const j = JSON.parse(await readStream(r.stream));
    return { admins: Array.isArray(j.admins) ? j.admins : [] };
  } catch (e) {
    return { admins: [] };
  }
}

async function writeStore(store) {
  const { put } = await import('@vercel/blob');
  await put(FILE, JSON.stringify(store), {
    access: 'private',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0,
  });
}

function scryptHash(secret, salt) {
  return crypto.scryptSync(String(secret), salt, 32).toString('hex');
}

function safeEqualHex(a, b) {
  const x = Buffer.from(String(a), 'hex');
  const y = Buffer.from(String(b), 'hex');
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

function sessionKey() {
  return crypto.createHash('sha256').update('exo-sess:' + ownerPassword()).digest();
}

function signToken(id) {
  const payload = Buffer.from(JSON.stringify({ id, exp: Date.now() + SESSION_HOURS * 3600e3 })).toString('base64url');
  const sig = crypto.createHmac('sha256', sessionKey()).update(payload).digest('base64url');
  return payload + '.' + sig;
}

async function verifyToken(token) {
  if (!token || !ownerPassword()) return null;
  const parts = String(token).split('.');
  if (parts.length !== 2) return null;
  const expected = crypto.createHmac('sha256', sessionKey()).update(parts[0]).digest('base64url');
  const a = Buffer.from(parts[1]);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let data;
  try { data = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); } catch (e) { return null; }
  if (!data || !data.id || !(data.exp > Date.now())) return null;
  const store = await module.exports.readStore();
  const adm = store.admins.find((x) => x.id === data.id && x.status === 'active');
  return adm ? adm.id : null;
}

// Zwraca 'owner', id konta albo null.
async function authorize(req) {
  const pass = String(req.headers['x-admin-pass'] || '');
  if (pass && ownerPassword() && pass === ownerPassword()) return 'owner';
  const id = await verifyToken(pass);
  return id || null;
}

function newId() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  const bytes = crypto.randomBytes(6);
  for (let i = 0; i < 6; i++) s += alphabet[bytes[i] % alphabet.length];
  return 'EX-' + s;
}

function newCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  const bytes = crypto.randomBytes(10);
  for (let i = 0; i < 10; i++) s += alphabet[bytes[i] % alphabet.length];
  return s;
}

module.exports = {
  readStore,
  writeStore,
  scryptHash,
  safeEqualHex,
  signToken,
  verifyToken,
  authorize,
  newId,
  newCode,
  INVITE_DAYS,
  ownerPassword,
};
