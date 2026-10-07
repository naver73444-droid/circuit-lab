// Y–Δ course tool with complex impedances (textbook 9.7). Hand-computed numbers; the resistor mode is covered by y-delta.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { COMPLEX_EXAMPLES, attemptComplex, convertDeltaToYZ, convertYToDeltaZ, createComplexState, evaluateComplexTool, impedanceDraft, parseImpedanceInput, terminalPairs, toggleComplexDirection, withComplexText, withComplexValue } from "../../src/y-delta-complex-model.js";
import { convertDeltaToY, convertYToDelta } from "../../src/y-delta-model.js";

const z = (re, im = 0) => ({ re, im });
const near = (actual, expected, tolerance = 1e-9, what = "") => assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance, `${what} ${actual} ≠ ${expected} ± ${tolerance}`);
const zn = (a, b, tolerance = 1e-9, what = "") => { near(a.re, b.re, tolerance, `${what} re`); near(a.im, b.im, tolerance, `${what} im`); };
const toY = (RAB, RBC, RCA) => ({ direction: "toY", values: { RAB, RBC, RCA } });
const toDelta = (RA, RB, RC) => ({ direction: "toDelta", values: { RA, RB, RC } });

test("balanced Δ: Z_Δ = 15 + j10 Ω on all three sides gives Z_Y = Z_Δ/3 = 5 + j3.333 Ω (same phase angle)", () => {
  const r = evaluateComplexTool(toY(z(15, 10), z(15, 10), z(15, 10)));
  for (const key of ["RA", "RB", "RC"]) zn(r.outputs[key], z(5, 10 / 3), 1e-12, key);
  assert.equal(r.balanced, true);
  assert.match(r.read, /Z_Y = Z_Δ\/3/);
  assert.match(r.texts.RA.rect, /5 \+ j3\.3333/);
  assert.match(r.texts.RA.polar, /∠ 33\.69/, "the angle of 15+j10 is kept");
  const back = evaluateComplexTool(toDelta(z(5, 10 / 3), z(5, 10 / 3), z(5, 10 / 3)));
  for (const key of ["RAB", "RBC", "RCA"]) zn(back.outputs[key], z(15, 10), 1e-12, key);
  assert.match(back.read, /Z_Δ = 3Z_Y/);
});

test("unbalanced Δ by hand: Z_AB = 10, Z_BC = j10, Z_CA = 10 − j10 (Σ = 20) gives Z_A = 5 − j5, Z_B = j5, Z_C = 5 + j5", () => {
  const r = evaluateComplexTool(toY(z(10), z(0, 10), z(10, -10)));
  zn(r.outputs.RA, z(5, -5), 1e-12, "Z_A = Z_AB Z_CA/Σ"); zn(r.outputs.RB, z(0, 5), 1e-12, "Z_B = Z_AB Z_BC/Σ"); zn(r.outputs.RC, z(5, 5), 1e-12, "Z_C = Z_BC Z_CA/Σ");
  assert.equal(r.balanced, false);
  assert.ok(r.pairs.every((p) => p.pass));
});

test("unbalanced Y by hand: Z_A = 3 + j4, Z_B = 6 − j2, Z_C = 4 (S = 62 + j26) gives Z_AB = 15.5 + j6.5, Z_BC = 11.6 − j6.8, Z_CA = 8 + j7", () => {
  const r = evaluateComplexTool(toDelta(z(3, 4), z(6, -2), z(4)));
  zn(r.outputs.RAB, z(15.5, 6.5), 1e-12, "Z_AB = S/Z_C"); zn(r.outputs.RBC, z(11.6, -6.8), 1e-12, "Z_BC = S/Z_A"); zn(r.outputs.RCA, z(8, 7), 1e-12, "Z_CA = S/Z_B");
  assert.match(r.math.general, /Z_AB = /);
});

