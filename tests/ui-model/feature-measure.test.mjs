import test from "node:test";
import assert from "node:assert/strict";
import { cursorDelta, measureAll, measureCutoff, measureFinalValue, measurePeriod, measureStats, measureStepResponse, prepareSamples, MEASURE_BASIS } from "../../src/measure-model.js";
import { simulate } from "../../src/circuit-engine.js";
import { cloneExample } from "../../src/examples.js";
import { acMagnitudeLevel } from "../../src/measurement-format.js";

const near = (actual, expected, tolerance, message = "") => assert.ok(Math.abs(actual - expected) <= tolerance, `${message} ${actual} vs ${expected} (±${tolerance})`);
const rel = (actual, expected, fraction, message = "") => near(actual, expected, Math.abs(expected) * fraction, message);
function sample(count, dt, fn) {
  const x = Array.from({ length: count }, (_, i) => i * dt);
  return { x, y: x.map(fn) };
}
function lcg(seed) { let s = seed; return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296; }

test("사인파: min/max/Vpp/평균/RMS/주파수 (표본 기준)", () => {
  const A = 2, f = 50, offset = 1;
  const { x, y } = sample(10 * 200 + 1, 1 / f / 200, (t) => offset + A * Math.sin(2 * Math.PI * f * t));
  const stats = measureStats(x, y, { xUnit: "s", yUnit: "V" });
  rel(stats.max.value, offset + A, 1e-3);
  rel(stats.min.value, offset - A, 1e-3);
  rel(stats.vpp.value, 2 * A, 1e-3);
  rel(stats.mean.value, offset, 1e-3);
  const pure = sample(10 * 200 + 1, 1 / f / 200, (t) => A * Math.sin(2 * Math.PI * f * t));
  rel(measureStats(pure.x, pure.y).rms.value, A / Math.SQRT2, 1e-3, "RMS=A/√2");
  const period = measurePeriod(x, y, { xUnit: "s", yUnit: "V" });
  rel(period.period.value, 1 / f, 1e-3);
  rel(period.frequency.value, f, 1e-3);
  assert.equal(period.frequency.unit, "Hz");
  assert.equal(period.cycles, 8);
  assert.match(period.period.note, /선형보간/);
  assert.match(period.frequency.text, /Hz/);
});

test("사각파: 평균 0, RMS = 진폭, 주파수 1 kHz, 낮은 듀티에서도 중점 기준 교차", () => {
  const sq = sample(5 * 100, 1e-5, (t) => (Math.floor(t / 5e-4 + 1e-9) % 2 === 0 ? 1 : -1));
  const stats = measureStats(sq.x, sq.y);
  near(stats.mean.value, 0, 0.02);
  rel(stats.rms.value, 1, 0.01);
  rel(measurePeriod(sq.x, sq.y, { xUnit: "s" }).frequency.value, 1000, 0.01);
  const pulse = sample(1000, 1e-5, (t) => ((t % 1e-3) < 1e-4 - 1e-9 ? 5 : 0));
  rel(measurePeriod(pulse.x, pulse.y, { xUnit: "s" }).period.value, 1e-3, 0.01);
});

test("RC 계단: 상승시간 = RC·ln9, 최종값, 정착 시간", () => {
  const tau = 1e-3;
  const { x, y } = sample(1201, tau / 100, (t) => 5 * (1 - Math.exp(-t / tau)));
  const step = measureStepResponse(x, y, { xUnit: "s", yUnit: "V" });
  rel(step.riseTime.value, tau * Math.log(9), 0.01);
  assert.match(step.riseTime.note, /선형보간/);
  near(measureFinalValue(x, y, { yUnit: "V" }).value, 5, 1e-3);
  // ±2 % 정착: t = tau * ln(50) = 3.912 tau
  near(step.settlingTime.value, tau * Math.log(50), tau * 0.05);
  assert.equal(step.settlingTime.unit, "s");
});

test("엔진 RC 충전 예제 결과로 상승시간 측정 (5τ 구간이라 허용오차 5 %)", () => {
  const example = cloneExample("rc-charge");
  const result = simulate(example.circuit, example.settings);
  const node = result.topology.nodeIdByPin["C1:0"];
  const y = result.points.map((point) => point.nodeVoltages[node]);
  const all = measureAll(result.xValues, y, { xUnit: "s", yUnit: "V" });
  assert.equal(all.ok, true);
  assert.equal(all.basis, MEASURE_BASIS);
  rel(all.items.riseTime.value, 1e-3 * Math.log(9), 0.05);
  rel(all.items.final.value, 5, 0.01);
  assert.equal(all.items.period.value, null);
  assert.match(all.items.period.note, /주기/);
});

test("RC 저역통과 AC: −3 dB = 1/(2πRC), 엔진 예제로도 확인", () => {
  const R = 1e3, C = 1e-6, fc = 1 / (2 * Math.PI * R * C);
  const f = Array.from({ length: 121 }, (_, i) => 10 * 10 ** (i / 30));
  const db = f.map((v) => -10 * Math.log10(1 + (v / fc) ** 2));
  const cutoff = measureCutoff(f, db);
  assert.equal(cutoff.type, "lowpass");
  rel(cutoff.value, fc, 0.005);
  near(cutoff.referenceDb, 0, 0.02);
  assert.match(cutoff.note, /선형보간/);

  const example = cloneExample("rc-lowpass");
  const result = simulate(example.circuit, example.settings);
  const node = result.topology.nodeIdByPin["C1:0"];
  const levels = result.points.map((point) => acMagnitudeLevel(point.nodeVoltages[node], "V").value);
  const fromEngine = measureAll(result.xValues, levels, { domain: "frequency", yUnit: "dBV", xUnit: "Hz" });
  rel(fromEngine.items.cutoff.value, fc, 0.01);
  assert.ok(fromEngine.items.max && fromEngine.items.min);
});

