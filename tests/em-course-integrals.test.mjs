import test from 'node:test';
import assert from 'node:assert/strict';
import { EXPERIMENTS } from '../src/em-course-integrals.js';
const [point, line, sheet, wire] = EXPERIMENTS;
const defaults = def => Object.fromEntries(def.parameters.map(p => [p.key, p.initial]));
const val = (r, key) => { const s = r.scalars.find(s => s.key === key); assert.ok(s, key); return s.value; };
const near = (a, b, abs = 1e-11) => assert.ok(Math.abs(a - b) <= abs + 2e-12 * Math.abs(b), a + ' ≠ ' + b);
const ps = defaults(point), ls = defaults(line), ss = defaults(sheet), ws = defaults(wire);
const pass = rows => assert.ok(rows.length && rows.every(row => row.status === 'pass'), JSON.stringify(rows));

test('fixed point charge E/D fixture at radius 0.2m', () => {
  const r = point.evaluate(ps, [0.2, 0, 0]);
  assert.equal(r.status, 'valid'); near(r.vectors.E[0], 898.7551786170799);
  near(r.vectors.D[0], 7.957747154594766e-9, 1e-22);
  assert.equal(val(r, 'enclosedCharge'), 4e-9); assert.equal(val(r, 'fluxD'), 4e-9);
});
test('point charge vector is radial and sign reverses', () => {
  const a = point.evaluate(ps, [0, 0.2, 0]), b = point.evaluate({ ...ps, charge: -4e-9 }, [0, 0.2, 0]);
  near(a.vectors.E[1], 898.7551786170799); near(b.vectors.E[1], -898.7551786170799);
  assert.equal(a.vectors.E[0], 0); assert.equal(a.vectors.E[2], 0);
});
test('external point charge produces nonzero local E but zero closed-sphere flux', () => {
  const params = { ...ps, centerZ: 0.8 };
  const r = point.evaluate(params, [0, 0, 0.8]);
  assert.ok(r.vectors.E[2] > 0); assert.equal(val(r, 'fluxD'), 0); assert.equal(val(r, 'enclosedCharge'), 0);
  pass(point.verify(params));
  near(point.verify(params)[0].actual, 0, 1e-15);
});
test('offset inside sphere uses surface quadrature rather than E×area shortcut', () => {
  const params = { ...ps, centerZ: 0.15 };
  pass(point.verify(params));
  const a = point.evaluate(params, [0, 0, 0.45]), b = point.evaluate(params, [0, 0, -0.15]);
  assert.ok(Math.abs(a.vectors.E[2]) < Math.abs(b.vectors.E[2]));
  near(val(a, 'fluxD'), 4e-9, 1e-22);
});
test('point singularity and source exactly on sphere are distinct', () => {
  assert.equal(point.evaluate(ps, [0, 0, 0]).status, 'singular');
  const params = { ...ps, centerZ: ps.radius };
  const r = point.evaluate(params, [0, 0, 1]);
  assert.equal(r.status, 'boundary'); assert.deepEqual(r.vectors, {}); assert.deepEqual(r.scalars, []);
  assert.equal(point.verify(params)[0].status, 'skipped');
});
test('near-surface source has analytic flux and convergence is estimated without a distance cutoff', () => {
  const params = { ...ps, centerZ: 0.299 };
  assert.equal(point.evaluate(params, [1, 0, 0]).status, 'valid');
  pass(point.verify(params));
});
test('zero point charge removes source singularity and surface ambiguity', () => {
  const params = { ...ps, charge: 0, centerZ: ps.radius };
  const r = point.evaluate(params, [0, 0, 0]);
  assert.equal(r.status, 'valid'); assert.deepEqual(r.vectors, { E: [0, 0, 0], D: [0, 0, 0] }); pass(point.verify(params));
});
test('fixed infinite line E fixture and independent enclosed cylinder charge', () => {
  const r = line.evaluate(ls, [0.1, 0, 0]);
  near(r.vectors.E[0], 359.5020714468319); near(r.vectors.D[0], 3.183098861837907e-9, 1e-22);
  near(val(r, 'enclosedCharge'), 8e-10, 1e-22);
  near(val(r, 'sideFluxD'), 8e-10, 1e-22); assert.equal(val(r, 'capsFluxD'), 0); pass(line.verify(ls));
});
test('line cylinder flux depends on height but not radius; local field falls as 1/r', () => {
  const a = line.evaluate(ls, [0.1, 0, 0]);
  const b = line.evaluate({ ...ls, radius: 0.2, height: 0.8 }, [0.2, 0, 6]);
  near(b.vectors.E[0], a.vectors.E[0] / 2);
  near(val(b, 'fluxD'), 2 * val(a, 'fluxD'), 1e-22);
  pass(line.verify({ ...ls, radius: 0.2, height: 0.8, lambda: -2e-9 }));
});
test('line axis singular unless charge absent', () => {
  const r = line.evaluate(ls, [0, 0, 20]);
  assert.equal(r.status, 'singular'); assert.deepEqual(r.vectors, {});
  assert.equal(line.evaluate({ ...ls, lambda: 0 }, [0, 0, 20]).status, 'valid');
});
test('sheet signed E and straddling pillbox flux fixed fixtures', () => {
  const a = sheet.evaluate(ss, [0, 0, 0.02]), b = sheet.evaluate(ss, [0, 0, -0.02]);
  near(a.vectors.E[2], 225.88181332153604); near(b.vectors.E[2], -225.88181332153604);
  near(val(a, 'enclosedCharge'), 1.2e-10, 1e-22);
  near(val(a, 'topFluxD'), 6e-11, 1e-22); near(val(a, 'bottomFluxD'), 6e-11, 1e-22); pass(sheet.verify(ss));
});
test('pillbox outside sheet has incoming/outgoing cancellation with nonzero E', () => {
  for (const centerZ of [-0.2, 0.2]) {
    const params = { ...ss, centerZ };
    const r = sheet.evaluate(params, [0, 0, centerZ]);
    assert.ok(Math.abs(r.vectors.E[2]) > 0);
    assert.equal(val(r, 'enclosedCharge'), 0); near(val(r, 'topFluxD') + val(r, 'bottomFluxD'), 0, 1e-22);
    pass(sheet.verify(params));
  }
});
test('sheet observation boundary returns one-sided E/D without average', () => {
  const r = sheet.evaluate(ss, [1, 1, 0]);
  assert.equal(r.status, 'boundary'); assert.deepEqual(r.vectors, {});
  near(val(r, 'EzMinus'), -225.88181332153604); near(val(r, 'EzPlus'), 225.88181332153604);
});
test('pillbox cap on sheet is ambiguous: no invented half-charge flux', () => {
  for (const sign of [-1, 1]) {
    const params = { ...ss, centerZ: sign * ss.halfHeight };
    const r = sheet.evaluate(params, [0, 0, 0.2]);
    assert.equal(r.status, 'boundary'); assert.deepEqual(r.scalars, []);
    assert.equal(sheet.verify(params)[0].status, 'skipped');
  }
  pass(sheet.verify({ ...ss, sigma: 0, centerZ: ss.halfHeight }));
});
test('doubling epsilon halves E and E flux, D and enclosed free charge stay fixed', () => {
  for (const [def, params] of [[point, ps], [line, ls], [sheet, ss]]) {
    const a = def.evaluate(params, def.probeDefault), b = def.evaluate({ ...params, epsilonR: 2 }, def.probeDefault);
    for (let i = 0; i < 3; i++) { near(b.vectors.E[i], a.vectors.E[i] / 2); near(b.vectors.D[i], a.vectors.D[i], 1e-22); }
    near(val(b, 'fluxE'), val(a, 'fluxE') / 2); near(val(b, 'fluxD'), val(a, 'fluxD'), 1e-22);
  }
});
test('ideal wire fixed B/H fixtures with positive +z current', () => {
  const r = wire.evaluate(ws, [0.1, 0, 0]);
  near(r.vectors.H[1], 4.77464829275686); near(r.vectors.B[1], 5.999999999207804e-6, 1e-18);
  near(val(r, 'enclosedCurrent'), 3); near(val(r, 'circulationH'), 3);
  near(val(r, 'circulationB'), 3.76991118381e-6, 1e-18); pass(wire.verify(ws));
});
test('right-hand direction: azimuthal magnetic vector at four quadrants', () => {
  for (const [p, expected] of [[[0.1, 0, 0], [0, 1]], [[0, 0.1, 0], [-1, 0]],
    [[-0.1, 0, 0], [0, -1]], [[0, -0.1, 0], [1, 0]]]) {
    const r = wire.evaluate(ws, p);
    near(r.vectors.H[0], 4.77464829275686 * expected[0]);
    near(r.vectors.H[1], 4.77464829275686 * expected[1]);
  }
});
test('uniform-current cylinder captures only path disk area, axis is regular', () => {
  const params = { ...ws, wireRadius: 0.2 };
  const r = wire.evaluate(params, [0.1, 0, 0]);
  near(val(r, 'enclosedCurrent'), 0.75); near(r.vectors.H[1], 1.193662073189215);
  near(r.vectors.B[1], 1.499999999801951e-6, 1e-18);
  const axis = wire.evaluate(params, [0, 0, 1]);
  assert.equal(axis.status, 'valid'); assert.deepEqual(axis.vectors, { H: [0, 0, 0], B: [0, 0, 0] });
  pass(wire.verify(params));
  near(val(wire.evaluate({ ...params, pathRadius: 0.3 }, [0.3, 0, 0]), 'enclosedCurrent'), 3);
});
test('path orientation reverses circulation and enclosed signed current, preserves field', () => {
  const params = { ...ws, wireRadius: 0.2 };
  const a = wire.evaluate(params, [0.1, 0, 0]), b = wire.evaluate({ ...params, orientation: -1 }, [0.1, 0, 0]);
  assert.deepEqual(a.vectors, b.vectors);
  for (const key of ['enclosedCurrent', 'circulationH', 'circulationB']) near(val(b, key), -val(a, key), 1e-18);
  pass(wire.verify({ ...params, orientation: -1 }));
});
test('cylinder surface displays continuous one-sided fields; boundary path check skipped', () => {
  const params = { ...ws, wireRadius: 0.2, pathRadius: 0.2 };
  const r = wire.evaluate(params, [0.2, 0, 0]);
  assert.equal(r.status, 'boundary'); assert.deepEqual(r.vectors, {});
  near(val(r, 'HphiMinus'), 2.38732414637843); near(val(r, 'HphiMinus'), val(r, 'HphiPlus'));
  near(val(r, 'BphiMinus'), val(r, 'BphiPlus'), 1e-18);
  assert.equal(wire.verify(params)[0].status, 'skipped');
});
test('ideal wire axis singular and zero current removes singularity', () => {
  assert.equal(wire.evaluate(ws, [0, 0, 0]).status, 'singular');
  const r = wire.evaluate({ ...ws, current: 0 }, [0, 0, 0]);
  assert.equal(r.status, 'valid'); pass(wire.verify({ ...ws, current: 0 }));
});
test('mu change scales B and B circulation, preserves H/current', () => {
  const a = wire.evaluate(ws, [0.1, 0, 0]), b = wire.evaluate({ ...ws, muR: 5 }, [0.1, 0, 0]);
  near(b.vectors.H[1], a.vectors.H[1]); near(b.vectors.B[1], 5 * a.vectors.B[1], 1e-18);
  near(val(b, 'circulationB'), 5 * val(a, 'circulationB'), 1e-18);
});
test('geometry, direction and invalid numbers rejected without clamping', () => {
  for (const [def, params, patch] of [[point, ps, { radius: 0 }], [line, ls, { height: 0 }],
    [sheet, ss, { area: 0 }], [sheet, ss, { halfHeight: 0 }], [wire, ws, { pathRadius: 0 }],
    [wire, ws, { orientation: 0 }], [wire, ws, { orientation: 0.5 }], [wire, ws, { wireRadius: 1e-20 }]]) {
    const r = def.evaluate({ ...params, ...patch }, def.probeDefault);
    assert.equal(r.status, 'invalid'); assert.deepEqual(r.vectors, {});
    assert.equal(def.verify({ ...params, ...patch })[0].status, 'skipped');
  }
});
test('all definitions reject missing/nonfinite/nonplain params and malformed points', () => {
  for (const def of EXPERIMENTS) {
    const params = defaults(def);
    for (const entry of def.parameters) {
      const missing = { ...params }; delete missing[entry.key];
      for (const p of [missing, { ...params, [entry.key]: NaN }, { ...params, [entry.key]: Infinity },
        { ...params, [entry.key]: '3' }, { ...params, [entry.key]: entry.max + Math.max(1, Math.abs(entry.max)) }])
        assert.equal(def.evaluate(p, def.probeDefault).status, 'invalid');
    }
    for (const p of [null, [], new Date(), Object.create({ bad: 1 })]) assert.equal(def.evaluate(p, def.probeDefault).status, 'invalid');
    for (const p of [[], [0, 0], [0, 0, NaN], [0, 0, Infinity], [0, '0', 0], new Array(3), {}])
      assert.equal(def.evaluate(params, p).status, 'invalid');
  }
});
test('bounded verification stays finite and correct for signed/zero amplitudes', () => {
  for (const def of EXPERIMENTS) {
    const params = defaults(def), drive = def === point ? 'charge' : def === line ? 'lambda' : def === sheet ? 'sigma' : 'current';
    for (const sign of [-1, 0, 1]) {
      const rows = def.verify({ ...params, [drive]: sign * params[drive] }); pass(rows);
      for (const row of rows) for (const key of ['actual', 'expected', 'absTolerance', 'relTolerance']) assert.ok(Number.isFinite(row[key]));
    }
  }
});
test('independent closed-box midpoint flux verifies exterior point charge cancellation', () => {
  // Test-only Coulomb oracle, not imported from the production evaluator.
  // Box centered at z=.8, half-side .1 contains no source. All six faces included.
  function integrateBox(n) {
  let flux = 0; const delta = 0.2 / n, centers = [0, 0, 0.8];
  for (let axis = 0; axis < 3; axis++) for (const sign of [-1, 1]) {
    const other = [0, 1, 2].filter(i => i !== axis);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const p = [...centers]; p[axis] += sign * 0.1;
      p[other[0]] += -0.1 + (i + 0.5) * delta; p[other[1]] += -0.1 + (j + 0.5) * delta;
      const r = Math.hypot(...p);
      flux += sign * 4e-9 * p[axis] / (4 * Math.PI * r ** 3) * delta ** 2;
    }
  }
  return flux;
  }
  const coarse = integrateBox(32), fine = integrateBox(64);
  assert.ok(Math.abs(fine) < 0.3 * Math.abs(coarse), 'midpoint quadrature should converge as O(h²)');
  near(fine, 0, 2e-16);
  assert.equal(val(point.evaluate({ ...ps, centerZ: 0.8 }, [0, 0, 0.8]), 'fluxD'), 0);
});
test('overflow/subnormal source distances are explicitly invalid and never NaN/Infinity', () => {
  for (const [def, params, p] of [[point, ps, [Number.MIN_VALUE, 0, 0]], [line, ls, [Number.MIN_VALUE, 0, 0]],
    [wire, ws, [Number.MIN_VALUE, 0, 0]], [point, ps, [1e308, 1e308, 1e308]]]) {
    const r = def.evaluate(params, p); assert.equal(r.status, 'invalid'); assert.deepEqual(r.vectors, {});
  }
});
test('metadata, purity and all valid/boundary fields conform to finite SI contract', () => {
  const ids = new Set();
  for (const def of EXPERIMENTS) {
    assert.ok(!ids.has(def.id)); ids.add(def.id);
    for (const key of ['assumptions', 'validity', 'singularities', 'formulas', 'references']) assert.ok(def[key].length);
    assert.ok(def.references.every(r => /^https:\/\//.test(r.url)));
    const params = defaults(def), before = structuredClone(params), probe = [...def.probeDefault];
    const r = def.evaluate(params, probe); assert.equal(r.status, 'valid');
    for (const v of Object.values(r.vectors)) assert.ok(v.length === 3 && v.every(Number.isFinite));
    for (const s of r.scalars) assert.ok(Number.isFinite(s.value));
    assert.deepEqual(params, before); assert.deepEqual(probe, def.probeDefault);
    assert.equal(def.evaluate(Object.assign(Object.create(null), params), probe).status, 'valid');
  }
});


test('reported sphere verification fixtures converge under unchanged physical tolerances', () => {
  for (const centerZ of [0.36, 0.264, 0.255, -0.36, -0.264, -0.255])
    for (const charge of [4e-9, -4e-9]) for (const epsilonR of [1, 6.4]) {
      const rows = point.verify({ ...ps, centerZ, charge, epsilonR });
      pass(rows);
      assert.equal(rows[0].absTolerance, 1e-15);
      assert.equal(rows[1].absTolerance, 1e-4);
      assert.equal(rows[0].relTolerance, 2e-5);
      assert.equal(rows[1].relTolerance, 2e-5);
      assert.equal(rows[0].expected, Math.abs(centerZ) < ps.radius ? charge : 0);
      assert.ok(rows[0].estimatedError <= (1e-15 + 2e-5 * Math.abs(rows[0].expected)) / 10);
      assert.ok(rows[1].estimatedError <= (1e-4 + 2e-5 * Math.abs(rows[1].expected)) / 10);
      assert.ok(rows.every(row => row.sampleCount > 0 && row.sampleCount <= 2047));
    }
});
test('near-surface quadrature refines when possible and skips unresolved error with actual preserved', () => {
  const resolved = point.verify({ ...ps, centerZ: 0.299 });
  pass(resolved);
  const params = { ...ps, centerZ: 0.300000000001 };
  assert.equal(point.evaluate(params, [1, 0, 0]).status, 'valid');
  let evaluations = 0;
  const evaluate = point.evaluate;
  point.evaluate = function (...args) { evaluations++; return evaluate(...args); };
  let rows;
  try { rows = point.verify(params); } finally { point.evaluate = evaluate; }
  assert.ok(evaluations <= 2048);
  assert.equal(evaluations, rows[0].sampleCount + 1);
  assert.ok(rows.every(row => row.status === 'skipped' && row.reason.includes('수렴 미확보')));
  assert.ok(rows.every(row => Number.isFinite(row.actual) && Number.isFinite(row.estimatedError)));
  assert.equal(rows[0].expected, 0);
  assert.notEqual(rows[0].actual, rows[0].expected, 'unresolved numerical actual must not be replaced by analytic zero');
  assert.ok(rows[0].estimatedError > rows[0].absTolerance);
});
test('converged numerical flux still detects a physical field mismatch', () => {
  const evaluate = point.evaluate;
  point.evaluate = function (...args) {
    const r = evaluate(...args);
    if (r.status !== 'valid') return r;
    return { ...r, vectors: Object.fromEntries(Object.entries(r.vectors).map(([key, v]) => [key, v.map(x => 1.01 * x)])) };
  };
  let rows;
  try { rows = point.verify({ ...ps, centerZ: 0.15 }); } finally { point.evaluate = evaluate; }
  assert.equal(rows[0].status, 'fail');
  assert.equal(rows[1].status, 'fail');
  assert.equal(rows[2].status, 'pass');
  assert.equal(rows[0].expected, 4e-9);
  assert.ok(Math.abs(rows[0].actual - 4.04e-9) <= 8e-15);
});
