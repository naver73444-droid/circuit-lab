// Lesson 3 view: rotating phasor chain (left) whose tip height is the partial-sum waveform scrolling right,
// and the line spectrum below (two-sided |c_k| with its phase, one-sided 2|c_k|, the power |c_k|^2, or the signed TFS bars a_k, b_k).
// Time is shared: the cursor is t in seconds, with a general period T0. In the TFS mode a folded coefficient table (k = 0..min(N,10))
// sits under the plot; its 11 rows are made once and only rewritten when the wave, duty or N changes.
import { createLegend, createPane, createSurface, phoneBudget, svgEl } from './signals-plot.js';
import { clamp, formatNumber, jumpList, niceTicks, sampleCurve } from './signals-util.js';
import { toAxis, isOmega } from './signals-axis.js';
import {
  MAX_HARMONICS, exactWaveform, gibbsOvershoot, hasJump, isUnipolar, jumpPositions, partialSum, phasorChain,
  seriesCoefficients, twoSidedSpectrum, TFS_SPEC, formatComplex, formatPhase,
} from './signals-series-model.js';
import { TABLE_ROWS, coefficientRow } from './signals-series-coefficients.js';

// Vertical range shared by the phasor and wave panes (a unipolar wave needs less room below zero).
const yRange = (wave) => (isUnipolar(wave) ? [-0.55, 1.45] : [-1.4, 1.4]);
const LAG = 1.6; // periods of history shown to the right
const KEYS = '←/→ 시각 t 이동, Shift는 10배, Home/End 처음·끝, Space 재생·정지. 스펙트럼을 끌면 N이 바뀜';
const REVIEW_PRESET = { N: 10, T0: 3, D: 1 / 3, spec: TFS_SPEC }; // Review p19~21: T0 = 3 s, 1 s wide pulse, N = 10
const LEGEND = ['회전 벡터 사슬 (k번째는 k배 빠르게)', '사슬 끝점 · 점선 = 높이', '합 x_N(t)', '원래 파형 (열린 원 = 점프의 양쪽 극한)', '부분합 최댓값'];
const TFS_LEGEND = ['aₖ 막대 (cos 계수, 왼쪽)', 'bₖ 막대 (sin 계수, 오른쪽)'];
const TABLE_HEAD = ['k', 'aₖ', 'bₖ', 'cₖ', '|cₖ|', '∠cₖ', 'dₖ', 'φₖ'];
const PI_TICKS = [{ value: -Math.PI, label: '−π' }, { value: 0, label: '0' }, { value: Math.PI, label: 'π' }];

