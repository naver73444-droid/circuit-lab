// Hayt Ch.9 (7주차) lecture experiments wired into the course: registry, subjects, presets, profiles, symbolic solutions, checks.
// The models themselves have their own files (course-emf-rotating, course-emf-homopolar, course-maxwell-displacement).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EXPERIMENTS, COURSE_ROADMAP, getExperiment } from '../../../src/em-course-registry.js';
import { paramSpec, topicOf } from '../../../src/em-course-params.js';
import { answerItems } from '../../../src/em-course-ui.js';
import { hayt, isZeroed, linspace, zeroed } from '../../../src/em-course-lecture.js';

const CH9 = {
  'emf-rotating-loop': { topic: '자기유도', sections: ['9.1'], series: 3, steps: 5, answers: ['emf', 'transformerEmf', 'motionalEmf'], coordinate: 'phase' },
  'emf-homopolar': { topic: '자기유도', sections: ['9.1'], series: 2, steps: 4, answers: ['voltageBA', 'voltageFull', 'motionalE'], coordinate: 'radiusRatio' },
  'maxwell-displacement': {
    topic: '변위전류·Maxwell', sections: ['9.2', '9.3', '9.4'], series: 2, steps: 5,
    answers: ['enclosedDisplacementCurrent', 'Hphi', 'freeCurrent', 'totalDisplacementCurrent'], coordinate: 'radiusRatio',
  },
};
const IDS = Object.keys(CH9);
const defaults = def => Object.fromEntries(def.parameters.map(p => [p.key, p.initial]));
const run = (id, over = {}, s = undefined) => { const def = getExperiment(id); return def.evaluate({ ...defaults(def), ...over }, [0, 0, s ?? def.probeDefault[2]]); };
const item = (result, key) => result.scalars.find(entry => entry.key === key);
const DEG = Math.PI / 180;

test('47 experiments, 12 subjects, three Ch.9 experiments at the end with week 7 and their sections', () => {
  assert.equal(EXPERIMENTS.length, 47);
  assert.equal(new Set(EXPERIMENTS.map(d => d.id)).size, 47, 'no duplicate id');
  assert.deepEqual(EXPERIMENTS.slice(-3).map(d => d.id), IDS, 'appended after the existing order');
  assert.equal(new Set(EXPERIMENTS.map(d => topicOf(d.id))).size, 12);
  assert.equal(EXPERIMENTS.filter(d => d.lecture?.week === 6).length, 21, 'the Ch.8 set is unchanged');
  assert.equal(EXPERIMENTS.filter(d => d.lecture?.week === 7).length, 3);
  for (const [id, spec] of Object.entries(CH9)) {
    const def = getExperiment(id);
    assert.ok(def, id);
    assert.equal(topicOf(id), spec.topic, id);
    assert.equal(def.lecture.week, 7, id);
    assert.deepEqual(def.lecture.sections, spec.sections, id);
    assert.ok(!def.title.includes('7주차') && !def.title.includes('§'), `${id}: the week and section live in the subject group and the subtitle`);
    assert.equal(def.view.kind, 'profile');
    assert.equal(def.view.plane, 'xz');
    assert.deepEqual(def.view.probeAxes, [0, 2]);
    assert.ok(def.view.coordinate?.key && def.view.coordinate.unit, id);
    assert.deepEqual(def.answerKeys, spec.answers, id);
    assert.deepEqual(def.coordinateKeys, [spec.coordinate], id);
    assert.ok(def.description.startsWith('앱 검산 예시'), `${id}: the description says the numbers are an app example`);
    assert.ok(def.references.some(r => r.title.includes('Hayt') && r.title.includes('Ch.9') && r.url.startsWith('https://')), `${id} cites Hayt Ch.9`);
    assert.ok(!def.references.some(r => r.url.includes('.notes')), `${id}: no local note links`);
    assert.ok(def.assumptions.length && def.validity.length && def.singularities.length && def.formulas.length, id);
  }
});

