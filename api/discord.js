// Bot Discorda działający przez endpoint HTTP (Interactions Endpoint URL): komendy, przyciski, tickety, moderacja.
// Zmienne (Vercel → Environment Variables):
//   DISCORD_PUBLIC_KEY        klucz publiczny aplikacji (weryfikacja podpisu żądań)
//   DISCORD_BOT_TOKEN         token bota (SEKRET, nigdy w kodzie ani w czacie)
//   DISCORD_APP_ID            ID aplikacji (do rejestracji komend)
//   DISCORD_GUILD_ID          ID serwera
//   DISCORD_TICKET_CATEGORY_ID   (opcjonalna) kategoria, w której tworzą się tickety
//   DISCORD_STAFF_ROLE_ID     (opcjonalna) rola staffu, która widzi tickety
//   DISCORD_LOG_CHANNEL_ID    (opcjonalna) kanał logów moderacji i ticketów
// Uprawnienia do komend sprawdzane są po uprawnieniach użytkownika na serwerze (bit w member.permissions).

const crypto = require('crypto');
const { readSettings, TICKET_CATEGORIES, panelComponents, rulesFields } = require('../lib/bot-settings.js');
const { addWarn, listWarns } = require('../lib/warns.js');
// waitUntil pozwala dokończyć zamykanie ticketa po odpowiedzi do Discorda (limit 3 s na odpowiedź)
let waitUntil = null;
try { waitUntil = require('@vercel/functions').waitUntil; } catch (e) { waitUntil = null; }

const API = 'https://discord.com/api/v10';
const EPHEMERAL = 64;
const BIT = {
  ADMIN: 1n << 3n,
  KICK: 1n << 1n,
  BAN: 1n << 2n,
  MANAGE_GUILD: 1n << 5n,
  MANAGE_MESSAGES: 1n << 13n,
  MODERATE: 1n << 40n,
};
const STAFF = BIT.ADMIN | BIT.KICK | BIT.BAN | BIT.MANAGE_MESSAGES | BIT.MODERATE;
const TICKET_ALLOW = String(1024n + 2048n + 65536n); // widok kanału, pisanie, historia
let COLORS = { info: 0xffffff, ok: 0x57f287, warn: 0xfee75c, bad: 0xed4245 };
let CFG = null; // ustawienia z panelu admina (ładowane przy każdym żądaniu)
const cfgOr = (key, envName) => (CFG && CFG[key]) || env(envName);

function env(name) { return (process.env[name] || '').trim(); }

function verify(rawBody, signature, timestamp) {
  const pub = env('DISCORD_PUBLIC_KEY');
  if (!pub || !signature || !timestamp) return false;
  try {
    // klucz Ed25519 w formacie SPKI: stały nagłówek + 32 bajty klucza
    const key = crypto.createPublicKey({
      key: Buffer.from('302a300506032b6570032100' + pub, 'hex'),
      format: 'der',
      type: 'spki',
    });
    return crypto.verify(null, Buffer.from(timestamp + rawBody), key, Buffer.from(signature, 'hex'));
  } catch (e) {
    return false;
  }
}

async function readRaw(req) {
  if (typeof req.body === 'string') return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
  if (req.body && typeof req.body === 'object') return JSON.stringify(req.body);
  const chunks = [];
  for await (const c of req) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks).toString('utf8');
}

