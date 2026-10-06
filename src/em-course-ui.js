// DOM of the course screen: the shell, the live parameter strip, the answer card and the side sections.
// Everything is built once per experiment; value changes only update values in place so focus is never lost.
import { appendCourseMath } from './course-math-view.js';
import { siComplex, siText, siVector } from './em-format.js';
import { formatParam, isParamVisible, paramSpec, rangeFromValue } from './em-course-params.js';

const statusLabel = { valid: '유효', singular: '특이점', boundary: '경계', invalid: '입력 오류', unsupported: '지원 범위 밖' };
const UNITS = { E: 'V/m', D: 'C/m²', B: 'T', H: 'A/m' };
export { statusLabel };

export const SHELL = `
<div class="em-course-shell">
  <header class="em-course-bar">
    <button id="em-course-back" type="button">← 자유실험실</button>
    <label class="em-course-pick em-pick-topic">분야 <select id="em-course-topic"></select></label>
    <label class="em-course-pick em-course-pick-wide em-pick-exp">실험 <select id="em-course-select"></select></label>
    <button id="em-course-reset" type="button">초기화</button>
  </header>
  <div class="em-course-body">
    <section class="em-course-visual" aria-label="그림">
      <div class="em-course-heading">
        <strong id="em-course-title"></strong><span id="em-course-status" class="em-course-status"></span>
      </div>
      <p class="em-note" id="em-course-desc" hidden></p>
      <p class="em-note" id="em-course-picture-note" hidden></p>
      <div class="em-course-canvas-box" id="em-course-canvas-box">
        <canvas id="em-course-canvas" tabindex="0"
          aria-label="전자기학 실험의 측정점과 장 방향. 끌거나 방향키로 측정점을 옮깁니다."></canvas>
      </div>
      <canvas id="em-course-radial-canvas" hidden tabindex="0"
        aria-label="동축 반경별 자기장 그래프: 드래그하면 관측 반경이 바뀝니다"></canvas>
      <div class="em-course-time" id="em-course-time" hidden>
        <button id="em-course-play" type="button">재생</button>
        <input aria-label="시각" id="em-course-time-slider" max="1000" min="0" step="1" type="range" value="0">
        <output id="em-course-time-text"></output>
      </div>
      <canvas id="em-course-trace" hidden aria-label="기전력의 시간 변화"></canvas>
      <div class="em-course-viewbar">
        <label class="em-course-vector-pick" id="em-course-vector-pick">표시 벡터 <select id="em-course-vector"></select></label>
        <button aria-pressed="false" class="em-chip" id="em-course-grid-chip" type="button">격자 화살표</button>
        <span class="em-course-zoom">
          <button id="em-course-zoom-in" type="button" aria-label="확대">＋</button>
          <button id="em-course-zoom-out" type="button" aria-label="축소">－</button>
          <button id="em-course-zoom-reset" type="button">보기 초기화</button>
        </span>
      </div>
      <p class="em-note" id="em-course-gesture"></p>
    </section>
    <section class="em-course-side" aria-label="조건과 답">
      <div class="em-card" id="em-course-params-card">
        <div class="em-side-head"><strong>조건</strong><span class="em-note" id="em-course-kind"></span></div>
        <div class="em-course-strip" id="em-course-parameters"></div>
        <div class="em-course-conditions" id="em-course-symbolic-controls"></div>
        <div class="em-course-radius" id="em-course-radius-control" hidden>
          <label for="em-course-radius">관측 반경 r/a</label>
          <input id="em-course-radius" type="range" min="0" max="4.5" step="0.01" value="2" aria-label="동축 관측 반경 r/a">
          <output id="em-course-radius-value"></output>
        </div>
        <p class="em-error" id="em-course-error" role="alert" hidden></p>
      </div>
      <div class="em-card em-course-sweep" id="em-course-sweep" hidden>
        <label for="em-course-sweep-input" id="em-course-sweep-label"></label>
        <span class="em-number"><input id="em-course-sweep-input" inputmode="decimal" autocomplete="off"><i id="em-course-sweep-unit"></i></span>
        <p class="em-error" id="em-course-sweep-error" role="alert" hidden></p>
      </div>
      <div class="em-card em-course-answer-card">
        <div class="em-side-head">
          <strong>현재 답</strong>
          <span class="segmented" role="group" aria-label="답 표시">
            <button aria-pressed="true" data-em-answer-mode="numeric" type="button">숫자</button>
            <button aria-pressed="false" data-em-answer-mode="symbolic" type="button">문자</button>
          </span>
        </div>
        <div id="em-course-answer-numeric">
          <label class="em-course-requested">구할 값 <select id="em-course-requested"></select></label>
          <output id="em-course-answer" aria-live="polite"></output>
          <p class="em-note" id="em-course-substitution"></p>
        </div>
        <div id="em-course-answer-symbolic" hidden><div id="em-course-active-branch" aria-live="polite"></div></div>
      </div>
      <div class="em-card">
        <div class="em-side-head"><strong>풀이 보기</strong><span class="em-note">단계를 눌러 펼칩니다</span></div>
        <div id="em-course-symbolic"></div>
      </div>
      <details class="em-card em-course-section" id="em-course-values-section">
        <summary>측정값 · 수치 검증 <span class="em-course-pill" id="em-course-check-pill"></span></summary>
        <dl id="em-course-values"></dl><ul id="em-course-notes"></ul><div id="em-course-checks"></div>
      </details>
      <details class="em-card em-course-section">
        <summary>가정 · 범위 · 해석식</summary>
        <strong>가정</strong><ul id="em-course-assumptions"></ul>
        <strong>유효 범위</strong><ul id="em-course-validity"></ul>
        <strong>특이점·경계</strong><ul id="em-course-singularities"></ul>
        <strong>해석식</strong><div id="em-course-formulas"></div>
      </details>
      <details class="em-card em-course-section">
        <summary>근거 자료 · 학습 범위</summary>
        <ul id="em-course-references"></ul><div id="em-course-roadmap-items"></div>
      </details>
    </section>
  </div>
</div>`;

