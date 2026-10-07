// Hayt Ch.8 §8.3 (Example 8.2): the force between two differential current elements. Hand numbers are written out here from the vector products.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getExperiment } from '../../../src/em-course-registry.js';
import { elementForces } from '../../../src/em-course-force-elements.js';
import { topicOf } from '../../../src/em-course-params.js';
import { MU0 } from '../../../src/em-course-constants.js';

const def = getExperiment('force-elements');
const defaults = Object.fromEntries(def.parameters.map(p => [p.key, p.initial]));
const run = (over = {}, s = def.probeDefault[2]) => def.evaluate({ ...defaults, ...over }, [0, 0, s]);
const val = (result, key) => result.scalars.find(item => item.key === key).value;
const near = (actual, expected, rel, label = '') => assert.ok(Math.abs(actual - expected) <= rel * Math.abs(expected) + 1e-300, `${label} ${actual} vs ${expected}`);
const statuses = rows => rows.map(row => row.status);

test('registered as a Hayt 8.3 force experiment with the plane link text; answers are the two force magnitudes and their (non-zero) sum', () => {
  assert.ok(def && topicOf(def.id) === '자기력·토크');
  assert.deepEqual(def.lecture, { week: 6, sections: ['8.3'] });
  assert.deepEqual(def.answerKeys, ['F2mag', 'F1mag', 'netMag']);
  assert.deepEqual(def.coordinateKeys, ['probeScale']);
  assert.ok(def.description.includes('평면 ▸ 자기'));
  assert.equal(def.symbolic({}).status, 'supported');
});

test('Example 8.2: I₁dL₁ = −3 a_y A·m at P₁(5,2,1), I₂dL₂ = −4 a_z A·m at P₂(1,8,5): d(dF₂) = 8.56 a_y nN and d(dF₁) = −12.84 a_z nN', () => {
  const result = run();
  assert.equal(result.status, 'valid'); assert.equal(result.region, 'non-reciprocal');
  // by hand: k = μ₀/(4π 68^{3/2}); m₁ × R = (−12, 0, −12), m₂ × that = (0, 48, 0); m₂ × R₂₁ = (−24, −16, 0), m₁ × that = (0, 0, −72)
  const k = 1e-7 / 68 ** 1.5;
  near(val(result, 'F2y'), 48 * k, 1e-8); near(val(result, 'F1z'), -72 * k, 1e-8);
  for (const key of ['F2x', 'F2z', 'F1x', 'F1y']) assert.ok(Math.abs(val(result, key)) === 0, `${key} is exactly zero (a signed zero is fine)`);
  near(val(result, 'F2y') * 1e9, 8.56, 1e-3, 'the lecture number 8.56 nN'); near(val(result, 'F1z') * 1e9, -12.84, 1e-3, 'the lecture number −12.84 nN');
  near(val(result, 'distance'), Math.sqrt(68), 1e-12);
  // the two forces are neither equal and opposite in size nor in direction; the sum is (0, 8.56, −12.84)
  assert.ok(Math.abs(val(result, 'F2mag') - val(result, 'F1mag')) > 1e-3 * val(result, 'F1mag'));
  near(val(result, 'netY') * 1e9, 8.56, 1e-3); near(val(result, 'netZ') * 1e9, -12.84, 1e-3); near(val(result, 'netMag') * 1e9, Math.hypot(8.56, 12.84), 1e-3);
  assert.ok(result.notes.some(n => n.includes('뉴턴 제3법칙')));
  // both signs flipped (+3 a_y, +4 a_z): the product of the two signs is the same, so is the result
  const flipped = run({ m1y: 3, m2z: 4 });
  near(val(flipped, 'F2y'), val(result, 'F2y'), 1e-12); near(val(flipped, 'F1z'), val(result, 'F1z'), 1e-12);
  // one sign flipped reverses both forces
  near(val(run({ m1y: 3 }), 'F2y'), -val(result, 'F2y'), 1e-12);
  const text = def.assumptions.join(' ');
  assert.ok(text.includes('앱이 계산한 값') && text.includes('nN') && !text.includes('µA·m'));
});

