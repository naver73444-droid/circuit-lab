// Hayt Ch.8 §8.1–8.4 lecture experiments: magnetic forces and torques. Pure: no DOM.
// Sweep coordinate (point[2]): orbit phase, distance, angle or axial position, named per experiment by view.coordinate.
import { AMU, C, E_CHARGE, SPEED_LIMIT_RATIO } from './em-course-constants.js';
import {
  FOUR_PI, MU0, REF, TWO_PI, checkRow, coordinate, defineLecture, excluded, hayt, linspace, parameter, scalar, series,
} from './em-course-lecture.js';

const TOPIC = 'forces';
const WEEK = 6;
const hr = Math.hypot;

// ---- 1. Lorentz force: circular orbit ------------------------------------------------------------------------------------
const lorentzParameters = [
  parameter('chargeE', '전하 q (기본전하 e의 배수, 부호 포함)', '1', '1', 1, 1, -10, 10),
  parameter('mass', '입자 질량 m', 'kg', 'u', AMU, 1.007276 * AMU, 5.485799e-4 * AMU, 500 * AMU),
  parameter('speed', '속력 v (B에 수직으로 입사)', 'm/s', 'm/s', 1, 1e6, 0, 2.9e7),
  parameter('B0', '자속밀도 B (+z 방향, 단위 T = Wb/m²)', 'T', 'T', 1, 0.1, 1e-6, 20),
];

function lorentzOrbit(p) {
  const q = p.chargeE * E_CHARGE, absq = Math.abs(q), omega = absq * p.B0 / p.mass;
  return { q, omega, radius: p.mass * p.speed / (absq * p.B0), sign: Math.sign(q) };
}

function lorentzCompute(p, phase) {
  const { q, omega, radius, sign } = lorentzOrbit(p), v = p.speed, B = p.B0;
  // Start at the origin moving along +y: x = s r (1 - cos(Ωt)), y = r sin(Ωt), center at (s r, 0).
  const x = sign * radius * (1 - Math.cos(phase)), y = radius * Math.sin(phase);
  const vx = sign * v * Math.sin(phase), vy = v * Math.cos(phase);
  const fx = q * vy * B, fy = -q * vx * B;
  const kinetic = 0.5 * p.mass * v * v;
  const notes = ['v ⟂ B이므로 F·v = 0: 자기력은 일을 하지 않아 운동에너지(속력)는 일정하고 방향만 바뀝니다.',
    '정지 입자(v=0)는 F = q v×B = 0 이라 자기력을 받지 않습니다.',
    q > 0 ? 'q>0: +z 쪽에서 볼 때 시계 방향으로 돕니다(각속도 −qB/m ẑ).' : 'q<0: +z 쪽에서 볼 때 반시계 방향으로 돕니다.'];
  if (v > SPEED_LIMIT_RATIO * C) notes.push('v가 광속의 10 %를 넘어 비상대론 공식은 근사입니다.');
  return {
    region: v === 0 ? 'at-rest' : 'orbit', vectors: { B: [0, 0, B] },
    scalars: [scalar('radius', '궤도 반지름 r = mv/(|q|B)', radius, 'm'), scalar('omegaC', '사이클로트론 각진동수 ω_c = |q|B/m', omega, 'rad/s'),
      scalar('frequency', '사이클로트론 주파수 f_c', omega / TWO_PI, 'Hz'), scalar('period', '주기 T = 2πm/(|q|B)', TWO_PI / omega, 's'),
      scalar('kinetic', '운동에너지 ½mv² (일정)', kinetic, 'J'), scalar('kineticEv', '운동에너지 ½mv²', kinetic / E_CHARGE, 'eV'),
      scalar('force', '자기력 크기 |q|vB', Math.abs(q) * v * B, 'N'), scalar('work', '자기력의 일률 F·v', 0, 'W'),
      scalar('phase', '궤도 위상 Ωt', phase, 'rad'), scalar('x', '위치 x', x, 'm'), scalar('y', '위치 y', y, 'm'),
      scalar('vx', '속도 v_x', vx, 'm/s'), scalar('vy', '속도 v_y', vy, 'm/s'), scalar('Fx', '힘 F_x', fx, 'N'), scalar('Fy', '힘 F_y', fy, 'N')],
    notes,
  };
}

function lorentzVerify(p) {
  const method = 'independent RK4 integration of m dv/dt = q v×B, 4000 steps per period';
  const { q, omega, radius, sign } = lorentzOrbit(p), B = p.B0, qm = q / p.mass, period = TWO_PI / omega, steps = 4000, dt = period / steps;
  const f = s => [s[2], s[3], qm * s[3] * B, -qm * s[2] * B];
  const axpy = (s, k, h) => s.map((value, i) => value + h * k[i]);
  let state = [0, 0, 0, p.speed];
  const at = {};
  for (let i = 1; i <= steps; i++) {
    const k1 = f(state), k2 = f(axpy(state, k1, dt / 2)), k3 = f(axpy(state, k2, dt / 2)), k4 = f(axpy(state, k3, dt));
    state = state.map((value, j) => value + dt / 6 * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j]));
    if (i === steps / 4 || i === steps / 2 || i === steps) at[i] = state;
  }
  const tol = 1e-9, abs = 1e-9 * radius + 1e-300, kinetic = 0.5 * p.mass * p.speed ** 2;
  return [
    checkRow('x(T/4) = ±r', method, at[steps / 4][0], sign * radius, 'm', tol, abs),
    checkRow('y(T/4) = r', method, at[steps / 4][1], radius, 'm', tol, abs),
    checkRow('x(T/2) = ±2r (지름 반대편)', method, at[steps / 2][0], 2 * sign * radius, 'm', tol, abs),
    checkRow('한 주기 뒤 x = 0 (닫힌 궤도)', method, at[steps][0], 0, 'm', tol, abs),
    checkRow('한 주기 뒤 운동에너지 불변', method, 0.5 * p.mass * (at[steps][2] ** 2 + at[steps][3] ** 2), kinetic, 'J', 1e-9, 1e-300),
  ];
}

