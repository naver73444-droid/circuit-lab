// Hayt Ch.8 §8.8 lecture experiment: the parallel magnetic circuit (three-legged core). Pure: no DOM.
// The coil (N·I) sits on the centre leg; the two outer legs return the flux in parallel, each with its own air gap. Linear core (constant μ_r).
// The magnetic circuit is solved like the electric one: reluctance R = ℓ/(μS) in series/parallel, mmf NI as the source, flux Φ as the current.
import {
  MU0, REF, checkRow, coordinate, defineLecture, excluded, hayt, linspace, parameter, scalar, series, skippedRow,
} from './em-course-lecture.js';
import { plainText } from './em-format.js';

const TOPIC = 'magnetic-circuit';
const WEEK = 6;

const parameters = [
  parameter('turns', '중앙 다리 코일의 감은 수 N', '1', '1', 1, 500, 1, 1e5),
  parameter('current', '전류 I', 'A', 'A', 1, 0.2, 0, 100),
  parameter('muR', '코어의 비투자율 μ_r (선형 근사)', '1', '1', 1, 2000, 1, 1e6),
  parameter('areaC', '중앙 다리 단면적 S_c', 'm²', 'cm²', 1e-4, 6e-4, 1e-6, 1),
  parameter('lengthC', '중앙 다리 길이 ℓ_c', 'm', 'cm', 0.01, 0.1, 1e-3, 10),
  parameter('areaL', '왼쪽 다리 단면적 S_L', 'm²', 'cm²', 1e-4, 3e-4, 1e-6, 1),
  parameter('lengthL', '왼쪽 다리 길이 ℓ_L (공극 제외)', 'm', 'cm', 0.01, 0.3, 1e-3, 10),
  parameter('gapL', '왼쪽 공극 g₁', 'm', 'mm', 1e-3, 1e-3, 0, 0.05),
  parameter('areaR', '오른쪽 다리 단면적 S_R', 'm²', 'cm²', 1e-4, 3e-4, 1e-6, 1),
  parameter('lengthR', '오른쪽 다리 길이 ℓ_R (공극 제외)', 'm', 'cm', 0.01, 0.3, 1e-3, 10),
  parameter('gapR', '오른쪽 공극 g₂', 'm', 'mm', 1e-3, 1e-3, 0, 0.05),
];
const defaults = Object.fromEntries(parameters.map(item => [item.key, item.initial]));

const reluctance = (length, area, permeability) => length / (permeability * area);

/**
 * Closed-form solution of the three legs (no input validation: callers check the ranges; gapR may be Infinity = an open leg).
 *   R_c = ℓ_c/(μS_c), R_L = ℓ_L/(μS_L) + g₁/(μ₀S_L), R_R = ℓ_R/(μS_R) + g₂/(μ₀S_R)
 *   R = R_c + R_L∥R_R, Φ = NI/R, Φ_L = Φ R_R/(R_L+R_R), Φ_R = Φ R_L/(R_L+R_R) (written with conductances so R_R = ∞ stays finite).
 */
export function solveLegs(p) {
  const mu = MU0 * p.muR, ni = p.turns * p.current;
  const rC = reluctance(p.lengthC, p.areaC, mu), rCoreL = reluctance(p.lengthL, p.areaL, mu), rCoreR = reluctance(p.lengthR, p.areaR, mu);
  const rGapL = p.gapL / (MU0 * p.areaL), rGapR = p.gapR / (MU0 * p.areaR);
  const rL = rCoreL + rGapL, rR = rCoreR + rGapR, gL = 1 / rL, gR = 1 / rR;
  const rParallel = 1 / (gL + gR), rTotal = rC + rParallel, flux = ni / rTotal;
  const fluxL = flux * gL / (gL + gR), fluxR = flux * gR / (gL + gR);
  return { mu, ni, rC, rCoreL, rCoreR, rGapL, rGapR, rL, rR, rParallel, rTotal, flux, fluxL, fluxR,
    bC: flux / p.areaC, bL: fluxL / p.areaL, bR: fluxR / p.areaR };
}