test('subjects: 자기유도 lists the two old experiments first, then the rotating loop and the disc; the first experiment is still force-lorentz', () => {
  assert.deepEqual(EXPERIMENTS.filter(d => topicOf(d.id) === '자기유도').map(d => d.id), ['faraday-loop', 'motional-rod', 'emf-rotating-loop', 'emf-homopolar']);
  assert.deepEqual(EXPERIMENTS.filter(d => topicOf(d.id) === '변위전류·Maxwell').map(d => d.id), ['maxwell-displacement']);
  assert.ok(getExperiment('force-lorentz'));
  const controller = readFileSync(new URL('../../../src/em-course-controller.js', import.meta.url), 'utf8');
  assert.match(controller, /FIRST_EXPERIMENT = 'force-lorentz'/);
  assert.match(controller, /CH9_TOPICS = \['자기유도', '변위전류·Maxwell'\]/);
  assert.match(controller, /Hayt Ch\.9 \(7주차\)/);
  // the strict cursor is a flag of the experiment's view, not a list of ids in the controller
  assert.match(controller, /def\.view\?\.strictProbe/);
  for (const id of IDS) {
    assert.equal(getExperiment(id).view.strictProbe, true, `${id}: the cursor refuses invalid candidates`);
    assert.ok(!controller.includes(`'${id}'`), `${id}: not listed in the controller`);
  }
  assert.equal(EXPERIMENTS.filter(d => d.view?.strictProbe).length, 3, 'only the Ch.9 sweeps are strict');
});

