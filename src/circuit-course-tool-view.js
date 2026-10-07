// DOM for one live course tool. The form is built once and only its values/visibility are updated afterwards, so focus and a dragged slider
// survive every input; the result area is redrawn each time. Colors come from the course stylesheet tokens.
import { escapeHtml as esc } from './safe-dom.js';
import { phasorGraphs, waves, triangle, table, verificationTable, examplesFold, examplesSummary, FOLD_OPEN_MAX } from './circuit-course-view.js';
import { fmt } from './circuit-course-format.js';
import { toolFigure } from './circuit-course-figures.js';
import { isShown, labelOf, unitOf, sliderOf, toDisplay, draftText } from './circuit-course-tool-common.js';

export { draftText };

function lineChart(curve) {
  const pts = curve.points, xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y1 = Math.max(...ys, 1e-30), W = 440, H = 220, L = 60, B = 40;
  const X = x => L + (x1 === x0 ? 0 : (x - x0) / (x1 - x0)) * (W - L - 12), Y = y => H - B - Math.max(0, y) / y1 * (H - B - 18);
  const path = pts.map((p, i) => (i ? 'L' : 'M') + X(p[0]).toFixed(1) + ' ' + Y(p[1]).toFixed(1)).join(' ');
  const mark = (pt, glyph, label, dy) => '<text x="' + (X(pt[0]) + 8) + '" y="' + (Y(pt[1]) + dy) + '" font-size="13">' + esc(glyph + ' ' + label) + '</text>';
  const best = curve.best ? '<circle cx="' + X(curve.best[0]) + '" cy="' + Y(curve.best[1]) + '" r="6" fill="none" style="stroke:var(--warning)" stroke-width="3"/>' + mark(curve.best, '○', '최대 ' + fmt(curve.best[1]) + ' W', -10) : '';
  const now = curve.mark ? '<path d="M' + (X(curve.mark[0]) - 6) + ' ' + (Y(curve.mark[1]) - 6) + 'l12 12m0 -12l-12 12" style="stroke:var(--text)" stroke-width="3" fill="none"/>' + mark(curve.mark, '×', '지금 ' + fmt(curve.mark[1])
    + ' W', 22) : '';
  return '<section class="circuit-course-card cc-curve"><h3>' + esc(curve.title) + '</h3><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(curve.title) + '"><path d="M' + L + ' 12V' + (H - B) + 'H' + (W - 12)
    + '" style="stroke:var(--line)" fill="none"/><path class="cc-line" d="' + path + '"/>'
    + best + now + '<text x="' + L + '" y="' + (H - 10) + '" font-size="13">' + esc(fmt(x0)) + '</text><text x="' + (W - 12) + '" y="' + (H - 10) + '" font-size="13" text-anchor="end">' + esc(fmt(x1)) + ' ' + esc(curve.xLabel)
      + '</text><text x="4" y="22" font-size="13">' + esc(fmt(y1)) + ' W</text></svg></section>';
}

