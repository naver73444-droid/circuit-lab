import test from 'node:test';import assert from 'node:assert/strict';
import { NOISE_ZERO_TEXT,isNumericNoise,noiseAwareText,noiseAwareVectorText,siText } from '../../../src/em-format.js';
import { EPS0 } from '../../../src/em-physics.js';
import { createPointChargeEvaluator } from '../../../src/em-playground-physics.js';
import { differential3D,loopCirculation,mathField,sphereFlux } from '../../../src/em-playground-calculus.js';
const fmt=v=>siText(v,'V',4);
test('noise rule: relative to scale, exact zero and real values stay literal',()=>{
  assert.equal(isNumericNoise(-1.641e-15,1e3*2*Math.PI),true);
  assert.equal(isNumericNoise(0,10),false);
  assert.equal(isNumericNoise(1e-6,10),false);
  assert.equal(isNumericNoise(1e-12,0),false);
  assert.equal(isNumericNoise(NaN,10),false);
  assert.equal(isNumericNoise(1e-9*10,10),true);
});
test('noiseAwareText hides noise but keeps the raw value in title',()=>{
  const hidden=noiseAwareText(-1.641e-15,6283,fmt);
  assert.equal(hidden.text,NOISE_ZERO_TEXT);assert.equal(hidden.noise,true);assert.match(hidden.title,/−1\.641 fV/);
  const real=noiseAwareText(2*Math.PI,6.28,fmt);
  assert.equal(real.noise,false);assert.equal(real.text,fmt(2*Math.PI));assert.equal(real.title,'');
});
test('noiseAwareVectorText requires every component to be noise',()=>{
  const f=v=>v.join(',');
  assert.equal(noiseAwareVectorText([1e-17,-2e-17,0],1,f).text,NOISE_ZERO_TEXT);
  assert.equal(noiseAwareVectorText([0,0,2],1,f).noise,false);
  assert.equal(noiseAwareVectorText([0,0,0],1,f).noise,false);
});
test('electrostatic closed loop is flagged as noise using the engine noiseScale',()=>{
  const charge={id:'p',type:'point',q:1e-9,position:[0,0,0],enabled:true,visible:true},field=createPointChargeEvaluator([charge]);
  const loop=loopCirculation(field,[2,0,0],.5,[0,0,1],[charge]);
  assert.equal(loop.status,'valid');assert.ok(loop.noiseScale>0);
  const shown=noiseAwareText(loop.circulation,loop.noiseScale,fmt);
  assert.equal(shown.noise,true);assert.equal(shown.text,NOISE_ZERO_TEXT);assert.ok(shown.title.length>0);
});
test('rotational field circulation 2π is never hidden; radial field loop is noise or exact 0',()=>{
  const rot=loopCirculation(mathField('rotational',1),[0,0,0],1,[0,0,1]);
  assert.equal(noiseAwareText(rot.circulation,rot.noiseScale,v=>String(v)).noise,false);
  const rad=loopCirculation(mathField('radial',1),[0,0,0],1,[0,0,1]);
  const shown=noiseAwareText(rad.circulation,rad.noiseScale,v=>String(v));
  assert.ok(shown.noise||rad.circulation===0);
});
test('divergence/curl use the derivative-term scale; true curl 2 survives',()=>{
  const rot=differential3D(mathField('rotational',1),[1,2,3]);
  assert.equal(noiseAwareText(rot.divergence,rot.noiseScale,String).noise||rot.divergence===0,true);
  assert.equal(noiseAwareVectorText(rot.curl,rot.noiseScale,String).noise,false);
  const rad=differential3D(mathField('radial',1),[1,2,3]);
  assert.equal(noiseAwareText(rad.divergence,rad.noiseScale,String).noise,false);
});
test('sphere flux exposes noiseScale',()=>{
  const value=sphereFlux(mathField('rotational',1),[0,0,0],1);
  assert.ok(value.noiseScale>0);void EPS0;
});
