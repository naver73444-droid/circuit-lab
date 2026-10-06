import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjectPanel } from '../../src/em-project-panel.js';
import { createPointChargeEditor } from '../../src/em-playground-state.js';
import { createEMState } from '../../src/em-state.js';
import { parseEMProject } from '../../src/em-playground-project.js';

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
  createProjectPanel({ root, editor, store, calculus, onLoaded() {}, signal: controller.signal });
  return { root, editor, store };
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
