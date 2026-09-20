export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers }
  });
}

export function uid(prefix = "id") {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

export function parseCookies(request) {
  const raw = request.headers.get("cookie") || "";
  const cookies = {};
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i < 1) continue;
    try { cookies[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch {}
  }
  return cookies;
}

export function sessionCookie(id) {
  return `VIDGEN_SESSION=${encodeURIComponent(id)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000`;
}

export async function ensureSession(request, env) {
  const cookies = parseCookies(request);
  let id = cookies.VIDGEN_SESSION;
  let fresh = false;
  if (!id) {
    id = uid("usr");
    fresh = true;
  }
  await env.DATABASE_V2.prepare(
    "INSERT OR IGNORE INTO users (id) VALUES (?)"
  ).bind(id).run();
  return { id, fresh, cookie: fresh ? sessionCookie(id) : null };
}

export async function hmacSign(value, secret) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export async function makeState(userId, env) {
  const ts = Date.now();
  const raw = `${userId}.${ts}`;
  const sig = await hmacSign(raw, env.SESSION_SECRET || "dev-only-change-me");
  return btoa(`${raw}.${sig}`).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export async function verifyState(state, env) {
  try {
    const decoded = atob(state.replaceAll("-", "+").replaceAll("_", "/"));
    const [userId, ts, sig] = decoded.split(".");
    if (!userId || !ts || !sig || Date.now() - Number(ts) > 10 * 60 * 1000) return null;
    const expected = await hmacSign(`${userId}.${ts}`, env.SESSION_SECRET || "dev-only-change-me");
    return sig === expected ? userId : null;
  } catch { return null; }
}

export function safeText(value, max = 4000) {
  return String(value ?? "").trim().slice(0, max);
}

