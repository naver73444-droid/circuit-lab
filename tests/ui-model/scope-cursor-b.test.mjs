import test from "node:test";
import assert from "node:assert/strict";

// ScopeView with a minimal fake DOM (same approach as scope-view.test.mjs).
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
globalThis.ResizeObserver = class { constructor() {} observe() {} };
globalThis.document = { activeElement: null, documentElement: { dataset: { theme: "dark" } }, getElementById: () => null };
const { ScopeView } = await import("../../src/scope-view.js");

function makeView() {
  const svg = new FakeElement({ svg: true });
  const view = new ScopeView(svg, new FakeElement(), new FakeElement());
  const changes = [];
  view.subscribe((type) => { if (type === "change") changes.push({ b: view.cursorB, armed: view.bArmed, active: view.activeTraceKey }); });
  return { view, svg, readout: view.readout, changes };
}
const transient = () => {
  const xValues = Array.from({ length: 101 }, (_, i) => i * 1e-5);
  return {
    result: { analysis: "transient", xValues, points: xValues.map(() => ({})) },
    series: [
      { key: "a", label: "V(a)", quantity: "V", color: "#176baf", values: xValues.map((t) => Math.sin(2 * Math.PI * 1000 * t)) },
      { key: "b", label: "V(b)", quantity: "V", color: "#c0392b", values: xValues.map((t) => 2 * t * 1000) },
    ],
  };
};

test("Shift+화살표는 B만, 화살표는 A만 움직이고 B는 새 결과(같은 형태)에서도 유지된다", () => {
  const { view, readout, svg } = makeView();
  const data = transient();
  view.setData(data.result, data.series);
  assert.equal(view.keyCursor("ArrowRight"), true);
  assert.equal(view.pinnedIndex, 0);
  assert.equal(view.keyCursor("ArrowRight", true), true, "B가 없으면 A 위치에서 시작");
  assert.equal(view.cursorB, 0);
  view.keyCursor("ArrowRight", true);
  view.keyCursor("ArrowRight", true);
  assert.equal(view.cursorB, 2);
  assert.equal(view.pinnedIndex, 0, "A는 그대로");
  view.keyCursor("ArrowRight");
  assert.equal(view.pinnedIndex, 1);
  assert.equal(view.cursorB, 2);
  view.keyCursor("End", true);
  assert.equal(view.cursorB, 100);
  view.keyCursor("Home", true);
  assert.equal(view.cursorB, 0);
  // 차이 줄이 읽기 영역에 들어간다 (B−A = 0 − 1 샘플)
  view.keyCursor("ArrowRight", true);
  view.keyCursor("ArrowRight", true);
  assert.match(readout.innerHTML, /B−A/);
  assert.match(readout.textContent, /ΔT 10 µs/);
  assert.match(svg.cursor.innerHTML, /plot-cursor-b/);
  assert.match(svg.cursor.innerHTML, />B</);
  assert.match(svg.cursor.innerHTML, />A</);
  // 같은 형태의 새 결과: B 유지, 다른 형태: 해제
  const again = transient();
  view.setData(again.result, again.series);
  assert.equal(view.cursorB, 2);
  const longer = { ...again.result, xValues: [...again.result.xValues, 1.01e-3], points: [...again.result.points, {}] };
  view.setData(longer, again.series.map((item) => ({ ...item, values: [...item.values, 0] })));
  assert.equal(view.cursorB, null);
});

test("Escape는 A를 먼저, 다음에 B를 해제하고 변경을 알린다", () => {
  const { view, changes } = makeView();
  const data = transient();
  view.setData(data.result, data.series);
  view.keyCursor("ArrowRight");
  view.keyCursor("ArrowRight", true);
  assert.equal(view.keyCursor("Escape"), true);
  assert.equal(view.pinnedIndex, null);
  assert.equal(view.cursorB, 0);
  assert.equal(view.keyCursor("Escape"), true);
  assert.equal(view.cursorB, null);
  assert.equal(view.keyCursor("Escape"), false);
  assert.ok(changes.length >= 2);
});

