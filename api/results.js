// Wyniki meczów Exomaly z Partnerskiego API Starter League (/matches/history).
// Klucz zostaje po stronie serwera (zmienne środowiskowe w Vercel), nigdy nie trafia do przeglądarki.
// Zmienne: STARTERLEAGUE_API_KEY (wymagana), STARTERLEAGUE_API_BASE (opcjonalna),
// STARTERLEAGUE_KEY_HEADER (opcjonalna, domyślnie Authorization z Bearer),
// STARTERLEAGUE_TEAM_NAME (opcjonalna, domyślnie wyszukiwanie po "exomaly"),
// STARTERLEAGUE_MAX_PAGES (opcjonalna, domyślnie 50).

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
  const maxPages = Math.max(1, Math.min(50, parseInt(process.env.STARTERLEAGUE_MAX_PAGES, 10) || 50));
  const headerName = (process.env.STARTERLEAGUE_KEY_HEADER || 'Authorization').replace(/[^\x21-\x7E]/g, '');
  const isAuth = headerName.toLowerCase() === 'authorization';

  const headers = { Accept: 'application/json' };
  headers[headerName] = isAuth && !/^Bearer /i.test(rawKey) ? 'Bearer ' + rawKey : rawKey;

  const fetchPage = async (n) => {
    const r = await fetch(base + '/matches/history?page=' + n, { headers });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  };

  // Budżet czasu: zwracamy to, co zdążyliśmy pobrać, zamiast czekać bez końca.
  const started = Date.now();
  const BUDGET_MS = 8000;
  const BATCH = 10;

  try {
    const first = await fetchPage(1);
    const totalPages = Math.max(1, Math.min(maxPages, (first.pagination && first.pagination.totalPages) || 1));
    const pages = [first];
    let failedPages = 0;
    let stoppedEarly = false;
    const nums = [];
    for (let n = 2; n <= totalPages; n++) nums.push(n);
    for (let i = 0; i < nums.length; i += BATCH) {
      if (Date.now() - started > BUDGET_MS) { stoppedEarly = true; break; }
      const got = await Promise.allSettled(nums.slice(i, i + BATCH).map(fetchPage));
      for (const g of got) {
        if (g.status === 'fulfilled') pages.push(g.value);
        else failedPages++;
      }
    }
    const missingPages = totalPages - pages.length;

    const matches = [];
    let totalItems = 0;
    for (const j of pages) {
      const items = Array.isArray(j.items) ? j.items : [];
      totalItems += items.length;
      for (const m of items) {
        if (isOurTeam(m.team1, pattern) || isOurTeam(m.team2, pattern)) {
          matches.push(mapMatch(m, pattern));
        }
      }
    }
    matches.sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));

    return res.status(200).json({
      updated: new Date().toISOString(),
      pagesScanned: pages.length,
      pagesTotal: totalPages,
      pagesFailed: failedPages,
      partial: stoppedEarly || failedPages > 0 || missingPages > 0,
      itemsScanned: totalItems,
      matches,
    });
  } catch (e) {
    return res.status(502).json({ error: 'Nie udało się połączyć z ligą' });
  }
};
