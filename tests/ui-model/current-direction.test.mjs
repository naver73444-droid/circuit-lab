import test from "node:test";
import assert from "node:assert/strict";
import {
  actualCurrentDirection, actualCurrentText, currentArrowGeometry, currentDirectionDescriptor, currentDirectionGuide, currentProbeLabel,
  currentReferenceSign, isCurrentReferenceFlipped, referenceDirection, sanitizeCurrentReferences, signedCurrent, toggleCurrentReference,
} from "../../src/current-direction.js";
import { componentDefaults, simulate, simulateACAtFrequency } from "../../src/circuit-engine.js";
import { pinPosition } from "../../src/circuit-geometry.js";
import { componentReadout } from "../../src/node-readout-model.js";
import { deserializeProject, serializeProject } from "../../src/project-format.js";
import { cloneExample } from "../../src/examples.js";
import { scaleComplex } from "../../src/ac-basis.js";

const component = (type, extra = {}) => ({ id: 'X1', type, x: 100, y: 200, rotation: 0, props: { ref: 'X1' }, ...extra });
const near = (actual, expected, tolerance, message = "") => assert.ok(Math.abs(actual - expected) <= tolerance, `${message} ${actual} vs ${expected} (±${tolerance})`);
const polar = (z) => [Math.hypot(z.re, z.im), (Math.atan2(z.im, z.re) * 180) / Math.PI];

test('ordinary two-pin current: engine reference pin 1 to pin 2, labelled as the reference', () => {
  const direction = currentDirectionDescriptor(component('R'));
  assert.equal(direction.label, '1→2');
  assert.deepEqual(direction.from, { x: -40, y: 0 });
  assert.deepEqual(direction.to, { x: 40, y: 0 });
  assert.equal(currentProbeLabel(component('R')), 'I(X1, 기준 1→2)');
});

test('controlled outputs and sensors keep their p to n contract', () => {
  for (const type of ['VCVS', 'VCCS', 'CURRENT_SENSOR', 'CCCS', 'CCVS']) {
    const direction = currentDirectionDescriptor(component(type));
    assert.equal(direction.label, 'p→n');
    assert.equal(direction.fromPin, 0);
    assert.equal(direction.toPin, 1);
    assert.equal(currentProbeLabel(component(type)), 'I(X1, 기준 p→n)');
  }
});

test('op amps point from output toward the internal reference, never between inputs', () => {
  const finite = currentDirectionDescriptor(component('OPAMP'));
  const ideal = currentDirectionDescriptor(component('OPAMP_IDEAL'));
  assert.equal(finite.fromPin, 2);
  assert.equal(finite.toPin, null);
  assert.equal(finite.label, '출력→기준');
  assert.equal(ideal.label, '출력→내부 기준 GND');
  assert.ok(finite.from.x > finite.to.x);
  assert.equal(actualCurrentDirection(component('OPAMP'), -1e-3).label, '기준→출력');
});

test('real direction: a positive solver current keeps the reference, a negative one reverses it; the magnitude is never negative', () => {
  const r = component('R');
  assert.equal(actualCurrentText(r, 2.91), '2.91 A (1→2)');
  assert.equal(actualCurrentText(r, -2.91), '2.91 A (2→1)');
  const reversed = actualCurrentDirection(r, -2.91);
  assert.equal(reversed.magnitude, 2.91);
  assert.deepEqual([reversed.direction.fromPin, reversed.direction.toPin], [1, 0]);
  const forward = currentArrowGeometry(actualCurrentDirection(r, 2.91).direction);
  const backward = currentArrowGeometry(reversed.direction);
  assert.ok(forward.end.x > forward.start.x && backward.end.x < backward.start.x, 'the reversed arrow points toward pin 1');
  near(forward.start.y, backward.start.y, 1e-12, 'both arrows stay on the same side of the part');
  const magnetic = component('COUPLED_L');
  assert.equal(actualCurrentText(magnetic, -0.5, { winding: 2 }), '500 mA (2b→2a)');
  assert.equal(actualCurrentText(component('VCCS'), -1e-3), '1 mA (n→p)');
});

