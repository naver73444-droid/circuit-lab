import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { InputDrafts } from '../src/input-drafts.js';
import { classifyNumericInput } from '../src/circuit-edit.js';
import { controlledSourceInputModel } from '../src/ui-model.js';

// Execute the actual app callbacks; simulate only the native focus default action.
// This tests event ordering and committed state, not browser layout or device input.
const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
const inlineCode = app.slice(app.indexOf('function closeInlineEditor('), app.indexOf('function addVoltageProbe('));
const discardCode = app.slice(app.indexOf('  document.getElementById("discard-drafts-button")'), app.indexOf('  document.addEventListener("click", (event) => {', app.indexOf('  document.getElementById("discard-drafts-button")')));

function fixture(value = '2k') {
  const classes = new Set();
  const editor = { value, classList: {
    add: (...names) => names.forEach(name => classes.add(name)),
    remove: (...names) => names.forEach(name => classes.delete(name)),
  }};
  const component = { id: 'R1', type: 'R', props: { value: '1k' } };
  const state = {
    circuit: { components: [component], wires: [], junctions: [] },
    settings: { step: '1u' }, history: [],
    inlineEdit: { componentId: 'R1', prop: 'value', original: '1k' },
  };
  const inputDrafts = new InputDrafts();
  inputDrafts.set('prop', 'R1', 'value', value, '1k');
  inputDrafts.set('setting', null, 'step', '1e', '1u');
  const listeners = new Map();
  const button = { addEventListener(type, callback) {
    if (!listeners.has(type)) listeners.set(type, []);
    listeners.get(type).push(callback);
  }};
  const context = {
    document: { getElementById(id) { assert.equal(id, 'discard-drafts-button'); return button; } },
    state, inputDrafts, elements: { 'inline-value-editor': editor },
    isCircuitUiActive: () => true, classifyNumericInput, controlledSourceInputModel,
    setStatus() {}, renderInspector() {}, updateDraftNotice() {}, scheduleAutoRun() {}, renderAll() {},
    mutate(change) { state.history.push(structuredClone(component.props)); change(); },
  };
  runInNewContext(inlineCode + '\n' + discardCode, context);
  return { state, component, inputDrafts, classes,
    blur: () => context.closeInlineEditor({ commit: true }),
    emit(type, buttonNumber = 0) {
      const event = { button: buttonNumber, defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; } };
      for (const callback of listeners.get(type) ?? []) callback(event);
      // Pointer focus causes blur before the subsequent button click.
      if (type === 'pointerdown' && !event.defaultPrevented) context.closeInlineEditor({ commit: true });
      return event;
    },
  };
}

for (const value of ['2k', '1e']) test(`discard pointer activation cancels ${JSON.stringify(value)} without committing`, () => {
  const f = fixture(value);
  f.emit('pointerdown');
  f.emit('click');
  assert.equal(f.component.props.value, '1k', 'discard must keep the committed resistor value');
  assert.equal(f.state.settings.step, '1u');
  assert.equal(f.state.history.length, 0, 'discard must not add an undo entry');
  assert.equal(f.inputDrafts.size, 0);
  assert.equal(f.state.inlineEdit, null);
  assert.ok(f.classes.has('hidden'));
});

test('aborting a discard pointer gesture preserves the pending draft', () => {
  const f = fixture();
  f.emit('pointerdown');
  f.emit('pointercancel');
  assert.equal(f.component.props.value, '1k');
  assert.equal(f.state.history.length, 0);
  assert.equal(f.inputDrafts.get('prop', 'R1', 'value'), '2k');
  assert.ok(f.state.inlineEdit);
});

test('ordinary blur still commits a valid inline edit and retains unrelated drafts', () => {
  const f = fixture();
  assert.equal(f.blur(), true);
  assert.equal(f.component.props.value, '2k');
  assert.equal(f.state.history.length, 1);
  assert.equal(f.inputDrafts.get('prop', 'R1', 'value'), undefined);
  assert.equal(f.inputDrafts.get('setting', null, 'step'), '1e');
});

test('direct click activation retains the discard behavior', () => {
  const f = fixture();
  f.emit('click');
  assert.equal(f.component.props.value, '1k');
  assert.equal(f.state.history.length, 0);
  assert.equal(f.inputDrafts.size, 0);
  assert.equal(f.state.inlineEdit, null);
});