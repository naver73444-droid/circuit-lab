// Lesson 4 view: time signal (left) and |X(f)| with its phase (right), both on fixed axes so that
// narrowing the signal visibly widens the spectrum.
import { createLegend, createPane, createSurface } from './signals-plot.js';
import { clamp, formatQuantity, niceTicks } from './signals-util.js';
import {
  DT_INDEX_RANGE, DT_OMEGA_RANGE, FREQ_RANGE, TIME_RANGE, isDiscreteTransform, sequencePoints,
  spectrumCurves, timeCurve, transformMetrics,
} from './signals-transform-model.js';

const PI_TICKS = [-2, -1, 0, 1, 2].map((m) => ({
  value: m * Math.PI,
  label: m === 0 ? '0' : m === 1 ? 'π' : m === -1 ? '−π' : `${m < 0 ? '−' : ''}${Math.abs(m)}π`,
}));

const GRAB_PAD = 28; // px: a touch this close to the signal grabs it

export function createTransformView({ doc, parent, emit }) {
  const root = doc.createElement('div');
  parent.append(root);
  const surface = createSurface(doc, root, { label: '푸리에 변환 그래프 (시간 신호, 크기, 위상)', className: 'sg-drag' });
  const timePane = createPane(doc, surface.svg);
  const magPane = createPane(doc, surface.svg);
  const phasePane = createPane(doc, surface.svg);
  const legend = createLegend(doc, root, [
    { cls: 'c1', text: '' },
    { cls: 'c2', text: '' },
    { cls: 'c3', text: '' },
    { cls: 'c4 mk', text: '반진폭 폭 (Δ)' },
  ]);

  const timeArea = timePane.area('c1');
  const timeLine = timePane.line('c1');
  const timeStems = timePane.stems('c1');
  const timeSpan = timePane.segment('c4');
  const timeSpanLabel = timePane.text('tint c4');
  const magArea = magPane.area('c2');
  const magLine = magPane.line('c2');
  const magSpan = magPane.segment('c4');
  const magSpanLabel = magPane.text('tint c4');
  const phaseLine = phasePane.line('c3 thin');
  let last = null;
  let dragging = false;
  let legendKey = null;

  function layout(width) {
    if (width < 700) {
      const heights = [150, 150, 78];
      const gap = 36;
      surface.resize(width, 22 + heights.reduce((a, b) => a + b, 0) + gap * 2 + 24);
      timePane.setBox(46, 22, width - 60, heights[0]);
      magPane.setBox(46, 22 + heights[0] + gap, width - 60, heights[1]);
      phasePane.setBox(46, 22 + heights[0] + heights[1] + gap * 2, width - 60, heights[2]);
    } else {
      const H = clamp(width * 0.3, 230, 300);
      const colW = (width - 46 - 40 - 14) / 2;
      const magH = Math.round(H * 0.64);
      surface.resize(width, 22 + H + 28);
      timePane.setBox(46, 22, colW, H);
      magPane.setBox(46 + colW + 40, 22, colW, magH);
      phasePane.setBox(46 + colW + 40, 22 + magH + 46, colW, H - magH - 46);
    }
  }

  function update(state) {
    last = state;
    const { family, params } = state;
    const discrete = isDiscreteTransform(family);
    const metrics = transformMetrics(family, params);
    if (legendKey !== discrete) {
      legendKey = discrete;
      legend.set(discrete
        ? ['x[n] 시간 신호', '|X(e^{jΩ})| 크기', '∠X(e^{jΩ}) 위상', '반진폭 폭 (Δ)']
        : ['x(t) 시간 신호', '|X(f)| 크기', '∠X(f) 위상', '반진폭 폭 (Δ)']);
    }
    // ---- time pane
    const tr = discrete ? DT_INDEX_RANGE : TIME_RANGE;
    timePane.setDomain(tr.lo, tr.hi, -0.25, 1.35);
    timePane.drawAxes({
      xTicks: discrete ? [-10, -5, 0, 5, 10, 15, 20, 25] : niceTicks(tr.lo, tr.hi, 4),
      yTicks: [0, 1],
    });
    timePane.setTitle(discrete ? 'x[n] (L개 표본) · n' : 'x(t) · t [s]', 'start', true);
    if (discrete) {
      timeArea.set([]); timeLine.set([]);
      timeStems.set(sequencePoints(params));
      timeSpan.set(params.n0 - 0.5, 1.2, params.n0 + params.L - 0.5, 1.2);
      timeSpanLabel.setAt(params.n0 + params.L / 2 - 0.5, 1.2, `L=${params.L}`, 'middle', -6);
    } else {
      const curve = timeCurve(family, params);
      timeStems.set([]);
      timeArea.set(curve);
      timeLine.set(curve);
      const [lo, hi] = metrics.timeSpan;
      timeSpan.set(lo, 0.5, hi, 0.5);
      timeSpanLabel.setAt((lo + hi) / 2, 0.5, `Δt ${formatQuantity(metrics.timeWidth, 's')}`, 'middle', -6);
    }
    // ---- spectrum panes
    const { magnitude, phase } = spectrumCurves(family, params);
    const range = discrete ? DT_OMEGA_RANGE : FREQ_RANGE;
    const peak = metrics.peak;
    magPane.setDomain(range.lo, range.hi, -peak * 0.08, peak * 1.28);
    magPane.drawAxes({ xTicks: discrete ? PI_TICKS : niceTicks(range.lo, range.hi, 4), yTicks: [0, Number(peak.toPrecision(2))] });
    magPane.setTitle(discrete ? '|X(e^{jΩ})| · Ω [rad/sample], 2π 주기' : '|X(f)| · f [Hz]', 'start', true);
    magArea.set(magnitude);
    magLine.set(magnitude);
    const [flo, fhi] = metrics.freqSpan;
    magSpan.set(flo, peak / 2, fhi, peak / 2);
    magSpanLabel.setAt(0, peak / 2, `Δ ${formatQuantity(metrics.freqWidth, metrics.unit)}`, 'middle', -6);
    phasePane.setDomain(range.lo, range.hi, -Math.PI * 1.1, Math.PI * 1.1);
    phasePane.drawAxes({ xTicks: discrete ? PI_TICKS : niceTicks(range.lo, range.hi, 4), yTicks: [{ value: -Math.PI, label: '−π' }, { value: 0, label: '0' }, { value: Math.PI, label: 'π' }] });
    phasePane.setTitle(discrete ? '∠X(e^{jΩ}) [rad] · 시간 이동은 위상만 기울임' : '∠X(f) [rad] · 시간 이동은 위상만 기울임', 'start', true);
    phaseLine.set(phase);
  }

  // Dragging in the time pane moves the signal (t0 / n0).
  function shift(event) {
    if (!last) return;
    const { family, params } = last;
    const x = timePane.fromPx(surface.pointer(event).x);
    if (family === 'dt') emit({ params: { n0: clamp(Math.round(x - (params.L - 1) / 2), -8, 8) } });
    else emit({ params: { t0: clamp(Math.round(x / 0.05) * 0.05, -2, 2) } });
  }
  surface.svg.addEventListener('pointerdown', (event) => {
    if (event.button > 0) return;
    const p = surface.pointer(event);
    if (!timePane.contains(p.x, p.y)) return;
    dragging = true;
    surface.svg.setPointerCapture?.(event.pointerId);
    shift(event);
  });
  surface.svg.addEventListener('pointermove', (event) => { if (dragging) shift(event); });
  for (const type of ['pointerup', 'pointercancel']) surface.svg.addEventListener(type, () => { dragging = false; });
  // Touch: only a finger on (or next to) the signal claims the gesture; elsewhere the page scrolls.
  surface.setGrab((p) => {
    if (!last || !timePane.contains(p.x, p.y)) return false;
    const [lo, hi] = transformMetrics(last.family, last.params).timeSpan;
    return p.x >= timePane.px(lo) - GRAB_PAD && p.x <= timePane.px(hi) + GRAB_PAD;
  });

  return { root, surface, layout, update, destroy: () => root.remove() };
}
