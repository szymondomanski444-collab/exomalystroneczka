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
  rulesChannelId: '',
  recruitChannelId: '',
  recruitPanelChannelId: '',
  playerRoleId: '',
  recruitRoles: 'Project Manager | Prowadzenie projektów, terminarz i koordynacja drużyny\nPartnerzy | Pozyskiwanie sponsorów i partnerów dla Exomaly',
  colors: { info: '#ffffff', ok: '#57f287', warn: '#fee75c', bad: '#ed4245' },
  texts: {
    panelTitle: 'Pomoc i tickety',
    panelDesc: 'Masz sprawę do ekipy **Exomaly**? Wybierz kategorię z menu poniżej. Otworzymy dla Ciebie prywatny kanał, widoczny tylko dla Ciebie i staffu.\n\n**Jak to działa**\n1 – wybierz kategorię z menu\n2 – opisz sprawę na swoim kanale\n3 – staff odpowie najszybciej, jak może\n\n**Kategorie**\n🤝 **Współpraca** – sponsoring, partnerstwo, propozycje\n📝 **Zgłoszenie** – skargi i sprawy moderacyjne\n🐞 **Błąd** – problem ze stroną albo botem\n💬 **Inne** – wszystko, czego nie ma wyżej',
    panelButton: 'Wybierz kategorię',
    welcomeTitle: 'Witaj w tickecie',
    welcomeDesc: 'Opisz swoją sprawę. Staff odpowie najszybciej, jak to możliwe.',
    closeButton: 'Zamknij ticket',
    footer: 'Exomaly · Staff',
    recruitTitle: 'Nabór do Exomaly',
    recruitDesc: 'Szukamy ludzi do drużyny. Wybierz stanowisko z menu, wypełnij krótki formularz, a zgłoszenie trafi do staffu.',
    recruitButton: 'Wybierz stanowisko',
    rulesTitle: 'Regulamin serwera',
    rulesIntro: 'Witaj na serwerze **Exomaly**! Zanim zaczniesz pisać, przeczytaj zasady. Ich nieznajomość nie zwalnia z przestrzegania.',
    rulesBody: '🤝 **Szacunek**\nSzanuj graczy, staff i rywali. Bez wyzwisk, ataków, dyskryminacji i wyśmiewania.\n\n💬 **Czat**\nNie spamuj, nie wysyłaj tej samej wiadomości wielokrotnie i nie nadużywaj WIELKICH LITER ani emoji.\nTematy pisz w kanałach, do których pasują.\n\n🔗 **Reklamy i linki**\nBez reklam, zaproszeń na inne serwery i linków bez zgody staffu.\n\n🎫 **Tickety**\nOtwieraj ticket tylko w konkretnej sprawie i wybierz odpowiednią kategorię.\nOpisz sprawę od razu, z nickiem i szczegółami. Nie pinguj staffu poza ticketem.\n\n🔞 **Treści**\nBez treści 18+, nielegalnych, wulgarnych i wrażliwych danych osobowych (swoich i cudzych).\n\n⚖️ **Kary**\nZa złamanie regulaminu staff może zwrócić uwagę, wyciszyć, wyrzucić lub zbanować. Decyzje odwoławcze składasz przez ticket.\n\n🛡️ **Staff**\nDecyzje staffu są ostateczne do czasu odwołania przez ticket. Nie podawaj się za członka staffu i nie wykonuj poleceń osób, które się nim podają.\n\n📣 **Ogłoszenia**\nTerminy meczów i wyniki pojawiają się na kanale powiadomień. Nie ignoruj ich, bo to podstawa do ustaleń w drużynie.\n\n✅ **Akceptacja**\nKorzystając z serwera, akceptujesz regulamin.',
  },
};

function clone(x) { return JSON.parse(JSON.stringify(x)); }