test('near zero: no direction, "0 A"; the band follows the largest current of the sample', () => {
  const r = component('R');
  assert.equal(actualCurrentText(r, 0), '0 A');
  assert.equal(actualCurrentText(r, -1e-17), '0 A');
  assert.equal(actualCurrentText(r, 3e-13, { scale: 1 }), '0 A', 'solver noise next to a 1 A current');
  assert.equal(actualCurrentText(r, -1e-9, { scale: 1 }), '1 nA (2→1)');
  const zero = actualCurrentDirection(r, -1e-17);
  assert.equal(zero.zero, true);
  assert.equal(zero.direction, null);
  assert.equal(zero.label, '');
  assert.equal(actualCurrentDirection(r, Number.NaN), null);
});

/** V1 (10 V) → R1 → GND, with R1 at the given rotation and pin order. */
function divider(rotation, reversed) {
  const parts = [
    { id: 'V1', type: 'V', x: 0, y: 200, rotation: 90, props: { ...componentDefaults('V', 1), mode: 'DC', dc: '10', ref: 'V1' } },
    { id: 'R1', type: 'R', x: 200, y: 100, rotation, props: { ...componentDefaults('R', 1), value: '2k', ref: 'R1' } },
    { id: 'G1', type: 'GND', x: 100, y: 400, rotation: 0, props: { ref: 'GND' } },
  ];
  const high = reversed ? 1 : 0, low = reversed ? 0 : 1;
  const wires = [
    { id: 'W1', a: { componentId: 'V1', pin: 0 }, b: { componentId: 'R1', pin: high } },
    { id: 'W2', a: { componentId: 'R1', pin: low }, b: { componentId: 'G1', pin: 0 } },
    { id: 'W3', a: { componentId: 'V1', pin: 1 }, b: { componentId: 'G1', pin: 0 } },
  ];
  return { version: 1, geometryVersion: 2, components: parts, wires };
}

test('rotated or reversed parts: the same current reads the same magnitude and an arrow toward the low-potential pin', () => {
  let magnitude = null;
  for (const rotation of [0, 90, 180, 270]) for (const reversed of [false, true]) {
    const circuit = divider(rotation, reversed);
    const result = simulate(circuit, { analysis: 'dc' });
    const readout = componentReadout({ circuit, result, componentId: 'R1' });
    const voltageOf = (pin) => result.points[0].nodeVoltages[result.topology.nodeIdByPin[`R1:${pin}`]];
    const [hi, lo] = voltageOf(0) > voltageOf(1) ? [0, 1] : [1, 0];
    assert.equal(hi, reversed ? 1 : 0, 'the source side is the high pin');
    magnitude ??= readout.current.value;
    near(readout.current.value, magnitude, 1e-15, `|I| at ${rotation}° ${reversed ? 'reversed' : 'forward'}`);
    assert.ok(readout.current.value > 0);
    assert.equal(readout.current.direction, `${hi + 1}→${lo + 1}`);
    assert.match(readout.text, new RegExp(`전류 5 mA \\(${hi + 1}→${lo + 1}\\)`));
    // The arrow tip (in canvas coordinates) sits at the pin the current leaves through.
    const part = circuit.components[1];
    const actual = actualCurrentDirection(part, readout.current.signed, { geometryVersion: 2 });
    const arrow = currentArrowGeometry(actual.direction);
    const angle = (rotation * Math.PI) / 180;
    const toCanvas = (point) => ({ x: part.x + point.x * Math.cos(angle) - point.y * Math.sin(angle), y: part.y + point.x * Math.sin(angle) + point.y * Math.cos(angle) });
    const tip = toCanvas(arrow.end), tail = toCanvas(arrow.start);
    const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const loPin = pinPosition(part, lo, 2), hiPin = pinPosition(part, hi, 2);
    assert.ok(distance(tip, loPin) < distance(tip, hiPin) && distance(tail, hiPin) < distance(tail, loPin), `arrow ${rotation}° ${reversed}`);
  }
});

