function veoDuration(value) {
  const n = Number(value || 8);
  if (n <= 4) return 4;
  if (n <= 6) return 6;
  return 8;
}

export async function createVeoVideo(env, scene) {
  if (!env.VEO_ACCESS_TOKEN || !env.VEO_PROJECT_ID) {
    return { demo: true, provider: "veo", taskId: `demo_veo_${crypto.randomUUID()}` };
  }
  const location = env.VEO_LOCATION || "us-central1";
  const model = env.VEO_MODEL || "veo-3.1-generate-001";
  const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${env.VEO_PROJECT_ID}/locations/${location}/publishers/google/models/${model}:predictLongRunning`;
  const instance = { prompt: scene.prompt };
  if (scene.referenceBase64 && scene.referenceMimeType && ["image/jpeg","image/png"].includes(scene.referenceMimeType)) {
    instance.image = { bytesBase64Encoded: scene.referenceBase64, mimeType: scene.referenceMimeType };
  }
  const body = {
    instances: [instance],
    parameters: {
      aspectRatio: scene.aspectRatio || "16:9",
      resolution: scene.resolution === "4K" ? "1080p" : (scene.resolution || "720p"),
      durationSeconds: veoDuration(scene.duration),
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
