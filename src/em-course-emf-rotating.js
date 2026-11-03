// Hayt Ch.9 §9.1 lecture experiment: a rectangular loop turning in a time-varying B (lecture note ex2, p09–p11). Pure: no DOM.
//
// B = B₀ sinωt a_y and the loop turns about the x axis at the same ω, so both causes act at once: the transformer emf (B changes
// at a fixed attitude) and the motional emf (two sides cut B). Their sum is −dΦ/dt of the moving surface.
import { TWO_PI, angleCoordinate, checkRow, defineLecture, linspace, parameter, scalar, series } from './em-course-lecture.js';
import { plainText, siText } from './em-format.js';

const HAYT_URL = 'https://openlibrary.org/isbn/9780073380667';
const OPENSTAX = 'https://openstax.org/books/university-physics-volume-2/pages/';
const DEG = Math.PI / 180;

const parameters = [
  parameter('B0', '자속밀도 진폭 B₀ (B = B₀ sinωt a_y)', 'T', 'T', 1, 0.5, -2, 2),
  parameter('h', '축방향 변의 길이 h', 'm', 'cm', 0.01, 0.2, 0.02, 0.5),
  parameter('d', '회전축에 수직인 변의 길이 d', 'm', 'cm', 0.01, 0.1, 0.01, 0.3),
  parameter('omega', '각주파수 ω (B와 회전이 같음)', 'rad/s', 'rad/s', 1, 100, 1, 1000),
  parameter('alpha0', 't = 0에서 법선 n과 a_y의 각 α₀', 'rad', '°', DEG, 0, -Math.PI, Math.PI),
];

/** Closed form at phase θ = ωt [rad]; p is the SI parameter object. The total is the sum of the two terms. */
function rotatingState(p, theta) {
  const area = p.h * p.d, alpha = p.alpha0 + theta, K = p.omega * p.B0 * area;
  const transformerEmf = -K * Math.cos(theta) * Math.cos(alpha);
  const motionalEmf = K * Math.sin(theta) * Math.sin(alpha);
  return {
    area, alpha, time: theta / p.omega, B: p.B0 * Math.sin(theta), flux: p.B0 * area * Math.sin(theta) * Math.cos(alpha),
    transformerEmf, motionalEmf, emf: transformerEmf + motionalEmf, phase: theta, K,
  };
}

// |value| ≤ 1e−12·K is floating-point residue of a zero (θ = 45° with α₀ = 0): the text then reads 0 and "방향 없음".
const isZero = (value, K) => Math.abs(value) <= 1e-12 * Math.abs(K);
const shown = (value, K) => (isZero(value, K) ? '0 V' : siText(value, 'V'));
const sense = (value, K) => (isZero(value, K) ? '방향 없음' : value > 0 ? '+ : 양의 순환(b→a) 방향' : '− : 양의 순환과 반대(a→b) 방향');
const deg = angle => `${plainText(angle / DEG, 4)}°`;

