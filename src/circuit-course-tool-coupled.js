// Live tool definitions for Ch.13: coupled coils with T/π equivalents, and the transformer tool (ideal, rating, autotransformer, 3-phase bank). Pure, no DOM.
import { scale, magnitude } from './circuit-course-complex.js';
import { coupledCoils, coupledEquivalents, coupledEnergy, autotransformerSplit, idealTransformer, idealRating, autotransformer, threePhaseBank, BANK_CONNECTIONS } from './circuit-course-coupled.js';
import { fmt, polarShort, short, zText, COUPLING_TOOL_GUIDE } from './circuit-course-format.js';
import { num, amp, choice, angleField, putPolar, metric } from './circuit-course-tool-common.js';

const z = (re, im) => ({ re, im });
const zField = (key, label, r, x, extra = {}) => [num(key + 'R', label + ' 저항 R', 'Ω', r, 0, 1e9, extra), num(key + 'X', label + ' 리액턴스 X', 'Ω', x, -1e9, 1e9, extra)];
// A component that is only rounding noise next to the other one is shown as exactly 0 (a purely real winding power would otherwise print an angle like 5e-15°).
const clean = w => { const m = magnitude(w), tiny = x => (Math.abs(x) <= 1e-12 * m ? 0 : x); return { re: tiny(w.re), im: tiny(w.im) }; };
const unit = k => (k > 1 ? 'peak' : 'rms');
const henry = L => (Math.abs(L) >= 1 || L === 0 ? short(L) + ' H' : short(L * 1e3) + ' mH');
const piHenry = L => (L === Infinity ? '개방 (∞ H, 가지 없음)' : henry(L));

