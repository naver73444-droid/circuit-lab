import { EMInputError, sceneMeasurement } from './em-physics.js';

export const DEFAULT_SCENES = Object.freeze({
  charge: { kind: 'charge', q: 1e-9, position: [0, 0, 0] },
  dipole: { kind: 'dipole', q: 1e-9, separation: 1, axis: [1, 0, 0], center: [0, 0, 0] },
  line: { kind: 'line', current: 1, position: [0, 0, 0], direction: [0, 0, 1] },
  loop: { kind: 'loop', current: 1, radius: 1, center: [0, 0, 0], normal: [0, 0, 1] },
  wave: { kind: 'wave', amplitude: 3, frequency: 1e6, phase: 0, direction: [0, 0, 1], polarization: [1, 0, 0] },
});

export function createEMState() {
  let revision = 0;
  const state = {
    active: false, destroyed: false, sceneName: 'charge',
    models: structuredClone(DEFAULT_SCENES), draft: {}, point: [1, 0, 0], slice: 'xy',
    timeCycles: 0, playing: false, displayCyclesPerSecond: .5,
    camera: { yaw: -.7, pitch: .45, distance: 7 },
    lastValid: null, error: null, previous: false, revision,
  };
  const inspect = () => structuredClone({ ...state, revision });
  const evaluate = ({ acceptDraft = false } = {}) => {
    if (!acceptDraft && Object.keys(state.draft).length) {
      state.error ||= '입력 적용 전';
      state.previous = Boolean(state.lastValid);
      revision += 1; state.revision = revision;
      return null;
    }
    try {
      const model = structuredClone(state.models[state.sceneName]);
      const result = sceneMeasurement(model, state.point, state.sceneName === 'wave' ? state.timeCycles / model.frequency : 0);
      if (model.kind === 'wave' && state.point.some(value => Math.abs(value / result.wavelength) > 2)) {
        throw new EMInputError('파동 측정점은 각 축에서 −2λ…2λ 범위여야 합니다.', 'OUT_OF_RANGE');
      }
      state.lastValid = { sceneName: state.sceneName, model, point: [...state.point], timeCycles: state.timeCycles, result };
      state.error = null; state.previous = false; revision += 1; state.revision = revision;
      return state.lastValid;
    } catch (error) {
      state.error = error instanceof EMInputError ? error.message : String(error);
      state.previous = Boolean(state.lastValid); state.playing = false; revision += 1; state.revision = revision;
      return null;
    }
  };
  return {
    state, inspect, evaluate,
    setScene(name) { if (!Object.hasOwn(state.models, name)) return false; state.sceneName = name; state.draft = {}; state.playing = false; return Boolean(evaluate()); },
    setDraft(key, value) { state.draft[key] = value; state.previous = Boolean(state.lastValid); state.error = '입력 적용 전'; revision += 1; state.revision = revision; },
    apply(fields) {
      const name = state.sceneName, previous = state.models[name];
      state.models[name] = { ...structuredClone(previous), ...structuredClone(fields) };
      const value = evaluate({ acceptDraft: true });
      if (!value) { state.models[name] = previous; return null; }
      state.draft = {};
      return value;
    },
    setPoint(point) {
      const previous = state.point;
      state.point = [...point];
      const value = evaluate();
      if (!value) state.point = previous;
      return value;
    },
    // Non-finite input (NaN/Infinity from a bad slider/field value) is ignored: it would otherwise store NaN as timeCycles.
    setTime(cycles) { const value = Number(cycles); if (!Number.isFinite(value)) return state.lastValid; state.timeCycles = Math.max(0, Math.min(2, value)); return evaluate(); },
    setActive(active) { state.active = Boolean(active); if (!active) state.playing = false; revision += 1; state.revision = revision; },
    stop() { state.playing = false; revision += 1; state.revision = revision; },
    destroy() { state.active = false; state.playing = false; state.destroyed = true; revision += 1; state.revision = revision; },
  };
}
