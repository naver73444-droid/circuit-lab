// Editor state of the magnetostatic sandbox: current sources, selection, drag and undo history. Pure: no DOM.
// Same contract as the charge editor (em-playground-state): edits apply live, an invalid patch keeps the old value and sets
// `error`, undo records one step per drag, per burst of live edits to one source, and per add / remove / reset / preset.
// The sensor and the viewed plane stay with the charge editor (they are view state shared by both field modes); this editor
// only owns the sources, so switching between 전기 and 자기 hides one set without deleting it.
import { PointChargeInputError, validatePoint } from './em-playground-physics.js';
import {
  MAX_CURRENT_SOURCES, MAX_LOOP_RADIUS, MIN_LOOP_RADIUS, planeBasis, validateCurrentSources,
} from './em-current-field.js';
import { add3, cross3, dot3, norm3, scale3, sub3 } from './em-physics.js';

const clone = value => structuredClone(value);
const PLANES = ['xy', 'xz', 'yz'];

export const DEFAULT_CURRENTS = Object.freeze([
  { id: 'I1', type: 'wire', current: 10, position: [0, 0, 0], direction: [0, 0, 1], enabled: true, visible: true },
]);

export const currentCenter = source => (source.type === 'segment' ? source.start.map((value, i) => (value + source.end[i]) / 2) : source.position);

const ID_PREFIX = { wire: 'W', segment: 'S', loop: 'L', sheet: 'K' };

