import test from "node:test";
import assert from "node:assert/strict";
import { createCanvasRenderer } from "../../src/canvas-renderer.js";
import { createFlowLayer } from "../../src/flow-layer.js";

/** Fake requestAnimationFrame queue: frames run only when the test says so. */
function withFakeFrames(run) {
  const saved = { raf: globalThis.requestAnimationFrame, caf: globalThis.cancelAnimationFrame };
  const queue = new Map();
  let nextId = 1;
  globalThis.requestAnimationFrame = (fn) => { const id = nextId++; queue.set(id, fn); return id; };
  globalThis.cancelAnimationFrame = (id) => { queue.delete(id); };
  const frames = { size: () => queue.size, flush() { for (const [id, fn] of [...queue]) { queue.delete(id); fn(); } } };
  try { return run(frames); } finally { globalThis.requestAnimationFrame = saved.raf; globalThis.cancelAnimationFrame = saved.caf; }
}

function rendererSetup() {
  const state = { drag: null, circuit: { components: [], wires: [], junctions: [] } };
  const calls = { frames: 0 };
  const noEl = { querySelector: () => null, querySelectorAll: () => [] };
  const renderer = createCanvasRenderer({
    state, elements: { "component-layer": noEl, "overlay-layer": noEl, "wire-layer": noEl, "circuit-canvas": {} },
    workspace: { circuitActive: true }, currentConnections: () => ({ byComponent: {}, counts: {} }),
    afterCanvasRender: () => {}, onDragFrame: () => { calls.frames += 1; },
  });
  return { state, calls, renderer };
}

test("드래그가 끝난 뒤 대기 중이던 드래그 프레임은 아무 일도 하지 않는다", () => {
  withFakeFrames((frames) => {
    const { state, calls, renderer } = rendererSetup();
    state.drag = { kind: "component", id: "R1", moved: true };
    renderer.scheduleDragUpdate("component", "R1");
    assert.equal(frames.size(), 1);
    state.drag = null; // pointer-up: the gesture is over, the frame is still queued
    frames.flush();
    assert.equal(calls.frames, 0, "onDragFrame (flow.suspend) must not fire after the drag ended");
    assert.equal(renderer.stats.drag, 0);
  });
});

test("진행 중인 이동 드래그의 프레임은 그대로 동작한다", () => {
  withFakeFrames((frames) => {
    const { state, calls, renderer } = rendererSetup();
    state.drag = { kind: "component", id: "R1", moved: true };
    renderer.scheduleDragUpdate("group", { components: [], junctions: [] });
    frames.flush();
    assert.equal(calls.frames, 1);
  });
});

test("cancelDragUpdate는 대기 중인 프레임을 취소하고, 이후 새 드래그는 다시 예약된다", () => {
  withFakeFrames((frames) => {
    const { state, calls, renderer } = rendererSetup();
    state.drag = { kind: "junction", id: "J1", moved: true };
    renderer.scheduleDragUpdate("junction", "J1");
    renderer.cancelDragUpdate();
    assert.equal(frames.size(), 0, "the queued frame is drained");
    frames.flush();
    assert.equal(calls.frames, 0);
    renderer.scheduleDragUpdate("group", { components: [], junctions: [] });
    assert.equal(frames.size(), 1, "a later drag can schedule again");
    frames.flush();
    assert.equal(calls.frames, 1);
  });
});

test("전체 렌더는 대기 중인 드래그 프레임을 대신하므로 프레임이 비워진다", () => {
  withFakeFrames((frames) => {
    const { state, renderer } = rendererSetup();
    state.drag = { kind: "component", id: "R1", moved: true };
    renderer.scheduleDragUpdate("component", "R1");
    assert.equal(frames.size(), 1);
    try { renderer.renderCanvas(); } catch { /* the fake DOM is too thin to finish a full render; the cancel happens first */ }
    assert.equal(frames.size(), 0);
  });
});

test("flow.suspend()는 이동 드래그가 끝난 뒤에는 오버레이를 다시 숨기지 않는다", () => {
  const classes = new Set();
  const layer = { markup: "<path/>", classList: { add: (n) => classes.add(n), remove: (n) => classes.delete(n), contains: (n) => classes.has(n), toggle() {} } };
  Object.defineProperty(layer, "innerHTML", { get: () => layer.markup, set: (v) => { layer.markup = v; } });
  Object.defineProperty(layer, "firstChild", { get: () => (layer.markup ? {} : null) });
  const state = { circuit: { components: [], wires: [], junctions: [] }, generation: 1, result: null, stale: false, runState: { status: "not-run" }, drag: null };
  const flow = createFlowLayer({ state, elements: { "flow-layer": layer, "flow-hint": { classList: { toggle() {} } }, "flow-toggle": { addEventListener() {} } }, scopeView: null, wireRoutes: () => new Map() });
  flow.suspend();
  assert.equal(flow.inspect().suspended, false, "no drag: a late frame is ignored");
  state.drag = { kind: "component", id: "R1", moved: true };
  flow.suspend();
  assert.equal(flow.inspect().suspended, true);
});
