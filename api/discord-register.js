// Rejestruje komendy bota na serwerze Discorda. Uruchamiane z panelu admina,
// token bota zostaje w zmiennych Vercela (nigdy nie trafia do przeglądarki).
const L = require('../lib/admins.js');
const { COMMANDS } = require('../lib/discord-commands.js');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Metoda niedozwolona' });
  }
  const who = await L.authorize(req);
  if (!who) return res.status(401).json({ error: 'Brak dostępu - zaloguj się ponownie' });

  const token = (process.env.DISCORD_BOT_TOKEN || '').trim();
  const app = (process.env.DISCORD_APP_ID || '').trim();
  const guild = (process.env.DISCORD_GUILD_ID || '').trim();
  if (!token || !app || !guild) {
    return res.status(500).json({ error: 'Brak DISCORD_BOT_TOKEN, DISCORD_APP_ID lub DISCORD_GUILD_ID w ustawieniach Vercela' });
  }

  try {
    const r = await fetch(`https://discord.com/api/v10/applications/${app}/guilds/${guild}/commands`, {
      method: 'PUT',
      headers: { Authorization: 'Bot ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(COMMANDS),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      return res.status(502).json({ error: 'Discord odrzucił rejestrację (HTTP ' + r.status + ')', details: t.slice(0, 200) });
    }
    const j = await r.json().catch(() => []);
    return res.status(200).json({ ok: true, commands: Array.isArray(j) ? j.length : COMMANDS.length });
  } catch (e) {
    return res.status(502).json({ error: 'Nie udało się połączyć z Discordem' });
  }
};
