// Ch.14 live tools: transfer function · Bode plot (14) and series/parallel resonance (15). Pure, no DOM (the figure is an SVG string).
import { parseTransfer, analyzeTransfer, standardFormText, polyText, rootText, zetaClass, peakOf } from './circuit-course-transfer.js';
import { resonance, capacitorForResonance, designFromBand } from './circuit-course-resonance.js';
import { logGrid } from './circuit-course-freq-plot.js';
import { fmt, short, siUnit } from './circuit-course-format.js';
import { num, amp, choice, textField, metric } from './circuit-course-tool-common.js';

const LOG_SLIDER = (min, max) => ({ min, max, step: 0.005, log: true });
// A base-unit value (Ω, H, F, Hz, rad/s) typed with an optional SI prefix and moved on a log slider.
const siNum = (key, label, unit, initial, min, max, extra = {}) => num(key, label, unit, initial, min, max, { si: true, slider: LOG_SLIDER(min, max), ...extra });
const dB = x => 20 * Math.log10(x);
const signed = (n, unit) => (n > 0 ? '+' : n < 0 ? '−' : '') + short(Math.abs(n)) + unit;

// ---------------------------------------------------------------------------------------------------------------------------------
// 14 · Transfer function and Bode plot
function bodeRange(expression) {
  try { return analyzeTransfer(parseTransfer(expression)).range; } catch { return [1e-2, 1e6]; }
}
function termRow(t) {
  const n = t.mult, zero = t.side > 0, sign = zero ? '+' : '−', word = zero ? '영점' : '극점';
  if (t.kind === 'single') {
    const dir = (zero ? 1 : -1) * (t.lhp ? 1 : -1);
    return ['단일 ' + word + (n > 1 ? ' ×' + n : '') + (t.lhp ? '' : ' (오른쪽 반평면)'), short(t.corner), sign + 20 * n + ' dB/dec (ω>' + short(t.corner) + ')',
      (dir > 0 ? '+' : '−') + 45 * n + '°/dec (' + short(t.corner / 10) + '~' + short(t.corner * 10) + ') → ' + (dir > 0 ? '+' : '−') + 90 * n + '°'];
  }
  const dir = (zero ? 1 : -1) * (t.zeta >= 0 ? 1 : -1);
  return ['이차 ' + word + (n > 1 ? ' ×' + n : '') + ' · ζ=' + short(t.zeta) + ' ' + zetaClass(t.zeta), short(t.corner), sign + 40 * n + ' dB/dec (ω>' + short(t.corner) + ')',
    (dir > 0 ? '+' : '−') + 90 * n + '°/dec (' + short(t.corner / 10) + '~' + short(t.corner * 10) + ') → ' + (dir > 0 ? '+' : '−') + 180 * n + '°'];
}

