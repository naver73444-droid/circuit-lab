import test from 'node:test';
import assert from 'node:assert/strict';
import { EM_PROJECT_VERSION, makeExampleProject, parseEMProject, serializeEMProject } from '../../../src/em-playground-project.js';

// A version 1 file as the earlier app wrote it: charges only.
const v1 = {
  format: 'circuit-lab-em-playground', version: 1,
  world: {
    sources: [{ id: 'q1', type: 'point', q: 1e-9, position: [0, 0, 0], enabled: true, visible: true }],
    probe: [1, 0, 0], plane: 'xy', selectedId: 'q1', comparison: null,
  },
  view: { camera: { yaw: 0.3, pitch: 0.2, distance: 9 }, vectorMode: 'E' },
  calculus: { mode: 'electric', differentialMode: 'numeric', alpha: 1, h: 0.005, radius: 1, normal: [0, 0, 1] },
  legend: { mode: 'auto' },
};

// Axis-aligned unit vectors so the validator's re-normalisation returns them exactly.
const magnetic = {
  sources: [
    { id: 'W1', type: 'wire', current: 10, position: [0, 0, 0], direction: [0, 0, 1], enabled: true, visible: true },
    { id: 'S1', type: 'segment', current: -5, start: [-0.75, 0.5, 0], end: [0.75, 0.5, 0], enabled: true, visible: false },
    { id: 'L1', type: 'loop', current: 4, position: [0.5, -0.5, 0], radius: 0.5, normal: [1, 0, 0], enabled: false, visible: true },
    { id: 'K1', type: 'sheet', K: 20, position: [0, -1, 0], normal: [0, 1, 0], direction: [0, 0, 1], enabled: true, visible: true },
  ],
  selectedId: 'L1',
  ampere: { shape: 'rect', center: [0.25, 0.1, 0], radius: 0.8, halfWidth: 1.2, halfHeight: 0.7, orientation: -1 },
  chips: { lines: true, contours: false, mcolor: true, arrows: false, hfield: true, ampere: true, force: true },
};
const v2 = { ...v1, version: 2, field: 'magnetic', magnetic };
const withMagnetic = change => { const file = structuredClone(v2); change(file.magnetic, file); return JSON.stringify(file); };

test('the format version is 2 and a magnetic file round-trips: four source kinds, Ampere loop, chips and the current field', () => {
  assert.equal(EM_PROJECT_VERSION, 2);
  const project = parseEMProject(JSON.stringify(v2));
  assert.equal(project.version, 2);
  assert.equal(project.field, 'magnetic');
  assert.deepEqual(project.magnetic.sources.map(source => source.type), ['wire', 'segment', 'loop', 'sheet']);
  assert.deepEqual(project.magnetic.sources.map(source => [source.enabled, source.visible]), [[true, true], [true, false], [false, true], [true, true]]);
  assert.equal(project.magnetic.selectedId, 'L1');
  assert.deepEqual(project.magnetic.ampere, magnetic.ampere);
  assert.deepEqual(project.magnetic.chips, magnetic.chips);
  assert.deepEqual(parseEMProject(serializeEMProject(project)), project, 'save then open gives the same project');
  assert.deepEqual(JSON.parse(serializeEMProject(project)).magnetic, magnetic);
});

test('a version 1 file still opens: empty magnetic state, electric field, the charges unchanged', () => {
  const project = parseEMProject(JSON.stringify(v1));
  assert.equal(project.version, 2, 'it is normalised to the current version');
  assert.equal(project.field, 'electric');
  assert.deepEqual(project.magnetic, { sources: [], selectedId: null, ampere: null, chips: null });
  assert.equal(project.world.sources[0].q, 1e-9);
  assert.deepEqual(parseEMProject(serializeEMProject(project)), project);
  // A version 1 file has no magnetic part: stray magnetic fields in it are not read.
  const stray = parseEMProject(JSON.stringify({ ...v1, field: 'magnetic', magnetic }));
  assert.equal(stray.field, 'electric');
  assert.deepEqual(stray.magnetic.sources, []);
});

test('a version 2 file may omit the magnetic part (electric-only writer): empty state, and null ampere / chips are allowed', () => {
  const bare = parseEMProject(JSON.stringify({ ...v1, version: 2 }));
  assert.equal(bare.field, 'electric');
  assert.deepEqual(bare.magnetic, { sources: [], selectedId: null, ampere: null, chips: null });
  const empty = parseEMProject(JSON.stringify({ ...v1, version: 2, magnetic: { sources: [], ampere: null } }));
  assert.deepEqual(empty.magnetic, { sources: [], selectedId: null, ampere: null, chips: null });
});

