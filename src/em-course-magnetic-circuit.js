// Hayt Ch.8 §8.8 lecture experiments: the magnetic circuit with an air gap and the B–H hysteresis loop. Pure: no DOM.
import {
  MU0, REF, TWO_PI, checkRow, choiceParameter, coordinate, defineLecture, excluded, hayt, linspace, parameter, scalar, series,
} from './em-course-lecture.js';
import { plainText } from './em-format.js';

const TOPIC = 'magnetic-circuit';
const WEEK = 6;

// ---- 7. Gapped core, nonlinear B–H table ---------------------------------------------------------------------------------
const gapParameters = [
  choiceParameter('mode', '풀이 방향', 0, [[0, '목표 B → 필요한 NI'], [1, '주어진 N·I → B (반복)']]),
  choiceParameter('coreModel', '코어 재료', 0, [[0, '비선형 B–H 표 (구간 선형)'], [1, '선형 코어 μ_r']]),
  parameter('area', '코어 단면적 S', 'm²', 'cm²', 1e-4, 6e-4, 1e-6, 1),
  parameter('meanDiameter', '환상 코어 평균 지름 (코어 길이 l = π D)', 'm', 'cm', 0.01, 0.3, 1e-3, 10),
  parameter('gap', '공극 길이 g', 'm', 'mm', 1e-3, 2e-3, 0, 0.1),
  parameter('targetB', '목표 공극 자속밀도 B', 'T', 'T', 1, 1, 1e-3, 1.9, { visibleWhen: { key: 'mode', equals: 0 } }),
  parameter('turns', '감은 수 N', '1', '1', 1, 500, 1, 1e5, { visibleWhen: { key: 'mode', equals: 1 } }),
  parameter('current', '전류 I', 'A', 'A', 1, 4, 0, 1000, { visibleWhen: { key: 'mode', equals: 1 } }),
  parameter('muR', '선형 코어의 비투자율 μ_r', '1', '1', 1, 4000, 1, 1e6, { visibleWhen: { key: 'coreModel', equals: 1 } }),
  parameter('h1', 'B–H 표 점 1: H₁', 'A/m', 'A/m', 1, 200, 1, 1e6, { visibleWhen: { key: 'coreModel', equals: 0 } }),
  parameter('b1', 'B–H 표 점 1: B₁', 'T', 'T', 1, 1, 1e-3, 3, { visibleWhen: { key: 'coreModel', equals: 0 } }),
  parameter('h2', 'B–H 표 점 2: H₂ (H₂ > H₁)', 'A/m', 'A/m', 1, 300, 1, 1e7, { visibleWhen: { key: 'coreModel', equals: 0 } }),
  parameter('b2', 'B–H 표 점 2: B₂ (B₂ > B₁)', 'T', 'T', 1, 1.13, 1e-3, 3, { visibleWhen: { key: 'coreModel', equals: 0 } }),
];

/** Piecewise-linear H(B) through (0,0), (h1,b1), (h2,b2); above the last point the core is saturated (slope μ₀). */
function coreCurve(p) {
  const slope2 = (p.b2 - p.b1) / (p.h2 - p.h1);
  return {
    slope2,
    H: b => {
      if (p.coreModel === 1) return b / (MU0 * p.muR);
      if (b <= p.b1) return b * p.h1 / p.b1;
      if (b <= p.b2) return p.h1 + (b - p.b1) / slope2;
      return p.h2 + (b - p.b2) / MU0;
    },
  };
}

const coreLength = p => Math.PI * p.meanDiameter;
const totalNI = (p, curve, b) => curve.H(b) * coreLength(p) + b * p.gap / MU0;
const regionOf = (p, b) => (p.coreModel === 1 ? 'linear-core' : b <= p.b1 ? 'below-knee' : b <= p.b2 ? 'knee' : 'saturation');

