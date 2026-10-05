import test from "node:test";
import assert from "node:assert/strict";
import { simulate } from "../../src/circuit-engine.js";
import { examples } from "../../src/examples.js";
import { createFlowLayer } from "../../src/flow-layer.js";

// A tiny stand-in for the three DOM nodes the overlay writes to.
function fakeElements() {
  const classes = new Set();
  const layer = { markup: "", classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name), contains: (name) => classes.has(name), toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)) } };
  Object.defineProperty(layer, "innerHTML", { get: () => layer.markup, set: (value) => { layer.markup = value; } });
  Object.defineProperty(layer, "firstChild", { get: () => (layer.markup ? {} : null) });
  const hint = { textContent: "", classList: { toggle() {} } };
  const toggle = { checked: false, addEventListener() {} };
  return { "flow-layer": layer, "flow-hint": hint, "flow-toggle": toggle };
}

const clone = (value) => structuredClone(value);
function setup({ id = "divider", analysis = "dc", rename = (text) => text } = {}) {
  const example = examples.find((item) => item.id === id);
  const circuit = JSON.parse(rename(JSON.stringify(clone(example.circuit))));
  const result = simulate(circuit, { analysis, ...(analysis === "dc" ? {} : example.settings) });
  const state = { circuit, generation: 1, result, stale: false, runState: { status: "success" }, drag: null };
  const calls = { routes: 0 };
  const wireRoutes = () => {
    calls.routes += 1;
    return new Map(circuit.wires.map((wire, index) => [wire.id, [{ x: 0, y: index * 40 }, { x: 120, y: index * 40 }]]));
  };
  const scopeView = { cursorIndex: null, onCursor: null };
  const elements = fakeElements();
  const flow = createFlowLayer({ state, elements, scopeView, wireRoutes });
  flow.setEnabled(true);
  return { state, flow, elements, scopeView, calls, circuit, result };
}

test("flow layer draws a determined current and clears the moment the result turns stale", () => {
  const { state, flow, elements } = setup();
  assert.equal(flow.inspect().status, "flow");
  assert.ok(elements["flow-layer"].markup.includes("flow-dash"));
  state.stale = true; // what markStale() does when a value changes
  flow.refresh();
  assert.equal(flow.inspect().status, "stale");
  assert.equal(elements["flow-layer"].markup, "", "no stale arrows keep animating");
  state.stale = false;
  state.runState = { status: "stale" };
  flow.refresh();
  assert.equal(elements["flow-layer"].markup, "", "a stale run state alone is enough");
  state.runState = { status: "success" };
  flow.refresh();
  assert.equal(flow.inspect().status, "flow", "a fresh result draws again");
});

test("a render during an active move drag keeps the overlay hidden, and it returns when the drag ends", () => {
  const { state, flow, elements } = setup();
  assert.equal(flow.inspect().suspended, false);
  state.drag = { kind: "component", id: "R1", moved: true };
  flow.suspend(); // the drag frame
  assert.equal(flow.inspect().suspended, true);
  const builds = flow.inspect().stats.builds;
  flow.refresh(); // renderAll() after an analysis finished mid-drag
  flow.refresh();
  assert.equal(flow.inspect().suspended, true, "build() must not un-suspend while the drag is active");
  assert.equal(flow.inspect().stats.builds, builds, "and does no work for it");
  state.drag = { kind: "junction", id: "J1", moved: true };
  flow.refresh();
  assert.equal(flow.inspect().suspended, true, "junction drags too");
  state.drag = { kind: "pan", moved: true };
  flow.refresh();
  assert.equal(flow.inspect().suspended, false, "panning does not move wires");
  state.drag = { kind: "component", id: "R1", moved: false };
  flow.refresh();
  assert.equal(flow.inspect().suspended, false, "a press that has not moved yet changes nothing");
  state.drag = { kind: "component", id: "R1", moved: true };
  flow.refresh();
  state.drag = null;
  flow.refresh();
  assert.equal(flow.inspect().suspended, false, "visible again after the drag");
  assert.ok(elements["flow-layer"].markup.includes("flow-dash"));
});

test("hostile wire ids cannot break out of the data-wires attribute", () => {
  const evil = 'W1" onmouseover="alert(1)" x="';
  const { flow, elements, circuit } = setup({ rename: (text) => text.replaceAll('"W1"', JSON.stringify(evil)) });
  assert.ok(circuit.wires.some((wire) => wire.id === evil));
  const markup = elements["flow-layer"].markup;
  assert.ok(markup.includes("flow-dash"), "still drawn");
  assert.ok(!markup.includes('" onmouseover="'), "the quote is escaped");
  assert.ok(markup.includes("&quot; onmouseover=&quot;"));
  assert.equal(flow.inspect().status, "flow");
});

test("net graph and routes are cached per geometry; a cursor move only redoes the per-sample sums", () => {
  const { state, flow, scopeView, calls, circuit, result } = setup({ id: "rc-charge", analysis: "transient" });
  assert.equal(calls.routes, 1);
  assert.equal(flow.inspect().stats.graphs, 1);
  const writes = flow.inspect().stats.writes;
  for (const index of [3, 8, 20, 3, 8]) { scopeView.cursorIndex = index; flow.refresh(); }
  assert.equal(calls.routes, 1, "routes are not recomputed for a cursor move");
  assert.equal(flow.inspect().stats.graphs, 1);
  assert.ok(flow.inspect().stats.writes > writes, "different samples still redraw");
  const builds = flow.inspect().stats.builds;
  flow.refresh();
  flow.refresh();
  assert.equal(flow.inspect().stats.builds, builds, "nothing changed: nothing is recomputed");
  assert.ok(flow.inspect().stats.skipped >= 2);
  state.generation += 1; // an edit
  flow.refresh();
  assert.equal(calls.routes, 2, "a new geometry revision recomputes once");
  assert.equal(flow.inspect().stats.graphs, 2);
  state.circuit = { ...circuit, wires: circuit.wires.slice(1) }; // a different circuit object with fewer wires
  flow.refresh();
  assert.equal(flow.inspect().stats.graphs, 3);
  state.result = { ...result }; // a new run
  flow.refresh();
  assert.equal(flow.inspect().stats.graphs, 3, "a new result reuses the geometry");
});
