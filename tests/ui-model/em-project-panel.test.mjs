import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjectPanel } from '../../src/em-project-panel.js';
import { createPointChargeEditor } from '../../src/em-playground-state.js';
import { createEMState } from '../../src/em-state.js';
import { EM_MAGNETIC_CHIPS, parseEMProject } from '../../src/em-playground-project.js';
import { createCurrentEditor } from '../../src/em-current-state.js';
import { currentPreset } from '../../src/em-current-presets.js';

// A minimal stand-in for the panel's DOM: nodes with listeners, a status text and a file input.
function fakeRoot() {
  const nodes = new Map();
  const node = () => ({ listeners: {}, textContent: '', value: '', addEventListener(type, fn) { this.listeners[type] = fn; }, click() { this.listeners.click?.(); } });
  return { nodes, querySelector: selector => { if (!nodes.has(selector)) nodes.set(selector, node()); return nodes.get(selector); } };
}

function openPanel() {
  const root = fakeRoot(), editor = createPointChargeEditor(), store = createEMState();
  let settings = { mode: 'electric', differentialMode: 'numeric', alpha: 1, h: 0.005, radius: 1, normal: [0, 0, 1] };
  const calculus = { settings: () => structuredClone(settings), setSettings: value => { settings = structuredClone(value); } };
  const controller = new AbortController();
  const panel = createProjectPanel({ root, editor, store, calculus, onLoaded() {}, signal: controller.signal });
  return { root, editor, store, panel };
}

// The panel saves through a Blob URL and a clicked link: capture the saved text instead of downloading.
async function save(root) {
  let blob = null;
  const original = { createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL, document: globalThis.document };
  URL.createObjectURL = value => { blob = value; return 'blob:test'; };
  URL.revokeObjectURL = () => {};
  globalThis.document = { createElement: () => ({ click() {} }) };
  try { root.querySelector('#em-d-save').click(); } finally {
    Object.assign(URL, { createObjectURL: original.createObjectURL, revokeObjectURL: original.revokeObjectURL });
    if (original.document === undefined) delete globalThis.document; else globalThis.document = original.document;
  }
  assert.ok(blob, `a file was saved: ${root.querySelector('#em-d-status').textContent}`);
  return blob.text();
}

const open = (root, source) => root.querySelector('#em-d-file').listeners.change({
  target: { files: [{ size: source.length, text: async () => source }], value: 'x' },
});

const project = {
  format: 'circuit-lab-em-playground', version: 1,
  world: {
    sources: [{ id: 'q1', type: 'point', q: 1e-9, position: [0, 0, 0], enabled: true, visible: true }],
    probe: [1, 0, 0], plane: 'xy', selectedId: 'q1',
    comparison: { sources: [{ id: 'q1', type: 'point', q: 1e-9, position: [-1, 0, 0], enabled: true, visible: true }], probe: [1, 0, 0] },
  },
  view: { camera: { yaw: 0.3, pitch: 0.2, distance: 9 }, vectorMode: 'gradV' },
  calculus: { mode: 'electric', differentialMode: 'numeric', alpha: 1, h: 0.005, radius: 1, normal: [0, 0, 1] },
  legend: { mode: 'fixed', min: -5, max: 25 },
};

test('opening a file with a comparison, gradV vectors and a fixed legend and saving it again loses nothing', async () => {
  const { root } = openPanel();
  await open(root, JSON.stringify(project));
  assert.match(root.querySelector('#em-d-status').textContent, /불러왔습니다/);
  const saved = JSON.parse(await save(root));
  assert.deepEqual(saved.world.comparison, project.world.comparison, 'the "before" comparison round-trips');
  assert.equal(saved.view.vectorMode, 'gradV');
  assert.deepEqual(saved.legend, { mode: 'fixed', min: -5, max: 25 });
  assert.deepEqual(saved.view.camera, project.view.camera);
  // and the saved file opens as an equal project
  assert.deepEqual(parseEMProject(JSON.stringify(saved)).legend, parseEMProject(JSON.stringify(project)).legend);
});

test('a fresh workspace still saves the plain defaults (no comparison, E vectors, automatic legend)', async () => {
  const { root } = openPanel();
  const saved = JSON.parse(await save(root));
  assert.equal(saved.world.comparison, null);
  assert.equal(saved.view.vectorMode, 'E');
  assert.deepEqual(saved.legend, { mode: 'auto' });
});

test('loading an example resets the comparison but keeps the loaded vector mode and legend', async () => {
  const { root } = openPanel();
  await open(root, JSON.stringify(project));
  const select = root.querySelector('#em-d-example');
  select.listeners.change({ target: { value: 'negative' } });
  const saved = JSON.parse(await save(root));
  assert.equal(saved.world.comparison, null, 'an example has no stored comparison');
  assert.equal(saved.view.vectorMode, 'gradV');
  assert.deepEqual(saved.legend, { mode: 'fixed', min: -5, max: 25 });
  assert.equal(saved.world.sources[0].q, -1e-9);
});

