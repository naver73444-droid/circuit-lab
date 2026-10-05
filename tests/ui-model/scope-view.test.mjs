import test from "node:test";
import assert from "node:assert/strict";

// ScopeView with a minimal fake DOM: it only needs sizing, listeners and innerHTML/textContent.
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
  set innerHTML(value) { this._innerHTML = value; this._textContent = ""; }
  get innerHTML() { return this._innerHTML; }
  set textContent(value) { this._textContent = value; this._innerHTML = ""; }
  get textContent() { return this._textContent || this._innerHTML.replace(/<[^>]+>/g, ""); }
}

let resizeCallback = null;
globalThis.ResizeObserver = class { constructor(callback) { resizeCallback = callback; } observe() {} };
globalThis.document = { activeElement: null, documentElement: { dataset: { theme: "dark" } }, getElementById: () => null };
const { ScopeView } = await import("../../src/scope-view.js");

function makeView({ width = 600, height = 320 } = {}) {
  const svg = new FakeElement({ width, height, svg: true });
  const controls = new FakeElement();
  const readout = new FakeElement();
  return { view: new ScopeView(svg, controls, readout), svg, controls, readout };
}
const svgBadges = (view) => [...view.svg.cursor.innerHTML.matchAll(/class="scope-cursor-badge"/g)];
const click = (readout, cursorTraceKey, axisSide) => readout.listeners.get("click")({ target: { closest: () => ({ dataset: { cursorTraceKey, axisSide } }) } });

// Eight traces per physical axis, all at the same value, cannot all get a badge in a short plot.
const crowded = ["V", "A"].flatMap((quantity) => Array.from({ length: 8 }, (_, index) => ({
  key: `${quantity}:${index}`,
  label: `${quantity} very long trace label ${index}`,
  quantity,
  color: `#${index + 2}${index + 2}6688`,
  values: [quantity === "V" ? 1 : 0.001],
})));

test("hidden badges stay listed, can be chosen from the list, survive fit and are pruned on deletion", () => {
  const { view, svg, readout } = makeView({ width: 390, height: 180 });
  const result = { analysis: "transient", xValues: [0], points: [{}] };
  view.setData(result, crowded);
  assert.equal(view.keyCursor("Home"), true);
  assert.match(readout.textContent, /배지 \d+개 숨김/);
  assert.doesNotMatch(svg.cursor.innerHTML, /data-trace-key="V:7"/, "the last trace has no badge until it is chosen");
  for (let index = 0; index < 8; index += 1) assert.match(readout.innerHTML, new RegExp(`V very long trace label ${index}`), "every trace is still listed with its value");
  click(readout, "V:7", "left");
  click(readout, "A:7", "right");
  assert.match(svg.cursor.innerHTML, /data-trace-key="V:7"/);
  assert.match(svg.cursor.innerHTML, /data-trace-key="A:7"/);
  view.fit();
  assert.deepEqual(Object.fromEntries(view.selectedTraceKeys), { left: "V:7", right: "A:7" });
  view.setData(result, crowded.filter((item) => item.key !== "V:7"));
  assert.equal(view.selectedTraceKeys.has("left"), false);
  assert.equal(view.pinnedIndex, 0);
});

test("AC negative-infinity levels are shown, undefined values are not", () => {
  const { view, readout } = makeView();
  const result = { analysis: "ac", xValues: [1000], points: [{}] };
  view.setData(result, [
    { key: "z-v", label: "zero voltage", quantity: "dBV", color: "#176baf", values: [Number.NEGATIVE_INFINITY] },
    { key: "z-a", label: "zero current", quantity: "dBA", color: "#c0392b", values: [Number.NEGATIVE_INFINITY] },
    { key: "phase", label: "phase", quantity: "°", color: "#669944", values: [null] },
    { key: "finite", label: "finite", quantity: "dBV", color: "#884499", values: [-6] },
  ]);
  view.cursorIndex = 0;
  view.renderCursor();
  assert.match(readout.textContent, /zero voltage = −∞ dBV/);
  assert.match(readout.textContent, /zero current = −∞ dBA/);
  assert.match(readout.textContent, /phase = 미정/);
  assert.match(readout.textContent, /finite = -6 dBV/);

  view.setData({ analysis: "transient", xValues: [0], points: [{}] }, [
    { key: "null", label: "null", quantity: "V", color: "#111111", values: [null] },
    { key: "nan", label: "nan", quantity: "V", color: "#222222", values: [NaN] },
    { key: "pos", label: "pos", quantity: "A", color: "#333333", values: [Infinity] },
    { key: "neg", label: "neg", quantity: "A", color: "#444444", values: [-Infinity] },
  ]);
  view.keyCursor("Home");
  assert.equal(svgBadges(view).length, 0);
  assert.doesNotMatch(readout.textContent, /= 0 [VA]/);
});

function rampView() {
  const { view, svg } = makeView();
  view.setData({ analysis: "transient", xValues: [0, 1, 2, 3], points: [{}, {}, {}, {}] }, [{ key: "v", label: "v", quantity: "V", color: "#336699", values: [0, 1, 2, 3] }]);
  return { view, svg };
}

test("moveCursor re-renders only when the hovered sample changes", () => {
  const { view } = rampView();
  let renders = 0;
  const original = view.renderCursor.bind(view);
  view.renderCursor = () => { renders += 1; original(); };
  const g = view.geometry;
  const point = { x: g.left + g.plotWidth * 0.4, y: g.top + g.plotHeight / 2 };
  view.moveCursor(point);
  view.moveCursor({ x: point.x + 0.01, y: point.y });
  view.moveCursor({ x: point.x - 0.01, y: point.y });
  assert.equal(renders, 1);
  view.moveCursor({ x: g.left + g.plotWidth * 0.1, y: point.y });
  assert.equal(renders, 2);
  view.moveCursor({ x: -50, y: -50 });
  assert.equal(renders, 3);
  view.moveCursor({ x: -60, y: -60 });
  assert.equal(renders, 3);
});

test("render uses the ResizeObserver-cached size instead of reading clientWidth", () => {
  const { view, svg } = rampView();
  assert.equal(view.geometry.width, 600);
  svg.clientWidth = 900; svg.clientHeight = 400;
  resizeCallback();
  assert.equal(view.geometry.width, 900);
  let reads = 0;
  Object.defineProperty(svg, "clientWidth", { get() { reads += 1; return 1; } });
  view.render();
  assert.equal(reads, 0);
  assert.equal(view.geometry.width, 900);
});