const lorentz = defineLecture({
  id: 'force-lorentz', title: '로런츠 힘 — 균일 B 속 원운동 · 6주차 §8.1', topic: TOPIC, week: WEEK, sections: ['8.1'],
  description: '자기장에 수직으로 입사한 하전입자의 원궤도: r = mv/(qB), ω_c = qB/m, 주기. 이온 임플랜터에서 질량 선택에 쓰는 원리입니다.',
  parameters: lorentzParameters, probeDefault: [0, 0, Math.PI / 2],
  view: { kind: 'xy-curve', plane: 'xy', extent: 1, probeAxes: [0, 1], coordinate: coordinate('Ωt', 'rad', '궤도 위상'),
    curve: { xLabel: 'x', xUnit: 'm', yLabel: 'y', yUnit: 'm', equal: true, marker: { x: 'x', y: 'y' }, sweep: () => [0, TWO_PI] } },
  validate: p => (p.chargeE === 0 ? '전하가 0이면 힘이 없어 궤도가 직선입니다. 0이 아닌 q를 입력하세요.' : ''),
  compute: lorentzCompute, profile: (p, count) => {
    const points = linspace(0, TWO_PI, count).map(phase => lorentzCompute(p, phase).scalars).map(s => ({ coordinate: s[9].value, value: s[10].value }));
    return [series('orbit', '궤도 y(x)', 'm', 'x', 'm', points)];
  },
  verify: lorentzVerify,
  assumptions: ['시간에 따라 변하지 않는 균일 B(+z)와 E=0. 입자는 처음에 원점에서 +y 방향으로 속력 v로 출발(v ⟂ B)합니다.',
    '비상대론(v ≪ c). 복사 손실과 입자 사이의 힘, B의 비균일은 무시합니다.',
    '프리셋은 양성자(m = 1.007276 u, q = +e)가 0.1 T에서 1×10⁶ m/s로 움직이는 이온 임플랜터형 예: r ≈ 0.1044 m, f_c ≈ 1.525 MHz (강의 숫자가 아니라 이 앱에서 계산한 값).'],
  validity: ['q ≠ 0, B > 0, 0 ≤ v ≤ 2.9×10⁷ m/s. v=0이면 r=0이고 힘이 0입니다.', '위상 Ωt는 한 주기 2π마다 같은 점으로 돌아옵니다.'],
  singularities: ['특이점은 없습니다. q=0은 입력 오류로 처리하고 값을 보정하지 않습니다.'],
  formulas: [{ label: '로런츠 힘', text: 'F = q(E + v×B)', unit: 'N' }, { label: '반지름', text: 'r = m v/(|q| B)', unit: 'm' },
    { label: '사이클로트론 진동수', text: 'ω_c = |q| B/m; T = 2π m/(|q| B)', unit: 'rad/s' }, { label: '일', text: 'F·v = q (v×B)·v = 0', unit: 'W' }],
  references: [hayt('8.1', 'Force on a moving charge'), REF.motion],
  symbolic: {
    title: '균일 자기장 속 하전입자의 원운동 — 기호 풀이',
    givens: [['q', '입자 전하 (부호 포함)', 'C', 'q ≠ 0'], ['m', '입자 질량', 'kg', 'm > 0'], ['v', 'B에 수직인 속력', 'm/s', 'v ≥ 0'], ['B', '+z 방향 자속밀도', 'T', 'B > 0']],
    laws: [['로런츠 힘 (자기항)', 'F = q v×B'], ['뉴턴 제2법칙', 'm dv/dt = q v×B']],
    steps: [['힘은 속도에 수직', 'F·v = 0', '일을 하지 않으므로 속력 v가 일정하고 방향만 바뀝니다.'],
      ['구심력 조건', 'm v²/r = |q| v B', '원운동의 구심력을 자기력이 공급합니다.'],
      ['반지름', 'r = m v/(|q| B)', 'v가 크거나 m이 크면 크게 돌고 B가 크면 작게 돕니다.'],
      ['각진동수와 주기', 'ω_c = v/r = |q| B/m; T = 2π m/(|q| B)', '주기는 v에 무관합니다: 질량 선택(질량분석)의 근거.']],
    answers: [['반지름 r', 'r = m v/(|q| B)', 'm', 'q>0이면 +z에서 볼 때 시계 방향'], ['사이클로트론 각진동수', 'ω_c = |q| B/m', 'rad/s'],
      ['주기', 'T = 2π m/(|q| B)', 's'], ['자기력이 한 일', 'W = F·v dt = 0', 'J']],
    conditions: ['v ⟂ B, 비상대론, E = 0'],
    limitations: ['v가 B와 평행한 성분을 가지면 나선 운동이 되지만 이 실험은 v ⟂ B만 다룹니다.'],
  },
});

// ---- 2. Straight wire + rectangular loop ---------------------------------------------------------------------------------
const wireLoopParameters = [
  parameter('current', '직선 도선 전류 I (강의 설정: 부호 + = −y 방향)', 'A', 'A', 1, 15, -1000, 1000),
  parameter('loopCurrent', '루프 전류 I₁ (반시계가 +)', 'A', 'mA', 1e-3, 2e-3, -100, 100),
  parameter('d1', '가까운 변까지 거리 d₁', 'm', 'm', 1, 1, 1e-3, 100),
  parameter('d2', '먼 변까지 거리 d₂ (d₂ > d₁)', 'm', 'm', 1, 3, 1e-3, 100),
  parameter('length', '변 ②·④의 길이 ℓ', 'm', 'm', 1, 2, 1e-3, 100),
];

function wireLoopForces(p) {
  const k = MU0 * p.current / TWO_PI, I1 = p.loopCurrent;
  const f1y = -I1 * k * Math.log(p.d2 / p.d1), f3y = -f1y;
  const f2x = -I1 * k * p.length / p.d1, f4x = I1 * k * p.length / p.d2;
  return { k, f1y, f3y, f2x, f4x, netX: f2x + f4x, netY: f1y + f3y };
}

function wireLoopCompute(p, rho) {
  if (!(rho > 0)) return excluded('singular', '직선 도선 위(ρ ≤ 0)에서는 B를 정의하지 않습니다. 도선에서 떨어진 거리를 양수로 두세요.', 'wire-axis');
  const forces = wireLoopForces(p), bz = forces.k / rho;
  return {
    region: 'nonuniform-field', vectors: { B: [0, 0, bz] },
    scalars: [scalar('B', '거리 ρ에서 도선의 B', bz, 'T'), scalar('lineForce', '그 거리의 변이 받는 단위 길이 힘 I₁B', p.loopCurrent * bz, 'N/m'),
      scalar('F1y', '변 ① 힘 F₁ (y 성분)', forces.f1y, 'N'), scalar('F3y', '변 ③ 힘 F₃ (y 성분)', forces.f3y, 'N'),
      scalar('F13', 'F₁ + F₃', forces.f1y + forces.f3y, 'N'),
      scalar('F2x', '변 ② 힘 F₂ (x 성분, 도선 쪽이 −)', forces.f2x, 'N'), scalar('F4x', '변 ④ 힘 F₄ (x 성분)', forces.f4x, 'N'),
      scalar('netX', '루프 알짜힘 F_x', forces.netX, 'N'), scalar('netY', '루프 알짜힘 F_y', forces.netY, 'N')],
    notes: ['변 ①·③은 x 방향 변으로 같은 크기·반대 방향의 힘이라 합이 0입니다. 변 ②·④는 B가 일정한 y 방향 변입니다.',
      '균일한 B에서는 닫힌 루프의 알짜힘이 0이지만, 직선전류의 B는 1/ρ로 변해 알짜힘이 0이 아닙니다.',
      'I·I₁ > 0(강의 설정)이면 알짜힘은 도선 쪽(−x)입니다. 가까운 변 ②는 끌리고 먼 변 ④는 약하게 밀립니다.'],
  };
}

function wireLoopVerify(p) {
  const method = 'independent midpoint quadrature of I₁ ∮ dl×B around the rectangle, 4000 geometric cells per side', cells = 4000;
  const closed = wireLoopForces(p), I1 = p.loopCurrent, bAt = x => MU0 * p.current / (TWO_PI * x);
  // dl×ẑ = (dy, −dx, 0); corners (d1,0) → (d2,0) → (d2,ℓ) → (d1,ℓ) → (d1,0): counter-clockwise.
  const sums = { f1y: 0, f2x: 0, f3y: 0, f4x: 0 }, dy = p.length / cells, ratio = (p.d2 / p.d1) ** (1 / cells);
  let left = p.d1;
  for (let i = 0; i < cells; i++) {
    const right = i === cells - 1 ? p.d2 : left * ratio, x = (left + right) / 2, dx = right - left; // geometric cells keep a wide d₂/d₁ resolved
    left = right;
    sums.f1y += -I1 * bAt(x) * dx; // ① bottom edge, +x
    sums.f3y += I1 * bAt(x) * dx; // ③ top edge, −x
    sums.f4x += I1 * bAt(p.d2) * dy; // ④ right edge, +y
    sums.f2x += -I1 * bAt(p.d1) * dy; // ② left edge, −y
  }
  const scale = Math.abs(I1 * bAt(p.d1) * p.length) + 1e-300;
  return [
    checkRow('변 ① 힘 F₁ = −I₁ (μ₀I/2π) ln(d₂/d₁)', method, sums.f1y, closed.f1y, 'N', 1e-5, 1e-12 * scale),
    checkRow('변 ② 힘 F₂ = −μ₀ I I₁ ℓ/(2π d₁)', method, sums.f2x, closed.f2x, 'N', 1e-9, 1e-12 * scale),
    checkRow('변 ④ 힘 F₄ = +μ₀ I I₁ ℓ/(2π d₂)', method, sums.f4x, closed.f4x, 'N', 1e-9, 1e-12 * scale),
    checkRow('알짜힘 F_x = F₂ + F₄', method, sums.f2x + sums.f4x, closed.netX, 'N', 1e-9, 1e-12 * scale),
    checkRow('F₁ + F₃ = 0 (상쇄)', method, sums.f1y + sums.f3y, 0, 'N', 0, 1e-9 * scale),
  ];
}

