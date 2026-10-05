import test from 'node:test';
import assert from 'node:assert/strict';
import { EXPERIMENTS } from '../src/em-course-electrostatics.js';
import { EPS0 } from '../src/em-course-constants.js';

const byId = Object.fromEntries(EXPERIMENTS.map(experiment => [experiment.id, experiment]));
const defaults = id => Object.fromEntries(byId[id].parameters.map(entry => [entry.key, entry.initial]));
const parameters = (id, patch = {}) => ({ ...defaults(id), ...patch });
const evaluate = (id, patch, point) => byId[id].evaluate(parameters(id, patch), point);
const value = (result, key) => result.scalars.find(entry => entry.key === key).value;
function near(actual, expected, absolute = 1e-9, relative = 1e-10) {
  assert.ok(Number.isFinite(actual), 'actual must be finite');
  assert.ok(Math.abs(actual - expected) <= absolute + relative * Math.abs(expected),
    'actual=' + actual + ' expected=' + expected);
}
function nearVector(actual, expected, absolute = 1e-9, relative = 1e-10) {
  actual.forEach((component, axis) => near(component, expected[axis], absolute, relative));
}
function excluded(result, status) {
  assert.equal(result.status, status);
  assert.ok(result.reason.length > 0);
  assert.deepEqual(result.vectors, {});
  assert.deepEqual(result.scalars, []);
}
// Independent numerical integration uses individual source elements, not module antiderivatives.
function lineQuadrature(p, point, n = 2048) {
  const k = 1 / (4 * Math.PI * EPS0 * p.epsilonR);
  const E = [0, 0, 0], step = (p.xEnd - p.xStart) / n;
  let V = 0;
  for (let index = 0; index < n; index++) {
    const r = [point[0] - p.xStart - (index + 0.5) * step, point[1], point[2]];
    const distance = Math.hypot(...r), dq = p.lambda * step;
    for (let axis = 0; axis < 3; axis++) E[axis] += k * dq * r[axis] / distance ** 3;
    V += k * dq / distance;
  }
  return { E, V };
}

test('exact module IDs, SI metadata, callable functions and finite default results', () => {
  assert.deepEqual(EXPERIMENTS.map(entry => entry.id),
    ['line-infinite', 'line-finite', 'sheet-infinite', 'disk-axis', 'parallel-plate']);
  for (const entry of EXPERIMENTS) {
    assert.equal(entry.topic, 'electrostatics');
    for (const key of ['description', 'title', 'modelKind']) assert.ok(entry[key].length > 0);
    for (const key of ['assumptions', 'validity', 'singularities', 'formulas', 'references'])
      assert.ok(entry[key].length > 0);
    for (const p of entry.parameters) {
      for (const key of ['initial', 'min', 'max', 'displayScale']) assert.ok(Number.isFinite(p[key]));
      assert.ok(p.min <= p.initial && p.initial <= p.max && p.displayScale > 0);
    }
    const { evaluate: detached, verify } = entry; // Evaluators must not depend on call binding.
    const p = defaults(entry.id), before = structuredClone(p), point = [...entry.probeDefault];
    const result = detached(p, point);
    assert.equal(result.status, 'valid');
    assert.deepEqual(p, before);
    assert.deepEqual(point, entry.probeDefault);
    assert.ok(verify(p).every(row => row.status === 'pass'));
    for (const components of Object.values(result.vectors)) assert.ok(components.every(Number.isFinite));
    for (const scalar of result.scalars) assert.ok(Number.isFinite(scalar.value) && scalar.unit);
  }
});

