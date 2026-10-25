const FILE = 'exomaly-content.json';

async function readStream(stream) {
  const chunks = [];
  for await (const c of stream) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks).toString('utf8');
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const { put, get } = await import('@vercel/blob');

    if (req.method === 'GET') {
      let result = null;
      try {
        result = await get(FILE, { access: 'private', useCache: false });
      } catch (e) {
        result = null;
      }
      if (!result || result.statusCode !== 200 || !result.stream) return res.status(200).json({ data: null });
      return res.status(200).json({ data: JSON.parse(await readStream(result.stream)) });
    }

    if (req.method === 'POST') {
      const expected = process.env.ADMIN_PASSWORD;
      if (!expected) return res.status(500).json({ error: 'Brak ADMIN_PASSWORD w ustawieniach serwera' });
      if (!process.env.BLOB_READ_WRITE_TOKEN) return res.status(500).json({ error: 'Brak BLOB_READ_WRITE_TOKEN - podłącz Vercel Blob do projektu i zrób Redeploy' });
      if ((req.headers['x-admin-pass'] || '') !== expected) return res.status(401).json({ error: 'Złe hasło' });
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
      if (!body || typeof body !== 'object' || !Array.isArray(body.skladGlowny)) return res.status(400).json({ error: 'Nieprawidłowe dane' });
      await put(FILE, JSON.stringify(body), {
        access: 'private',
        contentType: 'application/json',
        addRandomSuffix: false,
        allowOverwrite: true,
        cacheControlMaxAge: 60,
      });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Metoda niedozwolona' });
  } catch (e) {
    console.error('content error:', e);
    return res.status(500).json({ error: 'Błąd serwera: ' + (e && e.message ? e.message : String(e)) });
  }
};
