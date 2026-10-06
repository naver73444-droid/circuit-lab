// Hayt Ch.8 §8.10 lecture experiments: forces from the virtual-displacement (energy) method. Pure: no DOM.
import { MU0, REF, checkRow, choiceParameter, coordinate, defineLecture, excluded, hayt, linspace, parameter, scalar, series } from './em-course-lecture.js';

const TOPIC = 'inductance';
const WEEK = 6;
const CONSTRAINTS = [[0, '일정 전류 (전원이 연결됨)'], [1, '일정 쇄교자속 (고립계·초전도)']];
const area = radius => Math.PI * radius * radius;
const constraint = choiceParameter('constraint', '가상변위 조건', 0, CONSTRAINTS);
const displacement = parameter('dx', '가상변위 dx (에너지 수지 표시용)', 'm', 'µm', 1e-6, 1e-6, 1e-9, 1e-3);

// ---- 10a. Pull of a gapped core ---------------------------------------------------------------------------------------------
const gapForceParameters = [
  parameter('turns', '감은 수 N', '1', '1', 1, 500, 1, 1e5),
  parameter('current', '전류 I', 'A', 'A', 1, 4, -1000, 1000),
  parameter('area', '공극 단면적 S', 'm²', 'cm²', 1e-4, 6e-4, 1e-6, 1),
  parameter('coreLength', '코어 길이 l', 'm', 'cm', 0.01, 0.3 * Math.PI, 1e-3, 10),
  parameter('muR', '코어 비투자율 μ_r (선형)', '1', '1', 1, 4000, 1, 1e6),
  constraint, displacement,
];

const gapInductance = (p, x) => p.turns ** 2 * MU0 * p.muR * p.area / (p.coreLength + p.muR * x); // N²μ₀μS/(μ₀l+μx) with μ = μ₀μ_r
const gapForce = (p, x) => -0.5 * (p.turns * p.current) ** 2 * MU0 * p.muR ** 2 * p.area / (p.coreLength + p.muR * x) ** 2;

function gapForceCompute(p, x) {
  if (x < 0) return excluded('unsupported', '공극 길이 x는 0 이상이어야 합니다.', 'negative-gap');
  const L = gapInductance(p, x), F = gapForce(p, x), denominator = p.coreLength + p.muR * x;
  const B = p.turns * p.current * MU0 * p.muR / denominator, dx = p.dx;
  // Energy balance over the window x ± dx/2 (central difference): the error of "input − increase" against F·dx is of order dx³,
  // where a one-sided window x … x+dx gives a second-order error that is large for finite dx. Near x = 0 the window is moved to [0, dx].
  const xc = Math.max(x, dx / 2), La = gapInductance(p, xc - dx / 2), Lb = gapInductance(p, xc + dx / 2), Fc = gapForce(p, xc);
  const linkage = L * p.current, w1 = 0.5 * L * p.current ** 2;
  const constantFlux = p.constraint === 1;
  const linkageC = gapInductance(p, xc) * p.current; // the flux that stays fixed is the one at the window centre
  const dWfield = constantFlux ? linkageC ** 2 / (2 * Lb) - linkageC ** 2 / (2 * La) : 0.5 * (Lb - La) * p.current ** 2;
  const dWelec = constantFlux ? 0 : p.current * (Lb - La) * p.current;
  const scalars = [scalar('F', '공극 면에 작용하는 힘 F = ½I² dL/dx (− 인력)', F, 'N'), scalar('Fcheck', '자속밀도 식 −B²S/(2μ₀)', -B * B * p.area / (2 * MU0), 'N'),
    scalar('Finf', 'μ → ∞ 극한 −½N²I²μ₀S/x²', x > 0 ? -0.5 * (p.turns * p.current) ** 2 * MU0 * p.area / (x * x) : Number.NaN, 'N'),
    scalar('B', '공극 자속밀도 B = μ₀μ NI/(μ₀l + μx) (μ = μ₀μ_r에서 정리)', B, 'T'), scalar('L', '인덕턴스 L(x) = N²μ₀μS/(μ₀l + μx)', L, 'H'),
    scalar('linkage', '쇄교자속 Λ = LI', linkage, 'Wb·turn'), scalar('energy', '자기 에너지 W = ½LI²', w1, 'J'),
    scalar('pressure', '단위 면적당 힘 B²/(2μ₀)', B * B / (2 * MU0), 'Pa'),
    scalar('dWelec', constantFlux ? '전원이 넣은 에너지 (Λ 고정이면 0)' : '전원이 넣은 에너지 I dΛ', dWelec, 'J'),
    scalar('dWfield', '자기장 에너지 증가 dW', dWfield, 'J'), scalar('mechanical', '역학적 일 F dx (에너지 수지: 투입 − 증가)', dWelec - dWfield, 'J'),
    scalar('Fdx', '해석적 F·dx', Fc * dx, 'J')];
  if (!Number.isFinite(scalars[2].value)) scalars.splice(2, 1);
  return { region: constantFlux ? 'constant-flux' : 'constant-current', vectors: {}, scalars,
    notes: ['공극이 커지는 방향(dx > 0)의 일 F dx < 0은 끌어당기는 힘(공극이 닫히려 함)입니다.',
      `에너지 수지는 x ± dx/2 구간의 중심차분으로 계산해 dx → 0에서 F·dx와 일치합니다(유한 dx의 차이는 dx³ 차수, 한쪽 차분이면 dx² 차수로 훨씬 큼).${xc === x ? '' : ' x < dx/2이므로 구간을 0 … dx로 옮겼고 F·dx는 그 구간 중심(x = dx/2)의 힘으로 계산했습니다.'}`,
      '힘의 크기는 두 조건에서 같고 에너지 수지의 해석만 다릅니다. 일정 전류: 투입 I dΛ = F dx + dW(자기장 에너지는 ½IdΛ만 증가, 나머지 ½IdΛ가 일). 일정 쇄교자속: 투입 0, F dx = −dW.',
      '공극 단면 하나에 작용하는 힘이며 단위 면적당 B²/(2μ₀)입니다. 철심(μ 큼)에서는 R_m이 공극 g/(μ₀S)가 지배해 μ → ∞ 식에 가까워집니다.'] };
}

