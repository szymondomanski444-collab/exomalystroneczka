// Definicje komend bota Discorda (wspólne dla rejestracji w panelu i skryptu).
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

module.exports = { COMMANDS: commands };
