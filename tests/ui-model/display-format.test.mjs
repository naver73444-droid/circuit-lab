import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { simulateDC } from "../../src/circuit-engine.js";
import { acMagnitudeLevel, acPhaseDegrees, currentDisplayScale, displayAxes } from "../../src/plot-format.js";
import { deserializeProject } from "../../src/project-format.js";
import { phasorAxis, quantityDisplayScale } from "../../src/phasor-format.js";

function nodeFor(result, componentId, pin) {
  return result.topology.nodeIdByPin[`${componentId}:${pin}`];
}

function voltage(result, pointIndex, componentId, pin = 0) {
  return result.points[pointIndex].nodeVoltages[nodeFor(result, componentId, pin)];
}

test("혼합 전압·전류 trace는 단위별 독립 축과 공통 전류 배율을 사용한다", () => {
  const currentScale = currentDisplayScale([[0, 0.005], [0, 0.000005]]);
  assert.deepEqual(currentScale, { scale: 1e3, unit: "mA" });
  assert.deepEqual(currentDisplayScale([[0.2]]), { scale: 1, unit: "A" });
  assert.deepEqual(currentDisplayScale([[0.00005]]), { scale: 1e6, unit: "µA" });
  const axes = displayAxes([
    { unit: "V", values: [0, 10] },
    { unit: "mA", values: [0, 5] },
    { unit: "mA", values: [0, 0.005] },
  ], [0, 1]);
  assert.deepEqual(axes.map((axis) => axis.unit), ["V", "mA"]);
  assert.equal(axes[0].items.length, 1);
  assert.equal(axes[1].items.length, 2);
  assert.notEqual(axes[0].minimum, axes[1].minimum);
  assert.deepEqual(displayAxes([{ unit: "dBV", values: [0] }, { unit: "dBA", values: [-60] }], [0]).map((axis) => axis.unit), ["dBV", "dBA"]);
  assert.deepEqual(displayAxes([{ unit: "°", values: [-45] }, { unit: "°", values: [-90] }], [0]).map((axis) => axis.unit), ["°"]);
});

test("혼합 프로브 검증 파일은 10 V·10 mA·10 µA를 계산한다", () => {
  const project = deserializeProject(readFileSync(new URL("../fixtures/mixed-probe-units.json", import.meta.url), "utf8"));
  const result = simulateDC(project.circuit);
  assert.equal(result.points[0].nodeVoltages[nodeFor(result, "V1", 0)], 10);
  assert.equal(result.points[0].componentCurrents.R1, 0.01);
  assert.equal(result.points[0].componentCurrents.R2, 0.00001);
  assert.deepEqual(currentDisplayScale([[result.points[0].componentCurrents.R1], [result.points[0].componentCurrents.R2]]), { scale: 1e3, unit: "mA" });
});

test("페이저 평면은 물리량별 공통 배율을 사용한다", () => {
  assert.deepEqual(quantityDisplayScale([], "A"), { scale: 1, unit: "A" });
  assert.deepEqual(quantityDisplayScale([{ re: 0.01, im: 0 }, { re: 0.00001, im: 0 }], "A"), { scale: 1e3, unit: "mA" });
  assert.deepEqual(quantityDisplayScale([{ re: 5, im: 0 }, { re: 0.002, im: 0 }], "V"), { scale: 1, unit: "V" });
  assert.deepEqual(quantityDisplayScale([{ re: 0.00005, im: 0 }], "V"), { scale: 1e6, unit: "µV" });
});

test("페이저 숫자축은 물리량별 실제 범위와 같은 물리량의 상대 크기를 보존한다", () => {
  const voltage = phasorAxis([{ re: 1.2, im: 0 }, { re: 0.12, im: 0 }], "V");
  assert.deepEqual(voltage, { scale: 1, unit: "V", minimum: -2, maximum: 2, ticks: [2, 1, 0, -1, -2] });
  assert.equal((1.2 * voltage.scale / voltage.maximum) / (0.12 * voltage.scale / voltage.maximum), 10);
  const current = phasorAxis([{ re: 0.01, im: 0 }, { re: 0.00001, im: 0 }], "A");
  assert.deepEqual(current, { scale: 1e3, unit: "mA", minimum: -10, maximum: 10, ticks: [10, 5, 0, -5, -10] });
  assert.notEqual(voltage.maximum, current.maximum);
  assert.deepEqual(phasorAxis([{ re: 0, im: 0 }], "V"), { scale: 1, unit: "V", minimum: -1, maximum: 1, ticks: [1, .5, 0, -.5, -1] });
});

test("zero AC amplitude is minus infinity, not an artificial floor", () => {
  assert.equal(acMagnitudeLevel({ re: 0, im: 0 }, "V").value, -Infinity);
  assert.equal(acPhaseDegrees({ re: 0, im: 0 }), null);
});
