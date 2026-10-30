// Ch.14 live tools: passive/active filters (16) and magnitude/frequency scaling (17). Pure, no DOM (the figure is an SVG string).
import { analyzeTransfer, classifyFilter, normalizeRational, polyText, solveMagnitude } from './circuit-course-transfer.js';
import { FILTER_CIRCUITS, filterCircuit, buildFilter, SCALING_BASES, scaledLadder } from './circuit-course-filters.js';
import { logGrid } from './circuit-course-freq-plot.js';
import { fmt, short, siUnit } from './circuit-course-format.js';
import { num, choice, metric } from './circuit-course-tool-common.js';

const LOG_SLIDER = (min, max) => ({ min, max, step: 0.005, log: true });
const siNum = (key, label, unit, initial, min, max, extra = {}) => num(key, label, unit, initial, min, max, { si: true, slider: LOG_SLIDER(Math.max(min, 1e-15), max), ...extra });
const dB = x => 20 * Math.log10(x);
const mag = (sys, w) => { const v = sys.at(w); return Math.hypot(v.re, v.im); };
const TYPE_CODE = { lowpass: 1, highpass: 2, bandpass: 3, bandstop: 4 };
const UNIT = { R: 'Ω', L: 'H', C: 'F' };
const limitText = x => (x === null ? '0/0' : x === Infinity ? '∞' : short(x));

// ---------------------------------------------------------------------------------------------------------------------------------
// 16 · Filters
const circuitOf = v => filterCircuit(v.family === 'active' ? v.active : v.passive);
const uses = key => v => circuitOf(v)?.fields.includes(key) ?? false;
const cLabel = which => v => {
  const c = circuitOf(v);
  if (c?.family === 'active') return which === 1 ? 'C1 (ω1 = 1/(R·C1))' : 'C2 (ω2 = 1/(R·C2))';
  return which === 1 ? 'C1 (가운데 접지 가지)' : 'C2 (직렬)';
};
const choicesOf = family => FILTER_CIRCUITS.filter(c => c.family === family).map(c => [c.id, c.label]);