// ---------------------------------------------------------------------------------------------------------------------------------
const byK = v => v.couplingMode === 'k';
// The "보기" segment decides what shows: 회로 풀이 (source, Z1, ZL → I1, I2, ZR, Zin), T/π 등가 (coils only), 에너지 (typed i1, i2, or the solved circuit at time t).
const inView = name => v => v.view === name;
const solvesCircuit = v => v.view === 'circuit' || (v.view === 'energy' && v.energySource === 'circuit');
const directEnergy = v => v.view === 'energy' && v.energySource === 'direct';
export const COUPLED_TOOL = {
  id: 'coupled', title: '12 · 자기결합 코일 · T/π 등가', tab: 'Ch.13',
  lead: '보기를 고르세요. 회로 풀이: 전원·Z1·ZL 로 I1, I2, 반사 임피던스, 입력 임피던스. T/π 등가: L1, L2, M 과 점 위치만으로 T·π 인덕턴스. 에너지: w = ½L1i1² + ½L2i2² ± M i1 i2. 점 같은 쪽/반대쪽이 M 항의 부호를 바꿉니다. ' + COUPLING_TOOL_GUIDE,
  fields: [
    choice('view', '보기', 'circuit', [['circuit', '회로 풀이'], ['tpi', 'T/π 등가'], ['energy', '에너지']], { segment: true }),
    choice('energySource', '에너지에 쓸 전류', 'direct', [['direct', 'i1, i2 를 직접 입력'], ['circuit', '회로 풀이의 관측 시각 t']], { showIf: inView('energy') }),
    num('omega', '각주파수 ω', 'rad/s', 4, 1e-6, 1e9, { showIf: solvesCircuit }),
    num('l1', '코일 1 자기 인덕턴스 L1', 'H', 5, 1e-12, 1e9), num('l2', '코일 2 자기 인덕턴스 L2', 'H', 4, 1e-12, 1e9),
    choice('couplingMode', '결합 입력', 'M', [['M', '상호 인덕턴스 M'], ['k', '결합계수 k=M/√(L1L2)']]),
    num('m', '상호 인덕턴스 M', 'H', 2.5, 0, 1e9, { showIf: v => !byK(v) }),
    num('k', '결합계수 k', '', 0.56, 0, 1, { showIf: byK, slider: { min: 0, max: 1, step: 0.01 } }),
    choice('dots', '점 위치', 'opposite', [['same', '같은 쪽 (양쪽 코일 위)'], ['opposite', '반대쪽 (위/아래)']]),
    choice('i2Ref', 'I2 기준 방향', 'loop', [['loop', '2차 메시 시계방향 (예제 13.1, 13.3)'], ['into', '2차 코일 위 단자로 들어가는 방향 (예제 13.5, 13.6)']], { showIf: v => v.view !== 'tpi' }),
    num('i1', '코일 1 전류 i1 (순간값, 위 단자로 들어가는 방향)', 'A', 2, -1e9, 1e9, { showIf: directEnergy }), num('i2', '코일 2 전류 i2 (순간값, 위의 I2 기준 방향)', 'A', 3, -1e9, 1e9, { showIf: directEnergy }),
    amp('voltage', '전원 V', 'V', 60 / Math.SQRT2, 0, 1e9, { showIf: solvesCircuit }), angleField('voltageDeg', '전원 위상', 30, { showIf: solvesCircuit }),
    ...zField('z1', '1차 직렬 Z1', 10, 0, { showIf: solvesCircuit }), ...zField('zl', '2차 부하 ZL', 0, -4, { showIf: solvesCircuit }),
    num('timeSec', '관측 시각 t', 's', 1, 0, 1e6, { showIf: v => v.view === 'energy' && v.energySource === 'circuit', slider: v => ({ min: 0, max: 4 * Math.PI / v.omega, step: 4 * Math.PI / v.omega / 400 }) })
  ],
  presets: [
    { label: '예제 13.1 12∠0° V · −j4 · j5 ~j3~ j6 · 12 Ω', basis: 'rms', values: { view: 'circuit', omega: 1, l1: 5, l2: 6, couplingMode: 'M', m: 3, dots: 'same', i2Ref: 'loop', voltage: 12, voltageDeg: 0, z1R: 0, z1X: -4, zlR: 12, zlX: 0, timeSec: 0 },
      expect: [{ key: 'I1Mag', label: '|I1|', value: 13.01, unit: 'A' }, { key: 'I1Ang', label: '∠I1', value: -49.39, unit: '°' }, { key: 'I2Mag', label: '|I2|', value: 2.91, unit: 'A' }, { key: 'I2Ang', label: '∠I2', value: 14.04,
        unit: '°' }] },
    { label: '예제 13.3 60cos(4t+30°) · L1=5 L2=4 M=2.5 H · C=1/16 F · w(1 s)', basis: 'peak', values: { view: 'circuit', omega: 4, l1: 5, l2: 4, couplingMode: 'M', m: 2.5, dots: 'opposite', i2Ref: 'loop', voltage: 60, voltageDeg: 30, z1R: 10, z1X: 0,
      zlR: 0, zlX: -4, timeSec: 1 },
      expect: [{ key: 'k', label: 'k', value: 0.56, rel: 2e-3, note: '2.5/√20=0.559 를 교재가 0.56으로 반올림' }, { key: 'I1Mag', label: '|I1| (peak)', value: 3.905, unit: 'A' }, { key: 'I1Ang', label: '∠I1', value: -19.4, unit: '°' },
        { key: 'I2Mag', label: '|I2| (peak)', value: 3.254, unit: 'A' }, { key: 'I2Ang', label: '∠I2', value: 160.6, unit: '°' }, { key: 'w', label: 'w(1 s)', value: 20.73, unit: 'J' }] },
    { label: '예제 13.5 L1=10 L2=4 M=2 H → T 등가 8·2·2 H', basis: 'rms', values: { view: 'tpi', omega: 1, l1: 10, l2: 4, couplingMode: 'M', m: 2, dots: 'same', i2Ref: 'into', voltage: 1, voltageDeg: 0, z1R: 1, z1X: 0, zlR: 1, zlX: 0, timeSec: 0 },
      expect: [{ key: 'La', label: 'La=L1−M', value: 8, unit: 'H' }, { key: 'Lb', label: 'Lb=L2−M', value: 2, unit: 'H' }, { key: 'Lc', label: 'Lc=M', value: 2, unit: 'H' },
        { key: 'LA', label: 'π: LA=(L1L2−M²)/(L2−M)', value: 18, unit: 'H', note: '36/2' }, { key: 'LB', label: 'π: LB=(L1L2−M²)/(L1−M)', value: 4.5, unit: 'H' }, { key: 'LC', label: 'π: LC=(L1L2−M²)/M', value: 18, unit: 'H' }] },
    { label: '예제 13.6 6∠90° V · 4 Ω · j8, j5, M=j1(점 반대) · 10 Ω', basis: 'rms', values: { view: 'circuit', omega: 1, l1: 8, l2: 5, couplingMode: 'M', m: 1, dots: 'opposite', i2Ref: 'into', voltage: 6, voltageDeg: 90, z1R: 4, z1X: 0, zlR: 10, zlX: 0,
      timeSec: 0 },
      expect: [{ key: 'La', label: 'La=L1+M', value: 9, unit: 'H' }, { key: 'Lb', label: 'Lb=L2+M', value: 6, unit: 'H' }, { key: 'Lc', label: 'Lc=−M', value: -1, unit: 'H' },
        { key: 'I2Mag', label: '|I2|', value: 0.06, unit: 'A' }, { key: 'I2Ang', label: '∠I2', value: 90.57, unit: '°', note: '교재는 j0.06 → 90°로 반올림 (정확값 90.57°)' },
        { key: 'I1Mag', label: '|I1|', value: 0.6708, unit: 'A', note: '교재는 0.6+j0.3 으로 반올림 (정확값 0.598+j0.306)' }, { key: 'VoMag', label: '|Vo|', value: 0.6, unit: 'V', rel: 2e-3 }] },
    // Energy by hand: both currents into the dotted terminals (i2Ref 'into', dots same) add the M term. Not a numbered textbook example.
    { label: '에너지 직접 대입 · L1=5, L2=4, M=2 H · i1=2, i2=3 A (점 같은 쪽)', basis: 'rms', values: { view: 'energy', energySource: 'direct', l1: 5, l2: 4, couplingMode: 'M', m: 2, dots: 'same', i2Ref: 'into', i1: 2, i2: 3 },
      expect: [{ key: 'self1', label: '½L1 i1²', value: 10, unit: 'J' }, { key: 'self2', label: '½L2 i2²', value: 18, unit: 'J' }, { key: 'mutual', label: '+M i1 i2', value: 12, unit: 'J' }, { key: 'w', label: 'w', value: 40, unit: 'J' }] },
    { label: '에너지 · 점 반대쪽이면 상호 항이 −12 J → w=16 J', basis: 'rms', values: { view: 'energy', energySource: 'direct', l1: 5, l2: 4, couplingMode: 'M', m: 2, dots: 'opposite', i2Ref: 'into', i1: 2, i2: 3 },
      expect: [{ key: 'mutual', label: '−M i1 i2', value: -12, unit: 'J' }, { key: 'w', label: 'w', value: 16, unit: 'J' }] },
    { label: '에너지 · k=1 (L1=4, L2=1, M=2), i2=−2 i1 이면 w=0', basis: 'rms', values: { view: 'energy', energySource: 'direct', l1: 4, l2: 1, couplingMode: 'M', m: 2, dots: 'same', i2Ref: 'into', i1: 1, i2: -2 },
      expect: [{ key: 'k', label: 'k', value: 1 }, { key: 'w', label: 'w (완전제곱 ½(√L1 i1+√L2 i2)²=0)', value: 0, unit: 'J', abs: 1e-9 }] }
  ],
  // Switching between M and k keeps the same coupling: the newly shown field is filled from the one that was in use (k = M/√(L1L2), M = k√(L1L2)).
  onSelect(v, key) {
    if (key !== 'couplingMode') return null;
    const root = Math.sqrt(v.l1 * v.l2);
    return v.couplingMode === 'k' ? { k: v.m / root } : { m: v.k * root };
  },
  // Three views of the same coils; the values are shared and the view only decides which inputs, results and graphs show.
  evaluate(v, { k }) {
    if (v.view === 'tpi') return tpiView(v);
    if (directEnergy(v)) return energyView(v);
    return circuitView(v, k);
  }
};