export function createCurrentEditor(initial = {}) {
  let revision = 0;
  const counters = {};
  const state = {
    sources: validateCurrentSources(initial.sources ?? clone(DEFAULT_CURRENTS)),
    selectedId: initial.selectedId ?? null,
    error: null, drag: null, edit: null, past: [], future: [], revision,
  };
  if (initial.selectedId === undefined) state.selectedId = state.sources[0]?.id ?? null;

  const mark = () => { revision += 1; state.revision = revision; };
  const snapshot = () => ({ sources: clone(state.sources), selectedId: state.selectedId });
  const record = before => { state.past.push(before); state.future = []; };
  const restore = saved => {
    state.sources = clone(saved.sources);
    state.selectedId = saved.selectedId && state.sources.some(source => source.id === saved.selectedId) ? saved.selectedId : null;
    state.error = null; state.drag = null; state.edit = null;
    mark();
  };
  const selected = () => state.sources.find(source => source.id === state.selectedId) ?? null;
  const freshId = type => {
    const used = new Set(state.sources.map(source => source.id));
    const prefix = ID_PREFIX[type] ?? 'X';
    counters[prefix] ??= 1;
    while (used.has(`${prefix}${counters[prefix]}`)) counters[prefix] += 1;
    return `${prefix}${counters[prefix]++}`;
  };
  const fail = error => { state.error = error instanceof Error ? error.message : String(error); mark(); return false; };
  const settleEdit = () => {
    const { edit } = state;
    if (!edit) return;
    state.edit = null;
    if (JSON.stringify(edit.before.sources) !== JSON.stringify(state.sources)) record(edit.before);
  };
  const addSource = source => {
    settleEdit();
    if (state.sources.length >= MAX_CURRENT_SOURCES) { fail(`전류 원천은 최대 ${MAX_CURRENT_SOURCES}개입니다.`); return null; }
    const before = snapshot(), id = freshId(source.type);
    try { state.sources = validateCurrentSources([...state.sources, { id, enabled: true, visible: true, ...source }]); }
    catch (error) { fail(error); return null; }
    state.selectedId = id;
    record(before);
    state.error = null;
    mark();
    return id;
  };

  // The in-plane unit vector from a loop's centre toward its radius handle (also used by the plane geometry).
  const radiusDirection = (source, plane) => {
    const { a, n } = planeBasis(plane), across = cross3(source.normal, n), length = norm3(across);
    return length > 1e-9 ? scale3(across, 1 / length) : a;
  };

  const editor = {
    state,
    inspect: () => clone(state),
    radiusDirection,

    select(id) {
      if (id != null && !state.sources.some(source => source.id === id)) return false;
      settleEdit();
      if (state.drag) editor.cancelDrag();
      state.selectedId = id;
      state.error = null;
      mark();
      return true;
    },
    add: addSource,
    addWire: (current = 10, position = [0, 0, 0], direction = [0, 0, 1]) => addSource({ type: 'wire', current, position, direction }),
    addSegment: (current = 10, start = [-0.75, 0, 0], end = [0.75, 0, 0]) => addSource({ type: 'segment', current, start, end }),
    addLoop: (current = 10, position = [0, 0, 0], radius = 0.5, normal = [1, 0, 0]) => addSource({ type: 'loop', current, position, radius, normal }),
    addSheet: (K = 20, position = [0, 0, 0], normal = [0, 1, 0], direction = [0, 0, 1]) => addSource({ type: 'sheet', K, position, normal, direction }),
    /** Copy the selected source 0.3 m along the horizontal axis of the viewed `plane` (x for xy / xz, y for yz), so it never lands on the original. */
    cloneSelected(plane = 'xy') {
      const source = selected();
      if (!source) return null;
      const across = planeBasis(plane).axes[0];
      const shift = value => value.map((component, axis) => component + (axis === across ? 0.3 : 0));
      const { id, ...rest } = clone(source);
      if (source.type === 'segment') return addSource({ ...rest, start: shift(source.start), end: shift(source.end) });
      return addSource({ ...rest, position: shift(source.position) });
    },
    removeSelected() {
      settleEdit();
      const index = state.sources.findIndex(source => source.id === state.selectedId);
      if (index < 0) return false;
      const before = snapshot();
      state.sources = state.sources.filter((_, i) => i !== index);
      state.selectedId = null; state.drag = null; state.error = null;
      record(before);
      mark();
      return true;
    },
    /** Replace everything (the presets). One undo step. Returns the selected id. */
    load(sources, selectedId = null) {
      settleEdit();
      if (state.drag) editor.cancelDrag();
      let validated;
      try { validated = validateCurrentSources(sources); } catch (error) { fail(error); return null; }
      const before = snapshot();
      state.sources = validated;
      state.selectedId = validated.some(source => source.id === selectedId) ? selectedId : validated[0]?.id ?? null;
      state.error = null;
      Object.keys(counters).forEach(key => { delete counters[key]; });
      record(before);
      mark();
      return state.selectedId;
    },
    /** Replace everything from a validated project file (the history is cleared, unlike load()). */
    replaceWorld({ sources, selectedId = null }) {
      const validated = validateCurrentSources(sources);
      if (selectedId != null && !validated.some(source => source.id === selectedId)) throw new PointChargeInputError('선택 ID가 저장 전류 원천에 없습니다.');
      Object.assign(state, { sources: validated, selectedId, drag: null, edit: null, error: null, past: [], future: [] });
      Object.keys(counters).forEach(key => { delete counters[key]; });
      mark();
      return true;
    },
    /** Back to the default single wire. One undo step. */
    reset() { return editor.load(clone(DEFAULT_CURRENTS), DEFAULT_CURRENTS[0].id) !== null; },
    setEnabled(id, enabled) {
      settleEdit();
      const index = state.sources.findIndex(source => source.id === id);
      if (index < 0) return false;
      const before = snapshot();
      state.sources[index] = { ...state.sources[index], enabled: Boolean(enabled) };
      record(before);
      mark();
      return true;
    },

    updateSource(id, patch) {
      const index = state.sources.findIndex(source => source.id === id);
      if (index < 0) return false;
      if (state.drag) editor.cancelDrag();
      if (state.edit && state.edit.id !== id) settleEdit();
      const next = clone(state.sources);
      next[index] = { ...next[index], ...clone(patch) };
      let validated;
      try { validated = validateCurrentSources(next); } catch (error) { return fail(error); }
      state.edit ??= { id, before: snapshot() };
      state.sources = validated;
      state.error = null;
      mark();
      return true;
    },
    endEdit() { if (state.edit) { settleEdit(); mark(); } },

    beginDrag(id, plane = 'xy', handle = 'body', anchor = null) {
      settleEdit();
      const source = state.sources.find(item => item.id === id);
      if (!source || !PLANES.includes(plane)) return false;
      state.selectedId = id;
      state.drag = {
        id, plane, handle, anchor: anchor ? [...anchor] : [...currentCenter(source)], before: snapshot(), sourceBefore: clone(source),
      };
      state.error = null;
      mark();
      return true;
    },
    previewDrag(position) {
      const { drag } = state;
      if (!drag) return false;
      try {
        const target = validatePoint(position, '끌기 좌표');
        const index = state.sources.findIndex(source => source.id === drag.id);
        if (index < 0) return false;
        const source = drag.sourceBefore, delta = sub3(target, drag.anchor), next = clone(state.sources);
        const { n } = planeBasis(drag.plane);
        if (source.type === 'segment') {
          if (drag.handle === 'start') next[index] = { ...next[index], start: target };
          else if (drag.handle === 'end') next[index] = { ...next[index], end: target };
          else next[index] = { ...next[index], start: add3(source.start, delta), end: add3(source.end, delta) };
        } else if (source.type === 'loop' && drag.handle === 'radius') {
          const radius = norm3(sub3(target, source.position));
          next[index] = { ...next[index], radius: Math.min(MAX_LOOP_RADIUS, Math.max(MIN_LOOP_RADIUS, radius)) };
        } else if (source.type === 'sheet' && drag.handle === 'rotate') {
          const flat = sub3(target, source.position), line = sub3(flat, scale3(n, dot3(flat, n)));
          if (norm3(line) < 1e-6) return true;
          const t = scale3(line, 1 / norm3(line)), oldT = cross3(n, source.normal), outOfPlane = Math.abs(dot3(source.direction, n)) >= 0.5;
          const sign = Math.sign(dot3(source.direction, outOfPlane ? n : oldT)) || 1;
          next[index] = { ...next[index], normal: cross3(n, t), direction: scale3(outOfPlane ? n : t, sign) };
        } else next[index] = { ...next[index], position: add3(source.position, delta) };
        state.sources = validateCurrentSources(next);
        mark();
        return true;
      } catch (error) { return fail(error); }
    },
    commitDrag(position = null) {
      const { drag } = state;
      if (!drag) return false;
      if (position && !editor.previewDrag(position)) {
        const message = state.error;
        editor.cancelDrag();
        state.error = message;
        mark();
        return false;
      }
      const source = state.sources.find(item => item.id === drag.id);
      state.drag = null;
      if (!source || JSON.stringify(source) === JSON.stringify(drag.sourceBefore)) { mark(); return false; }
      record(drag.before);
      state.error = null;
      mark();
      return true;
    },
    cancelDrag() {
      const { drag } = state;
      if (!drag) return false;
      state.sources = clone(drag.before.sources);
      state.selectedId = drag.before.selectedId;
      state.drag = null; state.error = null;
      mark();
      return true;
    },

    undo() {
      settleEdit();
      if (state.drag) editor.cancelDrag();
      const previous = state.past.pop();
      if (!previous) return false;
      state.future.push(snapshot());
      restore(previous);
      return true;
    },
    redo() {
      settleEdit();
      if (state.drag) editor.cancelDrag();
      const next = state.future.pop();
      if (!next) return false;
      state.past.push(snapshot());
      restore(next);
      return true;
    },
  };
  return editor;
}