const list = (parent, values) => {
  parent.replaceChildren();
  for (const text of values || []) {
    const item = document.createElement('li');
    item.textContent = String(text);
    parent.append(item);
  }
};
export { list };

// ---- parameter strip -------------------------------------------------------------------------------------------

/**
 * One row per parameter: a slider (range kinds) with an exact number, a choice (select kinds) or a number only.
 * `skip` lists parameter keys shown elsewhere (the clock, shared structural choices).
 */
export function buildParameterStrip(host, definition, params, skip) {
  host.replaceChildren();
  for (const parameter of definition.parameters || []) {
    if (skip.has(parameter.key)) continue;
    const spec = paramSpec(parameter), row = document.createElement('div');
    row.className = 'em-param';
    row.dataset.param = parameter.key;
    row.title = parameter.label;
    row.hidden = !isParamVisible(parameter, params);
    const label = document.createElement('span');
    label.className = 'em-param-label';
    label.textContent = spec.label;
    // The parenthetical of the label is a helper line under it, visible on a phone too (a tooltip is not).
    if (spec.note) {
      const note = document.createElement('small');
      note.className = 'em-param-note';
      note.textContent = spec.note;
      label.append(note);
    }
    row.append(label);
    if (spec.kind === 'select') {
      const select = document.createElement('select');
      select.dataset.emCourseParameter = parameter.key;
      select.setAttribute('aria-label', parameter.label);
      for (const [value, title] of spec.options) select.append(Object.assign(document.createElement('option'), { value, textContent: title }));
      select.value = String(params[parameter.key]);
      row.append(select);
    } else {
      if (spec.kind === 'range') {
        const slider = document.createElement('input');
        slider.type = 'range'; slider.min = '0'; slider.max = '1000'; slider.step = '1';
        slider.dataset.emCourseSlider = parameter.key;
        slider.setAttribute('aria-label', `${parameter.label} 슬라이더`);
        slider.value = String(Math.round(rangeFromValue(spec, params[parameter.key]) * 1000));
        row.append(slider);
      } else row.classList.add('no-slider');
      const box = document.createElement('span'), input = document.createElement('input'), unit = document.createElement('i');
      box.className = 'em-number';
      input.dataset.emCourseParameter = parameter.key;
      input.inputMode = 'decimal';
      input.setAttribute('aria-label', `${parameter.label} (${spec.unit || '무차원'})`);
      input.value = formatParam(spec, params[parameter.key]);
      unit.textContent = spec.unit;
      box.append(input, unit);
      row.append(box);
    }
    host.append(row);
  }
}

/** Write current values into the strip without touching the control the user is typing in. */
export function syncParameterStrip(host, definition, params) {
  for (const parameter of definition.parameters || []) {
    const spec = paramSpec(parameter), value = params[parameter.key];
    const row = host.querySelector(`[data-param="${parameter.key}"]`);
    if (row) row.hidden = !isParamVisible(parameter, params);
    const input = host.querySelector(`[data-em-course-parameter="${parameter.key}"]`);
    const slider = host.querySelector(`[data-em-course-slider="${parameter.key}"]`);
    if (input && input !== document.activeElement) input.value = spec.kind === 'select' ? String(value) : formatParam(spec, value);
    if (slider && slider !== document.activeElement) slider.value = String(Math.round(rangeFromValue(spec, value) * 1000));
  }
}

