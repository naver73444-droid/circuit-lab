// Lesson 5 view: s-plane / z-plane with draggable poles and the shaded ROC, plus the matching time signal.
import { createLegend, createPane, createSurface, svgEl } from './signals-plot.js';
import { clamp, formatNumber, niceTicks, r1 } from './signals-util.js';
import {
  PLANE_RANGE, PREVIEW, dragPole, isTwoSided, isZ, previewCurve, rocControls, rocModel,
} from './signals-roc-model.js';

const KEYS = '←/→/↑/↓ 극점 이동, Shift는 큰 걸음, Space 극점 전환(양측 신호)';
const GRAB = 36; // px: a touch this close to a pole grabs it

export function createRocView({ doc, parent, emit }) {
  const root = doc.createElement('div');
  parent.append(root);
  const surface = createSurface(doc, root, { label: '극점과 수렴영역(ROC) 그래프', keys: KEYS, className: 'sg-drag' });
  const plane = createPane(doc, surface.svg);
  const preview = createPane(doc, surface.svg);
  const legend = createLegend(doc, root, [
    { cls: 'c2 band', text: 'ROC (수렴영역)' },
    { cls: 'c4 mk', text: '극점 × · 영점 ○' },
    { cls: 'c2', text: '' },
    { cls: 'c5 dash', text: '' },
    { cls: 'c1', text: '시간 신호' },
  ]);

  const rocShape = svgEl(doc, 'path', { class: 'fl strong c2', 'fill-rule': 'evenodd' }, plane.layer);
  const axisLine = plane.vline('c2 thick');
  const unitCircle = plane.circle('c2 thick');
  const polesX = [0, 1, 2].map(() => svgEl(doc, 'path', { class: 'ref thick c4', visibility: 'hidden' }, plane.layer));
  const zeros = [0, 1].map(() => svgEl(doc, 'circle', { class: 'ref c3', r: 5, visibility: 'hidden' }, plane.layer));
  const axisName = plane.text('muted');
  const axisName2 = plane.text('muted');
  const poleLabels = [plane.text('tint c4'), plane.text('tint c4')];
  const curve = preview.line('c1');
  const stems = preview.stems('c1');
  const clipNote = preview.text('tint c5');
  let last = null;
  let model = null;
  let activeHandle = 0;
  let dragging = false;
  let lastFamily = null;

  function layout(width) {
    if (width < 700) {
      const size = Math.min(width - 56, 320);
      surface.resize(width, 22 + size + 40 + 170 + 28);
      plane.setBox((width - size) / 2, 22, size, size);
      preview.setBox(46, 22 + size + 40, width - 60, 170);
    } else {
      const size = clamp(width * 0.36, 260, 340);
      surface.resize(width, 22 + size + 28);
      plane.setBox(46, 22, size, size);
      preview.setBox(46 + size + 40, 22, width - (46 + size + 40) - 14, size);
    }
  }

  const circlePath = (cx, cy, r) => `M${r1(cx - r)},${r1(cy)}a${r1(r)},${r1(r)} 0 1,0 ${r1(2 * r)},0a${r1(r)},${r1(r)} 0 1,0 ${r1(-2 * r)},0Z`;
  const rectPath = () => {
    const { x, y, w, h } = plane.box;
    return `M${r1(x)},${r1(y)}h${r1(w)}v${r1(h)}h${r1(-w)}Z`;
  };

  function drawRoc(m) {
    const { kind, lo, hi } = m.roc;
    const scale = plane.box.w / (plane.x1 - plane.x0);
    const c = { x: plane.px(0), y: plane.py(0) };
    if (kind === 'empty') { rocShape.setAttribute('d', ''); return; }
    if (!m.z) {
      const a = kind === 'inside' ? plane.x0 : lo;
      const b = kind === 'outside' ? plane.x1 : hi;
      const left = plane.px(Math.max(a, plane.x0));
      const right = plane.px(Math.min(b, plane.x1));
      const { y, h } = plane.box;
      rocShape.setAttribute('d', `M${r1(left)},${r1(y)}H${r1(right)}V${r1(y + h)}H${r1(left)}Z`);
      return;
    }
    if (kind === 'outside') rocShape.setAttribute('d', rectPath() + circlePath(c.x, c.y, lo * scale));
    else if (kind === 'inside') rocShape.setAttribute('d', circlePath(c.x, c.y, hi * scale));
    else rocShape.setAttribute('d', circlePath(c.x, c.y, hi * scale) + circlePath(c.x, c.y, lo * scale));
  }

  const cross = (px, py) => `M${r1(px - 7)},${r1(py - 7)}L${r1(px + 7)},${r1(py + 7)}M${r1(px - 7)},${r1(py + 7)}L${r1(px + 7)},${r1(py - 7)}`;

  function update(state) {
    last = state;
    const { family, params } = state;
    const z = isZ(family);
    model = rocModel(family, params);
    // A new example, or one without the selected pole, starts on its first movable pole.
    if (family !== lastFamily || !model.movable.includes(activeHandle)) activeHandle = model.movable[0];
    if (family !== lastFamily) {
      lastFamily = family;
      const axisName3 = z ? '단위원' : 'jω축';
      legend.set(['ROC (수렴영역)', '극점 × · 영점 ○', `${axisName3} ⊂ ROC (안정)`, `${axisName3} ⊄ ROC (불안정, 점선)`, z ? 'x[n] 시간 신호' : 'x(t) 시간 신호']);
    }
    const R = PLANE_RANGE[z ? 'z' : 's'];
    plane.setDomain(-R, R, -R, R);
    plane.drawAxes({ xTicks: niceTicks(-R, R, 6).filter((v) => v !== 0), yTicks: niceTicks(-R, R, 6).filter((v) => v !== 0) });
    plane.setTitle(z ? 'z 평면 (Re, Im)' : 's 평면 (σ, jω)', 'start', true);
    drawRoc(model);
    const stableClass = model.stable ? 'ref thick c2' : 'ref thick c5 dash';
    if (z) {
      axisLine.hide();
      unitCircle.node.setAttribute('class', model.stable ? 'ln thick c2' : 'ln thick c5 dash');
      unitCircle.set(0, 0, 1);
      axisName.setAt(0, R, 'Im', 'start', 14);
      axisName2.set(plane.box.x + plane.box.w - 4, plane.py(0) - 6, 'Re', 'end');
    } else {
      unitCircle.hide();
      axisLine.node.setAttribute('class', stableClass);
      axisLine.set(0);
      axisName.setAt(0, R, 'jω', 'start', 14);
      axisName2.set(plane.box.x + plane.box.w - 4, plane.py(0) - 6, 'σ', 'end');
    }
    polesX.forEach((node, i) => {
      const pole = model.poles[i];
      if (!pole) { node.setAttribute('visibility', 'hidden'); return; }
      node.setAttribute('visibility', 'visible');
      node.setAttribute('d', cross(plane.px(pole.re), plane.py(pole.im)));
      node.setAttribute('class', `ref thick c4${pole.handle === activeHandle ? '' : ' faintpole'}`);
    });
    zeros.forEach((node, i) => {
      const zero = model.zeros[i];
      if (!zero) { node.setAttribute('visibility', 'hidden'); return; }
      node.setAttribute('visibility', 'visible');
      node.setAttribute('cx', r1(plane.px(zero.re))); node.setAttribute('cy', r1(plane.py(zero.im)));
    });
    poleLabels.forEach((label, i) => {
      const pole = model.poles.filter((p) => p.im >= 0)[i];
      if (!pole) { label.hide(); return; }
      const text = pole.im > 0 ? `${formatNumber(pole.re)}±j${formatNumber(pole.im)}` : formatNumber(pole.re);
      label.setAt(pole.re, pole.im, text, pole.re > R * 0.55 ? 'end' : 'start', -12);
    });

    // time-domain preview
    const dt = z;
    const range = dt ? PREVIEW.dt : PREVIEW.ct;
    preview.setDomain(range.lo, range.hi, -PREVIEW.clip, PREVIEW.clip);
    preview.drawAxes({ xTicks: dt ? [-8, -4, 0, 4, 8] : [-4, -2, 0, 2, 4], yTicks: [-2, 0, 2] });
    preview.setTitle(dt ? 'x[n] — 이 ROC에 대응하는 신호' : 'x(t) — 이 ROC에 대응하는 신호', 'start', true);
    const points = previewCurve(family, params);
    const clipped = points.some(([, y]) => Math.abs(y) > PREVIEW.clip);
    if (dt) { curve.set([]); stems.set(points.map(([n, y]) => [n, clamp(y, -PREVIEW.clip, PREVIEW.clip)])); }
    else { stems.set([]); curve.set(points.map(([t, y]) => [t, clamp(y, -PREVIEW.clip * 1.05, PREVIEW.clip * 1.05)])); }
    if (clipped) clipNote.set(preview.box.x + preview.box.w - 6, preview.box.y + 14, '|x|>3 부분은 잘림 (발산)', 'end');
    else clipNote.hide();
  }

  function toPoint(event) {
    const p = surface.pointer(event);
    return { re: plane.fromPx(p.x), im: plane.fromPy(p.y) };
  }

  function grab(event) {
    if (!last || !model) return;
    const p = surface.pointer(event);
    let best = 0;
    let bestDistance = Infinity;
    for (const pole of model.poles) {
      if (pole.im < 0) continue; // the conjugate partner moves with its twin
      const distance = Math.hypot(plane.px(pole.re) - p.x, plane.py(pole.im) - p.y);
      if (distance < bestDistance) { bestDistance = distance; best = pole.handle; }
    }
    activeHandle = best;
  }

  function drag(event) {
    if (!last) return;
    emit({ params: dragPole(last.family, last.params, activeHandle, toPoint(event)) });
  }

  surface.svg.addEventListener('pointerdown', (event) => {
    if (event.button > 0) return;
    const p = surface.pointer(event);
    if (!plane.contains(p.x, p.y)) return;
    dragging = true;
    surface.svg.setPointerCapture?.(event.pointerId);
    surface.svg.focus({ preventScroll: true });
    grab(event);
    drag(event);
    event.preventDefault();
  });
  surface.svg.addEventListener('pointermove', (event) => { if (dragging) drag(event); });
  for (const type of ['pointerup', 'pointercancel']) surface.svg.addEventListener(type, () => { dragging = false; });
  // Touch: only a finger on a pole claims the gesture; the rest of the plot scrolls the page.
  surface.setGrab((p) => Boolean(model) && model.poles.some((pole) => Math.hypot(plane.px(pole.re) - p.x, plane.py(pole.im) - p.y) < GRAB));

  // Arrow keys nudge the active pole; Space switches poles in two-sided signals.
  function onKey(event, state) {
    const { family, params } = state;
    const step = event.shiftKey ? 0.25 : 0.05;
    const controls = rocControls(family);
    if (event.key === ' ' || event.key === 'Enter') {
      if (isTwoSided(family)) activeHandle = 1 - activeHandle;
      return { params };
    }
    const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowDown: [0, -step], ArrowUp: [0, step] }[event.key];
    if (!delta) return null;
    if (isTwoSided(family)) {
      if (delta[0] === 0) return null;
      const key = controls[activeHandle].key;
      return { params: dragPole(family, params, activeHandle, { re: params[key] + delta[0], im: 0 }) };
    }
    return { params: dragPole(family, params, 0, { re: params.re + delta[0], im: Math.max(0, params.im + delta[1]) }, { snap: 0 }) };
  }

  return { root, surface, layout, update, onKey, destroy: () => root.remove() };
}
