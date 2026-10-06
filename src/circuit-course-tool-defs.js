// Live tool definitions (Ch.9–12): complex calculator, extended three-phase, parallel loads, maximum power transfer. Pure, no DOM.
// Each tool = { id, title, lead, fields, presets, evaluate(values, { basis, k }) }. Values are internal RMS; results are shown in the display basis.
import { complexPower } from './circuit-course-model.js';
import { cz, scale, magnitude, conjugate, snap, sum } from './circuit-course-complex.js';
import { evaluateComplexExpression } from './circuit-course-complex-expr.js';
import { solveThreePhase, pfFromLineData } from './circuit-course-threephase.js';
import { combineLoads, LOAD_KINDS, MAX_LOADS } from './circuit-course-loads.js';
import { maxPowerTransfer } from './circuit-course-maxpower.js';
import { fmt, polarShort, short, zText } from './circuit-course-format.js';
import { num, amp, choice, textField, angleField, heading, putPolar, metric } from './circuit-course-tool-common.js';

const z = (re, im) => ({ re, im });
const polarZ = (m, deg) => ({ re: m * Math.cos(deg * Math.PI / 180), im: m * Math.sin(deg * Math.PI / 180) });
const natureText = S => (Math.abs(S.im) <= 1e-9 * Math.max(magnitude(S), 1e-300) ? '역률 1' : S.im > 0 ? '지상(lagging) · Q>0 유도성' : '진상(leading) · Q<0 용량성');
const pfText = S => { const m = magnitude(S); return m === 0 ? '미정' : short(Math.abs(S.re) / m) + (Math.abs(S.im) <= 1e-9 * m ? '' : S.im > 0 ? ' lagging' : ' leading'); };
const pqRow = (label, S) => [label, fmt(S.re), fmt(S.im), fmt(magnitude(S)), pfText(S)];
const triangleOf = (S, title) => ({ title, p: { pWatts: S.re, qVars: S.im, apparentVA: magnitude(S) } });
const capText = F => (F >= 1e-6 ? short(F * 1e6) + ' µF' : F >= 1e-9 ? short(F * 1e9) + ' nF' : short(F * 1e12) + ' pF');
const zField = (key, label, r, x, extra = {}) => [num(key + 'R', label + ' 저항 R', 'Ω', r, 0, 1e9, extra), num(key + 'X', label + ' 리액턴스 X', 'Ω', x, -1e9, 1e9, extra)];

// ---------------------------------------------------------------------------------------------------------------------------------
export const COMPLEX_TOOL = {
  id: 'complex', title: '8 · 복소수 계산기', tab: 'Ch.9',
  lead: '직교형 a+jb 와 극형 r∠θ°를 섞어 쓰는 식을 바로 계산합니다. 연산자 + − × ÷ ( ), 함수 sqrt conj abs re im, 각도는 도(°)입니다.',
  fields: [textField('expression', '계산할 식', 'sqrt(40∠50° + 20∠-30°)')],
  presets: [
    { label: '예제 9.3(a) √(40∠50°+20∠−30°)', values: { expression: 'sqrt(40∠50° + 20∠-30°)' },
      expect: [{ key: 'mag', label: '|결과|', value: 6.91 }, { key: 'ang', label: '∠결과', value: 12.81, unit: '°' }] },
    { label: '예제 9.3(b) [10∠−30°+(3−j4)] / [(2+j4)(3−j5)*]', values: { expression: '(10∠-30° + (3-j4)) / ((2+j4)*conj(3-j5))' },
      expect: [{ key: 'mag', label: '|결과|', value: 0.565 }, { key: 'ang', label: '∠결과', value: -160.13, unit: '°' }] },
    { label: '예제 9.9 Z = 5 + 1/(j4·0.1)', values: { expression: '5 + 1/(j*4*0.1)' }, expect: [{ key: 're', label: 'R', value: 5 }, { key: 'im', label: 'X', value: -2.5 }] }
  ],
  evaluate(v) {
    const r = evaluateComplexExpression(v.expression);
    if (r.status !== 'valid') return r;
    const values = { re: r.value.re, im: r.value.im, mag: r.polar.magnitude, ang: r.polar.angleDeg ?? 0 };
    return { status: 'valid', values, read: '결과 = ' + zText(r.value) + ' = ' + polarShort(r.value), metrics: [metric('직교형 a+jb', zText(r.value)), metric('극형 r∠θ', polarShort(r.value)), metric('크기 r', fmt(r.polar.magnitude)),
      metric('위상 θ', r.polar.angleDeg === null ? '미정' : fmt(r.polar.angleDeg), '°')],
      phasors: [{ label: '결과', unit: '(단위 없음)', z: r.value, raw: true }] };
  }
};

