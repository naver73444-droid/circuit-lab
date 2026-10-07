// Hayt Ch.8 §8.3 lecture experiment: the force between two differential current elements (Example 8.2). Pure: no DOM.
// d(dF₂) = I₂dL₂ × dB₂₁ with dB₂₁ = μ₀ I₁dL₁ × a_R12/(4πR₁₂²): the force on element 2 caused by element 1, and the same with the roles swapped.
// For element pairs the two forces are NOT equal and opposite (Newton's third law holds only for closed circuits).
// Sweep coordinate (point[2]): the factor s that scales the vector R₁₂ (the distance between the elements; the directions stay).
import {
  FOUR_PI, MU0, REF, checkRow, coordinate, defineLecture, excluded, hayt, linspace, parameter, scalar, series,
} from './em-course-lecture.js';
import { plainText } from './em-format.js';

const TOPIC = 'forces';
const WEEK = 6;

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const scaleVec = (a, k) => a.map(x => x * k);
const sub = (a, b) => a.map((x, i) => x - b[i]);
const add = (a, b) => a.map((x, i) => x + b[i]);
const norm = a => Math.hypot(a[0], a[1], a[2]);

const parameters = [
  parameter('Rx', 'R₁₂ = P₂ − P₁ 의 x 성분', 'm', 'm', 1, -4, -1e3, 1e3),
  parameter('Ry', 'R₁₂ = P₂ − P₁ 의 y 성분', 'm', 'm', 1, 6, -1e3, 1e3),
  parameter('Rz', 'R₁₂ = P₂ − P₁ 의 z 성분', 'm', 'm', 1, 4, -1e3, 1e3),
  parameter('m1x', '요소 1: I₁dL₁ 의 x 성분', 'A·m', 'A·m', 1, 0, -10, 10),
  parameter('m1y', '요소 1: I₁dL₁ 의 y 성분', 'A·m', 'A·m', 1, -3, -10, 10),
  parameter('m1z', '요소 1: I₁dL₁ 의 z 성분', 'A·m', 'A·m', 1, 0, -10, 10),
  parameter('m2x', '요소 2: I₂dL₂ 의 x 성분', 'A·m', 'A·m', 1, 0, -10, 10),
  parameter('m2y', '요소 2: I₂dL₂ 의 y 성분', 'A·m', 'A·m', 1, 0, -10, 10),
  parameter('m2z', '요소 2: I₂dL₂ 의 z 성분', 'A·m', 'A·m', 1, -4, -10, 10),
];

const inputs = (p, s = 1) => ({ R: scaleVec([p.Rx, p.Ry, p.Rz], s), m1: [p.m1x, p.m1y, p.m1z], m2: [p.m2x, p.m2y, p.m2z] });

/**
 * Both forces from the Biot–Savart form with the unit vector a_R12: dB = μ₀ (I dL × a_R)/(4πR²), then d(dF) = I dL × dB.
 * Element 2 sits at R₁₂ from element 1, so element 1 sits at −R₁₂ from element 2.
 */
export function elementForces({ R, m1, m2 }) {
  const r = norm(R), aR = scaleVec(R, 1 / r), k = MU0 / (FOUR_PI * r * r);
  const dB21 = scaleVec(cross(m1, aR), k), dB12 = scaleVec(cross(m2, scaleVec(aR, -1)), k);
  const dF2 = cross(m2, dB21), dF1 = cross(m1, dB12);
  return { r, aR, dB21, dB12, dF1, dF2, net: add(dF1, dF2) };
}

const vecText = v => '(' + v.map(x => plainText(x * 1e9, 4)).join(', ') + ') nN';

