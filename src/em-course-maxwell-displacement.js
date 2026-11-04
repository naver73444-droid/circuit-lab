// Hayt Ch.9 §9.2–9.4 lecture experiment: displacement current between the plates of a parallel-plate capacitor. Pure: no DOM.
//
// Quasi-static model of a circular capacitor (radius a, gap d, ε) on V = V_m sin ωt. The sweep coordinate point[2] is the
// radius ratio s = ρ/a of a circular path C between the plates (not a spatial z). Two series share the cursor: H_φ(ρ) and
// the displacement current enclosed by the flat disc bounded by C.
import { EPS0 } from './em-course-constants.js';
import { siText } from './em-format.js';
import { TWO_PI, checkRow, coordinate, defineLecture, hayt, linspace, openstax, parameter, scalar, series, zeroed } from './em-course-lecture.js';

const S_MAX = 3;

const parameters = [
  parameter('a', '극판 반지름 a', 'm', 'cm', 0.01, 0.05, 0.01, 0.1),
  parameter('d', '극판 간격 d (d/a ≤ 0.1)', 'm', 'mm', 1e-3, 0.001, 0.0001, 0.002),
  parameter('epsilonR', '절연체의 비유전율 ε_r', '1', '1', 1, 1, 1, 10),
  parameter('voltagePeak', '전압 최댓값 V_m (V = V_m sin ωt)', 'V', 'V', 1, 100, 1, 200),
  parameter('frequency', '주파수 f (ω = 2πf)', 'Hz', 'kHz', 1e3, 1000, 10, 10000),
  parameter('phase', '위상 ωt', 'rad', '°', Math.PI / 180, 0, -Math.PI, Math.PI),
];

/**
 * Closed form at radius ratio s for validated SI inputs. `peak` holds each quantity's largest size over ωt (the sin ωt ones
 * at ωt = 90°, the cos ωt ones at ωt = 0): the scale of the "shown as 0" rule (zeroed()).
 */
function displacementState(p, s) {
  const epsilon = EPS0 * p.epsilonR, omega = TWO_PI * p.frequency, area = Math.PI * p.a * p.a;
  const capacitance = epsilon * area / p.d, sin = Math.sin(p.phase), cos = Math.cos(p.phase);
  const JdPeak = epsilon * omega * p.voltagePeak / p.d, currentPeak = omega * capacitance * p.voltagePeak;
  const peak = {
    voltage: p.voltagePeak, charge: capacitance * p.voltagePeak, D: epsilon * p.voltagePeak / p.d, Jd: JdPeak, current: currentPeak,
    enclosed: s <= 1 ? JdPeak * Math.PI * (s * p.a) ** 2 : JdPeak * area, H: s <= 1 ? JdPeak * p.a * s / 2 : JdPeak * p.a / (2 * s),
  };
  return {
    epsilon, capacitance, radius: s * p.a, radiusRatio: s, voltage: peak.voltage * sin, charge: peak.charge * sin, D: peak.D * sin,
    Jd: JdPeak * cos, freeCurrent: currentPeak * cos, totalDisplacementCurrent: JdPeak * area * cos,
    enclosedDisplacementCurrent: peak.enclosed * cos, Hphi: peak.H * cos, peak,
  };
}

const deg = angle => `${Number((angle * 180 / Math.PI).toPrecision(6))}°`;

function validate(p, s) {
  // relative slack so a typed boundary pair (1.06 cm, 1.06 mm → 0.10000000000000002) is not rejected
  if (p.d / p.a > 0.1 * (1 + 1e-9)) return `d/a = ${Number((p.d / p.a).toPrecision(4))} > 0.1: 가장자리 효과를 무시하는 균일 D 근사를 쓸 수 없습니다. 간격을 줄이거나 극판을 키우세요. 자동 보정하지 않습니다.`;
  if (s !== undefined && (s < 0 || s > S_MAX)) return `경로 반경 비 ρ/a는 0 … ${S_MAX} 범위여야 합니다.`;
  return '';
}

