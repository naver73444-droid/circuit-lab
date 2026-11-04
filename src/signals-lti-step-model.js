// Second-order unit-step response (pure): y'' + a1 y' + a0 y = b0 u(t) with initial values y(0) = y0, y'(0) = dy0.
//   complete response y = y_p + y_h, y_p = q = b0/a0; the zero-state (initially relaxed) step response s(t) and h(t) = ds/dt.
// Closed forms only (no ODE parser or numerical integrator). Two fixed presets: Review p9 (over-damped) and Ex 2.19 (series RLC).
// The lti lesson delegates its ode2-* examples here; this module never imports the lti model.
import { formatNumber, niceTicks, sampleCurve } from './signals-util.js';

export const ODE2_PRESETS = {
  'ode2-review': { a1: 3, a0: 2, b0: 1, y0: 3, dy0: 0, tMax: 6, cursorInitial: 1, unit: '', hRange: [-0.05, 0.3] },
  'ode2-rlc': { a1: 2, a0: 26, b0: 26, y0: 0, dy0: 0, tMax: 5, cursorInitial: 0.3, unit: 'V', hRange: [-2.5, 4.5] },
};
export const ODE2_FAMILIES = [
  { value: 'ode2-review', label: '2차 계단응답 · 복습 p9' },
  { value: 'ode2-rlc', label: 'RLC 계단응답과 h · Ex 2.19' },
];
export const isOde2Family = (family) => Object.hasOwn(ODE2_PRESETS, family);

const presetOf = (family) => {
  if (!isOde2Family(family)) throw new RangeError('지원하지 않는 2차 응답 예시입니다.');
  return ODE2_PRESETS[family];
};
const finite = (v) => typeof v === 'number' && Number.isFinite(v);

// Homogeneous solution f with f(0) = z0, f'(0) = v0 of f'' + a1 f' + a0 f = 0.
function homogeneous(a1, a0, z0, v0) {
  const disc = a1 * a1 - 4 * a0;
  if (Math.abs(disc) <= 1e-10 * Math.max(1, a1 * a1, 4 * a0)) {
    const r = -a1 / 2;
    const c1 = z0;
    const c2 = v0 - r * z0;
    return {
      kind: 'critical', roots: [[r, 0], [r, 0]], coeffs: [c1, c2],
      f: (t) => (c1 + c2 * t) * Math.exp(r * t),
      df: (t) => (c2 + r * (c1 + c2 * t)) * Math.exp(r * t),
    };
  }
  if (disc > 0) {
    const root = Math.sqrt(disc);
    const r1 = (-a1 + root) / 2;
    const r2 = (-a1 - root) / 2;
    const c1 = (v0 - r2 * z0) / (r1 - r2);
    const c2 = z0 - c1;
    return {
      kind: 'over', roots: [[r1, 0], [r2, 0]], coeffs: [c1, c2],
      f: (t) => c1 * Math.exp(r1 * t) + c2 * Math.exp(r2 * t),
      df: (t) => c1 * r1 * Math.exp(r1 * t) + c2 * r2 * Math.exp(r2 * t),
    };
  }
  const sigma = -a1 / 2;
  const beta = Math.sqrt(-disc) / 2;
  const d1 = z0;
  const d2 = (v0 - sigma * z0) / beta;
  return {
    kind: 'under', roots: [[sigma, beta], [sigma, -beta]], coeffs: [d1, d2],
    f: (t) => Math.exp(sigma * t) * (d1 * Math.cos(beta * t) + d2 * Math.sin(beta * t)),
    df: (t) => Math.exp(sigma * t) * ((sigma * d1 + beta * d2) * Math.cos(beta * t) + (sigma * d2 - beta * d1) * Math.sin(beta * t)),
  };
}

