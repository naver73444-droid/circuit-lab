// Ch.14 transfer functions: polynomial / rational arithmetic in s, an expression parser (no eval), roots, the textbook standard form
// (K · (jω)^N · Π(1 + jω/z) · Π quadratic … / …), the exact H(jω) and the straight-line Bode approximation of Table 14.3. Pure, no DOM.
// Polynomials are arrays of real coefficients in ascending powers: [a0, a1, a2] = a0 + a1·s + a2·s².

export const MAX_DEGREE = 12;

// ---- polynomials --------------------------------------------------------------------------------------------------------------
// Coefficients of different powers of s carry different units (a circuit scaled to 50 kHz has s⁴ terms near 1e-22), so nothing is
// trimmed by size relative to the others: only exact zeros go, and polyAdd zeroes a sum that cancels to rounding noise of its own terms.
export function trimPoly(p) {
  let n = p.length;
  while (n > 1 && p[n - 1] === 0) n--;
  return p.slice(0, n);
}
export const degree = p => trimPoly(p).length - 1;
export const isZeroPoly = p => trimPoly(p).every(c => c === 0);
export function polyAdd(a, b) {
  const out = new Array(Math.max(a.length, b.length)).fill(0);
  a.forEach((c, i) => { out[i] += c; });
  b.forEach((c, i) => { out[i] += c; });
  for (let i = 0; i < out.length; i++) if (Math.abs(out[i]) <= 1e-13 * (Math.abs(a[i] ?? 0) + Math.abs(b[i] ?? 0))) out[i] = 0;
  return trimPoly(out);
}
export const polyScale = (a, k) => trimPoly(a.map(c => c * k));
export function polyMul(a, b) {
  const out = new Array(a.length + b.length - 1).fill(0);
  a.forEach((x, i) => b.forEach((y, j) => { out[i + j] += x * y; }));
  return trimPoly(out);
}
/** p(s) at a complex s = { re, im } (Horner). */
export function polyAt(p, s) {
  let re = 0, im = 0;
  for (let i = p.length - 1; i >= 0; i--) { const r = re * s.re - im * s.im + p[i], m = re * s.im + im * s.re; re = r; im = m; }
  return { re, im };
}

// ---- rational functions { num, den } -----------------------------------------------------------------------------------------
export const rational = (num, den = [1]) => ({ num: trimPoly(num), den: trimPoly(den) });
export const rAdd = (a, b) => rational(polyAdd(polyMul(a.num, b.den), polyMul(b.num, a.den)), polyMul(a.den, b.den));
export const rNeg = a => rational(polyScale(a.num, -1), a.den);
export const rSub = (a, b) => rAdd(a, rNeg(b));
export const rMul = (a, b) => rational(polyMul(a.num, b.num), polyMul(a.den, b.den));
export function rDiv(a, b) {
  if (isZeroPoly(b.num)) throw new RangeError('0으로 나누는 항이 있습니다.');
  return rational(polyMul(a.num, b.den), polyMul(a.den, b.num));
}
export function rPow(a, n) {
  let out = rational([1]);
  for (let i = 0; i < Math.abs(n); i++) out = rMul(out, a);
  return n < 0 ? rDiv(rational([1]), out) : out;
}
/** Parallel combination of two impedances: Z1·Z2/(Z1+Z2). */
export const rParallel = (a, b) => rDiv(rMul(a, b), rAdd(a, b));
export const rConst = k => rational([k]);
export const S = rational([0, 1]);
/** Leading coefficients normalized so the denominator's lowest nonzero coefficient is 1 (only for printing; the value is unchanged). */
export function normalizeRational(r) {
  const k = r.den.find(c => c !== 0) ?? 1;
  return rational(r.num.map(c => c / k), r.den.map(c => c / k));
}