function gapForceVerify(p) {
  const method = 'independent central difference of the energy / coenergy', x = 2e-3, h = 1e-5 * Math.max(x, 1e-3), F = gapForce(p, x);
  const energyI = xx => 0.5 * gapInductance(p, xx) * p.current ** 2;
  const linkage = gapInductance(p, x) * p.current, energyL = xx => linkage ** 2 / (2 * gapInductance(p, xx));
  const B = p.turns * p.current * MU0 * p.muR / (p.coreLength + p.muR * x), scale = Math.abs(F) + 1e-300;
  return [checkRow('일정 전류: F = +∂W′/∂x, W′ = ½LI² (x = 2 mm)', method, (energyI(x + h) - energyI(x - h)) / (2 * h), F, 'N', 1e-6, 1e-12 * scale),
    checkRow('일정 쇄교자속: F = −∂W/∂x|Λ, W = Λ²/(2L) (x = 2 mm)', method, -(energyL(x + h) - energyL(x - h)) / (2 * h), F, 'N', 1e-6, 1e-12 * scale),
    checkRow('F = −B²S/(2μ₀) (x = 2 mm, 유한 μ)', 'field-pressure formula', -B * B * p.area / (2 * MU0), F, 'N', 1e-9, 1e-12 * scale)];
}

