// Hayt Ch.8 §8.5–8.7 lecture experiments: magnetic materials, bound currents and magnetic boundary conditions. Pure: no DOM.
import {
  FOUR_PI, MU0, REF, TWO_PI, checkRow, coordinate, defineLecture, excluded, hayt, linspace, parameter, choiceParameter, scalar, series, skippedRow,
} from './em-course-lecture.js';

const TOPIC = 'materials';
const WEEK = 6;
const sqrt = Math.sqrt;

// ---- 5a. Uniformly magnetized bar magnet --------------------------------------------------------------------------------
const magnetizationParameters = [
  parameter('M', '균일 자화 M (+z, 영구자석의 M₀)', 'A/m', 'kA/m', 1e3, 1e6, -1e7, 1e7),
  parameter('radius', '막대 반지름 a', 'm', 'mm', 1e-3, 0.01, 1e-4, 1),
  parameter('length', '막대 길이 ℓ', 'm', 'mm', 1e-3, 0.05, 1e-3, 10),
];

/** On-axis B of the equivalent solenoid (bound surface current K_b = M φ̂), z measured from the bar's center. */
const axisField = (p, z) => {
  const h = p.length / 2, a2 = p.radius ** 2;
  return MU0 * p.M / 2 * ((z + h) / sqrt(a2 + (z + h) ** 2) - (z - h) / sqrt(a2 + (z - h) ** 2));
};

function magnetizationCompute(p, z) {
  const h = p.length / 2, bz = axisField(p, z), onFace = Math.abs(z) === h, inside = Math.abs(z) < h;
  const volume = Math.PI * p.radius ** 2 * p.length, hOutside = bz / MU0, hInside = bz / MU0 - p.M;
  const scalars = [scalar('Kb', '구속 면전류 K_b = M × a_n (φ 방향 크기)', p.M, 'A/m'), scalar('Ib', '등가 코일의 총 전류 K_b ℓ', p.M * p.length, 'A'),
    scalar('moment', '자기 모멘트 m = M·부피', p.M * volume, 'A·m²'), scalar('mu0M', '긴 막대 극한의 B = μ₀M', MU0 * p.M, 'T'),
    scalar('Bz', '축상 B_z', bz, 'T'), scalar('Hz', '축상 H_z = B/μ₀ − M (자석 안) / B/μ₀ (밖)', inside ? hInside : hOutside, 'A/m'),
    scalar('Mz', '그 위치의 M_z', inside ? p.M : 0, 'A/m')];
  const notes = ['균일 M의 내부 구속전류는 서로 상쇄하고 표면에 K_b = M × a_n 만 남습니다: 같은 길이·면전류의 솔레노이드와 외부 B가 같습니다.',
    'B는 닫힌 곡선(솔레노이드 모양), H는 극에서 나와 극으로 들어가는 선입니다: 자석 안에서 H는 M과 반대(감자 효과).',
    'B = μ₀(H + M): 구속전류와 자유전류를 모두 포함한 장이 B, 자유전류만의 장이 H입니다.'];
  if (onFace) return { status: 'boundary', reason: '끝면에서 B는 연속이지만 M이 0으로 끊겨 H = B/μ₀ − M이 점프합니다. 안쪽·바깥쪽 극한을 따로 표시합니다.', region: 'end-face', vectors: { B: [0, 0, bz] }, scalars, notes };
  return { region: inside ? 'inside-magnet' : 'outside', vectors: { B: [0, 0, bz], H: [0, 0, inside ? hInside : hOutside] }, scalars, notes };
}

function magnetizationVerify(p) {
  const method = 'independent ring-by-ring sum of the loop-axis field, rings of current K_b dz′ (≥ 4000, ≥ 40 per a)', count = Math.min(200000, Math.max(4000, Math.ceil(40 * p.length / p.radius))), h = p.length / 2, a2 = p.radius ** 2;
  const sumAt = z => {
    let total = 0;
    for (let i = 0; i < count; i++) {
      const zp = -h + (i + 0.5) * p.length / count;
      total += MU0 * p.M * (p.length / count) * a2 / (2 * (a2 + (z - zp) ** 2) ** 1.5);
    }
    return total;
  };
  const far = 40 * Math.max(p.length, p.radius), moment = p.M * Math.PI * a2 * p.length, scale = Math.abs(MU0 * p.M) + 1e-300;
  const center = magnetizationCompute(p, 0);
  const bCenter = center.scalars.find(s => s.key === 'Bz').value, hCenter = center.scalars.find(s => s.key === 'Hz').value;
  return [checkRow('중심 B_z: 고리 합 = 닫힌 꼴', method, sumAt(0), axisField(p, 0), 'T', 1e-7, 1e-12 * scale),
    checkRow('z = ℓ 에서 B_z: 고리 합 = 닫힌 꼴', method, sumAt(p.length), axisField(p, p.length), 'T', 1e-7, 1e-12 * scale),
    checkRow('원거리 축상 B ≈ μ₀m/(2π z³) (쌍극자)', 'dipole far field on the axis', axisField(p, far), MU0 * moment / (TWO_PI * far ** 3), 'T', 5e-3, 1e-18 * scale),
    checkRow('중심에서 B = μ₀(H + M)', 'constitutive relation at the center', bCenter, MU0 * (hCenter + p.M), 'T', 1e-9, 1e-12 * scale)];
}

