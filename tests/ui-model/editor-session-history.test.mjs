import test from "node:test";
import assert from "node:assert/strict";
import { createEditorSession, createEditorState } from "../../src/editor-session.js";
import { NUDGE_IDLE_MS } from "../../src/editor-shortcuts.js";

/** A session with inert collaborators: only history, grouping and the committed notification are under test. */
function harness() {
  const state = createEditorState();
  state.circuit = { version: 1, geometryVersion: state.circuit.geometryVersion, components: [{ id: "R1", type: "R", x: 100, y: 100, rotation: 0, props: { ref: "R1", value: "1k" } }], wires: [], junctions: [] };
  const committed = [];
  const noop = () => {};
  const session = createEditorSession({
    state, inputDrafts: { retainComponents: noop }, synchronizeIntent: noop, markStale: noop, scheduleAutoRun: noop, renderAll: noop,
    resetProjectSession: noop, refreshProbeViews: noop, closeProbeContextMenu: noop, confirmDiscardDrafts: () => true,
    onCommitted: () => committed.push(state.generation),
  });
  const wheel = (text) => session.mutateGrouped("wheel:R1", () => { state.circuit.components[0].props.value = text; });
  const value = () => state.circuit.components[0].props.value;
  return { state, session, committed, wheel, value, done: () => session.closeEditGroup() };
}

test("연속 휠 단계는 한 번의 되돌리기 항목으로 묶인다", () => {
  const h = harness();
  h.wheel("1.2k"); h.wheel("1.5k"); h.wheel("1.8k");
  assert.equal(h.state.history.length, 1);
  h.session.undo();
  assert.equal(h.value(), "1k");
  h.done();
});

test("휠 → 프로브 추가 → 400ms 안에 휠: 되돌리기는 마지막 휠 단계만 되돌린다", () => {
  const h = harness();
  h.wheel("1.2k");
  h.session.addVoltageProbe("R1", 0);
  h.wheel("1.5k"); // 같은 400ms 묶음 안이지만 프로브 편집이 사이에 있었다
  assert.equal(h.state.history.length, 3);
  h.session.undo();
  assert.equal(h.value(), "1.2k", "마지막 휠 단계만 되돌린다");
  assert.equal(h.state.probes.length, 1, "프로브는 그대로");
  h.session.undo();
  assert.equal(h.state.probes.length, 0);
  assert.equal(h.value(), "1.2k");
  h.session.undo();
  assert.equal(h.value(), "1k");
  h.done();
});

test("프로브 제거와 다른 프로브 종류의 편집도 묶음을 닫는다", () => {
  const h = harness();
  h.wheel("1.2k");
  h.session.addCurrentProbe("R1");
  h.session.removeProbe("I:R1");
  h.wheel("1.5k");
  assert.equal(h.state.history.length, 4);
  h.done();
});

test("모든 기록 경로가 묶음을 닫는다: mutate, commitMove, undo/redo(restore)", () => {
  const h = harness();
  // mutate(history) 사이
  h.wheel("1.2k");
  h.session.mutate(() => { h.state.title = "바뀐 제목"; });
  h.wheel("1.5k");
  assert.equal(h.state.history.length, 3);
  // commitMove 사이
  const before = h.session.snapshot();
  h.wheel("1.8k");
  h.session.commitMove(before);
  h.wheel("2.2k");
  assert.equal(h.state.history.length, 5);
  // undo 사이: 되돌린 뒤의 휠은 새 항목
  h.session.undo();
  const depth = h.state.history.length;
  h.wheel("3.3k");
  assert.equal(h.state.history.length, depth + 1);
  h.session.undo();
  h.session.redo();
  h.wheel("4.7k");
  assert.equal(h.state.history.length, depth + 2);
  h.done();
});

test("확정된 편집마다 onCommitted가 불린다(자동 저장 예약 지점)", () => {
  const h = harness();
  h.wheel("1.2k");
  h.session.addVoltageProbe("R1", 0);
  h.session.undo();
  assert.equal(h.committed.length, 3);
  h.done();
});

test("드래그를 먼저 확정하면 기록 순서가 맞다: 이동 → 회전, 되돌리기는 회전 → 이동 순으로 되돌린다", () => {
  const h = harness();
  const part = h.state.circuit.components[0];
  // 드래그 시작: 이동 전 스냅샷을 잡고 살아 있는 좌표를 옮긴다
  const before = h.session.snapshot();
  part.x = 300; part.y = 220;
  // 키보드 R: 편집기는 먼저 드래그를 확정(commitMove)한 뒤 회전을 기록한다
  h.session.commitMove(before);
  h.session.mutate(() => { part.rotation = 90; });
  assert.equal(h.state.history.length, 2);
  h.session.undo();
  assert.deepEqual([h.state.circuit.components[0].x, h.state.circuit.components[0].y, h.state.circuit.components[0].rotation], [300, 220, 0], "회전만 취소");
  h.session.undo();
  assert.deepEqual([h.state.circuit.components[0].x, h.state.circuit.components[0].y], [100, 100], "그다음 이동 취소");
  h.done();
});

