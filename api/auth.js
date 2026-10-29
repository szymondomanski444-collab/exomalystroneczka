const crypto = require('crypto');
const L = require('../lib/admins.js');

const NICK_RE = /^[\p{L}\p{N}_\- ]{2,20}$/u;

function readBody(req) {
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = null; } }
  return b && typeof b === 'object' ? b : {};
}

function normNick(s) {
  return String(s || '').trim().replace(/\s+/g, ' ');
}

function findByNick(store, nick) {
  const n = normNick(nick).toLowerCase();
  return store.admins.find((x) => (x.name || '').toLowerCase() === n && x.status === 'active') || null;
}

function publicAccount(a) {
  return { nick: a.name || '', role: a.role || 'user', createdAt: a.createdAt || null };
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Metoda niedozwolona' });

  if (!L.ownerPassword()) return res.status(500).json({ error: 'Brak ADMIN_PASSWORD w ustawieniach serwera' });
  if (!process.env.BLOB_READ_WRITE_TOKEN) return res.status(500).json({ error: 'Brak BLOB_READ_WRITE_TOKEN - podłącz Vercel Blob do projektu i zrób Redeploy' });

  const body = readBody(req);
  const action = body.action || '';

  try {
    // Zakładanie konta: nick + hasło (zwykłe konto, bez uprawnień)
    if (action === 'register') {
      const nick = normNick(body.nick || body.name);
      const pw = String(body.password || '');
      if (!NICK_RE.test(nick)) return res.status(400).json({ error: 'Nick: 2–20 znaków (litery, cyfry, spacja, _ lub -)' });
      if (pw.length < 8) return res.status(400).json({ error: 'Hasło musi mieć co najmniej 8 znaków' });
      const store = await L.readStore();
      if (store.admins.some((x) => (x.name || '').toLowerCase() === nick.toLowerCase())) {
        return res.status(409).json({ error: 'Ten nick jest już zajęty' });
      }
      const salt = crypto.randomBytes(16).toString('hex');
      const id = L.newId();
      store.admins.push({
        id, name: nick, role: 'user', status: 'active',
        salt, hash: L.scryptHash(pw, salt),
        createdAt: new Date().toISOString(),
      });
      await L.writeStore(store);
      return res.status(200).json({ ok: true, nick, role: 'user', token: L.signToken(id) });
    }

    // Logowanie: nick + hasło (bez względu na wielkość liter)
    if (action === 'login') {
      const pw = String(body.password || '');
      const store = await L.readStore();
      const acc = findByNick(store, body.nick || body.name);
      if (!acc || !L.safeEqualHex(L.scryptHash(pw, acc.salt), acc.hash)) {
        return res.status(401).json({ error: 'Zły nick lub hasło' });
      }
      return res.status(200).json({ ok: true, nick: acc.name, role: acc.role || 'user', token: L.signToken(acc.id) });
    }

    // Kto jest zalogowany (token z przeglądarki)
    if (action === 'me') {
      const acc = await L.verifyToken(String(body.token || ''));
      if (!acc) return res.status(401).json({ error: 'Nie jesteś zalogowany' });
      return res.status(200).json({ ok: true, nick: acc.name || '', role: acc.role || 'user' });
    }

    // Dostęp do panelu: hasło właściciela w nagłówku albo token konta z rolą admina
    const who = await L.authorize(req);
    if (!who) return res.status(401).json({ error: 'Nie masz uprawnień administratora' });
    if (!action) return res.status(200).json({ ok: true, role: who === 'owner' ? 'owner' : 'admin' });

    // Dalej tylko właściciel
    if (who !== 'owner') return res.status(403).json({ error: 'Tylko właściciel może to zrobić' });

    if (action === 'list') {
      const store = await L.readStore();
      return res.status(200).json({ accounts: store.admins.filter((x) => x.status === 'active').map(publicAccount) });
    }

    if (action === 'grant' || action === 'revoke') {
      const store = await L.readStore();
      const acc = findByNick(store, body.nick);
      if (!acc) return res.status(404).json({ error: 'Nie ma takiego nicka' });
      acc.role = action === 'grant' ? 'admin' : 'user';
      await L.writeStore(store);
      return res.status(200).json({ ok: true, nick: acc.name, role: acc.role });
    }

    if (action === 'remove') {
      const store = await L.readStore();
      const acc = findByNick(store, body.nick);
      if (!acc) return res.status(404).json({ error: 'Nie ma takiego nicka' });
      store.admins = store.admins.filter((x) => x.id !== acc.id);
      await L.writeStore(store);
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Nieznana akcja' });
  } catch (e) {
    return res.status(500).json({ error: 'Błąd serwera: ' + (e && e.message ? e.message : 'nieznany') });
  }
};
