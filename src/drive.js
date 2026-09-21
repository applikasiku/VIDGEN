import { makeState, verifyState } from "./utils.js";

const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";

export async function googleAuthStart(request, env, userId) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.SESSION_SECRET) {
    throw new Error("Google OAuth belum lengkap. Isi GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, dan SESSION_SECRET di Cloudflare Secrets.");
  }
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
  const oauthError = url.searchParams.get("error");
  if (oauthError) throw new Error(`Google OAuth dibatalkan/gagal: ${oauthError}`);
  const code = url.searchParams.get("code");
  const userId = await verifyState(url.searchParams.get("state") || "", env);
  if (!code || !userId) throw new Error("OAuth state tidak valid atau kedaluwarsa.");
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
  const row = await env.DATABASE_V2.prepare("SELECT u.email,u.name,u.picture,o.scope,o.expires_at FROM users u LEFT JOIN oauth_tokens o ON o.user_id=u.id AND o.provider='google' WHERE u.id=?").bind(userId).first();
  return {
    configured: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.SESSION_SECRET),
    connected: Boolean(row?.scope),
    email: row?.email || null,
    name: row?.name || null,
    picture: row?.picture || null,
    scope: row?.scope || null,
    tokenExpiresAt: row?.expires_at || null,
    folderName: env.GOOGLE_DRIVE_FOLDER || "VIDGEN"
  };
}

export async function disconnectDrive(env, userId) {
  await env.DATABASE_V2.prepare("DELETE FROM oauth_tokens WHERE user_id=? AND provider='google'").bind(userId).run();
  return { ok: true };
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

async function assertOwnedR2Key(env, userId, r2Key) {
  if (!r2Key) throw Object.assign(new Error("R2 key kosong."), { status: 400 });
  if (r2Key.startsWith(`${userId}/`)) return true;

  const scene = await env.DATABASE_V2.prepare(
    "SELECT s.id FROM scenes s JOIN projects p ON p.id=s.project_id WHERE p.user_id=? AND s.output_r2_key=? LIMIT 1"
  ).bind(userId, r2Key).first();
  if (scene) return true;

  const project = await env.DATABASE_V2.prepare(
    "SELECT id FROM projects WHERE user_id=? AND (audio_r2_key=? OR final_r2_key=?) LIMIT 1"
  ).bind(userId, r2Key, r2Key).first();
  if (project) return true;

  const asset = await env.DATABASE_V2.prepare(
    "SELECT id FROM assets WHERE user_id=? AND r2_key=? LIMIT 1"
  ).bind(userId, r2Key).first();
  if (asset) return true;

  throw Object.assign(new Error("File R2 bukan milik sesi ini."), { status: 403 });
}

async function ensureSubfolder(accessToken, parentId, folderName) {
  const escaped = folderName.replaceAll("'", "\\'");
  const q = `name='${escaped}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`;
  const find = await fetch(`${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=files(id,name)&spaces=drive`, {
    headers: { authorization: `Bearer ${accessToken}` }
  });
  if (find.ok) {
    const data = await find.json();
    if (data.files?.[0]?.id) return data.files[0].id;
  }
  const create = await fetch(`${DRIVE_API}/files?fields=id,name,webViewLink`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ name: folderName, mimeType: "application/vnd.google-apps.folder", parents: [parentId] })
  });
  if (!create.ok) throw new Error(`Gagal membuat subfolder Drive: ${await create.text()}`);
  return (await create.json()).id;
}

async function uploadObjectToDrive(accessToken, object, { fileName, mimeType, parentId }) {
  const init = await fetch(`${DRIVE_UPLOAD}?uploadType=resumable&fields=id,name,webViewLink,size`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json; charset=UTF-8",
      "x-upload-content-type": mimeType,
      "x-upload-content-length": String(object.size)
    },
    body: JSON.stringify({ name: fileName, parents: [parentId] })
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
  return upload.json();
}

export async function testDrive(env, userId) {
  const accessToken = await getToken(env, userId);
  const folderId = await ensureFolder(accessToken, env.GOOGLE_DRIVE_FOLDER || "VIDGEN");
  return { ok: true, folderId, folderName: env.GOOGLE_DRIVE_FOLDER || "VIDGEN" };
}

export async function archiveR2ToDrive(env, userId, { r2Key, fileName, mimeType = "video/mp4", projectFolder = null }) {
  await assertOwnedR2Key(env, userId, r2Key);
  const object = await env.STORAGE_V2.get(r2Key);
  if (!object) throw new Error("File R2 tidak ditemukan.");

  const accessToken = await getToken(env, userId);
  const rootFolderId = await ensureFolder(accessToken, env.GOOGLE_DRIVE_FOLDER || "VIDGEN");
  const parentId = projectFolder ? await ensureSubfolder(accessToken, rootFolderId, projectFolder) : rootFolderId;
  const uploaded = await uploadObjectToDrive(accessToken, object, { fileName, mimeType, parentId });
  return { ...uploaded, folderId: parentId, rootFolderId };
}

export async function archiveSceneToDrive(env, userId, { projectId, sceneId }) {
  const row = await env.DATABASE_V2.prepare(
    `SELECT s.id,s.scene_index,s.title,s.output_r2_key,s.drive_file_id,s.drive_web_view_link,
            p.title AS project_title
       FROM scenes s
       JOIN projects p ON p.id=s.project_id
      WHERE s.id=? AND s.project_id=? AND p.user_id=?
      LIMIT 1`
  ).bind(sceneId, projectId, userId).first();

  if (!row) throw Object.assign(new Error("Scene tidak ditemukan."), { status: 404 });
  if (!row.output_r2_key) throw Object.assign(new Error("Scene belum memiliki output video."), { status: 400 });

  if (row.drive_file_id) {
    return {
      id: row.drive_file_id,
      webViewLink: row.drive_web_view_link || null,
      alreadyArchived: true
    };
  }

  const safeProject = String(row.project_title || "Project").replace(/[\\/:*?"<>|]+/g, "-").trim().slice(0, 80) || "Project";
  const sceneNo = String(Number(row.scene_index || 0) + 1).padStart(2, "0");
  const safeScene = String(row.title || `Scene ${sceneNo}`).replace(/[\\/:*?"<>|]+/g, "-").trim().slice(0, 80) || `Scene ${sceneNo}`;
  const result = await archiveR2ToDrive(env, userId, {
    r2Key: row.output_r2_key,
    fileName: `${sceneNo} - ${safeScene}.mp4`,
    mimeType: "video/mp4",
    projectFolder: safeProject
  });

  await env.DATABASE_V2.prepare(
    "UPDATE scenes SET drive_file_id=?,drive_web_view_link=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND project_id=?"
  ).bind(result.id || null, result.webViewLink || null, sceneId, projectId).run();

  return result;
}