test("방향키 반복: 첫 키 → 반복 지연(Windows 약 500ms) → 반복은 되돌리기 한 단계, 키를 떼면 묶음이 닫힌다", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = harness();
  const nudge = (dx) => h.session.mutateGrouped("nudge", () => { h.state.circuit.components[0].x += dx; }, { idleMs: NUDGE_IDLE_MS });
  nudge(20); // keydown(repeat: false)
  t.mock.timers.tick(550); // OS 키 반복 지연: 예전 400ms 유휴 한도는 여기서 묶음을 닫아 두 단계가 됐다
  nudge(20);
  t.mock.timers.tick(30);
  nudge(20);
  t.mock.timers.tick(30);
  nudge(20);
  assert.equal(h.state.history.length, 1, "누르고 있는 동안은 한 단계");
  h.session.closeEditGroup("wheel:R1"); // 다른 묶음의 키업은 방향키 묶음을 건드리지 않는다
  nudge(20);
  assert.equal(h.state.history.length, 1);
  h.session.closeEditGroup("nudge"); // keyup
  nudge(20); // 새로 누른 키
  assert.equal(h.state.history.length, 2, "키를 떼고 다시 누르면 새 단계");
  h.session.undo();
  assert.equal(h.state.circuit.components[0].x, 100 + 20 * 5, "한 번의 되돌리기는 길게 누른 이동 전체를 되돌린다");
  h.done();
});

test("마지막 입력 뒤 700ms가 지나면 묶음이 저절로 닫힌다(키업을 못 받은 경우의 대비)", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = harness();
  const nudge = () => h.session.mutateGrouped("nudge", () => { h.state.circuit.components[0].x += 20; }, { idleMs: NUDGE_IDLE_MS });
  nudge();
  t.mock.timers.tick(699);
  nudge();
  assert.equal(h.state.history.length, 1);
  t.mock.timers.tick(700);
  nudge();
  assert.equal(h.state.history.length, 2);
  h.done();
});

test("프로젝트 안에서 되돌리기는 전체 초기화 대신 가벼운 정리만, 다른 프로젝트 스냅샷이면 전체 초기화를 부른다", () => {
  const calls = [];
  const state = createEditorState();
  state.circuit = { version: 1, geometryVersion: state.circuit.geometryVersion, components: [{ id: "R1", type: "R", x: 100, y: 100, rotation: 0, props: { ref: "R1", value: "1k" } }], wires: [], junctions: [] };
  const noop = () => {};
  const session = createEditorSession({
    state, inputDrafts: { retainComponents: noop }, synchronizeIntent: noop, markStale: noop, scheduleAutoRun: noop, renderAll: noop,
    resetProjectSession: () => calls.push("reset"), beforeHistoryRestore: () => calls.push("before"), afterHistoryRestore: () => calls.push("after"),
    refreshProbeViews: noop, closeProbeContextMenu: noop, confirmDiscardDrafts: () => true,
  });
  session.mutate(() => { state.circuit.components[0].props.value = "2k"; });
  session.undo();
  assert.deepEqual(calls, ["before", "after"], "같은 프로젝트: 결과·스코프·포트·스윕을 지우지 않는다");
  calls.length = 0;
  const oldProject = session.snapshot();
  session.mutate(() => { state.projectId = "other-project"; state.circuit = { ...state.circuit, components: [] }; }); // 새 프로젝트로 교체
  state.history.push(oldProject);
  session.undo();
  assert.equal(calls[0], "reset", "프로젝트 경계를 넘으면 전체 초기화");
  assert.equal(state.circuit.components.length, 1);
});

// ---- 프로젝트 경계를 넘는 되돌리기: 자동 저장 슬롯 회전 ----
import { createAutosave, AUTOSAVE_PREFIX } from "../../src/persistence.js";