// ---- answer -----------------------------------------------------------------------------------------------------

/** The selectable quantities of a result: [{ key, label, text, group }]; group is '답' | '중간값' | '좌표'. */
export function answerItems(result, definition) {
  const answers = definition?.answerKeys || [], coordinates = definition?.coordinateKeys || [];
  const groupOf = key => (answers.includes(key) ? '답' : coordinates.includes(key) ? '좌표' : '중간값');
  const items = [];
  for (const [key, v] of Object.entries(result.vectors || {})) {
    if (!Array.isArray(v) || !v.every(Number.isFinite)) continue;
    const unit = UNITS[key] || '';
    items.push({ key: `vector:${key}`, label: `${key} 벡터`, text: `${key}=${siVector(v, unit)}`, group: '중간값' });
    items.push({ key: `magnitude:${key}`, label: `|${key}| 크기`, text: `|${key}|=${siText(Math.hypot(...v), unit)}`, group: '중간값' });
  }
  for (const s of result.scalars || []) {
    if (Number.isFinite(s.value)) items.push({ key: `scalar:${s.key}`, label: s.label, text: `${s.label}=${siText(s.value, s.unit || '')}`, group: groupOf(s.key) });
  }
  for (const p of result.phasors || []) {
    if (Number.isFinite(p.re) && Number.isFinite(p.im)) {
      const value = siComplex(p.re, p.im, p.unit || '', { polar: false });
      items.push({ key: `phasor:${p.key}`, label: `${p.label} 위상자`, text: `${p.label}=${value} · ${p.reference || ''}`, group: '중간값' });
    }
  }
  return items;
}

/** Fill the "구할 값" select and return the text of the chosen item (or an explanation). */
export function renderRequested(select, output, data, result, definition) {
  const items = answerItems(result, definition);
  if (!data.requestedKey && items.length) {
    // An experiment that names its final answers opens on the first of them; the others open on the voltage phasor or the first item.
    const headline = definition?.answerKeys?.[0] && items.find(item => item.key === `scalar:${definition.answerKeys[0]}`);
    const first = headline || items.find(item => item.key === 'phasor:voltage') || items[0];
    data.requestedKey = first.key;
    data.requestedLabel = first.label;
  }
  select.replaceChildren();
  const grouped = items.some(item => item.group === '답');
  const groups = new Map();
  for (const item of items) {
    const entry = Object.assign(document.createElement('option'), { value: item.key, textContent: item.label });
    if (!grouped) { select.append(entry); continue; }
    if (!groups.has(item.group)) groups.set(item.group, Object.assign(document.createElement('optgroup'), { label: item.group }));
    groups.get(item.group).append(entry);
  }
  // Answers first, then intermediate values, then the sweep coordinate.
  for (const name of ['답', '중간값', '좌표']) if (groups.has(name)) select.append(groups.get(name));
  const chosen = items.find(item => item.key === data.requestedKey);
  if (data.requestedKey && !chosen) {
    select.append(Object.assign(document.createElement('option'), {
      value: data.requestedKey, textContent: `${data.requestedLabel} · 유한 단일값 없음`,
    }));
  }
  select.value = data.requestedKey;
  const infinite = data.requestedKey === 'scalar:swr' && (result.notes || []).some(n => n.includes('SWR') && n.includes('무한'));
  output.textContent = chosen ? chosen.text : infinite ? 'SWR = ∞ (완전반사 · 유한 숫자 없음)'
    : `요청한 값은 이 위치/모델에서 유한 단일값으로 표시할 수 없습니다. ${result.reason || ''}`;
}

export function renderValues(dl, result) {
  dl.replaceChildren();
  const add = (label, value) => {
    const dt = document.createElement('dt'), dd = document.createElement('dd');
    dt.textContent = label; dd.textContent = value;
    dl.append(dt, dd);
  };
  if (result.status !== 'valid') { add('계산 상태', result.reason || '이 측정 위치에서는 장을 표시하지 않습니다.'); return; }
  for (const [key, vector] of Object.entries(result.vectors || {})) {
    if (!Array.isArray(vector) || !vector.every(Number.isFinite)) continue;
    add(`${key} (x, y, z)`, siVector(vector, UNITS[key] || ''));
    add(`|${key}|`, siText(Math.hypot(...vector), UNITS[key] || ''));
  }
  for (const item of result.scalars || []) if (Number.isFinite(item.value)) add(item.label || item.key, siText(item.value, item.unit || ''));
  for (const p of result.phasors || []) {
    if (Number.isFinite(p.re) && Number.isFinite(p.im)) add(`${p.label} · 복소/극형`, siComplex(p.re, p.im, p.unit || ''));
  }
}

