import test from "node:test";
import assert from "node:assert/strict";
import { applyGroupOffset, captureGroupOrigins, moveGroup, restoreGroupOrigins, rotateGroup, rotationPivot } from "../../src/group-edit.js";
import { createEditorSession, createEditorState, newProjectId } from "../../src/editor-session.js";
import { deleteComponentFromCircuit } from "../../src/circuit-edit.js";
import { passedDragSlop } from "../../src/interaction-math.js";
import { shortcutFor } from "../../src/editor-shortcuts.js";
import { cloneExample } from "../../src/examples.js";

// 리뷰 보완: 그룹 이동 격자 맞춤, 회전 각도 정규화·축, 대기 배선 정리, 프로젝트 id, 단축키 소유권, 포인터 슬롭.

const item = (id) => ({ kind: id.startsWith("J") ? "junction" : id.startsWith("W") ? "wire" : "component", id });
const items = (...ids) => ids.map(item);
const onGrid = (value) => Math.abs(value / 20 - Math.round(value / 20)) < 1e-9;

function offGridCircuit() {
  const { circuit } = cloneExample("divider");
  circuit.junctions = [{ id: "J1", x: 107, y: 133 }];
  const [v1, r1, r2] = circuit.components;
  v1.x = 107; v1.y = 133; // first item of the group is off the grid
  r1.x = 200; r1.y = 120;
  r2.x = 260; r2.y = 120;
  circuit.wires = [{ id: "W1", a: { componentId: v1.id, pin: 0 }, b: { componentId: r1.id, pin: 0 }, waypoints: [{ x: 113, y: 127 }, { x: 200, y: 127 }] }];
  return circuit;
}

test("그룹 이동은 기준 항목뿐 아니라 모든 항목(과 꺾임점)을 격자에 맞춘다", () => {
  const circuit = offGridCircuit();
  const moved = moveGroup(circuit, items("V1", "R1", "R2", "J1"), 20, 0);
  assert.equal(moved, 4);
  for (const entry of [...circuit.components, ...circuit.junctions]) assert.ok(onGrid(entry.x) && onGrid(entry.y), `${entry.id} (${entry.x}, ${entry.y})`);
  for (const point of circuit.wires[0].waypoints) assert.ok(onGrid(point.x) && onGrid(point.y), "꺾임점도 격자 위");
  assert.deepEqual([circuit.components[1].x, circuit.components[1].y], [220, 120], "원래 격자 위였던 항목은 델타(20)만큼 이동");
});

test("applyGroupOffset: snap은 항목별로 맞추고, 복원은 정확한 원래 값을 되돌린다", () => {
  const circuit = offGridCircuit();
  const before = structuredClone(circuit);
  const origins = captureGroupOrigins(circuit, items("V1", "R1", "J1"));
  applyGroupOffset(circuit, origins, 40, 20, { snap: true });
  assert.deepEqual([circuit.components[0].x, circuit.components[0].y], [140, 160], "(107,133)+(40,20)=(147,153)은 가장 가까운 격자 (140,160)로");
  for (const entry of [...circuit.components.slice(0, 2), ...circuit.junctions]) assert.ok(onGrid(entry.x) && onGrid(entry.y));
  restoreGroupOrigins(circuit, origins);
  assert.deepEqual(circuit, before, "복원은 스냅하지 않는다");
  applyGroupOffset(circuit, origins, 40, 20);
  assert.equal(circuit.components[0].x, 147, "snap 없이는 기존처럼 평행 이동");
});

test("그룹 회전: 음수 각도도 0..270으로 정규화한다 (한 부품·여러 부품 모두)", () => {
  const single = offGridCircuit();
  single.components[1].rotation = -90;
  rotateGroup(single, items("R1"), 1);
  assert.equal(single.components[1].rotation, 0);
  single.components[1].rotation = -90;
  rotateGroup(single, items("R1"), -1);
  assert.equal(single.components[1].rotation, 180);
  const group = offGridCircuit();
  group.components[1].rotation = -90; group.components[2].rotation = -270; group.components[0].rotation = 450;
  rotateGroup(group, items("V1", "R1", "R2"), -1, { kind: "component", id: "R1" });
  for (const component of group.components.slice(0, 3)) assert.ok([0, 90, 180, 270].includes(component.rotation), `${component.id}: ${component.rotation}`);
  assert.deepEqual(group.components.slice(0, 3).map((component) => component.rotation), [0, 180, 0]);
});