async function discord(method, path, body) {
  const r = await fetch(API + path, {
    method,
    headers: { Authorization: 'Bot ' + env('DISCORD_BOT_TOKEN'), 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(method + ' ' + path.split('?')[0] + ' → ' + r.status + ' ' + t.slice(0, 160));
  }
  return r.status === 204 ? null : r.json();
}

function can(member, bits) {
  try { return (BigInt((member && member.permissions) || '0') & bits) !== 0n; } catch (e) { return false; }
}

// Logo strony (publiczny plik w repo) - Discord pobiera je sam, więc musi być pod stałym adresem.
const LOGO_URL = 'https://exomaly.pl/favicon-512.png';

function embed(title, description, color = COLORS.info, fields, thumbnail = false) {
  const e = {
    author: { name: 'EXOMALY', icon_url: LOGO_URL },
    title,
    description,
    color,
    fields: fields && fields.length ? fields : undefined,
    footer: { text: (CFG && CFG.texts.footer) || 'Exomaly · Staff', icon_url: LOGO_URL },
    timestamp: new Date().toISOString(),
  };
  if (thumbnail) e.thumbnail = { url: LOGO_URL };
  return e;
}

function reply(content, embeds, flags = EPHEMERAL) {
  return { type: 4, data: { content, embeds, flags, allowed_mentions: { parse: [] } } };
}

const noPerm = () => reply('Nie masz uprawnień do tej komendy.');

async function log(e) {
  const ch = cfgOr('logChannelId', 'DISCORD_LOG_CHANNEL_ID');
  if (!ch) return;
  try { await discord('POST', `/channels/${ch}/messages`, { embeds: [e], allowed_mentions: { parse: [] } }); } catch (err) { /* log nie może zablokować akcji */ }
}

async function dmUser(userId, e) {
  try {
    const dm = await discord('POST', '/users/@me/channels', { recipient_id: userId });
    await discord('POST', `/channels/${dm.id}/messages`, { embeds: [e] });
    return true;
  } catch (err) {
    return false;
  }
}

// Tickety ----------------------------------------------------------------

// Jeden otwarty ticket na gracza: szukamy kanału z ID gracza w temacie.
async function findOpenTicket(guild, userId) {
  const chans = await discord('GET', `/guilds/${guild}/channels`);
  const re = new RegExp('Ticket gracza ' + userId + '(\\D|$)');
  const hit = (chans || []).find((c) => c.type === 0 && re.test(c.topic || ''));
  return hit ? hit.id : null;
}

async function openTicket(i, catValue) {
  const guild = i.guild_id;
  const user = i.member.user;
  const existing = await findOpenTicket(guild, user.id);
  if (existing) return reply(`Masz już otwarty ticket: <#${existing}>`);
  const cat = TICKET_CATEGORIES.find((c) => c.value === catValue) || null;
  const category = cfgOr('ticketCategoryId', 'DISCORD_TICKET_CATEGORY_ID');
  const prefix = cat ? cat.value : 'ticket';
  const base = (prefix + '-' + (user.username || 'gracz')).toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 90);
  const overwrites = [
    { id: guild, type: 0, allow: '0', deny: '1024' }, // @everyone nie widzi kanału
    { id: user.id, type: 1, allow: TICKET_ALLOW, deny: '0' },
  ];
  const staffRole = cfgOr('staffRoleId', 'DISCORD_STAFF_ROLE_ID');
  if (staffRole) overwrites.push({ id: staffRole, type: 0, allow: TICKET_ALLOW, deny: '0' });

  const ch = await discord('POST', `/guilds/${guild}/channels`, {
    name: base || 'ticket',
    type: 0,
    parent_id: category || undefined,
    topic: 'Ticket gracza ' + user.id,
    permission_overwrites: overwrites,
  });
  await discord('POST', `/channels/${ch.id}/messages`, {
    content: `<@${user.id}>`,
    embeds: [embed(CFG.texts.welcomeTitle, CFG.texts.welcomeDesc, COLORS.info,
      cat ? [{ name: 'Kategoria', value: `${cat.emoji} ${cat.label}`, inline: true }] : null, true)],
    components: [{ type: 1, components: [{ type: 2, style: 4, label: CFG.texts.closeButton, emoji: { name: '🔒' }, custom_id: 'ticket_close' }] }],
    allowed_mentions: { users: [user.id] },
  });
  await log(embed('Ticket otwarty', `<#${ch.id}> · przez <@${user.id}>${cat ? ' · kategoria: ' + cat.label : ''}`, COLORS.ok));
  return reply(`Ticket utworzony: <#${ch.id}>`);
}

// Zamknięcie ticketa pyta najpierw o powód (modal), potem wysyła go do logu i na kanał.
const CLOSE_MODAL = 'ticket_close_modal';

function closeModal() {
  return {
    type: 9,
    data: {
      custom_id: CLOSE_MODAL,
      title: 'Zamknij ticket',
      components: [{
        type: 1,
        components: [{
          type: 4,
          custom_id: 'reason',
          style: 2,
          label: 'Powód zamknięcia',
          placeholder: 'np. sprawa załatwiona, brak odpowiedzi',
          required: true,
          min_length: 3,
          max_length: 300,
        }],
      }],
    },
  };
}

// Transkrypcja: ostatnie wiadomości z kanału, od najstarszej, jako zwykły tekst.
const TRANSCRIPT_MAX = 300;

async function fetchMessages(channelId) {
  const out = [];
  let before = null;
  while (out.length < TRANSCRIPT_MAX) {
    const batch = await discord('GET', `/channels/${channelId}/messages?limit=100${before ? '&before=' + before : ''}`);
    if (!batch || !batch.length) break;
    out.push(...batch);
    before = batch[batch.length - 1].id;
    if (batch.length < 100) break;
  }
  return out.slice(0, TRANSCRIPT_MAX).reverse();
}

function buildTranscript(msgs, chName) {
  const lines = [`Transkrypcja ticketa #${chName}`, `Wygenerowano: ${new Date().toISOString()} (UTC)`, ''];
  for (const m of msgs) {
    const when = new Date(m.timestamp).toISOString().replace('T', ' ').slice(0, 19);
    const who = (m.author && (m.author.global_name || m.author.username)) || '?';
    const parts = [];
    if (m.content) parts.push(m.content);
    for (const a of m.attachments || []) parts.push('[załącznik] ' + a.url);
    if (m.embeds && m.embeds.length) parts.push('[embed]');
    lines.push(`[${when}] ${who}: ${parts.join(' ') || '(pusta wiadomość)'}`);
  }
  return lines.join('\n') + '\n';
}

// Wysyłka wiadomości z plikiem (multipart). Zwraca nic, rzuca błąd przy odrzuceniu.
async function discordUpload(channelId, embeds, fileName, text) {
  const form = new FormData();
  form.append('payload_json', JSON.stringify({ embeds, allowed_mentions: { parse: [] } }));
  form.append('files[0]', new Blob([text], { type: 'text/plain; charset=utf-8' }), fileName);
  const r = await fetch(API + `/channels/${channelId}/messages`, {
    method: 'POST',
    headers: { Authorization: 'Bot ' + env('DISCORD_BOT_TOKEN') },
    body: form,
  });
  if (!r.ok) throw new Error('upload → ' + r.status + ' ' + (await r.text().catch(() => '')).slice(0, 120));
}

async function closeTicket(i, reasonRaw) {
  const who = i.member && i.member.user;
  const closer = who ? '<@' + who.id + '>' : 'nieznany';
  const reason = String(reasonRaw || '').trim().slice(0, 300) || 'brak powodu';
  const ch = await discord('GET', `/channels/${i.channel_id}`);
  const chName = ch.name || i.channel_id;
  const owner = ((ch.topic || '').match(/Ticket gracza (\d+)/) || [])[1] || null;

  let text = '';
  try {
    text = buildTranscript(await fetchMessages(i.channel_id), chName);
  } catch (e) {
    text = 'Nie udało się pobrać transkrypcji: ' + e.message + '\n';
  }
  const file = `transkrypcja-${chName}.txt`;

  // log moderacji: powód + kto zamknął + transkrypcja
  const logEmbed = embed('Ticket zamknięty', `Kanał: #${chName}\nZamknął: ${closer}\nTicket gracza: ${owner ? '<@' + owner + '>' : 'nieznany'}\nPowód: ${reason}`, COLORS.bad);
  const ch2 = cfgOr('logChannelId', 'DISCORD_LOG_CHANNEL_ID');
  if (ch2) {
    try { await discordUpload(ch2, [logEmbed], file, text); }
    catch (e) { await log(logEmbed); }
  }

  // DM do autora ticketa: powód + transkrypcja
  let dmNote = '';
  if (owner) {
    try {
      const dm = await discord('POST', '/users/@me/channels', { recipient_id: owner });
      await discordUpload(dm.id, [embed('Twój ticket został zamknięty', `Powód: ${reason}\n\nW załączniku znajduje się transkrypcja rozmowy.`, COLORS.bad)], file, text);
    } catch (e) {
      dmNote = ' (nie udało się wysłać DM)';
    }
  } else {
    dmNote = ' (brak ID autora w temacie kanału)';
  }
  if (dmNote && ch2) {
    await log(embed('Ticket zamknięty: DM niewysłany', `Kanał: #${chName}${dmNote}`, COLORS.warn));
  }

  await discord('DELETE', `/channels/${i.channel_id}`);
  return reply('Ticket zamknięty.');
}

// Komendy ----------------------------------------------------------------

async function onCommand(i) {
  const m = i.member;
  if (!m) return reply('Komendy działają tylko na serwerze.');
  const opt = (n) => (i.data.options || []).find((o) => o.name === n);
  const val = (n) => { const o = opt(n); return o ? o.value : undefined; };
  const target = () => {
    const id = val('user');
    const u = i.data.resolved && i.data.resolved.users && i.data.resolved.users[id];
    return { id, name: (u && u.username) || id };
  };
  const by = '<@' + m.user.id + '>';

  switch (i.data.name) {
    case 'panel': {
      if (!can(m, BIT.ADMIN | BIT.MANAGE_GUILD)) return noPerm();
      await discord('POST', `/channels/${i.channel_id}/messages`, {
        embeds: [embed(CFG.texts.panelTitle, CFG.texts.panelDesc, COLORS.info, null, true)],
        components: panelComponents(CFG),
      });
      return reply('Panel opublikowany.');
    }
    case 'warn': {
      if (!can(m, STAFF)) return noPerm();
      const t = target();
      const reason = val('reason') || 'brak powodu';
      const count = await addWarn(t.id, { reason, by: m.user.id });
      const sent = await dmUser(t.id, embed('Ostrzeżenie', 'Otrzymałeś ostrzeżenie na serwerze Exomaly.\nPowód: ' + reason, COLORS.warn));
      await log(embed('Ostrzeżenie', `<@${t.id}> · ${reason}\nPrzez: ${by}\nŁącznie ostrzeżeń: ${count}`, COLORS.warn));
      return reply(`Ostrzeżenie dla <@${t.id}> zapisane. Łącznie ostrzeżeń: ${count}.` + (sent ? '' : ' (nie udało się wysłać prywatnej wiadomości)'));
    }
    case 'warnings': {
      if (!can(m, STAFF)) return noPerm();
      const t = target();
      const list = await listWarns(t.id);
      if (!list.length) return reply(`<@${t.id}> nie ma ostrzeżeń.`);
      const lines = list.slice(-10).reverse().map((w) => `• ${w.at.slice(0, 10)} · ${w.reason} · przez <@${w.by}>`);
      if (list.length > 10) lines.push(`… i ${list.length - 10} wcześniejszych`);
      return reply(undefined, [embed(`Ostrzeżenia: ${t.name}`, `Łącznie: ${list.length}\n\n` + lines.join('\n'), COLORS.warn)]);
    }
    case 'timeout': {
      if (!can(m, BIT.MODERATE)) return noPerm();
      const t = target();
      const minutes = Math.min(40320, Math.max(1, Number(val('minutes')) || 10));
      const until = new Date(Date.now() + minutes * 60000).toISOString();
      await discord('PATCH', `/guilds/${i.guild_id}/members/${t.id}`, { communication_disabled_until: until });
      await log(embed('Wyciszenie', `<@${t.id}> · ${minutes} min · ${val('reason') || 'brak powodu'}\nPrzez: ${by}`, COLORS.warn));
      return reply(`<@${t.id}> wyciszony na ${minutes} min.`);
    }
    case 'kick': {
      if (!can(m, BIT.KICK)) return noPerm();
      const t = target();
      await discord('DELETE', `/guilds/${i.guild_id}/members/${t.id}`);
      await log(embed('Wyrzucenie', `${t.name} (<@${t.id}>) · ${val('reason') || 'brak powodu'}\nPrzez: ${by}`, COLORS.bad));
      return reply(`${t.name} został wyrzucony.`);
    }
    case 'ban': {
      if (!can(m, BIT.BAN)) return noPerm();
      const t = target();
      await discord('PUT', `/guilds/${i.guild_id}/bans/${t.id}`, { delete_message_seconds: 0 });
      await log(embed('Ban', `${t.name} (<@${t.id}>) · ${val('reason') || 'brak powodu'}\nPrzez: ${by}`, COLORS.bad));
      return reply(`${t.name} został zbanowany.`);
    }
    case 'purge': {
      if (!can(m, BIT.MANAGE_MESSAGES)) return noPerm();
      const amount = Math.min(100, Math.max(1, Number(val('amount')) || 10));
      const list = await discord('GET', `/channels/${i.channel_id}/messages?limit=${amount}`);
      // Discord nie usuwa wiadomości starszych niż 14 dni przez bulk-delete
      const limit = Date.now() - 14 * 24 * 3600 * 1000;
      const ids = (list || []).filter((x) => ((BigInt(x.id) >> 22n) + 1420070400000n) > BigInt(limit)).map((x) => x.id);
      if (ids.length === 1) await discord('DELETE', `/channels/${i.channel_id}/messages/${ids[0]}`);
      else if (ids.length > 1) await discord('POST', `/channels/${i.channel_id}/messages/bulk-delete`, { messages: ids });
      await log(embed('Wyczyszczono wiadomości', `Kanał: <#${i.channel_id}> · usunięto: ${ids.length}\nPrzez: ${by}`, COLORS.warn));
      return reply(`Usunięto wiadomości: ${ids.length}.`);
    }
    default:
      return reply('Nieznana komenda.');
  }
}

// Odpowiedź dla zamykającego wysyłana po zakończeniu (interakcja ważna 15 minut).
async function followUp(i, content) {
  await fetch(`${API}/webhooks/${i.application_id}/${i.token}/messages/@original`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
  });
}

