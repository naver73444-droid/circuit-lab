import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPlaneView, fitLabel, handlesOf, hitGauss, hitSource, placeSensorLabel, planeAxes, planeNormal, pointOnPlane, scaleBar, sectionRadius, zoomAbout,
} from '../../src/em-plane-geometry.js';
import { cycleSelectionTarget, inspectorFields, patchFromField, sliderFromStrength, strengthFromSlider, strengthText } from '../../src/em-source-edit.js';
import { validatePointSources } from '../../src/em-playground-physics.js';

const view = createPlaneView({ width: 800, height: 600, span: 3 });
const point = (id, q, x, y, z = 0) => ({ id, type: 'point', q, position: [x, y, z], enabled: true, visible: true });

test('the view is equal-aspect, centred on the origin and y is flipped', () => {
  assert.equal(view.scale, 100);
  assert.deepEqual(view.toCanvas(0, 0), [400, 300]);
  assert.deepEqual(view.toCanvas(1, 1), [500, 200]);
  const [a, b] = view.toWorld(500, 200);
  assert.ok(Math.abs(a - 1) < 1e-12 && Math.abs(b - 1) < 1e-12);
  assert.deepEqual(view.area, { aMin: -4, aMax: 4, bMin: -3, bMax: 3 });
  assert.deepEqual(planeAxes('xz'), [0, 2]);
  assert.equal(planeNormal('yz'), 0);
});

test('a canvas position maps to a 3D point with the plane normal fixed', () => {
  assert.deepEqual(pointOnPlane(view, 'xy', 0.5, 500, 200), [1, 1, 0.5]);
  assert.deepEqual(pointOnPlane(view, 'xz', 0.5, 500, 200), [1, 0.5, 1]);
  assert.deepEqual(pointOnPlane(view, 'yz', 0.5, 500, 200), [0.5, 1, 1]);
});

test('picking finds the nearest handle and respects the radius and visibility', () => {
  const sources = validatePointSources([
    point('a', 1e-9, -0.75, 0), point('b', -1e-9, 0.75, 0),
    { id: 'l', type: 'finite-line', lambda: 1e-9, start: [-1, 2, 0], end: [1, 2, 0] },
  ]);
  const hit = hitSource(sources, view, 'xy', 478, 301);
  assert.equal(hit.source.id, 'b');
  assert.equal(hit.handle, 'body');
  assert.equal(hitSource(sources, view, 'xy', 400, 300), null);
  assert.equal(hitSource(sources, view, 'xy', 300, 100).handle, 'start');
  assert.equal(hitSource(sources, view, 'xy', 500, 100).handle, 'end');
  assert.equal(hitSource(sources, view, 'xy', 400, 100).handle, 'body');
  sources[1].visible = false;
  assert.equal(hitSource(sources, view, 'xy', 478, 301), null);
});

test('an infinite line exposes a body and a direction handle', () => {
  const [line] = validatePointSources([
    { id: 'i', type: 'infinite-line', lambda: 1e-9, position: [0, 0, 0], direction: [1, 0, 0], sRef: 1, displayLength: 4 },
  ]);
  assert.deepEqual(handlesOf(line).map(h => h.handle), ['body', 'direction']);
  assert.deepEqual(handlesOf(line)[1].position, [2, 0, 0]);
});

test('the Gauss circle distinguishes ring and interior, and the section shrinks off-plane', () => {
  const gauss = { center: [0, 0, 0], radius: 1 };
  assert.equal(hitGauss(view, 'xy', gauss, 0, 500, 300), 'edge');
  assert.equal(hitGauss(view, 'xy', gauss, 0, 400, 300), 'inside');
  assert.equal(hitGauss(view, 'xy', gauss, 0, 700, 300), null);
  assert.equal(sectionRadius([0, 0, 0.6], 1, 'xy', 0), 0.8);
  assert.equal(sectionRadius([0, 0, 2], 1, 'xy', 0), 0);
  assert.equal(hitGauss(view, 'xy', { center: [0, 0, 2], radius: 1 }, 0, 400, 300), null);
});