const wireLoop = defineLecture({
  id: 'force-wire-loop', title: '직선전류 옆 직사각 루프의 힘 · 6주차 §8.2', topic: TOPIC, week: WEEK, sections: ['8.2'],
  description: '무한 직선전류의 비균일 B 속 직사각 루프: 변별 힘과 알짜힘. 변 ①·③은 상쇄하고 변 ②·④가 알짜힘을 만듭니다.',
  parameters: wireLoopParameters, probeDefault: [0, 0, 1],
  view: { kind: 'profile', plane: 'xz', extent: 1, probeAxes: [0, 2], coordinate: coordinate('ρ', 'm', '도선으로부터의 거리') },
  validate: p => (p.d2 > p.d1 ? '' : '먼 변까지 거리 d₂는 가까운 변까지 거리 d₁보다 커야 합니다.'),
  compute: wireLoopCompute,
  profile: (p, count) => {
    const rho = linspace(0.25 * p.d1, 1.5 * p.d2, count), b = rho.map(r => MU0 * p.current / (TWO_PI * r));
    return [series('B', 'B(ρ) 직선전류의 자기선속밀도', 'T', 'ρ', 'm', rho.map((r, i) => ({ coordinate: r, value: b[i] }))),
      series('lineForce', 'I₁B(ρ) 루프 변의 단위 길이 힘', 'N/m', 'ρ', 'm', rho.map((r, i) => ({ coordinate: r, value: p.loopCurrent * b[i] })))];
  },
  verify: wireLoopVerify,
  assumptions: ['도선은 x=0의 y 방향 무한 직선, 루프는 xy 평면의 직사각형(x: d₁…d₂, y: 0…ℓ)이며 루프 전류 I₁은 반시계가 +입니다.',
    '강의 설정: I > 0은 −y 방향(필기의 I = −15 a_y), 이때 도선 오른쪽(x>0)에서 B = μ₀I/(2πx) +z 입니다.',
    '프리셋 I = 15 A, I₁ = 2 mA, d₁ = 1 m, d₂ = 3 m, ℓ = 2 m: F₂ = −12 nN, F₄ = +4 nN, 알짜 −8 nN, |F₁| = 6.59 nN은 필기에 최종 숫자가 없어 이 앱이 계산한 값입니다(μ₀ = 4π×10⁻⁷와 CODATA 값의 차이는 1.5×10⁻¹⁰).',
    '루프가 만드는 도선 쪽의 반작용, 루프의 자체 B, 도선의 굵기는 무시합니다.'],
  validity: ['0 < d₁ < d₂, ℓ > 0, 루프 전체가 도선의 같은 쪽(x>0)에 있어야 합니다.', '그래프의 관측점 ρ는 양수여야 합니다.'],
  singularities: ['ρ = 0(도선 위)에서는 B가 발산하므로 singular로 표시하고 값을 만들지 않습니다.'],
  formulas: [{ label: '직선전류의 B', text: 'B = μ₀ I/(2π ρ) ẑ', unit: 'T' }, { label: '변 ②·④', text: 'F = I₁ ℓ μ₀ I/(2π d)', unit: 'N' },
    { label: '변 ①', text: 'F₁ = I₁ (μ₀ I/2π) ln(d₂/d₁)', unit: 'N' }, { label: '알짜힘', text: 'F = F₂ + F₄ = (μ₀ I I₁ ℓ/2π)(1/d₂ − 1/d₁)', unit: 'N' }],
  references: [hayt('8.2', 'Force on a differential current element'), REF.conductor],
  symbolic: {
    title: '직선전류 옆 직사각 루프 — 변별 힘과 알짜힘',
    givens: [['I', '직선 도선의 전류 크기', 'A', 'I ≥ 0'], ['I₁', '루프 전류(반시계)', 'A'], ['d₁, d₂', '가까운/먼 변까지 거리', 'm', '0 < d₁ < d₂'], ['ℓ', '변 ②·④ 길이', 'm', 'ℓ > 0']],
    laws: [['전류 요소가 받는 힘', 'dF = I₁ dl × B'], ['직선전류의 장', 'B(x) = μ₀ I/(2π x) ẑ']],
    steps: [['변 ①, ③ (x 방향)', 'F₁ = −I₁ ∫ B dx ŷ, F₃ = +I₁ ∫ B dx ŷ', '같은 적분이 전류 방향만 반대: F₁ + F₃ = 0.'],
      ['변 ② (x = d₁)', 'F₂ = I₁ ℓ B(d₁) (−x̂)', 'B가 상수인 y 방향 변이라 곱으로 끝납니다.'],
      ['변 ④ (x = d₂)', 'F₄ = I₁ ℓ B(d₂) (+x̂)', '전류가 반대 방향이고 B가 작아 힘도 작습니다.'],
      ['알짜힘', 'F = F₂ + F₄ = (μ₀ I I₁ ℓ/2π)(1/d₂ − 1/d₁) x̂', 'd₁ < d₂이므로 음(도선 쪽): 균일장이 아니어서 0이 아닙니다.']],
    answers: [['변 ② 힘', 'F₂ = −μ₀ I I₁ ℓ/(2π d₁)', 'N', '도선 쪽(−x)'], ['변 ④ 힘', 'F₄ = μ₀ I I₁ ℓ/(2π d₂)', 'N', '도선 반대쪽(+x)'],
      ['알짜힘', 'F = (μ₀ I I₁ ℓ/2π)(1/d₂ − 1/d₁)', 'N', '도선 쪽(−x)'], ['변 ①+③', 'F₁ + F₃ = 0', 'N']],
    limitations: ['루프의 반작용과 루프 자체의 장은 계산하지 않습니다.'],
  },
});

// ---- 3a. Parallel wires --------------------------------------------------------------------------------------------------
const parallelWiresParameters = [
  parameter('current1', '도선 1의 전류 I₁', 'A', 'A', 1, 1, -1e4, 1e4),
  parameter('current2', '도선 2의 전류 I₂ (같은 방향이 +)', 'A', 'A', 1, 1, -1e4, 1e4),
  parameter('length', '비교할 도선 길이 ℓ', 'm', 'm', 1, 1, 1e-6, 1e4),
];

function parallelWiresCompute(p, d) {
  if (!(d > 0)) return excluded('singular', '두 도선 사이의 거리 d는 양수여야 합니다.', 'zero-distance');
  const b1 = MU0 * p.current1 / (TWO_PI * d), attract = MU0 * p.current1 * p.current2 / (TWO_PI * d);
  return {
    region: attract > 0 ? 'attract' : attract < 0 ? 'repel' : 'no-force', vectors: { B: [0, 0, b1] },
    scalars: [scalar('B1', '도선 1이 도선 2 자리에 만드는 B', b1, 'T'), scalar('perLength', '단위 길이당 힘 μ₀I₁I₂/(2πd) (+ 인력)', attract, 'N/m'),
      scalar('total', '길이 ℓ에 작용하는 힘 (+ 인력)', attract * p.length, 'N'), scalar('distance', '도선 사이 거리 d', d, 'm')],
    notes: ['같은 방향 전류(I₁I₂ > 0)는 끌어당기고 반대 방향은 밀어냅니다.',
      'I₁ = I₂ = 1 A, d = 1 m이면 단위 길이당 2×10⁻⁷ N/m: 옛 SI의 암페어 정의(MKSA)입니다.'],
  };
}