test("회전 축: 기본 항목이 배선이면 마지막으로 선택한 부품, 부품이 없으면 선택 범위 중심(격자)", () => {
  const circuit = offGridCircuit();
  circuit.components[0].x = 100; circuit.components[0].y = 120;
  const origins = captureGroupOrigins(circuit, items("V1", "R1", "W1"));
  assert.deepEqual(rotationPivot(origins, items("V1", "R1", "W1"), { kind: "wire", id: "W1" }), { x: 200, y: 120 }, "배선이 기본 항목이어도 임의의 첫 부품(V1)이 아니라 마지막 부품 R1");
  assert.deepEqual(rotationPivot(origins, items("R1", "V1", "W1"), { kind: "wire", id: "W1" }), { x: 100, y: 120 }, "선택 순서의 마지막 부품");
  assert.deepEqual(rotationPivot(origins, items("V1", "R1", "W1"), { kind: "component", id: "V1" }), { x: 100, y: 120 }, "기본 항목이 부품이면 그 부품");
  assert.deepEqual(rotationPivot(origins, items("V1", "R1"), { kind: "component", id: "R2" }), { x: 200, y: 120 }, "그룹 밖 id가 기본이면 마지막 부품");
  const base = circuit;
  rotateGroup(base, items("V1", "R1", "W1"), 1, { kind: "wire", id: "W1" });
  assert.deepEqual([base.components[1].x, base.components[1].y], [200, 120], "R1이 축이라 제자리");
  assert.deepEqual([base.components[0].x, base.components[0].y], [200, 20], "V1은 R1 기준으로 도는 위치");

  const junctions = { components: [], wires: [], junctions: [{ id: "J1", x: 100, y: 100 }, { id: "J2", x: 140, y: 160 }] };
  const jOrigins = captureGroupOrigins(junctions, items("J1", "J2"));
  assert.deepEqual(rotationPivot(jOrigins, items("J1", "J2"), null), { x: 120, y: 140 }, "범위 중심 (120,130)을 격자로");
  rotateGroup(junctions, items("J1", "J2"), 1);
  for (const junction of junctions.junctions) assert.ok(onGrid(junction.x) && onGrid(junction.y), junction.id);
  assert.deepEqual(junctions.junctions.map((junction) => [junction.x, junction.y]), [[160, 120], [100, 160]]);
});

// ---- 세션: 대기 배선 정리, 프로젝트 id

function sessionHarness() {
  const state = createEditorState();
  state.circuit = { version: 1, geometryVersion: state.circuit.geometryVersion, components: [
    { id: "R1", type: "R", x: 100, y: 100, rotation: 0, props: { ref: "R1", value: "1k" } },
    { id: "R2", type: "R", x: 200, y: 100, rotation: 0, props: { ref: "R2", value: "1k" } },
  ], wires: [], junctions: [{ id: "J1", x: 150, y: 40 }] };
  const dropped = [];
  const noop = () => {};
  const session = createEditorSession({
    state, inputDrafts: { retainComponents: noop }, synchronizeIntent: noop, markStale: noop, scheduleAutoRun: noop, renderAll: noop,
    resetProjectSession: noop, refreshProbeViews: noop, closeProbeContextMenu: noop, confirmDiscardDrafts: () => true,
    onPendingWireDropped: () => dropped.push(true),
  });
  return { state, session, dropped };
}

