import { renderSymbolic } from './course-symbolic-view.js';
import { appendCourseMath } from './course-math-view.js';
import { magnitude, rectangularPolar, waveSample } from './circuit-course-model.js';
import { EXPERIMENTS, REFERENCES } from './circuit-course-registry.js';
import { escapeHtml as esc } from './safe-dom.js';
// Intl.NumberFormat construction dominates the cost, so the two formatters are built once.
const numberFormats = { scientific: new Intl.NumberFormat('en-US', { maximumSignificantDigits: 7, notation: 'scientific' }), standard: new Intl.NumberFormat('en-US', { maximumSignificantDigits: 7, notation: 'standard' }) };
export function formatNumber(n) { return n === null || n === undefined || !Number.isFinite(n) ? '미정' : numberFormats[Math.abs(n) > 0 && (Math.abs(n) < 1e-4 || Math.abs(n) >= 1e7) ? 'scientific' : 'standard'].format(Object.is(n, -0) ? 0 : n); }
// Learning tools that are not numeric experiments (own screen, own controller) share the tab row.
export const TOOL_TABS = [{ id: 'y-delta', title: '7 · Y–Δ 변환' }];
const fmt = formatNumber;
const zText = z => !z ? '유한한 값 없음' : fmt(z.re) + (z.im < 0 ? ' − j' : ' + j') + fmt(Math.abs(z.im));
const polarText = z => { const p = rectangularPolar(z); return fmt(p.magnitude) + ' ∠ ' + (p.angleDeg === null ? '위상 미정' : fmt(p.angleDeg) + '°'); };
// Series colors are theme tokens (defined with the stylesheet below), never literals in markup.
const colors = [0, 1, 2, 3, 4, 5].map(n => 'var(--cc-s' + n + ')');
const style = [
'.circuit-course{--cc-s0:#52b4ff;--cc-s1:#ffb75c;--cc-s2:#c3a1ff;--cc-s3:#55dfaa;--cc-s4:#ff859b;--cc-s5:#c6d572}',
':root[data-theme="light"] .circuit-course{--cc-s0:#0b64a8;--cc-s1:#a85a00;--cc-s2:#6b3fb3;--cc-s3:#16784f;--cc-s4:#b3243f;--cc-s5:#6b7300}',
'.circuit-course{color:var(--text);background:var(--bg);padding:18px;border-radius:14px;font:15px/1.6 system-ui,sans-serif;max-width:1600px;margin:auto;box-sizing:border-box}',
'.circuit-course *{box-sizing:border-box}.circuit-course button,.circuit-course input,.circuit-course select{font:inherit;color:inherit}',
'.circuit-course button{cursor:pointer;border:1px solid var(--line);background:var(--raised);border-radius:8px;padding:9px 12px;min-height:44px}',
'.circuit-course button[aria-current=true]{background:var(--selection);border-color:var(--accent)}.circuit-course button:focus-visible,.circuit-course input:focus-visible,.circuit-course select:focus-visible{outline:3px solid var(--accent);outline-offset:3px}',
'.circuit-course h2,.circuit-course h3,.circuit-course p{margin:0 0 10px}.circuit-course h2{font-size:24px}.circuit-course h3{font-size:18px}',
'.circuit-course .circuit-course-primary-answers{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.circuit-course .circuit-course-primary-answers>h3,.circuit-course .circuit-course-primary-answers>p{grid-column:1/-1}.circuit-course .circuit-course-primary-answers .course-symbolic-answer{margin:0}@media(max-width:760px){.circuit-course .circuit-course-primary-answers{grid-template-columns:minmax(0,1fr)}.circuit-course[data-circuit-course-presentation=symbolic] .circuit-course-layout>main{order:-1}}',
'.circuit-course .circuit-course-tabs{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0}',
'.circuit-course .circuit-course-layout{display:grid;grid-template-columns:minmax(250px,320px) minmax(0,1fr);gap:18px}',
'.circuit-course .circuit-course-card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:14px;margin-bottom:14px;min-width:0}',
'.circuit-course .circuit-course-layout>aside,.circuit-course .circuit-course-layout>main{min-width:0}.circuit-course .circuit-course-schematic{max-height:240px}',
'.circuit-course .circuit-course-form{display:grid;gap:10px}.circuit-course label{display:grid;gap:3px}',
'.circuit-course input:not([type=range]),.circuit-course select{background:var(--field);border:1px solid var(--line);border-radius:7px;width:100%;padding:8px;min-height:44px}',
'.circuit-course [hidden]{display:none!important}.circuit-course .circuit-course-note{color:var(--muted);font-size:13px}.circuit-course .circuit-course-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}',
'.circuit-course .circuit-course-apply{background:var(--action);border-color:var(--action);color:#fff;font-weight:bold}',
'.circuit-course .circuit-course-status{padding:10px 12px;border-left:4px solid var(--success);background:var(--success-bg);margin:12px 0;overflow-wrap:anywhere}',
'.circuit-course .circuit-course-status[data-kind=error],.circuit-course .circuit-course-warning{background:var(--warning-bg);border-left-color:var(--warning);color:var(--text)}',
'.circuit-course .circuit-course-status[data-kind=draft]{background:var(--selection);border-left-color:var(--accent)}',
'.circuit-course .circuit-course-linked-results{display:grid;grid-template-columns:minmax(0,2fr) minmax(280px,1fr);gap:12px;align-items:start}@media(max-width:1000px){.circuit-course .circuit-course-linked-results{grid-template-columns:minmax(0,1fr)}}',
'.circuit-course .circuit-course-graphs{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,330px),1fr));gap:12px}',
'.circuit-course svg{width:100%;height:auto;display:block;background:var(--canvas);border-radius:7px}.circuit-course svg text{font-family:system-ui,sans-serif;fill:var(--text)}',
'.circuit-course .circuit-course-legend{display:flex;flex-wrap:wrap;gap:6px 16px;margin:8px 0;font-size:13px}',
'.circuit-course .circuit-course-metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(135px,1fr));gap:8px;margin:12px 0}',
'.circuit-course .circuit-course-metric{background:var(--raised);border-radius:8px;padding:9px;overflow-wrap:anywhere}',
'.circuit-course .circuit-course-metric strong{display:block;font-size:20px}.circuit-course .circuit-course-metric span{color:var(--muted);font-size:13px}',
'.circuit-course textarea{font:inherit;color:inherit;resize:vertical;min-height:100px;width:100%;padding:8px;background:var(--field);border:1px solid var(--line);border-radius:7px}.circuit-course .circuit-course-worksheet li{margin-bottom:12px}.circuit-course .circuit-course-status{white-space:pre-wrap}',
'.circuit-course .circuit-course-table-wrap{overflow:auto}.circuit-course table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums;font-size:13px}',
'.circuit-course th,.circuit-course td{text-align:left;padding:8px;border-bottom:1px solid var(--line-soft);white-space:nowrap}',
'.circuit-course .circuit-course-formula{font-family:ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere;background:var(--field);padding:8px;border-radius:6px;margin:6px 0}',
'.circuit-course details summary{cursor:pointer;min-height:44px;padding:9px 0}.circuit-course a{color:var(--accent);overflow-wrap:anywhere}.circuit-course ul{padding-left:20px}',
'.circuit-course .circuit-course-time{margin:12px 0}.circuit-course input[type=range]{width:100%;min-height:30px;accent-color:var(--accent)}',
'.circuit-course .circuit-course-sample{font-variant-numeric:tabular-nums}',
'.circuit-course .circuit-course-display{border:1px solid var(--line);border-radius:8px;padding:0 10px}.circuit-course .circuit-course-display[open]{display:grid;gap:10px;padding-bottom:10px}.circuit-course .circuit-course-display>summary{padding:6px 0;min-height:36px}',
'@media(max-width:760px){.circuit-course{padding:10px}.circuit-course .circuit-course-layout{grid-template-columns:1fr}.circuit-course h2{font-size:21px}.circuit-course .circuit-course-tabs button{flex:1 1 150px}.circuit-course .circuit-course-graphs{grid-template-columns:1fr}}'
].join('\n');
function phasorGraphs(phasors) {
  return [...new Set(phasors.map(p => p.unit))].map(unit => {
    const list = phasors.filter(p => p.unit === unit), max = Math.max(...list.map(p => magnitude(p.z)), 1e-30);
    const cx = 210, cy = 175, radius = 130;
    const arrows = list.map((p, i) => {
      const x = cx + p.z.re / max * radius, y = cy - p.z.im / max * radius, angle = Math.atan2(y - cy, x - cx), len = magnitude(p.z) / max * radius;
      const head = len > 5 ? '<path d="M ' + (x - 9 * Math.cos(angle - .45)) + ' ' + (y - 9 * Math.sin(angle - .45)) + ' L ' + x + ' ' + y + ' L ' + (x - 9 * Math.cos(angle + .45)) + ' ' + (y - 9 * Math.sin(angle + .45)) + '" fill="none" style="stroke:' + colors[i % colors.length] + '" stroke-width="3"/>' : '';
      return '<line x1="' + cx + '" y1="' + cy + '" x2="' + x + '" y2="' + y + '" style="stroke:' + colors[i % colors.length] + '" stroke-width="3"/>' + head;
    }).join('');
    return '<section class="circuit-course-card"><h3>RMS 페이저 · ' + esc(unit) + '</h3><svg viewBox="0 0 420 350" role="img" aria-label="' + esc(unit) + ' 단위 RMS 페이저"><circle cx="210" cy="175" r="130" fill="none" style="stroke:var(--line)"/><path d="M45 175H390 M210 25V325" style="stroke:var(--zero)"/><text x="348" y="164" font-size="16">Re</text><text x="220" y="37" font-size="16">+j Im</text>' + arrows + '</svg><div class="circuit-course-legend">' + list.map((p, i) => '<span style="color:' + colors[i % colors.length] + '">' + esc(p.label) + ' = ' + esc(polarText(p.z)) + ' ' + esc(unit) + '</span>').join('') + '</div><p class="circuit-course-note">반시계방향 e^{jωt}. 단위마다 축척을 따로 씁니다.</p></section>';
  }).join('');
}
function waves(traces, f) {
  return [...new Set(traces.map(t => t.unit))].map(unit => {
    const list = traces.filter(t => t.unit === unit);
    const data = list.map(t => Array.from({ length: 361 }, (_, n) => t.sample ? t.sample(n * 2 / (360 * f)) : waveSample(t.phasor, f, n * 2 / (360 * f))));
    const max = Math.max(...data.flat().map(Math.abs)) || 1;
    const path = data.map((values, i) => '<path d="' + values.map((v, n) => (n ? 'L' : 'M') + (70 + n * 490 / 360).toFixed(2) + ' ' + (140 - v / max * 90).toFixed(2)).join(' ') + '" fill="none" style="stroke:' + colors[i % colors.length] + '" stroke-width="2.5"/>').join('');
    return '<section class="circuit-course-card"><h3>시간파형 · ' + esc(unit) + '</h3><svg viewBox="0 0 640 285" role="img" aria-label="' + esc(unit) + ' 단위 2주기 시간파형"><path d="M70 40V235 M70 140H570 M315 40V235 M560 40V235" style="stroke:var(--line)"/><text x="4" y="53" font-size="15">' + esc(fmt(max)) + '</text><text x="15" y="144" font-size="15">0</text><text x="4" y="231" font-size="15">' + esc(fmt(-max)) + '</text><text x="69" y="265" font-size="17">0</text><text x="295" y="265" font-size="17">T</text><text x="545" y="265" font-size="17">2T</text><text x="578" y="265" font-size="15">t</text>' + path + '</svg><div class="circuit-course-legend">' + list.map((t, i) => '<span style="color:' + colors[i % colors.length] + '">' + esc(t.label) + ' (' + esc(unit) + ')</span>').join('') + '</div><p class="circuit-course-note">T=' + esc(fmt(1000 / f)) + ' ms · 세로축은 실제 순간값. V, A, W 축을 각각 표시합니다.</p></section>';
  }).join('');
}
function triangle(p, title = '전력삼각형') {
  const m = Math.max(p.apparentVA, 1e-30), x = 230 + p.pWatts / m * 125, y = 170 - p.qVars / m * 125;
  return '<section class="circuit-course-card"><h3>' + esc(title) + '</h3><svg viewBox="0 0 460 340" role="img" aria-label="유효 무효 피상 전력 삼각형"><path d="M25 170H435 M230 25V312" style="stroke:var(--zero)"/><text x="395" y="193" font-size="16">P W</text><text x="242" y="32" font-size="16">+Q var</text><text x="242" y="322" font-size="16">−Q</text><path d="M230 170 L' + x + ' 170 L' + x + ' ' + y + ' Z" style="fill:color-mix(in srgb,var(--accent) 22%,transparent);stroke:var(--accent)" stroke-width="3"/><circle cx="' + x + '" cy="' + y + '" r="4" style="fill:var(--warning)"/></svg><p>P=' + esc(fmt(p.pWatts)) + ' W · Q=' + esc(fmt(p.qVars)) + ' var · |S|=' + esc(fmt(p.apparentVA)) + ' VA</p><p class="circuit-course-note">Q 방향이 부호입니다. 삼각형 길이는 화면에 맞게 축척됩니다.</p></section>';
}
function metrics(p) {
  const nature = { leading: '전류 진상 · Q<0', lagging: '전류 지상 · Q>0', unity: '동상 또는 반대상 · Q≈0', undefined: '전류/전압 0 · PF 미정' }[p.nature];
  return '<div class="circuit-course-metrics">' + [['P', p.pWatts, 'W'], ['Q', p.qVars, 'var'], ['|S|', p.apparentVA, 'VA'], ['PF = P/|S|', p.pf, '']].map(([k, v, u]) => '<div class="circuit-course-metric"><span>' + esc(k) + '</span><strong>' + esc(fmt(v)) + '</strong>' + esc(u) + '</div>').join('') + '</div><p>' + esc(nature) + ' · φ=∠V−∠I=' + esc(fmt(p.phaseDeg)) + '°</p>' + (p.flow === 'delivered' ? '<p class="circuit-course-warning">P<0: 수동부호 기준으로 이 포트가 유효전력을 전달합니다. 부하 역률 개선식은 P>0만 지원합니다.</p>' : '');
}
function table(headers, rows) {
  return '<div class="circuit-course-table-wrap"><table><thead><tr>' + headers.map(h => '<th scope="col">' + esc(h) + '</th>').join('') + '</tr></thead><tbody>' + rows.map(row => '<tr>' + row.map(c => '<td>' + esc(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';
}
function circuit(r) {
  if (r.connection) {
    if (r.connection === 'Y') return '<svg class="circuit-course-schematic" viewBox="0 0 520 230" role="img" aria-label="균형 Y 부하"><g style="stroke:var(--symbol)" fill="none" stroke-width="3"><path d="M80 45H180L260 115 M80 115H260 M80 185H180L260 115 M260 115H410"/></g><g font-size="19"><text x="35" y="50">a</text><text x="35" y="120">b</text><text x="35" y="190">c</text><text x="174" y="48">Z</text><text x="174" y="108">Z</text><text x="174" y="202">Z</text><text x="416" y="122">n</text><text x="300" y="192">V상 = V선 / √3</text></g></svg>';
    return '<svg class="circuit-course-schematic" viewBox="0 0 520 260" role="img" aria-label="균형 델타 부하"><path d="M130 45L380 45L255 220Z" fill="none" style="stroke:var(--symbol)" stroke-width="3"/><g font-size="19"><text x="102" y="37">a</text><text x="387" y="37">b</text><text x="253" y="247">c</text><text x="244" y="37">Zab → Iab</text><text x="330" y="140">Zbc</text><text x="108" y="142">Zca</text></g></svg>';
  }
  const parts = r.branches ?? [];
  const boxes = parts.map((b, i) => {
    const x = r.topology === 'series' ? 170 + i * 105 : 190, y = r.topology === 'series' ? 65 : 45 + i * 55;
    return '<path d="M' + (x - 25) + ' ' + y + 'H' + x + ' M' + (x + 65) + ' ' + y + 'H' + (x + 90) + '" style="stroke:var(--symbol)" stroke-width="3"/><rect x="' + x + '" y="' + (y - 17) + '" width="65" height="34" style="fill:var(--raised);stroke:var(--symbol)"/><text x="' + (x + 24) + '" y="' + (y + 6) + '" font-size="18">' + esc(b.kind) + '</text>';
  }).join('');
  return '<svg class="circuit-course-schematic" viewBox="0 0 550 250" role="img" aria-label="' + (r.topology === 'series' ? '직렬' : '병렬') + ' 이상 RLC 회로 개념도"><circle cx="72" cy="140" r="25" fill="none" style="stroke:var(--warning)" stroke-width="3"/><text x="56" y="147" font-size="23">~</text><text x="25" y="112" font-size="16">+ V</text><text x="25" y="193" font-size="16">−</text>' + (r.topology === 'series' ? '<path d="M72 115V65H145 M' + (170 + (parts.length - 1) * 105 + 90) + ' 65H510V215H72V165" style="stroke:var(--symbol)" stroke-width="3" fill="none"/><text x="110" y="42" font-size="17">I → + 단자로 입력</text>' : '<path d="M72 115V45H165V' + (45 + (parts.length - 1) * 55) + ' M280 45V215H72V165" style="stroke:var(--symbol)" stroke-width="3" fill="none"/><text x="319" y="96" font-size="18">분기 V 동일</text><text x="319" y="128" font-size="18">I = Σ I분기</text>') + boxes + '</svg>';
}
function worksheet(solution) {
  const asked = {current:'전원 복소전류',impedance:'등가 임피던스·어드미턴스',branch:'소자별 전압·전류',power:'유효·무효·피상전력',pf:'역률·위상차','line-current':'3상 선전류','phase-current':'부하 상전류','phase-voltage':'부하 상전압',capacitance:'각 보상 커패시터','source-current':'보상 전후 공급전류'}[solution.asked] ?? solution.asked;
  return '<section class="circuit-course-card circuit-course-worksheet" data-circuit-course-solution><h3>문제 풀이 · ' + esc(asked) + '</h3><p class="circuit-course-note">' + (solution.inputOrigin === 'fictional-check' ? '가상 검산문제입니다. 사용자가 업로드한 실제 문제는 아닙니다.' : solution.symbolic ? '선택한 기호 조건에 대한 문자식 답·유도입니다.' : '직접 입력한 수치 조건으로 계산한 풀이입니다.') + '</p>' +
    (solution.statement ? '<details open><summary>입력한 문제 메모 · 자동 해석 미지원</summary><p style="white-space:pre-wrap">' + esc(solution.statement) + '</p></details>' : '') +
    '<details open><summary>알려진 조건 · 단위 환산</summary><ul>' + solution.givens.map(v => '<li>' + esc(v) + '</li>').join('') + '</ul></details>' +
    '<h3>구한 답</h3><div class="circuit-course-metrics" data-circuit-course-answers>' + solution.answers.map(r => '<div class="circuit-course-metric"><span>' + esc(r.label) + '</span><strong>' + esc(r.text ?? fmt(r.value)) + '</strong>' + esc(r.unit) + (r.value === null ? '<p class="circuit-course-note">조건상 유한값 또는 위상을 정할 수 없습니다.</p>' : '') + '</div>').join('') + '</div>' +
    '<details open><summary>계산과정 · 식에 수치를 대입</summary><ol>' + solution.steps.map(s => '<li><strong>' + esc(s.label) + '</strong><div class="circuit-course-formula">' + esc(s.formula) + '</div><p>대입: ' + esc(s.substitution) + '</p><p>결과: ' + esc(s.result) + '</p></li>').join('') + '</ol></details><details><summary>풀이 가정 · 범위</summary><ul>' + solution.notes.map(s => '<li>' + esc(s) + '</li>').join('') + '</ul></details></section>';
}

export function problemSymbolHint(params,key) {
  if(params.solutionMode!=='numeric')return '';
  const renamed=(field,standard,format=value=>value)=>{const value=params[field];return typeof value==='string'&&value&&value!==standard?format(value):'';};
  if(key==='voltage')return renamed('symbolVoltage','V',v=>'|'+v+'|');
  if(key==='sourceAngle')return renamed('symbolVoltage','V',v=>'arg('+v+')');
  if(key==='frequencyHz')return renamed('symbolOmega','ω',v=>v+'=2πf');
  if(params.problemKind==='three'&&['r','x'].includes(key))return renamed('symbolZ','Z',v=>(key==='r'?'Re(':'Im(')+v+')');
  const fields={r:['symbolR','R'],l:['symbolL','L'],c:['symbolC','C'],pWatts:['symbolP','P'],qVars:['symbolQ','Q'],targetPF:['symbolPF','pf_t']};
  return fields[key]?renamed(...fields[key]):'';
}

export function problemSymbolMap(params) {
  const items=[];const add=(key,standard,meaning)=>{const value=params[key];if(typeof value==='string'&&value&&value!==standard)items.push(value+' ('+meaning+')');};
  add('symbolVoltage','V',params.problemKind==='three'?'주어진 '+(params.voltageKnown==='phase'?'상전압':'선간전압'):'주어진 전압; 도식 V');
  if(params.problemKind==='three')add('symbolZ','Z','각상 Z; 도식 Z 또는 Zab/Zbc/Zca');
  else if(params.problemKind==='single'){for(const kind of ['R','L','C'])if((params.elements||'').includes(kind))add('symbol'+kind,kind,kind);}
  else if(params.problemKind==='correction'){add('symbolP','P','P');add('symbolQ','Q','Q');add('symbolPF','pf_t','목표 PF');}
  add('symbolOmega','ω','각주파수; ω=2πf');return items;
}
const symbolMapNote=params=>{const items=problemSymbolMap(params);return items.length?'<p class="circuit-course-note" data-circuit-course-symbol-map style="overflow-wrap:anywhere">원기호 ↔ 도식·수치 풀이: '+items.map(esc).join(' · ')+'</p>':'';};

export function createCircuitCourseView(host) {
  host.classList.add('circuit-course');
  host.innerHTML = '<style>' + style + '</style><header><h2>교류 · 3상 회로 실험실</h2><p>균형 정현파 정상상태에서 페이저, 복소 임피던스, 무효전력과 역률을 직접 바꿔 보세요.</p></header><nav class="circuit-course-tabs" aria-label="AC 학습 실험">' + EXPERIMENTS.map(e => '<button type="button" data-circuit-course-experiment="' + esc(e.id) + '">' + esc(e.title) + '</button>').join('') + TOOL_TABS.map(t => '<button type="button" data-circuit-course-tool="' + esc(t.id) + '">' + esc(t.title) + '</button>').join('') + '</nav><div class="circuit-course-layout"><aside><section class="circuit-course-card"><h3 data-circuit-course-title></h3><p data-circuit-course-description></p><form class="circuit-course-form" data-circuit-course-form novalidate></form><div class="circuit-course-actions"><button type="button" data-circuit-course-apply class="circuit-course-apply">입력 적용 · 계산</button><button type="button" data-circuit-course-reset>이 실험 초기화</button></div><div class="circuit-course-actions" data-circuit-course-examples></div><p class="circuit-course-note">숫자를 바꾼 뒤 적용하세요. 잘못된 입력은 계산하지 않습니다.</p></section><section class="circuit-course-card" data-circuit-course-theory></section></aside><main><div class="circuit-course-status" role="status" aria-live="polite" data-circuit-course-status></div><div data-circuit-course-results></div></main></div>' + TOOL_TABS.map(t => '<section class="circuit-course-tool" data-circuit-course-tool-panel="' + esc(t.id) + '" hidden></section>').join('');
  let settingsOpen = false;
  const onToggle = event => { if (event.target.matches?.('[data-circuit-course-display-settings]')) settingsOpen = event.target.open; };
  host.addEventListener('toggle', onToggle, true);
  const q = name => host.querySelector('[data-circuit-course-' + name + ']');
  const mathCards = parent => {for(const box of parent.querySelectorAll('.circuit-course-formula')){const source=box.textContent;box.replaceChildren();appendCourseMath(box,source);}};
  function showSymbolicAnswers(data, solution) {
    const parent=q('answers');parent.replaceChildren();parent.classList.add('course-symbolic','circuit-course-primary-answers');
    const el=(tag,text,container=parent)=>{const n=host.ownerDocument.createElement(tag);n.textContent=text;container.append(n);return n;};
    el('h3',data?.title||'요청한 기호식 답');
    const givens=[solution.givens?.[0],solution.givens?.at(-1)].filter(Boolean);
    el('p',[...new Set(givens)].join(' · ')).className='circuit-course-note';
    if(data?.status!=='supported'){el('p',data?.reason||'이 조건의 문자식 답을 지원하지 않습니다.');return;}
    if(solution.canonical?.kind==='single' && solution.canonical.elements==='LC') {
      const text=solution.canonical.topology==='series'
        ? '적용 조건: 직렬 LC 공진에서 Z_eq=0이면, 0이 아닌 전압원에 대한 유한한 정현파 정상상태 전류해가 없습니다. 아래 일반식에 0으로 나누기를 대입하지 마세요.'
        : '공진 한계: 병렬 LC에서 Y_eq=0이면 전원전류는 0이고 역률은 미정입니다. 각 소자에는 전류가 흐를 수 있습니다.';
      const notice=el('p',text);notice.className='circuit-course-warning';notice.dataset.circuitCourseApplicability='';
    }
    for(const a of data.answers||[]){const box=el('div','');box.className='course-symbolic-answer';el('strong',a.quantity+(a.unit?' ['+a.unit+']':''),box);appendCourseMath(box,a.formula);if(a.direction)el('p',a.direction,box);}
    el('p','조건·법칙·유도와 지원 범위는 아래 풀이를 펼쳐 확인하세요.').className='circuit-course-note';
  }
  function showForm(experiment, params, drafts) {
    q('title').textContent = experiment.title; q('description').textContent = experiment.description;
    q('apply').textContent = experiment.id === 'problem' ? '문제 풀기 · 답과 과정 보기' : params.presentation === 'symbolic' ? '문자식 답·유도 보기' : '입력 적용 · 계산';
    host.querySelectorAll('[data-circuit-course-experiment]').forEach(b => b.setAttribute('aria-current', String(b.dataset.circuitCourseExperiment === experiment.id)));
    const fieldHtml = p => {
      const hidden = p.showIf && !p.showIf(params), value = drafts[p.key];
      const hint=experiment.id==='problem'?problemSymbolHint(params,p.key):'';
      const label = p.label + (p.unit ? ' (' + p.unit + ')' : '') + (hint?' · '+hint:'');
      return '<label' + (hidden ? ' hidden' : '') + '>' + esc(label) + (p.text && p.singleLine ? '<input type="text" maxlength="' + p.maxLength + '" data-circuit-course-key="' + esc(p.key) + '" value="' + esc(value) + '"><span class="circuit-course-note">단일 기호 이름 · 예: R1, V_s, ω</span>' : p.text ? '<textarea maxlength="' + p.maxLength + '" data-circuit-course-key="' + esc(p.key) + '" placeholder="문제의 글을 적어도 수치 조건은 아래에 직접 입력해야 합니다.">' + esc(value) + '</textarea>' : p.choices
        ? '<select data-circuit-course-key="' + esc(p.key) + '">' + p.choices.map(([k, text]) => '<option value="' + esc(k) + '"' + (value === k ? ' selected' : '') + '>' + esc(text) + '</option>').join('') + '</select>'
        : '<input type="text" inputmode="decimal" autocomplete="off" data-circuit-course-key="' + esc(p.key) + '" value="' + esc(value) + '" aria-label="' + esc(label) + '" placeholder="' + (p.quantity ? '예: 숫자 또는 숫자+단위' : '') + '"><span class="circuit-course-note">' + (p.quantity ? '단위 생략: ' + esc(p.unit.replace('uF','µF').replace('ohm','Ω')) + ' · ' : '') + esc(fmt(p.min / p.displayScale)) + ' ~ ' + esc(fmt(p.max / p.displayScale)) + '</span>') + '</label>';
    };
    // Input basis, complex notation and symbol names are display settings: folded away except in the free problem lesson, where they are the input.
    const isDisplay = p => experiment.id !== 'problem' && (p.key === 'basis' || p.key === 'coordinate' || p.key.startsWith('symbol'));
    const primary = experiment.parameters.filter(p => !isDisplay(p)), display = experiment.parameters.filter(isDisplay);
    const anyShown = display.some(p => !(p.showIf && !p.showIf(params)));
    q('form').innerHTML = primary.map(fieldHtml).join('') + (anyShown ? '<details class="circuit-course-display" data-circuit-course-display-settings' + (settingsOpen ? ' open' : '') + '><summary>표시 설정 · 입력 기준 · 기호 이름</summary>' + display.map(fieldHtml).join('') + '</details>' : display.map(fieldHtml).join(''));
    q('examples').innerHTML = experiment.examples.map((e, i) => '<button type="button" data-circuit-course-example="' + i + '">' + esc(e.label) + '</button>').join('');
    q('theory').innerHTML = '<h3>공식 · 읽는 기준</h3>' + experiment.formulas.map(f => '<div class="circuit-course-formula">' + esc(f) + '</div>').join('') + '<details open><summary>가정 · 지원 범위</summary><ul>' + experiment.assumptions.map(a => '<li>' + esc(a) + '</li>').join('') + '</ul></details><details><summary>공개 교재 출처</summary><p class="circuit-course-note">MIT 교재 일부는 peak를 사용해 ½가 나타납니다. 이 실험은 RMS로 환산한 식을 씁니다. 보상식은 S와 커패시터 Y=jωC에서 유도했습니다.</p>' + REFERENCES.map(r => '<p><a href="' + esc(r.url) + '" target="_blank" rel="noopener noreferrer">' + esc(r.title) + '</a></p>').join('') + '</details>';
    mathCards(q('theory'));
  }
  // A tool replaces the experiment form/results while it is open; showTool(null) brings the experiment back.
  function showTool(toolId) {
    host.querySelector('.circuit-course-layout').hidden = Boolean(toolId);
    host.querySelectorAll('[data-circuit-course-tool-panel]').forEach(p => { p.hidden = p.dataset.circuitCourseToolPanel !== toolId; });
    host.querySelectorAll('[data-circuit-course-tool]').forEach(b => b.setAttribute('aria-current', String(b.dataset.circuitCourseTool === toolId)));
    if (toolId) host.querySelectorAll('[data-circuit-course-experiment]').forEach(b => b.setAttribute('aria-current', 'false'));
  }
  function toolPanel(toolId) { return host.querySelector('[data-circuit-course-tool-panel="' + toolId + '"]'); }
  function status(message, kind = 'valid') { q('status').textContent = message; q('status').dataset.kind = kind; }
  function dirty() { status('미적용 입력이 있습니다. 입력 적용을 누르면 새 결과를 계산합니다.', 'draft'); q('results').hidden = true; }
  function projection(result, fraction = 0) {
    const root = q('projection'); if (!root || !result.traces?.length) return;
    const t = fraction / result.frequencyHz;
    root.textContent = 't/T=' + fmt(fraction) + ' · t=' + fmt(t * 1000) + ' ms · ' + result.traces.map(trace => trace.label + '=' + fmt(trace.sample ? trace.sample(t) : waveSample(trace.phasor, result.frequencyHz, t)) + ' ' + trace.unit).join(' · ');
  }
  function showResult(result, id, params = {}) {
    const symbolMap=id==='problem'?symbolMapNote(params):'';
    q('results').hidden = false;
    if (result.status !== 'valid') { status(result.reason ?? '계산할 수 없습니다.', 'error'); q('results').innerHTML = '<p>현재 입력의 유효한 해석값이 없습니다. 입력과 가정을 확인하세요.</p>'; return; }
    status((result.symbolic ? '적용한 기호 조건의 문자식 풀이입니다.' : '적용한 입력의 계산 결과입니다.') + (result.reason ? ' ' + result.reason : ''));
    host.dataset.circuitCoursePresentation=result.symbolic?'symbolic':'numeric';
    if(result.symbolic){
      const solution=result.solution;
      const schema=solution.canonical?.kind==='single'?circuit({topology:solution.canonical.topology,branches:solution.components}):solution.canonical?.kind==='three'?circuit({connection:solution.canonical.connection}):'';
      q('results').innerHTML='<section class="circuit-course-card" data-circuit-course-solution><div data-circuit-course-answers></div><details data-circuit-course-derivation><summary>문자 조건 · 법칙 · 유도 펼치기</summary><div data-circuit-course-derivation-body></div></details></section>'+(schema?'<section class="circuit-course-card"><h3>선택한 회로의 연결 관계</h3>'+symbolMap+schema+'</section>':'')+'<section class="circuit-course-card"><h3>시현에 사용할 문자식</h3><p class="circuit-course-formula">'+esc(solution.waveform??'전력·전류는 위 문자식을 사용합니다.')+'</p><p>숫자 시현을 선택하면 실제 페이저·파형·전력도표가 표시됩니다.</p></section>';
      showSymbolicAnswers(result.symbolicData,solution);
      if(id==='problem'){const button=host.ownerDocument.createElement('button');button.type='button';button.dataset.circuitCourseMode='numeric';button.textContent='같은 조건에 숫자 넣기';q('answers').append(button);}
      renderSymbolic(q('derivation-body'),{...result.symbolicData,answers:[]},{copyData:{...result.symbolicData,conditions:[...(solution.statement?['문제 메모 (자동 해석하지 않음): '+solution.statement]:[]),...result.symbolicData.conditions]}});
      if(solution.statement){const memo=host.ownerDocument.createElement('p');memo.className='circuit-course-note';memo.textContent='문제 메모 (자동 해석 미지원): '+solution.statement;q('solution').prepend(memo);}
      mathCards(q('results'));
      return;
    }
    id = result.displayKind ?? id;
    let html = (result.solution ? (params.solutionMode==='numeric'?'<div class="circuit-course-actions"><button type="button" data-circuit-course-mode="symbolic">문자식 답으로 돌아가기</button></div>':'')+symbolMap+worksheet(result.solution) : '') + '<section class="circuit-course-card">';
    if (result.frequencyHz) html += '<p>f=' + esc(fmt(result.frequencyHz)) + ' Hz · ω=' + esc(fmt(2 * Math.PI * result.frequencyHz)) + ' rad/s</p>';
    if (result.polar) html += '<h3>동일한 RMS 페이저</h3><p>V=' + esc(zText(result.V)) + ' V RMS</p><p>V=' + esc(polarText(result.V)) + ' V RMS · peak=' + esc(fmt(Math.SQRT2 * magnitude(result.V))) + ' V</p>';
    if (result.power) html += metrics(result.power);
    if (id === 'impedance') {
      html += '<p>Z=' + esc(zText(result.Z)) + ' Ω · Y=' + esc(zText(result.Y)) + ' S</p>' + symbolMap + circuit(result);
      html += table(['소자', 'Z (Ω)', '분기 V (V RMS)', '분기 I (A RMS)', 'P (W)', 'Q (var)'], result.branches.map(b => [b.kind, zText(b.Z), polarText(b.V), polarText(b.I), fmt(b.power.pWatts), fmt(b.power.qVars)]));
    }
    if (id === 'three-phase') {
      html += symbolMap + circuit(result) + '<p>|V상|=' + esc(fmt(result.loadVoltageRms)) + ' V RMS · |I상|=' + esc(fmt(result.loadCurrentRms)) + ' A RMS · |I선|=' + esc(fmt(result.lineCurrentRms)) + ' A RMS</p>';
      html += table(['상/분기', 'V상 (V RMS)', 'I상 (A RMS)', '선 전류 (A RMS)'], result.loadVoltages.map((v, i) => [result.connection === 'Y' ? ['an', 'bn', 'cn'][i] : ['ab', 'bc', 'ca'][i], polarText(v), polarText(result.loadCurrents[i]), ['Ia', 'Ib', 'Ic'][i] + '=' + polarText(result.lineCurrents[i])]));
      html += '<p class="circuit-course-note">Δ Iab: a→b, Ibc: b→c, Ica: c→a. Ia=Iab−Ica. 같은 Z를 Y→Δ로 바꾸면 부하 전압과 총 전력이 달라집니다.</p>';
    }
    if (id === 'correction') {
      html += '<p>권장 C_each=' + esc(result.recommendedCapacitanceF === null ? '커패시터로 목표 불가' : fmt(result.recommendedCapacitanceF * 1e6) + ' µF') + '</p><p>적용 C_each=' + esc(fmt(result.selectedCapacitanceF * 1e6)) + ' µF · 각 C 단자=' + esc(fmt(result.capacitorVoltageRms)) + ' V RMS · ' + (result.phases === 3 ? esc(result.connection === 'Y' ? 'Y · C 3개' : 'Δ · C 3개') : '단상 · C 1개') + '</p>';
      html += table(['구분', 'P (W)', 'Q (var)', '|S| (VA)', 'PF', '|I공급| (A RMS)'], [['보상 전', fmt(result.pWatts), fmt(result.qVars), fmt(result.before.apparentVA), fmt(result.before.pf), fmt(result.sourceCurrentBeforeRms)], ['보상 후', fmt(result.pWatts), fmt(result.qAfterVars), fmt(result.after.apparentVA), fmt(result.after.pf), fmt(result.sourceCurrentAfterRms)]]);
      html += '<p>Qcap=' + esc(fmt(result.qCapacitorVars)) + ' var · Q목표=' + esc(fmt(result.desiredQ)) + ' var</p>' + result.warnings.map(w => '<p class="circuit-course-warning">' + esc(w) + '</p>').join('');
      html += '<p class="circuit-course-note">커패시터는 부하 양 단자(단상), a-n/b-n/c-n(Y), a-b/b-c/c-a(Δ)에 병렬 연결합니다. 부하 P는 그대로입니다.</p>';
    }
    html += '</section><div class="circuit-course-linked-results"><div class="circuit-course-graphs">' + phasorGraphs(result.phasors ?? []) + (result.power ? triangle(result.power, id === 'correction' ? '보상 후 전력삼각형' : '전력삼각형') : '') + (id === 'correction' ? triangle(result.before, '보상 전 전력삼각형') : '') + waves(result.traces ?? [], result.frequencyHz) + '</div>' + (result.symbolicData?.status==='supported'?'<section class="circuit-course-card" data-circuit-course-symbolic-companion></section>':'') + '</div>';
    if (result.traces?.length) html += '<section class="circuit-course-card circuit-course-time"><label>한 주기의 관측 위치 t/T<input type="range" min="0" max="1" step="0.005" value="0" data-circuit-course-time></label><p class="circuit-course-sample" data-circuit-course-projection></p></section>';
    if (result.checks?.length) html += '<section class="circuit-course-card"><h3>독립 시간영역 확인</h3>' + table(['검사', '표본 계산', '페이저 기대값', '절대 허용오차', '결과'], result.checks.map(c => [c.label, fmt(c.actual) + ' ' + c.unit, fmt(c.expected) + ' ' + c.unit, fmt(c.tolerance), c.pass ? 'PASS' : 'FAIL'])) + '<p class="circuit-course-note">정수 한 주기의 균등 표본으로 계산합니다. 이 확인은 선택된 이상 모델의 일치 검사입니다.</p></section>';
    q('results').innerHTML = html;mathCards(q('results'));if(result.symbolicData?.status==='supported')renderSymbolic(q('symbolic-companion'),result.symbolicData); projection(result);
  }
  return { showForm, showResult, showTool, toolPanel, status, dirty, projection, revealInput(key) { const input=host.querySelector('[data-circuit-course-key="'+key+'"]');const folded=input?.closest?.('[data-circuit-course-display-settings]');if(folded){folded.open=true;settingsOpen=true;}input?.scrollIntoView?.({block:'center'});input?.focus?.({preventScroll:true}); }, revealAnswer() { q('answers')?.scrollIntoView?.({block:'start'}); }, clear() { host.removeEventListener('toggle', onToggle, true);host.replaceChildren(); host.classList.remove('circuit-course'); } };
}