function parallelWiresVerify(p) {
  const method = 'independent Biot–Savart quadrature over θ (infinite wire), 2048 cells', count = 2048, step = Math.PI / count;
  let integral = 0;
  for (let i = 0; i < count; i++) integral += Math.cos(-Math.PI / 2 + (i + 0.5) * step) * step;
  const d = 1, quad = MU0 * p.current1 / (FOUR_PI * d) * integral;
  const definition = parallelWiresCompute({ current1: 1, current2: 1, length: 1 }, 1).scalars.find(s => s.key === 'perLength').value;
  return [checkRow('도선 1의 B(d=1 m): Biot–Savart 적분 = μ₀I₁/(2πd)', method, quad, MU0 * p.current1 / TWO_PI, 'T', 1e-6, 1e-18),
    checkRow('힘 I₂B = μ₀I₁I₂/(2πd) (d=1 m)', method, p.current2 * quad, parallelWiresCompute(p, 1).scalars.find(s => s.key === 'perLength').value, 'N/m', 1e-6, 1e-18),
    checkRow('1 A, 1 A, 1 m → 2×10⁻⁷ N/m (MKSA 정의)', 'definition of the ampere (μ₀ = 4π×10⁻⁷)', definition, 2e-7, 'N/m', 1e-9)];
}

const parallelWires = defineLecture({
  id: 'force-parallel-wires', title: '평행한 두 직선 도선 사이의 힘 · 6주차 §8.3', topic: TOPIC, week: WEEK, sections: ['8.3'],
  description: '도선 1의 B 속에 놓인 도선 2의 힘: 단위 길이당 μ₀I₁I₂/(2πd). 그래프에서 거리 d를 끌어 바꿉니다.',
  parameters: parallelWiresParameters, probeDefault: [0, 0, 1],
  view: { kind: 'profile', plane: 'xz', extent: 1, probeAxes: [0, 2], coordinate: coordinate('d', 'm', '두 도선의 간격') },
  compute: parallelWiresCompute,
  profile: (p, count) => {
    const d = linspace(0.1, 3, count);
    return [series('perLength', '단위 길이당 힘 (+ 인력)', 'N/m', 'd', 'm', d.map(x => ({ coordinate: x, value: MU0 * p.current1 * p.current2 / (TWO_PI * x) }))),
      series('B1', '도선 1의 B(d)', 'T', 'd', 'm', d.map(x => ({ coordinate: x, value: MU0 * p.current1 / (TWO_PI * x) })))];
  },
  verify: parallelWiresVerify,
  assumptions: ['무한히 긴 평행 직선 도선, 진공, 정상 전류. 두 도선은 서로의 장만 느끼고 자기 자신의 장은 제외합니다.',
    '프리셋 I₁ = I₂ = 1 A, d = 1 m는 강의 복습 19쪽의 MKSA 정의 예입니다: 2×10⁻⁷ N/m (μ₀ = 4π×10⁻⁷ 기준).'],
  validity: ['d > 0. 그래프 범위는 0.1 … 3 m입니다. 도선 지름 ≪ d를 가정합니다.'],
  singularities: ['d = 0에서는 힘이 발산하므로 singular로 표시합니다.'],
  formulas: [{ label: '도선 1의 B', text: 'B₁ = μ₀ I₁/(2π d)', unit: 'T' }, { label: '단위 길이당 힘', text: 'F/ℓ = I₂ B₁ = μ₀ I₁ I₂/(2π d)', unit: 'N/m' }],
  references: [hayt('8.3', 'Force between differential current elements'), REF.parallel],
  symbolic: {
    title: '평행한 두 도선 사이의 힘 — 기호 풀이',
    givens: [['I₁, I₂', '두 도선의 전류(같은 방향이 +)', 'A'], ['d', '도선 사이 거리', 'm', 'd > 0'], ['ℓ', '도선 길이', 'm']],
    laws: [['직선전류의 B', 'B₁ = μ₀ I₁/(2π d)'], ['전류 요소의 힘', 'dF = I₂ dl × B₁']],
    steps: [['도선 1의 장', 'B₁ = μ₀ I₁/(2π d) φ̂', '도선 2 자리에서 B₁은 도선 2와 수직입니다.'],
      ['도선 2에 작용하는 힘', 'F = I₂ ℓ B₁', 'dl ⟂ B₁이므로 크기는 곱입니다.'], ['단위 길이당 힘', 'F/ℓ = μ₀ I₁ I₂/(2π d)', '방향: 같은 방향 전류는 서로 끌어당깁니다.']],
    answers: [['단위 길이당 힘', 'F/ℓ = μ₀ I₁ I₂/(2π d)', 'N/m', '같은 방향이면 인력'], ['길이 ℓ의 힘', 'F = μ₀ I₁ I₂ ℓ/(2π d)', 'N']],
    limitations: ['유한 길이 도선의 끝 효과는 포함하지 않습니다.'],
  },
});

// ---- 3b. Parallel current sheets -----------------------------------------------------------------------------------------
const sheetsParameters = [
  parameter('K', '면전류밀도 K (위 판 +K x̂, 아래 판 −K x̂)', 'A/m', 'A/m', 1, 100, -1e6, 1e6),
  parameter('separation', '판 사이 간격 d (z = 0 … d)', 'm', 'mm', 1e-3, 0.05, 1e-4, 10),
  parameter('area', '비교할 판 면적 A', 'm²', 'm²', 1, 1, 1e-6, 1e4),
];

function sheetsCompute(p, z) {
  const between = MU0 * p.K, d = p.separation, pressure = MU0 * p.K * p.K / 2, onSheet = z === 0 || z === d, inside = z > 0 && z < d;
  const by = inside ? between : onSheet ? between / 2 : 0;
  const scalars = [scalar('Bbetween', '판 사이 B = μ₀K', between, 'T'), scalar('Bsingle', '판 하나가 만드는 B = μ₀K/2', between / 2, 'T'),
    scalar('Boutside', '판 바깥의 B', 0, 'T'), scalar('pressure', '판이 받는 압력 μ₀K²/2 (바깥쪽 척력)', pressure, 'Pa'),
    scalar('force', '면적 A의 판이 받는 힘', pressure * p.area, 'N'), scalar('energyDensity', '판 사이 에너지 밀도 B²/(2μ₀)', between * between / (2 * MU0), 'J/m³'),
    scalar('By', '관측 위치의 B_y', by, 'T')];
  const notes = ['위 판이 받는 힘은 K x̂ × (μ₀K/2) ŷ: 자기 자신이 만든 장을 뺀 평균장 μ₀K/2를 씁니다.',
    '그 값 μ₀K²/2는 판 사이의 자기 에너지 밀도와 같고, 두 판은 서로 밀어냅니다(반대 방향 전류).'];
  if (onSheet) return { status: 'boundary', reason: '면전류 위에서는 B가 불연속입니다. 양쪽 극한은 0과 μ₀K이고 평균은 μ₀K/2입니다.', region: 'on-sheet', vectors: {}, scalars, notes };
  return { region: inside ? 'between-sheets' : 'outside', vectors: { B: [0, by, 0] }, scalars, notes };
}

const steps = (z0, z1, d, high) => [[z0, 0], [0, 0], [0, high], [d, high], [d, 0], [z1, 0]];

