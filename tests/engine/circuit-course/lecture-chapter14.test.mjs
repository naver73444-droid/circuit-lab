// Ch.14 frequency response (Alexander & Sadiku 7e): transfer-function parser, standard form, Table 14.3 straight lines, resonance,
// filters and scaling. Expected numbers are closed forms written out here (not the modules under test) or the lecture example values.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTransfer, analyzeTransfer, standardFormText, rootsOf, polyMul, classifyFilter, reduceRational, rational } from '../../../src/circuit-course-transfer.js';
import { resonance, capacitorForResonance, designFromBand } from '../../../src/circuit-course-resonance.js';
import { FILTER_CIRCUITS, buildFilter, scaledLadder, SCALING_BASES, scaleElement } from '../../../src/circuit-course-filters.js';
import { freqPlot, logGrid, niceStep } from '../../../src/circuit-course-freq-plot.js';
import { parseCourseNumber, siUnit } from '../../../src/circuit-course-format.js';
import { sliderPosition, sliderValue, evaluateTool, initialValues, presetValues } from '../../../src/circuit-course-tool-common.js';
import { getTool } from '../../../src/circuit-course-tools.js';

const near = (actual, expected, tolerance, what = '') => assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance, what + ' ' + actual + ' ≠ ' + expected + ' ± ' + tolerance);
const rel = (actual, expected, r = 1e-9, what = '') => near(actual, expected, Math.abs(expected) * r, what);
const of = text => analyzeTransfer(parseTransfer(text));
const dB = x => 20 * Math.log10(x);
const LOG3 = 20 * Math.log10(Math.SQRT2); // 3.0103 dB

test('parser: s, jω, jw, implicit products and integer powers give the same polynomials; bad input says why', () => {
  const forms = ['200s/((s+2)(s+10))', '200jω/((jω+2)(jω+10))', '200 jw / ((jw + 2)*(jw + 10))', '200*s/(s^2+12s+20)', '200s(s+2)^-1/(s+10)'];
  for (const f of forms) {
    const h = parseTransfer(f), k = 1 / h.den[0], got = [...h.num, ...h.den].map(c => c * k);
    assert.equal(h.num.length + h.den.length, 5, f);
    [0, 10, 1, 0.6, 0.05].forEach((c, i) => near(got[i], c, 1e-12, f));
  }
  assert.deepEqual(parseTransfer('2.533e-4s').num, [0, 2.533e-4], 'e-notation followed by s');
  assert.deepEqual(parseTransfer('−(s−1)×2').num, [2, -2], 'unicode minus and times');
  for (const [bad, why] of [['x+1', /읽을 수 없는 글자/], ['(s+1', /괄호/], ['s+1)', /괄호/], ['ω+1', /j를 붙이거나/], ['', /입력하세요/], ['1/(s-s)', /0으로 나누는/], ['s^1.5', /정수 지수/], ['s^13', /정수 지수/],
    ['s-s', /0입니다/], ['2*', /식이 끝났습니다/]]) assert.throws(() => parseTransfer(bad), why, bad);
});

test('example 14.3: standard form 10·jω/((1+jω/2)(1+jω/10)), constant 20 dB (not 200), corners 2 and 10', () => {
  const a = of('200jω/((jω+2)(jω+10))');
  assert.equal(a.K, 10);
  assert.equal(a.origin, 1);
  assert.deepEqual(a.corners, [2, 10]);
  assert.equal(standardFormText(a), 'H(ω) = 10·jω / [(1 + jω/2)(1 + jω/10)]');
  // closed form |H(j2)| = 400/(|2+2j|·|10+2j|), ∠ = 90 − 45 − atan(0.2)
  near(a.magDb(2), dB(400 / (Math.hypot(2, 2) * Math.hypot(10, 2))), 1e-12);
  near(a.phaseDeg(2), 90 - 45 - Math.atan(0.2) * 180 / Math.PI, 1e-9);
  near(a.magDb(2), 22.84, 0.005); near(a.approxDb(5), 20 + 20 * Math.log10(2), 1e-12);
});

