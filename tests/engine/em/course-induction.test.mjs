import test from 'node:test';
import assert from 'node:assert/strict';
import { EXPERIMENTS } from '../../../src/em-course-induction.js';

const byId = Object.fromEntries(EXPERIMENTS.map(e => [e.id, e]));
const defaults = id => Object.fromEntries(byId[id].parameters.map(p => [p.key, p.initial]));
const params = (id, patch = {}) => ({ ...defaults(id), ...patch });
const run = (id, patch = {}, point = [0, 0, 0]) => byId[id].evaluate(params(id, patch), point);
const val = (out, key) => out.scalars.find(s => s.key === key)?.value;
function near(actual, expected, absolute = 1e-12, relative = 1e-11) {
  assert.ok(Number.isFinite(actual));
  assert.ok(Math.abs(actual - expected) <= absolute + relative * Math.abs(expected),
    'actual=' + actual + ' expected=' + expected);
}
function excluded(out, status) {
  assert.equal(out.status, status);
  assert.ok(out.reason.length);
  assert.deepEqual(out.vectors, {});
  assert.deepEqual(out.scalars, []);
}
function finiteResult(out) {
  assert.ok(['valid', 'boundary', 'singular', 'invalid', 'unsupported'].includes(out.status));
  for (const vector of Object.values(out.vectors)) {
    assert.equal(vector.length, 3);
    assert.ok(vector.every(Number.isFinite));
  }
  for (const s of out.scalars) assert.ok(Number.isFinite(s.value) && s.unit);
}
const LOOP_FIXTURE = Object.freeze({ B0: 0.3, area: 0.02, omega: 4, turns: 50,
  theta: Math.PI / 3, time: Math.PI / 8, resistance: 3, closedCircuit: 1 });
const ROD_FIXTURE = Object.freeze({ B: 0.5, length: 0.4, velocity: 3,
  x0: 0.2, time: 0.1, railLength: 2, resistance: 2, closedCircuit: 1 });