function tableError(p) {
  if (p.coreModel === 1) return '';
  if (!(p.h2 > p.h1)) return 'B–H 표의 점 2는 점 1보다 H가 커야 합니다 (H₂ > H₁).';
  if (!(p.b2 > p.b1)) return 'B–H 표의 점 2는 점 1보다 B가 커야 합니다 (B₂ > B₁).';
  const slope2 = (p.b2 - p.b1) / (p.h2 - p.h1);
  if (slope2 < MU0 || slope2 > p.b1 / p.h1) return '곡선이 포화 쪽으로 휘어야 합니다: μ₀ ≤ (B₂−B₁)/(H₂−H₁) ≤ B₁/H₁.';
  return '';
}

/**
 * Fixed-point iteration of the lecture (b33): guess μ, solve the linear circuit, read B, update μ = B/H(B).
 * The plain lecture step (B ← the B just read) is kept while the residual |B_read − B| keeps shrinking. In saturation the map
 * f(B) = NI·B/NI(B) has slope 1 − B·NI'(B)/NI far below −1 and the plain step oscillates or diverges. B_read − B has the sign
 * of B* − B (NI(B) is increasing), so the step is damped: B ← B + α (B_read − B), α halved whenever the residual does not shrink
 * and doubled back after two steps in the same direction, and a step that leaves the bracket of known signs is replaced by its
 * midpoint (also after 150 steps). Each list row keeps the lecture's reading (assumed μ → B_read) and the α used.
 */
function iterate(p, curve, ni) {
  const length = coreLength(p), list = [], mu0 = p.coreModel === 1 ? MU0 * p.muR : p.b1 / p.h1;
  if (!(ni > 0)) return { b: 0, list: [{ k: 1, mur: mu0 / MU0, b: 0, alpha: 1 }], converged: true, damped: false };
  let mu = mu0, state = 0, alpha = 1, damped = false, residual = Infinity, lo = 0, hi = Infinity, lastSign = 0, run = 0, converged = false;
  for (let k = 1; k <= 500; k++) {
    const read = ni / (length / mu + p.gap / MU0), delta = read - state, step = Math.abs(delta), sign = Math.sign(delta);
    if (k > 1 && step >= residual) { alpha /= 2; run = 0; } else if (sign === lastSign) { if (++run >= 2) { alpha = Math.min(1, alpha * 2); run = 0; } } else run = 0;
    list.push({ k, mur: mu / MU0, b: read, alpha });
    converged = step <= 1e-13 * Math.max(read, 1e-300);
    if (converged) { state = read; break; }
    if (sign > 0) lo = Math.max(lo, state); else hi = Math.min(hi, state);
    // in saturation the reading amplifies the last digit of B by μ_r, so the residual floors at ≈ μ_r·ε: the bracket closing is the exact test
    if (Number.isFinite(hi) && hi - lo <= 4e-16 * hi) { converged = true; state = (lo + hi) / 2; break; }
    let next = k === 1 ? read : state + alpha * delta;
    if (k > 1 && Number.isFinite(hi) && (next <= lo || next >= hi || k > 150)) { next = (lo + hi) / 2; damped = true; } // k > 150: very flat knee, bisect the bracket
    if (alpha < 1) damped = true;
    residual = step; lastSign = sign; state = next;
    const h = curve.H(state);
    if (h === 0) break;
    mu = state / h;
  }
  return { b: state, list, converged, damped };
}

