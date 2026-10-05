import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');

test('EM-A UI exposes source editing, plane drag, comparison and shared revision results', async () => {
  const [html, controller, view, css] = await Promise.all([read('index.html'), read('src/em-controller.js'), read('src/em-view.js'), read('styles.css')]);
  for (const id of ['em-playground-controls', 'em-source-list', 'em-pg-plane', 'em-pg-vector', 'em-pg-compare', 'em-gradient-value', 'em-revision-value']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(controller, /intersectEditingPlane/);
  assert.match(controller, /pointercancel/);
  assert.match(controller, /captureComparison/);
  assert.match(controller, /pointChargePlaneSample/);
  assert.match(controller, /playgroundActive/);
  assert.match(view, /scene\.kind === 'playground'/);
  assert.match(view, /gridVectors/);
  assert.match(css, /\.em-source-row\.selected/);
});