test('parent fixture: infinite z-axis line, lambda=2 nC/m, epsilonR=3, r=.04, rRef=.1', () => {
  const result = evaluate('line-infinite', { epsilonR: 3 }, [0.04, 0, 0]);
  assert.equal(result.status, 'valid');
  nearVector(result.vectors.E, [299.585059539, 0, 0], 1e-8);
  near(value(result, 'potential'), 10.9802805385, 1e-9);
});
test('parent fixture: insulating sheet sigma=4 nC/m², epsilonR=2, z=±.03', () => {
  for (const sign of [1, -1]) {
    const result = evaluate('sheet-infinite', { epsilonR: 2 }, [0, 0, sign * 0.03]);
    nearVector(result.vectors.E, [0, 0, sign * 112.940906661], 1e-8);
    near(value(result, 'potential'), -3.38822719982, 1e-9);
  }
});
test('parent fixture: finite x[-.1,.1] line, lambda=2 nC/m, vacuum, P(0,0,.1)', () => {
  nearVector(evaluate('line-finite', {}, [0, 0, 0.1]).vectors.E, [0, 0, 254.206352571], 1e-8);
});
test('parent fixture: disk sigma=1 nC/m², R=.1, z=.1; displayed expected value tolerance', () => {
  const result = evaluate('disk-axis', {}, [0, 0, 0.1]);
  nearVector(result.vectors.E, [0, 0, 16.53981], 5e-6, 0);
});

test('infinite line: signed source, radial rotational symmetry and z translation', () => {
  const positive = evaluate('line-infinite', {}, [0.03, 0.04, 2]);
  const negative = evaluate('line-infinite', { lambda: -2e-9 }, [0.03, 0.04, -2]);
  nearVector(negative.vectors.E, positive.vectors.E.map(x => -x));
  near(value(negative, 'potential'), -value(positive, 'potential'));
  near(positive.vectors.E[0] / positive.vectors.E[1], 3 / 4);
  const rotated = evaluate('line-infinite', {}, [-0.04, 0.03, 9]);
  nearVector(rotated.vectors.E, [-positive.vectors.E[1], positive.vectors.E[0], 0]);
});
test('infinite line: 1/r field law, explicit finite reference and epsilon scaling', () => {
  const first = evaluate('line-infinite', {}, [0.04, 0, 0]);
  const twice = evaluate('line-infinite', {}, [0.08, 0, 0]);
  near(first.vectors.E[0], 2 * twice.vectors.E[0]);
  near(value(evaluate('line-infinite', {}, [0.1, 0, 0]), 'potential'), 0);
  const dielectric = evaluate('line-infinite', { epsilonR: 5 }, [0.04, 0, 0]);
  nearVector(dielectric.vectors.E, first.vectors.E.map(x => x / 5));
  nearVector(dielectric.vectors.D, first.vectors.D, 1e-20);
});

