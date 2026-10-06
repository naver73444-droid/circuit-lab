// Hayt Ch.8 §8.9–8.10 lecture experiments: inductance (solenoid, coax, toroid, mutual) and magnetic energy. Pure: no DOM.
import {
  MU0, REF, TWO_PI, checkRow, choiceParameter, coordinate, defineLecture, excluded, hayt, linspace, parameter, scalar, series,
} from './em-course-lecture.js';

const TOPIC = 'inductance';
const WEEK = 6;
const area = radius => Math.PI * radius * radius;

// ---- 9a. Solenoid ---------------------------------------------------------------------------------------------------------
const solenoidParameters = [
  parameter('turnsPerMeter', '단위 길이당 감은 수 n', '1/m', '1/m', 1, 1000, 1, 1e5),
  parameter('radius', '솔레노이드 반지름 a', 'm', 'cm', 0.01, 0.02, 1e-4, 10),
  parameter('length', '솔레노이드 길이 ℓ', 'm', 'cm', 0.01, 0.5, 1e-3, 100),
  parameter('muR', '코어의 비투자율 μ_r (선형)', '1', '1', 1, 1, 1, 1e5),
];

function solenoidModel(p) {
  const mu = MU0 * p.muR, S = area(p.radius), perLength = mu * p.turnsPerMeter ** 2 * S;
  return { mu, S, perLength, L: perLength * p.length, turns: p.turnsPerMeter * p.length };
}

function solenoidCompute(p, current) {
  const m = solenoidModel(p), B = m.mu * p.turnsPerMeter * current, H = p.turnsPerMeter * current, flux = B * m.S;
  const energy = 0.5 * m.L * current ** 2;
  return {
    region: 'inside', vectors: { B: [0, 0, B], H: [0, 0, H] },
    scalars: [scalar('Lper', '단위 길이당 인덕턴스 L′ = μn²S', m.perLength, 'H/m'), scalar('L', '전체 인덕턴스 L = L′ℓ', m.L, 'H'),
      scalar('turns', '전체 감은 수 N = nℓ', m.turns, '1'), scalar('flux', '한 바퀴의 자속 Φ = BS', flux, 'Wb'),
      scalar('linkagePer', '단위 길이당 쇄교자속 Λ′ = nΦ', p.turnsPerMeter * flux, 'Wb·turn/m'), scalar('linkage', '전체 쇄교자속 Λ = NΦ = LI', m.turns * flux, 'Wb·turn'),
      scalar('energy', '저장 에너지 W = ½LI²', energy, 'J'), scalar('energyDensity', '에너지 밀도 ½B·H', 0.5 * B * H, 'J/m³'), scalar('current', '관측 전류 I', current, 'A')],
    notes: ['L = Λ/I, Λ = NΦ. 긴 솔레노이드는 B = μnI가 균일해 쇄교자속이 I에 비례하므로 L은 I와 무관한 상수입니다.',
      '필기의 L = μn²S는 단위 길이당 값 [H/m]입니다. 길이 ℓ를 곱해 전체 L을 얻습니다. 가장자리 효과는 무시합니다.'],
  };
}

function solenoidVerify(p) {
  const method = 'independent radial ring sums of B·dA and ½B·H dv (500 rings)', m = solenoidModel(p), rings = 500, current = 1.3;
  const B = m.mu * p.turnsPerMeter * current, H = p.turnsPerMeter * current;
  let flux = 0, energy = 0;
  for (let i = 0; i < rings; i++) {
    const r = (i + 0.5) * p.radius / rings, ring = TWO_PI * r * p.radius / rings;
    flux += B * ring; energy += 0.5 * B * H * ring * p.length;
  }
  const linkage = m.turns * flux;
  return [checkRow('L = Λ/I (링 합으로 구한 쇄교자속)', method, linkage / current, m.L, 'H', 1e-9, 1e-18),
    checkRow('W = ½∫B·H dv = ½LI²', method, energy, 0.5 * m.L * current ** 2, 'J', 1e-9, 1e-18),
    checkRow('L′ = Λ′/I = nΦ/I', method, p.turnsPerMeter * flux / current, m.perLength, 'H/m', 1e-9, 1e-18)];
}