test('a file that fails to open leaves the carried fields of the current project alone', async () => {
  const { root } = openPanel();
  await open(root, JSON.stringify(project));
  await open(root, '{ not json');
  assert.match(root.querySelector('#em-d-status').textContent, /열기 오류/);
  const saved = JSON.parse(await save(root));
  assert.equal(saved.view.vectorMode, 'gradV');
  assert.deepEqual(saved.world.comparison, project.world.comparison);
});

test('초기화 clears the carried comparison, vector mode and legend: a reset world does not save the stale fields of the opened file', async () => {
  const { root, editor, panel } = openPanel();
  await open(root, JSON.stringify(project));
  assert.equal(panel.inspectCarried().vectorMode, 'gradV');
  editor.reset();
  panel.resetCarried(); // what the 초기화 button of the workspace does
  assert.deepEqual(panel.inspectCarried(), { comparison: null, vectorMode: 'E', legend: { mode: 'auto' } });
  const saved = JSON.parse(await save(root));
  assert.equal(saved.world.comparison, null);
  assert.equal(saved.view.vectorMode, 'E');
  assert.deepEqual(saved.legend, { mode: 'auto' });
});

// ---- the magnetic mode in the file: sources, Ampere loop, chips and the current field ------------------------------------------

function panelParts() {
  const root = fakeRoot(), editor = createPointChargeEditor(), store = createEMState();
  let settings = { mode: 'electric', differentialMode: 'numeric', alpha: 1, h: 0.005, radius: 1, normal: [0, 0, 1] };
  const calculus = { settings: () => structuredClone(settings), setSettings: value => { settings = structuredClone(value); } };
  const controller = new AbortController();
  return { root, editor, args: { root, editor, store, calculus, signal: controller.signal } };
}

// What the controller wires in: a current editor plus the lab fields (field, ampere, chips) that a file also carries.
function openMagneticPanel() {
  const base = panelParts();
  const currentEditor = createCurrentEditor();
  const lab = { field: 'electric', ampere: null, chips: { lines: true, contours: true, mcolor: true, arrows: true, hfield: false, ampere: false, force: false } };
  const loaded = [];
  const magnetic = {
    read: () => ({
      field: lab.field, sources: structuredClone(currentEditor.state.sources), selectedId: currentEditor.state.selectedId,
      ampere: lab.ampere ? structuredClone(lab.ampere) : null,
      chips: Object.fromEntries(EM_MAGNETIC_CHIPS.map(name => [name, lab.chips[name] === true])),
    }),
    write: ({ sources, selectedId, ampere, chips }) => {
      currentEditor.replaceWorld({ sources, selectedId });
      lab.ampere = ampere ? structuredClone(ampere) : null;
      if (chips) EM_MAGNETIC_CHIPS.forEach(name => { if (name in chips) lab.chips[name] = chips[name]; });
    },
  };
  createProjectPanel({ ...base.args, magnetic, onLoaded: file => { lab.field = file.field; loaded.push(file.field); } });
  return { root: base.root, editor: base.editor, currentEditor, lab, loaded };
}

const preset = currentPreset('wire-ampere', 'xy');

test('save then open in a fresh workspace restores the magnetic sources, Ampere loop, chips and the magnetic field; both histories are cleared', async () => {
  const a = openMagneticPanel();
  a.currentEditor.load([
    ...preset.sources,
    { id: 'S1', type: 'segment', current: 5, start: [-0.5, 1, 0], end: [0.5, 1, 0] },
    { id: 'L1', type: 'loop', current: 4, position: [1, 1, 0], radius: 0.4, normal: [0, 0, 1] },
    { id: 'K1', type: 'sheet', K: 20, position: [0, -1, 0], normal: [0, 1, 0], direction: [0, 0, 1] },
  ], 'L1');
  a.lab.ampere = preset.ampere;
  Object.assign(a.lab.chips, { ampere: true, hfield: true, force: true, arrows: false });
  a.lab.field = 'magnetic';
  const text = await save(a.root);
  const file = JSON.parse(text);
  assert.equal(file.version, 2);
  assert.equal(file.field, 'magnetic');
  assert.deepEqual(file.magnetic.sources.map(source => source.type), ['wire', 'segment', 'loop', 'sheet']);

  const b = openMagneticPanel();
  b.editor.add(2e-9, [0, 1, 0]); // both histories have something to clear
  b.currentEditor.addWire();
  assert.ok(b.editor.state.past.length && b.currentEditor.state.past.length);
  await open(b.root, text);
  assert.match(b.root.querySelector('#em-d-status').textContent, /불러왔습니다/);
  assert.deepEqual(b.loaded, ['magnetic'], 'the workspace is told which field to show');
  const cs = b.currentEditor.state;
  assert.deepEqual(cs.sources.map(source => source.id), ['W1', 'S1', 'L1', 'K1']);
  assert.equal(cs.selectedId, 'L1');
  assert.deepEqual(b.lab.ampere, preset.ampere);
  assert.deepEqual([b.lab.chips.ampere, b.lab.chips.hfield, b.lab.chips.force, b.lab.chips.arrows], [true, true, true, false]);
  assert.deepEqual([cs.past.length, cs.future.length, b.editor.state.past.length, b.editor.state.future.length], [0, 0, 0, 0], 'undo / redo of both modes are emptied');
  assert.equal(b.editor.state.sources.length, 2, 'the charges of the file replaced the ones added before');
  assert.deepEqual(JSON.parse(await save(b.root)).magnetic, file.magnetic, 'opening and saving again changes nothing');
});