function merge(j) {
  const out = clone(DEFAULTS);
  if (!j || typeof j !== 'object') return out;
  for (const k of ['staffRoleId', 'ticketCategoryId', 'logChannelId', 'panelChannelId', 'matchChannelId', 'rulesChannelId', 'recruitChannelId', 'recruitPanelChannelId', 'playerRoleId']) {
    if (typeof j[k] === 'string') out[k] = j[k];
  }
  if (typeof j.recruitRoles === 'string') out.recruitRoles = j.recruitRoles;
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
  for (const k of ['staffRoleId', 'ticketCategoryId', 'logChannelId', 'panelChannelId', 'matchChannelId', 'rulesChannelId', 'recruitChannelId', 'recruitPanelChannelId', 'playerRoleId']) {
    const v = String((input && input[k]) || '').trim();
    if (v && !idRe.test(v)) return { error: 'Nieprawidłowe ID w polu: ' + k };
    s[k] = v;
  }
  const roles = String(input && input.recruitRoles !== undefined ? input.recruitRoles : s.recruitRoles).trim();
  if (roles.length > 1500) return { error: 'Lista stanowisk jest za długa' };
  if (rolesFromText(roles).length === 0) return { error: 'Dodaj co najmniej jedno stanowisko w formacie: Nazwa | opis' };
  s.recruitRoles = roles;
  const colorRe = /^#?[0-9a-f]{6}$/i;
  for (const k of Object.keys(s.colors)) {
    const raw = input && input.colors && input.colors[k] !== undefined ? input.colors[k] : s.colors[k];
    const v = String(raw).trim();
    if (!colorRe.test(v)) return { error: 'Kolor "' + k + '" musi mieć format #RRGGBB' };
    s.colors[k] = v.startsWith('#') ? v : '#' + v;
  }
  const limits = { panelTitle: 256, panelDesc: 2000, panelButton: 80, welcomeTitle: 256, welcomeDesc: 2000, closeButton: 80, footer: 120, rulesTitle: 256, rulesIntro: 500, rulesBody: 4000, recruitTitle: 256, recruitDesc: 2000, recruitButton: 80 };
  for (const k of Object.keys(s.texts)) {
    const raw = input && input.texts && input.texts[k] !== undefined ? input.texts[k] : s.texts[k];
    const v = String(raw).trim();
    if (!v) return { error: 'Pole tekstu "' + k + '" nie może być puste' };
    if (v.length > (limits[k] || 200)) return { error: 'Tekst "' + k + '" jest za długi' };
    s.texts[k] = v;
  }
  return { value: s };
}

// Regulamin: bloki oddzielone pustą linią. Pierwsza linia bloku to tytuł pola, reszta to treść.
function rulesFields(text) {
  const blocks = String(text || '').split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  return blocks.map((b) => {
    const lines = b.split('\n');
    const name = lines[0].replace(/\*\*/g, '').trim().slice(0, 256) || 'Zasada';
    const value = (lines.slice(1).join('\n').trim() || 'Brak szczegółów.').slice(0, 1024);
    return { name, value, inline: false };
  }).slice(0, 25);
}

// Przyciski kategorii regulaminu (po 5 w rzędzie, max 25). Kliknięcie pokazuje zasady tylko klikającemu.
function rulesComponents(text) {
  const fields = rulesFields(text);
  const rows = [];
  for (let k = 0; k < fields.length; k += 5) {
    rows.push({
      type: 1,
      components: fields.slice(k, k + 5).map((f, j) => ({ type: 2, style: 2, label: f.name.slice(0, 80), custom_id: 'rule:' + (k + j) })),
    });
  }
  return rows;
}

// Stanowiska naboru: jedna linia = "Nazwa | opis". Zwraca najwyżej 25 pozycji.
function rolesFromText(text) {
  return String(text || '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const [name, ...rest] = l.split('|');
    return { name: name.trim().slice(0, 100), desc: rest.join('|').trim().slice(0, 100) };
  }).filter((r) => r.name).slice(0, 25);
}

// Panel naboru: menu wyboru stanowiska (wartość = indeks).
function recruitComponents(s) {
  const roles = rolesFromText(s.recruitRoles);
  return [{
    type: 1,
    components: [{
      type: 3,
      custom_id: 'recruit_pick',
      placeholder: s.texts.recruitButton,
      min_values: 1,
      max_values: 1,
      options: roles.map((r, idx) => ({ label: r.name, value: String(idx), description: r.desc || undefined })),
    }],
  }];
}

module.exports = { DEFAULTS, TICKET_CATEGORIES, panelComponents, recruitComponents, rolesFromText, rulesFields, rulesComponents, merge, readSettings, writeSettings, validate };
