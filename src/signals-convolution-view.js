// Lesson 2 view: one SVG, three stacked panes sharing the time axis:
// (1) x(tau) with the flipped, shifted h(t-tau); (2) their product (area shaded); (3) y accumulating up to the cursor.
import { createLegend, createPane, createSurface, svgEl } from './signals-plot.js';
import { clamp, formatNumber, jumpList, niceTicks, sampleCurve } from './signals-util.js';
import {
  cachedSetup, continuousFrame, convolutionFrame, flippedImpulse, outputCurve, isCustomFamily,
} from './signals-convolution-model.js';

// [lo, hi, peak, floor] value range for a pane: includes 0 with padding; room below when negative values exist.
function valueRange(values) {
  const floor = Math.min(0, ...values);
  const peak = Math.max(0, ...values);
  let lo = floor;
  let hi = peak;
  if (hi - lo < 1e-9) hi = lo + 1;
  const pad = (hi - lo) * 0.16;
  hi += pad;
  lo = lo < 0 ? lo - pad : -pad * 0.55;
  return [lo, hi, peak, floor];
}

// Bounds of the product of two signals with known value ranges.
function productBounds(xs, hs) {
  const [xmin, xmax, hmin, hmax] = [Math.min(0, ...xs), Math.max(0, ...xs), Math.min(0, ...hs), Math.max(0, ...hs)];
  return [Math.max(xmax * hmax, xmin * hmin), Math.min(xmax * hmin, xmin * hmax)];
}

function sampleValues(fn, lo, hi, count = 257) {
  return Array.from({ length: count }, (_, i) => fn(lo + ((hi - lo) * i) / (count - 1)));
}

function paneRanges(setup) {
  if (setup.discrete) {
    return [valueRange([...setup.x, ...setup.h]), valueRange(productBounds(setup.x, setup.h)), valueRange(setup.output.values)];
  }
  const { lo, hi } = setup.axis;
  const xs = sampleValues(setup.x, lo, hi);
  const hs = sampleValues(setup.h, lo, hi);
  const curve = setup.curve ?? outputCurve(setup, 201);
  return [valueRange([...xs, ...hs]), valueRange(productBounds(xs, hs)), valueRange(curve.map((p) => p[1]))];
}

const KEYS = '←/→ t 이동, Shift는 10배, Home/End 처음·끝, Space 재생·정지';
const GRAB = 32; // px: a touch this close to the cursor line grabs it