test('Table 14.3: each of the seven terms has the textbook straight lines (magnitude ±20N/±40N dB/dec, phase ramps over two decades)', () => {
  const k = of('-5'); near(k.approxDb(123), dB(5), 1e-12); assert.equal(k.approxPhase(1), 180); assert.equal(k.phaseDeg(1), 180);
  const z0 = of('s^2'); near(z0.approxDb(10), 40, 1e-12); near(z0.approxDb(1), 0, 1e-12); assert.equal(z0.approxPhase(0.01), 180);
  const p0 = of('1/s'); near(p0.approxDb(100), -40, 1e-12); assert.equal(p0.approxPhase(5), -90);
  const z1 = of('1+s/10');
  for (const [w, db, ph] of [[1, 0, 0], [10, 0, 45], [100, 20, 90], [1000, 40, 90], [Math.sqrt(10), 0, 22.5]]) { near(z1.approxDb(w), db, 1e-12, 'zero dB ' + w); near(z1.approxPhase(w), ph, 1e-12, 'zero phase ' + w); }
  near(z1.magDb(10) - z1.approxDb(10), LOG3, 1e-12, 'zero: +3.01 dB at its corner');
  const p1 = of('1/(1+s/10)^2');
  near(p1.approxDb(100), -40, 1e-12); near(p1.approxPhase(10), -90, 1e-12); near(p1.approxPhase(1000), -180, 1e-12);
  near(p1.magDb(10) - p1.approxDb(10), -2 * LOG3, 1e-9, 'double pole: −6.02 dB at its corner');
  const zq = of('1 + 0.6s/10 + (s/10)^2'); // ζ = 0.3, ωn = 10
  near(zq.terms[0].zeta, 0.3, 1e-12); near(zq.terms[0].corner, 10, 1e-12);
  near(zq.approxDb(100), 40, 1e-9); near(zq.approxPhase(10), 90, 1e-9); near(zq.approxPhase(100), 180, 1e-9);
  const pq = of('1/(1 + 0.6s/10 + (s/10)^2)');
  near(pq.approxDb(1000), -80, 1e-9); near(pq.approxPhase(1), 0, 1e-12); near(pq.approxPhase(10), -90, 1e-9);
  near(pq.magDb(10), -dB(0.6), 1e-9, 'at ωn the exact value is −20log(2ζ)');
  // A zero in the right half plane (1 − s/5): same magnitude lines, phase goes the other way (exact and straight line).
  const rhp = of('1 - s/5');
  near(rhp.approxDb(50), 20, 1e-12); near(rhp.approxPhase(50), -90, 1e-12); near(rhp.phaseDeg(5), -45, 1e-9);
});

test('exact phase is continuous (no 360° jumps) and equals the angle of H(jω) modulo 360°', () => {
  for (const text of ['100jω/((1+jω)(1+jω/5)(1+jω/20))', '1/(s+1)^4', '(s-3)/((s^2+0.2s+4)(s+10))', '-2s^2/((s+1)(s^2+s+100))']) {
    const a = of(text), grid = logGrid(1e-3, 1e4, 200);
    let last = a.phaseDeg(grid[0]);
    for (const w of grid) {
      const ph = a.phaseDeg(w), v = a.at(w), atan = Math.atan2(v.im, v.re) * 180 / Math.PI;
      assert.ok(Math.abs(ph - last) < 15, text + ': jump at ω=' + w);
      near(((ph - atan) % 360 + 540) % 360 - 180, 0, 1e-6, text + ' mod 360 at ' + w);
      last = ph;
    }
  }
  const a = of('1/(s+1)^4'); near(a.phaseDeg(1e4), -360, 0.05, 'four poles end at −360°, not 0°');
});

