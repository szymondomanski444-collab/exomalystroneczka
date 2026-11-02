// Ustawienia bota Discorda (ID ról i kanałów, kolory, teksty). Zapisywane w prywatnym Vercel Blob.
// Gdy wartość nie jest ustawiona w panelu, bot używa zmiennych środowiskowych (DISCORD_*).

const FILE = 'exomaly-bot.json';

// Kategorie ticketów do wyboru z menu na panelu. value trafia do nazwy kanału, więc tylko małe litery bez polskich znaków.
const TICKET_CATEGORIES = [
  { value: 'wspolpraca', label: 'Współpraca', emoji: '🤝', description: 'Sponsoring, partnerstwo, propozycje współpracy' },
  { value: 'zgloszenie', label: 'Zgłoszenie', emoji: '📝', description: 'Zgłoszenie gracza, skargi, sprawy moderacyjne' },
  { value: 'blad', label: 'Błąd', emoji: '🐞', description: 'Błąd na stronie albo w bocie' },
  { value: 'inne', label: 'Inne', emoji: '💬', description: 'Wszystko, czego nie ma w pozostałych kategoriach' },
];

// Wiadomość panelu: menu wyboru kategorii zamiast jednego przycisku.
function panelComponents(s) {
  return [{
    type: 1,
    components: [{
      type: 3,
      custom_id: 'ticket_pick',
      placeholder: s.texts.panelButton,
      min_values: 1,
      max_values: 1,
      options: TICKET_CATEGORIES.map((c) => ({ label: c.label, value: c.value, description: c.description, emoji: { name: c.emoji } })),
    }],
  }];
}

const DEFAULTS = {
  staffRoleId: '',
  ticketCategoryId: '',
  logChannelId: '',
  panelChannelId: '',
  matchChannelId: '',
  colors: { info: '#ffffff', ok: '#57f287', warn: '#fee75c', bad: '#ed4245' },
  texts: {
    panelTitle: 'Pomoc i tickety',
    panelDesc: 'Masz sprawę do ekipy Exomaly? Wybierz kategorię z menu poniżej, a otworzymy dla Ciebie prywatny kanał, widoczny tylko dla Ciebie i staffu.\n\nZanim otworzysz ticket, sprawdź kategorie:\n🤝 **Współpraca**: sponsoring, partnerstwo, propozycje\n📝 **Zgłoszenie**: skargi i sprawy moderacyjne\n🐞 **Błąd**: problem ze stroną albo botem\n💬 **Inne**: wszystko, czego nie ma wyżej',
    panelButton: 'Wybierz kategorię',
    welcomeTitle: 'Witaj w tickecie',
    welcomeDesc: 'Opisz swoją sprawę. Staff odpowie najszybciej, jak to możliwe.',
    closeButton: 'Zamknij ticket',
    footer: 'Exomaly · Staff',
  },
};

function clone(x) { return JSON.parse(JSON.stringify(x)); }

function merge(j) {
  const out = clone(DEFAULTS);
  if (!j || typeof j !== 'object') return out;
  for (const k of ['staffRoleId', 'ticketCategoryId', 'logChannelId', 'panelChannelId', 'matchChannelId']) {
    if (typeof j[k] === 'string') out[k] = j[k];
  }
  if (j.colors && typeof j.colors === 'object') {
    for (const k of Object.keys(out.colors)) if (typeof j.colors[k] === 'string') out.colors[k] = j.colors[k];
  }
  if (j.texts && typeof j.texts === 'object') {
    for (const k of Object.keys(out.texts)) if (typeof j.texts[k] === 'string') out.texts[k] = j.texts[k];
  }
  return out;
}

async function readStream(stream) {
  const chunks = [];
  for await (const c of stream) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks).toString('utf8');
}

async function readSettings() {
  try {
    const { get } = await import('@vercel/blob');
    const r = await get(FILE, { access: 'private', useCache: false });
    if (!r || r.statusCode !== 200 || !r.stream) return merge(null);
    return merge(JSON.parse(await readStream(r.stream)));
  } catch (e) {
    return merge(null);
  }
}

async function writeSettings(s) {
  const { put } = await import('@vercel/blob');
  await put(FILE, JSON.stringify(s), {
    access: 'private',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0,
  });
}

// Walidacja danych z panelu. Zwraca { value } albo { error }.
function validate(input) {
  const s = merge(null);
  const idRe = /^\d{5,25}$/;
  for (const k of ['staffRoleId', 'ticketCategoryId', 'logChannelId', 'panelChannelId', 'matchChannelId']) {
    const v = String((input && input[k]) || '').trim();
    if (v && !idRe.test(v)) return { error: 'Nieprawidłowe ID w polu: ' + k };
    s[k] = v;
  }
  const colorRe = /^#?[0-9a-f]{6}$/i;
  for (const k of Object.keys(s.colors)) {
    const raw = input && input.colors && input.colors[k] !== undefined ? input.colors[k] : s.colors[k];
    const v = String(raw).trim();
    if (!colorRe.test(v)) return { error: 'Kolor "' + k + '" musi mieć format #RRGGBB' };
    s.colors[k] = v.startsWith('#') ? v : '#' + v;
  }
  const limits = { panelTitle: 256, panelDesc: 2000, panelButton: 80, welcomeTitle: 256, welcomeDesc: 2000, closeButton: 80, footer: 120 };
  for (const k of Object.keys(s.texts)) {
    const raw = input && input.texts && input.texts[k] !== undefined ? input.texts[k] : s.texts[k];
    const v = String(raw).trim();
    if (!v) return { error: 'Pole tekstu "' + k + '" nie może być puste' };
    if (v.length > (limits[k] || 200)) return { error: 'Tekst "' + k + '" jest za długi' };
    s.texts[k] = v;
  }
  return { value: s };
}

module.exports = { DEFAULTS, TICKET_CATEGORIES, panelComponents, merge, readSettings, writeSettings, validate };
