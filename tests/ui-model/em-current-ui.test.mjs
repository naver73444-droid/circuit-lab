import test from 'node:test';
import assert from 'node:assert/strict';
import { createCurrentEditor, DEFAULT_CURRENTS } from '../../src/em-current-state.js';
import { createPointChargeEditor } from '../../src/em-playground-state.js';
import { createCurrentMode, createSandboxMode } from '../../src/em-plane-modes.js';
import {
  actionPatch, freeCurrentSpot, inspectorFields, newSource, nudgePatch, patchFromField, senseText, sliderFromStrength, sourceActions,
  strengthFromSlider, strengthText,
} from '../../src/em-current-edit.js';
import { createPlaneView, handlesOf, hitAmpere, hitSource } from '../../src/em-plane-geometry.js';
import { sensorReadout } from '../../src/em-readout.js';
import { computePlaneLines } from '../../src/em-plane-field.js';
import { sampleScalarGrid } from '../../src/em-plane-field.js';
import { validateCurrentSources } from '../../src/em-current-field.js';
import { MU0 } from '../../src/em-physics.js';

const view = createPlaneView({ width: 800, height: 600, span: 3 });

test('the current editor starts with one wire, adds, edits, drags and undoes like the charge editor', () => {
  const editor = createCurrentEditor(), state = editor.state;
  assert.deepEqual(state.sources.map(source => source.id), ['I1']);
  assert.equal(state.selectedId, 'I1');
  const spot = freeCurrentSpot(state.sources, 'xy', 0, [0, 1, 0]);
  const id = editor.add(newSource('in', 'xy', spot));
  assert.equal(id, 'W1');
  assert.equal(state.sources[1].current, -10);
  assert.deepEqual(state.sources[1].direction, [0, 0, 1]);
  assert.equal(editor.updateSource(id, patchFromField(state.sources[1], 'xy', 'strength', 25)), true);
  editor.endEdit();
  assert.equal(state.sources[1].current, 25);
  // an invalid edit keeps the old value and reports the reason
  assert.equal(editor.updateSource(id, { current: 500 }), false);
  assert.match(state.error, /±100 A/);
  assert.equal(state.sources[1].current, 25);
  // drag: one undo step
  const before = JSON.stringify(state.sources);
  assert.equal(editor.beginDrag(id, 'xy', 'body', state.sources[1].position), true);
  editor.previewDrag([1, 1, 0]);
  assert.deepEqual(state.sources[1].position, [1, 1, 0]);
  editor.cancelDrag();
  assert.equal(JSON.stringify(state.sources), before);
  editor.beginDrag(id, 'xy', 'body', state.sources[1].position);
  assert.equal(editor.commitDrag([2, 0.5, 0]), true);
  assert.deepEqual(state.sources[1].position, [2, 0.5, 0]);
  editor.undo(); // the drag
  editor.undo(); // the strength edit
  assert.equal(state.sources[1].current, -10);
  editor.undo(); // the add
  assert.equal(state.sources.length, 1);
  editor.redo();
  assert.equal(state.sources.length, 2);
});

