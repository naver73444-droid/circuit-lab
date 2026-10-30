// Ch.14 filter circuits (passive §14.7, active §14.8) and magnitude/frequency scaling (§14.10). Every circuit becomes a rational H(s)
// built from element impedances, so the transfer-function reading (type, order, half-power points) is shared with the Bode tool. Pure.
import { rAdd, rMul, rDiv, rNeg, rParallel, rConst, reduceRational, S } from './circuit-course-transfer.js';

// Element impedances in s: R, sL, 1/(sC).
export const zR = R => rConst(R);
export const zL = L => rMul(S, rConst(L));
export const zC = C => rDiv(rConst(1), rMul(S, rConst(C)));
const ONE = rConst(1);

/**
 * A ladder of series and shunt impedances from the source to an open output: steps = [['series', Z] | ['shunt', Z], …].
 * The chain matrix [[A, B], [C, D]] of the whole ladder gives H = Vo/Vs = 1/A.
 */
export function ladderTransfer(steps) {
  let A = ONE, B = rConst(0), C = rConst(0), D = ONE;
  for (const [kind, z] of steps) {
    if (kind === 'series') { B = rAdd(rMul(A, z), B); D = rAdd(rMul(C, z), D); } // M · [[1, Z], [0, 1]]
    else { const y = rDiv(ONE, z); A = rAdd(A, rMul(B, y)); C = rAdd(C, rMul(D, y)); } // M · [[1, 0], [Y, 1]]
  }
  return rDiv(ONE, A);
}
/** The same ladder evaluated directly with complex numbers at one ω (the independent check of the polynomial form). */
export function ladderAt(steps, w) {
  const c = (re, im = 0) => ({ re, im }), mul = (a, b) => c(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re), add = (a, b) => c(a.re + b.re, a.im + b.im);
  const div = (a, b) => { const d = b.re * b.re + b.im * b.im; return c((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d); };
  let A = c(1), B = c(0), C = c(0), D = c(1);
  for (const [kind, , direct] of steps) {
    const z = direct(w);
    if (kind === 'series') { B = add(mul(A, z), B); D = add(mul(C, z), D); }
    else { const y = div(c(1), z); A = add(A, mul(B, y)); C = add(C, mul(D, y)); }
  }
  return div(c(1), A);
}
// Steps carry both forms: the rational impedance and a direct complex function of ω.
const R_ = R => [zR(R), () => ({ re: R, im: 0 })];
const L_ = L => [zL(L), w => ({ re: 0, im: w * L })];
const C_ = C => [zC(C), w => ({ re: 0, im: -1 / (w * C) })];
const sum_ = (a, b) => [rAdd(a[0], b[0]), w => { const x = a[1](w), y = b[1](w); return { re: x.re + y.re, im: x.im + y.im }; }];
const step = (kind, [z, direct]) => [kind, z, direct];

// ---- circuit catalog ----------------------------------------------------------------------------------------------------------------
// fields: the element keys a circuit uses (the tool shows only those). steps (passive) or transfer (active) build H(s);
// formula: H in symbols; derivation: short steps; topology: one line describing the wiring.
const gain = v => 1 + v.Rf / v.Ri;
export const FILTER_CIRCUITS = Object.freeze([
  { id: 'rc-lp', family: 'passive', label: 'RC 저역통과 (출력 C)', fields: ['R', 'C'], topology: 'Vs — R — ●출력 — C — 접지',
    steps: v => [step('series', R_(v.R)), step('shunt', C_(v.C))], formula: 'H(s) = 1/(1 + sRC), ωc = 1/(RC)', derivation: ['분압: H = (1/sC)/(R + 1/sC)', '= 1/(1 + sRC)'] },
  { id: 'rc-hp', family: 'passive', label: 'RC 고역통과 (출력 R)', fields: ['R', 'C'], topology: 'Vs — C — ●출력 — R — 접지',
    steps: v => [step('series', C_(v.C)), step('shunt', R_(v.R))], formula: 'H(s) = sRC/(1 + sRC), ωc = 1/(RC)', derivation: ['분압: H = R/(R + 1/sC)', '= sRC/(1 + sRC)'] },
  { id: 'rl-lp', family: 'passive', label: 'RL 저역통과 (출력 R)', fields: ['R', 'L'], topology: 'Vs — L — ●출력 — R — 접지',
    steps: v => [step('series', L_(v.L)), step('shunt', R_(v.R))], formula: 'H(s) = R/(R + sL), ωc = R/L', derivation: ['분압: H = R/(R + sL)'] },
  { id: 'rl-hp', family: 'passive', label: 'RL 고역통과 (출력 L)', fields: ['R', 'L'], topology: 'Vs — R — ●출력 — L — 접지',
    steps: v => [step('series', R_(v.R)), step('shunt', L_(v.L))], formula: 'H(s) = sL/(R + sL), ωc = R/L', derivation: ['분압: H = sL/(R + sL)'] },
  { id: 'rlc-bp', family: 'passive', label: '직렬 RLC 대역통과 (출력 R)', fields: ['R', 'L', 'C'], topology: 'Vs — L — C — ●출력 — R — 접지',
    steps: v => [step('series', L_(v.L)), step('series', C_(v.C)), step('shunt', R_(v.R))], formula: 'H(s) = sRC/(s²LC + sRC + 1), ω0 = 1/√(LC), B = R/L',
    derivation: ['분압: H = R/(R + sL + 1/sC)', '분자·분모에 sC를 곱함: sRC/(s²LC + sRC + 1)'] },
  { id: 'rlc-bs', family: 'passive', label: '직렬 RLC 대역차단 (출력 L+C)', fields: ['R', 'L', 'C'], topology: 'Vs — R — ●출력 — (L — C 직렬) — 접지',
    steps: v => [step('series', R_(v.R)), step('shunt', sum_(L_(v.L), C_(v.C)))], formula: 'H(s) = (s²LC + 1)/(s²LC + sRC + 1), ω0 = 1/√(LC), B = R/L',
    derivation: ['분압: H = (sL + 1/sC)/(R + sL + 1/sC)', '= (s²LC + 1)/(s²LC + sRC + 1)'] },
  { id: 'lp2', family: 'passive', label: '2차 저역통과 L 직렬 · 출력 R∥C (예제 14.10)', fields: ['L', 'R', 'C'], topology: 'Vs — L — ●출력 — (R ∥ C) — 접지',
    steps: v => [step('series', L_(v.L)), step('shunt', R_(v.R)), step('shunt', C_(v.C))], formula: 'H(s) = R/(s²RLC + sL + R)',
    derivation: ['R∥C = R/(1 + sRC)', '분압: H = [R/(1 + sRC)] / [sL + R/(1 + sRC)]', '= R/(s²RLC + sL + R) → H(ω) = R/(R − ω²RLC + jωL)'] },
  { id: 'ladder-rc', family: 'passive', label: '2단 사다리 R–C–C–R (연습 14.57a)', fields: ['R1', 'C1', 'C2', 'R2'], topology: 'Vs — R1 — ● — C2 — ●출력 — R2 — 접지, 가운데 ●에서 C1 — 접지',
    steps: v => [step('series', R_(v.R1)), step('shunt', C_(v.C1)), step('series', C_(v.C2)), step('shunt', R_(v.R2))], formula: '1 Ω·1 F·1 F·1 Ω이면 H(s) = s/(s² + 3s + 1)',
    derivation: ['오른쪽부터: Z = C1 ∥ (1/sC2 + R2)', 'V1 = Vs·Z/(R1 + Z), Vo = V1·R2/(R2 + 1/sC2)'] },
  { id: 'ladder-rl', family: 'passive', label: '2단 사다리 L–R–R–L (연습 14.57b)', fields: ['L1', 'R1', 'R2', 'L2'], topology: 'Vs — L1 — ● — R2 — ●출력 — L2 — 접지, 가운데 ●에서 R1 — 접지',
    steps: v => [step('series', L_(v.L1)), step('shunt', R_(v.R1)), step('series', R_(v.R2)), step('shunt', L_(v.L2))], formula: '1 H·1 Ω·1 Ω·1 H이면 H(s) = s/(s² + 3s + 1)',
    derivation: ['오른쪽부터: Z = R1 ∥ (R2 + sL2)', 'V1 = Vs·Z/(sL1 + Z), Vo = V1·sL2/(R2 + sL2)'] },
  { id: 'inv-lp', family: 'active', label: '반전 저역통과 (Zi = Ri, Zf = Rf ∥ Cf)', fields: ['Ri', 'Rf', 'Cf'], topology: '반전 증폭기: 입력 Ri, 귀환 Rf ∥ Cf',
    transfer: v => rNeg(rDiv(rParallel(zR(v.Rf), zC(v.Cf)), zR(v.Ri))), direct: (v, w) => cdivc({ re: -v.Rf / v.Ri, im: 0 }, { re: 1, im: w * v.Rf * v.Cf }),
    formula: 'H(s) = −(Rf/Ri)·1/(1 + sRfCf), ωc = 1/(RfCf), 직류 이득 −Rf/Ri', derivation: ['H = −Zf/Zi', 'Zf = Rf/(1 + sRfCf)', '→ −(Rf/Ri)/(1 + sRfCf)'] },
  { id: 'inv-hp', family: 'active', label: '반전 고역통과 (Zi = Ri + 1/sCi, Zf = Rf)', fields: ['Ri', 'Ci', 'Rf'], topology: '반전 증폭기: 입력 Ri — Ci 직렬, 귀환 Rf',
    transfer: v => rNeg(rDiv(zR(v.Rf), rAdd(zR(v.Ri), zC(v.Ci)))), direct: (v, w) => cdivc({ re: 0, im: -w * v.Rf * v.Ci }, { re: 1, im: w * v.Ri * v.Ci }),
    formula: 'H(s) = −(Rf/Ri)·sRiCi/(1 + sRiCi), ωc = 1/(RiCi), 고주파 이득 −Rf/Ri', derivation: ['H = −Zf/Zi = −Rf/(Ri + 1/sCi)', '= −(Rf/Ri)·sRiCi/(1 + sRiCi)'] },
  { id: 'noninv-lp', family: 'active', label: '비반전 + RC 저역 (Rf=0이면 버퍼, 연습 14.61a)', fields: ['R', 'C', 'Ri', 'Rf'], topology: 'Vs — R — ●V+ — C — 접지, 비반전 증폭 1 + Rf/Ri',
    transfer: v => rMul(rConst(gain(v)), rDiv(ONE, rAdd(ONE, rMul(S, rConst(v.R * v.C))))), direct: (v, w) => cdivc({ re: gain(v), im: 0 }, { re: 1, im: w * v.R * v.C }),
    formula: 'H(s) = (1 + Rf/Ri)·1/(1 + sRC)', derivation: ['V+ = Vs/(1 + sRC) (분압)', 'Vo = (1 + Rf/Ri)·V+'] },
  { id: 'noninv-hp', family: 'active', label: '비반전 + RC 고역 (연습 14.65 꼴, Rf=0이면 14.61b)', fields: ['R', 'C', 'Ri', 'Rf'], topology: 'Vs — C — ●V+ — R — 접지, 비반전 증폭 1 + Rf/Ri',
    transfer: v => rMul(rConst(gain(v)), rDiv(rMul(S, rConst(v.R * v.C)), rAdd(ONE, rMul(S, rConst(v.R * v.C))))), direct: (v, w) => cdivc({ re: 0, im: gain(v) * w * v.R * v.C }, { re: 1, im: w * v.R * v.C }),
    formula: 'H(s) = (1 + Rf/Ri)·sRC/(1 + sRC), 고주파 이득 1 + Rf/Ri', derivation: ['V+ = Vs·R/(R + 1/sC) = Vs·sRC/(1 + sRC)', 'Vo = (1 + Rf/Ri)·V+', '→ (1 + Rf/Ri)·jωRC/(1 + jωRC)'] },
  { id: 'bpf3', family: 'active', label: '대역통과 3단 (저역 · 고역 · 반전 증폭)', fields: ['R', 'C1', 'C2', 'Ri', 'Rf'], topology: '반전 저역(ω2 = 1/RC2) → 반전 고역(ω1 = 1/RC1) → 반전 증폭(−Rf/Ri)',
    transfer: v => rMul(rConst(-v.Rf / v.Ri), rMul(rDiv(ONE, rAdd(ONE, rMul(S, rConst(v.R * v.C2)))), rDiv(rMul(S, rConst(v.R * v.C1)), rAdd(ONE, rMul(S, rConst(v.R * v.C1)))))),
    direct: (v, w) => cmulc(cdivc({ re: -v.Rf / v.Ri, im: 0 }, { re: 1, im: w * v.R * v.C2 }), cdivc({ re: 0, im: w * v.R * v.C1 }, { re: 1, im: w * v.R * v.C1 })),
    formula: 'H(s) = −(Rf/Ri)·[1/(1 + s/ω2)]·[(s/ω1)/(1 + s/ω1)], ω0 = √(ω1ω2), |H(ω0)| = (Rf/Ri)·ω2/(ω1 + ω2)',
    derivation: ['세 단의 곱 (−)(−)(−) = −', 'ω1 = 1/(RC1) < ω2 = 1/(RC2) 이어야 통과대역이 생김'] },
  { id: 'bsf', family: 'active', label: '대역차단 (저역 ∥ 고역 + 가산 증폭)', fields: ['R', 'C1', 'C2', 'Ri', 'Rf'], topology: '저역(ω1 = 1/RC1)과 고역(ω2 = 1/RC2)을 나란히 두고 가산 증폭(Rf/Ri)',
    transfer: v => rMul(rConst(v.Rf / v.Ri), rAdd(rDiv(ONE, rAdd(ONE, rMul(S, rConst(v.R * v.C1)))), rDiv(rMul(S, rConst(v.R * v.C2)), rAdd(ONE, rMul(S, rConst(v.R * v.C2)))))),
    direct: (v, w) => {
      const a = cdivc({ re: 1, im: 0 }, { re: 1, im: w * v.R * v.C1 }), b = cdivc({ re: 0, im: w * v.R * v.C2 }, { re: 1, im: w * v.R * v.C2 });
      return { re: v.Rf / v.Ri * (a.re + b.re), im: v.Rf / v.Ri * (a.im + b.im) };
    },
    formula: 'H(s) = (Rf/Ri)·[1/(1 + s/ω1) + (s/ω2)/(1 + s/ω2)], 통과 이득 Rf/Ri, |H(ω0)| = (Rf/Ri)·2ω1/(ω1 + ω2)',
    derivation: ['저역 단과 고역 단의 합 (각 단 반전, 가산기 반전 → 부호 +)', 'ω1 = 1/(RC1) < ω2 = 1/(RC2) 이어야 차단대역이 생김'] }
]);
function cdivc(a, b) { const d = b.re * b.re + b.im * b.im; return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d }; }
function cmulc(a, b) { return { re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re }; }
export const filterCircuit = id => FILTER_CIRCUITS.find(c => c.id === id) ?? null;

