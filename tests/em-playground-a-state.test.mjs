import test from 'node:test';
import assert from 'node:assert/strict';
import { createPointChargeEditor } from '../src/em-playground-state.js';
import { intersectEditingPlane, screenRay } from '../src/em-playground-interaction.js';

const source = (id, q, position) => ({ id, type: 'point', q, position, enabled: true, visible: true });

test('draft preserves invalid text, blocks drag, then atomically applies zero', () => {
  const editor = createPointChargeEditor({ sources: [source('fixed', 1e-9, [0, 0, 0])], selectedId: 'fixed' });
  editor.beginDraft(); editor.setDraft('q', '');
  assert.equal(editor.state.draft.q, '');
  assert.equal(editor.beginDrag('fixed'), false);
  editor.select(null);
  editor.setProbe([1, 1, 0]);
  editor.setPlane('xz');
  assert.equal(editor.state.draft.q, '');
  assert.equal(editor.state.previous, true);
  assert.match(editor.state.error, /빈값|미확정|적용/);
  assert.equal(editor.undo(), false);
  editor.select('fixed');
  assert.deepEqual(editor.state.sources[0].position, [0, 0, 0]);
  editor.setDraft('q', '0'); editor.setDraft('x', '1');
  assert.equal(editor.applyDraft(), true);
  assert.equal(editor.state.sources[0].q, 0);
  assert.deepEqual(editor.state.sources[0].position, [1, 0, 0]);
});

test('one drag is one history item; cancel adds none; undo and redo preserve stable ID', () => {
  const editor = createPointChargeEditor({ sources: [source('stable', 1e-9, [0, 0, 0])], selectedId: 'stable' });
  const beforeRevision = editor.state.revision;
  assert.equal(editor.beginDrag('stable', 'xy'), true);
  editor.previewDrag([0.25, 0.5, 0]); editor.previewDrag([0.5, 0.75, 0]);
  assert.equal(editor.commitDrag([1, 1, 0]), true);
  assert.equal(editor.state.past.length, 1);
  assert.deepEqual(editor.state.sources[0], source('stable', 1e-9, [1, 1, 0]));
  assert.ok(editor.state.revision > beforeRevision);
  editor.undo(); assert.deepEqual(editor.state.sources[0].position, [0, 0, 0]); assert.equal(editor.state.sources[0].id, 'stable');
  editor.redo(); assert.deepEqual(editor.state.sources[0].position, [1, 1, 0]); assert.equal(editor.state.sources[0].id, 'stable');
  const history = editor.state.past.length;
  editor.beginDrag('stable', 'xz'); editor.previewDrag([2, 1, 2]); editor.cancelDrag();
  assert.deepEqual(editor.state.sources[0].position, [1, 1, 0]); assert.equal(editor.state.past.length, history);
  editor.beginDrag('stable', 'xy'); editor.previewDrag([1.5, 1.5, 0]);
  assert.equal(editor.commitDrag([21, 0, 0]), false); assert.equal(editor.state.drag, null); assert.deepEqual(editor.state.sources[0].position, [1, 1, 0]); assert.equal(editor.state.past.length, history);
});

test('clone gets a fresh ID; deletion clears selection and undo restores exact target', () => {
  const editor = createPointChargeEditor({ sources: [source('q9', 1e-9, [0, 0, 0])], selectedId: 'q9' });
  const cloneId = editor.cloneSelected();
  assert.notEqual(cloneId, 'q9'); assert.equal(new Set(editor.state.sources.map(item => item.id)).size, 2);
  editor.removeSelected(); assert.equal(editor.state.selectedId, null); assert.equal(editor.state.sources.length, 1);
  editor.undo(); assert.equal(editor.state.sources.length, 2); assert.equal(editor.state.selectedId, cloneId);
});

test('clone at the coordinate boundary reports an error without leaking or mutating', () => {
  const editor = createPointChargeEditor({ sources: [source('edge', 1e-9, [20, 0, 0])], selectedId: 'edge' });
  assert.equal(editor.cloneSelected(), null);
  assert.equal(editor.state.sources.length, 1);
  assert.match(editor.state.error, /±20 m/);
});

test('comparison is a deep immutable snapshot and stale calculation tokens change on cancellation', () => {
  const editor = createPointChargeEditor({ sources: [source('q1', 1e-9, [0, 0, 0])], selectedId: 'q1' });
  const comparison = editor.captureComparison();
  const oldToken = editor.state.calculationToken;
  editor.beginDrag('q1'); editor.previewDrag([1, 0, 0]); editor.cancelDrag();
  assert.deepEqual(comparison.sources[0].position, [0, 0, 0]);
  assert.deepEqual(editor.state.comparison.sources[0].position, [0, 0, 0]);
  assert.ok(editor.state.calculationToken > oldToken);
});

test('plane ray intersection fixes its normal coordinate and rejects parallel rays', () => {
  const ray = screenRay({ left: 0, top: 0, width: 800, height: 600 }, 400, 300, { yaw: 0, pitch: 0.5, distance: 7 });
  const point = intersectEditingPlane(ray, 'xy', 0.25);
  assert.ok(point); assert.equal(point[2], 0.25);
  const screenRight = screenRay({ left: 0, top: 0, width: 800, height: 600 }, 600, 300, { yaw: 0, pitch: 0.5, distance: 7 });
  assert.ok(screenRight.direction[1] > ray.direction[1], 'positive screen x must follow em-view lookAt screen-right basis');
  assert.equal(intersectEditingPlane({ origin: [0, 0, 1], direction: [1, 0, 0] }, 'xy', 0), null);
});

test('pure EM editor operations do not mutate an unrelated caller-owned object', () => {
  const circuit = { components: [{ id: 'R1', value: 1000 }], valueDraft: { id: 'R1', text: '2k' }, probe: { kind: 'voltage', ref: 'R1' }, history: ['draw'] };
  const before = structuredClone(circuit);
  const editor = createPointChargeEditor();
  editor.add(1e-9, [0, 0, 1]); editor.beginDrag(editor.state.selectedId, 'xz'); editor.previewDrag([1, 0, 1]); editor.cancelDrag(); editor.undo(); editor.redo();
  assert.deepEqual(circuit, before);
});
