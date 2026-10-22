// Guided Fourier-transform steps: every expected value comes from a direct numerical integral of the time signal
// (X(f) = ∫ x(t) e^{−j2πft} dt by the midpoint rule) or from the course numbers, never from the guide's own formulas.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCourseMath } from '../../../src/course-math-view.js';
import {
  GUIDE_STEPS, TRAIN, SHIFTED, guideChips, guideControls, guideDefaults, guideFormula, guideFrame, guideObserve, guideSpectrum,
  guideText, linesInMainLobe, trainLine,
} from '../../../src/signals-transform-guide.js';

const TAU = 2 * Math.PI;

// ∫_lo^hi x(t) e^{−j2πft} dt by the midpoint rule.
function transform(x, lo, hi, f, n = 20000) {
  const h = (hi - lo) / n;
  let re = 0;
  let im = 0;
  for (let i = 0; i < n; i++) {
    const t = lo + (i + 0.5) * h;
    const v = x(t);
    re += v * Math.cos(TAU * f * t) * h;
    im -= v * Math.sin(TAU * f * t) * h;
  }
  return { re, im };
}
const close = (actual, expected, tol, label) => assert.ok(Math.abs(actual - expected) <= tol, `${label}: ${actual} vs ${expected}`);
const wrap = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle));

test('step 1: T0·c_k of the pulse train is the one-period integral, and it samples X(f) of one pulse (course figure, τ = 0.1 s)', () => {
  const pulse = (t) => (Math.abs(t) < TRAIN.tau / 2 ? TRAIN.A : 0);
  for (const T0 of [0.25, 0.5, 1, 2]) {
    for (let k = 0; k <= 8; k++) {
      // T0·c_k = ∫ over one period of x̃(t) e^{−jk2πt/T0} dt: only the pulse around 0 lies in (−T0/2, T0/2).
      const expected = transform(pulse, -TRAIN.tau / 2, TRAIN.tau / 2, k / T0).re;
      close(trainLine(T0, k), expected, 1e-7, `T0=${T0}, k=${k}`);
    }
    close(trainLine(T0, 0), 0.1, 1e-12, `T0=${T0}: the peak Aτ`);
  }
  // Zeros of the envelope at f = 1/τ = 10 Hz, i.e. k = T0/τ when that is an integer (course: k = 5, 10, 20).
  close(trainLine(0.5, 5), 0, 1e-12, 'T0=0.5, k=5');
  close(trainLine(1, 10), 0, 1e-12, 'T0=1, k=10');
  close(trainLine(2, 20), 0, 1e-12, 'T0=2, k=20');
  assert.ok(Math.abs(trainLine(0.25, 2)) > 0.01, 'T0=0.25: k = 2.5 is not a line, so no line sits on the zero');
});

test('step 1: lines strictly inside the main lobe |f| < 1/τ, counted by brute force', () => {
  for (const T0 of [0.2, 0.25, 0.3, 0.5, 0.75, 1, 1.35, 2, 4]) {
    let count = 0;
    for (let k = -1000; k <= 1000; k++) if (Math.abs(k / T0) < 1 / TRAIN.tau - 1e-9) count++;
    assert.equal(linesInMainLobe(T0), count, `T0=${T0}`);
  }
});

test('step 2 (Ex 4.12): X(f) of AΠ(t/τ) is real, X(0) is the area and the first zero is 1/τ — the three course pulses of area 1', () => {
  for (const [A, T] of [[1, 1], [2, 0.5], [0.5, 2], [3, 1.5]]) {
    const x = (t) => (Math.abs(t) < T / 2 ? A : 0);
    for (const f of [0, 0.3, 0.75, 1.6, 3.2]) {
      const expected = transform(x, -T / 2, T / 2, f);
      const value = guideSpectrum('pulse', { A, T }, f);
      close(value.re, expected.re, 1e-6, `A=${A}, τ=${T}, f=${f} (Re)`);
      close(value.im, 0, 1e-12, `A=${A}, τ=${T}, f=${f} (Im)`);
      close(expected.im, 0, 1e-6, 'the numerical integral is real too');
    }
    close(guideSpectrum('pulse', { A, T }, 0).re, A * T, 1e-12, 'X(0) = Aτ');
    close(guideSpectrum('pulse', { A, T }, 1 / T).re, 0, 1e-12, 'first zero at 1/τ');
  }
});

