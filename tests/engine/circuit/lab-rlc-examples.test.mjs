// 11/05 실험 편집기 예제(구형 0→6 V·1 kHz·듀티 50 %, 전원 + → L 1 mH → C 100 nF → R → 전원 −, R = 27·200·2200 Ω):
// 감쇠 종류별 v_C 모양을 손계산과 대조한다. 엔진은 후진 오일러라 간격 0.2 µs에서 27 Ω 울림이 조금 더 빨리 줄어든다
// (감쇠율 13.5 k/s → 약 14.46 k/s, 울림 99.09 → 98.81 krad/s): 기대값은 정확값과 이 근사값을 함께 적고 허용 범위로 둘 다 받는다.
import test from "node:test";
import assert from "node:assert/strict";
import { simulate } from "../../../src/circuit-engine.js";
import { cloneExample, examples } from "../../../src/examples.js";

const L = 1e-3, C = 100e-9, W0 = 1 / Math.sqrt(L * C);
const runs = new Map();
function run(id) {
  if (runs.has(id)) return runs.get(id);
  const example = cloneExample(id);
  const result = simulate(example.circuit, example.settings);
  const n = result.topology.nodeIdByPin, dt = result.xValues[1] - result.xValues[0];
  const at = (time) => Math.round(time / dt);
  const point = (time) => result.points[at(time)];
  const vC = (time) => point(time).nodeVoltages[n["C1:0"]] - point(time).nodeVoltages[n["C1:1"]];
  const vs = (time) => point(time).nodeVoltages[n["V1:0"]];
  const i = (time) => point(time).componentCurrents.R1;
  /** The largest and smallest v_C between two times, and when the largest happens. */
  const extremes = (from = 0, to = result.xValues.at(-1)) => {
    let max = -Infinity, min = Infinity, when = 0;
    for (let k = at(from); k <= Math.min(at(to), result.points.length - 1); k += 1) {
      const v = result.points[k].nodeVoltages[n["C1:0"]] - result.points[k].nodeVoltages[n["C1:1"]];
      if (v > max) { max = v; when = result.xValues[k]; }
      min = Math.min(min, v);
    }
    return { max, min, when };
  };
  const out = { example, result, vC, vs, i, extremes };
  runs.set(id, out);
  return out;
}
const within = (actual, low, high, label) => assert.ok(actual >= low && actual <= high, `${label}: ${actual} (기대 ${low} ~ ${high})`);

