import { json, uid, ensureSession, safeText, sessionCookie } from "./utils.js";
import { providerCatalog, providerCandidates } from "./providers/router.js";
import { createLumaVideo } from "./providers/luma.js";
import { createSeedanceVideo } from "./providers/seedance.js";
import { createRunwayVideo } from "./providers/runway.js";
import { createVeoVideo } from "./providers/veo.js";
import { pollProvider, normalizeProviderPayload } from "./providers/status.js";
import { googleAuthStart, googleAuthCallback, driveStatus, archiveR2ToDrive } from "./drive.js";

let schemaReady = false;

async function ensureSchema(env) {
  if (!schemaReady) {
    const schema = `
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT,
        name TEXT,
        picture TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS oauth_tokens (
        user_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        access_token TEXT NOT NULL,
        refresh_token TEXT,
        expires_at INTEGER,
        scope TEXT,
        token_type TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, provider),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        genre TEXT,
        concept TEXT,
        audio_name TEXT,
        audio_r2_key TEXT,
        duration_seconds REAL DEFAULT 0,
        style TEXT DEFAULT 'cinematic',
        aspect_ratio TEXT DEFAULT '16:9',
        resolution TEXT DEFAULT '1080p',
        router_mode TEXT DEFAULT 'auto',
        router_priority TEXT DEFAULT 'quality',
        save_to_drive INTEGER DEFAULT 1,
        drive_folder_id TEXT,
        final_r2_key TEXT,
        final_drive_file_id TEXT,
        status TEXT DEFAULT 'draft',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS scenes (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        scene_index INTEGER NOT NULL,
        title TEXT,
        prompt TEXT NOT NULL,
        start_seconds REAL DEFAULT 0,
        duration_seconds REAL DEFAULT 8,
        vendor TEXT DEFAULT 'auto',
        provider_job_id TEXT,
        output_r2_key TEXT,
        status TEXT DEFAULT 'draft',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        scene_id TEXT,
        job_type TEXT NOT NULL,
        provider TEXT,
        provider_job_id TEXT,
        status TEXT NOT NULL DEFAULT 'queued',
        progress INTEGER NOT NULL DEFAULT 0,
        error_message TEXT,
        payload_json TEXT,
        result_json TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (scene_id) REFERENCES scenes(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS assets (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'reference',
        name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        r2_key TEXT NOT NULL UNIQUE,
        size_bytes INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS project_assets (
        project_id TEXT NOT NULL,
        asset_id TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'reference',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (project_id, asset_id, role),
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS provider_media_tokens (\n        token TEXT PRIMARY KEY,\n        user_id TEXT NOT NULL,\n        r2_key TEXT NOT NULL,\n        mime_type TEXT NOT NULL,\n        expires_at TEXT NOT NULL,\n        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,\n        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE\n      );\n\n      CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_scenes_project ON scenes(project_id, scene_index);
      CREATE INDEX IF NOT EXISTS idx_jobs_project ON jobs(project_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_assets_user ON assets(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_project_assets_project ON project_assets(project_id, role);\n      CREATE INDEX IF NOT EXISTS idx_provider_media_expiry ON provider_media_tokens(expires_at);
    `;
    await env.DATABASE_V2.batch(schema.split(";").map(sql => sql.trim()).filter(Boolean).map(sql => env.DATABASE_V2.prepare(sql)));
    try { await env.DATABASE_V2.prepare("ALTER TABLE jobs ADD COLUMN scene_id TEXT").run(); } catch {}
    await env.DATABASE_V2.prepare("DELETE FROM provider_media_tokens WHERE expires_at <= CURRENT_TIMESTAMP").run();
    schemaReady = true;
  }
}

function withSession(response, session) {
  if (session?.cookie) response.headers.append("set-cookie", session.cookie);
  return response;
}

async function bodyJson(request) {
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return body;
  } catch { throw Object.assign(new Error("Permintaan JSON tidak valid."), { status: 400 }); }
}

