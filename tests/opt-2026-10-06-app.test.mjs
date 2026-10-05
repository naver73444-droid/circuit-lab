import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CANVAS_VIEW_MIN_WIDTH, CANVAS_VIEW_MAX_WIDTH, viewForPinch } from "../src/interaction-math.js";

const app = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const body = (name) => {
  const start = app.search(new RegExp(`(?:async )?function ${name}\\(`));
  return start < 0 ? "" : app.slice(start, app.indexOf("\n}\n", start));
};

test("every undo/redo history push is capped at 100 entries", () => {
  const pushes = [...app.matchAll(/state\.(history|future)\.push\([^\n]*\);\n(\s*)(if \(state\.\1\.length > 100\) state\.\1\.shift\(\);)?/g)];
  assert.ok(pushes.length >= 5, `expected history/future pushes, found ${pushes.length}`);
  for (const match of pushes) assert.ok(match[3], `uncapped push: ${match[0]}`);
  assert.match(app, /state\.history\.push\(drag\.before\);\n\s*if \(state\.history\.length > 100\) state\.history\.shift\(\);/);
});

test("canvas zoom and pinch share one limit pair", () => {
  assert.equal(CANVAS_VIEW_MIN_WIDTH, 220);
  assert.equal(CANVAS_VIEW_MAX_WIDTH, 3040);
  assert.doesNotMatch(body("zoomCanvas"), /1520|3040|\b220\b/);
  assert.match(body("zoomCanvas"), /Math\.max\(CANVAS_VIEW_MIN_WIDTH, Math\.min\(CANVAS_VIEW_MAX_WIDTH/);
  const start = { scale: 1, distance: 100, view: { x: 0, y: 0, width: 1000, height: 600 }, anchor: { x: 500, y: 300 }, center: { x: 100, y: 100 } };
  assert.equal(viewForPinch(start, { x: 100, y: 100 }, 1).width, CANVAS_VIEW_MAX_WIDTH);
  assert.equal(viewForPinch(start, { x: 100, y: 100 }, 1e6).width, CANVAS_VIEW_MIN_WIDTH);
});

test("runAnalysis cannot hang when requestAnimationFrame never fires", async () => {
  const run = body("runAnalysis");
  assert.match(run, /requestAnimationFrame\(resolve\); setTimeout\(resolve, \d+\)/);
  assert.match(run, /serial !== state\.runSerial/);
  // Same race shape, executed with a rAF that never fires.
  const start = Date.now();
  await new Promise((resolve) => { (() => 0)(resolve); setTimeout(resolve, 50); });
  assert.ok(Date.now() - start < 1000);
});

test("wire preview and scope hover are coalesced or short-circuited", () => {
  assert.match(app, /function scheduleOverlayRender\(\) \{[\s\S]*?requestAnimationFrame/);
  assert.match(app, /state\.pointer = snapPoint\(point\); scheduleOverlayRender\(\);/);
  assert.match(body("renderOverlay"), /cancelAnimationFrame\(overlayFrame\)/);
  assert.match(app, /!plotDrag && scopeView\.hoverIndex === null && !elements\["wave-plot"\]\.contains\(event\.target\)\) return;/);
});

test("phasor view renders only for a visible panel and AC keystrokes", () => {
  assert.match(body("renderPhasorLearning"), /if \(!phasorPanelVisible\(\)\) \{ phasorDirty = true; return; \}/);
  assert.match(app, /function phasorPanelVisible\(\) \{ return !panels \|\| panels\.isOpen\("phasor"\); \}/);
  const notice = body("updateDraftNotice");
  assert.match(notice, /state\.settings\.analysis === "ac"/);
  assert.match(notice, /phasorDirty = true/);
});

test("inspector keeps keyboard focus across re-renders", () => {
  const render = body("renderInspector");
  assert.match(render, /const savedFocus = captureInspectorFocus\(\);/);
  assert.match(render, /restoreInspectorFocus\(savedFocus\);/);
  assert.match(app, /inspectorTabIntent = event\.shiftKey \? -1 : 1;/);
});

test("index.html declares an inline icon so /favicon.ico is not requested", () => {
  assert.match(html, /<link href="data:," rel="icon"\/>/);
  assert.match(readFileSync(new URL("../server.mjs", import.meta.url), "utf8"), /img-src 'self' data:/);
});

class FakeElement {
  constructor({ width = 600, height = 320, svg = false } = {}) {
    this.clientWidth = width; this.clientHeight = height; this.listeners = new Map(); this.dataset = {};
    this.cursor = svg ? new FakeElement() : null; this._innerHTML = ""; this._textContent = "";
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
let resizeCallback = null;
globalThis.ResizeObserver = class { constructor(callback) { resizeCallback = callback; } observe() {} };
globalThis.document = { activeElement: null, documentElement: { dataset: { theme: "dark" } }, getElementById: () => null };
const { ScopeView } = await import("../src/scope-view.js");

function makeView() {
  const svg = new FakeElement({ svg: true });
  const view = new ScopeView(svg, new FakeElement(), new FakeElement());
  const result = { analysis: "transient", xValues: [0, 1, 2, 3], points: [{}, {}, {}, {}] };
  view.setData(result, [{ key: "v", label: "v", quantity: "V", color: "#336699", values: [0, 1, 2, 3] }]);
  return { view, svg };
}

test("ScopeView.moveCursor skips re-rendering while the hovered sample is unchanged", () => {
  const { view } = makeView();
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

test("ScopeView.render uses the ResizeObserver-cached size instead of reading clientWidth", () => {
  const { view, svg } = makeView();
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