test("round trip: Δ→Y→Δ and Y→Δ→Y return the original values (several unbalanced sets, some with negative parts)", () => {
  const sets = [[z(10), z(0, 10), z(10, -10)], [z(3, 4), z(6, -2), z(4)], [z(-2, 7), z(1e3, -250), z(0.5, 0.25)], [z(1e-3, 0), z(2e-3, 1e-3), z(5e-3, -2e-3)]];
  for (const [a, b, c] of sets) {
    const y = convertDeltaToYZ({ RAB: a, RBC: b, RCA: c }), d = convertYToDeltaZ(y);
    const scale = Math.max(Math.hypot(a.re, a.im), Math.hypot(b.re, b.im), Math.hypot(c.re, c.im));
    zn(d.RAB, a, 1e-9 * scale, "Z_AB"); zn(d.RBC, b, 1e-9 * scale, "Z_BC"); zn(d.RCA, c, 1e-9 * scale, "Z_CA");
    const back = convertDeltaToYZ(convertYToDeltaZ({ RA: a, RB: b, RC: c }));
    zn(back.RA, a, 1e-9 * scale, "Z_A"); zn(back.RB, b, 1e-9 * scale, "Z_B"); zn(back.RC, c, 1e-9 * scale, "Z_C");
  }
  // the toggle keeps the same network: results become inputs and come back
  const start = toY(z(10), z(0, 10), z(10, -10)), flipped = toggleComplexDirection(start);
  assert.equal(flipped.direction, "toDelta");
  zn(flipped.values.RA, z(5, -5), 1e-12);
  const again = toggleComplexDirection(flipped);
  zn(again.values.RAB, z(10), 1e-12); zn(again.values.RBC, z(0, 10), 1e-12); zn(again.values.RCA, z(10, -10), 1e-12);
});

test("terminal pairs: Y (Z_A+Z_B …) and Δ (Z_AB ∥ (Z_BC+Z_CA) …) agree for all three pairs; a wrong Δ is caught", () => {
  for (const state of [toY(z(10), z(0, 10), z(10, -10)), toDelta(z(3, 4), z(6, -2), z(4)), toY(z(15, 10), z(15, 10), z(15, 10))]) {
    const r = evaluateComplexTool(state);
    assert.deepEqual(r.pairs.map((p) => p.pair), ["A–B", "B–C", "C–A"]);
    assert.ok(r.pairs.every((p) => p.pass), JSON.stringify(r.pairs));
  }
  // by hand for the first state: Y = (5−j5, j5, 5+j5): A–B = 5, B–C = 5+j10, C–A = 10; Δ = (10, j10, 10−j10): A–B = 10 ∥ (10) = 5 ✓
  const y = { RA: z(5, -5), RB: z(0, 5), RC: z(5, 5) }, d = { RAB: z(10), RBC: z(0, 10), RCA: z(10, -10) };
  const pairs = terminalPairs(y, d);
  zn(pairs[0].fromY, z(5), 1e-12); zn(pairs[1].fromY, z(5, 10), 1e-12); zn(pairs[2].fromY, z(10), 1e-12);
  zn(pairs[0].fromDelta, z(5), 1e-12); zn(pairs[1].fromDelta, z(5, 10), 1e-12); zn(pairs[2].fromDelta, z(10), 1e-12);
  const wrong = terminalPairs(y, { ...d, RAB: z(11) });
  assert.ok(wrong.some((p) => !p.pass), "a changed side no longer matches");
});

test("a zero denominator is refused with the reason and attemptComplex says so (the controller then keeps the last result)", () => {
  // Δ: Σ = 10 + (−10) + 0 = 0
  assert.throws(() => convertDeltaToYZ({ RAB: z(10), RBC: z(-10), RCA: z(0) }), /Σ.*0/);
  const sigmaZero = attemptComplex(toY(z(3, 4), z(-3, -4), z(0)));
  assert.equal(sigmaZero.ok, false); assert.match(sigmaZero.reason, /Σ = Z_AB \+ Z_BC \+ Z_CA 가 0/);
  // complex cancellation too: (5+j5) + (−5+j2) + (−j7) = 0
  assert.equal(attemptComplex(toY(z(5, 5), z(-5, 2), z(0, -7))).ok, false);
  // Y: S = 1·1 + 1·(−½) + (−½)·1 = 0
  const sZero = attemptComplex(toDelta(z(1), z(1), z(-0.5)));
  assert.equal(sZero.ok, false); assert.match(sZero.reason, /S = Z_A·Z_B/);
  // a zero arm: the opposite side would be infinite
  const arm = attemptComplex(toDelta(z(0), z(2), z(3)));
  assert.equal(arm.ok, false); assert.match(arm.reason, /Z_A=0.*Z_BC/);
  // the usual cases are fine
  assert.equal(attemptComplex(toY(z(15, 10), z(15, 10), z(15, 10))).ok, true);
});

