// Powiadomienia o nowych meczach Exomaly na kanał Discorda.
// Sprawdza nadchodzące mecze z Partnerskiego API Starter League i wysyła embed tylko o tych,
// których jeszcze nie widzieliśmy. Zapamiętane ID są w prywatnym Vercel Blob (exomaly-matches.json).
// Pierwsze uruchomienie tylko zapamiętuje obecne mecze i niczego nie wysyła, żeby nie zalać kanału.

const B = require('./bot-settings.js');

const FILE = 'exomaly-matches.json';
const API = 'https://discord.com/api/v10';
const DEFAULT_BASE = 'https://starterleague.pl/api/partners';
const MAX_PAGES = 10;
const MAX_PER_RUN = 10;
const MAX_SEEN = 500;
const LOGO_URL = 'https://exomaly.pl/favicon-512.png';

const env = (n) => (process.env[n] || '').replace(/[^\x21-\x7E]/g, '');

async function readStream(stream) {
  const chunks = [];
  for await (const c of stream) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks).toString('utf8');
}

async function readSeen() {
  try {
    const { get } = await import('@vercel/blob');
    const r = await get(FILE, { access: 'private', useCache: false });
    if (!r || r.statusCode !== 200 || !r.stream) return null;
    const j = JSON.parse(await readStream(r.stream));
    return Array.isArray(j.seen) ? j.seen : null;
  } catch (e) {
    return null;
  }
}

async function writeSeen(seen) {
  const { put } = await import('@vercel/blob');
  await put(FILE, JSON.stringify({ seen: seen.slice(-MAX_SEEN) }), {
    access: 'private',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0,
  });
}

// Pobranie wszystkich nadchodzących meczy naszej drużyny (ta sama logika co w api/overview.js).
async function fetchUpcoming() {
  const rawKey = env('STARTERLEAGUE_API_KEY');
  if (!rawKey) throw new Error('Brak klucza STARTERLEAGUE_API_KEY');
  const base = process.env.STARTERLEAGUE_API_BASE || DEFAULT_BASE;
  const pattern = process.env.STARTERLEAGUE_TEAM_NAME
    ? new RegExp(process.env.STARTERLEAGUE_TEAM_NAME.replace(/[^\x20-\x7E]/g, ''), 'i')
    : /exomaly/i;
  const headerName = env('STARTERLEAGUE_KEY_HEADER') || 'Authorization';
  const headers = { Accept: 'application/json' };
  headers[headerName] = headerName.toLowerCase() === 'authorization' && !/^Bearer /i.test(rawKey) ? 'Bearer ' + rawKey : rawKey;

  const getJson = async (path) => {
    const r = await fetch(base + path, { headers });
    if (!r.ok) throw new Error('Liga: HTTP ' + r.status);
    return r.json();
  };

  const first = await getJson('/matches/upcoming?page=1');
  const totalPages = Math.max(1, Math.min(MAX_PAGES, (first.pagination && first.pagination.totalPages) || 1));
  const pages = [first];
  for (let p = 2; p <= totalPages; p++) pages.push(await getJson('/matches/upcoming?page=' + p));

  const out = [];
  for (const j of pages) {
    for (const m of Array.isArray(j.items) ? j.items : []) {
      let side = null;
      if (m.team1 && m.team1.name && pattern.test(m.team1.name)) side = 'team1';
      else if (m.team2 && m.team2.name && pattern.test(m.team2.name)) side = 'team2';
      if (!side) continue;
      const opp = side === 'team1' ? m.team2 : m.team1;
      out.push({
        id: String(m.id),
        division: m.division || '',
        date: m.matchDate || '',
        time: m.matchTime || '',
        bestOf: m.bestOf || null,
        opponent: (opp && opp.name) || 'Przeciwnik',
      });
    }
  }
  return out;
}

function matchEmbed(m, color) {
  const when = m.date ? (m.date + (m.time ? ' ' + m.time : '')) : 'Do ustalenia';
  const fields = [{ name: 'Termin', value: when, inline: true }];
  if (m.division) fields.push({ name: 'Dywizja', value: m.division, inline: true });
  if (m.bestOf) fields.push({ name: 'Format', value: 'BO' + m.bestOf, inline: true });
  return {
    author: { name: 'EXOMALY', icon_url: LOGO_URL },
    title: 'Nowy mecz zaplanowany',
    description: '**Exomaly vs ' + m.opponent + '**',
    color,
    fields,
    thumbnail: { url: LOGO_URL },
    footer: { text: 'Exomaly · Terminarz', icon_url: LOGO_URL },
    timestamp: new Date().toISOString(),
  };
}

// Główna funkcja. Zwraca podsumowanie do odpowiedzi API.
async function checkMatches() {
  const s = await B.readSettings();
  const channel = s.matchChannelId;
  if (!channel) return { ok: true, skipped: 'Nie ustawiono kanału powiadomień o meczach' };
  const token = env('DISCORD_BOT_TOKEN');
  if (!token) return { ok: false, error: 'Brak DISCORD_BOT_TOKEN w zmiennych Vercela' };

  const upcoming = await fetchUpcoming();
  const seen = await store.read();

  if (seen === null) {
    // pierwszy raz: zapamiętujemy obecne mecze bez wysyłania
    await store.write(upcoming.map((m) => m.id));
    return { ok: true, seeded: upcoming.length };
  }

  const seenSet = new Set(seen);
  const fresh = upcoming.filter((m) => !seenSet.has(m.id)).slice(0, MAX_PER_RUN);
  const color = parseInt(s.colors.info.slice(1), 16);
  let sent = 0;
  const failed = [];

  for (const m of fresh) {
    try {
      const r = await fetch(API + '/channels/' + channel + '/messages', {
        method: 'POST',
        headers: { Authorization: 'Bot ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ embeds: [matchEmbed(m, color)], allowed_mentions: { parse: [] } }),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + (await r.text().catch(() => '')).slice(0, 120));
      seen.push(m.id);
      sent++;
    } catch (e) {
      failed.push(m.opponent + ': ' + e.message);
    }
  }

  if (sent) await store.write(seen);
  return { ok: failed.length === 0, sent, failed, found: upcoming.length };
}

// store eksportowany, żeby testy mogły podmienić zapis (w produkcji to Vercel Blob)
const store = { read: readSeen, write: writeSeen };

module.exports = { checkMatches, store };
