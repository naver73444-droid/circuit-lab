// The "3D" tab: the WebGL view of the same sandbox / model state. Camera: drag empty space, wheel or pinch to zoom,
// arrow keys. Charges can be dragged here too; they move inside the editing plane under the pointer.
import { C } from './em-physics.js';
import { EMView } from './em-view.js';
import { intersectEditingPlane, projectedDistance } from './em-playground-interaction.js';
import { computePlaneLines, sampleVectorGrid } from './em-plane-field.js';
import { handlesOf, planeAxes, planeNormal } from './em-plane-geometry.js';

const HOME = { yaw: -.7, pitch: .45, distance: 7 };
const VIEWS = { x: { yaw: 0, pitch: 0 }, y: { yaw: Math.PI / 2, pitch: 0 }, z: { yaw: 0, pitch: Math.PI / 2 - .001 } };
const WINDOW = { aMin: -3, aMax: 3, bMin: -3, bMax: 3 };

export function create3DPanel({ canvas, status, editor, store, lab, getMode, getPalette, onChange, isActive, signal }) {
  const pg = editor.state, s = store.state;
  let view = null, grab = null, lineCache = null;

  function ensureView() {
    if (view) return view;
    view = new EMView(canvas, status);
    view.cameraListener = delta => {
      if (!isActive()) return;
      s.camera.yaw += delta.yaw;
      s.camera.pitch = Math.max(-1.45, Math.min(1.45, s.camera.pitch + delta.pitch));
      s.camera.distance = Math.max(2, Math.min(20, s.camera.distance + delta.zoom));
      onChange();
    };
    view.interactionListener = {
      down(_event, ray) {
        const mode = getMode();
        if (mode.kind !== 'sandbox' || !isActive() || !ray) return false;
        let target = null, nearest = Infinity;
        for (const source of pg.sources.filter(item => item.visible !== false)) {
          for (const handle of handlesOf(source)) {
            const distance = projectedDistance(ray, handle.position);
            if (distance < nearest) { nearest = distance; target = { source, ...handle }; }
          }
        }
        if (!target || nearest > Math.max(.12, s.camera.distance * .025)) return false;
        const normal = planeNormal(pg.plane), hit = intersectEditingPlane(ray, pg.plane, target.position[normal]);
        if (!hit) return false;
        editor.select(target.source.id);
        if (!editor.beginDrag(target.source.id, pg.plane, target.handle, target.position)) { onChange(); return true; }
        grab = { normal, offset: target.position.map((value, i) => value - hit[i]) };
        lab.quality = 'draft';
        onChange();
        return true;
      },
      move(_event, ray) {
        if (!pg.drag || !ray || !grab) return;
        const hit = intersectEditingPlane(ray, pg.drag.plane, pg.drag.origin[grab.normal]);
        if (!hit) return;
        editor.previewDrag(hit.map((value, i) => value + grab.offset[i]));
        onChange();
      },
      up(_event, cancelled, ray) {
        if (!pg.drag) return;
        const hit = !cancelled && ray && grab ? intersectEditingPlane(ray, pg.drag.plane, pg.drag.origin[grab.normal]) : null;
        if (hit) editor.commitDrag(hit.map((value, i) => value + grab.offset[i])); else editor.cancelDrag();
        grab = null;
        lab.quality = 'final';
        onChange();
      },
    };
    return view;
  }

  // Field lines and the in-plane arrows only depend on the field, the plane and the quality.
  function overlays(mode, field) {
    const plane = mode.plane(), fixed = mode.fixed();
    const key = JSON.stringify([mode.fieldKey(), plane, fixed, lab.quality, lab.chips.lines]);
    if (lineCache?.key === key) return lineCache.value;
    const lines = lab.chips.lines
      ? computePlaneLines(field, { plane, fixed, area: WINDOW, sources: mode.sources(), model: mode.model(), quality: lab.quality })
      : [];
    const arrows = sampleVectorGrid(field, plane, fixed, WINDOW, 9, 9).filter(item => item.magnitude > 0);
    const [a, b] = planeAxes(plane), n = planeNormal(plane);
    const gridVectors = arrows.map(item => {
      const start = [0, 0, 0], end = [0, 0, 0];
      start[a] = item.a; start[b] = item.b; start[n] = fixed;
      end[a] = item.a + item.va / item.magnitude * 0.25; end[b] = item.b + item.vb / item.magnitude * 0.25; end[n] = fixed;
      return { start, end };
    });
    lineCache = { key, value: { fieldLines: lines.map(line => ({ points: line.points })), gridVectors } };
    return lineCache.value;
  }

  function draw() {
    const gl = ensureView(), mode = getMode(), field = mode.field();
    const { fieldLines, gridVectors } = overlays(mode, field);
    const sandbox = mode.kind === 'sandbox', display = mode.sensor(), result = field.evaluate(display);
    const frame = {
      camera: s.camera, palette: getPalette(), plane: mode.plane(), fixed: mode.fixed(), fieldLines, gridVectors,
      point: sandbox ? pg.probe : s.point,
      vector: result.status === 'valid' ? result.vector : [0, 0, 0],
      scene: sandbox ? { kind: 'playground', sources: pg.sources, selectedId: pg.selectedId } : s.models[s.sceneName],
      gauss: sandbox && lab.chips.gauss ? lab.gauss : null,
    };
    if (!sandbox && s.sceneName === 'wave' && s.lastValid?.result.status === 'valid') {
      const { result: wave } = s.lastValid;
      frame.wave = { timeCycles: s.timeCycles, wavelength: wave.wavelength, E: wave.E, B: wave.B, c: C };
      frame.vector = [0, 0, 0];
    }
    return gl.render(frame);
  }

  canvas.addEventListener('keydown', event => {
    if (!isActive()) return;
    const key = event.key;
    if (key === 'Escape' && pg.drag) { event.preventDefault(); editor.cancelDrag(); grab = null; lab.quality = 'final'; onChange(); return; }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '-', 'Home'].includes(key)) return;
    event.preventDefault();
    const camera = s.camera;
    if (key === 'Home') Object.assign(camera, HOME);
    else if (key === 'ArrowLeft') camera.yaw -= .1;
    else if (key === 'ArrowRight') camera.yaw += .1;
    else if (key === 'ArrowUp') camera.pitch = Math.min(1.45, camera.pitch + .1);
    else if (key === 'ArrowDown') camera.pitch = Math.max(-1.45, camera.pitch - .1);
    else camera.distance = Math.max(2, Math.min(20, camera.distance + (key === '+' ? -.5 : .5)));
    onChange();
  }, { signal });

  return {
    draw,
    setView(name) { Object.assign(s.camera, VIEWS[name] ?? HOME); onChange(); },
    cancel() {
      view?.cancelPointers();
      if (pg.drag) editor.cancelDrag();
      grab = null;
      lab.quality = 'final';
    },
    invalidate() { lineCache = null; },
    destroy() { view?.dispose(); view = null; },
    get view() { return view; },
  };
}