function compute(p, theta) {
  const s = rotatingState(p, theta), K = s.K, n = plainText;
  const head = `${n(p.omega)}×${n(p.B0)}×${n(s.area)}`;
  const notes = [
    '축·법선·적분 방향: 회전축은 x축, 법선 n = cosα a_y − sinα a_z, 루프 면의 다른 축 w = −sinα a_y − cosα a_z (a_x × w = n). 양의 순환은 n에 대한 오른손 방향이며 도체를 따라 b→a로 적분합니다. 이 n과 맞는 각속도는 Ω = −ω a_x입니다.',
    `대입: S = h d = ${n(p.h)}×${n(p.d)} = ${n(s.area)} m², K = ωB₀S = ${head} = ${siText(K, 'V')}, θ = ωt = ${deg(theta)}, α = α₀ + θ = ${deg(s.alpha)}, t = θ/ω = ${siText(s.time, 's')}`,
    `대입: Φ = B₀ S sinθ cosα = ${n(p.B0)}×${n(s.area)}×sin${deg(theta)}×cos${deg(s.alpha)} = ${siText(s.flux, 'Wb')}`,
    `대입: ℰ_T = −ωB₀S cosθ cosα = −${head}×cos${deg(theta)}×cos${deg(s.alpha)} = ${shown(s.transformerEmf, K)}`,
    `대입: ℰ_M = +ωB₀S sinθ sinα = ${head}×sin${deg(theta)}×sin${deg(s.alpha)} = ${shown(s.motionalEmf, K)}`,
    `대입: ℰ_ab = ℰ_T + ℰ_M = ${shown(s.transformerEmf, K)} + ${shown(s.motionalEmf, K)} = ${shown(s.emf, K)} (= −K cos(2θ + α₀))`,
    `부호: ℰ_T ${sense(s.transformerEmf, K)} · ℰ_M ${sense(s.motionalEmf, K)} · 합계 ℰ_ab ${sense(s.emf, K)}`,
    '변압기 항은 자세를 고정하고 ∂B/∂t만 씁니다. 운동 항은 x축에 평행한 두 변(각 ℰ_M/2)만 기여하고, 축에 수직인 두 변은 u×B가 변과 수직이라 0입니다. 합계만 움직이는 면 전체의 −dΦ/dt와 같습니다.',
    '세 그래프의 세로축은 패널마다 따로 맞춘 눈금입니다. 곡선 높이만으로 항의 크기를 비교하지 말고 세로축 눈금을 함께 보세요.',
    '단자 a·b를 바꾸면 부호가 반대입니다. 부하·전압계 리드 경로를 정하지 않았으므로 전류·발열·임의 단자 전압은 계산하지 않습니다.',
  ];
  return {
    region: 'rotating-loop', vectors: {},
    scalars: [
      scalar('emf', '합계 기전력 ℰ_ab = ℰ_T + ℰ_M', s.emf, 'V', Math.abs(K)),
      scalar('transformerEmf', '변압기 기전력 ℰ_T = −ωB₀S cosθ cosα', s.transformerEmf, 'V', Math.abs(K)),
      scalar('motionalEmf', '운동 기전력 ℰ_M = ωB₀S sinθ sinα', s.motionalEmf, 'V', Math.abs(K)),
      scalar('flux', '쇄교 자속 Φ = B₀S sinθ cosα', s.flux, 'Wb', Math.abs(p.B0 * s.area)),
      scalar('B', '그 순간의 B_y = B₀ sinθ', s.B, 'T', Math.abs(p.B0)),
      scalar('area', '루프 면적 S = hd', s.area, 'm²'),
      scalar('alpha', '법선 각 α = α₀ + ωt', s.alpha, 'rad'),
      scalar('time', '시간 t = θ/ω', s.time, 's'),
      scalar('amplitude', '진폭 K = ωB₀S', K, 'V'),
      scalar('phase', '위상 θ = ωt', theta, 'rad'),
    ],
    notes,
  };
}

// ---- independent checks (vector geometry, not the scalar closed form) ---------------------------------------------------
const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
const frame = alpha => ({ n: [0, Math.cos(alpha), -Math.sin(alpha)], w: [0, -Math.sin(alpha), -Math.cos(alpha)] });
const fieldAt = (p, theta) => [0, p.B0 * Math.sin(theta), 0];

/** ∫S F·n dS over the h×d rectangle (x ∈ ±h/2 along a_x, q ∈ ±d/2 along w) with 16×8 = 128 equal cells. */
function surfaceSum(p, alpha, fieldOf) {
  const { n } = frame(alpha), nx = 16, nq = 8, dS = (p.h / nx) * (p.d / nq);
  let sum = 0;
  for (let i = 0; i < nx; i++) for (let j = 0; j < nq; j++) sum += dot(fieldOf(), n) * dS;
  return sum;
}

/** ∮(u×B)·dl around the four sides (32 segments each), counter-clockwise about n: +x at q = −d/2, +w at x = +h/2, … */
function motionalSides(p, theta) {
  const { w } = frame(p.alpha0 + theta), Omega = [-p.omega, 0, 0], B = fieldAt(p, theta), segments = 32;
  const point = (x, q) => [x, q * w[1], q * w[2]];
  const side = (start, end) => {
    let sum = 0;
    for (let k = 0; k < segments; k++) {
      const t = (k + 0.5) / segments, x = start[0] + (end[0] - start[0]) * t, q = start[1] + (end[1] - start[1]) * t;
      const r = point(x, q), dl = point((end[0] - start[0]) / segments, (end[1] - start[1]) / segments);
      sum += dot(cross(cross(Omega, r), B), dl);
    }
    return sum;
  };
  const hx = p.h / 2, hq = p.d / 2;
  return [side([-hx, -hq], [hx, -hq]), side([hx, -hq], [hx, hq]), side([hx, hq], [-hx, hq]), side([-hx, hq], [-hx, -hq])];
}

