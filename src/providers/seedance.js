function tasksEndpoint(env) {
  const raw = (env.SEEDANCE_API_BASE || "https://operator.las.ap-southeast-1.bytepluses.com").replace(/\/$/, "");
  if (raw.endsWith("/contents/generations/tasks")) return raw;
  if (raw.endsWith("/api/v1")) return raw + "/contents/generations/tasks";
  return raw + "/api/v1/contents/generations/tasks";
}

export async function createSeedanceVideo(env, scene) {
  if (!env.SEEDANCE_API_KEY) {
    return { demo: true, provider: "seedance", taskId: `demo_seedance_${crypto.randomUUID()}` };
  }
  const content = [{ type: "text", text: scene.prompt }];
  if (scene.referenceUrl) {
    content.push({
      type: "image_url",
      image_url: { url: scene.referenceUrl },
      role: "reference_image"
    });
  }
  const requestedResolution = scene.referenceUrl && scene.resolution === "1080p" ? "720p" : (scene.resolution || "720p");
  const res = await fetch(tasksEndpoint(env), {
    method: "POST",
    headers: {
      "authorization": `Bearer ${env.SEEDANCE_API_KEY}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: env.SEEDANCE_MODEL || "dreamina-seedance-2-0-260128",
      content,
      ratio: scene.aspectRatio || "16:9",
      duration: Math.max(4, Math.min(15, Number(scene.duration || 5))),
      resolution: requestedResolution,
      generate_audio: false,
      watermark: false
    })
  });
  if (!res.ok) throw new Error(`Seedance ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return { provider: "seedance", taskId: data.id, raw: data };
}