test("typed text: complex-calculator syntax (3+j4, 5∠53.13°, j10, −2−j), and a bad text keeps the state with a reason", () => {
  const state = createComplexState("toDelta");
  const typed = (text) => { const r = withComplexText(state, "RA", text); assert.equal(r.ok, true, `${text}: ${r.reason}`); return r.state.values.RA; };
  zn(typed("3+j4"), z(3, 4)); zn(typed("5∠53.13010235415598°"), z(3, 4), 1e-9); zn(typed("j10"), z(0, 10)); zn(typed("-2-j"), z(-2, -1)); zn(typed("5"), z(5)); zn(typed("(1+j)*(1-j)"), z(2));
  for (const bad of ["", "3+", "abc", "5V", "1/0", "3+j4+"]) {
    const r = withComplexText(state, "RA", bad);
    assert.equal(r.ok, false, `"${bad}" is refused`); assert.match(r.reason, /Z_A/);
  }
  assert.throws(() => withComplexValue(state, "RAB", z(1)), /입력할 수 없는/);
  assert.throws(() => parseImpedanceInput("2+", "Z_B"), /Z_B/);
});

test("field text round trip: the draft of a value parses back to the same value (re, im signs, zero parts)", () => {
  for (const value of [z(3, 4), z(5, -10 / 3), z(-2, 7), z(0, -4), z(0, 4), z(12), z(-0.5), z(1e-7, 2e-7), z(123456.789, -0.00123)]) {
    const text = impedanceDraft(value), back = parseImpedanceInput(text);
    zn(back, value, 1e-9 * Math.hypot(value.re, value.im), text);
  }
  assert.equal(impedanceDraft(z(3, 4)), "3+j4"); assert.equal(impedanceDraft(z(5, -4)), "5-j4"); assert.equal(impedanceDraft(z(0, 10)), "j10"); assert.equal(impedanceDraft(z(7)), "7");
});

test("with zero imaginary parts the complex formulas equal the resistor tool's (1 kΩ, 2 kΩ, 3 kΩ both ways)", () => {
  const r = convertYToDelta({ RA: "1k", RB: "2k", RC: "3k" }), c = convertYToDeltaZ({ RA: z(1e3), RB: z(2e3), RC: z(3e3) });
  near(c.RAB.re, r.RAB, 1e-6); near(c.RBC.re, r.RBC, 1e-6); near(c.RCA.re, r.RCA, 1e-6); near(c.RAB.im, 0, 1e-9);
  const d = convertDeltaToY({ RAB: "3k", RBC: "6k", RCA: "9k" }), e = convertDeltaToYZ({ RAB: z(3e3), RBC: z(6e3), RCA: z(9e3) });
  near(e.RA.re, d.RA, 1e-6); near(e.RB.re, d.RB, 1e-6); near(e.RC.re, d.RC, 1e-6);
});

test("the three one-press examples evaluate, pass the terminal-pair check, and the balanced one is the 15+j10 case", () => {
  assert.equal(COMPLEX_EXAMPLES.length, 3);
  for (const example of COMPLEX_EXAMPLES) {
    const keys = example.direction === "toY" ? ["RAB", "RBC", "RCA"] : ["RA", "RB", "RC"];
    const values = Object.fromEntries(keys.map((key, i) => [key, parseImpedanceInput(example.texts[i])]));
    const r = evaluateComplexTool({ direction: example.direction, values });
    assert.ok(r.pairs.every((p) => p.pass), example.label);
  }
  const balanced = evaluateComplexTool({ direction: "toY", values: { RAB: z(15, 10), RBC: z(15, 10), RCA: z(15, 10) } });
  assert.equal(balanced.balanced, true);
});