// ---- parser ---------------------------------------------------------------------------------------------------------------------
// Accepts s, jω, jw (and j*ω), numbers with e-notation, + − × · * / ÷ ^ (integer exponent), parentheses and implicit products
// such as 200s, s(s+2), (s+1)(s+3), 2.533e-4s. A bare ω (without j) is rejected because H is written in s or jω.
function tokenize(text) {
  const src = String(text).replace(/[−–]/g, '-').replace(/[×·]/g, '*').replace(/÷/g, '/').replace(/\s+/g, '').replace(/j\*?[ωw]/g, 's');
  if (!src) throw new RangeError('전달함수 식을 입력하세요. 예: 200s/((s+2)(s+10))');
  const tokens = [];
  for (let i = 0; i < src.length;) {
    const rest = src.slice(i), number = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(rest);
    if (number) { tokens.push({ t: 'n', v: Number(number[0]) }); i += number[0].length; continue; }
    const c = src[i];
    if (c === 's') tokens.push({ t: 's' });
    else if ('+-*/^()'.includes(c)) tokens.push({ t: c });
    else if (c === 'ω' || c === 'w') throw new RangeError('ω 앞에 j를 붙이거나 s를 쓰세요 (H는 jω 또는 s의 식). 위치 ' + (i + 1));
    else throw new RangeError('읽을 수 없는 글자 "' + c + '" (위치 ' + (i + 1) + '). 숫자, s 또는 jω, + − * / ^ ( )만 씁니다.');
    i++;
  }
  return tokens;
}

export function parseTransfer(text) {
  const tokens = tokenize(text);
  let pos = 0;
  const peek = () => tokens[pos]?.t, take = () => tokens[pos++];
  const startsFactor = t => t === 'n' || t === 's' || t === '(';
  function expr() {
    let left = term();
    while (peek() === '+' || peek() === '-') { const op = take().t, right = term(); left = op === '+' ? rAdd(left, right) : rSub(left, right); }
    return left;
  }
  function term() {
    let left = unary();
    for (;;) {
      if (peek() === '*') { take(); left = rMul(left, unary()); }
      else if (peek() === '/') { take(); left = rDiv(left, unary()); }
      else if (startsFactor(peek())) left = rMul(left, power()); // implicit product: 200s, s(s+2), (s+1)(s+2)
      else return left;
    }
  }
  function unary() {
    if (peek() === '-') { take(); return rNeg(unary()); }
    if (peek() === '+') { take(); return unary(); }
    return power();
  }
  function power() {
    const base = atom();
    if (peek() !== '^') return base;
    take();
    let sign = 1;
    if (peek() === '-') { take(); sign = -1; }
    const e = take();
    if (e?.t !== 'n' || !Number.isInteger(e.v) || e.v > MAX_DEGREE) throw new RangeError('^ 뒤에는 0~' + MAX_DEGREE + ' 정수 지수만 씁니다.');
    return rPow(base, sign * e.v);
  }
  function atom() {
    const tok = take();
    if (!tok) throw new RangeError('식이 끝났습니다. 빠진 숫자나 괄호가 있는지 확인하세요.');
    if (tok.t === 'n') return rConst(tok.v);
    if (tok.t === 's') return S;
    if (tok.t === '(') {
      const inside = expr();
      if (take()?.t !== ')') throw new RangeError('괄호 짝이 맞지 않습니다.');
      return inside;
    }
    throw new RangeError('"' + tok.t + '" 자리에 숫자, s 또는 괄호가 와야 합니다.');
  }
  const out = expr();
  if (pos < tokens.length) throw new RangeError(tokens[pos].t === ')' ? '괄호 짝이 맞지 않습니다.' : '식의 "' + tokens[pos].t + '" 부분을 읽을 수 없습니다.');
  if (isZeroPoly(out.num)) throw new RangeError('H(s)가 0입니다.');
  if (degree(out.num) > MAX_DEGREE || degree(out.den) > MAX_DEGREE) throw new RangeError('분자·분모 차수는 ' + MAX_DEGREE + ' 이하여야 합니다.');
  if (out.num.some(c => !Number.isFinite(c)) || out.den.some(c => !Number.isFinite(c))) throw new RangeError('계수가 표현 범위를 벗어났습니다.');
  return out;
}

// ---- roots ----------------------------------------------------------------------------------------------------------------------
const cmul = (a, b) => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re });
const cdiv = (a, b) => { const d = b.re * b.re + b.im * b.im; return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d }; };
const csub = (a, b) => ({ re: a.re - b.re, im: a.im - b.im });
const cabs = a => Math.hypot(a.re, a.im);

