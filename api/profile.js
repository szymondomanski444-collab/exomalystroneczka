// Profil użytkownika: GET ?u=nick (publiczny), POST (własny profil, wymaga tokenu konta).
const L = require('../lib/admins.js');

const MAX_AVATAR = 150 * 1024;   // znaki data URL
const MAX_BANNER = 320 * 1024;
const MAX_BIO = 200;
const IMG_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

function readBody(req) {
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = null; } }
  return b && typeof b === 'object' ? b : {};
}

function blankProfile(nick) {
  return { nick, bio: '', theme: 'mono', avatar: '', banner: '', updatedAt: null };
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!process.env.BLOB_READ_WRITE_TOKEN) return res.status(500).json({ error: 'Brak BLOB_READ_WRITE_TOKEN' });

  try {
    if (req.method === 'GET') {
      const url = new URL(req.url, 'https://exomaly.pl');
      const nick = String(url.searchParams.get('u') || '').trim();
      if (!nick) return res.status(400).json({ error: 'Podaj nick' });
      const store = await L.readStore();
      const acc = store.admins.find((x) => (x.name || '').toLowerCase() === nick.toLowerCase() && x.status === 'active');
      if (!acc) return res.status(404).json({ error: 'Nie ma takiego użytkownika' });
      const p = (await L.readProfile(acc.name)) || blankProfile(acc.name);
      return res.status(200).json({
        nick: acc.name,
        role: acc.role === 'admin' ? 'admin' : 'user',
        bio: p.bio || '',
        theme: L.THEMES.includes(p.theme) ? p.theme : 'mono',
        avatar: p.avatar || '',
        banner: p.banner || '',
        updatedAt: p.updatedAt || null,
      });
    }

    if (req.method === 'POST') {
      const body = readBody(req);
      const acc = await L.verifyToken(String(body.token || ''));
      if (!acc) return res.status(401).json({ error: 'Zaloguj się, żeby edytować profil' });

      const prev = (await L.readProfile(acc.name)) || blankProfile(acc.name);
      const bio = typeof body.bio === 'string' ? body.bio.trim().slice(0, MAX_BIO) : prev.bio;
      const theme = typeof body.theme === 'string' ? body.theme : prev.theme;
      if (!L.THEMES.includes(theme)) return res.status(400).json({ error: 'Nieznany motyw' });

      let avatar = prev.avatar || '';
      if (body.avatar === '') avatar = '';
      else if (typeof body.avatar === 'string') {
        if (body.avatar.length > MAX_AVATAR || !IMG_RE.test(body.avatar)) return res.status(400).json({ error: 'Awatar: obraz jpg, png lub webp, do 150 KB' });
        avatar = body.avatar;
      }

      let banner = prev.banner || '';
      if (body.banner === '') banner = '';
      else if (typeof body.banner === 'string') {
        if (body.banner.length > MAX_BANNER || !IMG_RE.test(body.banner)) return res.status(400).json({ error: 'Baner: obraz jpg, png lub webp, do 320 KB' });
        banner = body.banner;
      }

      const next = { nick: acc.name, bio, theme, avatar, banner, updatedAt: new Date().toISOString() };
      await L.writeProfile(acc.name, next);
      return res.status(200).json({ ok: true, profile: next });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Metoda niedozwolona' });
  } catch (e) {
    return res.status(500).json({ error: 'Błąd serwera: ' + (e && e.message ? e.message : 'nieznany') });
  }
};