test('the Biot–Savart evaluation agrees with the closed form k[m₁(m₂·R) − R(m₁·m₂)] and the sum equals k R×(m₁×m₂) for random elements', () => {
  let seed = 11;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647, r3 = () => [random() * 2 - 1, random() * 2 - 1, random() * 2 - 1];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  for (let i = 0; i < 100; i++) {
    const R = r3().map(x => x * 10), m1 = r3().map(x => x * 1e-5), m2 = r3().map(x => x * 1e-5), f = elementForces({ R, m1, m2 });
    const k = MU0 / (4 * Math.PI * Math.hypot(...R) ** 3), c2 = m1.map((x, j) => k * (x * dot(m2, R) - R[j] * dot(m1, m2)));
    const scale = k * Math.hypot(...m1) * Math.hypot(...m2) * Math.hypot(...R);
    f.dF2.forEach((x, j) => assert.ok(Math.abs(x - c2[j]) <= 1e-12 * scale, `dF₂[${j}]`));
    const net = cross(R, cross(m1, m2)).map(x => x * k);
    f.net.forEach((x, j) => assert.ok(Math.abs(x - net[j]) <= 1e-12 * scale, `sum[${j}]`));
  }
});

test('special cases: side-by-side parallel elements obey the third law (μ₀ I₁dL₁ I₂dL₂/(4πR²), attraction); collinear elements feel nothing; perpendicular ones break it', () => {
  // m₁ = m₂ = 2 µA·m a_z, R₁₂ = 0.5 m a_x: the force on element 2 points toward element 1 (−x), the force on 1 toward 2 (+x)
  const parallel = run({ Rx: 0.5, Ry: 0, Rz: 0, m1x: 0, m1y: 0, m1z: 2e-6, m2x: 0, m2y: 0, m2z: 2e-6 });
  const magnitude = MU0 * 2e-6 * 2e-6 / (4 * Math.PI * 0.25);
  near(val(parallel, 'F2mag'), magnitude, 1e-12); near(val(parallel, 'F1mag'), magnitude, 1e-12);
  near(val(parallel, 'F2x'), -magnitude, 1e-12); near(val(parallel, 'F1x'), magnitude, 1e-12);
  assert.ok(Math.abs(val(parallel, 'netMag')) <= 1e-12 * magnitude, 'equal and opposite');
  assert.equal(parallel.region, 'reciprocal');
  // antiparallel currents repel: the force on 2 points away from 1
  const anti = run({ Rx: 0.5, Ry: 0, Rz: 0, m1x: 0, m1y: 0, m1z: 2e-6, m2x: 0, m2y: 0, m2z: -2e-6 });
  near(val(anti, 'F2x'), magnitude, 1e-12);
  // collinear (both along R): sin 0 = 0, no field on the other element, no force
  const collinear = run({ Rx: 2, Ry: 0, Rz: 0, m1x: 1e-6, m1y: 0, m1z: 0, m2x: 3e-6, m2y: 0, m2z: 0 });
  assert.equal(val(collinear, 'F2mag'), 0); assert.equal(val(collinear, 'F1mag'), 0);
  // one element along R: only the other one can be pushed (here element 2 along R, element 1 across it)
  const half = run({ Rx: 1, Ry: 0, Rz: 0, m1x: 0, m1y: 1e-6, m1z: 0, m2x: 1e-6, m2y: 0, m2z: 0 });
  assert.equal(val(half, 'F1mag'), 0, 'element 2 along R makes no field at element 1');
  near(val(half, 'F2mag'), MU0 * 1e-12 / (4 * Math.PI), 1e-12, 'element 1 across R still pushes element 2');
  // m₁ = a_y, m₂ = a_z, R₁₂ = (1,1,0): the sum k R×(m₁×m₂) = k (1,1,0)×(1e-12,0,0) = k (0,0,−1e-12) with k = μ₀/(4π 2^{3/2}) ≠ 0
  const crossed = run({ Rx: 1, Ry: 1, Rz: 0, m1x: 0, m1y: 1e-6, m1z: 0, m2x: 0, m2y: 0, m2z: 1e-6 });
  assert.equal(crossed.region, 'non-reciprocal');
  const kc = MU0 / (4 * Math.PI) / 2 ** 1.5; // the app's μ₀ (CODATA 2022), not 4π×10⁻⁷
  near(val(crossed, 'netMag'), kc * 1e-12, 1e-12); near(val(crossed, 'netZ'), -kc * 1e-12, 1e-12);
});