test('an unsupported version is still refused', () => {
  assert.throws(() => parseEMProject(JSON.stringify({ ...v1, version: 3 })), /version/);
  assert.throws(() => parseEMProject(JSON.stringify({ ...v1, version: 0 })), /version/);
});

test('one bad magnetic source refuses the whole file (as a bad charge does) and the message names it', () => {
  const bad = (change, pattern) => assert.throws(() => parseEMProject(withMagnetic(change)), pattern);
  bad(m => { m.sources[0].type = 'solenoid'; }, /자기 원천 1\(W1\).*type/);
  bad(m => { m.sources[0].current = '10'; }, /자기 원천 1\(W1\).*유한한 숫자/);
  bad(m => { m.sources[1].start = [0, 0]; }, /자기 원천 2\(S1\).*3개/);
  bad(m => { m.sources[2].radius = 'big'; }, /자기 원천 3\(L1\).*반지름/);
  bad(m => { m.sources[3].K = 1e6; }, /자기 원천.*K/);
  bad(m => { m.sources[2].radius = 50; }, /루프 L1/);
  bad(m => { m.sources[0].direction = [0, 0, 0]; }, /W1/);
  bad(m => { m.sources[0].position = [0, 0, 99]; }, /W1/);
  bad(m => { m.sources[1].end = [-0.75, 0.5, 0]; }, /S1/);
  bad(m => { m.sources[3].direction = [0, 1, 0]; }, /K1/); // not in the sheet plane
  bad(m => { m.sources[1].id = 'W1'; }, /ID/);
  bad(m => { m.sources[1].enabled = 'yes'; }, /자기 원천 2\(S1\).*boolean/);
  bad(m => { m.sources[2] = null; }, /자기 원천 3.*객체/);
  bad(m => { m.sources = {}; }, /배열/);
  bad(m => { m.sources = Array.from({ length: 17 }, (_, i) => ({ ...m.sources[0], id: `W${i + 1}` })); }, /배열/);
  bad(m => { m.selectedId = 'nope'; }, /선택 ID/);
});

test('a dangerous key inside the magnetic part is refused like anywhere else in the file', () => {
  const source = JSON.stringify(v2).replace('"selectedId":"L1"', '"selectedId":"L1","__proto__":{"x":1}');
  assert.ok(source.includes('__proto__'));
  assert.throws(() => parseEMProject(source), /허용되지 않은 키/);
});

test('a bad Ampere loop, chip or field refuses the file with its own reason', () => {
  const bad = (change, pattern) => assert.throws(() => parseEMProject(withMagnetic(change)), pattern);
  bad(m => { m.ampere.shape = 'triangle'; }, /암페어 루프 모양/);
  bad(m => { m.ampere.orientation = 0; }, /암페어 루프 방향/);
  bad(m => { m.ampere.radius = 0.001; }, /암페어 루프 radius/);
  bad(m => { m.ampere.halfWidth = 6; }, /암페어 루프 halfWidth/);
  bad(m => { m.ampere.halfHeight = '1'; }, /암페어 루프 halfHeight/);
  bad(m => { m.ampere.center = [0, 0]; }, /중심/);
  bad(m => { m.ampere.center = [19.9, 0, 0]; }, /범위/); // the rectangle would stick out of the supported area
  bad(m => { m.ampere = 1; }, /암페어 루프 객체/);
  bad(m => { m.chips.arrows = 1; }, /칩 arrows/);
  bad(m => { m.chips = []; }, /표시 칩/);
  assert.throws(() => parseEMProject(withMagnetic((_, file) => { file.field = 'both'; })), /필드 모드/);
  assert.throws(() => parseEMProject(withMagnetic((_, file) => { file.magnetic = 'x'; })), /자기 모드 상태/);
});

test('unknown chip names in a file are ignored, and only the known magnetic chips are kept', () => {
  const project = parseEMProject(withMagnetic(m => { m.chips = { force: true, gauss: true, future: 1 }; }));
  assert.deepEqual(project.magnetic.chips, { force: true });
});

test('an example keeps the magnetic part of the workspace it is applied to and shows the electric field', () => {
  const base = parseEMProject(JSON.stringify(v2));
  const example = makeExampleProject('negative', base);
  assert.equal(example.field, 'electric');
  assert.deepEqual(example.magnetic, base.magnetic);
  assert.equal(example.world.sources[0].q, -1e-9);
});

test('the file size cap covers the magnetic part as well', () => {
  assert.throws(() => parseEMProject(withMagnetic(m => { m.note = 'x'.repeat(1048576); })), /1 MiB/);
});