test('transient instantaneous values are magnitudes with the direction of that sample', () => {
  const example = cloneExample('rc-charge');
  const result = simulate(example.circuit, example.settings);
  for (const index of [1, Math.floor(result.points.length / 2), result.points.length - 1]) {
    const readout = componentReadout({ circuit: example.circuit, result, componentId: 'C1', index });
    const raw = result.points[index].componentCurrents.C1;
    near(readout.current.value, Math.abs(raw), 1e-18);
    assert.ok(readout.current.value >= 0);
    if (readout.current.actual) assert.equal(readout.current.actual, raw > 0 ? '1→2' : '2→1');
  }
});

test('reference flip: toggles a display-only field, the shown value is ×(−1), the label and arrow follow', () => {
  const r = component('R');
  assert.equal(currentReferenceSign(r), 1);
  assert.equal(toggleCurrentReference(r), true);
  assert.equal(r.flipCurrent, true);
  assert.equal(currentReferenceSign(r), -1);
  assert.equal(referenceDirection(r).label, '2→1');
  assert.equal(currentProbeLabel(r), 'I(X1, 기준 2→1)');
  assert.deepEqual(signedCurrent({ re: 1, im: -2 }, -1), { re: -1, im: 2 });
  assert.equal(signedCurrent(3, -1), -3);
  const arrow = currentArrowGeometry(referenceDirection(r));
  assert.ok(arrow.end.x < arrow.start.x, 'the flipped reference arrow points toward pin 1');
  // DC/instantaneous text ignores the flip: it always names the real direction
  assert.equal(actualCurrentText(r, 2), '2 A (1→2)');
  assert.equal(toggleCurrentReference(r), false);
  assert.equal(Object.hasOwn(r, 'flipCurrent'), false, 'an unflipped part carries no field');
  // winding 2 exists only on magnetic parts; GND never flips
  assert.equal(toggleCurrentReference(r, 2), false);
  assert.equal(toggleCurrentReference(component('GND')), false);
  const k = component('COUPLED_L');
  toggleCurrentReference(k, 2);
  assert.deepEqual([isCurrentReferenceFlipped(k, 1), isCurrentReferenceFlipped(k, 2)], [false, true]);
  assert.equal(referenceDirection(k, 2, 2).label, '2b→2a');
});

test('AC hover readout: the phasor and the "기준" label follow the flipped reference', () => {
  const example = cloneExample('rc-lowpass');
  const result = simulateACAtFrequency(example.circuit, 1000);
  const plain = componentReadout({ circuit: example.circuit, result, componentId: 'R1' });
  const r1 = example.circuit.components.find((item) => item.id === 'R1');
  toggleCurrentReference(r1);
  const flipped = componentReadout({ circuit: example.circuit, result, componentId: 'R1' });
  assert.equal(plain.current.direction, '기준 1→2');
  assert.equal(flipped.current.direction, '기준 2→1');
  near(flipped.current.value, plain.current.value, 1e-15);
  near(flipped.current.phasor.re, -plain.current.phasor.re, 1e-15);
  near(flipped.current.phasor.im, -plain.current.phasor.im, 1e-15);
  near(flipped.power.value, plain.power.value, 1e-15, 'power does not depend on the shown reference');
});

