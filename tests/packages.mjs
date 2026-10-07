import assert from 'node:assert/strict';
import {parsePackage,predict,train,SCHEMA} from '../web/js/packages.js';
const sample={schema:SCHEMA,name:'Ejemplo',language:'LESCO',description:'Sintético',samples:Array.from({length:30},()=>Array(63).fill(0)),radius:.05};
assert.equal(predict([parsePackage(sample)],Array(63).fill(0),'LESCO'),'Ejemplo');
assert.equal(predict([sample],Array(63).fill(1),'LESCO'),null);
assert.equal(predict([sample],Array(63).fill(0),'ASL'),null);
assert.equal(predict([sample,{...sample,name:'Otra'}],Array(63).fill(0),'LESCO'),null);
for(const invalid of [NaN,Infinity,true,'0',11]) {
 const data=structuredClone(sample);data.samples[0][0]=invalid;assert.throws(()=>parsePackage(data));
}
assert.equal(train('Prueba','LESCO','',sample.samples).radius,.03);
assert.throws(()=>train('Prueba','LESCO','',sample.samples.slice(0,3)));
console.log('11 package assertions passed');