/** All complex roots of a polynomial with p[0] ≠ 0 (Aberth–Ehrlich iteration on the monic polynomial). */
function polyRoots(p) {
  const n = p.length - 1;
  if (n < 1) return [];
  if (n === 1) return [{ re: -p[0] / p[1], im: 0 }];
  const monic = p.map(c => c / p[n]), deriv = monic.slice(1).map((c, i) => c * (i + 1));
  // Starting circle from the Cauchy bound, slightly rotated so no start sits on the real axis.
  const radius = Math.max(...monic.slice(0, n).map((c, i) => Math.abs(c) ** (1 / (n - i)))) || 1;
  let z = Array.from({ length: n }, (_, k) => ({ re: radius * Math.cos(2 * Math.PI * k / n + 0.4), im: radius * Math.sin(2 * Math.PI * k / n + 0.4) }));
  for (let iter = 0; iter < 500; iter++) {
    let moved = 0;
    z = z.map((zk, k) => {
      const f = polyAt(monic, zk), df = polyAt(deriv, zk);
      if (cabs(f) === 0) return zk;
      const ratio = cdiv(f, df);
      let sum = { re: 0, im: 0 };
      z.forEach((zj, j) => { if (j !== k) { const d = csub(zk, zj); sum = { re: sum.re + d.re / (d.re * d.re + d.im * d.im), im: sum.im - d.im / (d.re * d.re + d.im * d.im) }; } });
      const step = cdiv(ratio, csub({ re: 1, im: 0 }, cmul(ratio, sum)));
      moved = Math.max(moved, cabs(step) / Math.max(cabs(zk), 1e-300));
      return csub(zk, step);
    });
    if (moved < 1e-15) break;
  }
  return z;
}

/**
 * Roots grouped by value: [{ root: {re, im}, mult }]; origin roots come back as root 0. Repeated roots come out of the iteration spread
 * by about ε^(1/m), so roots within a relative 3e-4 of a group's mean are merged; a lone root with |im| ≤ 1e-7·|root| (a merged one:
 * 3e-4) is taken as real. Coursework never has distinct roots that close.
 */
export function rootsOf(p) {
  const poly = trimPoly(p);
  let origin = 0;
  while (origin < poly.length - 1 && poly[origin] === 0) origin++;
  const rest = poly.slice(origin);
  const groups = [];
  for (const r of polyRoots(rest)) {
    const g = groups.find(x => cabs(csub({ re: x.sum.re / x.mult, im: x.sum.im / x.mult }, r)) <= 3e-4 * Math.max(cabs(r), 1e-300));
    if (g) { g.sum = { re: g.sum.re + r.re, im: g.sum.im + r.im }; g.mult++; } else groups.push({ sum: { ...r }, mult: 1 });
  }
  const base = rest, derivative = q => q.slice(1).map((c, i) => c * (i + 1));
  const out = groups.map(g => {
    let root = { re: g.sum.re / g.mult, im: g.sum.im / g.mult };
    // A root of multiplicity m is a simple root of the (m−1)-th derivative: a few Newton steps there recover the digits lost in the spread.
    if (g.mult > 1) {
      let q = base;
      for (let i = 1; i < g.mult; i++) q = derivative(q);
      const dq = derivative(q);
      for (let i = 0; i < 8; i++) { const d = polyAt(dq, root); if (cabs(d) === 0) break; const next = csub(root, cdiv(polyAt(q, root), d)); if (!Number.isFinite(next.re + next.im)) break; root = next; }
    }
    return { root: Math.abs(root.im) <= (g.mult > 1 ? 3e-4 : 1e-7) * cabs(root) ? { re: root.re, im: 0 } : root, mult: g.mult };
  });
  if (origin) out.unshift({ root: { re: 0, im: 0 }, mult: origin });
  return out;
}

// ---- standard form and Bode terms ------------------------------------------------------------------------------------------------
// term: { kind: 'origin' | 'single' | 'quad', side: +1 zero / −1 pole, mult, corner (|root| or ωn), zeta (quad), root, lhp (root in the left half) }
function termsOf(groups, side) {
  const terms = [];
  for (const { root, mult } of groups) {
    const m = cabs(root);
    if (m === 0) terms.push({ kind: 'origin', side, mult, corner: 1, root });
    else if (root.im === 0) terms.push({ kind: 'single', side, mult, corner: m, root, lhp: root.re < 0 });
    else if (root.im > 0) terms.push({ kind: 'quad', side, mult, corner: m, zeta: -root.re / m, root, lhp: root.re < 0 });
  }
  return terms;
}
/** Removes roots common to numerator and denominator (a pole–zero cancellation); returns the cancelled ones for a note. */
function cancel(zeros, poles) {
  const cancelled = [];
  for (const z of zeros) for (const p of poles) {
    const close = cabs(csub(z.root, p.root)) <= 1e-6 * Math.max(cabs(z.root), 1e-9) || (cabs(z.root) === 0 && cabs(p.root) === 0);
    if (!close || !z.mult || !p.mult) continue;
    const n = Math.min(z.mult, p.mult);
    z.mult -= n; p.mult -= n; cancelled.push({ root: z.root, mult: n });
  }
  return { zeros: zeros.filter(z => z.mult), poles: poles.filter(p => p.mult), cancelled };
}

