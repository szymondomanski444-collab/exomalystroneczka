import { getStore } from "@netlify/blobs";

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

export default async (req) => {
  const store = getStore("exomaly");

  if (req.method === "GET") {
    const data = await store.get("content", { type: "json" });
    return json({ data: data || null });
  }

  if (req.method === "POST") {
    const expected = process.env.ADMIN_PASSWORD;
    if (!expected) return json({ error: "Brak ADMIN_PASSWORD w ustawieniach Netlify" }, 500);
    if ((req.headers.get("x-admin-pass") || "") !== expected) return json({ error: "Złe hasło" }, 401);

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || !Array.isArray(body.skladGlowny)) {
      return json({ error: "Nieprawidłowe dane" }, 400);
    }
    await store.setJSON("content", body);
    return json({ ok: true });
  }

  return json({ error: "Metoda niedozwolona" }, 405);
};