// y, dy only for t >= 0 (null before: no history is given); s, h are 0 for t <= 0 (s(0) = h(0) = 0, both continuous there).
export function secondOrderStep({ a1, a0, b0, y0 = 0, dy0 = 0 }) {
  if (![a1, a0, b0, y0, dy0].every(finite)) throw new RangeError('2차 계수와 초기값은 유한한 수여야 합니다.');
  if (a1 <= 0 || a1 > 1000 || a0 <= 0 || a0 > 1000 || b0 < 0 || b0 > 1000) throw new RangeError('계수 범위: 0<a₁, a₀≤1000, 0≤b₀≤1000 입니다.');
  if (Math.abs(y0) > 100 || Math.abs(dy0) > 100) throw new RangeError('초기값 범위: |y₀|, |dy₀|≤100 입니다.');
  const q = b0 / a0;
  const full = homogeneous(a1, a0, y0 - q, dy0);
  const rest = homogeneous(a1, a0, -q, 0);
  return {
    kind: full.kind, roots: full.roots, coeffs: full.coeffs, steady: q, relaxedCoeffs: rest.coeffs,
    y: (t) => (t >= 0 ? q + full.f(t) : null),
    dy: (t) => (t >= 0 ? full.df(t) : null),
    s: (t) => (t > 0 ? q + rest.f(t) : 0),
    h: (t) => (t > 0 ? rest.df(t) : 0),
  };
}

// ---------------------------------------------------------------- lesson pieces
const num = (v) => formatNumber(v, 4);
const read5 = (v) => formatNumber(v, 5);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const paramsOf = (family, params = {}) => {
  const p = presetOf(family);
  return { ...p, y0: finite(params.y0) ? params.y0 : p.y0, dy0: finite(params.dy0) ? params.dy0 : p.dy0 };
};
const solve = (family, params) => secondOrderStep(paramsOf(family, params));

export function ode2Controls(family) {
  const p = presetOf(family);
  const per = p.unit ? `${p.unit}/s` : '1/s';
  return [
    { key: 'y0', label: 'y(0) 초기값', min: -5, max: 5, step: 0.5, initial: p.y0, unit: p.unit },
    { key: 'dy0', label: 'y′(0) 초기 기울기', min: -5, max: 5, step: 0.5, initial: p.dy0, unit: per },
  ];
}

export function ode2Cursor(family) {
  const p = presetOf(family);
  return { min: 0, max: p.tMax, step: 0.01, initial: p.cursorInitial, unit: 's', symbol: 't', discrete: false };
}

// Tangent of s at the cursor: a fixed 0.25 s long piece (never zero length at Home/End), slope h(cursor).
export function ode2Tangent(family, params, cursor) {
  const { tMax } = presetOf(family);
  const sol = solve(family, params);
  const c = clamp(cursor, 0, tMax);
  const t1 = clamp(c - 0.125, 0, tMax - 0.25);
  const t2 = t1 + 0.25;
  const at = (t) => sol.s(c) + sol.h(c) * (t - c);
  return { x1: t1, y1: at(t1), x2: t2, y2: at(t2) };
}

