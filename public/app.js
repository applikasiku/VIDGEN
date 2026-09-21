const state={api:false,providers:[],projects:[],assets:[],referenceAsset:null,referenceUploadAutoSelect:false,drive:{configured:false,connected:false},driveArchiving:false,scenes:[],jobs:[],style:'cinematic',ratio:'16:9',resolution:'1080p',duration:8,priority:'quality',vendor:'auto',googleModel:'veo-3.1-generate-preview',audio:null,audioDuration:0,currentProjectId:null,editing:null,jobTimer:null,projectLoading:false};
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const toast=m=>{const e=$('#toast');e.textContent=m;e.classList.add('show');clearTimeout(window.__toast);window.__toast=setTimeout(()=>e.classList.remove('show'),2300)};
const esc=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const fmt=n=>{n=Math.max(0,Math.round(n||0));return `${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`};
const THEME_KEY='vidgen:theme';
function normalizeTheme(value){return value==='dark'?'dark':'light'}
function currentTheme(){try{return normalizeTheme(document.documentElement.dataset.theme||localStorage.getItem(THEME_KEY)||'light')}catch{return 'light'}}
function applyTheme(theme,{persist=true}={}){
  const value=normalizeTheme(theme);
  document.documentElement.dataset.theme=value;
  if(persist){try{localStorage.setItem(THEME_KEY,value)}catch{}}
  const meta=document.querySelector('meta[name="theme-color"]');if(meta)meta.setAttribute('content',value==='dark'?'#070811':'#ffffff');
  const btn=$('#themeToggle'),icon=$('#themeIcon'),setting=$('#settingTheme');
  if(icon)icon.className=value==='dark'?'fa-solid fa-sun':'fa-solid fa-moon';
  if(btn){const next=value==='dark'?'terang':'gelap';btn.title=`Mode ${next[0].toUpperCase()+next.slice(1)}`;btn.setAttribute('aria-label',`Ganti ke mode ${next}`)}
  if(setting)setting.value=value;
  return value
}
function toggleTheme(){return applyTheme(currentTheme()==='dark'?'light':'dark')}