export const FILTER_TOOL = {
  id: 'filters', title: '16 · 수동 · 능동 필터', tab: 'Ch.14',
  lead: '회로를 고르고 소자값을 바꾸면 H(s), H(0)·H(∞)로 본 필터 종류, 차수, 차단(반전력) 주파수와 |H| 곡선이 바로 바뀝니다. 차단 주파수의 기준은 저역 H(0), 고역 H(∞), 대역통과 최댓값, 대역차단 통과 이득입니다.',
  fields: [
    choice('family', '종류', 'passive', [['passive', '수동 (14.7)'], ['active', '능동 (14.8)']], { segment: true }),
    choice('passive', '수동 회로', 'lp2', choicesOf('passive'), { showIf: v => v.family !== 'active' }),
    choice('active', '능동 회로', 'inv-lp', choicesOf('active'), { showIf: v => v.family === 'active' }),
    siNum('R', '저항 R', 'Ω', 2000, 1e-6, 1e9, { showIf: uses('R') }),
    siNum('L', '인덕턴스 L', 'H', 2, 1e-12, 1e6, { showIf: uses('L') }),
    siNum('C', '커패시턴스 C', 'F', 2e-6, 1e-15, 1e3, { showIf: uses('C') }),
    siNum('R1', '저항 R1', 'Ω', 1, 1e-6, 1e9, { showIf: uses('R1') }),
    siNum('R2', '저항 R2', 'Ω', 1, 1e-6, 1e9, { showIf: uses('R2') }),
    siNum('L1', '인덕턴스 L1', 'H', 1, 1e-12, 1e6, { showIf: uses('L1') }),
    siNum('L2', '인덕턴스 L2', 'H', 1, 1e-12, 1e6, { showIf: uses('L2') }),
    siNum('C1', cLabel(1), 'F', 1, 1e-15, 1e3, { showIf: uses('C1'), name: 'C1' }),
    siNum('C2', cLabel(2), 'F', 1, 1e-15, 1e3, { showIf: uses('C2'), name: 'C2' }),
    siNum('Ri', '입력 저항 Ri', 'Ω', 10e3, 1e-3, 1e12, { showIf: uses('Ri') }),
    siNum('Ci', '입력 커패시터 Ci', 'F', 0.1e-6, 1e-15, 1e3, { showIf: uses('Ci') }),
    siNum('Rf', '귀환 저항 Rf', 'Ω', 20e3, 0, 1e12, { showIf: uses('Rf'), slider: LOG_SLIDER(1, 1e9) }),
    siNum('Cf', '귀환 커패시터 Cf', 'F', 10e-9, 1e-15, 1e3, { showIf: uses('Cf') })
  ],
  presets: [
    { label: '예제 14.10 2차 저역 L=2 H · R=2 kΩ · C=2 µF', values: { family: 'passive', passive: 'lp2', L: 2, R: 2000, C: 2e-6 },
      expect: [{ key: 'typeCode', label: '종류 = 저역통과 (1)', value: 1 }, { key: 'order', label: '차수', value: 2 }, { key: 'h0', label: 'H(0)', value: 1 },
        { key: 'wc', label: 'ωc (H(0) 기준)', value: 742.3, unit: 'rad/s' }, { key: 'fc', label: 'fc', value: 118.1, unit: 'Hz' }, { key: 'slopeHigh', label: '고주파 기울기', value: -40, unit: 'dB/dec' },
        { key: 'peakDb', label: '봉우리', value: 6.30, unit: 'dB', abs: 0.01 }] },
    { label: 'RC 저역 (예제 14.1 회로) R=1 kΩ · C=1 µF', values: { family: 'passive', passive: 'rc-lp', R: 1000, C: 1e-6 },
      expect: [{ key: 'typeCode', label: '종류 = 저역통과 (1)', value: 1 }, { key: 'wc', label: 'ωc = 1/(RC)', value: 1000, unit: 'rad/s' },
        { get: r => dB(mag(r.sys, 1000)), label: '|H(jωc)|', value: -3.0103, unit: 'dB' }, { get: r => r.sys.phaseDeg(1000), label: '∠H(jωc)', value: -45, unit: '°' }, { key: 'slopeHigh', label: '고주파 기울기', value: -20, unit: 'dB/dec' }] },
    { label: '연습 14.57(a) R–C–C–R = 1 Ω · 1 F · 1 F · 1 Ω', values: { family: 'passive', passive: 'ladder-rc', R1: 1, C1: 1, C2: 1, R2: 1 },
      expect: [{ key: 'typeCode', label: '종류 = 대역통과 (3)', value: 3 }, { key: 'w0', label: 'ω0 = √(ω1ω2)', value: 1, unit: 'rad/s' }, { key: 'B', label: 'B', value: 3, unit: 'rad/s' },
        { key: 'w1', label: 'ω1', value: 0.3028, unit: 'rad/s' }, { key: 'w2', label: 'ω2', value: 3.303, unit: 'rad/s' }, { key: 'peakDb', label: '최댓값 1/3', value: -9.542, unit: 'dB' }] },
    { label: '연습 14.57(b) L–R–R–L = 1 H · 1 Ω · 1 Ω · 1 H', values: { family: 'passive', passive: 'ladder-rl', L1: 1, R1: 1, R2: 1, L2: 1 },
      expect: [{ key: 'typeCode', label: '종류 = 대역통과 (3)', value: 3 }, { key: 'w0', label: 'ω0', value: 1, unit: 'rad/s' }, { key: 'B', label: 'B', value: 3, unit: 'rad/s' },
        { key: 'w1', label: 'ω1', value: 0.3028, unit: 'rad/s' }, { key: 'w2', label: 'ω2', value: 3.303, unit: 'rad/s' }] },
    { label: 'RL 고역 (출력 L) R=1 kΩ · L=0.1 H · 식 검산 ωc=R/L', values: { family: 'passive', passive: 'rl-hp', R: 1000, L: 0.1 },
      expect: [{ key: 'typeCode', label: '종류 = 고역통과 (2)', value: 2 }, { key: 'wc', label: 'ωc = R/L', value: 1e4, unit: 'rad/s' }, { key: 'hInf', label: 'H(∞)', value: 1 }] },
    { label: '직렬 RLC 대역차단 R=100 Ω · L=10 mH · C=1 µF · 식 검산', values: { family: 'passive', passive: 'rlc-bs', R: 100, L: 10e-3, C: 1e-6 },
      expect: [{ key: 'typeCode', label: '종류 = 대역차단 (4)', value: 4 }, { key: 'w0', label: 'ω0 = 1/√(LC)', value: 1e4, unit: 'rad/s' }, { key: 'B', label: 'B = R/L', value: 1e4, unit: 'rad/s' }] },
    { label: '반전 저역 Ri=10 kΩ · Rf=20 kΩ · Cf=10 nF · 식 검산', values: { family: 'active', active: 'inv-lp', Ri: 10e3, Rf: 20e3, Cf: 10e-9 },
      expect: [{ key: 'typeCode', label: '종류 = 저역통과 (1)', value: 1 }, { key: 'h0', label: '직류 이득 −Rf/Ri', value: -2 }, { key: 'wc', label: 'ωc = 1/(RfCf)', value: 5000, unit: 'rad/s' }] },
    { label: '반전 고역 Ri=10 kΩ · Ci=0.1 µF · Rf=50 kΩ · 식 검산', values: { family: 'active', active: 'inv-hp', Ri: 10e3, Ci: 0.1e-6, Rf: 50e3 },
      expect: [{ key: 'typeCode', label: '종류 = 고역통과 (2)', value: 2 }, { key: 'hInf', label: '고주파 이득 −Rf/Ri', value: -5 }, { key: 'wc', label: 'ωc = 1/(RiCi)', value: 1000, unit: 'rad/s' }] },
    { label: '연습 14.65 꼴 비반전 고역 R=1 kΩ · C=1 µF · Ri=Rf=10 kΩ', values: { family: 'active', active: 'noninv-hp', R: 1000, C: 1e-6, Ri: 10e3, Rf: 10e3 },
      expect: [{ key: 'hInf', label: '고주파 이득 1 + Rf/Ri', value: 2 }, { key: 'wc', label: 'ωc = 1/(RC)', value: 1000, unit: 'rad/s' }] },
    { label: '대역통과 3단 ω1=1000 · ω2=10⁴ rad/s · Rf/Ri=1 · 식 검산', values: { family: 'active', active: 'bpf3', R: 10e3, C1: 0.1e-6, C2: 10e-9, Ri: 10e3, Rf: 10e3 },
      expect: [{ key: 'typeCode', label: '종류 = 대역통과 (3)', value: 3 }, { key: 'w0', label: 'ω0 = √(ω1ω2)', value: Math.sqrt(1e7), unit: 'rad/s' },
        { get: r => mag(r.sys, Math.sqrt(1e7)), label: '|H(ω0)| = (Rf/Ri)·ω2/(ω1+ω2)', value: 1e4 / 1.1e4 }] },
    { label: '대역차단 ω1=1000 · ω2=10⁴ rad/s · Rf/Ri=1 · 식 검산', values: { family: 'active', active: 'bsf', R: 10e3, C1: 0.1e-6, C2: 10e-9, Ri: 10e3, Rf: 10e3 },
      expect: [{ key: 'typeCode', label: '종류 = 대역차단 (4)', value: 4 }, { get: r => mag(r.sys, Math.sqrt(1e7)), label: '|H(ω0)| = (Rf/Ri)·2ω1/(ω1+ω2)', value: 2e3 / 1.1e4 },
        { key: 'h0', label: '통과 이득 Rf/Ri', value: 1 }] }
  ],
  evaluate(v) {
    const circuit = circuitOf(v);
    if (!circuit) return { status: 'invalid', reason: '회로를 고르세요.' };
    const built = buildFilter(circuit, v), f = classifyFilter(built.h), a = f.analysis, [lo, hi] = a.range;
    const marks = f.wc ? [{ w: f.wc, label: 'ωc' }] : f.w1 ? [{ w: f.w1, label: 'ω1' }, { w: f.w0, label: 'ω0' }, { w: f.w2, label: 'ω2' }] : [];
    const grid = [...new Set([...logGrid(lo, hi, 120), ...marks.map(m => m.w)].filter(w => w >= lo && w <= hi))].sort((x, y) => x - y);
    const peakDb = f.peak ? dB(f.peak.mag) : null, ref = f.reference;
    const values = { typeCode: TYPE_CODE[f.type] ?? 0, order: f.order, h0: f.h0 ?? NaN, hInf: f.hInf, wc: f.wc ?? NaN, fc: f.wc ? f.wc / (2 * Math.PI) : NaN, w0: f.w0 ?? NaN, w1: f.w1 ?? NaN, w2: f.w2 ?? NaN, B: f.bandwidth ?? NaN,
      slopeHigh: f.slopeHigh, peakDb: peakDb ?? NaN };
    // Three probes off the round numbers (a notch at exactly ω0 would make the relative error 0/0).
    const probes = [lo * 13.7, Math.sqrt(lo * hi) * 1.37, hi / 7.3];
    const worst = Math.max(...probes.map(w => { const p = a.at(w), d = built.at(w); return Math.hypot(p.re - d.re, p.im - d.im) / Math.max(Math.hypot(d.re, d.im), 1e-300); }));
    const shown = normalizeRational(built.h), edge = f.type === 'lowpass' ? 'H(0)' : f.type === 'highpass' ? 'H(∞)' : f.type === 'bandpass' ? '최댓값' : '통과 이득';
    const cut = f.wc ? 'ωc = ' + short(f.wc) + ' rad/s (fc = ' + short(f.wc / (2 * Math.PI)) + ' Hz)' : f.w1 ? 'ω1·ω0·ω2 = ' + short(f.w1) + ' · ' + short(f.w0) + ' · ' + short(f.w2) + ' rad/s, B = ' + short(f.bandwidth) : '반전력점 없음';
    const metrics = [metric('종류', f.label), metric('차수 (분모)', String(f.order)), metric('H(0)', limitText(f.h0)), metric('H(∞)', limitText(f.hInf)), metric('고주파 기울기', (f.slopeHigh > 0 ? '+' : '') + f.slopeHigh, 'dB/dec')];
    if (f.wc) metrics.push(metric('ωc (' + edge + '/√2)', fmt(f.wc), 'rad/s'), metric('fc', fmt(f.wc / (2 * Math.PI)), 'Hz'));
    if (f.w1) metrics.push(metric('ω1', fmt(f.w1), 'rad/s'), metric('ω2', fmt(f.w2), 'rad/s'), metric('ω0 = √(ω1ω2)', fmt(f.w0), 'rad/s'), metric('B = ω2 − ω1', fmt(f.bandwidth), 'rad/s'));
    if (f.type === 'bandstop') metrics.push(metric('|H(ω0)| (골)', short(mag(a, f.w0)) + ' = ' + short(dB(mag(a, f.w0))), 'dB'));
    if (f.type === 'lowpass' && peakDb > dB(Math.abs(f.h0)) + 0.01) metrics.push(metric('봉우리', short(peakDb) + ' dB @ ω=' + short(f.peak.w)));
    const notes = [];
    if (f.type === 'lowpass' && peakDb > dB(Math.abs(f.h0)) + 0.01) notes.push('봉우리가 있는 저역통과입니다. 강의의 차단 주파수는 H(0) 기준(−3 dB)이고, 회로 편집기의 자동 "−3 dB" 측정은 최댓값 기준이라 이 곡선을 대역통과처럼 읽습니다.');
    if (f.type === 'bandpass' || f.type === 'bandstop') notes.push('ω0 = √(ω1ω2)는 반전력점의 기하평균입니다. 2차 회로라면 1/√(LC)와 같습니다.');
    notes.push('고주파 기울기 = 20 × (분자 차수 − 분모 차수) dB/dec. 차수가 높을수록 차단 특성이 가파릅니다.');
    return { status: 'valid', values, sys: a,
      read: circuit.label + ' → ' + f.label + ' ' + f.order + '차 · ' + cut,
      freqPlots: [{ title: '|H(jω)| · ' + circuit.label, range: [lo, hi], legend: '실선 = 정확 |H| (dB), 노란 점선 = 기준(' + edge + ')의 −3 dB, 초록 점선 = 반전력 주파수' + (f.w1 ? ', 음영 = ω1~ω2' : '') + '.',
        panels: [{ label: '|H| (dB)', floor: 100, marks, band: f.w1 ? [f.w1, f.w2] : undefined, hlines: ref ? [{ y: dB(ref / Math.SQRT2), label: '−3 dB (' + edge + ' 기준)' }] : [],
          series: [{ style: 'exact', points: grid.map(w => [w, dB(mag(a, w))]) }] }] }],
      metrics,
      tables: [{ title: '회로와 전달함수', headers: ['', ''], rows: [['연결', circuit.topology], ['식', circuit.formula], ['지금 값', 'H(s) = (' + polyText(shown.num) + ') / (' + polyText(shown.den) + ')'],
        ...circuit.derivation.map((d, i) => ['유도 ' + (i + 1), d])] }],
      checks: [{ label: '다항식 H(s)와 회로 직접 계산 (세 주파수, 최대 상대오차)', actual: worst, expected: 0, tol: 1e-9, pass: worst <= 1e-9 }],
      notes };
  }
};

