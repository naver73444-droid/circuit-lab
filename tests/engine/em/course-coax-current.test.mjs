import test from 'node:test';
import assert from 'node:assert/strict';
import { EXPERIMENTS } from '../../../src/em-course-magnetostatics.js';

const definitions = EXPERIMENTS.filter(item => item.id.startsWith('coax-current'));
const thin = definitions.find(item => item.id === 'coax-current');
const thick = definitions.find(item => item.id === 'coax-current-thick');
const surface = definitions.find(item => item.id === 'coax-current-surface');
const params = Object.freeze({ a: .01, b: .03, muR: 1, current: 3 });
const thickParams = Object.freeze({ ...params, c: .04 });
// Analytic fixture fixed before implementation in 9e23e61 protocol. These are
// test literals independent of all evaluator/helper functions.
const fixture = Object.freeze({ coreH: 23.8732414637843, coreB: 2.9999999996039017e-5,
  aH: 47.7464829275686, aB: 5.9999999992078034e-5,
  bH: 15.915494309189535, bB: 1.9999999997359345e-5,
  thickI: 1.6071428571428572, thickH: 7.308135141974785, thickB: 9.18367346817521e-6 });
const value = (result, key) => result.scalars.find(item => item.key === key)?.value;
function near(actual, expected, absolute = 1e-18, relative = 1e-10) {
  assert.ok(Number.isFinite(actual), `not finite: ${actual}`);
  assert.ok(Math.abs(actual - expected) <= absolute + relative * Math.abs(expected), `${actual} != ${expected}`);
}
function finiteTree(tree) {
  if (typeof tree === 'number') assert.ok(Number.isFinite(tree));
  else if (tree && typeof tree === 'object') for (const entry of Object.values(tree)) finiteTree(entry);
}

test('three explicit current-distribution models publish SI parameters and radial signals', () => {
  assert.equal(definitions.length, 3);
  for (const definition of definitions) {
    assert.equal(definition.topic, 'magnetostatics');
    assert.equal(definition.view.kind, 'coax-cross-section');
    assert.equal(definition.view.profileAxis, 'r');
    assert.deepEqual(definition.signals.map(signal => signal.key), ['Bphi', 'Hphi', 'enclosedCurrent']);
    assert.ok(definition.parameters.find(item => item.key === 'b').label.includes('축'));
    assert.ok(definition.validity.some(item => item.includes('b−a')));
    const initial = Object.fromEntries(definition.parameters.map(item => [item.key, item.initial]));
    assert.equal(definition.evaluate(initial, definition.probeDefault).status, 'valid');
    assert.ok(definition.formulas[0].label.startsWith('기호'));
  }
});

test('symbolic answer is primary: region expressions, derivation, signed direction and flux distinction', () => {
  const answer = thin.symbolicAnswer;
  assert.equal(answer.pieces[0].enclosedCurrent, 'I r²/a²');
  assert.equal(answer.pieces[0].Bphi, 'μ I r/(2πa²)');
  assert.equal(answer.pieces[1].Hphi, 'I/(2πr)');
  assert.equal(answer.pieces[1].Bphi, 'μ I/(2πr)');
  assert.equal(answer.pieces.at(-1).enclosedCurrent, 'I+(−I)=0');
  assert.ok(answer.derivation.some(step => step.equation.includes('2πr Hφ')));
  assert.ok(answer.direction.positiveCurrent.includes('+φ'));
  assert.ok(answer.direction.negativeCurrent.includes('−φ'));
  assert.ok(answer.fluxDistinction.flux.includes('Wb'));
  assert.equal(thick.symbolicAnswer.pieces[2].enclosedCurrent, 'I(c²−r²)/(c²−b²)');
  assert.equal(surface.symbolicAnswer.pieces[0].Bphi, '0');
  assert.equal(surface.symbolicAnswer.boundaries[0].kind, 'sheet-jump');
});

test('uniform DC core and gap independent B/H/Ienc fixtures', () => {
  for (const definition of [thin, thick]) {
    const input = definition === thick ? thickParams : params;
    const core = definition.evaluate(input, [.005, 0, 0]);
    assert.equal(core.status, 'valid');
    assert.equal(core.region, 'inner-conductor');
    near(value(core, 'enclosedCurrent'), .75, 1e-10);
    near(core.vectors.B[1], fixture.coreB);
    near(core.vectors.H[1], fixture.coreH, 1e-10);
    const gap = definition.evaluate(input, [.02, 0, 0]);
    assert.equal(gap.region, 'gap');
    near(gap.vectors.B[1], fixture.coreB);
    near(gap.vectors.H[1], fixture.coreH, 1e-10);
    assert.equal(value(gap, 'enclosedCurrent'), 3);
  }
});