test('scale bar uses round numbers and zoom keeps the point under the cursor', () => {
  const bar = scaleBar(view);
  assert.ok([1, 2, 5].includes(bar.meters) || bar.meters === 0.5);
  assert.ok(bar.pixels > 60 && bar.pixels < 160);
  const [a0, b0] = view.toWorld(600, 150);
  const zoomed = createPlaneView({ width: 800, height: 600, ...zoomAbout(view, 600, 150, 0.5) });
  const [a1, b1] = zoomed.toWorld(600, 150);
  assert.ok(Math.abs(a0 - a1) < 1e-12 && Math.abs(b0 - b1) < 1e-12);
  assert.equal(zoomAbout(view, 0, 0, 100).span, 12);
  assert.equal(zoomAbout(view, 0, 0, 0.001).span, 0.8);
});

test('charge slider: notch, log scale, round trip and limits', () => {
  assert.equal(strengthFromSlider(0), 0);
  assert.equal(strengthFromSlider(0.02), 0);
  assert.equal(strengthFromSlider(1), 1000);
  assert.equal(strengthFromSlider(-1), -1000);
  assert.equal(strengthFromSlider(0.03 + 0.97 * 0.4), 1);
  for (const nc of [0.05, 0.3, 1, 2.5, 47, 800, -3, -250]) {
    const back = strengthFromSlider(sliderFromStrength(nc));
    assert.ok(Math.abs(back - nc) / Math.abs(nc) < 0.01, `${nc} -> ${back}`);
  }
  assert.equal(sliderFromStrength(0.001), 0);
  assert.equal(sliderFromStrength(1e6), 1);
  assert.equal(strengthText(point('a', -2e-9, 0, 0)), '−2 nC');
  assert.equal(strengthText({ type: 'infinite-line', lambda: 3e-9 }), '+3 nC/m');
});

test('inspector fields follow the viewed plane and convert units on the way back', () => {
  const [q] = validatePointSources([point('a', 2e-9, 1, 0.5, 3)]);
  const fields = inspectorFields(q, 'xz');
  assert.deepEqual(fields.map(f => [f.id, f.label, f.value]), [['strength', 'q', 2], ['pa', 'x', 1], ['pb', 'z', 3]]);
  assert.deepEqual(patchFromField(q, 'xz', 'pb', 4), { position: [1, 0.5, 4] });
  assert.deepEqual(patchFromField(q, 'xy', 'pa', -1), { position: [-1, 0.5, 3] });
  assert.equal(patchFromField(q, 'xy', 'strength', 5).q, 5e-9);
  assert.equal(patchFromField(q, 'xy', 'pa', NaN), null);
  assert.equal(patchFromField(q, 'xy', 'nope', 1), null);
});

test('line inspector: endpoints, infinite-line angle and strength', () => {
  const [finite, infinite] = validatePointSources([
    { id: 'f', type: 'finite-line', lambda: -1e-9, start: [-1, 0, 0], end: [1, 2, 0] },
    { id: 'i', type: 'infinite-line', lambda: 1e-9, position: [0, 1, 0], direction: [0, 1, 0], sRef: 1, displayLength: 4 },
  ]);
  assert.deepEqual(inspectorFields(finite, 'xy').map(f => f.id), ['strength', 'sa', 'sb', 'ea', 'eb']);
  assert.equal(inspectorFields(finite, 'xy')[0].value, -1);
  assert.deepEqual(patchFromField(finite, 'xy', 'eb', 5), { end: [1, 5, 0] });
  const angle = inspectorFields(infinite, 'xy').find(f => f.id === 'angle');
  assert.equal(angle.value, 90);
  const patch = patchFromField(infinite, 'xy', 'angle', 0);
  assert.deepEqual(patch.direction.map(v => Math.round(v * 1e9) / 1e9), [1, 0, 0]);
  assert.deepEqual(patchFromField(infinite, 'xz', 'angle', 90).direction.map(v => Math.round(v * 1e9) / 1e9), [0, 0, 1]);
});

test('keyboard nudging moves every kind of source inside the viewed plane', async () => {
  const { nudgePatch } = await import('../../src/em-source-edit.js');
  const [p, f, i] = validatePointSources([
    point('a', 1e-9, 0, 0, 1),
    { id: 'f', type: 'finite-line', lambda: 1e-9, start: [0, 0, 0], end: [1, 0, 0] },
    { id: 'i', type: 'infinite-line', lambda: 1e-9, position: [0, 0, 0], direction: [1, 0, 0], sRef: 1, displayLength: 4 },
  ]);
  assert.deepEqual(nudgePatch(p, 'xz', 0.5, -0.5), { position: [0.5, 0, 0.5] });
  assert.deepEqual(nudgePatch(f, 'xy', 0, 1), { start: [0, 1, 0], end: [1, 1, 0] });
  assert.deepEqual(nudgePatch(i, 'yz', 2, 3), { position: [0, 2, 3] });
});

