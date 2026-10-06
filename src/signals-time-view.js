// Lesson 1 view: x(t) and y(t)=x(at-b) overlaid; a draggable marker maps tau -> t=(tau+b)/a.
import { createLegend, createPane, createSurface } from './signals-plot.js';
import { clamp, formatNumber, sampleCurve } from './signals-util.js';
import {
  TIME_AXIS, TIME_SEQUENCE, baseSignal, baseEdges, transformedSignal, transformedEdges,
  normalizeScale, timeImage, sequenceTransform, isDiscrete, markerDomain,
} from './signals-time-model.js';

const DT_AXIS = { lo: -8, hi: 8 };

const KEYS = '←/→ 점 이동, Shift는 10배, Home/End 처음·끝';
const GRAB = 32; // px: a touch this close to a dot grabs it

export function createTimeView({ doc, parent, emit }) {
  const root = doc.createElement('div');
  parent.append(root);
  const surface = createSurface(doc, root, { label: '시간축 변환 그래프', keys: KEYS, className: 'sg-drag' });
  const pane = createPane(doc, surface.svg);
  const legend = createLegend(doc, root, [
    { cls: 'c1', text: '' },
    { cls: 'c2', text: '' },
    { cls: 'c4 mk', text: '' },
    { cls: 'cm', text: '' },
  ]);

  const curveX = pane.line('c1');
  const curveY = pane.line('c2');
  const stemsX = pane.stems('c1');
  const stemsY = pane.stems('c2');
  const dropX = pane.vline('c1 dash');
  const dropY = pane.vline('c2 dash');
  const link = pane.segment('c4', { arrow: true });
  const dotX = pane.dot('c1', 6.5);
  const dotY = pane.dot('c2', 6.5);
  const labelX = pane.text('tint c1');
  const labelY = pane.text('tint c2');
  let last = null;
  let dragMode = null;
  let legendKey = null;

  function layout(width) {
    const height = width < 640 ? 270 : clamp(width * 0.36, 300, 380);
    surface.resize(width, height);
    pane.setBox(46, 20, width - 46 - 14, height - 20 - 32);
  }

  function update(state) {
    last = state;
    const { family, params, cursor } = state;
    const discrete = isDiscrete(family);
    const a = normalizeScale(params.a, discrete);
    const b = discrete ? Math.round(params.b) : params.b;
    const axis = discrete ? DT_AXIS : TIME_AXIS;
    if (legendKey !== discrete) {
      legendKey = discrete;
      legend.set(discrete
        ? ['x[k] 원 수열', 'y[n]=x[an−b]', '대응 n=(k+b)/a', '막대는 겹치지 않게 좌우 ±0.12 비껴 그림']
        : ['x(t) 원 신호', 'y(t)=x(at−b)', '대응 t=(τ+b)/a', null]);
    }
    const seqValues = TIME_SEQUENCE.values;
    const yLo = discrete ? Math.min(...seqValues, 0) - 0.8 : -0.3;
    const yHi = discrete ? Math.max(...seqValues) + 0.9 : 1.45;
    pane.setDomain(axis.lo, axis.hi, yLo, yHi);
    pane.drawAxes({
      xTicks: discrete ? Array.from({ length: axis.hi - axis.lo + 1 }, (_, i) => axis.lo + i).filter((n) => n % 2 === 0) : undefined,
      yTicks: discrete ? undefined : [0, 1],
    });
    pane.setTitle(discrete ? 'x[k] · y[n]=x[an−b]   (횡축 정수 인덱스)' : 'x(t) · y(t)=x(at−b)');
    let v;
    let tau = cursor;
    let image;
    if (discrete) {
      const kept = sequenceTransform(seqValues, TIME_SEQUENCE.start, a, b);
      curveX.set([]); curveY.set([]);
      stemsX.set(seqValues.map((value, i) => [TIME_SEQUENCE.start + i - 0.12, value]));
      stemsY.set(kept.map((p) => [p.n + 0.12, p.value]));
      tau = Math.round(cursor);
      v = seqValues[tau - TIME_SEQUENCE.start];
      image = timeImage(tau, a, b);
    } else {
      stemsX.set([]); stemsY.set([]);
      curveX.set(sampleCurve((t) => baseSignal(family, t), axis.lo, axis.hi, 700, baseEdges(family)));
      curveY.set(sampleCurve((t) => transformedSignal(family, a, b, t), axis.lo, axis.hi, 1200, transformedEdges(family, a, b)));
      v = baseSignal(family, tau);
      image = timeImage(tau, a, b);
    }
    dotX.set(tau, v);
    dropX.set(tau, 0, v);
    const forward = timeImage(tau, a, b) >= tau;
    labelX.set(pane.px(tau) + (forward ? -4 : 4), pane.py(0) + 16, discrete ? `k=${tau}` : `τ=${formatNumber(tau)}`, forward ? 'end' : 'start');
    const survives = !discrete || Number.isInteger(image);
    if (survives && image >= axis.lo && image <= axis.hi) {
      dotY.set(image, v);
      dropY.set(image, 0, v);
      link.set(tau, v, image, v);
      labelY.set(pane.px(image) + (forward ? 4 : -4), pane.py(0) + 16, discrete ? `n=${formatNumber(image)}` : `t=${formatNumber(image)}`, forward ? 'start' : 'end');
    } else {
      dotY.hide(); dropY.hide(); link.hide(); labelY.hide();
      if (discrete && !Number.isInteger(image)) labelY.setAt(tau, v, 'n 정수 아님 → 표본 없음', 'middle', 28);
    }
  }

  // The scale, shift and marker position of a state (a is already normalized by the controller; kept safe here too).
  function mapOf(state) {
    const discrete = isDiscrete(state.family);
    const a = normalizeScale(state.params.a, discrete);
    const b = discrete ? Math.round(state.params.b) : state.params.b;
    return { discrete, a, b, tau: discrete ? Math.round(state.cursor) : state.cursor };
  }

  // Which dot the pointer grabs: the nearer one (x curve or y curve).
  function toMarker(event, mode) {
    const { discrete, a, b } = mapOf(last);
    const value = pane.fromPx(surface.pointer(event).x);
    const domain = markerDomain(last.family);
    let tau = mode === 'x' ? value : a * value - b;
    if (discrete) tau = Math.round(tau);
    return clamp(tau, domain.min, domain.max);
  }

  surface.svg.addEventListener('pointerdown', (event) => {
    if (!last || event.button > 0) return;
    const p = surface.pointer(event);
    if (!pane.contains(p.x, p.y)) return;
    const { a, b, tau } = mapOf(last);
    const dx = Math.abs(pane.px(tau) - p.x);
    const dy = Math.abs(pane.px(timeImage(tau, a, b)) - p.x);
    dragMode = dy < dx ? 'y' : 'x';
    surface.svg.setPointerCapture?.(event.pointerId);
    surface.svg.focus({ preventScroll: true });
    emit({ cursor: toMarker(event, dragMode) });
    event.preventDefault();
  });
  surface.svg.addEventListener('pointermove', (event) => {
    if (dragMode && last) emit({ cursor: toMarker(event, dragMode) });
  });
  const stop = () => { dragMode = null; };
  surface.svg.addEventListener('pointerup', stop);
  surface.svg.addEventListener('pointercancel', stop);
  // Touch: only a finger next to one of the two dots claims the gesture; elsewhere the page scrolls.
  surface.setGrab((p) => {
    if (!last || !pane.contains(p.x, p.y)) return false;
    const { a, b, tau } = mapOf(last);
    return Math.abs(pane.px(tau) - p.x) < GRAB || Math.abs(pane.px(timeImage(tau, a, b)) - p.x) < GRAB;
  });

  return { root, surface, layout, update, destroy: () => root.remove() };
}