const magnetization = defineLecture({
  id: 'matter-magnetization', title: '자화와 구속전류 — 막대자석 · 6주차 §8.6', topic: TOPIC, week: WEEK, sections: ['8.5', '8.6'],
  description: '균일 자화 M의 막대자석은 표면 구속전류 K_b = M × a_n 의 솔레노이드와 같습니다. 축상 B와 H = B/μ₀ − M를 비교합니다.',
  parameters: magnetizationParameters, probeDefault: [0, 0, 0],
  view: { kind: 'profile', plane: 'xz', extent: 1, probeAxes: [0, 2], coordinate: coordinate('z', 'm', '막대 중심에서의 축 위치') },
  compute: magnetizationCompute,
  profile: (p, count) => {
    const h = p.length / 2, zs = linspace(-1.6 * p.length, 1.6 * p.length, count), b = z => axisField(p, z);
    const sided = (test, f) => zs.filter(test).map(z => ({ coordinate: z, value: f(z) }));
    const hOut = z => b(z) / MU0, hIn = z => b(z) / MU0 - p.M;
    const hPoints = [...sided(z => z < -h, hOut), { coordinate: -h, value: hOut(-h) }, { coordinate: -h, value: hIn(-h) }, ...sided(z => Math.abs(z) < h, hIn),
      { coordinate: h, value: hIn(h) }, { coordinate: h, value: hOut(h) }, ...sided(z => z > h, hOut)];
    return [series('Bz', 'B_z(z) 축상 (연속)', 'T', 'z', 'm', zs.map(z => ({ coordinate: z, value: b(z) }))),
      series('Hz', 'H_z(z) = B/μ₀ − M (끝면에서 점프)', 'A/m', 'z', 'm', hPoints)];
  },
  verify: magnetizationVerify,
  assumptions: ['반지름 a, 길이 ℓ인 원기둥에 +z 방향 균일 자화 M. 모든 값은 막대축(ρ = 0) 위에서 계산합니다. 진공 중, 영구자석(M은 H에 의존하지 않는 M₀).',
    '구속전류는 J_b = ∇×M = 0(내부), K_b = M × a_n = M φ̂(옆면), 끝면은 M ∥ a_n이라 0입니다.',
    '프리셋 M = 1×10⁶ A/m(B_r ≈ 1.26 T급 강자성체)와 a = 10 mm, ℓ = 50 mm는 이 앱의 예시 값이며 강의 숫자가 아닙니다.'],
  validity: ['축 위 점만 지원합니다. 그래프 범위는 −1.6ℓ … 1.6ℓ입니다.', 'M < 0이면 모든 장의 방향이 반대입니다.'],
  singularities: ['z = ±ℓ/2(끝면)에서는 B는 연속이지만 H가 M만큼 점프하므로 boundary로 표시합니다.'],
  formulas: [{ label: '구속전류', text: 'J_b = ∇×M, K_b = M × a_n', unit: 'A/m²; A/m' }, { label: '구성 관계', text: 'B = μ₀(H + M)', unit: 'T' },
    { label: '축상 장', text: 'B_z = (μ₀M/2)[(z+ℓ/2)/√(a²+(z+ℓ/2)²) − (z−ℓ/2)/√(a²+(z−ℓ/2)²)]', unit: 'T' }],
  references: [hayt('8.6', 'Magnetization and permeability'), REF.matter],
  symbolic: {
    title: '균일 자화 막대의 구속전류 — 기호 풀이',
    givens: [['M', '+z 방향 균일 자화', 'A/m'], ['a, ℓ', '반지름, 길이', 'm']],
    laws: [['구속전류', 'J_b = ∇×M, K_b = M × a_n'], ['자기장 세기', 'H = B/μ₀ − M'], ['쌍극자 밀도', 'M = lim (1/Δv) Σ m_i']],
    steps: [['내부', 'M = 상수 → J_b = ∇×M = 0', '이웃 쌍극자의 전류가 서로 상쇄합니다.'],
      ['옆면', 'K_b = M ẑ × ρ̂ = M φ̂', '단위 길이당 전류 M: 코일의 nI = M과 같습니다.'], ['등가 솔레노이드', 'B_z(z) = (μ₀M/2)[…]', '유한 솔레노이드의 축상 식을 K = M으로 씁니다.'],
      ['긴 막대 극한', 'ℓ ≫ a: B ≈ μ₀M, H ≈ 0 (중앙)', 'B = μ₀(H+M)에서 H = B/μ₀ − M은 M과 반대(감자장).']],
    answers: [['구속 면전류', 'K_b = M φ̂', 'A/m'], ['자기 모멘트', 'm = M π a² ℓ', 'A·m²'], ['축상 B', 'B_z(z) = (μ₀M/2)[(z+ℓ/2)/√(a²+(z+ℓ/2)²) − (z−ℓ/2)/√(a²+(z−ℓ/2)²)]', 'T']],
    limitations: ['축 밖의 장과 H의 2D 분포는 계산하지 않습니다.'],
  },
});

