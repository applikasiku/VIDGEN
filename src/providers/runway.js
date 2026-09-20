export async function createRunwayVideo(env, scene) {
  // Keamanan V1: adapter disiapkan, tetapi endpoint/model Runway dibuat configurable
  // agar mudah disesuaikan dengan model yang aktif pada akun developer pengguna.
  if (!env.RUNWAY_API_KEY) {
    return { demo: true, provider: "runway", taskId: `demo_runway_${crypto.randomUUID()}` };
  }
  if (!env.RUNWAY_API_BASE) {
    return { demo: true, configuredKey: true, provider: "runway", taskId: `demo_runway_${crypto.randomUUID()}`, note: "Set RUNWAY_API_BASE untuk mengaktifkan request nyata." };
  }
  const res = await fetch(`${env.RUNWAY_API_BASE.replace(/\/$/, "")}/video`, {
    method: "POST",
    headers: { "authorization": `Bearer ${env.RUNWAY_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify(scene)
  });
  if (!res.ok) throw new Error(`Runway ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return { provider: "runway", taskId: data.id || data.task_id, raw: data };
}