const solenoid = defineLecture({
  id: 'induct-solenoid', title: '긴 솔레노이드의 인덕턴스 L = μn²S · 6주차 §8.10', topic: TOPIC, week: WEEK, sections: ['8.9', '8.10'],
  description: '쇄교자속 Λ = nΦ, L = Λ/I = μn²S [H/m]. 그래프에서 전류 I를 끌면 Λ와 W = ½LI²이 어떻게 변하는지 봅니다.',
  parameters: solenoidParameters, probeDefault: [0, 0, 2],
  view: { kind: 'profile', plane: 'xz', extent: 1, probeAxes: [0, 2], coordinate: coordinate('I', 'A', '코일 전류') },
  compute: solenoidCompute,
  profile: (p, count) => {
    const m = solenoidModel(p), currents = linspace(-10, 10, count);
    return [series('linkage', '쇄교자속 Λ = LI', 'Wb·turn', 'I', 'A', currents.map(i => ({ coordinate: i, value: m.L * i }))),
      series('energy', '에너지 W = ½LI²', 'J', 'I', 'A', currents.map(i => ({ coordinate: i, value: 0.5 * m.L * i * i })))];
  },
  verify: solenoidVerify,
  assumptions: ['무한히 긴 솔레노이드의 안쪽 B = μnI(균일), 바깥 0, 가장자리 효과·피치 무시, 선형 균질 코어. 프리셋 n = 1000/m, a = 2 cm, ℓ = 0.5 m는 이 앱의 예시입니다.',
    'W = ½LI² = ½∫B·H dv 두 식이 같은 값을 줍니다(필기 c03–c06의 두 에너지 표현).'],
  validity: ['그래프 범위 I = −10 … 10 A(L은 I와 무관). ℓ ≫ a에서만 정확합니다.'],
  singularities: ['특이점은 없습니다.'],
  formulas: [{ label: '인덕턴스', text: 'L ≡ Λ/I, Λ = NΦ', unit: 'H' }, { label: '솔레노이드', text: 'B = μ n I, L′ = μ n² S, L = L′ ℓ', unit: 'H/m' },
    { label: '에너지', text: 'W = ½ L I² = ½ ∫ B·H dv', unit: 'J' }],
  references: [hayt('8.10', 'Inductance of the solenoid'), REF.self],
  symbolic: {
    title: '긴 솔레노이드의 인덕턴스 — 기호 풀이',
    givens: [['n', '단위 길이당 감은 수', '1/m'], ['S', '단면적', 'm²'], ['μ', '코어 투자율', 'H/m'], ['ℓ', '길이', 'm']],
    laws: [['인덕턴스', 'L = Λ/I'], ['에너지', 'W = ½ L I²']],
    steps: [['내부 B', 'B = μ n I', '암페어 법칙에서 H = nI.'], ['자속', 'Φ = B S = μ n I S', ''],
      ['단위 길이당 쇄교자속', 'Λ′ = n Φ = μ n² I S', '단위 길이에 n 바퀴가 있습니다.'], ['인덕턴스', 'L′ = Λ′/I = μ n² S [H/m], L = L′ ℓ', '']],
    answers: [['단위 길이당 인덕턴스', "L′ = μ n² S", 'H/m'], ['전체 인덕턴스', 'L = μ n² S ℓ', 'H'], ['저장 에너지', 'W = ½ L I² = ½ μ n² S ℓ I²', 'J']],
    limitations: ['가장자리 효과가 없는 긴 솔레노이드만 다룹니다.'],
  },
});

// ---- 9b. Coaxial cable ----------------------------------------------------------------------------------------------------
const coaxParameters = [
  parameter('a', '내부 도체 반지름 a', 'm', 'mm', 1e-3, 0.01, 1e-5, 1),
  parameter('b', '외부 도체 반지름 b (b > a)', 'm', 'mm', 1e-3, 0.03, 1e-5, 10),
  parameter('muRg', '도체 사이 매질의 비투자율 μ_r', '1', '1', 1, 1, 1, 1e4),
  parameter('current', '전류 I (내부 +, 외부 귀환 −)', 'A', 'A', 1, 10, -1e4, 1e4),
];

function coaxField(p, r) {
  const mu = MU0 * p.muRg;
  if (r < p.a) return { b: MU0 * p.current * r / (TWO_PI * p.a * p.a), mu: MU0 };
  if (r <= p.b) return { b: mu * p.current / (TWO_PI * r), mu };
  return { b: 0, mu };
}