test('a new source is placed in a free spot away from sources and the sensor', async () => {
  const { freeSpot } = await import('../../src/em-source-edit.js');
  const sources = validatePointSources([point('a', 1e-9, 0, 0), point('b', -1e-9, 0.9, 0)]);
  const spot = freeSpot(sources, 'xy', 0, [0, 1, 0]);
  for (const other of [[0, 0], [0.9, 0], [0, 1]]) assert.ok(Math.hypot(spot[0] - other[0], spot[1] - other[1]) >= 0.7 - 1e-9);
  assert.equal(spot[2], 0);
  const onXz = freeSpot(sources, 'xz', 0.3, [0, 0.3, 1]);
  assert.equal(onXz[1], 0.3, 'the normal coordinate is kept');
  assert.deepEqual(freeSpot([], 'xy', 0, [5, 5, 0]), [0, 0, 0], 'an empty plane gets its centre');
});

test('a new source keeps clear of an infinite line, not just its reference point', async () => {
  const { freeSpot } = await import('../../src/em-source-edit.js');
  const lines = validatePointSources([
    { id: 'i', type: 'infinite-line', lambda: 1e-9, position: [3, 0, 0], direction: [1, 0, 0], sRef: 1, displayLength: 4 },
  ]);
  const spot = freeSpot(lines, 'xy', 0, [0, 3, 0]);
  assert.ok(Math.abs(spot[1]) >= 0.7 - 1e-9, `kept ${spot[1]} m from the line y=0`);
});

test('a line perpendicular to the view plane: body and direction handles coincide and the body wins the tie (centre click moves it)', () => {
  const sources = validatePointSources([
    { id: 'q1', type: 'infinite-line', lambda: 1e-9, position: [0, 0, 0], direction: [0, 0, 1], sRef: 1, displayLength: 4 },
  ]);
  const handles = handlesOf(sources[0]);
  const [a, b] = [view.toCanvas(handles[0].position[0], handles[0].position[1]), view.toCanvas(handles[1].position[0], handles[1].position[1])];
  assert.deepEqual(a, b, 'both handles project onto one pixel');
  for (const [x, y] of [[400, 300], [405, 297], [390, 310]]) assert.equal(hitSource(sources, view, 'xy', x, y).handle, 'body');
  // the same line seen from the side keeps both handles apart and still reaches the direction handle
  const side = createPlaneView({ width: 800, height: 600, span: 3 });
  assert.equal(hitSource(sources, side, 'xz', 400, 300 - 200).handle, 'direction');
  assert.equal(hitSource(sources, side, 'xz', 400, 300).handle, 'body');
  // a finite line along z also projects its two end points and centre onto one pixel: body again
  const finite = validatePointSources([{ id: 'f', type: 'finite-line', lambda: 1e-9, start: [1, 0, -1], end: [1, 0, 1] }]);
  assert.equal(hitSource(finite, view, 'xy', 500, 300).handle, 'body');
});

test('a tie between sources still prefers the later one (drawn on top)', () => {
  const sources = validatePointSources([point('a', 1e-9, 0, 0), point('b', 1e-9, 0, 0)]);
  assert.equal(hitSource(sources, view, 'xy', 400, 300).source.id, 'b');
});

test('keyboard selection walks the visible sources, wraps for brackets and stops at the ends for Tab', () => {
  const sources = validatePointSources([point('a', 1e-9, 0, 0), point('b', 1e-9, 1, 0), { ...point('c', 1e-9, 2, 0), visible: false }, point('d', 1e-9, 3, 0)]);
  assert.equal(cycleSelectionTarget(sources, null, 1).source.id, 'a');
  assert.equal(cycleSelectionTarget(sources, null, -1).source.id, 'd');
  assert.equal(cycleSelectionTarget(sources, 'b', 1).source.id, 'd', 'hidden sources are skipped');
  assert.deepEqual([cycleSelectionTarget(sources, 'b', 1).index, cycleSelectionTarget(sources, 'b', 1).count], [2, 3]);
  assert.equal(cycleSelectionTarget(sources, 'd', 1).source.id, 'a', 'wraps');
  assert.equal(cycleSelectionTarget(sources, 'a', -1).source.id, 'd');
  assert.equal(cycleSelectionTarget(sources, 'd', 1, false), null, 'Tab past the last source lets the focus leave');
  assert.equal(cycleSelectionTarget(sources, 'a', -1, false), null);
  assert.equal(cycleSelectionTarget([], null, 1), null);
});

