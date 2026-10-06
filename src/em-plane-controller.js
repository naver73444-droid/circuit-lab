// The plane view's controller: pointer interaction (charges, sensor, Gauss circle, zoom, keyboard) and one draw()
// that renders the canvas and returns the texts for the side readouts. Everything updates while dragging.
import { clampGauss, coarseSphereFlux, gaussEnclosure } from './em-gauss.js';
import { createPlaneRenderer } from './em-plane-render.js';
import {
  createPlaneView, hitGauss, hitSource, planeAxes, planeNormal, pointOnPlane, zoomAbout,
} from './em-plane-geometry.js';
import { createPointChargeEvaluator } from './em-playground-physics.js';
import { sphereFlux } from './em-playground-calculus.js';
import { gaussReadout, sensorReadout } from './em-readout.js';
import { nudgePatch } from './em-source-edit.js';

const SENSOR_GRAB = 16;
const KEY_STEP = 0.05;

export function createPlaneController({ baseCanvas, canvas, editor, getMode, lab, getPalette, onChange, signal }) {
  const pg = editor.state, renderer = createPlaneRenderer(baseCanvas, canvas, getPalette);
  let drag = null, preciseTimer = null, precise = null;

  const geometry = () => createPlaneView({
    width: canvas.clientWidth, height: canvas.clientHeight, span: lab.view.span, offset: lab.view.offset,
  });
  const local = event => {
    const rect = canvas.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  };
  const sensorPixel = (view, mode) => {
    const [a, b] = planeAxes(mode.plane()), point = mode.sensor();
    return view.toCanvas(point[a], point[b]);
  };

  // ---- Gauss surface ----------------------------------------------------------------------------------------------

  function gaussEvaluate(field) {
    return point => { const r = field.evaluate(point); return { status: r.status, E: r.vector }; };
  }

  function gaussInfo(mode, field, dragging) {
    if (mode.kind !== 'sandbox' || !lab.chips.gauss || !lab.gauss) return null;
    const { center, radius } = lab.gauss, sources = mode.sources();
    const enclosure = gaussEnclosure(sources, center, radius);
    let coarse = null, exact = null;
    if (enclosure.status === 'ok') {
      coarse = coarseSphereFlux(gaussEvaluate(field), center, radius);
      const key = JSON.stringify([mode.fieldKey(), center, radius]);
      if (precise?.key === key) exact = precise.result;
      else if (!dragging) {
        clearTimeout(preciseTimer);
        preciseTimer = setTimeout(() => {
          const result = sphereFlux(createPointChargeEvaluator(sources), center, radius, sources);
          precise = { key, result };
          onChange();
        }, 30);
      }
    }
    return { ...gaussReadout({ enclosure, coarse, precise: exact }), enclosure };
  }

  // ---- drawing ----------------------------------------------------------------------------------------------------

  // What the readouts show: the sensor's field and the Gauss surface. Cheap enough to run on every frame.
  function measure() {
    const mode = getMode(), field = mode.field(), plane = mode.plane(), [a, b] = planeAxes(plane);
    const sensor = mode.sensor(), result = field.evaluate(sensor);
    const gauss = gaussInfo(mode, field, Boolean(drag));
    return {
      mode, field, plane, sensor, result, gauss, readout: sensorReadout(field, result, plane),
      inPlane: result.status === 'valid' ? [result.vector[a], result.vector[b]] : null,
    };
  }

  function draw() {
    const view = geometry();
    if (!(view.width > 1 && view.height > 1)) return null;
    const info = measure(), { mode } = info;
    renderer.render({
      view, plane: info.plane, fixed: mode.fixed(), field: info.field, fieldKey: mode.fieldKey(), sources: mode.sources(),
      model: mode.model(), quality: lab.quality, chips: lab.chips, selectedId: pg.selectedId,
      sensor: { point: info.sensor, vector: info.inPlane, text: info.readout.compact },
      gauss: info.gauss ? { ...lab.gauss, label: info.gauss.status === 'ok' ? info.gauss.lines[1] : '' } : null,
      gaussEnclosed: info.gauss?.enclosure.enclosedIds ?? [],
    });
    return info;
  }

  // ---- pointer interaction ----------------------------------------------------------------------------------------

  function moveSensorTo(view, mode, x, y) {
    mode.moveSensor(pointOnPlane(view, mode.plane(), mode.fixed(), x, y));
  }

  function startDrag(event) {
    if (event.button !== 0) return;
    const [x, y] = local(event), view = geometry(), mode = getMode(), plane = mode.plane();
    const [sx, sy] = sensorPixel(view, mode), sensorDistance = Math.hypot(sx - x, sy - y);
    const sandbox = mode.kind === 'sandbox';
    const hit = sandbox ? hitSource(mode.sources(), view, plane, x, y) : null;
    event.preventDefault();
    canvas.focus({ preventScroll: true });
    canvas.setPointerCapture?.(event.pointerId);
    if (hit && !(sensorDistance <= SENSOR_GRAB && sensorDistance <= hit.distance)) {
      editor.select(hit.source.id);
      if (!editor.beginDrag(hit.source.id, plane, hit.handle, hit.position)) { onChange(); return; }
      const grab = pointOnPlane(view, plane, hit.position[planeNormal(plane)], x, y);
      const normal = hit.position[planeNormal(plane)];
      drag = { type: 'source', pointerId: event.pointerId, normal, offset: hit.position.map((v, i) => v - grab[i]) };
      lab.quality = 'draft';
      onChange();
      return;
    }
    if (sensorDistance > SENSOR_GRAB && sandbox && lab.chips.gauss && lab.gauss) {
      const where = hitGauss(view, plane, lab.gauss, mode.fixed(), x, y);
      if (where) {
        const grab = pointOnPlane(view, plane, mode.fixed(), x, y);
        const type = where === 'edge' ? 'gauss-resize' : 'gauss-move';
        drag = { type, pointerId: event.pointerId, offset: lab.gauss.center.map((v, i) => v - grab[i]) };
        onChange();
        return;
      }
    }
    drag = { type: 'sensor', pointerId: event.pointerId };
    moveSensorTo(view, mode, x, y);
    onChange();
  }

  function moveDrag(event) {
    const [x, y] = local(event), view = geometry(), mode = getMode(), plane = mode.plane();
    if (!drag) { hover(view, mode, x, y); return; }
    if (event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    if (drag.type === 'sensor') moveSensorTo(view, mode, x, y);
    else if (drag.type === 'source') {
      const point = pointOnPlane(view, plane, drag.normal, x, y);
      editor.previewDrag(point.map((v, i) => v + drag.offset[i]));
    } else if (drag.type === 'gauss-move') {
      const point = pointOnPlane(view, plane, mode.fixed(), x, y);
      lab.gauss = clampGauss({ ...lab.gauss, center: point.map((v, i) => v + drag.offset[i]) });
    } else {
      const [a, b] = planeAxes(plane), [world0, world1] = view.toWorld(x, y);
      const planar = Math.hypot(world0 - lab.gauss.center[a], world1 - lab.gauss.center[b]);
      const off = lab.gauss.center[planeNormal(plane)] - mode.fixed();
      lab.gauss = clampGauss({ ...lab.gauss, radius: Math.hypot(planar, off) });
    }
    onChange();
  }

  function endDrag(event, cancelled) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const finished = drag;
    drag = null;
    try { canvas.releasePointerCapture?.(event.pointerId); } catch { /* already released */ }
    if (finished.type === 'source') {
      if (cancelled) editor.cancelDrag();
      else {
        const [x, y] = local(event), view = geometry(), plane = getMode().plane();
        const point = pointOnPlane(view, plane, finished.normal, x, y);
        editor.commitDrag(point.map((v, i) => v + finished.offset[i]));
      }
      lab.quality = 'final';
    }
    onChange();
  }

  function hover(view, mode, x, y) {
    const [sx, sy] = sensorPixel(view, mode);
    const overSensor = Math.hypot(sx - x, sy - y) <= SENSOR_GRAB;
    const overSource = mode.kind === 'sandbox' && hitSource(mode.sources(), view, mode.plane(), x, y);
    const overGauss = mode.kind === 'sandbox' && lab.chips.gauss && lab.gauss && hitGauss(view, mode.plane(), lab.gauss, mode.fixed(), x, y);
    canvas.style.cursor = overSource || overSensor || overGauss ? 'grab' : 'crosshair';
  }

  canvas.addEventListener('pointerdown', startDrag, { signal });
  canvas.addEventListener('pointermove', moveDrag, { signal });
  canvas.addEventListener('pointerup', event => endDrag(event, false), { signal });
  canvas.addEventListener('pointercancel', event => endDrag(event, true), { signal });
  canvas.addEventListener('lostpointercapture', event => endDrag(event, true), { signal });
  // If pointer capture is unavailable (or the release happens outside the page area), the window still ends the drag.
  window.addEventListener('pointermove', event => { if (drag && event.target !== canvas) moveDrag(event); }, { signal });
  window.addEventListener('pointerup', event => { if (event.target !== canvas) endDrag(event, false); }, { signal });
  window.addEventListener('pointercancel', event => { if (event.target !== canvas) endDrag(event, true); }, { signal });
  canvas.addEventListener('wheel', event => {
    event.preventDefault();
    const [x, y] = local(event);
    Object.assign(lab.view, zoomAbout(geometry(), x, y, event.deltaY > 0 ? 1.12 : 1 / 1.12));
    onChange();
  }, { passive: false, signal });

  canvas.addEventListener('keydown', event => {
    if (event.key === 'Escape' && drag) {
      event.preventDefault();
      if (drag.type === 'source') editor.cancelDrag();
      drag = null;
      lab.quality = 'final';
      onChange();
      return;
    }
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[event.key];
    const mode = getMode(), plane = mode.plane();
    if (event.key === 'Delete' && mode.kind === 'sandbox' && editor.removeSelected()) { event.preventDefault(); onChange(); return; }
    if (!arrows) return;
    event.preventDefault();
    const step = (event.shiftKey ? 5 : 1) * KEY_STEP;
    const selected = mode.kind === 'sandbox' ? pg.sources.find(source => source.id === pg.selectedId) : null;
    if (selected) {
      editor.updateSource(selected.id, nudgePatch(selected, plane, arrows[0] * step, arrows[1] * step));
      editor.endEdit();
    } else {
      const point = mode.sensor().slice(), [a, b] = planeAxes(plane);
      point[a] += arrows[0] * step; point[b] += arrows[1] * step;
      mode.moveSensor(point);
    }
    onChange();
  }, { signal });

  const observer = new ResizeObserver(() => onChange());
  observer.observe(canvas);
  signal.addEventListener('abort', () => { observer.disconnect(); clearTimeout(preciseTimer); }, { once: true });

  return {
    draw,
    measure,
    stats: renderer.stats,
    isDragging: () => Boolean(drag),
    invalidate: () => renderer.invalidate(),
    cancel() {
      if (!drag) return;
      if (drag.type === 'source') editor.cancelDrag();
      drag = null;
      lab.quality = 'final';
    },
    /** Put the Gauss circle around the selected source (or the first one, or the origin). */
    placeGauss() {
      const mode = getMode(), plane = mode.plane();
      const target = pg.sources.find(source => source.id === pg.selectedId) ?? pg.sources[0];
      const centre = target ? (target.type === 'finite-line' ? target.start.map((v, i) => (v + target.end[i]) / 2) : target.position) : [0, 0, 0];
      const center = centre.slice();
      center[planeNormal(plane)] = mode.fixed();
      lab.gauss = clampGauss({ center, radius: 0.6 });
    },
  };
}
