// Powiadomienia o meczach Exomaly na kanał Discorda.
// 1) Nowy zaplanowany mecz -> embed "Nowy mecz zaplanowany".
// 2) Mecz, który zniknął z nadchodzących, a w historii ma już wynik -> embed z wynikiem.
// Stan (zapamiętane ID i mecze czekające na wynik) jest w prywatnym Vercel Blob (exomaly-matches.json).
// Pierwsze uruchomienie tylko zapamiętuje obecne mecze i niczego nie wysyła, żeby nie zalać kanału.

const B = require('./bot-settings.js');

const FILE = 'exomaly-matches.json';
const API = 'https://discord.com/api/v10';
const DEFAULT_BASE = 'https://starterleague.pl/api/partners';
const MAX_UPCOMING_PAGES = 10;
const MAX_HISTORY_PAGES = 300;
const HISTORY_BUDGET_MS = 7000;
const MAX_PER_RUN = 10;
const MAX_SEEN = 500;
const PENDING_TTL_MS = 3 * 24 * 60 * 60 * 1000; // mecz bez wyniku po 3 dniach przestaje być śledzony
const LOGO_URL = 'https://exomaly.pl/favicon-512.png';

const env = (n) => (process.env[n] || '').replace(/[^\x21-\x7E]/g, '');

async function readStream(stream) {
  const chunks = [];
  for await (const c of stream) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks).toString('utf8');
}

async function readState() {
  try {
    const { get } = await import('@vercel/blob');
    const r = await get(FILE, { access: 'private', useCache: false });
    if (!r || r.statusCode !== 200 || !r.stream) return null;
    const j = JSON.parse(await readStream(r.stream));
    if (!Array.isArray(j.seen)) return null;
    return { seen: j.seen, pending: Array.isArray(j.pending) ? j.pending : [] };
  } catch (e) {
    return null;
  }
}

async function writeState(state) {
  const { put } = await import('@vercel/blob');
  await put(FILE, JSON.stringify({ seen: state.seen.slice(-MAX_SEEN), pending: state.pending }), {
    access: 'private',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0,
  });
}