function sheetsVerify(p) {
  const method = 'independent filament integral: each strip K dy′ is a line current μ₀K dy′/(2πR); y′ = h tan φ, 4096 cells', count = 4096, h = p.separation / 2;
  let single = 0;
  for (let i = 0; i < count; i++) {
    const phi = -Math.PI / 2 + (i + 0.5) * Math.PI / count, yPrime = h * Math.tan(phi), dy = h / Math.cos(phi) ** 2 * (Math.PI / count);
    const radius = Math.hypot(h, yPrime);
    single += MU0 * p.K * dy / (TWO_PI * radius) * (h / radius);
  }
  // force on the top sheet: each strip meets the bottom sheet's field; force density K × B_single.
  const topPressure = Math.abs(p.K) * Math.abs(single);
  return [checkRow('판 하나의 B = μ₀K/2 (필라멘트 적분)', method, single, MU0 * p.K / 2, 'T', 1e-9, 1e-18),
    checkRow('두 판 사이의 B = 2 × (μ₀K/2) = μ₀K', method, 2 * single, MU0 * p.K, 'T', 1e-9, 1e-18),
    checkRow('판이 받는 압력 K·(μ₀K/2) = 사이 에너지 밀도 B²/(2μ₀)', method, topPressure, (MU0 * p.K) ** 2 / (2 * MU0), 'Pa', 1e-9, 1e-18)];
}

const sheets = defineLecture({
  id: 'force-parallel-sheets', title: '평행 면전류판 사이의 B와 힘 · 6주차 §8.3', topic: TOPIC, week: WEEK, sections: ['8.3'],
  description: '반대 방향 면전류 ±K: 사이 B = μ₀K, 바깥 B = 0, 판이 받는 압력 μ₀K²/2(= 사이 에너지 밀도).',
  parameters: sheetsParameters, probeDefault: [0, 0, 0.025],
  view: { kind: 'profile', plane: 'xz', extent: 1, probeAxes: [0, 2], coordinate: coordinate('z', 'm', '판에 수직인 위치') },
  compute: sheetsCompute,
  profile: p => {
    const d = p.separation, high = MU0 * p.K, to = list => list.map(([c, v]) => ({ coordinate: c, value: v }));
    return [series('By', 'B_y(z)', 'T', 'z', 'm', to(steps(-d, 2 * d, d, high))),
      series('energy', '에너지 밀도 B²/(2μ₀)', 'J/m³', 'z', 'm', to(steps(-d, 2 * d, d, high * high / (2 * MU0))))];
  },
  verify: sheetsVerify,
  assumptions: ['z = 0의 아래 판은 −K x̂, z = d의 위 판은 +K x̂ 면전류를 갖는 무한히 넓은 얇은 판이며 진공입니다.',
    '판 하나가 만드는 장 μ₀K/2는 a_n 방향에 따라 방향이 바뀌고, 판이 받는 힘에는 자기 자신의 장을 제외한 평균장을 씁니다.'],
  validity: ['판 사이 간격 d ≪ 판의 크기. 가장자리 효과는 없습니다.', 'K = 0이면 모든 장과 힘이 0입니다.'],
  singularities: ['z = 0, d (판 위)에서는 B가 불연속이라 boundary로 표시하고 양쪽 극한을 설명합니다.'],
  formulas: [{ label: '판 하나', text: 'B = (μ₀K/2) K̂ × a_n', unit: 'T' }, { label: '두 판 사이', text: 'B = μ₀ K ŷ', unit: 'T' },
    { label: '압력', text: 'F/A = K (μ₀K/2) = μ₀K²/2 = B²/(2μ₀)', unit: 'Pa' }],
  references: [hayt('8.3', 'Force between current sheets'), REF.parallel],
  symbolic: {
    title: '평행 면전류판 — B와 힘',
    givens: [['K', '면전류밀도 크기', 'A/m'], ['d', '판 간격', 'm'], ['A', '판 면적', 'm²']],
    laws: [['면전류의 장', 'B = (μ₀/2) K × a_n'], ['면전류에 작용하는 힘', 'dF = (K × B) dS']],
    steps: [['판 하나의 장', 'B₁ = μ₀K/2 (사이와 바깥에서 방향이 반대)', '두 판 사이에서는 같은 방향으로 더해집니다.'],
      ['중첩', '사이: μ₀K ŷ, 바깥: 0', '바깥에서는 반대 방향이라 상쇄합니다.'],
      ['위 판이 받는 힘', 'dF/dS = K x̂ × (μ₀K/2) ŷ = (μ₀K²/2) ẑ', '자기 자신의 장은 제외한 평균장 μ₀K/2를 씁니다.'],
      ['에너지 밀도와 비교', 'B²/(2μ₀) = μ₀K²/2', '압력과 같습니다.']],
    answers: [['판 사이의 B', 'B = μ₀ K ŷ', 'T'], ['압력', 'p = μ₀K²/2', 'Pa', '서로 밀어냄(바깥쪽)'], ['면적 A의 힘', 'F = μ₀ K² A/2', 'N']],
    limitations: ['무한 평판 근사입니다.'],
  },
});

// ---- 3c. Solenoid magnetic pressure --------------------------------------------------------------------------------------
const solenoidPressureParameters = [
  parameter('turnsPerMeter', '단위 길이당 감은 수 n', '1/m', '1/m', 1, 1000, 1, 1e5),
  parameter('current', '코일 전류 I', 'A', 'A', 1, 10, -1000, 1000),
  parameter('radius', '솔레노이드 반지름 a', 'm', 'mm', 1e-3, 0.05, 1e-4, 10),
];

function solenoidPressureCompute(p, rho) {
  if (rho < 0) return excluded('unsupported', '반지름 방향 좌표 ρ는 0 이상이어야 합니다.', 'negative-rho');
  const a = p.radius, B = MU0 * p.turnsPerMeter * p.current, pressure = B * B / (2 * MU0), K = p.turnsPerMeter * p.current;
  const lPrime = MU0 * p.turnsPerMeter ** 2 * Math.PI * a * a;
  const scalars = [scalar('Binside', '내부 B = μ₀nI', B, 'T'), scalar('K', '표면 전류밀도 K = nI', K, 'A/m'),
    scalar('pressure', '벽에 작용하는 자기압 B²/(2μ₀)', pressure, 'Pa'), scalar('wallForce', '단위 길이 벽 전체의 바깥 방향 힘 p·2πa', pressure * TWO_PI * a, 'N/m'),
    scalar('Lprime', '단위 길이당 인덕턴스 L′ = μ₀n²πa²', lPrime, 'H/m'), scalar('energyDensity', '내부 에너지 밀도 B²/(2μ₀)', pressure, 'J/m³'),
    scalar('Bz', '관측 위치의 B_z', rho < a ? B : rho === a ? B / 2 : 0, 'T')];
  const notes = ['면전류가 받는 힘은 안쪽 B와 바깥 B(0)의 평균 μ₀K/2를 씁니다: K × μ₀K/2 = B²/(2μ₀).',
    '같은 값이 가상변위법 ½I² dL′/da / (2πa)와 일치합니다: 코일은 바깥으로 팽창하려 합니다.'];
  if (rho === a) return { status: 'boundary', reason: '솔레노이드 표면(ρ = a)에서는 B가 불연속입니다: 안쪽 μ₀nI, 바깥 0, 평균 μ₀nI/2.', region: 'winding', vectors: {}, scalars, notes };
  return { region: rho < a ? 'inside' : 'outside', vectors: { B: [0, 0, rho < a ? B : 0] }, scalars, notes };
}

