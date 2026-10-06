// Hayt Ch.8 lecture experiments (forces, materials, magnetic circuit, inductance): closed forms, lecture numbers, registry integrity.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EXPERIMENTS, COURSE_ROADMAP, getExperiment } from '../../../src/em-course-registry.js';
import { paramSpec, topicOf } from '../../../src/em-course-params.js';
import { AMU, E_CHARGE, MU0 } from '../../../src/em-course-constants.js';

const GROUPS = { '자기력·토크': 'force-', '자성체·경계': 'matter-', '자기회로': 'mcircuit-', '에너지·인덕턴스': 'induct-' };
const lecture = EXPERIMENTS.filter(d => d.lecture);
const defaults = def => Object.fromEntries(def.parameters.map(p => [p.key, p.initial]));
const run = (id, over = {}, s = undefined, point = null) => {
  const def = getExperiment(id), params = { ...defaults(def), ...over };
  return def.evaluate(params, point ?? [0, 0, s ?? def.probeDefault[2]]);
};
const val = (result, key) => result.scalars.find(item => item.key === key)?.value;
const near = (actual, expected, rel, label = '') => assert.ok(Math.abs(actual - expected) <= rel * Math.abs(expected) + 1e-300, `${label} ${actual} vs ${expected}`);
const MU0_LECTURE = 4 * Math.PI * 1e-7; // the lecture's μ₀; CODATA differs by 1.5e-10 relative

// ---- registry --------------------------------------------------------------------------------------------------------------
test('19 lecture experiments are registered with unique ids, four groups and lecture tags', () => {
  assert.equal(lecture.length, 19);
  assert.equal(EXPERIMENTS.length, 42);
  assert.equal(new Set(EXPERIMENTS.map(d => d.id)).size, EXPERIMENTS.length);
  const counts = { '자기력·토크': 7, '자성체·경계': 4, '자기회로': 2, '에너지·인덕턴스': 6 };
  for (const [topic, prefix] of Object.entries(GROUPS)) {
    const members = lecture.filter(d => d.id.startsWith(prefix));
    assert.equal(members.length, counts[topic], topic);
    for (const def of members) assert.equal(topicOf(def.id), topic, def.id);
  }
  for (const def of lecture) {
    assert.equal(typeof def.evaluate, 'function', def.id);
    assert.equal(def.lecture.week, 6);
    assert.ok(def.lecture.sections.every(s => /^8\.\d+$/.test(s)), def.id);
    assert.ok(!def.title.includes('6주차') && !def.title.includes('§'), `${def.id}: the week and section live in the topic group and the subtitle, not in the title`);
    const scalarKeys = def.evaluate(defaults(def), [...def.probeDefault]).scalars.map(item => item.key);
    assert.ok(def.answerKeys.length >= 1 && [...def.answerKeys, ...def.coordinateKeys].every(key => scalarKeys.includes(key)), `${def.id}: answer and coordinate keys are scalars of the preset`);
    assert.ok(def.references.some(r => r.title.includes('Hayt') && r.url.startsWith('https://')), `${def.id} cites Hayt`);
    assert.ok(def.assumptions.length >= 1 && def.formulas.length >= 1 && def.validity.length >= 1 && def.singularities.length >= 1, def.id);
  }
  assert.ok(COURSE_ROADMAP.some(item => item.title.includes('자기력')) && COURSE_ROADMAP.some(item => item.title.includes('복습')));
  assert.ok(COURSE_ROADMAP.every(item => ['implemented', 'planned'].includes(item.status)));
});

test('the original topics keep their names and the browser smoke path (coax-current → 정자계·암페어) is unchanged', () => {
  assert.equal(topicOf('coax-current'), '정자계·암페어');
  assert.equal(topicOf('faraday-loop'), '자기유도');
  assert.equal(topicOf('line-infinite'), '정전계·정전용량');
});

test('every lecture experiment: preset is valid, verify passes, profile is finite, symbolic solution is supported', () => {
  for (const def of lecture) {
    const params = defaults(def), result = def.evaluate(params, [...def.probeDefault]);
    assert.equal(result.status, 'valid', `${def.id}: ${result.reason}`);
    assert.ok(result.scalars.length >= 3 && result.scalars.every(s => Number.isFinite(s.value)), def.id);
    const rows = def.verify(params);
    assert.ok(rows.length >= 2, def.id);
    for (const row of rows) assert.equal(row.status, 'pass', `${def.id}: ${row.label} ${row.actual} vs ${row.expected}`);
    const profiles = def.profile(params, 81);
    if (def.view.kind === 'profile' || def.view.kind === 'xy-curve') {
      assert.ok(profiles.length >= 1, def.id);
      for (const item of profiles) assert.ok(item.points.length >= 2 && item.points.length <= 512 && item.points.every(q => Number.isFinite(q.coordinate) && Number.isFinite(q.value)), `${def.id}/${item.key}`);
    } else assert.deepEqual(profiles, []);
    const solution = def.symbolic({});
    assert.equal(solution.status, 'supported', def.id);
    assert.ok(solution.steps.length >= 3 && solution.answers.length >= 2 && solution.laws.length >= 1 && solution.givens.length >= 2, def.id);
    assert.equal(def.symbolic({ nonsense: 1 }).status, 'unsupported');
    assert.ok(profiles.length <= 3);
  }
});

