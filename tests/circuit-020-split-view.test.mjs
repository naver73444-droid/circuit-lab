import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// The 020 free-layout machinery (docks, splitters, saved panel layout) was replaced by a fixed layout.
// These tests pin the behaviour of the replacement controller with a tiny fake DOM.
class FakeNode {
  constructor(id = '', dataset = {}) { this.id = id; this.dataset = dataset; this.hidden = false; this.inert = false; this.attrs = {}; this.listeners = {}; this.scrollTop = 0; this.offsetTop = 100; this.tabIndex = 0; }
  setAttribute(name, value) { this.attrs[name] = value; }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  querySelectorAll() { return []; }
  click() { for (const fn of this.listeners.click ?? []) fn({}); }
}

function setup({ mobile }) {
  const ids = ['workbench', 'side-panel', 'palette-panel', 'inspector-panel', 'results-panel', 'wave-panel', 'phasor-panel', 'port-panel'];
  const nodes = Object.fromEntries(ids.map((id) => [id, new FakeNode(id)]));
  const views = ['palette', 'inspector', 'results', 'wave'].map((view) => Object.assign(new FakeNode('', { view })));
  const results = ['phasor', 'port'].map((view) => new FakeNode('', { resultView: view }));
  const media = { matches: mobile, addEventListener() {} };
  globalThis.document = {
    getElementById: (id) => nodes[id] ?? null,
    querySelectorAll: (selector) => selector === '[data-view]' ? views : selector === '[data-result-view]' ? results : [],
  };
  globalThis.matchMedia = () => media;
  globalThis.requestAnimationFrame = (fn) => { fn(); return 1; };
  return { nodes, views, results };
}

test('fixed layout: desktop shows palette, wave and one of properties/results', async () => {
  const { nodes, views } = setup({ mobile: false });
  const { createPanelController } = await import('../src/panel-controller.js?desktop');
  let changes = 0;
  const panels = createPanelController({ onChange: () => { changes += 1; } });
  assert.equal(panels.isOpen('palette'), true);
  assert.equal(panels.isOpen('wave'), true);
  assert.equal(panels.isOpen('inspector'), true);
  assert.equal(panels.isOpen('results'), false);
  assert.equal(nodes['results-panel'].hidden, true);
  assert.equal(nodes['results-panel'].inert, true, 'hidden panels are inert');
  panels.show('results');
  assert.equal(panels.isOpen('inspector'), false);
  assert.equal(nodes['inspector-panel'].hidden, true);
  assert.equal(nodes['results-panel'].hidden, false);
  assert.equal(views.find((v) => v.dataset.view === 'results').attrs['aria-selected'], 'true');
  assert.equal(panels.isOpen('phasor'), true);
  panels.show('port');
  assert.equal(panels.isOpen('port'), true);
  assert.equal(panels.isOpen('phasor'), false);
  assert.equal(nodes['phasor-panel'].hidden, true);
  assert.equal(nodes['palette-panel'].hidden, false, 'desktop palette never hides');
  assert.ok(changes >= 1);
});

test('fixed layout: phone shows exactly one panel and never moves the workbench scroll for desktop', async () => {
  const { nodes } = setup({ mobile: true });
  const { createPanelController } = await import('../src/panel-controller.js?mobile');
  const panels = createPanelController({});
  assert.deepEqual(['palette', 'inspector', 'results', 'wave'].filter((name) => panels.isOpen(name)), ['palette']);
  assert.equal(nodes['side-panel'].hidden, true);
  panels.show('wave');
  assert.deepEqual(['palette', 'inspector', 'results', 'wave'].filter((name) => panels.isOpen(name)), ['wave']);
  assert.ok(nodes.workbench.scrollTop > 0, 'tab switch brings the panel into view');
  panels.showCanvas();
  assert.equal(nodes.workbench.scrollTop, 0);
  panels.show('inspector');
  assert.equal(nodes['side-panel'].hidden, false);
});

test('inactive circuit workspace keeps every panel inert and ignores show()', async () => {
  const { nodes } = setup({ mobile: false });
  const { createPanelController } = await import('../src/panel-controller.js?inactive');
  let active = false;
  const panels = createPanelController({ isActive: () => active });
  assert.ok(['palette-panel', 'inspector-panel', 'wave-panel'].every((id) => nodes[id].inert));
  panels.show('results');
  assert.equal(panels.isOpen('results'), false);
  active = true; panels.synchronize();
  assert.equal(nodes['inspector-panel'].inert, false);
});

test('layout is fixed markup: no separators, drag handles, layout reset, shelf or saved layout', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const controller = await readFile(new URL('../src/panel-controller.js', import.meta.url), 'utf8');
  assert.equal((html.match(/role="separator"/g) ?? []).length, 0);
  for (const gone of ['layout-reset-button', 'workspace-reset', 'panel-shelf', 'panel-grip', 'dock-left', 'palette-open', 'inspector-open', 'mini-guide', 'learning-bar']) assert.ok(!html.includes(gone), gone);
  assert.doesNotMatch(controller, /\b(?:localStorage|sessionStorage)\b/);
  assert.equal((html.match(/data-view="/g) ?? []).length, 6, 'two side tabs and four phone tabs');
});