async function closeInBackground(i, reason) {
  let text;
  try {
    await closeTicket(i, reason);
    text = 'Ticket zamknięty.';
  } catch (e) {
    text = 'Nie udało się zamknąć ticketa: ' + (e && e.message ? e.message : 'błąd').slice(0, 160);
  }
  await followUp(i, text).catch(() => {});
}

function modalReason(i) {
  const row = (i.data.components || [])[0];
  const field = row && (row.components || [])[0];
  return field && field.value;
}

async function onModal(i) {
  if (i.data.custom_id !== CLOSE_MODAL) return reply('Nieznany formularz.');
  const row = (i.data.components || [])[0];
  const field = row && (row.components || [])[0];
  return closeTicket(i, field && field.value);
}

async function onButton(i) {
  // ticket_open: stary przycisk z wcześniej opublikowanych paneli, bez kategorii
  if (i.data.custom_id === 'ticket_open' || i.data.custom_id === 'ticket_pick') {
    if (!i.member) return reply('Ticket można otworzyć tylko na serwerze.');
    const picked = (i.data.values && i.data.values[0]) || null;
    return openTicket(i, i.data.custom_id === 'ticket_pick' ? picked : null);
  }
  if (i.data.custom_id === 'ticket_close') return closeModal();
  // kategoria regulaminu: zasady widoczne tylko dla klikającego
  if (i.data.custom_id.startsWith('rule:')) {
    const f = rulesFields(CFG.texts.rulesBody)[parseInt(i.data.custom_id.slice(5), 10)];
    if (!f) return reply('Ta kategoria regulaminu już nie istnieje. Poproś staff o odświeżenie regulaminu.');
    return {
      type: 4,
      data: {
        embeds: [{
          author: { name: 'EXOMALY · Regulamin', icon_url: LOGO_URL },
          title: f.name,
          description: f.value,
          color: COLORS.info,
          footer: { text: CFG.texts.footer },
        }],
        flags: EPHEMERAL,
        allowed_mentions: { parse: [] },
      },
    };
  }
  return reply('Nieznany przycisk.');
}