test('step 3 (Ex 4.13): a shift leaves |X| alone and turns the phase by −2πf t0 (plus π where the sinc is negative)', () => {
  const T = SHIFTED.tau;
  for (const t0 of [0, 0.5, -1.5, 1.25]) {
    const x = (t) => (Math.abs(t - t0) < T / 2 ? SHIFTED.A : 0);
    for (const f of [0.2, 0.6, 1.3, 1.7, 2.4, 3.6]) {
      const expected = transform(x, t0 - T / 2, t0 + T / 2, f);
      const value = guideSpectrum('shift', { t0 }, f);
      close(value.re, expected.re, 1e-6, `t0=${t0}, f=${f} (Re)`);
      close(value.im, expected.im, 1e-6, `t0=${t0}, f=${f} (Im)`);
      const unshifted = guideSpectrum('shift', { t0: 0 }, f);
      close(Math.hypot(value.re, value.im), Math.hypot(unshifted.re, unshifted.im), 1e-12, `t0=${t0}, f=${f}: |X| unchanged`);
      const positive = Math.sin(Math.PI * f * T) / (Math.PI * f * T) > 0;
      const phase = Math.atan2(value.im, value.re);
      close(Math.abs(wrap(phase - (-TAU * f * t0 + (positive ? 0 : Math.PI)))), 0, 1e-9, `t0=${t0}, f=${f}: phase`);
    }
  }
});

