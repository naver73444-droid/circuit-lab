// First-time user flow "build → run → see the result": recommended probes, the GND fix, failure marks, new-result cues, first-run guide.
import test from "node:test";
import assert from "node:assert/strict";
import { examples } from "../../src/examples.js";
import { circuitNodes, suggestGroundFix, suggestProbes } from "../../src/editor-guide-model.js";
import { diagnosticHighlightIds } from "../../src/analysis-diagnostics.js";
import { CircuitError, simulateDC } from "../../src/circuit-engine.js";
import { createEditorSession, createEditorState } from "../../src/editor-session.js";
import { createFirstRunGuide } from "../../src/first-run-guide.js";

const exampleCircuit = (id) => structuredClone(examples.find((example) => example.id === id).circuit);

// The voltage probes the editor's own example projects ship with (project-io.js loadExample defaults): the node a textbook calls the output.
const SHIPPED_OUTPUT = {
  divider: ["R2", 0], "rc-charge": ["C1", 0], "rc-lowpass": ["C1", 0], rlc: ["C1", 0], "parallel-sine": ["V1", 0],
  diode: ["R1", 0], opamp: ["U1", 2], "ideal-transformer": ["R2", 0],
};

// Expected suggestion for every example: the voltage probes in order, then the source current.
const EXPECTED = {
  divider: ["V(R2.1)"],
  "rc-charge": ["V(C1.1)"],
  "rc-lowpass": ["V(C1.1)"],
  rl: ["V(L1.1)"],
  rlc: ["V(C1.1)", "V(L1.1)"],
  "parallel-sine": ["V(R1.1)"], // everything is in parallel with the source: the source node itself
  diode: ["V(R1.1)"],
  opamp: ["V(U1.3)", "V(R2.1)"], // the op amp output first, then the inverting input (feedback divider)
  "y-network": ["V(R4.1)", "V(R5.2)"], // the loaded branch ends B and C, furthest from the source
  "coupled-coils": ["V(R1.1)", "V(C1.2)"], // the secondary load first
  "ideal-transformer": ["V(R2.1)", "V(C1.2)"], // Vo = V(R2.1) of the textbook example
};

