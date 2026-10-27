// Tabela ligowa z Partnerskiego API Starter League.
// Klucz zostaje po stronie serwera (zmienne środowiskowe w Vercel), nigdy nie trafia do przeglądarki.
// Zmienne: STARTERLEAGUE_API_KEY (wymagana), STARTERLEAGUE_DIVISION (opcjonalna, domyślnie "Starter Division 6"),
// STARTERLEAGUE_API_BASE (opcjonalna), STARTERLEAGUE_KEY_HEADER (opcjonalna, domyślnie Authorization z Bearer).

const DEFAULT_BASE = 'https://starterleague.pl/api/partners';
const DEFAULT_DIVISION = 'Starter Division 6';

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Metoda niedozwolona' });
  }

  const rawKey = (process.env.STARTERLEAGUE_API_KEY || '').replace(/[^\x21-\x7E]/g, '');
  if (!rawKey) {
    return res.status(503).json({ error: 'Brak klucza API w konfiguracji serwera' });
  }

  const base = process.env.STARTERLEAGUE_API_BASE || DEFAULT_BASE;
  const division = process.env.STARTERLEAGUE_DIVISION || DEFAULT_DIVISION;
  const headerName = (process.env.STARTERLEAGUE_KEY_HEADER || 'Authorization').replace(/[^\x21-\x7E]/g, '');
  const isAuth = headerName.toLowerCase() === 'authorization';

  const headers = { Accept: 'application/json' };
  headers[headerName] = isAuth && !/^Bearer /i.test(rawKey) ? 'Bearer ' + rawKey : rawKey;

  try {
    const url = base + '/standings?division=' + encodeURIComponent(division);
    const r = await fetch(url, { headers });
    if (!r.ok) {
      return res.status(502).json({ error: 'Liga zwróciła błąd ' + r.status });
    }
    const j = await r.json();
    const d = (j.divisions || [])[0];
    const rows = d && Array.isArray(d.tablo) ? d.tablo : [];

    const divisionNames = (j.divisions || []).map((x) => (x && (x.name || x.division || x.title)) || '?');

    return res.status(200).json({
      division,
      debug: {
        divisionsFound: divisionNames.length,
        divisionNames,
        topKeys: Object.keys(j || {}),
        divisionKeys: d ? Object.keys(d) : [],
        tabloLength: Array.isArray(d && d.tablo) ? d.tablo.length : null,
      },
      updated: new Date().toISOString(),
      table: rows.map((x) => ({
        rank: x.rank,
        name: (x.team && x.team.name) || '',
        logo: (x.team && x.team.logo) || '',
        mecze: x.matchesPlayed,
        wygrane: x.wins,
        przegrane: x.losses,
        punkty: x.points,
      })),
    });
  } catch (e) {
    return res.status(502).json({ error: 'Nie udało się połączyć z ligą' });
  }
};