for (const point of [[0.07, 0.04, 0.08], [0.3, 0.05, -0.06], [-0.2, -0.07, 0.03],
  [0.1, 0.04, 0], [-0.1, 0, -0.06]]) {
  test('finite line: general vector at ' + JSON.stringify(point) + ' versus independent element integral', () => {
    const p = parameters('line-finite', { epsilonR: 3 });
    const numerical = lineQuadrature(p, point);
    const analytic = byId['line-finite'].evaluate(p, point);
    assert.equal(analytic.status, 'valid');
    nearVector(analytic.vectors.E, numerical.E, 1e-9, 2e-6);
    near(value(analytic, 'potential'), numerical.V, 1e-9, 2e-6);
  });
}
test('finite line: extension of line is valid with axial field and independent integral', () => {
  for (const x of [-0.3, 0.3]) {
    const p = defaults('line-finite'), point = [x, 0, 0];
    const result = byId['line-finite'].evaluate(p, point), numerical = lineQuadrature(p, point);
    assert.equal(result.status, 'valid');
    nearVector(result.vectors.E, numerical.E, 1e-9, 2e-6);
    near(value(result, 'potential'), numerical.V, 1e-9, 2e-6);
  }
});
test('finite line: near-extension formula converges without fabricated transverse field', () => {
  const axial = evaluate('line-finite', {}, [0.3, 0, 0]);
  const nearby = evaluate('line-finite', {}, [0.3, 1e-10, 0]);
  near(nearby.vectors.E[0], axial.vectors.E[0]);
  near(value(nearby, 'potential'), value(axial, 'potential'));
  assert.ok(nearby.vectors.E[1] > 0);
  assert.ok(nearby.vectors.E[1] < 1e-6);
});
test('finite line: shifted segment is equivalent to shifted observation point', () => {
  const first = evaluate('line-finite', {}, [0.07, 0.04, 0.08]);
  const shifted = evaluate('line-finite', { xStart: 0.3, xEnd: 0.5 }, [0.47, 0.04, 0.08]);
  nearVector(first.vectors.E, shifted.vectors.E);
  near(value(first, 'potential'), value(shifted, 'potential'));
});
test('finite line: signed source, reflection symmetry and dielectric scaling', () => {
  const first = evaluate('line-finite', {}, [0.03, 0.04, 0.07]);
  const mirror = evaluate('line-finite', {}, [-0.03, -0.04, -0.07]);
  const negative = evaluate('line-finite', { lambda: -2e-9 }, [0.03, 0.04, 0.07]);
  const dielectric = evaluate('line-finite', { epsilonR: 4 }, [0.03, 0.04, 0.07]);
  nearVector(mirror.vectors.E, first.vectors.E.map(x => -x));
  near(value(mirror, 'potential'), value(first, 'potential'));
  nearVector(negative.vectors.E, first.vectors.E.map(x => -x));
  near(value(negative, 'potential'), -value(first, 'potential'));
  nearVector(dielectric.vectors.E, first.vectors.E.map(x => x / 4));
  nearVector(dielectric.vectors.D, first.vectors.D, 1e-20);
});
test('finite line: distant source approaches the total point-charge field and potential', () => {
  const result = evaluate('line-finite', {}, [0, 0, 100]);
  const totalCharge = 2e-9 * 0.2, k = 1 / (4 * Math.PI * EPS0);
  near(result.vectors.E[2], k * totalCharge / 100 ** 2, 1e-12, 1e-6);
  near(value(result, 'potential'), k * totalCharge / 100, 1e-12, 1e-6);
});
test('finite line: long line tends to infinite line at perpendicular bisector', () => {
  const finite = evaluate('line-finite', { xStart: -10, xEnd: 10 }, [0, 0, 0.01]);
  const infinite = evaluate('line-infinite', {}, [0.01, 0, 0]);
  near(finite.vectors.E[2], infinite.vectors.E[0], 1e-9, 1e-6);
});

test('sheet: negative source, z reflection, transverse translation, distance independence', () => {
  const first = evaluate('sheet-infinite', {}, [0, 0, 0.03]);
  const lower = evaluate('sheet-infinite', {}, [2, -3, -0.03]);
  const farther = evaluate('sheet-infinite', {}, [4, 5, 8]);
  const negative = evaluate('sheet-infinite', { sigma: -4e-9 }, [0, 0, 0.03]);
  nearVector(lower.vectors.E, first.vectors.E.map(x => -x));
  near(value(lower, 'potential'), value(first, 'potential'));
  nearVector(farther.vectors.E, first.vectors.E);
  nearVector(negative.vectors.E, first.vectors.E.map(x => -x));
  near(value(negative, 'potential'), -value(first, 'potential'));
});
test('sheet: field and potential scale as 1/epsilon while D does not', () => {
  const vacuum = evaluate('sheet-infinite', {}, [0, 0, 0.03]);
  const dielectric = evaluate('sheet-infinite', { epsilonR: 3 }, [0, 0, 0.03]);
  nearVector(dielectric.vectors.E, vacuum.vectors.E.map(x => x / 3));
  near(value(dielectric, 'potential'), value(vacuum, 'potential') / 3);
  nearVector(dielectric.vectors.D, vacuum.vectors.D, 1e-20);
});
test('sheet: displacement jump is free charge density, not a conductor factor', () => {
  const above = evaluate('sheet-infinite', {}, [0, 0, 1e-12]);
  const below = evaluate('sheet-infinite', {}, [0, 0, -1e-12]);
  near(above.vectors.D[2] - below.vectors.D[2], 4e-9, 1e-20);
  near(above.vectors.D[2], 2e-9, 1e-20);
});

