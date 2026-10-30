// Ch.14 frequency-response figure: one SVG of stacked panels sharing a logarithmic ω axis (|H| in dB over phase in degrees, or a single
// curve). Strings only, no DOM; colors are theme tokens. Pure.
//   plot = { title, range: [ωlo, ωhi], xLabel, legend, panels: [{ label, series, marks, hlines, band, cursor, phase, yMin, yMax, logY }] }
//   series = { points: [[ω, y]…], style: 'exact' | 'approx' | 'base' | 'term' }   marks = [{ w, label }]   hlines = [{ y, label }]
//   band = [ω1, ω2] (shaded)   cursor = ω (vertical line and a dot on every 'exact' series)
const W = 400, L = 50, R = 10, PANEL = 170, GAP = 34, TOP = 12;
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const STYLE = {
  exact: 'style="stroke:var(--accent)" stroke-width="2.5" fill="none"',
  approx: 'style="stroke:var(--text)" stroke-width="2" stroke-dasharray="7 5" fill="none"',
  base: 'style="stroke:var(--muted)" stroke-width="2" stroke-dasharray="3 4" fill="none"',
  term: 'style="stroke:var(--zero)" stroke-width="1.2" stroke-dasharray="2 4" fill="none"'
};

/** ω tick text: 0.01, 0.1, 1, 10, 100, 1k, 10k, 100k, 1M … */
export function decadeText(w) {
  const e = Math.round(Math.log10(w));
  if (e < 0) return String(Number((10 ** e).toPrecision(1)));
  if (e < 3) return String(10 ** e);
  const unit = e < 6 ? ['k', 3] : e < 9 ? ['M', 6] : ['G', 9];
  return String(10 ** (e - unit[1])) + unit[0];
}
/** 1-2-5 step giving three to six ticks over a span. */
export function linearStep(span) {
  const p = 10 ** Math.floor(Math.log10(span));
  return [0.1, 0.2, 0.5, 1, 2, 5].map(k => k * p).find(k => span / k <= 6);
}
/** 49000 → 49k, 0.25 → 0.25 (tick labels of a narrow window). */
export function siText(w) {
  const units = [[1e9, 'G'], [1e6, 'M'], [1e3, 'k']], u = units.find(([v]) => Math.abs(w) >= v);
  return u ? String(Number((w / u[0]).toPrecision(4))) + u[1] : String(Number(w.toPrecision(4)));
}
const short = n => (Math.abs(n) >= 1e4 || (Math.abs(n) < 1e-2 && n !== 0) ? n.toExponential(1) : String(Number(n.toPrecision(3))));
/** A step that gives about four to six grid lines; phase panels use multiples of 45°. */
export function niceStep(span, phase = false) {
  const steps = phase ? [15, 30, 45, 90, 180, 360, 720] : [1, 2, 5, 10, 20, 40, 50, 100, 200, 500, 1000];
  if (!phase && span < 4) { const p = 10 ** Math.floor(Math.log10(Math.max(span, 1e-12) / 4)); return [1, 2, 5, 10].map(k => k * p).find(k => span / k <= 6) ?? 10 * p; }
  return steps.find(s => span / s <= 6) ?? steps[steps.length - 1];
}