// Klient Partnerskiego API (ta sama konfiguracja co w api/overview.js i api/results.js).
function league() {
  const rawKey = env('STARTERLEAGUE_API_KEY');
  if (!rawKey) throw new Error('Brak klucza STARTERLEAGUE_API_KEY');
  const base = process.env.STARTERLEAGUE_API_BASE || DEFAULT_BASE;
  const pattern = process.env.STARTERLEAGUE_TEAM_NAME
    ? new RegExp(process.env.STARTERLEAGUE_TEAM_NAME.replace(/[^\x20-\x7E]/g, ''), 'i')
    : /exomaly/i;
  const headerName = env('STARTERLEAGUE_KEY_HEADER') || 'Authorization';
  const headers = { Accept: 'application/json' };
  headers[headerName] = headerName.toLowerCase() === 'authorization' && !/^Bearer /i.test(rawKey) ? 'Bearer ' + rawKey : rawKey;
  const getJson = async (path, timeoutMs = 8000) => {
    const r = await fetch(base + path, { headers, signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) throw new Error('Liga: HTTP ' + r.status);
    return r.json();
  };
  const sideOf = (m) => {
    if (m.team1 && m.team1.name && pattern.test(m.team1.name)) return 'team1';
    if (m.team2 && m.team2.name && pattern.test(m.team2.name)) return 'team2';
    return null;
  };
  return { getJson, sideOf };
}

async function fetchUpcoming(lg) {
  const first = await lg.getJson('/matches/upcoming?page=1');
  const totalPages = Math.max(1, Math.min(MAX_UPCOMING_PAGES, (first.pagination && first.pagination.totalPages) || 1));
  const pages = [first];
  for (let p = 2; p <= totalPages; p++) pages.push(await lg.getJson('/matches/upcoming?page=' + p));
  const out = [];
  for (const j of pages) {
    for (const m of Array.isArray(j.items) ? j.items : []) {
      const side = lg.sideOf(m);
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

// Szuka wyniku w historii (strony po 10 naraz, z budżetem czasu). Zwraca null, dopóki wyniku nie ma.
async function findResult(lg, id) {
  const deadline = Date.now() + HISTORY_BUDGET_MS;
  const first = await lg.getJson('/matches/history?page=1');
  const total = Math.min(MAX_HISTORY_PAGES, Math.max(1, (first.pagination && first.pagination.totalPages) || 1));
  const pages = [first];
  for (let p = 2; p <= total && Date.now() < deadline; p += 10) {
    const batch = [];
    for (let q = p; q < Math.min(p + 10, total + 1); q++) {
      batch.push(lg.getJson('/matches/history?page=' + q, Math.max(500, deadline - Date.now())));
    }
    pages.push(...(await Promise.all(batch)));
  }
  for (const j of pages) {
    for (const m of Array.isArray(j.items) ? j.items : []) {
      if (String(m.id) !== id) continue;
      const side = lg.sideOf(m);
      if (!side) return null;
      const theirs = side === 'team1' ? 'team2' : 'team1';
      const ourId = m[side] && m[side].id;
      if (m.winnerTeamId == null || ourId == null) return null; // wynik jeszcze niegotowy
      return {
        mine: m.score ? m.score[side] : null,
        opponent: m.score ? m.score[theirs] : null,
        won: m.winnerTeamId === ourId,
      };
    }
  }
  return null;
}

function matchEmbed(m, color, sample = false) {
  const when = m.date ? (m.date + (m.time ? ' ' + m.time : '')) : 'Do ustalenia';
  const fields = [{ name: 'Termin', value: when, inline: true }];
  if (m.division) fields.push({ name: 'Dywizja', value: m.division, inline: true });
  if (m.bestOf) fields.push({ name: 'Format', value: 'BO' + m.bestOf, inline: true });
  return {
    author: { name: 'EXOMALY', icon_url: LOGO_URL },
    title: sample ? 'PRZYKŁAD: nowy mecz zaplanowany' : 'Nowy mecz zaplanowany',
    description: '**Exomaly vs ' + m.opponent + '**',
    color,
    fields,
    thumbnail: { url: LOGO_URL },
    footer: { text: 'Exomaly · Terminarz', icon_url: LOGO_URL },
    timestamp: new Date().toISOString(),
  };
}

function resultEmbed(p, r, colors) {
  const score = r.mine != null && r.opponent != null ? r.mine + ' : ' + r.opponent : 'brak danych';
  return {
    author: { name: 'EXOMALY', icon_url: LOGO_URL },
    title: r.won ? 'Wygrana!' : 'Przegrana',
    description: '**Exomaly ' + score + ' ' + p.opponent + '**',
    color: parseInt((r.won ? colors.ok : colors.bad).slice(1), 16),
    fields: [
      { name: 'Wynik', value: r.won ? 'Wygrana' : 'Przegrana', inline: true },
      ...(p.division ? [{ name: 'Dywizja', value: p.division, inline: true }] : []),
      ...(p.bestOf ? [{ name: 'Format', value: 'BO' + p.bestOf, inline: true }] : []),
    ],
    thumbnail: { url: LOGO_URL },
    footer: { text: 'Exomaly · Wyniki', icon_url: LOGO_URL },
    timestamp: new Date().toISOString(),
  };
}

async function post(channel, token, embeds) {
  const r = await fetch(API + '/channels/' + channel + '/messages', {
    method: 'POST',
    headers: { Authorization: 'Bot ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ embeds, allowed_mentions: { parse: [] } }),
  });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + (await r.text().catch(() => '')).slice(0, 120));
}

// Główna funkcja. Zwraca podsumowanie do odpowiedzi API.
async function checkMatches() {
  const s = await B.readSettings();
  const channel = s.matchChannelId;
  if (!channel) return { ok: true, skipped: 'Nie ustawiono kanału powiadomień o meczach' };
  const token = env('DISCORD_BOT_TOKEN');
  if (!token) return { ok: false, error: 'Brak DISCORD_BOT_TOKEN w zmiennych Vercela' };

  const lg = league();
  const upcoming = await fetchUpcoming(lg);
  const state = await store.read();
  const now = Date.now();

  if (state === null) {
    // pierwszy raz: zapamiętujemy obecne mecze bez wysyłania (ich wyniki też będą śledzone)
    await store.write({ seen: upcoming.map((m) => m.id), pending: upcoming.map((m) => ({ ...m, since: now })) });
    return { ok: true, seeded: upcoming.length };
  }

  const color = parseInt(s.colors.info.slice(1), 16);
  const failed = [];
  let sent = 0;
  let results = 0;
  let changed = false;

  // 1) nowe zaplanowane mecze
  const seenSet = new Set(state.seen);
  const fresh = upcoming.filter((m) => !seenSet.has(m.id)).slice(0, MAX_PER_RUN);
  for (const m of fresh) {
    try {
      await post(channel, token, [matchEmbed(m, color)]);
      state.seen.push(m.id);
      state.pending.push({ ...m, since: now });
      sent++;
      changed = true;
    } catch (e) {
      failed.push(m.opponent + ': ' + e.message);
    }
  }

  // 2) mecze, które zniknęły z nadchodzących: szukamy wyniku w historii
  const upcomingIds = new Set(upcoming.map((m) => m.id));
  const waiting = state.pending.filter((p) => !upcomingIds.has(String(p.id)));
  let keep = state.pending.filter((p) => upcomingIds.has(String(p.id)));
  if (waiting.length) {
    changed = true;
    let historyOk = true;
    for (const p of waiting) {
      let r = null;
      try {
        r = historyOk ? await findResult(lg, String(p.id)) : null;
      } catch (e) {
        historyOk = false;
        failed.push('historia: ' + e.message);
      }
      if (r) {
        try {
          await post(channel, token, [resultEmbed(p, r, s.colors)]);
          results++;
          continue; // wynik wysłany, mecz znika z oczekujących
        } catch (e) {
          failed.push('wynik ' + p.opponent + ': ' + e.message);
        }
      }
      // bez wyniku (albo błąd): zostaje, dopóki nie minie PENDING_TTL_MS
      if (now - p.since < PENDING_TTL_MS) keep.push(p);
    }
  }
  state.pending = keep;

  if (changed) await store.write(state);
  return { ok: failed.length === 0, sent, results, failed, found: upcoming.length };
}

// Przykładowe powiadomienie na kanał (do sprawdzenia wyglądu, nie zmienia stanu).
async function sendSample() {
  const s = await B.readSettings();
  const channel = s.matchChannelId;
  if (!channel) return { ok: false, error: 'Najpierw ustaw ID kanału powiadomień i zapisz ustawienia' };
  const token = env('DISCORD_BOT_TOKEN');
  if (!token) return { ok: false, error: 'Brak DISCORD_BOT_TOKEN w zmiennych Vercela' };
  const color = parseInt(s.colors.info.slice(1), 16);
  try {
    await post(channel, token, [matchEmbed({ opponent: 'Przykładowy rywal', division: 'Liga testowa', date: '2026-11-10', time: '20:00', bestOf: 3 }, color, true)]);
  } catch (e) {
    return { ok: false, error: 'Discord odrzucił wiadomość: ' + e.message };
  }
  return { ok: true };
}

// store eksportowany, żeby testy mogły podmienić zapis (w produkcji to Vercel Blob)
const store = { read: readState, write: writeState };

module.exports = { checkMatches, sendSample, store };