// ---- 5b. Susceptibility and permeability --------------------------------------------------------------------------------
const susceptibilityParameters = [
  parameter('chi', '자화율 χ_m (역자성 < 0, 상자성 > 0)', '1', '1', 1, 3999, -1, 1e7),
];

const classOf = chi => (chi < 0 ? 'diamagnetic' : chi <= 0.1 ? 'paramagnetic' : 'ferromagnetic-like');

function susceptibilityCompute(p, h) {
  const chi = p.chi, mu = MU0 * (1 + chi), m = chi * h, b = mu * h, region = classOf(chi);
  const names = { diamagnetic: '반자성(χ_m < 0): 장을 약하게 밀어냄', paramagnetic: '상자성(작은 χ_m > 0)', 'ferromagnetic-like': '강자성 모형(μ_r ≫ 1, 선형 근사)' };
  return {
    region, vectors: { B: [0, 0, b], H: [0, 0, h] },
    scalars: [scalar('mur', '비투자율 μ_r = 1 + χ_m', 1 + chi, '1'), scalar('mu', '투자율 μ = μ₀μ_r', mu, 'H/m'), scalar('M', '자화 M = χ_m H', m, 'A/m'),
      scalar('B', '자속밀도 B = μ₀(H + M) = μH', b, 'T'), scalar('Bvac', '같은 H의 진공 B = μ₀H', MU0 * h, 'T'), scalar('ratio', 'B / B_진공 = μ_r', 1 + chi, '1')],
    notes: [names[region], '손글씨 필기 예: 반자성 χ_m ≈ −10⁻⁵, 강자성은 B–H 곡선(1 T ↔ 200 A/m)에서 μ_r = (1/200)/μ₀ ≈ 4000.',
      'μ_r < 0이 되는 χ_m < −1은 지원하지 않고, χ_m = −1(μ_r = 0)이 완전반자성(초전도) 극한입니다. 실제 강자성체는 H에 비선형(포화·이력)입니다.'],
  };
}

