// Jednorazowo: rejestruje komendy bota na serwerze.
// Uruchom lokalnie: DISCORD_BOT_TOKEN=... DISCORD_APP_ID=... DISCORD_GUILD_ID=... node scripts/discord-register.js
const token = process.env.DISCORD_BOT_TOKEN;
const app = process.env.DISCORD_APP_ID;
const guild = process.env.DISCORD_GUILD_ID;
if (!token || !app || !guild) {
  console.error('Ustaw DISCORD_BOT_TOKEN, DISCORD_APP_ID i DISCORD_GUILD_ID.');
  process.exit(1);
}

const { COMMANDS: commands } = require('../lib/discord-commands.js');

fetch(`https://discord.com/api/v10/applications/${app}/guilds/${guild}/commands`, {
  method: 'PUT',
  headers: { Authorization: 'Bot ' + token, 'Content-Type': 'application/json' },
  body: JSON.stringify(commands),
})
  .then(async (r) => {
    const text = await r.text();
    console.log('HTTP', r.status, text.length > 300 ? text.slice(0, 300) + '…' : text);
    if (!r.ok) process.exit(1);
  })
  .catch((e) => { console.error('Błąd:', e.message); process.exit(1); });