test("11/05 실험 예제 3개: 이름·R·시간응답 설정, ω0 = 100 krad/s와 ζ = 0.135·1·11", () => {
  const expected = [["lab-rlc-27", "27", 0.135], ["lab-rlc-200", "200", 1], ["lab-rlc-2k2", "2.2k", 11]];
  assert.ok(Math.abs(W0 - 1e5) < 1e-6, `ω0 = ${W0}`);
  for (const [id, value, zeta] of expected) {
    const example = examples.find((item) => item.id === id);
    assert.ok(example, id);
    assert.match(example.name, /^RLC 직렬 실험 11\/05 \(/);
    assert.equal(example.circuit.components.find((part) => part.id === "R1").props.value, value);
    assert.deepEqual(example.settings, { analysis: "transient", start: "0", end: "3m", step: "0.2u" });
    const R = Number(value.replace("k", "e3"));
    assert.ok(Math.abs(R / (2 * L) / W0 - zeta) < 1e-12, `${id}: ζ = α/ω0`);
    assert.match(example.description, new RegExp(`ζ = (α/ω0 = )?${String(zeta).replace(".", "\\.")} `));
  }
});

test("11/05 실험 전원: 구형 0→6 V, 1 kHz, 듀티 50 % (0.25 ms에 6 V, 0.75 ms에 0 V)", () => {
  const { vs } = run("lab-rlc-27");
  assert.ok(Math.abs(vs(0.25e-3) - 6) < 1e-9, `vs(0.25 ms) = ${vs(0.25e-3)}`);
  assert.ok(Math.abs(vs(0.75e-3)) < 1e-9, `vs(0.75 ms) = ${vs(0.75e-3)}`);
  assert.ok(Math.abs(vs(2.25e-3) - 6) < 1e-9, `vs(2.25 ms) = ${vs(2.25e-3)}`);
});

test("27 Ω 부족감쇠: v_C 첫 최대 ≈ 6 + 6·e^(−ζπ/√(1−ζ²)) (정확 9.911 V, 0.2 µs 후진 오일러 ≈ 9.79 V), t ≈ π/ωd ≈ 31.7 µs", () => {
  const { vC, i, extremes } = run("lab-rlc-27");
  const zeta = 0.135, exact = 6 + 6 * Math.exp((-zeta * Math.PI) / Math.sqrt(1 - zeta ** 2));
  assert.ok(Math.abs(exact - 9.911) < 0.001, `손계산 ${exact}`);
  const first = extremes(0, 0.5e-3);
  within(first.max, 9.6, 10.1, "첫 최대 v_C");
  within(first.when, 30.5e-6, 33e-6, "첫 최대 시각");
  // i = C dv_C/dt ≈ (6/(L·ωd))·e^(−αt)·sin(ωd t): 10 µs에서 정확 44.2 mA, 후진 오일러 ≈ 43.8 mA. 양수 = + → L → C → R 방향.
  within(i(10e-6), 0.040, 0.047, "i(10 µs) [A]");
  // 0.49 ms면 포락선 6·e^(−α·t) ≈ 0.005 V까지 줄어 반주기마다 6 V·0 V에 닿는다(셋째 주기도 같음).
  assert.ok(Math.abs(vC(0.49e-3) - 6) < 0.05, `v_C(0.49 ms) = ${vC(0.49e-3)}`);
  assert.ok(Math.abs(vC(0.99e-3)) < 0.05, `v_C(0.99 ms) = ${vC(0.99e-3)}`);
  assert.ok(Math.abs(vC(2.49e-3) - 6) < 0.05, `v_C(2.49 ms) = ${vC(2.49e-3)}`);
  assert.ok(Math.abs(vC(2.99e-3)) < 0.05, `v_C(2.99 ms) = ${vC(2.99e-3)}`);
});

test("200 Ω 임계감쇠: 넘침 없이 0 ~ 6 V, v_C(10 µs) = 6[1 − 2e^(−1)] ≈ 1.585 V, 반주기 끝 6 V", () => {
  const { vC, extremes } = run("lab-rlc-200");
  const all = extremes();
  assert.ok(all.max <= 6.05, `최대 v_C ${all.max}`);
  assert.ok(all.min >= -0.05, `최소 v_C ${all.min}`);
  const t = 1 / W0, expected = 6 * (1 - (1 + W0 * t) * Math.exp(-W0 * t));
  assert.ok(Math.abs(expected - 1.5854) < 0.001, `손계산 ${expected}`);
  assert.ok(Math.abs(vC(t) - expected) < 0.1, `v_C(10 µs) = ${vC(t)} vs ${expected}`);
  assert.ok(Math.abs(vC(0.49e-3) - 6) < 0.05, `v_C(0.49 ms) = ${vC(0.49e-3)}`);
  assert.ok(Math.abs(vC(0.99e-3)) < 0.05, `v_C(0.99 ms) = ${vC(0.99e-3)}`);
});

test("2.2 kΩ 과감쇠: 넘침 없음, 느린 극 τ ≈ 220 µs라 반주기 끝에도 6 V에 못 미침(0.49 ms ≈ 5.36 V, 정상상태 ≈ 5.42 V·0.59 V)", () => {
  const { vC, i, extremes } = run("lab-rlc-2k2");
  const R = 2200, alpha = R / (2 * L), s1 = -alpha + Math.sqrt(alpha ** 2 - W0 ** 2), s2 = -alpha - Math.sqrt(alpha ** 2 - W0 ** 2);
  assert.ok(Math.abs(-1 / s1 - 219.6e-6) < 0.1e-6, `τ = ${-1 / s1}`);
  // v_C = 6[1 − (s2·e^(s1 t) − s1·e^(s2 t))/(s2 − s1)]: 빠른 극(τ ≈ 0.46 µs)은 금방 사라진다.
  const step = (t) => 6 * (1 - (s2 * Math.exp(s1 * t) - s1 * Math.exp(s2 * t)) / (s2 - s1));
  assert.ok(Math.abs(step(0.49e-3) - 5.355) < 0.002, `손계산 ${step(0.49e-3)}`);
  within(vC(0.49e-3), 5.25, 5.45, "v_C(0.49 ms)");
  const all = extremes();
  assert.ok(all.max <= 6.05, `최대 v_C ${all.max}`);
  assert.ok(all.max < 5.6, `6 V에 닿지 않음: 최대 ${all.max}`);
  // 정상상태: 높은 반주기 끝 V_H = 6/(1 + x), 낮은 끝 V_L = 6x/(1 + x), x = e^(−0.5 ms/τ) ≈ 0.1026 → 5.44 V·0.56 V.
  // 셋째 주기의 0.49 ms 지점: 6 − (6 − V_L)·e^(−0.49 ms/τ) ≈ 5.42 V, V_H·e^(−0.49 ms/τ) ≈ 0.59 V.
  within(vC(2.49e-3), 5.3, 5.5, "v_C(2.49 ms)");
  within(vC(2.99e-3), 0.5, 0.7, "v_C(2.99 ms)");
  // i(10 µs) ≈ 6C·s1·s2/(s2 − s1)·e^(s1 t) ≈ 2.62 mA (≈ 6 V/R).
  within(i(10e-6), 2.5e-3, 2.75e-3, "i(10 µs) [A]");
});