function panelSvg(panel, y0, range, xOf, withXLabels) {
  const finite = panel.series.flatMap(s => s.points.map(p => p[1])).filter(Number.isFinite);
  let lo = panel.yMin ?? Math.min(...finite, ...(panel.hlines ?? []).map(h => h.y)), hi = panel.yMax ?? Math.max(...finite, ...(panel.hlines ?? []).map(h => h.y));
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) { lo = -1; hi = 1; }
  if (panel.floor !== undefined) lo = Math.max(lo, hi - panel.floor);
  if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
  const step = niceStep(hi - lo, panel.phase);
  lo = Math.floor(lo / step - 1e-9) * step; hi = Math.ceil(hi / step + 1e-9) * step;
  const yOf = y => y0 + PANEL - (Math.min(hi, Math.max(lo, y)) - lo) / (hi - lo) * PANEL, x1 = W - R;
  let body = '<rect x="' + L + '" y="' + y0 + '" width="' + (x1 - L) + '" height="' + PANEL + '" style="fill:var(--field);stroke:var(--line)"/>';
  if (panel.band) body += '<rect x="' + xOf(panel.band[0]).toFixed(1) + '" y="' + y0 + '" width="' + Math.max(0, xOf(panel.band[1]) - xOf(panel.band[0])).toFixed(1) + '" height="' + PANEL
    + '" style="fill:var(--accent-soft)" opacity="0.6"/>';
  // Decade grid (with faint 2…9 lines); a window narrower than a decade gets plain 1-2-5 ticks instead.
  if (Math.log10(range[1] / range[0]) >= 1) {
    for (let e = Math.ceil(Math.log10(range[0]) - 1e-9); 10 ** e <= range[1] * (1 + 1e-9); e++) {
      for (let m = 2; m <= 9; m++) { const w = m * 10 ** e; if (w < range[1]) body += '<path d="M' + xOf(w).toFixed(1) + ' ' + y0 + 'v' + PANEL + '" style="stroke:var(--line-soft)" stroke-width="0.6"/>'; }
      const x = xOf(10 ** e).toFixed(1);
      body += '<path d="M' + x + ' ' + y0 + 'v' + PANEL + '" style="stroke:var(--grid)" stroke-width="1.2"/>';
      if (withXLabels) body += '<text x="' + x + '" y="' + (y0 + PANEL + 18) + '" font-size="15" text-anchor="middle">' + decadeText(10 ** e) + '</text>';
    }
  } else {
    const step = linearStep(range[1] - range[0]);
    for (let w = Math.ceil(range[0] / step) * step; w <= range[1]; w += step) {
      const x = xOf(w).toFixed(1);
      body += '<path d="M' + x + ' ' + y0 + 'v' + PANEL + '" style="stroke:var(--grid)" stroke-width="1"/>';
      if (withXLabels) body += '<text x="' + x + '" y="' + (y0 + PANEL + 18) + '" font-size="15" text-anchor="middle">' + siText(w) + '</text>';
    }
  }
  for (let y = lo; y <= hi + step / 2; y += step) {
    const py = yOf(y).toFixed(1);
    body += '<path d="M' + L + ' ' + py + 'H' + x1 + '" style="stroke:var(--grid)" stroke-width="' + (Math.abs(y) < step / 2 ? 1.6 : 0.8) + '"/>'
      + '<text x="' + (L - 6) + '" y="' + (Number(py) + 5) + '" font-size="15" text-anchor="end">' + short(Math.abs(y) < step / 1e6 ? 0 : y) + '</text>';
  }
  for (const h of panel.hlines ?? []) {
    const py = yOf(h.y).toFixed(1);
    body += '<path d="M' + L + ' ' + py + 'H' + x1 + '" style="stroke:var(--warning)" stroke-width="1.5" stroke-dasharray="5 4"/>'
      + (h.label ? '<text x="' + (x1 - 4) + '" y="' + (Number(py) - 5) + '" font-size="14" text-anchor="end" style="fill:var(--warning)">' + esc(h.label) + '</text>' : '');
  }
  for (const s of panel.series) {
    let d = '', pen = false;
    for (const [w, y] of s.points) {
      if (!Number.isFinite(y) || w < range[0] * (1 - 1e-9) || w > range[1] * (1 + 1e-9)) { pen = false; continue; }
      d += (pen ? 'L' : 'M') + xOf(w).toFixed(1) + ' ' + yOf(y).toFixed(1);
      pen = true;
    }
    if (d) body += '<path d="' + d + '" ' + STYLE[s.style ?? 'exact'] + ' data-cc-series="' + esc(s.style ?? 'exact') + '"/>';
  }
  (panel.marks ?? []).forEach((m, i) => {
    if (!(m.w >= range[0] && m.w <= range[1])) return;
    const x = xOf(m.w).toFixed(1);
    body += '<path d="M' + x + ' ' + y0 + 'v' + PANEL + '" style="stroke:var(--success)" stroke-width="1.5" stroke-dasharray="2 3"/>'
      + (m.label ? '<text x="' + (Number(x) + 3) + '" y="' + (y0 + 15 + 15 * (i % 2)) + '" font-size="14" style="fill:var(--success)">' + esc(m.label) + '</text>' : '');
  });
  if (Number.isFinite(panel.cursor) && panel.cursor >= range[0] && panel.cursor <= range[1]) {
    const x = xOf(panel.cursor).toFixed(1);
    body += '<path d="M' + x + ' ' + y0 + 'v' + PANEL + '" style="stroke:var(--text)" stroke-width="1.5" data-cc-cursor/>';
    for (const s of panel.series.filter(s => (s.style ?? 'exact') === 'exact')) {
      const y = s.cursorValue;
      if (Number.isFinite(y)) body += '<circle cx="' + x + '" cy="' + yOf(y).toFixed(1) + '" r="5" style="fill:var(--accent);stroke:var(--text)"/>';
    }
  }
  body += '<text x="' + (L + 6) + '" y="' + (y0 + PANEL - 8) + '" font-size="15" font-weight="bold">' + esc(panel.label) + '</text>';
  return body;
}

/** The whole figure as an HTML string (a card with the SVG and a one-line legend). */
export function freqPlot(plot) {
  const range = plot.range, lx = Math.log10(range[0]), span = Math.log10(range[1]) - lx;
  const xOf = w => L + (Math.log10(w) - lx) / span * (W - L - R);
  const n = plot.panels.length, H = TOP + n * PANEL + (n - 1) * GAP + 44;
  const panels = plot.panels.map((p, i) => panelSvg(p, TOP + i * (PANEL + GAP), range, xOf, true)).join('');
  return '<section class="circuit-course-card cc-freq" data-cc-freq><h3>' + esc(plot.title) + '</h3><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(plot.title) + '">' + panels
    + '<text x="' + (W - R) + '" y="' + (H - 6) + '" font-size="15" text-anchor="end">' + esc(plot.xLabel ?? 'ω (rad/s, 로그 눈금)') + '</text></svg>'
    + (plot.legend ? '<p class="circuit-course-note">' + esc(plot.legend) + '</p>' : '') + '</section>';
}

/** n points per decade on a log grid from lo to hi (both included). */
export function logGrid(lo, hi, perDecade = 60) {
  const n = Math.max(2, Math.ceil(Math.log10(hi / lo) * perDecade));
  return Array.from({ length: n + 1 }, (_, i) => lo * (hi / lo) ** (i / n));
}