export function ode2Frame(family, params = {}, cursor = 0) {
  const p = paramsOf(family, params);
  const sol = secondOrderStep(p);
  const c = clamp(cursor, 0, p.tMax);
  const relaxed = p.y0 === 0 && p.dy0 === 0;
  const xTicks = niceTicks(0, p.tMax, 6);
  const probe = Array.from({ length: 121 }, (_, i) => (p.tMax * i) / 120).flatMap((t) => [sol.y(t), sol.s(t)]);
  const lo = Math.min(0, ...probe);
  const hi = Math.max(sol.steady, ...probe);
  const pad = Math.max(hi - lo, 1e-9) * 0.12;
  const tangent = ode2Tangent(family, params, c);
  const top = [{ cls: 'c1', pts: sampleCurve(sol.y, 0, p.tMax, 600) }];
  if (!relaxed) top.push({ cls: 'cm dash', pts: sampleCurve(sol.s, 0, p.tMax, 600) });
  const unit = p.unit ? ` ${p.unit}` : '';
  return {
    panes: [
      { title: `y(t) 완전응답 · yₚ=${num(sol.steady)}${unit} · 접선은 s 위`, x: [0, p.tMax], y: [lo - pad, hi + pad], xTicks,
        lines: top, hlines: [{ cls: 'c5 dash', y: sol.steady }],
        segments: [{ cls: 'c4', ...tangent }], dots: [{ cls: 'c4', x: c, y: sol.s(c) }] },
      { title: 'h(t)=ds/dt 임펄스응답 (s의 기울기)', x: [0, p.tMax], y: p.hRange, xTicks,
        lines: [{ cls: 'c2', pts: sampleCurve(sol.h, 0, p.tMax, 600) }],
        dots: [{ cls: 'c4', x: c, y: sol.h(c) }], vlines: [{ cls: 'c4 dash', x: c }] },
    ],
    legend: [
      { cls: 'c1', text: relaxed ? 'y(t)=s(t) (초기값 0)' : 'y(t) 완전응답' },
      { cls: 'c5 dash', text: 'yₚ=b₀/a₀ 정상값' },
      ...(relaxed ? [] : [{ cls: 'cm dash', text: 's(t) 초기 이완 계단응답' }]),
      { cls: 'c4', text: `초기 이완 s의 접선 (기울기 h=${num(sol.h(c))})` },
      { cls: 'c2', text: 'h(t)=ds/dt' },
    ],
  };
}

const rootsText = (sol) => (sol.kind === 'under'
  ? `s=${num(sol.roots[0][0])}±j${num(sol.roots[0][1])}`
  : sol.kind === 'critical' ? `s=${num(sol.roots[0][0])} (중근)` : `s=${num(sol.roots[0][0])}, ${num(sol.roots[1][0])}`);
const KIND_TEXT = { over: '과감쇠', critical: '임계감쇠', under: '부족감쇠' };

export function ode2Describe(family, params = {}, cursor = 0) {
  const p = paramsOf(family, params);
  const sol = secondOrderStep(p);
  const t = clamp(cursor, 0, p.tMax);
  const [k1, k2] = sol.coeffs;
  const names = sol.kind === 'under' ? ['d₁', 'd₂'] : ['c₁', 'c₂'];
  const y = sol.y(t);
  return `${KIND_TEXT[sol.kind]} ${rootsText(sol)} · ${names[0]}=${num(k1)}, ${names[1]}=${num(k2)} · t=${num(t)} s: y=${read5(y)}, yₕ=y−yₚ=${read5(y - sol.steady)}, s=${read5(sol.s(t))}, h=${read5(sol.h(t))}`;
}

export function ode2Read(family) {
  presetOf(family);
  if (family === 'ode2-review') return '초기값을 바꾸면 완전응답 y만 달라지고 초기 이완 계단응답 s와 h=ds/dt는 그대로입니다. 접선은 s 위에 있고 기울기가 h입니다.';
  return '직렬 RLC(R=2 Ω, L=1 H, C=1/26 F)의 계단응답은 부족감쇠로 1 V 둘레를 진동합니다. h=ds/dt는 s의 접선 기울기이고 t=0에서 0입니다.';
}