test('step 3 formula: the straight line is β = −2πf t₀, θ adds ±π where the sinc is negative and is folded into (−π, π] — as drawn', () => {
  // t0 = 0, f = 1.5 Hz: the sinc is negative there, so the drawn phase is ±π although β = 0.
  const v = guideSpectrum('shift', { t0: 0 }, 1.5);
  close(Math.abs(Math.atan2(v.im, v.re)), Math.PI, 1e-12, 't0=0, f=1.5: |θ| = π');
  for (const axis of [0, 1]) {
    const sym = axis ? 'ω' : 'f';
    const sinc = axis ? 'sinc(ωτ/(2π))' : 'sinc(fτ)';
    const lines = guideFormula('shift', { t0: 0, axis }).split('\n');
    assert.ok(lines.includes(axis ? 'β(ω) = −ω t₀' : 'β(f) = −2πf t₀'), `${sym}: β line`);
    assert.ok(lines.includes(`${sinc} > 0: θ(${sym}) = wrap(β(${sym}))`), `${sym}: θ = wrap(β) where the sinc is positive`);
    assert.ok(lines.includes(`${sinc} < 0: θ(${sym}) = wrap(β(${sym}) ± π)`), `${sym}: θ = wrap(β ± π) where it is negative`);
    assert.ok(lines.includes('wrap(φ) = φ + 2πm, −π < wrap(φ) ≤ π'), `${sym}: wrap folds into (−π, π]`);
    // θ is never written as the straight line alone (that read 0 at t0 = 0 while the plot showed ±π)
    assert.ok(!lines.some((line) => /^θ\([fω]\) = −/.test(line)), `${sym}: no "θ = −…" line`);
    assert.match(lines.at(-1), /^지금: t₀ = 0 s → β 기울기 /);
    assert.match(lines.at(-1), axis ? /6\.28~12\.6 rad\/s/ : /1~2 Hz/, `${sym}: the first negative-sinc band`);
    // t0 = 0: θ = 0 in the main lobe and π (not 0) at f = 1.5 Hz
    assert.match(lines.at(-1), axis ? /ω = 1\.5π rad\/s에서 β = 0, θ = 0 · ω = 3π rad\/s에서 β = 0, θ = π$/ : /f = 0\.75 Hz에서 β = 0, θ = 0 · f = 1\.5 Hz에서 β = 0, θ = π$/);
    // the graph says the same: the dashed line is β, the solid one the folded θ
    const frame = guideFrame('shift', { t0: 0, axis });
    const legend = frame.legend.map((entry) => entry.text);
    assert.ok(legend.includes('θ 위상 (접힘)'), `${sym}: legend θ`);
    assert.ok(legend.includes(axis ? 'β = −ω t₀ 직선' : 'β = −2πf t₀ 직선'), `${sym}: legend β`);
    assert.match(frame.panes[2].title, new RegExp(`^θ\\(${sym}\\) \\[rad\\]: 점선 = 직선 β, 실선 = θ`));
  }
  // t0 = 1, f = 0.75 Hz: β = −3π/2 but the sinc is positive and the drawn phase is folded: θ = +π/2 (graph and formula agree)
  const one = guideSpectrum('shift', { t0: 1 }, 0.75);
  close(Math.atan2(one.im, one.re), Math.PI / 2, 1e-9, 't0=1, f=0.75: the plotted θ');
  close(wrap(-TAU * 0.75 * 1), Math.PI / 2, 1e-12, 'wrap(β) = π/2');
  for (const axis of [0, 1]) {
    const now = guideFormula('shift', { t0: 1, axis }).split('\n').at(-1);
    assert.match(now, axis ? /ω = 1\.5π rad\/s에서 β = −1\.5π, θ = 0\.5π/ : /f = 0\.75 Hz에서 β = −1\.5π, θ = 0\.5π/, `axis ${axis}: ${now}`);
    assert.match(now, axis ? /ω = 3π rad\/s에서 β = −3π, θ = 0$/ : /f = 1\.5 Hz에서 β = −3π, θ = 0$/, `axis ${axis}: ${now}`);
  }
  assert.match(guideText('shift').body, /β\(f\)=−2πf·t₀/);
  assert.match(guideText('shift').body, /θ\(f\)=β\(f\)±π/);
});

test('step labels: one-word phone labels; the ③ t₀ label has headroom under the title, the ④ height label sits above the pulse', () => {
  for (const step of GUIDE_STEPS) {
    assert.ok(step.tiny && !/\s.*\s/.test(step.tiny), `${step.id}: "${step.tiny}" is the number and one word`);
    assert.ok([...step.tiny].length <= [...step.short].length, `${step.id}: tiny is not longer than short`);
    assert.equal(step.tiny[0], step.title[0], `${step.id}: same step number`);
  }
  for (const t0 of [-2, -0.5, 0, 0.5, 2]) {
    const pane = guideFrame('shift', { t0 }).panes[0];
    const label = pane.texts[0];
    // at least 0.25 of the pane height between the label's anchor and the top edge (the title sits above that edge)
    assert.ok((pane.y[1] - label.y) / (pane.y[1] - pane.y[0]) >= 0.25, `t0=${t0}: headroom ${JSON.stringify(pane.y)}`);
  }
  for (const a of [0.05, 0.1, 1, 2]) {
    const pane = guideFrame('impulse', { a }).panes[0];
    const label = pane.texts[0];
    assert.deepEqual([label.x, label.y], [0, 1 / a], `a=${a}: centred on the pulse's top edge`);
    assert.ok(label.dy < 0, `a=${a}: drawn above it`);
    assert.ok((pane.y[1] - label.y) / (pane.y[1] - pane.y[0]) >= 0.2, `a=${a}: room for the label under the title`);
  }
});