const coaxModel = p => {
  const external = MU0 * p.muRg / TWO_PI * Math.log(p.b / p.a), internal = MU0 / (8 * Math.PI);
  return { external, internal, total: external + internal };
};

function coaxCompute(p, r) {
  if (r < 0) return excluded('unsupported', '반지름 r은 0 이상이어야 합니다.', 'negative-r');
  const m = coaxModel(p), field = coaxField(p, r), region = r < p.a ? 'inner-conductor' : r <= p.b ? 'between' : 'outside';
  return {
    region, vectors: { B: [0, field.b, 0], H: [0, field.b / field.mu, 0] },
    scalars: [scalar('Lext', '외부 인덕턴스 L′_ext = μ ln(b/a)/(2π)', m.external, 'H/m'), scalar('Lint', '내부 인덕턴스 L′_int = μ₀/(8π)', m.internal, 'H/m'),
      scalar('Ltotal', '합계 L′ = L′_ext + L′_int', m.total, 'H/m'), scalar('energyPer', '단위 길이 에너지 ½L′I²', 0.5 * m.total * p.current ** 2, 'J/m'),
      scalar('Bphi', '관측 위치의 B_φ', field.b, 'T'), scalar('energyDensity', '관측 위치의 에너지 밀도 B²/(2μ)', field.b ** 2 / (2 * field.mu), 'J/m³')],
    notes: ['a ≤ r ≤ b: B = μI/(2πr), 단위 길이 쇄교자속 Λ′ = ∫B dr = (μI/2π) ln(b/a): 외부 인덕턴스.',
      'r < a: B = μ₀Ir/(2πa²)는 전류의 r²/a²만 쇄교하므로 dΛ′ = (r²/a²)B dr, 적분하면 μ₀I/(8π): 내부 인덕턴스는 a·b와 무관합니다.',
      '귀환 도체는 얇은 원통(r = b)으로 보아 그 안의 내부 인덕턴스는 없다고 둡니다.'],
  };
}

function coaxVerify(p) {
  const method = 'independent radial integrals of ½B·H·2πr dr and of the linkage, 20000 cells per region', cells = 20000, I = p.current, m = coaxModel(p);
  let energy = 0, linkageInner = 0;
  for (let i = 0; i < cells; i++) {
    const r1 = (i + 0.5) * p.a / cells, w1 = p.a / cells, f1 = coaxField(p, r1);
    energy += 0.5 * f1.b * (f1.b / f1.mu) * TWO_PI * r1 * w1;
    linkageInner += (r1 * r1 / (p.a * p.a)) * f1.b * w1;
    // geometric cells for a ≤ r ≤ b (a wide b/a stays resolved)
    const ratio = (p.b / p.a) ** (1 / cells), lo = p.a * ratio ** i, hi = lo * ratio, r2 = (lo + hi) / 2, f2 = coaxField(p, r2);
    energy += 0.5 * f2.b * (f2.b / f2.mu) * TWO_PI * r2 * (hi - lo);
  }
  const scale = Math.abs(m.total * I * I) + 1e-300;
  const inner = coaxField(p, p.a * (1 - 1e-12)), outer = coaxField(p, p.a), hScale = Math.abs(I / (TWO_PI * p.a));
  const hAtInterface = { inside: inner.b / inner.mu, outside: outer.b / outer.mu };
  return [checkRow('W′ = ½∫B·H dA = ½L′I² (단위 길이)', method, energy, 0.5 * m.total * I * I, 'J/m', 1e-6, 1e-12 * scale),
    checkRow('내부 쇄교자속 Λ′_int = ∫(r²/a²)B dr = μ₀I/(8π)', method, linkageInner, MU0 * I / (8 * Math.PI), 'Wb/m', 1e-8, 1e-18),
    checkRow('L′_int = μ₀/(8π) = 5×10⁻⁸ H/m', 'closed form', m.internal, MU0 / (8 * Math.PI), 'H/m', 1e-12),
    checkRow('r = a에서 H 연속: H(a⁻) = H(a⁺)', 'both branches of the field, evaluated at the interface', hAtInterface.inside, hAtInterface.outside, 'A/m', 1e-9, 1e-12 * hScale),
    checkRow('r = a에서 H = I/(2πa) (B는 μ_r ≠ 1이면 불연속)', 'Ampère loop around the inner conductor', hAtInterface.outside, I / (TWO_PI * p.a), 'A/m', 1e-9, 1e-12 * hScale)];
}