test('loop radius, sheet rotation and segment end handles drag through the same contract', () => {
  const editor = createCurrentEditor({ sources: [] }), state = editor.state;
  const loop = editor.add(newSource('loop', 'xy', [0, 0, 0]));
  const [, radiusHandle] = handlesOf(state.sources[0], 'xy');
  assert.equal(radiusHandle.handle, 'radius');
  assert.deepEqual(radiusHandle.position.map(value => Number(value.toFixed(9))), [0, -0.5, 0]); // the loop is edge-on along y; the handle is on the x-hat cross z-hat side
  editor.beginDrag(loop, 'xy', 'radius', radiusHandle.position);
  editor.previewDrag([0, -1.25, 0]);
  editor.commitDrag();
  assert.equal(state.sources[0].radius, 1.25);
  const sheet = editor.add(newSource('sheet', 'xy', [0, 0.5, 0]));
  const rotate = handlesOf(state.sources[1], 'xy').find(item => item.handle === 'rotate');
  editor.beginDrag(sheet, 'xy', 'rotate', rotate.position);
  editor.previewDrag([0, 1.5, 0]); // rotate the sheet line to point along +y
  editor.commitDrag();
  const rotated = state.sources[1];
  assert.ok(Math.abs(rotated.normal[0]) > 0.99, 'the line turned, so its normal is along x');
  assert.deepEqual(rotated.direction, [0, 0, 1], 'K stays out of the screen');
  const segment = editor.add(newSource('segment', 'xy', [0, -1, 0]));
  editor.beginDrag(segment, 'xy', 'end', state.sources[2].end);
  editor.previewDrag([2, -1, 0]);
  editor.commitDrag();
  assert.deepEqual(state.sources[2].end, [2, -1, 0]);
});

test('picking: a wire body, the loop radius handle and the sheet rotate handle', () => {
  const sources = validateCurrentSources([
    { id: 'W', type: 'wire', current: 10, position: [-1, 0, 0], direction: [0, 0, 1] },
    { id: 'L', type: 'loop', current: 5, position: [1, 0, 0], radius: 0.5, normal: [1, 0, 0] },
    { id: 'S', type: 'sheet', K: 20, position: [0, -2, 0], normal: [0, 1, 0], direction: [0, 0, 1] },
  ]);
  assert.equal(hitSource(sources, view, 'xy', 300, 300).source.id, 'W');
  assert.equal(hitSource(sources, view, 'xy', 500, 350).handle, 'radius');
  assert.equal(hitSource(sources, view, 'xy', 400 - 80, 500).handle, 'rotate');
  assert.equal(hitSource(sources, view, 'xy', 100, 100), null);
});

test('hitAmpere: circle ring / inside / outside and the rectangle sides and corner', () => {
  const circle = { shape: 'circle', center: [0, 0, 0], radius: 1 };
  assert.equal(hitAmpere(view, 'xy', circle, 500, 300), 'edge');
  assert.equal(hitAmpere(view, 'xy', circle, 400, 300), 'inside');
  assert.equal(hitAmpere(view, 'xy', circle, 700, 300), null);
  const rect = { shape: 'rect', center: [0, 0, 0], halfWidth: 1, halfHeight: 0.5 };
  assert.equal(hitAmpere(view, 'xy', rect, 500, 300), 'edge-x');
  assert.equal(hitAmpere(view, 'xy', rect, 400, 250), 'edge-y');
  assert.equal(hitAmpere(view, 'xy', rect, 500, 250), 'corner');
  assert.equal(hitAmpere(view, 'xy', rect, 420, 290), 'inside');
});