function solenoidPressureVerify(p) {
  const method = 'central difference of L′(a) = μ₀n²πa² and the mean-field force K × B_mean', a = p.radius, h = a * 1e-4;
  const lPrime = r => MU0 * p.turnsPerMeter ** 2 * Math.PI * r * r, dL = (lPrime(a + h) - lPrime(a - h)) / (2 * h);
  const B = MU0 * p.turnsPerMeter * p.current, K = p.turnsPerMeter * p.current;
  return [checkRow('벽 힘: ½ I² dL′/da = (B²/2μ₀)(2πa)', method, 0.5 * p.current ** 2 * dL, B * B / (2 * MU0) * TWO_PI * a, 'N/m', 1e-7, 1e-18),
    checkRow('평균장 규칙: K × (μ₀K/2) = B²/(2μ₀)', method, Math.abs(K) * MU0 * Math.abs(K) / 2, B * B / (2 * MU0), 'Pa', 1e-9, 1e-18),
    checkRow('내부 에너지: ½∫B·H dA = ½ L′ I² (단위 길이)', method, 0.5 * B * (B / MU0) * Math.PI * a * a, 0.5 * lPrime(a) * p.current ** 2, 'J/m', 1e-9, 1e-18)];
}

const solenoidPressure = defineLecture({
  id: 'force-solenoid-pressure', title: '솔레노이드 표면의 자기압 B²/(2μ₀) · 6주차 §8.3', topic: TOPIC, week: WEEK, sections: ['8.3', '8.10'],
  description: '긴 솔레노이드 코일면의 면전류가 받는 힘: 평균장 μ₀K/2를 쓰면 B²/(2μ₀)이고 코일은 바깥으로 팽창합니다.',
  parameters: solenoidPressureParameters, probeDefault: [0, 0, 0.03],
  view: { kind: 'profile', plane: 'xz', extent: 1, probeAxes: [0, 2], coordinate: coordinate('ρ', 'm', '축으로부터의 반지름') },
  compute: solenoidPressureCompute,
  profile: p => {
    const a = p.radius, B = MU0 * p.turnsPerMeter * p.current, to = list => list.map(([c, v]) => ({ coordinate: c, value: v }));
    return [series('Bz', 'B_z(ρ)', 'T', 'ρ', 'm', to([[0, B], [a, B], [a, 0], [2 * a, 0]])),
      series('energy', '에너지 밀도 B²/(2μ₀)', 'J/m³', 'ρ', 'm', to([[0, B * B / (2 * MU0)], [a, B * B / (2 * MU0)], [a, 0], [2 * a, 0]]))];
  },
  verify: solenoidPressureVerify,
  assumptions: ['무한히 긴 얇은 솔레노이드(면전류 K = nI φ̂), 내부 B = μ₀nI ẑ, 외부 0, 진공.',
    '강의 필기에는 이 힘 식에 물음표가 남아 있습니다. 표면에서 장이 불연속이므로 평균 μ₀K/2를 쓰는 것이 올바른 값이며 이 실험은 그 해석을 따릅니다.'],
  validity: ['ρ ≥ 0. 가장자리 효과와 코일 피치는 무시합니다.'],
  singularities: ['ρ = a(코일면)에서는 B가 불연속이므로 boundary로 표시하고 양쪽 극한을 알려 줍니다.'],
  formulas: [{ label: '내부 장', text: 'B = μ₀ n I ẑ', unit: 'T' }, { label: '자기압', text: 'F/S = K (μ₀K/2) = B²/(2μ₀)', unit: 'Pa' },
    { label: '가상변위법', text: 'F′ = ½ I² dL′/da, L′ = μ₀ n² π a²', unit: 'N/m' }],
  references: [hayt('8.3', 'Force on a current sheet'), hayt('8.10', 'Energy and inductance — virtual displacement'), REF.conductor],
  symbolic: {
    title: '솔레노이드의 자기압 — 기호 풀이',
    givens: [['n', '단위 길이당 감은 수', '1/m'], ['I', '전류', 'A'], ['a', '반지름', 'm']],
    laws: [['솔레노이드 내부 장', 'B = μ₀ n I'], ['면전류의 힘', 'dF = (K × B_평균) dS']],
    steps: [['면전류', 'K = n I φ̂', '코일면 한 겹이 면전류로 근사됩니다.'], ['평균장', 'B_평균 = (μ₀nI + 0)/2', '코일면 위에서 장이 불연속이라 양쪽 평균을 씁니다.'],
      ['압력', 'F/S = K × B_평균 = μ₀ n² I²/2 = B²/(2μ₀)', '방향은 바깥쪽입니다.'], ['가상변위 검산', 'F′ = ½ I² dL′/da = μ₀ n² I² π a', '위 압력 × 2πa와 같습니다.']],
    answers: [['자기압', 'p = B²/(2μ₀) = μ₀ n² I²/2', 'Pa', '바깥쪽(팽창)'], ['단위 길이 벽 힘', "F′ = π a μ₀ n² I²", 'N/m']],
    limitations: ['무한 길이 이상 솔레노이드입니다.'],
  },
});

// ---- 4a. Loop torque -----------------------------------------------------------------------------------------------------
const torqueParameters = [
  parameter('radius', '원형 루프 반지름 a', 'm', 'cm', 0.01, 0.05, 1e-4, 10),
  parameter('current', '루프 전류 I (법선은 오른손 법칙)', 'A', 'A', 1, 2, -1000, 1000),
  parameter('B0', '균일 자속밀도 B₀ (+z)', 'T', 'T', 1, 0.5, 1e-6, 20),
];

function torqueCompute(p, theta) {
  const m = p.current * Math.PI * p.radius ** 2, tau = m * p.B0 * Math.sin(theta);
  return {
    region: Math.sin(theta) === 0 ? 'equilibrium' : 'torque', vectors: { B: [0, 0, p.B0] },
    scalars: [scalar('m', '자기 모멘트 크기 m = Iπa²', m, 'A·m²'), scalar('my', 'm의 y 성분 m sinθ', m * Math.sin(theta), 'A·m²'),
      scalar('mz', 'm의 z 성분 m cosθ', m * Math.cos(theta), 'A·m²'), scalar('tauX', '토크 τ_x = m B₀ sinθ', tau, 'N·m'),
      scalar('tauMax', '최대 토크 |m|B₀ (θ = 90°)', Math.abs(m) * p.B0, 'N·m'), scalar('energy', '위치에너지 U = −m·B = −mB₀cosθ', -m * p.B0 * Math.cos(theta), 'J'),
      scalar('netForce', '균일 B에서 알짜힘', 0, 'N'), scalar('thetaDeg', '관측 각도 θ', theta * 180 / Math.PI, '°')],
    notes: ['균일한 B에서 닫힌 루프의 알짜힘은 0이지만 토크는 0이 아닙니다: τ = m × B.',
      'm = I S a_N 이고 법선 a_N은 전류 방향에서 오른손 법칙으로 정합니다. 안정 평형은 m ∥ B(θ = 0).'],
  };
}

function torqueVerify(p) {
  const method = 'independent sum of r × (I dl × B) over 2048 segments of the circle', cells = 2048, a = p.radius, theta = 1;
  const normal = [0, Math.sin(theta), Math.cos(theta)], e1 = [1, 0, 0], e2 = [0, Math.cos(theta), -Math.sin(theta)], B = [0, 0, p.B0];
  const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const torque = [0, 0, 0], force = [0, 0, 0], dphi = TWO_PI / cells;
  for (let i = 0; i < cells; i++) {
    const phi = (i + 0.5) * dphi, c = Math.cos(phi), s = Math.sin(phi);
    const r = e1.map((v, k) => a * (c * v + s * e2[k])), dl = e1.map((v, k) => a * dphi * (-s * v + c * e2[k]));
    const df = cross(dl, B).map(v => p.current * v), dt = cross(r, df);
    for (let k = 0; k < 3; k++) { torque[k] += dt[k]; force[k] += df[k]; }
  }
  const m = p.current * Math.PI * a * a, expected = cross(normal.map(v => m * v), B), scale = Math.abs(m * p.B0) + 1e-300;
  return [checkRow('τ_x = (m × B)_x (θ = 1 rad)', method, torque[0], expected[0], 'N·m', 1e-9, 1e-12 * scale),
    checkRow('τ_y = 0', method, torque[1], 0, 'N·m', 0, 1e-9 * scale), checkRow('τ_z = 0', method, torque[2], 0, 'N·m', 0, 1e-9 * scale),
    checkRow('알짜힘 F_y = 0 (균일 B)', method, force[1], 0, 'N', 0, 1e-9 * scale)];
}

