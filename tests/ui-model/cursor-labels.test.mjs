import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { axisSide, cursorIndexAfterKey, isTapGesture, layoutCursorLabels, advanceCursorPointerSession } from "../../src/cursor-label-model.js";
import { extremaIndices, nearestSampleIndex } from "../../src/scope-model.js";
import { simulateTransient } from "../../src/circuit-engine.js";
import { deserializeProject } from "../../src/project-format.js";
import { buildResultsCSV, parseCSV } from "../../src/csv-format.js";

describe("cursor labels", () => {
  const fixture = JSON.parse(readFileSync(new URL("../fixtures/scope-sine.json", import.meta.url), "utf8"));

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

  test("raw mixed-unit samples retain sign, zero, side, and index", () => {
    for (const [index, voltage, current] of [[1, 5, 0.005], [2, -2, -0.00001], [0, 0, 0]]) {
      const result = layout(index);
      assert.equal(result.entries.find((entry) => entry.quantity === "V").value, voltage);
      assert.equal(result.entries.find((entry) => entry.quantity === "A").value, current);
      assert.equal(result.entries.find((entry) => entry.quantity === "V").side, "left");
      assert.equal(result.entries.find((entry) => entry.quantity === "A").side, "right");
    }
  });

  test("nearest sample uses irregular x coordinates and earlier tie", () => {
    assert.equal(nearestSampleIndex(fixture.ui.xValues, 0.0024), 3);
    assert.equal(nearestSampleIndex(fixture.ui.xValues, 0.0015), 1);
  });

  test("narrow spike remains a selectable raw index after extrema reduction", () => {
    const x = Array.from({ length: 10000 }, (_, index) => index * 1e-6);
    const voltage = x.map(() => 0);
    voltage[5001] = 7;
    const selected = extremaIndices(x, voltage, 0, x.at(-1), 390);
    assert.ok(selected.includes(5001));
    assert.deepEqual([5000, 5001, 5002].map((index) => voltage[index]), [0, 7, 0]);
    assert.equal(cursorIndexAfterKey(5000, "ArrowRight", x.length), 5001);
    assert.equal(cursorIndexAfterKey(5001, "ArrowRight", x.length), 5002);
  });

  test("tap threshold and keyboard entry policy are exact", () => {
    assert.equal(isTapGesture(6), true);
    assert.equal(isTapGesture(6.000001), false);
    assert.equal(cursorIndexAfterKey(null, "ArrowRight", 4), 0);
    assert.equal(cursorIndexAfterKey(null, "ArrowLeft", 4), 0);
    assert.equal(cursorIndexAfterKey(2, "Home", 4), 0);
    assert.equal(cursorIndexAfterKey(2, "End", 4), 3);
  });

  test("voltage-only and current-only axes keep physical sides", () => {
    assert.equal(axisSide("V"), "left");
    assert.equal(axisSide("A"), "right");
    assert.equal(layout(1, { series: [baseSeries[0]], axes: new Map([["V", axes.get("V")]]) }).placed[0].side, "left");
    assert.equal(layout(1, { series: [baseSeries[1]], axes: new Map([["A", axes.get("A")]]) }).placed[0].side, "right");
  });

  test("overlapping labels are stable, complete, and bounded at narrow width", () => {
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

  test("offscreen and non-finite samples never become normal badges", () => {
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

  function seriesFor(result, project) {
    return project.probes.map((probe) => ({
      probe,
      raw: probe.kind === "voltage"
        ? result.points.map((point) => node(result, point, probe.componentId, probe.pin))
        : result.points.map((point) => point.componentCurrents[probe.componentId]),
    }));
  }

  const close = (actual, expected, atol, rtol) => assert.ok(Math.abs(actual - expected) <= atol + rtol * Math.abs(expected), `${actual} != ${expected}`);

  test("SIN 1 kHz transient samples, currents and CSV columns follow the analytic sine", () => {
    const project = deserializeProject(JSON.stringify(fixture.project));
    const result = simulateTransient(project.circuit, project.settings);
    const times = [0, 0.00025, 0.0005, 0.00075, 0.001];
    assert.equal(result.xValues.length, times.length);
    times.forEach((time, index) => close(result.xValues[index], time, 1e-15, 1e-12));
    const volts = times.map((time) => 5 * Math.sin(2 * Math.PI * 1000 * time));
    result.points.forEach((point, index) => {
      close(node(result, point, "R1", 0), volts[index], 1e-9, 1e-8);
      close(point.componentCurrents.R1, volts[index] / 1000, 1e-11, 1e-8);
    });
    assert.equal(nearestSampleIndex(result.xValues, 0.00025), 1);
    const rows = parseCSV(buildResultsCSV(result, seriesFor(result, project)));
    assert.equal(rows.length, times.length + 1);
    rows.slice(1).forEach((row, index) => {
      close(Number(row[1]), volts[index], 1e-9, 1e-8);
      close(Number(row[2]), volts[index] / 1000, 1e-11, 1e-8);
    });
  });
});

describe("crowded labels", () => {
  const axes = new Map([
    ["V", { minimum: -5, maximum: 5, division: 1, automatic: true }],
    ["A", { minimum: -0.01, maximum: 0.01, division: 0.002, automatic: true }],
  ]);

  const crowdedSeries = ["V", "A"].flatMap((quantity) => Array.from({ length: 4 }, (_, index) => ({
    key: `${quantity}:${index}`,
    label: `${quantity} very long trace label ${index}`,
    quantity,
    color: `#${index + 2}${index + 2}6688`,
    values: [quantity === "V" ? 1 : 0.001],
  })));

  const geometry = { top: 28, plotHeight: 64, left: 68, plotWidth: 222 };

  test("capacity keeps selected hidden trace visible on each physical axis", () => {
    const layout = layoutCursorLabels({
      series: crowdedSeries,
      index: 0,
      axes,
      xAxis: { minimum: 0, maximum: 1 },
      xValue: 0,
      geometry,
      selectedKeys: ["V:3", "A:3"],
    });
    assert.equal(layout.entries.length, 8);
    assert.equal(layout.hiddenCount, 2);
    assert.deepEqual(layout.placed.filter((entry) => entry.side === "left").map((entry) => entry.key), ["V:0", "V:1", "V:3"]);
    assert.deepEqual(layout.placed.filter((entry) => entry.side === "right").map((entry) => entry.key), ["A:0", "A:1", "A:3"]);
    for (const side of ["left", "right"]) {
      const placed = layout.placed.filter((entry) => entry.side === side);
      assert.ok(placed.every((entry) => entry.badgeY >= 38 && entry.badgeY <= 82));
      for (let index = 1; index < placed.length; index += 1) assert.ok(placed[index].badgeY - placed[index - 1].badgeY >= 22 - 1e-9);
    }
    // anchorY = top + (1 - (v - min) / (max - min)) * plotHeight = 28 + (1 - 6 / 10) * 64
    assert.ok(Math.abs(layout.entries.find((entry) => entry.key === "V:3").anchorY - 53.6) < 1e-9);
    assert.equal(layout.entries.find((entry) => entry.key === "A:3").value, 0.001);
  });

  test("pointer state measures CSS client distance and records final up point", () => {
    const start = { pointerId: 7, clientPoint: { x: 10, y: 10 }, point: { x: 100, y: 50 }, lastPoint: { x: 100, y: 50 }, maxDistance: 0 };
    const atSix = advanceCursorPointerSession(start, { x: 16, y: 10 }, { x: 160, y: 50 });
    assert.equal(atSix.maxDistance, 6);
    assert.deepEqual(atSix.lastPoint, { x: 160, y: 50 });
    const overOnUp = advanceCursorPointerSession(start, { x: 16.01, y: 10 }, { x: 160.1, y: 50 });
    assert.ok(overOnUp.maxDistance > 6);
    const returned = advanceCursorPointerSession(overOnUp, { x: 10, y: 10 }, { x: 100, y: 50 });
    assert.equal(returned.maxDistance, overOnUp.maxDistance);
    assert.deepEqual(returned.lastPoint, { x: 100, y: 50 });
  });
});