const susceptibility = defineLecture({
  id: 'matter-susceptibility', title: '자화율·투자율 관계 B = μ₀(1+χ_m)H · 6주차 §8.5–8.6', topic: TOPIC, week: WEEK, sections: ['8.5', '8.6'],
  description: '반자성·상자성·강자성의 선형 모형: M = χ_m H, B = μ₀(H+M) = μ₀μ_r H. 그래프에서 H를 끌어 봅니다.',
  parameters: susceptibilityParameters, probeDefault: [0, 0, 1e4],
  view: { kind: 'profile', plane: 'xz', extent: 1, probeAxes: [0, 2], coordinate: coordinate('H', 'A/m', '자기장 세기') },
  compute: susceptibilityCompute,
  profile: (p, count) => {
    const hs = linspace(0, 2e4, count);
    return [series('B', 'B(H) = μ₀(1+χ_m)H', 'T', 'H', 'A/m', hs.map(h => ({ coordinate: h, value: MU0 * (1 + p.chi) * h }))),
      series('M', 'M(H) = χ_m H', 'A/m', 'H', 'A/m', hs.map(h => ({ coordinate: h, value: p.chi * h })))];
  },
  verify: p => {
    const method = 'independent relations B = μ₀(H+M) and B = μH', h = 1234.5, m = p.chi * h;
    return [checkRow('B = μ₀(H + M)', method, MU0 * (h + m), MU0 * (1 + p.chi) * h, 'T', 1e-12, 1e-18),
      checkRow('M/H = χ_m', method, m / h, p.chi, '1', 1e-12, 1e-12)];
  },
  assumptions: ['선형·등방·균질 자성체(M = χ_m H). 프리셋 χ_m = 3999는 b32의 곡선 점 1 T ↔ 200 A/m에서 나온 μ_r ≈ 4000(= 3979, 이 앱이 계산한 값)을 반올림한 예시입니다.',
    '분류 경계(|χ_m| ≤ 0.1이면 상자성)는 이 앱의 구분이며 강의에 숫자가 주어지지 않았습니다.'],
  validity: ['−1 ≤ χ_m ≤ 10⁷, H ≥ 0. 포화·이력은 자기회로 실험에서 다룹니다.'],
  singularities: ['특이점은 없습니다. χ_m = −1이면 B = 0(완전반자성).'],
  formulas: [{ label: '자화', text: 'M = χ_m H', unit: 'A/m' }, { label: '구성 관계', text: 'B = μ₀(H + M) = μ₀(1 + χ_m)H = μ₀μ_r H = μH', unit: 'T' }],
  references: [hayt('8.5', 'The nature of magnetic materials'), hayt('8.6', 'Magnetization and permeability'), REF.matter],
  symbolic: {
    title: '자화율과 투자율 — 기호 풀이',
    givens: [['χ_m', '자화율', '1'], ['H', '자기장 세기', 'A/m']],
    laws: [['자화', 'M = χ_m H'], ['자속밀도', 'B = μ₀(H + M)']],
    steps: [['자화 대입', 'B = μ₀(H + χ_m H)', ''], ['정리', 'B = μ₀(1 + χ_m)H = μ₀μ_r H = μH', 'μ_r = 1 + χ_m'],
      ['종류', 'χ_m < 0: 반자성(μ_r ≲ 1), χ_m > 0 작음: 상자성, χ_m 매우 큼: 강자성', '반자성 χ_m ≈ −10⁻⁵, 강자성 μ_r ~ 10³–10⁴.']],
    answers: [['비투자율', 'μ_r = 1 + χ_m', '1'], ['자속밀도', 'B = μ₀(1 + χ_m)H', 'T'], ['자화', 'M = χ_m H', 'A/m']],
    limitations: ['선형 관계만 다룹니다. 비선형 B–H 곡선은 자기회로 실험을 보세요.'],
  },
});

// ---- 6a. Boundary conditions and refraction ------------------------------------------------------------------------------
const boundaryParameters = [
  parameter('mu1R', '영역 1의 비투자율 μ_r1', '1', '1', 1, 1, 1e-3, 1e6),
  parameter('mu2R', '영역 2의 비투자율 μ_r2', '1', '1', 1, 1e4, 1e-3, 1e6),
  parameter('B1', '영역 1의 자속밀도 크기 B₁', 'T', 'mT', 1e-3, 1e-4, 0, 10),
  parameter('K', '경계의 자유 면전류 K (+y 방향)', 'A/m', 'A/m', 1, 0, -1e6, 1e6),
];

// Normal a_N12 = +z (from region 1 to region 2), plane of incidence xz, K = K ŷ:  H₂t − H₁t = K  (from (H₁−H₂)×a_N12 = K).
function boundaryFields(p, theta1) {
  const mu1 = MU0 * p.mu1R, mu2 = MU0 * p.mu2R, b1n = p.B1 * Math.cos(theta1), b1t = p.B1 * Math.sin(theta1);
  const h1t = b1t / mu1, h2t = h1t + p.K, b2t = mu2 * h2t, b2n = b1n;
  // B₂ = 0 (B₁ = 0 and K = 0) has no direction: θ₂ is undefined (NaN), not atan2(0, 0) = 0
  return { mu1, mu2, b1n, b1t, h1t, h1n: b1n / mu1, h2t, h2n: b2n / mu2, b2t, b2n, theta2: b2t === 0 && b2n === 0 ? NaN : Math.atan2(b2t, b2n) };
}

