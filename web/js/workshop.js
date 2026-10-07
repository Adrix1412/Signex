// @ts-check
import {parsePackage, predict, train} from './packages.js';
import {normalizeLandmarks} from './utils.js';
import {FilesetResolver, HandLandmarker, DrawingUtils} from '../vendor/mediapipe/vision_bundle.mjs';
/** @template {HTMLElement} T @param {string} id @returns {T} */
function el(id) { const value=document.getElementById(id); if(!value) throw new Error(`Falta ${id}`); return /** @type {T} */(value); }
const video=/** @type {HTMLVideoElement} */(el('camera'));
const overlay=/** @type {HTMLCanvasElement} */(el('overlay'));
const offscreen=document.createElement('canvas');
const context=offscreen.getContext('2d'), drawContext=overlay.getContext('2d');
if(!context || !drawContext) throw new Error('Canvas no disponible.');
const drawer=new DrawingUtils(drawContext);
const language=/** @type {HTMLSelectElement} */(el('language'));
/** @type {import('./packages.js').SignPackage[]} */
let installed=[];
/** @type {number[][]} */ let samples=[];
/** @type {Awaited<ReturnType<typeof HandLandmarker.createFromOptions>> | null} */ let detector=null;
let running=false, busy=false, front=true, lastFrame=0, generation=0, lastVideoTime=-1;
let captureLeft=0, captureAt=0, captureDeadline=0;
let candidate='', candidateAt=0, displayed='', errors=0;
let token='', username='', offset=0;
/** @type {{id:string,owner:string,name:string,language:string,description:string}[]} */ let catalog=[];
function notice(message) { el('notice').textContent=message; }
function report(error) { notice(error instanceof Error ? error.message : 'No se pudo completar la operación.'); }
const STORE='signex.packages.v1';
const DRAFT_STORE='signex.training-draft.v1';
try { const raw=JSON.parse(localStorage.getItem(STORE)||'[]'); if(!Array.isArray(raw)||raw.length>100) throw new Error('Colección inválida.'); installed=raw.map(parsePackage); } catch(error) { report(error); }
function persist(next) {
  if(next.length>100) throw new Error('Máximo 100 paquetes instalados.');
  try { localStorage.setItem(STORE,JSON.stringify(next)); } catch { throw new Error('No hay espacio local. Exporta paquetes y elimina algunos.'); }
  installed=next; renderInstalled();
}

function saveDraft() {
  const draft = {
    language: language.value,
    name: /** @type {HTMLInputElement} */ (el('name')).value,
    description: /** @type {HTMLTextAreaElement} */ (el('description')).value,
    samples,
  };
  try { localStorage.setItem(DRAFT_STORE, JSON.stringify(draft)); }
  catch { notice('No se pudo guardar el borrador local. Descarga los paquetes terminados antes de borrar datos del navegador.'); }
}

function clearDraft() {
  samples=[];
  captureLeft=0;
  localStorage.removeItem(DRAFT_STORE);
  updateTrainingUi();
}

