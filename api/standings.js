// Tabela z Partnerskiego API Starter League. Klucz zostaje po stronie serwera (zmienne w Vercel).
// Zmienne: STARTERLEAGUE_API_BASE (opcjonalnie), STARTERLEAGUE_DIVISION, STARTERLEAGUE_API_KEY,
// STARTERLEAGUE_KEY_HEADER (np. X-API-Key; domyślnie Authorization).
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
  const base = process.env.STARTERLEAGUE_API_BASE || 'https://starterleague.pl/api/partners';
  const division = process.env.STARTERLEAGUE_DIVISION || 'Starter Division 6';
  const headers = { Accept: 'application/json' };
  const rawKey = process.env.STARTERLEAGUE_API_KEY || '';
  const key = rawKey.replace(/[^\x21-\x7E]/g, '');
  if (key) {
    const hName = (process.env.STARTERLEAGUE_KEY_HEADER || 'Authorization').replace(/[^\x21-\x7E]/g, '');
    const isAuth = hName.toLowerCase() === 'authorization';
    headers[hName] = isAuth && !/^Bearer /i.test(key) ? 'Bearer ' + key : key;
  }
  try {
    const r = await fetch(base + '/standings?division=' + encodeURIComponent(division), { headers });
    if (!r.ok) return res.status(502).json({ error: 'API zwróciło ' + r.status });
    const j = await r.json();
    const d = (j.divisions || [])[0];
    const table = (d && Array.isArray(d.tablo)) ? d.tablo : [];
    return res.status(200).json({
      division,
      dostepneDywizje: (j.divisions || []).map((x) => x.division),
      table: table.map((x) => ({
        rank: x.rank,
        name: x.team && x.team.name,
        logo: x.team && x.team.logo,
        mecze: x.matchesPlayed,
        wygrane: x.wins,
        przegrane: x.losses,
        punkty: x.points,
      })),
    });
  } catch (e) {
    return res.status(502).json({ error: 'Nie udało się połączyć z API: ' + e.message, diagnostyka: { dlugoscKlucza: rawKey.length, znakiSpozaASCII: rawKey.length !== key.length } });
  }
};
