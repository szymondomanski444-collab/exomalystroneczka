// Panel bota Discorda: odczyt i zapis ustawień, publikacja panelu ticketów, lista banów i odbanowanie.
// Dostęp: właściciel albo admin (jak reszta panelu). Token bota zostaje w zmiennych Vercela.
const L = require('../lib/admins.js');
const B = require('../lib/bot-settings.js');

const API = 'https://discord.com/api/v10';
const env = (n) => (process.env[n] || '').trim();
const LOGO_URL = 'https://exomaly.pl/favicon-512.png'; // ten sam logo co w discord.js

function readBody(req) {
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = null; } }
  return b && typeof b === 'object' ? b : {};
}

async function discord(method, path, body) {
  const r = await fetch(API + path, {
    method,
    headers: { Authorization: 'Bot ' + env('DISCORD_BOT_TOKEN'), 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(method + ' ' + path.split('?')[0] + ' → HTTP ' + r.status + ' ' + t.slice(0, 160));
  }
  return r.status === 204 ? null : r.json();
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Metoda niedozwolona' });
  }
  const who = await L.authorize(req);
  if (!who) return res.status(401).json({ error: 'Brak dostępu - zaloguj się ponownie' });

  const body = readBody(req);
  const guild = env('DISCORD_GUILD_ID');
  if (!env('DISCORD_BOT_TOKEN') || !guild) {
    return res.status(500).json({ error: 'Brak DISCORD_BOT_TOKEN lub DISCORD_GUILD_ID w ustawieniach Vercela' });
  }

  try {
    if (body.action === 'get') {
      const settings = await B.readSettings();
      let bans = [];
      let bansError = '';
      try {
        const list = await discord('GET', `/guilds/${guild}/bans?limit=1000`);
        bans = (list || []).map((x) => ({
          id: x.user.id,
          name: x.user.global_name || x.user.username || x.user.id,
          reason: x.reason || '',
        }));
      } catch (e) {
        bansError = e.message;
      }
      return res.status(200).json({ settings, bans, bansError });
    }

    if (body.action === 'save') {
      const v = B.validate(body.settings || {});
      if (v.error) return res.status(400).json({ error: v.error });
      await B.writeSettings(v.value);
      return res.status(200).json({ ok: true, settings: v.value });
    }

    if (body.action === 'publish') {
      const s = await B.readSettings();
      const ch = s.panelChannelId || env('DISCORD_PANEL_CHANNEL_ID');
      if (!ch) return res.status(400).json({ error: 'Najpierw wybierz kanał panelu i zapisz ustawienia' });
      const color = parseInt(s.colors.info.slice(1), 16);
      await discord('POST', `/channels/${ch}/messages`, {
        embeds: [{
          author: { name: 'EXOMALY', icon_url: LOGO_URL },
          title: s.texts.panelTitle,
          description: s.texts.panelDesc,
          color,
          thumbnail: { url: LOGO_URL },
          footer: { text: s.texts.footer, icon_url: LOGO_URL },
          timestamp: new Date().toISOString(),
        }],
        components: [{ type: 1, components: [{ type: 2, style: 1, label: s.texts.panelButton, emoji: { name: '🎫' }, custom_id: 'ticket_open' }] }],
      });
      return res.status(200).json({ ok: true });
    }

    if (body.action === 'unban') {
      const id = String(body.userId || '').trim();
      if (!/^\d{5,25}$/.test(id)) return res.status(400).json({ error: 'Nieprawidłowe ID użytkownika' });
      await discord('DELETE', `/guilds/${guild}/bans/${id}`);
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Nieznana akcja' });
  } catch (e) {
    return res.status(502).json({ error: (e && e.message ? e.message : 'Błąd').slice(0, 240) });
  }
};