test('disk: opposite z gives opposite E and equal V; negative source reverses both', () => {
  const first = evaluate('disk-axis', {}, [0, 0, 0.1]);
  const lower = evaluate('disk-axis', {}, [0, 0, -0.1]);
  const negative = evaluate('disk-axis', { sigma: -1e-9 }, [0, 0, 0.1]);
  nearVector(lower.vectors.E, first.vectors.E.map(x => -x));
  near(value(lower, 'potential'), value(first, 'potential'));
  nearVector(negative.vectors.E, first.vectors.E.map(x => -x));
  near(value(negative, 'potential'), -value(first, 'potential'));
});
test('disk: approaches infinite sheet near center and total point charge far away', () => {
  const nearCenter = evaluate('disk-axis', {}, [0, 0, 1e-9]);
  near(nearCenter.vectors.E[2], 1e-9 / (2 * EPS0), 1e-9, 2e-8);
  const distant = evaluate('disk-axis', {}, [0, 0, 1000]);
  const totalCharge = 1e-9 * Math.PI * 0.1 ** 2;
  near(distant.vectors.E[2], totalCharge / (4 * Math.PI * EPS0 * 1000 ** 2), 1e-15, 2e-8);
  near(value(distant, 'potential'), totalCharge / (4 * Math.PI * EPS0 * 1000), 1e-14, 2e-8);
});
test('disk: very distant axial point retains field through rationalized formula', () => {
  const z = 1e10, result = evaluate('disk-axis', {}, [0, 0, z]);
  const totalCharge = 1e-9 * Math.PI * 0.1 ** 2;
  assert.ok(result.vectors.E[2] > 0);
  near(result.vectors.E[2], totalCharge / (4 * Math.PI * EPS0 * z ** 2), 1e-32, 1e-10);
});
test('disk: homogeneous permittivity scaling', () => {
  const vacuum = evaluate('disk-axis', {}, [0, 0, 0.1]);
  const dielectric = evaluate('disk-axis', { epsilonR: 5 }, [0, 0, 0.1]);
  nearVector(dielectric.vectors.E, vacuum.vectors.E.map(x => x / 5));
  nearVector(dielectric.vectors.D, vacuum.vectors.D, 1e-20);
  near(value(dielectric, 'potential'), value(vacuum, 'potential') / 5);
});

