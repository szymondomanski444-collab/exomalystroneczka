// Proxy logo drużyn z Starter League. Przeglądarka nie zawsze może pobrać obrazek z ligi
// (blokada obcych stron), więc serwer pobiera go sam i przekazuje dalej z cache.
// Przepuszcza wyłącznie https://starterleague.pl/... i tylko pliki graficzne.

const MAX_BYTES = 1024 * 1024;

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Metoda niedozwolona' });
  }

  let target;
  try {
    const raw = new URL(req.url, 'https://exomaly.pl').searchParams.get('u') || '';
    target = new URL(raw);
  } catch (e) {
    return res.status(400).json({ error: 'Zły adres logo' });
  }
  if (target.protocol !== 'https:' || target.hostname !== 'starterleague.pl') {
    return res.status(400).json({ error: 'Niedozwolony adres' });
  }

  try {
    const r = await fetch(target.href, { headers: { Accept: 'image/*' }, redirect: 'error' });
    if (!r.ok) return res.status(404).json({ error: 'Brak logo' });
    const type = r.headers.get('content-type') || '';
    if (!type.startsWith('image/')) return res.status(415).json({ error: 'To nie jest obrazek' });
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > MAX_BYTES) return res.status(413).json({ error: 'Za duży plik' });

    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
    return res.status(200).send(buf);
  } catch (e) {
    return res.status(502).json({ error: 'Nie udało się pobrać logo' });
  }
};