const coax = defineLecture({
  id: 'induct-coax', title: '동축 케이블의 단위 길이 인덕턴스 · 6주차 §8.10', topic: TOPIC, week: WEEK, sections: ['8.10'],
  description: 'L′ = μ ln(b/a)/(2π) (외부) + μ/(8π) (내부 도체 속). 그래프에서 반지름 r을 끌어 B와 에너지 밀도를 봅니다.',
  parameters: coaxParameters, probeDefault: [0, 0, 0.02],
  view: { kind: 'profile', plane: 'xz', extent: 1, probeAxes: [0, 2], coordinate: coordinate('r', 'm', '축으로부터의 반지름') },
  validate: p => (p.b > p.a ? '' : '외부 반지름 b는 내부 반지름 a보다 커야 합니다 (모두 축 기준 반경).'),
  compute: coaxCompute,
  profile: (p, count) => {
    const rs = linspace(0, 1.5 * p.b, count);
    return [series('B', 'B_φ(r)', 'T', 'r', 'm', rs.map(r => ({ coordinate: r, value: coaxField(p, r).b }))),
      series('energy', '에너지 밀도 B²/(2μ)', 'J/m³', 'r', 'm', rs.map(r => { const f = coaxField(p, r); return { coordinate: r, value: f.b ** 2 / (2 * f.mu) }; }))];
  },
  verify: coaxVerify,
  assumptions: ['무한 동축: 내부 도체(반지름 a)에 균일 DC 전류 +I, 외부는 얇은 원통(r = b) 귀환 −I, 도체 사이 선형 매질 μ. 도체 자체는 비자성(μ₀).',
    '프리셋 a = 10 mm, b = 30 mm는 기존 동축 전류 실험과 같습니다: L′_ext = 2×10⁻⁷ ln3 = 219.7 nH/m, L′_int = 50 nH/m, 합 269.7 nH/m(앱이 계산한 값).'],
  validity: ['0 < a < b. r 좌표는 0 … 1.5b에서 그립니다.', 'I의 부호는 B의 방향만 바꾸고 L′은 같습니다.'],
  singularities: ['특이점은 없습니다. r = 0에서 B = 0입니다. r = a에서는 H = I/(2πa)가 연속(접선 성분)이고, 도체(μ₀)와 매질(μ)의 투자율이 다르면 B는 μ₀H에서 μH로 뛰어 μ_r ≠ 1이면 B는 불연속입니다.'],
  formulas: [{ label: '외부 인덕턴스', text: "L′_ext = (μ/2π) ln(b/a)", unit: 'H/m' }, { label: '내부 인덕턴스', text: "L′_int = μ₀/(8π)", unit: 'H/m' },
    { label: '에너지 확인', text: "½ L′ I² = ½ ∫ B·H dA", unit: 'J/m' }],
  references: [hayt('8.10', 'Inductance of the coaxial cable'), REF.self],
  symbolic: {
    title: '동축 케이블의 인덕턴스 — 기호 풀이',
    givens: [['a, b', '내부·외부 반지름(축 기준)', 'm', '0 < a < b'], ['μ', '사이 매질 투자율', 'H/m'], ['I', '전류', 'A']],
    laws: [['암페어 법칙', '∮H·dl = I_enc'], ['인덕턴스', 'L = Λ/I']],
    steps: [['사이 영역 a ≤ r ≤ b', 'B = μ I/(2π r)', ''], ['외부 쇄교자속', "Λ′_ext = ∫_a^b B dr = (μ I/2π) ln(b/a)", '전류 전체와 쇄교합니다.'],
      ['도체 안 r < a', 'B = μ₀ I r/(2π a²)', '반지름 r 안쪽의 전류 비율 r²/a²만 쇄교합니다.'], ['내부 쇄교자속', "Λ′_int = ∫₀^a (r²/a²) B dr = μ₀ I/(8π)", '']],
    answers: [['외부 인덕턴스', "L′_ext = (μ/2π) ln(b/a)", 'H/m'], ['내부 인덕턴스', "L′_int = μ₀/(8π)", 'H/m'], ['합계', "L′ = (μ/2π) ln(b/a) + μ₀/(8π)", 'H/m']],
    limitations: ['고주파 표피효과(내부 인덕턴스가 줄어듦)는 다루지 않습니다.'],
  },
});