const isSymmetric = p => p.gapL === p.gapR && p.lengthL === p.lengthR && p.areaL === p.areaR;
const SATURATION_NOTE_B = 1.2; // above this a ferromagnetic core is no longer well described by a constant μ_r

function compute(p, probeGap) {
  if (probeGap < 0) return excluded('unsupported', '스윕하는 공극 g₂는 0 이상으로 둡니다.', 'negative-gap');
  const s = solveLegs(p), probe = solveLegs({ ...p, gapR: probeGap });
  const notes = ['자기 회로는 전기 회로와 같이 풉니다: 기자력 NI = 전원, 자속 Φ = 전류, 자기저항 R = ℓ/(μS) = 저항. 가운데 다리가 직렬로 들어가고 두 바깥 다리가 병렬 가지입니다.',
    `R_c = ${plainText(s.rC, 4)}, R_L = R_코어 + R_공극 = ${plainText(s.rCoreL, 4)} + ${plainText(s.rGapL, 4)}, R_R = ${plainText(s.rCoreR, 4)} + ${plainText(s.rGapR, 4)} A·turn/Wb → R = R_c + R_L∥R_R = ${plainText(s.rTotal, 5)} A·turn/Wb.`,
    '자속은 자기저항이 작은 쪽으로 더 많이 흐릅니다 (전류 분배와 같음): 한쪽 공극을 넓히면 그 다리의 자속은 줄고 다른 다리로 몰립니다. 아래 곡선이 그 변화입니다.',
    '공극에서도 단면적이 코어와 같고 가장자리 퍼짐(fringing)·누설자속은 없다고 봅니다. 코어는 선형(일정 μ_r)입니다: 비선형 B–H 표와 반복 풀이는 직렬 공극 코어 실험(mcircuit-gap-core)에만 있습니다.'];
  const worst = Math.max(s.bC, s.bL, s.bR);
  if (worst > SATURATION_NOTE_B) notes.push(`[선형 근사 한계] 가장 큰 다리의 B = ${plainText(worst, 4)} T는 ${SATURATION_NOTE_B} T를 넘습니다. 실제 철심이면 포화로 μ_r이 떨어져 이 값보다 자속이 줄어듭니다 (참고용).`);
  if (!isSymmetric(p)) notes.push('두 바깥 다리가 서로 다릅니다: Φ_L ≠ Φ_R 이며 Φ_L/Φ_R = R_R/R_L 입니다.');
  return {
    region: isSymmetric(p) ? 'symmetric' : 'asymmetric', vectors: {},
    scalars: [scalar('flux', '중앙 다리 자속 Φ = NI/R', s.flux, 'Wb'), scalar('fluxL', '왼쪽 다리 자속 Φ_L', s.fluxL, 'Wb'), scalar('fluxR', '오른쪽 다리 자속 Φ_R', s.fluxR, 'Wb'),
      scalar('NI', '기자력 NI', s.ni, 'A·turn'), scalar('Rtotal', '전체 자기저항 R = R_c + R_L∥R_R', s.rTotal, 'A·turn/Wb'), scalar('Rc', '중앙 다리 R_c', s.rC, 'A·turn/Wb'),
      scalar('RL', '왼쪽 가지 R_L = R_코어 + R_공극', s.rL, 'A·turn/Wb'), scalar('RR', '오른쪽 가지 R_R = R_코어 + R_공극', s.rR, 'A·turn/Wb'),
      scalar('Rparallel', '병렬 R_L∥R_R', s.rParallel, 'A·turn/Wb'), scalar('RgapL', '왼쪽 공극 g₁/(μ₀S_L)', s.rGapL, 'A·turn/Wb'), scalar('RgapR', '오른쪽 공극 g₂/(μ₀S_R)', s.rGapR, 'A·turn/Wb'),
      scalar('Bc', '중앙 다리 B = Φ/S_c', s.bC, 'T'), scalar('BL', '왼쪽 다리 B = Φ_L/S_L', s.bL, 'T'), scalar('BR', '오른쪽 다리 B = Φ_R/S_R', s.bR, 'T'),
      scalar('Hc', '중앙 다리 H = B/μ', s.bC / s.mu, 'A/m'), scalar('HL', '왼쪽 다리 코어 H', s.bL / s.mu, 'A/m'), scalar('HR', '오른쪽 다리 코어 H', s.bR / s.mu, 'A/m'),
      scalar('shareL', '왼쪽으로 가는 자속의 비율 Φ_L/Φ', s.flux > 0 ? s.fluxL / s.flux : s.rR / (s.rL + s.rR), '1'),
      scalar('probeGap', '그래프 관측 공극 g₂', probeGap, 'm'), scalar('probeFlux', '그 g₂에서 Φ', probe.flux, 'Wb'), scalar('probeFluxL', '그 g₂에서 Φ_L', probe.fluxL, 'Wb'),
      scalar('probeFluxR', '그 g₂에서 Φ_R', probe.fluxR, 'Wb')],
    notes,
  };
}