const gapForceExperiment = defineLecture({
  id: 'induct-virtual-gap', title: '가상변위법 — 공극 코어의 흡인력 F = −B²S/(2μ₀)', topic: TOPIC, week: WEEK, sections: ['8.10'],
  description: '공극 x의 코어: Λ(x) = N²Iμ₀μS/(μ₀l+μx), F = ½I² dL/dx. 일정 전류와 일정 자속의 에너지 수지를 비교합니다(힘은 같음). 그래프에서 공극 x를 끌어 봅니다.',
  answers: ['F'], coordinateScalars: [],
  parameters: gapForceParameters, probeDefault: [0, 0, 2e-3],
  view: { kind: 'profile', plane: 'xz', extent: 1, probeAxes: [0, 2], coordinate: coordinate('x', 'm', '공극 길이') },
  compute: gapForceCompute,
  profile: (p, count) => {
    const xs = linspace(0.2e-3, 6e-3, count);
    return [series('F', '힘 F(x) (− 인력)', 'N', 'x', 'm', xs.map(x => ({ coordinate: x, value: gapForce(p, x) }))),
      series('Finf', 'μ → ∞ 근사 −½N²I²μ₀S/x²', 'N', 'x', 'm', xs.map(x => ({ coordinate: x, value: -0.5 * (p.turns * p.current) ** 2 * MU0 * p.area / (x * x) }))),
      series('L', '인덕턴스 L(x)', 'H', 'x', 'm', xs.map(x => ({ coordinate: x, value: gapInductance(p, x) })))];
  },
  verify: gapForceVerify,
  assumptions: ['공극 하나가 있는 선형 코어, 가장자리 퍼짐·누설 무시. R_m = l/(μS) + x/(μ₀S).',
    '프리셋 N = 500, I = 4 A(NI = 2000), S = 6 cm², l = 0.3π m, μ_r = 4000, x = 2 mm는 b32의 코어를 선형화한 예이며 F ≈ −302 N, B ≈ 1.124 T는 이 앱이 계산한 값입니다.',
    '필기에는 μ → ∞ 식 F = −B²S/(2μ₀)와 유한 μ 식 F = −½N²I²μ₀μ²S/(μ₀l+μd)²(μ = 투자율)가 있습니다. 앱은 μ = μ₀μ_r로 두고 같은 식을 씁니다.'],
  validity: ['x ≥ 0. 그래프 범위는 0.2 … 6 mm입니다. 선형 코어(포화 없음)에서만 맞습니다.'],
  singularities: ['x = 0에서 μ → ∞ 식은 발산하지만 유한 μ 식은 유한합니다(칸에서 μ → ∞ 값은 x > 0에서만 표시).'],
  formulas: [{ label: '인덕턴스', text: 'L(x) = N² μ₀ μ S/(μ₀ l + μ x)', unit: 'H' }, { label: '힘', text: 'F = ½ I² dL/dx = −½ N²I² μ₀ μ² S/(μ₀ l + μ x)²', unit: 'N' },
    { label: '자속밀도 형', text: 'F = −B² S/(2μ₀)', unit: 'N' }],
  references: [hayt('8.10', 'Forces by virtual displacement'), REF.energy],
  symbolic: {
    title: '가상변위법 — 공극 코어 흡인력',
    givens: [['N, I', '감은 수, 전류', '1; A'], ['S, l', '단면적, 코어 길이', 'm²; m'], ['x', '공극 길이', 'm']],
    laws: [['에너지 수지(일정 I)', 'I dΛ = F dx + dW, W = ½ I Λ'], ['일정 쇄교자속', '0 = F dx + dW']],
    steps: [['자기저항', 'R_m = l/(μS) + x/(μ₀S)', ''], ['쇄교자속', 'Λ(x) = N² I/R_m = N² I μ₀ μ S/(μ₀ l + μ x)', ''],
      ['일정 전류', 'F dx = ½ I dΛ → F = ½ I² dL/dx', 'W = ½IΛ가 ½IdΛ만 늘고 나머지 절반이 일이 됩니다.'], ['미분', 'F = −½ N²I² μ₀ μ² S/(μ₀ l + μ x)²', 'x에 관한 L의 도함수는 음수: 인력.'],
      ['자속밀도로', 'B = N I μ₀ μ/(μ₀ l + μ x) → F = −B² S/(2μ₀)', 'μ → ∞이면 B = μ₀NI/x.']],
    answers: [['흡인력', 'F = −B² S/(2μ₀)', 'N', '공극이 닫히는 방향(인력)'], ['μ → ∞ 극한', 'F = −½ N² I² μ₀ S/x²', 'N'], ['단위 면적당', 'F/S = B²/(2μ₀)', 'Pa']],
    limitations: ['선형 코어입니다. 포화가 있으면 L이 I에 의존해 ½I²dL/dx를 쓸 수 없습니다.'],
  },
});