function storyboardFrom(body) {
  const requestedCount = Number(body.sceneCount ?? 8);
  const requestedDuration = Number(body.sceneDuration ?? 8);
  if (!Number.isFinite(requestedCount) || !Number.isFinite(requestedDuration)) throw Object.assign(new Error("Jumlah dan durasi scene harus berupa angka."), { status: 400 });
  const count = Math.min(30, Math.max(4, Math.floor(requestedCount)));
  const duration = Math.min(10, Math.max(4, requestedDuration));
  const style = safeText(body.style || "cinematic", 80);
  const genre = safeText(body.genre || "music video", 120);
  const concept = safeText(body.concept || "cinematic performance and storytelling", 1000);
  const mood = safeText(body.mood || "dynamic", 80);
  const cameraPreference = safeText(body.camera || "mixed cinematic", 80);
  const referenceName = safeText(body.referenceName || "", 180);
  const beatSync = body.beatSync !== false;
  const lyricSync = body.lyricSync !== false;
  const consistency = body.consistency !== false;

  const labels = ["Intro","Verse 1","Build","Chorus","Verse 2","Transition","Bridge","Final Chorus","Outro"];
  const shots = ["wide establishing shot","medium performance shot","close-up portrait","tracking shot","low angle hero shot","over-the-shoulder shot","aerial or crane shot","intimate close-up"];
  const motions = ["slow dolly in","smooth lateral tracking","gentle handheld movement","slow orbit","push-in on the beat","controlled pull-back","static composition with subject motion","cinematic pan"];
  const lights = ["soft cinematic key light","neon rim light","golden hour glow","dramatic backlight","moody practical lighting","high contrast concert lighting","soft diffused daylight","volumetric atmospheric light"];

  return Array.from({ length: count }, (_, i) => {
    const progress = count <= 1 ? 0 : i / (count - 1);
    const title = labels[Math.min(labels.length - 1, Math.floor(progress * labels.length))];
    const shot = cameraPreference === "mixed cinematic" ? shots[i % shots.length] : cameraPreference;
    const motion = motions[(i + Math.floor(count / 3)) % motions.length];
    const lighting = lights[(i * 2) % lights.length];
    const sync = [
      beatSync ? "edit and camera movement synchronized to musical beat" : "",
      lyricSync ? "visual storytelling follows the lyrical emotion" : "",
      consistency ? "keep character identity, face, wardrobe and visual continuity consistent" : ""
    ].filter(Boolean).join(", ");
    const reference = referenceName ? `Use the selected reference image "${referenceName}" as visual identity/style guidance.` : "";
    const energy = progress < .2 ? "introductory and atmospheric" : progress < .45 ? "building energy" : progress < .75 ? "high emotional or performance energy" : "strong closing payoff";
    const prompt = `${concept}. ${title}. ${genre}. ${style} music video with ${mood} mood. ${shot}, ${motion}, ${lighting}. Scene energy: ${energy}. ${sync}. ${reference} cinematic composition, intentional subject movement, no text, no logo, no watermark.`.replace(/\s+/g, " ").trim();
    return { id: uid("scn"), index: i, title, start: i * duration, duration, shot, motion, lighting, prompt };
  });
}


function bytesToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let out = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) out += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(out);
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function prepareReference(env, projectId, userId, origin) {
  const asset = await env.DATABASE_V2.prepare(
    "SELECT a.* FROM project_assets pa JOIN assets a ON a.id=pa.asset_id WHERE pa.project_id=? AND pa.role='reference' AND a.user_id=? LIMIT 1"
  ).bind(projectId, userId).first();
  if (!asset) return null;

  const token = crypto.randomUUID();
  await env.DATABASE_V2.prepare(
    "INSERT INTO provider_media_tokens (token,user_id,r2_key,mime_type,expires_at) VALUES (?,?,?,?,datetime('now','+1 day'))"
  ).bind(token, userId, asset.r2_key, asset.mime_type).run();

  let referenceBase64 = null;
  if (["image/jpeg","image/png"].includes(asset.mime_type) && Number(asset.size_bytes || 0) <= 8 * 1024 * 1024) {
    const object = await env.STORAGE_V2.get(asset.r2_key);
    if (object) referenceBase64 = bytesToBase64(await object.arrayBuffer());
  }
  return {
    assetId: asset.id,
    name: asset.name,
    mimeType: asset.mime_type,
    url: `${origin}/provider-media/${token}`,
    base64: referenceBase64
  };
}

async function createProviderTask(env, provider, scene, request, reference = null) {
  const payload = {
    prompt: scene.prompt,
    duration: scene.duration,
    aspectRatio: scene.aspectRatio,
    resolution: scene.resolution,
    referenceUrl: reference?.url || null,
    referenceBase64: reference?.base64 || null,
    referenceMimeType: reference?.mimeType || null
  };
  if (provider === "luma") return createLumaVideo(env, payload, `${new URL(request.url).origin}/api/webhooks/luma`);
  if (provider === "seedance") return createSeedanceVideo(env, payload);
  if (provider === "runway") return createRunwayVideo(env, payload);
  if (provider === "veo") return createVeoVideo(env, payload);
  throw new Error(`Provider tidak didukung: ${provider}`);
}