function boundaryHarness({ withHook }) {
  const data = new Map();
  const storage = { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => { data.set(k, String(v)); }, removeItem: (k) => { data.delete(k); }, get length() { return data.size; }, key: (i) => [...data.keys()][i] ?? null };
  const queue = new Map();
  let clock = 1000;
  let nextTimer = 1;
  const autosave = createAutosave({
    storage, tabId: "tab-boundary", now: () => clock,
    setTimeout: (fn, ms) => { const id = nextTimer++; queue.set(id, { fn, at: clock + ms }); return id; },
    clearTimeout: (id) => queue.delete(id),
  });
  const advance = (ms) => { clock += ms; for (const [id, t] of [...queue]) if (t.at <= clock) { queue.delete(id); t.fn(); } };
  const state = createEditorState();
  state.circuit = { version: 1, geometryVersion: state.circuit.geometryVersion, components: [{ id: "R1", type: "R", x: 100, y: 100, rotation: 0, props: { ref: "R1", value: "1k" } }], wires: [], junctions: [] };
  state.title = "A";
  const noop = () => {};
  const project = () => ({ title: state.title, subtitle: state.subtitle, circuit: state.circuit, settings: state.settings, probes: state.probes });
  const session = createEditorSession({
    state, inputDrafts: { retainComponents: noop }, synchronizeIntent: noop, markStale: noop, scheduleAutoRun: noop, renderAll: noop,
    resetProjectSession: noop, refreshProbeViews: noop, closeProbeContextMenu: noop, confirmDiscardDrafts: () => true,
    beforeProjectBoundary: withHook ? () => autosave.retire() : undefined,
    onCommitted: () => autosave.schedule(project()),
  });
  const title = (key) => JSON.parse(data.get(key)).project.title;
  /** Same bookkeeping project-io does for new/open/example, then the replacement itself (one undo step). */
  const replaceWith = (name) => {
    autosave.retire();
    session.mutate(() => { state.projectId = `proj-${name}`; state.title = name; state.circuit = { ...state.circuit, components: [{ id: "R1", type: "R", x: 100, y: 100, rotation: 0, props: { ref: "R1", value: `${name}k` } }] }; });
  };
  return { state, session, autosave, advance, data, title, replaceWith };
}

test("프로젝트 경계를 넘는 되돌리기/다시 실행: 떠나는 프로젝트가 prev로 남고 own은 복원된 프로젝트다", () => {
  const h = boundaryHarness({ withHook: true });
  h.session.mutate(() => { h.state.circuit.components[0].props.value = "2k"; }); // A의 편집
  h.advance(800);
  assert.equal(h.title("circuit-lab.autosave.v2.tab-boundary"), "A");
  h.replaceWith("B");
  h.advance(800);
  const own = `${AUTOSAVE_PREFIX}tab-boundary`;
  assert.equal(h.title(own), "B");
  assert.equal(h.title(`${own}.prev`), "A");
  h.session.undo(); // B의 열기를 되돌려 A로 돌아간다 (다른 projectId)
  assert.equal(h.state.title, "A");
  h.advance(800);
  assert.equal(h.title(own), "A", "복원된 A가 own");
  assert.equal(h.title(`${own}.prev`), "B", "떠난 B는 prev에 남는다 (own=A, prev=A로 B를 잃지 않는다)");
  h.session.redo(); // 다시 B로
  h.advance(800);
  assert.equal(h.title(own), "B");
  assert.equal(h.title(`${own}.prev`), "A");
});

test("프로젝트 경계 훅이 없으면 B가 사라진다(회귀 확인용)", () => {
  const h = boundaryHarness({ withHook: false });
  h.session.mutate(() => { h.state.circuit.components[0].props.value = "2k"; });
  h.advance(800);
  h.replaceWith("B");
  h.advance(800);
  h.session.undo();
  h.advance(800);
  const own = `${AUTOSAVE_PREFIX}tab-boundary`;
  assert.equal(h.title(`${own}.prev`), "A", "훅 없이는 prev가 A로 덮인다");
});

test("같은 프로젝트 안의 되돌리기는 경계 훅을 부르지 않는다", () => {
  let calls = 0;
  const state = createEditorState();
  state.circuit = { version: 1, geometryVersion: state.circuit.geometryVersion, components: [], wires: [], junctions: [] };
  const noop = () => {};
  const session = createEditorSession({
    state, inputDrafts: { retainComponents: noop }, synchronizeIntent: noop, markStale: noop, scheduleAutoRun: noop, renderAll: noop,
    resetProjectSession: noop, refreshProbeViews: noop, closeProbeContextMenu: noop, confirmDiscardDrafts: () => true,
    beforeProjectBoundary: () => { calls += 1; },
  });
  session.mutate(() => { state.title = "x"; });
  session.undo();
  session.redo();
  assert.equal(calls, 0);
});
