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
const { readSettings, TICKET_CATEGORIES, panelComponents } = require('../lib/bot-settings.js');

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

async function openTicket(i, catValue) {
  const guild = i.guild_id;
  const user = i.member.user;
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

async function closeTicket(i) {
  const who = i.member && i.member.user;
  await log(embed('Ticket zamknięty', `Kanał: ${i.channel && i.channel.name ? '#' + i.channel.name : i.channel_id}\nPrzez: <@${who && who.id}>`, COLORS.bad));
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
      const sent = await dmUser(t.id, embed('Ostrzeżenie', 'Otrzymałeś ostrzeżenie na serwerze Exomaly.\nPowód: ' + reason, COLORS.warn));
      await log(embed('Ostrzeżenie', `<@${t.id}> · ${reason}\nPrzez: ${by}`, COLORS.warn));
      return reply(`Ostrzeżenie dla <@${t.id}> zapisane.` + (sent ? '' : ' (nie udało się wysłać prywatnej wiadomości)'));
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

async function onButton(i) {
  // ticket_open: stary przycisk z wcześniej opublikowanych paneli, bez kategorii
  if (i.data.custom_id === 'ticket_open' || i.data.custom_id === 'ticket_pick') {
    if (!i.member) return reply('Ticket można otworzyć tylko na serwerze.');
    const picked = (i.data.values && i.data.values[0]) || null;
    return openTicket(i, i.data.custom_id === 'ticket_pick' ? picked : null);
  }
  if (i.data.custom_id === 'ticket_close') return closeTicket(i);
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

  try {
    let out;
    if (i.type === 2) out = await onCommand(i);
    else if (i.type === 3) out = await onButton(i);
    else out = reply('Nieobsługiwane żądanie.');
    return res.status(200).json(out);
  } catch (e) {
    return res.status(200).json(reply('Nie udało się wykonać akcji: ' + (e && e.message ? e.message : 'błąd').slice(0, 180)));
  }
};

module.exports.verify = verify;
module.exports.readRaw = readRaw;