async function persistProviderOutput(env, projectId, sceneId, provider, normalized) {
  if (!normalized || normalized.status !== "completed") return null;
  const key = `renders/${projectId}/${sceneId}/${Date.now()}-${provider}.mp4`;
  const mimeType = normalized.mimeType || "video/mp4";

  if (normalized.outputBase64) {
    const bytes = base64ToBytes(normalized.outputBase64);
    await env.STORAGE_V2.put(key, bytes, { httpMetadata: { contentType: mimeType } });
  } else if (normalized.outputUrl && /^https:\/\//i.test(normalized.outputUrl)) {
    const response = await fetch(normalized.outputUrl);
    if (!response.ok || !response.body) throw new Error(`Gagal mengambil output ${provider}: HTTP ${response.status}`);
    await env.STORAGE_V2.put(key, response.body, { httpMetadata: { contentType: response.headers.get("content-type") || mimeType } });
  } else if (normalized.outputGcsUri) {
    throw new Error("Veo mengembalikan GCS URI tanpa bytes. Hapus storageUri agar output dapat diarsipkan otomatis ke R2.");
  } else {
    throw new Error(`${provider} selesai tetapi URL/bytes output tidak ditemukan.`);
  }

  await env.DATABASE_V2.prepare(
    "UPDATE scenes SET output_r2_key=?,status='completed',updated_at=CURRENT_TIMESTAMP WHERE id=? AND project_id=?"
  ).bind(key, sceneId, projectId).run();
  return key;
}