// ---------------------------------------------------------------------------------------------------------------------------------
const isCircuit = v => v.mode === 'circuit', isInverse = v => v.mode === 'inverse';
const unbalanced = v => isCircuit(v) && v.balanced === 'no';
const delta = v => v.loadConnection === 'delta';
export const THREE_PHASE_TOOL = {
  id: 'three-phase-ext', title: '9 · 3상 확장 (전원·선로·부하)', tab: 'Ch.12',
  lead: '전원 Y/Δ, 선로 임피던스, 부하 Y/Δ(불평형 가능), 중성선을 고르면 선전류·상전류·전력 분배가 바로 바뀝니다. 아래 "VL·IL·P → 역률"은 모터 같은 역문제입니다.',
  fields: [
    choice('mode', '풀이 종류', 'circuit', [['circuit', '회로 해석'], ['inverse', 'VL·IL·P → 역률 (역문제)']]),
    heading('hSource', '전원', { showIf: isCircuit }),
    choice('sequence', '상순서', 'abc', [['abc', 'abc (정상순)'], ['acb', 'acb (역상순)']], { showIf: isCircuit }),
    choice('reference', '기준 위상', 'Van', [['Van', 'Van (Y 전원 기준)'], ['Vab', 'Vab (Δ 전원 기준)']], { showIf: isCircuit }),
    angleField('referenceDeg', '기준 위상각', 0, { showIf: isCircuit }),
    choice('sourceConnection', '전원 결선', 'Y', [['Y', 'Y'], ['delta', 'Δ (등가 Y: Vp/√3 ∠−30°)']], { showIf: isCircuit }),
    choice('voltageKind', '입력한 전압', 'phase', [['phase', '상전압 Vp'], ['line', '선간전압 VL']], { showIf: v => isCircuit(v) && v.sourceConnection === 'Y' }),
    amp('voltage', '전원 전압 (Δ는 선간=코일)', 'V', 110, 1e-6, 1e9, { showIf: isCircuit }),
    heading('hLine', '선로 · 부하', { showIf: isCircuit }),
    ...zField('line', '선로 Zℓ', 0, 0, { showIf: isCircuit }),
    choice('loadConnection', '부하 결선', 'Y', [['Y', 'Y'], ['delta', 'Δ (ZΔ=3ZY)']], { showIf: isCircuit }),
    choice('neutral', '중성선 (Y 부하)', 'none', [['none', '없음 (3선식 · 메시)'], ['ideal', '이상 (Zn=0)'], ['impedance', 'Zn']], { showIf: v => isCircuit(v) && v.loadConnection === 'Y' }),
    ...zField('neutralZ', '중성선 Zn', 1, 0, { showIf: v => isCircuit(v) && v.loadConnection === 'Y' && v.neutral === 'impedance' }),
    choice('balanced', '부하', 'yes', [['yes', '평형 (세 상 같음)'], ['no', '불평형 (상마다 다름)']], { showIf: isCircuit }),
    ...zField('za', '부하 a (Y: AN · Δ: AB)', 10, 8, { showIf: isCircuit }),
    ...zField('zb', '부하 b (Y: BN · Δ: BC)', 10, 8, { showIf: unbalanced }),
    ...zField('zc', '부하 c (Y: CN · Δ: CA)', 10, 8, { showIf: unbalanced }),
    amp('invVL', '선간전압 VL', 'V', 220, 1e-6, 1e12, { showIf: isInverse }),
    amp('invIL', '선전류 IL', 'A', 18.2, 1e-9, 1e12, { showIf: isInverse }),
    num('invP', '유효전력 P', 'W', 5600, 1e-9, 1e15, { showIf: isInverse }),
    choice('invNature', '전류 위상', 'lagging', [['lagging', '지상 lagging (유도성)'], ['leading', '진상 leading (용량성)']], { showIf: isInverse })
  ],
  presets: [
    { label: '예제 12.2 Y-Y · 선로 5−j2 · 부하 10+j8', basis: 'rms', values: { voltage: 110, lineR: 5, lineX: -2, zaR: 10, zaX: 8 },
      expect: [{ key: 'IAMag', label: '|Ia|', value: 6.81, unit: 'A' }, { key: 'IAAng', label: '∠Ia', value: -21.8, unit: '°' }, { key: 'IBAng', label: '∠Ib', value: -141.8, unit: '°' }, { key: 'ICAng', label: '∠Ic', value: 98.2,
        unit: '°' }] },
    { label: '예제 12.3 Y 전원 100∠10° · Δ 부하 8+j4', basis: 'rms', values: { voltage: 100, referenceDeg: 10, loadConnection: 'delta', zaR: 8, zaX: 4 },
      expect: [{ key: 'IABMag', label: '|IAB|', value: 19.36, unit: 'A' }, { key: 'IABAng', label: '∠IAB', value: 13.43, unit: '°' }, { key: 'IAMag', label: '|Ia|', value: 33.53, unit: 'A' }, { key: 'IAAng', label: '∠Ia', value: -16.57,
        unit: '°' }] },
    { label: '예제 12.4 Δ 발전기 Vab=330∠0° · Δ 부하 20−j15', basis: 'rms', values: { sourceConnection: 'delta', reference: 'Vab', voltage: 330, loadConnection: 'delta', zaR: 20, zaX: -15 },
      expect: [{ key: 'IABMag', label: '|IAB|', value: 13.2, unit: 'A' }, { key: 'IABAng', label: '∠IAB', value: 36.87, unit: '°' }, { key: 'IBCAng', label: '∠IBC', value: -83.13, unit: '°' }, { key: 'ICAAng', label: '∠ICA',
        value: 156.87, unit: '°' },
        { key: 'IAMag', label: '|Ia|', value: 22.86, unit: 'A' }, { key: 'IAAng', label: '∠Ia', value: 6.87, unit: '°' }] },
    { label: '예제 12.5 Δ 전원 선간 210 V(Vab 기준) · Y 부하 40+j25', basis: 'rms', values: { sourceConnection: 'delta', reference: 'Vab', voltage: 210, zaR: 40, zaX: 25 },
      expect: [{ key: 'IAMag', label: '|Ia|', value: 2.57, unit: 'A' }, { key: 'IAAng', label: '∠Ia', value: -62.01, unit: '°' }, { key: 'IBAng', label: '∠Ib', value: 177.99, unit: '°' }, { key: 'ICAng', label: '∠Ic', value: 57.99,
        unit: '°' }] },
    { label: '예제 12.6 12.2 회로의 복소전력 분배', basis: 'rms', values: { voltage: 110, lineR: 5, lineX: -2, zaR: 10, zaX: 8 },
      expect: [{ key: 'SsrcRe', label: 'P 전원(공급)', value: 2087, unit: 'W', note: '교재는 Ip=6.81로 반올림해 계산' }, { key: 'SsrcIm', label: 'Q 전원(공급)', value: 834.6, unit: 'var' },
        { key: 'SloadRe', label: 'P 부하', value: 1392, unit: 'W', note: '정확한 값은 약 1390.8 (교재 반올림 차이 0.09%)' }, { key: 'SloadIm', label: 'Q 부하', value: 1113, unit: 'var', note: '정확한 값은 약 1112.6' },
        { key: 'SlineRe', label: 'P 선로', value: 695.6, unit: 'W' }, { key: 'SlineIm', label: 'Q 선로', value: -278.3, unit: 'var' }] },
    { label: '예제 12.7 3상 모터 VL=220 V, IL=18.2 A, P=5.6 kW → pf', basis: 'rms', values: { mode: 'inverse', invVL: 220, invIL: 18.2, invP: 5600 },
      expect: [{ key: 'S', label: '|S|=√3 VL IL', value: 6935.13, unit: 'VA' }, { key: 'pf', label: 'pf', value: 0.8075 }] },
    { label: '연습 12.9 4선 Y-Y · 선로 1+j2 · 부하 19+j13', basis: 'rms', values: { voltage: 120, lineR: 1, lineX: 2, neutral: 'ideal', zaR: 19, zaX: 13 },
      expect: [{ key: 'IAMag', label: '|Ia|', value: 4.8, unit: 'A' }, { key: 'IAAng', label: '∠Ia', value: -36.87, unit: '°' }, { key: 'INMag', label: '|In|', value: 0, unit: 'A', abs: 1e-6 }] },
    { label: '연습 12.14 Y 전원 100 V · 선로 1+j2 · Δ 부하 12+j12', basis: 'rms', values: { voltage: 100, lineR: 1, lineX: 2, loadConnection: 'delta', zaR: 12, zaX: 12 },
      expect: [{ key: 'IAMag', label: '|Ia|', value: 12.8, unit: 'A' }, { key: 'IAAng', label: '∠Ia', value: -50.19, unit: '°' }] },
    { label: '불평형 4선식 (120 V Y 전원, 부하 j5·10·−j10 Ω) · In=−(Ia+Ib+Ic)', basis: 'rms', values: { voltage: 120, neutral: 'ideal', balanced: 'no', zaR: 0, zaX: 5, zbR: 10, zbX: 0, zcR: 0, zcX: -10 },
      expect: [{ key: 'IAMag', label: '|Ia|=120/5', value: 24, unit: 'A' }, { key: 'IBMag', label: '|Ib|=120/10', value: 12, unit: 'A' }, { key: 'ICMag', label: '|Ic|=120/10', value: 12, unit: 'A' },
        { key: 'INMag', label: '|In|=|24∠−90°+12∠−120°+12∠210°|', value: 43.5918, unit: 'A', note: '교재는 풀이 없이 회로만 제시 · 닫힌 꼴 검산' }] },
    { label: '불평형 3선식 (같은 부하, 중성선 없음)', basis: 'rms', values: { voltage: 120, neutral: 'none', balanced: 'no', zaR: 0, zaX: 5, zbR: 10, zbX: 0, zcR: 0, zcX: -10 },
      expect: [{ key: 'INMag', label: '|Ia+Ib+Ic| (KCL)', value: 0, unit: 'A', abs: 1e-6 }] }
  ],
  evaluate(v, { k }) {
    if (isInverse(v)) {
      const r = pfFromLineData({ lineVoltageRms: v.invVL, lineCurrentRms: v.invIL, pWatts: v.invP, nature: v.invNature });
      if (r.status !== 'valid') return r;
      const S = z(r.pWatts, r.qVars);
      return { status: 'valid', values: { S: r.apparentVA, pf: r.pf, thetaDeg: r.thetaDeg, Q: r.qVars },
        read: 'S=√3·VL·IL=' + fmt(r.apparentVA) + ' VA → pf=P/S=' + short(r.pf) + ' (' + (r.nature === 'lagging' ? 'lagging' : 'leading') + '), θ=' + short(r.thetaDeg) + '°',
        metrics: [metric('|S| = √3 VL IL', fmt(r.apparentVA), 'VA'), metric('pf = P/|S|', short(r.pf) + (r.nature === 'lagging' ? ' lagging' : ' leading')), metric('θ (역률각 = 부하 Z 각)', short(r.thetaDeg), '°'), metric('Q', fmt(r.qVars),
          'var')],
        triangles: [triangleOf(S, '3상 전력삼각형')], phasors: [] };
    }
    const bal = v.balanced === 'yes', za = z(v.zaR, v.zaX), zb = bal ? za : z(v.zbR, v.zbX), zc = bal ? za : z(v.zcR, v.zcX);
    const r = solveThreePhase({ sequence: v.sequence, reference: v.reference, referenceDeg: v.referenceDeg, sourceConnection: v.sourceConnection, voltageKind: v.voltageKind,
      voltageRms: v.voltage, lineZ: z(v.lineR, v.lineX), loads: [za, zb, zc], loadConnection: v.loadConnection, neutral: v.neutral, neutralZ: z(v.neutralZR, v.neutralZX) });
    if (r.status !== 'valid') return r;
    const d = delta(v), iMax = Math.max(...r.lineCurrents.map(magnitude));
    const IN = snap(r.neutralCurrent, iMax);
    const values = {}, phaseNames = d ? ['AB', 'BC', 'CA'] : ['AN', 'BN', 'CN'];
    ['A', 'B', 'C'].forEach((n, i) => putPolar(values, 'I' + n, r.lineCurrents[i], k));
    putPolar(values, 'IN', IN, k);
    if (d) ['AB', 'BC', 'CA'].forEach((n, i) => putPolar(values, 'I' + n, r.loadCurrents[i], k));
    for (const [key, S] of [['Ssrc', r.power.source], ['Sline', r.power.line], ['Sload', r.power.load]]) { values[key + 'Re'] = S.re; values[key + 'Im'] = S.im; }
    const angleOf = w => (magnitude(w) === 0 ? '—' : short(Math.atan2(w.im, w.re) * 180 / Math.PI) + '°');
    const polarK = w => (magnitude(w) === 0 ? '0' : short(magnitude(w) * k) + '∠' + angleOf(w));
    const rows = [...['a', 'b', 'c'].map((n, i) => ['I' + n + ' (선전류)', polarK(r.lineCurrents[i])])];
    if (d) rows.push(...['AB', 'BC', 'CA'].map((n, i) => ['I' + n + ' (Δ 상전류)', polarK(r.loadCurrents[i])]));
    rows.push(['In = −(Ia+Ib+Ic)', polarK(IN)]);
    if (r.neutral !== 'ideal' && !d) rows.push(['중성점 전위 VnN', polarK(snap(r.neutralShift, magnitude(r.sourceVoltages[0])))]);
    const loadV = r.loadVoltages.map((w, i) => ['V' + phaseNames[i] + ' (부하 상전압)', polarK(w)]);
    const phasors = [...r.sourceVoltages.map((w, i) => ({ label: ['Van', 'Vbn', 'Vcn'][i], unit: 'V', z: w })), ...r.loadVoltages.map((w, i) => ({ label: 'V' + phaseNames[i], unit: 'V', z: w })),
      ...r.lineCurrents.map((w, i) => ({ label: ['Ia', 'Ib', 'Ic'][i], unit: 'A', z: w })), ...(d ? r.loadCurrents.map((w, i) => ({ label: 'I' + phaseNames[i], unit: 'A', z: w })) : []),
      ...(magnitude(IN) > 0 ? [{ label: 'In', unit: 'A', z: IN }] : [])];
    const powerRows = [pqRow('전원 (공급)', r.power.source), pqRow('선로 Zℓ', r.power.line), pqRow('부하', r.power.load)];
    if (r.neutral === 'impedance') powerRows.push(pqRow('중성선 Zn', r.power.neutral));
    const note = r.balanced ? '평형: In=0 이라 단상 등가(a상)만 풀면 b, c는 ∓120° 이동입니다.' : r.neutral === 'none' ? '불평형 3선식: Ia+Ib+Ic=0 (메시 해석과 대조 완료).' : '불평형: 중성선 전류 In=−(Ia+Ib+Ic)≠0 입니다.';
    return { status: 'valid', values, balanced: r.balanced, checks: r.checks, phasors, triangles: [triangleOf(r.power.load, '부하 복소전력 S=P+jQ')],
      read: 'Ia=' + polarK(r.lineCurrents[0]) + ' A, Ib=' + polarK(r.lineCurrents[1]) + ' A, Ic=' + polarK(r.lineCurrents[2]) + ' A · In=' + polarK(IN) + ' A · ' + note,
      metrics: [metric('|Ia|', short(magnitude(r.lineCurrents[0]) * k), 'A'), metric('부하 P', fmt(r.power.load.re), 'W'), metric('부하 Q', fmt(r.power.load.im), 'var'), metric('부하 pf', pfText(r.power.load))],
      tables: [{ title: '전류 · 전압 (' + (k > 1 ? 'peak' : 'rms') + ')', headers: ['양', '크기∠위상 (A 또는 V)'], rows: [...rows, ...loadV] },
        { title: '복소전력 분배 (S전원 = S선로 + S부하' + (r.neutral === 'impedance' ? ' + S중성선' : '') + ')', headers: ['구분', 'P (W)', 'Q (var)', '|S| (VA)', 'pf'], rows: powerRows }],
      notes: [note, natureText(r.power.load) + ' (부하 기준)'], figure: { kind: 'three-phase', source: v.sourceConnection, load: v.loadConnection, neutral: r.neutral, hasLine: v.lineR !== 0 || v.lineX !== 0 } };
  }
};