function compute(p, s) {
  const st = displacementState(p, s), pk = st.peak, omega = TWO_PI * p.frequency;
  const I = zeroed(st.freeCurrent, pk.current), Jd = zeroed(st.Jd, pk.Jd), enclosed = zeroed(st.enclosedDisplacementCurrent, pk.enclosed);
  const H = zeroed(st.Hphi, pk.H), V = zeroed(st.voltage, pk.voltage);
  const rho = siText(st.radius, 'm');
  const surfaces = s >= 1
    ? `면 선택(ρ ≥ a): 같은 경로 C에 붙인 두 면 — 도선이 뚫고 지나는 면(I_f = I, I_d ≈ 0)과 극판 사이를 지나는 면(I_f = 0, I_d = I). 어느 면이든 ∮H·dl = I입니다. 두 면은 같은 경계·같은 법선 방향을 가진 대체 표현이므로 두 전류를 더해 2I로 만들지 않습니다(이 준정적 모델의 근사).`
    : `면 선택(ρ < a): 극판 사이의 원판 면(반경 ρ)만 계산합니다. 이 면을 지나는 것은 변위전류뿐이고 I_d,enc = I·ρ²/a²로 도선 전체 전류 I보다 작습니다. 두 면이 같은 I를 주는 비교는 ρ ≥ a에서만 적용됩니다.`;
  const circulation = H === 0 ? 'H 0(방향 없음)' : Jd > 0 ? '+z에서 보아 반시계 H' : '+z에서 보아 시계 H';
  const direction = Jd === 0 ? '변위전류 0 · 방향 없음(이 위상에서 dV/dt = 0)' : `${Jd > 0 ? '+z' : '−z'} 변위전류 · ${circulation}`;
  const notes = [
    '축·법선·적분 방향: 극판 축이 z이고 D·J_d의 양의 방향은 +z(아래 극판 → 위 극판)입니다. 기준: V = V_아래 − V_위, Q = 아래 극판 전하, I_f = 아래 극판으로 들어가는 도선 전류(= dQ/dt)이므로 V > 0이면 D가 +z, dV/dt > 0이면 J_d·I_f가 +z입니다. 경로 C는 극판 사이 축을 중심으로 한 반경 ρ의 원이며 +z에서 보아 반시계가 양의 순환, 면의 법선은 오른손 규칙으로 +z입니다.',
    surfaces,
    `C = ε_rε₀πa²/d = ${p.epsilonR} × ${siText(EPS0, 'F/m', 11)} × π × (${siText(p.a, 'm')})² / ${siText(p.d, 'm')} = ${siText(st.capacitance, 'F')}`,
    `J_d = ∂D/∂t = εωV_m cos ωt / d = ${siText(st.epsilon, 'F/m')} × ${siText(omega, 'rad/s')} × ${siText(p.voltagePeak, 'V')} × cos ${deg(p.phase)} / ${siText(p.d, 'm')} = ${siText(Jd, 'A/m²')}`,
    `전체 I_f = dQ/dt = ωCV_m cos ωt = ${siText(omega, 'rad/s')} × ${siText(st.capacitance, 'F')} × ${siText(p.voltagePeak, 'V')} × cos ${deg(p.phase)} = ${siText(I, 'A')} = 전체 I_d = J_d·πa²`,
    `포함 I_d,enc = J_d·π·min(ρ, a)² = ${siText(Jd, 'A/m²')} × π × (${siText(Math.min(st.radius, p.a), 'm')})² = ${siText(enclosed, 'A')} (ρ = ${rho})`,
    s === 0 ? 'H_φ = 0: ρ = 0(축 위)에서는 포함 전류도 0이고 0으로 나누지 않는 극한값입니다 · 방향 없음.'
      : `H_φ = I_d,enc/(2πρ) = ${siText(enclosed, 'A')} / (2π × ${rho}) = ${siText(H, 'A/m')}`,
    `방향: ${direction}. V = ${siText(V, 'V')}: V = V_m sin ωt가 최대(ωt = 90°)일 때 전류 0, V = 0(ωt = 0°)일 때 전류 최대입니다.`,
  ];
  return {
    region: s === 0 ? 'axis' : s < 1 ? 'inside-plates' : s === 1 ? 'plate-edge' : 'outside-plates', vectors: {},
    scalars: [
      scalar('enclosedDisplacementCurrent', '경로 안 변위전류 I_d,enc = J_d π min(ρ,a)²', st.enclosedDisplacementCurrent, 'A', pk.enclosed),
      scalar('Hphi', '경로 위 자계 H_φ = I_d,enc/(2πρ)', st.Hphi, 'A/m', pk.H),
      scalar('freeCurrent', '도선 전체 전류 I_f = dQ/dt', st.freeCurrent, 'A', pk.current),
      scalar('totalDisplacementCurrent', '극판 사이 전체 변위전류 I_d = J_d πa²', st.totalDisplacementCurrent, 'A', pk.current),
      scalar('Jd', '변위전류 밀도 J_d = ∂D/∂t', st.Jd, 'A/m²', pk.Jd),
      scalar('D', '전속밀도 D_z = εV/d', st.D, 'C/m²', pk.D),
      scalar('charge', '극판 전하 Q = CV', st.charge, 'C', pk.charge),
      scalar('voltage', '전압 V = V_m sin ωt', st.voltage, 'V', pk.voltage),
      scalar('capacitance', '정전용량 C = επa²/d', st.capacitance, 'F'),
      scalar('radius', '경로 반경 ρ = (ρ/a)·a', st.radius, 'm'),
      scalar('radiusRatio', '경로 반경 비 ρ/a', s, '1'),
    ],
    notes,
  };
}