// ---------------------------------------------------------------------------------------------------------------------------------
// 17 · Magnitude and frequency scaling
const isRlc = v => v.base !== 'butter', isTarget = v => v.method === 'target';
function scaleFactors(v) {
  const base = SCALING_BASES[isRlc(v) ? 'rlc' : 'butter'];
  return isTarget(v) ? { Km: v.Rt / base.refR(v), Kf: 2 * Math.PI * v.ft / base.refW(v) } : { Km: v.Km, Kf: v.Kf };
}
export const SCALING_TOOL = {
  id: 'scaling', title: '17 · 크기 · 주파수 스케일링', tab: 'Ch.14',
  lead: '크기 Km은 R·L을 Km배, C를 1/Km배로, 주파수 Kf는 L·C를 1/Kf배로 바꿉니다. 점선(원 회로)과 실선(바꾼 회로)을 겹쳐 보면 Km은 전압비 곡선을 바꾸지 않고, Kf는 곡선을 log10(Kf) decade만큼 옆으로 옮깁니다.',
  fields: [
    choice('base', '원 회로', 'rlc', [['rlc', '직렬 RLC'], ['butter', '4차 Butterworth']], { segment: true }),
    choice('method', '방식', 'direct', [['direct', 'Km · Kf 직접'], ['target', '목표 R · 주파수 → Km · Kf']]),
    siNum('R0', '원 회로 R', 'Ω', 10, 1e-6, 1e9, { showIf: isRlc }),
    siNum('L0', '원 회로 L', 'H', 2, 1e-12, 1e6, { showIf: isRlc }),
    siNum('C0', '원 회로 C', 'F', 312.5e-6, 1e-15, 1e3, { showIf: isRlc }),
    siNum('Km', '크기 배율 Km', '', 1, 1e-6, 1e9, { showIf: v => !isTarget(v), slider: LOG_SLIDER(1e-3, 1e6) }),
    siNum('Kf', '주파수 배율 Kf', '', 1, 1e-6, 1e12, { showIf: v => !isTarget(v), slider: LOG_SLIDER(1e-3, 1e9) }),
    siNum('Rt', v => (isRlc(v) ? '목표 R' : '목표 종단 저항'), 'Ω', 10e3, 1e-6, 1e12, { showIf: isTarget, name: '목표 R' }),
    siNum('ft', v => (isRlc(v) ? '목표 공진 주파수 f0' : '목표 차단 주파수'), 'Hz', 50e3, 1e-6, 1e12, { showIf: isTarget, name: '목표 주파수' })
  ],
  presets: [
    { label: '과제 14.77(a) Km=600 (10 Ω · 2 H · 312.5 µF)', values: { base: 'rlc', method: 'direct', R0: 10, L0: 2, C0: 312.5e-6, Km: 600, Kf: 1 },
      expect: [{ key: 'R', label: "R'", value: 6000, unit: 'Ω' }, { key: 'L', label: "L'", value: 1200, unit: 'H' }, { key: 'C', label: "C'", value: 520.8e-9, unit: 'F' }, { key: 'Qs', label: "Q'", value: 8 }] },
    { label: '과제 14.77(b) Kf=1000', values: { base: 'rlc', method: 'direct', R0: 10, L0: 2, C0: 312.5e-6, Km: 1, Kf: 1000 },
      expect: [{ key: 'R', label: "R'", value: 10, unit: 'Ω' }, { key: 'L', label: "L'", value: 2e-3, unit: 'H' }, { key: 'C', label: "C'", value: 312.5e-9, unit: 'F' },
        { key: 'w0s', label: "ω0'", value: 40000, unit: 'rad/s' }, { key: 'Bs', label: "B'", value: 5000, unit: 'rad/s' }, { key: 'Qs', label: "Q'", value: 8 }] },
    { label: '과제 14.77(c) Km=400 · Kf=10⁵', values: { base: 'rlc', method: 'direct', R0: 10, L0: 2, C0: 312.5e-6, Km: 400, Kf: 1e5 },
      expect: [{ key: 'R', label: "R'", value: 4000, unit: 'Ω' }, { key: 'L', label: "L'", value: 8e-3, unit: 'H' }, { key: 'C', label: "C'", value: 7.8125e-12, unit: 'F' }, { key: 'Qs', label: "Q'", value: 8 }] },
    { label: '예제 14.14 4차 Butterworth → 10 kΩ · 50 kHz', values: { base: 'butter', method: 'target', Rt: 10e3, ft: 50e3 },
      expect: [{ key: 'Km', label: 'Km', value: 1e4 }, { key: 'Kf', label: 'Kf = 2π·50k', value: 3.1416e5 }, { key: 'L2', label: "L2'", value: 58.82e-3, unit: 'H' }, { key: 'L4', label: "L4'", value: 24.35e-3, unit: 'H' },
        { key: 'C1', label: "C1'", value: 243.5e-12, unit: 'F' }, { key: 'C3', label: "C3'", value: 588.2e-12, unit: 'F' }, { key: 'f3', label: '−3 dB (직류 대비) 주파수', value: 50e3, unit: 'Hz' }] }
  ],
  evaluate(v) {
    const { Km, Kf } = scaleFactors(v);
    if (!(Km > 0 && Kf > 0 && Number.isFinite(Km) && Number.isFinite(Kf))) return { status: 'invalid', reason: 'Km과 Kf는 0보다 커야 합니다.' };
    const rlc = isRlc(v), base = SCALING_BASES[rlc ? 'rlc' : 'butter'], ladder = scaledLadder(base.elements(v), Km, Kf);
    const wRef = base.refW(v), lo = Math.min(wRef, wRef * Kf) / 100, hi = Math.max(wRef, wRef * Kf) * 100;
    const grid = logGrid(lo, hi, 60), magOf = (sys, w) => { const x = sys.at(w); return Math.hypot(x.re, x.im); };
    const values = { Km, Kf };
    for (const e of ladder.elements) values[rlc ? e.kind : e.name] = e.scaled;
    const rows = ladder.elements.map(e => [e.name + (e.at === 'series' ? ' (직렬)' : ' (병렬)'), siUnit(e.value, UNIT[e.kind]), e.kind === 'R' ? '× Km' : e.kind === 'L' ? '× Km/Kf' : '÷ (Km·Kf)', siUnit(e.scaled, UNIT[e.kind])]);
    const metrics = [metric('Km', short(Km)), metric('Kf', short(Kf))];
    const notes = ['크기 스케일링은 전압비 H를 바꾸지 않습니다(임피던스만 Km배). 주파수 스케일링은 같은 응답을 ω×Kf 자리로 옮기고 Q는 그대로입니다.'];
    const marks = [{ w: wRef, label: '원' }, { w: wRef * Kf, label: '새' }];
    if (rlc) {
      const w0 = 1 / Math.sqrt(v.L0 * v.C0), B = v.R0 / v.L0, w0s = 1 / Math.sqrt(values.L * values.C), Bs = values.R / values.L;
      Object.assign(values, { w0, B, Q: w0 / B, w0s, Bs, Qs: w0s / Bs });
      metrics.push(metric("ω0 → ω0'", short(w0) + ' → ' + short(w0s), 'rad/s'), metric("B → B'", short(B) + ' → ' + short(Bs), 'rad/s'), metric("Q → Q'", short(w0 / B) + ' → ' + short(w0s / Bs)));
    } else {
      const dc0 = magOf(ladder.before, wRef * 1e-4), dc1 = magOf(ladder.after, wRef * Kf * 1e-4), aAfter = analyzeTransfer(ladder.after.h);
      const w3 = solveMagnitude(aAfter, wRef * Kf / 100, wRef * Kf * 100, dc1 / Math.SQRT2);
      Object.assign(values, { f3: w3 / (2 * Math.PI), w3, dcDb: dB(dc0) });
      metrics.push(metric('직류 이득', short(dB(dc1)), 'dB'), metric('−3 dB (직류 대비)', short(w3) + ' rad/s = ' + short(w3 / (2 * Math.PI)) + ' Hz'),
        metric('10배 주파수에서', short(dB(magOf(ladder.after, 10 * w3)) - dB(dc1)), 'dB (−80 dB/dec)'));
      notes.push('정규형(1 Ω, ωc = 1 rad/s) 소자값은 교재 표의 반올림 값(0.765, 1.848)이라 차단 주파수가 정확히 1이 아니고 0.01 % 정도 다릅니다.');
    }
    const shift = Math.max(...grid.map(w => Math.abs(dB(magOf(ladder.after, w * Kf)) - dB(magOf(ladder.before, w)))));
    return { status: 'valid', values,
      read: base.label + ': Km = ' + short(Km) + ', Kf = ' + short(Kf) + ' → ' + ladder.elements.map(e => e.name + "' = " + siUnit(e.scaled, UNIT[e.kind])).join(', '),
      freqPlots: [{ title: '|H(jω)| 원 회로(점선)와 바꾼 회로(실선)', range: [lo, hi], legend: '점선 = 원 회로, 실선 = 스케일 후. 초록 점선 = 기준 주파수(원 → 새). Km만 바꾸면 두 곡선이 겹칩니다.',
        panels: [{ label: '|H| (dB)', floor: 120, marks, series: [{ style: 'base', points: grid.map(w => [w, dB(magOf(ladder.before, w))]) }, { style: 'exact', points: grid.map(w => [w, dB(magOf(ladder.after, w))]) }] }] }],
      metrics,
      tables: [{ title: '원 값 → 새 값', headers: ['소자', '원 값', '규칙', '새 값'], rows }],
      checks: [{ label: "|H'(j·Kf·ω)| = |H(jω)| (전 구간 최대 차이)", actual: shift, expected: 0, tol: 1e-6, pass: shift <= 1e-6, unit: 'dB' },
        ...(rlc ? [{ label: "Q' = Q", actual: values.Qs, expected: values.Q, tol: 1e-9 * values.Q, pass: Math.abs(values.Qs - values.Q) <= 1e-9 * values.Q }] : [])],
      notes };
  }
};