// ---------------------------------------------------------------------------------------------------------------------------------
const loadFields = [];
for (let i = 1; i <= MAX_LOADS; i++) {
  const on = v => Number(v.count) >= i;
  loadFields.push(heading('hLoad' + i, '부하 ' + i, { showIf: on }),
    choice('l' + i + 'Kind', '입력 방식', 'kw-pf', [['kw-pf', 'P[kW] + pf'], ['kva-pf', 'S[kVA] + pf'], ['kvar-pf', 'Q[kvar] + pf'], ['kw-kvar', 'P[kW] + Q[kvar]']], { showIf: on }),
    num('l' + i + 'A', '값 1', '', 10, 0, 1e9, { showIf: on, label: v => '값 1 (' + LOAD_KINDS[v['l' + i + 'Kind']].a + ')', unit: v => LOAD_KINDS[v['l' + i + 'Kind']].a, name: '부하 ' + i + ' 값 1' }),
    num('l' + i + 'B', '값 2', '', 0.8, 0, 1e9, { showIf: on, label: v => '값 2 (' + (LOAD_KINDS[v['l' + i + 'Kind']].b === 'pf' ? '역률 pf' : 'kvar') + ')', unit: v => LOAD_KINDS[v['l' + i + 'Kind']].b === 'pf' ? '' : 'kvar', name: '부하 '
      + i + ' 값 2' }),
    choice('l' + i + 'Nature', '전류 위상', 'lagging', [['lagging', '지상 lagging (유도성, Q>0)'], ['leading', '진상 leading (용량성, Q<0)']], { showIf: on }));
}
const loadSet = (list, extra) => { const o = { ...extra, count: String(list.length) }; list.forEach((l, i) => { o['l' + (i + 1) + 'Kind'] = l[0]; o['l' + (i + 1) + 'A'] = l[1]; o['l' + (i + 1) + 'B'] = l[2]; o['l' + (i + 1)
  + 'Nature'] = l[3] ?? 'lagging'; }); return o; };
