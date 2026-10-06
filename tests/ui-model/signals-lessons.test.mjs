import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCourseMath } from '../../src/course-math-view.js';
import { SIGNALS_LESSONS } from '../../src/signals-course-model.js';
import { timeLesson } from '../../src/signals-time-model.js';
import { isCustomFamily } from '../../src/signals-convolution-model.js';
import { seriesLesson } from '../../src/signals-series-model.js';
import { convolutionLesson } from '../../src/signals-convolution-model.js';
import { CUSTOM_FIELDS, customDefaults, parseCustomInput } from '../../src/signals-custom-input.js';
import { createSignalsCourseController, SIGNALS_REGISTRY } from '../../src/signals-course-controller.js';

const LESSONS = Object.fromEntries(Object.entries(SIGNALS_REGISTRY).map(([id, [lesson]]) => [id, lesson]));
const familiesOf = (lesson) => (lesson.families ? lesson.families.map((f) => f.value) : [lesson.initialFamily]);

// Parameter sets at the slider extremes plus the initial values.
function paramSets(lesson, family) {
  const controls = lesson.controls(family, {});
  const make = (pick) => Object.fromEntries(controls.map((c) => [c.key, pick(c)]));
  return [make((c) => c.initial), make((c) => c.min), make((c) => c.max), make((c) => (c.min + c.max) / 2)];
}

test('lessons registry: ids unique, every lesson has a pure model and a view factory, the skeleton is shared', () => {
  const ids = SIGNALS_LESSONS.map((l) => l.id);
  assert.equal(new Set(ids).size, ids.length, 'unique ids');
  assert.deepEqual(Object.keys(LESSONS), ids);
  for (const [id, [lesson, createView]] of Object.entries(SIGNALS_REGISTRY)) {
    assert.equal(typeof lesson, 'object', id);
    assert.equal(typeof createView, 'function', `${id}: view`);
    assert.equal(typeof lesson.describe === 'function' || id === 'convolution', true, `${id}: describe`);
  }
  assert.ok(SIGNALS_LESSONS.length >= 9);
  for (const [id, lesson] of Object.entries(LESSONS)) {
    assert.equal(lesson.id, id);
    assert.equal(typeof lesson.read, 'function');
    assert.equal(typeof lesson.formula, 'function');
    assert.equal(typeof lesson.controls, 'function');
    assert.ok(familiesOf(lesson).includes(lesson.initialFamily), id);
  }
});

test('control strip: 1-3 sliders per example plus up to two choice selects (axis, scale), no calculate/apply controls', () => {
  for (const [id, lesson] of Object.entries(LESSONS)) {
    for (const family of familiesOf(lesson)) {
      const controls = lesson.controls(family, {});
      const sliders = controls.filter((c) => !c.options);
      const choices = controls.filter((c) => c.options);
      const fixed = id === 'convolution' && (isCustomFamily(family) || family.startsWith('dt-')); // scrubber only
      const limit = id === 'lti' && family === 'forced' ? 4 : 3; // + the input amplitude A of the forced response
      assert.ok(sliders.length <= limit && (sliders.length >= 1 || fixed) && choices.length <= 2, `${id}/${family}: ${sliders.length}+${choices.length}`);
      for (const c of choices) assert.ok(c.integer && c.min === 0 && c.max === c.options.length - 1 && c.options.length >= 2, `${id}/${family}/${c.key}`);
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
      if (!spec) continue; // lti: only the step-response example has a time marker
      assert.ok(spec.min < spec.max && spec.step > 0 && spec.initial >= spec.min && spec.initial <= spec.max, `${id}/${family}`);
    }
  }
  assert.equal(timeLesson.scrub, false);
  assert.equal(convolutionLesson.scrub, true);
  assert.equal(seriesLesson.scrub, true);
  assert.equal(LESSONS.lti.scrub, false);
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
  for (const family of familiesOf(timeLesson).filter((f) => f !== 'up')) {
    const controls = timeLesson.controls(family, {});
    const { params } = timeLesson.normalize(family, { a: 0, b: 0 });
    const a = controls.find((c) => c.key === 'a');
    assert.ok(params.a >= a.min && params.a <= a.max && params.a !== 0);
  }
  const up = timeLesson.normalize('up', { L: 0, b: 1.4 });
  assert.deepEqual([up.params.L, up.params.b], [1, 1]);
  for (const [id, lesson] of Object.entries(LESSONS)) if (id !== 'time') assert.equal(lesson.normalize, undefined, id);
});

// ---- series view: the phase pane's ticks do not stay drawn when the pane is hidden (fake DOM, no browser) ----------
function fakeNode(tag) {
  const attrs = new Map();
  const node = {
    tag, children: [], style: {}, hidden: false, textContent: '', parent: null,
    classList: { toggle() {}, add() {}, remove() {} },
    setAttribute(key, value) { attrs.set(key, String(value)); },
    getAttribute: (key) => attrs.get(key) ?? null,
    append(...items) { for (const item of items) { if (typeof item === 'object') item.parent = node; node.children.push(item); } },
    addEventListener() {}, remove() {}, focus() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 400 }),
  };
  return node;
}
const fakeDoc = {
  createElement: (tag) => fakeNode(tag),
  createElementNS: (ns, tag) => fakeNode(tag),
  createTextNode: (text) => ({ data: text }),
};
const walk = (node, visit) => { visit(node); for (const child of node.children ?? []) if (child && child.tag) walk(child, visit); };

