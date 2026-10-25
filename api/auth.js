module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Metoda niedozwolona' });
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return res.status(500).json({ error: 'Brak ADMIN_PASSWORD w ustawieniach serwera' });
  if ((req.headers['x-admin-pass'] || '') !== expected) return res.status(401).json({ error: 'Złe hasło' });
  return res.status(200).json({ ok: true });
};
