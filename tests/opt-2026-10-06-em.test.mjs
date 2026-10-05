import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createEMState } from '../src/em-state.js';
import { createPointChargeEvaluator, evaluatePointChargeWorld, pointChargePlaneSample, validatePointSources } from '../src/em-playground-physics.js';
import { loopCirculation, sphereFlux } from '../src/em-playground-calculus.js';
import { EMView } from '../src/em-view.js';

const point = (id, q, position) => ({ id, type: 'point', q, position, enabled: true, visible: true });
const finite = { id: 'f1', type: 'finite-line', lambda: 2e-9, start: [-1, 2, 0], end: [1, 2.5, 0.3], enabled: true, visible: true };
const infinite = { id: 'i1', type: 'infinite-line', lambda: -1e-9, position: [0, -2.5, 0], direction: [0, 0, 1], sRef: 1, displayLength: 4, enabled: true, visible: true };
const sixteen = Array.from({ length: 16 }, (_, i) => point(`q${i}`, (i % 2 ? -1 : 1) * 1e-9, [Math.cos(i) * 1.5, Math.sin(i) * 1.5, Math.sin(2 * i) * 0.3]));
const probes = [[0.3, 0.4, 0.1], [1, 0, 0], [-0.7, 1.2, 0.5], [0, 0, 1.4], [3.3, -2.1, 0.8]];

test('OPT-EM fast evaluator and options give bit-identical E/potential to the default path', () => {
  for (const sources of [sixteen.slice(0, 2), sixteen, [...sixteen.slice(0, 3), finite, infinite]]) {
    const evaluator = createPointChargeEvaluator(sources);
    const validated = validatePointSources(sources);
    for (const p of probes) {
      const slow = evaluatePointChargeWorld(sources, p);
      const fast = evaluator(p);
      const viaOptions = evaluatePointChargeWorld(validated, p, { jacobian: false, validated: true });
      for (const result of [fast, viaOptions]) {
        assert.equal(result.status, slow.status);
        assert.deepEqual(result.E, slow.E);
        assert.equal(result.potential, slow.potential);
        assert.deepEqual(result.gradV, slow.gradV);
        assert.equal(result.jacobian, null, 'fast path never builds the Jacobian');
      }
    }
  }
});

test('OPT-EM sphere flux and loop circulation are numerically identical with the fast field', () => {
  const sources = sixteen.slice(0, 4);
  const slowField = p => evaluatePointChargeWorld(sources, p);
  const fastField = createPointChargeEvaluator(sources);
  const center = [0.3, 0.4, 0.1];
  const a = sphereFlux(slowField, center, 0.5, sources), b = sphereFlux(fastField, center, 0.5, sources);
  assert.equal(a.status, 'valid');
  assert.equal(b.flux, a.flux);
  assert.equal(b.coarseFlux, a.coarseFlux);
  assert.deepEqual(b.surfaceContributions, a.surfaceContributions);
  const c = loopCirculation(slowField, center, 0.5, [0, 0, 1], sources), d = loopCirculation(fastField, center, 0.5, [0, 0, 1], sources);
  assert.equal(d.circulation, c.circulation);
});

test('OPT-EM default evaluate keeps the point-charge Jacobian and the plane sample opt-out matches', () => {
  const two = sixteen.slice(0, 2);
  const result = evaluatePointChargeWorld(two, [0.3, 0.4, 0.1]);
  assert.equal(result.status, 'valid');
  assert.ok(Array.isArray(result.jacobian) && result.jacobian.length === 3);
  assert.ok(Math.abs(result.jacobian[0][0] + result.jacobian[1][1] + result.jacobian[2][2]) < 1e-3, 'point-charge Jacobian is traceless outside sources');
  const full = pointChargePlaneSample(two, 'xy', 0.2, { grid: 7 });
  const lean = pointChargePlaneSample(two, 'xy', 0.2, { grid: 7, jacobian: false });
  assert.ok(full.values.every(item => item.result.status !== 'valid' || item.result.jacobian));
  assert.ok(lean.values.every(item => item.result.jacobian === null));
  assert.deepEqual(lean.values.map(item => item.result.potential), full.values.map(item => item.result.potential));
  assert.equal(lean.maxAbsPotential, full.maxAbsPotential);
  assert.equal(lean.maxField, full.maxField);
});

test('OPT-EM Jacobian is null (not a silent point-only matrix) whenever an active line source contributes', () => {
  const p = [0.3, 0.4, 0.1];
  assert.equal(evaluatePointChargeWorld([sixteen[0], finite], p).jacobian, null);
  assert.equal(evaluatePointChargeWorld([sixteen[0], infinite], p).jacobian, null);
  assert.equal(evaluatePointChargeWorld([finite], p).status, 'valid');
  assert.ok(evaluatePointChargeWorld([sixteen[0], { ...finite, enabled: false }], p).jacobian, 'a disabled line contributes nothing, so the point Jacobian is complete');
  assert.ok(evaluatePointChargeWorld([sixteen[0], { ...finite, lambda: 0 }], p).jacobian);
  assert.ok(evaluatePointChargeWorld([sixteen[0]], p).jacobian);
});

test('OPT-EM setTime ignores non-finite input and keeps time, snapshot and revision', () => {
  const em = createEMState();
  em.setScene('wave');
  em.setTime(0.5);
  const snapshot = em.state.lastValid, revision = em.inspect().revision;
  for (const bad of [NaN, 'abc', Infinity, -Infinity, undefined]) {
    assert.strictEqual(em.setTime(bad), snapshot);
    assert.equal(em.state.timeCycles, 0.5);
    assert.equal(em.inspect().revision, revision);
  }
  em.setTime(5);
  assert.equal(em.state.timeCycles, 2);
  em.setTime(-1);
  assert.equal(em.state.timeCycles, 0);
});

test('OPT-EM EMView rebuilds its GL program and redraws after webglcontextrestored', () => {
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

test('OPT-EM source contracts: one validation per calculation, coalesced render, cached legacy scenes, canvas resize guard', () => {
  const controller = readFileSync(new URL('../src/em-controller.js', import.meta.url), 'utf8');
  const courseView = readFileSync(new URL('../src/em-course-view.js', import.meta.url), 'utf8');
  assert.match(controller, /createPointChargeEvaluator\(sourceSnapshot\)/);
  assert.doesNotMatch(controller, /point=>evaluatePointChargeWorld\(sourceSnapshot,point\)/);
  assert.match(controller, /requestAnimationFrame\(flushFrame\)/);
  assert.match(controller, /requestRender\(DIRTY_SCENE\)/);
  assert.match(controller, /preserveCourseFocus/);
  assert.match(controller, /key===cachedLinesKey/);
  assert.match(controller, /key===cachedSliceKey/);
  assert.match(courseView, /canvas\.width !== width \|\| canvas\.height !== height/);
  assert.doesNotMatch(courseView, /canvas\.width = Math\.round\(canvas\.clientWidth \* dpr\)/);
});