test('views: sweep views name their coordinate, xy-curves have a sweep, the image view has an overlay', () => {
  for (const def of lecture) {
    if (['profile', 'xy-curve'].includes(def.view.kind)) assert.ok(def.view.coordinate?.key && def.view.coordinate.unit, def.id);
    if (def.view.kind === 'xy-curve') assert.deepEqual(def.view.curve.sweep(defaults(def)).length, 2);
  }
  const image = getExperiment('matter-image'), overlay = image.view.overlay(defaults(image));
  assert.equal(overlay.lines.length, 1);
  assert.equal(overlay.lines[0].a[1], -defaults(image).h);
  assert.deepEqual(overlay.glyphs[0].at, [0, -2 * defaults(image).h]);
  assert.equal(overlay.glyphs[0].sign, 1);
  assert.equal(getExperiment('matter-image').view.overlay({ ...defaults(image), case: 1 }).glyphs[0].sign, -1);
});

test('parameter controls: choices become selects that offer their default, every slider position evaluates without throwing', () => {
  for (const def of lecture) {
    for (const parameter of def.parameters) {
      const spec = paramSpec(parameter);
      if (parameter.choices) {
        assert.equal(spec.kind, 'select', `${def.id}.${parameter.key}`);
        assert.ok(spec.options.some(([value]) => value === parameter.initial));
      }
      assert.ok(parameter.initial >= parameter.min && parameter.initial <= parameter.max, `${def.id}.${parameter.key} default in range`);
      assert.ok(spec.label.length > 0 && !/[()]/.test(spec.label), `${def.id}.${parameter.key}: ${spec.label}`);
      if (spec.kind !== 'range') continue;
      for (const t of [0, 0.5, 1]) {
        const value = spec.scale === 'log' ? spec.lo * (spec.hi / spec.lo) ** t : spec.lo + (spec.hi - spec.lo) * t;
        const result = def.evaluate({ ...defaults(def), [parameter.key]: value }, [...def.probeDefault]);
        assert.ok(['valid', 'invalid', 'singular', 'boundary', 'unsupported'].includes(result.status), `${def.id}.${parameter.key}`);
      }
    }
  }
});

test('invalid inputs are reported, never corrected', () => {
  assert.equal(run('force-lorentz', { chargeE: 0 }).status, 'invalid');
  assert.equal(run('force-lorentz', { B0: 0 }).status, 'invalid');
  assert.equal(run('force-wire-loop', { d2: 0.5 }).status, 'invalid');
  assert.equal(run('force-wire-loop', {}, 0).status, 'singular');
  assert.equal(run('mcircuit-hysteresis', { Br: 1.6 }).status, 'invalid');
  assert.equal(run('mcircuit-gap-core', { h2: 100 }).status, 'invalid');
  assert.equal(run('induct-coax', { b: 0.005 }).status, 'invalid');
  assert.equal(run('induct-toroid', { a: 0.2 }).status, 'invalid');
  assert.equal(run('induct-mutual', { r2: 0.01 }).status, 'invalid');
  assert.equal(run('force-parallel-wires', { current1: Number.NaN }).status, 'invalid');
  assert.equal(getExperiment('force-lorentz').evaluate(defaults(getExperiment('force-lorentz')), [0, 0, Number.NaN]).status, 'invalid');
  assert.equal(getExperiment('force-lorentz').evaluate(null, [0, 0, 0]).status, 'invalid');
  assert.deepEqual(getExperiment('force-lorentz').profile({ ...defaults(getExperiment('force-lorentz')), chargeE: 0 }), []);
});