test("배선 대기 중 그 부품(또는 접속점)을 지우면 대기 배선이 취소된다", () => {
  const { state, session, dropped } = sessionHarness();
  state.pendingPin = { componentId: "R1", pin: 0 };
  state.pendingWaypoints = [{ x: 120, y: 80 }];
  state.pointer = { x: 130, y: 90 };
  session.mutate(() => { state.circuit = deleteComponentFromCircuit(state.circuit, "R2").circuit; });
  assert.deepEqual(state.pendingPin, { componentId: "R1", pin: 0 }, "다른 부품을 지워도 대기는 유지");
  assert.equal(dropped.length, 0);
  session.mutate(() => { state.circuit = deleteComponentFromCircuit(state.circuit, "R1").circuit; });
  assert.equal(state.pendingPin, null);
  assert.deepEqual(state.pendingWaypoints, []);
  assert.equal(state.pointer, null);
  assert.equal(dropped.length, 1, "힌트 문구를 되돌리도록 알린다");
  state.pendingPin = { junctionId: "J1" };
  session.mutate(() => { state.circuit.junctions = []; });
  assert.equal(state.pendingPin, null, "접속점이 대기 시작점이어도 마찬가지");
  state.pendingPin = { junctionId: "J9" };
  session.mutate(() => {});
  assert.equal(state.pendingPin, null, "이미 없는 시작점");
});

test("되돌리기·다시 실행은 프로젝트 id도 함께 되돌린다 (예제 열기를 취소하면 원래 프로젝트로 붙여넣기 판정)", () => {
  const { state, session } = sessionHarness();
  const first = state.projectId;
  assert.match(first, /^[a-z0-9]+-[a-z0-9]+$/);
  assert.notEqual(newProjectId(), newProjectId());
  const second = newProjectId();
  session.mutate(() => { state.projectId = second; });
  session.undo();
  assert.equal(state.projectId, first);
  session.redo();
  assert.equal(state.projectId, second);
});

// ---- 단축키 소유권

const key = (k, extra = {}) => ({ key: k, code: "", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, isComposing: false, repeat: false, ...extra });

test("선택한 글자가 있으면 Ctrl+C·X·A는 브라우저 몫, Ctrl+V·D·Z는 그대로", () => {
  const options = { textSelection: true };
  for (const letter of ["c", "x", "a"]) assert.equal(shortcutFor(key(letter, { ctrlKey: true }), options), null, `Ctrl+${letter}`);
  assert.equal(shortcutFor(key("v", { ctrlKey: true }), options)?.action, "paste");
  assert.equal(shortcutFor(key("d", { ctrlKey: true }), options)?.action, "clone");
  assert.equal(shortcutFor(key("z", { ctrlKey: true }), options)?.action, "undo");
  assert.equal(shortcutFor(key("c", { ctrlKey: true }), { textSelection: false })?.action, "copy");
});

test("Ctrl+V·Ctrl+D·Ctrl+X를 꾹 누른 반복은 ignore로 표시된다 (복사·방향키 반복은 영향 없음)", () => {
  for (const [letter, action] of [["v", "paste"], ["d", "clone"], ["x", "cut"]]) {
    assert.equal(shortcutFor(key(letter, { ctrlKey: true })).ignore, undefined, `${action} 첫 눌림`);
    assert.deepEqual(shortcutFor(key(letter, { ctrlKey: true, repeat: true })), { action, preventDefault: true, ignore: true });
  }
  assert.equal(shortcutFor(key("c", { ctrlKey: true, repeat: true })).ignore, undefined);
  assert.equal(shortcutFor(key("ArrowLeft", { repeat: true })).repeat, true);
});

test("IME 조합 중에도 Ctrl+S는 저장(브라우저 저장 대화상자 차단), 나머지는 막힌다", () => {
  assert.deepEqual(shortcutFor(key("Process", { code: "KeyS", ctrlKey: true, isComposing: true })), { action: "save", preventDefault: true });
  assert.deepEqual(shortcutFor(key("s", { ctrlKey: true, isComposing: true })), { action: "save", preventDefault: true });
  assert.equal(shortcutFor(key("Process", { code: "KeyR", isComposing: true })), null);
  assert.equal(shortcutFor(key("z", { ctrlKey: true, isComposing: true })), null);
  assert.equal(shortcutFor(key("Enter", { ctrlKey: true, isComposing: true })), null);
});

test("펜도 터치처럼 8px 슬롭 (마우스는 4px)", () => {
  const start = { x: 0, y: 0 };
  assert.equal(passedDragSlop(start, { x: 5, y: 0 }, "mouse"), true);
  assert.equal(passedDragSlop(start, { x: 5, y: 0 }, "pen"), false);
  assert.equal(passedDragSlop(start, { x: 8, y: 0 }, "pen"), true);
  assert.equal(passedDragSlop(start, { x: 5, y: 0 }, "touch"), false);
});