/** Independent solution of NI(B) = N·I by bisection (NI(B) is increasing). */
function bisect(p, curve, ni) {
  if (!(ni > 0)) return 0;
  let lo = 0, hi = 1;
  while (totalNI(p, curve, hi) < ni && hi < 1e6) hi *= 2;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (totalNI(p, curve, mid) < ni) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

function gapSolve(p) {
  const curve = coreCurve(p), length = coreLength(p);
  let b, ni, iteration = null;
  if (p.mode === 0) { b = p.targetB; ni = totalNI(p, curve, b); }
  else {
    ni = p.turns * p.current;
    iteration = iterate(p, curve, ni);
    b = bisect(p, curve, ni);
  }
  const hCore = curve.H(b), muSecant = hCore > 0 ? b / hCore : MU0 * (p.coreModel === 1 ? p.muR : p.b1 / p.h1 / MU0);
  return { curve, length, b, ni, hCore, muSecant, iteration, vCore: hCore * length, vGap: b * p.gap / MU0 };
}

function gapCompute(p, probeB) {
  const error = tableError(p);
  if (error) return excluded('invalid', error);
  if (probeB < 0) return excluded('unsupported', '코어의 자속밀도 B는 0 이상으로 둡니다.', 'negative-B');
  const s = gapSolve(p), flux = s.b * p.area, rCore = s.length / (s.muSecant * p.area), rGap = p.gap / (MU0 * p.area);
  const notes = ['기자력 V_m = NI = ∮H·dl = H_core l + H_gap g, 자속 Φ = B S, 자기저항 R_m = l/(μS) (전기 회로의 V = IR, I = ∫J·ds와 대응). 공극은 코어 B와 같은 B에서 H = B/μ₀로 매우 큰 H가 필요합니다.',
    '단일 직렬 자기회로이며 공극 가장자리의 퍼짐(fringing)과 누설자속은 무시합니다.'];
  if (p.coreModel === 0 && (s.b > p.b2 || probeB > p.b2)) {
    notes.push(`[표 밖 외삽] B = ${plainText(Math.max(s.b, probeB), 4)} T는 B–H 표의 마지막 점 B₂ = ${plainText(p.b2, 4)} T 위입니다. 표 밖 외삽(기울기 μ₀ 가정): 실제 재료 곡선이 아니므로 필요한 NI는 참고용입니다.`);
  }
  if (s.iteration) {
    const rows = s.iteration.list;
    for (const row of rows.slice(0, 6)) {
      notes.push(`반복 ${row.k}: 가정한 μ_r = ${plainText(row.mur, 4)} → B = ${plainText(row.b, 5)} T${row.alpha < 1 ? ` (감쇠 α = ${plainText(row.alpha, 3)})` : ''}`);
    }
    if (s.iteration.damped) notes.push('이 입력은 포화 쪽이라 필기의 μ 갱신을 그대로 반복하면 B가 진동·발산합니다. 잔차가 줄지 않을 때마다 갱신 폭을 절반으로 줄이는 감쇠(필요하면 해가 낀 구간의 중점)를 적용해 같은 해로 수렴시켰습니다.');
    notes.push(s.iteration.converged ? `${rows.length}회 만에 수렴: B = ${plainText(s.iteration.b, 6)} T`
      : '500회 안에 수렴하지 않았습니다. 감쇠를 적용해도 잔차가 허용값 아래로 내려가지 않아 반복의 B는 쓰지 않고 이분법의 B를 보였습니다.');
  }
  const probeNI = totalNI(p, s.curve, probeB);
  return {
    region: regionOf(p, s.b), vectors: {},
    scalars: [scalar('NI', '필요한/주어진 기자력 NI', s.ni, 'A·turn'), scalar('B', '공극 자속밀도 B', s.b, 'T'), scalar('Vcore', '철심의 기자력 V_m,core = H l', s.vCore, 'A·turn'),
      scalar('Vgap', '공극의 기자력 V_m,gap = B g/μ₀', s.vGap, 'A·turn'), scalar('Hcore', '코어의 H', s.hCore, 'A/m'), scalar('Hgap', '공극의 H = B/μ₀', s.b / MU0, 'A/m'),
      scalar('flux', '자속 Φ = B S', flux, 'Wb'), scalar('RmCore', '코어 자기저항 l/(μS) (할선 μ)', rCore, 'A·turn/Wb'),
      scalar('RmGap', '공극 자기저항 g/(μ₀S)', rGap, 'A·turn/Wb'), scalar('mur', '할선 비투자율 B/(μ₀H)', s.muSecant / MU0, '1'),
      scalar('gapShare', '공극이 차지하는 기자력 비율', s.ni > 0 ? s.vGap / s.ni : 0, '1'), scalar('coreLength', '코어 길이 l = πD', s.length, 'm'),
      scalar('currentNeeded', '필요한 전류 I = NI/N', s.ni / p.turns, 'A'),
      scalar('probeB', '그래프 관측 B', probeB, 'T'), scalar('probeNI', '그 B에 필요한 NI', probeNI, 'A·turn')],
    notes,
  };
}

function gapVerify(p) {
  const error = tableError(p);
  if (error) return [{ label: '자기회로 검증', method: 'input validation', status: 'skipped', reason: error, unit: '' }];
  const method = 'independent re-evaluation of the circuit relations', s = gapSolve(p), flux = s.b * p.area;
  const absTol = Math.max(1e-12 * Math.abs(s.ni), 1e-12); // absolute floor: NI = 0 gives B = 0 and no relative scale
  const rows = [
    checkRow('암페어 법칙: H_core l + H_gap g = NI', method, s.hCore * s.length + (s.b / MU0) * p.gap, s.ni, 'A·turn', 1e-9, absTol),
    checkRow('자기 옴의 법칙: Φ (R_core + R_gap) = NI', method, flux * (s.length / (s.muSecant * p.area) + p.gap / (MU0 * p.area)), s.ni, 'A·turn', 1e-9, absTol),
  ];
  if (p.mode === 1) {
    rows.push(s.iteration.converged ? checkRow('고정점 반복의 B = 이분법의 B', 'fixed-point iteration (μ → B → μ) vs bisection on NI(B)', s.iteration.b, s.b, 'T', 1e-9, 1e-12)
      : { label: '고정점 반복의 수렴', method, status: 'skipped', reason: '500회 반복(감쇠 포함)에서 수렴하지 않아 반복과 이분법의 비교를 건너뜁니다.', unit: 'T' });
  } else {
    const back = iterate(p, s.curve, s.ni);
    rows.push(back.converged ? checkRow('왕복: 이 NI로 반복해 얻은 B = 목표 B', 'iterating the lecture procedure on the NI just found', back.b, s.b, 'T', 1e-8, 1e-12)
      : { label: '왕복 반복의 수렴', method, status: 'skipped', reason: '500회 반복(감쇠 포함)에서 수렴하지 않아 왕복 비교를 건너뜁니다.', unit: 'T' });
  }
  return rows;
}

// A worked example of the preset for the symbolic steps (computed with the same functions).
const presetParams = Object.fromEntries(gapParameters.map(item => [item.key, item.initial]));
const presetOne = gapSolve(presetParams), presetTwo = gapSolve({ ...presetParams, mode: 1 });
const workedOne = `B = 1 T → H_core = 200 A/m, V_m,core = ${plainText(presetOne.vCore, 4)}, V_m,gap = ${plainText(presetOne.vGap, 4)} → NI = ${plainText(presetOne.ni, 4)} A·turn`;
const workedTwo = `NI = 2000: ${presetTwo.iteration.list.slice(0, 4).map(r => `B${r.k} = ${plainText(r.b, 4)} T`).join(', ')} … → B = ${plainText(presetTwo.b, 4)} T (${presetTwo.iteration.list.length}회)`;

const gapCore = defineLecture({
  id: 'mcircuit-gap-core', title: '공극 있는 코어의 자기회로 NI와 B', topic: TOPIC, week: WEEK, sections: ['8.8'],
  description: '환상 코어(S = 6 cm², 평균 지름 0.3 m, 공극 2 mm): B = 1 T에 필요한 NI는 약 1780 A·turn. 반대로 NI = 2000에서 B는 μ를 가정·갱신하는 반복으로 구합니다.',
  answers: ['NI','B'], coordinateScalars: ['probeB'],
  parameters: gapParameters, probeDefault: [0, 0, 1],
  view: { kind: 'profile', plane: 'xz', extent: 1, probeAxes: [0, 2], coordinate: coordinate('B', 'T', '공극(=코어) 자속밀도') },
  validate: p => tableError(p),
  compute: gapCompute,
  profile: (p, count) => {
    if (tableError(p)) return [];
    // up to the last tabulated point: beyond it the slope-μ₀ saturation makes H huge and would flatten everything else
    const curve = coreCurve(p), length = coreLength(p), bs = linspace(0, p.coreModel === 1 ? 1.6 : p.b2, count);
    return [series('NI', '필요한 기자력 NI(B)', 'A·turn', 'B', 'T', bs.map(b => ({ coordinate: b, value: totalNI(p, curve, b) }))),
      series('Vcore', '철심 기자력 H(B) l', 'A·turn', 'B', 'T', bs.map(b => ({ coordinate: b, value: curve.H(b) * length }))),
      series('Vgap', '공극 기자력 B g/μ₀', 'A·turn', 'B', 'T', bs.map(b => ({ coordinate: b, value: b * p.gap / MU0 })))];
  },
  verify: gapVerify,
  assumptions: ['환상 코어를 한 줄 자기회로(전기 직렬 회로)로 봅니다: 코어 길이 l = πD(공극 길이는 빼지 않음), 코어·공극의 단면적 S가 같고 B가 같습니다.',
    'B–H 표는 원점 (0,0), (H₁, B₁), (H₂, B₂)를 잇는 구간 선형이며 마지막 점 위는 기울기 μ₀(완전 포화)로 잇습니다. 이 외삽과 그 아래 구간은 이 앱의 가정입니다.',
    '프리셋은 필기 b32: S = 6×10⁻⁴ m², D = 0.3 m, g = 2 mm, B = 1 T, 곡선점 (200 A/m, 1 T)·(300 A/m, 1.13 T). 결과 NI = 1780 A·turn(공극 1591.5 + 철심 188.5)이 4자리까지 일치합니다.',
    '[앱이 계산한 값 / 필기와 다른 점] NI = 2000 A·turn을 주면 필기는 1.13 T로 읽지만, 표의 (1.13 T, 300 A/m)에서 NI(B)는 약 2081이라 B = 1.13 T는 해가 아닙니다. μ = 1/200으로 첫 계산하면 1.1236 T(필기의 "≈ 1.12")이고 반복이 수렴하는 값은 이 표에서 약 1.095 T입니다.',
    'μ₀는 CODATA 2022 값(4π×10⁻⁷과 상대 차 1.5×10⁻¹⁰)을 씁니다.'],
  validity: ['0 ≤ g ≤ 0.1 m. 풀이 방향 0은 목표 B, 방향 1은 N·I를 쓰고 쓰지 않는 입력은 무시됩니다.', 'B–H 표 조건: 0 < H₁ < H₂, 0 < B₁ < B₂, μ₀ ≤ (B₂−B₁)/(H₂−H₁) ≤ B₁/H₁.'],
  singularities: ['특이점은 없습니다. 공극 g = 0이면 자기저항은 코어뿐입니다. 잘못된 표는 입력 오류로 거절합니다.'],
  formulas: [{ label: '기자력과 자속', text: 'V_m = NI = ∮H·dl = H_core l + (B/μ₀) g, Φ = B S', unit: 'A·turn; Wb' },
    { label: '자기저항', text: 'R_m = l/(μ S), V_m = Φ R_m', unit: 'A·turn/Wb' }, { label: '선형 코어 공극 회로', text: 'B = NI/(l/μ + g/μ₀)', unit: 'T' }],
  references: [hayt('8.8', 'The magnetic circuit'), REF.self],
  symbolic: {
    title: '공극 코어 자기회로 — 기호 풀이와 반복',
    givens: [['N, I', '감은 수, 전류', '1; A'], ['S, l, g', '단면적, 코어 길이, 공극', 'm²; m; m'], ['B–H 곡선', '코어 재료의 H(B)', 'A/m']],
    laws: [['암페어 법칙', '∮H·dl = NI'], ['자속 보존', 'Φ = B S (코어와 공극에서 같음)']],
    steps: [['기자력 분해', 'NI = H_core l + H_gap g = H_core l + B g/μ₀', '공극에서 H = B/μ₀.'],
      ['목표 B가 주어질 때', 'NI = H(B) l + B g/μ₀', `H(B)는 B–H 곡선에서 읽습니다. 프리셋: ${workedOne}.`],
      ['선형 코어일 때', 'B = NI/(l/μ + g/μ₀)', 'R_m,total = l/(μS) + g/(μ₀S)와 같은 식입니다.'],
      ['NI가 주어질 때(비선형)', 'μ_k = B_{k−1}/H(B_{k−1}), B_k = NI/(l/μ_k + g/μ₀)', `μ를 가정 → B → 곡선에서 μ 갱신을 반복합니다. 프리셋: ${workedTwo}.`]],
    answers: [['필요한 기자력', 'NI = H(B) l + B g/μ₀', 'A·turn'], ['공극 자속밀도', 'B = NI/(l/μ + g/μ₀) (선형)', 'T'], ['자속', 'Φ = B S = NI/(R_core + R_gap)', 'Wb']],
    limitations: ['단일 직렬 회로입니다. 다리가 여럿인 병렬 자기회로(강의 ex2)는 이 실험에서 계산하지 않습니다.'],
  },
});

// ---- 8. Hysteresis loop (concept model) ---------------------------------------------------------------------------------
const hysteresisParameters = [
  parameter('Bs', '포화 자속밀도 B_s', 'T', 'T', 1, 1.5, 0.1, 3),
  parameter('Br', '잔류 자속밀도 B_r (H = 0일 때 남는 B, B_r < B_s)', 'T', 'T', 1, 1, 0.01, 2.9),
  parameter('Hc', '보자력 H_c (B를 0으로 만드는 H)', 'A/m', 'A/m', 1, 60, 1, 1e5),
  parameter('Hmax', '구동 진폭 H_max', 'A/m', 'A/m', 1, 400, 1, 1e6),
  parameter('volume', '코어 부피 V', 'm³', 'cm³', 1e-6, 1e-4, 1e-9, 1),
  parameter('frequency', '구동 주파수 f', 'Hz', 'Hz', 1, 50, 0.1, 1e6),
];

const lncosh = x => Math.abs(x) + Math.log1p(Math.exp(-2 * Math.abs(x))) - Math.LN2;

function loopModel(p) {
  const width = p.Hc / Math.atanh(p.Br / p.Bs), up = h => p.Bs * Math.tanh((h - p.Hc) / width), down = h => p.Bs * Math.tanh((h + p.Hc) / width);
  const area = 2 * p.Bs * width * (lncosh((p.Hmax + p.Hc) / width) - lncosh((p.Hmax - p.Hc) / width));
  return { width, up, down, area };
}

function hysteresisCompute(p, phase) {
  const m = loopModel(p), h = p.Hmax * Math.sin(phase), ascending = Math.cos(phase) >= 0, b = ascending ? m.up(h) : m.down(h);
  const energy = p.volume * m.area;
  return {
    region: ascending ? 'ascending' : 'descending', vectors: {},
    scalars: [scalar('H', '구동 H = H_max sinφ', h, 'A/m'), scalar('B', '그 순간의 B (가지에 따라 다름)', b, 'T'), scalar('phase', '구동 위상 φ', phase, 'rad'),
      scalar('Br', '잔류 자속밀도 B_r = B(H=0, 내려오는 가지)', m.down(0), 'T'), scalar('Hc', '보자력 H_c: B(−H_c, 내려오는 가지) = 0', -p.Hc, 'A/m'),
      scalar('Bmax', '최대 자속밀도 B(H_max)', m.down(p.Hmax), 'T'), scalar('width', '곡선 모양 폭 w = H_c/atanh(B_r/B_s)', m.width, 'A/m'),
      scalar('area', '루프 면적 ∮H dB = 부피당 손실/주기', m.area, 'J/m³'), scalar('cycleLoss', '코어 전체 손실/주기 V∮H dB', energy, 'J'),
      scalar('power', '히스테리시스 손실 전력 f V∮H dB', p.frequency * energy, 'W'), scalar('bound', '직사각형 상한 4 H_c B_s', 4 * p.Hc * p.Bs, 'J/m³')],
    notes: ['[개념 모델] tanh 두 가지: 올라가는 가지 B = B_s tanh((H−H_c)/w), 내려오는 가지 B = B_s tanh((H+H_c)/w)로 같은 H에서 B가 다른 이력을 나타냅니다. 측정 곡선이 아닙니다.',
      '한 주기 동안 철심이 먹는 에너지는 W = V∮H dB: 루프가 에워싼 면적에 부피를 곱한 값이며 열로 사라집니다.',
      '교류 자성체의 손실은 히스테리시스 손실 + 와전류 손실입니다. 와전류는 절연된 얇은 판(적층)이나 페라이트로 줄이며 이 모형에는 포함하지 않았습니다.'],
  };
}

function hysteresisVerify(p) {
  const method = 'independent trapezoid of ∮H dB around the closed loop (4000 points per branch, vertical closing segments)', model = loopModel(p), count = 4000;
  if (!(Number.isFinite(model.width) && model.width > 0 && Number.isFinite(model.area))) {
    return [{ label: '히스테리시스 루프 검산', method: 'input validation', status: 'skipped', reason: '곡선 폭 w나 루프 면적이 유한한 양수로 정의되지 않아 검산하지 않습니다.', unit: '' }];
  }
  // The branches differ by 4B_s e^(−2(|H|−H_c)/w) beyond H_c, so past H_c + 40 w the loop is closed to e^−80: a grid over that range keeps
  // the spacing a small fraction of w however large H_max is (a grid over ±H_max alone steps over the loop when H_max ≫ w).
  const reach = Math.min(p.Hmax, p.Hc + 40 * model.width);
  const hs = linspace(-reach, reach, count), pts = [];
  for (const h of hs) pts.push([h, model.up(h)]);
  for (const h of [...hs].reverse()) pts.push([h, model.down(h)]);
  let loop = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    loop += (a[0] + b[0]) / 2 * (b[1] - a[1]);
  }
  // the descending branch is increasing and crosses zero at −H_c, which may lie outside ±H_max (H_c > H_max): bracket both
  const span = Math.max(p.Hmax, 2 * p.Hc);
  let lo = -span, hi = span;
  for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; if (model.down(mid) < 0) lo = mid; else hi = mid; }
  return [checkRow('루프 면적: 닫힌 꼴 = 수치 ∮H dB', method, loop, model.area, 'J/m³', 1e-6, 1e-9),
    checkRow('H = 0에서 내려오는 가지의 B = B_r', 'direct evaluation of the branch', model.down(0), p.Br, 'T', 1e-9, 1e-12),
    checkRow('내려오는 가지가 B = 0이 되는 H = −H_c', 'bisection on the descending branch', (lo + hi) / 2, -p.Hc, 'A/m', 1e-9, 1e-9)];
}