const coilArgs = v => ({ l1: v.l1, l2: v.l2, couplingMode: v.couplingMode, m: v.m, k: v.k, dots: v.dots });
const sgnOf = s => (s > 0 ? '+' : '−');
const energyRows = (self1, self2, mutual, w, sign) => [['L1 의 자기 에너지', '½ L1 i1²', fmt(self1)], ['L2 의 자기 에너지', '½ L2 i2²', fmt(self2)], ['상호 항', sign + ' M i1 i2', fmt(mutual)], ['저장 에너지 w', '세 항의 합', fmt(w)]];
const energyNotes = (sign, zeroRatio) => ['w = ½L1 i1² + ½L2 i2² ' + sign + ' M i1 i2. 두 전류가 점 찍힌 단자로 같이 들어가면(자속이 더해지면) +M i1 i2, 한쪽만 들어가면 −M i1 i2 입니다. 지금 점 위치와 I2 기준 방향에서는 ' + sign + ' 입니다.',
  'k ≤ 1 (M² ≤ L1L2) 이어야 w ≥ 0 입니다: w 는 행렬 [[L1, ±M], [±M, L2]] 의 이차형식이고, 행렬식 L1L2−M² 가 음수이면 어떤 (i1, i2)에서 w<0 이 되어 에너지 보존이 깨집니다. 그래서 M 은 √(L1L2) 를 넘을 수 없습니다.',
  ...(zeroRatio === null ? [] : ['k=1 이면 w = ½(√L1 i1 ± √L2 i2)² 로 완전제곱이 되어, i2/i1 = ' + short(zeroRatio) + ' 일 때 w=0 입니다 (두 코일이 한 자속을 완전히 나눠 가짐).'])];
const figureOf = (v, i2Ref) => ({ kind: 'coupled', dots: v.dots, i2Ref });

/** "T/π 등가": L1, L2, M (or k) and the dots only. */
function tpiView(v) {
  const r = coupledEquivalents(coilArgs(v));
  if (r.status !== 'valid') return r;
  const minus = r.dotSign > 0 ? '−' : '+', values = { k: r.k, M: r.M, La: r.T.La, Lb: r.T.Lb, Lc: r.T.Lc, seriesAiding: r.seriesAiding, seriesOpposing: r.seriesOpposing };
  if (r.pi) Object.assign(values, { LA: r.pi.LA, LB: r.pi.LB, LC: r.pi.LC });
  const tRows = [['La = L1 ' + minus + ' M', henry(r.T.La)], ['Lb = L2 ' + minus + ' M', henry(r.T.Lb)], ['Lc = ' + (r.dotSign > 0 ? '+M' : '−M'), henry(r.T.Lc)]];
  const piRows = r.pi ? [['LA = (L1L2−M²)/(L2∓M)', piHenry(r.pi.LA)], ['LB = (L1L2−M²)/(L1∓M)', piHenry(r.pi.LB)], ['LC = (L1L2−M²)/(±M)', piHenry(r.pi.LC)]] : [['π 등가', r.piReason]];
  return { status: 'valid', values, checks: r.checks,
    read: 'k=' + short(r.k) + ' · M=' + henry(r.M) + ' · T: La=' + henry(r.T.La) + ', Lb=' + henry(r.T.Lb) + ', Lc=' + henry(r.T.Lc) + (r.pi ? ' · π: LA=' + piHenry(r.pi.LA) + ', LB=' + piHenry(r.pi.LB) + ', LC=' + piHenry(r.pi.LC) : ' · ' + r.piReason),
    metrics: [metric('결합계수 k', short(r.k)), metric('M', henry(r.M)), metric('La', henry(r.T.La)), metric('Lb', henry(r.T.Lb)), metric('Lc', henry(r.T.Lc))],
    tables: [{ title: 'T 등가 (La, Lb, Lc)', headers: ['식', '값'], rows: tRows }, { title: 'π 등가', headers: ['식', '값'], rows: piRows },
      { title: '직렬 연결', headers: ['연결', 'L'], rows: [['가극성(aiding) L1+L2+2M', henry(r.seriesAiding)], ['감극성(opposing) L1+L2−2M', henry(r.seriesOpposing)]] }],
    notes: ['두 코일의 전류가 모두 점 찍힌(위) 단자로 들어가는 기준입니다. 점이 반대쪽이면 M 의 부호가 바뀌어 Lc=−M 이고 La, Lb 는 L+M 입니다.',
      ...(r.pi?.open.LA || r.pi?.open.LB ? ['π 등가에서 분모가 0인 가지(LA 또는 LB)는 인덕턴스가 무한대이므로 개방(가지 없음)입니다. 나머지 두 가지만 남습니다.'] : [])],
    figure: figureOf(v, 'into') };
}

