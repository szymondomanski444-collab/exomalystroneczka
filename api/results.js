// Wyniki meczów Exomaly z Partnerskiego API Starter League (/matches/history).
// Klucz zostaje po stronie serwera (zmienne środowiskowe w Vercel), nigdy nie trafia do przeglądarki.
// Zmienne: STARTERLEAGUE_API_KEY (wymagana), STARTERLEAGUE_API_BASE (opcjonalna),
// STARTERLEAGUE_KEY_HEADER (opcjonalna, domyślnie Authorization z Bearer),
// STARTERLEAGUE_TEAM_NAME (opcjonalna, domyślnie wyszukiwanie po "exomaly"),
// STARTERLEAGUE_MAX_PAGES (opcjonalna, domyślnie 10).

const DEFAULT_BASE = 'https://starterleague.pl/api/partners';
const DEFAULT_TEAM_PATTERN = /exomaly/i;

function isOurTeam(team, pattern) {
  return !!(team && team.name && pattern.test(team.name));
}

function mapMatch(m, pattern) {
  const ours = isOurTeam(m.team1, pattern) ? 'team1' : 'team2';
  const theirsKey = ours === 'team1' ? 'team2' : 'team1';
  const mine = m.score ? m.score[ours] : null;
  const opp = ours === 'team1' ? m.team2 : m.team1;
  const oppScore = m.score ? m.score[theirsKey] : null;
  const ourId = m[ours] && m[ours].id;
  let result = null;
  if (m.winnerTeamId != null && ourId != null) {
    result = m.winnerTeamId === ourId ? 'W' : 'L';
  }
  return {
    id: m.id,
    division: m.division || '',
    date: m.matchDate || '',
    time: m.matchTime || '',
    bestOf: m.bestOf || null,
    opponent: { name: (opp && opp.name) || '', logo: (opp && opp.logo) || '' },
    score: { mine, opponent: oppScore },
    result,
  };
}

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
  const pattern = process.env.STARTERLEAGUE_TEAM_NAME
    ? new RegExp(process.env.STARTERLEAGUE_TEAM_NAME.replace(/[^\x20-\x7E]/g, ''), 'i')
    : DEFAULT_TEAM_PATTERN;
  const maxPages = Math.max(1, Math.min(50, parseInt(process.env.STARTERLEAGUE_MAX_PAGES, 10) || 10));
  const headerName = (process.env.STARTERLEAGUE_KEY_HEADER || 'Authorization').replace(/[^\x21-\x7E]/g, '');
  const isAuth = headerName.toLowerCase() === 'authorization';

  const headers = { Accept: 'application/json' };
  headers[headerName] = isAuth && !/^Bearer /i.test(rawKey) ? 'Bearer ' + rawKey : rawKey;

  try {
    const matches = [];
    let page = 1;
    let hasNext = true;

    while (hasNext && page <= maxPages) {
      const r = await fetch(base + '/matches/history?page=' + page, { headers });
      if (!r.ok) {
        return res.status(502).json({ error: 'Liga zwróciła błąd ' + r.status });
      }
      const j = await r.json();
      const items = Array.isArray(j.items) ? j.items : [];
      for (const m of items) {
        if (isOurTeam(m.team1, pattern) || isOurTeam(m.team2, pattern)) {
          matches.push(mapMatch(m, pattern));
        }
      }
      hasNext = !!(j.pagination && j.pagination.hasNextPage);
      page += 1;
    }

    return res.status(200).json({
      updated: new Date().toISOString(),
      matches,
    });
  } catch (e) {
    return res.status(502).json({ error: 'Nie udało się połączyć z ligą' });
  }
};
