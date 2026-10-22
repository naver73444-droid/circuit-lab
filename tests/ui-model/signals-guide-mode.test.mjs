// The Fourier-transform lesson's guided mode as the controller sees it: the five steps ride on the family mechanism as
// "guide:<step>" families, answer controls / read / describe / formula from the guide, and leave the free examples alone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TRANSFORM_FAMILIES, guideFamily, guideStepOf, transformControls, transformLesson } from '../../src/signals-transform-model.js';
import { GUIDE_STEPS, guideChips, guideControls, guideFormula, guideObserve, guideText } from '../../src/signals-transform-guide.js';
import { controlDefaults } from '../../src/signals-util.js';

const guide = transformLesson.guide;

test('guide families: every step maps to "guide:<step>" and back; anything else is not a guide family', () => {
  assert.equal(guide.steps, GUIDE_STEPS);
  assert.equal(guide.initialStep, 'train');
  for (const { id } of GUIDE_STEPS) {
    assert.equal(guide.family(id), `guide:${id}`);
    assert.equal(guideStepOf(guideFamily(id)), id);
    assert.equal(guide.stepOf(guide.family(id)), id);
  }
  for (const other of ['rect', 'guide:', 'guide:nope', 'guide:train ', 'train', '', null, undefined, 3]) assert.equal(guideStepOf(other), null, String(other));
  // The 예시 select lists only the free examples.
  assert.ok(TRANSFORM_FAMILIES.every((f) => guideStepOf(f.value) === null));
  assert.notEqual(guide.label, guide.freeLabel);
});

test('a guide family answers from the guide: controls, read (the "try" line), live line, formula, body and presets', () => {
  for (const { id } of GUIDE_STEPS) {
    const family = guideFamily(id);
    const controls = transformLesson.controls(family, {});
    assert.deepEqual(controls.map((c) => c.key), guideControls(id).map((c) => c.key), id);
    const params = controlDefaults(controls);
    assert.equal(transformLesson.read(family, params), guideText(id, params).tryText, id);
    assert.equal(transformLesson.describe({ family, params }), guideObserve(id, params), id);
    assert.equal(transformLesson.formula(family, params), guideFormula(id, params), id);
    assert.equal(guide.body(id, params), guideText(id, params).body, id);
    assert.deepEqual(guide.chips(id), guideChips(id), id);
    assert.ok(params.axis === 0, `${id}: starts on the f axis`);
  }
  // The exponential step's explanation follows the shape select.
  assert.notEqual(guide.body('exp', { shape: 0, a: 1, axis: 0 }), guide.body('exp', { shape: 1, a: 1, axis: 0 }));
});

test('free examples are unchanged: same controls as before, and none of the guide text leaks into them', () => {
  const tries = new Set(GUIDE_STEPS.map(({ id }) => guideText(id).tryText));
  for (const { value } of TRANSFORM_FAMILIES) {
    assert.deepEqual(transformLesson.controls(value, {}), transformControls(value, {}), value);
    const params = controlDefaults(transformControls(value, {}));
    assert.ok(!tries.has(transformLesson.read(value, params)), value);
    assert.match(transformLesson.formula(value, params), /^X\(ω\)=∫ x\(t\) e\^\(−jωt\) dt;/, value);
  }
});
