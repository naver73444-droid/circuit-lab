import test from 'node:test';
import assert from 'node:assert/strict';
import { MU0 } from '../../../src/em-physics.js';
import { validateCurrentSources } from '../../../src/em-current-field.js';
import { forceOnSource } from '../../../src/em-current-force.js';
import { CURRENT_PRESETS, PRESET_FACTS, currentPreset } from '../../../src/em-current-presets.js';
import { forceReadout } from '../../../src/em-readout.js';

const wire = (id, current, x, y, direction = [0, 0, 1]) => ({ id, type: 'wire', current, position: [x, y, 0], direction });
const within = (value, expected, rel = 1e-9) => assert.ok(Math.abs(value - expected) <= rel * Math.abs(expected), `${value} vs ${expected}`);

test('two parallel wires I1 = I2 = 10 A at d = 0.2 m: F/l = mu0 I1 I2 / (2 pi d) = 1.0e-4 N/m, attracting', () => {
  const sources = validateCurrentSources([wire('A', 10, -0.1, 0), wire('B', 10, 0.1, 0)]);
  const a = forceOnSource(sources, 'A'), b = forceOnSource(sources, 'B');
  assert.equal(a.status, 'ok');
  assert.equal(a.kind, 'perLength');
  within(a.magnitude, 1.0e-4, 1e-9);
  within(a.theory, MU0 * 100 / (2 * Math.PI * 0.2));
  assert.equal(a.relation, 'attract');
  assert.ok(a.vector[0] > 0 && b.vector[0] < 0, 'each is pulled toward the other');
  assert.ok(Math.abs(a.vector[0] + b.vector[0]) < 1e-15, 'equal and opposite');
  assert.equal(a.uniform, true);
  assert.equal(a.distance.toFixed(6), '0.200000');
});

test('antiparallel wires repel; the strength scales with the product of the currents', () => {
  const repel = forceOnSource(validateCurrentSources([wire('A', 10, -0.1, 0), wire('B', -5, 0.1, 0)]), 'A');
  assert.equal(repel.relation, 'repel');
  assert.ok(repel.vector[0] < 0);
  within(repel.magnitude, MU0 * 50 / (2 * Math.PI * 0.2));
});

test('a lone source feels nothing, a disabled source is skipped, a source on top of another is excluded', () => {
  assert.equal(forceOnSource(validateCurrentSources([wire('A', 10, 0, 0)]), 'A').status, 'none');
  const withOff = validateCurrentSources([wire('A', 10, 0, 0), { ...wire('B', 10, 1, 0), enabled: false }]);
  assert.equal(forceOnSource(withOff, 'A').status, 'none');
  assert.equal(forceOnSource(withOff, 'B'), null);
  assert.equal(forceOnSource(validateCurrentSources([wire('A', 10, 0, 0), wire('B', 10, 0.0005, 0)]), 'A').status, 'excluded');
});

test('two sheets (K, -K): force per area mu0 K^2 / 2 pushing them apart (the own field is left out)', () => {
  const sheets = validateCurrentSources([
    { id: 'U', type: 'sheet', K: 20, position: [0, 0.3, 0], normal: [0, 1, 0], direction: [0, 0, 1] },
    { id: 'D', type: 'sheet', K: -20, position: [0, -0.3, 0], normal: [0, 1, 0], direction: [0, 0, 1] },
  ]);
  const upper = forceOnSource(sheets, 'U'), lower = forceOnSource(sheets, 'D');
  assert.equal(upper.kind, 'perArea');
  within(upper.magnitude, MU0 * 400 / 2);
  assert.ok(upper.vector[1] > 0 && lower.vector[1] < 0, 'repulsion');
  within(upper.magnitude, PRESET_FACTS.sheetPressure);
});

