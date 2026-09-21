function normalizeStatus(value=""){
  const s=String(value||"").toLowerCase();
  if(["completed","succeeded","success","done"].includes(s)) return "completed";
  if(["failed","error","canceled","cancelled","expired"].includes(s)) return "failed";
  if(["queued","pending","throttled","submitted"].includes(s)) return "queued";
  if(["running","processing","dreaming","in_progress"].includes(s)) return "running";
  if(s==="demo") return "demo";
  return s||"queued";
}

export function normalizeProviderPayload(provider,data={}){
  if(provider==="luma"){
    const status=normalizeStatus(data.state);
    return {
      status,
      progress: status==="completed"?100:status==="failed"?0:status==="running"?55:15,
      outputUrl:data.assets?.video||null,
      mimeType:"video/mp4",
      error:data.failure_reason||null,
      raw:data
    };
  }
  if(provider==="runway"){
    const status=normalizeStatus(data.status);
    return {
      status,
      progress:Number.isFinite(Number(data.progress))?Math.round(Number(data.progress)*100):(status==="completed"?100:status==="failed"?0:status==="running"?55:15),
      outputUrl:Array.isArray(data.output)?data.output[0]:null,
      mimeType:"video/mp4",
      error:data.failure||data.failureCode||data.error||null,
      raw:data
    };
  }
  if(provider==="seedance"){
    const status=normalizeStatus(data.status);
    const err=data.error?.message||data.error?.code||(typeof data.error==="string"?data.error:null);
    return {
      status,
      progress:status==="completed"?100:status==="failed"?0:status==="running"?55:12,
      outputUrl:data.content?.video_url||null,
      mimeType:"video/mp4",
      error:err||null,
      raw:data
    };
  }
  if(provider==="veo"){
    if(!data.done) return {status:"running",progress:55,outputUrl:null,outputBase64:null,mimeType:"video/mp4",error:null,raw:data};
    if(data.error) return {status:"failed",progress:0,error:data.error?.message||JSON.stringify(data.error),raw:data};
    const video=data.response?.videos?.[0]||null;
    if(!video) return {status:"failed",progress:0,error:(data.response?.raiMediaFilteredReasons||[]).join(", ")||"Veo selesai tanpa output video.",raw:data};
    return {
      status:"completed",
      progress:100,
      outputUrl:video.gcsUri?.startsWith("http")?video.gcsUri:null,
      outputGcsUri:video.gcsUri||null,
      outputBase64:video.bytesBase64Encoded||null,
      mimeType:video.mimeType||"video/mp4",
      error:null,
      raw:data
    };
  }
  return {status:"failed",progress:0,error:`Provider tidak dikenali: ${provider}`,raw:data};
}

function seedanceTasksBase(env){
  const raw=(env.SEEDANCE_API_BASE||"https://operator.las.ap-southeast-1.bytepluses.com").replace(/\/$/,"");
  if(raw.endsWith("/contents/generations/tasks")) return raw;
  if(raw.endsWith("/api/v1")) return raw+"/contents/generations/tasks";
  return raw+"/api/v1/contents/generations/tasks";
}

export async function pollProvider(env,provider,taskId){
  if(!taskId) return {status:"failed",progress:0,error:"Provider task ID kosong."};
  if(String(taskId).startsWith("demo_")) return {status:"demo",progress:32,raw:{id:taskId}};
  let res;
  if(provider==="luma"){
    res=await fetch(`https://api.lumalabs.ai/dream-machine/v1/generations/${encodeURIComponent(taskId)}`,{
      headers:{authorization:`Bearer ${env.LUMA_API_KEY}`,accept:"application/json"}
    });
  }else if(provider==="runway"){
    const base=(env.RUNWAY_API_BASE||"https://api.dev.runwayml.com/v1").replace(/\/$/,"");
    res=await fetch(`${base}/tasks/${encodeURIComponent(taskId)}`,{
      headers:{authorization:`Bearer ${env.RUNWAY_API_KEY}`,"X-Runway-Version":"2024-11-06",accept:"application/json"}
    });
  }else if(provider==="seedance"){
    res=await fetch(`${seedanceTasksBase(env)}/${encodeURIComponent(taskId)}`,{
      headers:{authorization:`Bearer ${env.SEEDANCE_API_KEY}`,accept:"application/json"}
    });
  }else if(provider==="veo"){
    const location=env.VEO_LOCATION||"us-central1";
    const model=env.VEO_MODEL||"veo-3.1-generate-001";
    const endpoint=`https://${location}-aiplatform.googleapis.com/v1/projects/${env.VEO_PROJECT_ID}/locations/${location}/publishers/google/models/${model}:fetchPredictOperation`;
    res=await fetch(endpoint,{
      method:"POST",
      headers:{authorization:`Bearer ${env.VEO_ACCESS_TOKEN}`,"content-type":"application/json"},
      body:JSON.stringify({operationName:taskId})
    });
  }else{
    return {status:"failed",progress:0,error:`Provider tidak didukung: ${provider}`};
  }
  if(!res.ok) throw new Error(`${provider} status ${res.status}: ${await res.text()}`);
  return normalizeProviderPayload(provider,await res.json());
}