function compute(p, s) {
  const given = inputs(p);
  if (norm(given.R) === 0) return excluded('singular', '두 요소가 같은 점에 있으면(R₁₂ = 0) 힘이 정해지지 않습니다.', 'zero-distance');
  if (!(s > 0)) return excluded('singular', '거리 배율 s는 0보다 커야 합니다.', 'zero-distance');
  const f = elementForces(given), probe = elementForces(inputs(p, s)), netMag = norm(f.net);
  const notes = ['작용·반작용(뉴턴 제3법칙) 불성립: 요소 1이 요소 2에 주는 힘 d(dF₂)와 요소 2가 요소 1에 주는 힘 d(dF₁)는 크기도 방향도 서로 반대가 아닙니다. 점전하 사이의 쿨롱 힘이 F₁ + F₂ = 0인 것과 다릅니다.',
    `d(dF₂) = ${vecText(f.dF2)}, d(dF₁) = ${vecText(f.dF1)}, 합 = ${vecText(f.net)}. 합의 크기가 0이 아니면 요소 쌍만으로는 3법칙이 깨진 것입니다.`,
    '닫힌 회로 전체(두 루프)에서는 ∮∮ 로 합하면 상쇄되어 F₁ + F₂ = 0이 되고, 3법칙은 닫힌 루프 사이에서만 회복됩니다. 전류 요소 하나는 닫힌 회로가 아니므로 실제로는 단독으로 존재할 수 없습니다.',
    '힘은 두 요소 중 상대 요소의 방향에 따라 달라집니다: 한 요소가 R₁₂와 나란하면(sin 0) 그 요소가 만드는 B는 0이라 상대 요소는 힘을 받지 않습니다.'];
  if (netMag <= 1e-9 * Math.max(norm(f.dF1), norm(f.dF2))) notes.push('이 배치에서는 합이 0입니다 (두 요소가 서로 나란하거나 R₁₂가 I₁dL₁ × I₂dL₂ 방향인 경우: 합 = μ₀ R × (I₁dL₁ × I₂dL₂)/(4πR³)).');
  return {
    region: netMag > 1e-9 * Math.max(norm(f.dF1), norm(f.dF2)) ? 'non-reciprocal' : 'reciprocal', vectors: {},
    scalars: [scalar('F2mag', '요소 2가 받는 힘의 크기 |d(dF₂)|', norm(f.dF2), 'N'), scalar('F1mag', '요소 1이 받는 힘의 크기 |d(dF₁)|', norm(f.dF1), 'N'),
      scalar('netMag', '두 힘의 합의 크기 |d(dF₁) + d(dF₂)| (뉴턴 3법칙이면 0)', netMag, 'N'),
      scalar('F2x', 'd(dF₂)의 x 성분', f.dF2[0], 'N'), scalar('F2y', 'd(dF₂)의 y 성분', f.dF2[1], 'N'), scalar('F2z', 'd(dF₂)의 z 성분', f.dF2[2], 'N'),
      scalar('F1x', 'd(dF₁)의 x 성분', f.dF1[0], 'N'), scalar('F1y', 'd(dF₁)의 y 성분', f.dF1[1], 'N'), scalar('F1z', 'd(dF₁)의 z 성분', f.dF1[2], 'N'),
      scalar('netX', '합의 x 성분', f.net[0], 'N'), scalar('netY', '합의 y 성분', f.net[1], 'N'), scalar('netZ', '합의 z 성분', f.net[2], 'N'),
      scalar('distance', '두 요소 사이 거리 R₁₂', f.r, 'm'), scalar('B21', '요소 1이 요소 2 자리에 만드는 dB의 크기', norm(f.dB21), 'T'),
      scalar('B12', '요소 2가 요소 1 자리에 만드는 dB의 크기', norm(f.dB12), 'T'),
      scalar('probeScale', '그래프 관측 거리 배율 s (R = s R₁₂)', s, '1'), scalar('probeF2', '그 s에서 |d(dF₂)|', norm(probe.dF2), 'N'), scalar('probeF1', '그 s에서 |d(dF₁)|', norm(probe.dF1), 'N'),
      scalar('probeNet', '그 s에서 합의 크기', norm(probe.net), 'N')],
    notes,
  };
}