export function createCourseToolView(host, def) {
  const doc = host.ownerDocument;
  let lastPreset = null;
  const inputOf = key => host.querySelector('[data-cc-key="' + key + '"]');
  const presets = def.presets.map((p, i) => '<button type="button" data-cc-preset="' + i + '" aria-pressed="false">' + esc(p.label) + '</button>').join('');
  const fieldHtml = f => {
    if (f.kind === 'heading') return '<h4 data-cc-field="' + f.key + '">' + esc(f.label) + '</h4>';
    const control = f.kind === 'select'
      ? '<select data-cc-key="' + f.key + '">' + f.choices.map(([k, t]) => '<option value="' + esc(k) + '">' + esc(t) + '</option>').join('') + '</select>'
      : '<input type="text" data-cc-key="' + f.key + '" autocomplete="off" spellcheck="false"' + (f.kind === 'number' ? ' inputmode="decimal"' : '') + '>' + (f.kind === 'number' && f.slider ? '<input type="range" data-cc-slider="'
        + f.key + '" step="any">' : '');
    return '<label data-cc-field="' + f.key + '" class="cc-field-row"><span data-cc-label></span>' + control + '<small class="cc-tool-error" role="status" data-cc-error="' + f.key + '"></small></label>';
  };
  host.innerHTML = '<div class="circuit-course-card" data-cc-tool="' + def.id + '"><h3>' + esc(def.title) + '</h3><p>' + esc(def.lead) + '</p>' + examplesFold(def.presets.length, null, presets, null, def.id, 'cc-tool-presets')
    + '<div class="cc-tool-grid"><form class="cc-tool-form" novalidate>' + def.fields.map(fieldHtml).join('')
      + '</form><div><div class="circuit-course-status" role="status" aria-live="polite" data-cc-status></div><div data-cc-results></div></div></div></div>';
  const results = host.querySelector('[data-cc-results]'), statusEl = host.querySelector('[data-cc-status]');

  return {
    inputOf,
    /** Visibility, dynamic labels, slider ranges and values; the field being typed in keeps its text. */
    syncForm(values, basis, drafts, errors) {
      for (const f of def.fields) {
        const row = host.querySelector('[data-cc-field="' + f.key + '"]');
        if (!row) continue;
        row.hidden = !isShown(f, values);
        if (f.kind === 'heading') continue;
        const unit = unitOf(f, values), basisTag = f.amplitude ? ' ' + basis : '';
        row.querySelector('[data-cc-label]').textContent = labelOf(f, values) + (unit || basisTag ? ' (' + (unit + basisTag).trim() + ')' : '');
        const input = row.querySelector('[data-cc-key]');
        if (f.kind === 'select') input.value = values[f.key];
        else if (input !== doc.activeElement) input.value = f.kind === 'text' ? values[f.key] : drafts[f.key] ?? '';
        const slider = row.querySelector('[data-cc-slider]');
        if (slider) {
          const range = sliderOf(f, values), shown = toDisplay(f, values[f.key], basis), scale = f.amplitude ? toDisplay(f, 1, basis) : 1;
          slider.min = String(range.min * scale); slider.max = String(range.max * scale); slider.step = String(range.step * scale);
          slider.value = String(Math.min(range.max * scale, Math.max(range.min * scale, shown)));
          slider.setAttribute('aria-label', labelOf(f, values));
        }
        const message = errors[f.key] ?? '';
        row.querySelector('[data-cc-error]').textContent = message;
        if (input) { if (message) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid'); }
      }
    },
    /** Marks the applied example and keeps its label in the fold's summary line (it stays after a later manual edit: "last applied"). */
    showPresetState(active) {
      host.querySelectorAll('[data-cc-preset]').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.ccPreset) === active)));
      if (active >= 0 && def.presets[active]) lastPreset = def.presets[active].label;
      const summary = host.querySelector('[data-circuit-course-examples-fold] > summary');
      if (summary) summary.textContent = examplesSummary(def.presets.length, lastPreset);
    },
    /** A long example list closes after one was used, so the inputs and the result come back up the screen. */
    foldPresets() {
      const fold = host.querySelector('[data-circuit-course-examples-fold]');
      if (!fold || def.presets.length <= FOLD_OPEN_MAX) return;
      const hadFocus = fold.contains(doc.activeElement);
      fold.open = false;
      if (hadFocus) fold.querySelector('summary').focus({ preventScroll: true });
    },
    status(message, kind = 'valid') { statusEl.textContent = message; statusEl.dataset.kind = kind; },
    /** result: valid tool result; verification: rows for an active lecture preset or null; basis: 'peak' | 'rms'. */
    showResult(result, verification, basis) {
      let html = result.read ? '<p class="cc-tool-read" data-cc-read>' + esc(result.read) + '</p>' : '';
      if (result.figure) html += '<section class="circuit-course-card">' + toolFigure(result.figure) + '</section>';
      if (result.metrics?.length) html += '<div class="circuit-course-metrics">' + result.metrics.map(m => '<div class="circuit-course-metric"><span>' + esc(m.label) + '</span><strong>' + esc(m.text) + '</strong>' + esc(m.unit)
        + '</div>').join('') + '</div>';
      if (verification?.length) html += verificationTable(verification, basis);
      html += (result.tables ?? []).map(t => '<section class="circuit-course-card"><h3>' + esc(t.title) + '</h3>' + table(t.headers, t.rows) + '</section>').join('');
      html += '<div class="circuit-course-graphs">' + (result.phasors?.length ? phasorGraphs(result.phasors, basis) : '') + (result.triangles ?? []).map(t => triangle(t.p, t.title)).join('')
        + (result.curves ?? []).map(lineChart).join('') + (result.traces?.length ? waves(result.traces, result.frequencyHz) : '') + '</div>';
      if (result.checks?.length) html += '<section class="circuit-course-card"><h3>독립 검산</h3>' + table(['검사', '값', '기대', '허용', '결과'], result.checks.map(c => [c.label, fmt(c.actual) + ' ' + (c.unit ?? ''), fmt(c.expected) + ' '
        + (c.unit ?? ''), fmt(c.tol ?? c.tolerance), c.pass ? 'PASS' : 'FAIL'])) + '</section>';
      if (result.notes?.length) html += '<section class="circuit-course-card"><ul>' + result.notes.map(n => '<li>' + esc(n) + '</li>').join('') + '</ul></section>';
      results.innerHTML = html;
    },
    clear() { host.replaceChildren(); }
  };
}
