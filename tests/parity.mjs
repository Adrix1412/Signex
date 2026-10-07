import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../web/js');
const nodes=new Map();
function element(){return {textContent:'',className:'',children:[],appendChild(child){this.children.push(child);},append(...children){this.children.push(...children);}};}
globalThis.document={getElementById(id){if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);},createElement:element};
globalThis.fetch=async url=>{const data=await fs.readFile(path.resolve(root,url),'utf8');return {ok:true,json:async()=>JSON.parse(data)};};
const html=await fs.readFile(path.join(root,'utils.test.html'),'utf8');
const script=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
const target=path.join(root,'.parity-run.mjs');
try {await fs.writeFile(target,script);await import(pathToFileURL(target));const summary=nodes.get('summary');console.log(summary.textContent);if(summary.className!=='pass'){console.log(JSON.stringify(nodes.get('results')));process.exitCode=1;}} finally {await fs.unlink(target);}
