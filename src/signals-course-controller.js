// Signals workspace controller: lesson tabs, one control strip, one live view per lesson.
// Everything repaints from `input` events, coalesced into one requestAnimationFrame.
// Playback policy: it pauses when the tab is hidden or the window loses focus (and resumes after), a plot drag, key or
// scrubber input takes it over for good, and parameter sliders do NOT stop it (the animation keeps running while you
// turn a knob). prefers-reduced-motion switches AUTO-play off (and stops a running one); a press on the play button
// still plays.
import { SIGNALS_LESSONS } from './signals-course-model.js';
import { ensureCourseStyle } from './course-style.js';
import { SIGNALS_STYLE } from './signals-style.js';
import { appendCourseMath } from './course-math-view.js';
import { clamp, controlDefaults, formatQuantity } from './signals-util.js';
import { playbackCursor } from './signals-playback.js';
import { CUSTOM_FIELDS, CUSTOM_HELP, customDefaults, parseCustomInput } from './signals-custom-input.js';
import { timeLesson } from './signals-time-model.js';
import { convolutionLesson, isCustomFamily } from './signals-convolution-model.js';
import { seriesLesson } from './signals-series-model.js';
import { transformLesson } from './signals-transform-model.js';
import { rocLesson } from './signals-roc-model.js';
import { samplingLesson } from './signals-sampling-model.js';
import { createTimeView } from './signals-time-view.js';
import { createConvolutionView } from './signals-convolution-view.js';
import { createSeriesView } from './signals-series-view.js';
import { createTransformView } from './signals-transform-view.js';
import { createRocView } from './signals-roc-view.js';
import { createSamplingView } from './signals-sampling-view.js';

const REGISTRY = {
  time: [timeLesson, createTimeView],
  convolution: [convolutionLesson, createConvolutionView],
  series: [seriesLesson, createSeriesView],
  fourier: [transformLesson, createTransformView],
  roc: [rocLesson, createRocView],
  sampling: [samplingLesson, createSamplingView],
};

