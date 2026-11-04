// Hayt Ch.9 §9.1 lecture experiment: the homopolar (Faraday disc) generator (lecture note ex3, p13). Pure: no DOM.
//
// A disc of radius r₀ turns at ω in a uniform axial B. Each radial strip cuts B at speed rω, so the open-circuit voltage between
// the axle contact a and a brush b at radius r is the radial integral of (v×B)·dl from a to b: V_emf_ba = Bωr²/2.
import { checkRow, coordinate, defineLecture, hayt, linspace, openstax, parameter, scalar, series } from './em-course-lecture.js';
import { plainText, siText } from './em-format.js';

const parameters = [
  parameter('B', '축방향 자속밀도 B (B a_z)', 'T', 'T', 1, 0.5, -2, 2),
  parameter('omega', '각속도 ω (+z에서 보아 반시계가 +)', 'rad/s', 'rad/s', 1, 100, -1000, 1000),
  parameter('r0', '원판 반지름 r₀', 'm', 'cm', 0.01, 0.1, 0.01, 0.3),
];

/** Closed form at the brush radius ratio η = r/r₀; p is the SI parameter object. */
function homopolarState(p, eta) {
  const radius = eta * p.r0, k = p.B * p.omega;
  return { radius, radiusRatio: eta, motionalE: k * radius, voltageBA: k * radius * radius / 2, voltageFull: k * p.r0 * p.r0 / 2 };
}

// Products of the inputs only (no trigonometry): a zero is exact (B = 0, ω = 0 or r = 0), so a tiny value is real and keeps its sign.
function compute(p, eta) {
  const s = homopolarState(p, eta), n = plainText;
  const polarity = s.voltageBA === 0 ? '전압 0 · 극성 없음' : s.voltageBA > 0 ? 'b + / a − (브러시가 높은 전위)' : 'a + / b − (축 접점이 높은 전위)';
  const textV = value => (value === 0 ? '0 V' : siText(value, 'V'));
  const textE = s.motionalE === 0 ? '0 V/m' : siText(s.motionalE, 'V/m');
  return {
    region: 'disc', vectors: {},
    scalars: [
      scalar('voltageBA', '브러시 전압 V_emf_ba = V_b − V_a = Bωr²/2', s.voltageBA, 'V'),
      scalar('voltageFull', '가장자리 전압 Bωr₀²/2', s.voltageFull, 'V'),
      scalar('motionalE', '전하당 자기력 E_m = Bωr (반경 방향)', s.motionalE, 'V/m'),
      scalar('voltageAB', '반대 첨자 V_emf_ab = −V_emf_ba', -s.voltageBA, 'V'),
      scalar('radius', '브러시 반경 r = η r₀', s.radius, 'm'),
      scalar('speed', '그 반경의 속력 |v| = |ω| r', Math.abs(p.omega) * s.radius, 'm/s'),
      scalar('radiusRatio', '반경 비 η = r/r₀', eta, '1'),
    ],
    notes: [
      `대입: r = η r₀ = ${n(eta)}×${n(p.r0)} = ${n(s.radius)} m, E_m = Bωr = ${n(p.B)}×${n(p.omega)}×${n(s.radius)} = ${textE}`,
      `대입: V_emf_ba = Bωr²/2 = ${n(p.B)}×${n(p.omega)}×${n(s.radius)}²/2 = ${textV(s.voltageBA)} (가장자리 Bωr₀²/2 = ${textV(s.voltageFull)})`,
      `극성: ${polarity}. V_emf_ab = −V_emf_ba = ${textV(-s.voltageBA)}`,
      '첨자와 적분 방향: a = 축 접점, b = 반경 r의 브러시. V_emf_ba = ∫a→b (v×B)·dl = ∫₀ʳ Bωr′ dr′ (중심에서 바깥으로). B = B a_z, Ω = ω a_z, v = rω a_φ, v×B = Bωr a_r.',
      'E_m = v×B는 전하당 자기력이며 실험실계 정전계 E_s와 다릅니다. 개방 정상상태에서 도체 안 E_s = −v×B이므로 V_b − V_a = −∫a→b E_s·dl = +∫a→b (v×B)·dl입니다.',
      '반경을 절반으로 줄이면 E_m은 절반, 전압은 1/4입니다(전압은 반경 제곱에 비례). 전류·부하·마찰·원판 전류가 만드는 자기장은 계산하지 않습니다.',
    ],
  };
}