test('lecture model files stay DOM-free', () => {
  for (const file of ['lecture', 'forces', 'materials', 'magnetic-circuit', 'inductance', 'virtual-work']) {
    const source = readFileSync(new URL(`../../../src/em-course-${file}.js`, import.meta.url), 'utf8');
    assert.ok(!/\b(?:window|document|localStorage|sessionStorage)\s*[.[]|addEventListener\s*\(/.test(source), file);
  }
});

// ---- 8.1 Lorentz --------------------------------------------------------------------------------------------------------------
test('Lorentz orbit: proton, 1e6 m/s, 0.1 T → r = mv/(qB), ω_c = qB/m, T = 2πm/(qB)', () => {
  const result = run('force-lorentz'), m = 1.007276 * AMU, q = E_CHARGE;
  near(val(result, 'radius'), m * 1e6 / (q * 0.1), 1e-12, 'r');
  near(val(result, 'radius'), 0.10440, 5e-4, 'r ≈ 10.44 cm');
  near(val(result, 'omegaC'), q * 0.1 / m, 1e-12);
  near(val(result, 'period'), 2 * Math.PI * m / (q * 0.1), 1e-12);
  near(val(result, 'frequency') * val(result, 'period'), 1, 1e-12);
  assert.equal(val(result, 'work'), 0);
  near(val(result, 'kinetic'), 0.5 * m * 1e12, 1e-12);
  near(val(result, 'force'), q * 1e6 * 0.1, 1e-12);
  // the particle starts at the origin moving along +x; phase π: the far side of the circle (diameter below, −y); phase 2π: back at the start
  near(val(run('force-lorentz', {}, Math.PI), 'y'), -2 * val(result, 'radius'), 1e-12);
  assert.ok(Math.abs(val(run('force-lorentz', {}, 2 * Math.PI), 'y')) < 1e-12 * val(result, 'radius'));
  // at the quarter point (r, −r) the force points to the center (0, −r): −x
  const quarter = run('force-lorentz', {}, Math.PI / 2);
  assert.ok(val(quarter, 'Fx') < 0 && Math.abs(val(quarter, 'Fy')) < 1e-12 * val(quarter, 'force'));
  near(Math.hypot(val(quarter, 'Fx'), val(quarter, 'Fy')), val(quarter, 'force'), 1e-12);
  // negative charge mirrors the orbit; a stationary particle feels nothing
  near(val(run('force-lorentz', { chargeE: -1 }, Math.PI), 'y'), 2 * val(result, 'radius'), 1e-12);
  const rest = run('force-lorentz', { speed: 0 });
  assert.equal(rest.status, 'valid');
  assert.equal(val(rest, 'radius'), 0);
  assert.equal(val(rest, 'force'), 0);
  // an electron (m = 5.4858e-4 u) in the same field circles ~1836 times faster
  near(val(run('force-lorentz', { mass: 5.485799e-4 * AMU, chargeE: -1 }), 'omegaC') / val(result, 'omegaC'), 1.007276 / 5.485799e-4, 1e-12);
});

test('Lorentz + E×B: v_d = E/B, straight line at E = vB (proton 1e6 m/s, 0.1 T, E = 1e5 V/m)', () => {
  const def = getExperiment('force-lorentz'), m = 1.007276 * AMU, q = E_CHARGE;
  assert.ok(def.answerKeys.includes('vd') && def.answerKeys.includes('straightE'));
  const base = run('force-lorentz');
  assert.equal(val(base, 'vd'), 0);
  near(val(base, 'straightE'), 1e5, 1e-12, 'E = vB');
  const T = 2 * Math.PI * m / (q * 0.1), straight = { Ey: 1e5 };
  const end = run('force-lorentz', straight, 2 * Math.PI);
  assert.equal(end.region, 'straight');
  near(val(end, 'vd'), 1e6, 1e-12, 'v_d = E/B');
  assert.equal(val(end, 'radius'), 0);
  assert.ok(Math.abs(val(end, 'y')) < 1e-9 * 1e6 * T, 'no y change');
  near(val(end, 'x'), 1e6 * T, 1e-12);
  for (const s of [0.3, 1.7, 4]) {
    const r = run('force-lorentz', straight, s);
    assert.ok(Math.abs(val(r, 'y')) < 1e-9 * 1e6 * T && Math.abs(val(r, 'Fx')) < 1e-9 * q * 1e5 && Math.abs(val(r, 'Fy')) < 1e-9 * q * 1e5);
    near(val(r, 'vx'), 1e6, 1e-12);
  }
  const profile = def.profile({ ...defaults(def), ...straight }, 81)[0];
  assert.ok(profile.points.every(point => Math.abs(point.value) < 1e-9 * 1e6 * T));
  assert.ok(run('force-lorentz', straight).notes.some(note => note.includes('E = vB') && note.includes('v_d = E/B') && note.includes('직진')));
  assert.ok(run('force-lorentz', { Ey: 5e4 }).notes.some(note => note.includes('드리프트')));
  assert.ok(run('force-lorentz').notes.some(note => note.includes('v_d = E/B') && note.includes('순수 원운동')));
});

test('Lorentz + E×B: trochoid = drift + gyration, drift independent of the sign of q, E does work', () => {
  const m = 1.007276 * AMU, q = E_CHARGE, T = 2 * Math.PI * m / (q * 0.1), half = { Ey: 5e4 };
  const proton = run('force-lorentz', half, 2 * Math.PI), electron = run('force-lorentz', { ...half, chargeE: -1 }, 2 * Math.PI);
  near(val(proton, 'vd'), 5e5, 1e-12);
  near(val(proton, 'radius'), m * 5e5 / (q * 0.1), 1e-12, 'r uses |v − v_d|');
  near(val(proton, 'x'), 5e5 * T, 1e-12, 'one period moves the guiding center by v_d T');
  assert.ok(Math.abs(val(proton, 'y')) < 1e-9 * 5e5 * T);
  near(val(electron, 'vd'), 5e5, 1e-12);
  near(val(electron, 'x'), 5e5 * T, 1e-12);
  // faster than the drift: v_d < v keeps going forward; slower than the drift: the loops are cycloid with v_d > v
  near(val(run('force-lorentz', { Ey: 3e5 }), 'radius'), m * 2e6 / (q * 0.1), 1e-12);
  // at rest the E field alone starts a cycloid with radius m v_d/(qB)
  const rest = run('force-lorentz', { speed: 0, Ey: 1e5 }, Math.PI);
  near(val(rest, 'radius'), m * 1e6 / (q * 0.1), 1e-12);
  near(val(rest, 'y'), 2 * val(rest, 'radius'), 1e-12); // starts along +y (the E direction), then drifts toward +x
  // E is non-zero: the field does work, the speed changes; the power is q E v_y and the energy theorem holds along the path
  const mid = run('force-lorentz', half, Math.PI / 2);
  near(val(mid, 'work'), q * 5e4 * val(mid, 'vy'), 1e-12);
  assert.notEqual(val(mid, 'work'), 0);
  assert.equal(val(run('force-lorentz'), 'work'), 0);
  // every sweep point agrees with F = q(E + v×B) at that point
  for (const s of [0.4, 1.9, 3.3, 5.5]) {
    const r = run('force-lorentz', half, s), fx = q * val(r, 'vy') * 0.1, fy = q * (5e4 - val(r, 'vx') * 0.1);
    near(val(r, 'Fx'), fx, 1e-12); near(val(r, 'Fy'), fy, 1e-12);
  }
  // beyond 10 % of c (drift included) the non-relativistic warning stays
  assert.ok(run('force-lorentz', { Ey: 1e6, B0: 0.01 }).notes.some(note => note.includes('비상대론')));
  assert.ok(!run('force-lorentz').notes.some(note => note.includes('비상대론')));
  assert.equal(run('force-lorentz', { Ey: 2e6 }).status, 'invalid');
});

test('Lorentz verify rows: RK4 vs closed form for several E, E=0 radius formula, E=vB straight line', () => {
  const def = getExperiment('force-lorentz');
  for (const over of [{}, { Ey: 5e4 }, { Ey: 1e5 }, { Ey: -3e5 }, { Ey: 1e6, chargeE: -2, mass: 5.485799e-4 * AMU }, { speed: 0, Ey: 1e5 }]) {
    const rows = def.verify({ ...defaults(def), ...over });
    assert.ok(rows.length >= 10, JSON.stringify(over));
    for (const row of rows) assert.equal(row.status, 'pass', `${JSON.stringify(over)}: ${row.label}`);
    assert.ok(rows.some(row => row.label.includes('E=0') && row.label.includes('반지름 공식')));
    assert.ok(rows.some(row => row.label.includes('E=vB') && row.label.includes('y 변화')));
  }
});

// ---- 8.2 wire + loop ----------------------------------------------------------------------------------------------------------
test('straight wire and rectangular loop: 12 nN, 4 nN, net 8 nN toward the wire, F₁ + F₃ = 0 (lecture a05)', () => {
  const result = run('force-wire-loop');
  near(val(result, 'F2x'), -12e-9, 1e-8, 'F₂');
  near(val(result, 'F4x'), 4e-9, 1e-8, 'F₄');
  near(val(result, 'netX'), -8e-9, 1e-8, 'net');
  near(Math.abs(val(result, 'F1y')), 15 * 2e-3 * 2e-7 * Math.log(3), 1e-8, '|F₁|');
  near(Math.abs(val(result, 'F1y')), 6.59e-9, 1e-3, '6.59 nN');
  assert.equal(val(result, 'F13'), 0);
  assert.equal(val(result, 'netY'), 0);
  near(val(run('force-wire-loop', {}, 2), 'B'), MU0 * 15 / (4 * Math.PI), 1e-12);
  // reversing the wire current reverses every force; uniform-field limit d₂ → d₁ gives vanishing net force
  near(val(run('force-wire-loop', { current: -15 }), 'netX'), 8e-9, 1e-8);
  assert.ok(Math.abs(val(run('force-wire-loop', { d2: 1.0000001 }), 'netX')) < 1e-3 * 8e-9);
  // CODATA μ₀ vs the lecture's 4π×10⁻⁷ is far below the four digits of the lecture's numbers
  near(MU0, MU0_LECTURE, 2e-10);
});

test('parallel wires, sheets and solenoid pressure', () => {
  near(val(run('force-parallel-wires'), 'perLength'), 2e-7, 1e-9, '1 A, 1 A, 1 m');
  near(val(run('force-parallel-wires', { current1: 3, current2: 5, length: 2 }, 0.5), 'total'), MU0 * 15 * 2 / (2 * Math.PI * 0.5), 1e-12);
  assert.equal(run('force-parallel-wires', { current2: -1 }).region, 'repel');
  assert.equal(run('force-parallel-wires').region, 'attract');
  const between = run('force-parallel-sheets'), K = 100;
  near(val(between, 'Bbetween'), MU0 * K, 1e-12);
  near(val(between, 'Bsingle'), MU0 * K / 2, 1e-12);
  near(val(between, 'pressure'), MU0 * K * K / 2, 1e-12);
  near(val(between, 'pressure'), val(between, 'energyDensity'), 1e-12);
  assert.deepEqual(between.vectors.B, [0, MU0 * K, 0]);
  assert.deepEqual(run('force-parallel-sheets', {}, 0.2).vectors.B, [0, 0, 0]);
  assert.equal(run('force-parallel-sheets', {}, 0.05).status, 'boundary');
  const coil = run('force-solenoid-pressure'), B = MU0 * 1000 * 10;
  near(val(coil, 'Binside'), B, 1e-12);
  near(val(coil, 'pressure'), B * B / (2 * MU0), 1e-12);
  near(val(coil, 'wallForce'), B * B / (2 * MU0) * 2 * Math.PI * 0.05, 1e-12);
  near(val(coil, 'Lprime'), MU0 * 1e6 * Math.PI * 0.0025, 1e-12);
  assert.equal(run('force-solenoid-pressure', {}, 0.05).status, 'boundary');
  assert.deepEqual(run('force-solenoid-pressure', {}, 0.09).vectors.B, [0, 0, 0]);
});

// ---- 8.4 torque and dipole -------------------------------------------------------------------------------------------------------
test('loop torque τ = m×B = πa²IB₀ sinθ x̂ (lecture a16)', () => {
  const m = Math.PI * 0.05 ** 2 * 2;
  for (const theta of [0, 0.4, Math.PI / 2, 2.5, Math.PI]) {
    const result = run('force-loop-torque', {}, theta);
    near(val(result, 'm'), m, 1e-12);
    assert.ok(Math.abs(val(result, 'tauX') - m * 0.5 * Math.sin(theta)) < 1e-15, `θ=${theta}`);
    near(val(result, 'energy'), -m * 0.5 * Math.cos(theta), 1e-12);
    assert.equal(val(result, 'netForce'), 0);
  }
  near(val(run('force-loop-torque', {}, Math.PI / 2), 'tauX'), val(run('force-loop-torque'), 'tauMax'), 1e-12);
  assert.equal(run('force-loop-torque', {}, 0).region, 'equilibrium');
  assert.ok(val(run('force-loop-torque', { current: -2 }, 1), 'tauX') < 0);
});

test('dipole far field B = μ₀m/(4πr³)(2cosθ a_r + sinθ a_θ) and its comparison with the exact loop', () => {
  const a = 0.01, I = 5, m = I * Math.PI * a * a, r = 0.2, theta = Math.PI / 3;
  const result = run('force-dipole-field', {}, r);
  near(val(result, 'Br'), MU0 * m * 2 * Math.cos(theta) / (4 * Math.PI * r ** 3), 1e-12);
  near(val(result, 'Btheta'), MU0 * m * Math.sin(theta) / (4 * Math.PI * r ** 3), 1e-12);
  near(val(result, 'Aphi'), MU0 * m * Math.sin(theta) / (4 * Math.PI * r * r), 1e-12);
  near(val(result, 'Bexact'), val(result, 'Bmag'), 5e-3, 'dipole ≈ exact at r = 20a');
  near(val(result, 'Bmag'), Math.hypot(...result.vectors.B), 1e-12);
  // on the axis the exact loop field is μ₀Ia²/(2(a²+z²)^{3/2}); the dipole axis value is μ₀m/(2πz³)
  const axis = run('force-dipole-field', { theta: 0 }, 0.3);
  near(val(axis, 'Bexact'), MU0 * I * a * a / (2 * (a * a + 0.09) ** 1.5), 1e-9);
  near(val(axis, 'Bmag'), MU0 * m / (2 * Math.PI * 0.027), 1e-12);
  assert.equal(val(axis, 'Btheta'), 0);
  assert.ok(Math.abs(val(run('force-dipole-field', { theta: Math.PI / 2 }, 0.2), 'Br')) < 1e-18);
  // the relative error shrinks as (a/r)²
  const e10 = val(run('force-dipole-field', {}, 10 * a), 'relError'), e40 = val(run('force-dipole-field', {}, 40 * a), 'relError');
  assert.ok(e40 < e10 / 8, `${e10} ${e40}`);
  assert.equal(run('force-dipole-field', {}, 0.02).status, 'unsupported');
});

// ---- 8.5–8.7 materials --------------------------------------------------------------------------------------------------------------
test('magnetized bar: K_b = M, equivalent coil, axis field, H opposite to M inside', () => {
  const M = 1e6, a = 0.01, length = 0.05, h = length / 2;
  const center = run('matter-magnetization', {}, 0);
  assert.equal(val(center, 'Kb'), M);
  near(val(center, 'Ib'), M * length, 1e-12);
  near(val(center, 'moment'), M * Math.PI * a * a * length, 1e-12);
  const expected = MU0 * M / 2 * 2 * h / Math.sqrt(a * a + h * h);
  near(val(center, 'Bz'), expected, 1e-12);
  near(val(center, 'Hz'), expected / MU0 - M, 1e-12);
  assert.ok(val(center, 'Hz') < 0, 'H points against M inside the magnet');
  near(val(center, 'Bz'), MU0 * (val(center, 'Hz') + val(center, 'Mz')), 1e-12);
  // long thin bar: B → μ₀M and H → 0
  const thin = run('matter-magnetization', { radius: 1e-4, length: 1 }, 0);
  near(val(thin, 'Bz'), MU0 * M, 1e-4);
  assert.ok(Math.abs(val(thin, 'Hz')) < 1e-4 * M);
  assert.equal(run('matter-magnetization', {}, h).status, 'boundary');
  const outside = run('matter-magnetization', {}, 0.2);
  assert.equal(val(outside, 'Mz'), 0);
  near(val(outside, 'Hz'), val(outside, 'Bz') / MU0, 1e-12);
  // B is continuous across the end face, H jumps by M
  const profile = getExperiment('matter-magnetization').profile(defaults(getExperiment('matter-magnetization')), 81).find(item => item.key === 'Hz');
  const jumps = profile.points.filter((q, i) => i && q.coordinate === profile.points[i - 1].coordinate);
  assert.equal(jumps.length, 2);
  for (const q of jumps) near(Math.abs(q.value - profile.points[profile.points.indexOf(q) - 1].value), M, 1e-9);
});

test('susceptibility: B = μ₀(H + M) = μ₀(1 + χ)H; the lecture curve gives μ_r ≈ 4000', () => {
  const result = run('matter-susceptibility', {}, 1e4);
  near(val(result, 'mur'), 4000, 1e-12);
  near(val(result, 'B'), MU0 * 4000 * 1e4, 1e-12);
  near(val(result, 'B'), MU0 * (1e4 + val(result, 'M')), 1e-12);
  assert.equal(result.region, 'ferromagnetic-like');
  assert.equal(run('matter-susceptibility', { chi: -1e-5 }).region, 'diamagnetic');
  assert.equal(run('matter-susceptibility', { chi: 2e-4 }).region, 'paramagnetic');
  assert.equal(val(run('matter-susceptibility', { chi: -1 }), 'B'), 0);
  near((1 / 200) / MU0_LECTURE, 3979, 1e-3, 'b32: μ_r = (1 T/200 A/m)/μ₀');
});

test('magnetic boundary: B_n continuous, tanθ₂/tanθ₁ = μ₂/μ₁ (10⁴ preset), H_t jumps by K', () => {
  for (const theta of [0.05, 0.5, 1.2]) {
    const result = run('matter-boundary', {}, theta);
    near(val(result, 'tanRatio'), 1e4, 1e-9, `θ₁=${theta}`);
    near(val(result, 'B2n'), val(result, 'B1n'), 1e-14);
    near(val(result, 'H2t'), val(result, 'H1t'), 1e-14);
    assert.ok(val(result, 'theta2') > val(result, 'theta1') && val(result, 'theta2') < 90);
  }
  const k = run('matter-boundary', { mu1R: 2, mu2R: 8 }, 0.7);
  near(Math.tan(val(k, 'theta2') * Math.PI / 180) / Math.tan(0.7), 4, 1e-12);
  const withK = run('matter-boundary', { K: 50 }, 0.5);
  near(val(withK, 'H2t') - val(withK, 'H1t'), 50, 1e-12);
  near(val(withK, 'B2t'), MU0 * 1e4 * val(withK, 'H2t'), 1e-12);
  assert.equal(val(run('matter-boundary', {}, 0), 'tanRatio'), undefined, 'θ₁ = 0: 0/0 is not shown');
  assert.equal(val(run('matter-boundary', {}, 0), 'theta2'), 0);
  assert.equal(run('matter-boundary', {}, 2).status, 'unsupported');
});

test('image currents: iron k = +1, superconductor k = −1, general k = (μ₂−μ₁)/(μ₂+μ₁); boundary conditions hold', () => {
  const at = (over, point) => getExperiment('matter-image').evaluate({ ...defaults(getExperiment('matter-image')), ...over }, point);
  assert.equal(val(at({}, [0.03, 0.02, 0]), 'k'), 1);
  assert.equal(val(at({ case: 1 }, [0.03, 0.02, 0]), 'k'), -1);
  near(val(at({ case: 2, mu2R: 3 }, [0.03, 0.02, 0]), 'k'), 0.5, 1e-12);
  assert.ok(val(at({}, [0.03, 0.02, 0]), 'wireForce') > 0 && val(at({ case: 1 }, [0.03, 0.02, 0]), 'wireForce') < 0);
  near(val(at({}, [0.03, 0.02, 0]), 'wireForce'), MU0 * 100 / (4 * Math.PI * 0.05), 1e-12);
  const h = 0.05, x = 0.04, eps = 1e-9 * h;
  for (const over of [{}, { case: 1 }, { case: 2, mu2R: 5 }]) {
    const up = at(over, [x, -h + eps, 0]), down = at(over, [x, -h - eps, 0]);
    assert.ok(Math.abs(down.vectors.B[1] - up.vectors.B[1]) < 1e-6 * Math.hypot(...up.vectors.B) + 1e-30, 'B_n');
    assert.ok(Math.abs(down.vectors.H[0] - up.vectors.H[0]) < 1e-6 * Math.hypot(...up.vectors.H) + 1e-12, 'H_t');
  }
  // iron: H_t = 0 at the surface (field lines enter normally) but B inside is finite and twice the air-side wire field
  const iron = at({}, [x, -h - 1e-12, 0]);
  assert.ok(Math.abs(iron.vectors.H[0]) < 1e-6 * Math.hypot(...iron.vectors.B) / MU0);
  // superconductor: nothing below the surface, no normal B above it
  assert.deepEqual(at({ case: 1 }, [x, -0.2, 0]).vectors.B, [0, 0, 0]);
  assert.ok(Math.abs(at({ case: 1 }, [x, -h + eps, 0]).vectors.B[1]) < 1e-6 * Math.hypot(...at({ case: 1 }, [x, -h + eps, 0]).vectors.B));
  assert.equal(at({}, [0, 0, 0]).status, 'singular');
  assert.equal(at({}, [x, -h, 0]).status, 'boundary');
  // the field of the real wire alone (far from the interface) matches μ₀I/(2πρ) when k = 0 (μ₂ = μ₁)
  const plain = at({ case: 2, mu2R: 1 }, [0.02, 0.01, 0]);
  near(Math.hypot(...plain.vectors.B), MU0 * 10 / (2 * Math.PI * Math.hypot(0.02, 0.01)), 1e-12);
});

// ---- 8.8 magnetic circuit ----------------------------------------------------------------------------------------------------------
test('gapped core: B = 1 T needs NI ≈ 1780 A·turn (gap 1591.5 + iron 188.5), reproduced to 4 digits (lecture b32)', () => {
  const result = run('mcircuit-gap-core');
  assert.equal(Math.round(val(result, 'NI')), 1780);
  assert.ok(Math.abs(val(result, 'NI') - 1780) < 0.1);
  near(val(result, 'Vgap'), 1591.5, 1e-4);
  near(val(result, 'Vcore'), 188.5, 1e-3);
  near(val(result, 'Vgap'), 1 * 2e-3 / MU0_LECTURE, 1e-9, 'with the lecture μ₀');
  near(val(result, 'Vcore'), 200 * 0.3 * Math.PI, 1e-12);
  near(val(result, 'flux'), 6e-4, 1e-12);
  near(val(result, 'Hcore'), 200, 1e-12);
  near(val(result, 'mur'), 3979, 1e-3);
  near(val(result, 'RmGap'), 2e-3 / (MU0 * 6e-4), 1e-12);
  near(val(result, 'flux') * (val(result, 'RmCore') + val(result, 'RmGap')), val(result, 'NI'), 1e-12, 'Φ R_m = NI');
  // the probe reads the NI curve at any B
  near(val(run('mcircuit-gap-core', {}, 1.13), 'probeNI'), 300 * 0.3 * Math.PI + 1.13 * 2e-3 / MU0, 1e-12);
});

test('gapped core: NI = 2000 by fixed-point iteration (μ guess → B → μ), compared with bisection', () => {
  const result = run('mcircuit-gap-core', { mode: 1 });
  assert.equal(val(result, 'NI'), 2000);
  const first = result.notes.find(n => n.startsWith('반복 1'));
  assert.ok(first && first.includes('1.1236'), 'μ = 1/200 gives 1.1236 T (the lecture\'s ≈ 1.12)');
  assert.ok(result.notes.some(n => n.includes('수렴')));
  const B = val(result, 'B');
  near(B, 1.0950, 1e-3, 'converged B ≈ 1.095 T on the piecewise-linear table');
  assert.ok(B < 1.13 && B > 1);
  // the converged B satisfies NI = H(B) l + B g/μ₀ on the table
  const H = 200 + (B - 1) / 0.13 * 100;
  near(H * 0.3 * Math.PI + B * 2e-3 / MU0, 2000, 1e-9);
  // B = 1.13 T is not a solution: that point needs about 2081 A·turn
  near(val(run('mcircuit-gap-core', {}, 1.13), 'probeNI'), 2081.2, 1e-3);
  // linear core: B = NI/(l/μ + g/μ₀)
  const linear = run('mcircuit-gap-core', { mode: 1, coreModel: 1, muR: 4000 });
  near(val(linear, 'B'), 2000 / (0.3 * Math.PI / (4000 * MU0) + 2e-3 / MU0), 1e-9);
  const row = getExperiment('mcircuit-gap-core').verify({ ...defaults(getExperiment('mcircuit-gap-core')), mode: 1 });
  assert.ok(row.every(r => r.status === 'pass'), JSON.stringify(row.map(r => r.status)));
  assert.equal(getExperiment('mcircuit-gap-core').symbolic({}).steps.at(-1).explanation.includes('1.095'), true);
  assert.equal(val(run('mcircuit-gap-core', { gap: 0 }), 'RmGap'), 0);
});

test('hysteresis loop (concept model): B_r at H = 0, B = 0 at −H_c, area = ∮H dB ≤ 4 H_c B_s', () => {
  const result = run('mcircuit-hysteresis', {}, 0);
  assert.equal(result.region, 'ascending');
  near(val(result, 'Br'), 1, 1e-12);
  near(val(result, 'width'), 60 / Math.atanh(1 / 1.5), 1e-12);
  const area = val(result, 'area'), bound = 4 * 60 * 1.5;
  assert.ok(area < bound && area > 0.99 * bound, `${area} vs ${bound}`);
  near(val(result, 'cycleLoss'), 1e-4 * area, 1e-12);
  near(val(result, 'power'), 50 * 1e-4 * area, 1e-12);
  assert.equal(run('mcircuit-hysteresis', {}, Math.PI).region, 'descending');
  // same H on the two branches: ascending B is smaller (the lag that makes the loop)
  const up = val(run('mcircuit-hysteresis', {}, 0.3), 'B'), down = val(run('mcircuit-hysteresis', {}, Math.PI - 0.3), 'B');
  assert.ok(up < down);
  const small = run('mcircuit-hysteresis', { Hmax: 30 }, 0);
  assert.ok(val(small, 'area') < area, 'a smaller drive amplitude encloses less area');
});

// ---- 8.9–8.10 inductance and virtual work -------------------------------------------------------------------------------------------
test('solenoid, coax and toroid inductances (lecture c12–c15) and the energy identity', () => {
  const sol = run('induct-solenoid', { muR: 2 }, 3), S = Math.PI * 0.02 ** 2;
  near(val(sol, 'Lper'), 2 * MU0 * 1e6 * S, 1e-12);
  near(val(sol, 'L'), 2 * MU0 * 1e6 * S * 0.5, 1e-12);
  near(val(sol, 'linkage'), val(sol, 'L') * 3, 1e-12);
  near(val(sol, 'energy'), 0.5 * val(sol, 'L') * 9, 1e-12);
  near(val(sol, 'energyDensity') * S * 0.5, val(sol, 'energy'), 1e-12, 'W = ½∫B·H dv');
  const coax = run('induct-coax');
  near(val(coax, 'Lext'), 2e-7 * Math.log(3), 1e-9, 'μ ln(b/a)/(2π) with a = 10 mm, b = 30 mm');
  near(val(coax, 'Lint'), 5e-8, 1e-9, 'μ₀/(8π) = 50 nH/m');
  near(val(coax, 'Ltotal'), 2e-7 * Math.log(3) + 5e-8, 1e-9);
  near(val(coax, 'energyPer'), 0.5 * val(coax, 'Ltotal') * 100, 1e-12);
  assert.equal(run('induct-coax', {}, 0.02).region, 'between');
  assert.equal(run('induct-coax', {}, 0.005).region, 'inner-conductor');
  near(val(run('induct-coax', {}, 0.005), 'Bphi'), MU0 * 10 * 0.005 / (2 * Math.PI * 1e-4), 1e-12);
  assert.equal(val(run('induct-coax', {}, 0.05), 'Bphi'), 0);
  const toroid = run('induct-toroid', { muR: 100 }, 0.07), L = 100 * MU0 / (2 * Math.PI) * 500 ** 2 * 0.03 * Math.log(2);
  near(val(toroid, 'L'), L, 1e-12);
  near(val(toroid, 'Bphi'), 100 * MU0 * 500 / (2 * Math.PI * 0.07), 1e-12);
  near(val(toroid, 'energy'), 0.5 * L, 1e-12);
  assert.ok(Math.abs(val(toroid, 'approxRatio') - 1) < 0.05, 'mean-radius approximation within 5 % for b/a = 2');
  assert.ok(Math.abs(val(run('induct-toroid', { b: 0.055 }, 0.05), 'approxRatio') - 1) < 1e-3, 'and within 0.1 % for b/a = 1.1');
  assert.equal(val(run('induct-toroid', {}, 0.03), 'Bphi'), 0);
});

test('mutual inductance: M = μ n₁n₂S₁ℓ, k = √(S₁/S₂), series L₁ + L₂ ± 2M, energy ± M I₁I₂', () => {
  const result = run('induct-mutual', {}, 1), S1 = Math.PI * 4e-4, S2 = Math.PI * 16e-4;
  near(val(result, 'M'), MU0 * 2000 * 1000 * S1 * 0.3, 1e-12);
  near(val(result, 'L1'), MU0 * 2000 ** 2 * S1 * 0.3, 1e-12);
  near(val(result, 'L2'), MU0 * 1000 ** 2 * S2 * 0.3, 1e-12);
  near(val(result, 'k'), Math.sqrt(S1 / S2), 1e-12);
  assert.equal(val(result, 'k'), 0.5);
  near(val(result, 'seriesAiding'), val(result, 'L1') + val(result, 'L2') + 2 * val(result, 'M'), 1e-12);
  near(val(result, 'seriesOpposing'), val(result, 'L1') + val(result, 'L2') - 2 * val(result, 'M'), 1e-12);
  near(val(result, 'energy'), 0.5 * val(result, 'L1') * 4 + val(result, 'M') * 2 + 0.5 * val(result, 'L2'), 1e-12);
  const opposing = run('induct-mutual', { polarity: -1 }, 1);
  near(val(opposing, 'mutualEnergy'), -val(result, 'mutualEnergy'), 1e-12);
  near(val(opposing, 'energy'), 0.5 * val(result, 'L1') * 4 - val(result, 'M') * 2 + 0.5 * val(result, 'L2'), 1e-12);
});

test('virtual displacement: gap core F = −B²S/(2μ₀) (finite μ), constant-I and constant-Λ give the same force', () => {
  const x = 2e-3, N = 500, I = 4, S = 6e-4, l = 0.3 * Math.PI, mu = 4000;
  for (const constraint of [0, 1]) {
    const result = run('induct-virtual-gap', { constraint });
    near(val(result, 'F'), -0.5 * (N * I) ** 2 * MU0 * mu * mu * S / (l + mu * x) ** 2, 1e-12);
    assert.ok(val(result, 'F') < 0);
    near(val(result, 'F'), val(result, 'Fcheck'), 1e-12, 'F = −B²S/2μ₀');
    near(val(result, 'mechanical'), val(result, 'Fdx'), 2e-3, 'energy bookkeeping F dx');
  }
  const B = val(run('induct-virtual-gap'), 'B');
  near(B, 1.1242, 5e-4, 'B ≈ 1.124 T for NI = 2000, μ_r = 4000');
  near(val(run('induct-virtual-gap'), 'F'), -301.7, 5e-4, 'F ≈ −302 N');
  // constant I: the supply delivers I dΛ, half of which stays as field energy; constant Λ: the supply delivers nothing
  const constantI = run('induct-virtual-gap', { constraint: 0 }), constantFlux = run('induct-virtual-gap', { constraint: 1 });
  near(val(constantI, 'dWfield'), 0.5 * val(constantI, 'dWelec'), 1e-12);
  assert.equal(val(constantFlux, 'dWelec'), 0);
  assert.ok(val(constantFlux, 'dWfield') > 0 && val(constantI, 'dWfield') < 0, 'opening the gap: field energy up at constant Λ, down at constant I');
  // μ → ∞: F → −½N²I²μ₀S/x²
  const stiff = run('induct-virtual-gap', { muR: 1e6 });
  near(val(stiff, 'F'), val(stiff, 'Finf'), 5e-3);
  near(val(run('induct-virtual-gap', { muR: 1e6 }), 'Finf'), -0.5 * (N * I) ** 2 * MU0 * S / (x * x), 1e-12);
  assert.equal(run('induct-virtual-gap', {}, -1e-3).status, 'unsupported');
});

test('virtual displacement: two solenoids F = I₁I₂ dM/dx = μ n₁n₂S₁ I₁I₂ (lecture c24)', () => {
  for (const constraint of [0, 1]) {
    const result = run('induct-virtual-coils', { constraint }), S1 = Math.PI * 4e-4, F = MU0 * 2000 * 1000 * S1 * 2 * 1.5;
    near(val(result, 'F'), F, 1e-12);
    near(val(result, 'slope'), MU0 * 2000 * 1000 * S1, 1e-12);
    near(val(result, 'M'), val(result, 'slope') * 0.3, 1e-12);
    near(val(result, 'mechanical'), val(result, 'Fdx'), 1e-9, 'bookkeeping closes for the linear model');
    if (constraint === 0) near(val(result, 'dWelec'), 2 * val(result, 'dWfield'), 1e-12);
    else assert.equal(val(result, 'dWelec'), 0);
  }
  assert.ok(val(run('induct-virtual-coils', { current2: -1.5 }), 'F') < 0, 'opposite currents repel');
  assert.equal(run('induct-virtual-coils', {}, -0.1).status, 'unsupported');
});