test("추천 프로브: 예제 11개 모두 기대한 출력 노드(V 1–2개)와 전원 전류 I(V1)를 고른다", () => {
  assert.equal(examples.length, 11);
  for (const example of examples) {
    const suggestion = suggestProbes(example.circuit);
    assert.deepEqual(suggestion.voltage.map((probe) => probe.label), EXPECTED[example.id], example.id);
    assert.equal(suggestion.current?.componentId, "V1", `${example.id}: the source current`);
    assert.match(suggestion.current.label, /^I\(V1/);
    assert.deepEqual(suggestion.probes.map((probe) => probe.key), [...suggestion.voltage.map((probe) => probe.key), "I:V1"]);
  }
});

test("추천 프로브: 첫 V 프로브는 예제 프로젝트가 기본으로 다는 출력 프로브와 같은 노드다", () => {
  for (const [id, [componentId, pin]] of Object.entries(SHIPPED_OUTPUT)) {
    const circuit = exampleCircuit(id);
    const { rootOf } = circuitNodes(circuit);
    const first = suggestProbes(circuit).voltage[0];
    assert.equal(rootOf(first.componentId, first.pin), rootOf(componentId, pin), `${id}: ${first.label} sits on the shipped output node`);
  }
});

test("추천 프로브: 규칙 — GND·전원 양극 노드는 빼고, 부품이 2개 이상 붙은 노드만, 칩은 GND 아닌 노드 전부(추천 먼저)", () => {
  for (const example of examples) {
    const circuit = example.circuit;
    const { nodes, rootOf } = circuitNodes(circuit);
    const suggestion = suggestProbes(circuit);
    for (const probe of suggestion.voltage) {
      const node = nodes.get(rootOf(probe.componentId, probe.pin));
      assert.equal(node.ground, false, `${example.id}: ${probe.label} is not ground`);
      if (example.id !== "parallel-sine") assert.equal(node.source, false, `${example.id}: ${probe.label} is not a source terminal`);
      assert.ok(node.componentIds.size >= 2, `${example.id}: ${probe.label} joins two or more parts`);
    }
    const chipRoots = suggestion.nodes.map((chip) => rootOf(chip.componentId, chip.pin));
    assert.equal(new Set(chipRoots).size, chipRoots.length, `${example.id}: one chip per node`);
    const expectedNodes = [...nodes.values()].filter((node) => !node.ground && node.componentIds.size > 0).length;
    assert.equal(suggestion.nodes.length, Math.min(8, expectedNodes), `${example.id}: every non-ground node is offered`);
    assert.deepEqual(suggestion.nodes.slice(0, suggestion.voltage.length).map((chip) => chip.key), suggestion.voltage.map((probe) => probe.key));
  }
});

test("추천 프로브: 빈 회로·전원 없는 회로·끊긴 배선도 예외 없이 처리한다", () => {
  assert.deepEqual(suggestProbes({ components: [], wires: [] }).probes, []);
  assert.deepEqual(suggestProbes(null).probes, []);
  const noSource = {
    components: [{ id: "R1", type: "R", x: 0, y: 0, props: { ref: "R1" } }, { id: "R2", type: "R", x: 0, y: 0, props: { ref: "R2" } }, { id: "G1", type: "GND", x: 0, y: 0, props: { ref: "GND" } }],
    wires: [{ id: "W1", a: { componentId: "R1", pin: 1 }, b: { componentId: "R2", pin: 0 } }, { id: "W2", a: { componentId: "R2", pin: 1 }, b: { componentId: "G1", pin: 0 } },
      { id: "W3", a: { componentId: "R9", pin: 0 }, b: { componentId: "R1", pin: 0 } }],
  };
  const suggestion = suggestProbes(noSource);
  assert.equal(suggestion.current, null, "no source, no current probe");
  assert.deepEqual(suggestion.voltage.map((probe) => probe.label), ["V(R2.1)"], "the R1–R2 node; the wire to a missing part is ignored");
});

test("GND 추가 제안: 접지가 없으면 첫 전압원의 − 단자(핀 2) 아래 격자점, 있으면 null; 적용하면 분압기가 다시 풀린다", () => {
  const circuit = exampleCircuit("divider");
  assert.equal(suggestGroundFix(circuit), null, "a circuit with GND needs no fix");
  circuit.components = circuit.components.filter((component) => component.type !== "GND");
  circuit.wires = [...circuit.wires.filter((wire) => wire.a.componentId !== "G1" && wire.b.componentId !== "G1"), { id: "W5", a: { componentId: "R2", pin: 1 }, b: { componentId: "V1", pin: 1 } }];
  assert.throws(() => simulateDC(circuit), (error) => error instanceof CircuitError && error.code === "NO_GROUND" && /− 단자/.test(error.hint));
  const fix = suggestGroundFix(circuit);
  assert.equal(fix.sourceId, "V1");
  assert.equal(fix.pin, 1);
  assert.equal(fix.label, "GND 추가 (V1 − 단자)");
  assert.equal(fix.x % 20, 0); assert.equal(fix.y % 20, 0);
  assert.ok(fix.y > 270, "below the source's lower terminal");
  assert.ok(!circuit.components.some((component) => Math.abs(component.x - fix.x) < 40 && Math.abs(component.y - fix.y) < 40), "on a free spot");
  const state = createEditorState();
  state.circuit = { ...circuit, junctions: [] };
  const noop = () => {};
  const session = createEditorSession({ state, inputDrafts: { retainComponents: noop }, synchronizeIntent: noop, markStale: noop, scheduleAutoRun: noop, renderAll: noop,
    resetProjectSession: noop, refreshProbeViews: noop, closeProbeContextMenu: noop, confirmDiscardDrafts: () => true });
  const id = session.addGround(fix);
  assert.equal(state.history.length, 1, "one undo step");
  assert.equal(state.circuit.components.find((component) => component.id === id).type, "GND");
  assert.ok(state.circuit.wires.some((wire) => wire.a.componentId === "V1" && wire.a.pin === 1 && wire.b.componentId === id), "wired to V1 −");
  assert.deepEqual(state.selected, { kind: "component", id });
  const result = simulateDC(state.circuit);
  assert.ok(Math.abs(result.points[0].nodeVoltages[result.topology.nodeIdByPin["R2:0"]] - 5) < 1e-9, "the divider middle is 5 V again");
  assert.equal(session.addGround(fix), null, "a second press does nothing (there is a GND now)");
  session.undo();
  assert.equal(state.circuit.components.some((component) => component.type === "GND"), false, "undo removes GND and wire together");
});

test("추천 프로브 추가: 한 번의 되돌리기 항목, 이미 있는 프로브·없는 부품은 건너뛴다", () => {
  const state = createEditorState();
  state.circuit = { ...exampleCircuit("rlc"), junctions: [] };
  let refreshed = 0;
  const noop = () => {};
  const session = createEditorSession({ state, inputDrafts: { retainComponents: noop }, synchronizeIntent: noop, markStale: noop, scheduleAutoRun: noop, renderAll: noop,
    resetProjectSession: noop, refreshProbeViews: () => { refreshed += 1; }, closeProbeContextMenu: noop, confirmDiscardDrafts: () => true });
  const suggestion = suggestProbes(state.circuit);
  assert.equal(session.addProbes(suggestion.probes), 3);
  assert.equal(state.history.length, 1, "three probes, one undo step");
  assert.equal(refreshed, 1);
  assert.deepEqual(state.probes.map((probe) => probe.label), ["V(C1.1)", "V(L1.1)", "I(V1, 기준 1→2)"]);
  assert.equal(new Set(state.probes.map((probe) => probe.color)).size, 3, "distinct trace colours");
  assert.equal(session.addProbes([...suggestion.probes, { kind: "voltage", componentId: "R9", pin: 0 }, { kind: "voltage", componentId: "R1", pin: 7 }]), 0, "nothing new");
  assert.equal(state.history.length, 1, "no empty undo step");
  assert.equal(session.addProbes([suggestion.nodes.at(-1)]), 1, "a node chip adds one probe");
  session.undo();
  session.undo();
  assert.deepEqual(state.probes, [], "two undos remove the chip probe and then all three recommended ones");
});

test("오류 강조: 떠 있는 노드·전압원 고리는 관련 부품, GND 없음은 GND를 붙일 전원; 전압원 고리 힌트는 인덕터 이야기를 하지 않는다", () => {
  const part = (id, type, props = {}) => ({ id, type, x: 0, y: 0, rotation: 0, props: { ref: id, ...props } });
  const wire = (id, a, ap, b, bp) => ({ id, a: { componentId: a, pin: ap }, b: { componentId: b, pin: bp } });
  const loop = { components: [part("V1", "V", { dc: "5" }), part("V2", "V", { dc: "3" }), part("G1", "GND"), part("R1", "R", { value: "1k" })],
    wires: [wire("W1", "V1", 0, "V2", 0), wire("W2", "V1", 1, "G1", 0), wire("W3", "V2", 1, "G1", 0), wire("W4", "V1", 0, "R1", 0), wire("W5", "R1", 1, "G1", 0)] };
  let failure;
  try { simulateDC(loop); } catch (error) { failure = error; }
  assert.equal(failure.code, "IDEAL_CONSTRAINT_CONFLICT");
  assert.doesNotMatch(failure.hint, /인덕터/, "no inductor in the loop, no inductor wording");
  assert.match(failure.hint, /고리/);
  assert.deepEqual([...diagnosticHighlightIds(loop, failure)].sort(), ["V1", "V2"]);
  const inductive = { components: [part("V1", "V", { dc: "5" }), part("L1", "L", { value: "1m" }), part("G1", "GND")],
    wires: [wire("W1", "V1", 0, "L1", 0), wire("W2", "L1", 1, "G1", 0), wire("W3", "V1", 1, "G1", 0)] };
  try { simulateDC(inductive); } catch (error) { failure = error; }
  assert.match(failure.hint, /인덕터는 0 V 단락/, "a loop through an inductor keeps the DC-short explanation");
  const floating = { components: [part("V1", "V", { dc: "5" }), part("R1", "R", { value: "1k" }), part("G1", "GND"), part("R2", "R", { value: "1k" }), part("R3", "R", { value: "1k" })],
    wires: [wire("W1", "V1", 0, "R1", 0), wire("W2", "R1", 1, "G1", 0), wire("W3", "V1", 1, "G1", 0), wire("W4", "R2", 1, "R3", 0), wire("W5", "R3", 1, "R2", 0)] };
  try { simulateDC(floating); } catch (error) { failure = error; }
  assert.deepEqual([...diagnosticHighlightIds(floating, failure)].sort(), ["R2", "R3"]);
  const grounded = { components: [part("V1", "V", { dc: "5" }), part("R1", "R", { value: "1k" })], wires: [wire("W1", "V1", 0, "R1", 0), wire("W2", "R1", 1, "V1", 1)] };
  try { simulateDC(grounded); } catch (error) { failure = error; }
  assert.deepEqual([...diagnosticHighlightIds(grounded, failure)], ["V1"]);
});

/** Minimal DOM stand-ins for the panel controller: data attributes, aria, classList and a header node. */
class FakeNode {
  constructor(id = "", dataset = {}, text = "") { this.id = id; this.dataset = dataset; this.textContent = text; this.hidden = false; this.inert = false; this.attrs = {}; this.listeners = {}; this.scrollTop = 0; this.offsetTop = 100; this.offsetWidth = 10; this.tabIndex = 0; this.classes = new Set(); this.child = null; }
  setAttribute(name, value) { this.attrs[name] = value; }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  querySelectorAll() { return []; }
  querySelector() { return this.child; }
  closest(selector) { return selector === ".side-tabs" && this.side ? this : null; }
  get classList() { const set = this.classes; return { add: (c) => set.add(c), remove: (c) => set.delete(c), contains: (c) => set.has(c), toggle: (c, on) => (on ? set.add(c) : set.delete(c)) }; }
  click() { for (const fn of this.listeners.click ?? []) fn({}); }
}

function panelSetup({ mobile }) {
  const ids = ["workbench", "side-panel", "palette-panel", "inspector-panel", "results-panel", "wave-panel", "phasor-panel", "port-panel"];
  const nodes = Object.fromEntries(ids.map((id) => [id, new FakeNode(id)]));
  nodes["wave-panel"].child = new FakeNode("wave-header");
  const labels = { palette: "부품", inspector: "속성", results: "결과", wave: "파형" };
  const views = ["palette", "inspector", "results", "wave"].map((view) => new FakeNode("", { view }, labels[view]));
  const media = { matches: mobile, addEventListener() {} };
  globalThis.document = {
    getElementById: (id) => nodes[id] ?? null,
    querySelectorAll: (selector) => (selector === "[data-view]" ? views : []),
  };
  globalThis.matchMedia = () => media;
  globalThis.requestAnimationFrame = (fn) => { fn(); return 1; };
  return { nodes, views, wave: views.find((view) => view.dataset.view === "wave") };
}

test("새 결과 알림: 폰은 파형 탭에 점(탭은 바꾸지 않음, 열면 사라짐), PC는 파형 머리 강조", async () => {
  const phone = panelSetup({ mobile: true });
  const { createPanelController } = await import("../../src/panel-controller.js?flow-phone");
  const panels = createPanelController({});
  panels.notifyResult("wave");
  assert.equal(phone.wave.dataset.fresh, "1");
  assert.equal(phone.wave.attrs["aria-label"], "파형 · 새 결과");
  assert.deepEqual(panels.inspect().fresh, ["wave"]);
  assert.equal(panels.inspect().view, "palette", "the open panel does not change");
  panels.show("wave");
  assert.equal(phone.wave.dataset.fresh, undefined, "opening the tab clears the dot");
  assert.equal(phone.wave.attrs["aria-label"], "파형");
  panels.notifyResult("wave");
  assert.deepEqual(panels.inspect().fresh, [], "no dot for the panel that is already open");

  const desktop = panelSetup({ mobile: false });
  const { createPanelController: createDesktop } = await import("../../src/panel-controller.js?flow-desktop");
  const wide = createDesktop({});
  wide.notifyResult("wave");
  assert.equal(desktop.nodes["wave-panel"].child.classes.has("result-flash"), true, "the header lights up");
  assert.deepEqual(wide.inspect().fresh, [], "no tab dot on the desktop");
});

test("첫 실행 안내: 빈 회로에 3단계·예제 버튼, 손으로 부품을 놓으면 기억하고, 예제·붙여넣기로는 기억하지 않는다; 저장소 오류에도 동작", () => {
  const make = (storage) => {
    const element = { innerHTML: "", dataset: {}, listeners: [], classes: new Set(), addEventListener(type, fn) { this.listeners.push(fn); },
      classList: { toggle(c, on) { on ? element.classes.add(c) : element.classes.delete(c); }, contains(c) { return element.classes.has(c); } } };
    const view = { empty: true, placing: false };
    let opened = 0;
    const guide = createFirstRunGuide({ element, getState: () => view, onOpenExample: () => { opened += 1; }, storage });
    return { element, view, guide, opened: () => opened };
  };
  const store = new Map();
  const storage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) };
  const first = make(storage);
  first.guide.sync();
  assert.match(first.element.innerHTML, /부품을 눌러 캔버스에 놓기/);
  assert.match(first.element.innerHTML, /핀끼리 끌어 배선/);
  assert.match(first.element.innerHTML, /자동 해석/);
  assert.match(first.element.innerHTML, /data-first-run-example/);
  first.element.listeners[0]({ target: { closest: (selector) => (selector === "[data-first-run-example]" ? {} : null) } });
  assert.equal(first.opened(), 1, "예제 열기 opens the example");
  Object.assign(first.view, { empty: false, placing: false }); first.guide.sync(); // an example arrived
  assert.equal(store.size, 0, "an example does not end the guide");
  Object.assign(first.view, { empty: true, placing: true }); first.guide.sync();
  assert.equal(first.element.dataset.placing, "1", "the button steps aside while a part is armed");
  Object.assign(first.view, { empty: false, placing: true }); first.guide.sync(); // the user placed a part
  assert.equal(store.get("circuit-lab:first-run-done"), "1");
  Object.assign(first.view, { empty: true, placing: false }); first.guide.sync();
  assert.doesNotMatch(first.element.innerHTML, /first-run-steps/, "after that only the plain hint");
  const second = make(storage);
  second.guide.sync();
  assert.doesNotMatch(second.element.innerHTML, /first-run-steps/, "remembered across page loads");
  const broken = make({ getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } });
  broken.guide.sync();
  assert.match(broken.element.innerHTML, /first-run-steps/);
  Object.assign(broken.view, { empty: false, placing: true });
  assert.doesNotThrow(() => broken.guide.sync());
});
