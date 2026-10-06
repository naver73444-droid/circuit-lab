import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCourseMath } from '../../src/course-math-view.js';
import { SIGNALS_LESSONS } from '../../src/signals-course-model.js';
import { timeLesson } from '../../src/signals-time-model.js';
import { convolutionLesson, isCustomFamily } from '../../src/signals-convolution-model.js';
import { seriesLesson } from '../../src/signals-series-model.js';
import { transformLesson } from '../../src/signals-transform-model.js';
import { rocLesson } from '../../src/signals-roc-model.js';
import { samplingLesson } from '../../src/signals-sampling-model.js';
import { CUSTOM_FIELDS, customDefaults, parseCustomInput } from '../../src/signals-custom-input.js';
import { createSignalsCourseController } from '../../src/signals-course-controller.js';

const LESSONS = { time: timeLesson, convolution: convolutionLesson, series: seriesLesson, fourier: transformLesson, roc: rocLesson, sampling: samplingLesson };
const familiesOf = (lesson) => (lesson.families ? lesson.families.map((f) => f.value) : [lesson.initialFamily]);

// Parameter sets at the slider extremes plus the initial values.
function paramSets(lesson, family) {
  const controls = lesson.controls(family, {});
  const make = (pick) => Object.fromEntries(controls.map((c) => [c.key, pick(c)]));
  return [make((c) => c.initial), make((c) => c.min), make((c) => c.max), make((c) => (c.min + c.max) / 2)];
}

test('the registry covers exactly the six lessons, each with the shared skeleton', () => {
  assert.deepEqual(Object.keys(LESSONS), SIGNALS_LESSONS.map((l) => l.id));
  for (const [id, lesson] of Object.entries(LESSONS)) {
    assert.equal(lesson.id, id);
    assert.equal(typeof lesson.read, 'function');
    assert.equal(typeof lesson.formula, 'function');
    assert.equal(typeof lesson.controls, 'function');
    assert.ok(familiesOf(lesson).includes(lesson.initialFamily), id);
  }
});

test('control strip: 1-4 sliders per example (plus the scrubber), no calculate/apply controls', () => {
  for (const [id, lesson] of Object.entries(LESSONS)) {
    for (const family of familiesOf(lesson)) {
      const controls = lesson.controls(family, {});
      const fixed = id === 'convolution' && (isCustomFamily(family) || family.startsWith('dt-')); // scrubber only
      assert.ok(controls.length <= 4 && (controls.length >= 1 || fixed), `${id}/${family}: ${controls.length}`);
      for (const c of controls) {
        assert.ok(c.max > c.min && c.step > 0 && c.initial >= c.min && c.initial <= c.max, `${id}/${family}/${c.key}`);
        assert.doesNotMatch(c.label, /예시 계산|적용|계산/);
      }
    }
  }
});

test('every formula line parses as math (no prose fallbacks), for every family and slider position', () => {
  for (const [id, lesson] of Object.entries(LESSONS)) {
    for (const family of familiesOf(lesson)) {
      for (const params of paramSets(lesson, family)) {
        const source = lesson.formula(family, params);
        for (const part of source.split(/[;\n]/u).map((p) => p.trim()).filter(Boolean)) {
          assert.ok(parseCourseMath(part), `${id}/${family}: cannot parse "${part}"`);
        }
      }
    }
  }
});

test('read lines are one sentence-sized hint per example, in Korean', () => {
  for (const [id, lesson] of Object.entries(LESSONS)) {
    for (const family of familiesOf(lesson)) {
      const text = lesson.read(family, {});
      assert.match(text, /[가-힣]/, `${id}/${family}`);
      assert.ok(text.length > 20 && text.length < 160, `${id}/${family}: ${text.length}`);
    }
  }
});