test('second-order peak and damping class follow the closed forms; repeated roots are found with their multiplicity', () => {
  const zeta = 0.05, a = of('1/(s^2+0.1s+1)'), w = logGrid(0.5, 2, 20000);
  const best = w.reduce((m, x) => (a.magDb(x) > m.db ? { x, db: a.magDb(x) } : m), { x: 0, db: -Infinity });
  near(best.db, -dB(2 * zeta * Math.sqrt(1 - zeta * zeta)), 1e-5, 'Mr = 1/(2ζ√(1−ζ²)) (grid peak)');
  near(best.x, Math.sqrt(1 - 2 * zeta * zeta), 1e-4, 'ωr = ωn√(1−2ζ²)');
  assert.deepEqual(rootsOf([1, 4, 6, 4, 1]), [{ root: { re: -1, im: 0 }, mult: 4 }]);
  const pair = rootsOf(polyMul([4, 0.4, 1], [4, 0.4, 1]));
  assert.equal(pair.length, 2); assert.ok(pair.every(g => g.mult === 2)); near(Math.hypot(pair[0].root.re, pair[0].root.im), 2, 1e-9);
  const ex142 = of('s(s+2)/(s^2+2s+1)');
  assert.equal(ex142.poles.length, 1); assert.equal(ex142.poles[0].mult, 2); near(ex142.poles[0].root.re, -1, 1e-12);
  assert.equal(standardFormText(ex142), 'H(ω) = 2·jω(1 + jω/2) / [(1 + jω)²]');
  // pole-zero cancellation: (s+1)/((s+1)(s+3)) reads as 1/(s+3)
  const c = of('(s+1)/((s+1)(s+3))');
  assert.equal(c.terms.length, 1); assert.equal(c.cancelled.length, 1); near(c.K, 1 / 3, 1e-12);
  assert.deepEqual(reduceRational(rational([0, 0, 1], [0, 1, 1])), rational([0, 1], [1, 1]), 'a shared s is removed exactly');
});

test('scaled circuits keep their tiny high-power coefficients (no trimming by size): 4th-order Butterworth at 50 kHz', () => {
  const ladder = scaledLadder(SCALING_BASES.butter.elements({}), 1e4, 2 * Math.PI * 5e4), a = analyzeTransfer(ladder.after.h);
  assert.equal(ladder.after.h.den.length, 5, 'fourth order');
  for (const w of [1e3, 1e5, 3.14e5, 1e6, 1e7]) { const x = a.at(w), y = ladder.after.at(w); rel(Math.hypot(x.re, x.im), Math.hypot(y.re, y.im), 1e-9, 'ω=' + w); }
});

test('filters: type from H(0) and H(∞), lecture half-power points against closed forms', () => {
  const f1410 = classifyFilter(buildFilter(FILTER_CIRCUITS.find(c => c.id === 'lp2'), { L: 2, R: 2000, C: 2e-6 }).h);
  // |H|² = 1/2: R²L²C²x² + (L² − 2R²LC)x − R² = 0 with x = ω²
  const [R, L, C] = [2000, 2, 2e-6], qa = R * R * L * L * C * C, qb = L * L - 2 * R * R * L * C, x = (-qb + Math.sqrt(qb * qb + 4 * qa * R * R)) / (2 * qa);
  assert.equal(f1410.type, 'lowpass'); assert.equal(f1410.order, 2); rel(f1410.wc, Math.sqrt(x), 1e-9); near(f1410.wc, 742.3, 0.05);
  const f1457 = classifyFilter(buildFilter(FILTER_CIRCUITS.find(c => c.id === 'ladder-rc'), { R1: 1, C1: 1, C2: 1, R2: 1 }).h);
  assert.equal(f1457.type, 'bandpass'); rel(f1457.w1, (Math.sqrt(13) - 3) / 2, 1e-9); rel(f1457.w2, (Math.sqrt(13) + 3) / 2, 1e-9); rel(f1457.bandwidth, 3, 1e-9);
  const bs = classifyFilter(buildFilter(FILTER_CIRCUITS.find(c => c.id === 'rlc-bs'), { R: 100, L: 0.01, C: 1e-6 }).h);
  assert.equal(bs.type, 'bandstop'); rel(bs.w0, 1e4, 1e-9); rel(bs.bandwidth, 100 / 0.01, 1e-9);
  const hp = classifyFilter(buildFilter(FILTER_CIRCUITS.find(c => c.id === 'inv-hp'), { Ri: 1e4, Ci: 1e-7, Rf: 5e4 }).h);
  assert.equal(hp.type, 'highpass'); rel(hp.hInf, -5, 1e-12); rel(hp.wc, 1000, 1e-9);
  const buffer = classifyFilter(buildFilter(FILTER_CIRCUITS.find(c => c.id === 'noninv-lp'), { R: 1e3, C: 1e-6, Ri: 1e4, Rf: 0 }).h);
  rel(buffer.h0, 1, 1e-12, 'Rf = 0: a voltage follower, gain 1 (exercise 14.61a)');
  for (const circuit of FILTER_CIRCUITS) {
    const v = { R: 1e3, L: 0.1, C: 1e-6, R1: 1, R2: 2, L1: 1, L2: 3, C1: 1e-6, C2: 1e-8, Ri: 1e4, Rf: 2e4, Cf: 1e-8, Ci: 1e-7 };
    const built = buildFilter(circuit, v), a = analyzeTransfer(built.h);
    for (const w of [3.7, 370, 37000]) { const p = a.at(w), d = built.at(w); near(Math.hypot(p.re - d.re, p.im - d.im) / Math.hypot(d.re, d.im), 0, 1e-9, circuit.id + ' at ' + w); }
  }
});