test('step 4 (Ex 4.14): the unit-area pulse q_a has Q(0) = 1 and its first zero at 1/a, which runs away as a → 0', () => {
  for (const a of [2, 1, 0.2, 0.1]) {
    const x = (t) => (Math.abs(t) < a / 2 ? 1 / a : 0);
    for (const f of [0, 0.4, 1.1, 2.5, 4.9]) close(guideSpectrum('impulse', { a }, f).re, transform(x, -a / 2, a / 2, f).re, 1e-6, `a=${a}, f=${f}`);
    close(guideSpectrum('impulse', { a }, 0).re, 1, 1e-12, `a=${a}: area 1`);
    close(guideSpectrum('impulse', { a }, 1 / a).re, 0, 1e-12, `a=${a}: zero at 1/a`);
  }
  assert.ok(guideSpectrum('impulse', { a: 0.05 }, 5).re > 0.89, 'a = 0.05: the spectrum is nearly flat on ±5 Hz');
});

test('step 5 (Ex 4.15, 4.16): e^(−at)u(t) has Re even, Im odd, |X| = 1/(√2 a) and phase −π/4 at ω = a; e^(−a|t|) is real', () => {
  for (const a of [0.5, 1, 3]) {
    const end = 40 / a;
    const one = (t) => (t > 0 ? Math.exp(-a * t) : 0);
    const two = (t) => Math.exp(-a * Math.abs(t));
    for (const f of [0, 0.05, 0.2, 0.9]) {
      const v1 = guideSpectrum('exp', { shape: 0, a }, f);
      const e1 = transform(one, 0, end, f, 400000);
      close(v1.re, e1.re, 2e-5, `one-sided a=${a}, f=${f} (Re)`);
      close(v1.im, e1.im, 2e-5, `one-sided a=${a}, f=${f} (Im)`);
      const mirrored = guideSpectrum('exp', { shape: 0, a }, -f);
      close(mirrored.re, v1.re, 1e-12, 'Re X is even');
      close(mirrored.im, -v1.im, 1e-12, 'Im X is odd');
      const v2 = guideSpectrum('exp', { shape: 1, a }, f);
      const e2 = transform(two, -end, end, f, 800000);
      close(v2.re, e2.re, 2e-5, `two-sided a=${a}, f=${f}`);
      close(v2.im, 0, 1e-12, 'two-sided: purely real');
    }
    const corner = guideSpectrum('exp', { shape: 0, a }, a / TAU); // ω = a
    close(Math.hypot(corner.re, corner.im), 1 / (Math.SQRT2 * a), 1e-12, `a=${a}: |X(a)|`);
    close(Math.atan2(corner.im, corner.re), -Math.PI / 4, 1e-12, `a=${a}: θ(a)`);
    close(guideSpectrum('exp', { shape: 1, a }, a / TAU).re, 1 / a, 1e-12, `a=${a}: two-sided X(a) = 1/a`);
  }
});

// Parameter sets at the slider extremes, the defaults and every preset of a step.
function paramSets(stepId) {
  const controls = guideControls(stepId);
  const make = (pick) => ({ ...guideDefaults(stepId), ...Object.fromEntries(controls.map((c) => [c.key, pick(c)])) });
  const sets = [make((c) => c.initial), make((c) => c.min), make((c) => c.max), make((c) => c.min + Math.round((c.max - c.min) / c.step / 2) * c.step)];
  for (const chip of guideChips(stepId)) sets.push({ ...guideDefaults(stepId), ...chip.params });
  return sets.flatMap((p) => [{ ...p, axis: 0 }, { ...p, axis: 1 }]);
}