function boundaryCompute(p, theta1) {
  if (theta1 < 0 || theta1 > Math.PI / 2) return excluded('unsupported', '입사각 θ₁은 0 … π/2 (법선 기준)여야 합니다.', 'out-of-range');
  const f = boundaryFields(p, theta1), magnitude = Math.hypot(f.b2t, f.b2n);
  return {
    region: 'region-2', vectors: { B: [f.b2t, 0, f.b2n], H: [f.h2t, 0, f.h2n] },
    scalars: [scalar('theta1', '영역 1의 각 θ₁ (법선 기준)', theta1 * 180 / Math.PI, '°'),
      ...(Number.isFinite(f.theta2) ? [scalar('theta2', '영역 2의 각 θ₂', f.theta2 * 180 / Math.PI, '°')] : []),
      ...(theta1 > 0 && Number.isFinite(f.theta2) && f.b2n !== 0 ? [scalar('tanRatio', 'tanθ₂/tanθ₁ (K = 0이면 μ₂/μ₁)', Math.tan(f.theta2) / Math.tan(theta1), '1')] : []),
      scalar('muRatio', 'μ₂/μ₁', f.mu2 / f.mu1, '1'),
      scalar('B1n', '영역 1의 법선 B₁n', f.b1n, 'T'), scalar('B2n', '영역 2의 법선 B₂n (연속)', f.b2n, 'T'),
      scalar('H1t', '영역 1의 접선 H₁t', f.h1t, 'A/m'), scalar('H2t', '영역 2의 접선 H₂t = H₁t + K', f.h2t, 'A/m'),
      scalar('B1t', '영역 1의 접선 B₁t', f.b1t, 'T'), scalar('B2t', '영역 2의 접선 B₂t = μ₂H₂t', f.b2t, 'T'),
      scalar('B2', '영역 2의 |B₂|', magnitude, 'T'), scalar('H2', '영역 2의 |H₂|', Math.hypot(f.h2t, f.h2n), 'A/m')],
    notes: [...(Number.isFinite(f.theta2) ? [] : ['B₁ = 0이고 K = 0이면 영역 2의 B₂ = 0이라 방향이 없어 θ₂와 tanθ₂/tanθ₁는 정의되지 않습니다(표시하지 않음).']),
      '법선 B는 항상 연속(B₁n = B₂n), 접선 H는 자유 면전류 K만큼 점프합니다: (H₁ − H₂) × a_N12 = K, a_N12는 영역 1에서 2로 향하는 법선.',
      'K = 0이면 H_t가 연속이고 tanθ₂/tanθ₁ = μ₂/μ₁. 투자율이 큰 쪽에서 장선이 법선에서 멀어져 경계면과 거의 평행해집니다(철 속 장선).',
      'μ₂ ≫ μ₁이면 영역 2에서 H_t ≈ H₁t(작음)이고 B₂t = μ₂H₂t는 아주 큽니다. 이 선형 모형은 포화를 무시합니다.'],
  };
}

function boundaryVerify(p) {
  const method = 'independent boundary relations (B_n continuity, H_t continuity, Ampère loop)', theta = 0.5;
  const base = boundaryCompute({ ...p, K: 0 }, theta), value = (r, key) => r.scalars.find(s => s.key === key).value;
  const withK = boundaryCompute(p, theta), law = Math.atan2(p.mu2R * Math.sin(theta), p.mu1R * Math.cos(theta)), dl = 1e-3;
  const refraction = p.B1 === 0 ? skippedRow('K = 0: tanθ₂ = (μ₂/μ₁) tanθ₁ (θ₁ = 0.5 rad)', 'B₁ = 0이면 K = 0일 때 B₂ = 0이라 θ₂가 정의되지 않아 굴절 검산을 건너뜁니다.', method, 'rad')
    : checkRow('K = 0: tanθ₂ = (μ₂/μ₁) tanθ₁ (θ₁ = 0.5 rad)', method, value(base, 'theta2') * Math.PI / 180, law, 'rad', 1e-12, 1e-12);
  return [refraction,
    checkRow('B₂n = B₁n', method, value(withK, 'B2n'), value(withK, 'B1n'), 'T', 1e-12, 1e-30),
    checkRow('얇은 직사각 암페어 경로 ∮H·dl = (H₂t − H₁t) Δl = K Δl', method, (value(withK, 'H2t') - value(withK, 'H1t')) * dl, p.K * dl, 'A', 1e-9, 1e-12 * Math.abs(value(withK, 'H1t') * dl) + 1e-30)];
}

