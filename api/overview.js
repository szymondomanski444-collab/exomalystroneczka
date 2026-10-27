// Mecz na żywo i następny mecz Exomaly z Partnerskiego API Starter League.
// Klucz zostaje po stronie serwera (zmienne środowiskowe w Vercel), nigdy nie trafia do przeglądarki.
// Zmienne: STARTERLEAGUE_API_KEY (wymagana), STARTERLEAGUE_API_BASE (opcjonalna),
// STARTERLEAGUE_KEY_HEADER (opcjonalna, domyślnie Authorization z Bearer),
// STARTERLEAGUE_TEAM_NAME (opcjonalna, domyślnie wyszukiwanie po "exomaly").

const DEFAULT_BASE = 'https://starterleague.pl/api/partners';
const DEFAULT_TEAM_PATTERN = /exomaly/i;
const MAX_PAGES = 10;

function ourSide(m, pattern) {
  if (m.team1 && m.team1.name && pattern.test(m.team1.name)) return 'team1';
  if (m.team2 && m.team2.name && pattern.test(m.team2.name)) return 'team2';
  return null;
}

function mapLive(m, side) {
  const opp = side === 'team1' ? m.team2 : m.team1;
  const sOther = side === 'team1' ? 'team2' : 'team1';
  const cm = m.currentMap || {};
  const rs = cm.score || null;
  const ss = m.seriesScore || null;
  return {
    id: m.id,
    division: m.division || '',
    bestOf: m.bestOf || null,
    opponent: { name: (opp && opp.name) || '', logo: (opp && opp.logo) || '' },
    seriesScore: ss ? { mine: ss[side], opponent: ss[sOther] } : null,
    map: cm.name || '',
    mapNumber: cm.number || null,
    roundScore: rs ? { mine: rs[side], opponent: rs[sOther] } : null,
  };
}

function mapUpcoming(m, side) {
  const opp = side === 'team1' ? m.team2 : m.team1;
  return {
    id: m.id,
    division: m.division || '',
    date: m.matchDate || '',
    time: m.matchTime || '',
    bestOf: m.bestOf || null,
    opponent: { name: (opp && opp.name) || '', logo: (opp && opp.logo) || '' },
  };
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'public, s-maxage=15, stale-while-revalidate=30');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Metoda niedozwolona' });
  }

  const rawKey = (process.env.STARTERLEAGUE_API_KEY || '').replace(/[^\x21-\x7E]/g, '');
  if (!rawKey) {
    return res.status(503).json({ error: 'Brak klucza API w konfiguracji serwera' });
  }

  const base = process.env.STARTERLEAGUE_API_BASE || DEFAULT_BASE;
  const pattern = process.env.STARTERLEAGUE_TEAM_NAME
    ? new RegExp(process.env.STARTERLEAGUE_TEAM_NAME.replace(/[^\x20-\x7E]/g, ''), 'i')
    : DEFAULT_TEAM_PATTERN;
  const headerName = (process.env.STARTERLEAGUE_KEY_HEADER || 'Authorization').replace(/[^\x21-\x7E]/g, '');
  const isAuth = headerName.toLowerCase() === 'authorization';

  const headers = { Accept: 'application/json' };
  headers[headerName] = isAuth && !/^Bearer /i.test(rawKey) ? 'Bearer ' + rawKey : rawKey;

  const getJson = async (path) => {
    const r = await fetch(base + path, { headers });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  };

  // mecz na żywo (błąd ligi nie blokuje najbliższego meczu)
  let live = null;
  let liveError = false;
  try {
    const j = await getJson('/matches/live');
    const items = Array.isArray(j.items) ? j.items : Array.isArray(j.item) ? j.item : [];
    for (const m of items) {
      const side = ourSide(m, pattern);
      if (side) { live = mapLive(m, side); break; }
    }
  } catch (e) {
    liveError = true;
  }

  // następny zaplanowany mecz (wszystkie strony, najbliższy jako pierwszy)
  let next = null;
  let upcomingError = false;
  try {
    const first = await getJson('/matches/upcoming?page=1');
    const totalPages = Math.max(1, Math.min(MAX_PAGES, (first.pagination && first.pagination.totalPages) || 1));
    const pages = [first];
    if (totalPages > 1) {
      const rest = [];
      for (let p = 2; p <= totalPages; p++) rest.push(getJson('/matches/upcoming?page=' + p));
      pages.push(...(await Promise.all(rest)));
    }
    const found = [];
    for (const j of pages) {
      for (const m of Array.isArray(j.items) ? j.items : []) {
        const side = ourSide(m, pattern);
        if (side) found.push(mapUpcoming(m, side));
      }
    }
    found.sort((a, b) => (a.date + ' ' + a.time).localeCompare(b.date + ' ' + b.time));
    next = found[0] || null;
  } catch (e) {
    upcomingError = true;
  }

  if (liveError && upcomingError) {
    return res.status(502).json({ error: 'Nie udało się połączyć z ligą' });
  }

  return res.status(200).json({
    updated: new Date().toISOString(),
    live,
    next,
    liveError,
    upcomingError,
  });
};