const torque = defineLecture({
  id: 'force-loop-torque', title: '자기장 속 전류 루프의 토크 τ = m×B · 6주차 §8.4', topic: TOPIC, week: WEEK, sections: ['8.4'],
  description: '균일 B₀ ẑ 속 원형 루프(법선이 z축과 θ): m = Iπa², τ = mB₀ sinθ x̂. 그래프에서 θ를 끌어 봅니다.',
  parameters: torqueParameters, probeDefault: [0, 0, Math.PI / 3],
  view: { kind: 'profile', plane: 'xz', extent: 1, probeAxes: [0, 2], coordinate: coordinate('θ', 'rad', '법선과 B 사이의 각') },
  compute: torqueCompute,
  profile: (p, count) => {
    const angle = linspace(0, Math.PI, count), m = p.current * Math.PI * p.radius ** 2;
    return [series('tauX', '토크 τ_x(θ)', 'N·m', 'θ', 'rad', angle.map(t => ({ coordinate: t, value: m * p.B0 * Math.sin(t) }))),
      series('energy', '위치에너지 U(θ)', 'J', 'θ', 'rad', angle.map(t => ({ coordinate: t, value: -m * p.B0 * Math.cos(t) })))];
  },
  verify: torqueVerify,
  assumptions: ['원형 루프(반지름 a)는 균일한 B = B₀ ẑ 속에 있고 법선 a_N = (0, sinθ, cosθ). 루프가 만드는 장은 따로 보지 않습니다.',
    'm = I S a_N [A·m²]. 필기의 직사각형 루프(Δx×Δy) 결과 τ = IΔxΔy (a_z × B₀)도 같은 τ = m×B 입니다.'],
  validity: ['θ는 0 … π로 그립니다. I의 부호가 바뀌면 m이 반대가 되어 안정 평형이 θ = π가 됩니다.'],
  singularities: ['특이점은 없습니다. θ = 0, π에서 토크가 0인 평형입니다.'],
  formulas: [{ label: '자기 모멘트', text: 'm = I S a_N = I π a² a_N', unit: 'A·m²' }, { label: '토크', text: 'τ = m × B = I π a² B₀ sinθ x̂', unit: 'N·m' },
    { label: '위치에너지', text: 'U = −m·B', unit: 'J' }],
  references: [hayt('8.4', 'Force and torque on a closed circuit'), REF.loop],
  symbolic: {
    title: '자기장 속 원형 루프의 토크 — 기호 풀이',
    givens: [['a', '루프 반지름', 'm'], ['I', '전류', 'A'], ['B₀', 'z 방향 균일 자속밀도', 'T'], ['θ', '법선과 B의 각', 'rad']],
    laws: [['닫힌 루프에 작용하는 힘', 'F = ∮ I dl × B = −I B × ∮ dl = 0'], ['토크', 'τ = ∮ r × (I dl × B) = m × B']],
    steps: [['균일 B의 알짜힘', 'F = I (∮ dl) × B = 0', '닫힌 경로의 ∮dl은 0입니다.'], ['자기 모멘트', 'm = I π a² (sinθ ŷ + cosθ ẑ)', '법선은 전류 방향의 오른손 법칙입니다.'],
      ['토크', 'τ = m × B₀ ẑ = π a² I B₀ sinθ x̂', 'θ = 90°에서 최대, θ = 0에서 0입니다.']],
    answers: [['토크', 'τ = π a² I B₀ sinθ', 'N·m', '+x 방향(m을 B쪽으로 돌림)'], ['최대 토크', 'τ_max = π a² I B₀', 'N·m'], ['알짜힘', 'F = 0', 'N']],
    limitations: ['균일 B만 다룹니다. 비균일 B에서는 알짜힘도 생깁니다.'],
  },
});

// ---- 4b. Dipole far field ------------------------------------------------------------------------------------------------
const dipoleParameters = [
  parameter('radius', '루프 반지름 a', 'm', 'mm', 1e-3, 0.01, 1e-5, 1),
  parameter('current', '루프 전류 I (+z 법선)', 'A', 'A', 1, 5, -1e4, 1e4),
  parameter('theta', '관측 방향의 극각 θ (z축 기준)', 'rad', 'rad', 1, Math.PI / 3, 0, Math.PI),
];

/** Independent Biot–Savart sum of a circular loop in the xy-plane (counter-clockwise from +z), midpoint rule in φ′. */
function loopFieldNumeric(a, current, point, cells = 720) {
  const sum = [0, 0, 0], dphi = TWO_PI / cells;
  for (let i = 0; i < cells; i++) {
    const phi = (i + 0.5) * dphi, sx = a * Math.cos(phi), sy = a * Math.sin(phi), dlx = -a * Math.sin(phi) * dphi, dly = a * Math.cos(phi) * dphi;
    const rx = point[0] - sx, ry = point[1] - sy, rz = point[2], r3 = hr(rx, ry, rz) ** 3;
    sum[0] += dly * rz / r3; sum[1] += -dlx * rz / r3; sum[2] += (dlx * ry - dly * rx) / r3;
  }
  return sum.map(v => MU0 * current / FOUR_PI * v);
}

const dipoleField = (m, r, theta) => ({ br: MU0 * m * 2 * Math.cos(theta) / (FOUR_PI * r ** 3), bt: MU0 * m * Math.sin(theta) / (FOUR_PI * r ** 3) });

function dipoleCompute(p, r) {
  const a = p.radius, theta = p.theta;
  if (!(r >= 3 * a)) return excluded('unsupported', `쌍극자 원거리식은 r ≫ a에서만 씁니다. 이 앱은 r ≥ 3a = ${3 * a} m 에서만 표시합니다.`, 'near-field');
  const m = p.current * Math.PI * a * a, { br, bt } = dipoleField(m, r, theta);
  const cartesian = [br * Math.sin(theta) + bt * Math.cos(theta), 0, br * Math.cos(theta) - bt * Math.sin(theta)];
  const exact = loopFieldNumeric(a, p.current, [r * Math.sin(theta), 0, r * Math.cos(theta)]), magnitude = hr(br, bt);
  return {
    region: 'far-field', vectors: { B: cartesian },
    scalars: [scalar('m', '자기 모멘트 m = Iπa²', m, 'A·m²'), scalar('Br', 'B_r = μ₀m cosθ/(2πr³)', br, 'T'), scalar('Btheta', 'B_θ = μ₀m sinθ/(4πr³)', bt, 'T'),
      scalar('Bmag', '|B| 쌍극자 근사', magnitude, 'T'), scalar('Aphi', '벡터 퍼텐셜 A_φ = μ₀m sinθ/(4πr²)', MU0 * m * Math.sin(theta) / (FOUR_PI * r * r), 'Wb/m'),
      scalar('Bexact', '|B| 루프의 정확한 비오–사바르 적분', hr(...exact), 'T'),
      scalar('relError', '쌍극자 근사의 상대 오차', magnitude ? Math.abs(hr(...exact) - magnitude) / magnitude : 0, '1')],
    notes: ['원거리에서 루프는 자기쌍극자: A = μ₀ m × a_r/(4πr²), B = ∇×A (정전기 쌍극자 V = p·a_r/(4πε₀r²)와 대응).',
      'xz 평면(φ = 0)에서 구한 값입니다. φ 대칭이라 다른 φ도 같은 B_r, B_θ를 가집니다.'],
  };
}