function verify(p) {
  const s = solveLegs(p), method = 'independent re-evaluation of the circuit relations';
  const absTol = Math.max(1e-12 * Math.abs(s.ni), 1e-12), fluxTol = 1e-12 * Math.max(Math.abs(s.flux), 1e-300);
  // Two mesh equations (outer window loops through the centre leg) solved by Cramer: (R_c+R_L)Φ_L + R_cΦ_R = NI, R_cΦ_L + (R_c+R_R)Φ_R = NI.
  const det = (s.rC + s.rL) * (s.rC + s.rR) - s.rC * s.rC, cramerL = s.ni * s.rR / det, cramerR = s.ni * s.rL / det;
  const hC = s.bC / s.mu, hL = s.bL / s.mu, hR = s.bR / s.mu;
  const rows = [
    checkRow('자속 보존(KCL 꼴): Φ_L + Φ_R = Φ', method, s.fluxL + s.fluxR, s.flux, 'Wb', 1e-9, fluxTol),
    checkRow('왼쪽 고리(KVL 꼴): R_cΦ + R_LΦ_L = NI', method, s.rC * s.flux + s.rL * s.fluxL, s.ni, 'A·turn', 1e-9, absTol),
    checkRow('오른쪽 고리(KVL 꼴): R_cΦ + R_RΦ_R = NI', method, s.rC * s.flux + s.rR * s.fluxR, s.ni, 'A·turn', 1e-9, absTol),
    checkRow('암페어 법칙, 왼쪽 고리: H_c ℓ_c + H_L ℓ_L + (B_L/μ₀) g₁ = NI', method, hC * p.lengthC + hL * p.lengthL + (s.bL / MU0) * p.gapL, s.ni, 'A·turn', 1e-9, absTol),
    checkRow('암페어 법칙, 오른쪽 고리: H_c ℓ_c + H_R ℓ_R + (B_R/μ₀) g₂ = NI', method, hC * p.lengthC + hR * p.lengthR + (s.bR / MU0) * p.gapR, s.ni, 'A·turn', 1e-9, absTol),
    checkRow('두 메시 방정식(Cramer)의 Φ_L = 분배식의 Φ_L', 'two-mesh linear system solved by Cramer', cramerL, s.fluxL, 'Wb', 1e-9, fluxTol),
    checkRow('두 메시 방정식(Cramer)의 Φ_R = 분배식의 Φ_R', 'two-mesh linear system solved by Cramer', cramerR, s.fluxR, 'Wb', 1e-9, fluxTol),
  ];
  rows.push(isSymmetric(p) ? checkRow('대칭(g₁ = g₂, 같은 ℓ·S)이면 Φ_L = Φ_R', 'symmetry', s.fluxL, s.fluxR, 'Wb', 1e-12, fluxTol)
    : skippedRow('대칭이면 Φ_L = Φ_R', '두 바깥 다리의 공극·길이·단면적이 같지 않아 대칭 검산은 해당하지 않습니다.', 'symmetry', 'Wb'));
  return rows;
}