// ---- 9c. Toroid -----------------------------------------------------------------------------------------------------------
const toroidParameters = [
  parameter('a', '안쪽 반지름 a', 'm', 'cm', 0.01, 0.05, 1e-3, 10),
  parameter('b', '바깥 반지름 b (b > a)', 'm', 'cm', 0.01, 0.1, 1e-3, 10),
  parameter('height', '코어 높이 c', 'm', 'cm', 0.01, 0.03, 1e-3, 10),
  parameter('turns', '감은 수 N', '1', '1', 1, 500, 1, 1e5),
  parameter('muR', '코어 비투자율 μ_r (선형)', '1', '1', 1, 1, 1, 1e5),
  parameter('current', '전류 I', 'A', 'A', 1, 1, -1000, 1000),
];

const toroidModel = p => {
  const mu = MU0 * p.muR, L = mu / TWO_PI * p.turns ** 2 * p.height * Math.log(p.b / p.a), mean = Math.PI * (p.a + p.b);
  return { mu, L, approx: mu * p.turns ** 2 * p.height * (p.b - p.a) / mean };
};
const toroidB = (p, rho, mu) => (rho >= p.a && rho <= p.b ? mu * p.turns * p.current / (TWO_PI * rho) : 0);

function toroidCompute(p, rho) {
  if (rho < 0) return excluded('unsupported', '반지름 ρ는 0 이상이어야 합니다.', 'negative-rho');
  const m = toroidModel(p), B = toroidB(p, rho, m.mu), flux = m.mu * p.turns * p.current * p.height * Math.log(p.b / p.a) / TWO_PI;
  return {
    region: rho < p.a ? 'hole' : rho <= p.b ? 'core' : 'outside', vectors: { B: [0, B, 0], H: [0, B / m.mu, 0] },
    scalars: [scalar('L', '인덕턴스 L = μN²c ln(b/a)/(2π)', m.L, 'H'), scalar('flux', '단면 자속 Φ = μNIc ln(b/a)/(2π)', flux, 'Wb'),
      scalar('linkage', '쇄교자속 Λ = NΦ', p.turns * flux, 'Wb·turn'), scalar('energy', '저장 에너지 ½LI²', 0.5 * m.L * p.current ** 2, 'J'),
      scalar('Lapprox', '평균 길이 근사 μN²S/l_평균 (비교용)', m.approx, 'H'), scalar('approxRatio', '근사/정확', m.approx / m.L, '1'),
      scalar('Bphi', '관측 위치의 B_φ = μNI/(2πρ)', B, 'T')],
    notes: ['암페어 법칙 2πρH = NI에서 B = μNI/(2πρ)가 ρ에 반비례해 변합니다(코어 안쪽이 더 강함). 코어 밖(ρ < a, ρ > b)은 B = 0.',
      '평균 반지름과 단면적 S = c(b−a)로 만든 근사 L ≈ μN²S/(π(a+b))는 b/a가 작을수록 정확한 식에 가까워집니다.'],
  };
}

function toroidVerify(p) {
  const method = 'independent ring sum of ½B·H dv over the core, 20000 geometric cells', cells = 20000, m = toroidModel(p), ratio = (p.b / p.a) ** (1 / cells);
  let energy = 0, flux = 0;
  for (let i = 0; i < cells; i++) {
    const lo = p.a * ratio ** i, hi = lo * ratio, rho = (lo + hi) / 2, B = toroidB(p, rho, m.mu);
    energy += 0.5 * B * (B / m.mu) * TWO_PI * rho * p.height * (hi - lo);
    flux += B * p.height * (hi - lo);
  }
  const scale = Math.abs(m.L * p.current ** 2) + 1e-300;
  return [checkRow('W = ½∫B·H dv = ½LI²', method, energy, 0.5 * m.L * p.current ** 2, 'J', 1e-6, 1e-12 * scale),
    checkRow('L = NΦ/I (적분한 자속)', method, p.current === 0 ? m.L : p.turns * flux / p.current, m.L, 'H', 1e-6, 1e-18)];
}

