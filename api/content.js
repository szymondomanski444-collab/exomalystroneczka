const FILE = 'exomaly-content.json';

module.exports = async (req, res) => {
  const { put, list } = await import('@vercel/blob');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    const found = await list({ prefix: FILE, limit: 5 });
    const blob = found.blobs.find((b) => b.pathname === FILE);
    if (!blob) return res.status(200).json({ data: null });
    const r = await fetch(blob.url + '?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) return res.status(200).json({ data: null });
    return res.status(200).json({ data: await r.json() });
  }

  if (req.method === 'POST') {
    const expected = process.env.ADMIN_PASSWORD;
    if (!expected) return res.status(500).json({ error: 'Brak ADMIN_PASSWORD w ustawieniach serwera' });
    if ((req.headers['x-admin-pass'] || '') !== expected) return res.status(401).json({ error: 'Złe hasło' });
    const body = req.body && typeof req.body === 'object' ? req.body : null;
    if (!body || !Array.isArray(body.skladGlowny)) return res.status(400).json({ error: 'Nieprawidłowe dane' });
    await put(FILE, JSON.stringify(body), {
      access: 'public',
      contentType: 'application/json',
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 60,
    });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Metoda niedozwolona' });
};
