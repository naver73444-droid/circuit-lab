import test from "node:test";
import assert from "node:assert/strict";
import { createEditorSession, createEditorState } from "../../src/editor-session.js";

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

test("연속 휠 단계는 한 번의 실행 취소 항목으로 묶인다", () => {
  const h = harness();
  h.wheel("1.2k"); h.wheel("1.5k"); h.wheel("1.8k");
  assert.equal(h.state.history.length, 1);
  h.session.undo();
  assert.equal(h.value(), "1k");
  h.done();
});

test("휠 → 프로브 추가 → 400ms 안에 휠: 실행 취소는 마지막 휠 단계만 되돌린다", () => {
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

test("드래그를 먼저 확정하면 기록 순서가 맞다: 이동 → 회전, 실행 취소는 회전 → 이동 순으로 되돌린다", () => {
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
