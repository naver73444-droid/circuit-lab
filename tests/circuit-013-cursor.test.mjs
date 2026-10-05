import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { axisSide, cursorIndexAfterKey, isTapGesture, layoutCursorLabels } from "../src/cursor-label-model.js";
import { extremaIndices, nearestSampleIndex } from "../src/scope-model.js";
import * as candidateEngine from "../src/circuit-engine.js";
import * as candidateProject from "../src/project-format.js";
import * as candidateCsv from "../src/csv-format.js";
import * as parentEngine from "./frozen/CIRCUIT-012/src/circuit-engine.js";
import * as parentProject from "./frozen/CIRCUIT-012/src/project-format.js";
import * as parentCsv from "./frozen/CIRCUIT-012/src/csv-format.js";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/circuit-013-scope.json", import.meta.url), "utf8"));
const geometry = { top: 28, plotHeight: 236, left: 68, plotWidth: 720 };
const axes = new Map([
  ["V", { minimum: -5, maximum: 5 }],
  ["A", { minimum: -0.01, maximum: 0.01 }],
]);
const baseSeries = [
  { key: "V:R1:0", label: "V(R1+)", quantity: "V", color: "#176baf", values: fixture.ui.voltage },
  { key: "I:R1", label: "I(R1, 1→2)", quantity: "A", color: "#c0392b", values: fixture.ui.current },
];

function layout(index, options = {}) {
  return layoutCursorLabels({
    series: options.series ?? baseSeries,
    index,
    axes: options.axes ?? axes,
    xAxis: options.xAxis ?? { minimum: 0, maximum: 0.0025 },
    xValue: fixture.ui.xValues[index],
    geometry: options.geometry ?? geometry,
  });
}

test("CIRCUIT-013 raw mixed-unit samples retain sign, zero, side, and index", () => {
  for (const [index, voltage, current] of [[1, 5, 0.005], [2, -2, -0.00001], [0, 0, 0]]) {
    const result = layout(index);
    assert.equal(result.entries.find((entry) => entry.quantity === "V").value, voltage);
    assert.equal(result.entries.find((entry) => entry.quantity === "A").value, current);
    assert.equal(result.entries.find((entry) => entry.quantity === "V").side, "left");
    assert.equal(result.entries.find((entry) => entry.quantity === "A").side, "right");
  }
});

test("CIRCUIT-013 nearest sample uses irregular x coordinates and earlier tie", () => {
  assert.equal(nearestSampleIndex(fixture.ui.xValues, 0.0024), 3);
  assert.equal(nearestSampleIndex(fixture.ui.xValues, 0.0015), 1);
});

test("CIRCUIT-013 narrow spike remains a selectable raw index after extrema reduction", () => {
  const x = Array.from({ length: 10000 }, (_, index) => index * 1e-6);
  const voltage = x.map(() => 0);
  voltage[5001] = 7;
  const selected = extremaIndices(x, voltage, 0, x.at(-1), 390);
  assert.ok(selected.includes(5001));
  assert.deepEqual([5000, 5001, 5002].map((index) => voltage[index]), [0, 7, 0]);
  assert.equal(cursorIndexAfterKey(5000, "ArrowRight", x.length), 5001);
  assert.equal(cursorIndexAfterKey(5001, "ArrowRight", x.length), 5002);
});

test("CIRCUIT-013 tap threshold and keyboard entry policy are exact", () => {
  assert.equal(isTapGesture(6), true);
  assert.equal(isTapGesture(6.000001), false);
  assert.equal(cursorIndexAfterKey(null, "ArrowRight", 4), 0);
  assert.equal(cursorIndexAfterKey(null, "ArrowLeft", 4), 0);
  assert.equal(cursorIndexAfterKey(2, "Home", 4), 0);
  assert.equal(cursorIndexAfterKey(2, "End", 4), 3);
});

test("CIRCUIT-013 voltage-only and current-only axes keep physical sides", () => {
  assert.equal(axisSide("V"), "left");
  assert.equal(axisSide("A"), "right");
  assert.equal(layout(1, { series: [baseSeries[0]], axes: new Map([["V", axes.get("V")]]) }).placed[0].side, "left");
  assert.equal(layout(1, { series: [baseSeries[1]], axes: new Map([["A", axes.get("A")]]) }).placed[0].side, "right");
});