function verify(p) {
  const s = homopolarState(p, 1), cells = 128, dr = p.r0 / cells;
  // 1. v = Ω × r and (v × B)·a_r summed over 128 radial midpoints (r on the +x axis, so a_r = a_x).
  const cross = (u, w) => [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
  const Omega = [0, 0, p.omega], B = [0, 0, p.B];
  let radial = 0;
  for (let i = 0; i < cells; i++) radial += cross(cross(Omega, [(i + 0.5) * dr, 0, 0]), B)[0] * dr;
  // 2. The signed sector swept by the radius a→b: Φ_sweep(τ) = B·(r₀² ωτ/2), central difference at τ = 0.01 s.
  const sweep = tau => p.B * (p.r0 * p.r0 * (p.omega * tau) / 2), tau = 0.01, h = 0.001;
  const rate = (sweep(tau + h) - sweep(tau - h)) / (2 * h);
  return [
    checkRow('가장자리: 반경 128분할 ∫(v×B)·dr = Bωr₀²/2', 'vector cross product v×B at each radius, midpoint rule from axle to rim', radial, s.voltageFull, 'V', 1e-10, 1e-12),
    checkRow('가장자리: 쓸린 부채꼴 +dΦ_sweep/dτ = Bωr₀²/2', 'central difference of the signed swept-sector flux (not −dΦ/dt of the fixed disc)', rate, s.voltageFull, 'V', 1e-10, 1e-12),
  ];
}

export const EXPERIMENTS = [defineLecture({
  id: 'emf-homopolar', title: '원판 발전기: 반경과 전압', topic: 'induction', week: 7, sections: ['9.1'],
  description: '앱 검산 예시(근거: 강의 필기 ex3 · p13, Homopolar 발전기): B = 0.5 T, ω = 100 rad/s, r₀ = 10 cm 원판의 축과 가장자리 사이 V_emf_ba = Bωr₀²/2 = 0.25 V. '
    + '그래프를 끌어 브러시 반경 비를 바꾸면 반경 1/2에서 전압 1/4을 읽습니다.',
  answers: ['voltageBA', 'voltageFull', 'motionalE'], coordinateScalars: ['radiusRatio'],
  parameters, probeDefault: [0, 0, 1],
  view: { kind: 'profile', plane: 'xz', extent: 1, probeAxes: [0, 2], coordinate: coordinate('r/r₀', '1', '브러시 반경 비'), strictProbe: true },
  validate: (p, eta) => (eta === undefined || (eta >= 0 && eta <= 1) ? '' : '반경 비 r/r₀는 0 … 1(축 … 가장자리)에서만 봅니다. 자동 보정하지 않습니다.'),
  compute,
  profile: (p, count) => {
    const states = linspace(0, 1, count).map(eta => homopolarState(p, eta));
    return [series('motionalE', '자기력 E_m = Bωr', 'V/m', 'r/r₀', '1', states.map(s => ({ coordinate: s.radiusRatio, value: s.motionalE }))),
      series('voltageBA', '전압 V_emf_ba = Bωr²/2', 'V', 'r/r₀', '1', states.map(s => ({ coordinate: s.radiusRatio, value: s.voltageBA })))];
  },
  verify,
  assumptions: [
    '균일한 B = B a_z 속에서 반지름 r₀의 도체 원판이 z축 둘레를 ω로 돕니다. ω > 0은 +z에서 보아 반시계입니다.',
    '단자 a는 축 접점, b는 반경 r의 브러시(η = 1이면 가장자리)이며 개방 정상상태의 전압만 봅니다.',
    'V_emf_ba = V_b − V_a = ∫a→b (v×B)·dl, V_emf_ab = −V_emf_ba. 첨자를 바꾸면 부호도 바뀝니다.',
    '기본값은 강의 식을 검산하기 위한 앱 예시 수치이며 강의에 주어진 수치가 아닙니다.',
  ],
  validity: ['0 ≤ r/r₀ ≤ 1, r₀ > 0. B와 ω는 음수도 됩니다(Bω의 부호가 극성을 정함).', '전류가 흐르면 생기는 내부 전압 강하·원판 전류의 자기장·마찰은 다루지 않습니다.'],
  singularities: ['유효 범위 안에 특이점은 없습니다. 축(r = 0)에서 E_m = V = 0은 유한한 값입니다.'],
  formulas: [
    { label: '속도와 자기력', text: 'v = rω a_φ, E_m = v×B = Bωr a_r', unit: 'm/s; V/m' },
    { label: '브러시 전압', text: 'V_emf_ba = ∫a→b (v×B)·dl = ∫₀ʳ Bωr′ dr′ = Bωr²/2', unit: 'V' },
    { label: '첨자 반전', text: 'V_emf_ab = −V_emf_ba', unit: 'V' },
  ],
  references: [hayt('9.1', "Faraday's law"), openstax('13-3-motional-emf', '§13.3 — Motional emf')],
  symbolic: {
    title: '원판 발전기의 단자 전압 — 기호 풀이',
    givens: [['B = B a_z', '축방향 균일 자속밀도', 'T'], ['ω', '각속도 (Ω = ω a_z)', 'rad/s'], ['r₀', '원판 반지름', 'm'], ['a, b', '축 접점, 반경 r의 브러시']],
    laws: [['운동 기전력', 'V_emf = ∮ (v×B)·dl'], ['전하당 자기력', 'E_m = F/q = v×B']],
    steps: [
      ['속도', 'v = Ω×r = rω a_φ', '반경 r의 점은 원운동합니다.'],
      ['외적 방향', 'v×B = rω B (a_φ × a_z) = Bωr a_r', 'Bω > 0이면 바깥(+a_r) 방향입니다.'],
      ['a→b 반경 적분', 'V_emf_ba = ∫a→b (v×B)·dl = ∫₀ʳ Bωr′ dr′ = Bωr²/2', '축(a)에서 브러시(b)로 적분합니다.'],
      ['첨자와 개방 극성', 'V_b − V_a = V_emf_ba, V_emf_ab = −V_emf_ba', 'Bω > 0이면 b +, a −. 개방 도체 안 E_s = −v×B.'],
    ],
    answers: [['브러시 전압', 'V_emf_ba = Bωr²/2', 'V', 'Bω > 0이면 b가 +'], ['가장자리 전압', 'V_emf_ba(r₀) = Bωr₀²/2', 'V'],
      ['자기력', 'E_m = Bωr a_r', 'V/m', '반경 방향']],
    limitations: ['미끄럼 접점이 있는 회로를 하나의 물질 루프로 보고 고정 원판 자속의 −dΦ/dt를 쓰지 않습니다. 부채꼴 자속은 쓸린 면적 검산에만 씁니다.'],
  },
})];