test('controls: 1–2 sliders plus at most two selects per step; defaults, maxima, 0 and every preset lie on the slider grid', () => {
  assert.equal(GUIDE_STEPS.length, 5);
  for (const { id } of GUIDE_STEPS) {
    const controls = guideControls(id);
    const sliders = controls.filter((c) => !c.options);
    const choices = controls.filter((c) => c.options);
    assert.ok(sliders.length >= 1 && sliders.length <= 2 && choices.length <= 2, id);
    assert.equal(controls.at(-1).key, 'axis', `${id}: the frequency axis is the last control`);
    const onGrid = (c, v) => Math.abs((v - c.min) / c.step - Math.round((v - c.min) / c.step)) < 1e-9;
    for (const c of sliders) {
      assert.ok(onGrid(c, c.initial) && onGrid(c, c.max), `${id}/${c.key}`);
      if (c.min < 0 && c.max > 0) assert.ok(onGrid(c, 0), `${id}/${c.key}: 0`);
      assert.doesNotMatch(c.label, /적용|계산/);
    }
    const chips = guideChips(id);
    assert.ok(chips.length >= 2 && chips.length <= 4, `${id}: chips`);
    for (const chip of chips) {
      for (const [key, value] of Object.entries(chip.params)) {
        const c = controls.find((entry) => entry.key === key);
        assert.ok(c, `${id}: chip key ${key}`);
        assert.ok(value >= c.min && value <= c.max && (c.options || onGrid(c, value)), `${id}/${chip.label}`);
      }
    }
    assert.equal(guideDefaults(id, 1).axis, 1, `${id}: the axis carries over`);
  }
});

test('frames: 2–3 panes with finite ranges and titles at every extreme and preset; the shift step has the phase pane', () => {
  for (const { id } of GUIDE_STEPS) {
    for (const params of paramSets(id)) {
      const frame = guideFrame(id, params);
      assert.ok(frame.panes.length >= 2 && frame.panes.length <= 3, id);
      for (const pane of frame.panes) {
        assert.ok(pane.title.length > 4, `${id}: title`);
        assert.ok(pane.x[1] > pane.x[0] && pane.y[1] > pane.y[0] && [...pane.x, ...pane.y].every(Number.isFinite), `${id}: ranges ${JSON.stringify([pane.x, pane.y])}`);
        for (const type of ['stems', 'texts', 'dots', 'segments']) {
          for (const item of pane[type] ?? []) {
            const numbers = type === 'stems' ? item.pts.flat() : [item.x, item.y, item.x1, item.y1, item.x2, item.y2].filter((v) => v !== undefined);
            assert.ok(numbers.every(Number.isFinite), `${id}: ${type}`);
            if (type === 'texts') assert.doesNotMatch(item.text, /NaN|undefined|Infinity/);
          }
        }
      }
      assert.ok(frame.legend.length >= 2, `${id}: legend`);
    }
  }
  assert.equal(guideFrame('shift', guideDefaults('shift')).panes.length, 3);
  // ω axis: titles name ω [rad/s] and the stems move by 2π.
  const frame = guideFrame('train', { T0: 0.5, axis: 1 });
  assert.match(frame.panes[1].title, /ω \[rad\/s\]/);
  const stems = frame.panes[1].stems[0].pts;
  close(stems[1][0] - stems[0][0], TAU / 0.5, 1e-9, 'ω axis: line spacing 2π/T0');
});

test('words: Korean body and try lines, a read-out without NaN, and formula lines that parse as math (the "지금" line is prose)', () => {
  for (const { id } of GUIDE_STEPS) {
    for (const params of paramSets(id)) {
      const { body, tryText } = guideText(id, params);
      assert.match(body, /[가-힣]/);
      assert.ok(body.length > 40 && body.length < 260, `${id}: body ${body.length}`);
      assert.match(tryText, /[가-힣]/);
      const observe = guideObserve(id, params);
      assert.doesNotMatch(observe, /NaN|undefined|Infinity/, `${id}: ${observe}`);
      const lines = guideFormula(id, params).split('\n');
      assert.ok(lines.length >= 3, id);
      for (const line of lines) {
        assert.doesNotMatch(line, /NaN|undefined|Infinity/, `${id}: ${line}`);
        if (/[가-힣]/u.test(line)) assert.match(line, /^지금: /, `${id}: prose only on the "지금" line`);
        else assert.ok(parseCourseMath(line), `${id}: cannot parse "${line}"`);
      }
    }
  }
});
