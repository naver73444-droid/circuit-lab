import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { advanceCursorPointerSession, layoutCursorLabels } from "../src/cursor-label-model.js";

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

test("attempt-02 capacity keeps selected hidden trace visible on each physical axis", () => {
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
  assert.equal(layout.entries.find((entry) => entry.key === "V:3").anchorY, 65.8);
  assert.equal(layout.entries.find((entry) => entry.key === "A:3").value, 0.001);
});

test("attempt-02 pointer state measures CSS client distance and records final up point", () => {
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

class FakeElement {
  constructor({ width = 600, height = 320, svg = false } = {}) {
    this.clientWidth = width;
    this.clientHeight = height;
    this.listeners = new Map();
    this.dataset = {};
    this.cursor = svg ? new FakeElement() : null;
    this._innerHTML = "";
    this._textContent = "";
  }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  contains() { return false; }
  querySelector(selector) { return selector === "#scope-cursor" ? this.cursor : null; }
  setAttribute() {}
  replaceChildren() { this._innerHTML = ""; this._textContent = ""; }
  set innerHTML(value) { this._innerHTML = value; }
  get innerHTML() { return this._innerHTML; }
  set textContent(value) { this._textContent = value; this._innerHTML = ""; }
  get textContent() { return this._textContent || this._innerHTML.replace(/<[^>]+>/g, ""); }
}

globalThis.ResizeObserver = class { constructor(callback) { this.callback = callback; } observe() {} };
globalThis.document = { activeElement: null, documentElement: { dataset: { theme: "dark" } }, getElementById: () => null };
const { ScopeView } = await import("../src/scope-view.js");

function makeView({ width = 600, height = 320 } = {}) {
  const svg = new FakeElement({ width, height, svg: true });
  const controls = new FakeElement();
  const readout = new FakeElement();
  return { view: new ScopeView(svg, controls, readout), svg, controls, readout };
}

test("attempt-02 ScopeView list selects hidden badges, survives fit, and prunes deletion", () => {
  const { view, svg, readout } = makeView({ width: 390, height: 128 });
  const result = { analysis: "transient", xValues: [0], points: [{}] };
  view.setData(result, crowdedSeries);
  assert.equal(view.keyCursor("Home"), true);
  assert.match(readout.innerHTML, /V very long trace label 3/);
  assert.match(readout.innerHTML, /A very long trace label 3/);
  assert.match(readout.textContent, /배지 2개 숨김/);
  readout.listeners.get("click")({ target: { closest: () => ({ dataset: { cursorTraceKey: "V:3", axisSide: "left" } }) } });
  readout.listeners.get("click")({ target: { closest: () => ({ dataset: { cursorTraceKey: "A:3", axisSide: "right" } }) } });
  assert.match(svg.cursor.innerHTML, /data-trace-key="V:3"/);
  assert.match(svg.cursor.innerHTML, /data-trace-key="A:3"/);
  view.fit();
  assert.deepEqual(Object.fromEntries(view.selectedTraceKeys), { left: "V:3", right: "A:3" });
  view.setData(result, crowdedSeries.filter((item) => item.key !== "V:3"));
  assert.equal(view.selectedTraceKeys.has("left"), false);
  assert.equal(view.pinnedIndex, 0);
});

test("attempt-02 ScopeView preserves AC negative-infinity levels but not undefined values", () => {
  const { view, readout } = makeView();
  const result = { analysis: "ac", xValues: [1000], points: [{}] };
  const series = [
    { key: "z-v", label: "zero voltage", quantity: "dBV", color: "#176baf", values: [Number.NEGATIVE_INFINITY] },
    { key: "z-a", label: "zero current", quantity: "dBA", color: "#c0392b", values: [Number.NEGATIVE_INFINITY] },
    { key: "phase", label: "phase", quantity: "°", color: "#669944", values: [null] },
    { key: "finite", label: "finite", quantity: "dBV", color: "#884499", values: [-6] },
  ];
  view.setData(result, series);
  view.cursorIndex = 0;
  view.renderCursor();
  assert.match(readout.textContent, /zero voltage = −∞ dBV/);
  assert.match(readout.textContent, /zero current = −∞ dBA/);
  assert.match(readout.textContent, /phase = 미정/);
  assert.match(readout.textContent, /finite = -6 dBV/);

  const transient = { analysis: "transient", xValues: [0], points: [{}] };
  view.setData(transient, [
    { key: "null", label: "null", quantity: "V", color: "#111111", values: [null] },
    { key: "nan", label: "nan", quantity: "V", color: "#222222", values: [NaN] },
    { key: "pos", label: "pos", quantity: "A", color: "#333333", values: [Infinity] },
    { key: "neg", label: "neg", quantity: "A", color: "#444444", values: [-Infinity] },
  ]);
  view.keyCursor("Home");
  assert.equal((svgBadges(view)).length, 0);
  assert.doesNotMatch(readout.textContent, /= 0 [VA]/);
});

function svgBadges(view) {
  return [...view.svg.cursor.innerHTML.matchAll(/class="scope-cursor-badge"/g)];
}

test("attempt-02 app graph connection updates pointer state on move and final pointerup", () => {
  const source = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
  assert.match(source, /advanceCursorPointerSession\(plotDrag, \{ x: event\.clientX, y: event\.clientY \}, point\)/);
  assert.match(source, /finishPlotPointer\(event\.pointerId, "commit", event\)/);
  assert.match(source, /clientPoint, lastClientPoint: clientPoint/);
  assert.doesNotMatch(source, /Math\.hypot\(point\.x - plotDrag\.point\.x/);
});
