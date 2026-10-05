import { polar, rmsPhasor, rectangularPolar, phaseDifference, magnitude, complexPower, impedanceNetwork, balancedThreePhase, correction, sampledPowerCheck, waveSample } from './circuit-course-model.js';
import { symbolicCourseExperiment, solveSymbolicProblem, courseSymbolicData } from './circuit-course-problem-symbolic.js';
import { PROBLEM_EXPERIMENT } from './circuit-course-problem.js';
export const REFERENCES = [
  { title: 'MIT Kirtley · Ch.2 AC Power Flow (pp.5–6, 12–15)', url: 'https://ocw.mit.edu/courses/6-061-introduction-to-electric-power-systems-spring-2011/9cf8de165233601f547b284cee5c2131_MIT6_061S11_ch2.pdf' },
  { title: 'MIT Kirtley · Ch.3 Polyphase Networks (pp.3–8)', url: 'https://ocw.mit.edu/courses/6-061-introduction-to-electric-power-systems-spring-2011/c6393a58319200a5344752de0cf47ec4_MIT6_061S11_ch3.pdf' }
];
const num = (key, label, unit, initial, min, max, displayScale = 1) => ({ key, label, unit, initial, min, max, displayScale });
const select = (key, label, initial, choices) => ({ key, label, initial, choices });
const f = () => num('frequencyHz', '주파수 f', 'Hz', 50, .01, 1e6);
const basis = () => select('basis', '입력 진폭 기준', 'rms', [['rms', 'RMS 실효값'], ['peak', 'peak 최댓값']]);
const frequency = p => p.frequencyHz;
const common = ['정현파 정상상태, 공통 주파수, 이상 선형 소자.', 'e^{jωt}와 코사인 기준. 내부 페이저는 항상 RMS.', '전류는 부하의 + 전압 단자로 들어갑니다 (수동부호).'];
const trace = (label, unit, phasor) => ({ label, unit, phasor });
const vt = V => trace('v(t)', 'V', V), it = I => trace('i(t)', 'A', I);
function powerOutput(V, I, frequencyHz) {
  const power = complexPower(V, I);
  return { status: 'valid', V, I, power, frequencyHz, phasors: [{ label: 'V RMS', unit: 'V', z: V }, { label: 'I RMS', unit: 'A', z: I }],
    traces: [vt(V), it(I), { label: 'p(t)=v(t)i(t)', unit: 'W', sample: t => waveSample(V, frequencyHz, t) * waveSample(I, frequencyHz, t) }],
    checks: [sampledPowerCheck(V, I, frequencyHz, power.pWatts)] };
}
export const EXPERIMENTS = [
  {
    id: 'phasor-wave', title: '1 · 복소수 → 페이저 → 파형',
    description: '직교형/극형을 바꾸고 위상각이 시간파형을 어떻게 옮기는지 봅니다.',
    parameters: [f(), basis(), select('coordinate', '복소수 표현', 'rect', [['rect', '직교형 a+jb'], ['polar', '극형 |V|∠θ']]),
      { ...num('re', '실수부 a', 'V', 100, -1e6, 1e6), showIf: p => p.coordinate === 'rect' },
      { ...num('im', '허수부 b', 'V', 0, -1e6, 1e6), showIf: p => p.coordinate === 'rect' },
      { ...num('amplitude', '크기 |V|', 'V', 100, 0, 1e6), showIf: p => p.coordinate === 'polar' },
      { ...num('angleDeg', '위상 θ', '°', 30, -36000, 36000), showIf: p => p.coordinate === 'polar' }],
    assumptions: [...common, '0벡터(크기 0)의 위상은 미정입니다.'], formulas: ['V=a+jb=|V|∠θ, θ=atan2(b,a)', 'ω=2πf (rad/s), T=1/f (s)', 'v(t)=√2 |V_RMS| cos(ωt+θ)', '|V_peak|=√2 |V_RMS|'],
    examples: [{ label: '100+j100 V RMS', values: { coordinate: 'rect', basis: 'rms', re: 100, im: 100 } }, { label: '141.421 V peak = 100 V RMS', values: { coordinate: 'polar', basis: 'peak', amplitude: 100 * Math.SQRT2, angleDeg: 0 } }],
    evaluate(p) {
      const V = rmsPhasor(p.coordinate === 'rect' ? { re: p.re, im: p.im } : polar(p.amplitude, p.angleDeg), p.basis);
      return { status: 'valid', V, frequencyHz: frequency(p), polar: rectangularPolar(V), phasors: [{ label: 'V RMS', unit: 'V', z: V }], traces: [vt(V)], checks: [] };
    }
  },
  {
    id: 'impedance', title: '2 · R/L/C 복소 회로',
    description: '직렬은 임피던스 합, 병렬은 어드미턴스 합. 분기별 전압·전류와 위상을 비교합니다.',
    parameters: [f(), num('voltageRms', '전원 V', 'V RMS', 100, 0, 1e6),
      select('topology', '연결', 'series', [['series', '직렬 Z 합'], ['parallel', '병렬 Y 합']]),
      select('elements', '소자 조합', 'RL', ['R', 'L', 'C', 'RL', 'RC', 'LC', 'RLC'].map(k => [k, k])),
      { ...num('r', '저항 R', 'Ω', 3, 1e-9, 1e9), showIf: p => p.elements.includes('R') },
      { ...num('l', '인덕턴스 L', 'mH', 4 / (100 * Math.PI), 1e-12, 1e6, 1e-3), showIf: p => p.elements.includes('L') },
      { ...num('c', '정전용량 C', 'µF', 1 / (400 * Math.PI), 1e-15, 1e3, 1e-6), showIf: p => p.elements.includes('C') }],
    assumptions: [...common, '임의 회로 배선·과도응답은 기존 회로 실험을 사용하세요.', '이상 LC 정확 공진: 직렬은 Z=0 특이점, 병렬은 입력 Y=0 개방 등가. 분기에는 전류가 흐를 수 있습니다.'],
    formulas: ['Z_R=R Ω, Z_L=jωL Ω, Z_C=1/(jωC) Ω', 'Y=1/Z (S), Z_series=ΣZ, Y_parallel=ΣY', 'I=V/Z=VY · 유도성: V가 I보다 앞섬, 전류 지상', '용량성: 전류 진상, Q<0'],
    examples: [{ label: '3+j4 Ω · 지상', values: { topology: 'series', elements: 'RL', frequencyHz: 50, voltageRms: 100, r: 3, l: 4 / (100 * Math.PI) } },
      { label: '3−j4 Ω · 진상', values: { topology: 'series', elements: 'RC', frequencyHz: 50, voltageRms: 100, r: 3, c: 1 / (400 * Math.PI) } },
      { label: 'RLC 공진 · 저항만 남음', values: { topology: 'series', elements: 'RLC', frequencyHz: 50, voltageRms: 100, r: 10, l: .1, c: 1 / (1000 * Math.PI ** 2) } }],
    evaluate(p) {
      const value = { R: p.r, L: p.l, C: p.c };
      const result = impedanceNetwork({ ...p, branches: [...p.elements].map(kind => ({ kind, value: value[kind] })) });
      if (result.status !== 'valid') return result;
      return { ...result, phasors: [{ label: 'V RMS', unit: 'V', z: result.V }, { label: 'I RMS', unit: 'A', z: result.I }],
        traces: [vt(result.V), it(result.I)], checks: [sampledPowerCheck(result.V, result.I, p.frequencyHz, result.power.pWatts)] };
    }
  },
  {
    id: 'power', title: '3 · 복소전력 · 무효전력',
    description: '전압·전류의 위상을 직접 바꾸며 전력삼각형과 순간전력을 봅니다. 켤레와 RMS가 핵심입니다.',
    parameters: [f(), basis(), num('voltage', '|V|', 'V', 100, 0, 1e6), num('voltageAngle', 'V 위상', '°', 0, -36000, 36000),
      num('current', '|I|', 'A', 20, 0, 1e6), num('currentAngle', 'I 위상', '°', -53.13010235415598, -36000, 36000)],
    assumptions: [...common, '여기서는 독립 V/I를 입력하므로 P<0인 전력 전달도 표시합니다. PF는 P/|S| 부호를 보존합니다.'],
    formulas: ['S=V_RMS I_RMS*=P+jQ · 켤레는 전류에', 'peak 페이저를 사용하면 S=½ V_peak I_peak*', 'P: W, Q: var, |S|: VA, PF=P/|S|', 'Q>0: 유도성/전류 지상 · Q<0: 용량성/전류 진상 · |S|=0: PF 미정'],
    examples: [{ label: '전류 지상 · Q=+1600 var', values: { basis: 'rms', voltage: 100, current: 20, voltageAngle: 0, currentAngle: -53.13010235415598 } },
      { label: '전류 진상 · Q=−1600 var', values: { basis: 'rms', voltage: 100, current: 20, voltageAngle: 0, currentAngle: 53.13010235415598 } },
      { label: '순수 L · P=0, PF=0', values: { basis: 'rms', voltage: 100, current: 10, voltageAngle: 0, currentAngle: -90 } }],
    evaluate: p => powerOutput(rmsPhasor(polar(p.voltage, p.voltageAngle), p.basis), rmsPhasor(polar(p.current, p.currentAngle), p.basis), p.frequencyHz)
  },
  {
    id: 'three-phase', title: '4 · 균형 3상 · Y / Δ',
    description: 'abc 양의 상순서. 부하 한 상의 Z와 선간 RMS 전압을 지정하고 선/상 관계를 벡터로 확인합니다.',
    parameters: [f(), select('connection', '부하 연결', 'Y', [['Y', 'Y (스타)'], ['delta', 'Δ (델타)']]),
      num('lineVoltageRms', '선간 |Vab|', 'V RMS', 400, 1e-9, 1e6), num('r', '상 임피던스 R', 'Ω', 8, 0, 1e9), num('x', '상 임피던스 X', 'Ω', 6, -1e9, 1e9),
      num('phaseDeg', 'Van 기준 위상', '°', 0, -36000, 36000)],
    assumptions: [...common, '동일한 3개 부하, 균형 전원, abc 순서. Y의 n은 균형 스타점 기준.', '불평형·중성선 전위 이동·고조파·변압기 결선은 계산하지 않습니다.'],
    formulas: ['Van,Vbn,Vcn: θ, θ−120°, θ+120°', 'Vab=Van−Vbn=√3 Van∠+30°', 'Y: V상=V선/√3, I선=I상', 'Δ: V상=V선, Ia=Iab−Ica=√3 Iab∠−30°', 'S₃=Σ(V상 I상*)=3 Van Ia*', '√3|V선||I선|∠φ 는 크기·역률각 식. 복소식은 √3 Vab Ia*e^(−j30°)'],
    examples: [{ label: 'Y: 8+j6 Ω', values: { connection: 'Y', lineVoltageRms: 400, r: 8, x: 6 } },
      { label: '등가 Δ: 24+j18 Ω', values: { connection: 'delta', lineVoltageRms: 400, r: 24, x: 18 } },
      { label: '동일 Z로 Δ 재연결 → 전력 3배', values: { connection: 'delta', lineVoltageRms: 400, r: 8, x: 6 } }],
    evaluate(p) {
      const r = balancedThreePhase({ ...p, z: { re: p.r, im: p.x } });
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
          ...r.lineCurrents.map((z, i) => ({ label: ['Ia', 'Ib', 'Ic'][i], unit: 'A', z }))],
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
      num('voltageRms', '단상 단자 / 3상 선간 전압', 'V RMS', 120, 1e-9, 1e6),
      num('pWatts', '총 유효전력 P', 'W', 1000, 1e-9, 1e9), num('qVars', '총 무효전력 Q (지상 +)', 'var', 750, -1e9, 1e9),
      num('targetPF', '목표 지상 역률', '', 1, .001, 1),
      select('capacitorMode', 'C 선택', 'recommended', [['recommended', '목표 PF로 계산'], ['custom', '직접 C 입력']]),
      { ...num('capacitanceF', '각 커패시터 C · 0은 미설치', 'µF', 138.15533254504802e-6, 0, 1e3, 1e-6), showIf: p => p.capacitorMode === 'custom' }],
    assumptions: [...common, '부하의 P와 Q는 보상 전후 일정, 전원전압 일정. C는 병렬 접속.', '3상 C는 뱅크 합계가 아닌 각 커패시터 값. 총 P/Q를 입력하세요.', '지상 PF 개선을 위한 이상 소자 교육식. 실제 설비 선정·공진·보호 설계는 범위 밖.'],
    formulas: ['Q목표=P tan(acos(PF목표))≥0', 'Qcap=Q목표−Q부하≤0', '단상 C=−Qcap/(ωV²)', '3상 Y: C_each=−Qcap/(ωV선²) · Δ: C_each=−Qcap/(3ωV선²)', '공급원 Q_after=Q부하+Qcap · Q_after<0이면 과보상', '|I단상|=|S|/V · |I3상 선|=|S₃|/(√3V선)'],
    examples: [{ label: '단상 .8 → 1', values: { phases: '1', frequencyHz: 60, voltageRms: 120, pWatts: 1000, qVars: 750, targetPF: 1, capacitorMode: 'recommended' } },
      { label: '3상 .8 → .95 · Δ', values: { phases: '3', connection: 'delta', frequencyHz: 50, voltageRms: 400, pWatts: 10000, qVars: 7500, targetPF: .95, capacitorMode: 'recommended' } },
      { label: 'C 300 µF · 과보상 확인', values: { phases: '1', frequencyHz: 60, voltageRms: 120, pWatts: 1000, qVars: 750, targetPF: 1, capacitorMode: 'custom', capacitanceF: 300e-6 } }],
    evaluate(p) {
      const r = correction({ ...p, phases: Number(p.phases), capacitanceF: p.capacitorMode === 'custom' ? p.capacitanceF : undefined });
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
  for(const example of experiment.examples)example.values.presentation='numeric';
}
export function getExperiment(id) {
  const experiment = EXPERIMENTS.find(e => e.id === id);
  if (!experiment) throw new RangeError('지원하지 않는 AC 실험입니다.');
  return experiment;
}
export function initialParameters(experiment) { return Object.fromEntries(experiment.parameters.map(p => [p.key, p.initial])); }
export function evaluateExperiment(id, p) {
  const experiment = getExperiment(id);
  try {
    for (const d of experiment.parameters) {
      if (d.showIf && !d.showIf(p)) continue;
      if (d.text) { if (typeof p[d.key] !== 'string' || p[d.key].length > d.maxLength) throw new RangeError(d.label + ': 메모 길이를 확인하세요.'); continue; }
      if (d.optionalIf?.(p) && p[d.key] === null) continue;
      if (d.choices) {
        if (!d.choices.some(([key]) => key === p[d.key])) throw new RangeError(d.label + ': 선택값을 확인하세요.');
      } else if (!Number.isFinite(p[d.key]) || p[d.key] < d.min || p[d.key] > d.max) throw new RangeError(d.label + ': 허용 범위를 확인하세요.');
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
