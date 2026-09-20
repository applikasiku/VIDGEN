import { json, uid, ensureSession, safeText, sessionCookie } from "./utils.js";
import { providerCatalog, pickProvider } from "./providers/router.js";
import { createLumaVideo } from "./providers/luma.js";
import { createSeedanceVideo } from "./providers/seedance.js";
import { createRunwayVideo } from "./providers/runway.js";
import { createVeoVideo } from "./providers/veo.js";
import { googleAuthStart, googleAuthCallback, driveStatus, archiveR2ToDrive } from "./drive.js";

let schemaReadyPromise;

async function ensureSchema(env) {
  if (!schemaReadyPromise) {
    schemaReadyPromise = env.DB.exec(`
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
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_scenes_project ON scenes(project_id, scene_index);
      CREATE INDEX IF NOT EXISTS idx_jobs_project ON jobs(project_id, created_at DESC);
    `).catch((error) => {
      schemaReadyPromise = null;
      throw error;
    });
  }
  return schemaReadyPromise;
}

function withSession(response, session) {
  if (session.cookie) response.headers.append("set-cookie", session.cookie);
  return response;
}

async function bodyJson(request) {
  try { return await request.json(); } catch { return {}; }
}

function storyboardFrom(body) {
  const count = Math.min(30, Math.max(4, Number(body.sceneCount || 8)));
  const duration = Math.min(10, Math.max(4, Number(body.sceneDuration || 8)));
  const style = safeText(body.style || "cinematic", 80);
  const genre = safeText(body.genre || "music video", 120);
  const concept = safeText(body.concept || "cinematic performance and storytelling", 1000);
  const labels = ["Intro", "Verse 1", "Build", "Chorus", "Verse 2", "Transition", "Bridge", "Final Chorus", "Outro"];
  return Array.from({ length: count }, (_, i) => ({
    id: uid("scn"),
    index: i,
    title: labels[Math.min(labels.length - 1, Math.floor(i * labels.length / count))],
    start: i * duration,
    duration,
    prompt: `${concept}. ${labels[Math.min(labels.length - 1, Math.floor(i * labels.length / count))]}. ${genre}. ${style} music video, coherent character identity, consistent wardrobe, cinematic lighting, intentional camera movement, no text or watermark.`
  }));
}