test('live readouts never throw and never contain NaN/undefined at the slider extremes', () => {
  for (const [id, lesson] of Object.entries(LESSONS)) {
    if (!lesson.describe) continue;
    for (const family of familiesOf(lesson)) {
      if (isCustomFamily(family)) continue;
      for (const params of paramSets(lesson, family)) {
        const spec = lesson.cursor?.(family, params, null);
        for (const cursor of spec ? [spec.min, spec.initial, spec.max] : [0]) {
          const text = lesson.describe({ family, params, cursor, extra: {} });
          assert.equal(typeof text, 'string');
          assert.doesNotMatch(text, /NaN|undefined|Infinity/, `${id}/${family}`);
        }
      }
    }
  }
});

test('cursor specs: initial inside the range, positive step', () => {
  for (const [id, lesson] of Object.entries(LESSONS)) {
    if (!lesson.cursor) continue;
    for (const family of familiesOf(lesson)) {
      if (isCustomFamily(family)) continue;
      const spec = lesson.cursor(family, Object.fromEntries(lesson.controls(family, {}).map((c) => [c.key, c.initial])), null);
      assert.ok(spec.min < spec.max && spec.step > 0 && spec.initial >= spec.min && spec.initial <= spec.max, `${id}/${family}`);
    }
  }
  assert.equal(timeLesson.scrub, false);
  assert.equal(convolutionLesson.scrub, true);
  assert.equal(seriesLesson.scrub, true);
});

test('advanced input: at most eight fields, defaults are valid, limits still apply', () => {
  const total = Object.values(CUSTOM_FIELDS).flat().length;
  assert.ok(total <= 8, String(total));
  const drafts = customDefaults();
  assert.equal(parseCustomInput('custom', drafts).T, 4);
  assert.deepEqual(parseCustomInput('custom-dt', drafts), { x: [1, 2, 1], h: [1, -1], xStart: 0, hStart: 0 });
  assert.throws(() => parseCustomInput('custom', { ...drafts, xExpression: 'alert(1)' }));
  assert.throws(() => parseCustomInput('custom', { ...drafts, xExpression: '1'.repeat(300) }));
  assert.throws(() => parseCustomInput('custom', { ...drafts, windowT: '99' }));
  assert.throws(() => parseCustomInput('custom', { ...drafts, dt: '0.00001' })); // too many cells
  assert.throws(() => parseCustomInput('custom-dt', { ...drafts, x: '1,,2' }));
  assert.throws(() => parseCustomInput('custom-dt', { ...drafts, xStart: '1.5' }));
  assert.throws(() => parseCustomInput('rect-rect', drafts));
});

test('controller keeps its public contract', () => {
  assert.equal(typeof createSignalsCourseController, 'function');
  assert.throws(() => createSignalsCourseController(null), TypeError);
  assert.throws(() => createSignalsCourseController({}), TypeError);
});

test('every slider grid (min + k·step) contains its default, its maximum and 0 when 0 is inside the range', () => {
  const onGrid = (control, value) => {
    const steps = (value - control.min) / control.step;
    return Math.abs(steps - Math.round(steps)) < 1e-9;
  };
  for (const [id, lesson] of Object.entries(LESSONS)) {
    for (const family of familiesOf(lesson)) {
      for (const c of lesson.controls(family, {})) {
        const where = `${id}/${family}/${c.key}`;
        assert.ok(onGrid(c, c.initial), `${where}: default ${c.initial} is off the grid`);
        assert.ok(onGrid(c, c.max), `${where}: max ${c.max} is off the grid`);
        if (c.min < 0 && c.max > 0) assert.ok(onGrid(c, 0), `${where}: 0 is not reachable`);
      }
    }
  }
});

test('only the time lesson normalizes parameters; the normalized value is a legal slider value', () => {
  assert.equal(typeof timeLesson.normalize, 'function');
  for (const family of familiesOf(timeLesson)) {
    const controls = timeLesson.controls(family, {});
    const { params } = timeLesson.normalize(family, { a: 0, b: 0 });
    const a = controls.find((c) => c.key === 'a');
    assert.ok(params.a >= a.min && params.a <= a.max && params.a !== 0);
  }
});