export function createSignalsCourseController(host) {
  if (!host || typeof host.querySelector !== 'function') throw new TypeError('신호 학습 패널 host가 필요합니다.');
  const doc = host.ownerDocument;
  const win = doc.defaultView;
  const motion = win.matchMedia?.('(prefers-reduced-motion: reduce)');
  const states = new Map();
  const views = new Map();
  let lessonId = SIGNALS_LESSONS[0].id;
  let active = false;
  let destroyed = false;
  let mounted = false;
  let frame = 0;
  let playTimer = 0;
  let layoutWidth = 0;
  let resizer = null;
  const ui = {};

  // ---------------------------------------------------------------- state
  const lessonOf = (id = lessonId) => REGISTRY[id][0];
  const defaultsOf = (lesson, family) => controlDefaults(lesson.controls(family, {}));
  function makeState(id) {
    const lesson = lessonOf(id);
    const state = {
      family: lesson.initialFamily,
      params: defaultsOf(lesson, lesson.initialFamily),
      saved: {},
      cursor: 0,
      extra: { drafts: customDefaults(), custom: null, customFamily: null, error: '' },
      note: '',
      playing: Boolean(lesson.scrub) && !motion?.matches,
    };
    state.cursor = lesson.cursor?.(state.family, state.params, state.extra)?.initial ?? 0;
    return state;
  }
  for (const { id } of SIGNALS_LESSONS) states.set(id, makeState(id));
  const current = () => states.get(lessonId);

  const cursorSpec = (state = current()) => lessonOf().cursor?.(state.family, state.params, state.extra) ?? null;

  // The one-line hint under the plot, plus the note about a value that had to be moved (a = 0).
  const readText = (state) => {
    const text = lessonOf().read(state.family, state.params);
    return state.note ? `${text} (${state.note})` : text;
  };

  function clampCursor(state) {
    const spec = cursorSpec(state);
    if (!spec) return;
    const value = clamp(state.cursor, spec.min, spec.max);
    state.cursor = spec.discrete ? Math.round(value) : value;
  }

  // ---------------------------------------------------------------- DOM helpers
  function el(tag, attrs = {}, parent = null, text) {
    const node = doc.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    if (text !== undefined) node.textContent = text;
    parent?.append(node);
    return node;
  }

  function mount() {
    ensureCourseStyle(host, 'signals-course', SIGNALS_STYLE);
    host.replaceChildren();
    ui.root = el('div', { class: 'sg' }, host);
    ui.tabs = el('nav', { class: 'sg-tabs', 'aria-label': '학습 단계' }, ui.root);
    for (const lesson of SIGNALS_LESSONS) {
      el('button', { type: 'button', 'data-signals-lesson': lesson.id, title: lesson.title }, ui.tabs, lesson.tab);
    }
    ui.head = el('div', { class: 'sg-head' }, ui.root);
    ui.title = el('h2', {}, ui.head);
    ui.controls = el('section', { class: 'sg-controls', 'aria-label': '조건 슬라이더' }, ui.root);
    ui.stage = el('div', { class: 'sg-stage' }, ui.root);
    ui.read = el('p', { class: 'sg-read', 'data-signals-read': '' }, ui.root);
    ui.live = el('p', { class: 'sg-live', 'data-signals-live': '' }, ui.root);
    ui.status = el('p', { class: 'sg-status', role: 'status', 'data-signals-status': '' }, ui.root);
    buildAdvanced();
    ui.formula = el('details', { class: 'sg-details', 'data-signals-formula-box': '' }, ui.root);
    el('summary', {}, ui.formula, '핵심 수식');
    ui.formulaBody = el('div', { 'data-signals-formula': '' }, ui.formula);
    ui.formula.addEventListener('toggle', () => { ui.formulaSource = null; schedule(); });
    if (typeof win.ResizeObserver === 'function') {
      resizer = new win.ResizeObserver(() => schedule());
      resizer.observe(ui.stage);
    }
    mounted = true;
  }

  function buildAdvanced() {
    ui.advanced = el('details', { class: 'sg-details sg-advanced', 'data-signals-advanced': '' }, ui.root);
    el('summary', {}, ui.advanced, '고급 입력 (수식 · 수열 직접 입력)');
    const fields = el('div', { class: 'sg-fields' }, ui.advanced);
    for (const [group, list] of Object.entries(CUSTOM_FIELDS)) {
      for (const field of list) {
        const label = el('label', {}, fields, field.label);
        const input = el('input', {
          type: 'text', spellcheck: 'false', autocomplete: 'off',
          'data-signals-field': field.key, 'data-signals-group': group,
          ...(field.maxLength ? { maxlength: field.maxLength } : {}),
        }, label);
        input.value = field.initial;
      }
    }
    el('p', { class: 'sg-help' }, fields, CUSTOM_HELP);
  }

  // ---------------------------------------------------------------- control strip
  function buildControls() {
    const lesson = lessonOf();
    const state = current();
    ui.controls.replaceChildren();
    ui.sliders = new Map();
    if (lesson.families) {
      const wrap = el('label', { class: 'sg-ctl' }, ui.controls);
      el('span', { class: 'sg-name' }, wrap, '예시');
      ui.select = el('select', { 'data-signals-family': '' }, wrap);
      for (const family of lesson.families) el('option', { value: family.value }, ui.select, family.label);
      ui.select.value = state.family;
    } else ui.select = null;
    ui.dynamic = el('div', { class: 'sg-dyn' }, ui.controls);
    buildDynamicControls();
  }

  function buildDynamicControls() {
    const lesson = lessonOf();
    const state = current();
    ui.dynamic.replaceChildren();
    ui.sliders.clear();
    for (const spec of lesson.controls(state.family, state.params)) {
      const wrap = el('label', { class: 'sg-ctl' }, ui.dynamic);
      el('span', { class: 'sg-name' }, wrap, spec.label);
      const output = el('output', { 'aria-live': 'off' }, wrap);
      const input = el('input', {
        type: 'range', min: spec.min, max: spec.max, step: spec.step, 'data-signals-param': spec.key,
        'aria-label': spec.label,
      }, wrap);
      ui.sliders.set(spec.key, { spec, input, output });
    }
    const scrub = cursorSpec(state);
    ui.scrub = null;
    if (lesson.scrub && scrub) {
      const wrap = el('div', { class: 'sg-ctl sg-scrub' }, ui.dynamic);
      el('span', { class: 'sg-name' }, wrap, scrub.discrete ? '관측 위치 n (정수)' : '관측 시각 (플롯을 끌거나 ←/→)');
      const play = el('button', { type: 'button', 'data-signals-play': '' }, wrap, '재생');
      const input = el('input', { type: 'range', 'data-signals-cursor': '', 'aria-label': '관측 위치' }, wrap);
      const output = el('output', { 'aria-live': 'off' }, wrap);
      ui.scrub = { play, input, output };
    }
  }

  const cursorText = (spec, value) => `${spec.symbol} = ${formatQuantity(value, spec.unit === 's' ? 's' : '')}`;

  function syncControls() {
    const state = current();
    for (const { spec, input, output } of ui.sliders.values()) {
      const value = state.params[spec.key];
      if (Number(input.value) !== value) input.value = String(value);
      output.textContent = formatQuantity(value, spec.unit);
      input.setAttribute('aria-valuetext', output.textContent);
    }
    const spec = cursorSpec(state);
    if (ui.scrub && spec) {
      const { play, input, output } = ui.scrub;
      input.min = spec.min; input.max = spec.max; input.step = spec.discrete ? 1 : 'any';
      if (Number(input.value) !== state.cursor) input.value = String(state.cursor);
      output.textContent = cursorText(spec, state.cursor);
      input.setAttribute('aria-valuetext', output.textContent);
      const playing = playTimer !== 0;
      play.textContent = playing ? '일시정지' : '재생';
      play.title = motion?.matches ? '움직임 줄이기 설정이라 자동 재생은 꺼져 있습니다. 눌러서 직접 재생합니다.' : '';
    }
  }

  // ---------------------------------------------------------------- lessons and views
  function ensureView(id) {
    if (!views.has(id)) {
      const [, createView] = REGISTRY[id];
      views.set(id, createView({ doc, parent: ui.stage, emit: (patch) => applyPatch(patch) }));
    }
    return views.get(id);
  }

  function showLesson(id) {
    stopPlayback();
    lessonId = id;
    const state = current();
    ensureView(id);
    for (const [other, v] of views) v.root.hidden = other !== id;
    for (const button of ui.tabs.querySelectorAll('[data-signals-lesson]')) {
      if (button.dataset.signalsLesson === id) button.setAttribute('aria-current', 'step');
      else button.removeAttribute('aria-current');
    }
    ui.title.textContent = SIGNALS_LESSONS.find((l) => l.id === id).title;
    ui.read.textContent = readText(state);
    ui.advanced.hidden = id !== 'convolution';
    if (id === 'convolution' && isCustomFamily(state.family)) applyCustom();
    clampCursor(state);
    buildControls();
    layoutWidth = 0;
    ui.formulaSource = null;
    ui.status.textContent = state.extra.error;
    autoPlay();
  }

  function setFamily(family) {
    const state = current();
    const lesson = lessonOf();
    if (!lesson.families?.some((f) => f.value === family) || family === state.family) return;
    stopPlayback();
    state.saved[state.family] = { params: state.params, cursor: state.cursor };
    state.family = family;
    const restored = state.saved[family];
    state.params = restored?.params ?? defaultsOf(lesson, family);
    state.note = '';
    if (lessonId === 'convolution' && isCustomFamily(family)) applyCustom();
    const spec = cursorSpec(state);
    state.cursor = restored?.cursor ?? spec?.initial ?? 0;
    clampCursor(state);
    if (ui.select) ui.select.value = family;
    buildDynamicControls();
    ui.read.textContent = readText(state);
    ui.formulaSource = null;
    if (lessonId === 'convolution' && isCustomFamily(family)) ui.advanced.open = true;
    autoPlay();
    schedule();
  }

  // views and the keyboard report changes as patches: { cursor?, params? }
  function applyPatch(patch) {
    const state = current();
    if (patch.params) {
      const controls = lessonOf().controls(state.family, state.params);
      for (const [key, value] of Object.entries(patch.params)) {
        const spec = controls.find((c) => c.key === key);
        if (!spec || !Number.isFinite(value)) continue;
        const next = clamp(spec.integer ? Math.round(value) : value, spec.min, spec.max);
        state.params[key] = next;
      }
      // Values the lesson cannot use (a = 0) are written back so the slider jumps to what is really drawn.
      const normalized = lessonOf().normalize?.(state.family, state.params);
      if (normalized) {
        Object.assign(state.params, normalized.params);
        state.note = normalized.note;
      }
    }
    if (patch.cursor !== undefined && Number.isFinite(patch.cursor)) {
      stopPlayback(true);
      state.cursor = patch.cursor;
    }
    clampCursor(state);
    schedule();
  }

  // ---------------------------------------------------------------- advanced convolution input
  function applyCustom() {
    const state = current();
    const { family, extra } = state;
    try {
      extra.custom = parseCustomInput(family, extra.drafts);
      extra.customFamily = family;
      extra.error = '';
      const spec = cursorSpec(state);
      if (spec && extra.lastCustomFamily !== family) state.cursor = spec.initial;
      extra.lastCustomFamily = family;
      // The scrubber only exists while there is a valid input to scrub: build it when the first one arrives.
      if (lessonOf().scrub && spec && !ui.scrub) buildDynamicControls();
    } catch (error) {
      extra.error = error.message;
      // A previous valid input of the same kind stays on screen; one of the other kind (or none) would be wrong
      // for this example, so the view shows its empty state instead.
      if (extra.customFamily !== family) extra.custom = null;
    }
    ui.status.textContent = extra.error;
  }

  // ---------------------------------------------------------------- playback
  // startPlayback is the user-level "play": it ignores prefers-reduced-motion. autoPlay is what activation, lesson
  // changes and returning focus use, and it respects the setting.
  function startPlayback() {
    const spec = cursorSpec();
    if (playTimer || !active || !spec || doc.hidden) return;
    const state = current();
    if (!spec.loop && state.cursor >= spec.max) state.cursor = spec.min;
    const origin = { time: 0, cursor: state.cursor };
    const tick = (timestamp) => {
      onMotion();
      if (!playTimer) return;
      if (!active || destroyed || doc.hidden) { stopPlayback(); return; }
      const s = current();
      const range = cursorSpec(s);
      if (!range) { stopPlayback(); return; }
      origin.time ||= timestamp;
      s.cursor = playbackCursor(origin.cursor, timestamp - origin.time, range, 1, Boolean(range.discrete), Boolean(range.loop));
      // Reaching the end finishes the animation for good: coming back to the tab must not restart it by itself.
      if (!range.loop && s.cursor >= range.max) stopPlayback(true);
      paint();
      if (playTimer) playTimer = win.requestAnimationFrame(tick);
    };
    playTimer = win.requestAnimationFrame(tick);
    syncControls();
  }

  function autoPlay() {
    if (active && lessonOf().scrub && current().playing && !motion?.matches) startPlayback();
  }

  // `user`: the learner took over (drag, key, slider, end reached), so remember that playback is over.
  function stopPlayback(user = false) {
    if (playTimer) { win.cancelAnimationFrame(playTimer); playTimer = 0; }
    if (user) current().playing = false;
    if (ui.scrub) syncControls();
  }

  // ---------------------------------------------------------------- painting
  function schedule() {
    if (frame || !active || destroyed) return;
    frame = win.requestAnimationFrame(() => { frame = 0; paint(); });
  }

  function paint() {
    if (!active || destroyed || !mounted) return;
    const state = current();
    const view = views.get(lessonId);
    const read = readText(state);
    if (ui.read.textContent !== read) ui.read.textContent = read;
    const width = Math.floor(ui.stage.clientWidth);
    if (width > 0 && width !== layoutWidth) { layoutWidth = width; view.layout(width); }
    if (!layoutWidth) return;
    const lesson = lessonOf();
    clampCursor(state);
    syncControls();
    const info = { family: state.family, params: state.params, cursor: state.cursor, extra: state.extra, playing: playTimer !== 0 };
    try {
      view.update(info);
      ui.live.textContent = lesson.describe?.(info) ?? '';
      ui.status.textContent = state.extra.error; // an earlier paint error goes away once a paint succeeds
    } catch (error) {
      ui.status.textContent = error.message;
    }
    if (ui.formula.open) refreshFormula(lesson, state);
  }

  function refreshFormula(lesson, state) {
    const source = lesson.formula(state.family, state.params);
    if (source === ui.formulaSource) return;
    ui.formulaSource = source;
    ui.formulaBody.replaceChildren();
    appendCourseMath(ui.formulaBody, source);
  }

  // ---------------------------------------------------------------- events
  function onInput(event) {
    if (!active || destroyed) return;
    const target = event.target;
    if (target.dataset?.signalsParam) {
      const entry = ui.sliders.get(target.dataset.signalsParam);
      if (entry) applyPatch({ params: { [entry.spec.key]: Number(target.value) } });
    } else if (target.dataset?.signalsCursor !== undefined) {
      applyPatch({ cursor: Number(target.value) });
    } else if (target.dataset?.signalsField) {
      const state = current();
      const group = target.dataset.signalsGroup;
      state.extra.drafts[target.dataset.signalsField] = target.value;
      if (state.family !== group) setFamily(group);
      applyCustom();
      schedule();
    }
  }

  function onChange(event) {
    if (!active || destroyed) return;
    if (event.target.dataset?.signalsFamily !== undefined) setFamily(event.target.value);
  }

  function onClick(event) {
    if (!active || destroyed) return;
    const button = event.target.closest?.('button');
    if (!button || !host.contains(button)) return;
    if (button.dataset.signalsLesson) {
      showLesson(button.dataset.signalsLesson);
      paint();
    } else if (button.hasAttribute('data-signals-play')) {
      if (playTimer) stopPlayback(true);
      else { current().playing = true; startPlayback(); }
    }
  }

  function onKeyDown(event) {
    if (!active || destroyed || !event.target.classList?.contains('sg-svg')) return;
    const state = current();
    const view = views.get(lessonId);
    const patch = view.onKey?.(event, { family: state.family, params: state.params, cursor: state.cursor });
    if (patch) { applyPatch(patch); event.preventDefault(); return; }
    const spec = cursorSpec(state);
    if (!spec) return;
    const unit = (event.shiftKey ? 10 : 1) * (spec.discrete ? 1 : spec.step);
    if (event.key === ' ' && lessonOf().scrub) {
      if (playTimer) stopPlayback(true); else { state.playing = true; startPlayback(); }
    } else if (event.key === 'ArrowLeft') applyPatch({ cursor: state.cursor - unit });
    else if (event.key === 'ArrowRight') applyPatch({ cursor: state.cursor + unit });
    else if (event.key === 'Home') applyPatch({ cursor: spec.min });
    else if (event.key === 'End') applyPatch({ cursor: spec.max });
    else return;
    event.preventDefault();
  }

  const onVisibility = () => { if (doc.hidden) stopPlayback(); else autoPlay(); };
  const onBlur = () => stopPlayback();
  const onFocus = () => autoPlay();
  // Turning "reduce motion" on stops a running animation and keeps it stopped.
  // Reading `matches` elsewhere can use up the browser's change notification, so every animation frame re-checks it too.
  let reduced = Boolean(motion?.matches);
  const onMotion = () => {
    const now = Boolean(motion?.matches);
    if (now === reduced) return;
    reduced = now;
    if (now) stopPlayback(true);
    else if (ui.scrub) syncControls();
  };

  host.addEventListener('input', onInput);
  host.addEventListener('change', onChange);
  host.addEventListener('click', onClick);
  host.addEventListener('keydown', onKeyDown);
  doc.addEventListener('visibilitychange', onVisibility);
  win.addEventListener('blur', onBlur);
  win.addEventListener('focus', onFocus);
  motion?.addEventListener?.('change', onMotion);
  host.hidden = true;
  host.inert = true;

  // Lazy first render: built on the first activate()/inspect(), not at construction.
  function ensureMounted() {
    if (mounted || destroyed) return;
    mount();
    showLesson(lessonId);
  }

  return {
    activate() {
      if (destroyed) return;
      ensureMounted();
      active = true;
      host.hidden = false;
      host.inert = false;
      layoutWidth = 0;
      autoPlay();
      paint();
    },
    deactivate() {
      if (destroyed) return;
      stopPlayback();
      if (frame) { win.cancelAnimationFrame(frame); frame = 0; }
      active = false;
      host.hidden = true;
      host.inert = true;
    },
    inspect() {
      if (destroyed) return { active: false, destroyed: true, lessonId };
      ensureMounted();
      const state = current();
      const lesson = lessonOf();
      return JSON.parse(JSON.stringify({
        active, destroyed, lessonId,
        family: state.family,
        options: { family: state.family },
        params: state.params,
        drafts: state.extra.drafts,
        cursor: state.cursor,
        playing: playTimer !== 0,
        reducedMotion: Boolean(motion?.matches),
        note: state.note,
        status: 'supported',
        numericStatus: state.extra.error ? 'invalid' : 'valid',
        numericError: state.extra.error,
        symbolic: {
          status: 'supported',
          formula: lesson.formula(state.family, state.params),
          read: readText(state),
          live: ui.live?.textContent ?? '',
        },
      }));
    },
    destroy() {
      if (destroyed) return;
      stopPlayback();
      if (frame) win.cancelAnimationFrame(frame);
      resizer?.disconnect();
      active = false;
      host.hidden = true;
      host.inert = true;
      host.removeEventListener('input', onInput);
      host.removeEventListener('change', onChange);
      host.removeEventListener('click', onClick);
      host.removeEventListener('keydown', onKeyDown);
      doc.removeEventListener('visibilitychange', onVisibility);
      win.removeEventListener('blur', onBlur);
      win.removeEventListener('focus', onFocus);
      motion?.removeEventListener?.('change', onMotion);
      for (const view of views.values()) view.destroy();
      views.clear();
      host.replaceChildren();
      states.clear();
      destroyed = true;
    },
  };
}