test("고역통과·대역통과·찾을 수 없음", () => {
  const f = Array.from({ length: 200 }, (_, i) => 1 * 10 ** (i / 30));
  const hp = measureCutoff(f, f.map((v) => -10 * Math.log10(1 + (1000 / v) ** 2)));
  assert.equal(hp.type, "highpass");
  rel(hp.value, 1000, 0.01);
  const bp = measureCutoff(f, f.map((v) => -10 * Math.log10(1 + ((v / 1000 - 1000 / v) * 5) ** 2)));
  assert.equal(bp.type, "bandpass");
  assert.ok(bp.lower < 1000 && bp.upper > 1000 && bp.bandwidth > 0);
  const flat = measureCutoff(f, f.map(() => 0));
  assert.equal(flat.value, null);
  assert.ok(flat.note);
});

test("불균일 간격: 사다리꼴 적분 평균·RMS", () => {
  const rnd = lcg(7);
  const x = [0];
  while (x.at(-1) < 1) x.push(Math.min(1, x.at(-1) + 0.0005 + rnd() * 0.004));
  const ramp = measureStats(x, x.map((t) => t));
  near(ramp.mean.value, 0.5, 1e-9, "선형 함수 평균은 사다리꼴이 정확");
  rel(ramp.rms.value, Math.sqrt(1 / 3), 0.01);
  const sine = measureStats(x, x.map((t) => Math.sin(2 * Math.PI * 5 * t)));
  near(sine.mean.value, 0, 0.02);
  rel(sine.rms.value, Math.SQRT1_2, 0.03);
});

test("NaN/null 빈 구간: 극값은 유효 표본만, 적분은 빈 구간 제외", () => {
  const { x, y } = sample(101, 0.01, () => 3);
  y[40] = NaN; y[41] = null; y[70] = Infinity;
  const prep = prepareSamples(x, y);
  assert.equal(prep.dropped, 3);
  assert.equal(prep.gaps, 2);
  const stats = measureStats(x, y);
  near(stats.mean.value, 3, 1e-9);
  near(stats.rms.value, 3, 1e-9);
  assert.equal(stats.max.value, 3);
  assert.match(stats.mean.note, /누락 표본 3개/);
  const wave = sample(2001, 1e-4, (t) => Math.sin(2 * Math.PI * 50 * t));
  wave.y[500] = NaN;
  rel(measurePeriod(wave.x, wave.y, { xUnit: "s" }).frequency.value, 50, 0.01);
  assert.equal(measureAll([0, 1, 2], [NaN, NaN, NaN]).items.max.value, null);
});

test("너무 짧거나 측정 불가능한 신호는 null + 이유", () => {
  assert.equal(measureStats([], []).max.value, null);
  assert.match(measureStats([], []).max.note, /유효한 표본/);
  const one = measureStats([0], [4.2]);
  assert.equal(one.mean.value, 4.2);
  assert.equal(one.rms.value, 4.2);
  assert.match(one.mean.note, /1개/);
  const mismatch = measureAll([0, 1], [1]);
  assert.equal(mismatch.ok, false);
  assert.equal(measureAll([2, 1, 0], [1, 2, 3]).ok, false);
  const short = sample(150, 1 / 100, (t) => Math.sin(2 * Math.PI * t));
  const period = measurePeriod(short.x, short.y, { xUnit: "s" });
  assert.equal(period.period.value, null);
  assert.match(period.period.note, /2개 이상/);
  assert.equal(measurePeriod([0, 1, 2], [1, 1, 1]).period.value, null);
  const constant = sample(100, 1, () => 2);
  assert.match(measurePeriod(constant.x, constant.y).period.note, /일정/);
  const sine = sample(1000, 1e-4, (t) => Math.sin(2 * Math.PI * 50 * t));
  const step = measureStepResponse(sine.x, sine.y, { xUnit: "s" });
  assert.equal(step.riseTime.value, null);
  assert.equal(step.settlingTime.value, null);
  assert.match(step.riseTime.text, /측정 불가/);
  const dc = measureAll([0], [5], { xUnit: "s", yUnit: "V" });
  assert.equal(dc.items.mean.value, 5);
  assert.equal(dc.items.period.value, null);
});

test("두 커서 차이: Δx, Δy, 기울기, 1/Δx", () => {
  const { x, y } = sample(11, 0.001, (t) => 2 * t + 1);
  const d = cursorDelta(x, y, 2, 7, { xUnit: "s", yUnit: "V" });
  assert.equal(d.ok, true);
  near(d.dx.value, 0.005, 1e-12);
  near(d.dy.value, 0.01, 1e-12);
  near(d.slope.value, 2, 1e-9);
  near(d.inverse.value, 200, 1e-6);
  assert.equal(d.inverse.unit, "Hz");
  assert.equal(d.slope.unit, "V/s");
  const reversed = cursorDelta(x, y, 7, 2, { xUnit: "s" });
  assert.ok(reversed.dx.value < 0 && reversed.inverse.value > 0);
  const same = cursorDelta(x, y, 3, 3);
  assert.equal(same.slope.value, null);
  assert.equal(same.inverse.value, null);
  assert.equal(cursorDelta(x, y, 0, 99).ok, false);
  const gap = y.slice(); gap[4] = NaN;
  assert.equal(cursorDelta(x, gap, 4, 5).ok, false);
});