export const LOADS_TOOL = {
  id: 'loads', title: '10 · 병렬 부하 합성', tab: 'Ch.11·12',
  lead: '여러 부하를 병렬로 걸면 복소전력은 그대로 더해집니다 (S=ΣSk). P끼리, Q끼리 더하고 |S|는 더하지 않습니다. 역률 보상 커패시터도 구합니다.',
  fields: [
    choice('phases', '계통', '1', [['1', '단상'], ['3', '균형 3상 (Y 결선 선전류)']]),
    amp('voltage', '전압 (단상: 단자 / 3상: 선간)', 'V', 120, 1e-6, 1e12, { name: '전압' }),
    angleField('voltageDeg', '기준 전압 위상 (단상 V, 3상 Van)', 0),
    num('frequencyHz', '주파수 f', 'Hz', 60, 1e-3, 1e6),
    choice('count', '부하 개수', '2', Array.from({ length: MAX_LOADS }, (_, i) => [String(i + 1), String(i + 1) + '개'])),
    ...loadFields,
    choice('compensate', '역률 보상', 'no', [['no', '보상 안 함'], ['yes', '목표 역률까지 병렬 C']]),
    num('targetPF', '목표 역률 (지상)', '', 0.9, 0.001, 1, { showIf: v => v.compensate === 'yes' }),
    choice('bank', 'C 뱅크 결선 (3상)', 'delta', [['delta', 'Δ · 각 C에 선간전압'], ['Y', 'Y · 각 C에 VL/√3']], { showIf: v => v.compensate === 'yes' && v.phases === '3' })
  ],
  presets: [
    { label: '예제 12.8 3상 240 kV · 30 kW 0.6 lag + 45 kvar 0.8 lag → 0.9', basis: 'rms',
      values: loadSet([['kw-pf', 30, 0.6], ['kvar-pf', 45, 0.8]], { phases: '3', voltage: 240e3, frequencyHz: 60, compensate: 'yes', targetPF: 0.9, bank: 'delta' }),
      expect: [{ key: 'P', label: 'ΣP', value: 90, unit: 'kW' }, { key: 'Q', label: 'ΣQ', value: 85, unit: 'kvar' }, { key: 'S', label: '|S|', value: 123.8, unit: 'kVA', rel: 2e-3 },
        { key: 'I', label: '선전류 합', value: 0.2978, unit: 'A' }, { key: 'Qc', label: 'Qc (3개 합)', value: 41.4, unit: 'kvar' }, { key: 'QcEach', label: '각 C의 kvar', value: 13.8, unit: 'kvar' }, { key: 'C', label: '각 C', value: 635.5e-12,
          unit: 'F' }] },
    { label: '연습 11.52 A 2 kW 0.8 lag · B 3 kVA 0.4 lead · C 1 kW+0.5 kvar (병렬로 가정)', basis: 'rms',
      values: loadSet([['kw-pf', 2, 0.8], ['kva-pf', 3, 0.4, 'leading'], ['kw-kvar', 1, 0.5]], { phases: '1', voltage: 120, voltageDeg: 45, frequencyHz: 60 }),
      expect: [{ key: 'P', label: 'ΣP', value: 4.2, unit: 'kW' }, { key: 'Q', label: 'ΣQ', value: -0.7496, unit: 'kvar', note: '1.5 − 2.7495 + 0.5 (그림의 결선은 슬라이드 미표기: 병렬 가정)' },
        { key: 'pf', label: '총 pf (leading)', value: 0.9845, rel: 2e-3 }, { key: 'I', label: '선전류', value: 35.55, unit: 'A', rel: 2e-3 }, { key: 'IAng', label: '∠I (V=120∠45°)', value: 55.1, unit: '°', rel: 2e-3 }] },
    { label: '연습 11.73 240 V · 10 kW + 15 kvar 용량성 + 22 kvar 유도성 → 0.96', basis: 'rms',
      values: loadSet([['kw-pf', 10, 1], ['kw-kvar', 0, 15, 'leading'], ['kw-kvar', 0, 22]], { phases: '1', voltage: 240, frequencyHz: 60, compensate: 'yes', targetPF: 0.96 }),
      expect: [{ key: 'Q', label: 'ΣQ', value: 7, unit: 'kvar' }, { key: 'S', label: '|S|', value: 12.21, unit: 'kVA', rel: 2e-3 }, { key: 'I', label: '전류', value: 50.9, unit: 'A', rel: 2e-3 }, { key: 'pf', label: 'pf (lagging)',
        value: 0.819, rel: 2e-3 },
        { key: 'Qc', label: 'Qc', value: 4.083, unit: 'kvar', rel: 2e-3 }, { key: 'C', label: 'C', value: 188e-6, unit: 'F', rel: 5e-3 }, { key: 'IAfter', label: '보상 후 전류', value: 43.4, unit: 'A', rel: 2e-3 }] },
    { label: '연습 11.74 120 V · 24 kW 0.8 lag ∥ 40 kW 0.95 lag → pf=1', basis: 'rms',
      values: loadSet([['kw-pf', 24, 0.8], ['kw-pf', 40, 0.95]], { phases: '1', voltage: 120, frequencyHz: 60, compensate: 'yes', targetPF: 1 }),
      expect: [{ key: 'P', label: 'ΣP', value: 64, unit: 'kW' }, { key: 'pf', label: '합성 pf (lagging)', value: 0.899, rel: 2e-3 }, { key: 'C', label: 'pf=1 C', value: 5.74e-3, unit: 'F', rel: 5e-3 }] }
  ],
  evaluate(v, { k }) {
    const phases = Number(v.phases), n = Number(v.count);
    const loads = Array.from({ length: n }, (_, i) => ({ kind: v['l' + (i + 1) + 'Kind'], a: v['l' + (i + 1) + 'A'], b: v['l' + (i + 1) + 'B'], nature: v['l' + (i + 1) + 'Nature'] }));
    const r = combineLoads({ loads, phases, voltageRms: v.voltage, frequencyHz: v.frequencyHz, compensate: v.compensate === 'yes', targetPF: v.targetPF, connection: v.bank });
    if (r.status !== 'valid') return r;
    const S = z(r.P, r.Q), Iang = v.voltageDeg + r.lineCurrentDeg;
    const values = { P: r.P / 1e3, Q: r.Q / 1e3, S: r.S / 1e3, pf: r.pf, I: r.lineCurrentRms * k, IAng: Iang };
    const c = r.compensation;
    if (c) Object.assign(values, { Qc: c.qcVars / 1e3, QcEach: c.qcPerCapacitor / 1e3, C: c.capacitanceF, IAfter: c.sourceCurrentAfterRms * k, pfAfter: c.after.pf });
    const rows = r.parts.map((l, i) => [String(i + 1), fmt(l.P / 1e3), fmt(l.Q / 1e3), fmt(l.S / 1e3), l.nature === 'lagging' ? 'lagging' : l.nature === 'leading' ? 'leading' : '역률 1']);
    rows.push(['합 ΣS', fmt(r.P / 1e3), fmt(r.Q / 1e3), fmt(r.S / 1e3), pfText(S)]);
    const metrics = [metric('ΣP', fmt(r.P / 1e3), 'kW'), metric('ΣQ', fmt(r.Q / 1e3), 'kvar'), metric('|S|', fmt(r.S / 1e3), 'kVA'), metric('총 pf', pfText(S)),
      metric(phases === 3 ? '선전류 IL' : '전류 I', short(r.lineCurrentRms * k), 'A')];
    const triangles = [triangleOf(S, '합성 전력삼각형 (보상 전)')];
    if (c) {
      metrics.push(metric('Qc (보상 용량)', fmt(c.qcVars / 1e3), 'kvar'), metric(phases === 3 ? '각 C (3개)' : 'C', capText(c.capacitanceF)), metric('보상 후 pf', short(c.after.pf) + (c.after.nature === 'leading' ? ' leading' : ' lagging')),
        metric('보상 후 전류', short(c.sourceCurrentAfterRms * k), 'A'));
      triangles.push(triangleOf(z(r.P, c.qAfterVars), '보상 후 (Q−Qc)'));
    }
    const notes = ['Σ|Sk|=' + fmt(r.sumOfApparent / 1e3) + ' kVA ≠ |S|=' + fmt(r.S / 1e3) + ' kVA : 피상전력은 그대로 더할 수 없습니다. ' + natureText(S)];
    if (c) notes.push(...(c.warnings ?? []), 'Qc = P(tanθ_old − tanθ_new), C = Qc/(ωV²)' + (phases === 3 ? ' · 3개로 나누면 각 C=(Qc/3)/(ωV²) (Δ는 V=VL)' : '') + '.');
    return { status: 'valid', values, metrics, triangles, notes, read: 'ΣP=' + fmt(r.P / 1e3) + ' kW, ΣQ=' + fmt(r.Q / 1e3) + ' kvar → pf=' + pfText(S) + ', I=' + short(r.lineCurrentRms * k) + ' A' + (c ? ' · C='
      + capText(c.capacitanceF) : ''),
      tables: [{ title: '부하별 · 합성 (kW, kvar, kVA)', headers: ['부하', 'P (kW)', 'Q (kvar)', '|S| (kVA)', 'pf'], rows }],
      phasors: [{ label: phases === 3 ? 'Van' : 'V', unit: 'V', z: polarZ(phases === 3 ? v.voltage / Math.sqrt(3) : v.voltage, v.voltageDeg) },
        { label: 'I', unit: 'A', z: polarZ(r.lineCurrentRms, Iang) }] };
  }
};

