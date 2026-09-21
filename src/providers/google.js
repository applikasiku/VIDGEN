const GOOGLE_MODELS = new Set([
  "veo-3.1-generate-preview",
  "veo-3.1-fast-generate-preview",
  "veo-3.1-lite-generate-preview",
  "gemini-omni-1.1-flash"
]);

function cleanModel(value) {
  const model = String(value || "").trim();
  return GOOGLE_MODELS.has(model) ? model : "veo-3.1-generate-preview";
}

function omniResolution(value = "720p") {
  if (value === "4K") return "4k";
  if (["360p","720p","1080p"].includes(value)) return value;
  return "720p";
}

function findOmniVideo(data) {
  for (const step of data?.steps || []) {
    if (step?.type !== "model_output") continue;
    for (const content of step.content || []) {
      if (content?.type === "video" && content?.data) {
        return {
          data: content.data,
          mimeType: content.mime_type || "video/mp4"
        };
      }
    }
  }
  return null;
}

export function googleModelCatalog() {
  return [
    { id: "veo-3.1-generate-preview", label: "Veo 3.1 - Quality", mode: "veo" },
    { id: "veo-3.1-fast-generate-preview", label: "Veo 3.1 - Fast", mode: "veo" },
    { id: "veo-3.1-lite-generate-preview", label: "Veo 3.1 - Lite", mode: "veo" },
    { id: "gemini-omni-1.1-flash", label: "Omni 1.1 Flash", mode: "omni" }
  ];
}

export async function createGoogleVideo(env, scene) {
  if (!env.GOOGLE_AI_API_KEY) {
    return { demo: true, provider: "google", taskId: `demo_google_${crypto.randomUUID()}` };
  }

  const base = (env.GOOGLE_AI_API_BASE || "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");
  const model = cleanModel(scene.googleModel || env.GOOGLE_AI_DEFAULT_MODEL);

  if (model === "gemini-omni-1.1-flash") {
    const hasImage = Boolean(scene.referenceBase64 && scene.referenceMimeType);
    const input = hasImage
      ? [
          { type: "image", data: scene.referenceBase64, mime_type: scene.referenceMimeType },
          { type: "text", text: scene.prompt }
        ]
      : scene.prompt;

    const body = {
      model,
      input,
      response_format: {
        type: "video",
        aspect_ratio: scene.aspectRatio === "9:16" ? "9:16" : "16:9",
        resolution: omniResolution(scene.resolution)
      }
    };
    if (hasImage) {
      body.generation_config = { video_config: { task: "image_to_video" } };
    }

    const res = await fetch(`${base}/interactions`, {
      method: "POST",
      headers: {
        "x-goog-api-key": env.GOOGLE_AI_API_KEY,
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`Google Omni ${res.status}: ${await res.text()}`);
    const data = await res.json();
    const video = findOmniVideo(data);
    if (!video) {
      throw new Error(`Google Omni selesai tanpa output video (status: ${data.status || "unknown"}).`);
    }
    return {
      provider: "google",
      model,
      taskId: data.id || `omni_${crypto.randomUUID()}`,
      immediate: {
        status: "completed",
        progress: 100,
        outputBase64: video.data,
        mimeType: video.mimeType,
        raw: { id: data.id, status: data.status, model: data.model }
      }
    };
  }

  const instance = { prompt: scene.prompt };
  if (scene.referenceBase64 && scene.referenceMimeType) {
    instance.referenceImages = [{
      image: {
        inlineData: {
          mimeType: scene.referenceMimeType,
          data: scene.referenceBase64
        }
      },
      referenceType: "asset"
    }];
  }

  const parameters = {
    aspectRatio: scene.aspectRatio === "9:16" ? "9:16" : "16:9",
    resolution: scene.resolution === "4K" ? "4k" : (scene.resolution || "720p")
  };
  if (model === "veo-3.1-lite-generate-preview" && parameters.resolution === "4k") {
    parameters.resolution = "1080p";
  }

  const res = await fetch(`${base}/models/${encodeURIComponent(model)}:predictLongRunning`, {
    method: "POST",
    headers: {
      "x-goog-api-key": env.GOOGLE_AI_API_KEY,
      "content-type": "application/json"
    },
    body: JSON.stringify({ instances: [instance], parameters })
  });
  if (!res.ok) throw new Error(`Google Veo ${res.status}: ${await res.text()}`);
  const data = await res.json();
  if (!data.name) throw new Error("Google Veo tidak mengembalikan operation name.");
  return { provider: "google", model, taskId: data.name, raw: data };
}
