import test from 'node:test';
import assert from 'node:assert/strict';
import { createCurrentEvaluator, validateCurrentSources } from '../../../src/em-current-field.js';
import {
  ampereCoarse, ampereEnclosure, ampereLength, ampereMeasure, ampereSamples, amperePrecise, circulationAgrees, clampAmpere,
  ampereSize, ampereSizeText, resizeAmpere, switchAmpereShape,
} from '../../../src/em-ampere.js';
import { ampereReadout } from '../../../src/em-readout.js';

const wire = (id, current, x, y, direction = [0, 0, 1]) => ({ id, type: 'wire', current, position: [x, y, 0], direction });
const circle = (x, y, radius, orientation = 1) => ({ shape: 'circle', center: [x, y, 0], radius, halfWidth: 1, halfHeight: 1, orientation });
const rect = (x, y, halfWidth, halfHeight, orientation = 1) => ({ shape: 'rect', center: [x, y, 0], radius: 1, halfWidth, halfHeight, orientation });
const within = (value, expected, rel) => assert.ok(Math.abs(value - expected) <= rel * Math.max(Math.abs(expected), 1e-12), `${value} vs ${expected}`);

test('a circle around one wire: I_enc = I and the circulation of H matches within 1% (coarse) and tightly (precise)', () => {
  const sources = validateCurrentSources([wire('W', 10, 0, 0)]);
  const coarse = ampereMeasure(sources, circle(0, 0, 1), 'xy');
  assert.equal(coarse.enclosure.status, 'ok');
  assert.deepEqual(coarse.enclosure.enclosedIds, ['W']);
  assert.equal(coarse.enclosure.enclosedCurrent, 10);
  within(coarse.numeric.circulation, 10, 0.01);
  const precise = ampereMeasure(sources, circle(0, 0, 1), 'xy', { precise: true });
  within(precise.numeric.circulation, 10, 1e-9);
  assert.equal(precise.numeric.converged, true);
  // symmetric loop: H is the same everywhere on the path, 10 / (2 pi)
  within(precise.numeric.maxH, 10 / (2 * Math.PI), 1e-9);
  within(precise.numeric.minH, 10 / (2 * Math.PI), 1e-9);
});

test('off-centre circles keep the circulation, but H is no longer uniform on the path', () => {
  const sources = validateCurrentSources([wire('W', 10, 0, 0)]);
  const measure = ampereMeasure(sources, circle(0.6, 0.2, 1), 'xy', { precise: true });
  within(measure.numeric.circulation, 10, 1e-6);
  assert.ok(measure.numeric.maxH / measure.numeric.minH > 2);
  assert.equal(circulationAgrees(measure.numeric.circulation, measure.enclosure.enclosedCurrent), true);
});

test('no enclosed wire: I_enc = 0 and the circulation is zero (H itself is not)', () => {
  const sources = validateCurrentSources([wire('W', 10, 3, 0)]);
  const measure = ampereMeasure(sources, circle(0, 0, 1), 'xy', { precise: true });
  assert.equal(measure.enclosure.status, 'ok');
  assert.equal(measure.enclosure.enclosedCurrent, 0);
  assert.deepEqual(measure.enclosure.outsideIds, ['W']);
  assert.ok(Math.abs(measure.numeric.circulation) < 1e-9);
  assert.ok(measure.numeric.maxH > 0.1);
});

test('signed sum, orientation and the right-hand rule', () => {
  const sources = validateCurrentSources([wire('A', 10, -0.3, 0), wire('B', -4, 0.3, 0.1), wire('C', 7, 5, 5)]);
  const ccw = ampereMeasure(sources, circle(0, 0, 1), 'xy', { precise: true });
  assert.equal(ccw.enclosure.enclosedCurrent, 6);
  within(ccw.numeric.circulation, 6, 1e-6);
  const cw = ampereMeasure(sources, circle(0, 0, 1, -1), 'xy', { precise: true });
  assert.equal(cw.enclosure.enclosedCurrent, -6);
  within(cw.numeric.circulation, -6, 1e-6);
  // in the xz view the viewer looks from -y: a wire along -y points at the viewer and counts positive
  const side = validateCurrentSources([{ id: 'S', type: 'wire', current: 5, position: [0, 0, 0], direction: [0, -1, 0] }]);
  const xz = ampereMeasure(side, { ...circle(0, 0, 1), center: [0, 0, 0] }, 'xz', { precise: true });
  assert.equal(xz.enclosure.enclosedCurrent, 5);
  within(xz.numeric.circulation, 5, 1e-9);
});

