import test from 'node:test';
import assert from 'node:assert/strict';
import { EXPERIMENTS } from '../src/em-course-boundaries.js';
const [face, plate] = EXPERIMENTS;
const defaults = def => Object.fromEntries(def.parameters.map(p => [p.key, p.initial]));
const value = (r, key) => { const entry = r.scalars.find(s => s.key === key); assert.ok(entry, key); return entry.value; };
const near = (actual, expected, abs = 1e-11) =>
  assert.ok(Math.abs(actual - expected) <= abs + 2e-12 * Math.abs(expected), actual + ' ≠ ' + expected);
const finite = result => {
  for (const v of Object.values(result.vectors)) { assert.equal(v.length, 3); assert.ok(v.every(Number.isFinite)); }
  for (const s of result.scalars) assert.ok(Number.isFinite(s.value), s.key);
};
const p = defaults(face), q = defaults(plate);

test('parent boundary fixture: 2ε0→5ε0, E1(30,0,40)→E2(30,0,16)', () => {
  const one = face.evaluate(p, [0, 0, -1]), two = face.evaluate(p, [0, 0, 1]);
  assert.equal(one.status, 'valid'); assert.equal(two.status, 'valid');
  assert.deepEqual(one.vectors.E, [30, 0, 40]);
  two.vectors.E.forEach((v, i) => near(v, [30, 0, 16][i]));
  near(two.vectors.D[2], 7.08335025504e-10, 1e-22);
  near(value(two, 'normalDJump'), 0, 1e-22);
});
test('signed free surface charge adds with requested +z normal', () => {
  const plus = face.evaluate({ ...p, sigmaFree: 8.8541878188e-11 }, [0, 0, 1]);
  const minus = face.evaluate({ ...p, E1z: -40, sigmaFree: -8.8541878188e-11 }, [0, 0, 1]);
  near(plus.vectors.E[2], 18); near(minus.vectors.E[2], -18);
  near(value(plus, 'normalDJump'), 8.8541878188e-11, 1e-22);
});
test('tangential E remains continuous, tangential D changes with material', () => {
  const r = face.evaluate({ ...p, E1y: -7 }, [1, 4, 1]);
  assert.deepEqual(r.vectors.E.slice(0, 2), [30, -7]);
  near(value(r, 'D2x') / value(r, 'D1x'), 2.5);
});
test('boundary exposes both limits and no unique vector', () => {
  const r = face.evaluate(p, [0.2, -0.1, 0]);
  assert.equal(r.status, 'boundary'); assert.deepEqual(r.vectors, {});
  near(value(r, 'E1z'), 40); near(value(r, 'E2z'), 16); finite(r);
});
test('permittivity alone cannot infer an unspecified one-sided field', () => {
  assert.equal(face.evaluate({ epsilon1R: 2, epsilon2R: 5, sigmaFree: 0 }, [0, 0, 1]).status, 'invalid');
  for (const key of ['E1x', 'E1y', 'E1z']) {
    const missing = { ...p }; delete missing[key];
    assert.equal(face.evaluate(missing, [0, 0, 1]).status, 'invalid');
  }
});
test('equal materials and zero charge reproduce one field', () => {
  const r = face.evaluate({ ...p, epsilon2R: 2 }, [0, 0, 1]);
  assert.deepEqual(r.vectors.E, [30, 0, 40]);
});
test('interface verification enforces independently specified Maxwell constraints', () => {
  for (const sigmaFree of [0, 4e-9, -4e-9]) {
    const rows = face.verify({ ...p, sigmaFree, E1y: 8 });
    assert.equal(rows.length, 3); assert.ok(rows.every(r => r.status === 'pass'));
    near(rows[0].expected, sigmaFree, 1e-22);
  }
});
test('fixed Q layer fixture: capacitance, fields, voltage and energy', () => {
  const r = plate.evaluate(q, [0, 0, 0.0005]);
  assert.equal(r.status, 'valid');
  near(value(r, 'capacitance'), 1.9675972930666668e-10, 1e-23);
  near(value(r, 'charge'), 2e-9, 1e-22);
  near(value(r, 'D1z'), 1e-7, 1e-22); near(value(r, 'D2z'), 1e-7, 1e-22);
  near(value(r, 'E1z'), 5647.045333038401);
  near(value(r, 'E2z'), 2258.8181332153604);
  near(value(r, 'voltage'), 10.164681599469121);
  near(value(r, 'energy'), 1.0164681599469122e-8, 1e-22);
});
test('fixed V layer fixture (12V): solved charge and voltage partition', () => {
  const r = plate.evaluate({ ...q, control: 1 }, [0, 0, 0.002]);
  near(value(r, 'charge'), 2.36111675168e-9, 1e-22);
  near(value(r, 'E1z'), 6666.666666666667);
  near(value(r, 'E2z'), 2666.666666666667);
  near(value(r, 'voltage'), 12);
  near(value(r, 'potential'), 2.6666666666666665);
});
test('doubling both permittivities at fixed Q: D constant, E/V/U halve, C doubles', () => {
  const a = plate.evaluate(q, [0, 0, 0.0005]);
  const b = plate.evaluate({ ...q, epsilon1R: 4, epsilon2R: 10 }, [0, 0, 0.0005]);
  for (const key of ['D1z', 'D2z', 'charge']) near(value(b, key), value(a, key), 1e-22);
  for (const key of ['E1z', 'E2z', 'voltage', 'energy']) near(value(b, key), value(a, key) / 2, key === 'energy' ? 1e-22 : 1e-11);
  near(value(b, 'capacitance'), 2 * value(a, 'capacitance'), 1e-23);
});
test('doubling permittivities at fixed V: E/V constant, D/Q/U/C double', () => {
  const a = plate.evaluate({ ...q, control: 1 }, [0, 0, 0.0005]);
  const b = plate.evaluate({ ...q, control: 1, epsilon1R: 4, epsilon2R: 10 }, [0, 0, 0.0005]);
  for (const key of ['E1z', 'E2z', 'voltage']) near(value(b, key), value(a, key));
  for (const key of ['D1z', 'D2z', 'charge', 'energy', 'capacitance']) near(value(b, key), 2 * value(a, key), 1e-22);
});
test('changing only layer2 at fixed Q affects only E2 and its voltage contribution', () => {
  const a = plate.evaluate(q, [0, 0, 0.0005]);
  const b = plate.evaluate({ ...q, epsilon2R: 10 }, [0, 0, 0.0005]);
  near(value(b, 'E1z'), value(a, 'E1z')); near(value(b, 'E2z'), value(a, 'E2z') / 2);
  near(value(b, 'voltage'), 7.905863466253761);
});
test('all layer interfaces show correct signed one-sided D jumps', () => {
  for (const sign of [1, -1]) {
    const params = { ...q, charge: sign * 2e-9 };
    for (const [z, minus, plus, jump] of [[0, 0, sign * 1e-7, sign * 1e-7],
      [q.d1, sign * 1e-7, sign * 1e-7, 0], [q.d1 + q.d2, sign * 1e-7, 0, -sign * 1e-7]]) {
      const r = plate.evaluate(params, [0, 0, z]);
      assert.equal(r.status, 'boundary'); assert.deepEqual(r.vectors, {});
      near(value(r, 'DzMinus'), minus, 1e-22); near(value(r, 'DzPlus'), plus, 1e-22);
      near(value(r, 'sigmaFreeBoundary'), jump, 1e-22); finite(r);
    }
  }
});
test('potential is continuous, -dV/dz matches each layer field, top reference is zero', () => {
  const h = 1e-9;
  for (const z of [0.0005, 0.002]) {
    const l = plate.evaluate(q, [0, 0, z - h]), r = plate.evaluate(q, [0, 0, z + h]);
    const mid = plate.evaluate(q, [0, 0, z]);
    const derivative = -(value(r, 'potential') - value(l, 'potential')) / (2 * h);
    assert.ok(Math.abs(derivative - mid.vectors.E[2]) < 2e-6);
  }
  const inter = plate.evaluate(q, [0, 0, q.d1]);
  near(value(inter, 'potential'), 4.517636266430721);
  assert.equal(value(plate.evaluate(q, [0, 0, q.d1 + q.d2]), 'potential'), 0);
});
test('exterior field is zero with explicitly stated balanced plate assumption', () => {
  for (const z of [-1, 1]) {
    const r = plate.evaluate(q, [2, 2, z]); assert.equal(r.status, 'valid');
    assert.deepEqual(r.vectors, { E: [0, 0, 0], D: [0, 0, 0] });
  }
});
test('inactive Q/V controls never alter the chosen solution', () => {
  for (const control of [0, 1]) {
    const a = plate.evaluate({ ...q, control }, [0, 0, 0.0005]);
    const b = plate.evaluate({ ...q, control, ...(control ? { charge: -1e-3 } : { voltage: -1e9 }) }, [0, 0, 0.0005]);
    assert.deepEqual(a.vectors, b.vectors); assert.deepEqual(a.scalars, b.scalars);
  }
});
test('layer bounded quadrature passes for both controls and signed/zero drive', () => {
  for (const control of [0, 1]) for (const sign of [-1, 0, 1]) {
    const rows = plate.verify({ ...q, control, charge: sign * q.charge, voltage: sign * q.voltage });
    assert.equal(rows.length, 3); assert.ok(rows.every(r => r.status === 'pass'), JSON.stringify(rows));
  }
});
test('invalid geometry/control is rejected without clamp or synthetic fields', () => {
  for (const patch of [{ area: 0 }, { d1: 0 }, { d2: -1 }, { epsilon1R: 0 }, { control: 0.5 }]) {
    const r = plate.evaluate({ ...q, ...patch }, [0, 0, 0.001]);
    assert.equal(r.status, 'invalid'); assert.deepEqual(r.vectors, {});
    assert.equal(plate.verify({ ...q, ...patch })[0].status, 'skipped');
  }
});
test('all definitions validate missing/nonfinite/out-of-range numbers and malformed points', () => {
  for (const def of EXPERIMENTS) {
    const initial = defaults(def);
    for (const entry of def.parameters) {
      const missing = { ...initial }; delete missing[entry.key];
      for (const params of [missing, { ...initial, [entry.key]: NaN },
        { ...initial, [entry.key]: Infinity }, { ...initial, [entry.key]: '2' },
        { ...initial, [entry.key]: entry.max + Math.max(1, Math.abs(entry.max)) }])
        assert.equal(def.evaluate(params, def.probeDefault).status, 'invalid', def.id + ':' + entry.key);
    }
    for (const point of [[], [0, 0], [0, 0, NaN], [0, 0, Infinity], [0, '0', 0], new Array(3), {}])
      assert.equal(def.evaluate(initial, point).status, 'invalid');
    for (const params of [null, [], new Date(), Object.create({ bad: 1 })])
      assert.equal(def.evaluate(params, def.probeDefault).status, 'invalid');
  }
});
test('metadata includes SI display, sources, limits and finite API; evaluate is pure', () => {
  const ids = new Set();
  for (const def of EXPERIMENTS) {
    assert.ok(!ids.has(def.id)); ids.add(def.id);
    for (const key of ['assumptions', 'validity', 'singularities', 'formulas', 'references']) assert.ok(def[key].length);
    assert.ok(def.references.every(r => /^https:\/\//.test(r.url)));
    const params = defaults(def), before = structuredClone(params), point = [...def.probeDefault];
    finite(def.evaluate(params, point)); assert.deepEqual(params, before); assert.deepEqual(point, def.probeDefault);
    for (const row of def.verify(params)) {
      assert.ok(['pass', 'fail', 'skipped'].includes(row.status)); assert.ok(row.method); assert.ok(row.unit);
      for (const key of ['actual', 'expected', 'absTolerance', 'relTolerance']) assert.ok(Number.isFinite(row[key]));
    }
    assert.equal(def.evaluate(Object.assign(Object.create(null), params), point).status, 'valid');
  }
});