test('the sensor readout box stays inside the canvas: it flips at an edge and slides along it when neither side fits', () => {
  const inside = (box, w, h, W, H) => box.x >= 4 && box.y >= 4 && box.x + w <= W - 4 + 1e-9 && box.y + h <= H - 4 + 1e-9;
  const phone = { width: 180, height: 22, viewWidth: 346, viewHeight: 474 };
  // Room on the right and below: the usual spot, down and to the right of the crosshair.
  assert.deepEqual(placeSensorLabel({ ...phone, x: 40, y: 100 }), { x: 56, y: 114, side: 'below' });
  // Right edge: flips to the left of the sensor.
  assert.deepEqual(placeSensorLabel({ ...phone, x: 320, y: 100 }), { x: 124, y: 114, side: 'below' });
  // Upper middle of a phone canvas: neither side has 180 px, so the box slides inside and stays below the crosshair.
  const middle = placeSensorLabel({ ...phone, x: 173, y: 20 });
  assert.ok(inside(middle, 180, 22, 346, 474) && middle.y >= 20 + 14, JSON.stringify(middle));
  // Bottom edge: goes above the sensor.
  assert.equal(placeSensorLabel({ ...phone, x: 40, y: 465 }).side, 'above');
  for (const [x, y] of [[0, 0], [346, 0], [0, 474], [346, 474], [173, 4], [173, 470]]) {
    const box = placeSensorLabel({ ...phone, x, y });
    assert.ok(inside(box, 180, 22, 346, 474), `(${x}, ${y}) -> ${JSON.stringify(box)}`);
  }
});

test('the sensor readout keeps clear of a source label when another spot inside the canvas is free', () => {
  const phone = { width: 120, height: 22, viewWidth: 346, viewHeight: 474 };
  const sourceLabel = { x: 200, y: 100, width: 80, height: 16 };
  assert.deepEqual(placeSensorLabel({ ...phone, x: 180, y: 90 }), { x: 196, y: 104, side: 'below' });
  const moved = placeSensorLabel({ ...phone, x: 180, y: 90, avoid: [sourceLabel] });
  assert.deepEqual(moved, { x: 44, y: 104, side: 'below' }, 'it flips to the free left side');
  // Nowhere free: it still stays inside the canvas.
  const everywhere = { x: 0, y: 0, width: 346, height: 474 };
  assert.deepEqual(placeSensorLabel({ ...phone, x: 180, y: 90, avoid: [everywhere] }), { x: 196, y: 104, side: 'below' });
});

test('under a finger the readout goes above the fingertip, beside it at the top edge and below it when there is no room beside', () => {
  const phone = { width: 120, height: 22, viewWidth: 346, viewHeight: 474, lift: true };
  assert.deepEqual(placeSensorLabel({ ...phone, x: 173, y: 200 }), { x: 113, y: 130, side: 'lift-above' });
  assert.equal(placeSensorLabel({ ...phone, x: 60, y: 30 }).side, 'lift-right');
  assert.equal(placeSensorLabel({ ...phone, x: 300, y: 30 }).side, 'lift-left');
  const wide = placeSensorLabel({ ...phone, width: 300, x: 173, y: 30 });
  assert.equal(wide.side, 'lift-below');
  assert.ok(wide.y >= 30 + 48 && wide.x >= 4 && wide.x + 300 <= 342, JSON.stringify(wide));
});

test('a canvas label keeps its whole text inside the view, flipping a left-aligned one to the other side of what it names', () => {
  const room = { viewWidth: 346, viewHeight: 474 };
  assert.deepEqual(fitLabel({ ...room, x: 100, y: 50, width: 80 }), { x: 100, y: 50 });
  assert.deepEqual(fitLabel({ ...room, x: 322, y: 50, width: 80, flipAround: 300 }), { x: 198, y: 50 });
  assert.deepEqual(fitLabel({ ...room, x: 10, y: 470, width: 100, align: 'center' }), { x: 54, y: 462 });
  assert.deepEqual(fitLabel({ ...room, x: 340, y: 2, width: 100, align: 'center' }), { x: 292, y: 12 });
});