test("CIRCUIT-013 overlapping labels are stable, complete, and bounded at narrow width", () => {
  const series = [];
  for (const quantity of ["V", "A"]) for (let index = 0; index < 4; index += 1) {
    series.push({ key: `${quantity}:${index}`, label: `${quantity} very long trace label ${index}`, quantity, color: `#${index + 2}${index + 2}6688`, values: [quantity === "V" ? 1 : 0.001] });
  }
  const result = layoutCursorLabels({ series, index: 0, axes, xAxis: { minimum: 0, maximum: 1 }, xValue: 0, geometry: { ...geometry, plotWidth: 222 } });
  assert.equal(result.entries.length, 8);
  assert.equal(result.placed.length, 8);
  assert.equal(result.hiddenCount, 0);
  for (const side of ["left", "right"]) {
    const placed = result.placed.filter((entry) => entry.side === side);
    assert.equal(placed.length, 4);
    assert.ok(placed.every((entry) => entry.badgeY >= geometry.top && entry.badgeY <= geometry.top + geometry.plotHeight));
    for (let index = 1; index < placed.length; index += 1) assert.ok(placed[index].badgeY - placed[index - 1].badgeY >= 22);
  }
});

test("CIRCUIT-013 offscreen and non-finite samples never become normal badges", () => {
  const offscreen = layout(2, { xAxis: { minimum: 0, maximum: 0.001 } });
  assert.ok(offscreen.entries.every((entry) => entry.offscreen));
  assert.equal(offscreen.placed.length, 0);
  const invalid = layoutCursorLabels({
    series: [{ key: "bad", label: "bad", quantity: "V", color: "#176baf", values: [null, NaN, Infinity] }],
    index: 1,
    axes,
    xAxis: { minimum: 0, maximum: 1 },
    xValue: 0,
    geometry,
  });
  assert.equal(invalid.entries[0].valid, false);
  assert.equal(invalid.placed.length, 0);
});

function node(result, point, id, pin) {
  return point.nodeVoltages[result.topology.nodeIdByPin[`${id}:${pin}`]];
}

function electrical(result) {
  return {
    analysis: result.analysis,
    xValues: result.xValues,
    points: result.points.map((point) => ({ V: node(result, point, "R1", 0), I: point.componentCurrents.R1 })),
  };
}

function seriesFor(result, project) {
  return project.probes.map((probe) => ({
    probe,
    raw: probe.kind === "voltage"
      ? result.points.map((point) => node(result, point, probe.componentId, probe.pin))
      : result.points.map((point) => point.componentCurrents[probe.componentId]),
  }));
}

const close = (actual, expected, atol, rtol) => assert.ok(Math.abs(actual - expected) <= atol + rtol * Math.abs(expected), `${actual} != ${expected}`);

test("CIRCUIT-013 actual SIN transient keeps parent raw and CSV bytes", () => {
  const text = JSON.stringify(fixture.project);
  const parent = parentProject.deserializeProject(text);
  const candidate = candidateProject.deserializeProject(text);
  const parentResult = parentEngine.simulateTransient(parent.circuit, parent.settings);
  const candidateResult = candidateEngine.simulateTransient(candidate.circuit, candidate.settings);
  assert.deepEqual(electrical(candidateResult), electrical(parentResult));
  assert.equal(candidateCsv.buildResultsCSV(candidateResult, seriesFor(candidateResult, candidate)), parentCsv.buildResultsCSV(parentResult, seriesFor(parentResult, parent)));
  const quarter = candidateResult.points[nearestSampleIndex(candidateResult.xValues, 0.00025)];
  const threeQuarter = candidateResult.points[nearestSampleIndex(candidateResult.xValues, 0.00075)];
  close(node(candidateResult, quarter, "R1", 0), 5, 1e-9, 1e-8);
  close(quarter.componentCurrents.R1, 0.005, 1e-11, 1e-8);
  close(node(candidateResult, threeQuarter, "R1", 0), -5, 1e-9, 1e-8);
  close(threeQuarter.componentCurrents.R1, -0.005, 1e-11, 1e-8);
});