const hysteresis = defineLecture({
  id: 'mcircuit-hysteresis', title: '히스테리시스 B–H 루프와 손실 (개념 모형)', topic: TOPIC, week: WEEK, sections: ['8.8', '8.10'],
  description: '잔류 B_r, 보자력 H_c, 포화 B_s를 갖는 tanh 루프. 루프가 에워싼 면적이 한 주기의 손실 W = V∮H dB입니다. 그림을 가로로 끌어 구동 위상을 바꿉니다.',
  answers: ['area','cycleLoss','power'], coordinateScalars: ['phase'],
  modelKind: 'lecture-concept', parameters: hysteresisParameters, probeDefault: [0, 0, Math.PI / 4],
  view: { kind: 'xy-curve', plane: 'xy', extent: 1, probeAxes: [0, 1], coordinate: coordinate('φ', 'rad', '구동 위상'),
    curve: { xLabel: 'H', xUnit: 'A/m', yLabel: 'B', yUnit: 'T', marker: { x: 'H', y: 'B' }, sweep: () => [0, TWO_PI] } },
  validate: p => (p.Br < p.Bs ? '' : '잔류 자속밀도 B_r는 포화 자속밀도 B_s보다 작아야 합니다.'),
  compute: hysteresisCompute,
  profile: (p, count) => {
    const model = loopModel(p), hs = linspace(-p.Hmax, p.Hmax, count);
    return [series('ascending', '올라가는 가지', 'T', 'H', 'A/m', hs.map(h => ({ coordinate: h, value: model.up(h) }))),
      series('descending', '내려오는 가지', 'T', 'H', 'A/m', hs.map(h => ({ coordinate: h, value: model.down(h) })))];
  },
  verify: hysteresisVerify,
  assumptions: ['개념 모형: 곡선 폭 w = H_c/atanh(B_r/B_s)로 B(H=0) = B_r, B(−H_c) = 0이 정확히 맞도록 정했습니다. 실제 재료의 곡선 모양이 아닙니다.',
    '이 모형은 두 가지를 ±H_c만큼 옮긴 같은 곡선이라 포화 루프 면적이 w와 무관하게 ≈ 4H_cB_s에 가까워집니다. 숫자 프리셋(1.5 T, 1 T, 60 A/m, 400 A/m)은 강의 값이 아니라 이 앱의 예시입니다.',
    '구동은 H = H_max sin φ의 한 주기이고 와전류 손실, 주파수 의존, 마이너 루프는 다루지 않습니다.'],
  validity: ['0 < B_r < B_s, H_max > 0. H_max가 H_c보다 충분히 커야 포화 루프가 됩니다.'],
  singularities: ['특이점은 없습니다. 올라가는 가지와 내려오는 가지는 φ = ±π/2에서 바뀌며 H_max가 크면 끝점의 차이는 아주 작습니다.'],
  formulas: [{ label: '가지', text: 'B_↑ = B_s tanh((H − H_c)/w), B_↓ = B_s tanh((H + H_c)/w)', unit: 'T' },
    { label: '폭', text: 'w = H_c/atanh(B_r/B_s)', unit: 'A/m' },
    { label: '손실', text: 'W = V ∮H dB = V ∫(B_↓ − B_↑) dH', unit: 'J' }],
  references: [hayt('8.8', 'The magnetic circuit — B–H curve, hysteresis'), REF.matter],
  symbolic: {
    title: '히스테리시스 루프의 면적과 손실 — 기호 풀이',
    givens: [['B_s', '포화 자속밀도', 'T'], ['B_r', '잔류 자속밀도', 'T'], ['H_c', '보자력', 'A/m'], ['V', '코어 부피', 'm³']],
    laws: [['자성체에 주는 에너지', 'dW = V H dB'], ['한 주기', 'W = V ∮H dB']],
    steps: [['폭의 결정', 'B_s tanh(H_c/w) = B_r → w = H_c/atanh(B_r/B_s)', '두 조건 B(0) = B_r, B(−H_c) = 0이 함께 맞습니다.'],
      ['면적', 'A = ∫(B_↓ − B_↑) dH = 2 B_s w [ln cosh((H_m+H_c)/w) − ln cosh((H_m−H_c)/w)]', '닫힌 루프의 넓이가 한 주기의 부피당 손실입니다.'],
      ['포화 극한', 'A → 4 H_c B_s (H_m ≫ H_c)', '이상적 직사각 루프의 면적과 같습니다.']],
    answers: [['부피당 주기 손실', 'A = ∮H dB', 'J/m³'], ['코어 손실 전력', 'P = f V A', 'W']],
    limitations: ['개념 모형이며 와전류 손실과 마이너 루프는 다루지 않습니다.'],
  },
});

export const EXPERIMENTS = [gapCore, hysteresis];