function restoreDraft() {
  try {
    const draft = JSON.parse(localStorage.getItem(DRAFT_STORE) || 'null');
    if (!draft || !Array.isArray(draft.samples)) return;
    const safeSamples = draft.samples.map(row => {
      if (!Array.isArray(row) || row.length !== 63 || row.some(value => typeof value !== 'number' || !Number.isFinite(value))) throw new Error('Borrador inválido.');
      return row;
    });
    if (typeof draft.language === 'string' && ['LESCO','ASL','CUSTOM'].includes(draft.language)) language.value=draft.language;
    if (typeof draft.name === 'string') /** @type {HTMLInputElement} */ (el('name')).value=draft.name.slice(0,60);
    if (typeof draft.description === 'string') /** @type {HTMLTextAreaElement} */ (el('description')).value=draft.description.slice(0,500);
    samples=safeSamples;
  } catch { localStorage.removeItem(DRAFT_STORE); }
}
function install(p) {
  const existing=installed.find(x=>x.language===p.language && x.name===p.name);
  if(existing && !confirm('Ya existe ese nombre en esta lengua. ¿Reemplazarlo?')) return;
  persist([...installed.filter(x=>x!==existing),p]);
  notice(`“${p.name}” agregada a tu colección.`);
}
function download(p) {
  const url=URL.createObjectURL(new Blob([JSON.stringify(p)],{type:'application/json'}));
  const a=document.createElement('a'); a.href=url; a.download=`${p.language}-${p.name.replace(/[^\p{L}\p{N}_-]/gu,'_')}.json`; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function button(label, action) {
  const b=document.createElement('button'); b.textContent=label;
  b.onclick=async()=>{b.disabled=true;try {await action();} catch(error){report(error);} finally {b.disabled=false;}}; return b;
}
function card(name, description, meta) {
  const article=document.createElement('article'); article.className='card';
  const h=document.createElement('h3'); h.textContent=name;
  const small=document.createElement('small'); small.textContent=meta;
  const p=document.createElement('p'); p.textContent=description;
  article.append(h,small,p); return article;
}
function renderInstalled() {
  const target=el('installed'); target.replaceChildren();
  const selected=installed.filter(p=>p.language===language.value);
  if(!selected.length) {target.textContent='Todavía no hay paquetes de esta lengua. Entrena uno o impórtalo desde el workshop.';return;}
  for(const p of selected) {
    const article=card(p.name,p.description,`${p.language} · ${p.samples.length} muestras · comunitaria`);
    const row=document.createElement('div'); row.className='row';
    row.append(button('Descargar',()=>download(p)),button('Publicar',async()=>{
      if(!token) throw new Error('Abre Workshop e inicia sesión para publicar.');
      if(!/** @type {HTMLInputElement} */(el('consent')).checked) throw new Error('Confirma el permiso de publicación en Workshop.');
      await api('/api/packages',{method:'POST',body:JSON.stringify({package:p,consent:true})}); notice('Paquete publicado.');
    }),button('Eliminar',()=>{if(confirm(`¿Eliminar ${p.name} de este navegador?`)) persist(installed.filter(x=>x!==p));}));
    article.append(row);target.append(article);
  }
}
async function api(path, options={}) {
  const response=await fetch(path,{...options,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},signal:AbortSignal.timeout(15000)});
  let data; try {data=await response.json();} catch {throw new Error('Workshop no disponible. Inicia serve.py; un servidor estático solo permite uso local.');}
  if(!response.ok) throw new Error(data.error||'No se pudo completar la solicitud.'); return data;
}
function renderCatalog() {
  const list=el('catalog-list');list.replaceChildren();
  const search=/** @type {HTMLInputElement} */(el('search')).value.toLowerCase();
  const matching=catalog.filter(p=>p.language===language.value && `${p.name} ${p.description} ${p.owner}`.toLowerCase().includes(search));
  if(!matching.length) list.textContent='No hay coincidencias entre los paquetes cargados. Puedes cargar más o publicar el primero.';
  for(const p of matching) {
    const article=card(p.name,p.description,`${p.language} · por ${p.owner} · sin revisión lingüística`);
    const row=document.createElement('div');row.className='row';
    row.append(button('Agregar a mi colección',async()=>install(parsePackage(await api(`/api/packages/${p.id}`)))),button('Descargar JSON',async()=>download(parsePackage(await api(`/api/packages/${p.id}`)))));
    if(p.owner===username) row.append(button('Retirar publicación',async()=>{if(confirm('¿Retirar del catálogo? Las copias descargadas seguirán existiendo.')){await api(`/api/packages/${p.id}`,{method:'DELETE'});await loadCatalog(true);}}));
    article.append(row);list.append(article);
  }
}
async function loadCatalog(reset) {
  const nextOffset=reset?0:offset;
  const data=await api(`/api/packages?offset=${nextOffset}`);
  catalog=reset?data.items:[...catalog,...data.items];offset=nextOffset+data.items.length;
  /** @type {HTMLButtonElement} */(el('more')).disabled=!data.more;renderCatalog();
}
function cameraControls() {
  /** @type {HTMLButtonElement} */(el('start')).disabled=running||busy;
  for(const id of ['stop','flip']) /** @type {HTMLButtonElement} */(el(id)).disabled=!running||busy;
  el('camera-placeholder').hidden=running;
  updateTrainingUi();
}
function stopCamera() {
  running=false;generation++;captureLeft=0;
  const stream=video.srcObject;if(stream instanceof MediaStream) stream.getTracks().forEach(t=>t.stop());
  video.srcObject=null;drawContext.clearRect(0,0,overlay.width,overlay.height);cameraControls();
  candidate='';displayed='';el('prediction').textContent='Sin seña';
  updateTrainingUi();
}
async function startCamera() {
  if(busy) return;busy=true;cameraControls();
  try {
    if(!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('La cámara requiere HTTPS, o acceso local desde el mismo equipo.');
    notice('Preparando cámara y detector…');
    if(!detector) {
      const vision=await FilesetResolver.forVisionTasks('vendor/mediapipe/wasm');
      const options={baseOptions:{modelAssetPath:'model/hand_landmarker.task',delegate:'GPU'},runningMode:'VIDEO',numHands:1};
      try {detector=await HandLandmarker.createFromOptions(vision,options);} catch {options.baseOptions.delegate='CPU';detector=await HandLandmarker.createFromOptions(vision,options);}
    }
    const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:front?'user':'environment'},width:{ideal:640},height:{ideal:480},frameRate:{ideal:20,max:30}},audio:false});
    video.srcObject=stream;await video.play();running=true;lastVideoTime=-1;errors=0;
    const mine=++generation;
    requestAnimationFrame(now=>frame(now,mine));notice('Cámara lista. Usa una mano; mantén la postura y retírala para repetir.');
  } catch(error) {stopCamera();report(error);} finally {busy=false;cameraControls();}
}
function frame(now,mine) {
  if(!running||mine!==generation) return;
  try {
    if(document.hidden || now-lastFrame<66 || video.currentTime===lastVideoTime) return;
    lastFrame=now;lastVideoTime=video.currentTime;
    if(!video.videoWidth||!detector) return;
    const w=video.videoWidth,h=video.videoHeight;
    if(offscreen.width!==w||offscreen.height!==h) {offscreen.width=overlay.width=w;offscreen.height=overlay.height=h;}
    context.save();context.scale(-1,1);context.drawImage(video,-w,0,w,h);context.restore();
    drawContext.clearRect(0,0,w,h);
    const result=detector.detectForVideo(offscreen,now), hand=result.landmarks[0];
    let matched=null;
    if(hand) {
      drawer.drawConnectors(hand,HandLandmarker.HAND_CONNECTIONS,{color:'#bddba5',lineWidth:2});
      drawer.drawLandmarks(hand,{color:'#f1b580',radius:3});
      const vector=Array.from(normalizeLandmarks(hand.flatMap(p=>[p.x,p.y,p.z]),w/h));
      if (captureLeft && now-captureAt>=400) {
        samples.push(vector);
        captureLeft--;
        captureAt=now;
        saveDraft();
        updateTrainingUi();
        if (!captureLeft) {
          const complete = samples.length >= 100;
          notice(complete ? `${samples.length} muestras listas. Puedes seguir capturando o entrenar y guardar.` : 'Ronda completa. Retira y vuelve a colocar la mano antes de la siguiente ronda.');
        }
      }
      matched=predict(installed,vector,language.value);
    }
    if(captureLeft && now>captureDeadline) {captureLeft=0;saveDraft();updateTrainingUi();notice('Captura pausada: no se detectó una mano completa. Conservamos las muestras ya tomadas.');}
    if(matched!==candidate) {candidate=matched;candidateAt=now;}
    if(now-candidateAt>700 && displayed!==candidate) {displayed=candidate;el('prediction').textContent=matched||'Sin seña';}
    errors=0;
  } catch(error) {if(++errors>=5){stopCamera();report(error);}}
  finally {if(running && mine===generation) requestAnimationFrame(next=>frame(next,mine));}
}
function updateTrainingUi() {
  const currentRound=Math.floor(samples.length / 10) + 1;
  const inRound=10-captureLeft;
  /** @type {HTMLProgressElement} */(el('progress')).value=samples.length;
  el('count').textContent=`${samples.length} muestras (mínimo 100, sin límite de rondas)`;
  el('sample-dots').replaceChildren(...Array.from({length:100},(_,index)=>{
    const dot=document.createElement('span');
    dot.className=index < samples.length ? 'done' : (captureLeft && index === samples.length ? 'current' : '');
    return dot;
  }));
  for (const round of Array.from({length:10},(_,index)=>index+1)) {
    const node=el(`training`).querySelector(`[data-round="${round}"]`);
    if (node instanceof HTMLElement) node.className=samples.length >= round * 10 ? 'done' : round === currentRound ? 'active' : '';
  }
  for (const line of el('training').querySelectorAll('.rounds i')) {
    const index=Array.from(el('training').querySelectorAll('.rounds i')).indexOf(line);
    line.classList.toggle('done', samples.length >= (index + 1) * 10);
  }
  const capture=/** @type {HTMLButtonElement} */(el('capture'));
  const trainButton=/** @type {HTMLButtonElement} */(el('train'));
  const state=el('training-state');
  const detail=el('training-detail');
  if (captureLeft) {
    capture.disabled=true;
    capture.textContent=`Capturando ronda ${currentRound}: ${inRound} / 10`;
    state.textContent='Capturando una muestra cada 0,4 segundos…';
    detail.textContent=`Muestra ${samples.length + 1}. Mantén la misma postura.`;
  } else {
    capture.disabled=!running;
    capture.textContent=`Tomar ronda ${currentRound}: 10 muestras`;
    state.textContent=running ? `Listo para la ronda ${currentRound}.` : 'Activa la cámara para continuar.';
    detail.textContent=`${samples.length} muestras guardadas automáticamente. Puedes seguir después de 100.`;
  }
  trainButton.disabled=samples.length < 100 || captureLeft !== 0;
}
for(const b of document.querySelectorAll('nav button')) b.addEventListener('click',()=>{
  const tab=/** @type {HTMLElement} */(b).dataset.tab;
  for(const id of ['practice','training','catalog']) el(id).hidden=id!==tab;
  for(const sibling of document.querySelectorAll('nav button')) sibling.setAttribute('aria-pressed',String(sibling===b));
  if(tab!=='training' && captureLeft) {captureLeft=0;saveDraft();updateTrainingUi();}
  if(tab==='catalog') loadCatalog(true).catch(report);
});
el('start').onclick=startCamera;el('stop').onclick=()=>{stopCamera();notice('Cámara apagada.');};
el('flip').onclick=async()=>{stopCamera();front=!front;await startCamera();};
el('hide').onclick=()=>{const hidden=el('camera').parentElement.classList.toggle('privacy');el('hide').textContent=hidden?'Mostrar video':'Ocultar video';notice(hidden?'Video oculto; el reconocimiento continúa.':'Video visible.');};
el('capture').onclick=()=>{
  if(!running){notice('Primero pulsa “Activar cámara”.');return;}
  if(captureLeft)return;
  captureLeft=10;
  captureAt=0;
  captureDeadline=performance.now()+20000;
  updateTrainingUi();
  notice(`Ronda ${Math.floor(samples.length/10)+1}: mantén la postura. Verás cada muestra marcada abajo.`);
};
el('reset').onclick=()=>{if(samples.length && !confirm('¿Borrar las muestras de este borrador?'))return;clearDraft();el('saved-result').hidden=true;notice('Borrador reiniciado.');};
el('train').onclick=()=>{try {
  if(samples.length<100||captureLeft) throw new Error('Captura al menos 100 muestras antes de entrenar.');
  const packageData=train(/** @type {HTMLInputElement} */(el('name')).value,language.value,/** @type {HTMLTextAreaElement} */(el('description')).value,samples);
  install(packageData);
  localStorage.removeItem(DRAFT_STORE);
  samples=[];
  updateTrainingUi();
  const result=el('saved-result');
  result.hidden=false;
  result.replaceChildren('✓ Seña guardada en tu colección. ',button('Descargar mi paquete JSON',()=>download(packageData)));
  notice(`“${packageData.name}” fue entrenada y guardada correctamente.`);
}catch(error){report(error);}};
for(const field of ['name','description']) el(field).addEventListener('input',()=>{saveDraft();updateTrainingUi();});
language.onchange=()=>{if(samples.length && !confirm('Cambiar de lengua reinicia el borrador actual. ¿Continuar?')){restoreDraft();return;}clearDraft();candidate='';el('prediction').textContent='Sin seña';renderInstalled();renderCatalog();};
el('import').onchange=async event=>{const input=/** @type {HTMLInputElement} */(event.target);try {const file=input.files?.[0];if(!file)return;if(file.size>20000000)throw new Error('Paquete demasiado grande (máximo 20 MB para compartir).');install(parsePackage(JSON.parse(await file.text())));}catch(error){report(error);}finally{input.value='';}};
for(const action of ['register','login']) el(action).onclick=async()=>{try {const data=await api(`/api/${action}`,{method:'POST',body:JSON.stringify({username:/** @type {HTMLInputElement} */(el('username')).value,password:/** @type {HTMLInputElement} */(el('password')).value})});token=data.token;username=data.username;/** @type {HTMLInputElement} */(el('password')).value='';el('account').textContent=`Sesión: ${username}`;renderCatalog();notice('Sesión iniciada. Publica desde los botones de tu colección.');}catch(error){report(error);}};
el('logout').onclick=async()=>{try {if(token) await api('/api/logout',{method:'POST',body:'{}'});token='';username='';el('account').textContent='Sin sesión';renderCatalog();}catch(error){report(error);}};
el('refresh').onclick=()=>loadCatalog(true).catch(report);el('more').onclick=()=>loadCatalog(false).catch(report);el('search').oninput=renderCatalog;
window.addEventListener('pagehide',stopCamera);
document.addEventListener('visibilitychange',()=>{if(document.hidden&&captureLeft){captureLeft=0;saveDraft();updateTrainingUi();notice('Captura pausada. El borrador se guardó automáticamente.');}});
restoreDraft();
renderInstalled();
updateTrainingUi();
