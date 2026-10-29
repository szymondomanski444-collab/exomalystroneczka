const crypto = require('crypto');
const L = require('../lib/admins.js');

function readBody(req) {
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = null; } }
  return b && typeof b === 'object' ? b : {};
}

function publicAdmin(a) {
  return { id: a.id, name: a.name || '', status: a.status, createdAt: a.createdAt || null };
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Metoda niedozwolona' });

  if (!L.ownerPassword()) return res.status(500).json({ error: 'Brak ADMIN_PASSWORD w ustawieniach serwera' });
  if (!process.env.BLOB_READ_WRITE_TOKEN) return res.status(500).json({ error: 'Brak BLOB_READ_WRITE_TOKEN - podłącz Vercel Blob do projektu i zrób Redeploy' });

  const body = readBody(req);
  const action = body.action || '';

  try {
    // Logowanie ID + hasło (konto aktywne)
    if (action === 'login') {
      const id = String(body.id || '').trim().toUpperCase();
      const pw = String(body.password || '');
      const store = await L.readStore();
      const adm = store.admins.find((x) => x.id === id && x.status === 'active');
      if (!adm || !L.safeEqualHex(L.scryptHash(pw, adm.salt), adm.hash)) {
        return res.status(401).json({ error: 'Złe ID lub hasło' });
      }
      return res.status(200).json({ ok: true, id: adm.id, token: L.signToken(adm.id) });
    }

    // Aktywacja konta: ID + kod z zaproszenia + nowe hasło
    if (action === 'activate') {
      const id = String(body.id || '').trim().toUpperCase();
      const code = String(body.code || '').trim().toUpperCase();
      const pw = String(body.password || '');
      if (pw.length < 8) return res.status(400).json({ error: 'Hasło musi mieć co najmniej 8 znaków' });
      const store = await L.readStore();
      const adm = store.admins.find((x) => x.id === id && x.status === 'invited');
      if (!adm || !(adm.codeExp > Date.now()) || !L.safeEqualHex(L.scryptHash(code, adm.codeSalt), adm.codeHash)) {
        return res.status(401).json({ error: 'Złe ID, kod albo kod wygasł' });
      }
      adm.salt = crypto.randomBytes(16).toString('hex');
      adm.hash = L.scryptHash(pw, adm.salt);
      adm.status = 'active';
      delete adm.codeHash; delete adm.codeSalt; delete adm.codeExp;
      adm.activatedAt = new Date().toISOString();
      await L.writeStore(store);
      return res.status(200).json({ ok: true, id: adm.id, token: L.signToken(adm.id) });
    }

    // Sprawdzenie dostępu (nagłówek x-admin-pass = hasło właściciela albo token admina)
    const who = await L.authorize(req);
    if (!who) return res.status(401).json({ error: 'Brak uprawnień' });
    if (!action) return res.status(200).json({ ok: true, role: who === 'owner' ? 'owner' : 'admin' });

    // Dalej tylko właściciel
    if (who !== 'owner') return res.status(403).json({ error: 'Tylko właściciel może to zrobić' });

    if (action === 'invite') {
      const name = String(body.name || '').trim().slice(0, 60);
      const store = await L.readStore();
      let id = L.newId();
      while (store.admins.some((x) => x.id === id)) id = L.newId();
      const code = L.newCode();
      const codeSalt = crypto.randomBytes(16).toString('hex');
      store.admins.push({
        id, name, status: 'invited',
        codeSalt, codeHash: L.scryptHash(code, codeSalt),
        codeExp: Date.now() + L.INVITE_DAYS * 86400e3,
        createdAt: new Date().toISOString(),
      });
      await L.writeStore(store);
      // kod pokazujemy tylko raz, w odpowiedzi
      return res.status(200).json({ ok: true, id, code, expiresInDays: L.INVITE_DAYS });
    }

    if (action === 'list') {
      const store = await L.readStore();
      return res.status(200).json({ admins: store.admins.map(publicAdmin) });
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