/** Five-point derivative of f at x with step h. */
const fivePoint = (f, x, h) => (f(x - 2 * h) - 8 * f(x - h) + 8 * f(x + h) - f(x + 2 * h)) / (12 * h);

function verify(p) {
  const delta = 1e-3, rings = 128, omega = TWO_PI * p.frequency, epsilon = EPS0 * p.epsilonR;
  const iPeak = omega * epsilon * Math.PI * p.a * p.a * p.voltagePeak / p.d, absTol = 1e-14 + 2e-8 * iPeak, relTol = 2e-6;
  // independent pieces: Q(φ) and D(φ) from their own definitions, differentiated numerically; ring sums over the flat disc
  const charge = phi => (epsilon * Math.PI * p.a * p.a / p.d) * p.voltagePeak * Math.sin(phi);
  const flux = phi => epsilon * p.voltagePeak * Math.sin(phi) / p.d;
  const Jd = omega * fivePoint(flux, p.phase, delta);
  const discCurrent = radius => {
    let sum = 0;
    for (let i = 0; i < rings; i++) { const r = (i + 0.5) * radius / rings; sum += Jd * TWO_PI * r * radius / rings; }
    return sum;
  };
  const edge = displacementState(p, 1), half = displacementState(p, 0.5);
  const method = `5점 차분(δ = ${delta} rad) × ω, ${rings}링 중점 면적분`;
  return [
    checkRow(`ωt = ${deg(p.phase)}: 전체 I_f = ω·dQ/d(ωt) (Q의 5점 차분)`, method, omega * fivePoint(charge, p.phase, delta), edge.freeCurrent, 'A', relTol, absTol),
    checkRow('ρ = a (s = 1): ∫J_d·ds(원판) = 2πa·H_φ(a)', method, discCurrent(p.a), TWO_PI * p.a * edge.Hphi, 'A', relTol, absTol),
    checkRow('ρ = a/2 (s = 1/2): ∫J_d·ds(원판) = 2π(a/2)·H_φ(a/2)', method, discCurrent(p.a / 2), TWO_PI * (p.a / 2) * half.Hphi, 'A', relTol, absTol),
  ];
}