test('resonance: series and parallel closed forms, Table 14.4 duality, design inverses (14.30, 14.77)', () => {
  const s = resonance({ circuit: 'series', R: 2, L: 1e-3, C: 0.4e-6, source: 1 });
  rel(s.w0, 5e4); rel(s.B, 2000); rel(s.Q, 25); rel(s.w1 * s.w2, s.w0 ** 2, 1e-12); rel(s.w2 - s.w1, s.B, 1e-9);
  rel(s.at(s.w1).p / s.at(s.w0).p, 0.5, 1e-9); rel(s.at(s.w0).vL, 25, 1e-9, '|VL| = Q·V at ω0');
  const p = resonance({ circuit: 'parallel', R: 2, L: 1e-3, C: 0.4e-6, source: 1 });
  rel(p.B, 1 / (2 * 0.4e-6)); rel(s.Q * p.Q, 1, 1e-12, 'Q series × Q parallel = 1 for the same R, L, C');
  rel(p.at(p.w0).response, 2, 1e-12, '|V(ω0)| = Im·R'); rel(p.at(p.w2).p / p.at(p.w0).p, 0.5, 1e-9);
  rel(capacitorForResonance(15e3, 10e-3), 1 / ((2 * Math.PI * 15e3) ** 2 * 0.01), 1e-12); near(capacitorForResonance(15e3, 10e-3) * 1e9, 11.26, 0.005);
  const d = designFromBand('series', 40, 5, 10); rel(d.L, 2); rel(d.C, 312.5e-6);
  const dp = designFromBand('parallel', 40, 5, 10); rel(dp.C, 1 / 50); rel(1 / Math.sqrt(dp.L * dp.C), 40, 1e-12);
  assert.throws(() => resonance({ circuit: 'series', R: 0, L: 1, C: 1, source: 1 }), /0보다 큰/);
});

test('scaling: R·Km, L·Km/Kf, C/(Km·Kf); Km leaves H unchanged and Kf moves it by log10 Kf decades (exercise 14.77, example 14.14)', () => {
  assert.equal(scaleElement('R', 10, 600, 1), 6000); rel(scaleElement('L', 2, 400, 1e5), 8e-3); rel(scaleElement('C', 312.5e-6, 400, 1e5), 7.8125e-12);
  const base = SCALING_BASES.rlc.elements({ R0: 10, L0: 2, C0: 312.5e-6 });
  const onlyKm = scaledLadder(base, 600, 1), onlyKf = scaledLadder(base, 1, 1000);
  for (const w of [3, 40, 400]) {
    const m = sys => { const v = sys.at(w); return Math.hypot(v.re, v.im); };
    rel(m(onlyKm.after), m(onlyKm.before), 1e-12, 'Km: same |H|');
    const shifted = onlyKf.after.at(w * 1000), orig = onlyKf.before.at(w);
    rel(Math.hypot(shifted.re, shifted.im), Math.hypot(orig.re, orig.im), 1e-12, 'Kf: |H′(Kf·ω)| = |H(ω)|');
  }
  const r = evaluateTool(getTool('scaling'), presetValues(getTool('scaling'), getTool('scaling').presets[3]));
  rel(r.values.Kf, 2 * Math.PI * 5e4, 1e-12); near(r.values.f3, 5e4, 50, 'textbook values rounded to 4 digits: within 0.1 %');
});