function verify(p) {
  const method = 'independent vector identity (a × (b × c) = b(a·c) − c(a·b)) with the unnormalised R₁₂', given = inputs(p), f = elementForces(given);
  const { R, m1, m2 } = given, r = f.r, k = MU0 / (FOUR_PI * r ** 3), scale = k * norm(m1) * norm(m2) * r + 1e-300; // the size every term is built from (also meaningful when both forces vanish)
  // d(dF₂) = k m₂ × (m₁ × R) = k [m₁(m₂·R) − R(m₁·m₂)];  d(dF₁) = k m₁ × (m₂ × R₂₁), R₂₁ = −R: = k [m₂(m₁·R₂₁) − R₂₁(m₁·m₂)]
  const closed2 = scaleVec(sub(scaleVec(m1, dot(m2, R)), scaleVec(R, dot(m1, m2))), k);
  const R21 = scaleVec(R, -1), closed1 = scaleVec(sub(scaleVec(m2, dot(m1, R21)), scaleVec(R21, dot(m1, m2))), k);
  // the sum of the two forces is k R × (m₁ × m₂): zero for parallel elements (m₁ ∥ m₂) or when R lies along m₁ × m₂
  const closedNet = scaleVec(cross(R, cross(m1, m2)), k);
  const twice = elementForces({ R: scaleVec(R, 2), m1, m2 });
  return [checkRow('d(dF₂) = μ₀[m₁(m₂·R) − R(m₁·m₂)]/(4πR³) (BAC−CAB), 벡터 차이의 크기', method, norm(sub(f.dF2, closed2)), 0, 'N', 0, 1e-12 * scale),
    checkRow('d(dF₁) = μ₀[m₂(m₁·R₂₁) − R₂₁(m₁·m₂)]/(4πR³), 벡터 차이의 크기', method, norm(sub(f.dF1, closed1)), 0, 'N', 0, 1e-12 * scale),
    checkRow('두 힘의 합 = μ₀ R × (m₁ × m₂)/(4πR³), 벡터 차이의 크기', method, norm(sub(f.net, closedNet)), 0, 'N', 0, 1e-12 * scale),
    checkRow('거리를 2배로 하면 힘의 크기가 1/4 (R⁻²)', 'doubling R in the full Biot–Savart evaluation', norm(twice.dF2), norm(f.dF2) / 4, 'N', 1e-9, 1e-12 * scale)];
}

// The worked example with the same functions (the textbook's Example 8.2 inputs; the lecture note has the result only).
const example = elementForces(inputs(Object.fromEntries(parameters.map(item => [item.key, item.initial]))));