function profile(p, count) {
  // the same 0 rule as the answer: at ωt = ±90° both curves are flat zeros, not a magnified floating-point residue
  const states = linspace(0, S_MAX, count).map(s => displacementState(p, s));
  return [
    series('Hphi', '극판 사이 H_φ(ρ)', 'A/m', 'ρ/a', '1', states.map(st => ({ coordinate: st.radiusRatio, value: zeroed(st.Hphi, st.peak.H) }))),
    series('enclosedDisplacementCurrent', '경로 안 변위전류 I_d,enc(ρ)', 'A', 'ρ/a', '1',
      states.map(st => ({ coordinate: st.radiusRatio, value: zeroed(st.enclosedDisplacementCurrent, st.peak.enclosed) }))),
  ];
}

const maxwellDisplacement = defineLecture({
  id: 'maxwell-displacement', title: '커패시터: 변위전류', topic: 'maxwell', week: 7, sections: ['9.2', '9.3', '9.4'],
  description: '앱 검산 예시: 강의 필기 p14–p16(연속식에서 변위전류 도출, 같은 경로의 두 면)의 식을 원형 평행판 커패시터 수치로 확인합니다. '
    + '그래프에서 경로 반경 비 ρ/a를 끌어 극판 사이 H_φ와 경로 안 변위전류가 ρ = a에서 도선 전류 I_f와 같아지는 과정을 봅니다.',
  answers: ['enclosedDisplacementCurrent', 'Hphi', 'freeCurrent', 'totalDisplacementCurrent'], coordinateScalars: ['radiusRatio'],
  parameters, probeDefault: [0, 0, 1],
  view: { kind: 'profile', plane: 'xz', extent: 1, probeAxes: [0, 2], coordinate: coordinate('ρ/a', '1', '경로 반경 비'), strictProbe: true },
  validate, compute, profile, verify,
  assumptions: [
    '원형 극판(반지름 a, 간격 d)의 균질·선형 절연체(σ = 0, ε = ε_rε₀) 커패시터에 V = V_m sin ωt(최댓값·sin 기준)를 겁니다. 극판 사이 D는 균일하고 가장자리 효과·복사·도선 저항·역작용을 무시하는 준정적 모델입니다.',
    '프리셋 a = 5 cm, d = 1 mm, ε_r = 1, V_m = 100 V, f = 1 kHz는 강의 식을 검산하기 위한 앱 예시입니다(강의에는 수치 예제가 없습니다).',
    '기호 ρ는 경로 반경이고, 자유 전하밀도는 ρ_f로 구별합니다.',
  ],
  validity: [
    'd/a ≤ 0.1에서만 계산합니다. 넘으면 이유와 함께 거절합니다.',
    `경로 반경 비 ρ/a = 0 … ${S_MAX}. 위 범위의 f·a·ε_r 상한에서도 ωa√(μ₀ε) ≲ 6.7×10⁻⁵ ≪ 1이라 준정적 근사가 성립합니다.`,
    '실제 유한 극판과 귀환 도선의 엄밀해가 아닙니다. ρ > a의 H_φ = J_d a²/(2ρ)는 극판 사이 평면에서의 원대칭 근사입니다.',
  ],
  singularities: ['특이점은 없습니다. ρ = 0에서는 H_φ = I_d,enc = 0인 유한한 극한이고, ρ = a에서는 안·밖 두 식이 같은 값(연속)입니다.'],
  formulas: [
    { label: 'Ampère–Maxwell', text: '∇×H = J_f + ∂D/∂t, ∮_C H·dl = ∫_S J_f·ds + ∫_S ∂D/∂t·ds (+z 법선 · 반시계 C)', unit: 'A' },
    { label: '변위전류 밀도', text: 'J_d = ∂D/∂t = εωV_m cos ωt / d', unit: 'C/(m²·s) = A/m²' },
    { label: '전체 전류', text: 'I_f = dQ/dt = ωCV_m cos ωt = J_d πa² = I_d', unit: 'A' },
    { label: '극판 사이 H', text: 'H_φ = J_d ρ/2 (ρ ≤ a), J_d a²/(2ρ) (ρ ≥ a)', unit: 'A/m' },
  ],
  references: [hayt('9.2', 'Displacement current'), hayt('9.3–9.4', "Maxwell's equations in point and integral form"),
    openstax('16-1-maxwells-equations-and-electromagnetic-waves', "§16.1 — Maxwell's equations and electromagnetic waves")],
  symbolic: {
    title: '커패시터의 변위전류 — 기호 풀이',
    givens: [['a, d', '극판 반지름, 간격', 'm', 'd/a ≤ 0.1'], ['ε', '절연체 유전율 ε_rε₀ (σ = 0)', 'F/m'],
      ['V = V_m sin ωt', '극판 전압', 'V'], ['ρ', '경로 C의 반경(자유 전하밀도 ρ_f와 다름)', 'm']],
    conditions: ['D의 양의 방향 +z(아래 극판 → 위 극판), V = V_아래 − V_위, Q = 아래 극판 전하. C는 +z에서 보아 반시계, 면의 법선 +z.'],
    laws: [
      ['연속 방정식', '∂ρ_f/∂t + ∇·J_f = 0'],
      ['정적 Ampère', '∇×H = J_f'],
      ['Gauss', '∇·D = ρ_f'],
      ['Stokes', '∮_C H·dl = ∫_S (∇×H)·ds'],
      ['Maxwell 점형 ①', '∇·D = ρ_f'],
      ['Maxwell 점형 ②', '∇·B = 0'],
      ['Maxwell 점형 ③', '∇×E = −∂B/∂t'],
      ['Maxwell 점형 ④', '∇×H = J_f + ∂D/∂t'],
      ['구성 관계', 'D = ε₀E + P = εE, B = μ₀(H + M) = μH, J = σE (일반 관계 — 이 모델의 절연체는 σ = 0)'],
    ],
    steps: [
      ['정적 Ampère의 모순', '∇·(∇×H) = 0 = ∇·J_f, 그러나 연속식은 ∇·J_f = −∂ρ_f/∂t ≠ 0', '시변 전하가 있으면 발산을 취한 정적 식이 연속식과 맞지 않습니다.'],
      ['보정항', '∂ρ_f/∂t = ∂(∇·D)/∂t → ∇·(J_f + ∂D/∂t) = 0 → ∇×H = J_f + ∂D/∂t', 'J_d = ∂D/∂t의 단위는 C/(m²·s) = A/m²로 전류밀도와 같습니다.'],
      ['적분형', '∮_C H·dl = ∫_S J_f·ds + ∫_S ∂D/∂t·ds', '같은 경계 C를 가진 면 S마다 성립합니다. 도선을 뚫는 면과 극판 사이를 지나는 면은 대체 표현이며 더하지 않습니다.'],
      ['두 전류의 일치', 'I_f = dQ/dt = C dV/dt, I_d = ∫ ∂D/∂t·ds = εA(dV/dt)/d, C = εA/d → I_f = I_d', 'A = πa², D = εV/d.'],
      ['원대칭 H_φ', '2πρH_φ = J_d π min(ρ,a)² → H_φ = J_d ρ/2 (ρ ≤ a), J_d a²/(2ρ) (ρ ≥ a)', 'ρ = 0에서 0, ρ = a에서 두 식이 J_d a/2로 이어집니다.'],
    ],
    answers: [
      ['경로 안 변위전류', 'I_d,enc = J_d π min(ρ,a)² = I_f·min(ρ,a)²/a²', 'A'],
      ['경로 위 자계', 'H_φ = I_d,enc/(2πρ)', 'A/m', 'J_d > 0이면 +z에서 보아 반시계'],
      ['도선 전체 전류', 'I_f = ωCV_m cos ωt, C = επa²/d', 'A'],
      ['전체 변위전류', 'I_d = J_d πa² = (εωV_m cos ωt/d)πa² = I_f', 'A'],
    ],
    limitations: ['균일 D·원대칭 근사의 준정적 모델입니다. 경계조건(p17)은 기존 경계 실험으로 복습합니다.'],
  },
});

export const EXPERIMENTS = [maxwellDisplacement];