function verify(p) {
  const theta = Math.PI / 6, s = rotatingState(p, theta), K = Math.abs(s.K);
  const transformer = -surfaceSum(p, s.alpha, () => [0, p.B0 * p.omega * Math.cos(theta), 0]);
  const sides = motionalSides(p, theta), motional = sides.reduce((a, b) => a + b, 0);
  const flux = th => surfaceSum(p, p.alpha0 + th, () => fieldAt(p, th)), delta = 1e-3;
  const dPhi = (flux(theta - 2 * delta) - 8 * flux(theta - delta) + 8 * flux(theta + delta) - flux(theta + 2 * delta)) / (12 * delta);
  return [
    checkRow('θ = 30°: 128셀 면적분 −∫(∂B/∂t)·n dS = ℰ_T', 'midpoint surface sum of −∂B/∂t·n over the fixed-attitude rectangle', transformer, s.transformerEmf, 'V', 1e-10, 1e-12),
    checkRow('θ = 30°: 네 변 32구간 ∮(u×B)·dl = ℰ_M', 'vector cross/dot products with u = Ω×r, Ω = −ω a_x, along all four sides', motional, s.motionalEmf, 'V', 1e-10, 1e-12),
    checkRow('θ = 30°: 5점 차분 −ω dΦ/dθ = ℰ_T + ℰ_M', 'five-point difference of the re-integrated flux, δ = 1e−3 rad', -p.omega * dPhi, s.emf, 'V', 2e-6, 1e-12 + 2e-8 * K),
  ];
}

const presetTheta = Math.PI / 6;