// ---- 10b. Two coaxial solenoids -----------------------------------------------------------------------------------------------
const coilsParameters = [
  parameter('n1', '안쪽 코일의 단위 길이당 감은 수 n₁', '1/m', '1/m', 1, 2000, 1, 1e5),
  parameter('n2', '바깥 코일의 단위 길이당 감은 수 n₂', '1/m', '1/m', 1, 1000, 1, 1e5),
  parameter('r1', '안쪽 코일 반지름 r₁', 'm', 'cm', 0.01, 0.02, 1e-4, 10),
  parameter('muR', '매질의 비투자율 μ_r', '1', '1', 1, 1, 1, 1e4),
  parameter('current1', '안쪽 코일 전류 I₁ (같은 방향이 +)', 'A', 'A', 1, 2, -1000, 1000),
  parameter('current2', '바깥 코일 전류 I₂', 'A', 'A', 1, 1.5, -1000, 1000),
  constraint, displacement,
];

const coilsSlope = p => MU0 * p.muR * p.n1 * p.n2 * area(p.r1); // dM/dx

function coilsCompute(p, x) {
  if (x < 0) return excluded('unsupported', '겹침 길이 x는 0 이상이어야 합니다.', 'negative-overlap');
  const slope = coilsSlope(p), M = slope * x, F = p.current1 * p.current2 * slope, dM = slope * p.dx, constantFlux = p.constraint === 1;
  const dWelec = constantFlux ? 0 : 2 * p.current1 * p.current2 * dM, dWfield = constantFlux ? -p.current1 * p.current2 * dM : p.current1 * p.current2 * dM;
  return { region: constantFlux ? 'constant-flux' : 'constant-current', vectors: {},
    scalars: [scalar('F', '코일 사이 힘 F = I₁I₂ dM/dx (+: 더 겹치는 방향)', F, 'N'), scalar('slope', 'dM/dx = μ n₁n₂ S₁', slope, 'H/m'), scalar('M', '상호 인덕턴스 M(x) = μ n₁n₂ S₁ x', M, 'H'),
      scalar('mutualEnergy', '상호 에너지 M I₁I₂', M * p.current1 * p.current2, 'J'),
      scalar('dWelec', constantFlux ? '전원이 넣은 에너지 (Λ 고정이면 0)' : '전원이 넣은 에너지 I₁dΛ₁ + I₂dΛ₂ = 2I₁I₂dM', dWelec, 'J'),
      scalar('dWfield', '자기장 에너지 증가 dW', dWfield, 'J'), scalar('mechanical', '역학적 일 (투입 − 증가)', dWelec - dWfield, 'J'), scalar('Fdx', '해석적 F·dx', F * p.dx, 'J')],
    notes: ['자기 인덕턴스 항 ½L₁I₁², ½L₂I₂²는 겹침 x에 따라 변하지 않는다고 보면 상호항 M I₁I₂만 x에 의존합니다.',
      '일정 전류: 투입 2I₁I₂dM = F dx + I₁I₂dM → F = I₁I₂ dM/dx. 일정 쇄교자속: 투입 0, F dx = −dW. 두 경우 힘이 같습니다.',
      'I₁I₂ > 0(같은 방향)이면 F > 0: 안쪽 코일이 바깥 코일 속으로 끌려 들어갑니다.'] };
}

function coilsVerify(p) {
  const method = 'independent central difference of the field-energy cross term ∫B₁·H₂ dv', x = 0.17, h = 1e-4;
  const cross = xx => (MU0 * p.muR * p.n1 * p.current1) * (p.n2 * p.current2) * area(p.r1) * xx; // ∫B₁·H₂ dv over the overlap
  const F = p.current1 * p.current2 * coilsSlope(p), scale = Math.abs(F) + 1e-300;
  return [checkRow('F = ∂(∫B₁·H₂ dv)/∂x (일정 전류, x = 0.17 m)', method, (cross(x + h) - cross(x - h)) / (2 * h), F, 'N', 1e-9, 1e-12 * scale),
    checkRow('F = I₁I₂ dM/dx = μ n₁n₂ S₁ I₁I₂', 'closed form', F, MU0 * p.muR * p.n1 * p.n2 * area(p.r1) * p.current1 * p.current2, 'N', 1e-12, 1e-30),
    checkRow('에너지 수지: 투입 − 증가 = F dx', 'bookkeeping of the chosen constraint', coilsCompute(p, x).scalars.find(s => s.key === 'mechanical').value,
      F * p.dx, 'J', 1e-9, 1e-12 * Math.abs(F * p.dx) + 1e-300)];
}

