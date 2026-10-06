// What the plane view shows: either the free charge sandbox or one of the built-in models. Both answer the same
// questions (plane, fixed coordinate, field, sensor) so the view and the controllers do not care which is active.
// Pure: no DOM. Fields are rebuilt only when the underlying state changes.
import { createSandboxField, createSceneField, toDisplay, toMetres } from './em-plane-field.js';
import { planeNormal } from './em-plane-geometry.js';

export function createSandboxMode(editor) {
  const pg = editor.state;
  let cache = null;
  return {
    kind: 'sandbox',
    plane: () => pg.plane,
    setPlane: plane => editor.setPlane(plane),
    fixed: () => pg.probe[planeNormal(pg.plane)],
    sources: () => pg.sources,
    model: () => null,
    sensor: () => pg.probe,
    /** Move the sensor to a 3D display point; false when it is outside the model range. */
    moveSensor: point => editor.setProbe(point),
    // The field depends on the sources only; moving the sensor must not rebuild it.
    field() {
      const key = JSON.stringify(pg.sources);
      if (cache?.key !== key) cache = { key, field: createSandboxField(pg.sources), fieldKey: `sandbox:${hash(key)}` };
      return cache.field;
    },
    fieldKey() { this.field(); return cache.fieldKey; },
  };
}

// A cheap stable string hash so the render cache key stays short.
function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

export function createSceneMode(store) {
  const s = store.state;
  let cache = null;
  return {
    kind: 'scene',
    plane: () => s.slice,
    setPlane: plane => store.setSlice(plane),
    fixed() { const field = this.field(); return s.point[planeNormal(s.slice)] / field.unit; },
    sources: () => [],
    model: () => s.models[s.sceneName],
    sensor() { return toDisplay(this.field(), s.point); },
    moveSensor(display) { return Boolean(store.setPoint(toMetres(this.field(), display))); },
    field() {
      const model = s.models[s.sceneName], time = s.sceneName === 'wave' ? s.timeCycles : 0;
      const key = JSON.stringify([model, time]);
      if (cache?.key !== key) cache = { key, field: createSceneField(model, time), fieldKey: `scene:${hash(key)}` };
      return cache.field;
    },
    fieldKey() { this.field(); return cache.fieldKey; },
  };
}