// Endpoint --------------------------------------------------------------

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Metoda niedozwolona' });
  }

  const raw = await readRaw(req);
  CFG = await readSettings();
  COLORS = Object.fromEntries(Object.entries(CFG.colors).map(([k, v]) => [k, parseInt(v.slice(1), 16)]));
  if (!verify(raw, req.headers['x-signature-ed25519'], req.headers['x-signature-timestamp'])) {
    return res.status(401).send('invalid request signature');
  }

  let i;
  try { i = JSON.parse(raw); } catch (e) { return res.status(400).json({ error: 'Zły JSON' }); }

  // Discord sprawdza adres przy zapisie w panelu: PING musi dostać PONG
  if (i.type === 1) return res.status(200).json({ type: 1 });

  // zamknięcie ticketa: odpowiedź "myślę" od razu, reszta w tle (jeśli dostępne)
  if (i.type === 5 && i.data.custom_id === CLOSE_MODAL && waitUntil) {
    res.status(200).json({ type: 5, data: { flags: EPHEMERAL } });
    waitUntil(closeInBackground(i, modalReason(i)));
    return;
  }

  try {
    let out;
    if (i.type === 2) out = await onCommand(i);
    else if (i.type === 3) out = await onButton(i);
    else if (i.type === 5) out = await onModal(i);
    else out = reply('Nieobsługiwane żądanie.');
    return res.status(200).json(out);
  } catch (e) {
    return res.status(200).json(reply('Nie udało się wykonać akcji: ' + (e && e.message ? e.message : 'błąd').slice(0, 180)));
  }
};

module.exports.verify = verify;
module.exports.readRaw = readRaw;
