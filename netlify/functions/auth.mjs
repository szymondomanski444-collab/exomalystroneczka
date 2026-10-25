export default async (req) => {
  const json = (obj, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  if (req.method !== "POST") return json({ error: "Metoda niedozwolona" }, 405);
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return json({ error: "Brak ADMIN_PASSWORD w ustawieniach Netlify" }, 500);
  if ((req.headers.get("x-admin-pass") || "") !== expected) return json({ error: "Złe hasło" }, 401);
  return json({ ok: true });
};