test('plate: fixed Q dielectric insertion reduces E,V,U and keeps Q,D fixed', () => {
  const vacuum = evaluate('parallel-plate', {}, [0, 0, 0.005]);
  const dielectric = evaluate('parallel-plate', { epsilonR: 4 }, [0, 0, 0.005]);
  nearVector(dielectric.vectors.E, vacuum.vectors.E.map(x => x / 4));
  nearVector(dielectric.vectors.D, vacuum.vectors.D, 1e-20);
  near(value(dielectric, 'charge'), 1e-9, 1e-20);
  near(value(dielectric, 'voltage'), value(vacuum, 'voltage') / 4);
  near(value(dielectric, 'energy'), value(vacuum, 'energy') / 4, 1e-20);
  near(value(dielectric, 'capacitance'), value(vacuum, 'capacitance') * 4, 1e-20);
});
test('plate: fixed V dielectric insertion retains E,V and increases Q,D,U', () => {
  const vacuum = evaluate('parallel-plate', { control: 1 }, [0, 0, 0.005]);
  const dielectric = evaluate('parallel-plate', { control: 1, epsilonR: 4 }, [0, 0, 0.005]);
  nearVector(vacuum.vectors.E, [0, 0, 1000]);
  nearVector(dielectric.vectors.E, vacuum.vectors.E);
  nearVector(dielectric.vectors.D, vacuum.vectors.D.map(x => x * 4), 1e-20);
  near(value(dielectric, 'voltage'), 10);
  near(value(dielectric, 'charge'), value(vacuum, 'charge') * 4, 1e-20);
  near(value(dielectric, 'energy'), value(vacuum, 'energy') * 4, 1e-20);
});
test('plate: unused control value cannot change the controlled solution', () => {
  const fixedQ = evaluate('parallel-plate', {}, [0, 0, 0.005]);
  const ignoredV = evaluate('parallel-plate', { voltage: -123 }, [0, 0, 0.005]);
  assert.deepEqual(ignoredV, fixedQ);
  const fixedV = evaluate('parallel-plate', { control: 1 }, [0, 0, 0.005]);
  const ignoredQ = evaluate('parallel-plate', { control: 1, charge: -1e-6 }, [0, 0, 0.005]);
  assert.deepEqual(ignoredQ, fixedV);
});
test('plate: signed control reverses E,D,Q,V; energy stays positive', () => {
  for (const control of [0, 1]) {
    const positive = evaluate('parallel-plate', { control }, [0, 0, 0.005]);
    const negative = evaluate('parallel-plate', { control, charge: -1e-9, voltage: -10 }, [0, 0, 0.005]);
    nearVector(negative.vectors.E, positive.vectors.E.map(x => -x));
    nearVector(negative.vectors.D, positive.vectors.D.map(x => -x), 1e-20);
    for (const key of ['charge', 'voltage', 'potential']) near(value(negative, key), -value(positive, key), 1e-20);
    near(value(negative, 'energy'), value(positive, 'energy'), 1e-20);
  }
});
test('plate: reference V(d)=0 and volume electric energy agree with QV/2', () => {
  const p = parameters('parallel-plate', { epsilonR: 3 });
  const first = byId['parallel-plate'].evaluate(p, [0, 0, p.distance / 4]);
  const next = byId['parallel-plate'].evaluate(p, [9, -8, 3 * p.distance / 4]);
  near(value(first, 'potential'), 3 * value(next, 'potential'));
  near(value(first, 'potential'), value(first, 'voltage') * 0.75);
  const volumeEnergy = 0.5 * first.vectors.E[2] * first.vectors.D[2] * p.area * p.distance;
  near(volumeEnergy, value(first, 'energy'), 1e-20);
});

for (const [id, points, status] of [
  ['line-infinite', [[0, 0, 0], [0, 0, 4]], 'singular'],
  ['line-finite', [[0, 0, 0], [-0.1, 0, 0], [0.1, 0, 0]], 'singular'],
  ['sheet-infinite', [[0, 0, 0], [2, 3, 0]], 'boundary'],
  ['disk-axis', [[0, 0, 0]], 'boundary'],
  ['disk-axis', [[1e-20, 0, 0.1], [0, 0.01, 0]], 'unsupported'],
  ['parallel-plate', [[0, 0, 0], [0, 0, 0.01]], 'boundary'],
  ['parallel-plate', [[0, 0, -0.01], [0, 0, 0.02]], 'unsupported'],
]) {
  test(id + ': excluded region is explicitly ' + status, () => {
    for (const point of points) excluded(evaluate(id, {}, point), status);
  });
}
test('zero-source policy: removed line/sheet/disk have valid zero fields at source geometry', () => {
  for (const [id, key] of [['line-infinite', 'lambda'], ['line-finite', 'lambda'],
    ['sheet-infinite', 'sigma'], ['disk-axis', 'sigma']]) {
    const result = evaluate(id, { [key]: 0 }, [0, 0, 0]);
    assert.equal(result.status, 'valid');
    nearVector(result.vectors.E, [0, 0, 0]);
    nearVector(result.vectors.D, [0, 0, 0]);
    near(value(result, 'potential'), 0);
  }
  excluded(evaluate('disk-axis', { sigma: 0 }, [0.01, 0, 0]), 'unsupported');
});
test('zero plate drive: interior fields/energy zero; interfaces remain explicitly excluded', () => {
  for (const patch of [{ control: 0, charge: 0 }, { control: 1, voltage: 0 }]) {
    const result = evaluate('parallel-plate', patch, [0, 0, 0.005]);
    assert.equal(result.status, 'valid');
    nearVector(result.vectors.E, [0, 0, 0]);
    for (const key of ['charge', 'voltage', 'potential', 'energy']) near(value(result, key), 0);
    excluded(evaluate('parallel-plate', patch, [0, 0, 0]), 'boundary');
  }
});
test('nonzero sources near geometry are not clamped to epsilon distance', () => {
  const first = evaluate('line-infinite', {}, [1e-10, 0, 0]);
  const closer = evaluate('line-infinite', {}, [1e-11, 0, 0]);
  near(closer.vectors.E[0] / first.vectors.E[0], 10);
  assert.ok(first.vectors.E[0] > 1e10);
  const finite = evaluate('line-finite', {}, [0, 0, 1e-10]);
  assert.ok(finite.vectors.E[2] > 1e10);
});