/**
 * The same H with common factors removed: a shared s^k, and any root shared by numerator and denominator (rebuilt from the remaining
 * roots with the original leading coefficients). Circuit algebra (chain matrices, Z1∥Z2) leaves such factors behind; H(0), H(∞) and
 * the order must be read after removing them.
 */
export function reduceRational(h) {
  let num = trimPoly(h.num), den = trimPoly(h.den);
  while (num.length > 1 && den.length > 1 && num[0] === 0 && den[0] === 0) { num = num.slice(1); den = den.slice(1); }
  const c = cancel(rootsOf(num), rootsOf(den));
  if (!c.cancelled.length) return rational(num, den);
  const build = (groups, lead) => {
    let p = [lead];
    for (const { root, mult } of groups) for (let i = 0; i < mult; i++) {
      if (root.im === 0) p = polyMul(p, [-root.re, 1]);
      else if (root.im > 0) p = polyMul(p, [root.re * root.re + root.im * root.im, -2 * root.re, 1]);
    }
    return p;
  };
  return rational(build(c.zeros, num[num.length - 1]), build(c.poles, den[den.length - 1]));
}

const log10 = Math.log10;
const DEG = 180 / Math.PI;

/**
 * The whole Ch.14 reading of H(s) = num/den: { K, terms, origin (net count: zeros − poles at s = 0), zeros, poles, cancelled,
 * magDb(ω), phaseDeg(ω), approxDb(ω), approxPhase(ω), at(ω) → complex, corners, range }.
 */
export function analyzeTransfer(h) {
  const num = trimPoly(h.num), den = trimPoly(h.den);
  if (isZeroPoly(den)) throw new RangeError('분모가 0입니다.');
  const c = cancel(rootsOf(num), rootsOf(den));
  const terms = [...termsOf(c.zeros, +1), ...termsOf(c.poles, -1)].sort((x, y) => x.corner - y.corner);
  const lowest = p => { let i = 0; while (i < p.length - 1 && p[i] === 0) i++; return { i, c: p[i] }; };
  const ln = lowest(num), ld = lowest(den);
  // K: the gain left when every factor is written as (1 + s/p) or (1 + 2ζs/ωn + s²/ωn²); cancelled roots cancel in this ratio as well.
  // A cancelled root r appears as −r·(1 − s/r) on both sides, so the ratio is unchanged.
  const K = ln.c / ld.c;
  const origin = ln.i - ld.i;
  const at = w => cdiv(polyAt(num, { re: 0, im: w }), polyAt(den, { re: 0, im: w }));
  const magDb = w => 20 * log10(cabs(at(w)));
  // Continuous phase: the sum of the factor phases (each continuous in ω), not atan2 of the whole value (which jumps by 360°).
  function phaseDeg(w) {
    let ph = (K < 0 ? 180 : 0) + 90 * origin;
    for (const t of terms) {
      if (t.kind === 'origin') continue;
      let p;
      if (t.kind === 'single') p = Math.atan2(-w / t.root.re, 1) * DEG; // factor (1 − jω/r)
      else { const u = w / t.corner; p = Math.atan2(2 * t.zeta * u, 1 - u * u) * DEG; if (t.zeta === 0 && u > 1) p = 180; }
      ph += t.side * t.mult * p;
    }
    return ph;
  }
  function approxDb(w) {
    let db = 20 * log10(Math.abs(K)) + 20 * origin * log10(w);
    for (const t of terms) {
      if (t.kind === 'origin' || w <= t.corner) continue;
      db += t.side * t.mult * (t.kind === 'single' ? 20 : 40) * log10(w / t.corner);
    }
    return db;
  }
  function approxPhase(w) {
    let ph = (K < 0 ? 180 : 0) + 90 * origin;
    for (const t of terms) {
      if (t.kind === 'origin') continue;
      const full = t.kind === 'single' ? 90 : 180, dir = t.kind === 'single' ? (t.lhp ? 1 : -1) : (t.zeta >= 0 ? 1 : -1);
      const x = log10(w / t.corner); // −1 … +1 is the two-decade ramp
      const frac = x <= -1 ? 0 : x >= 1 ? 1 : (x + 1) / 2;
      ph += t.side * t.mult * dir * full * frac;
    }
    return ph;
  }
  const corners = [...new Set(terms.filter(t => t.kind !== 'origin').map(t => t.corner))].sort((a, b) => a - b);
  const lo = corners.length ? 10 ** (Math.floor(log10(corners[0])) - 1) : 0.1, hi = corners.length ? 10 ** (Math.ceil(log10(corners[corners.length - 1])) + 1) : 10;
  return { num, den, K, origin, terms, zeros: c.zeros, poles: c.poles, cancelled: c.cancelled, at, magDb, phaseDeg, approxDb, approxPhase, corners, range: [lo, hi] };
}

