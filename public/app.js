const state={api:false,providers:[],projects:[],drive:{connected:false},scenes:[],jobs:[],style:'cinematic',ratio:'16:9',resolution:'1080p',duration:8,priority:'quality',vendor:'auto',audio:null,audioDuration:0,currentProjectId:null,editing:null};
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const toast=m=>{const e=$('#toast');e.textContent=m;e.classList.add('show');clearTimeout(window.__toast);window.__toast=setTimeout(()=>e.classList.remove('show'),2300)};
const esc=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const fmt=n=>{n=Math.max(0,Math.round(n||0));return `${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`};
async function api(path,opt={}){const r=await fetch(path,{...opt,headers:{'content-type':'application/json',...(opt.headers||{})}});if(!r.ok)throw new Error((await r.json().catch(()=>({}))).error||`HTTP ${r.status}`);return r.json()}
function buildWave(){const w=$('#wave');w.innerHTML='';for(let i=0;i<90;i++){const b=document.createElement('i');b.style.height=`${5+Math.random()*20}px`;w.appendChild(b)}}buildWave();
function setStep(n){$$('.step').forEach((e,i)=>e.classList.toggle('active',i<n))}
function updateStats(){
  $('#sceneCount').textContent=state.scenes.length;$('#projectCount').textContent=state.projects.length+(state.currentProjectId?0:0);$('#driveKpi').textContent=state.drive.connected?'Aktif':'Belum';$('#routerKpi').textContent=state.vendor==='auto'?'Auto':state.vendor[0].toUpperCase()+state.vendor.slice(1);
  const total=state.scenes.reduce((a,s)=>a+Number(s.duration||0),0);$('#estimate').textContent=`${state.scenes.length} scene • ${fmt(total)}`;$('#jobCount').textContent=`${state.jobs.length} job`;
}
async function bootstrap(){
  try{const data=await api('/api/bootstrap');state.api=true;state.providers=data.providers||[];state.projects=data.projects||[];state.drive=data.drive||{connected:false};$('#cloudState').className='cloud-state ok';$('#cloudState').innerHTML='<span></span><b>Cloudflare API</b>';$('#backendMode').textContent='Cloudflare Worker';renderProviders();renderProjects();renderDrive();}
  catch(e){state.api=false;state.backendError=true;state.providers=['seedance','veo','runway','luma'].map(id=>({id,name:id[0].toUpperCase()+id.slice(1),configured:false,strengths:['demo mode']}));$('#cloudState').className='cloud-state demo';$('#cloudState').innerHTML='<span></span><b>Server tidak tersedia</b>';$('#backendMode').textContent='Koneksi gagal — muat ulang untuk mencoba lagi';$('#generateBtn').disabled=true;toast('Tidak dapat terhubung ke server. Muat ulang untuk mencoba lagi.');renderProviders();}
  updateStats();
}
function renderProviders(){const box=$('#providerGrid');box.innerHTML=state.providers.map(p=>`<div class="provider-card"><b>${esc(p.name)}</b><small>Model: ${esc(p.model||'configurable')}</small><small>${esc((p.strengths||[]).join(' • '))}</small><span class="status ${p.configured?'ok':''}">${p.configured?'API configured':'Demo / belum ada key'}</span></div>`).join('')||'<div class="empty">Provider belum tersedia.</div>'}
function renderProjects(){const box=$('#projectGrid');if(!state.projects.length){box.innerHTML='<div class="empty">Belum ada proyek tersimpan.</div>';return}box.innerHTML=state.projects.map(p=>`<div class="project-card"><div class="project-cover"></div><b>${esc(p.title)}</b><small>${esc(p.aspect_ratio||'16:9')} • ${esc(p.resolution||'1080p')} • ${esc(p.status||'draft')}</small><small>${new Date(p.created_at).toLocaleString('id-ID')}</small></div>`).join('')}
function renderDrive(){const connected=state.drive.connected;$('#driveKpi').textContent=connected?'Aktif':'Belum';$('#driveTitle').textContent=connected?(state.drive.name||state.drive.email||'Terhubung'):'Belum terhubung';$('#driveText').textContent=connected?`Google Drive siap. Output akan diarsipkan ke folder VIDGEN${state.drive.email?' • '+state.drive.email:''}.`:'Hubungkan Google Drive untuk menyimpan video final, storyboard dan thumbnail.';$('#connectDrive').textContent=connected?'Google Drive Terhubung ✓':'Hubungkan Google Drive'}
function localStoryboard(){const count=Math.max(6,Math.min(24,state.audioDuration?Math.ceil(state.audioDuration/state.duration):8));const labels=['Intro','Verse 1','Build','Chorus','Verse 2','Transition','Bridge','Final Chorus','Outro'];const genre=$('#genreInput').value||'music video';const concept=$('#conceptInput').value||'cinematic performance and emotional storytelling';return Array.from({length:count},(_,i)=>{const title=labels[Math.min(labels.length-1,Math.floor(i*labels.length/count))];return{id:`local_${Date.now()}_${i}`,index:i,title,start:i*state.duration,duration:state.duration,prompt:`${concept}. ${title}. ${genre}. ${state.style} music video, coherent character identity, consistent wardrobe, cinematic lighting, intentional camera movement, no text or watermark.`}})}
async function makeStoryboard(){
  const payload={genre:$('#genreInput').value,concept:$('#conceptInput').value,style:state.style,sceneDuration:state.duration,sceneCount:state.audioDuration?Math.ceil(state.audioDuration/state.duration):8};
  try{state.scenes=state.api?(await api('/api/storyboard',{method:'POST',body:JSON.stringify(payload)})).scenes:localStoryboard()}catch(e){toast(e.message);return}
  renderScenes();setStep(2);toast(`Storyboard dibuat: ${state.scenes.length} scene`)
}
function renderScenes(){
  const list=$('#sceneList'),tl=$('#timeline');if(!state.scenes.length){list.innerHTML='<div class="empty">Storyboard belum dibuat.</div>';tl.innerHTML='<div class="empty">Scene akan muncul di timeline.</div>';updateStats();return}
  list.innerHTML=state.scenes.map((s,i)=>`<div class="scene-row"><div class="scene-num">${String(i+1).padStart(2,'0')}</div><div class="scene-copy"><b>${esc(s.title)}</b><small>${fmt(s.start)} • ${s.duration}s • ${esc(s.prompt)}</small></div><div class="scene-actions"><button data-edit="${esc(s.id)}">✎</button></div></div>`).join('');
  tl.innerHTML=state.scenes.map((s,i)=>`<div class="timeline-item"><div class="timeline-thumb"></div><b>${String(i+1).padStart(2,'0')} • ${esc(s.title)}</b><small>${fmt(s.start)}–${fmt(Number(s.start)+Number(s.duration))} • ${state.ratio}</small><small>${state.vendor==='auto'?'Auto Router':esc(state.vendor)}</small></div>`).join('');
  $$('[data-edit]').forEach(b=>b.onclick=()=>openScene(b.dataset.edit));updateStats()
}
function openScene(id){const s=state.scenes.find(x=>x.id===id);if(!s)return;state.editing=id;$('#modalTitle').textContent=s.title;$('#modalSceneTitle').value=s.title;$('#modalPrompt').value=s.prompt;$('#modal').classList.add('show')}
function closeModal(){$('#modal').classList.remove('show');state.editing=null}
function renderJobs(){const box=$('#jobList');if(!state.jobs.length){box.innerHTML='<div class="empty">Belum ada job.</div>';updateStats();return}box.innerHTML=state.jobs.map((j,i)=>`<div class="job"><div class="job-head"><b>Scene ${i+1} • ${esc(j.provider||'auto')}</b><span>${esc(j.error?'Gagal':j.demo?'Demo':j.status||'Submitted')}</span></div><div class="progress"><i style="width:${j.error?5:j.demo?32:12}%"></i></div></div>`).join('');updateStats()}
async function saveProject(){
  const p={title:$('#projectTitle').value||'Videoclip Baru',genre:$('#genreInput').value,concept:$('#conceptInput').value,duration:state.audioDuration,style:state.style,aspectRatio:state.ratio,resolution:state.resolution,vendor:state.vendor,priority:state.priority,saveToDrive:$('#driveSaveToggle').checked,scenes:state.scenes};
  if(!state.api)return `demo_${Date.now()}`;const r=await api('/api/projects',{method:'POST',body:JSON.stringify(p)});state.projects.unshift({id:r.id,title:p.title,status:'draft',aspect_ratio:p.aspectRatio,resolution:p.resolution,created_at:new Date().toISOString()});renderProjects();if(typeof renderHistory==='function')renderHistory();updateStats();return r.id
}
async function generate(){if(!state.api)return toast('Server belum terhubung. Muat ulang untuk mencoba lagi.');if(!state.scenes.length)return toast('Buat storyboard terlebih dahulu.');$('#generateBtn').disabled=true;$('#generateBtn').textContent='Menyiapkan render…';try{state.currentProjectId=await saveProject();if(state.api){const r=await api('/api/generate',{method:'POST',body:JSON.stringify({projectId:state.currentProjectId})});state.jobs=r.jobs||[]}else{const route={quality:['seedance','veo','runway','luma'],balanced:['seedance','runway','veo','luma'],speed:['runway','luma','seedance','veo'],cost:['luma','seedance','runway','veo']}[state.priority];state.jobs=state.scenes.map((s,i)=>({provider:state.vendor==='auto'?route[i%route.length]:state.vendor,demo:true,status:'demo'}))}renderJobs();setStep(4);toast(state.jobs.every(j=>j.demo)?'Simulasi dibuat. Belum ada video yang dihasilkan.':state.jobs.every(j=>j.error)?'Semua proses gagal. Periksa konfigurasi provider.':'Permintaan video dikirim.')}catch(e){toast(e.message)}finally{$('#generateBtn').disabled=false;$('#generateBtn').textContent='🚀 Generate Music Video'}}
async function connectDrive(){if(!state.api)return toast('Deploy Worker terlebih dahulu untuk OAuth Google Drive.');if(state.drive.connected)return toast('Google Drive sudah terhubung.');try{const r=await api('/api/drive/connect');location.href=r.authUrl}catch(e){toast(e.message)}}
function exportProject(){const data={app:'VIDGEN',version:'1.0.4',title:$('#projectTitle').value,genre:$('#genreInput').value,concept:$('#conceptInput').value,settings:{style:state.style,ratio:state.ratio,resolution:state.resolution,sceneDuration:state.duration,priority:state.priority,vendor:state.vendor,fallback:$('#fallbackToggle').checked,saveToDrive:$('#driveSaveToggle').checked},scenes:state.scenes};const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));a.download='VIDGEN-project.json';a.click();toast('Project JSON diekspor.')}
const input=$('#audioInput'),drop=$('#dropzone'),player=$('#audioPlayer');
function loadAudio(file){if(!file||!file.type.startsWith('audio/'))return toast('Pilih file audio.');if(state.audio?.url)URL.revokeObjectURL(state.audio.url);const url=URL.createObjectURL(file);state.audio={file,url};player.src=url;$('#audioTitle').textContent=file.name;$('#audioMeta').textContent=`${(file.size/1024/1024).toFixed(2)} MB • siap dianalisis`;$('#audioStrip').classList.add('show');buildWave();player.onloadedmetadata=()=>{state.audioDuration=player.duration||0;$('#audioTime').textContent=fmt(state.audioDuration);updateStats()};setStep(1);toast('Musik siap.')}
input.onchange=e=>loadAudio(e.target.files[0]);['dragenter','dragover'].forEach(x=>drop.addEventListener(x,e=>{e.preventDefault();drop.classList.add('drag')}));['dragleave','drop'].forEach(x=>drop.addEventListener(x,e=>{e.preventDefault();drop.classList.remove('drag')}));drop.addEventListener('drop',e=>loadAudio(e.dataTransfer.files[0]));
$('#audioPlay').onclick=()=>{if(!player.src)return;player.paused?player.play():player.pause()};player.onplay=()=>$('#audioPlay').textContent='Ⅱ';player.onpause=()=>$('#audioPlay').textContent='▶';player.ontimeupdate=()=>$('#audioTime').textContent=`${fmt(player.currentTime)} / ${fmt(state.audioDuration)}`;
$('#storyboardBtn').onclick=makeStoryboard;$('#resetScenes').onclick=()=>{state.scenes=[];renderScenes();setStep(1)};$('#addSceneBtn').onclick=()=>{const i=state.scenes.length;state.scenes.push({id:`manual_${Date.now()}`,index:i,title:`Scene ${i+1}`,start:i*state.duration,duration:state.duration,prompt:'Prompt visual manual, cinematic music video.'});renderScenes();setStep(2)};
$$('#styleGrid .style').forEach(b=>b.onclick=()=>{$$('#styleGrid .style').forEach(x=>x.classList.remove('active'));b.classList.add('active');state.style=b.dataset.style});
$$('#ratioGroup button').forEach(b=>b.onclick=()=>{$$('#ratioGroup button').forEach(x=>x.classList.remove('active'));b.classList.add('active');state.ratio=b.dataset.value;renderScenes()});
$$('#priorityGroup button').forEach(b=>b.onclick=()=>{$$('#priorityGroup button').forEach(x=>x.classList.remove('active'));b.classList.add('active');state.priority=b.dataset.value});
$$('#vendorList .vendor').forEach(b=>b.onclick=()=>{$$('#vendorList .vendor').forEach(x=>x.classList.remove('active'));b.classList.add('active');state.vendor=b.dataset.vendor;setStep(3);updateStats();renderScenes()});
$('#resolution').onchange=e=>state.resolution=e.target.value;$('#sceneDuration').onchange=e=>{state.duration=Number(e.target.value);state.scenes.forEach((s,i)=>{s.duration=state.duration;s.start=i*state.duration});renderScenes()};
$('#generateBtn').onclick=generate;$('#connectDrive').onclick=connectDrive;$('#driveQuick').onclick=()=>{$('[data-tab="storage"]').click()};$('#exportBtn').onclick=exportProject;$('#dismissNotice').onclick=()=>$('#notice').remove();
$('#modalX').onclick=closeModal;$('#modal').onclick=e=>{if(e.target.id==='modal')closeModal()};$('#saveScene').onclick=()=>{const s=state.scenes.find(x=>x.id===state.editing);if(!s)return;s.title=$('#modalSceneTitle').value.trim()||s.title;s.prompt=$('#modalPrompt').value.trim()||s.prompt;renderScenes();closeModal();toast('Scene diperbarui.')};$('#deleteScene').onclick=()=>{state.scenes=state.scenes.filter(x=>x.id!==state.editing).map((s,i)=>({...s,index:i,start:i*state.duration}));renderScenes();closeModal();toast('Scene dihapus.')};
$$('.nav-item').forEach(b=>b.onclick=()=>{$$('.nav-item').forEach(x=>x.classList.remove('active'));b.classList.add('active');$$('.view').forEach(v=>v.classList.remove('active'));$(`#view-${b.dataset.tab}`).classList.add('active');window.scrollTo({top:0,behavior:'smooth'})});
// VIDGEN extra UI features 2026-09-22
const DEFAULT_PREFS={ratio:'16:9',resolution:'1080p',duration:8,vendor:'auto',drive:true};
function readPrefs(){try{return {...DEFAULT_PREFS,...JSON.parse(localStorage.getItem('vidgen:prefs')||'{}')}}catch{return {...DEFAULT_PREFS}}}
function applyPrefs(p=readPrefs()){
  state.ratio=p.ratio; state.resolution=p.resolution; state.duration=Number(p.duration)||8; state.vendor=p.vendor||'auto';
  const sr=$('#settingRatio'),sres=$('#settingResolution'),sd=$('#settingDuration'),sv=$('#settingVendor'),sg=$('#settingDrive');
  if(sr)sr.value=state.ratio;if(sres)sres.value=state.resolution;if(sd)sd.value=String(state.duration);if(sv)sv.value=state.vendor;if(sg)sg.checked=p.drive!==false;
  const r=$('#resolution'),d=$('#sceneDuration'),drive=$('#driveSaveToggle');if(r)r.value=state.resolution;if(d)d.value=String(state.duration);if(drive)drive.checked=p.drive!==false;
  $('#ratioGroup button').forEach(b=>b.classList.toggle('active',b.dataset.value===state.ratio));
  $('#vendorList .vendor').forEach(b=>b.classList.toggle('active',b.dataset.vendor===state.vendor));
  updateStats();
}
function renderHistory(){
  const box=$('#historyList');if(!box)return;
  const rows=[...(state.projects||[])];
  box.innerHTML=rows.length?rows.map(p=>`<div class="history-row"><div class="history-icon">▶</div><div><b>${esc(p.title||'Untitled Project')}</b><small>${esc(p.aspect_ratio||state.ratio)} • ${esc(p.resolution||state.resolution)} • ${esc(p.status||'draft')}</small></div><em>${p.created_at?new Date(p.created_at).toLocaleString('id-ID'):'Project'}</em></div>`).join(''):'<div class="empty">Belum ada riwayat proyek.</div>';
}
$('.template-preset').forEach(b=>b.onclick=()=>{
  $('#genreInput').value=b.dataset.genre||'';$('#conceptInput').value=b.dataset.concept||'';
  state.style=b.dataset.style||'cinematic';state.ratio=b.dataset.ratio||'16:9';state.duration=Number(b.dataset.duration||8);
  $('#styleGrid .style').forEach(x=>x.classList.toggle('active',x.dataset.style===state.style));
  $('#ratioGroup button').forEach(x=>x.classList.toggle('active',x.dataset.value===state.ratio));
  $('#sceneDuration').value=String(state.duration);
  $('[data-tab="create"]').click();toast('Template diterapkan.');
});
$('.prompt-preset').forEach(b=>b.onclick=()=>{const target=$('#conceptInput');target.value=(target.value?target.value+' ':'')+(b.dataset.prompt||'');$('[data-tab="create"]').click();target.focus();toast('Prompt ditambahkan ke konsep video.')});
$('#refreshHistory')?.addEventListener('click',()=>{renderHistory();toast('Riwayat diperbarui.')});
$('#saveSettings')?.addEventListener('click',()=>{
  const p={ratio:$('#settingRatio').value,resolution:$('#settingResolution').value,duration:Number($('#settingDuration').value),vendor:$('#settingVendor').value,drive:$('#settingDrive').checked};
  localStorage.setItem('vidgen:prefs',JSON.stringify(p));applyPrefs(p);toast('Pengaturan disimpan.');
});
$('#resetSettings')?.addEventListener('click',()=>{localStorage.removeItem('vidgen:prefs');applyPrefs(DEFAULT_PREFS);toast('Pengaturan dikembalikan ke default.')});
applyPrefs();
renderHistory();

if(new URLSearchParams(location.search).get('drive')==='connected'){toast('Google Drive berhasil terhubung.');history.replaceState({},'',location.pathname)}
if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});
bootstrap();renderScenes();renderJobs();