export const BODE_TOOL = {
  id: 'bode', title: '14 · 전달함수 · 보드선도', tab: 'Ch.14',
  lead: 'H(s)를 s 또는 jω로 쓰면 표준형, 영점·극점, 항별 직선 근사(표 14.3)와 정확 곡선이 바로 나옵니다. 곱셈 기호는 생략해도 되고(생략한 곱은 / 보다 먼저 묶여 200s/(s+2)(s+10)은 분모 전체), ^는 정수 지수입니다. 아래 ω 커서를 끌어 한 점의 값을 읽으세요.',
  fields: [
    textField('expression', '전달함수 H(s)', '200s/((s+2)(s+10))'),
    siNum('cursor', 'ω 커서', 'rad/s', 2, 1e-9, 1e12, { slider: v => { const [lo, hi] = bodeRange(v.expression); return LOG_SLIDER(lo, hi); } }),
    choice('lines', '직선 근사', 'sum', [['sum', '합만'], ['terms', '항별 직선도']], { segment: true })
  ],
  presets: [
    { label: '예제 14.3 200jω/((jω+2)(jω+10))', values: { expression: '200jω/((jω+2)(jω+10))', cursor: 2 },
      expect: [{ key: 'K', label: '표준형 상수 K (200이 아님)', value: 10 }, { key: 'KdB', label: '20log|K|', value: 20, unit: 'dB' },
        { get: r => r.sys.approxDb(0.1), label: '직선 근사 ω=0.1', value: 0, unit: 'dB', abs: 1e-9 }, { get: r => r.sys.approxDb(5), label: '직선 근사 평탄부 ω=2~10', value: 26.02, unit: 'dB' },
        { get: r => r.sys.approxDb(200), label: '직선 근사 ω=200', value: 0, unit: 'dB', abs: 1e-9 },
        { get: r => r.sys.magDb(2), label: '정확 |H(j2)|', value: 22.84, unit: 'dB' }, { get: r => r.sys.phaseDeg(2), label: '정확 ∠H(j2)', value: 33.69, unit: '°' },
        { get: r => r.sys.phaseDeg(10), label: '정확 ∠H(j10)', value: -33.69, unit: '°' }, { get: r => r.sys.phaseDeg(Math.sqrt(20)), label: '∠H(j√20)', value: 0, unit: '°', abs: 1e-9 }] },
    { label: '예제 14.2 s(s+2)/(s²+2s+1)', values: { expression: 's(s+2)/(s^2+2s+1)', cursor: 1 },
      expect: [{ key: 'K', label: '표준형 상수 K', value: 2 }, { key: 'zeroCount', label: '영점 개수 (0, −2)', value: 2 }, { key: 'poleMult', label: '극점 −1의 중복도', value: 2 },
        { get: r => r.sys.magDb(100), label: '|H(j100)| (→ 1)', value: 0, unit: 'dB', abs: 0.01 }] },
    { label: '예제 14.6 (역문제) 100jω/((1+jω)(1+jω/5)(1+jω/20))', values: { expression: '100jω/((1+jω)(1+jω/5)(1+jω/20))', cursor: 1 },
      expect: [{ get: r => r.sys.approxDb(1), label: '직선 근사 ω=1~5', value: 40, unit: 'dB' }, { get: r => r.sys.approxDb(20), label: '직선 근사 ω=20', value: 27.96, unit: 'dB' },
        { get: r => r.sys.approxDb(100), label: '직선 근사 ω=100', value: 0, unit: 'dB', abs: 1e-9 },
        { get: r => r.sys.magDb(1), label: '정확 |H(j1)|', value: 36.81, unit: 'dB' }, { get: r => r.sys.magDb(100), label: '정확 |H(j100)|', value: -0.18, unit: 'dB', abs: 0.005 }] },
    { label: 'RC 저역 1/(1+s/1000) (예제 14.1 회로, 1 kΩ·1 µF)', values: { expression: '1/(1+s/1000)', cursor: 1000 },
      expect: [{ get: r => r.sys.magDb(1000), label: '|H| at ωc', value: -3.0103, unit: 'dB' }, { get: r => r.sys.phaseDeg(1000), label: '∠H at ωc', value: -45, unit: '°' },
        { get: r => r.sys.magDb(1000) - r.sys.approxDb(1000), label: '정확 − 직선 (절점)', value: -3.0103, unit: 'dB' }, { key: 'slopeHigh', label: '고주파 기울기', value: -20, unit: 'dB/dec' }] },
    { label: '이차 극점 ζ=0.05: 1/(s²+0.1s+1)', values: { expression: '1/(s^2+0.1s+1)', cursor: 1 },
      expect: [{ key: 'peakDb', label: '정확 곡선 최댓값', value: 20.01, unit: 'dB', abs: 0.01 }, { key: 'peakW', label: '최댓값 위치 ω', value: 0.9975, unit: 'rad/s' },
        { get: r => r.sys.approxDb(1), label: '직선 근사 ω=ωn', value: 0, unit: 'dB', abs: 1e-9 }, { get: r => r.sys.terms[0].zeta, label: 'ζ', value: 0.05 }] },
    { label: '직렬 RLC 출력 R (100 Ω · 10 mH · 2.533 µF)', values: { expression: '2.533e-4s/(2.533e-8s^2+2.533e-4s+1)', cursor: 6283 },
      expect: [{ get: r => r.sys.terms.find(t => t.kind === 'quad').corner, label: 'ωn = 1/√(LC)', value: 6283, unit: 'rad/s' },
        { get: r => r.sys.magDb(1 / Math.sqrt(2.533e-8)), label: '정확 |H(jωn)|', value: 0, unit: 'dB', abs: 0.005 },
        { get: r => r.sys.approxDb(1 / Math.sqrt(2.533e-8)), label: '직선 근사 봉우리 ω=ωn', value: 4.04, unit: 'dB', abs: 0.005 }] }
  ],
  evaluate(v) {
    const h = parseTransfer(v.expression), a = analyzeTransfer(h), [lo, hi] = a.range;
    const grid = [...new Set([...logGrid(lo, hi, 80), ...a.corners.flatMap(c => [c / 10, c, c * 10]).filter(w => w >= lo && w <= hi)])].sort((x, y) => x - y);
    const w = v.cursor, m = a.at(w), magnitude = Math.hypot(m.re, m.im), exact = dB(magnitude), approx = a.approxDb(w), phase = a.phaseDeg(w), approxPhase = a.approxPhase(w);
    // A pole pair on the jω axis (ζ = 0) has no finite peak: the reading says so instead of a huge or undefined number.
    const axisPole = a.poles.find(p => p.root.re === 0 && p.root.im > 0), peak = axisPole ? { w: axisPole.root.im, mag: Infinity } : peakOf(a, lo, hi), slopeHigh = 20 * (h.num.length - h.den.length);
    const termSeries = v.lines === 'terms' ? a.terms.filter(t => t.kind !== 'origin').map(t => {
      const single = analyzeTransfer({ num: t.side > 0 ? factorPoly(t) : [1], den: t.side > 0 ? [1] : factorPoly(t) });
      return { style: 'term', points: grid.map(x => [x, single.approxDb(x)]) };
    }) : [];
    const kOnly = Math.abs(a.K) !== 1 || a.origin ? [{ style: 'term', points: grid.map(x => [x, dB(Math.abs(a.K)) + 20 * a.origin * Math.log10(x)]) }] : [];
    const zeroCount = a.zeros.reduce((n, z) => n + z.mult, 0), firstPole = a.poles.find(p => Math.abs(p.root.re + 1) < 1e-9 && p.root.im === 0);
    const values = { K: a.K, KdB: dB(Math.abs(a.K)), origin: a.origin, exactDb: exact, phase, approxDb: approx, approxPhase, diffDb: exact - approx, peakDb: dB(peak.mag), peakW: peak.w, slopeHigh, zeroCount,
      poleCount: a.poles.reduce((n, p) => n + p.mult, 0), poleMult: firstPole?.mult ?? 0 };
    const rootRows = [...a.zeros.map(z => ['영점', 's = ' + rootText(z.root), String(z.mult)]), ...a.poles.map(p => ['극점', 's = ' + rootText(p.root), String(p.mult)])];
    const termRows = [['상수 K = ' + short(a.K), '—', '0 (높이 ' + signed(dB(Math.abs(a.K)), ' dB') + ')', a.K < 0 ? '180° (K<0)' : '0°']];
    if (a.origin) {
      termRows.push(['원점 ' + (a.origin > 0 ? '영점' : '극점') + ' (jω)' + (Math.abs(a.origin) > 1 ? '^' + Math.abs(a.origin) : ''), 'ω=1에서 0 dB', signed(20 * a.origin, ' dB/dec') + ' (전 구간)',
        signed(90 * a.origin, '°') + ' (전 구간)']);
    }
    termRows.push(...a.terms.filter(t => t.kind !== 'origin').map(termRow));
    const notes = ['상수 K는 모든 인수를 (1 + jω/p) 꼴로 바꾼 뒤의 값입니다. 예: 200jω/((jω+2)(jω+10)) → 200/(2·10) = 10 (20 dB).',
      '단일 영점의 위상은 ω/10~10ω 구간에서 +45N°/dec로 올라 +90N°에서 끝납니다. 극점은 부호만 반대입니다.',
      '직선 근사와 정확 곡선의 차이: 단일 절점에서 ∓3.01 dB, 이차 항은 ζ가 작을수록 ωn 근처의 봉우리(극점) 또는 골(영점)이 커집니다.'];
    if (a.K < 0) notes.push('K<0이면 위상에 180°를 더합니다(−180°로 보아도 같은 각입니다).');
    if (a.cancelled.length) notes.push('분자·분모에 같은 근이 있어 약분했습니다: s = ' + a.cancelled.map(c => rootText(c.root)).join(', ') + '.');
    if (slopeHigh > 0) notes.push('분자 차수가 분모보다 높아 고주파에서 |H|가 계속 커집니다(실제 회로라면 확인하세요).');
    return { status: 'valid', values, sys: a,
      read: standardFormText(a) + ' · K = ' + short(a.K) + ' (' + signed(dB(Math.abs(a.K)), ' dB') + ')' + (a.origin ? ' · 원점 ' + (a.origin > 0 ? '영점' : '극점') + ' ' + Math.abs(a.origin) + '개' : ''),
      freqPlots: [{ title: '보드선도 · 실선 정확, 점선 직선 근사', range: [lo, hi], legend: '굵은 실선 = 정확 |H|·∠H, 긴 점선 = 직선 근사 합' + (termSeries.length ? ', 짧은 점선 = 항별 직선과 K·(jω)^N' : '') + ', 초록 점선 = 절점 ω, 세로 실선 = 커서.',
        panels: [{ label: '|H| (dB)', floor: 160, cursor: w, marks: a.corners.map(c => ({ w: c, label: short(c) })),
          series: [...(termSeries.length ? [...kOnly, ...termSeries] : []), { style: 'approx', points: grid.map(x => [x, a.approxDb(x)]) }, { style: 'exact', points: grid.map(x => [x, a.magDb(x)]), cursorValue: exact }] },
        { label: '∠H (°)', phase: true, cursor: w, marks: a.corners.map(c => ({ w: c })),
          series: [{ style: 'approx', points: grid.map(x => [x, a.approxPhase(x)]) }, { style: 'exact', points: grid.map(x => [x, a.phaseDeg(x)]), cursorValue: phase }] }] }],
      metrics: [metric('ω 커서', fmt(w), 'rad/s'), metric('정확 |H(jω)|', Number.isFinite(magnitude) ? short(magnitude) + ' = ' + short(exact) : '∞', Number.isFinite(magnitude) ? 'dB' : ''), metric('정확 ∠H(jω)', short(phase), '°'), metric('직선 근사', short(approx), 'dB'),
        metric('근사 위상', short(approxPhase), '°'), metric('정확 − 근사', signed(exact - approx, ''), 'dB'), metric('|H| 최댓값 (그림 범위)', (axisPole ? '∞ (ζ=0 극점)' : short(dB(peak.mag)) + ' dB') + ' @ ω=' + short(peak.w)), metric('고주파 기울기', signed(slopeHigh, ''), 'dB/dec')],
      tables: [{ title: '항 분해 (표 14.3 형식)', headers: ['항', '꺾임 ω (rad/s)', '크기 직선', '위상 직선'], rows: termRows },
        { title: '영점 · 극점 (s 평면)', headers: ['종류', '위치', '중복도'], rows: rootRows.length ? rootRows : [['—', '영점·극점 없음 (상수)', '—']] },
        { title: '다항식 꼴', headers: ['', 'H(s)'], rows: [['분자 N(s)', polyText(h.num)], ['분모 D(s)', polyText(h.den)]] }],
      notes };
  }
};
// The polynomial of one standard-form factor: (1 − s/r)^m or (1 + 2ζ s/ωn + s²/ωn²)^m.
function factorPoly(t) {
  const one = t.kind === 'single' ? [1, -1 / t.root.re] : [1, 2 * t.zeta / t.corner, 1 / (t.corner * t.corner)];
  let p = [1];
  for (let i = 0; i < t.mult; i++) { const next = new Array(p.length + one.length - 1).fill(0); p.forEach((x, a) => one.forEach((y, b) => { next[a + b] += x * y; })); p = next; }
  return p;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// 15 · Series / parallel resonance
const isSeries = v => v.circuit !== 'parallel';
function resonanceInputs(v) {
  if (v.solve === 'f0') return { R: v.R, L: v.L, C: capacitorForResonance(v.f0, v.L) };
  if (v.solve === 'band') return { R: v.R, ...designFromBand(v.circuit, v.w0, v.B, v.R) };
  return { R: v.R, L: v.L, C: v.C };
}
export const RESONANCE_TOOL = {
  id: 'resonance', title: '15 · 직렬 · 병렬 공진', tab: 'Ch.14',
  lead: 'R·L·C를 바꾸면 ω0, 반전력 주파수 ω1·ω2, 대역폭 B, 선택도 Q와 공진 곡선이 바로 바뀝니다. 직렬은 전압원과 전류 |I|, 병렬은 전류원과 전압 |V|입니다. 값은 0.4u, 10m, 2k처럼 SI 접두어로 써도 됩니다.',
  fields: [
    choice('circuit', '연결', 'series', [['series', '직렬 RLC'], ['parallel', '병렬 RLC']], { segment: true }),
    choice('solve', '풀이 종류', 'rlc', [['rlc', 'R·L·C → 공진값'], ['f0', 'f0·L·R → C'], ['band', 'ω0·B·R → L·C']]),
    amp('source', v => (isSeries(v) ? '전원 전압 Vm' : '전원 전류 Im'), v => (isSeries(v) ? 'V' : 'A'), 10, 1e-12, 1e9, { name: '전원 크기' }),
    siNum('R', '저항 R', 'Ω', 2, 1e-6, 1e9),
    siNum('L', '인덕턴스 L', 'H', 1e-3, 1e-12, 1e6, { showIf: v => v.solve !== 'band' }),
    siNum('C', '커패시턴스 C', 'F', 0.4e-6, 1e-15, 1e3, { showIf: v => v.solve === 'rlc' }),
    siNum('f0', '목표 공진 주파수 f0', 'Hz', 15e3, 1e-6, 1e12, { showIf: v => v.solve === 'f0' }),
    siNum('w0', '목표 ω0', 'rad/s', 40, 1e-6, 1e13, { showIf: v => v.solve === 'band' }),
    siNum('B', '목표 대역폭 B', 'rad/s', 5, 1e-9, 1e13, { showIf: v => v.solve === 'band' }),
    num('ratio', 'ω 커서 (ω/ω0)', '', 1, 1e-3, 1e3, { slider: LOG_SLIDER(0.5, 2) })
  ],
  presets: [
    { label: '예제 14.7 직렬 20 V(peak) · 2 Ω · 1 mH · 0.4 µF', basis: 'peak', values: { circuit: 'series', solve: 'rlc', source: 20, R: 2, L: 1e-3, C: 0.4e-6, ratio: 1 },
      expect: [{ key: 'w0', label: 'ω0', value: 50000, unit: 'rad/s' }, { key: 'w1', label: 'ω1', value: 49010, unit: 'rad/s' }, { key: 'w2', label: 'ω2', value: 51010, unit: 'rad/s' },
        { key: 'B', label: 'B = R/L', value: 2000, unit: 'rad/s' }, { key: 'Q', label: 'Q', value: 25 }, { key: 'peak', label: '|I(ω0)|', value: 10, unit: 'A' }, { key: 'halfResponse', label: '|I(ω1)|', value: 7.071, unit: 'A' },
        { key: 'storeL', label: '|VL(ω0)| = Q·Vm', value: 500, unit: 'V' }] },
    { label: '과제 14.30 f0=15 kHz · L=10 mH · R=20 Ω · 120 V(rms) → C', basis: 'rms', values: { circuit: 'series', solve: 'f0', source: 120, R: 20, L: 10e-3, f0: 15e3, ratio: 1 },
      expect: [{ key: 'C', label: 'C = 1/(ω0²L)', value: 11.26e-9, unit: 'F' }, { key: 'peak', label: '공진 전류 (rms)', value: 6, unit: 'A' }, { key: 'Q', label: 'Q = ω0L/R', value: 47.12 },
        { key: 'B', label: 'B = R/L', value: 2000, unit: 'rad/s' }] },
    { label: '과제 14.77 기준 회로 ω0=40 · B=5 · R=10 Ω → L·C', basis: 'rms', values: { circuit: 'series', solve: 'band', source: 1, R: 10, w0: 40, B: 5, ratio: 1 },
      expect: [{ key: 'L', label: 'L = R/B', value: 2, unit: 'H' }, { key: 'C', label: 'C = 1/(ω0²L)', value: 312.5e-6, unit: 'F' }, { key: 'Q', label: 'Q', value: 8 },
        { key: 'w1', label: 'ω1', value: 37.58, unit: 'rad/s' }, { key: 'w2', label: 'ω2', value: 42.58, unit: 'rad/s' }] },
    { label: '표 14.4 병렬 · 10 mA(peak) · 1.25 kΩ · 1 mH · 0.4 µF (Q=25)', basis: 'peak', values: { circuit: 'parallel', solve: 'rlc', source: 0.01, R: 1250, L: 1e-3, C: 0.4e-6, ratio: 1 },
      expect: [{ key: 'B', label: 'B = 1/(RC)', value: 2000, unit: 'rad/s' }, { key: 'Q', label: 'Q = ω0RC', value: 25 }, { key: 'w1', label: 'ω1 (직렬 Q=25와 같음)', value: 49010, unit: 'rad/s' },
        { key: 'w2', label: 'ω2', value: 51010, unit: 'rad/s' }, { key: 'peak', label: '|V(ω0)| = Im·R', value: 12.5, unit: 'V' }] }
  ],
  evaluate(v, { k }) {
    const inputs = resonanceInputs(v), r = resonance({ circuit: v.circuit, ...inputs, source: v.source }), series = r.circuit === 'series';
    const w = v.ratio * r.w0, now = r.at(w), top = r.at(r.w0), half = r.at(r.w1);
    const span = Math.min(1, Math.max(0.1, 3 * Math.log10(r.w2 / r.w1))), lo = r.w0 * 10 ** -span, hi = r.w0 * 10 ** span;
    const grid = [...new Set([...logGrid(lo, hi, 400), r.w0, r.w1, r.w2].filter(x => x >= lo && x <= hi))].sort((a, b) => a - b);
    const respUnit = series ? 'A' : 'V', respName = series ? '|I|' : '|V|', storeName = series ? '|VL| = |VC|' : '|IL| = |IC|', storeUnit = series ? 'V' : 'A';
    const susceptance = w * r.C - 1 / (w * r.L), store = series ? top.vL : top.iL, approxErr = (r.approx[0] - r.w1) / r.w1 * 100;
    const values = { w0: r.w0, f0: r.f0, w1: r.w1, w2: r.w2, B: r.B, Q: r.Q, R: r.R, L: r.L, C: r.C, peak: top.response * k, halfResponse: half.response * k, storeL: store * k, P0: top.p, cursorResponse: now.response * k };
    const a = series ? 'R/(2L)' : '1/(2RC)', aValue = r.B / 2;
    return { status: 'valid', values,
      read: (series ? '직렬' : '병렬') + ' 공진: ω0 = 1/√(LC) = ' + short(r.w0) + ' rad/s (f0 = ' + short(r.f0) + ' Hz), B = ' + (series ? 'R/L' : '1/(RC)') + ' = ' + short(r.B) + ' rad/s, Q = ω0/B = ' + short(r.Q)
        + ', ω1·ω2 = ' + short(r.w1) + ' · ' + short(r.w2) + ' rad/s',
      freqPlots: [{ title: '공진 곡선 ' + respName + '(ω) · 반전력 띠 ω1~ω2', range: [lo, hi], legend: '실선 = ' + respName + ' (' + (k > 1 ? 'peak' : 'rms') + '), 노란 점선 = 최댓값의 1/√2, 음영 = ω1~ω2 (대역폭 B), 세로 실선 = 커서.',
        panels: [{ label: respName + ' (' + respUnit + ')', yMin: 0, band: [r.w1, r.w2], cursor: w, hlines: [{ y: top.response * k / Math.SQRT2, label: '0.707 × 최대' }],
          marks: [{ w: r.w1, label: 'ω1' }, { w: r.w0, label: 'ω0' }, { w: r.w2, label: 'ω2' }],
          series: [{ style: 'exact', points: grid.map(x => [x, r.at(x).response * k]), cursorValue: now.response * k }] }] }],
      metrics: [metric('ω0 = 1/√(LC)', fmt(r.w0), 'rad/s'), metric('f0', fmt(r.f0), 'Hz'), metric('ω1 (정확)', fmt(r.w1), 'rad/s'), metric('ω2 (정확)', fmt(r.w2), 'rad/s'),
        metric('B = ω2 − ω1', fmt(r.B), 'rad/s'), metric('Q = ω0/B', fmt(r.Q)), metric(respName + '(ω0)', fmt(top.response * k), respUnit), metric(storeName + ' (ω0) = Q×전원', fmt(store * k), storeUnit),
        metric('P(ω0)', fmt(top.p), 'W'), metric('근사 ω0 ∓ B/2', short(r.approx[0]) + ' · ' + short(r.approx[1]) + ' (ω1 오차 ' + short(approxErr) + ' %)', 'rad/s')],
      tables: [
        ...(v.solve === 'rlc' ? [] : [{ title: '역산한 소자값', headers: ['소자', '식', '값'], rows: v.solve === 'f0' ? [['C', '1/((2πf0)²·L)', siUnit(r.C, 'F')]]
          : series ? [['L', 'R/B', siUnit(r.L, 'H')], ['C', '1/(ω0²·L)', siUnit(r.C, 'F')]] : [['C', '1/(R·B)', siUnit(r.C, 'F')], ['L', '1/(ω0²·C)', siUnit(r.L, 'H')]] }]),
        { title: '커서 ω = ' + short(w) + ' rad/s (ω/ω0 = ' + short(v.ratio) + ')', headers: ['양', '값'], rows: series
          ? [['Z = R + j(ωL − 1/(ωC))', short(now.z.re) + (now.z.im < 0 ? ' − j' : ' + j') + short(Math.abs(now.z.im)) + ' Ω'], ['|I|', fmt(now.response * k) + ' A'],
            ['|VR| · |VL| · |VC|', short(now.vR * k) + ' · ' + short(now.vL * k) + ' · ' + short(now.vC * k) + ' V'], ['P', fmt(now.p) + ' W']]
          : [['Y = 1/R + j(ωC − 1/(ωL))', short(1 / r.R) + (susceptance < 0 ? ' − j' : ' + j') + short(Math.abs(susceptance)) + ' S'], ['|V|', fmt(now.response * k) + ' V'],
            ['|IR| · |IL| · |IC|', short(now.iR * k) + ' · ' + short(now.iL * k) + ' · ' + short(now.iC * k) + ' A'], ['P', fmt(now.p) + ' W']] },
        { title: '반전력 주파수 유도 (지금 값)', headers: ['단계', '식', '값'], rows: series
          ? [['반전력 조건', '|Z| = √2·R ⇔ ωL − 1/(ωC) = ±R', 'R = ' + short(r.R) + ' Ω'], ['이차방정식', 'ω² ∓ (R/L)ω − 1/(LC) = 0', 'R/L = ' + short(r.B) + ', 1/(LC) = ' + short(r.w0 ** 2)],
            ['양의 근', 'ω1,2 = ∓' + a + ' + √((' + a + ')² + ω0²)', short(r.w1) + ' · ' + short(r.w2)], ['확인', 'ω1·ω2 = ω0², ω2 − ω1 = B', short(Math.sqrt(r.w1 * r.w2)) + ' · ' + short(r.w2 - r.w1)]]
          : [['반전력 조건', '|Y| = √2/R ⇔ ωC − 1/(ωL) = ±1/R', 'R = ' + short(r.R) + ' Ω'], ['이차방정식', 'ω² ∓ ω/(RC) − 1/(LC) = 0', '1/(RC) = ' + short(r.B) + ', 1/(LC) = ' + short(r.w0 ** 2)],
            ['양의 근', 'ω1,2 = ∓' + a + ' + √((' + a + ')² + ω0²)', short(r.w1) + ' · ' + short(r.w2)], ['확인', 'ω1·ω2 = ω0², ω2 − ω1 = B', short(Math.sqrt(r.w1 * r.w2)) + ' · ' + short(r.w2 - r.w1)]] },
        { title: '표 14.4 같은 R·L·C로 비교', headers: ['', '직렬', '병렬'], rows: (() => {
          const s = resonance({ ...inputs, circuit: 'series', source: 1 }), p = resonance({ ...inputs, circuit: 'parallel', source: 1 });
          return [['B', short(s.B) + ' (R/L)', short(p.B) + ' (1/(RC))'], ['Q', short(s.Q) + ' (ω0L/R)', short(p.Q) + ' (ω0RC)'],
            ['ω1 · ω2', short(s.w1) + ' · ' + short(s.w2), short(p.w1) + ' · ' + short(p.w2)], ['Q직렬 × Q병렬', short(s.Q * p.Q), '(= 1)']];
        })() }],
      checks: [
        { label: '√(ω1·ω2) = ω0', actual: Math.sqrt(r.w1 * r.w2), expected: r.w0, tol: 1e-9 * r.w0, pass: Math.abs(Math.sqrt(r.w1 * r.w2) - r.w0) <= 1e-9 * r.w0, unit: 'rad/s' },
        { label: 'ω2 − ω1 = B', actual: r.w2 - r.w1, expected: r.B, tol: 1e-9 * r.w0, pass: Math.abs(r.w2 - r.w1 - r.B) <= 1e-9 * r.w0, unit: 'rad/s' },
        { label: 'P(ω1)/P(ω0) (|Z| 직접 계산)', actual: half.p / top.p, expected: 0.5, tol: 1e-9, pass: Math.abs(half.p / top.p - 0.5) <= 1e-9 },
        { label: 'P(ω2)/P(ω0)', actual: r.at(r.w2).p / top.p, expected: 0.5, tol: 1e-9, pass: Math.abs(r.at(r.w2).p / top.p - 0.5) <= 1e-9 }],
      notes: [series ? '공진에서 |VL| = |VC| = Q·Vm 이라 Q가 크면 소자 전압이 전원보다 훨씬 큽니다.' : '공진에서 |IL| = |IC| = Q·Im 입니다.',
        'ω0 ∓ B/2 근사는 Q ≥ 10 정도에서 잘 맞습니다. 지금 Q = ' + short(r.Q) + ', ω1 근사 오차 ' + short(approxErr) + ' %.', '진폭 기준(peak/RMS)을 바꾸면 전원·전류·전압 숫자만 √2배가 되고 ω0·B·Q·P는 그대로입니다.'] };
  }
};