async function createProviderTask(env, provider, scene, request) {
  const payload = {
    prompt: scene.prompt,
    duration: scene.duration,
    aspectRatio: scene.aspectRatio,
    resolution: scene.resolution
  };
  if (provider === "luma") return createLumaVideo(env, payload, `${new URL(request.url).origin}/api/webhooks/luma`);
  if (provider === "seedance") return createSeedanceVideo(env, payload);
  if (provider === "runway") return createRunwayVideo(env, payload);
  if (provider === "veo") return createVeoVideo(env, payload);
  throw new Error(`Provider tidak didukung: ${provider}`);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/") && !url.pathname.startsWith("/oauth/")) return env.ASSETS.fetch(request);

    // Health check must not depend on D1/session state so Cloudflare can verify the Worker
    // immediately after the first deployment, before migrations are applied.
    if (url.pathname === "/api/health") {
      return json({
        ok: true,
        app: env.APP_NAME || "VIDGEN",
        version: env.APP_VERSION || "1.0.2",
        runtime: "cloudflare-workers",
        time: new Date().toISOString()
      });
    }

    await ensureSchema(env);

    // Provider callbacks are server-to-server and do not need a browser session.
    if (url.pathname === "/api/webhooks/luma" && request.method === "POST") {
      try {
        const b = await bodyJson(request);
        const providerId = b.id || b.generation_id;
        if (providerId) {
          const state = b.state || b.status || "updated";
          const progress = state === "completed" ? 100 : state === "failed" ? 0 : 50;
          await env.DB.prepare("UPDATE jobs SET status=?,progress=?,result_json=?,updated_at=CURRENT_TIMESTAMP WHERE provider_job_id=?")
            .bind(state, progress, JSON.stringify(b), providerId).run();
        }
        return json({ ok: true });
      } catch (error) {
        return json({ error: String(error.message || error) }, 500);
      }
    }

    const session = await ensureSession(request, env);

    try {
      if (url.pathname === "/api/bootstrap") {
        const drive = await driveStatus(env, session.id);
        const providers = providerCatalog(env);
        const projects = await env.DB.prepare("SELECT id,title,status,aspect_ratio,resolution,created_at FROM projects WHERE user_id=? ORDER BY created_at DESC LIMIT 12").bind(session.id).all();
        return withSession(json({ mode: "cloudflare", providers, drive, projects: projects.results || [] }), session);
      }
      if (url.pathname === "/api/storyboard" && request.method === "POST") {
        const body = await bodyJson(request);
        return withSession(json({ scenes: storyboardFrom(body) }), session);
      }
      if (url.pathname === "/api/projects" && request.method === "POST") {
        const b = await bodyJson(request);
        const id = uid("prj");
        await env.DB.prepare(`INSERT INTO projects (id,user_id,title,genre,concept,duration_seconds,style,aspect_ratio,resolution,router_mode,router_priority,save_to_drive,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .bind(id, session.id, safeText(b.title || "Untitled", 160), safeText(b.genre, 160), safeText(b.concept, 2000), Number(b.duration || 0), safeText(b.style || "cinematic", 50), safeText(b.aspectRatio || "16:9", 10), safeText(b.resolution || "1080p", 20), safeText(b.vendor || "auto", 40), safeText(b.priority || "quality", 40), b.saveToDrive === false ? 0 : 1, "draft").run();
        for (const [i, s] of (b.scenes || []).entries()) {
          await env.DB.prepare(`INSERT INTO scenes (id,project_id,scene_index,title,prompt,start_seconds,duration_seconds,vendor,status) VALUES (?,?,?,?,?,?,?,?,?)`)
            .bind(s.id || uid("scn"), id, i, safeText(s.title, 160), safeText(s.prompt, 5000), Number(s.start || 0), Number(s.duration || 8), safeText(s.vendor || "auto", 40), "draft").run();
        }
        return withSession(json({ ok: true, id }, 201), session);
      }
      if (url.pathname === "/api/generate" && request.method === "POST") {
        const b = await bodyJson(request);
        const projectId = safeText(b.projectId, 100);
        const project = await env.DB.prepare("SELECT * FROM projects WHERE id=? AND user_id=?").bind(projectId, session.id).first();
        if (!project) return withSession(json({ error: "Project tidak ditemukan." }, 404), session);
        const scenes = (await env.DB.prepare("SELECT * FROM scenes WHERE project_id=? ORDER BY scene_index").bind(projectId).all()).results || [];
        const created = [];
        for (const s of scenes.slice(0, 30)) {
          const provider = pickProvider({ vendor: project.router_mode, priority: project.router_priority, sceneIndex: s.scene_index });
          const jobId = uid("job");
          const scene = { prompt: s.prompt, duration: s.duration_seconds, aspectRatio: project.aspect_ratio, resolution: project.resolution };
          try {
            const result = await createProviderTask(env, provider, scene, request);
            await env.DB.prepare("INSERT INTO jobs (id,project_id,job_type,provider,provider_job_id,status,progress,payload_json,result_json) VALUES (?,?,?,?,?,?,?,?,?)")
              .bind(jobId, projectId, "scene_generation", provider, result.taskId || null, result.demo ? "demo" : "submitted", result.demo ? 18 : 5, JSON.stringify(scene), JSON.stringify(result)).run();
            await env.DB.prepare("UPDATE scenes SET vendor=?,provider_job_id=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
              .bind(provider, result.taskId || null, result.demo ? "demo" : "submitted", s.id).run();
            created.push({ jobId, sceneId: s.id, provider, taskId: result.taskId, demo: Boolean(result.demo) });
          } catch (error) {
            await env.DB.prepare("INSERT INTO jobs (id,project_id,job_type,provider,status,progress,error_message,payload_json) VALUES (?,?,?,?,?,?,?,?)")
              .bind(jobId, projectId, "scene_generation", provider, "failed", 0, String(error.message || error), JSON.stringify(scene)).run();
            created.push({ jobId, sceneId: s.id, provider, error: String(error.message || error) });
          }
        }
        await env.DB.prepare("UPDATE projects SET status='rendering',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(projectId).run();
        return withSession(json({ ok: true, jobs: created }), session);
      }
      if (url.pathname === "/api/jobs") {
        const projectId = url.searchParams.get("projectId") || "";
        const rows = await env.DB.prepare("SELECT j.* FROM jobs j JOIN projects p ON p.id=j.project_id WHERE j.project_id=? AND p.user_id=? ORDER BY j.created_at DESC").bind(projectId, session.id).all();
        return withSession(json({ jobs: rows.results || [] }), session);
      }
      if (url.pathname === "/api/storage/upload" && request.method === "POST") {
        const contentType = request.headers.get("content-type") || "application/octet-stream";
        const name = safeText(url.searchParams.get("name") || `upload-${Date.now()}`, 180).replace(/[^a-zA-Z0-9._-]/g, "-");
        const key = `${session.id}/uploads/${Date.now()}-${name}`;
        await env.MEDIA.put(key, request.body, { httpMetadata: { contentType } });
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
      return withSession(json({ error: String(error.message || error), stack: env.APP_ENV === "development" ? error.stack : undefined }, 500), session);
    }
  }
};