test('axis is finite physical B=H=Ienc=0 for every distribution', () => {
  for (const definition of definitions) for (const current of [3, -3, 0]) {
    const result = definition.evaluate({ ...thickParams, current }, [0, 0, 12]);
    assert.equal(result.status, 'valid');
    assert.equal(result.region, 'axis');
    assert.equal(Math.hypot(...result.vectors.B), 0);
    assert.equal(Math.hypot(...result.vectors.H), 0);
    assert.equal(Math.abs(value(result, 'enclosedCurrent')), 0);
    finiteTree(result);
  }
});

test('uniform core boundary a is continuous with the exact analytic value', () => {
  for (const definition of [thin, thick]) {
    const result = definition.evaluate(thickParams, [.01, 0, 0]);
    assert.equal(result.status, 'valid');
    near(result.vectors.B[1], fixture.aB);
    near(result.vectors.H[1], fixture.aH, 1e-10);
    const minus = definition.evaluate(thickParams, [.01 * (1 - 1e-8), 0, 0]);
    const plus = definition.evaluate(thickParams, [.01 * (1 + 1e-8), 0, 0]);
    near(minus.vectors.B[1], result.vectors.B[1], 1e-12, 2e-8);
    near(plus.vectors.B[1], result.vectors.B[1], 1e-12, 2e-8);
  }
});

test('thin return shell b has signed two-sided field and current jump, no single vector', () => {
  for (const definition of [thin, surface]) for (const sign of [1, -1, 0]) {
    const result = definition.evaluate({ ...params, current: 3 * sign }, [.03, 0, 0]);
    assert.equal(result.status, 'boundary');
    assert.deepEqual(result.vectors, {});
    near(value(result, 'enclosedCurrentInside'), 3 * sign, 1e-10);
    assert.equal(Math.abs(value(result, 'enclosedCurrentOutside')), 0);
    near(value(result, 'BphiInside'), sign * fixture.bB);
    near(value(result, 'HphiInside'), sign * fixture.bH, 1e-10);
    assert.equal(Math.abs(value(result, 'BphiOutside')), 0);
    finiteTree(result);
  }
});

test('finite return shell r=.035 fixture and continuous boundaries b/c', () => {
  const result = thick.evaluate(thickParams, [.035, 0, 0]);
  assert.equal(result.status, 'valid');
  assert.equal(result.region, 'outer-conductor');
  near(value(result, 'enclosedCurrent'), fixture.thickI, 1e-10);
  near(value(result, 'Hphi'), fixture.thickH, 1e-10);
  near(value(result, 'Bphi'), fixture.thickB);
  const atB = thick.evaluate(thickParams, [.03, 0, 0]);
  assert.equal(atB.status, 'valid');
  near(value(atB, 'Bphi'), fixture.bB);
  assert.equal(value(atB, 'enclosedCurrent'), 3);
  const atC = thick.evaluate(thickParams, [.04, 0, 0]);
  assert.equal(atC.status, 'valid');
  assert.equal(value(atC, 'enclosedCurrent'), 0);
  assert.equal(value(atC, 'Bphi'), 0);
  for (const radius of [.03, .04]) {
    const minus = thick.evaluate(thickParams, [radius * (1 - 1e-8), 0, 0]);
    const plus = thick.evaluate(thickParams, [radius * (1 + 1e-8), 0, 0]);
    near(value(minus, 'Bphi'), value(plus, 'Bphi'), 1e-12, 1e-7);
  }
});

test('internal surface-current model has zero core field and a sheet jump at a', () => {
  const core = surface.evaluate(params, [.005, 0, 0]);
  assert.equal(core.status, 'valid');
  assert.equal(value(core, 'enclosedCurrent'), 0);
  assert.equal(value(core, 'Bphi'), 0);
  assert.ok(thin.evaluate(params, [.005, 0, 0]).vectors.B[1] > 0);
  const boundary = surface.evaluate(params, [.01, 0, 0]);
  assert.equal(boundary.status, 'boundary');
  assert.equal(value(boundary, 'HphiInside'), 0);
  near(value(boundary, 'HphiOutside'), fixture.aH, 1e-10);
  near(value(boundary, 'BphiOutside'), fixture.aB);
  const gap = surface.evaluate(params, [.02, 0, 0]);
  near(value(gap, 'Bphi'), fixture.coreB);
});

test('direction is azimuthal, negative drive reverses it, z irrelevant, mu scales only B', () => {
  for (const definition of definitions) {
    const positive = definition.evaluate(thickParams, [.012, .016, 0]);
    assert.ok(positive.vectors.B[0] < 0);
    assert.ok(positive.vectors.B[1] > 0);
    near(positive.vectors.B[0], -.8 * fixture.coreB);
    near(positive.vectors.B[1], .6 * fixture.coreB);
    const negative = definition.evaluate({ ...thickParams, current: -3 }, [.012, .016, 11]);
    const scaledMu = definition.evaluate({ ...thickParams, muR: 5 }, [.012, .016, -17]);
    for (let axis = 0; axis < 3; axis++) {
      near(negative.vectors.B[axis], -positive.vectors.B[axis]);
      near(scaledMu.vectors.B[axis], 5 * positive.vectors.B[axis]);
    }
    assert.deepEqual(scaledMu.vectors.H, positive.vectors.H);
    assert.equal(value(scaledMu, 'enclosedCurrent'), value(positive, 'enclosedCurrent'));
  }
});