/** "에너지" with typed i1, i2: w = ½L1 i1² + ½L2 i2² ± M i1 i2. */
function energyView(v) {
  const r = coupledEnergy({ ...coilArgs(v), i2Ref: v.i2Ref, i1: v.i1, i2: v.i2 });
  if (r.status !== 'valid') return r;
  const sign = sgnOf(r.sigma);
  return { status: 'valid', values: { k: r.k, M: r.M, w: r.w, self1: r.self1, self2: r.self2, mutual: r.mutual }, checks: r.checks,
    read: 'k=' + short(r.k) + ' · w = ' + fmt(r.self1) + ' + ' + fmt(r.self2) + ' ' + sign + ' ' + fmt(Math.abs(r.mutual)) + ' = ' + fmt(r.w) + ' J (i1=' + fmt(v.i1) + ' A, i2=' + fmt(v.i2) + ' A)',
    metrics: [metric('결합계수 k', short(r.k)), metric('M', henry(r.M)), metric('½ L1 i1²', fmt(r.self1), 'J'), metric('½ L2 i2²', fmt(r.self2), 'J'), metric(sign + ' M i1 i2', fmt(r.mutual), 'J'), metric('저장 에너지 w', fmt(r.w), 'J')],
    tables: [{ title: '에너지의 세 항', headers: ['항', '식', '값 (J)'], rows: energyRows(r.self1, r.self2, r.mutual, r.w, sign) }],
    notes: energyNotes(sign, r.zeroRatio), figure: figureOf(v, v.i2Ref) };
}

/** "회로 풀이" (and "에너지" from the solved circuit at time t): two meshes, the reflected impedance, Zin, I1, I2. */
function circuitView(v, k) {
  const r = coupledCoils({ frequencyHz: v.omega / (2 * Math.PI), ...coilArgs(v), z1: z(v.z1R, v.z1X), zl: z(v.zlR, v.zlX), voltageRms: v.voltage, voltageDeg: v.voltageDeg });
  if (r.status !== 'valid') return r;
  const I2 = v.i2Ref === 'into' ? r.I2into : r.I2, wNow = r.energy(v.timeSec), wm = v.omega * r.M;
  const sigma = v.i2Ref === 'into' ? r.dotSign : r.energySign, sign = sgnOf(sigma); // sign of the M i1 i2 term for the I2 reference shown
  const values = { k: r.k, M: r.M, w: wNow, La: r.T.La, Lb: r.T.Lb, Lc: r.T.Lc, ZRR: r.reflected.re, ZRX: r.reflected.im, Z22R: r.z22.re, Z22X: r.z22.im, ZinR: r.zin.re, ZinX: r.zin.im };
  putPolar(values, 'I1', r.I1, k); putPolar(values, 'I2', I2, k); putPolar(values, 'Vo', r.Vo, k);
  if (r.pi) Object.assign(values, { LA: r.pi.LA, LB: r.pi.LB, LC: r.pi.LC });
  const common = { status: 'valid', values, checks: r.checks, frequencyHz: r.frequencyHz, figure: figureOf(v, v.i2Ref) };
  if (v.view === 'energy') {
    const i1 = r.current(r.I1, v.timeSec), i2 = r.current(I2, v.timeSec), self1 = 0.5 * v.l1 * i1 * i1, self2 = 0.5 * v.l2 * i2 * i2, mutual = wNow - self1 - self2;
    return { ...common,
      read: 'k=' + short(r.k) + ' · t=' + fmt(v.timeSec) + ' s: i1=' + fmt(i1) + ' A, i2=' + fmt(i2) + ' A → w = ' + fmt(self1) + ' + ' + fmt(self2) + ' ' + sign + ' ' + fmt(Math.abs(mutual)) + ' = ' + fmt(wNow) + ' J',
      metrics: [metric('결합계수 k', short(r.k)), metric('i1(t)', fmt(i1), 'A'), metric('i2(t)', fmt(i2), 'A'), metric('w(t) 저장 에너지', fmt(wNow), 'J')],
      tables: [{ title: 'w(t) 의 세 항 (t=' + fmt(v.timeSec) + ' s)', headers: ['항', '식', '값 (J)'], rows: energyRows(self1, self2, mutual, wNow, sign) }],
      traces: [{ label: 'i1(t)', unit: 'A', phasor: r.I1 }, { label: 'i2(t)', unit: 'A', phasor: I2 }, { label: 'w(t)', unit: 'J', sample: r.energy }],
      notes: ['i1(t), i2(t) 는 회로 풀이의 전류를 시간 함수로 쓴 값입니다 (peak 기준 진폭이 아니라 순간값이라 표시 기준과 무관).', ...energyNotes(sign, r.k >= 1 - 1e-12 ? -sigma * Math.sqrt(v.l1 / v.l2) : null)] };
  }
  const ohm = z => zText(z) + ' Ω';
  return { ...common,
    read: 'k=' + short(r.k) + ' · I1=' + polarShort(scale(r.I1, k)) + ' A, I2=' + polarShort(scale(I2, k)) + ' A (' + unit(k) + ') · Z22=ZL+jωL2=' + zText(r.z22) + ' Ω → 반사 ZR=(ωM)²/Z22=' + zText(r.reflected) + ' Ω → Zin=Z1+jωL1+ZR=' + zText(r.zin) + ' Ω',
    metrics: [metric('결합계수 k', short(r.k)), metric('I1 (' + unit(k) + ')', polarShort(scale(r.I1, k)), 'A'), metric('I2 (' + unit(k) + ')', polarShort(scale(I2, k)), 'A'), metric('반사 ZR=(ωM)²/Z22', zText(r.reflected), 'Ω'),
      metric('Zin=Z1+jωL1+ZR', zText(r.zin), 'Ω')],
    tables: [{ title: '반사 임피던스 → 입력 임피던스', headers: ['단계', '식', '값'], rows: [['2차 루프 Z22', 'ZL + jωL2', ohm(r.z22)], ['(ωM)²', 'ω² M²', fmt(wm * wm) + ' Ω²'], ['반사 임피던스 ZR', '(ωM)² / Z22', ohm(r.reflected)],
      ['1차 루프 Z11', 'Z1 + jωL1', ohm(r.z11)], ['입력 임피던스 Zin', 'Z11 + ZR', ohm(r.zin)], ['1차 전류 I1 (' + unit(k) + ')', 'V / Zin', polarShort(scale(r.I1, k)) + ' A'],
      ['2차 전류 I2 (' + unit(k) + ')', sgnOf(r.dotSign) + 'jωM I1 / Z22', polarShort(scale(r.I2, k)) + ' A (시계방향 메시)']] }],
    traces: [{ label: 'i1(t)', unit: 'A', phasor: r.I1 }, { label: 'i2(t)', unit: 'A', phasor: I2 }],
    phasors: [{ label: 'V', unit: 'V', z: r.V }, { label: 'Vo (ZL 양단)', unit: 'V', z: r.Vo }, { label: 'I1', unit: 'A', z: r.I1 }, { label: 'I2', unit: 'A', z: I2 }],
    notes: ['2차 루프가 1차에서 보이는 반사 임피던스는 ZR = ω²M²/Z22 이고 Z22 = ZL + jωL2 입니다 (교재 13.3). 1차에서 본 입력 임피던스는 Zin = Z1 + jωL1 + ZR 이고 I1 = V/Zin 입니다.',
      '반사 임피던스는 M² 만 들어 있어 점 위치와 무관합니다. 점 위치는 I2 의 부호(식의 ' + (r.dotSign > 0 ? '−' : '+') + 'jωM 항)와 에너지의 ±M i1 i2 항만 바꿉니다.'] };
}

