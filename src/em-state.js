// State of the built-in models (point charge, dipole, line current, loop, plane wave): parameters, the sensor point,
// the viewed plane and the wave clock. Edits apply live: a change is validated at once and an invalid one is
// rejected, keeping the last valid state (error holds the reason). Pure: no DOM.
import { EMInputError, sceneMeasurement } from './em-physics.js';

export const DEFAULT_SCENES = Object.freeze({
  charge: { kind: 'charge', q: 1e-9, position: [0, 0, 0] },
  dipole: { kind: 'dipole', q: 1e-9, separation: 1, axis: [1, 0, 0], center: [0, 0, 0] },
  line: { kind: 'line', current: 1, position: [0, 0, 0], direction: [0, 0, 1] },
  loop: { kind: 'loop', current: 1, radius: 1, center: [0, 0, 0], normal: [0, 0, 1] },
  wave: { kind: 'wave', amplitude: 3, frequency: 1e6, phase: 0, direction: [0, 0, 1], polarization: [1, 0, 0] },
});

// Where the sensor starts and which plane shows each model best (the loop and the wave are easiest to read edge-on).
export const SCENE_VIEWS = Object.freeze({
  charge: { point: [1, 0, 0], plane: 'xy' },
  dipole: { point: [1, 0, 0], plane: 'xy' },
  line: { point: [1, 0, 0], plane: 'xy' },
  loop: { point: [0, 0, 0], plane: 'xz' },
  wave: { point: [0, 0, 0], plane: 'xz' },
});

export function createEMState() {
  let revision = 0;
  const state = {
    active: false, destroyed: false, sceneName: 'charge',
    models: structuredClone(DEFAULT_SCENES), point: [...SCENE_VIEWS.charge.point], slice: SCENE_VIEWS.charge.plane,
    timeCycles: 0, playing: false,
    camera: { yaw: -.7, pitch: .45, distance: 7 },
    lastValid: null, error: null, revision,
  };
  const bump = () => { revision += 1; state.revision = revision; };
  const inspect = () => structuredClone({ ...state, revision });

  function evaluate() {
    try {
      const model = structuredClone(state.models[state.sceneName]);
      const time = state.sceneName === 'wave' ? state.timeCycles / model.frequency : 0;
      const result = sceneMeasurement(model, state.point, time);
      if (model.kind === 'wave' && state.point.some(value => Math.abs(value / result.wavelength) > 2)) {
        throw new EMInputError('파동 측정점은 각 축에서 −2λ…2λ 범위여야 합니다.', 'OUT_OF_RANGE');
      }
      state.lastValid = { sceneName: state.sceneName, model, point: [...state.point], timeCycles: state.timeCycles, result };
      state.error = null;
      bump();
      return state.lastValid;
    } catch (error) {
      state.error = error instanceof EMInputError ? error.message : String(error);
      state.playing = false;
      bump();
      return null;
    }
  }

  return {
    state, inspect, evaluate,
    setScene(name) {
      if (!Object.hasOwn(state.models, name)) return null;
      const view = SCENE_VIEWS[name];
      Object.assign(state, { sceneName: name, point: [...view.point], slice: view.plane, playing: false, timeCycles: 0 });
      return evaluate();
    },
    /** Merge model fields and re-evaluate; invalid values are rejected and the previous model stays. */
    apply(fields) {
      const name = state.sceneName, previous = state.models[name], previousPoint = state.point;
      state.models[name] = { ...structuredClone(previous), ...structuredClone(fields) };
      // The wave sensor sits at a fixed place in wavelengths: keep it there when the frequency changes.
      if (name === 'wave' && fields.frequency > 0 && fields.frequency !== previous.frequency) {
        state.point = state.point.map(value => value * previous.frequency / fields.frequency);
      }
      const value = evaluate();
      if (!value) {
        const error = state.error;
        state.models[name] = previous;
        state.point = previousPoint;
        state.error = error;
      }
      return value;
    },
    setPoint(point) {
      const previous = state.point;
      state.point = [...point];
      const value = evaluate();
      if (!value) state.point = previous;
      return value;
    },
    setSlice(plane) { if (!['xy', 'xz', 'yz'].includes(plane)) return false; state.slice = plane; bump(); return true; },
    // Non-finite input (NaN/Infinity from a bad slider value) is ignored: it would otherwise store NaN as timeCycles.
    setTime(cycles) {
      const value = Number(cycles);
      if (!Number.isFinite(value)) return state.lastValid;
      state.timeCycles = Math.max(0, Math.min(2, value));
      return evaluate();
    },
    setActive(active) { state.active = Boolean(active); if (!active) state.playing = false; bump(); },
    stop() { state.playing = false; bump(); },
    destroy() { state.active = false; state.playing = false; state.destroyed = true; bump(); },
  };
}
