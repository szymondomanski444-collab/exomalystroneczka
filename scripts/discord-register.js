// Jednorazowo: rejestruje komendy bota na serwerze.
// Uruchom lokalnie: DISCORD_BOT_TOKEN=... DISCORD_APP_ID=... DISCORD_GUILD_ID=... node scripts/discord-register.js
const token = process.env.DISCORD_BOT_TOKEN;
const app = process.env.DISCORD_APP_ID;
const guild = process.env.DISCORD_GUILD_ID;
if (!token || !app || !guild) {
  console.error('Ustaw DISCORD_BOT_TOKEN, DISCORD_APP_ID i DISCORD_GUILD_ID.');
  process.exit(1);
}

const user = { type: 6, name: 'user', description: 'Użytkownik', required: true };
const reason = { type: 3, name: 'reason', description: 'Powód', required: false };

const commands = [
  { name: 'panel', description: 'Opublikuj panel ticketów na tym kanale' },
  { name: 'warn', description: 'Wyślij ostrzeżenie do użytkownika', options: [user, reason] },
  {
    name: 'timeout',
    description: 'Wycisz użytkownika na czas',
    options: [
      user,
      { type: 4, name: 'minutes', description: 'Czas w minutach (1–40320)', required: true, min_value: 1, max_value: 40320 },
      reason,
    ],
  },
  { name: 'kick', description: 'Wyrzuć użytkownika z serwera', options: [user, reason] },
  { name: 'ban', description: 'Zbanuj użytkownika', options: [user, reason] },
  {
    name: 'purge',
    description: 'Usuń ostatnie wiadomości z kanału',
    options: [{ type: 4, name: 'amount', description: 'Ile wiadomości (1–100)', required: true, min_value: 1, max_value: 100 }],
  },
];

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