test('project file: flip fields round-trip as optional fields, the version stays and invalid flags are dropped', () => {
  const circuit = divider(0, false);
  circuit.components[1].flipCurrent = true;
  const text = serializeProject({ title: 't', subtitle: '', circuit, settings: { analysis: 'dc' }, probes: [] });
  const saved = JSON.parse(text);
  assert.equal(saved.version, 1, 'no version bump');
  assert.equal(saved.circuit.components[1].flipCurrent, true);
  const opened = deserializeProject(text);
  assert.equal(opened.circuit.components.find((item) => item.id === 'R1').flipCurrent, true);
  assert.equal(currentProbeLabel(opened.circuit.components[1]), 'I(R1, 기준 2→1)');
  // an older file without the field opens unflipped
  const old = deserializeProject(serializeProject({ title: 't', subtitle: '', circuit: divider(0, false), settings: { analysis: 'dc' }, probes: [] }));
  assert.equal(old.circuit.components.some((item) => Object.hasOwn(item, 'flipCurrent')), false);
  // junk values and fields on parts that cannot carry them are dropped, not trusted
  const junk = divider(0, false);
  junk.components[0].flipCurrent = 'yes';
  junk.components[1].flipCurrent2 = true;
  junk.components[2].flipCurrent = true;
  const cleaned = deserializeProject(serializeProject({ title: 't', subtitle: '', circuit: junk, settings: { analysis: 'dc' }, probes: [] }));
  assert.deepEqual(cleaned.circuit.components.map((item) => [Object.hasOwn(item, 'flipCurrent'), Object.hasOwn(item, 'flipCurrent2')]), [[false, false], [false, false], [false, false]]);
  // the magnetic winding-2 flag survives on a magnetic part (version 4 file)
  const coils = cloneExample('coupled-coils');
  const reopened = deserializeProject(serializeProject({ title: 'c', subtitle: '', circuit: coils.circuit, settings: coils.settings, probes: [] }));
  assert.equal(reopened.circuit.components.find((item) => item.id === 'K1').flipCurrent2, true);
  assert.deepEqual(sanitizeCurrentReferences([{ type: 'R', flipCurrent: false }]), [{ type: 'R' }]);
});

test('example 13.1: the secondary reference points out of the dot, so I(K1.2) shows the textbook I2 = 2.91∠14.04° A rms', () => {
  const example = cloneExample('coupled-coils');
  const k1 = example.circuit.components.find((item) => item.id === 'K1');
  assert.deepEqual([isCurrentReferenceFlipped(k1, 1), isCurrentReferenceFlipped(k1, 2)], [false, true]);
  assert.equal(currentProbeLabel(k1, 2, 2), 'I(K1.2, 기준 2b→2a)');
  const result = simulateACAtFrequency(example.circuit, example.settings.phasorFrequency);
  const shown = signedCurrent(result.points[0].componentCurrents['K1#2'], currentReferenceSign(k1, 2));
  const [magnitude, phase] = polar(scaleComplex(shown, 'rms'));
  near(magnitude, 2.91, 1e-3, '|I2| rms');
  near(phase, 14.04, 5e-3, '∠I2');
  const readout = componentReadout({ circuit: example.circuit, result, componentId: 'K1', acBasis: 'rms' });
  near(readout.current2.value, 2.91, 1e-3);
  near(readout.current2.phasor.phaseDeg, 14.04, 5e-3);
  assert.equal(readout.current2.direction, '기준 2b→2a');
  assert.match(readout.text, /2차 전류 2\.91 A \(rms\) ∠ 14\.0\d*° \(기준 2b→2a\)/);
  near(readout.current.phasor.phaseDeg, -49.39, 2e-2, 'I1 keeps its reference');
});

test('example 13.8: the 2a→2b reference already matches the textbook I2 = −5.545∠33.69° A rms', () => {
  const example = cloneExample('ideal-transformer');
  const t1 = example.circuit.components.find((item) => item.id === 'T1');
  assert.equal(isCurrentReferenceFlipped(t1, 2), false);
  const result = simulateACAtFrequency(example.circuit, example.settings.phasorFrequency);
  const shown = scaleComplex(signedCurrent(result.points[0].componentCurrents['T1#2'], currentReferenceSign(t1, 2)), 'rms');
  const textbook = { re: -5.545 * Math.cos((33.69 * Math.PI) / 180), im: -5.545 * Math.sin((33.69 * Math.PI) / 180) };
  near(shown.re, textbook.re, 2e-3, 'Re I2');
  near(shown.im, textbook.im, 2e-3, 'Im I2');
});

test('legend text per analysis', () => {
  assert.match(currentDirectionGuide('dc'), /실제로 흐르는 방향/);
  assert.match(currentDirectionGuide('dc'), /방향 없음/);
  assert.match(currentDirectionGuide('transient'), /기준 방향 부호/);
  assert.match(currentDirectionGuide('ac'), /기준 방향/);
  assert.match(currentDirectionGuide('ac'), /뒤집기/);
});
