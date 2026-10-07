// @ts-check
/** @typedef {{schema:string,name:string,language:string,description:string,samples:number[][],radius:number}} SignPackage */
export const SCHEMA = 'signex.handshape.v1';
/** @param {unknown} raw @returns {SignPackage} */
export function parsePackage(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Paquete inválido.');
  const p = /** @type {SignPackage} */ (raw);
  if (p.schema !== SCHEMA || typeof p.name !== 'string' || !p.name.trim() || p.name.length > 60 || /[\x00-\x1f]/.test(p.name)) throw new Error('Nombre o formato inválido.');
  if (!['LESCO','ASL','CUSTOM'].includes(p.language)) throw new Error('Lengua inválida.');
  if (typeof p.description !== 'string' || p.description.length > 500) throw new Error('Descripción inválida.');
  if (!Array.isArray(p.samples) || p.samples.length < 20 || p.samples.some(r => !Array.isArray(r) || r.length !== 63 || r.some(v => typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v)>10))) throw new Error('Se requieren al menos 20 muestras válidas de 63 coordenadas.');
  if (typeof p.radius !== 'number' || !Number.isFinite(p.radius) || p.radius < .03 || p.radius > .15) throw new Error('Umbral inválido.');
  return {schema:SCHEMA,name:p.name.trim(),language:p.language,description:p.description,samples:p.samples,radius:p.radius};
}
/** @param {ArrayLike<number>} a @param {ArrayLike<number>} b */
export function rms(a,b) { let sum=0; for(let i=0;i<63;i++) sum+=(a[i]-b[i])**2; return Math.sqrt(sum/63); }
/** @param {SignPackage[]} packages @param {ArrayLike<number>} vector @param {string} language */
export function predict(packages,vector,language) {
  if(vector.length!==63 || Array.from(vector).some(x=>!Number.isFinite(x))) return null;
  const scores=packages.filter(p=>p.language===language).map(p=>({p,d:p.samples.reduce((best,s)=>Math.min(best,rms(s,vector)),Infinity)/p.radius})).sort((a,b)=>a.d-b.d);
  if(!scores.length || scores[0].d>1 || (scores.length>1 && scores[1].d-scores[0].d<.2)) return null;
  return scores[0].p.name;
}
/** @param {string} name @param {string} language @param {string} description @param {number[][]} samples */
export function train(name,language,description,samples) {
  if(samples.length<20) throw new Error('Captura al menos 20 muestras.');
  const holdout=samples.slice(-5), training=samples.slice(0,-5);
  const distances=holdout.map(a=>Math.min(...training.map(b=>rms(a,b))));
  const worst=Math.max(...distances);
  if(worst>.12) throw new Error('Muestras inconsistentes: vuelve a capturar la misma postura con cambios leves.');
  const radius=Math.min(.15,Math.max(.03,worst*1.5));
  return parsePackage({schema:SCHEMA,name,language,description,samples,radius});
}