for (const entry of EXPERIMENTS) {
  test(entry.id + ': missing, nonfinite, nonphysical, nonnumeric parameters and invalid probes rejected', () => {
    const p = defaults(entry.id), point = entry.probeDefault;
    for (const params of [null, [], 1, {}, { ...p, epsilonR: 0 }, { ...p, epsilonR: -1 },
      { ...p, epsilonR: 0.9 }, { ...p, epsilonR: Infinity }, { ...p, epsilonR: NaN },
      { ...p, epsilonR: '2' }, { ...p, epsilonR: 1001 }]) excluded(entry.evaluate(params, point), 'invalid');
    for (const point of [null, {}, [], [0, 0], [0, 0, 0, 0], [NaN, 0, 0],
      [Infinity, 0, 0], ['0', 0, 0], Array(3)]) excluded(entry.evaluate(p, point), 'invalid');
    const skip = entry.verify({ ...p, epsilonR: 0 });
    assert.ok(skip.length > 0 && skip.every(row => row.status === 'skipped' && row.reason));
  });
}
test('geometry, reference and discrete control validation is enforced without clamping', () => {
  for (const rRef of [0, -1]) excluded(evaluate('line-infinite', { rRef }, [0.1, 0, 0]), 'invalid');
  for (const patch of [{ xStart: 0.1, xEnd: 0.1 }, { xStart: 0.2, xEnd: 0.1 }])
    excluded(evaluate('line-finite', patch, [0, 0, 0.1]), 'invalid');
  for (const radius of [0, -0.1]) excluded(evaluate('disk-axis', { radius }, [0, 0, 0.1]), 'invalid');
  for (const patch of [{ area: 0 }, { distance: 0 }, { area: -1 }, { distance: -1 }, { control: 0.5 }])
    excluded(evaluate('parallel-plate', patch, [0, 0, 0.005]), 'invalid');
});
test('overflow is returned as invalid with no fabricated finite field', () => {
  excluded(evaluate('line-infinite', {}, [Number.MIN_VALUE, 0, 0]), 'invalid');
  excluded(evaluate('line-finite', {}, [0, 0, Number.MIN_VALUE]), 'invalid');
});

test('bounded verification: 12 default rows and 2 fixed-voltage plate rows are independent pass rows', () => {
  let count = 0;
  for (const entry of EXPERIMENTS) {
    for (const patch of [{}, ...(entry.id === 'parallel-plate' ? [{ control: 1 }] : [])]) {
      const rows = entry.verify(parameters(entry.id, patch));
      count += rows.length;
      for (const row of rows) {
        assert.equal(row.status, 'pass', row.label + ': ' + row.reason);
        assert.ok(row.method && row.label && row.unit);
        for (const key of ['actual', 'expected', 'absTolerance', 'relTolerance']) assert.ok(Number.isFinite(row[key]));
      }
    }
  }
  assert.equal(count, 14);
});
test('verification remains correct for negative and zero sources', () => {
  for (const entry of EXPERIMENTS) {
    const sourceKey = entry.parameters.find(p => ['lambda', 'sigma', 'charge'].includes(p.key)).key;
    for (const factor of [-1, 0]) {
      const p = defaults(entry.id);
      p[sourceKey] *= factor;
      assert.ok(entry.verify(p).every(row => row.status === 'pass'), entry.id + ' source factor ' + factor);
    }
  }
});