async function submitSceneJob(env, project, scene, request, { vendor, fallback = true, reference = null } = {}) {
  const candidates = providerCandidates({
    vendor: vendor || project.router_mode || "auto",
    priority: project.router_priority || "quality",
    sceneIndex: Number(scene.scene_index || 0),
    fallback
  });
  const jobId = uid("job");
  const payload = {
    prompt: scene.prompt,
    duration: Number(scene.duration_seconds || 8),
    aspectRatio: project.aspect_ratio,
    resolution: project.resolution
  };
  const attempts = [];

  for (const provider of candidates) {
    try {
      const result = await createProviderTask(env, provider, payload, request, reference);
      const status = result.demo ? "demo" : "submitted";
      const progress = result.demo ? 32 : 5;
      await env.DATABASE_V2.prepare(
        "INSERT INTO jobs (id,project_id,scene_id,job_type,provider,provider_job_id,status,progress,payload_json,result_json) VALUES (?,?,?,?,?,?,?,?,?,?)"
      ).bind(jobId, project.id, scene.id, "scene_generation", provider, result.taskId || null, status, progress, JSON.stringify(payload), JSON.stringify({ ...result, attempts })).run();
      await env.DATABASE_V2.prepare(
        "UPDATE scenes SET vendor=?,provider_job_id=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?"
      ).bind(provider, result.taskId || null, status, scene.id).run();
      return { jobId, sceneId: scene.id, sceneIndex: scene.scene_index, provider, taskId: result.taskId, demo: Boolean(result.demo), status };
    } catch (error) {
      attempts.push({ provider, error: String(error.message || error) });
    }
  }

  const errorMessage = attempts.map(a => `${a.provider}: ${a.error}`).join(" | ") || "Tidak ada provider yang tersedia.";
  await env.DATABASE_V2.prepare(
    "INSERT INTO jobs (id,project_id,scene_id,job_type,provider,status,progress,error_message,payload_json,result_json) VALUES (?,?,?,?,?,?,?,?,?,?)"
  ).bind(jobId, project.id, scene.id, "scene_generation", candidates[0] || "auto", "failed", 0, errorMessage, JSON.stringify(payload), JSON.stringify({ attempts })).run();
  await env.DATABASE_V2.prepare("UPDATE scenes SET status='failed',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(scene.id).run();
  return { jobId, sceneId: scene.id, sceneIndex: scene.scene_index, provider: candidates[0] || "auto", error: errorMessage, status: "failed" };
}

async function applyNormalizedJob(env, job, normalized) {
  let status = normalized.status || "running";
  let errorMessage = normalized.error ? String(normalized.error) : null;
  let outputKey = null;

  if (status === "completed" && job.scene_id) {
    try {
      outputKey = await persistProviderOutput(env, job.project_id, job.scene_id, job.provider, normalized);
    } catch (error) {
      status = "failed";
      errorMessage = String(error.message || error);
      await env.DATABASE_V2.prepare("UPDATE scenes SET status='failed',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(job.scene_id).run();
    }
  } else if (status === "failed" && job.scene_id) {
    await env.DATABASE_V2.prepare("UPDATE scenes SET status='failed',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(job.scene_id).run();
  } else if (job.scene_id && ["queued","running","submitted"].includes(status)) {
    await env.DATABASE_V2.prepare("UPDATE scenes SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(status === "submitted" ? "queued" : status, job.scene_id).run();
  }

  await env.DATABASE_V2.prepare(
    "UPDATE jobs SET status=?,progress=?,error_message=?,result_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?"
  ).bind(status, Number(normalized.progress || 0), errorMessage, JSON.stringify(normalized.raw || normalized), job.id).run();
  return { status, outputKey, errorMessage };
}

async function syncProjectJobs(env, projectId, userId) {
  const active = await env.DATABASE_V2.prepare(
    "SELECT j.* FROM jobs j JOIN projects p ON p.id=j.project_id WHERE j.project_id=? AND p.user_id=? AND j.provider_job_id IS NOT NULL AND j.status IN ('queued','submitted','running','processing','dreaming') ORDER BY j.created_at ASC LIMIT 12"
  ).bind(projectId, userId).all();

  for (const job of active.results || []) {
    if (String(job.provider_job_id || "").startsWith("demo_")) continue;
    try {
      const normalized = await pollProvider(env, job.provider, job.provider_job_id);
      await applyNormalizedJob(env, job, normalized);
    } catch (error) {
      await env.DATABASE_V2.prepare(
        "UPDATE jobs SET error_message=?,updated_at=CURRENT_TIMESTAMP WHERE id=?"
      ).bind(String(error.message || error), job.id).run();
    }
  }

  const scenes = await env.DATABASE_V2.prepare(
    "SELECT id,scene_index,title,prompt,start_seconds,duration_seconds,vendor,provider_job_id,output_r2_key,status FROM scenes WHERE project_id=? ORDER BY scene_index"
  ).bind(projectId).all();
  const sceneRows = scenes.results || [];
  const jobs = await env.DATABASE_V2.prepare(
    "SELECT id,project_id,scene_id,job_type,provider,provider_job_id,status,progress,error_message,created_at,updated_at FROM jobs WHERE project_id=? ORDER BY created_at DESC"
  ).bind(projectId).all();
  const jobRows = jobs.results || [];
  const hasActive = jobRows.some(j => ["queued","submitted","running","processing","dreaming"].includes(j.status));
  const completed = sceneRows.length > 0 && sceneRows.every(s => s.output_r2_key && s.status === "completed");
  const anyDone = sceneRows.some(s => s.output_r2_key && s.status === "completed");
  const anyFailed = sceneRows.some(s => s.status === "failed");
  const projectStatus = hasActive ? "rendering" : completed ? "completed" : anyFailed && anyDone ? "partial" : anyFailed ? "failed" : "draft";
  await env.DATABASE_V2.prepare("UPDATE projects SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?").bind(projectStatus, projectId, userId).run();
  return { jobs: jobRows, scenes: sceneRows, projectStatus };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const isProviderMedia = url.pathname.startsWith("/provider-media/");
    if (!url.pathname.startsWith("/api/") && !url.pathname.startsWith("/oauth/") && !isProviderMedia) return env.ASSETS.fetch(request);

    // Health check must not depend on D1/session state so Cloudflare can verify the Worker
    // immediately after the first deployment, before migrations are applied.
    if (url.pathname === "/api/health") {
      return json({
        ok: true,
        app: env.APP_NAME || "VIDGEN",
        version: env.APP_VERSION || "1.4.0",
        runtime: "cloudflare-workers",
        time: new Date().toISOString()
      });
    }

    let session;
    try {
      await ensureSchema(env);

      if (isProviderMedia && request.method === "GET") {
        const token = safeText(url.pathname.split("/").pop(), 120);
        const row = await env.DATABASE_V2.prepare("SELECT r2_key,mime_type FROM provider_media_tokens WHERE token=? AND expires_at>CURRENT_TIMESTAMP").bind(token).first();
        if (!row) return new Response("Expired or invalid media token", { status: 404 });
        const object = await env.STORAGE_V2.get(row.r2_key);
        if (!object) return new Response("Media not found", { status: 404 });
        return new Response(object.body, { headers: { "content-type": row.mime_type || "application/octet-stream", "cache-control": "private, max-age=300" } });
      }

      // Provider callbacks are server-to-server and do not need a browser session.
      if (url.pathname === "/api/webhooks/luma" && request.method === "POST") {
        try {
          const b = await bodyJson(request);
          const providerId = b.id || b.generation_id;
          if (providerId) {
            const job = await env.DATABASE_V2.prepare("SELECT * FROM jobs WHERE provider='luma' AND provider_job_id=? ORDER BY created_at DESC LIMIT 1").bind(providerId).first();
            if (job) await applyNormalizedJob(env, job, normalizeProviderPayload("luma", b));
          }
          return json({ ok: true });
        } catch (error) {
          return json({ error: String(error.message || error) }, 500);
        }
      }

      session = await ensureSession(request, env);
      if (url.pathname === "/api/bootstrap") {
        const drive = await driveStatus(env, session.id);
        const providers = providerCatalog(env);
        const projects = await env.DATABASE_V2.prepare("SELECT id,title,genre,status,aspect_ratio,resolution,audio_name,duration_seconds,created_at,updated_at FROM projects WHERE user_id=? ORDER BY updated_at DESC LIMIT 24").bind(session.id).all();
        const assets = await env.DATABASE_V2.prepare("SELECT id,kind,name,mime_type,size_bytes,created_at FROM assets WHERE user_id=? ORDER BY created_at DESC LIMIT 60").bind(session.id).all();
        return withSession(json({ mode: "cloudflare", providers, drive, projects: projects.results || [], assets: assets.results || [] }), session);
      }
      if (url.pathname === "/api/storyboard" && request.method === "POST") {
        const body = await bodyJson(request);
        return withSession(json({ scenes: storyboardFrom(body) }), session);
      }
      if (url.pathname === "/api/audio/upload" && request.method === "POST") {
        const contentType = (request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
        const allowed = ["audio/mpeg","audio/mp3","audio/wav","audio/x-wav","audio/mp4","audio/x-m4a","audio/aac","audio/ogg"];
        if (!allowed.includes(contentType)) throw Object.assign(new Error("Audio harus MP3, WAV, M4A/AAC, atau OGG."), { status: 415 });
        const contentLength = Number(request.headers.get("content-length") || 0);
        if (contentLength > 50 * 1024 * 1024) throw Object.assign(new Error("Ukuran audio maksimal 50 MB."), { status: 413 });
        if (!request.body) throw Object.assign(new Error("File audio kosong."), { status: 400 });
        const rawName = safeText(url.searchParams.get("name") || "audio", 180);
        const name = rawName.replace(/[^a-zA-Z0-9._ -]/g, "-").replace(/\s+/g, " ").trim() || "audio";
        const safeName = name.replace(/\s+/g, "-");
        const key = `${session.id}/audio/${Date.now()}-${crypto.randomUUID()}-${safeName}`;
        await env.STORAGE_V2.put(key, request.body, { httpMetadata: { contentType } });
        return withSession(json({ ok: true, key, name, contentType }), session);
      }
      if (url.pathname === "/api/assets" && request.method === "GET") {
        const rows = await env.DATABASE_V2.prepare("SELECT id,kind,name,mime_type,size_bytes,created_at FROM assets WHERE user_id=? ORDER BY created_at DESC LIMIT 60").bind(session.id).all();
        return withSession(json({ assets: rows.results || [] }), session);
      }
      if (url.pathname === "/api/assets/upload" && request.method === "POST") {
        const contentType = (request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
        if (!["image/jpeg","image/png","image/webp"].includes(contentType)) throw Object.assign(new Error("Reference image harus JPG, PNG, atau WEBP."), { status: 415 });
        const bytes = await request.arrayBuffer();
        if (!bytes.byteLength) throw Object.assign(new Error("File kosong."), { status: 400 });
        if (bytes.byteLength > 10 * 1024 * 1024) throw Object.assign(new Error("Ukuran reference image maksimal 10 MB."), { status: 413 });
        const rawName = safeText(url.searchParams.get("name") || "reference-image", 180);
        const name = rawName.replace(/[^a-zA-Z0-9._ -]/g, "-").replace(/\s+/g, " ").trim() || "reference-image";
        const id = uid("ast");
        const safeName = name.replace(/\s+/g, "-");
        const key = `${session.id}/assets/${id}-${safeName}`;
        await env.STORAGE_V2.put(key, bytes, { httpMetadata: { contentType } });
        await env.DATABASE_V2.prepare("INSERT INTO assets (id,user_id,kind,name,mime_type,r2_key,size_bytes) VALUES (?,?,?,?,?,?,?)")
          .bind(id, session.id, "reference", name, contentType, key, bytes.byteLength).run();
        return withSession(json({ ok: true, asset: { id, kind: "reference", name, mime_type: contentType, size_bytes: bytes.byteLength, created_at: new Date().toISOString() } }, 201), session);
      }
      const assetMatch = url.pathname.match(/^\/api\/assets\/([^/]+)(?:\/(content))?$/);
      if (assetMatch) {
        const assetId = safeText(assetMatch[1], 120);
        const asset = await env.DATABASE_V2.prepare("SELECT * FROM assets WHERE id=? AND user_id=?").bind(assetId, session.id).first();
        if (!asset) return withSession(json({ error: "Aset tidak ditemukan." }, 404), session);
        if (assetMatch[2] === "content" && request.method === "GET") {
          const object = await env.STORAGE_V2.get(asset.r2_key);
          if (!object) return withSession(json({ error: "File aset tidak ditemukan di R2." }, 404), session);
          const headers = new Headers({ "content-type": asset.mime_type || "application/octet-stream", "cache-control": "private, max-age=300" });
          if (object.etag) headers.set("etag", object.etag);
          return withSession(new Response(object.body, { headers }), session);
        }
        if (!assetMatch[2] && request.method === "DELETE") {
          await env.STORAGE_V2.delete(asset.r2_key);
          await env.DATABASE_V2.prepare("DELETE FROM assets WHERE id=? AND user_id=?").bind(assetId, session.id).run();
          return withSession(json({ ok: true }), session);
        }
      }
      if (url.pathname === "/api/projects" && request.method === "POST") {
        const b = await bodyJson(request);
        if (!Array.isArray(b.scenes) || b.scenes.length > 30) throw Object.assign(new Error("Proyek harus berisi maksimal 30 scene."), { status: 400 });
        if (b.scenes.some(s => !s || typeof s !== "object" || !safeText(s.prompt) || !Number.isFinite(Number(s.duration)) || Number(s.duration) <= 0 || !Number.isFinite(Number(s.start || 0)))) throw Object.assign(new Error("Data scene tidak valid."), { status: 400 });
        if (!Number.isFinite(Number(b.duration || 0))) throw Object.assign(new Error("Durasi tidak valid."), { status: 400 });
        const id = uid("prj");
        const audioName = safeText(b.audioName, 180);
        const audioKey = safeText(b.audioR2Key, 700);
        const referenceAssetId = safeText(b.referenceAssetId, 120);
        const statements = [env.DATABASE_V2.prepare(`INSERT INTO projects (id,user_id,title,genre,concept,audio_name,audio_r2_key,duration_seconds,style,aspect_ratio,resolution,router_mode,router_priority,save_to_drive,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .bind(id, session.id, safeText(b.title || "Untitled", 160), safeText(b.genre, 160), safeText(b.concept, 2000), audioName || null, audioKey || null, Number(b.duration || 0), safeText(b.style || "cinematic", 50), safeText(b.aspectRatio || "16:9", 10), safeText(b.resolution || "1080p", 20), safeText(b.vendor || "auto", 40), safeText(b.priority || "quality", 40), b.saveToDrive === false ? 0 : 1, "draft")];
        for (const [i, s] of b.scenes.entries()) {
          statements.push(env.DATABASE_V2.prepare(`INSERT INTO scenes (id,project_id,scene_index,title,prompt,start_seconds,duration_seconds,vendor,status) VALUES (?,?,?,?,?,?,?,?,?)`)
            .bind(uid("scn"), id, i, safeText(s.title, 160), safeText(s.prompt, 5000), Number(s.start || 0), Number(s.duration || 8), safeText(s.vendor || "auto", 40), "draft"));
        }
        if (referenceAssetId) {
          statements.push(env.DATABASE_V2.prepare("INSERT OR IGNORE INTO project_assets (project_id,asset_id,role) SELECT ?,id,'reference' FROM assets WHERE id=? AND user_id=?")
            .bind(id, referenceAssetId, session.id));
        }
        await env.DATABASE_V2.batch(statements);
        return withSession(json({ ok: true, id }, 201), session);
      }

      const projectMatch = url.pathname.match(/^\/api\/projects\/([^/]+)(?:\/(audio))?$/);
      if (projectMatch) {
        const projectId = safeText(projectMatch[1], 120);
        const project = await env.DATABASE_V2.prepare("SELECT * FROM projects WHERE id=? AND user_id=?").bind(projectId, session.id).first();
        if (!project) return withSession(json({ error: "Project tidak ditemukan." }, 404), session);

        if (projectMatch[2] === "audio" && request.method === "GET") {
          if (!project.audio_r2_key) return withSession(json({ error: "Project tidak memiliki audio tersimpan." }, 404), session);
          const object = await env.STORAGE_V2.get(project.audio_r2_key);
          if (!object) return withSession(json({ error: "Audio tidak ditemukan di R2." }, 404), session);
          const headers = new Headers({
            "content-type": object.httpMetadata?.contentType || "audio/mpeg",
            "cache-control": "private, max-age=300",
            "accept-ranges": "bytes"
          });
          if (object.etag) headers.set("etag", object.etag);
          return withSession(new Response(object.body, { headers }), session);
        }

        if (!projectMatch[2] && request.method === "GET") {
          const scenes = await env.DATABASE_V2.prepare("SELECT * FROM scenes WHERE project_id=? ORDER BY scene_index").bind(projectId).all();
          const jobs = await env.DATABASE_V2.prepare("SELECT * FROM jobs WHERE project_id=? ORDER BY created_at DESC").bind(projectId).all();
          const reference = await env.DATABASE_V2.prepare("SELECT a.id,a.kind,a.name,a.mime_type,a.size_bytes,a.created_at FROM project_assets pa JOIN assets a ON a.id=pa.asset_id WHERE pa.project_id=? AND pa.role='reference' AND a.user_id=? LIMIT 1").bind(projectId, session.id).first();
          return withSession(json({ project, scenes: scenes.results || [], jobs: jobs.results || [], reference: reference || null }), session);
        }

        if (!projectMatch[2] && request.method === "PUT") {
          const b = await bodyJson(request);
          if (!Array.isArray(b.scenes) || b.scenes.length > 30) throw Object.assign(new Error("Proyek harus berisi maksimal 30 scene."), { status: 400 });
          if (b.scenes.some(s => !s || typeof s !== "object" || !safeText(s.prompt) || !Number.isFinite(Number(s.duration)) || Number(s.duration) <= 0 || !Number.isFinite(Number(s.start || 0)))) throw Object.assign(new Error("Data scene tidak valid."), { status: 400 });
          const audioName = safeText(b.audioName || project.audio_name, 180);
          const audioKey = safeText(b.audioR2Key || project.audio_r2_key, 700);
          const referenceAssetId = safeText(b.referenceAssetId, 120);
          const statements = [
            env.DATABASE_V2.prepare("UPDATE projects SET title=?,genre=?,concept=?,audio_name=?,audio_r2_key=?,duration_seconds=?,style=?,aspect_ratio=?,resolution=?,router_mode=?,router_priority=?,save_to_drive=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?")
              .bind(safeText(b.title || "Untitled",160),safeText(b.genre,160),safeText(b.concept,2000),audioName||null,audioKey||null,Number(b.duration||0),safeText(b.style||"cinematic",50),safeText(b.aspectRatio||"16:9",10),safeText(b.resolution||"1080p",20),safeText(b.vendor||"auto",40),safeText(b.priority||"quality",40),b.saveToDrive===false?0:1,projectId,session.id),
            env.DATABASE_V2.prepare("DELETE FROM scenes WHERE project_id=?").bind(projectId),
            env.DATABASE_V2.prepare("DELETE FROM project_assets WHERE project_id=? AND role='reference'").bind(projectId)
          ];
          for (const [i, s] of b.scenes.entries()) {
            statements.push(env.DATABASE_V2.prepare(`INSERT INTO scenes (id,project_id,scene_index,title,prompt,start_seconds,duration_seconds,vendor,status) VALUES (?,?,?,?,?,?,?,?,?)`)
              .bind(uid("scn"), projectId, i, safeText(s.title,160), safeText(s.prompt,5000), Number(s.start||0), Number(s.duration||8), safeText(s.vendor||"auto",40), "draft"));
          }
          if (referenceAssetId) {
            statements.push(env.DATABASE_V2.prepare("INSERT OR IGNORE INTO project_assets (project_id,asset_id,role) SELECT ?,id,'reference' FROM assets WHERE id=? AND user_id=?").bind(projectId,referenceAssetId,session.id));
          }
          await env.DATABASE_V2.batch(statements);
          return withSession(json({ ok: true, id: projectId }), session);
        }

        if (!projectMatch[2] && request.method === "DELETE") {
          await env.DATABASE_V2.prepare("DELETE FROM projects WHERE id=? AND user_id=?").bind(projectId, session.id).run();
          if (project.audio_r2_key) await env.STORAGE_V2.delete(project.audio_r2_key);
          return withSession(json({ ok: true }), session);
        }
      }

      if (url.pathname === "/api/generate" && request.method === "POST") {
        const b = await bodyJson(request);
        const projectId = safeText(b.projectId, 100);
        const project = await env.DATABASE_V2.prepare("SELECT * FROM projects WHERE id=? AND user_id=?").bind(projectId, session.id).first();
        if (!project) return withSession(json({ error: "Project tidak ditemukan." }, 404), session);
        const scenes = (await env.DATABASE_V2.prepare("SELECT * FROM scenes WHERE project_id=? ORDER BY scene_index").bind(projectId).all()).results || [];
        if (!scenes.length) return withSession(json({ error: "Proyek belum memiliki scene." }, 400), session);
        const created = [];
        for (const s of scenes.slice(0, 30)) {
          const provider = pickProvider({ vendor: project.router_mode, priority: project.router_priority, sceneIndex: s.scene_index });
          const jobId = uid("job");
          const scene = { prompt: s.prompt, duration: s.duration_seconds, aspectRatio: project.aspect_ratio, resolution: project.resolution };
          try {
            const result = await createProviderTask(env, provider, scene, request);
            await env.DATABASE_V2.prepare("INSERT INTO jobs (id,project_id,job_type,provider,provider_job_id,status,progress,payload_json,result_json) VALUES (?,?,?,?,?,?,?,?,?)")
              .bind(jobId, projectId, "scene_generation", provider, result.taskId || null, result.demo ? "demo" : "submitted", result.demo ? 18 : 5, JSON.stringify(scene), JSON.stringify(result)).run();
            await env.DATABASE_V2.prepare("UPDATE scenes SET vendor=?,provider_job_id=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
              .bind(provider, result.taskId || null, result.demo ? "demo" : "submitted", s.id).run();
            created.push({ jobId, sceneId: s.id, provider, taskId: result.taskId, demo: Boolean(result.demo) });
          } catch (error) {
            await env.DATABASE_V2.prepare("INSERT INTO jobs (id,project_id,job_type,provider,status,progress,error_message,payload_json) VALUES (?,?,?,?,?,?,?,?)")
              .bind(jobId, projectId, "scene_generation", provider, "failed", 0, String(error.message || error), JSON.stringify(scene)).run();
            created.push({ jobId, sceneId: s.id, provider, error: String(error.message || error) });
          }
        }
        const status = created.every(j => j.error) ? "failed" : created.every(j => j.demo) ? "demo" : "rendering";
        await env.DATABASE_V2.prepare("UPDATE projects SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(status, projectId).run();
        return withSession(json({ ok: true, jobs: created }), session);
      }
      if (url.pathname === "/api/jobs") {
        const projectId = url.searchParams.get("projectId") || "";
        const rows = await env.DATABASE_V2.prepare("SELECT j.* FROM jobs j JOIN projects p ON p.id=j.project_id WHERE j.project_id=? AND p.user_id=? ORDER BY j.created_at DESC").bind(projectId, session.id).all();
        return withSession(json({ jobs: rows.results || [] }), session);
      }
      if (url.pathname === "/api/storage/upload" && request.method === "POST") {
        const contentType = request.headers.get("content-type") || "application/octet-stream";
        const name = safeText(url.searchParams.get("name") || `upload-${Date.now()}`, 180).replace(/[^a-zA-Z0-9._-]/g, "-");
        const key = `${session.id}/uploads/${Date.now()}-${name}`;
        await env.STORAGE_V2.put(key, request.body, { httpMetadata: { contentType } });
        return withSession(json({ ok: true, key }), session);
      }
      if (url.pathname === "/api/drive/connect") {
        const authUrl = await googleAuthStart(request, env, session.id);
        return withSession(json({ authUrl }), session);
      }
      if (url.pathname === "/oauth/google/callback") {
        const userId = await googleAuthCallback(request, env);
        const headers = new Headers({ location: "/?drive=connected" });
        headers.append("set-cookie", sessionCookie(userId));
        return new Response(null, { status: 302, headers });
      }
      if (url.pathname === "/api/drive/archive" && request.method === "POST") {
        const b = await bodyJson(request);
        const result = await archiveR2ToDrive(env, session.id, { r2Key: safeText(b.r2Key, 500), fileName: safeText(b.fileName || "VIDGEN-output.mp4", 180), mimeType: safeText(b.mimeType || "video/mp4", 80) });
        return withSession(json({ ok: true, drive: result }), session);
      }
      return withSession(json({ error: "Not found" }, 404), session);
    } catch (error) {
      return withSession(json({ error: String(error.message || error), stack: env.APP_ENV === "development" ? error.stack : undefined }, error.status || 500), session);
    }
  }
};