// ---------------------------------------------------------------------------------------------------------------------------------
const divider = v => v.source === 'divider';
export const MAXPOWER_TOOL = {
  id: 'max-power', title: '11 · 최대전력전달 · AC 테브냉', tab: 'Ch.11',
  lead: '테브냉 등가 VTh, ZTh에 부하 ZL을 달면 ZL=ZTh* (켤레 정합)일 때 평균전력이 최대입니다. R과 X를 직접 끌어 보며 곡선 위의 점을 확인하세요.',
  fields: [
    choice('source', '등가 입력', 'direct', [['direct', 'VTh, ZTh 직접'], ['divider', '예제 11.5 회로: Vs–Zs–(Zp 접지)–Zo → 단자']]),
    amp('vth', 'VTh (divider: 소스 Vs)', 'V', 7.454 / Math.SQRT2, 1e-9, 1e9, { name: 'VTh' }),
    angleField('vthDeg', 'VTh 위상', 0),
    ...zField('zth', '내부 ZTh', 3, 4, { showIf: v => !divider(v) }),
    ...zField('zs', '직렬 Zs', 4, 0, { showIf: divider }), ...zField('zp', '접지 가지 Zp', 8, -6, { showIf: divider }), ...zField('zo', '단자 직렬 Zo', 0, 5, { showIf: divider }),
    choice('loadMode', '부하 ZL', 'conjugate', [['conjugate', 'ZL = ZTh* (최대전력)'], ['manual', '직접 (R, X 슬라이더)']]),
    num('zlR', '부하 저항 RL', 'Ω', 3, 0, 1e9, { slider: { min: 0, max: 20, step: 0.05 }, showIf: v => v.loadMode === 'manual' }),
    num('zlX', '부하 리액턴스 XL', 'Ω', -4, -1e9, 1e9, { slider: { min: -20, max: 20, step: 0.05 }, showIf: v => v.loadMode === 'manual' })
  ],
  presets: [
    { label: '예제 11.5 10∠0° V · 4 Ω · j5 · (8−j6) 접지', basis: 'peak', values: { source: 'divider', vth: 10, vthDeg: 0, zsR: 4, zsX: 0, zpR: 8, zpX: -6, zoR: 0, zoX: 5, loadMode: 'conjugate' },
      expect: [{ key: 'ZthR', label: 'RTh', value: 2.933, unit: 'Ω' }, { key: 'ZthX', label: 'XTh', value: 4.467, unit: 'Ω' }, { key: 'VthMag', label: '|VTh|', value: 7.454, unit: 'V' }, { key: 'VthAng', label: '∠VTh', value: -10.3,
        unit: '°' },
        { key: 'ZlR', label: 'RL', value: 2.933, unit: 'Ω' }, { key: 'ZlX', label: 'XL', value: -4.467, unit: 'Ω' }, { key: 'Pmax', label: 'Pmax = |VTh|²/(8RTh)', value: 2.368, unit: 'W' }] },
    { label: 'RL만 맞춘 경우 (XL=0)', basis: 'peak', values: { source: 'direct', vth: 10, vthDeg: 0, zthR: 3, zthX: 4, loadMode: 'manual', zlR: 5, zlX: 0 },
      expect: [{ key: 'Pmax', label: 'Pmax = 100/(8·3)', value: 100 / 24, unit: 'W' }, { key: 'Pnow', label: 'P(RL=5, XL=0)', value: 0.5 * 100 * 5 / ((3 + 5) ** 2 + 16), unit: 'W', note: 'P=½|VTh|²RL/((RTh+RL)²+(XTh+XL)²)' }] }
  ],
  evaluate(v, { k }) {
    const r = maxPowerTransfer({ source: v.source, vthRms: v.vth, vthDeg: v.vthDeg, zth: z(v.zthR, v.zthX), zs: z(v.zsR, v.zsX), zp: z(v.zpR, v.zpX), zo: z(v.zoR, v.zoX),
      zl: v.loadMode === 'manual' ? z(v.zlR, v.zlX) : null });
    if (r.status !== 'valid') return r;
    const pLoad = r.pNow, vm = magnitude(r.vth) * k;
    const values = { ZthR: r.zth.re, ZthX: r.zth.im, ZlR: r.zl.re, ZlX: r.zl.im, Pmax: r.pmaxClosed, Pnow: pLoad, eta: r.efficiency };
    putPolar(values, 'Vth', r.vth, k);
    return { status: 'valid', values, checks: r.checks.map(c => ({ ...c, tolerance: c.tol })),
      read: 'ZTh=' + zText(r.zth) + ' Ω → ZL=ZTh*=' + zText(r.optimum) + ' Ω, Pmax=|VTh|²/(' + (k > 1 ? '8' : '4') + 'RTh)=' + fmt(r.pmaxClosed) + ' W · 지금 ZL의 P=' + fmt(pLoad) + ' W (' + fmt((r.fraction ?? 0) * 100) + ' %)',
      metrics: [metric('VTh (' + (k > 1 ? 'peak' : 'rms') + ')', short(vm) + '∠' + short(Math.atan2(r.vth.im, r.vth.re) * 180 / Math.PI) + '°', 'V'), metric('ZTh', zText(r.zth), 'Ω'), metric('ZL = ZTh*', zText(r.optimum), 'Ω'),
        metric('Pmax', fmt(r.pmaxClosed), 'W'),
        metric('지금 ZL', zText(r.zl), 'Ω'), metric('지금 P', fmt(pLoad), 'W'), metric('P / Pmax', fmt((r.fraction ?? 0) * 100), '%'), metric('효율 RL/(RTh+RL)', fmt(r.efficiency * 100), '%')],
      notes: ['최대전력 전달은 최대 효율이 아닙니다: 정합일 때 효율은 RL/(RTh+RL)=' + fmt(r.efficiency * 100) + ' %.', ...(r.derived ? ['VTh=Vs·Zp/(Zs+Zp), ZTh=Zo+Zs∥Zp'] : [])],
      curves: [{ title: 'P(RL) · XL=' + fmt(r.zl.im) + ' Ω 고정', xLabel: 'RL (Ω)', yLabel: 'P (W)', points: r.curveR, mark: [r.zl.re, pLoad], best: [r.optimum.re, r.pBest] },
        { title: 'P(XL) · RL=' + fmt(r.zl.re) + ' Ω 고정', xLabel: 'XL (Ω)', yLabel: 'P (W)', points: r.curveX, mark: [r.zl.im, pLoad], best: [r.optimum.im, r.pBest] }],
      phasors: [{ label: 'VTh', unit: 'V', z: r.vth }, { label: 'I (지금 ZL)', unit: 'A', z: r.iNow }] };
  }
};
