import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createEMState } from '../src/em-state.js';
import { parseEMNumber } from '../src/em-controller.js';
import { waveDisplayGeometry } from '../src/em-view.js';

test('CIRCUIT-023 EM session is separate, preserves last valid snapshot, and never auto-resumes',()=>{
  const em=createEMState();assert.equal(em.state.playing,false);const first=em.evaluate();assert.equal(first.result.status,'valid');const revision=em.inspect().revision;
  em.setDraft('q','-');assert.equal(em.state.models.charge.q,1e-9);assert.ok(em.inspect().revision>revision);
  assert.equal(em.apply({q:2e-6}),null);assert.equal(em.state.models.charge.q,1e-9);assert.equal(em.state.draft.q,'-');assert.equal(em.state.previous,true);assert.equal(em.state.lastValid.result.status,'valid');assert.match(em.state.error,/범위/);
  assert.throws(()=>parseEMNumber(''),/빈값/);assert.throws(()=>parseEMNumber('   '),/빈값/);assert.equal(parseEMNumber('0'),0);
  assert.equal(em.setPoint([21,0,0]),null);assert.deepEqual(em.state.point,[1,0,0]);assert.equal(em.setPoint([0,0,0]).result.status,'excluded');assert.deepEqual(em.state.point,[0,0,0]);assert.equal(em.setPoint([2,0,0]).result.status,'valid');
  em.state.playing=true;em.setActive(false);assert.equal(em.state.playing,false);em.setActive(true);assert.equal(em.state.playing,false);
  em.setScene('wave');assert.equal(em.state.sceneName,'wave');assert.equal(em.state.playing,false);em.setTime(1.25);assert.equal(em.state.timeCycles,1.25);
  em.destroy();assert.equal(em.inspect().destroyed,true);
});

test('CIRCUIT-023 wave drawing follows the same amplitude, time, phase, E and B directions',()=>{
  const scene={kind:'wave',amplitude:3,frequency:1e6,phase:0,direction:[0,0,1],polarization:[1,0,0]};
  assert.deepEqual(waveDisplayGeometry({...scene,amplitude:0},0,5),[]);
  const initial=waveDisplayGeometry(scene,0,5)[2],quarter=waveDisplayGeometry(scene,.25,5)[2],reversed=waveDisplayGeometry({...scene,phase:Math.PI},0,5)[2];
  assert.ok(initial.electric[0]>.34);assert.ok(initial.magnetic[1]>.34);assert.ok(Math.abs(quarter.electric[0])<1e-12);assert.ok(Math.abs(quarter.magnetic[1])<1e-12);assert.ok(reversed.electric[0]<-.34);assert.ok(reversed.magnetic[1]<-.34);
});

test('CIRCUIT-023 actual product wiring guards inactive circuit state and uses native WebGL only',()=>{
  const app=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
  const tabs=readFileSync(new URL('../src/workspace-tabs.js',import.meta.url),'utf8');
  const panels=readFileSync(new URL('../src/panel-controller.js',import.meta.url),'utf8');
  const controller=readFileSync(new URL('../src/em-controller.js',import.meta.url),'utf8');
  const view=readFileSync(new URL('../src/em-view.js',import.meta.url),'utf8');
  assert.match(app,/isCircuitUiActive/);assert.match(app,/finishCanvasPointer\(state\.drag\.pointerId, "cancel"\)/);assert.match(app,/cancelPlotSession\(\)/);assert.match(app,/getEMState/);
  assert.match(tabs,/\.inert = name !== 'circuit'/);assert.match(panels,/if \(!isActive\(\) \|\| !Object\.hasOwn/);assert.match(panels,/panel\.inert = !open \|\| !active/);
  assert.match(view,/getContext\('webgl'/);assert.doesNotMatch(view,/THREE|cdn|vendor/i);assert.match(view,/deleteBuffer/);assert.match(view,/deleteProgram/);assert.match(view,/deleteShader/);
  assert.match(controller,/%32===0\|\|performance\.now\(\)-sliceStarted>=8/);assert.match(controller,/token!==lineTask/);assert.match(controller,/token!==sliceTask/);assert.match(controller,/snapshot!==s\.lastValid/);assert.match(controller,/cachedLines/);assert.match(controller,/cachedSlice/);assert.match(controller,/kind==='loop'\?16:32/);assert.match(controller,/loopFieldAtN\(model,p,64\)/);
  assert.match(controller,/if\(!valid\)throw new Error\(s\.error\)/);assert.match(controller,/em-error'\)\.hidden=false/);assert.doesNotMatch(controller,/result\.frequency/);assert.match(controller,/snapshot\.model\.frequency/);assert.match(controller,/data-em-wave-point/);
});