const toroid = defineLecture({
  id: 'induct-toroid', title: '직사각 단면 토로이드의 인덕턴스 · 6주차 §8.10', topic: TOPIC, week: WEEK, sections: ['8.10'],
  description: 'B = μNI/(2πρ), Φ = (μNIc/2π) ln(b/a), L = μN²c ln(b/a)/(2π). 그래프에서 ρ를 끌어 B와 에너지 밀도를 봅니다.',
  parameters: toroidParameters, probeDefault: [0, 0, 0.07],
  view: { kind: 'profile', plane: 'xz', extent: 1, probeAxes: [0, 2], coordinate: coordinate('ρ', 'm', '토로이드 축으로부터의 반지름') },
  validate: p => (p.b > p.a ? '' : '바깥 반지름 b는 안쪽 반지름 a보다 커야 합니다.'),
  compute: toroidCompute,
  profile: (p, count) => {
    const m = toroidModel(p), rs = linspace(0, 1.3 * p.b, count);
    return [series('B', 'B_φ(ρ)', 'T', 'ρ', 'm', rs.map(r => ({ coordinate: r, value: toroidB(p, r, m.mu) }))),
      series('energy', '에너지 밀도 ½B·H', 'J/m³', 'ρ', 'm', rs.map(r => ({ coordinate: r, value: toroidB(p, r, m.mu) ** 2 / (2 * m.mu) })))];
  },
  verify: toroidVerify,
  assumptions: ['직사각 단면(안쪽 a, 바깥 b, 높이 c), 촘촘히 감은 N회, 선형 균질 코어, 누설자속 없음. 프리셋은 이 앱의 예시(a = 5 cm, b = 10 cm, c = 3 cm, N = 500, 공심)입니다.'],
  validity: ['0 < a < b. B는 a ≤ ρ ≤ b에서만 0이 아닙니다.'],
  singularities: ['ρ = a, b(코어 경계)에서는 B가 불연속인 면이 아니라 코어 밖으로 0이 되는 계단이며 값은 안쪽 극한을 씁니다.'],
  formulas: [{ label: '장', text: 'B = μ N I/(2π ρ)', unit: 'T' }, { label: '자속', text: 'Φ = (μ N I c/2π) ln(b/a)', unit: 'Wb' },
    { label: '인덕턴스', text: 'L = Λ/I = μ N² c ln(b/a)/(2π)', unit: 'H' }],
  references: [hayt('8.10', 'Inductance of the toroid'), REF.self],
  symbolic: {
    title: '토로이드의 인덕턴스 — 기호 풀이',
    givens: [['a, b, c', '안쪽·바깥 반지름, 높이', 'm'], ['N', '감은 수', '1'], ['μ', '코어 투자율', 'H/m']],
    laws: [['암페어 법칙', '∮H·dl = N I'], ['인덕턴스', 'L = N Φ/I']],
    steps: [['코어 안의 장', '2π ρ H = N I → B = μ N I/(2π ρ)', ''], ['단면 자속', 'Φ = ∫_a^b B c dρ = (μ N I c/2π) ln(b/a)', ''],
      ['쇄교자속과 L', 'L = Λ/I = N Φ/I = μ N² c ln(b/a)/(2π)', '']],
    answers: [['인덕턴스', 'L = μ N² c ln(b/a)/(2π)', 'H'], ['자속', 'Φ = (μ N I c/2π) ln(b/a)', 'Wb']],
    limitations: ['누설자속과 도선의 내부 인덕턴스는 포함하지 않습니다.'],
  },
});

// ---- 9d. Mutual inductance of two coaxial solenoids -----------------------------------------------------------------------
const mutualParameters = [
  parameter('n1', '안쪽 코일의 단위 길이당 감은 수 n₁', '1/m', '1/m', 1, 2000, 1, 1e5),
  parameter('n2', '바깥 코일의 단위 길이당 감은 수 n₂', '1/m', '1/m', 1, 1000, 1, 1e5),
  parameter('r1', '안쪽 코일 반지름 r₁', 'm', 'cm', 0.01, 0.02, 1e-4, 10),
  parameter('r2', '바깥 코일 반지름 r₂ (r₂ > r₁)', 'm', 'cm', 0.01, 0.04, 1e-4, 10),
  parameter('length', '겹치는 길이 ℓ', 'm', 'cm', 0.01, 0.3, 1e-3, 100),
  parameter('muR', '매질의 비투자율 μ_r', '1', '1', 1, 1, 1, 1e4),
  parameter('current1', '안쪽 코일 전류 I₁', 'A', 'A', 1, 2, -1000, 1000),
  choiceParameter('polarity', '두 코일의 장 방향', 1, [[1, '같은 방향 (+, 보강)'], [-1, '반대 방향 (−, 상쇄)']]),
];