test('opening a version 1 file empties the magnetic mode (sources, loop, history), keeps the chips and shows the electric field', async () => {
  const a = openMagneticPanel();
  a.lab.ampere = preset.ampere;
  a.lab.field = 'magnetic';
  a.currentEditor.addWire();
  assert.ok(a.currentEditor.state.past.length);
  await open(a.root, JSON.stringify(project)); // the shared version 1 fixture of this file
  assert.deepEqual(a.loaded, ['electric']);
  assert.deepEqual(a.currentEditor.state.sources, []);
  assert.equal(a.currentEditor.state.selectedId, null);
  assert.equal(a.lab.ampere, null);
  assert.deepEqual([a.currentEditor.state.past.length, a.currentEditor.state.future.length], [0, 0]);
  assert.equal(a.lab.chips.lines, true, 'a file without magnetic chips leaves the chips as they are');
});

test('a file with a bad magnetic source is refused as a whole with the reason; the current scene and both histories stay', async () => {
  const a = openMagneticPanel();
  a.currentEditor.addWire();
  a.editor.add(2e-9, [0, 1, 0]);
  const before = [structuredClone(a.currentEditor.state.sources), structuredClone(a.editor.state.sources), a.currentEditor.state.past.length, a.editor.state.past.length];
  const file = JSON.parse(await save(a.root));
  file.magnetic.sources[0].type = 'solenoid';
  file.world.sources[0].q = 5e-9; // a valid change elsewhere in the same file must not be half-applied
  await open(a.root, JSON.stringify(file));
  assert.match(a.root.querySelector('#em-d-status').textContent, /열기 오류.*자기 원천 1\(I1\).*type.*현재 장면은 바뀌지 않았습니다/);
  assert.deepEqual([a.currentEditor.state.sources, a.editor.state.sources, a.currentEditor.state.past.length, a.editor.state.past.length], before);
  assert.deepEqual(a.loaded, []);
});

test('a learning example changes the charges and shows the electric field, but leaves the magnetic mode and its history alone', async () => {
  const a = openMagneticPanel();
  a.currentEditor.addWire();
  a.lab.ampere = preset.ampere;
  a.lab.field = 'magnetic';
  const sources = structuredClone(a.currentEditor.state.sources), past = a.currentEditor.state.past.length;
  a.root.querySelector('#em-d-example').listeners.change({ target: { value: 'negative' } });
  assert.deepEqual(a.loaded, ['electric']);
  assert.deepEqual(a.currentEditor.state.sources, sources);
  assert.equal(a.currentEditor.state.past.length, past);
  assert.ok(a.lab.ampere, 'the Ampere loop is kept');
  assert.equal(a.editor.state.sources[0].q, -1e-9);
  assert.equal(JSON.parse(await save(a.root)).field, 'electric');
});

test('a workspace without the magnetic adapter still saves a valid version 2 file with an empty magnetic part', async () => {
  const { root } = openPanel();
  const saved = JSON.parse(await save(root));
  assert.equal(saved.version, 2);
  assert.equal(saved.field, 'electric');
  assert.deepEqual(saved.magnetic, { sources: [], selectedId: null, ampere: null, chips: null });
});

test('the magnetic editor replaces its world from a file: history cleared, ids restart, a missing selection is refused', () => {
  const editor = createCurrentEditor();
  editor.addWire();
  editor.undo();
  assert.ok(editor.state.future.length);
  editor.replaceWorld({ sources: [{ id: 'W1', type: 'wire', current: 3, position: [0, 0, 0], direction: [0, 0, 1] }], selectedId: 'W1' });
  assert.deepEqual([editor.state.past.length, editor.state.future.length], [0, 0]);
  assert.equal(editor.addWire(), 'W2', 'ids are chosen again from the loaded sources');
  assert.throws(() => editor.replaceWorld({ sources: [], selectedId: 'W9' }), /선택 ID/);
  assert.deepEqual(editor.state.sources.map(source => source.id), ['W1', 'W2'], 'a refused replacement changes nothing');
  editor.replaceWorld({ sources: [] });
  assert.deepEqual([editor.state.sources.length, editor.state.selectedId], [0, null]);
});