test('inspector model: fields per type, patches, actions, sliders and texts', () => {
  const [wire, loop, sheet, segment] = validateCurrentSources([
    { id: 'W', type: 'wire', current: -10, position: [1, 2, 0], direction: [0, 0, 1] },
    { id: 'L', type: 'loop', current: 5, position: [0, 0, 0], radius: 0.5, normal: [1, 0, 0] },
    { id: 'S', type: 'sheet', K: 20, position: [0, 1, 0], normal: [0, 1, 0], direction: [0, 0, 1] },
    { id: 'G', type: 'segment', current: 5, start: [0, 0, 0], end: [1, 0, 0] },
  ]);
  assert.deepEqual(inspectorFields(wire, 'xy').map(field => field.id), ['strength', 'pa', 'pb']);
  assert.deepEqual(inspectorFields(loop, 'xy').map(field => field.id), ['strength', 'pa', 'pb', 'radius', 'angle']);
  assert.deepEqual(inspectorFields(sheet, 'xy').map(field => field.id), ['strength', 'pa', 'pb', 'angle']);
  assert.deepEqual(inspectorFields(segment, 'xy').map(field => field.id), ['strength', 'sa', 'sb', 'ea', 'eb']);
  assert.equal(inspectorFields(wire, 'xy')[0].unit, 'A');
  assert.equal(inspectorFields(sheet, 'xy')[0].unit, 'A/m');
  assert.deepEqual(patchFromField(wire, 'xy', 'pa', 3), { position: [3, 2, 0] });
  assert.deepEqual(patchFromField(wire, 'xz', 'pb', 4), { position: [1, 2, 4] });
  assert.deepEqual(patchFromField(sheet, 'xy', 'strength', 40), { K: 40 });
  assert.equal(patchFromField(loop, 'xy', 'radius', 99).radius, 5);
  assert.equal(patchFromField(wire, 'xy', 'pa', NaN), null);
  const turned = patchFromField(loop, 'xy', 'angle', 90).normal;
  assert.ok(Math.abs(turned[1] - 1) < 1e-12);
  // actions toggle the loop between edge-on and face-on, the sheet K between out-of-screen and along the sheet
  assert.equal(sourceActions(loop, 'xy')[0].id, 'toggle-axis');
  assert.deepEqual(actionPatch(loop, 'xy', 'toggle-axis'), { normal: [0, 0, 1] });
  assert.deepEqual(actionPatch({ ...loop, normal: [0, 0, 1] }, 'xy', 'toggle-axis'), { normal: [1, 0, 0] });
  const along = actionPatch(sheet, 'xy', 'toggle-k');
  assert.ok(Math.abs(Math.abs(along.direction[0]) - 1) < 1e-12);
  assert.deepEqual(nudgePatch(wire, 'xy', 0.5, -0.5), { position: [1.5, 1.5, 0] });
  assert.deepEqual(nudgePatch(segment, 'xy', 1, 0), { start: [1, 0, 0], end: [2, 0, 0] });
  // slider: notch, log scale and the round trip
  assert.equal(strengthFromSlider(0, wire), 0);
  assert.equal(strengthFromSlider(1, wire), 100);
  assert.equal(strengthFromSlider(-1, sheet), -1000);
  for (const value of [0.2, 1, 10, 50]) assert.ok(Math.abs(strengthFromSlider(sliderFromStrength(value, wire), wire) / value - 1) < 0.02);
  assert.equal(strengthText(wire), '−10 A');
  assert.equal(strengthText(sheet), '+20 A/m');
  assert.match(senseText(wire, 'xy'), /⊗ 화면 안/);
  assert.match(senseText({ ...wire, current: 10 }, 'xy'), /⊙ 화면 밖/);
  assert.match(senseText(wire, 'xz'), /화면 안에서 흐름/); // a wire along z lies in the xz view
});

test('modes: charge sources and current sources live side by side; the sensor and plane are shared', () => {
  const charges = createPointChargeEditor(), currents = createCurrentEditor();
  const sandbox = createSandboxMode(charges), magnetic = createCurrentMode(currents, charges);
  assert.equal(magnetic.kind, 'current');
  assert.equal(sandbox.sources().length, 2);
  assert.equal(magnetic.sources().length, DEFAULT_CURRENTS.length);
  magnetic.setPlane('xz');
  assert.equal(sandbox.plane(), 'xz');
  assert.equal(magnetic.moveSensor([0.5, 0, 0.5]), true);
  assert.deepEqual(sandbox.sensor(), [0.5, 0, 0.5]);
  assert.equal(sandbox.sources().length, 2, 'switching modes never touches the other set');
  const key = magnetic.fieldKey();
  currents.add(newSource('out', 'xz', [1, 0, 1]));
  assert.notEqual(magnetic.fieldKey(), key);
  assert.equal(sandbox.field().kind, 'sandbox');
  assert.equal(magnetic.field().kind, 'current');
});

