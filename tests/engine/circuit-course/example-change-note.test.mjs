// "Example applied" summary line: field names changed by an example, the amplitude basis first.
import test from 'node:test';
import assert from 'node:assert/strict';
import { getExperiment, exampleChangeNote, exampleFieldName, changedParameterLabels, initialParameters, draftsOf, exampleDrafts } from '../../../src/circuit-course-registry.js';

test('field names: parentheses dropped, R/X pairs collapse to Z', () => {
  assert.equal(exampleFieldName('전원 전압 (Δ는 선간=코일) V'), '전원 전압 V');
  assert.equal(exampleFieldName('부하 a (Y: AN · Δ: AB) 저항 R'), '부하 a Z');
  assert.equal(exampleFieldName('선로 Zℓ 리액턴스 X'), '선로 Zℓ Z');
  assert.equal(exampleFieldName('저항 R'), 'Z');
});

test('note text: basis first, names joined with ·, nothing changed', () => {
  assert.equal(exampleChangeNote({ basisBefore: 'peak', basisAfter: 'rms', labels: ['주파수 f', '전원 V', '부하 a 저항 R', '부하 a 리액턴스 X'] }), '예제 적용: 기준 peak → RMS, 주파수 f·전원 V·부하 a Z 변경');
  assert.equal(exampleChangeNote({ basisBefore: 'rms', basisAfter: 'rms', labels: ['주파수 f'] }), '예제 적용: 주파수 f 변경');
  assert.equal(exampleChangeNote({ basisBefore: 'rms', basisAfter: 'rms', labels: [] }), '예제 적용: 바뀐 값 없음');
  assert.equal(exampleChangeNote({ basisBefore: 'rms', basisAfter: 'peak', labels: [] }), '예제 적용: 기준 RMS → peak');
});

test('experiments: only fields whose physical value changed are named; a basis switch alone does not rename amplitude fields', () => {
  for (const experiment of ['phasor-wave', 'impedance'].map(getExperiment)) {
    const base = draftsOf(experiment, initialParameters(experiment));
    const example = experiment.examples.find(e => e.values.basis === 'peak') ?? experiment.examples[0];
    const after = exampleDrafts(experiment, example, base);
    const labels = changedParameterLabels(experiment, base, after, { ...initialParameters(experiment), ...after });
    const names = experiment.parameters.filter(p => labels.includes(p.label)).map(p => p.key);
    for (const key of names) assert.notEqual(base[key], after[key], experiment.id + ' ' + key);
    assert.deepEqual(changedParameterLabels(experiment, base, base, initialParameters(experiment)), [], 'same drafts: nothing changed');
  }
  const ex = getExperiment('phasor-wave'), base = draftsOf(ex, initialParameters(ex));
  const peakSame = { ...base, basis: 'peak', re: String(Number(base.re) * Math.SQRT2), im: String(Number(base.im) * Math.SQRT2) };
  assert.deepEqual(changedParameterLabels(ex, base, peakSame, initialParameters(ex)), [], 'same physical quantity in the other basis');
});