test('rectangle loops: enclosed current within 1%, converged value tight', () => {
  const sources = validateCurrentSources([wire('W', 10, 0.2, 0.1), wire('X', 3, 2, 0)]);
  const loop = rect(0, 0, 1, 0.6);
  const coarse = ampereMeasure(sources, loop, 'xy');
  assert.equal(coarse.enclosure.enclosedCurrent, 10);
  within(coarse.numeric.circulation, 10, 0.01);
  const precise = ampereMeasure(sources, loop, 'xy', { precise: true });
  within(precise.numeric.circulation, 10, 1e-7);
  assert.equal(precise.numeric.converged, true);
  assert.ok(Math.abs(ampereLength(loop) - 6.4) < 1e-12);
  const total = ampereSamples(loop, 'xy', 400).reduce((sum, sample) => sum + sample.dl, 0);
  within(total, 6.4, 1e-9);
});

test('wires parallel to the loop plane and distant wires do not link the loop', () => {
  const sources = validateCurrentSources([
    { id: 'P', type: 'wire', current: 10, position: [0, 0, 1], direction: [1, 0, 0] }, // above the plane, parallel to it
    wire('Q', 10, 4, 0),
  ]);
  const measure = ampereMeasure(sources, circle(0, 0, 1), 'xy', { precise: true });
  assert.equal(measure.enclosure.status, 'ok');
  assert.equal(measure.enclosure.enclosedCurrent, 0);
  assert.ok(Math.abs(measure.numeric.circulation) < 1e-9);
});

test('a current loop links the path once (its wire pierces the disk once) and not at all when it lies wholly inside', () => {
  // loop in the xz plane (normal y) centred on the origin, radius 0.5: it crosses the xy plane at x = +-0.5
  const make = x => ({ id: 'L', type: 'loop', current: 5, position: [x, 0, 0], radius: 0.5, normal: [0, 1, 0] });
  const linked = ampereMeasure(validateCurrentSources([make(0.7)]), circle(0, 0, 0.45), 'xy', { precise: true });
  // crossing points at x = 0.2 and 1.2: only the first is inside r = 0.45
  assert.equal(linked.enclosure.status, 'ok');
  assert.equal(Math.abs(linked.enclosure.enclosedCurrent), 5);
  within(linked.numeric.circulation, linked.enclosure.enclosedCurrent, 1e-4);
  const inside = ampereMeasure(validateCurrentSources([make(0)]), circle(0, 0, 1), 'xy', { precise: true });
  assert.equal(inside.enclosure.enclosedCurrent, 0);
  assert.ok(Math.abs(inside.numeric.circulation) < 1e-6);
  assert.deepEqual(inside.enclosure.enclosedIds, []);
});

test('crossings: sheets, in-plane wires and finite segments are unsupported; a wire on the path is excluded', () => {
  const sheet = { id: 'K', type: 'sheet', K: 20, position: [0.3, 0, 0], normal: [1, 0, 0], direction: [0, 0, 1] };
  assert.equal(ampereEnclosure(validateCurrentSources([sheet]), circle(0, 0, 1), 'xy').status, 'unsupported');
  assert.deepEqual(ampereEnclosure(validateCurrentSources([sheet]), circle(0, 0, 1), 'xy').crossingIds, ['K']);
  const far = ampereEnclosure(validateCurrentSources([{ ...sheet, position: [3, 0, 0] }]), circle(0, 0, 1), 'xy');
  assert.equal(far.status, 'ok');
  assert.deepEqual(far.outsideIds, ['K']);
  const inPlane = { id: 'I', type: 'wire', current: 5, position: [0, 0.2, 0], direction: [1, 0, 0] };
  assert.equal(ampereEnclosure(validateCurrentSources([inPlane]), circle(0, 0, 1), 'xy').status, 'unsupported');
  const segment = { id: 'S', type: 'segment', current: 5, start: [3, 0, 0], end: [4, 0, 0] };
  const open = ampereEnclosure(validateCurrentSources([segment]), circle(0, 0, 1), 'xy');
  assert.equal(open.status, 'unsupported');
  assert.match(open.reason, /닫힌/);
  const onPath = ampereEnclosure(validateCurrentSources([wire('W', 10, 1, 0)]), circle(0, 0, 1), 'xy');
  assert.equal(onPath.status, 'excluded');
  const measure = ampereMeasure(validateCurrentSources([sheet]), circle(0, 0, 1), 'xy');
  assert.equal(measure.numeric, null);
});

test('two sheets (K, -K): a loop between them has no enclosed current and zero circulation (H is uniform)', () => {
  const sheets = validateCurrentSources([
    { id: 'U', type: 'sheet', K: 20, position: [0, 0.3, 0], normal: [0, 1, 0], direction: [0, 0, 1] },
    { id: 'D', type: 'sheet', K: -20, position: [0, -0.3, 0], normal: [0, 1, 0], direction: [0, 0, 1] },
  ]);
  const measure = ampereMeasure(sheets, circle(0, 0, 0.2), 'xy', { precise: true });
  assert.equal(measure.enclosure.status, 'ok');
  assert.ok(Math.abs(measure.numeric.circulation) < 1e-9);
  within(measure.numeric.maxH, 20, 1e-9); // H between the sheets = K
});

