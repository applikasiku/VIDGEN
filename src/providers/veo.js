export async function createVeoVideo(env, scene) {
  if (!env.VEO_ACCESS_TOKEN || !env.VEO_PROJECT_ID) {
    return { demo: true, provider: "veo", taskId: `demo_veo_${crypto.randomUUID()}` };
  }
  const location = env.VEO_LOCATION || "us-central1";
  const model = env.VEO_MODEL || "veo-3.1-generate-001";
  const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${env.VEO_PROJECT_ID}/locations/${location}/publishers/google/models/${model}:predictLongRunning`;
  const body = {
    instances: [{ prompt: scene.prompt }],
    parameters: {
      aspectRatio: scene.aspectRatio || "16:9",
      resolution: (scene.resolution || "1080p").replace("p", ""),
      durationSeconds: scene.duration || 8,
      sampleCount: 1
    }
  };
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "authorization": `Bearer ${env.VEO_ACCESS_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`Veo ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return { provider: "veo", taskId: data.name, raw: data };
}
