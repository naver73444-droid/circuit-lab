// Editor state of the charge sandbox: sources, selection, sensor (probe), plane, drag and undo history.
// Edits apply live: a patch is validated and applied at once, an invalid patch keeps the old value and sets `error`.
// Undo records one step per drag, per burst of live edits to one source, and per add / remove / reset.
import {
  MAX_POINT_SOURCES,
  PointChargeInputError,
  validatePoint,
  validatePointSources,
} from './em-playground-physics.js';

const clone = value => structuredClone(value);

export const DEFAULT_SOURCES = Object.freeze([
  { id: 'q1', q: 1e-9, position: [-0.75, 0, 0], enabled: true, visible: true },
  { id: 'q2', q: -1e-9, position: [0.75, 0, 0], enabled: true, visible: true },
]);

export const sourceCenter = source => (source.type === 'finite-line'
  ? source.start.map((value, axis) => (value + source.end[axis]) / 2) : source.position);

const PLANES = ['xy', 'xz', 'yz'];

export function createPointChargeEditor(initial = {}) {
  let nextId = 1, revision = 0;
  const initialSources = initial.sources ?? clone(DEFAULT_SOURCES);
  const state = {
    sources: validatePointSources(initialSources),
    selectedId: initial.selectedId ?? initialSources[0]?.id ?? null,
    probe: validatePoint(initial.probe ?? [0, 1, 0], '측정점'),
    plane: initial.plane ?? 'xy',
    error: null,
    drag: null,
    edit: null,
    past: [],
    future: [],
    revision,
  };

  const mark = () => { revision += 1; state.revision = revision; };
  // History holds sources and selection only; the sensor is a viewing tool and is never undone.
  const snapshot = () => ({ sources: clone(state.sources), selectedId: state.selectedId });
  const record = before => { state.past.push(before); state.future = []; };
  const restore = saved => {
    state.sources = clone(saved.sources);
    state.selectedId = saved.selectedId && state.sources.some(source => source.id === saved.selectedId) ? saved.selectedId : null;
    state.error = null;
    state.drag = null;
    state.edit = null;
    mark();
  };
  const selected = () => state.sources.find(source => source.id === state.selectedId) ?? null;
  const freshId = () => {
    const used = new Set(state.sources.map(source => source.id));
    while (used.has(`q${nextId}`)) nextId += 1;
    return `q${nextId++}`;
  };
  const fail = error => { state.error = error instanceof Error ? error.message : String(error); mark(); return false; };
  // A burst of live edits becomes one undo step once anything else happens (or endEdit() is called).
  const settleEdit = () => {
    const { edit } = state;
    if (!edit) return;
    state.edit = null;
    if (JSON.stringify(edit.before.sources) !== JSON.stringify(state.sources)) record(edit.before);
  };
  const addSource = source => {
    settleEdit();
    if (state.sources.length >= MAX_POINT_SOURCES) { fail(`원천은 최대 ${MAX_POINT_SOURCES}개입니다.`); return null; }
    const before = snapshot(), id = freshId();
    try { state.sources = validatePointSources([...state.sources, { id, enabled: true, visible: true, ...source }]); }
    catch (error) { fail(error); return null; }
    state.selectedId = id;
    record(before);
    state.error = null;
    mark();
    return id;
  };

  const editor = {
    state,
    inspect: () => clone(state),

    select(id) {
      if (id != null && !state.sources.some(source => source.id === id)) return false;
      settleEdit();
      if (state.drag) editor.cancelDrag();
      state.selectedId = id;
      state.error = null;
      mark();
      return true;
    },
    add: (q = 1e-9, position = [0, 0, 0]) => addSource({ type: 'point', q, position }),
    addFiniteLine: (lambda = 1e-9, start = [-0.75, 0, 0], end = [0.75, 0, 0]) => addSource({ type: 'finite-line', lambda, start, end }),
    addInfiniteLine: (lambda = 1e-9, position = [0, 0, 0], direction = [1, 0, 0], sRef = 1) => addSource({
      type: 'infinite-line', lambda, position, direction, sRef, displayLength: 4,
    }),
    cloneSelected() {
      const source = selected();
      if (!source) return null;
      const shift = value => value.map((component, axis) => component + (axis === 0 ? 0.2 : 0));
      if (source.type === 'finite-line') return editor.addFiniteLine(source.lambda, shift(source.start), shift(source.end));
      if (source.type === 'infinite-line') return editor.addInfiniteLine(source.lambda, shift(source.position), source.direction, source.sRef);
      return editor.add(source.q, shift(source.position));
    },
    removeSelected() {
      settleEdit();
      const index = state.sources.findIndex(source => source.id === state.selectedId);
      if (index < 0) return false;
      const before = snapshot();
      state.sources = state.sources.filter((_, i) => i !== index);
      state.selectedId = null;
      state.drag = null;
      record(before);
      state.error = null;
      mark();
      return true;
    },
    /** Back to the two opposite charges. One undo step. */
    reset() {
      settleEdit();
      if (state.drag) editor.cancelDrag();
      const before = snapshot();
      state.sources = validatePointSources(clone(DEFAULT_SOURCES));
      state.selectedId = state.sources[0].id;
      state.probe = [0, 1, 0];
      state.error = null;
      nextId = 1;
      record(before);
      mark();
      return true;
    },
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

    /** Live edit: merge `patch` into a source, validated as a whole. Invalid input keeps the old source. */
    updateSource(id, patch) {
      const index = state.sources.findIndex(source => source.id === id);
      if (index < 0) return false;
      if (state.drag) editor.cancelDrag();
      if (state.edit && state.edit.id !== id) settleEdit();
      const next = clone(state.sources);
      next[index] = { ...next[index], ...clone(patch) };
      let validated;
      try { validated = validatePointSources(next); } catch (error) { return fail(error); }
      state.edit ??= { id, before: snapshot() };
      state.sources = validated;
      state.error = null;
      mark();
      return true;
    },
    endEdit() { if (state.edit) { settleEdit(); mark(); } },

    setProbe(point) {
      try { state.probe = validatePoint(point, '측정점'); } catch (error) { return fail(error); }
      state.error = null;
      mark();
      return true;
    },
    setPlane(plane) {
      if (!PLANES.includes(plane)) return false;
      if (state.drag) editor.cancelDrag();
      state.plane = plane;
      mark();
      return true;
    },

    beginDrag(id, plane = state.plane, handle = 'body', anchor = null) {
      settleEdit();
      const source = state.sources.find(item => item.id === id);
      if (!source || !PLANES.includes(plane)) return false;
      state.selectedId = id;
      state.drag = {
        id, plane, handle, anchor: anchor ? [...anchor] : sourceCenter(source), before: snapshot(),
        sourceBefore: clone(source), origin: [...sourceCenter(source)],
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
        const source = drag.sourceBefore, delta = target.map((value, axis) => value - drag.anchor[axis]);
        const next = clone(state.sources);
        if (source.type === 'finite-line') {
          if (drag.handle === 'start') next[index] = { ...next[index], start: target };
          else if (drag.handle === 'end') next[index] = { ...next[index], end: target };
          else next[index] = { ...next[index], start: source.start.map((v, i) => v + delta[i]), end: source.end.map((v, i) => v + delta[i]) };
        } else if (source.type === 'infinite-line') {
          if (drag.handle === 'direction') next[index] = { ...next[index], direction: target.map((v, i) => v - source.position[i]) };
          else next[index] = { ...next[index], position: source.position.map((v, i) => v + delta[i]) };
        } else next[index] = { ...next[index], position: target };
        state.sources = validatePointSources(next);
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
      state.drag = null;
      state.error = null;
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

    /** Replace everything from a validated project (history is cleared). */
    replaceWorld(world) {
      const sources = validatePointSources(world.sources), probe = validatePoint(world.probe, '측정점');
      if (!PLANES.includes(world.plane)) throw new PointChargeInputError('EM 단면은 xy/xz/yz 중 하나여야 합니다.');
      const selectedId = world.selectedId == null ? null : String(world.selectedId);
      if (selectedId && !sources.some(source => source.id === selectedId)) throw new PointChargeInputError('선택 ID가 저장 원천에 없습니다.');
      Object.assign(state, {
        sources: clone(sources), probe: [...probe], plane: world.plane, selectedId,
        drag: null, edit: null, error: null, past: [], future: [],
      });
      nextId = 1;
      mark();
      return true;
    },
  };
  return editor;
}
