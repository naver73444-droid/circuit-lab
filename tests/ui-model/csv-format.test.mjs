import test from "node:test";
import assert from "node:assert/strict";
import { simulateDC } from "../../src/circuit-engine.js";
import { cloneExample } from "../../src/examples.js";
import { buildResultsCSV, parseCSV, stringifyCSV } from "../../src/csv-format.js";

function nodeFor(result, componentId, pin) {
  return result.topology.nodeIdByPin[`${componentId}:${pin}`];
}

function voltage(result, pointIndex, componentId, pin = 0) {
  return result.points[pointIndex].nodeVoltages[nodeFor(result, componentId, pin)];
}

test("CSV는 쉼표·따옴표·줄바꿈을 escape하고 실제 parser로 같은 열을 복원한다", () => {
  const edgeRows = [["label", "value"], ["I(R1, 1→2)", 0.01], ['quote "inside"', "line1\nline2"]];
  assert.deepEqual(parseCSV(stringifyCSV(edgeRows)), edgeRows.map((row) => row.map(String)));
  const result = { analysis: "dc", xValues: [0] };
  const series = [
    { probe: { kind: "voltage", label: "V(out)" }, raw: [10], values: [10], unit: "V" },
    { probe: { kind: "current", label: "I(R1, 1→2)" }, raw: [0.01], values: [10], unit: "mA" },
    { probe: { kind: "current", label: "I(R2, 1→2)" }, raw: [0.00001], values: [0.01], unit: "mA" },
  ];
  const parsed = parseCSV(buildResultsCSV(result, series));
  assert.equal(parsed[0].length, 4);
  assert.equal(parsed[1].length, 4);
  assert.deepEqual(parsed[0], ["operating_point", "V(out)_V", "I(R1, 1→2)_A", "I(R2, 1→2)_A"]);
  assert.deepEqual(parsed[1].map(Number), [0, 10, 0.01, 0.00001]);
});

test("zero AC exports as -Infinity and an empty phase cell", () => {
  const result = { analysis: "ac", xValues: [1000] };
  const rows = parseCSV(buildResultsCSV(result, [{ probe: { kind: "voltage", label: "V0" }, raw: [{ re: 0, im: 0 }] }]));
  assert.deepEqual(rows[1], ["1000", "-Infinity", ""]);
});

test("text CSV formula prefix is escaped without changing negative numeric samples", () => {
  const result = { analysis: "dc", xValues: [0] };
  const rows = parseCSV(buildResultsCSV(result, [{ probe: { kind: "current", label: "=2+2" }, raw: [-.001] }]));
  assert.equal(rows[0][1], "'=2+2_A"); assert.equal(rows[1][1], "-0.001");
});

test('displayed current scale does not change raw CSV values',()=>{
  const result=simulateDC(cloneExample('divider').circuit);const series=[{probe:{kind:'current',label:'I(R1)'},raw:[.005],values:[5],unit:'mA'}];
  const csv=parseCSV(buildResultsCSV(result,series));assert.equal(Number(csv[1][1]),.005);
});