function getGenreValue(){const s=$('#genreSelect'),c=$('#genreCustom');if(!s)return '';return s.value==='Lainnya'?(c?.value||'').trim():s.value}
function setGenreValue(value=''){const s=$('#genreSelect'),c=$('#genreCustom');if(!s)return;const options=[...s.options].map(o=>o.value);if(options.includes(value)){s.value=value;if(c)c.value=''}else{s.value='Lainnya';if(c)c.value=value}syncGenreField()}
function syncGenreField(){const s=$('#genreSelect'),w=$('#genreCustomWrap');if(!s||!w)return;w.classList.toggle('show',s.value==='Lainnya')}
async function api(path,opt={}){const r=await fetch(path,{...opt,headers:{'content-type':'application/json',...(opt.headers||{})}});if(!r.ok)throw new Error((await r.json().catch(()=>({}))).error||`HTTP ${r.status}`);return r.json()}
function buildWave(){const w=$('#wave');w.innerHTML='';for(let i=0;i<90;i++){const b=document.createElement('i');b.style.height=`${5+Math.random()*20}px`;w.appendChild(b)}}buildWave();
function setStep(n){$$('.step').forEach((e,i)=>e.classList.toggle('active',i<n))}
function latestJobsForScenes(jobs=state.jobs){
  const seen=new Set(),out=[];
  for(const job of jobs){
    const key=job.scene_id||job.sceneId||job.id||`job_${out.length}`;
    if(seen.has(key))continue;
    seen.add(key);out.push(job);
  }
  return out;
}
function friendlyJobError(message=''){
  const s=String(message||'').replace(/\s+/g,' ').trim();
  const low=s.toLowerCase();
  if(low.includes('too many subrequests'))return 'Cloudflare Worker mencapai batas request. Pipeline v1.4.3 sekarang memakai batch kecil.';
  if(low.includes('invalid_api_key')||low.includes('authorization failed')||low.includes('not authenticated')||low.includes('unauthorized')||low.includes('api key tidak valid'))return 'API key provider tidak valid atau tidak cocok dengan endpoint.';
  if(low.includes('not enough credits')||low.includes('credit provider tidak cukup')||low.includes('insufficient credit'))return 'Credit provider tidak cukup untuk menjalankan render.';
  if(low.includes('rate limit')||low.includes('too_many_requests')||low.includes('quota'))return 'Quota / rate limit provider habis. Gunakan model lain atau aktifkan billing/quota.';
  return s.length>220?s.slice(0,220)+'…':s;
}
function providerIssuesText(issues={}){
  const values=Object.values(issues||{}).filter(Boolean);
  return values.length?values.join(' • '):'';
}
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function updateStats(){
  $('#sceneCount').textContent=state.scenes.length;$('#projectCount').textContent=state.projects.length+(state.currentProjectId?0:0);$('#driveKpi').textContent=state.drive.connected?'Aktif':'Belum';$('#routerKpi').textContent=state.vendor==='auto'?'Auto':state.vendor[0].toUpperCase()+state.vendor.slice(1);
  const total=state.scenes.reduce((a,s)=>a+Number(s.duration||0),0);$('#estimate').textContent=`${state.scenes.length} scene • ${fmt(total)}`;$('#jobCount').textContent=`${latestJobsForScenes().length} job`;
}
async function bootstrap(){
  try{const data=await api('/api/bootstrap');state.api=true;state.providers=data.providers||[];state.projects=data.projects||[];state.assets=data.assets||[];state.drive=data.drive||{connected:false};$('#cloudState').className='cloud-state ok';$('#cloudState').innerHTML='<span></span><b>Cloudflare API</b>';$('#backendMode').textContent='Cloudflare Worker';renderProviders();renderProjects();renderAssets();renderDrive();renderHistory();}
  catch(e){
    state.api=false;state.backendError=true;state.backendErrorMessage=e.message||String(e);
    try{
      const ps=await api('/api/provider-status');
      state.providers=ps.providers||[];
      let diag=null;try{diag=await api('/api/diagnostics')}catch{}
      $('#cloudState').className='cloud-state demo';
      $('#cloudState').innerHTML='<span></span><b>API aktif • Bootstrap gagal</b>';
      $('#backendMode').textContent=diag?.checks?.d1==='error'?'Worker aktif • D1 bermasalah':'Worker aktif • bootstrap bermasalah';
      const notice=$('#notice span');if(notice)notice.textContent='Worker VIDGEN aktif, tetapi bootstrap database gagal. Status API vendor di bawah tetap dibaca langsung dari Cloudflare Secrets.';
      toast(diag?.databaseError?'D1 error terdeteksi. Status API key tetap berhasil dibaca.':'Bootstrap gagal. Status API key tetap berhasil dibaca.');
    }catch(statusError){
      state.providers=['seedance','google','runway','luma'].map(id=>({id,name:id[0].toUpperCase()+id.slice(1),configured:false,strengths:['status tidak dapat dibaca']}));
      $('#cloudState').className='cloud-state demo';$('#cloudState').innerHTML='<span></span><b>Server tidak tersedia</b>';$('#backendMode').textContent='Worker/API tidak dapat dihubungi';toast('Tidak dapat terhubung ke Worker VIDGEN.');
    }
    $('#generateBtn').disabled=true;renderProviders();
  }
  syncGoogleModelVisibility();updateStats();
}
function providerIcon(id){return id==='google'?'<i class="fa-brands fa-google"></i>':id==='seedance'?'<i class="fa-solid fa-music"></i>':id==='runway'?'<i class="fa-solid fa-clapperboard"></i>':id==='luma'?'<i class="fa-solid fa-video"></i>':'<i class="fa-solid fa-microchip"></i>'}
function renderProviders(){const box=$('#providerGrid');box.innerHTML=state.providers.map(p=>`<div class="provider-card"><div class="provider-card-head"><span class="provider-card-icon">${providerIcon(p.id)}</span><b>${esc(p.name)}</b></div><small>Model: ${esc(p.model||'configurable')}</small><small>${esc((p.strengths||[]).join(' • '))}</small><span class="status ${p.configured?'ok':''}">${p.configured?'API configured':'Demo / belum ada key'}</span></div>`).join('')||'<div class="empty"><i class="fa-solid fa-circle-info"></i> Provider belum tersedia.</div>'}
function renderProjects(){
  const box=$('#projectGrid');if(!box)return;
  if(!state.projects.length){box.innerHTML='<div class="empty">Belum ada proyek tersimpan.</div>';return}
  box.innerHTML=state.projects.map(p=>`<article class="project-card"><div class="project-cover"><span>${esc(p.status||'draft')}</span></div><b>${esc(p.title)}</b><small>${esc(p.genre||'Music video')} • ${esc(p.aspect_ratio||'16:9')} • ${esc(p.resolution||'1080p')}</small><small>${p.audio_name?'♫ '+esc(p.audio_name):'Belum ada audio'} • ${p.updated_at?new Date(p.updated_at).toLocaleString('id-ID'):new Date(p.created_at).toLocaleString('id-ID')}</small><div class="project-actions"><button class="primary" data-open-project="${esc(p.id)}"><i class="fa-solid fa-folder-open"></i> Buka</button><button class="secondary" data-delete-project="${esc(p.id)}"><i class="fa-solid fa-trash"></i> Hapus</button></div></article>`).join('');
  $$('[data-open-project]').forEach(b=>b.onclick=()=>openProject(b.dataset.openProject));
  $$('[data-delete-project]').forEach(b=>b.onclick=()=>deleteProject(b.dataset.deleteProject));
}
function renderDrive(){
  const configured=state.drive.configured!==false;
  const connected=Boolean(state.drive.connected);
  const archived=state.scenes.filter(s=>s.driveFileId).length;
  const ready=state.scenes.filter(s=>s.outputR2Key&&!s.driveFileId).length;
  $('#driveKpi').textContent=connected?'Aktif':'Belum';
  $('#driveTitle').textContent=connected?(state.drive.name||state.drive.email||'Terhubung'):(configured?'Belum terhubung':'OAuth belum dikonfigurasi');
  $('#driveText').textContent=connected?('Drive siap • folder /'+(state.drive.folderName||'VIDGEN')+(state.drive.email?' • '+state.drive.email:'')):(configured?'Hubungkan akun Google untuk mengarsipkan hasil render VIDGEN.':'Tambahkan GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, dan SESSION_SECRET di Cloudflare Secrets.');
  const oauth=$('#driveOauthStatus');if(oauth){oauth.textContent=connected?'OAuth terhubung':(configured?'OAuth siap':'OAuth belum lengkap');oauth.classList.toggle('ok',connected)}
  const count=$('#driveArchiveCount');if(count)count.textContent=archived+' scene tersimpan';
  const connect=$('#connectDrive'),test=$('#testDrive'),archive=$('#archiveDrive'),disconnect=$('#disconnectDrive'),progress=$('#driveProgress');
  if(connect){connect.hidden=connected;connect.disabled=!configured;connect.innerHTML='<i class="fa-brands fa-google-drive"></i> Hubungkan Google Drive'}
  if(test)test.hidden=!connected;
  if(archive){archive.hidden=!connected;archive.disabled=state.driveArchiving||!ready;archive.innerHTML=state.driveArchiving?'<i class="fa-solid fa-spinner fa-spin"></i> Mengarsipkan…':('<i class="fa-solid fa-cloud-arrow-up"></i> Arsip Scene'+(ready?' ('+ready+')':''))}
  if(disconnect)disconnect.hidden=!connected;
  if(progress)progress.textContent=state.driveArchiving?'Mengunggah scene ke Google Drive…':(connected?(ready?ready+' scene siap diarsipkan.':'Tidak ada scene baru yang perlu diarsipkan.'):(configured?'Klik Hubungkan Google Drive untuk mulai.':'Lengkapi OAuth secrets di Cloudflare.'));
}
function renderCurrentReference(){
  const preview=$('#referencePreview'),name=$('#referenceName'),status=$('#referenceStatus');
  if(!preview||!name||!status)return;
  if(!state.referenceAsset){
    preview.classList.remove('has-image');
    preview.innerHTML='<i class="fa-regular fa-image"></i>';
    name.textContent='Belum dipilih';
    status.textContent='Pilih gambar untuk menjaga karakter dan style antar scene.';
    return;
  }
  const asset=state.referenceAsset;
  preview.classList.add('has-image');
  preview.innerHTML=`<img src="/api/assets/${encodeURIComponent(asset.id)}/content" alt="${esc(asset.name||'Reference image')}" loading="lazy">`;
  name.textContent=asset.name||'Reference aktif';
  const mb=Number(asset.size_bytes||0)/1024/1024;
  status.textContent=`${asset.mime_type||'image'} • ${mb.toFixed(2)} MB • digunakan saat storyboard dan generate`;
}
function renderAssets(){
  const box=$('#assetGrid'),count=$('#assetCount');
  if(count)count.textContent=`${state.assets.length} aset`;
  renderCurrentReference();
  if(!box)return;
  if(!state.assets.length){box.innerHTML='<div class="empty"><i class="fa-regular fa-images"></i> Belum ada reference image.</div>';return}
  box.innerHTML=state.assets.map(a=>`<article class="asset-card ${state.referenceAsset?.id===a.id?'selected':''}"><div class="asset-preview"><img src="/api/assets/${encodeURIComponent(a.id)}/content" alt="${esc(a.name)}" loading="lazy"></div><div class="asset-copy"><b>${esc(a.name)}</b><small>${(Number(a.size_bytes||0)/1024/1024).toFixed(2)} MB • ${esc(a.mime_type||'image')}</small></div><div class="asset-actions"><button class="secondary" data-use-asset="${esc(a.id)}"><i class="fa-solid fa-check"></i> Pakai</button><button class="text-btn danger-text" data-delete-asset="${esc(a.id)}" title="Hapus"><i class="fa-solid fa-trash"></i></button></div></article>`).join('');
  $$('[data-use-asset]').forEach(b=>b.onclick=()=>{state.referenceAsset=state.assets.find(a=>a.id===b.dataset.useAsset)||null;renderAssets();toast('Reference image aktif.')});
  $$('[data-delete-asset]').forEach(b=>b.onclick=()=>deleteAsset(b.dataset.deleteAsset));
}
async function uploadAudio(file){
  if(!state.api||!file)return null;
  $('#audioMeta').textContent='Mengunggah audio ke Cloudflare R2…';
  try{
    const r=await fetch('/api/audio/upload?name='+encodeURIComponent(file.name),{method:'POST',headers:{'content-type':file.type||'audio/mpeg'},body:file});
    const data=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(data.error||`HTTP ${r.status}`);
    if(state.audio){state.audio.r2Key=data.key;state.audio.name=data.name||file.name}
    $('#audioMeta').textContent=`${(file.size/1024/1024).toFixed(2)} MB • tersimpan di R2`;
    return data;
  }catch(e){
    $('#audioMeta').textContent=`${(file.size/1024/1024).toFixed(2)} MB • upload R2 gagal`;
    toast(e.message);throw e;
  }
}
function syncGoogleModelVisibility(){
  const panel=$('#googleModelPanel');
  if(panel)panel.classList.toggle('hidden',!['auto','google'].includes(state.vendor));
  const select=$('#googleModel');if(select)select.value=state.googleModel;
  const setting=$('#settingGoogleModel');if(setting)setting.value=state.googleModel;
}
function setEditorControls(){
  $$('#styleGrid .style').forEach(x=>x.classList.toggle('active',x.dataset.style===state.style));
  $$('#ratioGroup button').forEach(x=>x.classList.toggle('active',x.dataset.value===state.ratio));
  $$('#priorityGroup button').forEach(x=>x.classList.toggle('active',x.dataset.value===state.priority));
  $$('#vendorList .vendor').forEach(x=>x.classList.toggle('active',x.dataset.vendor===state.vendor));
  $('#resolution').value=state.resolution;$('#sceneDuration').value=String(state.duration);
  syncGoogleModelVisibility();renderAssets();updateStats();
}
async function openProject(id){
  if(!state.api||state.projectLoading)return;
  state.projectLoading=true;
  try{
    const data=await api('/api/projects/'+encodeURIComponent(id));
    const p=data.project;
    state.currentProjectId=p.id;state.scenes=mapServerScenes(data.scenes||[]);state.jobs=data.jobs||[];state.referenceAsset=data.reference||null;renderCurrentReference();
    state.style=p.style||'cinematic';state.ratio=p.aspect_ratio||'16:9';state.resolution=p.resolution||'1080p';state.vendor=p.router_mode||'auto';state.priority=p.router_priority||'quality';state.googleModel=p.google_model||'veo-3.1-generate-preview';state.audioDuration=Number(p.duration_seconds||0);
    $('#projectTitle').value=p.title||'Videoclip Baru';setGenreValue(p.genre||'');$('#conceptInput').value=p.concept||'';$('#driveSaveToggle').checked=Boolean(p.save_to_drive);
    if(state.audio?.url?.startsWith('blob:'))URL.revokeObjectURL(state.audio.url);
    if(p.audio_r2_key){const url='/api/projects/'+encodeURIComponent(id)+'/audio';state.audio={name:p.audio_name||'Audio project',r2Key:p.audio_r2_key,url};player.src=url;$('#audioTitle').textContent=p.audio_name||'Audio project';$('#audioMeta').textContent='Tersimpan di Cloudflare R2';$('#audioStrip').classList.add('show');$('#audioTime').textContent=fmt(state.audioDuration)}
    else{state.audio=null;player.removeAttribute('src');$('#audioTitle').textContent='Pilih lagu atau tarik file ke sini';$('#audioMeta').textContent='File akan disimpan ke R2.';$('#audioStrip').classList.remove('show')}
    setEditorControls();renderScenes();renderJobs();renderDrive();if(state.jobs.length)startJobPolling();$('[data-tab="create"]').click();setStep(state.jobs.length?4:state.scenes.length?2:1);toast('Project dibuka.');
  }catch(e){toast(e.message)}finally{state.projectLoading=false}
}
async function deleteProject(id){
  if(!state.api)return;
  if(!confirm('Hapus project ini beserta scene, job, dan audio R2-nya?'))return;
  try{await api('/api/projects/'+encodeURIComponent(id),{method:'DELETE'});state.projects=state.projects.filter(p=>p.id!==id);if(state.currentProjectId===id)newProject(false);renderProjects();renderHistory();toast('Project dihapus.')}catch(e){toast(e.message)}
}
function newProject(switchTab=true){
  stopJobPolling();state.currentProjectId=null;state.scenes=[];state.jobs=[];state.referenceAsset=null;state.audioDuration=0;renderCurrentReference();
  if(state.audio?.url?.startsWith('blob:'))URL.revokeObjectURL(state.audio.url);state.audio=null;player.removeAttribute('src');
  $('#projectTitle').value='Videoclip Baru';setGenreValue('Ska rocksteady');$('#conceptInput').value='';$('#audioTitle').textContent='Pilih lagu atau tarik file ke sini';$('#audioMeta').textContent='File akan disimpan ke R2.';$('#audioStrip').classList.remove('show');
  applyPrefs();renderAssets();renderScenes();renderJobs();renderDrive();setStep(1);if(switchTab)$('[data-tab="create"]').click();
}
async function saveDraft(){try{await saveProject();toast('Draft project tersimpan.');renderProjects();renderHistory()}catch(e){toast(e.message)}}
function localStoryboard(){const count=Math.max(6,Math.min(24,state.audioDuration?Math.ceil(state.audioDuration/state.duration):8));const labels=['Intro','Verse 1','Build','Chorus','Verse 2','Transition','Bridge','Final Chorus','Outro'];const shots=['wide establishing shot','medium performance shot','close-up portrait','tracking shot','low angle hero shot','slow orbit'];const genre=getGenreValue()||'music video';const concept=$('#conceptInput').value||'cinematic performance and emotional storytelling';const mood=$('#moodInput')?.value||'dynamic';const camera=$('#cameraInput')?.value||'mixed cinematic';return Array.from({length:count},(_,i)=>{const title=labels[Math.min(labels.length-1,Math.floor(i*labels.length/count))];const shot=camera==='mixed cinematic'?shots[i%shots.length]:camera;const ref=state.referenceAsset?` Use selected reference image "${state.referenceAsset.name}" as identity/style guidance.`:'';return{id:`local_${Date.now()}_${i}`,index:i,title,start:i*state.duration,duration:state.duration,shot,motion:'cinematic camera movement',lighting:'cinematic lighting',prompt:`${concept}. ${title}. ${genre}. ${state.style} music video, ${mood} mood, ${shot}, coherent character identity, consistent wardrobe, cinematic lighting, intentional camera movement.${ref} no text or watermark.`}})}
async function makeStoryboard(){
  const payload={genre:getGenreValue(),concept:$('#conceptInput').value,style:state.style,mood:$('#moodInput')?.value||'dynamic',camera:$('#cameraInput')?.value||'mixed cinematic',beatSync:$('#beatToggle').checked,lyricSync:$('#lyricToggle').checked,consistency:$('#consistencyToggle').checked,referenceName:state.referenceAsset?.name||'',hasReference:Boolean(state.referenceAsset),sceneDuration:state.duration,sceneCount:state.audioDuration?Math.ceil(state.audioDuration/state.duration):8};
  try{state.scenes=state.api?(await api('/api/storyboard',{method:'POST',body:JSON.stringify(payload)})).scenes:localStoryboard()}catch(e){toast(e.message);return}
  renderScenes();setStep(2);toast(`Storyboard dibuat: ${state.scenes.length} scene`)
}
function mapServerScenes(rows=[]){
  const oldByIndex=new Map(state.scenes.map((s,i)=>[Number(s.index??i),s]));
  return rows.map((s,i)=>{const old=oldByIndex.get(Number(s.scene_index??i))||{};return {...old,id:s.id,index:Number(s.scene_index??i),title:s.title||old.title||`Scene ${i+1}`,start:Number(s.start_seconds??old.start??0),duration:Number(s.duration_seconds??old.duration??state.duration),vendor:s.vendor||old.vendor||'auto',prompt:s.prompt||old.prompt||'',status:s.status||old.status||'draft',providerJobId:s.provider_job_id||null,outputR2Key:s.output_r2_key||null,driveFileId:s.drive_file_id||old.driveFileId||null,driveWebViewLink:s.drive_web_view_link||old.driveWebViewLink||null}});
}
function sceneStatusLabel(s){return s?.status|| (s?.outputR2Key?'completed':'draft')}
function renderScenes(){
  const list=$('#sceneList'),tl=$('#timeline');if(!state.scenes.length){list.innerHTML='<div class="empty">Storyboard belum dibuat.</div>';tl.innerHTML='<div class="empty">Scene akan muncul di timeline.</div>';updateStats();return}
  list.innerHTML=state.scenes.map((s,i)=>{const status=sceneStatusLabel(s);return `<div class="scene-row scene-${esc(status)}"><div class="scene-num">${String(i+1).padStart(2,'0')}</div><div class="scene-copy"><div class="scene-titleline"><b>${esc(s.title)}</b><span class="scene-state">${esc(status)}</span></div><div class="scene-meta">${esc(s.shot||'cinematic shot')} • ${esc(s.motion||'intentional movement')} • ${esc(s.lighting||'cinematic light')}</div><small>${fmt(s.start)} • ${s.duration}s • ${esc(s.prompt)}</small>${s.driveFileId?'<small class="scene-drive"><i class="fa-brands fa-google-drive"></i> Tersimpan di Drive</small>':''}</div><div class="scene-actions">${s.outputR2Key?`<button data-preview="${esc(s.id)}" title="Preview"><i class="fa-solid fa-play"></i></button>`:''}<button data-edit="${esc(s.id)}" title="Inspector"><i class="fa-solid fa-pen"></i></button></div></div>`}).join('');
  tl.innerHTML=state.scenes.map((s,i)=>`<div class="timeline-item ${s.outputR2Key?'has-output':''}"><div class="timeline-thumb">${s.outputR2Key?'<i class="fa-solid fa-play"></i>':''}</div><b>${String(i+1).padStart(2,'0')} • ${esc(s.title)}</b><small>${fmt(s.start)}–${fmt(Number(s.start)+Number(s.duration))} • ${state.ratio}</small><small>${esc(sceneStatusLabel(s))} • ${esc(s.vendor||state.vendor||'auto')}</small></div>`).join('');
  $$('[data-edit]').forEach(b=>b.onclick=()=>openScene(b.dataset.edit));
  $$('[data-preview]').forEach(b=>b.onclick=()=>openScene(b.dataset.preview,true));
  updateStats()
}
function openScene(id,autoplay=false){
  const s=state.scenes.find(x=>x.id===id);if(!s)return;state.editing=id;
  $('#modalTitle').textContent=s.title;$('#modalSceneTitle').value=s.title;$('#modalPrompt').value=s.prompt;
  const status=sceneStatusLabel(s);$('#modalSceneStatus').textContent=status;$('#modalSceneStatus').className='scene-status status-'+status;
  $('#modalVendor').value=s.vendor||'auto';$('#modalGoogleModel').value=state.googleModel;$('#modalFallback').value='true';
  const video=$('#modalVideo');video.pause();video.removeAttribute('src');video.hidden=!s.outputR2Key;
  if(s.outputR2Key){video.src='/api/scenes/'+encodeURIComponent(s.id)+'/output?v='+Date.now();video.load();if(autoplay)video.play().catch(()=>{})}
  $('#modal').classList.add('show')
}
function closeModal(){const v=$('#modalVideo');if(v){v.pause();v.removeAttribute('src');v.load()}$('#modal').classList.remove('show');state.editing=null}
async function regenerateScene(){
  const s=state.scenes.find(x=>x.id===state.editing);if(!s||!state.api)return;
  const btn=$('#regenerateScene');btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Mengirim…';
  try{
    const r=await api('/api/scenes/'+encodeURIComponent(s.id)+'/regenerate',{method:'POST',body:JSON.stringify({vendor:$('#modalVendor').value,googleModel:$('#modalGoogleModel').value,fallback:$('#modalFallback').value==='true'})});
    s.status=r.job?.demo?'demo':r.job?.error?'failed':'queued';s.vendor=r.job?.provider||$('#modalVendor').value;
    if(r.job)state.jobs.unshift(r.job);renderScenes();renderJobs();startJobPolling();openScene(s.id);toast(r.job?.error?'Regenerate gagal dikirim.':'Regenerate scene dikirim.');
  }catch(e){toast(e.message)}finally{btn.disabled=false;btn.innerHTML='<i class="fa-solid fa-rotate"></i> Regenerate Scene'}
}
function renderJobs(){
  const box=$('#jobList'),summary=$('#queueSummary');
  const visibleJobs=latestJobsForScenes();
  if(!visibleJobs.length){box.innerHTML='<div class="empty">Belum ada job.</div>';if(summary)summary.textContent='Belum ada render aktif.';updateStats();return}
  const failed=visibleJobs.filter(j=>j.error||j.error_message||j.status==='failed').length;
  const done=visibleJobs.filter(j=>j.status==='completed').length;
  const active=visibleJobs.filter(j=>['queued','submitted','running','processing','dreaming'].includes(j.status)).length;
  if(summary)summary.textContent=`${active} aktif • ${done} selesai • ${failed} gagal`;
  box.innerHTML=visibleJobs.map((j,i)=>{
    const status=j.error||j.error_message?'failed':j.demo?'demo':j.status||'submitted';
    const progress=Number.isFinite(Number(j.progress))?Number(j.progress):(status==='completed'?100:status==='failed'?5:status==='demo'?32:12);
    const scene=state.scenes.find(s=>s.id===(j.scene_id||j.sceneId));
    const sceneNo=(scene?.index??j.sceneIndex??i)+1;
    const rawError=j.error_message||j.error||'';
    const shortError=rawError?friendlyJobError(rawError):'';
    return `<div class="job job-${esc(status)}"><div class="job-head"><b>Scene ${sceneNo} • ${esc(j.provider||'auto')}</b><span>${esc(status)}</span></div><div class="progress"><i style="width:${Math.max(3,Math.min(100,progress))}%"></i></div>${shortError?`<small class="job-error" title="${esc(rawError)}">${esc(shortError)}</small>`:''}</div>`
  }).join('');
  updateStats()
}
function applyJobSync(r){
  state.jobs=r.jobs||[];
  if(Array.isArray(r.scenes)){state.scenes=mapServerScenes(r.scenes);renderScenes()}
  const p=state.projects.find(x=>x.id===state.currentProjectId);if(p&&r.projectStatus){p.status=r.projectStatus;p.updated_at=new Date().toISOString();renderProjects();renderHistory()}
  renderJobs();renderDrive()
}
async function refreshJobs(silent=false){
  if(!state.api||!state.currentProjectId)return;
  if(!silent)$('#refreshJobs')?.setAttribute('disabled','');
  try{const r=await api('/api/jobs?projectId='+encodeURIComponent(state.currentProjectId));applyJobSync(r)}
  catch(e){if(!silent)toast(e.message)}
  finally{if(!silent)$('#refreshJobs')?.removeAttribute('disabled')}
}
function stopJobPolling(){if(state.jobTimer){clearTimeout(state.jobTimer);state.jobTimer=null}}
function startJobPolling(){
  stopJobPolling();if(!state.currentProjectId)return;
  const tick=async()=>{await refreshJobs(true);const active=state.jobs.some(j=>['queued','submitted','running','processing','dreaming'].includes(j.status));if(active)state.jobTimer=setTimeout(tick,7000+Math.floor(Math.random()*4000));else{state.jobTimer=null;if(state.drive.connected&&$('#driveSaveToggle')?.checked)archiveCompletedScenes({silent:true})}};
  state.jobTimer=setTimeout(tick,2500)
}
async function uploadAsset(file){
  if(!file)throw new Error('File tidak ditemukan.');
  if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error(`${file.name}: gunakan JPG, PNG, atau WEBP.`);
  if(file.size>10*1024*1024)throw new Error(`${file.name}: ukuran maksimal 10 MB.`);
  const r=await fetch('/api/assets/upload?name='+encodeURIComponent(file.name),{method:'POST',headers:{'content-type':file.type},body:file});
  const data=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(data.error||`HTTP ${r.status}`);
  state.assets.unshift(data.asset);
  return data.asset;
}
async function uploadAssets(files){
  const list=[...(files||[])];if(!list.length)return;
  const input=$('#assetInput');let ok=0,failed=0,firstUploaded=null;
  if(input)input.disabled=true;
  for(const file of list){
    try{const asset=await uploadAsset(file);if(!firstUploaded)firstUploaded=asset;ok++}
    catch(e){failed++;console.error(e);toast(e.message)}
  }
  if(state.referenceUploadAutoSelect&&firstUploaded)state.referenceAsset=firstUploaded;
  state.referenceUploadAutoSelect=false;
  renderAssets();
  if(input){input.disabled=false;input.value=''}
  if(failed===0)toast(state.referenceAsset?.id===firstUploaded?.id?`${ok} reference berhasil diupload • reference aktif`:`${ok} reference image berhasil diupload.`);
  else toast(`${ok} berhasil • ${failed} gagal.`);
}
async function deleteAsset(id){const asset=state.assets.find(a=>a.id===id);if(!asset)return;try{const r=await fetch('/api/assets/'+encodeURIComponent(id),{method:'DELETE'});const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.error||`HTTP ${r.status}`);state.assets=state.assets.filter(a=>a.id!==id);if(state.referenceAsset?.id===id)state.referenceAsset=null;renderAssets();toast('Aset dihapus.')}catch(e){toast(e.message)}}
async function saveProject(){
  if(state.audio?.uploadPromise){try{await state.audio.uploadPromise}catch{}}
  const p={title:$('#projectTitle').value||'Videoclip Baru',genre:getGenreValue(),concept:$('#conceptInput').value,audioName:state.audio?.name||state.audio?.file?.name||'',audioR2Key:state.audio?.r2Key||'',referenceAssetId:state.referenceAsset?.id||'',duration:state.audioDuration,style:state.style,aspectRatio:state.ratio,resolution:state.resolution,vendor:state.vendor,priority:state.priority,googleModel:state.googleModel,saveToDrive:$('#driveSaveToggle').checked,scenes:state.scenes};
  if(!state.api)return state.currentProjectId||`demo_${Date.now()}`;
  let r;
  if(state.currentProjectId)r=await api('/api/projects/'+encodeURIComponent(state.currentProjectId),{method:'PUT',body:JSON.stringify(p)});
  else r=await api('/api/projects',{method:'POST',body:JSON.stringify(p)});
  state.currentProjectId=r.id;
  const row={id:r.id,title:p.title,genre:p.genre,status:'draft',aspect_ratio:p.aspectRatio,resolution:p.resolution,audio_name:p.audioName,duration_seconds:p.duration,google_model:p.googleModel,created_at:new Date().toISOString(),updated_at:new Date().toISOString()};
  const ix=state.projects.findIndex(x=>x.id===r.id);if(ix>=0)state.projects[ix]={...state.projects[ix],...row};else state.projects.unshift(row);
  try{const detail=await api('/api/projects/'+encodeURIComponent(r.id));state.scenes=mapServerScenes(detail.scenes||[]);state.jobs=detail.jobs||state.jobs;state.referenceAsset=detail.reference||state.referenceAsset;renderScenes();renderJobs()}catch{}
  renderProjects();renderHistory();updateStats();return r.id
}
async function generate(){
  if(!state.api)return toast('Server belum terhubung. Muat ulang untuk mencoba lagi.');
  if(!state.scenes.length)return toast('Buat storyboard terlebih dahulu.');
  const btn=$('#generateBtn');btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Menyiapkan render…';
  try{
    state.currentProjectId=await saveProject();
    if(state.api){
      const sceneIds=state.scenes.map(s=>s.id).filter(Boolean);
      const batchSize=3;
      const allJobs=[];
      let halted=false;
      let issues={};
      for(let i=0;i<sceneIds.length;i+=batchSize){
        const batch=sceneIds.slice(i,i+batchSize);
        btn.innerHTML=`<i class="fa-solid fa-spinner fa-spin"></i> Mengirim scene ${i+1}–${Math.min(i+batch.length,sceneIds.length)} / ${sceneIds.length}`;
        const r=await api('/api/generate',{method:'POST',body:JSON.stringify({projectId:state.currentProjectId,sceneIds:batch,fallback:$('#fallbackToggle').checked})});
        const jobs=r.jobs||[];
        allJobs.push(...jobs);
        state.jobs=[...allJobs];
        for(const j of jobs){
          const s=state.scenes.find(x=>x.id===(j.sceneId||j.scene_id));
          if(s){s.status=j.demo?'demo':j.error?'failed':j.status||'queued';s.vendor=j.provider||s.vendor}
        }
        renderScenes();renderJobs();
        if(r.halted){
          halted=true;issues=r.providerIssues||{};break;
        }
        if(i+batchSize<sceneIds.length)await wait(900);
      }
      setStep(4);
      const active=state.jobs.some(j=>['queued','submitted','running','processing','dreaming'].includes(j.status));
      if(active)startJobPolling();else if(state.drive.connected&&$('#driveSaveToggle')?.checked)archiveCompletedScenes({silent:true});
      if(halted){
        const detail=providerIssuesText(issues);
        toast(detail||'Render dihentikan karena semua provider yang dikonfigurasi sedang bermasalah.');
      }else if(state.jobs.every(j=>j.demo)){
        toast('Simulasi dibuat. Belum ada video yang dihasilkan.');
      }else if(state.jobs.every(j=>j.error||j.status==='failed')){
        toast('Semua proses gagal. Periksa API key, quota, dan credit provider.');
      }else{
        toast('Permintaan video dikirim bertahap.');
      }
    }
  }catch(e){toast(friendlyJobError(e.message))}
  finally{btn.disabled=false;btn.innerHTML='<i class="fa-solid fa-rocket"></i> Generate Music Video'}
}
async function connectDrive(){
  if(!state.api)return toast('Worker belum terhubung.');
  if(state.drive.connected)return toast('Google Drive sudah terhubung.');
  if(state.drive.configured===false)return toast('Lengkapi GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, dan SESSION_SECRET di Cloudflare Secrets.');
  try{const r=await api('/api/drive/connect');location.href=r.authUrl}catch(e){toast(e.message)}
}
async function refreshDriveStatus(){
  if(!state.api)return;
  try{state.drive=await api('/api/drive/status');renderDrive()}catch(e){toast(e.message)}
}
async function testDriveConnection(){
  if(!state.drive.connected)return toast('Hubungkan Google Drive terlebih dahulu.');
  const btn=$('#testDrive');if(btn)btn.disabled=true;
  try{const r=await api('/api/drive/test',{method:'POST',body:'{}'});toast('Google Drive siap • folder /'+(r.folderName||'VIDGEN'));await refreshDriveStatus()}
  catch(e){toast(e.message)}finally{if(btn)btn.disabled=false}
}
async function disconnectGoogleDrive(){
  if(!state.drive.connected)return;
  if(!confirm('Putuskan Google Drive dari VIDGEN?'))return;
  try{await api('/api/drive/disconnect',{method:'POST',body:'{}'});state.drive={...state.drive,connected:false,email:null,name:null};renderDrive();toast('Google Drive diputuskan.')}catch(e){toast(e.message)}
}
async function archiveCompletedScenes({silent=false}={}){
  if(state.driveArchiving)return;
  if(!state.api||!state.currentProjectId){if(!silent)toast('Buka atau simpan project terlebih dahulu.');return}
  if(!state.drive.connected){if(!silent)toast('Hubungkan Google Drive terlebih dahulu.');return}
  const pending=state.scenes.filter(s=>s.outputR2Key&&!s.driveFileId);
  if(!pending.length){if(!silent)toast('Semua scene selesai sudah tersimpan di Drive.');renderDrive();return}
  state.driveArchiving=true;renderDrive();
  let ok=0,failed=0;
  for(let i=0;i<pending.length;i++){
    const scene=pending[i];
    const progress=$('#driveProgress');if(progress)progress.textContent='Mengunggah scene '+(i+1)+'/'+pending.length+': '+(scene.title||'Scene');
    try{
      const r=await api('/api/drive/archive-scene',{method:'POST',body:JSON.stringify({projectId:state.currentProjectId,sceneId:scene.id})});
      scene.driveFileId=r.drive?.id||scene.driveFileId||null;
      scene.driveWebViewLink=r.drive?.webViewLink||scene.driveWebViewLink||null;
      ok++;
    }catch(e){failed++;if(!silent)toast(e.message)}
  }
  state.driveArchiving=false;renderDrive();renderScenes();
  if(!silent)toast(failed?(ok+' scene tersimpan • '+failed+' gagal'):(ok+' scene berhasil diarsipkan ke Google Drive.'));
}
function exportProject(){const data={app:'VIDGEN',version:'1.4.4',title:$('#projectTitle').value,genre:getGenreValue(),concept:$('#conceptInput').value,settings:{style:state.style,ratio:state.ratio,resolution:state.resolution,sceneDuration:state.duration,priority:state.priority,vendor:state.vendor,googleModel:state.googleModel,fallback:$('#fallbackToggle').checked,saveToDrive:$('#driveSaveToggle').checked},scenes:state.scenes};const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));a.download='VIDGEN-project.json';a.click();toast('Project JSON diekspor.')}
const input=$('#audioInput'),drop=$('#dropzone'),player=$('#audioPlayer');
function loadAudio(file){if(!file||!file.type.startsWith('audio/'))return toast('Pilih file audio.');if(state.audio?.url?.startsWith('blob:'))URL.revokeObjectURL(state.audio.url);const url=URL.createObjectURL(file);state.audio={file,url,name:file.name,r2Key:null,uploadPromise:null};player.src=url;$('#audioTitle').textContent=file.name;$('#audioMeta').textContent=`${(file.size/1024/1024).toFixed(2)} MB • menunggu metadata`;$('#audioStrip').classList.add('show');buildWave();player.onloadedmetadata=()=>{state.audioDuration=player.duration||0;$('#audioTime').textContent=fmt(state.audioDuration);updateStats()};if(state.api)state.audio.uploadPromise=uploadAudio(file);setStep(1);toast('Musik siap.')}
input.onchange=e=>loadAudio(e.target.files[0]);['dragenter','dragover'].forEach(x=>drop.addEventListener(x,e=>{e.preventDefault();drop.classList.add('drag')}));['dragleave','drop'].forEach(x=>drop.addEventListener(x,e=>{e.preventDefault();drop.classList.remove('drag')}));drop.addEventListener('drop',e=>loadAudio(e.dataTransfer.files[0]));
$('#audioPlay').onclick=()=>{if(!player.src)return;player.paused?player.play():player.pause()};player.onplay=()=>$('#audioPlay').innerHTML='<i class="fa-solid fa-pause"></i>';player.onpause=()=>$('#audioPlay').innerHTML='<i class="fa-solid fa-play"></i>';player.ontimeupdate=()=>$('#audioTime').textContent=`${fmt(player.currentTime)} / ${fmt(state.audioDuration)}`;
$('#storyboardBtn').onclick=makeStoryboard;$('#resetScenes').onclick=()=>{state.scenes=[];renderScenes();setStep(1)};$('#addSceneBtn').onclick=()=>{const i=state.scenes.length;state.scenes.push({id:`manual_${Date.now()}`,index:i,title:`Scene ${i+1}`,start:i*state.duration,duration:state.duration,prompt:'Prompt visual manual, cinematic music video.'});renderScenes();setStep(2)};
$$('#styleGrid .style').forEach(b=>b.onclick=()=>{$$('#styleGrid .style').forEach(x=>x.classList.remove('active'));b.classList.add('active');state.style=b.dataset.style});
$$('#ratioGroup button').forEach(b=>b.onclick=()=>{$$('#ratioGroup button').forEach(x=>x.classList.remove('active'));b.classList.add('active');state.ratio=b.dataset.value;renderScenes()});
$$('#priorityGroup button').forEach(b=>b.onclick=()=>{$$('#priorityGroup button').forEach(x=>x.classList.remove('active'));b.classList.add('active');state.priority=b.dataset.value});
$$('#vendorList .vendor').forEach(b=>b.onclick=()=>{$$('#vendorList .vendor').forEach(x=>x.classList.remove('active'));b.classList.add('active');state.vendor=b.dataset.vendor;syncGoogleModelVisibility();setStep(3);updateStats();renderScenes()});
$('#googleModel')?.addEventListener('change',e=>{state.googleModel=e.target.value;const m=$('#modalGoogleModel');if(m)m.value=state.googleModel;});
$('#resolution').onchange=e=>state.resolution=e.target.value;$('#sceneDuration').onchange=e=>{state.duration=Number(e.target.value);state.scenes.forEach((s,i)=>{s.duration=state.duration;s.start=i*state.duration});renderScenes()};
$('#generateBtn').onclick=generate;$('#saveDraftBtn')?.addEventListener('click',saveDraft);$('#newProjectBtn')?.addEventListener('click',()=>newProject(true));$('#connectDrive').onclick=connectDrive;$('#testDrive')?.addEventListener('click',testDriveConnection);$('#archiveDrive')?.addEventListener('click',()=>archiveCompletedScenes());$('#disconnectDrive')?.addEventListener('click',disconnectGoogleDrive);$('#driveQuick').onclick=()=>{$('[data-tab="storage"]').click()};$('#exportBtn').onclick=exportProject;$('#dismissNotice').onclick=()=>$('#notice').remove();
$('#themeToggle')?.addEventListener('click',()=>{const theme=toggleTheme();const prefs=readPrefs();prefs.theme=theme;try{localStorage.setItem('vidgen:prefs',JSON.stringify(prefs))}catch{};toast(theme==='dark'?'Mode gelap aktif.':'Mode terang aktif.')});
$('#genreSelect')?.addEventListener('change',syncGenreField);
syncGenreField();
$('#assetInput')?.addEventListener('change',e=>uploadAssets(e.target.files));
$('#quickReferenceUpload')?.addEventListener('click',()=>{state.referenceUploadAutoSelect=true;$('#assetInput')?.click()});
$('#pickReference')?.addEventListener('click',()=>{$('[data-tab="assets"]')?.click();toast('Pilih salah satu gambar lalu tekan Pakai.')});
$('#clearReference')?.addEventListener('click',()=>{state.referenceAsset=null;renderAssets();toast('Reference image dilepas.')});
$('#refreshJobs')?.addEventListener('click',()=>refreshJobs(false));
$('#modalX').onclick=closeModal;$('#regenerateScene')?.addEventListener('click',regenerateScene);$('#modal').onclick=e=>{if(e.target.id==='modal')closeModal()};$('#saveScene').onclick=()=>{const s=state.scenes.find(x=>x.id===state.editing);if(!s)return;s.title=$('#modalSceneTitle').value.trim()||s.title;s.prompt=$('#modalPrompt').value.trim()||s.prompt;renderScenes();closeModal();toast('Scene diperbarui.')};$('#deleteScene').onclick=()=>{state.scenes=state.scenes.filter(x=>x.id!==state.editing).map((s,i)=>({...s,index:i,start:i*state.duration}));renderScenes();closeModal();toast('Scene dihapus.')};
$$('.nav-item').forEach(b=>b.onclick=()=>{$$('.nav-item').forEach(x=>x.classList.remove('active'));b.classList.add('active');$$('.view').forEach(v=>v.classList.remove('active'));$(`#view-${b.dataset.tab}`).classList.add('active');window.scrollTo({top:0,behavior:'smooth'})});
// VIDGEN extra UI features 2026-09-22
const DEFAULT_PREFS={theme:'light',ratio:'16:9',resolution:'1080p',duration:8,vendor:'auto',googleModel:'veo-3.1-generate-preview',drive:true};
function readPrefs(){try{return {...DEFAULT_PREFS,theme:currentTheme(),...JSON.parse(localStorage.getItem('vidgen:prefs')||'{}')}}catch{return {...DEFAULT_PREFS,theme:currentTheme()}}}
function applyPrefs(p=readPrefs()){
  state.ratio=p.ratio; state.resolution=p.resolution; state.duration=Number(p.duration)||8; state.vendor=p.vendor||'auto'; state.googleModel=p.googleModel||'veo-3.1-generate-preview';
  applyTheme(p.theme||currentTheme(),{persist:false});
  const st=$('#settingTheme'),sr=$('#settingRatio'),sres=$('#settingResolution'),sd=$('#settingDuration'),sv=$('#settingVendor'),sgm=$('#settingGoogleModel'),sg=$('#settingDrive');
  if(st)st.value=currentTheme();if(sr)sr.value=state.ratio;if(sres)sres.value=state.resolution;if(sd)sd.value=String(state.duration);if(sv)sv.value=state.vendor;if(sgm)sgm.value=state.googleModel;if(sg)sg.checked=p.drive!==false;
  const r=$('#resolution'),d=$('#sceneDuration'),drive=$('#driveSaveToggle');if(r)r.value=state.resolution;if(d)d.value=String(state.duration);if(drive)drive.checked=p.drive!==false;
  $$('#ratioGroup button').forEach(b=>b.classList.toggle('active',b.dataset.value===state.ratio));
  $$('#vendorList .vendor').forEach(b=>b.classList.toggle('active',b.dataset.vendor===state.vendor));
  syncGoogleModelVisibility();updateStats();
}
function renderHistory(){
  const box=$('#historyList');if(!box)return;
  const rows=[...(state.projects||[])];
  box.innerHTML=rows.length?rows.map(p=>`<div class="history-row"><div class="history-icon"><i class="fa-solid fa-film"></i></div><div><b>${esc(p.title||'Untitled Project')}</b><small>${esc(p.aspect_ratio||state.ratio)} • ${esc(p.resolution||state.resolution)} • ${esc(p.status||'draft')}</small></div><em>${p.created_at?new Date(p.created_at).toLocaleString('id-ID'):'Project'}</em></div>`).join(''):'<div class="empty">Belum ada riwayat proyek.</div>';
}
$$('.template-preset').forEach(b=>b.onclick=()=>{
  setGenreValue(b.dataset.genre||'');$('#conceptInput').value=b.dataset.concept||'';
  state.style=b.dataset.style||'cinematic';state.ratio=b.dataset.ratio||'16:9';state.duration=Number(b.dataset.duration||8);
  $$('#styleGrid .style').forEach(x=>x.classList.toggle('active',x.dataset.style===state.style));
  $$('#ratioGroup button').forEach(x=>x.classList.toggle('active',x.dataset.value===state.ratio));
  $('#sceneDuration').value=String(state.duration);
  $('[data-tab="create"]').click();toast('Template diterapkan.');
});
$$('.prompt-preset').forEach(b=>b.onclick=()=>{const target=$('#conceptInput');target.value=(target.value?target.value+' ':'')+(b.dataset.prompt||'');$('[data-tab="create"]').click();target.focus();toast('Prompt ditambahkan ke konsep video.')});
$('#refreshHistory')?.addEventListener('click',()=>{renderHistory();toast('Riwayat diperbarui.')});
$('#settingTheme')?.addEventListener('change',e=>applyTheme(e.target.value));
$('#saveSettings')?.addEventListener('click',()=>{
  const p={theme:$('#settingTheme').value,ratio:$('#settingRatio').value,resolution:$('#settingResolution').value,duration:Number($('#settingDuration').value),vendor:$('#settingVendor').value,googleModel:$('#settingGoogleModel').value,drive:$('#settingDrive').checked};
  localStorage.setItem('vidgen:prefs',JSON.stringify(p));applyTheme(p.theme);applyPrefs(p);toast('Pengaturan disimpan.');
});
$('#resetSettings')?.addEventListener('click',()=>{localStorage.removeItem('vidgen:prefs');applyTheme(DEFAULT_PREFS.theme);applyPrefs(DEFAULT_PREFS);toast('Pengaturan dikembalikan ke default.')});
applyTheme(currentTheme(),{persist:false});
applyPrefs();
renderHistory();

if(new URLSearchParams(location.search).get('drive')==='connected'){toast('Google Drive berhasil terhubung.');history.replaceState({},'',location.pathname)}
if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});
renderCurrentReference();bootstrap();renderScenes();renderJobs();