function mutualModel(p) {
  const mu = MU0 * p.muR, S1 = area(p.r1), S2 = area(p.r2), M = mu * p.n1 * p.n2 * S1 * p.length;
  const L1 = mu * p.n1 ** 2 * S1 * p.length, L2 = mu * p.n2 ** 2 * S2 * p.length;
  return { mu, S1, S2, M, L1, L2, k: M / Math.sqrt(L1 * L2) };
}
const mutualEnergy = (p, m, i2) => 0.5 * m.L1 * p.current1 ** 2 + p.polarity * m.M * p.current1 * i2 + 0.5 * m.L2 * i2 ** 2;

function mutualCompute(p, i2) {
  const m = mutualModel(p), s = p.polarity, energy = mutualEnergy(p, m, i2);
  return {
    region: s > 0 ? 'aiding' : 'opposing', vectors: {},
    scalars: [scalar('M', '상호 인덕턴스 M = μ n₁n₂ S₁ ℓ', m.M, 'H'), scalar('L1', '안쪽 코일 L₁ = μ n₁² S₁ ℓ', m.L1, 'H'), scalar('L2', '바깥 코일 L₂ = μ n₂² S₂ ℓ', m.L2, 'H'),
      scalar('k', '결합계수 k = M/√(L₁L₂) = √(S₁/S₂)', m.k, '1'), scalar('seriesAiding', '직렬 보강 L₁ + L₂ + 2M', m.L1 + m.L2 + 2 * m.M, 'H'),
      scalar('seriesOpposing', '직렬 상쇄 L₁ + L₂ − 2M', m.L1 + m.L2 - 2 * m.M, 'H'),
      scalar('linkage1', '코일 1의 쇄교자속 Λ₁ = L₁I₁ ± M I₂', m.L1 * p.current1 + s * m.M * i2, 'Wb·turn'),
      scalar('energy', '총 에너지 ½L₁I₁² ± M I₁I₂ + ½L₂I₂²', energy, 'J'), scalar('mutualEnergy', '상호항 ± M I₁I₂', s * m.M * p.current1 * i2, 'J'),
      scalar('current2', '관측 전류 I₂', i2, 'A')],
    notes: ['M₁₂ = M₂₁: 코일 1의 전류가 코일 2에 만드는 쇄교자속(Λ₁₂/I₁)과 그 반대가 같습니다.',
      '+ 부호: I₂가 안쪽에 만드는 장이 I₁이 만드는 장과 같은 방향일 때. 바깥 코일이 안쪽을 덮으므로 결합계수는 √(S₁/S₂) < 1입니다(가장자리 효과 무시).'],
  };
}

function mutualVerify(p) {
  const method = 'field-based energy ½∫B·H dv and independent flux linkage for both directions', m = mutualModel(p), i2 = 1.7, s = p.polarity;
  const inner = m.mu * (p.n1 * p.current1 + s * p.n2 * i2), between = m.mu * p.n2 * i2;
  const fieldEnergy = 0.5 * (inner * inner / m.mu * m.S1 + between * between / m.mu * (m.S2 - m.S1)) * p.length;
  const m12 = (p.n2 * p.length) * (m.mu * p.n1 * 1 * m.S1) / 1; // Λ₁₂/I₁ per unit I₁: outer N₂ turns see inner coil's flux
  const m21 = (p.n1 * p.length) * (m.mu * p.n2 * 1 * m.S1) / 1; // Λ₂₁/I₂: inner N₁ turns see outer coil's flux through S₁
  return [checkRow('에너지: ½∫B·H dv = ½L₁I₁² ± M I₁I₂ + ½L₂I₂²', method, fieldEnergy, mutualEnergy(p, m, i2), 'J', 1e-9, 1e-18),
    checkRow('M₁₂ = Λ₁₂/I₁ = M₂₁ = Λ₂₁/I₂', method, m12, m21, 'H', 1e-12, 1e-18), checkRow('M = μ n₁n₂ S₁ ℓ', method, m12, m.M, 'H', 1e-12, 1e-18)];
}

