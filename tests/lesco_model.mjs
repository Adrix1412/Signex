import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DenseModel } from '../web/js/model.js';

const weights = JSON.parse(readFileSync(new URL('../web/model/lesco_letters/model_weights.json', import.meta.url)));
const labels = JSON.parse(readFileSync(new URL('../web/model/labels_lesco_letters.json', import.meta.url)));
const model = new DenseModel(weights);

assert.equal(model.inputDim, 63);
assert.equal(model.numClasses, Object.keys(labels).length);
assert.equal(model.numClasses, 24);
assert.ok(Object.values(labels).includes('T'));

const output = model.predict(new Float32Array(63));
assert.equal(output.length, 24);
assert.ok(output.every(Number.isFinite));
assert.ok(Math.abs(output.reduce((sum, value) => sum + value, 0) - 1) < 1e-5);
console.log('Modelo LESCO: 24 clases y salida válida');