export function renderChecks(container, pill, data) {
  container.replaceChildren();
  const passed = data.checks.filter(row => row.status === 'pass').length, failed = data.checks.filter(row => row.status === 'fail').length;
  const other = data.checks.length - passed - failed;
  const failedText = failed ? ` · ${failed} 불일치` : '', otherText = other ? ` · ${other} 미판정` : '';
  pill.textContent = data.checkError ? '검증 오류' : data.checked ? `${passed} 통과${failedText}${otherText}` : '';
  pill.dataset.status = data.checkError || failed ? 'fail' : data.checked && data.checks.length && passed === data.checks.length ? 'pass' : 'skipped';
  if (data.checkError) { container.textContent = `검증 오류: ${data.checkError}`; return; }
  for (const row of data.checks) {
    const block = document.createElement('div'), title = document.createElement('strong');
    block.className = 'em-course-check'; block.dataset.status = row.status;
    const unsettled = ['unconverged', 'inconclusive'].includes(row.status) ? '수치 미수렴/미판정' : '미판정/범위 제외';
    const verdict = row.status === 'pass' ? 'PASS' : row.status === 'fail' ? '비교 불일치' : unsettled;
    title.textContent = `${verdict} · ${row.label}`;
    const numbers = document.createElement('p'), detail = document.createElement('p');
    numbers.textContent = `수치 ${siText(row.actual, row.unit || '')} / 기준 ${siText(row.expected, row.unit || '')}`;
    const tolerance = `허용오차 abs ${row.absTolerance ?? '—'} / rel ${row.relTolerance ?? '—'}`;
    detail.textContent = [row.method, row.reason, tolerance].filter(Boolean).join(' · ');
    block.append(title, numbers, detail);
    container.append(block);
  }
}

// ---- static sections of an experiment ---------------------------------------------------------------------------

export function renderStatics(root, definition, roadmap) {
  const $ = selector => root.querySelector(selector);
  list($('#em-course-assumptions'), definition.assumptions);
  list($('#em-course-validity'), definition.validity);
  list($('#em-course-singularities'), definition.singularities);
  const formulas = $('#em-course-formulas');
  formulas.replaceChildren();
  for (const item of definition.formulas || []) {
    const label = document.createElement('strong');
    label.className = 'em-course-formula-label';
    label.textContent = item.label + (item.unit ? ` [${item.unit}]` : '');
    formulas.append(label);
    appendCourseMath(formulas, item.text);
  }
  const references = $('#em-course-references');
  references.replaceChildren();
  for (const ref of definition.references || []) {
    try {
      const url = new URL(ref.url);
      if (!['https:', 'http:'].includes(url.protocol)) continue;
      const li = document.createElement('li'), a = document.createElement('a');
      a.textContent = ref.title; a.href = url.href; a.target = '_blank'; a.rel = 'noopener noreferrer';
      li.append(a); references.append(li);
    } catch { /* an invalid reference is omitted */ }
  }
  const items = $('#em-course-roadmap-items');
  if (!items.childElementCount) {
    for (const item of roadmap) {
      const p = document.createElement('p');
      p.textContent = `${item.status === 'implemented' ? '구현' : '미지원/예정'} · ${item.title}: ${item.description}`;
      items.append(p);
    }
  }
}

/**
 * Turn the flat symbolic solution (h4 headings followed by their content) into one collapsible section per heading,
 * so the solution is a short list of steps rather than a wall of text. Existing <details> stay as they are.
 * `openTitles` lists headings that start open.
 */
export function sectionize(container, openTitles = ['기호 정답']) {
  const children = [...container.childNodes];
  let section = null;
  for (const node of children) {
    if (node.nodeType === 1 && node.tagName === 'H4') {
      section = document.createElement('details');
      section.className = 'em-course-step';
      section.open = openTitles.includes(node.textContent.trim());
      const summary = document.createElement('summary');
      summary.textContent = node.textContent;
      section.append(summary);
      container.replaceChild(section, node);
    } else if (section && !(node.nodeType === 1 && (node.tagName === 'DETAILS' || node.tagName === 'H3'))) {
      section.append(node);
    } else if (node.nodeType === 1 && node.tagName === 'DETAILS') {
      node.classList.add('em-course-step');
      section = null;
    }
  }
}