const mutual = defineLecture({
  id: 'induct-mutual', title: '두 동축 솔레노이드의 상호 인덕턴스 M · 6주차 §8.10', topic: TOPIC, week: WEEK, sections: ['8.9', '8.10'],
  description: 'M₁₂ ≈ μ n₁n₂ S₁ ℓ, 직렬 연결 L₁ + L₂ ± 2M, 에너지 ½L₁I₁² ± M I₁I₂ + ½L₂I₂². 그래프에서 I₂를 끌어 봅니다.',
  parameters: mutualParameters, probeDefault: [0, 0, 1],
  view: { kind: 'profile', plane: 'xz', extent: 1, probeAxes: [0, 2], coordinate: coordinate('I₂', 'A', '바깥 코일 전류') },
  validate: p => (p.r2 > p.r1 ? '' : '바깥 코일 반지름 r₂는 안쪽 r₁보다 커야 합니다.'),
  compute: mutualCompute,
  profile: (p, count) => {
    const m = mutualModel(p), currents = linspace(-5, 5, count);
    return [series('linkage1', '코일 1 쇄교자속 Λ₁(I₂)', 'Wb·turn', 'I₂', 'A', currents.map(i => ({ coordinate: i, value: m.L1 * p.current1 + p.polarity * m.M * i }))),
      series('energy', '총 에너지 W(I₂)', 'J', 'I₂', 'A', currents.map(i => ({ coordinate: i, value: mutualEnergy(p, m, i) })))];
  },
  verify: mutualVerify,
  assumptions: ['안쪽 코일(S₁, n₁)이 바깥 코일(S₂, n₂) 안에 같은 축으로 겹쳐 있고 겹치는 길이 ℓ에서만 장이 균일합니다. 가장자리 효과를 무시하고 두 코일의 길이를 ℓ로 둡니다.',
    '프리셋 n₁ = 2000/m, n₂ = 1000/m, r₁ = 2 cm, r₂ = 4 cm, ℓ = 0.3 m는 이 앱의 예시입니다.'],
  validity: ['0 < r₁ < r₂. I₁, I₂의 부호는 자유입니다(장 방향은 + / − 선택으로 고릅니다).'],
  singularities: ['특이점은 없습니다.'],
  formulas: [{ label: '상호 인덕턴스', text: 'M₁₂ = Λ₁₂/I₁ = μ n₁ n₂ S₁ ℓ = M₂₁', unit: 'H' }, { label: '직렬', text: 'L = L₁ + L₂ ± 2M', unit: 'H' },
    { label: '에너지', text: 'W = ½L₁I₁² ± M I₁I₂ + ½L₂I₂²', unit: 'J' }],
  references: [hayt('8.10', 'Mutual inductance'), REF.mutual],
  symbolic: {
    title: '두 솔레노이드의 상호 인덕턴스 — 기호 풀이',
    givens: [['n₁, n₂', '단위 길이당 감은 수', '1/m'], ['S₁, S₂', '코일 단면적(S₁ < S₂)', 'm²'], ['ℓ', '겹치는 길이', 'm']],
    laws: [['상호 인덕턴스', 'M₁₂ = Λ₁₂/I₁ = N₂ Φ₁₂/I₁'], ['에너지', 'W = ½L₁I₁² ± M I₁I₂ + ½L₂I₂²']],
    steps: [['코일 1의 장', 'B ≈ μ n₁ I₁ (안쪽)', ''], ['코일 2와의 쇄교', 'Λ₁₂ = (n₂ ℓ)(B S₁) = μ n₁ n₂ S₁ ℓ I₁', 'B는 안쪽에만 있어 단면적은 S₁.'],
      ['M', 'M₁₂ = μ n₁ n₂ S₁ ℓ = M₂₁', '반대 방향 계산도 같습니다.'], ['직렬', 'L = L₁ + L₂ ± 2M', '같은 방향 감김이면 +.']],
    answers: [['상호 인덕턴스', 'M = μ n₁ n₂ S₁ ℓ', 'H'], ['직렬 인덕턴스', 'L = L₁ + L₂ ± 2M', 'H'], ['결합계수', 'k = M/√(L₁ L₂) = √(S₁/S₂)', '1']],
    limitations: ['가장자리 효과와 누설을 무시한 이상 결합입니다.'],
  },
});

export const EXPERIMENTS = [solenoid, coax, toroid, mutual];
