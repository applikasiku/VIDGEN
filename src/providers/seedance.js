export async function createSeedanceVideo(env, scene) {
  // Seedance endpoints/models may differ by Volcengine/BytePlus account and region.
  // Configure SEEDANCE_API_BASE to the exact official endpoint enabled for your account.
  if (!env.SEEDANCE_API_KEY || !env.SEEDANCE_API_BASE) {
    return { demo: true, provider: "seedance", taskId: `demo_seedance_${crypto.randomUUID()}` };
  }
  const endpoint = `${env.SEEDANCE_API_BASE.replace(/\/$/, "")}/video/generations`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "authorization": `Bearer ${env.SEEDANCE_API_KEY}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: env.SEEDANCE_MODEL || "doubao-seedance-1-5-pro-251215",
      prompt: scene.prompt,
      aspect_ratio: scene.aspectRatio || "16:9",
      duration: scene.duration || 5,
      resolution: scene.resolution || "1080p"
    })
  });
  if (!res.ok) throw new Error(`Seedance ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return { provider: "seedance", taskId: data.task_id || data.id, raw: data };
}