/** { h (rational), at(ω) direct complex value } for a catalog circuit with element values v. */
export function buildFilter(circuit, v) {
  for (const key of circuit.fields) if (!(Number.isFinite(v[key]) && v[key] > 0) && !(key === 'Rf' && circuit.id.startsWith('noninv') && v[key] === 0)) throw new RangeError(key + '는 0보다 큰 값이어야 합니다.');
  if (circuit.steps) { const steps = circuit.steps(v); return { h: reduceRational(ladderTransfer(steps)), at: w => ladderAt(steps, w) }; }
  return { h: reduceRational(circuit.transfer(v)), at: w => circuit.direct(v, w) };
}

// ---- scaling ------------------------------------------------------------------------------------------------------------------------
/** Magnitude Km and frequency Kf: R' = Km·R, L' = (Km/Kf)·L, C' = C/(Km·Kf). */
export function scaleElement(kind, value, Km, Kf) {
  if (kind === 'R') return Km * value;
  if (kind === 'L') return Km / Kf * value;
  return value / (Km * Kf);
}
// The two scaling circuits: elements in ladder order (series/shunt, kind, value) and the ω at which the base circuit is read (ω0 or the cutoff).
export const SCALING_BASES = Object.freeze({
  rlc: { label: '직렬 RLC (출력 R)', elements: v => [['series', 'L', 'L', v.L0], ['series', 'C', 'C', v.C0], ['shunt', 'R', 'R', v.R0]], refR: v => v.R0, refW: v => 1 / Math.sqrt(v.L0 * v.C0) },
  butter: { label: '4차 Butterworth 사다리 (예제 14.14 정규형)',
    elements: () => [['series', 'Rs', 'R', 1], ['shunt', 'C1', 'C', 0.765], ['series', 'L2', 'L', 1.848], ['shunt', 'C3', 'C', 1.848], ['series', 'L4', 'L', 0.765], ['shunt', 'RL', 'R', 1]],
    refR: () => 1, refW: () => 1 }
});
const element = (kind, value) => (kind === 'R' ? R_(value) : kind === 'L' ? L_(value) : C_(value));
export function scaledLadder(elements, Km, Kf) {
  const scaled = elements.map(([at, name, kind, value]) => ({ at, name, kind, value, scaled: scaleElement(kind, value, Km, Kf) }));
  const steps = list => list.map(e => step(e.at, element(e.kind, e.v)));
  const before = steps(scaled.map(e => ({ ...e, v: e.value }))), after = steps(scaled.map(e => ({ ...e, v: e.scaled })));
  return { elements: scaled, before: { h: reduceRational(ladderTransfer(before)), at: w => ladderAt(before, w) }, after: { h: reduceRational(ladderTransfer(after)), at: w => ladderAt(after, w) } };
}
