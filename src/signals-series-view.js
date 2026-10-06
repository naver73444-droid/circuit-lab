// Lesson 3 view: rotating phasor chain (left) whose tip height is the partial-sum waveform scrolling right,
// and the amplitude spectrum below. Time is shared: the cursor is t in seconds, T0 = 1 s.
import { createLegend, createPane, createSurface, svgEl } from './signals-plot.js';
import { clamp, formatNumber, sampleCurve } from './signals-util.js';
import {
  MAX_HARMONICS, exactWaveform, gibbsOvershoot, hasJump, partialSum, phasorChain,
  seriesCoefficients, spectrumLines,
} from './signals-series-model.js';

// Vertical range shared by the phasor and wave panes (a unipolar pulse needs less room below zero).
const yRange = (wave) => (wave === 'pulse' ? [-0.55, 1.45] : [-1.4, 1.4]);
const LAG = 1.6; // periods of history shown to the right
const KEYS = '←/→ 시각 t 이동, Shift는 10배, Home/End 처음·끝, Space 재생·정지. 스펙트럼을 끌면 N이 바뀜';

export function createSeriesView({ doc, parent, emit }) {
  const root = doc.createElement('div');
  parent.append(root);
  const surface = createSurface(doc, root, { label: '푸리에 급수 (회전 벡터, 파형, 스펙트럼)', keys: KEYS, className: 'sg-drag' });
  const phasorPane = createPane(doc, surface.svg);
  const wavePane = createPane(doc, surface.svg);
  const specPane = createPane(doc, surface.svg);
  createLegend(doc, root, [
    { cls: 'c1', text: '회전 벡터 사슬 (k번째는 k배 빠르게)' },
    { cls: 'c4 mk', text: '사슬 끝점 · 점선 = 높이' },
    { cls: 'c2', text: '합 x_N(t)' },
    { cls: 'cm dash', text: '원래 파형' },
    { cls: 'c5 dot', text: '부분합 최댓값' },
  ]);

  const circles = Array.from({ length: MAX_HARMONICS }, () => phasorPane.circle('cm thin'));
  const chain = phasorPane.line('c1 thick');
  const tip = phasorPane.dot('c4', 6);
  const tipLine = phasorPane.hline('c4 dash');
  const gapLine = svgEl(doc, 'line', { class: 'ref c4 dash', visibility: 'hidden' }, surface.svg);
  const waveLine = wavePane.line('c2');
  const exactLine = wavePane.line('cm dash faint');
  const waveTip = wavePane.dot('c4', 5);
  const tipLine2 = wavePane.hline('c4 dash');
  const peakLine = wavePane.hline('c5 dot');
  const peakLabel = wavePane.text('tint c5');
  const spectrumIn = specPane.stems('c1');
  const spectrumOut = specPane.stems('cm faint');
  const spectrumNow = specPane.vline('c4 dash');
  let stacked = false;
  let dragging = false;

  function layout(width) {
    stacked = width < 700;
    const specH = 96;
    if (stacked) {
      const size = Math.min(width - 56, 280);
      const waveH = 150;
      const height = 22 + size + 40 + waveH + 40 + specH + 28;
      surface.resize(width, height);
      phasorPane.setBox((width - size) / 2, 22, size, size);
      wavePane.setBox(46, 22 + size + 40, width - 46 - 14, waveH);
      specPane.setBox(46, 22 + size + 40 + waveH + 40, width - 46 - 14, specH);
    } else {
      const size = clamp(width * 0.33, 230, 300);
      const height = 22 + size + 44 + specH + 28;
      surface.resize(width, height);
      phasorPane.setBox(34, 22, size, size);
      wavePane.setBox(34 + size + 36, 22, width - (34 + size + 36) - 14, size);
      specPane.setBox(46, 22 + size + 44, width - 46 - 14, specH);
    }
  }

  const waveEdges = (wave, D, t) => {
    if (!hasJump(wave)) return [];
    const edges = [];
    for (let m = -3; m <= 4; m++) {
      for (const s of wave === 'pulse' ? [-1, 1] : [1]) {
        const at = wave === 'pulse' ? s * D / 2 + m : 0.5 + m;
        edges.push(t - at);
      }
    }
    return edges.filter((u) => u > 0 && u < LAG);
  };

  function update(state) {
    const { family: wave, params, cursor: t } = state;
    const N = params.N;
    const D = params.D ?? 0.5;
    const coeff = seriesCoefficients(wave, D, MAX_HARMONICS);
    const points = phasorChain(coeff, N, t);
    const tipPoint = points.at(-1);

    // phasor chain pane
    const [yLo, yHi] = yRange(wave);
    const half = (yHi - yLo) / 2;
    phasorPane.setDomain(-half, half, yLo, yHi);
    phasorPane.drawAxes({ xTicks: [], yTicks: [0], showY: false });
    phasorPane.setTitle('회전 벡터 (90° 돌려 그림: 위쪽이 실수축)', 'start', true);
    for (let i = 0; i < MAX_HARMONICS; i++) {
      const center = points[i + 1];
      const term = points[i + 2];
      const radiusPx = term ? (term.amp * phasorPane.box.w) / (2 * half) : 0;
      if (i < N && term && radiusPx > 1.2) circles[i].set(center.x, center.y, term.amp);
      else circles[i].hide();
    }
    chain.set(points.map((p) => [p.x, p.y]));
    tip.set(tipPoint.x, tipPoint.y);
    tipLine.set(tipPoint.y);

    // waveform pane (history flows to the right: x axis is the lag u = how long ago)
    wavePane.setDomain(0, LAG, yLo, yHi);
    wavePane.drawAxes({ xTicks: [0, 0.5, 1, 1.5], yTicks: yLo < -1 ? [-1, 0, 1] : [0, 1], showY: !stacked });
    wavePane.setTitle('x_N(t−u) · u [s] — 오른쪽일수록 과거', 'start', true);
    waveLine.set(sampleCurve((u) => partialSum(coeff, N, t - u), 0, LAG, 640, waveEdges(wave, D, t)));
    exactLine.set(sampleCurve((u) => exactWaveform(wave, D, t - u), 0, LAG, 640, waveEdges(wave, D, t)));
    const value = partialSum(coeff, N, t);
    waveTip.set(0, value);
    tipLine2.set(value);
    if (!stacked) {
      gapLine.setAttribute('visibility', 'visible');
      const y = phasorPane.py(tipPoint.y);
      gapLine.setAttribute('x1', phasorPane.box.x + phasorPane.box.w); gapLine.setAttribute('x2', wavePane.box.x);
      gapLine.setAttribute('y1', y); gapLine.setAttribute('y2', y);
    } else gapLine.setAttribute('visibility', 'hidden');
    if (hasJump(wave)) {
      const g = gibbsOvershoot(wave, D, N);
      peakLine.set(g.peak);
      peakLabel.set(wavePane.box.x + wavePane.box.w - 4, wavePane.py(g.peak) - 5, `부분합 최댓값 ${formatNumber(g.peak)}`, 'end');
    } else {
      peakLine.hide(); peakLabel.hide();
    }

    // spectrum pane
    const lines = spectrumLines(wave, D, MAX_HARMONICS);
    const top = Math.max(...lines.map((l) => l.amp)) * 1.15 || 1;
    specPane.setDomain(-0.7, MAX_HARMONICS + 0.7, 0, top);
    specPane.drawAxes({ xTicks: [0, 5, 10, 15, 20, 25], yTicks: [0, Number((top / 1.15).toPrecision(2))] });
    specPane.setTitle('진폭 스펙트럼 · k ↔ k·f₀ Hz (f₀=1/T₀=1 Hz, k=0은 DC)', 'start', true);
    spectrumIn.set(lines.filter((l) => l.k <= N).map((l) => [l.k, l.amp]));
    spectrumOut.set(lines.filter((l) => l.k > N).map((l) => [l.k, l.amp]));
    spectrumNow.set(N + 0.5);
  }

  const setHarmonics = (event) => {
    const k = Math.round(specPane.fromPx(surface.pointer(event).x));
    emit({ params: { N: clamp(k, 1, MAX_HARMONICS) } });
  };
  surface.svg.addEventListener('pointerdown', (event) => {
    if (event.button > 0) return;
    const p = surface.pointer(event);
    if (!specPane.contains(p.x, p.y)) return;
    surface.svg.focus({ preventScroll: true });
    dragging = true;
    surface.svg.setPointerCapture?.(event.pointerId);
    setHarmonics(event);
  });
  surface.svg.addEventListener('pointermove', (event) => { if (dragging) setHarmonics(event); });
  for (const type of ['pointerup', 'pointercancel']) surface.svg.addEventListener(type, () => { dragging = false; });
  // Touch: only the spectrum strip (the N handle) claims the gesture; the rest of the plot scrolls the page.
  surface.setGrab((p) => specPane.contains(p.x, p.y));

  return { root, surface, layout, update, destroy: () => root.remove() };
}