export function createSeriesView({ doc, parent, emit }) {
  const root = doc.createElement('div');
  parent.append(root);
  const surface = createSurface(doc, root, { label: '푸리에 급수 (회전 벡터, 파형, 스펙트럼)', keys: KEYS, className: 'sg-drag' });
  const phasorPane = createPane(doc, surface.svg);
  const wavePane = createPane(doc, surface.svg);
  const specPane = createPane(doc, surface.svg);
  const phasePane = createPane(doc, surface.svg);
  const legend = createLegend(doc, root, [
    { cls: 'c1', text: LEGEND[0] },
    { cls: 'c4 mk', text: LEGEND[1] },
    { cls: 'c2', text: LEGEND[2] },
    { cls: 'cm dash', text: LEGEND[3] },
    { cls: 'c5 dot', text: LEGEND[4] },
    { cls: 'c1', text: TFS_LEGEND[0] },
    { cls: 'c2', text: TFS_LEGEND[1] },
  ]);
  legend.set(LEGEND);

  const circles = Array.from({ length: MAX_HARMONICS }, () => phasorPane.circle('cm thin'));
  const chain = phasorPane.line('c1 thick');
  const tip = phasorPane.dot('c4', 6);
  const tipLine = phasorPane.hline('c4 dash');
  const gapLine = svgEl(doc, 'line', { class: 'ref c4 dash', visibility: 'hidden' }, surface.svg);
  const waveLine = wavePane.line('c2');
  const exactLine = wavePane.line('cm dash faint');
  const exactJumps = wavePane.jumps('cm');
  const waveTip = wavePane.dot('c4', 5);
  const tipLine2 = wavePane.hline('c4 dash');
  const peakLine = wavePane.hline('c5 dot');
  const peakLabel = wavePane.text('tint c5');
  const spectrumIn = specPane.stems('c1');
  const spectrumOut = specPane.stems('cm faint');
  const spectrumNow = specPane.vline('c4 dash');
  const spectrumNow2 = specPane.vline('c4 dash');
  // TFS bars: thin stems without end dots (a_k at k-0.2, b_k at k+0.2) so the pair stays apart on a phone
  const barA = specPane.stems('c1', { radius: 0 });
  const barAOut = specPane.stems('c1 faint', { radius: 0 });
  const barB = specPane.stems('c2', { radius: 0 });
  const barBOut = specPane.stems('c2 faint', { radius: 0 });
  const phaseIn = phasePane.stems('c1');
  const phaseOut = phasePane.stems('cm faint');
  const phaseNow = phasePane.vline('c4 dash');
  const phaseNow2 = phasePane.vline('c4 dash');
  const table = createCoefficientTable(doc, root, () => emit({ params: { ...REVIEW_PRESET } }));
  let stacked = false;
  let dragging = false;
  let width = 0;
  let placedKey = '';
  let showPhase = false;
  let lastState = null;

  function place() {
    const key = `${width}|${showPhase}|${phoneBudget(doc)}`;
    if (key === placedKey || !width) return;
    placedKey = key;
    stacked = width < 700;
    let specH = 96;
    const phaseH = showPhase ? 70 : 0;
    const phaseGap = showPhase ? 46 : 0;
    if (stacked) {
      // Phone: the whole plot stays within the height budget (55 % of the screen); the three panes share what is left after the fixed margins.
      const room = Math.max(0, phoneBudget(doc) - (22 + 40 + 40 + phaseGap + phaseH + 28));
      const size = clamp(Math.round(room * 0.42), 120, Math.min(width - 56, 280));
      const waveH = clamp(Math.round(room * 0.34), 70, 150);
      specH = clamp(Math.round(room * 0.24), 56, 96);
      const height = 22 + size + 40 + waveH + 40 + specH + phaseGap + phaseH + 28;
      surface.resize(width, height);
      phasorPane.setBox((width - size) / 2, 22, size, size);
      wavePane.setBox(46, 22 + size + 40, width - 46 - 14, waveH);
      specPane.setBox(46, 22 + size + 40 + waveH + 40, width - 46 - 14, specH);
      phasePane.setBox(46, 22 + size + 40 + waveH + 40 + specH + phaseGap, width - 46 - 14, phaseH || 1);
    } else {
      const size = clamp(width * 0.33, 230, 300);
      const height = 22 + size + 44 + specH + phaseGap + phaseH + 28;
      surface.resize(width, height);
      phasorPane.setBox(34, 22, size, size);
      wavePane.setBox(34 + size + 36, 22, width - (34 + size + 36) - 14, size);
      specPane.setBox(46, 22 + size + 44, width - 46 - 14, specH);
      phasePane.setBox(46, 22 + size + 44 + specH + phaseGap, width - 46 - 14, phaseH || 1);
    }
  }

  function layout(w) {
    width = w;
    placedKey = '';
    place();
    if (lastState) update(lastState);
  }

  // Absolute positions (in seconds of lag u) of the jumps of the wave seen from time t.
  function waveEdges(wave, D, t, T0) {
    const edges = [];
    for (let m = -3; m <= 4; m++) for (const pos of jumpPositions(wave, D)) edges.push((t - (m + pos)) * T0);
    return edges.filter((u) => u > 0 && u < LAG * T0);
  }

  function update(state) {
    lastState = state;
    const { family: wave, params, cursor } = state;
    const N = params.N;
    const D = params.D ?? 0.5;
    const T0 = params.T0 ?? 1;
    const spec = params.spec ?? 0;
    const axis = params.axis ?? 0;
    const t = cursor / T0; // periods
    const wantPhase = spec === 0;
    if (wantPhase !== showPhase) { showPhase = wantPhase; placedKey = ''; place(); }
    else place();
    phasePane.root.setAttribute('visibility', showPhase ? 'visible' : 'hidden');
    if (!showPhase) phasePane.clearAxes(); // tick nodes carry their own visibility and would stay drawn under a hidden parent
    const coeff = seriesCoefficients(wave, D, MAX_HARMONICS);
    const points = phasorChain(coeff, N, t);
    const tipPoint = points.at(-1);

    // phasor chain pane
    const [yLo, yHi] = yRange(wave);
    const half = (yHi - yLo) / 2;
    phasorPane.setDomain(-half, half, yLo, yHi);
    phasorPane.drawAxes({ xTicks: [], yTicks: [0], showY: false });
    // On a phone the phasor pane is a small centred square: its title is centred over the full width instead of being cut to it.
    const middle = phasorPane.box.x + phasorPane.box.w / 2;
    if (stacked) phasorPane.setTitle('회전 벡터 (90° 돌려 그림: 위쪽이 실수축)', 'middle', true, 2 * Math.min(middle, width - middle) - 8);
    else phasorPane.setTitle('회전 벡터 (90° 돌려 그림: 위쪽이 실수축)', 'start', true);
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
    const edges = waveEdges(wave, D, t, T0);
    wavePane.setDomain(0, LAG * T0, yLo, yHi);
    wavePane.drawAxes({ xTicks: niceTicks(0, LAG * T0, 4), yTicks: yLo < -1 ? [-1, 0, 1] : [0, 1], showY: !stacked });
    wavePane.setTitle(`x_N(t−u) · u [s] — 오른쪽일수록 과거 (T₀=${formatNumber(T0)} s)`, 'start', true);
    waveLine.set(sampleCurve((u) => partialSum(coeff, N, t - u / T0), 0, LAG * T0, 640, edges));
    const exactFn = (u) => exactWaveform(wave, D, t - u / T0);
    exactLine.set(sampleCurve(exactFn, 0, LAG * T0, 640, edges, { gaps: true }));
    exactJumps.set(jumpList(exactFn, edges, 0, LAG * T0));
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
    updateSpectrum(wave, D, N, T0, spec, axis);
    const tfs = spec === TFS_SPEC;
    legend.set(tfs ? [...LEGEND, ...TFS_LEGEND] : LEGEND);
    table.update(tfs, wave, D, N);
  }

  // All 26 rows (k = 0..25) for the bars, cached per wave and duty (the cursor changes every frame while playing).
  let barKey = '';
  let barCache = [];
  function barRows(wave, D) {
    const key = `${wave}|${D}`;
    if (key !== barKey) { barKey = key; barCache = Array.from({ length: MAX_HARMONICS + 1 }, (_, k) => coefficientRow(wave, D, k)); }
    return barCache;
  }

  const freqLabel = (k, T0, axis) => formatNumber(toAxis(k / T0, axis), 3);

  function updateSpectrum(wave, D, N, T0, spec, axis) {
    const K = MAX_HARMONICS;
    const sym = isOmega(axis) ? 'ω' : 'f';
    const unit = isOmega(axis) ? 'rad/s' : 'Hz';
    const lines = twoSidedSpectrum(wave, D, K);
    const ticksFor = (list) => list.map((k) => ({ value: k, label: freqLabel(k, T0, axis) }));
    const xr = K + 0.8;
    if (spec !== TFS_SPEC) for (const bar of [barA, barAOut, barB, barBOut]) bar.set([]);
    if (spec === TFS_SPEC) {
      const rows = barRows(wave, D);
      const top = Math.max(...rows.flatMap((r) => [Math.abs(r.a), Math.abs(r.b ?? 0)]));
      const half = Math.max(1.15 * top, 0.5); // centred on 0, span at least 1
      const mark = Number(top.toPrecision(2));
      specPane.setDomain(-0.7, K + 0.7, -half, half);
      specPane.drawAxes({ xTicks: ticksFor([0, 5, 10, 15, 20, 25]), yTicks: [-mark, 0, mark] });
      specPane.setTitle(`TFS aₖ·bₖ (k=0은 평균 a₀) · 눈금 = k·${sym} [${unit}]`, 'start', true);
      const aPts = rows.map((r) => [r.k === 0 ? 0 : r.k - 0.2, r.a, r.k]);
      const bPts = rows.filter((r) => r.k > 0).map((r) => [r.k + 0.2, r.b, r.k]);
      const inside = (list) => list.filter((p) => p[2] <= N).map((p) => [p[0], p[1]]);
      const outside = (list) => list.filter((p) => p[2] > N).map((p) => [p[0], p[1]]);
      barA.set(inside(aPts)); barAOut.set(outside(aPts));
      barB.set(inside(bPts)); barBOut.set(outside(bPts));
      spectrumIn.set([]); spectrumOut.set([]);
      spectrumNow.set(N + 0.5);
      spectrumNow2.hide();
      phaseIn.set([]); phaseOut.set([]); phaseNow.hide(); phaseNow2.hide();
      return;
    }
    if (spec === 1) {
      const peak = Math.max(...lines.filter((l) => l.k >= 0).map((l) => (l.k === 0 ? l.mag : 2 * l.mag))) * 1.15 || 1;
      specPane.setDomain(-0.7, K + 0.7, 0, peak);
      specPane.drawAxes({ xTicks: ticksFor([0, 5, 10, 15, 20, 25]), yTicks: [0, Number((peak / 1.15).toPrecision(2))] });
      specPane.setTitle(`한쪽 진폭 d_k=2|c_k| (k=0은 DC) · 눈금 = k·${sym} [${unit}]`, 'start', true);
      const one = lines.filter((l) => l.k >= 0).map((l) => [l.k, l.k === 0 ? l.mag : 2 * l.mag, l.k]);
      spectrumIn.set(one.filter((p) => p[2] <= N).map((p) => [p[0], p[1]]));
      spectrumOut.set(one.filter((p) => p[2] > N).map((p) => [p[0], p[1]]));
      spectrumNow.set(N + 0.5);
      spectrumNow2.hide();
      phaseIn.set([]); phaseOut.set([]); phaseNow.hide(); phaseNow2.hide();
      return;
    }
    const power = spec === 2;
    const val = (l) => (power ? l.power : l.mag);
    const peak = Math.max(...lines.map(val)) * 1.15 || 1;
    specPane.setDomain(-xr, xr, 0, peak);
    specPane.drawAxes({ xTicks: ticksFor([-25, -20, -15, -10, -5, 0, 5, 10, 15, 20, 25]), yTicks: [0, Number((peak / 1.15).toPrecision(2))] });
    specPane.setTitle(power
      ? `전력 스펙트럼 |c_k|² (Σ=⟨x²⟩) · 눈금 = k·${sym} [${unit}], f₀=${formatNumber(1 / T0)} Hz`
      : `|c_k| (k=−∞..∞, 양쪽) · 눈금 = k·${sym} [${unit}], f₀=${formatNumber(1 / T0)} Hz`, 'start', true);
    spectrumIn.set(lines.filter((l) => Math.abs(l.k) <= N).map((l) => [l.k, val(l)]));
    spectrumOut.set(lines.filter((l) => Math.abs(l.k) > N).map((l) => [l.k, val(l)]));
    spectrumNow.set(N + 0.5);
    spectrumNow2.set(-N - 0.5);
    if (power) {
      phaseIn.set([]); phaseOut.set([]); phaseNow.hide(); phaseNow2.hide();
      return;
    }
    phasePane.setDomain(-xr, xr, -Math.PI * 1.2, Math.PI * 1.2);
    phasePane.drawAxes({ xTicks: ticksFor([-25, -20, -15, -10, -5, 0, 5, 10, 15, 20, 25]), yTicks: PI_TICKS });
    phasePane.setTitle('∠c_k [rad] (|c_k|≈0 인 선은 위상을 그리지 않음)', 'start', true);
    const withPhase = lines.filter((l) => l.phase !== null);
    phaseIn.set(withPhase.filter((l) => Math.abs(l.k) <= N).map((l) => [l.k, l.phase]));
    phaseOut.set(withPhase.filter((l) => Math.abs(l.k) > N).map((l) => [l.k, l.phase]));
    phaseNow.set(N + 0.5);
    phaseNow2.set(-N - 0.5);
  }

  const setHarmonics = (event) => {
    const k = Math.round(Math.abs(specPane.fromPx(surface.pointer(event).x)));
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

// Folded "계수 표": k | a_k | b_k | c_k | |c_k| | angle c_k | d_k | phi_k for k = 0..min(N,10), phases in rad, undefined = —.
// The review button (centred pulse train only) applies the Review p19~21 values; the axis stays as it is.
function createCoefficientTable(doc, parent, applyPreset) {
  const make = (tag, attrs = {}, parentNode = null, text) => {
    const node = doc.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    if (text !== undefined) node.textContent = text;
    parentNode?.append(node);
    return node;
  };
  const box = make('details', { class: 'sg-coefficients', 'data-signals-coefficients': '' }, parent);
  box.hidden = true;
  make('summary', {}, box, '계수 표');
  const preset = make('button', { type: 'button', 'data-signals-coefficient-preset': '' }, box, '복습 p19~21');
  preset.addEventListener('click', applyPreset);
  const scroll = make('div', { class: 'sg-coefficient-scroll', tabindex: '0', role: 'region', 'aria-label': '세 꼴 푸리에 계수 표 (가로 스크롤)' }, box);
  const table = make('table', {}, scroll);
  const head = make('tr', {}, make('thead', {}, table));
  for (const name of TABLE_HEAD) make('th', { scope: 'col' }, head, name);
  const body = make('tbody', {}, table);
  const rows = Array.from({ length: TABLE_ROWS + 1 }, (_, k) => {
    const row = make('tr', { 'data-signals-coefficient-row': String(k) }, body);
    make('th', { scope: 'row' }, row, String(k));
    const cells = Object.fromEntries(['a', 'b', 'c', 'mag', 'phase', 'd', 'phi'].map((name) => [name, make('td', { 'data-key': name }, row)]));
    return { row, cells };
  });
  // Taps on the table never reach the plot's drag / touch readout.
  box.addEventListener('pointerdown', (event) => event.stopPropagation());
  let key = '';

  const put = (cell, text, value) => {
    if (cell.textContent !== text) cell.textContent = text;
    cell.dataset.value = value === null ? '' : String(value);
  };
  return {
    update(visible, wave, D, N) {
      if (box.hidden === visible) box.hidden = !visible;
      if (preset.hidden !== (wave !== 'pulse')) preset.hidden = wave !== 'pulse';
      if (!visible) return;
      const next = `${wave}|${D}|${N}`;
      if (next === key) return;
      key = next;
      const shown = Math.min(N, TABLE_ROWS);
      rows.forEach(({ row, cells }, k) => {
        row.hidden = k > shown;
        if (row.hidden) return;
        const r = coefficientRow(wave, D, k);
        put(cells.a, formatNumber(r.a, 4), r.a);
        put(cells.b, r.b === null ? '—' : formatNumber(r.b, 4), r.b);
        put(cells.c, formatComplex(r.c), null);
        put(cells.mag, formatNumber(r.mag, 4), r.mag);
        put(cells.phase, formatPhase(r.phase), r.phase);
        put(cells.d, formatNumber(r.d, 4), r.d);
        put(cells.phi, formatPhase(r.phi), r.phi);
      });
    },
  };
}
