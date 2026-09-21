function runwayRatio(ratio="16:9", hasImage=false) {
  if (ratio === "9:16") return "720:1280";
  if (ratio === "1:1") return hasImage ? "960:960" : "1280:720";
  return "1280:720";
}

export async function createRunwayVideo(env, scene) {
  if (!env.RUNWAY_API_KEY) {
    return { demo: true, provider: "runway", taskId: `demo_runway_${crypto.randomUUID()}` };
  }
  const base = (env.RUNWAY_API_BASE || "https://api.dev.runwayml.com/v1").replace(/\/$/, "");
  const hasImage = Boolean(scene.referenceUrl);
  const body = {
    model: env.RUNWAY_MODEL || "gen4.5",
    promptText: scene.prompt,
    ratio: runwayRatio(scene.aspectRatio, hasImage),
    duration: Number(scene.duration || 5) >= 8 ? 10 : 5
  };
  if (scene.referenceUrl) body.promptImage = scene.referenceUrl;
  const res = await fetch(`${base}/image_to_video`, {
    method: "POST",
    headers: {
      "authorization": `Bearer ${env.RUNWAY_API_KEY}`,
      "content-type": "application/json",
      "X-Runway-Version": "2024-11-06"
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`Runway ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return { provider: "runway", taskId: data.id, raw: data };
}