// ---- text -------------------------------------------------------------------------------------------------------------------------
const g4 = n => Number(n.toPrecision(4)).toString();
const SUP = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹'];
const supText = m => String(m).split('').map(d => SUP[d]).join('');
const powText = (base, m) => (m === 1 ? base : (base.startsWith('(') ? base : '(' + base + ')') + supText(m));
const over = c => (Math.abs(c - 1) < 1e-9 ? 'jω' : 'jω/' + g4(c));
function factorText(t) {
  if (t.kind === 'origin') return powText('jω', t.mult);
  if (t.kind === 'single') return powText('(1 ' + (t.lhp ? '+' : '−') + ' ' + over(t.corner) + ')', t.mult);
  return powText('(1 + j2·' + g4(t.zeta) + '·' + over(t.corner).slice(1) + ' + (' + over(t.corner) + ')²)', t.mult);
}
/** Standard form text: K · zeros / poles, with (jω)^N as a zero or a pole according to its sign. */
export function standardFormText(a) {
  const ups = [], downs = [];
  if (a.origin > 0) ups.push(factorText({ kind: 'origin', mult: a.origin }));
  if (a.origin < 0) downs.push(factorText({ kind: 'origin', mult: -a.origin }));
  for (const t of a.terms) if (t.kind !== 'origin') (t.side > 0 ? ups : downs).push(factorText(t));
  const top = g4(a.K) + (ups.length ? '·' + ups.join('') : '');
  return 'H(ω) = ' + top + (downs.length ? ' / [' + downs.join('') + ']' : '');
}
/** Polynomial as text in s, highest power first: 2.533e-8s² + 2.533e-4s + 1. */
export function polyText(p) {
  const parts = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const c = p[i];
    if (c === 0) continue;
    const mag = Math.abs(c), coef = i > 0 && Math.abs(mag - 1) < 1e-12 ? '' : g4(mag), pow = i === 0 ? '' : 's' + (i === 1 ? '' : supText(i));
    parts.push((parts.length ? (c < 0 ? ' − ' : ' + ') : c < 0 ? '−' : '') + coef + pow);
  }
  return parts.join('') || '0';
}
export const rootText = r => (r.im === 0 ? g4(r.re) : g4(r.re) + (r.im < 0 ? ' − j' : ' + j') + g4(Math.abs(r.im)));
/** ζ class with the general definition (ζ<1 underdamped, =1 critical, >1 overdamped). */
export const zetaClass = zeta => (Math.abs(zeta - 1) < 1e-6 ? '임계감쇠 (ζ=1)' : zeta < 1 ? '부족감쇠 (ζ<1)' : '과감쇠 (ζ>1)');