const boundary = defineLecture({
  id: 'matter-boundary', title: '자기 경계조건과 굴절 tanθ₂/tanθ₁ = μ₂/μ₁ · 6주차 §8.7', topic: TOPIC, week: WEEK, sections: ['8.7'],
  description: '두 자성체의 경계: B_n 연속, H_t는 면전류 K만큼 점프. 그래프에서 입사각 θ₁을 끌어 굴절각 θ₂를 봅니다(프리셋 μ₂/μ₁ = 10⁴).',
  parameters: boundaryParameters, probeDefault: [0, 0, 0.5],
  view: { kind: 'profile', plane: 'xz', extent: 1, probeAxes: [0, 2], coordinate: coordinate('θ₁', 'rad', '영역 1의 입사각(법선 기준)') },
  compute: boundaryCompute,
  profile: (p, count) => {
    const angles = linspace(0, Math.PI / 2, count), fields = angles.map(t => boundaryFields(p, t));
    return [series('theta2', '굴절각 θ₂(θ₁)', 'rad', 'θ₁', 'rad', angles.map((t, i) => ({ coordinate: t, value: fields[i].theta2 }))),
      series('B2t', '접선 B₂t(θ₁)', 'T', 'θ₁', 'rad', angles.map((t, i) => ({ coordinate: t, value: fields[i].b2t }))),
      series('B2', '|B₂|(θ₁)', 'T', 'θ₁', 'rad', angles.map((t, i) => ({ coordinate: t, value: Math.hypot(fields[i].b2t, fields[i].b2n) })))];
  },
  verify: boundaryVerify,
  assumptions: ['선형·등방 균질한 두 자성체의 평면 경계. 법선 a_N12 = +z(영역 1 → 2), 입사면은 xz, 자유 면전류는 K ŷ입니다.',
    '프리셋은 b23 예제의 μ₁ = μ₀, μ₂ = 10⁴μ₀입니다. B₁ = 0.1 mT는 이 앱이 정한 크기이고 θ₁ = 0.5 rad의 굴절 결과는 앱이 계산한 값입니다.',
    '필기에서 "①/②" 중 어느 쪽인지의 질문과 μ₂ ≫ μ₁ 극한(H_t → 0?)은 해석이 포함되어 있습니다: 이 모형에서 H₂t = H₁t(K = 0)는 작고 B₂t = μ₂H₂t가 큽니다.'],
  validity: ['0 ≤ θ₁ ≤ π/2. B₁ = 0이면 K ≠ 0일 때만 영역 2에 B₂t가 생깁니다.', 'tanθ₂/tanθ₁는 θ₁ = 0에서 정의되지 않습니다(미정으로 표시).'],
  singularities: ['θ₁ = 0에서 비율 tanθ₂/tanθ₁는 0/0입니다. 이 경우 비율 칸은 유한한 값이 아닙니다.'],
  formulas: [{ label: '법선 B', text: 'B₁n = B₂n', unit: 'T' }, { label: '접선 H', text: '(H₁ − H₂) × a_N12 = K', unit: 'A/m' },
    { label: '굴절', text: 'tanθ₂/tanθ₁ = μ₂/μ₁', unit: '1' }],
  references: [hayt('8.7', 'Magnetic boundary conditions'), REF.matter],
  symbolic: {
    title: '자기 경계조건과 굴절 — 기호 풀이',
    givens: [['μ₁, μ₂', '영역 1, 2의 투자율', 'H/m'], ['θ₁', '영역 1의 각(법선 기준)', 'rad'], ['K', '자유 면전류', 'A/m']],
    laws: [['가우스(자기)', '∮B·ds = 0'], ['암페어', '∮H·dl = I_free']],
    steps: [['필박스', 'B₁n = B₂n', '경계에 얇은 상자를 놓고 ∮B·ds = 0을 씁니다.'],
      ['직사각 암페어 경로', 'H₁t Δl − H₂t Δl = K Δl, 즉 (H₁ − H₂) × a_N12 = K', '높이 Δh → 0인 경로가 감싸는 자유 전류는 K Δl.'],
      ['K = 0: 굴절', 'H₁ sinθ₁ = H₂ sinθ₂, μ₁H₁ cosθ₁ = μ₂H₂ cosθ₂ → tanθ₂/tanθ₁ = μ₂/μ₁', '두 식을 나누면 μ₂/μ₁ 비로 휘어집니다.']],
    answers: [['굴절 법칙', 'tanθ₂ = (μ₂/μ₁) tanθ₁', '1', 'μ₂ > μ₁이면 법선에서 멀어짐'], ['법선 B', 'B₂n = B₁n', 'T'], ['접선 H', 'H₂t = H₁t + K', 'A/m']],
    limitations: ['선형 균질 매질, 평면 경계만 다룹니다.'],
  },
});

