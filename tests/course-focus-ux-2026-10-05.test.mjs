import test from 'node:test';
import assert from 'node:assert/strict';
import { preserveCourseFocus } from '../src/course-focus.js';

function node(attribute, value, extras = {}) {
  return {
    isConnected: true, disabled: false, selectionStart: null, selectionEnd: null,
    hasAttribute: key => key === attribute,
    getAttribute: key => key === attribute ? value : null,
    focus(options) { this.focused = options; },
    setSelectionRange(...range) { this.selection = range; },
    ...extras,
  };
}
function fixture(active, replacements = []) {
  return {
    ownerDocument: { activeElement: active },
    contains: target => target === active,
    querySelectorAll: () => replacements,
  };
}

test('focus helper restores replaced text input and selection without scrolling', () => {
  const active = node('data-key', 'expression', { selectionStart: 1, selectionEnd: 4, selectionDirection: 'backward' });
  const replacement = node('data-key', 'expression', { selectionStart: 0 });
  const restore = preserveCourseFocus(fixture(active, [replacement]), ['data-key']);
  active.isConnected = false;
  restore();
  assert.deepEqual(replacement.focused, { preventScroll: true });
  assert.deepEqual(replacement.selection, [1, 4, 'backward']);
});

test('focus helper matches attribute values literally, including CSS-special characters', () => {
  const value = 'R["x"]';
  const active = node('data-key', value);
  const wrong = node('data-key', 'R');
  const replacement = node('data-key', value);
  const restore = preserveCourseFocus(fixture(active, [wrong, replacement]), ['data-key']);
  active.isConnected = false; restore();
  assert.equal(wrong.focused, undefined);
  assert.deepEqual(replacement.focused, { preventScroll: true });
});

test('focus helper does not steal focus from a still-connected control or outside the root', () => {
  const active = node('data-key', 'a'), replacement = node('data-key', 'a');
  const root = fixture(active, [replacement]);
  preserveCourseFocus(root, ['data-key'])();
  assert.equal(replacement.focused, undefined);
  root.contains = () => false;
  const restore = preserveCourseFocus(root, ['data-key']);
  active.isConnected = false; restore();
  assert.equal(replacement.focused, undefined);
});

test('focus helper ignores missing and disabled replacement controls', () => {
  for (const replacements of [[], [node('data-key', 'a', { disabled: true })]]) {
    const active = node('data-key', 'a');
    const restore = preserveCourseFocus(fixture(active, replacements), ['data-key']);
    active.isConnected = false;
    assert.doesNotThrow(restore);
    assert.equal(replacements[0]?.focused, undefined);
  }
});

test('focus helper handles empty button attributes and text-to-select replacement safely', () => {
  const active = node('data-reset', '', { selectionStart: 0, selectionEnd: 3 });
  const replacement = node('data-reset', '');
  const restore = preserveCourseFocus(fixture(active, [replacement]), ['data-reset']);
  active.isConnected = false; restore();
  assert.deepEqual(replacement.focused, { preventScroll: true });
  assert.equal(replacement.selection, undefined);
});