test('external balanced currents cancel exactly and zero excitation is valid', () => {
  for (const definition of definitions) {
    const exterior = definition.evaluate(thickParams, [.05, 0, 0]);
    assert.equal(exterior.status, 'valid');
    assert.equal(exterior.region, 'exterior');
    assert.equal(Math.hypot(...exterior.vectors.B), 0);
    assert.equal(value(exterior, 'enclosedCurrent'), 0);
    for (const radius of [0, .005, .02, .035, .05]) {
      const result = definition.evaluate({ ...thickParams, current: 0 }, [radius, 0, 0]);
      assert.equal(result.status, 'valid');
      assert.equal(Math.hypot(...result.vectors.B), 0);
      assert.equal(Math.hypot(...result.vectors.H), 0);
    }
  }
});

test('invalid radii, mu, parameters and points are rejected without fake physical values', () => {
  for (const definition of definitions) {
    for (const invalid of [null, [], {}, { ...thickParams, a: 0 }, { ...thickParams, a: -.01 },
      { ...thickParams, b: .01 }, { ...thickParams, a: .05 }, { ...thickParams, muR: 0 },
      { ...thickParams, muR: -1 }, { ...thickParams, current: Infinity }, { ...thickParams, a: NaN },
      { ...thickParams, current: 'I' }, { ...thickParams, extra: NaN }]) {
      const result = definition.evaluate(invalid, [.02, 0, 0]);
      assert.equal(result.status, 'invalid');
      assert.ok(result.reason);
      assert.deepEqual(result.vectors, {});
      assert.deepEqual(result.scalars, []);
    }
    for (const point of [[], null, [0, 0], [0, 0, 0, 0], [0, Infinity, 0], [NaN, 0, 0]]) {
      assert.equal(definition.evaluate(thickParams, point).status, 'invalid');
    }
  }
  assert.equal(thick.evaluate({ ...thickParams, c: .03 }, [.02, 0, 0]).status, 'invalid');
  assert.equal(thick.evaluate({ ...thickParams, c: .02 }, [.02, 0, 0]).status, 'invalid');
  assert.equal(thin.evaluate(params, [Number.MAX_VALUE, Number.MAX_VALUE, 0]).status, 'invalid');
});

test('radial profiles retain exact discontinuous limits, correct units and continuous boundaries', () => {
  for (const definition of definitions) {
    const series = definition.profile(thickParams, 81);
    assert.equal(series.length, 3);
    assert.deepEqual(series.map(item => item.unit), ['T', 'A/m', 'A']);
    for (const item of series) {
      assert.equal(item.coordinateKey, 'r');
      assert.equal(item.coordinateUnit, 'm');
      assert.ok(item.points.length < 90);
      finiteTree(item.points);
      for (let i = 1; i < item.points.length; i++) assert.ok(item.points[i].coordinate >= item.points[i - 1].coordinate);
    }
    const bPoints = series[2].points.filter(point => point.coordinate === .03);
    if (definition === thick) {
      assert.equal(bPoints.length, 1);
      assert.equal(bPoints[0].value, 3);
    } else {
      assert.equal(bPoints.length, 2);
      assert.deepEqual(bPoints.map(point => point.side), ['inside', 'outside']);
      assert.deepEqual(bPoints.map(point => point.value), [3, 0]);
    }
    const origin = series[0].points[0];
    assert.equal(origin.coordinate, 0);
    assert.equal(origin.value, 0);
    assert.equal(series[0].points.at(-1).value, 0);
    assert.deepEqual(definition.profile({ ...thickParams, b: 0 }), []);
    assert.deepEqual(definition.profile(thickParams, 100000), []);
  }
});

test('independent density/ampere verification passes all models with signed and zero currents', () => {
  for (const definition of definitions) for (const sign of [1, -1, 0]) {
    const rows = definition.verify({ ...thickParams, current: 3 * sign });
    assert.equal(rows.length, definition === thick ? 4 : 3);
    for (const row of rows) {
      assert.equal(row.status, 'pass', row.reason);
      assert.ok(row.method.includes('current-density'));
      finiteTree(row);
    }
  }
  for (const definition of definitions) {
    const rows = definition.verify({ ...thickParams, b: .001 });
    assert.ok(rows.every(row => row.status === 'skipped' && row.reason));
  }
});
