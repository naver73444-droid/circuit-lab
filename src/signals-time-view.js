// Lesson 1 view: x(t) and y(t)=x(at-b) overlaid; a draggable marker maps tau -> t=(tau+b)/a.
// CT jumps are drawn as open circles at both one-sided limits (u(0) is undefined); DT stems show u[0]=1 style values.
import { createLegend, createPane, createSurface } from './signals-plot.js';
import { clamp, formatNumber, jumpList, sampleCurve } from './signals-util.js';
import {
  TIME_SEQUENCE, baseSignal, baseEdges, transformedSignal, transformedEdges, stageSignals, timeAxisOf, valueRangeOf,
  timeImage, timeMap, sequenceTransform, sequenceUpsample, isDiscrete, markerDomain,
} from './signals-time-model.js';

const dtAxisOf = (family) => (family === 'up' ? { lo: -8, hi: 20 } : { lo: -8, hi: 8 });

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
    { cls: 'c5 dot', text: '' },
    { cls: 'cm dash', text: '' },
    { cls: 'cm', text: '' },
  ]);

  const stageScale = pane.line('c5 dot');
  const stageShift = pane.line('cm dash');
  const curveX = pane.line('c1');
  const curveY = pane.line('c2');
  const jumpsX = pane.jumps('c1');
  const jumpsY = pane.jumps('c2');
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

  // Everything the plot needs from the state: the map, the axis and the value range.
  function frameOf(state) {
    const { family, params } = state;
    const discrete = isDiscrete(family);
    const map = timeMap(family, params);
    const axis = discrete ? dtAxisOf(family) : timeAxisOf(family);
    return { family, discrete, map, axis, tau: discrete ? Math.round(state.cursor) : state.cursor, stage: !discrete && params.stage === 1 };
  }

  function update(state) {
    last = state;
    const { family, discrete, map, axis, tau, stage } = frameOf(state);
    const { a, b } = map;
    const kind = discrete ? family : stage ? 'stage' : 'ct';
    if (legendKey !== kind) {
      legendKey = kind;
      if (family === 'up') legend.set(['x[k] 원 수열', 'y[n]=x[(n−b)/L]', '대응 n=L k+b', null, null, '삽입된 0 (축 위의 점)']);
      else if (discrete) legend.set(['x[k] 원 수열', 'y[n]=x[an−b]', '대응 n=(k+b)/a', null, null, '막대는 겹치지 않게 좌우 ±0.12 비껴 그림']);
      else {
        legend.set([
          'x(t) 원 신호', 'y(t)=x(at−b)', '대응 t=(τ+b)/a', stage ? 'g₁(t)=x(|a|t) 스케일' : null,
          stage ? 'g₂(t)=g₁(t−b/|a|) 이동' : null, '열린 원 = 값이 정의되지 않은 쪽, 채운 원 = 정의된 쪽',
        ]);
      }
    }
    const seqValues = TIME_SEQUENCE.values;
    const [cy0, cy1] = valueRangeOf(family);
    const yLo = discrete ? Math.min(...seqValues, 0) - 0.8 : cy0;
    const yHi = discrete ? Math.max(...seqValues) + 0.9 : cy1;
    pane.setDomain(axis.lo, axis.hi, yLo, yHi);
    const tickStep = axis.hi - axis.lo > 20 ? 4 : 2;
    pane.drawAxes({
      xTicks: discrete ? Array.from({ length: axis.hi - axis.lo + 1 }, (_, i) => axis.lo + i).filter((n) => n % tickStep === 0) : undefined,
      yTicks: discrete ? undefined : family === 'steps' || family === 'steps-r' ? [-0.5, 0, 1, 2] : [0, 1],
    });
    pane.setTitle(discrete ? 'x[k] · y[n]  (횡축 정수 인덱스)' : 'x(t) · y(t)=x(at−b)', 'start');
    let v;
    let image;
    let jumpIn = null; // CT: the marker sits on a jump of x(t), where the value is undefined and only the one-sided limits exist
    let jumpOut = null;
    if (discrete) {
      curveX.set([]); curveY.set([]); jumpsX.set([]); jumpsY.set([]); stageScale.set([]); stageShift.set([]);
      stemsX.set(seqValues.map((value, i) => [TIME_SEQUENCE.start + i - 0.12, value]));
      if (family === 'up') {
        const points = sequenceUpsample(seqValues, TIME_SEQUENCE.start, map.L, map.shift);
        stemsY.set(points.map((p) => [p.n + 0.12, p.value]));
        image = map.L * tau + map.shift;
      } else {
        const kept = sequenceTransform(seqValues, TIME_SEQUENCE.start, a, b);
        stemsY.set(kept.map((p) => [p.n + 0.12, p.value]));
        image = timeImage(tau, a, b);
      }
      v = seqValues[tau - TIME_SEQUENCE.start];
    } else {
      stemsX.set([]); stemsY.set([]);
      const baseFn = (t) => baseSignal(family, t);
      const outFn = (t) => transformedSignal(family, a, b, t);
      const xEdges = baseEdges(family);
      const yEdges = transformedEdges(family, a, b);
      curveX.set(sampleCurve(baseFn, axis.lo, axis.hi, 700, xEdges, { gaps: true }));
      curveY.set(sampleCurve(outFn, axis.lo, axis.hi, 1200, yEdges, { gaps: true }));
      const defined = family === 'steps' || family === 'steps-r'; // the lecture defines the end values by interval ([-1,2) is closed on the left)
      const listX = jumpList(baseFn, xEdges, axis.lo, axis.hi, { defined });
      const listY = jumpList(outFn, yEdges, axis.lo, axis.hi, { defined });
      jumpsX.set(listX);
      jumpsY.set(listY);
      if (stage) {
        const s = stageSignals(family, a, b);
        const scaledEdges = xEdges.map((e) => e / Math.abs(a));
        stageScale.set(sampleCurve(s.scaled, axis.lo, axis.hi, 900, scaledEdges, { gaps: true }));
        stageShift.set(sampleCurve(s.shifted, axis.lo, axis.hi, 900, scaledEdges.map((e) => e + s.shiftBy), { gaps: true }));
      } else { stageScale.set([]); stageShift.set([]); }
      v = baseFn(tau);
      image = timeImage(tau, a, b);
      jumpIn = defined ? null : listX.find((j) => Math.abs(j.x - tau) < 1e-9) ?? null;
      jumpOut = defined ? null : listY.find((j) => Math.abs(j.x - image) < 1e-9) ?? null;
    }
    const forward = image >= tau;
    const limits = (name, at, j) => `${name}(${formatNumber(at)}⁻)=${formatNumber(j.left)}, ${name}(${formatNumber(at)}⁺)=${formatNumber(j.right)}`;
    if (jumpIn) {
      // no value at the jump: no dot, only the position guide and the two one-sided limits
      dotX.hide();
      dropX.set(tau, 0, Math.abs(jumpIn.left) > Math.abs(jumpIn.right) ? jumpIn.left : jumpIn.right);
    } else {
      dotX.set(tau, v);
      dropX.set(tau, 0, v);
    }
    labelX.set(pane.px(tau) + (forward ? -4 : 4), pane.py(0) + 16, discrete ? `k=${tau}` : jumpIn ? `τ=${formatNumber(tau)}: ${limits('x', tau, jumpIn)}` : `τ=${formatNumber(tau)}`, forward ? 'end' : 'start');
    const survives = !discrete || Number.isInteger(image);
    if (survives && image >= axis.lo && image <= axis.hi) {
      if (jumpOut) {
        dotY.hide();
        dropY.set(image, 0, Math.abs(jumpOut.left) > Math.abs(jumpOut.right) ? jumpOut.left : jumpOut.right);
        link.hide();
      } else {
        dotY.set(image, v);
        dropY.set(image, 0, v);
        link.set(tau, v, image, v);
      }
      labelY.set(pane.px(image) + (forward ? 4 : -4), pane.py(0) + 16, discrete ? `n=${formatNumber(image)}` : jumpOut ? `t=${formatNumber(image)}: ${limits('y', image, jumpOut)}` : `t=${formatNumber(image)}`, forward ? 'start' : 'end');
    } else {
      dotY.hide(); dropY.hide(); link.hide(); labelY.hide();
      if (discrete && !Number.isInteger(image)) labelY.setAt(tau, v, 'n 정수 아님 → 표본 없음', 'middle', 28);
    }
  }

  // Which dot the pointer grabs: the nearer one (x curve or y curve).
  function toMarker(event, mode) {
    const { discrete, map } = frameOf(last);
    const value = pane.fromPx(surface.pointer(event).x);
    const domain = markerDomain(last.family);
    let tau = mode === 'x' ? value : map.a * value - map.b;
    if (discrete) tau = Math.round(tau);
    return clamp(tau, domain.min, domain.max);
  }

  surface.svg.addEventListener('pointerdown', (event) => {
    if (!last || event.button > 0) return;
    const p = surface.pointer(event);
    if (!pane.contains(p.x, p.y)) return;
    const { map, tau } = frameOf(last);
    const dx = Math.abs(pane.px(tau) - p.x);
    const dy = Math.abs(pane.px(timeImage(tau, map.a, map.b)) - p.x);
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
    const { map, tau } = frameOf(last);
    return Math.abs(pane.px(tau) - p.x) < GRAB || Math.abs(pane.px(timeImage(tau, map.a, map.b)) - p.x) < GRAB;
  });

  return { root, surface, layout, update, destroy: () => root.remove() };
}