test('series view: switching to the one-sided / power spectrum hides the phase pane axes too (no tick node stays visible)', async () => {
  const { createSeriesView } = await import('../../src/signals-series-view.js');
  const host = fakeNode('div');
  const view = createSeriesView({ doc: fakeDoc, parent: host, emit() {} });
  view.layout(900);
  const state = (spec) => ({ family: 'pulse', params: { N: 7, T0: 1, D: 0.5, spec, axis: 0 }, cursor: 0.25 });
  const drawnTicks = () => {
    let drawn = 0;
    let pane = null;
    walk(view.root, (n) => { if (n.getAttribute?.('class') === 'sg-pane') pane = n; });
    const panes = [];
    walk(view.root, (n) => { if (n.getAttribute?.('class') === 'sg-pane') panes.push(n); });
    pane = panes.at(-1); // the phase pane is the last one created
    walk(pane, (n) => {
      const cls = n.getAttribute('class');
      if ((cls === 'sg-tick' || cls === 'sg-grid' || cls === 'sg-axis') && n.getAttribute('visibility') !== 'hidden') drawn += 1;
    });
    return { drawn, root: pane.getAttribute('visibility') };
  };
  view.update(state(0));
  const shown = drawnTicks();
  assert.equal(shown.root, 'visible');
  assert.ok(shown.drawn > 5, 'the two-sided spectrum draws phase ticks');
  for (const spec of [1, 2]) {
    view.update(state(spec));
    assert.deepEqual(drawnTicks(), { drawn: 0, root: 'hidden' }, 'spec ' + spec);
  }
  view.update(state(0));
  assert.ok(drawnTicks().drawn > 5, 'the ticks come back with the phase pane');
});

// ---- frequency response view: dragging the |H| plot moves the input frequency (fake DOM that records the listeners) ----
test('freq view: pressing and dragging the |H| plot emits the input frequency, the arrow keys step it, the train example has no drag', async () => {
  const { createFreqView } = await import('../../src/signals-freq-view.js');
  const listeners = new Map();
  const recording = (tag) => {
    const node = fakeNode(tag);
    node.addEventListener = (type, fn) => { listeners.set(`${node.getAttribute('class') ?? tag}:${type}`, fn); };
    return node;
  };
  const doc = { createElement: (tag) => fakeNode(tag), createElementNS: (ns, tag) => recording(tag), createTextNode: (text) => ({ data: text }) };
  const emitted = [];
  const view = createFreqView({ doc, parent: fakeNode('div'), emit: (patch) => emitted.push(patch) });
  view.layout(900);
  const state = (family, params) => ({ family, params });
  const rc = state('rc', { fc: 80, fin: 20, phi: 0, axis: 0, scale: 0 });
  view.update(rc);
  const down = listeners.get('sg-svg sg-drag:pointerdown');
  const move = listeners.get('sg-svg sg-drag:pointermove');
  assert.ok(down && move, 'the svg listens to pointerdown/move');
  const at = (x, y = 40) => ({ button: 0, clientX: x, clientY: y, pointerId: 1, preventDefault() {} });
  down(at(700)); // right of the centre of the |H| plot (800 css px wide fake box, 900 user units)
  assert.equal(emitted.length, 1);
  const first = emitted[0].params.fin;
  assert.ok(first > 20 && first <= 500 && first % 5 === 0, `fin ${first} is on the slider grid`);
  move(at(600));
  assert.ok(emitted[1].params.fin < first, 'dragging back left lowers the frequency');
  down(at(400, 700)); // below the two response panes (the time pane): no frequency change
  assert.equal(emitted.length, 2);
  // keys: the model-side step of the slider
  assert.deepEqual(view.onKey({ key: 'ArrowRight' }, rc), { params: { fin: 25 } });
  assert.deepEqual(view.onKey({ key: 'ArrowLeft', shiftKey: true }, rc), { params: { fin: -30 } }); // clamped to the slider by the controller
  assert.deepEqual(view.onKey({ key: 'End' }, rc), { params: { fin: 500 } });
  assert.equal(view.onKey({ key: 'a' }, rc), null);
  // the train example is not draggable
  const train = state('train', { N: 20, d: 0.2, fc: 80, axis: 0 });
  view.update(train);
  down(at(700));
  assert.equal(emitted.length, 2);
  assert.equal(view.onKey({ key: 'ArrowRight' }, train), null);
});

test('symbols: duty cycle is d (not D), the convolution integration step is Δλ, the DT phase carries its rad unit', () => {
  assert.equal(seriesLesson.controls('pulse', {}).find((c) => c.key === 'D').label, 'd 듀티 (τ/T₀)');
  assert.match(seriesLesson.read('pulse'), /d=τ\/T₀/);
  assert.match(seriesLesson.formula('pulse', {}), /c₀=d, cₖ=d sinc\(kd\)/);
  assert.doesNotMatch(seriesLesson.formula('pulse0', {}), /sinc\(kD\)/);
  assert.equal(CUSTOM_FIELDS.custom.find((f) => f.key === 'dt').label, '적분 간격 Δλ [s]');
  const theta = LESSONS.ops.controls('dt-pi', {}).find((c) => c.key === 'theta');
  assert.deepEqual([theta.label, theta.unit], ['θ 위상', 'π rad']);
});