const coils = defineLecture({
  id: 'induct-virtual-coils', title: '가상변위법 — 두 솔레노이드 사이의 힘 F = I₁I₂ dM/dx', topic: TOPIC, week: WEEK, sections: ['8.10'],
  description: '안쪽 코일을 바깥 코일 속으로 x만큼 넣을 때 M(x) = μ n₁n₂ S₁ x: F = I₁I₂ dM/dx = μ n₁n₂ S₁ I₁I₂. 일정 전류와 일정 자속의 수지를 비교합니다.',
  answers: ['F'], coordinateScalars: [],
  parameters: coilsParameters, probeDefault: [0, 0, 0.3],
  view: { kind: 'profile', plane: 'xz', extent: 1, probeAxes: [0, 2], coordinate: coordinate('x', 'm', '코일이 겹친 길이') },
  compute: coilsCompute,
  profile: (p, count) => {
    const xs = linspace(0, 0.5, count), slope = coilsSlope(p);
    return [series('M', '상호 인덕턴스 M(x)', 'H', 'x', 'm', xs.map(x => ({ coordinate: x, value: slope * x }))),
      series('mutualEnergy', '상호 에너지 M(x) I₁I₂', 'J', 'x', 'm', xs.map(x => ({ coordinate: x, value: slope * x * p.current1 * p.current2 })))];
  },
  verify: coilsVerify,
  assumptions: ['안쪽 코일(S₁)이 바깥 코일 속에 겹친 길이 x일 때 M = μ n₁n₂ S₁ x이고 자기 인덕턴스는 x와 무관하다고 둡니다(필기 c24). 가장자리 효과 무시.',
    '프리셋 n₁ = 2000/m, n₂ = 1000/m, r₁ = 2 cm, I₁ = 2 A, I₂ = 1.5 A는 이 앱의 예시입니다.'],
  validity: ['x ≥ 0. 그래프 범위 0 … 0.5 m. 두 코일의 전류 부호는 자유입니다.'],
  singularities: ['특이점은 없습니다.'],
  formulas: [{ label: '힘', text: 'F = I₁ I₂ dM/dx = μ n₁ n₂ S₁ I₁ I₂', unit: 'N' }, { label: '일정 전류의 수지', text: '2 I₁ I₂ dM = F dx + I₁ I₂ dM', unit: 'J' }],
  references: [hayt('8.10', 'Forces by virtual displacement'), REF.mutual],
  symbolic: {
    title: '가상변위법 — 두 솔레노이드의 힘',
    givens: [['n₁, n₂', '단위 길이당 감은 수', '1/m'], ['S₁', '안쪽 코일 단면적', 'm²'], ['I₁, I₂', '전류', 'A']],
    laws: [['에너지 수지(일정 I)', 'I₁dΛ₁ + I₂dΛ₂ = F dx + dW'], ['상호항', 'W = ½L₁I₁² + M I₁I₂ + ½L₂I₂²']],
    steps: [['M(x)', 'M = μ n₁ n₂ S₁ x', 'x는 겹친 길이.'], ['투입 에너지', 'I₁dΛ₁ + I₂dΛ₂ = 2 I₁ I₂ dM', 'L₁, L₂ 항은 변하지 않음.'],
      ['자기장 에너지 증가', 'dW = I₁ I₂ dM', ''], ['힘', 'F dx = 2I₁I₂dM − I₁I₂dM → F = I₁ I₂ dM/dx', '']],
    answers: [['코일 사이의 힘', 'F = I₁ I₂ dM/dx = μ n₁ n₂ S₁ I₁ I₂', 'N', 'I₁I₂ > 0이면 겹치는 방향(인력)'], ['일정 자속의 경우', 'F = −∂W/∂x|Λ = I₁ I₂ dM/dx', 'N']],
    limitations: ['M이 x에 선형인 이상 모형입니다.'],
  },
});

export const EXPERIMENTS = [gapForceExperiment, coils];
