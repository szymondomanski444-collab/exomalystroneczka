const crypto = require('crypto');
const L = require('../lib/admins.js');

function readBody(req) {
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = null; } }
  return b && typeof b === 'object' ? b : {};
}

function publicAccount(a) {
  return { id: a.id, name: a.name || '', role: a.role || 'user', createdAt: a.createdAt || null };
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Metoda niedozwolona' });

  if (!L.ownerPassword()) return res.status(500).json({ error: 'Brak ADMIN_PASSWORD w ustawieniach serwera' });
  if (!process.env.BLOB_READ_WRITE_TOKEN) return res.status(500).json({ error: 'Brak BLOB_READ_WRITE_TOKEN - podłącz Vercel Blob do projektu i zrób Redeploy' });

  const body = readBody(req);
  const action = body.action || '';

  try {
    // Zakładanie konta – każdy może: dostaje swoje ID generowane przez stronę
    if (action === 'register') {
      const pw = String(body.password || '');
      const name = String(body.name || '').trim().slice(0, 40);
      if (pw.length < 8) return res.status(400).json({ error: 'Hasło musi mieć co najmniej 8 znaków' });
      const store = await L.readStore();
      let id = L.newId();
      while (store.admins.some((x) => x.id === id)) id = L.newId();
      const salt = crypto.randomBytes(16).toString('hex');
      store.admins.push({
        id, name, role: 'user', status: 'active',
        salt, hash: L.scryptHash(pw, salt),
        createdAt: new Date().toISOString(),
      });
      await L.writeStore(store);
      return res.status(200).json({ ok: true, id, role: 'user', token: L.signToken(id) });
    }

    // Logowanie ID + hasło (dla każdego zarejestrowanego konta)
    if (action === 'login') {
      const id = String(body.id || '').trim().toUpperCase();
      const pw = String(body.password || '');
      const store = await L.readStore();
      const acc = store.admins.find((x) => x.id === id && x.status === 'active');
      if (!acc || !L.safeEqualHex(L.scryptHash(pw, acc.salt), acc.hash)) {
        return res.status(401).json({ error: 'Złe ID lub hasło' });
      }
      return res.status(200).json({ ok: true, id: acc.id, role: acc.role || 'user', token: L.signToken(acc.id) });
    }

    // Sprawdzenie dostępu do panelu (nagłówek x-admin-pass = hasło właściciela albo token admina)
    const who = await L.authorize(req);
    if (!who) return res.status(401).json({ error: 'Brak uprawnień administratora' });
    if (!action) return res.status(200).json({ ok: true, role: who === 'owner' ? 'owner' : 'admin' });

    // Dalej tylko właściciel
    if (who !== 'owner') return res.status(403).json({ error: 'Tylko właściciel może to zrobić' });

    if (action === 'list') {
      const store = await L.readStore();
      return res.status(200).json({ accounts: store.admins.map(publicAccount) });
    }

    if (action === 'grant' || action === 'revoke') {
      const id = String(body.id || '').trim().toUpperCase();
      const store = await L.readStore();
      const acc = store.admins.find((x) => x.id === id);
      if (!acc) return res.status(404).json({ error: 'Nie ma takiego konta' });
      acc.role = action === 'grant' ? 'admin' : 'user';
      await L.writeStore(store);
      return res.status(200).json({ ok: true, id, role: acc.role });
    }

    if (action === 'remove') {
      const id = String(body.id || '').trim().toUpperCase();
      const store = await L.readStore();
      const before = store.admins.length;
      store.admins = store.admins.filter((x) => x.id !== id);
      if (store.admins.length === before) return res.status(404).json({ error: 'Nie ma takiego konta' });
      await L.writeStore(store);
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Nieznana akcja' });
  } catch (e) {
    return res.status(500).json({ error: 'Błąd serwera: ' + (e && e.message ? e.message : 'nieznany') });
  }
};