test('two exact IDs, SI metadata and pure detached evaluators', () => {
  assert.deepEqual(EXPERIMENTS.map(e => e.id), ['faraday-loop', 'motional-rod']);
  for (const e of EXPERIMENTS) {
    assert.equal(e.topic, 'induction');
    for (const key of ['title', 'description', 'modelKind']) assert.ok(e[key].length);
    for (const key of ['assumptions', 'validity', 'singularities', 'formulas', 'references']) assert.ok(e[key].length);
    for (const p of e.parameters) {
      for (const key of ['initial', 'min', 'max', 'displayScale']) assert.ok(Number.isFinite(p[key]));
      assert.ok(p.min <= p.initial && p.initial <= p.max && p.displayScale > 0);
    }
    const p = defaults(e.id), point = [...e.probeDefault], before = structuredClone(p);
    const { evaluate, verify } = e;
    const out = evaluate(p, point);
    assert.equal(out.status, 'valid');
    finiteResult(out);
    assert.deepEqual(p, before);
    assert.deepEqual(point, e.probeDefault);
    const checks = verify(p);
    assert.ok(checks.some(c => c.status === 'pass'));
    assert.ok(checks.every(c => c.status !== 'fail'));
    assert.ok(checks.some(c => c.status === 'skipped' && c.reason)); // open circuit intentionally skipped
    for (const c of checks) for (const key of ['actual', 'expected', 'absTolerance', 'relTolerance'])
      assert.ok(Number.isFinite(c[key]));
    assert.deepEqual(Object.keys(out.vectors), ['B']);
    assert.equal(val(out, 'potential'), undefined);
  }
});
test('fixed source-grounded loop: quarter cycle +.6 V, .2 A and .12 W', () => {
  const out = run('faraday-loop', LOOP_FIXTURE);
  assert.equal(out.status, 'valid');
  near(val(out, 'flux'), 0, 1e-15, 0);
  near(val(out, 'linkage'), 0, 1e-15, 0);
  near(val(out, 'emf'), 0.6);
  near(val(out, 'current'), 0.2);
  near(val(out, 'joulePower'), 0.12);
  near(val(out, 'transformerEmf'), 0.6);
  near(val(out, 'motionalEmf'), 0);
  assert.ok(out.notes.some(n => n.includes('반시계')));
  assert.ok(byId['faraday-loop'].verify(params('faraday-loop', LOOP_FIXTURE)).every(c => c.status === 'pass'));
});
test('fixed eighth-cycle flux, N-turn linkage and radian phase', () => {
  const out = run('faraday-loop', { ...LOOP_FIXTURE, time: Math.PI / 16 });
  near(val(out, 'flux'), 0.0021213203435596424);
  near(val(out, 'linkage'), 0.10606601717798213);
  near(val(out, 'emf'), 0.4242640687119285);
  assert.equal(out.scalars.find(s => s.key === 'flux').unit, 'Wb');
  assert.equal(out.scalars.find(s => s.key === 'emf').unit, 'V');
  const definition = byId['faraday-loop'];
  assert.equal(definition.parameters.find(p => p.key === 'theta').unit, 'rad');
  assert.equal(definition.parameters.find(p => p.key === 'area').displayScale, 1e-4);
});
test('fixed rod: signed emf/current, flux and opposing force/energy', () => {
  const out = run('motional-rod', ROD_FIXTURE);
  assert.equal(out.status, 'valid');
  for (const [key, expected] of Object.entries({ position: 0.5, area: 0.2, flux: 0.1, linkage: 0.1,
    emf: -0.6, current: -0.3, joulePower: 0.18, magneticForceX: -0.06,
    externalForceX: 0.06, mechanicalPower: 0.18, transformerEmf: 0, motionalEmf: -0.6 }))
    near(val(out, key), expected);
  assert.ok(out.notes.some(n => n.includes('시계')));
  assert.ok(byId['motional-rod'].verify(params('motional-rod', ROD_FIXTURE)).every(c => c.status === 'pass'));
});
test('OpenStax earth-field magnitude: open rod 150 microvolt with declared signed orientation', () => {
  const out = run('motional-rod', { B: 50e-6, length: 1, velocity: 3, closedCircuit: 0 });
  near(val(out, 'emf'), -150e-6);
  for (const key of ['current', 'joulePower', 'magneticForceX', 'externalForceX', 'mechanicalPower'])
    assert.equal(val(out, key), undefined);
});
test('loop B sign and normal reversal reverse emf; N scales only linkage and emf', () => {
  const original = run('faraday-loop', LOOP_FIXTURE);
  for (const patch of [{ B0: -0.3 }, { theta: 2 * Math.PI / 3 }]) {
    const out = run('faraday-loop', { ...LOOP_FIXTURE, ...patch });
    near(val(out, 'emf'), -val(original, 'emf'));
    near(val(out, 'current'), -val(original, 'current'));
    near(val(out, 'joulePower'), val(original, 'joulePower'));
  }
  const p = { ...LOOP_FIXTURE, time: Math.PI / 16 };
  const one = run('faraday-loop', { ...p, turns: 1 });
  const fifty = run('faraday-loop', p);
  near(val(fifty, 'flux'), val(one, 'flux'));
  near(val(fifty, 'linkage'), 50 * val(one, 'linkage'));
  near(val(fifty, 'emf'), 50 * val(one, 'emf'));
});
test('theta ±pi/2 exactly cancels flux and emf without a near-zero clamp', () => {
  for (const theta of [Math.PI / 2, -Math.PI / 2]) {
    const out = run('faraday-loop', { ...LOOP_FIXTURE, theta, time: 0.123 });
    near(val(out, 'flux'), 0, 0, 0);
    near(val(out, 'linkage'), 0, 0, 0);
    near(val(out, 'emf'), 0, 0, 0);
    assert.ok(byId['faraday-loop'].verify(params('faraday-loop', { ...LOOP_FIXTURE, theta })).every(c => c.status === 'pass'));
  }
  const nearPerpendicular = run('faraday-loop', { ...LOOP_FIXTURE, theta: Math.PI / 2 - 1e-12 });
  assert.ok(val(nearPerpendicular, 'emf') > 0); // preserve tiny physical result
});
test('time turning points use zero emf; quarter-cycle changes sign', () => {
  for (const time of [0, Math.PI / 4, Math.PI / 2]) {
    const out = run('faraday-loop', { ...LOOP_FIXTURE, time });
    near(val(out, 'emf'), 0, 0, 0);
    near(val(out, 'current'), 0, 0, 0);
    assert.ok(byId['faraday-loop'].verify(params('faraday-loop', { ...LOOP_FIXTURE, time })).every(c => c.status === 'pass'));
  }
  near(val(run('faraday-loop', { ...LOOP_FIXTURE, time: 3 * Math.PI / 8 }), 'emf'), -0.6);
});
test('B0=0, omega=0, area=0 are valid and explicitly zero induction limits', () => {
  for (const patch of [{ B0: 0 }, { omega: 0 }, { area: 0 }]) {
    const p = { ...LOOP_FIXTURE, ...patch };
    const out = run('faraday-loop', p);
    assert.equal(out.status, 'valid');
    near(val(out, 'emf'), 0, 0, 0);
    assert.ok(byId['faraday-loop'].verify(params('faraday-loop', p)).every(c => c.status === 'pass'));
  }
  const degenerate = run('faraday-loop', { ...LOOP_FIXTURE, area: 0 });
  assert.ok(degenerate.notes.some(n => n.includes('축퇴')));
  const staticB = run('faraday-loop', { ...LOOP_FIXTURE, omega: 0 });
  near(val(staticB, 'flux'), 0.003); // constant nonzero flux can coexist with zero emf
});
test('rod v=0 and B=0 are valid zero emf/force/power, constant flux need not be zero', () => {
  for (const patch of [{ velocity: 0 }, { B: 0 }]) {
    const p = { ...ROD_FIXTURE, ...patch }, out = run('motional-rod', p);
    assert.equal(out.status, 'valid');
    for (const key of ['emf', 'current', 'magneticForceX', 'mechanicalPower', 'joulePower'])
      near(val(out, key), 0, 0, 0);
    assert.ok(byId['motional-rod'].verify(params('motional-rod', p)).every(c => c.status === 'pass'));
  }
  near(val(run('motional-rod', { ...ROD_FIXTURE, velocity: 0 }), 'flux'), 0.04);
});
test('rod velocity/B reversal: signed current and magnetic force obey Lenz, power nonnegative', () => {
  for (const B of [-0.5, 0.5]) for (const velocity of [-3, 3]) {
    const out = run('motional-rod', { ...ROD_FIXTURE, B, velocity, x0: 1 });
    assert.equal(out.status, 'valid');
    assert.ok(val(out, 'magneticForceX') * velocity < 0);
    assert.ok(val(out, 'mechanicalPower') > 0);
    near(val(out, 'joulePower'), val(out, 'mechanicalPower'));
    near(val(out, 'emf'), B * velocity < 0 ? 0.6 : -0.6);
  }
});
test('closed circuits with R=0 are singular even at zero emf', () => {
  for (const id of ['faraday-loop', 'motional-rod']) for (const zero of [false, true]) {
    const patch = { closedCircuit: 1, resistance: 0,
      ...(zero ? (id === 'faraday-loop' ? { B0: 0 } : { velocity: 0 }) : {}) };
    const p = params(id, patch);
    excluded(byId[id].evaluate(p, [0, 0, 0]), 'singular');
    const rows = byId[id].verify(p);
    assert.ok(rows.every(c => c.status === 'skipped' && c.reason.includes('singular')));
  }
});
test('open circuits do not divide by zero or invent an Ohmic current', () => {
  for (const id of ['faraday-loop', 'motional-rod']) {
    const out = run(id, { closedCircuit: 0, resistance: 0 });
    assert.equal(out.status, 'valid');
    assert.equal(val(out, 'current'), undefined);
    assert.equal(val(out, 'joulePower'), undefined);
  }
});
test('rod rail endpoints boundary; outside rail unsupported; no clamp', () => {
  for (const x0 of [0, 2]) excluded(run('motional-rod', { x0, velocity: 0 }), 'boundary');
  for (const [x0, velocity, time] of [[0.1, -1, 1], [1.9, 1, 1]])
    excluded(run('motional-rod', { x0, velocity, time }), 'unsupported');
  assert.equal(run('motional-rod', { x0: 1e-14, velocity: 0 }).status, 'valid');
  assert.equal(run('motional-rod', { x0: 2 - 1e-14, velocity: 0 }).status, 'valid');
  for (const patch of [{ x0: 0, velocity: 0 }, { x0: 1, velocity: 3, time: 1 }]) {
    const rows = byId['motional-rod'].verify(params('motional-rod', patch));
    assert.ok(rows.every(c => c.status === 'skipped' && c.reason));
  }
});
test('initial rod position beyond rail is invalid', () => {
  excluded(run('motional-rod', { x0: 3, railLength: 2 }), 'invalid');
});
test('strict circuit flag and integer turn count', () => {
  for (const closedCircuit of [-1, 0.5, 2, true, '1']) {
    for (const id of ['faraday-loop', 'motional-rod']) excluded(run(id, { closedCircuit }), 'invalid');
  }
  for (const turns of [0, -1, 1.5, 10001]) excluded(run('faraday-loop', { turns }), 'invalid');
});
test('negative physical quantities and out-of-range SI values are invalid', () => {
  const cases = {
    'faraday-loop': [{ area: -1 }, { omega: -1 }, { theta: 90 }, { B0: 101 }],
    'motional-rod': [{ length: 0 }, { length: -1 }, { railLength: 0 }, { velocity: 101 }, { x0: -1 }],
  };
  for (const id of Object.keys(cases)) for (const patch of [...cases[id], { time: -1 }, { resistance: -1 }, { time: 1001 }])
    excluded(run(id, patch), 'invalid');
});
test('nonfinite/missing/string SI params, malformed objects and sparse points fail safely', () => {
  for (const id of ['faraday-loop', 'motional-rod']) {
    const e = byId[id];
    for (const p of [null, [], 1, 'x', Object.create({}), { ...defaults(id), time: NaN },
      { ...defaults(id), time: Infinity }, { ...defaults(id), time: '0.1' },
      { ...defaults(id), extra: -Infinity }, { ...defaults(id), resistance: undefined }]) {
      excluded(e.evaluate(p, [0, 0, 0]), 'invalid');
      assert.ok(e.verify(p).every(c => c.status === 'skipped'));
    }
    for (const point of [null, [0, 0], [0, 0, 0, 0], [0, NaN, 0], ['0', 0, 0], Array(3),
      new Float64Array([0, 0, 0])]) excluded(e.evaluate(defaults(id), point), 'invalid');
    const missing = defaults(id); delete missing.time;
    excluded(e.evaluate(missing, [0, 0, 0]), 'invalid');
    const nullPrototype = Object.assign(Object.create(null), defaults(id));
    assert.equal(e.evaluate(nullPrototype, [0, 0, 0]).status, 'valid');
  }
});
test('tiny positive R overflow yields invalid finite-empty output rather than NaN/Infinity', () => {
  for (const id of ['faraday-loop', 'motional-rod']) {
    const p = params(id, { closedCircuit: 1, resistance: Number.MIN_VALUE });
    excluded(byId[id].evaluate(p, [0, 0, 0]), 'invalid');
    assert.ok(byId[id].verify(p).every(c => c.status === 'skipped'));
  }
});
test('circuit scalars independent of probe, prescribed B only, no general electrostatic potential/E', () => {
  for (const id of ['faraday-loop', 'motional-rod']) {
    const p = defaults(id), a = byId[id].evaluate(p, [0, 0, 0]);
    const b = byId[id].evaluate(p, [1e100, -1e100, 1e100]);
    assert.deepEqual(a, b);
    assert.equal(a.vectors.E, undefined);
    assert.equal(a.vectors.D, undefined);
    assert.equal(a.vectors.H, undefined);
    assert.ok(a.scalars.every(s => s.key !== 'potential'));
  }
});
test('independent loop surface-flux finite difference at multiple noncardinal phases', () => {
  // Direct grid integrates projected B, independent of production flux/evaluate helpers.
  function quadrature(p, t) {
    let integral = 0;
    for (let ix = 0; ix < 16; ix++) for (let iy = 0; iy < 16; iy++)
      integral += p.B0 * Math.cos(p.omega * t) * Math.cos(p.theta) * p.area / 256;
    return p.turns * integral;
  }
  for (const theta of [0, 0.7, -1.2, Math.PI]) for (const time of [0.07, 0.3, 0.6]) {
    const p = params('faraday-loop', { ...LOOP_FIXTURE, theta, time });
    const h = 1e-4;
    const derivative = (quadrature(p, time - 2 * h) - 8 * quadrature(p, time - h) +
      8 * quadrature(p, time + h) - quadrature(p, time + 2 * h)) / (12 * h);
    near(val(byId['faraday-loop'].evaluate(p, [0, 0, 0]), 'emf'), -derivative, 1e-9, 2e-6);
  }
});
test('independent rod geometric flux derivative uses future/past area; motion not doubled', () => {
  for (const B of [-0.7, 0.7]) for (const velocity of [-0.4, 0.4]) {
    const p = params('motional-rod', { ...ROD_FIXTURE, B, velocity, x0: 1 });
    const h = 1e-4;
    const areaLow = p.length * (p.x0 + velocity * (p.time - h));
    const areaHigh = p.length * (p.x0 + velocity * (p.time + h));
    const expected = -B * (areaHigh - areaLow) / (2 * h);
    const out = byId['motional-rod'].evaluate(p, [0, 0, 0]);
    near(val(out, 'emf'), expected, 1e-10, 2e-6);
    near(val(out, 'emf'), val(out, 'transformerEmf') + val(out, 'motionalEmf'));
  }
});
test('deterministic parameter sweep: finite SI results, Lenz sign, no failed checks', () => {
  for (let i = 0; i < 80; i++) {
    const lp = params('faraday-loop', { B0: (i - 40) / 20, area: i / 100,
      theta: -Math.PI + i * 2 * Math.PI / 80, omega: 1 + i,
      time: i / 100, turns: i + 1, closedCircuit: 1, resistance: 0.1 + i });
    const rp = params('motional-rod', { B: (i - 40) / 20, length: 0.1 + i / 100,
      velocity: (i - 40) / 100, x0: 1, time: 0.1, closedCircuit: 1, resistance: 0.1 + i });
    for (const [id, p] of [['faraday-loop', lp], ['motional-rod', rp]]) {
      const out = byId[id].evaluate(p, [0, 0, 0]);
      assert.equal(out.status, 'valid');
      finiteResult(out);
      assert.ok(byId[id].verify(p).every(c => c.status !== 'fail'), id + ' sweep index ' + i);
      assert.ok(val(out, 'joulePower') >= 0);
    }
    const rod = byId['motional-rod'].evaluate(rp, [0, 0, 0]);
    assert.ok(val(rod, 'magneticForceX') * rp.velocity <= 0);
  }
});
test('unresolvable tiny derivatives return explicit skipped rows with finite payloads', () => {
  const lp = params('faraday-loop', { time: Number.MIN_VALUE });
  const rows = byId['faraday-loop'].verify(lp);
  assert.ok(rows.some(c => c.status === 'skipped' && c.reason.includes('분해능')));
  const rp = params('motional-rod', { velocity: Number.MIN_VALUE });
  assert.ok(byId['motional-rod'].verify(rp).some(c => c.status === 'skipped' && c.reason.includes('차분')));
  rows.forEach(c => ['actual', 'expected', 'absTolerance', 'relTolerance'].forEach(k => assert.ok(Number.isFinite(c[k]))));
});