test('course numbers: SI prefixes only for fields that ask for them; log sliders keep four significant digits', () => {
  assert.equal(parseCourseNumber('0.4u', { si: true }), 4e-7);
  assert.equal(parseCourseNumber('2k', { si: true }), 2000); assert.equal(parseCourseNumber('10m', { si: true }), 0.01); assert.equal(parseCourseNumber('1M', { si: true }), 1e6);
  assert.equal(parseCourseNumber('3e-3', { si: true }), 0.003);
  for (const t of ['0.4u', '2k', 'u', '2kk']) assert.throws(() => parseCourseNumber(t), t + ' without si');
  for (const t of ['u', '2kk', 'k2', 'e3']) assert.throws(() => parseCourseNumber(t, { si: true }), t);
  const range = { min: 1e-3, max: 1e6, step: 0.005, log: true };
  near(sliderPosition(range, 100), 2, 1e-12); assert.equal(sliderValue(range, 0.37), 2.344); assert.equal(sliderPosition(range, 1e9), 6, 'clamped');
  const linear = { min: 0, max: 10, step: 1 }; assert.equal(sliderPosition(linear, 3), 3); assert.equal(sliderValue(linear, 3), 3);
  assert.equal(siUnit(1.1258e-8, 'F'), '11.26 nF'); assert.equal(siUnit(1200, 'H'), '1.2 kH'); assert.equal(siUnit(7.8125e-12, 'F'), '7.813 pF');
});

test('frequency figure: decade ticks, narrow windows get plain ticks, zeros on the jω axis never print NaN', () => {
  const a = of('(s^2+4)/((s+1)(s+10))'), grid = logGrid(0.1, 100, 50).concat([2]).sort((x, y) => x - y);
  const html = freqPlot({ title: 't', range: [0.1, 100], panels: [{ label: 'dB', floor: 120, cursor: 2, series: [{ style: 'exact', points: grid.map(w => [w, a.magDb(w)]), cursorValue: a.magDb(2) }] }] });
  assert.ok(!/NaN|Infinity/.test(html)); assert.match(html, />0\.1</); assert.match(html, />100</);
  const narrow = freqPlot({ title: 'n', range: [45000, 55000], panels: [{ label: 'A', yMin: 0, series: [{ points: [[45000, 1], [55000, 2]] }] }] });
  assert.match(narrow, />50k</);
  assert.equal(niceStep(360, true), 90); assert.equal(niceStep(100), 20);
});

test('Ch.14 tools: the defaults evaluate, a bad expression keeps a reason, and the Bode cursor reading matches the system', () => {
  for (const id of ['bode', 'resonance', 'filters', 'scaling']) { const def = getTool(id); assert.equal(evaluateTool(def, initialValues(def)).status, 'valid', id); }
  const bode = getTool('bode');
  const bad = evaluateTool(bode, { ...initialValues(bode), expression: '(s+1' });
  assert.equal(bad.status, 'invalid'); assert.match(bad.reason, /괄호/);
  const r = evaluateTool(bode, { ...initialValues(bode), cursor: 10 });
  near(r.values.exactDb, r.sys.magDb(10), 1e-12); near(r.values.diffDb, r.sys.magDb(10) - r.sys.approxDb(10), 1e-12);
  const res = getTool('resonance'), rms = evaluateTool(res, presetValues(res, res.presets[0]), 'rms'), peak = evaluateTool(res, presetValues(res, res.presets[0]), 'peak');
  rel(peak.values.peak, rms.values.peak * Math.SQRT2, 1e-12); rel(peak.values.Q, rms.values.Q, 1e-15); rel(peak.values.P0, rms.values.P0, 1e-15, 'power does not depend on the basis');
});