// ---- formula text: every line must parse as math (no Korean, ';' separates lines)
const coefText = (v, first = false) => {
  const sign = v < 0 ? '−' : first ? '' : '+';
  return `${sign}${num(Math.abs(v))}`;
};
// a·sym with a = ±1 written as ±sym
const termText = (a, sym, first = false) => {
  if (Math.abs(a) < 1e-12) return '';
  const sign = a < 0 ? '−' : first ? '' : '+';
  const mag = Math.abs(Math.abs(a) - 1) < 1e-12 ? '' : num(Math.abs(a));
  return `${sign}${mag}${sym}`;
};
const expText = (r) => (Math.abs(r) < 1e-12 ? '' : `e^(${termText(r, 't', true)})`);
// q + sum of c_i e^(r_i t) (over), q + (c1 + c2 t) e^(rt) (critical) or q + e^(sigma t)[d1 cos(beta t) + d2 sin(beta t)] (under)
function solutionText(kind, roots, [k1, k2], q) {
  const lead = Math.abs(q) < 1e-12 ? '' : num(q);
  if (kind === 'over') {
    let text = lead;
    for (const [k, r] of [[k1, roots[0][0]], [k2, roots[1][0]]]) text += termText(k, expText(r), !text);
    return text || '0';
  }
  const e = expText(roots[0][0]);
  if (kind === 'critical') return `${lead}${lead ? '+' : ''}(${num(k1)}${coefText(k2)}t)${e}`;
  const beta = num(roots[0][1]);
  const terms = [[k1, `cos(${beta}t)`], [k2, `sin(${beta}t)`]].filter(([k]) => Math.abs(k) > 1e-9);
  if (!terms.length) return lead || '0';
  if (terms.length === 1) return `${lead}${termText(terms[0][0], `${e}${terms[0][1]}`, !lead)}`;
  const sign = k1 < 0 ? -1 : 1; // 1−e^(−t)[cos(5t)+0.2sin(5t)] rather than 1+e^(−t)[−cos(5t)−0.2sin(5t)]
  return `${lead}${sign < 0 ? '−' : lead ? '+' : ''}${e}[${termText(sign * k1, terms[0][1], true)}${termText(sign * k2, terms[1][1])}]`;
}
// h = s' written from the derivative coefficients of the relaxed solution
function impulseText(kind, roots, [k1, k2]) {
  if (kind === 'over') {
    const [r1, r2] = [roots[0][0], roots[1][0]];
    return solutionText('over', roots, [k1 * r1, k2 * r2], 0);
  }
  if (kind === 'critical') {
    const r = roots[0][0];
    return solutionText('critical', roots, [k2 + r * k1, r * k2], 0);
  }
  const [sigma, beta] = roots[0];
  return solutionText('under', roots, [sigma * k1 + beta * k2, sigma * k2 - beta * k1], 0);
}

export function ode2Formula(family, params = {}) {
  const p = paramsOf(family, params);
  const sol = secondOrderStep(p);
  const q = sol.steady;
  const z0 = p.y0 - q;
  const lines = [
    'y″+a₁y′+a₀y=b₀x(t), x(t)=u(t)',
    `y″${termText(p.a1, 'y′')}${termText(p.a0, 'y')}=${termText(p.b0, 'u(t)', true)}`,
    `s²${termText(p.a1, 's')}${coefText(p.a0)}=0, ${rootsText(sol)}`,
    `y=yₕ+yₚ, yₚ=b₀/a₀=${num(q)}`,
  ];
  if (sol.kind === 'over') {
    const [r1, r2] = [sol.roots[0][0], sol.roots[1][0]];
    lines.push('y=yₚ+c₁e^(r₁t)+c₂e^(r₂t)');
    lines.push(`c₁+c₂=${num(p.y0)}−${num(q)}=${num(z0)}`);
    lines.push(`${termText(r1, 'c₁', true)}${termText(r2, 'c₂')}=${num(p.dy0)}`);
    lines.push(`c₁=${num(sol.coeffs[0])},c₂=${num(sol.coeffs[1])}`);
  } else if (sol.kind === 'critical') {
    lines.push('y=yₚ+(c₁+c₂t)e^(rt)');
    lines.push(`c₁=y(0)−yₚ=${num(z0)}, c₂=y′(0)−rc₁=${num(sol.coeffs[1])}`);
  } else {
    lines.push('y=yₚ+e^(σt)[d₁cos(βt)+d₂sin(βt)]');
    lines.push(`d₁=y(0)−yₚ=${num(z0)}, d₂=(y′(0)−σd₁)/β=${num(sol.coeffs[1])}`);
  }
  lines.push(`y(t)=${solutionText(sol.kind, sol.roots, sol.coeffs, q)}`);
  lines.push(`s(t)=${solutionText(sol.kind, sol.roots, sol.relaxedCoeffs, q)}`);
  lines.push(`h(t)=ds/dt=${impulseText(sol.kind, sol.roots, sol.relaxedCoeffs)}`);
  return lines.join('; ');
}