function dipoleVerify(p) {
  const a = p.radius, method = 'independent Biot–Savart loop sum, 720 cells', m = p.current * Math.PI * a * a;
  const axisR = 7 * a, axis = loopFieldNumeric(a, p.current, [0, 0, axisR]);
  const exactAxis = MU0 * p.current * a * a / (2 * (a * a + axisR * axisR) ** 1.5);
  const r = 20 * a, theta = p.theta, field = dipoleField(m, r, theta), dipoleMag = hr(field.br, field.bt);
  const exact = hr(...loopFieldNumeric(a, p.current, [r * Math.sin(theta), 0, r * Math.cos(theta)]));
  // B = ∇×A in spherical coordinates, A = A_φ φ̂ with A_φ = μ₀ m sinθ/(4π r²): central differences.
  const aphi = (rr, th) => MU0 * m * Math.sin(th) / (FOUR_PI * rr * rr), hh = 1e-5, rr = 15 * a, th = Math.min(Math.max(theta, 0.3), Math.PI - 0.3);
  const curlR = (Math.sin(th + hh) * aphi(rr, th + hh) - Math.sin(th - hh) * aphi(rr, th - hh)) / (2 * hh * rr * Math.sin(th));
  const curlT = -((rr + hh * rr) * aphi(rr + hh * rr, th) - (rr - hh * rr) * aphi(rr - hh * rr, th)) / (2 * hh * rr * rr);
  const reference = dipoleField(m, rr, th), tiny = 1e-300 + 1e-12 * Math.abs(MU0 * m / (rr ** 3));
  return [checkRow('축상 정확해와 비오–사바르 합의 일치 (z = 7a)', method, axis[2], exactAxis, 'T', 1e-9, tiny),
    checkRow('쌍극자 근사 vs 정확한 장 (r = 20a, 상대 1 % 이내)', method, dipoleMag, exact, 'T', 1e-2, tiny),
    checkRow('B_r = (∇×A)_r (A = μ₀m×a_r/4πr²)', 'central difference of A_φ in spherical coordinates', curlR, reference.br, 'T', 1e-6, tiny),
    checkRow('B_θ = (∇×A)_θ', 'central difference of A_φ in spherical coordinates', curlT, reference.bt, 'T', 1e-6, tiny)];
}

const dipole = defineLecture({
  id: 'force-dipole-field', title: '자기쌍극자의 원거리 장 B_r, B_θ · 6주차 §8.4', topic: TOPIC, week: WEEK, sections: ['8.4'],
  description: '반지름 a ≪ r인 전류 루프의 장 B = μ₀m/(4πr³)(2cosθ a_r + sinθ a_θ). 그래프에서 거리 r을 끌어 정확한 비오–사바르 합과 비교합니다.',
  parameters: dipoleParameters, probeDefault: [0, 0, 0.1],
  view: { kind: 'profile', plane: 'xz', extent: 1, probeAxes: [0, 2], coordinate: coordinate('r', 'm', '중심으로부터의 거리') },
  compute: dipoleCompute,
  profile: (p, count) => {
    const a = p.radius, m = p.current * Math.PI * a * a, r = linspace(3 * a, 20 * a, count);
    const error = r.map(x => {
      const f = dipoleField(m, x, p.theta), mag = hr(f.br, f.bt), ex = hr(...loopFieldNumeric(a, p.current, [x * Math.sin(p.theta), 0, x * Math.cos(p.theta)], 360));
      return mag ? Math.abs(ex - mag) / mag * 100 : 0;
    });
    return [series('Br', 'B_r(r)', 'T', 'r', 'm', r.map(x => ({ coordinate: x, value: dipoleField(m, x, p.theta).br }))),
      series('Btheta', 'B_θ(r)', 'T', 'r', 'm', r.map(x => ({ coordinate: x, value: dipoleField(m, x, p.theta).bt }))),
      series('error', '쌍극자 근사의 상대 오차', '%', 'r', 'm', r.map((x, i) => ({ coordinate: x, value: error[i] })))];
  },
  verify: dipoleVerify,
  assumptions: ['xy 평면의 원형 루프(중심 원점, 전류 반시계)가 만드는 장을 r ≫ a에서 쌍극자로 근사합니다. 진공.',
    '1/|r−r′| ≈ (1/r)(1 + a sinθ sinφ′/r) 전개에서 sin²φ′ 항만 살아남아 A_φ가 나옵니다(강의 a17–a21의 유도).'],
  validity: ['r ≥ 3a에서만 표시합니다. 오차는 대략 (a/r)²로 줄어듭니다. 그래프 범위는 3a … 20a입니다.', 'θ = 0은 축상(B_θ = 0), θ = π/2는 루프면 연장선(B_r = 0)입니다.'],
  singularities: ['r < 3a는 원거리식의 정의역 밖이라 unsupported로 표시하고 값을 만들지 않습니다.'],
  formulas: [{ label: '벡터 퍼텐셜', text: 'A = μ₀ m × a_r/(4π r²)', unit: 'Wb/m' },
    { label: '쌍극자 장', text: 'B = μ₀ m/(4π r³) (2cosθ a_r + sinθ a_θ)', unit: 'T' }, { label: '자기 모멘트', text: 'm = I π a²', unit: 'A·m²' }],
  references: [hayt('8.4', 'Magnetic dipole far field'), REF.loop],
  symbolic: {
    title: '자기쌍극자의 원거리 장 — 기호 풀이',
    givens: [['a', '루프 반지름', 'm', 'a ≪ r'], ['I', '전류', 'A'], ['(r, θ)', '관측점의 구면좌표', '', 'φ 대칭']],
    laws: [['벡터 퍼텐셜', 'A = (μ₀/4π) ∮ I dl′/|r − r′|'], ['장', 'B = ∇ × A']],
    steps: [['거리의 전개', '1/|r−r′| ≈ (1/r)(1 + a sinθ sinφ′/r)', 'a ≪ r에서 1차까지 전개합니다.'],
      ['φ′ 적분', 'A_φ = μ₀ I a² π sinθ/(4π r² a) · a → μ₀ I sinθ π a²/(4π r²)', 'sinφ′, cosφ′, sinφ′cosφ′ 항은 한 바퀴에서 0, sin²φ′ 항(∫ = π)만 남습니다.'],
      ['쌍극자 퍼텐셜', 'A = μ₀ m × a_r/(4π r²), m = I π a² a_z', '정전기 쌍극자 V = p·a_r/(4πε₀r²)와 같은 꼴입니다.'],
      ['구면 curl', 'B_r = (1/(r sinθ)) ∂(sinθ A_φ)/∂θ, B_θ = −(1/r) ∂(r A_φ)/∂r', 'B = μ₀ m/(4π r³)(2cosθ a_r + sinθ a_θ).']],
    answers: [['B_r', 'B_r = μ₀ m cosθ/(2π r³)', 'T'], ['B_θ', 'B_θ = μ₀ m sinθ/(4π r³)', 'T'], ['A_φ', 'A_φ = μ₀ m sinθ/(4π r²)', 'Wb/m']],
    limitations: ['원거리 근사입니다. 가까운 곳은 비오–사바르 적분(타원적분)이 필요합니다.'],
  },
});

export const EXPERIMENTS = [lorentz, wireLoop, parallelWires, sheets, solenoidPressure, torque, dipole];