// Worked cases (computed with the same function) for the assumptions and the symbolic steps.
const symmetricCase = solveLegs(defaults), asymmetricCase = solveLegs({ ...defaults, gapL: 0, gapR: 2e-3 });
const caseText = r => `R_c =${plainText(r.rC, 4)}, R_L = ${plainText(r.rL, 4)}, R_R = ${plainText(r.rR, 4)}, R = ${plainText(r.rTotal, 4)} A·turn/Wb → Φ = ${plainText(r.flux, 4)} Wb, Φ_L = ${plainText(r.fluxL, 4)}, Φ_R = ${plainText(r.fluxR, 4)} Wb`;

const parallelCore = defineLecture({
  id: 'mcircuit-parallel', title: '3다리 코어의 병렬 자기회로: 자속 분배', topic: TOPIC, week: WEEK, sections: ['8.8'],
  description: '가운데 다리에 코일(NI), 바깥 두 다리가 공극 g₁·g₂를 가진 병렬 귀로. R = R_c + R_L∥R_R, Φ = NI/R. 오른쪽 공극 g₂를 끌어 넓히면 Φ_R이 줄고 자속이 왼쪽으로 몰립니다.',
  answers: ['flux', 'fluxL', 'fluxR'], coordinateScalars: ['probeGap'],
  parameters, probeDefault: [0, 0, 2e-3],
  view: { kind: 'profile', plane: 'xz', extent: 1, probeAxes: [0, 2], coordinate: coordinate('g₂', 'm', '오른쪽 공극 (스윕)') },
  validate: (p, probeGap) => (probeGap < 0 ? '스윕하는 공극 g₂는 0 이상이어야 합니다.' : ''),
  compute,
  profile: (p, count) => {
    const gaps = linspace(0, Math.max(0.01, 2 * p.gapR), count), curve = (key, label) => series(key, label, 'Wb', 'g₂', 'm', gaps.map(g => ({ coordinate: g, value: solveLegs({ ...p, gapR: g })[key] })));
    return [curve('flux', '중앙 다리 Φ'), curve('fluxL', '왼쪽 다리 Φ_L'), curve('fluxR', '오른쪽 다리 Φ_R')];
  },
  verify,
  assumptions: ['선형 코어(일정 μ_r), 공극 단면적 = 그 다리의 코어 단면적, 가장자리 퍼짐·누설자속 없음. 각 다리를 한 개의 자기저항으로 보는 집중 회로입니다. 비선형 B–H 표는 이 실험에서 지원하지 않으며 B가 1.2 T를 넘으면 안내 줄로 알립니다.',
    '강의 정리본의 병렬 예제(필기 b30, 중앙 다리 코일 + 양쪽 공극 d₁, d₂)는 식만 있고 수치가 없습니다: R_m,total = R_m + [(R_m1+R_m3)∥(R_m2+R_m4)]. 아래 수치는 모두 이 앱의 예시입니다.',
    '[앱이 계산한 값] 기본값(N = 500, I = 0.2 A → NI = 100, μ_r = 2000, S_c = 6 cm², S_L = S_R = 3 cm², ℓ_c = 10 cm, ℓ_L = ℓ_R = 30 cm, g₁ = g₂ = 1 mm) 대칭 경우. ' + caseText(symmetricCase),
    '[앱이 계산한 값] 한쪽 공극만 있는 비대칭: g₁ = 0, g₂ = 2 mm (나머지 같음). ' + caseText(asymmetricCase) + ' — 공극이 없는 왼쪽 다리가 자속 대부분(' + plainText(100 * asymmetricCase.fluxL / asymmetricCase.flux, 4) + ' %)을 가져갑니다.',
    'μ₀는 CODATA 2022 값을 씁니다. 손계산과의 차이는 상대 1.5×10⁻¹⁰ 이하입니다.'],
  validity: ['N ≥ 1, 0 ≤ I ≤ 100 A, μ_r ≥ 1, 단면적 ≥ 1 mm², 길이 ≥ 1 mm, 0 ≤ g ≤ 50 mm. 범위 밖은 보정 없이 거절합니다. 스윕 g₂는 0 이상입니다.'],
  singularities: ['특이점은 없습니다. g₂ → ∞(오른쪽 다리가 끊김)이면 R_R → ∞, Φ_R → 0이고 회로는 R_c + R_L의 직렬 회로(공극 코어)로 환원됩니다. 코어 자기저항은 0이 될 수 없으므로 0으로 나누지 않습니다.'],
  formulas: [{ label: '자기저항', text: 'R = ℓ/(μS), 공극 R_g = g/(μ₀S)', unit: 'A·turn/Wb' },
    { label: '합성', text: 'R = R_c + R_L∥R_R, R_L = ℓ_L/(μS_L) + g₁/(μ₀S_L), R_R = ℓ_R/(μS_R) + g₂/(μ₀S_R)', unit: 'A·turn/Wb' },
    { label: '자속과 분배', text: 'Φ = NI/R, Φ_L = Φ R_R/(R_L+R_R), Φ_R = Φ R_L/(R_L+R_R), B = Φ/S', unit: 'Wb; T' }],
  references: [hayt('8.8', 'The magnetic circuit (parallel legs)'), REF.self],
  symbolic: {
    title: '3다리 코어 병렬 자기회로 — 기호 풀이',
    givens: [['N, I', '코일의 감은 수, 전류', '1; A'], ['ℓ_c, ℓ_L, ℓ_R, S_c, S_L, S_R', '다리 길이, 단면적', 'm; m²'], ['g₁, g₂', '바깥 두 다리의 공극', 'm'], ['μ_r', '코어의 비투자율 (일정)', '1']],
    laws: [['암페어 법칙', '∮H·dl = NI (각 바깥 창의 고리)'], ['자속 보존', 'Φ = Φ_L + Φ_R (가운데 다리에서 갈라지는 점)']],
    steps: [['다리별 자기저항', 'R_c = ℓ_c/(μS_c), R_L = ℓ_L/(μS_L) + g₁/(μ₀S_L), R_R = ℓ_R/(μS_R) + g₂/(μ₀S_R)', '코어는 ℓ/(μS), 공극은 g/(μ₀S)이고 한 다리 안에서는 직렬로 더합니다.'],
      ['합성', 'R = R_c + R_L R_R/(R_L + R_R)', '두 바깥 다리는 같은 두 점(위·아래 요크) 사이의 병렬 가지입니다.'],
      ['자속', 'Φ = NI/R', `프리셋 대칭: ${caseText(symmetricCase)}.`],
      ['분배', 'Φ_L = Φ R_R/(R_L+R_R), Φ_R = Φ R_L/(R_L+R_R)', `자기저항이 작은 쪽으로 더 흐릅니다. 비대칭 예: ${caseText(asymmetricCase)}.`],
      ['검산', 'NI = R_cΦ + R_LΦ_L = R_cΦ + R_RΦ_R', '두 창의 암페어 고리 방정식과 같고 Φ_L + Φ_R = Φ입니다.']],
    answers: [['중앙 다리 자속', 'Φ = NI/(R_c + R_L∥R_R)', 'Wb'], ['왼쪽 다리 자속', 'Φ_L = Φ R_R/(R_L+R_R)', 'Wb'], ['오른쪽 다리 자속', 'Φ_R = Φ R_L/(R_L+R_R)', 'Wb']],
    limitations: ['선형 코어와 집중 자기저항만 다룹니다. 포화(비선형 B–H)·누설·가장자리 퍼짐은 계산하지 않습니다.'],
  },
});

export const EXPERIMENTS = [parallelCore];