test('shared pieces: one 0 rule (1e−12 of the peak) and one Hayt citation helper for Ch.8 and Ch.9', () => {
  assert.equal(zeroed(1e-13, 1), 0);                                           // 1e−13 ≤ 1e−12·1
  assert.equal(zeroed(1e-12, 1), 0);                                           // the bound itself is residue
  assert.equal(zeroed(2e-12, 1), 2e-12);                                       // above the bound: kept as is
  assert.equal(zeroed(-3e-13, -1), 0);                                         // the peak's sign does not matter
  assert.equal(zeroed(0, 0), 0);                                               // an exact zero of a zero peak
  assert.equal(isZeroed(1e-30, 0), false, 'a zero peak zeroes only exact zeros');
  assert.equal(isZeroed(1e-30, undefined), false, 'no peak: never zeroed');
  assert.deepEqual(hayt('9.1', "Faraday's law"), { title: "Hayt & Buck, Engineering Electromagnetics 8판 — Ch.9 §9.1 Faraday's law", url: 'https://openlibrary.org/isbn/9780073380667' });
  assert.equal(hayt('9.3–9.4', 'x').title, 'Hayt & Buck, Engineering Electromagnetics 8판 — Ch.9 §9.3–9.4 x');
  assert.equal(hayt('8.10', 'y').title, 'Hayt & Buck, Engineering Electromagnetics 8판 — Ch.8 §8.10 y');
  for (const file of ['em-course-emf-rotating.js', 'em-course-emf-homopolar.js', 'em-course-maxwell-displacement.js', 'em-course-ui.js']) {
    const source = readFileSync(new URL(`../../../src/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /<=\s*(?:1e-12|ZERO_RATIO)/, `${file}: no own copy of the 0 rule`);
    assert.doesNotMatch(source, /openlibrary\.org|openstax\.org/, `${file}: citations through hayt()/openstax()`);
  }
  // the capacitor's peaks come from the closed form once, not from two extra state evaluations per result
  const capacitor = readFileSync(new URL('../../../src/em-course-maxwell-displacement.js', import.meta.url), 'utf8');
  assert.doesNotMatch(capacitor, /function peaks|phase: 0 \}|phase: Math\.PI \/ 2 \}/);
  // sweep samples end on the end itself: 2π, 1 and 3 exactly, so a drag clamped to the last sample is a valid cursor
  assert.deepEqual(linspace(0, 1, 5), [0, 0.25, 0.5, 0.75, 1]);
  for (const count of [2, 7, 81, 97, 161, 512]) {
    assert.equal(linspace(0, 2 * Math.PI, count).at(-1), 2 * Math.PI, `2π, ${count} samples`);
    assert.equal(linspace(0, 3, count).at(-1), 3);
    assert.equal(linspace(-1, 1, count)[0], -1);
  }
});

test('every Ch.9 experiment: preset valid, answers and coordinate are scalars, profile series finite, verify passes, symbolic supported', () => {
  for (const [id, spec] of Object.entries(CH9)) {
    const def = getExperiment(id), params = defaults(def), result = def.evaluate(params, [...def.probeDefault]);
    assert.equal(result.status, 'valid', `${id}: ${result.reason}`);
    assert.deepEqual(result.vectors, {}, `${id}: no fake vectors`);
    const keys = result.scalars.map(s => s.key);
    for (const key of [...spec.answers, spec.coordinate]) assert.ok(keys.includes(key), `${id}.${key}`);
    assert.ok(result.scalars.every(s => Number.isFinite(s.value)), id);
    assert.ok(result.notes.length >= 3, id);
    const profiles = def.profile(params, 81);
    assert.equal(profiles.length, spec.series, id);
    for (const series of profiles) {
      assert.equal(series.points.length, 81, `${id}/${series.key}`);
      assert.ok(series.points.every(p => Number.isFinite(p.coordinate) && Number.isFinite(p.value)), `${id}/${series.key}`);
    }
    assert.deepEqual(def.profile(params, 1), []);
    assert.deepEqual(def.profile(params, 513), []);
    const rows = def.verify(params);
    assert.ok(rows.length >= 2, id);
    for (const row of rows) assert.equal(row.status, 'pass', `${id}: ${row.label} ${row.actual} vs ${row.expected}`);
    const solution = def.symbolic({});
    assert.equal(solution.status, 'supported', id);
    assert.equal(solution.steps.length, spec.steps, id);
    assert.equal(def.symbolic({ any: 1 }).status, 'unsupported', id);
    for (const parameter of def.parameters) {
      const control = paramSpec(parameter);
      assert.ok(['range', 'number'].includes(control.kind), `${id}.${parameter.key}`);
      assert.ok(parameter.initial >= parameter.min && parameter.initial <= parameter.max, `${id}.${parameter.key}`);
    }
  }
});

test('presets: −0.5 V for the loop, +0.25 V at the rim, 43.69367 μA through the capacitor (hand numbers in the spec)', () => {
  // K = ωB₀hd = 100·0.5·0.2·0.1 = 1 V; θ = 30°: ℰ = −K cos60° = −0.5 V
  assert.ok(Math.abs(item(run('emf-rotating-loop'), 'emf').value + 0.5) <= 1e-12 + 1e-11 * 0.5);
  // V_ba = Bωr₀²/2 = 0.5·100·0.01/2 = 0.25 V
  assert.ok(Math.abs(item(run('emf-homopolar'), 'voltageBA').value - 0.25) <= 1e-12 + 1e-11 * 0.25);
  // I = ωC V_m = 2000π · ε₀π(0.05)²/0.001 · 100
  const expected = 2000 * Math.PI * 8.8541878188e-12 * Math.PI * 0.0025 / 0.001 * 100;
  const result = run('maxwell-displacement');
  assert.ok(Math.abs(item(result, 'freeCurrent').value - expected) <= 1e-14 + 1e-11 * expected);
  assert.ok(Math.abs(item(result, 'enclosedDisplacementCurrent').value - expected) <= 1e-14 + 1e-11 * expected, 's = 1 encloses the whole current');
  assert.ok(Math.abs(expected - 43.69367e-6) <= 1e-5 * 43.69367e-6);
});

test('sweep ends: a candidate past an end is invalid (the controller then keeps the last valid point)', () => {
  assert.equal(run('emf-rotating-loop', {}, -0.01).status, 'invalid');
  assert.equal(run('emf-rotating-loop', {}, 2 * Math.PI + 0.01).status, 'invalid');
  assert.equal(run('emf-rotating-loop', {}, 2 * Math.PI).status, 'valid');
  assert.equal(run('emf-homopolar', {}, 1.01).status, 'invalid');
  assert.equal(run('emf-homopolar', {}, 0).status, 'valid');
  assert.equal(run('maxwell-displacement', {}, 3.01).status, 'invalid');
  assert.equal(run('maxwell-displacement', {}, -0.01).status, 'invalid');
  assert.equal(run('maxwell-displacement', { a: 0.01, d: 0.002 }).status, 'invalid', 'd/a = 0.2 > 0.1');
});

test('zero residue reads 0 on screen while the stored value is not rounded; a small nonzero value keeps its number', () => {
  const loop = getExperiment('emf-rotating-loop');
  const at45 = run('emf-rotating-loop', {}, 45 * DEG), sum = item(at45, 'emf');
  assert.ok(Math.abs(sum.value) <= 1e-12 * sum.zero, `|${sum.value}| is residue of K = ${sum.zero}`);
  const text = answerItems(at45, loop).find(entry => entry.key === 'scalar:emf').text;
  assert.match(text, /= ?0 V$/, text);
  assert.ok(at45.notes.some(n => n.includes('합계 V_emf_ab 방향 없음')), 'sign text says no direction');
  const at449 = run('emf-rotating-loop', {}, 44.9 * DEG), near = answerItems(at449, loop).find(entry => entry.key === 'scalar:emf').text;
  assert.doesNotMatch(near, /= ?0 V$/, near);

  const cap = getExperiment('maxwell-displacement');
  const at90 = run('maxwell-displacement', { phase: Math.PI / 2 }), current = item(at90, 'freeCurrent');
  assert.ok(current.zero > 0 && Math.abs(current.value) <= 1e-12 * current.zero);
  assert.match(answerItems(at90, cap).find(entry => entry.key === 'scalar:freeCurrent').text, /= ?0 A$/);
  assert.ok(at90.notes.some(n => n.includes('방향 없음')));
  const at899 = run('maxwell-displacement', { phase: 89.9 * DEG });
  assert.doesNotMatch(answerItems(at899, cap).find(entry => entry.key === 'scalar:freeCurrent').text, /= ?0 A$/);
  assert.ok(at899.notes.some(n => n.includes('+z 변위전류')), 'a small positive current keeps its direction');
});

test('roadmap, README, ARCHITECTURE and the pure-module list know the Ch.9 experiments', () => {
  assert.ok(COURSE_ROADMAP.some(entry => entry.title.startsWith('자기유도') && entry.description.startsWith('4실험')));
  assert.ok(COURSE_ROADMAP.some(entry => entry.title.includes('변위전류') && entry.description.includes('점형 4식')));
  const boundaries = readFileSync(new URL('../../../scripts/check-boundaries.mjs', import.meta.url), 'utf8');
  for (const file of ['em-course-emf-rotating.js', 'em-course-emf-homopolar.js', 'em-course-maxwell-displacement.js']) {
    assert.ok(boundaries.includes(`'${file}'`), `${file} is a pure module`);
    const source = readFileSync(new URL(`../../../src/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /\b(?:document|window|localStorage)\b/, `${file} stays DOM-free`);
  }
  const readme = readFileSync(new URL('../../../README.md', import.meta.url), 'utf8');
  assert.match(readme, /47개 실험/);
  assert.match(readme, /Hayt Ch\.9/);
  const architecture = readFileSync(new URL('../../../docs/ARCHITECTURE.md', import.meta.url), 'utf8');
  assert.match(architecture, /em-course-maxwell-displacement\.js/);
});