test("B 커서 무장: 다음 점 놓기가 B가 되고 무장은 해제된다, DC에서는 쓸 수 없다", () => {
  const { view, changes } = makeView();
  const data = transient();
  view.setData(data.result, data.series);
  assert.equal(view.armB(true), true);
  assert.equal(view.bArmed, true);
  assert.match(view.readout.textContent, /B 커서/);
  const g = view.geometry;
  assert.equal(view.placeB({ x: g.left + g.plotWidth * 0.5, y: g.top + 10 }), true);
  assert.equal(view.bArmed, false);
  assert.ok(view.cursorB > 30 && view.cursorB < 70, String(view.cursorB));
  assert.equal(view.placeB({ x: -50, y: -50 }), false, "그래프 밖은 무시");
  assert.equal(view.clearB(), true);
  assert.equal(view.clearB(), false);
  assert.equal(changes.at(-1).b, null);
  const dc = makeView();
  dc.view.setData({ analysis: "dc", xValues: [0], points: [{}] }, [{ key: "a", label: "a", quantity: "V", color: "#176baf", values: [1] }]);
  assert.equal(dc.view.hasCursors, false);
  assert.equal(dc.view.armB(true), false);
  assert.equal(dc.view.keyCursor("ArrowRight", true), false);
});

test("선택한 트레이스가 차이 줄에 쓰이고, 사라지면 첫 트레이스로 돌아간다", () => {
  const { view, readout } = makeView();
  const data = transient();
  view.setData(data.result, data.series);
  view.keyCursor("ArrowRight");
  view.keyCursor("End", true);
  assert.match(readout.innerHTML, /V\(a\)/);
  assert.equal(view.setActiveTrace("b"), true);
  assert.equal(view.setActiveTrace("b"), false, "같은 값은 변경 없음");
  assert.match(readout.innerHTML, /delta-trace[^>]*>V\(b\)/);
  assert.equal(view.setActiveTrace("nope"), false);
  view.setData(data.result, data.series.slice(0, 1));
  assert.equal(view.activeTraceKey, null);
  assert.equal(view.activeSeries().key, "a");
});

test("AC에서도 클릭 고정(A)과 Δf·dB 차이가 동작한다", () => {
  const { view, readout } = makeView();
  const xValues = [10, 100, 1000, 10000];
  const result = { analysis: "ac", xValues, points: xValues.map(() => ({})) };
  view.setData(result, [{ key: "g", label: "V(out)", quantity: "dBV", color: "#176baf", values: [0, -0.04, -3, -20] }]);
  const g = view.geometry;
  assert.equal(view.pinCursorAt({ x: g.left + g.plotWidth * 0.05, y: g.top + 10 }), true, "AC도 A를 고정할 수 있다");
  assert.notEqual(view.pinnedIndex, null);
  const frozen = view.cursorIndex;
  view.moveCursor({ x: g.left + g.plotWidth * 0.7, y: g.top + 10 });
  assert.equal(view.cursorIndex, frozen, "고정되면 호버가 A를 바꾸지 않는다");
  view.keyCursor("End", true);
  assert.equal(view.cursorB, 3);
  assert.match(view.readout.textContent, /Δf/);
  assert.match(view.readout.textContent, /Δ레벨/);
  assert.equal(readout.textContent.includes("dB/dec"), true);
});

test("subscribe: 여러 관찰자가 서로를 덮어쓰지 않고, 해제 함수로 빠지며, 예외는 그래프를 깨지 않는다", () => {
  const { view } = makeView();
  const data = transient();
  view.setData(data.result, data.series);
  const first = [];
  const second = [];
  const stopFirst = view.subscribe((type, detail) => first.push([type, detail]));
  view.subscribe((type) => second.push(type));
  view.subscribe(() => { throw new Error("broken observer"); });
  assert.equal(view.armB(true), true);
  assert.ok(first.some(([type]) => type === "change") && second.includes("change"), "두 관찰자 모두 변경을 받는다");
  const before = first.length;
  view.keyCursor("ArrowRight", false);
  assert.ok(first.slice(before).some(([type, detail]) => type === "cursor" && Number.isInteger(detail)), "커서 A 이동은 cursor 이벤트로 온다");
  stopFirst();
  const frozen = first.length;
  view.armB(false);
  assert.equal(first.length, frozen, "해제한 관찰자는 더 받지 않는다");
  assert.ok(second.length > 0);
});