// ---------------------------------------------------------------------------------------------------------------------------------
const mode = name => v => v.mode === name;
const BANKS = Object.keys(BANK_CONNECTIONS).map(key => [key, key.replace('delta', 'Δ') + (key === 'Y-delta' ? ' (13.12)' : '')]);
export const TRANSFORMER_TOOL = {
  id: 'transformer', title: '13 · 변압기 (이상 · 단권 · 3상)', tab: 'Ch.13',
  lead: '이상 변압기는 n=N2/N1 로 V2=±nV1, I2=±I1/n, 부하는 ZL/n² 로 보입니다. 점 위치와 I2 기준 방향의 네 경우, 정격, 단권변압기, 3상 변압기 결선을 고릅니다. ' + COUPLING_TOOL_GUIDE,
  fields: [
    choice('mode', '종류', 'ideal', [['ideal', '이상 변압기 + 회로'], ['rating', '정격 (V1, V2, kVA → n, I)'], ['auto', '단권변압기'], ['bank', '3상 변압기 결선']]),
    num('turns1', '1차 권수 N1', '회', 1, 1e-9, 1e12, { showIf: mode('ideal') }), num('turns2', '2차 권수 N2', '회', 2, 1e-9, 1e12, { showIf: mode('ideal') }),
    choice('dots', '점 위치 (V 부호)', 'opposite', [['same', '같은 쪽 → V2/V1=+n'], ['opposite', '반대쪽 → V2/V1=−n']], { showIf: mode('ideal') }),
    choice('i2Direction', 'I2 기준 방향', 'out', [['out', '2차 + 단자에서 부하로 나감'], ['in', '2차 + 단자로 들어옴']], { showIf: mode('ideal') }),
    amp('voltage', '전원 V', 'V', 120, 0, 1e9, { showIf: mode('ideal') }), angleField('voltageDeg', '전원 위상', 0, { showIf: mode('ideal') }),
    ...zField('z1', '1차 직렬 Z1', 4, -6, { showIf: mode('ideal') }), ...zField('zl', '2차 부하 ZL', 20, 0, { showIf: mode('ideal') }),
    amp('v1', '정격 1차 전압 V1', 'V', 2400, 1e-6, 1e12, { showIf: mode('rating') }), amp('v2', '정격 2차 전압 V2', 'V', 120, 1e-6, 1e12, { showIf: mode('rating') }),
    num('kva', '정격 용량', 'kVA', 9.6, 1e-9, 1e12, { showIf: mode('rating') }), num('ratingTurns2', '2차 권수 N2', '회', 50, 1e-9, 1e12, { showIf: mode('rating') }),
    choice('autoMode', '단권변압기 결선', 'down', [['down', '강압: 전원 N1+N2, 부하 N2'], ['up', '승압: 전원 N1, 부하 N1+N2']], { showIf: mode('auto') }),
    num('autoN1', '권수 N1', '회', 100, 1e-9, 1e12, { showIf: mode('auto') }), num('autoN2', '권수 N2', '회', 100, 1e-9, 1e12, { showIf: mode('auto') }),
    amp('autoV1', '1차(전원) 전압', 'V', 240, 1e-6, 1e12, { showIf: mode('auto') }), amp('autoI2', '부하 전류 I2', 'A', 10, 0, 1e12, { showIf: mode('auto') }),
    num('autoPF', '부하 역률 pf (0 < pf ≤ 1)', '', 1, 1e-9, 1, { showIf: mode('auto'), slider: { min: 0.05, max: 1, step: 0.01 } }),
    choice('autoPFKind', '부하 역률 종류', 'lagging', [['lagging', '지상 (유도성 부하, Q>0)'], ['leading', '진상 (용량성 부하, Q<0)']], { showIf: mode('auto') }),
    choice('connection', '결선 (1차-2차)', 'Y-delta', BANKS, { showIf: mode('bank') }),
    num('n', '권수비 n=N2/N1 (상 기준)', '', 5, 1e-9, 1e9, { showIf: mode('bank') }),
    choice('known', '알고 있는 쪽', 'secondary', [['primary', '1차 선간전압'], ['secondary', '2차 선간전압']], { showIf: mode('bank') }),
    amp('lineVoltage', '알고 있는 쪽의 선간전압', 'V', 240, 1e-6, 1e12, { showIf: mode('bank') }), num('bankKva', '3상 용량 √3 VL IL', 'kVA', 42, 1e-9, 1e12, { showIf: mode('bank') })
  ],
  presets: [
    { label: '예제 13.7 2400/120 V · 9.6 kVA · N2=50', basis: 'rms', values: { mode: 'rating', v1: 2400, v2: 120, kva: 9.6, ratingTurns2: 50 },
      expect: [{ key: 'n', label: 'n=V2/V1', value: 0.05 }, { key: 'N1', label: 'N1', value: 1000, unit: '회' }, { key: 'I1', label: 'I1 (정격)', value: 4, unit: 'A' }, { key: 'I2', label: 'I2 (정격)', value: 80, unit: 'A' }] },
    { label: '예제 13.8 120∠0° V · 4−j6 Ω · 1:2 (점 반대) · 20 Ω', basis: 'rms', values: { mode: 'ideal', turns1: 1, turns2: 2, dots: 'opposite', i2Direction: 'out', voltage: 120, voltageDeg: 0, z1R: 4, z1X: -6, zlR: 20, zlX: 0 },
      expect: [{ key: 'ZinR', label: '반사 ZL/n²', value: 5, unit: 'Ω' }, { key: 'I1Mag', label: '|I1|', value: 11.09, unit: 'A' }, { key: 'I1Ang', label: '∠I1', value: 33.69, unit: '°' },
        { key: 'I2Mag', label: '|I2|', value: 5.545, unit: 'A' }, { key: 'I2Ang', label: '∠I2', value: -146.31, unit: '°', note: '교재: −5.545∠33.69° (같은 값)' }, { key: 'VoMag', label: '|Vo|', value: 110.9, unit: 'V' }, { key: 'VoAng',
          label: '∠Vo', value: -146.31, unit: '°', note: '교재: 110.9∠213.69°' },
        { key: 'S1Mag', label: '|S1|=|S2| (권선)', value: 615.38, unit: 'VA', note: '|I1|²·ZL/n² = 123·5, 위상 0 (순수 유효전력)' }, { key: 'S1Ang', label: '∠S1', value: 0, unit: '°', abs: 1e-9 },
        { key: 'SMag', label: '|S전원|', value: 1330.8, unit: 'VA' }, { key: 'SAng', label: '∠S전원', value: -33.69, unit: '°' }] },
    { label: '이상 변압기 점 같은 쪽 (+n, +1/n) · 같은 회로', basis: 'rms', values: { mode: 'ideal', turns1: 1, turns2: 2, dots: 'same', i2Direction: 'out', voltage: 120, voltageDeg: 0, z1R: 4, z1X: -6, zlR: 20, zlX: 0 },
      expect: [{ key: 'VoAng', label: '∠Vo (V2=+nV1)', value: 33.69, unit: '°' }, { key: 'VoMag', label: '|Vo|', value: 110.9, unit: 'V' }, { key: 'I2Ang', label: '∠I2 (+I1/n)', value: 33.69, unit: '°' }] },
    { label: '예제 13.10 단권 승압 240 V → 252 V · I2=4 A', basis: 'rms', values: { mode: 'auto', autoMode: 'up', autoN1: 100, autoN2: 5, autoV1: 240, autoI2: 4 },
      expect: [{ key: 'v2', label: 'V2', value: 252, unit: 'V' }, { key: 'i1', label: 'I1', value: 4.2, unit: 'A' }, { key: 'S', label: 'S=V2 I2', value: 1008, unit: 'VA' }, { key: 'twoWindingVA', label: '같은 권선을 2권선으로 쓸 때', value: 48,
        unit: 'VA' }, { key: 'gain', label: '정격 배수', value: 21 },
        { key: 'Sind', label: 'S_유도 (자기결합) = 12 V × 4 A', value: 48, unit: 'VA' }, { key: 'Scond', label: 'S_전도 = 1008 − 48', value: 960, unit: 'VA' }, { key: 'Icommon', label: '공통 권선 전류 |I1−I2|', value: 0.2, unit: 'A', note: '교재: 0.2 A 분기 (4.2 − 4)' },
        { key: 'fracInd', label: 'S_유도/S = 1 − V1/V2', value: 1 - 240 / 252 }] },
    { label: '단권 강압 N1=N2 (V2=V1/2)', basis: 'rms', values: { mode: 'auto', autoMode: 'down', autoN1: 100, autoN2: 100, autoV1: 240, autoI2: 10 },
      expect: [{ key: 'v2', label: 'V2=V1·N2/(N1+N2)', value: 120, unit: 'V' }, { key: 'i1', label: 'I1=I2·N2/(N1+N2)', value: 5, unit: 'A' },
        { key: 'Sind', label: 'S_유도 = (V1−V2)·I1', value: 600, unit: 'VA' }, { key: 'Scond', label: 'S_전도', value: 600, unit: 'VA' }, { key: 'Icommon', label: '공통 권선 전류 |I1−I2|', value: 5, unit: 'A' }, { key: 'fracInd', label: 'S_유도/S = 1 − V2/V1', value: 0.5 }] },
    // Power split with a load power factor (not a numbered textbook example): the 13.10 step-up with a 0.8 lagging load, S = 1008 VA.
    { label: '단권 승압 240→252 V · I2=4 A · 부하 pf 0.8 지상 (P·Q 분배)', basis: 'rms', values: { mode: 'auto', autoMode: 'up', autoN1: 100, autoN2: 5, autoV1: 240, autoI2: 4, autoPF: 0.8, autoPFKind: 'lagging' },
      expect: [{ key: 'Ptotal', label: 'P = S·pf = 1008·0.8', value: 806.4, unit: 'W' }, { key: 'Pind', label: 'P_유도 = 48·0.8', value: 38.4, unit: 'W' }, { key: 'Pcond', label: 'P_전도 = 960·0.8', value: 768, unit: 'W' },
        { key: 'Qtotal', label: 'Q = S·0.6 (지상, +)', value: 604.8, unit: 'var' }, { key: 'Qind', label: 'Q_유도 = 48·0.6', value: 28.8, unit: 'var' }, { key: 'Qcond', label: 'Q_전도 = 960·0.6', value: 576, unit: 'var' }] },
    { label: '예제 13.12 42 kVA · Y-Δ · 1:5 · 선간 240 V', basis: 'rms', values: { mode: 'bank', connection: 'Y-delta', n: 5, known: 'secondary', lineVoltage: 240, bankKva: 42 },
      expect: [{ key: 'is', label: 'ILs (2차 선전류)', value: 101, unit: 'A' }, { key: 'ip', label: 'ILp (1차 선전류)', value: 292, unit: 'A', rel: 2e-3, note: '교재는 (5·101)/√3 로 반올림 · 정확값 291.7' },
        { key: 'vp', label: 'VLp (1차 선간)', value: 83.14, unit: 'V' }, { key: 'perUnit', label: '변압기 1대', value: 14, unit: 'kVA' }] }
  ],
  evaluate(v, { k }) {
    if (v.mode === 'rating') {
      const r = idealRating({ v1: v.v1, v2: v.v2, kva: v.kva, turns2: v.ratingTurns2 });
      if (r.status !== 'valid') return r;
      return { status: 'valid', values: { n: r.n, N1: r.turns1, I1: r.i1 * k, I2: r.i2 * k },
        read: 'n=N2/N1=V2/V1=' + short(r.n) + ' (' + r.step + ') · N1=N2/n=' + short(r.turns1) + ' 회 · I1=S/V1=' + short(r.i1 * k) + ' A, I2=S/V2=' + short(r.i2 * k) + ' A (' + unit(k) + ') · S1=S2',
        metrics: [metric('권수비 n', short(r.n), r.step), metric('1차 권수 N1', short(r.turns1), '회'), metric('정격 I1 (' + unit(k) + ')', short(r.i1 * k), 'A'), metric('정격 I2 (' + unit(k) + ')', short(r.i2 * k), 'A')],
        notes: ['이상 변압기는 전력을 소비하지 않아 V1I1=V2I2=정격 kVA 입니다.'] };
    }
    if (v.mode === 'auto') {
      const r = autotransformer({ mode: v.autoMode, turns1: v.autoN1, turns2: v.autoN2, v1Rms: v.autoV1, loadCurrentRms: v.autoI2 });
      if (r.status !== 'valid') return r;
      const split = autotransformerSplit(r, v.autoPF, v.autoPFKind);
      if (split.status !== 'valid') return split;
      const { total, ind, cond } = split, share = part => (total.S === 0 ? '—' : fmt(100 * part.S / total.S) + ' %'), commonA = r.commonWindingCurrent * k, seriesA = r.seriesCurrent * k;
      const values = { v2: r.v2 * k, i1: r.i1 * k, S: r.apparentVA, twoWindingVA: r.twoWindingVA, gain: r.gain ?? 0, ratio: r.ratioV1V2, Sind: ind.S, Scond: cond.S, fracInd: r.inductiveFraction ?? 0,
        Icommon: commonA, Iseries: seriesA, Ptotal: total.P, Pind: ind.P, Pcond: cond.P, Qtotal: total.Q, Qind: ind.Q, Qcond: cond.Q };
      const lowSide = r.mode === 'up' ? 'V1/V2' : 'V2/V1';
      return { status: 'valid', values, checks: split.checks,
        read: 'V1/V2=' + short(r.ratioV1V2) + ' · V2=' + short(r.v2 * k) + ' V, I1=' + short(r.i1 * k) + ' A (' + unit(k) + ') · S=V2 I2=' + fmt(r.apparentVA) + ' VA = 전도 ' + fmt(cond.S) + ' + 유도(자기결합) ' + fmt(ind.S) + ' VA (유도 몫 '
          + (r.inductiveFraction === null ? '—' : fmt(100 * r.inductiveFraction) + ' %') + ') · 공통 권선 전류 ' + short(commonA) + ' A · 유도 몫이 곧 2권선으로 쓸 때의 용량 → 정격 ' + short(r.gain ?? 0) + ' 배',
        metrics: [metric('V1/V2', short(r.ratioV1V2)), metric('V2 (' + unit(k) + ')', short(r.v2 * k), 'V'), metric('I1 (' + unit(k) + ')', short(r.i1 * k), 'A'), metric('부하 S=V2 I2', fmt(r.apparentVA), 'VA'),
          metric('S_전도 (직접 연결)', fmt(cond.S), 'VA'), metric('S_유도 (자기결합, =2권선으로 쓸 때)', fmt(ind.S), 'VA'), metric('S_유도 / S', r.inductiveFraction === null ? '—' : fmt(100 * r.inductiveFraction), '%'),
          metric('공통 권선 전류 |I1−I2| (' + unit(k) + ')', short(commonA), 'A'), metric('정격 배수 S/S_유도', short(r.gain ?? 0), '배')],
        tables: [{ title: '전력 분배 (pf=' + short(v.autoPF) + ' ' + (v.autoPFKind === 'leading' ? '진상' : '지상') + ')', headers: ['구분', 'S (VA)', 'P (W)', 'Q (var)', 'S 비율'],
          rows: [['전도로 전달 (직접 연결)', fmt(cond.S), fmt(cond.P), fmt(cond.Q), share(cond)], ['유도로 전달 (자기결합)', fmt(ind.S), fmt(ind.P), fmt(ind.Q), share(ind)], ['합 = 부하', fmt(total.S), fmt(total.P), fmt(total.Q), share(total)]] }],
        notes: ['단권변압기는 1·2차가 전기적으로 연결되어 절연되지 않습니다.', '같은 권선을 2권선 변압기로 쓰면 직렬 권선 몫(|V1−V2| × 직렬 권선 전류 ' + fmt(r.seriesVoltage) + ' V × ' + short(seriesA) + ' A)만 변환하지만, 단권은 나머지를 전도로 전달해 용량이 큽니다.',
          '이상 단권변압기(V1I1=V2I2=S)에서 유도 몫은 S_유도/S = 1 − V작은쪽/V큰쪽 입니다 (승압 1 − V1/V2, 강압 1 − V2/V1; 지금 ' + lowSide + '). S_전도, S_유도, 부하는 모두 같은 위상이라 같은 역률을 가지며 P, Q 도 같은 비율로 나뉩니다.',
          '공통 권선(두 단자쌍이 함께 쓰는 권선)에는 I1과 I2의 차 |I1−I2| 가 흐릅니다.'],
        figure: { kind: 'auto', mode: v.autoMode, note: '공통 권선 |I1−I2| = ' + short(commonA) + ' A · 직렬 권선 ' + short(seriesA) + ' A' } };
    }
    if (v.mode === 'bank') {
      const r = threePhaseBank({ connection: v.connection, n: v.n, known: v.known, lineVoltage: v.lineVoltage, totalVA: v.bankKva * 1000 });
      if (r.status !== 'valid') return r;
      const sh = r.shiftDeg === 0 ? '선간전압 위상 이동 없음' : '2차 선간전압이 1차보다 ' + Math.abs(r.shiftDeg) + '° ' + (r.shiftDeg > 0 ? '앞섬' : '뒤짐');
      return { status: 'valid', values: { vp: r.vp * k, vs: r.vs * k, ip: r.ip * k, is: r.is * k, perUnit: r.perUnitVA / 1000, vRatio: r.vRatio, iRatio: r.iRatio },
        read: r.primary.replace('delta', 'Δ') + '-' + r.secondary.replace('delta', 'Δ') + ' · VLs/VLp=' + short(r.vRatio) + ' → VLp=' + short(r.vp * k) + ' V, ILp=' + short(r.ip * k) + ' A, VLs=' + short(r.vs * k) + ' V, ILs='
          + short(r.is * k) + ' A · 1대 ' + short(r.perUnitVA / 1000) + ' kVA (' + unit(k) + ')',
        metrics: [metric('VLp (1차 선간)', short(r.vp * k), 'V'), metric('ILp (1차 선)', short(r.ip * k), 'A'), metric('VLs (2차 선간)', short(r.vs * k), 'V'), metric('ILs (2차 선)', short(r.is * k), 'A'), metric('변압기 1대',
          short(r.perUnitVA / 1000), 'kVA'), metric('VLs/VLp', short(r.vRatio))],
        tables: [{ title: '권선(상) 값 (' + unit(k) + ')', headers: ['쪽', '결선', '권선 전압 (V)', '권선 전류 (A)'], rows: [['1차', r.primary === 'Y' ? 'Y' : 'Δ', fmt(r.primaryWinding.v * k), fmt(r.primaryWinding.i * k)], ['2차', r.secondary === 'Y'
          ? 'Y' : 'Δ', fmt(r.secondaryWinding.v * k), fmt(r.secondaryWinding.i * k)]] }],
        notes: [sh + '. 3상 변압기는 상전압 기준으로 판단하고, Y-Δ·Δ-Y 에서 √3과 30°가 생깁니다.'], figure: { kind: 'bank', primary: r.primary, secondary: r.secondary } };
    }
    const r = idealTransformer({ turns1: v.turns1, turns2: v.turns2, dots: v.dots, i2Direction: v.i2Direction, z1: z(v.z1R, v.z1X), zl: z(v.zlR, v.zlX), voltageRms: v.voltage, voltageDeg: v.voltageDeg });
    if (r.status !== 'valid') return r;
    const values = { n: r.n, ZinR: r.zin.re, ZinX: r.zin.im };
    putPolar(values, 'I1', r.I1, k); putPolar(values, 'I2', r.I2, k); putPolar(values, 'Vo', r.V2, k); putPolar(values, 'S', r.Ssource, 1); const S1 = clean(r.S1), S2 = clean(r.S2);
    putPolar(values, 'S1', S1, 1); putPolar(values, 'S2', S2, 1);
    const sgn = s => (s > 0 ? '+' : '−');
    return { status: 'valid', values, checks: r.checks,
      read: r.step + ' n=N2/N1=' + short(r.n) + ' · V2/V1=' + sgn(r.dotSign) + 'n, I2/I1=' + sgn(r.currentRatioSign) + '1/n · Zin=ZL/n²=' + zText(r.zin) + ' Ω · I1=' + polarShort(scale(r.I1, k)) + ' A, Vo=' + polarShort(scale(r.V2, k))
        + ' V (' + unit(k) + ')',
      metrics: [metric('권수비 n=N2/N1', short(r.n), r.step), metric('V2/V1', sgn(r.dotSign) + short(r.n)), metric('I2/I1', sgn(r.currentRatioSign) + '1/' + short(r.n)), metric('반사 Zin=ZL/n²', zText(r.zin), 'Ω'),
        metric('I1 (' + unit(k) + ')', polarShort(scale(r.I1, k)), 'A'), metric('I2 (' + unit(k) + ')', polarShort(scale(r.I2, k)), 'A'), metric('Vo=V2 (' + unit(k) + ')', polarShort(scale(r.V2, k)), 'V'),
        metric('권선 S1=S2 (S1=V1 I1*)', polarShort(S1), 'VA'), metric('전원 S (S=V I1*, Z1 포함)', polarShort(r.Ssource), 'VA')],
      phasors: [{ label: 'V 전원', unit: 'V', z: r.Vs }, { label: 'V1', unit: 'V', z: r.V1 }, { label: 'V2=Vo', unit: 'V', z: r.V2 }, { label: 'I1', unit: 'A', z: r.I1 }, { label: 'I2', unit: 'A', z: r.I2 }],
      notes: ['점 위치와 I2 기준 방향이 V2/V1, I2/I1 의 부호를 정합니다. 어느 경우에도 권선 전력 S1=S2 입니다 (전력 소비·저장 없음). 전원이 내는 S는 직렬 Z1이 쓰는 몫을 더한 값이라 S1과 다릅니다.'], figure: { kind: 'ideal', dots: v.dots, i2Direction: v.i2Direction, n: r.n } };
  }
};