test('sensor readout shows B (T = Wb/m²) or H (A/m) with the other as an extra row', () => {
  const sources = validateCurrentSources([{ id: 'W', type: 'wire', current: 10, position: [0, 0, 0], direction: [0, 0, 1] }]);
  const mode = createCurrentMode(createCurrentEditor({ sources }), createPointChargeEditor()), field = mode.field();
  const result = field.evaluate([0.5, 0, 0]);
  const asB = sensorReadout(field, result, 'xy'), asH = sensorReadout(field, result, 'xy', { showH: true });
  assert.equal(asB.compact, 'B = 4 µT ∠ 90°');
  assert.equal(asH.compact, `H = ${(10 / (2 * Math.PI * 0.5)).toPrecision(3)} A/m ∠ 90°`);
  assert.deepEqual(asB.rows.map(row => row.label), ['B', '|B|', '|H|']);
  assert.deepEqual(asH.rows.map(row => row.label), ['H', '|H|', '|B|']);
  assert.match(asB.rows[0].title, /Wb\/m²/);
  assert.match(asH.rows[0].title, /μ₀H/);
  assert.equal(MU0 > 0, true);
  // the existing electric readout is unchanged
  const charges = createSandboxMode(createPointChargeEditor()).field();
  assert.equal(sensorReadout(charges, charges.evaluate([0, 1, 0]), 'xy').rows.some(row => row.title), false);
});

test('B field lines of a wire are closed circles and of a loop thread its opening', () => {
  const wire = validateCurrentSources([{ id: 'W', type: 'wire', current: 10, position: [0, 0, 0], direction: [0, 0, 1] }]);
  const mode = createCurrentMode(createCurrentEditor({ sources: wire }), createPointChargeEditor()), field = mode.field();
  const area = { aMin: -3, aMax: 3, bMin: -2, bMax: 2 };
  const lines = computePlaneLines(field, { plane: 'xy', fixed: 0, area, sources: wire, quality: 'final' });
  assert.ok(lines.length >= 6);
  const closed = lines.filter(line => line.end.reason === 'closed');
  assert.ok(closed.length >= 5, 'the rings around a wire close');
  for (const line of closed) {
    const radii = line.points.map(p => Math.hypot(p[0], p[1])), mean = radii.reduce((a, b) => a + b) / radii.length;
    assert.ok(radii.every(r => Math.abs(r - mean) < 0.01 * mean + 1e-9), 'a circle about the wire');
    assert.deepEqual(line.points[0], line.points.at(-1), 'the polyline ends where it began');
    // counter-clockwise for a current out of the screen
    const [p0, p1] = line.points;
    assert.ok(p0[0] * p1[1] - p0[1] * p1[0] > 0);
  }
  const loop = validateCurrentSources([{ id: 'L', type: 'loop', current: 10, position: [0, 0, 0], radius: 0.5, normal: [1, 0, 0] }]);
  const loopField = createCurrentMode(createCurrentEditor({ sources: loop }), createPointChargeEditor()).field();
  const loopLines = computePlaneLines(loopField, { plane: 'xy', fixed: 0, area, sources: loop, quality: 'draft' });
  assert.ok(loopLines.length >= 4);
  assert.ok(loopLines.some(line => line.points.some(p => Math.abs(p[1]) < 0.3 && p[0] > 0.5)), 'lines pass through the opening along the axis');
});

test('the colour-map sample grid of a current field is the magnitude and is NaN only in exclusion zones', () => {
  const sources = validateCurrentSources([{ id: 'W', type: 'wire', current: 10, position: [0, 0, 0], direction: [0, 0, 1] }]);
  const field = createCurrentMode(createCurrentEditor({ sources }), createPointChargeEditor()).field();
  const grid = sampleScalarGrid(field, 'xy', 0, { aMin: -1, aMax: 1, bMin: -1, bMax: 1 }, 5, 5);
  assert.ok(Number.isNaN(grid.values[12]), 'the wire centre');
  assert.ok(Math.abs(grid.values[14] - MU0 * 10 / (2 * Math.PI * 1)) < 1e-12);
});