const forceElements = defineLecture({
  id: 'force-elements', title: '두 미분 전류 요소 사이의 힘 (작용·반작용 불성립)', topic: TOPIC, week: WEEK, sections: ['8.3'],
  description: '요소 I₁dL₁이 만드는 dB₂₁ 속의 요소 I₂dL₂의 힘 d(dF₂)와 그 반대(d(dF₁)). 두 힘은 크기·방향 모두 서로 반대가 아닙니다. 그래프에서 거리 배율을 끕니다. 닫힌 루프의 힘은 평면 ▸ 자기에서 확인.',
  answers: ['F2mag', 'F1mag', 'netMag'], coordinateScalars: ['probeScale'],
  parameters, probeDefault: [0, 0, 1],
  view: { kind: 'profile', plane: 'xz', extent: 1, probeAxes: [0, 2], coordinate: coordinate('s', '1', '거리 배율 s (R = s·R₁₂)') },
  validate: (p, s) => (norm([p.Rx, p.Ry, p.Rz]) === 0 ? '두 요소가 같은 점에 있습니다(R₁₂ = 0).' : !(s > 0) ? '거리 배율 s는 0보다 커야 합니다.' : ''),
  compute,
  profile: (p, count) => {
    const scales = linspace(0.25, 4, count), at = s => elementForces(inputs(p, s));
    return [series('F2', '|d(dF₂)| 요소 2가 받는 힘', 'N', 's', '1', scales.map(s => ({ coordinate: s, value: norm(at(s).dF2) }))),
      series('F1', '|d(dF₁)| 요소 1이 받는 힘', 'N', 's', '1', scales.map(s => ({ coordinate: s, value: norm(at(s).dF1) }))),
      series('net', '|d(dF₁) + d(dF₂)| 합 (3법칙이면 0)', 'N', 's', '1', scales.map(s => ({ coordinate: s, value: norm(at(s).net) })))];
  },
  verify,
  assumptions: ['진공의 두 미분 전류 요소(점 전류 요소)입니다. 입력은 요소 사이의 벡터 R₁₂ = P₂ − P₁ 과 두 I dL 벡터(전류 × 길이 벡터)이며 절대 위치는 힘에 영향이 없습니다.',
    `기본값은 교재 Example 8.2 배치입니다: I₁dL₁ = −3 a_y A·m 가 P₁(5, 2, 1), I₂dL₂ = −4 a_z A·m 가 P₂(1, 8, 5) → R₁₂ = P₂ − P₁ = (−4, 6, 4) m. 강의 정리본에는 결과(8.56 a_y, −12.84 a_z nN)만 있고 입력은 교재 배치입니다.`,
    `[앱이 계산한 값] d(dF₂) = ${vecText(example.dF2)}, d(dF₁) = ${vecText(example.dF1)}. 정리본의 "8.56 a_y nN, −12.84 a_z nN"과 같습니다 (I dL을 A·m로 읽은 값; 두 요소의 부호가 곱해져 결과는 부호와 무관).`,
    'μ₀ = 4π×10⁻⁷에서 CODATA 2022 값을 씁니다. 전류 요소 하나는 닫힌 회로가 아니라 물리적으로 홀로 존재하지 않는 계산 도구입니다.'],
  validity: ['R₁₂ ≠ 0, |성분| ≤ 1000 m, |I dL 성분| ≤ 10 A·m. 거리 배율 s > 0 (R = s R₁₂ 로 거리만 바꾸고 방향은 유지).'],
  singularities: ['R₁₂ = 0이면 힘이 발산하므로 singular로 표시하고 값을 만들지 않습니다. 한 요소가 R₁₂와 나란하면 그 요소의 dB가 0이라 상대 요소의 힘은 0입니다.'],
  formulas: [{ label: '요소가 만드는 dB', text: 'dB₂₁ = μ₀ I₁dL₁ × a_R12/(4π R₁₂²)', unit: 'T' },
    { label: '요소가 받는 힘', text: 'd(dF₂) = I₂dL₂ × dB₂₁ = μ₀ I₂dL₂ × (I₁dL₁ × a_R12)/(4π R₁₂²)', unit: 'N' },
    { label: '반대 방향', text: 'd(dF₁) = I₁dL₁ × dB₁₂, dB₁₂ = μ₀ I₂dL₂ × a_R21/(4π R₁₂²), a_R21 = −a_R12', unit: 'N' },
    { label: '합', text: 'd(dF₁) + d(dF₂) = μ₀ R × (I₁dL₁ × I₂dL₂)/(4π R³) ≠ 0', unit: 'N' }],
  references: [hayt('8.3', 'Force between differential current elements'), REF.conductor],
  symbolic: {
    title: '두 전류 요소 사이의 힘 — Biot–Savart와 BAC−CAB',
    givens: [['I₁dL₁, I₂dL₂', '두 요소의 전류×길이 벡터', 'A·m'], ['R₁₂', '요소 1에서 요소 2로 가는 벡터', 'm']],
    laws: [['Biot–Savart', 'dB = μ₀ I dL × a_R/(4πR²)'], ['전류 요소가 받는 힘', 'dF = I dL × B']],
    steps: [['요소 1이 요소 2 자리에 만드는 장', 'dB₂₁ = μ₀ I₁dL₁ × a_R12/(4πR₁₂²)', 'a_R12 = R₁₂/|R₁₂|.'],
      ['요소 2가 받는 힘', 'd(dF₂) = I₂dL₂ × dB₂₁ = μ₀ I₂dL₂ × (I₁dL₁ × a_R12)/(4πR₁₂²)', `프리셋: d(dF₂) = ${vecText(example.dF2)}.`],
      ['반대 방향', 'd(dF₁) = μ₀ I₁dL₁ × (I₂dL₂ × a_R21)/(4πR₁₂²), a_R21 = −a_R12', `프리셋: d(dF₁) = ${vecText(example.dF1)}.`],
      ['BAC−CAB로 합', 'd(dF₁) + d(dF₂) = μ₀ R × (I₁dL₁ × I₂dL₂)/(4πR³)', '요소 쌍의 합은 일반적으로 0이 아닙니다.'],
      ['닫힌 회로', '∮∮ [d(dF₁) + d(dF₂)] = 0', '두 닫힌 루프로 합하면 상쇄되어 3법칙이 회복됩니다.']],
    answers: [['요소 2의 힘', 'd(dF₂) = μ₀ I₂dL₂ × (I₁dL₁ × a_R12)/(4πR₁₂²)', 'N'], ['요소 1의 힘', 'd(dF₁) = μ₀ I₁dL₁ × (I₂dL₂ × a_R21)/(4πR₁₂²)', 'N'], ['합', 'd(dF₁) + d(dF₂) = μ₀ R × (I₁dL₁ × I₂dL₂)/(4πR³)', 'N']],
    limitations: ['두 점 요소만 다룹니다. 닫힌 루프의 총합(∮∮)은 이 실험이 아니라 평면 ▸ 자기에서 봅니다.'],
  },
});

export const EXPERIMENTS = [forceElements];
