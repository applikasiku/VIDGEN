import { makeState, verifyState } from "./utils.js";

const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";

export async function googleAuthStart(request, env, userId) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) throw new Error("Google OAuth belum dikonfigurasi.");
  const origin = new URL(request.url).origin;
  const state = await makeState(userId, env);
  const qs = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: `${origin}/oauth/google/callback`,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    scope: "openid email profile https://www.googleapis.com/auth/drive.file",
    state
  });
  return `${GOOGLE_AUTH}?${qs}`;
}

export async function googleAuthCallback(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const userId = await verifyState(url.searchParams.get("state") || "", env);
  if (!code || !userId) throw new Error("OAuth state tidak valid.");
  const origin = url.origin;
  const tokenRes = await fetch(GOOGLE_TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: `${origin}/oauth/google/callback`
    })
  });
  if (!tokenRes.ok) throw new Error(`Google token ${tokenRes.status}: ${await tokenRes.text()}`);
  const token = await tokenRes.json();
  let profile = {};
  try {
    const profileRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { authorization: `Bearer ${token.access_token}` } });
    if (profileRes.ok) profile = await profileRes.json();
  } catch {}
  await env.DATABASE_V2.prepare("UPDATE users SET email=?, name=?, picture=?, updated_at=CURRENT_TIMESTAMP WHERE id=?")
    .bind(profile.email || null, profile.name || null, profile.picture || null, userId).run();
  await env.DATABASE_V2.prepare(`
    INSERT INTO oauth_tokens (user_id, provider, access_token, refresh_token, expires_at, scope, token_type)
    VALUES (?, 'google', ?, ?, ?, ?, ?)
    ON CONFLICT(user_id,provider) DO UPDATE SET access_token=excluded.access_token,
      refresh_token=COALESCE(excluded.refresh_token, oauth_tokens.refresh_token),
      expires_at=excluded.expires_at, scope=excluded.scope, token_type=excluded.token_type,
      updated_at=CURRENT_TIMESTAMP
  `).bind(userId, token.access_token, token.refresh_token || null, Date.now() + (token.expires_in || 3600) * 1000, token.scope || "", token.token_type || "Bearer").run();
  return userId;
}

async function getToken(env, userId) {
  const row = await env.DATABASE_V2.prepare("SELECT * FROM oauth_tokens WHERE user_id=? AND provider='google'").bind(userId).first();
  if (!row) throw new Error("Google Drive belum terhubung.");
  if (!row.expires_at || Number(row.expires_at) > Date.now() + 60000) return row.access_token;
  if (!row.refresh_token) throw new Error("Token Google kedaluwarsa. Hubungkan ulang Google Drive.");
  const res = await fetch(GOOGLE_TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: row.refresh_token,
      grant_type: "refresh_token"
    })
  });
  if (!res.ok) throw new Error(`Refresh Google token gagal: ${await res.text()}`);
  const data = await res.json();
  await env.DATABASE_V2.prepare("UPDATE oauth_tokens SET access_token=?, expires_at=?, updated_at=CURRENT_TIMESTAMP WHERE user_id=? AND provider='google'")
    .bind(data.access_token, Date.now() + (data.expires_in || 3600) * 1000, userId).run();
  return data.access_token;
}

export async function driveStatus(env, userId) {
  const row = await env.DATABASE_V2.prepare("SELECT u.email,u.name,u.picture,o.scope FROM users u LEFT JOIN oauth_tokens o ON o.user_id=u.id AND o.provider='google' WHERE u.id=?").bind(userId).first();
  return { connected: Boolean(row?.scope), email: row?.email || null, name: row?.name || null, picture: row?.picture || null };
}

async function ensureFolder(accessToken, folderName) {
  const q = `name='${folderName.replaceAll("'", "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const find = await fetch(`${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=files(id,name)&spaces=drive`, { headers: { authorization: `Bearer ${accessToken}` } });
  if (find.ok) {
    const data = await find.json();
    if (data.files?.[0]?.id) return data.files[0].id;
  }
  const create = await fetch(`${DRIVE_API}/files?fields=id`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ name: folderName, mimeType: "application/vnd.google-apps.folder" })
  });
  if (!create.ok) throw new Error(`Gagal membuat folder Drive: ${await create.text()}`);
  return (await create.json()).id;
}

export async function archiveR2ToDrive(env, userId, { r2Key, fileName, mimeType = "video/mp4" }) {
  const object = await env.STORAGE_V2.get(r2Key);
  if (!object) throw new Error("File R2 tidak ditemukan.");
  const accessToken = await getToken(env, userId);
  const folderId = await ensureFolder(accessToken, env.GOOGLE_DRIVE_FOLDER || "VIDGEN");

  const init = await fetch(`${DRIVE_UPLOAD}?uploadType=resumable&fields=id,name,webViewLink,size`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json; charset=UTF-8",
      "x-upload-content-type": mimeType,
      "x-upload-content-length": String(object.size)
    },
    body: JSON.stringify({ name: fileName, parents: [folderId] })
  });
  if (!init.ok) throw new Error(`Drive resumable init gagal: ${await init.text()}`);
  const location = init.headers.get("location");
  if (!location) throw new Error("Google Drive tidak mengembalikan resumable upload URL.");
  const upload = await fetch(location, {
    method: "PUT",
    headers: { "content-type": mimeType, "content-length": String(object.size) },
    body: object.body
  });
  if (!upload.ok) throw new Error(`Upload Google Drive gagal: ${await upload.text()}`);
  return { ...(await upload.json()), folderId };
}
