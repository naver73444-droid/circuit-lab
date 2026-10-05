import test from "node:test";
import assert from "node:assert/strict";
import { waveDisplayGeometry, EMView } from "../../src/em-view.js";

test('wave drawing follows the same amplitude, time, phase, E and B directions',()=>{
  const scene={kind:'wave',amplitude:3,frequency:1e6,phase:0,direction:[0,0,1],polarization:[1,0,0]};
  assert.deepEqual(waveDisplayGeometry({...scene,amplitude:0},0,5),[]);
  const initial=waveDisplayGeometry(scene,0,5)[2],quarter=waveDisplayGeometry(scene,.25,5)[2],reversed=waveDisplayGeometry({...scene,phase:Math.PI},0,5)[2];
  assert.ok(initial.electric[0]>.34);assert.ok(initial.magnetic[1]>.34);assert.ok(Math.abs(quarter.electric[0])<1e-12);assert.ok(Math.abs(quarter.magnetic[1])<1e-12);assert.ok(reversed.electric[0]<-.34);assert.ok(reversed.magnetic[1]<-.34);
});

const point = (id, q, position) => ({ id, type: 'point', q, position, enabled: true, visible: true });

test('EMView rebuilds its GL program and redraws after webglcontextrestored', () => {
  globalThis.devicePixelRatio = 1;
  const counts = { createProgram: 0, createBuffer: 0, drawArrays: 0 };
  const gl = new Proxy({}, {
    get(_, name) {
      if (name === 'getShaderParameter' || name === 'getProgramParameter') return () => true;
      if (name === 'isContextLost') return () => false;
      if (name in counts) return () => { counts[name] += 1; return {}; };
      if (name === 'createShader' || name === 'createProgram') return () => ({});
      return () => undefined;
    },
  });
  const listeners = {};
  const canvas = {
    width: 0, height: 0,
    getContext: () => gl,
    addEventListener: (name, handler) => { listeners[name] = handler; },
    removeEventListener: name => { delete listeners[name]; },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
  };
  const message = { textContent: '' };
  const view = new EMView(canvas, message);
  assert.equal(typeof listeners.webglcontextrestored, 'function');
  const args = { camera: { yaw: 0, pitch: 0, distance: 5 }, scene: { kind: 'charge', position: [0, 0, 0] }, point: [1, 0, 0], vector: [1, 0, 0] };
  assert.equal(view.render(args), true);
  assert.equal(counts.drawArrays, 1);
  listeners.webglcontextlost({ preventDefault() {} });
  assert.equal(view.render(args), false, 'no GL calls while the context is lost');
  assert.equal(counts.drawArrays, 1);
  const programsBefore = counts.createProgram, buffersBefore = counts.createBuffer;
  listeners.webglcontextrestored();
  assert.equal(counts.createProgram, programsBefore + 1);
  assert.equal(counts.createBuffer, buffersBefore + 1);
  assert.equal(counts.drawArrays, 2, 'last frame is redrawn on restore');
  view.dispose();
  assert.equal(listeners.webglcontextrestored, undefined);
});