export const EXPERIMENTS = [defineLecture({
  id: 'emf-rotating-loop', title: '회전 루프: 두 기전력', topic: 'induction', week: 7, sections: ['9.1'],
  description: '앱 검산 예시(근거: 강의 필기 ex2 · p09–p11, Cheng 교재 예제): B = B₀ sinωt a_y 속에서 같은 ω로 x축 둘레를 도는 직사각 루프. '
    + 'h = 20 cm, d = 10 cm, B₀ = 0.5 T, ω = 100 rad/s, θ = 30°에서 변압기 −0.75 V + 운동 +0.25 V = −0.5 V. 그래프를 끌어 ωt를 바꿉니다.',
  answers: ['emf', 'transformerEmf', 'motionalEmf'], coordinateScalars: ['phase'],
  parameters, probeDefault: [0, 0, presetTheta],
  view: { kind: 'profile', plane: 'xz', extent: 1, probeAxes: [0, 2], coordinate: angleCoordinate('ωt', '자계·회전 위상') },
  validate: (p, theta) => (theta === undefined || (theta >= 0 && theta <= TWO_PI) ? '' : 'ωt는 0 … 360° 범위에서만 봅니다. 자동 보정하지 않습니다.'),
  compute,
  profile: (p, count) => {
    const states = linspace(0, TWO_PI, count).map(theta => rotatingState(p, theta));
    const line = (key, label) => series(key, label, 'V', 'ωt', 'rad', states.map(s => ({ coordinate: s.phase, value: s[key] })));
    return [line('transformerEmf', '변압기 ℰ_T'), line('motionalEmf', '운동 ℰ_M'), line('emf', '합계 ℰ_ab')];
  },
  verify,
  assumptions: [
    '균일한 B = B₀ sinωt a_y. 루프는 x축 둘레를 B와 같은 ω로 회전하며 α = α₀ + ωt는 법선 n과 a_y 사이 각입니다.',
    '루프 자신의 전류가 만드는 자기장(자체 유도)과 부하는 무시합니다. 슬립링 단자 a·b 사이의 순환 기전력만 봅니다.',
    '부호 기준: n = cosα a_y − sinα a_z, 양의 순환은 n의 오른손 방향(도체를 따라 b→a), Ω = −ω a_x. a/b를 바꾸면 부호가 바뀝니다.',
    '기본값은 강의 식을 검산하기 위한 앱 예시 수치이며 강의에 주어진 수치가 아닙니다.',
  ],
  validity: ['ωt는 0 … 360°(한 주기), ω > 0. B₀는 음수도 됩니다(모든 항 부호 반전).', '일반형은 ∮C(E + u×B)·dl = −dΦ/dt이며, 실험실계 E만의 ∮E·dl에 운동 항을 넣지 않습니다.'],
  singularities: ['유효 범위 안에 특이점은 없습니다. B₀ = 0이면 모든 위상에서 기전력 0입니다.'],
  formulas: [
    { label: '쇄교 자속', text: 'Φ = B₀ S sinθ cosα, S = hd, θ = ωt, α = α₀ + θ', unit: 'Wb' },
    { label: '변압기 기전력', text: 'ℰ_T = −∫S (∂B/∂t)·ds = −ωB₀S cosθ cosα', unit: 'V' },
    { label: '운동 기전력', text: 'ℰ_M = ∮C (u×B)·dl = +ωB₀S sinθ sinα', unit: 'V' },
    { label: '합계', text: 'ℰ_ab = ℰ_T + ℰ_M = −dΦ/dt = −ωB₀S cos(2θ + α₀)', unit: 'V' },
  ],
  references: [
    { title: 'Hayt & Buck, Engineering Electromagnetics 8판 — Ch.9 §9.1 Faraday\'s law', url: HAYT_URL },
    { title: 'OpenStax University Physics 2 §13.6 — Electric generators and back emf', url: OPENSTAX + '13-6-electric-generators-and-back-emf' },
  ],
  symbolic: {
    title: '회전 루프의 변압기·운동 기전력 — 기호 풀이',
    givens: [['B = B₀ sinωt a_y', '시변 균일 자속밀도', 'T'], ['h, d', '루프 변의 길이 (S = hd)', 'm'], ['ω', 'B와 회전의 공통 각주파수', 'rad/s'],
      ['α₀', 't = 0에서 법선과 a_y의 각', 'rad']],
    laws: [['일반형 패러데이 법칙', '∮C (E + u×B)·dl = −dΦ/dt'], ['기전력 분해', 'V_emf = −∫S (∂B/∂t)·ds + ∮C (u×B)·dl']],
    steps: [
      ['법선과 자속', 'n = cosα a_y − sinα a_z, Φ = B·n S = B₀ S sinωt cosα', 'α = α₀ + ωt. 양의 순환은 n의 오른손 방향(b→a)입니다.'],
      ['자세를 고정한 변압기 항', 'ℰ_T = −(∂B/∂t)·n S = −ωB₀S cosωt cosα', '편미분이므로 α는 상수로 둡니다.'],
      ['축방향 두 변의 u×B', 'u = Ω×r (Ω = −ω a_x), (u×B)·dl 합 = ωB₀S sinωt sinα', '두 변이 각각 절반씩 기여하고 축에 수직인 변은 0입니다.'],
      ['합계와 전체 미분', 'ℰ_T + ℰ_M = −ωB₀S cos(2ωt + α₀) = −dΦ/dt', '움직이는 면의 전체 미분이 두 항의 합과 같습니다.'],
      ['α₀ = 0의 배각', 'ℰ_T = −ωB₀S cos²ωt, ℰ_M = ωB₀S sin²ωt, 합 = −ωB₀S cos2ωt', 'cos² − sin² = cos2ωt.'],
    ],
    answers: [['합계 기전력', 'ℰ_ab = −ωB₀S cos(2ωt + α₀)', 'V', '+이면 양의 순환(b→a)'], ['변압기 기전력', 'ℰ_T = −ωB₀S cosωt cos(α₀ + ωt)', 'V'],
      ['운동 기전력', 'ℰ_M = ωB₀S sinωt sin(α₀ + ωt)', 'V']],
    limitations: ['B의 변화와 회전이 같은 ω인 한 경우만 다룹니다. 단독 변압기·단독 직선 운동은 faraday-loop·motional-rod 실험에서 봅니다.'],
  },
})];
