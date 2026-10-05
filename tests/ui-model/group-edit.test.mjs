import test from "node:test";
import assert from "node:assert/strict";
import { applyGroupOffset, captureGroupOrigins, groupFootprint, moveGroup, movableItems, restoreGroupOrigins, rotateGroup } from "../../src/group-edit.js";
import { pinPosition } from "../../src/circuit-geometry.js";
import { createEditorSession, createEditorState } from "../../src/editor-session.js";
import { cloneExample } from "../../src/examples.js";
import { allItems } from "../../src/selection-model.js";

function circuitWithRoute() {
  const { circuit } = cloneExample("divider");
  circuit.junctions = [{ id: "J1", x: 360, y: 240 }];
  circuit.wires.find((wire) => wire.id === "W1").waypoints = [{ x: 160, y: 120 }, { x: 360, y: 120 }];
  return circuit;
}
const items = (...ids) => ids.map((id) => ({ kind: id.startsWith("J") ? "junction" : "component", id }));
const pos = (circuit) => Object.fromEntries([...circuit.components, ...circuit.junctions].map((item) => [item.id, [item.x, item.y]]));

/** Editor session with inert collaborators: history and mutate are what matters. */
function harness() {
  const state = createEditorState();
  state.circuit = circuitWithRoute();
  const noop = () => {};
  const session = createEditorSession({ state, inputDrafts: { retainComponents: noop }, synchronizeIntent: noop, markStale: noop, scheduleAutoRun: noop, renderAll: noop, resetProjectSession: noop, refreshProbeViews: noop, closeProbeContextMenu: noop, confirmDiscardDrafts: () => true });
  return { state, session };
}

test("movableItems는 부품과 접속점만 남긴다", () => {
  assert.deepEqual(movableItems([...items("R1", "J1"), { kind: "wire", id: "W1" }]), items("R1", "J1"));
});

test("그룹 이동: 모두 같은 거리만큼, 양 끝이 함께 움직이는 배선의 꺾임점도 같이 이동", () => {
  const circuit = circuitWithRoute();
  const before = pos(circuit);
  const moved = moveGroup(circuit, items("V1", "R1", "J1"), 40, 60);
  assert.equal(moved, 3);
  const after = pos(circuit);
  for (const id of ["V1", "R1", "J1"]) assert.deepEqual(after[id], [before[id][0] + 40, before[id][1] + 60], id);
  for (const id of ["R2", "G1"]) assert.deepEqual(after[id], before[id], "선택 밖은 그대로");
  assert.deepEqual(circuit.wires.find((wire) => wire.id === "W1").waypoints, [{ x: 200, y: 180 }, { x: 400, y: 180 }], "V1-R1 배선(양끝 이동)의 꺾임점은 따라간다");
});

test("한쪽 끝이 고정된 배선의 꺾임점은 그대로 둔다", () => {
  const circuit = circuitWithRoute();
  moveGroup(circuit, items("V1"), 20, 0);
  assert.deepEqual(circuit.wires.find((wire) => wire.id === "W1").waypoints, [{ x: 160, y: 120 }, { x: 360, y: 120 }]);
});

test("드래그용 origin 기록·적용·복원은 멱등이다 (프레임마다 같은 기준에서 적용)", () => {
  const circuit = circuitWithRoute();
  const before = structuredClone(circuit);
  const origins = captureGroupOrigins(circuit, items("V1", "R1"));
  assert.deepEqual(groupFootprint(origins), { components: ["V1", "R1"], junctions: [], wires: ["W1"] });
  applyGroupOffset(circuit, origins, 20, 20);
  applyGroupOffset(circuit, origins, 60, 40);
  assert.deepEqual(pos(circuit).V1, [220, 280]);
  restoreGroupOrigins(circuit, origins);
  assert.deepEqual(circuit, before);
  assert.doesNotThrow(() => JSON.stringify(origins), "plain data");
});