test('a circular loop beside a long wire in the same plane: F = mu0 I1 I2 (D / sqrt(D^2 - R^2) - 1)', () => {
  const D = 0.8, R = 0.5;
  for (const loopCurrent of [3, -3]) {
    const sources = validateCurrentSources([
      wire('W', 7, D, 0),
      { id: 'L', type: 'loop', current: loopCurrent, position: [0, 0, 0], radius: R, normal: [0, 1, 0] },
    ]);
    const force = forceOnSource(sources, 'L');
    assert.equal(force.kind, 'net');
    within(force.magnitude, MU0 * 7 * 3 * (D / Math.sqrt(D * D - R * R) - 1), 1e-9);
    assert.ok(Math.abs(force.vector[1]) < 1e-15 && Math.abs(force.vector[2]) < 1e-12 * force.magnitude, 'along x only');
    // the near side carries -z current for a positive loop current: antiparallel to the wire, so it is pushed away
    assert.equal(Math.sign(force.vector[0]), loopCurrent > 0 ? -1 : 1);
  }
});

test('a finite segment parallel to a long wire feels the force per length times its length (far from its ends)', () => {
  const sources = validateCurrentSources([wire('W', 10, 0.2, 0), { id: 'S', type: 'segment', current: 10, start: [0, 0, -0.02], end: [0, 0, 0.02] }]);
  const force = forceOnSource(sources, 'S');
  within(force.magnitude, MU0 * 100 / (2 * Math.PI * 0.2) * 0.04, 1e-3);
  assert.ok(force.vector[0] > 0);
});

test('the presets build valid sources, name their facts, and fit every viewing plane', () => {
  assert.deepEqual(Object.keys(CURRENT_PRESETS), ['pair', 'wire-ampere', 'sheets', 'wire-loop']);
  within(PRESET_FACTS.pairForcePerLength, 1.0e-4, 1e-9);
  within(PRESET_FACTS.sheetsFieldBetween, MU0 * 20);
  for (const plane of ['xy', 'xz', 'yz']) {
    const pair = currentPreset('pair', plane), sources = validateCurrentSources(pair.sources);
    within(forceOnSource(sources, pair.selectedId).magnitude, 1.0e-4, 1e-9);
    for (const name of Object.keys(CURRENT_PRESETS)) {
      const preset = currentPreset(name, plane);
      assert.doesNotThrow(() => validateCurrentSources(preset.sources));
      assert.ok(preset.sources.some(source => source.id === preset.selectedId));
    }
  }
  assert.equal(currentPreset('nope'), null);
  assert.equal(currentPreset('wire-ampere').ampere.shape, 'circle');
});

test('force readout: magnitude, direction, pair relation and the theory value', () => {
  const sources = validateCurrentSources(currentPreset('pair', 'xy').sources);
  const force = forceOnSource(sources, 'W1'), readout = forceReadout(force, sources[0], 'xy');
  assert.equal(readout.status, 'ok');
  assert.equal(readout.compact, 'F/ℓ = 100 µN/m');
  assert.match(readout.lines.join('\n'), /같은 방향 전류는 끌어당깁니다/);
  assert.match(readout.lines.join('\n'), /이론 μ₀I₁I₂\/\(2πd\) = 100 µN\/m/);
  assert.match(readout.lines.join('\n'), /평면 안 ∠ 0°/);
  assert.equal(forceReadout(null).status, 'none');
});

test('a preset note names the chips the preset flipped and points to the rectangular-loop force solution', async () => {
  const { currentPreset, presetChipChanges, presetNoteText, PRESET_COURSE_HINT } = await import('../../../src/em-current-presets.js');
  const preset = currentPreset('wire-ampere');
  assert.equal(presetChipChanges(preset, { force: true, ampere: false }), '힘 끔 · 암페어 루프 켬');
  assert.equal(presetChipChanges(preset, { force: false, ampere: true }), '');
  const note = presetNoteText('wire-ampere', preset, { force: true, ampere: false });
  assert.match(note, /^한 도선 \+ 암페어 루프: /);
  assert.match(note, /\n바뀐 칩: 힘 끔 · 암페어 루프 켬\n/);
  assert.ok(note.endsWith('직사각 루프 변별 힘 풀이: 문제 풀이 ▸ 자기력·토크'));
  assert.equal(PRESET_COURSE_HINT, '직사각 루프 변별 힘 풀이: 문제 풀이 ▸ 자기력·토크');
  assert.doesNotMatch(presetNoteText('wire-ampere', preset, { force: false, ampere: true }), /바뀐 칩/);
});
