const ROUTES = {
  quality: ["seedance", "google", "runway", "luma"],
  balanced: ["seedance", "runway", "google", "luma"],
  speed: ["runway", "luma", "seedance", "google"],
  cost: ["luma", "seedance", "runway", "google"]
};

export function providerCandidates({ vendor = "auto", priority = "quality", sceneIndex = 0, fallback = true }) {
  const route = ROUTES[priority] || ROUTES.quality;
  if (vendor && vendor !== "auto") {
    if (!fallback) return [vendor];
    return [vendor, ...route.filter(v => v !== vendor)];
  }
  if (!fallback) return [route[sceneIndex % route.length]];
  const offset = sceneIndex % route.length;
  return [...route.slice(offset), ...route.slice(0, offset)];
}

export function pickProvider({ vendor = "auto", priority = "quality", sceneIndex = 0 }) {
  return providerCandidates({ vendor, priority, sceneIndex, fallback: false })[0];
}

export function providerCatalog(env) {
  return [
    { id: "seedance", name: "Seedance", model: env.SEEDANCE_MODEL || "configurable", configured: Boolean(env.SEEDANCE_API_KEY), strengths: ["music video", "multimodal", "character/action"] },
    { id: "google", name: "Google AI", model: env.GOOGLE_AI_DEFAULT_MODEL || "veo-3.1-generate-preview", configured: Boolean(env.GOOGLE_AI_API_KEY), strengths: ["Veo Quality", "Veo Fast", "Veo Lite", "Omni Flash"] },
    { id: "runway", name: "Runway", model: "configurable", configured: Boolean(env.RUNWAY_API_KEY), strengths: ["creative control", "image-to-video", "workflow"] },
    { id: "luma", name: "Luma", model: env.LUMA_MODEL || "ray-2", configured: Boolean(env.LUMA_API_KEY), strengths: ["speed", "camera motion", "image-to-video"] }
  ];
}