test("그룹 회전: 한 부품은 제자리, 여러 개는 기준 부품을 축으로 함께 돌고 모든 위치가 격자 위에 남는다", () => {
  const single = circuitWithRoute();
  const original = pos(single).R1;
  assert.equal(rotateGroup(single, items("R1"), 1), 1);
  assert.deepEqual(pos(single).R1, original);
  assert.equal(single.components.find((c) => c.id === "R1").rotation, 180);

  const group = circuitWithRoute();
  const wasRotation = Object.fromEntries(group.components.map((c) => [c.id, c.rotation]));
  assert.equal(rotateGroup(group, items("V1", "R1", "R2", "G1", "J1"), 1), 5);
  for (const item of [...group.components, ...group.junctions]) {
    assert.equal(item.x % 20, 0, item.id + " x on grid");
    assert.equal(item.y % 20, 0, item.id + " y on grid");
  }
  for (const c of group.components) assert.equal(c.rotation, (wasRotation[c.id] + 90) % 360);
  const dist = (circuit, a, b) => { const p = pos(circuit); return Math.hypot(p[a][0] - p[b][0], p[a][1] - p[b][1]); };
  const base = circuitWithRoute();
  for (const [a, b] of [["V1", "R1"], ["R1", "R2"], ["G1", "J1"]]) assert.ok(Math.abs(dist(group, a, b) - dist(base, a, b)) < 1e-9, a + b);
  const four = circuitWithRoute();
  for (let n = 0; n < 4; n += 1) rotateGroup(four, items("V1", "R1", "R2", "G1", "J1"), 1);
  assert.deepEqual(four, circuitWithRoute(), "네 번 돌리면 제자리");
  const reverse = circuitWithRoute();
  rotateGroup(reverse, items("V1", "R1", "R2"), 1);
  rotateGroup(reverse, items("V1", "R1", "R2"), -1);
  assert.deepEqual(reverse, circuitWithRoute(), "시계 후 반시계는 제자리");
  const pivoted = circuitWithRoute();
  rotateGroup(pivoted, items("V1", "R1", "R2"), 1, { kind: "component", id: "R2" });
  assert.deepEqual(pos(pivoted).R2, pos(base).R2, "기준 부품은 제자리");
  assert.deepEqual([pos(pivoted).R1[0] - pos(pivoted).R2[0], pos(pivoted).R1[1] - pos(pivoted).R2[1]], [140, 0], "R1은 R2 기준 (0,-140)에서 (140,0)으로");
  const a0 = pinPosition(base.components[0], 0), b0 = pinPosition(base.components[1], 0);
  const rotated = circuitWithRoute();
  rotateGroup(rotated, items("V1", "R1", "R2", "G1", "J1"), 1);
  const a1 = pinPosition(rotated.components[0], 0), b1 = pinPosition(rotated.components[1], 0);
  assert.ok(Math.abs((b1.x - a1.x) - -(b0.y - a0.y)) < 1e-9 && Math.abs((b1.y - a1.y) - (b0.x - a0.x)) < 1e-9, "핀 사이 상대 벡터 (dx,dy)가 (-dy,dx)로");
});

test("그룹 이동·회전은 mutate 한 번 = 이력 한 항목이고 되돌리면 한 번에 복원된다", () => {
  const { state, session } = harness();
  const everything = allItems(state.circuit);
  const original = structuredClone(state.circuit);
  session.mutate(() => { moveGroup(state.circuit, everything, 40, 20); });
  assert.equal(state.history.length, 1);
  session.mutate(() => { rotateGroup(state.circuit, everything, 1); });
  assert.equal(state.history.length, 2);
  session.undo();
  session.undo();
  assert.deepEqual(state.circuit.components, original.components);
  assert.deepEqual(state.circuit.wires, original.wires);
  assert.equal(state.history.length, 0);
});

test("키보드 그룹 이동: 눌러 둔 방향키 반복은 이력 한 항목으로 묶인다 (mutateGrouped)", () => {
  const { state, session } = harness();
  const group = items("V1", "R1", "R2");
  for (let n = 0; n < 5; n += 1) session.mutateGrouped("nudge", () => { moveGroup(state.circuit, group, 20, 0); });
  assert.equal(state.history.length, 1);
  assert.equal(state.circuit.components.find((c) => c.id === "R1").x, 460);
  session.closeEditGroup();
  session.undo();
  assert.equal(state.circuit.components.find((c) => c.id === "R1").x, 360);
});

test("드래그 커밋: commitMove(before) 한 번이 그룹 이동 전체의 이력 한 항목", () => {
  const { state, session } = harness();
  const before = session.snapshot();
  const origins = captureGroupOrigins(state.circuit, items("V1", "R1", "R2"));
  for (let frame = 1; frame <= 10; frame += 1) applyGroupOffset(state.circuit, origins, frame * 4, frame * 2);
  assert.equal(state.history.length, 0, "드래그 중에는 이력이 없다");
  session.commitMove(before);
  assert.equal(state.history.length, 1);
  assert.equal(state.circuit.components.find((c) => c.id === "V1").x, 200);
  session.undo();
  assert.equal(state.circuit.components.find((c) => c.id === "V1").x, 160);
  assert.equal(state.circuit.components.find((c) => c.id === "R2").y, 300);
});
