// Wyzwalacz powiadomień o nowych meczach.
// Wywołanie: GET albo POST z nagłówkiem "Authorization: Bearer <CRON_SECRET>" (zewnętrzny harmonogram)
// albo z hasłem admina (x-admin-pass). Bez jednego z nich odpowiedź to 401.
const L = require('../lib/admins.js');
const { checkMatches } = require('../lib/match-notify.js');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Metoda niedozwolona' });
  }

  const secret = (process.env.CRON_SECRET || '').trim();
  const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const byCron = !!secret && bearer === secret;
  if (!byCron && !(await L.authorize(req))) {
    return res.status(401).json({ error: 'Brak dostępu' });
  }

  try {
    const out = await checkMatches();
    return res.status(out.ok === false ? 502 : 200).json(out);
  } catch (e) {
    return res.status(502).json({ error: 'Nie udało się sprawdzić meczów: ' + e.message });
  }
};
