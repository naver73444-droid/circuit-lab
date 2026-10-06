import { verifyExpectations } from './circuit-course-tool-common.js';
import { polar, rmsPhasor, rectangularPolar, phaseDifference, magnitude, complexPower, impedanceNetwork, balancedThreePhase, correction, sampledPowerCheck, waveSample } from './circuit-course-model.js';
import { symbolicCourseExperiment, solveSymbolicProblem, courseSymbolicData } from './circuit-course-problem-symbolic.js';
import { PROBLEM_EXPERIMENT } from './circuit-course-problem.js';
export const REFERENCES = [
  { title: 'MIT Kirtley · Ch.2 AC Power Flow (pp.5–6, 12–15)', url: 'https://ocw.mit.edu/courses/6-061-introduction-to-electric-power-systems-spring-2011/9cf8de165233601f547b284cee5c2131_MIT6_061S11_ch2.pdf' },
  { title: 'MIT Kirtley · Ch.3 Polyphase Networks (pp.3–8)', url: 'https://ocw.mit.edu/courses/6-061-introduction-to-electric-power-systems-spring-2011/c6393a58319200a5344752de0cf47ec4_MIT6_061S11_ch3.pdf' }
];
const num = (key, label, unit, initial, min, max, displayScale = 1, extra = {}) => ({ key, label, unit, initial, min, max, displayScale, ...extra });
// Amplitude fields are typed in the course-wide display basis (peak or RMS); the experiments convert them to RMS themselves.
const amp = (key, label, unit, initial, min, max) => num(key, label, unit, initial, min, max, 1, { amplitude: true });
const rmsFactor = p => (p.basis === 'peak' ? Math.SQRT1_2 : 1);
const PEAK = Math.SQRT2, DEG = 180 / Math.PI;
const angleOf = z => Math.atan2(z.im, z.re) * DEG;
// Lecture expectation: get(result) is the number the textbook prints (peak examples multiply by PEAK).
const E = (label, value, get, unit = '', extra = {}) => ({ label, value, get, unit, ...extra });
const select = (key, label, initial, choices) => ({ key, label, initial, choices });
const f = () => num('frequencyHz', '주파수 f', 'Hz', 50, .01, 1e6);
const basis = () => select('basis', '진폭 기준 (머리글의 표시 기준과 같음)', 'rms', [['rms', 'RMS 실효값'], ['peak', 'peak 최댓값']]);
const frequency = p => p.frequencyHz;
const common = ['정현파 정상상태, 공통 주파수, 이상 선형 소자.', 'e^{jωt}와 코사인 기준. 내부 페이저는 항상 RMS, 화면에는 머리글의 peak/RMS 기준으로 표시합니다.', '전류는 부하의 + 전압 단자로 들어갑니다 (수동부호).'];
const trace = (label, unit, phasor) => ({ label, unit, phasor });
const vt = V => trace('v(t)', 'V', V), it = I => trace('i(t)', 'A', I);
function powerOutput(V, I, frequencyHz) {
  const power = complexPower(V, I);
  return { status: 'valid', V, I, power, frequencyHz, phasors: [{ label: 'V', unit: 'V', z: V }, { label: 'I', unit: 'A', z: I }],
    traces: [vt(V), it(I), { label: 'p(t)=v(t)i(t)', unit: 'W', sample: t => waveSample(V, frequencyHz, t) * waveSample(I, frequencyHz, t) }],
    checks: [sampledPowerCheck(V, I, frequencyHz, power.pWatts)] };
}
export const EXPERIMENTS = [
  {
    id: 'phasor-wave', title: '1 · 복소수 → 페이저 → 파형',
    description: '직교형/극형을 바꾸고 위상각이 시간파형을 어떻게 옮기는지 봅니다.',
    parameters: [f(), basis(), select('coordinate', '복소수 표현', 'rect', [['rect', '직교형 a+jb'], ['polar', '극형 |V|∠θ']]),
      { ...amp('re', '실수부 a', 'V', 100, -1e6, 1e6), showIf: p => p.coordinate === 'rect' },
      { ...amp('im', '허수부 b', 'V', 0, -1e6, 1e6), showIf: p => p.coordinate === 'rect' },
      { ...amp('amplitude', '크기 |V|', 'V', 100, 0, 1e6), showIf: p => p.coordinate === 'polar' },
      { ...num('angleDeg', '위상 θ', '°', 30, -36000, 36000), showIf: p => p.coordinate === 'polar' }],
    assumptions: [...common, '0벡터(크기 0)의 위상은 미정입니다.'], formulas: ['V=a+jb=|V|∠θ, θ=atan2(b,a)', 'ω=2πf (rad/s), T=1/f (s)', 'v(t)=√2 |V_RMS| cos(ωt+θ)', '|V_peak|=√2 |V_RMS|'],
    examples: [{ label: '100+j100 V RMS', values: { coordinate: 'rect', basis: 'rms', re: 100, im: 100 } }, { label: '141.421 V peak = 100 V RMS', values: { coordinate: 'polar', basis: 'peak', amplitude: 100 * Math.SQRT2,
      angleDeg: 0 } },
      { label: '예제 9.1 v=12cos(50t+10°) V', values: { coordinate: 'polar', basis: 'peak', amplitude: 12, angleDeg: 10, frequencyHz: 50 / (2 * Math.PI) },
        expect: [E('|V| (peak)', 12, r => magnitude(r.V) * PEAK, 'V'), E('위상 φ', 10, r => r.polar.angleDeg, '°'), E('ω=2πf', 50, r => 2 * Math.PI * r.frequencyHz, 'rad/s'), E('f', 7.958, r => r.frequencyHz, 'Hz'), E('T=1/f', 0.1257,
          r => 1 / r.frequencyHz, 's')] },
      { label: '예제 9.5(a) I=−3+j4 A → 5cos(ωt+126.87°)', values: { coordinate: 'rect', basis: 'peak', re: -3, im: 4 },
        expect: [E('|I| (peak)', 5, r => magnitude(r.V) * PEAK, 'A'), E('위상', 126.87, r => r.polar.angleDeg, '°')] }],
    evaluate(p) {
      const V = rmsPhasor(p.coordinate === 'rect' ? { re: p.re, im: p.im } : polar(p.amplitude, p.angleDeg), p.basis);
      return { status: 'valid', V, frequencyHz: frequency(p), polar: rectangularPolar(V), phasors: [{ label: 'V', unit: 'V', z: V }], traces: [vt(V)], checks: [] };
    }
  },
  {
    id: 'impedance', title: '2 · R/L/C 복소 회로',
    description: '직렬은 임피던스 합, 병렬은 어드미턴스 합. 분기별 전압·전류와 위상을 비교합니다.',
    parameters: [f(), basis(), amp('voltageRms', '전원 V', 'V', 100, 0, 1e6),
      select('topology', '연결', 'series', [['series', '직렬 Z 합'], ['parallel', '병렬 Y 합']]),
      select('elements', '소자 조합', 'RL', ['R', 'L', 'C', 'RL', 'RC', 'LC', 'RLC'].map(k => [k, k])),
      { ...num('r', '저항 R', 'Ω', 3, 1e-9, 1e9), showIf: p => p.elements.includes('R') },
      { ...num('l', '인덕턴스 L', 'mH', 4 / (100 * Math.PI), 1e-12, 1e6, 1e-3), showIf: p => p.elements.includes('L') },
      { ...num('c', '정전용량 C', 'µF', 1 / (400 * Math.PI), 1e-15, 1e3, 1e-6), showIf: p => p.elements.includes('C') }],
    assumptions: [...common, '임의 회로 배선·과도응답은 기존 회로 실험을 사용하세요.', '이상 LC 정확 공진: 직렬은 Z=0 특이점, 병렬은 입력 Y=0 개방 등가. 분기에는 전류가 흐를 수 있습니다.'],
    formulas: ['Z_R=R Ω, Z_L=jωL Ω, Z_C=1/(jωC) Ω', 'Y=1/Z (S), Z_series=ΣZ, Y_parallel=ΣY', 'I=V/Z=VY · 유도성: V가 I보다 앞섬, 전류 지상', '용량성: 전류 진상, Q<0'],
    examples: [{ label: '3+j4 Ω · 지상', values: { topology: 'series', elements: 'RL', frequencyHz: 50, voltageRms: 100, r: 3, l: 4 / (100 * Math.PI) } },
      { label: '3−j4 Ω · 진상', values: { topology: 'series', elements: 'RC', frequencyHz: 50, voltageRms: 100, r: 3, c: 1 / (400 * Math.PI) } },
      { label: 'RLC 공진 · 저항만 남음', values: { topology: 'series', elements: 'RLC', frequencyHz: 50, voltageRms: 100, r: 10, l: .1, c: 1 / (1000 * Math.PI ** 2) } },
      { label: '예제 9.9 직렬 5 Ω + 0.1 F, 10cos4t V', values: { basis: 'peak', topology: 'series', elements: 'RC', frequencyHz: 4 / (2 * Math.PI), voltageRms: 10, r: 5, c: 0.1 },
        expect: [E('Z 실수부', 5, r => r.Z.re, 'Ω'), E('Z 허수부', -2.5, r => r.Z.im, 'Ω'), E('|I| (peak)', 1.789, r => magnitude(r.I) * PEAK, 'A'), E('∠I', 26.57, r => angleOf(r.I), '°'),
          E('|Vc| (peak)', 4.47, r => magnitude(r.branches[1].V) * PEAK, 'V'), E('∠Vc', -63.43, r => angleOf(r.branches[1].V), '°', { note: 'i가 v를 90° 앞섬 (진상)' })] },
      { label: '예제 11.2 Z=30−j70 Ω, V=120∠0° (peak) → P', values: { basis: 'peak', topology: 'series', elements: 'RC', frequencyHz: 1 / (2 * Math.PI), voltageRms: 120, r: 30, c: 1 / 70 },
        expect: [E('|I| (peak)', 1.576, r => magnitude(r.I) * PEAK, 'A'), E('∠I', 66.8, r => angleOf(r.I), '°'), E('P=½VmIm cosθ', 37.24, r => r.power.pWatts, 'W')] },
      { label: '예제 11.3 5∠30° V (peak), 4−j2 Ω → 소스 = 저항 2.5 W', values: { basis: 'peak', topology: 'series', elements: 'RC', frequencyHz: 1 / (2 * Math.PI), voltageRms: 5, r: 4, c: 0.5 },
        expect: [E('|I| (peak)', 1.118, r => magnitude(r.I) * PEAK, 'A'), E('P 소스', 2.5, r => r.power.pWatts, 'W', { note: '위상 30°는 입력하지 않아도 전력은 같음' }), E('P 저항', 2.5, r => r.branches[0].power.pWatts, 'W'), E('P 커패시터', 0,
          r => r.branches[1].power.pWatts, 'W', { abs: 1e-9 })] },
      { label: '예제 11.9(소자값) Z=25.98−j15 Ω, 120 V (peak), 50 Hz', values: { basis: 'peak', topology: 'series', elements: 'RC', frequencyHz: 50, voltageRms: 120, r: 25.98076211353316, c: 1 / (15 * 100 * Math.PI) },
        expect: [E('C', 212.2, r => r.branches[1].Z.im === 0 ? 0 : 1 / (2 * Math.PI * 50 * -r.branches[1].Z.im) * 1e6, 'µF'), E('|S|', 240, r => r.power.apparentVA, 'VA'), E('pf (leading)', 0.866, r => r.power.pf), E('|I| (peak)', 4,
          r => magnitude(r.I) * PEAK, 'A')] }],
    evaluate(p) {
      const value = { R: p.r, L: p.l, C: p.c };
      const result = impedanceNetwork({ ...p, voltageRms: p.voltageRms * rmsFactor(p), branches: [...p.elements].map(kind => ({ kind, value: value[kind] })) });
      if (result.status !== 'valid') return result;
      return { ...result, phasors: [{ label: 'V', unit: 'V', z: result.V }, { label: 'I', unit: 'A', z: result.I }],
        traces: [vt(result.V), it(result.I)], checks: [sampledPowerCheck(result.V, result.I, p.frequencyHz, result.power.pWatts)] };
    }
  },
  {
    id: 'power', title: '3 · 복소전력 · 무효전력',
    description: '전압·전류의 위상을 직접 바꾸며 전력삼각형과 순간전력을 봅니다. 켤레와 RMS가 핵심입니다.',
    parameters: [f(), basis(), amp('voltage', '|V|', 'V', 100, 0, 1e6), num('voltageAngle', 'V 위상', '°', 0, -36000, 36000),
      amp('current', '|I|', 'A', 20, 0, 1e6), num('currentAngle', 'I 위상', '°', -53.13010235415598, -36000, 36000)],
    assumptions: [...common, '여기서는 독립 V/I를 입력하므로 P<0인 전력 전달도 표시합니다. PF는 P/|S| 부호를 보존합니다.'],
    formulas: ['S=V_RMS I_RMS*=P+jQ · 켤레는 전류에', 'peak 페이저를 사용하면 S=½ V_peak I_peak*', 'P: W, Q: var, |S|: VA, PF=P/|S|', 'Q>0: 유도성/전류 지상 · Q<0: 용량성/전류 진상 · |S|=0: PF 미정'],
    examples: [{ label: '전류 지상 · Q=+1600 var', values: { basis: 'rms', voltage: 100, current: 20, voltageAngle: 0, currentAngle: -53.13010235415598 } },
      { label: '전류 진상 · Q=−1600 var', values: { basis: 'rms', voltage: 100, current: 20, voltageAngle: 0, currentAngle: 53.13010235415598 } },
      { label: '순수 L · P=0, PF=0', values: { basis: 'rms', voltage: 100, current: 10, voltageAngle: 0, currentAngle: -90 } },
      { label: '예제 9.2 v1=10∠−130°, v2=12∠−100° (V=v1, I=v2) → v2가 30° 앞섬', values: { basis: 'peak', voltage: 10, voltageAngle: -130, current: 12, currentAngle: -100 },
        expect: [E('∠v1−∠v2', -30, r => r.power.phaseDeg, '°', { note: '음수 = v2가 v1보다 앞섬 (전력 값은 이 비교에서 의미 없음)' })] },
      { label: '예제 11.9 120∠−20° V, 4∠10° A (peak) → 240 VA, pf 0.866 leading', values: { basis: 'peak', voltage: 120, current: 4, voltageAngle: -20, currentAngle: 10 },
        expect: [E('|S|', 240, r => r.power.apparentVA, 'VA'), E('pf (leading)', 0.866, r => r.power.pf), E('P', 207.8, r => r.power.pWatts, 'W'), E('Q (<0 용량성)', -120, r => r.power.qVars, 'var')] },
      { label: '예제 11.11 60∠−10° V, 1.5∠50° A (peak) → 45 VA, pf 0.5 leading', values: { basis: 'peak', voltage: 60, current: 1.5, voltageAngle: -10, currentAngle: 50 },
        expect: [E('|S|', 45, r => r.power.apparentVA, 'VA'), E('P', 22.5, r => r.power.pWatts, 'W'), E('Q', -38.97, r => r.power.qVars, 'var'), E('pf (leading)', 0.5, r => r.power.pf)] },
      { label: '예제 11.12 120 V rms, 12 kVA, pf 0.856 lagging', values: { basis: 'rms', voltage: 120, current: 100, voltageAngle: 0, currentAngle: -Math.acos(0.856) * DEG },
        expect: [E('P', 10272, r => r.power.pWatts, 'W'), E('Q', 6204, r => r.power.qVars, 'var'), E('Im (peak)', 141.4, r => magnitude(r.I) * PEAK, 'A'), E('pf (lagging)', 0.856, r => r.power.pf)] }],
    evaluate: p => powerOutput(rmsPhasor(polar(p.voltage, p.voltageAngle), p.basis), rmsPhasor(polar(p.current, p.currentAngle), p.basis), p.frequencyHz)
  },
  {
    id: 'three-phase', title: '4 · 균형 3상 · Y / Δ',
    description: '상순서(abc·acb)와 기준 위상(Van·Vab)을 고르고, 부하 한 상의 Z와 선간전압을 지정해 선/상 관계를 벡터로 확인합니다. 선로·전원 결선·불평형은 "9 · 3상 확장"에서 다룹니다.',
    parameters: [f(), select('connection', '부하 연결', 'Y', [['Y', 'Y (스타)'], ['delta', 'Δ (델타)']]),
      basis(), amp('lineVoltageRms', '선간 |Vab|', 'V', 400, 1e-9, 1e6), num('r', '상 임피던스 R', 'Ω', 8, 0, 1e9), num('x', '상 임피던스 X', 'Ω', 6, -1e9, 1e9),
      select('reference', '기준 위상의 대상', 'Van', [['Van', 'Van (Y 전원 기준)'], ['Vab', 'Vab (Δ 전원 기준)']]), num('phaseDeg', '기준 위상각', '°', 0, -36000, 36000),
      select('sequence', '상순서', 'abc', [['abc', 'abc (정상순)'], ['acb', 'acb (역상순)']])],
    assumptions: [...common, '동일한 3개 부하, 균형 전원. Y의 n은 균형 스타점 기준. 대문자(VAN, IAB)는 부하 쪽, 소문자(Van)는 전원 쪽 표기.', '불평형·중성선 전위 이동·고조파·변압기 결선은 계산하지 않습니다.'],
    // The phase relations follow the chosen sequence: abc has Vbn=−120°, Vab=+30°, Ia=Iab−30°; acb mirrors every sign.
    formulas: p => { const acb = p?.sequence === 'acb', s = acb ? '−' : '+', t = acb ? '+' : '−', seq = acb ? 'acb (역상순)' : 'abc (정상순)'; return [
      '상순서 ' + seq + ': Van,Vbn,Vcn = θ, θ' + t + '120°, θ' + s + '120°', 'Vab=Van−Vbn=√3 Van∠' + s + '30°', 'Y: V상=V선/√3, I선=I상',
      'Δ: V상=V선, Ia=Iab−Ica=√3 Iab∠' + t + '30°', 'S₃=Σ(V상 I상*)=3 Van Ia*', '√3|V선||I선|∠φ 는 크기·역률각 식. 복소식은 √3 Vab Ia*e^(' + t + 'j30°)']; },
    examples: [{ label: 'Y: 8+j6 Ω', values: { connection: 'Y', lineVoltageRms: 400, r: 8, x: 6 } },
      { label: '등가 Δ: 24+j18 Ω', values: { connection: 'delta', lineVoltageRms: 400, r: 24, x: 18 } },
      { label: '동일 Z로 Δ 재연결 → 전력 3배', values: { connection: 'delta', lineVoltageRms: 400, r: 8, x: 6 } },
      { label: '예제 12.3 abc, Van=100∠10° V, Δ 부하 8+j4 Ω', values: { basis: 'rms', connection: 'delta', lineVoltageRms: 100 * Math.sqrt(3), r: 8, x: 4, reference: 'Van', phaseDeg: 10 },
        expect: [E('|IAB|', 19.36, r => magnitude(r.loadCurrents[0]), 'A'), E('∠IAB', 13.43, r => angleOf(r.loadCurrents[0]), '°'), E('|Ia|', 33.53, r => magnitude(r.lineCurrents[0]), 'A'), E('∠Ia', -16.57,
          r => angleOf(r.lineCurrents[0]), '°')] },
      { label: '연습 12.4 Δ 발전기 Vab=330∠0° V, Δ 부하 20−j15 Ω', values: { basis: 'rms', connection: 'delta', lineVoltageRms: 330, r: 20, x: -15, reference: 'Vab', phaseDeg: 0 },
        expect: [E('|IAB|', 13.2, r => magnitude(r.loadCurrents[0]), 'A'), E('∠IAB', 36.87, r => angleOf(r.loadCurrents[0]), '°'), E('∠IBC', -83.13, r => angleOf(r.loadCurrents[1]), '°'), E('∠ICA', 156.87,
          r => angleOf(r.loadCurrents[2]), '°'),
          E('|Ia|', 22.86, r => magnitude(r.lineCurrents[0]), 'A'), E('∠Ia', 6.87, r => angleOf(r.lineCurrents[0]), '°')] },
      { label: '연습 12.5 선간 210 V (Vab 기준), Y 부하 40+j25 Ω', values: { basis: 'rms', connection: 'Y', lineVoltageRms: 210, r: 40, x: 25, reference: 'Vab', phaseDeg: 0 },
        expect: [E('|Ia|', 2.57, r => magnitude(r.lineCurrents[0]), 'A'), E('∠Ia', -62.01, r => angleOf(r.lineCurrents[0]), '°'), E('∠Ib', 177.99, r => angleOf(r.lineCurrents[1]), '°'), E('∠Ic', 57.99, r => angleOf(r.lineCurrents[2]),
          '°')] },
      { label: '연습 12.46 100 Ω×3 · 선간 110 V · Y 결선 → 121 W', values: { basis: 'rms', connection: 'Y', lineVoltageRms: 110, r: 100, x: 0, reference: 'Van', phaseDeg: 0 }, expect: [E('P (Y)', 121, r => r.power.pWatts, 'W')] },
      { label: '연습 12.46 100 Ω×3 · 선간 110 V · Δ 결선 → 363 W (Y의 3배)', values: { basis: 'rms', connection: 'delta', lineVoltageRms: 110, r: 100, x: 0, reference: 'Van', phaseDeg: 0 }, expect: [E('P (Δ)', 363, r => r.power.pWatts, 'W')] },
      { label: '역상순 acb · Y 8+j6 Ω · Vab=√3 Van∠−30°', values: { basis: 'rms', connection: 'Y', lineVoltageRms: 400, r: 8, x: 6, reference: 'Van', phaseDeg: 0, sequence: 'acb' },
        expect: [E('∠Vab', -30, r => angleOf(r.lineVoltages[0]), '°', { note: 'abc 에서는 +30°' }), E('∠Vbn', 120, r => angleOf(r.phaseVoltages[1]), '°')] }],
    evaluate(p) {
      const r = balancedThreePhase({ ...p, lineVoltageRms: p.lineVoltageRms * rmsFactor(p), z: { re: p.r, im: p.x } });
      if (r.status !== 'valid') return r;
      let actual = 0, min = Infinity, max = -Infinity;
      for (let n = 0; n < 360; n++) {
        const t = n / (360 * p.frequencyHz);
        const value = r.loadVoltages.reduce((sum, v, i) => sum + waveSample(v, p.frequencyHz, t) * waveSample(r.loadCurrents[i], p.frequencyHz, t), 0);
        actual += value; min = Math.min(min, value); max = Math.max(max, value);
      }
      const tolerance = 1e-8 + 1e-10 * r.power.apparentVA;
      return { ...r, frequencyHz: p.frequencyHz,
        phasors: [...r.phaseVoltages.map((z, i) => ({ label: ['Van', 'Vbn', 'Vcn'][i], unit: 'V', z })), ...r.lineVoltages.map((z, i) => ({ label: ['Vab', 'Vbc', 'Vca'][i], unit: 'V', z })),
          ...r.lineCurrents.map((z, i) => ({ label: ['Ia', 'Ib', 'Ic'][i], unit: 'A', z })),
          ...(r.connection === 'delta' ? r.loadCurrents.map((z, i) => ({ label: ['IAB', 'IBC', 'ICA'][i], unit: 'A', z })) : [])],
        traces: [...r.phaseVoltages.map((v, i) => trace(['van(t)', 'vbn(t)', 'vcn(t)'][i], 'V', v)),
          { label: '3相 p_total(t)', unit: 'W', sample: t => r.loadVoltages.reduce((sum, v, i) => sum + waveSample(v, p.frequencyHz, t) * waveSample(r.loadCurrents[i], p.frequencyHz, t), 0) }],
        checks: [{ label: '三相 순간전력 합 · 한 주기 평균', actual: actual / 360, expected: r.power.pWatts, unit: 'W', tolerance, pass: Math.abs(actual / 360 - r.power.pWatts) <= tolerance },
          { label: '균형 三相 총 순간전력의 max−min', actual: max - min, expected: 0, unit: 'W', tolerance, pass: max - min <= tolerance }] };
    }
  },
  {
    id: 'correction', title: '5 · 역률 보상 · 과보상',
    description: '유효전력은 유지하고 병렬 커패시터로 공급원의 Q와 전류를 줄입니다. 권장 C와 실제 C를 비교합니다.',
    parameters: [f(), select('phases', '전원', '1', [['1', '단상'], ['3', '균형 3상']]),
      { ...select('connection', '커패시터 뱅크 결선', 'delta', [['delta', 'Δ · 각 C에 선간전압'], ['Y', 'Y · 각 C에 V선/√3']]), showIf: p => p.phases === '3' },
      basis(), amp('voltageRms', '단상 단자 / 3상 선간 전압', 'V', 120, 1e-9, 1e6),
      num('pWatts', '총 유효전력 P', 'W', 1000, 1e-9, 1e9), num('qVars', '총 무효전력 Q (지상 +)', 'var', 750, -1e9, 1e9),
      num('targetPF', '목표 지상 역률', '', 1, .001, 1),
      select('capacitorMode', 'C 선택', 'recommended', [['recommended', '목표 PF로 계산'], ['custom', '직접 C 입력']]),
      { ...num('capacitanceF', '각 커패시터 C · 0은 미설치', 'µF', 138.15533254504802e-6, 0, 1e3, 1e-6), showIf: p => p.capacitorMode === 'custom' }],
    assumptions: [...common, '부하의 P와 Q는 보상 전후 일정, 전원전압 일정. C는 병렬 접속.', '3상 C는 뱅크 합계가 아닌 각 커패시터 값. 총 P/Q를 입력하세요.', '지상 PF 개선을 위한 이상 소자 교육식. 실제 설비 선정·공진·보호 설계는 범위 밖.'],
    formulas: ['Q목표=P tan(acos(PF목표))≥0', 'Qc=Q부하−Q목표 (필요한 보상량, 양수) · 커패시터 복소전력 S_C=−jQc', '단상 C=Qc/(ωV²)', '3상 Y: C_each=Qc/(ωV선²) · Δ: C_each=Qc/(3ωV선²)', '공급원 Q_after=Q부하−Qc · Q_after<0이면 과보상', '|I단상|=|S|/V · |I3상 선|=|S₃|/(√3V선)'],
    examples: [{ label: '단상 .8 → 1', values: { phases: '1', frequencyHz: 60, voltageRms: 120, pWatts: 1000, qVars: 750, targetPF: 1, capacitorMode: 'recommended' } },
      { label: '3상 .8 → .95 · Δ', values: { phases: '3', connection: 'delta', frequencyHz: 50, voltageRms: 400, pWatts: 10000, qVars: 7500, targetPF: .95, capacitorMode: 'recommended' } },
      { label: 'C 300 µF · 과보상 확인', values: { phases: '1', frequencyHz: 60, voltageRms: 120, pWatts: 1000, qVars: 750, targetPF: 1, capacitorMode: 'custom', capacitanceF: 300e-6 } },
      { label: '예제 11.15 120 V 60 Hz · 4 kW 0.8 lag → 0.95', values: { basis: 'rms', phases: '1', frequencyHz: 60, voltageRms: 120, pWatts: 4000, qVars: 3000, targetPF: 0.95, capacitorMode: 'recommended' },
        expect: [E('Qc', 1685.6, r => -r.qCapacitorVars, 'var'), E('C', 310.5, r => r.recommendedCapacitanceF * 1e6, 'µF')] },
      { label: '예제 12.8 3상 240 kV · 90 kW + 85 kvar → 0.9 (Δ)', values: { basis: 'rms', phases: '3', connection: 'delta', frequencyHz: 60, voltageRms: 240000, pWatts: 90000, qVars: 85000, targetPF: 0.9, capacitorMode: 'recommended' },
        expect: [E('Qc 합', 41400, r => -r.qCapacitorVars, 'var'), E('각 C', 635.5, r => r.recommendedCapacitanceF * 1e12, 'pF')] }],
    evaluate(p) {
      const r = correction({ ...p, voltageRms: p.voltageRms * rmsFactor(p), phases: Number(p.phases), capacitanceF: p.capacitorMode === 'custom' ? p.capacitanceF : undefined });
      if (r.status !== 'valid') return r;
      return { ...r, power: r.after, phasors: [], traces: [], checks: [] };
    }
  },
  PROBLEM_EXPERIMENT
];
const symbolField=(key,label,initial,showIf)=>({key,label,initial,text:true,singleLine:true,maxLength:24,showIf:p=>p.presentation==='symbolic'&&(!showIf||showIf(p))});
for(const experiment of EXPERIMENTS.filter(e=>e.id!=='problem')) {
  const commonKeys = new Set(['basis','coordinate','topology','elements','connection','phases']);
  for(const d of experiment.parameters) if(!commonKeys.has(d.key)) { const condition=d.showIf; d.showIf=p=>p.presentation==='numeric'&&(!condition||condition(p)); }
  experiment.parameters.unshift({key:'presentation',label:'학습 방식',initial:'symbolic',choices:[['symbolic','문자식·법칙·유도 (기본)'],['numeric','숫자 시현·그래프 (보조)']]});
  experiment.parameters.push(symbolField('symbolVoltage','전압 기호','V'),symbolField('symbolOmega','각주파수 기호','ω'));
  if(experiment.id==='impedance')experiment.parameters.push(symbolField('symbolR','저항 기호','R',p=>p.elements.includes('R')),symbolField('symbolL','인덕턴스 기호','L',p=>p.elements.includes('L')),symbolField('symbolC','정전용량 기호','C',p=>p.elements.includes('C')));
  if(experiment.id==='power')experiment.parameters.push(symbolField('symbolCurrent','전류 기호','I'),symbolField('symbolPhi','V−I 상대위상 기호','φ'));
  if(experiment.id==='three-phase'){experiment.parameters.push(symbolField('symbolZ','상 임피던스 기호','Z'),{key:'voltageKnown',label:'기호 전압의 종류',initial:'line',choices:[['line','선간 Vab'],['phase','부하 상전압']],showIf:p=>p.presentation==='symbolic'});}
  if(experiment.id==='correction')experiment.parameters.push(symbolField('symbolP','총 유효전력 기호','P'),symbolField('symbolQ','총 무효전력 기호','Q'),symbolField('symbolPF','목표 지상 역률 기호','pf_t'));
  for(const example of experiment.examples){example.values.presentation='numeric';example.values.basis??='rms';}
}
// Lecture examples carry expect rows; this evaluates the example's numeric experiment and compares every row (display-basis numbers).
// `shown` is the result that is actually on screen (the form's own state); without it the example is recomputed from the defaults plus its own values.
export function verifyExample(id, index, shown = null) {
  const experiment = getExperiment(id), example = experiment.examples[index];
  if (!example?.expect) return null;
  const result = shown ?? evaluateExperiment(id, { ...initialParameters(experiment), ...example.values });
  if (result.status !== 'valid') return { status: 'invalid', reason: result.reason, rows: [], pass: false };
  const rows = verifyExpectations({ ...result, values: {} }, example.expect);
  return { status: 'valid', rows, pass: rows.every(r => r.pass) };
}
export function getExperiment(id) {
  const experiment = EXPERIMENTS.find(e => e.id === id);
  if (!experiment) throw new RangeError('지원하지 않는 AC 실험입니다.');
  return experiment;
}
export function initialParameters(experiment) { return Object.fromEntries(experiment.parameters.map(p => [p.key, p.initial])); }
const draftNumber = n => String(Number(n.toPrecision(10)));
const draftOf = (p, value) => (p.choices || p.text ? value : value === null ? '' : draftNumber(value / p.displayScale));
// Form drafts (text) for parameters already written in the display basis.
export function draftsOf(experiment, params) { return Object.fromEntries(experiment.parameters.map(p => [p.key, draftOf(p, params[p.key])])); }
// Switching the complex notation of experiment 1 keeps the same voltage: rectangular a+jb ⇄ polar |V|∠θ (display-basis numbers, typed text in and out).
// A draft that is empty or not a number leaves the target fields as they were.
export function convertCoordinateDrafts(drafts, next) {
  const out = { ...drafts }, read = text => (String(text ?? '').trim() === '' ? NaN : Number(text)), tidy = (v, scale) => draftNumber(Math.abs(v) < 1e-12 * scale ? 0 : v);
  if (next === 'polar') {
    const re = read(drafts.re), im = read(drafts.im);
    if (Number.isFinite(re) && Number.isFinite(im)) { const magnitudeNow = Math.hypot(re, im); out.amplitude = draftNumber(magnitudeNow); out.angleDeg = magnitudeNow === 0 ? '0' : tidy(Math.atan2(im, re) * DEG, 180); }
  } else {
    const size = read(drafts.amplitude), angle = read(drafts.angleDeg);
    if (Number.isFinite(size) && Number.isFinite(angle)) { const rad = angle / DEG; out.re = tidy(size * Math.cos(rad), size); out.im = tidy(size * Math.sin(rad), size); }
  }
  return out;
}
// Applying a lecture example: start from the complete default drafts and overwrite only what the example sets, so nothing typed or picked earlier (e.g. the acb sequence) survives.
export function exampleDrafts(experiment, example, defaultDrafts) {
  const drafts = { ...defaultDrafts };
  for (const p of experiment.parameters) if (Object.hasOwn(example.values, p.key)) drafts[p.key] = draftOf(p, example.values[p.key]);
  return drafts;
}
export function evaluateExperiment(id, p) {
  const experiment = getExperiment(id);
  try {
    for (const d of experiment.parameters) {
      if (d.showIf && !d.showIf(p)) continue;
      if (d.text) { if (typeof p[d.key] !== 'string' || p[d.key].length > d.maxLength) throw new RangeError(d.label + ': 메모 길이를 확인하세요.'); continue; }
      if (d.optionalIf?.(p) && p[d.key] === null) continue;
      if (d.choices) {
        if (!d.choices.some(([key]) => key === p[d.key])) throw new RangeError(d.label + ': 선택값을 확인하세요.');
      } else if (!Number.isFinite(p[d.key])) throw new RangeError(d.label + ': 허용 범위를 확인하세요.');
      else {
        // The limits are internal RMS values: a peak-basis amplitude is shown √2 times larger and must not be rejected for that alone.
        const internal = d.amplitude && p.basis === 'peak' ? p[d.key] * Math.SQRT1_2 : p[d.key], slack = 1e-12 * Math.abs(internal);
        if (internal < d.min - slack || internal > d.max + slack) throw new RangeError(d.label + ': 허용 범위를 확인하세요.');
      }
    }
    const result=p.presentation === 'symbolic' ? symbolicCourseExperiment(id,p) : experiment.evaluate(p);
    if(result.status==='valid') {
      // Numeric illustrations use the identical structural template, without numeric substitution.
      const symbolicParams={...p, basis:p.basis??'rms', ...(id==='three-phase'&&p.presentation==='numeric'?{voltageKnown:'line'}:{})};
      const symbolic=result.symbolic?result:id==='problem'?solveSymbolicProblem(symbolicParams):symbolicCourseExperiment(id,symbolicParams);
      result.symbolicData=courseSymbolicData(symbolic,symbolicParams);
    }
    return result;
  } catch (e) { return { status: 'invalid', reason: e.message }; }
}
