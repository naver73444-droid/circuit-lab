// Course UX (round 2): label notes, conditional parameters, degrees for angles, answer groups, sweep coordinate text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EXPERIMENTS, getExperiment } from '../../../src/em-course-registry.js';
import { coordinateScale, coordinateText, formatParam, isParamVisible, paramSpec, parseParam, splitLabel, topicOf } from '../../../src/em-course-params.js';
import { answerItems } from '../../../src/em-course-ui.js';

const defaults = def => Object.fromEntries(def.parameters.map(p => [p.key, p.initial]));
const specOf = (id, key) => paramSpec(getExperiment(id).parameters.find(p => p.key === key));

test('label bodies are never cut; parenthetical notes and case lists become the helper line', () => {
  assert.deepEqual(splitLabel('B–H 표 점 1: H₁'), { main: 'B–H 표 점 1: H₁', note: '' });
  assert.deepEqual(splitLabel('B–H 표 점 2: H₂ (H₂ > H₁)'), { main: 'B–H 표 점 2: H₂', note: 'H₂ > H₁' });
  assert.equal(specOf('mcircuit-gap-core', 'h1').label !== specOf('mcircuit-gap-core', 'b1').label, true, 'H₁ and B₁ stay distinguishable');
  assert.deepEqual(splitLabel('V(0)−V(d) (고정 V에서 사용)'), { main: 'V(0)−V(d)', note: '고정 V에서 사용' });
  assert.deepEqual(splitLabel('직선 도선 전류 I (강의 설정: 부호 + = −y 방향)'), { main: '직선 도선 전류 I', note: '강의 설정: 부호 + = −y 방향' });
  assert.deepEqual(splitLabel('제어: 0=고정 Q, 1=고정 V'), { main: '제어', note: '0=고정 Q, 1=고정 V' });
  assert.equal(specOf('mcircuit-gap-core', 'mode').label, '풀이 방향');
  for (const def of EXPERIMENTS) for (const parameter of def.parameters) {
    const { main, note } = splitLabel(parameter.label);
    assert.ok(main.length > 0, `${def.id}.${parameter.key}`);
    assert.equal(paramSpec(parameter).note, note);
  }
});

test('visibleWhen hides the inputs that the chosen solving direction and core material do not use', () => {
  const def = getExperiment('mcircuit-gap-core'), visible = params => def.parameters.filter(p => isParamVisible(p, params)).map(p => p.key);
  const base = defaults(def);
  assert.equal(base.mode, 0);
  assert.deepEqual(visible(base), ['mode', 'coreModel', 'area', 'meanDiameter', 'gap', 'targetB', 'h1', 'b1', 'h2', 'b2']);
  assert.deepEqual(visible({ ...base, mode: 1 }), ['mode', 'coreModel', 'area', 'meanDiameter', 'gap', 'turns', 'current', 'h1', 'b1', 'h2', 'b2']);
  assert.deepEqual(visible({ ...base, coreModel: 1 }), ['mode', 'coreModel', 'area', 'meanDiameter', 'gap', 'targetB', 'muR']);
  assert.ok(isParamVisible({ key: 'x' }, {}), 'a parameter without a rule is always shown');
  assert.ok(isParamVisible({ visibleWhen: { key: 'a', in: [1, 2] } }, { a: 2 }) && !isParamVisible({ visibleWhen: { key: 'a', in: [1, 2] } }, { a: 3 }));
});

test('angles are entered and shown in degrees while the model keeps radians', () => {
  const theta = specOf('force-dipole-field', 'theta');
  assert.equal(theta.unit, '°');
  assert.equal(formatParam(theta, Math.PI / 3), '60');
  const parsed = parseParam(theta, '90');
  assert.ok(parsed.ok && Math.abs(parsed.value - Math.PI / 2) < 1e-15);
  assert.equal(parseParam(theta, '181').ok, false, 'out of range is still rejected');
  for (const id of ['force-loop-torque', 'matter-boundary']) {
    const axis = getExperiment(id).view.coordinate, { scale, unit } = coordinateScale(axis);
    assert.equal(unit, '°', id);
    assert.ok(Math.abs(scale - Math.PI / 180) < 1e-18, id);
    assert.equal(coordinateText(axis, Math.PI / 3), '60°');
  }
  assert.equal(coordinateText({ key: 'ρ', unit: 'm' }, 0.002), '2 mm', 'distances keep their SI prefix');
  assert.equal(coordinateText({ key: 'B', unit: 'T', scale: 1 }, 1), '1 T');
  const matter = getExperiment('matter-boundary'), series = matter.profile(defaults(matter), 81).find(item => item.key === 'theta2');
  assert.equal(series.unit, '°');
  assert.ok(series.points.every(q => q.value >= 0 && q.value <= 90 + 1e-9), 'the θ₂ curve is in degrees');
});

test('the default answer is the final one and the answer list is grouped 답 / 중간값 / 좌표', () => {
  const headline = { 'force-wire-loop': 'netX', 'force-loop-torque': 'tauX', 'matter-boundary': 'theta2', 'induct-coax': 'Ltotal', 'mcircuit-gap-core': 'NI', 'force-lorentz': 'radius' };
  for (const [id, key] of Object.entries(headline)) assert.equal(getExperiment(id).answerKeys[0], key, id);
  for (const def of EXPERIMENTS.filter(d => d.lecture)) {
    const items = answerItems(def.evaluate(defaults(def), [...def.probeDefault]), def);
    assert.ok(items.every(item => ['답', '중간값', '좌표'].includes(item.group)), def.id);
    assert.equal(items.find(item => item.key === `scalar:${def.answerKeys[0]}`).group, '답', def.id);
    for (const key of def.coordinateKeys) assert.equal(items.find(item => item.key === `scalar:${key}`).group, '좌표', `${def.id}.${key}`);
  }
  const wire = getExperiment('force-wire-loop'), items = answerItems(wire.evaluate(defaults(wire), [...wire.probeDefault]), wire);
  assert.ok(items.filter(item => item.group === '답').length >= 1 && items.some(item => item.group === '중간값'));
});

test('the Hayt Ch.8 topics are the four lecture groups and the first experiment of the first group is force-lorentz', () => {
  const lectureTopics = [...new Set(EXPERIMENTS.filter(d => d.lecture).map(d => topicOf(d.id)))];
  assert.deepEqual(lectureTopics, ['자기력·토크', '자성체·경계', '자기회로', '에너지·인덕턴스']);
  assert.equal(EXPERIMENTS.find(d => topicOf(d.id) === lectureTopics[0]).id, 'force-lorentz');
  for (const def of EXPERIMENTS.filter(d => d.id.startsWith('force-'))) assert.ok(def.description.includes('평면 ▸ 자기'), def.id);
});