test('published maximum inputs and minimal rod geometry remain finite and verified', () => {
  const cases = [
    ['faraday-loop', { B0: 100, area: 10, turns: 10000, omega: 10000, time: 1000, closedCircuit: 1, resistance: 1e9 }],
    ['motional-rod', { B: 100, length: 10, velocity: 100, x0: 1, time: 0.01, railLength: 10, closedCircuit: 1, resistance: 1e9 }],
    ['motional-rod', { length: 1e-6, railLength: 1e-6, x0: 5e-7, velocity: 0, time: 1000 }],
  ];
  for (const [id, patch] of cases) {
    const p = params(id, patch), out = byId[id].evaluate(p, [0, 0, 0]);
    assert.equal(out.status, 'valid');
    finiteResult(out);
    assert.ok(byId[id].verify(p).every(c => c.status !== 'fail'));
  }
});
test('subnormal angular frequency has finite result and explicit unresolved derivative skip', () => {
  const p = params('faraday-loop', { omega: Number.MIN_VALUE });
  assert.equal(byId['faraday-loop'].evaluate(p, [0, 0, 0]).status, 'valid');
  const rows = byId['faraday-loop'].verify(p);
  assert.ok(rows.some(c => c.status === 'skipped' && c.reason));
  rows.forEach(c => ['actual', 'expected', 'absTolerance', 'relTolerance'].forEach(k => assert.ok(Number.isFinite(c[k]))));
});
test('finite large current/power with tiny positive R must avoid an intermediate I squared overflow', () => {
  for (const [id, fixture, sign] of [['faraday-loop', LOOP_FIXTURE, 1], ['motional-rod', ROD_FIXTURE, -1]]) {
    const p = params(id, { ...fixture, resistance: 1e-200 });
    const out = byId[id].evaluate(p, [0, 0, 0]);
    assert.equal(out.status, 'valid');
    finiteResult(out);
    near(val(out, 'current'), sign * 6e199);
    near(val(out, 'joulePower'), 3.6e199);
    assert.ok(byId[id].verify(p).every(c => c.status === 'pass'));
  }
});