export function createConvolutionView({ doc, parent, emit }) {
  const root = doc.createElement('div');
  parent.append(root);
  const surface = createSurface(doc, root, { label: '컨볼루션 그래프 (x, h, 곱, y)', keys: KEYS, className: 'sg-drag' });
  const [p1, p2, p3] = [createPane(doc, surface.svg), createPane(doc, surface.svg), createPane(doc, surface.svg)];
  const panes = [p1, p2, p3];
  const legend = createLegend(doc, root, [
    { cls: 'c1', text: '' },
    { cls: 'c2', text: '' },
    { cls: 'c4 dash', text: '' },
    { cls: 'c3', text: '' },
    { cls: 'cm', text: '' },
  ]);

  const xLine = p1.line('c1');
  const xJumps = p1.jumps('c1');
  const movingJumps = p1.jumps('c2');
  const xStems = p1.stems('c1');
  const flippedLine = p1.line('c2 faint dash');
  const movingLine = p1.line('c2');
  const movingStems = p1.stems('c2');
  const shiftArrow = p1.segment('c4', { arrow: true });
  const flipLabel = p1.text('tint c2 muted');
  const moveLabel = p1.text('tint c2');
  const productArea = p2.area('c4');
  const productLine = p2.line('c4');
  const productStems = p2.stems('c4');
  const areaLabel = p2.text('tint c4');
  const fullCurve = p3.line('cm faint');
  const accumulated = p3.line('c3');
  const outStems = p3.stems('c3');
  const outDot = p3.dot('c4', 6);
  const outLabel = p3.text('tint c4');
  const cursors = panes.map((pane) => pane.vline('c4 dash'));
  const emptyNote = svgEl(doc, 'text', { class: 'sg-note muted', 'text-anchor': 'middle', visibility: 'hidden' }, surface.svg);
  let last = null;
  let dragging = false;
  let rangeKey = null;
  let ranges = null;
  let legendKey = null;

  function layout(width) {
    const compact = width < 640;
    const paneH = compact ? 92 : 132;
    const gap = 42;
    const top = 22;
    const height = top + paneH * 3 + gap * 2 + 28;
    surface.resize(width, height);
    panes.forEach((pane, i) => pane.setBox(46, top + i * (paneH + gap), width - 46 - 14, paneH));
    rangeKey = null;
  }

  function update(state) {
    last = state;
    const { family, params, cursor } = state;
    const empty = isCustomFamily(family) && !state.extra?.custom;
    for (const pane of panes) pane.root.setAttribute('visibility', empty ? 'hidden' : 'visible');
    if (empty) for (const pane of panes) pane.clearAxes();
    emptyNote.setAttribute('visibility', empty ? 'visible' : 'hidden');
    if (empty) {
      emptyNote.setAttribute('x', surface.width / 2);
      emptyNote.setAttribute('y', surface.height / 2);
      emptyNote.textContent = family === 'custom' ? '식을 입력하세요' : '수열을 입력하세요';
      return;
    }
    const setup = cachedSetup(family, params, state.extra?.custom ?? null);
    if (rangeKey !== setup) { ranges = paneRanges(setup); rangeKey = setup; }
    const { lo, hi } = setup.axis;
    const discrete = setup.discrete;
    const tickList = discrete
      ? Array.from({ length: Math.floor(hi) - Math.ceil(lo) + 1 }, (_, i) => Math.ceil(lo) + i).filter((n) => n % (hi - lo > 16 ? 2 : 1) === 0)
      : niceTicks(lo, hi, Math.max(3, Math.floor(p1.box.w / 100)));
    panes.forEach((pane, i) => {
      pane.setDomain(lo, hi, ranges[i][0], ranges[i][1]);
      pane.drawAxes({ xTicks: tickList, yTicks: [...new Set([0, ranges[i][2], ranges[i][3]].map((v) => Number(v.toPrecision(2))))] });
    });
    if (legendKey !== discrete) {
      legendKey = discrete;
      legend.set(discrete
        ? ['x[k]', 'h[n−k] 뒤집어 이동', '곱 x[k]h[n−k] · 합 = y[n]', 'y[n] 출력', '막대는 겹치지 않게 좌우 ±0.12 비껴 그림']
        : ['x(λ)', 'h(t−λ) 뒤집어 이동', '곱 · 면적', 'y(t) 출력', null]);
    }
    const t = discrete ? Math.round(cursor) : cursor;
    cursors.forEach((line) => line.set(t));
    if (discrete) updateDiscrete(setup, t);
    else updateContinuous(setup, t);
  }

  function updateContinuous(setup, t) {
    const frame = continuousFrame(setup, t);
    p1.setTitle('① x(λ)와 뒤집어(Flip) 옮긴(Shift) h(t−λ)', 'start', true);
    p2.setTitle('② 곱(Multiply) x(λ)·h(t−λ) — 색칠한 넓이(Integrate)가 y(t)', 'start', true);
    p3.setTitle('③ y(t): t까지의 값이 쌓이는 중', 'start', true);
    xLine.set(sampleX(setup));
    xJumps.set(jumpsX(setup));
    movingJumps.set(frame.movingJumps);
    xStems.set([]); movingStems.set([]); productStems.set([]); outStems.set([]);
    movingLine.set(frame.moving);
    flippedLine.set(frame.flipped);
    productLine.set(frame.product);
    productArea.set(frame.product);
    const hEnd = Math.max(0, ...setup.hEdges) || (setup.axis.hi - setup.axis.lo) * 0.12;
    const topY = p1.y1 * 0.88;
    flipLabel.setAt(-hEnd / 2, topY, 'h(−λ)', 'middle');
    moveLabel.setAt(t - hEnd / 2, topY * 0.86, 'h(t−λ)', 'middle');
    if (Math.abs(t) > (setup.axis.hi - setup.axis.lo) * 0.03) shiftArrow.set(0, p1.y0 * 0.45, t, p1.y0 * 0.45);
    else shiftArrow.hide();
    areaLabel.setAt(t, p2.y1 * 0.8, `y(${formatNumber(t)})=${formatNumber(frame.y)}`, t > (setup.axis.lo + setup.axis.hi) / 2 ? 'end' : 'start');
    const curve = outputCurve(setup);
    fullCurve.set(curve);
    accumulated.set([...curve.filter((point) => point[0] <= t), [t, frame.y]]);
    outDot.set(t, frame.y);
    outLabel.setAt(t, frame.y, `y=${formatNumber(frame.y)}`, t > (setup.axis.lo + setup.axis.hi) / 2 ? 'end' : 'start', -10);
  }

  const xCache = { setup: null, points: [], jumps: [] };
  function sampleX(setup) {
    if (xCache.setup !== setup) {
      xCache.setup = setup;
      xCache.points = sampleCurve(setup.x, setup.axis.lo, setup.axis.hi, 400, setup.xEdges, { gaps: true });
      xCache.jumps = jumpList(setup.x, setup.xEdges, setup.axis.lo, setup.axis.hi);
    }
    return xCache.points;
  }
  const jumpsX = (setup) => { sampleX(setup); return xCache.jumps; };

  function updateDiscrete(setup, n) {
    const frame = convolutionFrame(setup.x, setup.h, setup.xStart, setup.hStart, n);
    p1.setTitle('① x[k]와 뒤집어 옮긴 h[n−k]', 'start', true);
    p2.setTitle('② 곱 x[k]·h[n−k] — 모두 더하면 y[n]', 'start', true);
    p3.setTitle('③ y[n]: n까지의 값이 쌓이는 중', 'start', true);
    for (const line of [xLine, flippedLine, movingLine, productLine, fullCurve, accumulated]) line.set([]);
    xJumps.set([]); movingJumps.set([]);
    productArea.set([]);
    xStems.set(setup.x.map((v, i) => [setup.xStart + i - 0.12, v]));
    movingStems.set(flippedImpulse(setup.h, setup.hStart, n).map(([k, v]) => [k + 0.12, v]));
    productStems.set(frame.terms.map((term) => [term.k, term.product]));
    const out = setup.output.values.map((v, i) => [setup.output.start + i, v]);
    outStems.set(out, 0, { hollowFrom: n });
    shiftArrow.hide(); flipLabel.hide(); moveLabel.hide();
    areaLabel.setAt(n, p2.y1 * 0.8, `Σ = ${formatNumber(frame.sum)}`, n > (setup.axis.lo + setup.axis.hi) / 2 ? 'end' : 'start');
    outDot.set(n, frame.sum);
    outLabel.setAt(n, frame.sum, `y[${n}]=${formatNumber(frame.sum)}`, n > (setup.axis.lo + setup.axis.hi) / 2 ? 'end' : 'start', -10);
  }

  // Dragging anywhere in the panes moves the cursor.
  function move(event) {
    if (!last) return;
    const setup = cachedSetup(last.family, last.params, last.extra?.custom ?? null);
    const value = p1.fromPx(surface.pointer(event).x);
    const rounded = setup.discrete ? Math.round(value) : value;
    emit({ cursor: clamp(rounded, setup.domain.min, setup.domain.max) });
  }
  surface.svg.addEventListener('pointerdown', (event) => {
    if (event.button > 0) return;
    surface.svg.focus({ preventScroll: true });
    dragging = true;
    surface.svg.setPointerCapture?.(event.pointerId);
    move(event);
  });
  surface.svg.addEventListener('pointermove', (event) => { if (dragging) move(event); });
  for (const type of ['pointerup', 'pointercancel']) surface.svg.addEventListener(type, () => { dragging = false; });

  // Touch: only a finger near the cursor line claims the gesture; elsewhere the page scrolls.
  surface.setGrab((p) => {
    if (!last) return false;
    const t = cursors[0].node.getAttribute('x1');
    return t !== null && Math.abs(Number(t) - p.x) < GRAB && p.y >= p1.box.y && p.y <= p3.box.y + p3.box.h;
  });

  return { root, surface, layout, update, destroy: () => root.remove() };
}