test('the converged circulation is the loopCirculation pass for a circle (coarse and precise agree to 1%)', () => {
  const sources = validateCurrentSources([wire('W', 10, 0.1, 0)]);
  const evaluate = createCurrentEvaluator(sources);
  const loop = circle(0, 0, 0.9);
  const coarse = ampereCoarse(evaluate, loop, 'xy'), precise = amperePrecise(evaluate, loop, 'xy');
  within(coarse.circulation, precise.circulation, 0.01);
  assert.equal(precise.samples, 256);
});

test('clampAmpere keeps the loop inside the supported size and the +-20 m range', () => {
  const clamped = clampAmpere({ shape: 'circle', center: [30, -30, 0], radius: 50, halfWidth: 0, halfHeight: 9 });
  assert.equal(clamped.radius, 5);
  assert.equal(clamped.halfWidth, 0.05);
  assert.equal(clamped.halfHeight, 5);
  assert.deepEqual(clamped.center, [15, -15, 0]);
  assert.equal(clamped.orientation, 1);
});

test('the readout reports I_enc, agreement, the symmetry hint, unsupported and excluded states', () => {
  const sources = validateCurrentSources([wire('W', 10, 0, 0)]);
  const measure = ampereMeasure(sources, circle(0.5, 0, 1), 'xy', { precise: true });
  const readout = ampereReadout({ enclosure: measure.enclosure, sources, numeric: measure.numeric, precise: true, symmetric: 10 / (2 * Math.PI) });
  assert.equal(readout.status, 'ok');
  assert.equal(readout.agrees, true);
  assert.equal(readout.stateText, '암페어 법칙과 일치');
  assert.match(readout.lines[0], /^I내부 = ∮H·dl = \+10 A  \(W, 반시계 경로\)$/);
  assert.match(readout.lines[1], /^수치 ∮H·dl = \+10 A  \(정밀 · 수렴\) · ∮B·dl = μ₀I내부/);
  assert.match(readout.lines[2], /^\|H\| 경로 위: 최대 .* · 최소 /);
  assert.equal(readout.lines.slice(0, 3).filter(line => /∮H·dl = I내부/.test(line)).length, 0, 'the law is not stated twice');
  assert.ok(readout.lines.some(line => /∮B·dl = μ₀I내부 = 1\.257e-5 T·m/.test(line)));
  assert.ok(readout.lines.some(line => /H가 일정하지 않아도/.test(line)));
  assert.equal(readout.compact, '∮H·dl = +10 A');
  const sheet = { id: 'K', type: 'sheet', K: 20, position: [0.3, 0, 0], normal: [1, 0, 0], direction: [0, 0, 1] };
  const blocked = ampereReadout({ enclosure: ampereEnclosure(validateCurrentSources([sheet]), circle(0, 0, 1), 'xy') });
  assert.equal(blocked.status, 'unsupported');
  assert.equal(blocked.stateText, '미지원');
  const onWire = ampereReadout({ enclosure: ampereEnclosure(sources, circle(1, 0, 1), 'xy') });
  assert.equal(onWire.status, 'excluded');
  const none = ampereMeasure(validateCurrentSources([wire('W', 10, 4, 0)]), circle(0, 0, 1), 'xy');
  const zero = ampereReadout({ enclosure: none.enclosure, numeric: none.numeric });
  assert.ok(zero.lines.some(line => /내부 전류가 없으면/.test(line)));
});

// ---- the size slider: one measure for value and label, no jump between shapes -----------------------------------------------------
test('the size slider keeps a rectangle\'s aspect ratio and reads the same measure the label shows', () => {
  const loop = rect(0, 0, 1, 0.5);
  const bigger = resizeAmpere(loop, 2);
  assert.equal(bigger.halfWidth, 2);
  assert.equal(bigger.halfHeight, 1);
  assert.equal(ampereSize(bigger), 2);
  assert.match(ampereSizeText(bigger), /^반폭 a = 2 m \(4 × 2 m\)$/);
  assert.equal(resizeAmpere(circle(0, 0, 1), 0.6).radius, 0.6);
  assert.equal(ampereSizeText(circle(0, 0, 0.8)), 'r = 0.8 m');
});

test('switching circle <-> rectangle keeps the slider value and the rectangle\'s own aspect ratio', () => {
  const asCircle = { ...circle(0, 0, 0.8), halfWidth: 1, halfHeight: 0.5 };
  const asRect = switchAmpereShape(asCircle, 'rect');
  assert.equal(asRect.shape, 'rect');
  assert.equal(ampereSize(asRect), ampereSize(asCircle));
  assert.equal(asRect.halfHeight / asRect.halfWidth, 0.5);
  const back = switchAmpereShape(asRect, 'circle');
  assert.equal(back.shape, 'circle');
  assert.equal(ampereSize(back), ampereSize(asRect));
  assert.equal(switchAmpereShape(back, 'circle').radius, back.radius);
});
