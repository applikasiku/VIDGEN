export async function createLumaVideo(env, scene, callbackUrl) {
  if (!env.LUMA_API_KEY) return { demo: true, provider: "luma", taskId: `demo_luma_${crypto.randomUUID()}` };
  const body = {
    prompt: scene.prompt,
    model: env.LUMA_MODEL || "ray-2",
    aspect_ratio: scene.aspectRatio || "16:9",
    duration: `${scene.duration || 5}s`,
    callback_url: callbackUrl
  };
  if (scene.referenceUrl) body.keyframes = { frame0: { type: "image", url: scene.referenceUrl } };
  const res = await fetch("https://api.lumalabs.ai/dream-machine/v1/generations", {
    method: "POST",
    headers: {
      "authorization": `Bearer ${env.LUMA_API_KEY}`,
      "content-type": "application/json",
      "accept": "application/json"
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`Luma ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return { provider: "luma", taskId: data.id, raw: data };
}