test('sweeping the distance factor s: both forces fall as 1/s², and at s = 1 the curve is the answer', () => {
  const curves = Object.fromEntries(def.profile(defaults, 81).map(item => [item.key, item]));
  assert.deepEqual(Object.keys(curves), ['F2', 'F1', 'net']);
  for (const item of Object.values(curves)) { assert.equal(item.points.length, 81); assert.equal(item.coordinateKey, 's'); assert.equal(item.unit, 'N'); }
  const base = run();
  for (const point of curves.F2.points) near(point.value, val(base, 'F2mag') / point.coordinate ** 2, 1e-12, 's=' + point.coordinate);
  for (const point of curves.net.points) near(point.value, val(base, 'netMag') / point.coordinate ** 2, 1e-12);
  const at2 = run({}, 2);
  near(val(at2, 'probeF2'), val(base, 'F2mag') / 4, 1e-12); near(val(at2, 'probeF1'), val(base, 'F1mag') / 4, 1e-12); near(val(at2, 'probeNet'), val(base, 'netMag') / 4, 1e-12);
  assert.equal(val(at2, 'F2mag'), val(base, 'F2mag'), 'the answers use the typed R₁₂; the probe only moves the curve point');
  assert.equal(val(at2, 'probeScale'), 2);
});

test('verification rows pass for the example and for other layouts, also when the forces vanish', () => {
  for (const over of [{}, { Rx: 1, Ry: -2, Rz: 3, m1x: 1e-6, m2y: -2e-6 }, { Rx: 2, Ry: 0, Rz: 0, m1x: 1e-6, m1y: 0, m1z: 0, m2x: 3e-6, m2y: 0, m2z: 0 }, { m1y: 0, m1x: 0, m1z: 0 }]) {
    const rows = def.verify({ ...defaults, ...over });
    assert.equal(rows.length, 4, JSON.stringify(over)); assert.deepEqual(statuses(rows), Array(4).fill('pass'), JSON.stringify(over) + ' ' + rows.map(r => r.label + ' ' + r.actual).join(' | '));
  }
  assert.equal(def.verify({ ...defaults, Rx: 0, Ry: 0, Rz: 0 })[0].status, 'skipped');
});

test('invalid input is refused without correction: R₁₂ = 0, ranges, non-numbers, a non-positive distance factor', () => {
  for (const over of [{ Rx: 0, Ry: 0, Rz: 0 }, { Rx: 2000 }, { m1y: 20 }, { m2z: NaN }, { Ry: '6' }, { m1x: Infinity }]) {
    const result = run(over); assert.equal(result.status, 'invalid', JSON.stringify(over)); assert.equal(result.scalars.length, 0);
  }
  for (const s of [0, -1, NaN]) assert.equal(run({}, s).status, 'invalid', 's = ' + s);
  assert.deepEqual(def.profile({ ...defaults, Rx: 0, Ry: 0, Rz: 0 }, 81), []);
  assert.equal(run({ m1x: 0, m1y: 0, m1z: 0 }).status, 'valid', 'a zero element is valid: no field, no force');
  assert.equal(val(run({ m1x: 0, m1y: 0, m1z: 0 }), 'F2mag'), 0);
});

test('DOM-free pure module with the Hayt 8.3 reference', () => {
  const source = readFileSync(new URL('../../../src/em-course-force-elements.js', import.meta.url), 'utf8');
  assert.ok(!/\b(?:window|document|localStorage|sessionStorage)\b/.test(source.replace(/\/\/.*$/gm, '')));
  assert.ok(def.references.some(r => r.title.includes('Hayt') && r.title.includes('8.3') && r.url.startsWith('https://')));
});