// ---- filter reading ----------------------------------------------------------------------------------------------------------------
/** H(0) and H(∞) as numbers (0, finite or Infinity). */
export function limitsOf(h) {
  const num = trimPoly(h.num), den = trimPoly(h.den);
  const h0 = den[0] !== 0 ? num[0] / den[0] : num[0] === 0 ? null : Infinity;
  const dn = num.length - 1, dd = den.length - 1;
  const hInf = dn < dd ? 0 : dn > dd ? Infinity : num[dn] / den[dd];
  return { h0, hInf, relDegree: dn - dd };
}
/** Bisection on log ω for |H(jω)| = target between a and b (|H| − target must change sign). */
export function solveMagnitude(a, w1, w2, target) {
  const f = w => Math.hypot(a.at(w).re, a.at(w).im) - target;
  let lo = Math.log(w1), hi = Math.log(w2), flo = f(w1);
  if (flo * f(w2) > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2, fm = f(Math.exp(mid));
    if (fm === 0) return Math.exp(mid);
    if (flo * fm < 0) hi = mid; else { lo = mid; flo = fm; }
  }
  return Math.exp((lo + hi) / 2);
}
/** Peak of |H| on a log grid between lo and hi, refined by golden-section search. */
export function peakOf(a, lo, hi, n = 2000) {
  const mag = w => Math.hypot(a.at(w).re, a.at(w).im);
  let best = lo, bestM = -1;
  for (let i = 0; i <= n; i++) { const w = lo * (hi / lo) ** (i / n), m = mag(w); if (m > bestM) { bestM = m; best = w; } }
  let x0 = Math.log(best) - Math.log(hi / lo) / n, x1 = Math.log(best) + Math.log(hi / lo) / n;
  const gr = (Math.sqrt(5) - 1) / 2;
  for (let i = 0; i < 100; i++) {
    const c = x1 - gr * (x1 - x0), d = x0 + gr * (x1 - x0);
    if (mag(Math.exp(c)) > mag(Math.exp(d))) x1 = d; else x0 = c;
  }
  const w = Math.exp((x0 + x1) / 2);
  return { w, mag: mag(w) };
}
/** Minimum of |H| (a band-stop notch) the same way. */
export function dipOf(a, lo, hi, n = 2000) {
  const inv = { at: w => { const v = a.at(w), m2 = v.re * v.re + v.im * v.im; return m2 === 0 ? { re: 1e300, im: 0 } : { re: v.re / m2, im: -v.im / m2 }; } };
  const p = peakOf(inv, lo, hi, n);
  return { w: p.w, mag: 1 / p.mag };
}

/**
 * Filter type from H(0), H(∞) and the curve: { type, label, reference, w1, w2, wc, peak, order, slopeHigh, slopeLow }.
 * Half-power points follow the lecture definitions: low-pass relative to |H(0)|, high-pass to |H(∞)|, band-pass to the peak,
 * band-stop to the pass-band gain |H(0)|.
 */
export function classifyFilter(h) {
  const a = analyzeTransfer(h), { h0, hInf, relDegree } = limitsOf(h), order = degree(h.den);
  const [lo0, hi0] = a.range, lo = lo0 / 100, hi = hi0 * 100;
  const z = x => x === 0 || x === null, fin = x => x !== null && Number.isFinite(x) && x !== 0;
  const out = { order, slopeHigh: 20 * relDegree, slopeLow: 20 * a.origin, h0, hInf, analysis: a, wc: null, w1: null, w2: null, peak: null };
  if (fin(h0) && z(hInf)) {
    out.type = 'lowpass'; out.label = '저역통과'; out.reference = Math.abs(h0);
    out.peak = peakOf(a, lo, hi);
    out.wc = solveMagnitude(a, out.peak.w, hi, out.reference / Math.SQRT2);
  } else if (z(h0) && fin(hInf)) {
    out.type = 'highpass'; out.label = '고역통과'; out.reference = Math.abs(hInf);
    out.peak = peakOf(a, lo, hi);
    out.wc = solveMagnitude(a, lo, out.peak.w, out.reference / Math.SQRT2);
  } else if (z(h0) && z(hInf)) {
    out.type = 'bandpass'; out.label = '대역통과'; out.peak = peakOf(a, lo, hi); out.reference = out.peak.mag;
    out.w1 = solveMagnitude(a, lo, out.peak.w, out.reference / Math.SQRT2); out.w2 = solveMagnitude(a, out.peak.w, hi, out.reference / Math.SQRT2);
  } else if (fin(h0) && fin(hInf)) {
    const dip = dipOf(a, lo, hi), ref = Math.min(Math.abs(h0), Math.abs(hInf));
    if (dip.mag < ref / Math.SQRT2) {
      out.type = 'bandstop'; out.label = '대역차단'; out.reference = ref; out.dip = dip;
      out.w1 = solveMagnitude(a, lo, dip.w, ref / Math.SQRT2); out.w2 = solveMagnitude(a, dip.w, hi, ref / Math.SQRT2);
    } else { out.type = 'allpass'; out.label = '전역 통과 · 기타 (H(0)·H(∞) 모두 0이 아님)'; out.reference = ref; }
  } else { out.type = 'other'; out.label = '판정 없음 (H(0) 또는 H(∞)가 무한대)'; out.reference = null; }
  if (out.w1 && out.w2) { out.w0 = Math.sqrt(out.w1 * out.w2); out.bandwidth = out.w2 - out.w1; }
  return out;
}
export const FILTER_LABELS = Object.freeze({ lowpass: '저역통과', highpass: '고역통과', bandpass: '대역통과', bandstop: '대역차단' });
