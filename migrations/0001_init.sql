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