// ---- 6b. Image of a line current across a high-μ plane or a superconductor ----------------------------------------------
const CASES = [[0, '철 μ → ∞ (같은 방향 영상)'], [1, '초전도·완전반자성 (반대 방향 영상)'], [2, '유한 μ₂ (일반)']];
const imageParameters = [
  parameter('current', '선전류 I (+z, 종이에서 나오는 방향)', 'A', 'A', 1, 10, -1e4, 1e4),
  parameter('h', '경계면에서 선전류까지 거리 h', 'm', 'mm', 1e-3, 0.05, 1e-3, 10),
  choiceParameter('case', '아래 영역의 종류', 0, CASES),
  parameter('mu2R', '유한 μ₂ 선택 시 비투자율 μ_r2', '1', '1', 1, 1000, 1e-3, 1e9),
];

const imageRatio = p => (p.case === 0 ? 1 : p.case === 1 ? -1 : (p.mu2R - 1) / (p.mu2R + 1));

// Wire at the origin, interface y = −h (air above, region 2 below), image at (0, −2h) carrying k I.
function imageCompute(p, point) {
  const [x, y] = point, k = imageRatio(p), fac = p.current / TWO_PI, r2 = x * x + y * y;
  if (r2 === 0) return excluded('singular', '선전류 위에서는 장이 발산합니다.', 'wire');
  const wire = [-y / r2, x / r2];
  const common = [scalar('k', '영상 전류 비율 k = I′/I', k, '1'), scalar('imageCurrent', '영상 전류 I′ = kI', k * p.current, 'A'),
    scalar('wireForce', '선전류가 받는 단위 길이 힘 k μ₀I²/(4πh) (+ 경계 쪽 인력)', k * MU0 * p.current ** 2 / (4 * Math.PI * p.h), 'N/m')];
  const notes = ['경계 위쪽(공기)의 장은 선전류와 영상 전류(거리 2h 아래)가 함께 만든 장이고, 아래쪽의 장은 (1−k)I의 한 선전류가 만든 장처럼 계산합니다.',
    '철(μ → ∞)은 같은 방향 영상(k = 1)이라 장선이 경계에 수직으로 들어가고, 초전도체는 반대 방향 영상(k = −1)이라 장선이 경계에 접합니다.'];
  if (y === -p.h) {
    const bn = MU0 * fac * x * (1 + k) / r2, ht = fac * p.h * (1 - k) / r2;
    return { status: 'boundary', reason: '경계면 위입니다. B_n과 H_t는 양쪽에서 연속이고 B_t, H_n은 불연속일 수 있어 단일 벡터를 표시하지 않습니다.', region: 'interface', vectors: {},
      scalars: [...common, scalar('Bn', '경계 법선 B_n (연속)', bn, 'T'), scalar('Ht', '경계 접선 H_t (연속)', ht, 'A/m'),
        scalar('Bt1', '위쪽 B_t', MU0 * ht, 'T'), scalar('Bt2', '아래쪽 B_t = μ₂H_t', MU0 * (1 + k) * fac * p.h / r2, 'T')], notes };
  }
  let h;
  if (y > -p.h) {
    const r2i = x * x + (y + 2 * p.h) ** 2;
    h = [fac * (wire[0] + k * (-(y + 2 * p.h)) / r2i), fac * (wire[1] + k * x / r2i)];
  } else h = wire.map(v => (1 - k) * fac * v);
  const b = y > -p.h ? h.map(v => MU0 * v) : wire.map(v => MU0 * (1 + k) * fac * v);
  return { region: y > -p.h ? 'air' : 'medium-2', vectors: { B: [b[0], b[1], 0], H: [h[0], h[1], 0] },
    scalars: [...common, scalar('Bmag', '|B|', Math.hypot(...b), 'T'), scalar('Hmag', '|H|', Math.hypot(...h), 'A/m')], notes };
}

function imageVerify(p) {
  const method = 'continuity of B_n and H_t evaluated just above and below the interface', eps = 1e-9 * p.h, rows = [];
  for (const x of [-2 * p.h, 0.4 * p.h, 3 * p.h]) {
    const up = imageCompute(p, [x, -p.h + eps, 0]), down = imageCompute(p, [x, -p.h - eps, 0]);
    if (!up.vectors.B || !down.vectors.B) { rows.push({ label: `x = ${x} m`, method, status: 'skipped', reason: '경계 근방 표본을 만들 수 없습니다.', unit: '' }); continue; }
    const scale = Math.hypot(...up.vectors.B) + 1e-300, hscale = Math.hypot(...up.vectors.H) + 1e-300;
    rows.push(checkRow(`x = ${Number(x.toPrecision(3))} m: B_n 연속`, method, down.vectors.B[1], up.vectors.B[1], 'T', 1e-6, 1e-6 * scale),
      checkRow(`x = ${Number(x.toPrecision(3))} m: H_t 연속`, method, down.vectors.H[0], up.vectors.H[0], 'A/m', 1e-6, 1e-6 * hscale));
  }
  return rows;
}

const image = defineLecture({
  id: 'matter-image', title: '영상 전류 — 철(μ→∞)·초전도체 위의 선전류 · 6주차 §8.7', topic: TOPIC, week: WEEK, sections: ['8.7'],
  description: '무한 직선전류가 평면 경계에서 거리 h에 있을 때: μ → ∞는 같은 방향 영상, 초전도체는 반대 방향 영상. 흰 점을 끌어 B, H를 읽습니다.',
  parameters: imageParameters, probeDefault: [0.03, 0.02, 0],
  view: { kind: 'lecture-plane', plane: 'xy', extent: 0.25, probeAxes: [0, 1],
    overlay: p => ({ lines: [{ a: [-1, -p.h], b: [1, -p.h], label: '경계면' }], glyphs: [{ at: [0, -2 * p.h], sign: Math.sign(imageRatio(p) * p.current), label: '영상 전류 I′ = kI' }],
      texts: ['원점: 선전류 · 가운데 점선: 경계면 · 아래 점: 영상 전류'] }) },
  compute: (p, s, point) => imageCompute(p, point),
  verify: imageVerify,
  assumptions: ['선전류는 원점에서 z 방향, 경계면은 y = −h의 평면, 위쪽은 진공(μ₀), 아래쪽은 철(μ → ∞), 초전도체(B = 0) 또는 유한 μ₂입니다.',
    '영상 비율 k = (μ₂ − μ₁)/(μ₂ + μ₁): 철 +1, 초전도체 −1. 아래쪽 장은 (1−k)I의 한 선전류의 장입니다. 이 공식은 경계조건(B_n, H_t 연속)으로 이 앱이 유도한 것이며 필기는 스케치(b24, b26)만 있습니다.',
    '철 속에서 H는 0이지만 B는 공기 쪽 장의 2배(B = μ₀(1+k)I/(2πR)로 유한)입니다.'],
  validity: ['점은 선전류 위(원점)가 아니어야 하고 경계면 위에서는 boundary로 표시합니다.', '2D(z 무관) 문제입니다. 전류가 경계면 위쪽에 있을 때만 영상법을 씁니다.'],
  singularities: ['원점(선전류)은 singular, y = −h(경계면)은 boundary입니다.'],
  formulas: [{ label: '영상 비율', text: 'I′ = [(μ₂ − μ₁)/(μ₂ + μ₁)] I', unit: 'A' }, { label: '경계조건', text: 'B₁n = B₂n, H₁t = H₂t', unit: '' },
    { label: '선전류의 힘', text: 'F′ = μ₀ I I′/(2π · 2h) = k μ₀ I²/(4π h)', unit: 'N/m' }],
  references: [hayt('8.7', 'Magnetic boundary conditions — image currents'), REF.matter],
  symbolic: {
    title: '경계면 위 선전류의 영상법 — 기호 풀이',
    givens: [['I', '선전류', 'A'], ['h', '경계면까지 거리', 'm'], ['μ₁, μ₂', '위·아래 투자율', 'H/m']],
    laws: [['경계조건', 'B₁n = B₂n, H₁t = H₂t'], ['직선전류', 'H = I/(2πR) φ̂']],
    steps: [['위쪽 장', 'H₁ = (I/2π)[φ̂/R + k φ̂′/R′]', '실제 전류와 영상 전류 kI(거리 2h 아래)의 합입니다.'],
      ['아래쪽 장', 'H₂ = ((1 − k)I/2π) φ̂/R', '실제 위치의 한 전류가 만든 장으로 쓰고 H_t 연속에서 계수가 1 − k.'],
      ['B_n 연속으로 k 결정', 'μ₁(1 + k) = μ₂(1 − k) → k = (μ₂ − μ₁)/(μ₂ + μ₁)', '철 k → 1, 초전도체(μ₂ = 0) k = −1.']],
    answers: [['영상 비율', 'k = (μ₂ − μ₁)/(μ₂ + μ₁)', '1', '철: 같은 방향, 초전도체: 반대 방향'], ['경계 위 B', 'B_x = μ₀I(1−k)h/(2πR²), B_y = μ₀I(1+k)x/(2πR²)', 'T'],
      ['선전류의 힘', 'F′ = k μ₀ I²/(4π h)', 'N/m']],
    limitations: ['선전류가 한 매질 안에 있고 경계가 평면일 때만 유효합니다.'],
  },
});

export const EXPERIMENTS = [magnetization, susceptibility, boundary, image];
