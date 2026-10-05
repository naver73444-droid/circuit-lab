import test from "node:test";
import assert from "node:assert/strict";
import { CLIPBOARD_FORMAT, additionLimitReason, buildClipboard, normalizeClipboardWires, parseClipboardText, pasteClipboard, serializeClipboard } from "../../src/clipboard-model.js";
import { cloneComponentSet, componentIdPrefix, splitWireAtJunction } from "../../src/circuit-edit.js";
import { allocatorFor, createIdAllocator } from "../../src/id-allocator.js";
import { createSelectionCommands } from "../../src/selection-commands.js";
import { createClipboardShortcutGate } from "../../src/editor-shortcuts.js";
import { rotateGroup } from "../../src/group-edit.js";
import { CIRCUIT_LIMITS } from "../../src/circuit-engine.js";
import { setSingleSelection, setSelectionItems } from "../../src/selection-model.js";
import { createEditorSession, createEditorState } from "../../src/editor-session.js";

// 2차 리뷰 보완: 복사·붙여넣기·복제·그룹 회전·id 발급.

const comp = (id) => ({ kind: "component", id });
const R = (id, x = 100, y = 100, extra = {}) => ({ id, type: "R", x, y, rotation: 0, props: { ref: id, value: "1k" }, ...extra });
const pin = (componentId, p) => ({ componentId, pin: p });
const baseCircuit = (extra = {}) => ({ version: 1, geometryVersion: 2, components: [R("R1"), R("R2", 200, 100)], wires: [], junctions: [], ...extra });
const sensorCircuit = () => baseCircuit({
  components: [
    { id: "S1", type: "CURRENT_SENSOR", x: 100, y: 100, rotation: 0, props: { ref: "S1" } },
    { id: "F1", type: "CCCS", x: 300, y: 100, rotation: 0, props: { ref: "F1", beta: "2" }, control: { kind: "branchCurrent", elementId: "S1", direction: 1 } },
  ],
});

/** selection-commands on a real editor session (history, ids) with inert collaborators. */
function harness(circuit = baseCircuit(), { projectId = "project-1" } = {}) {
  const state = { ...createEditorState(), inlineEdit: null, pointerOwnerId: null, pendingPin: null };
  state.projectId = projectId;
  state.circuit = circuit;
  const noop = () => {};
  const session = createEditorSession({ state, inputDrafts: { retainComponents: noop }, synchronizeIntent: noop, markStale: noop, scheduleAutoRun: noop, renderAll: noop, resetProjectSession: noop, refreshProbeViews: noop, closeProbeContextMenu: noop, confirmDiscardDrafts: () => true });
  const statuses = [], notices = [];
  const commands = createSelectionCommands({
    state, elements: { "inline-value-editor": { classList: { add() {} } } },
    mutate: session.mutate, mutateGrouped: session.mutateGrouped, closeEditGroup: session.closeEditGroup, commitActiveDrag() {},
    setStatus: (text, kind) => statuses.push([text, kind]), renderSelection() {}, isCircuitUiActive: () => true,
    notify: (text, kind) => notices.push([text, kind]),
  });
  return { state, session, commands, statuses, notices };
}

function withNavigator(clipboard, body) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { value: { clipboard }, configurable: true, writable: true });
  const restore = () => { if (original) Object.defineProperty(globalThis, "navigator", original); else delete globalThis.navigator; };
  return Promise.resolve(body()).finally(restore);
}
const tick = () => new Promise((resolve) => setImmediate(resolve));
const nativeData = (text) => ({ getData: () => text, setData() {} });

// ---- 6: parallel wires

const parallel = () => baseCircuit({
  wires: [
    { id: "Wa", a: pin("R1", 1), b: pin("R2", 0), waypoints: [{ x: 120, y: 60 }] },
    { id: "Wb", a: pin("R1", 1), b: pin("R2", 0), waypoints: [{ x: 120, y: 160 }] },
    { id: "Wc", a: pin("R1", 1), b: pin("R2", 0) },
  ],
});

test("복사·붙여넣기: 같은 끝점이라도 경로가 다른 병렬 배선은 남기고, 완전히 같은 배선·자기 루프만 버린다", () => {
  const circuit = parallel();
  const clip = buildClipboard(circuit, [comp("R1"), comp("R2")], "p");
  assert.equal(clip.wires.length, 3);
  const text = serializeClipboard(clip);
  const parsed = parseClipboardText(text);
  assert.deepEqual(parsed.wires.map((wire) => wire.id), ["Wa", "Wb", "Wc"], "경로가 다르면 세 배선 모두 유지");
  // 정확히 같은 두 배선(끝점이 뒤집히고 꺾임점이 거꾸로여도 같은 경로)과 자기 루프
  const noisy = { ...clip, wires: [
    ...clip.wires,
    { id: "Wd", a: pin("R2", 0), b: pin("R1", 1), waypoints: [{ x: 120, y: 160 }] }, // Wb의 반대 방향 복제
    { id: "We", a: pin("R1", 1), b: pin("R2", 0), waypoints: [{ x: 120, y: 60 }] }, // Wa와 완전히 같음
    { id: "Wf", a: pin("R1", 0), b: pin("R1", 0) }, // 핀에서 같은 핀으로
  ] };
  const cleaned = parseClipboardText(JSON.stringify(noisy));
  assert.deepEqual(cleaned.wires.map((wire) => wire.id), ["Wa", "Wb", "Wc"]);
  const multi = { ...clip, wires: [{ id: "A", a: pin("R1", 1), b: pin("R2", 0), waypoints: [{ x: 1, y: 2 }, { x: 3, y: 4 }] }, { id: "B", a: pin("R2", 0), b: pin("R1", 1), waypoints: [{ x: 3, y: 4 }, { x: 1, y: 2 }] }] };
  assert.deepEqual(normalizeClipboardWires(multi.wires).map((wire) => wire.id), ["A"], "끝점을 바꾸고 꺾임점을 거꾸로 읽으면 같은 경로");
  assert.deepEqual(normalizeClipboardWires([{ id: "A", a: pin("R1", 1), b: pin("R2", 0), waypoints: [] }, { id: "B", a: pin("R1", 1), b: pin("R2", 0) }]).map((wire) => wire.id), ["A"], "waypoints 없음 = 빈 배열");
});

test("붙여넣기 결과는 붙여넣는 경로(내부 클립보드 / 시스템 텍스트)와 무관하다", () => {
  const circuit = parallel();
  const noisy = buildClipboard(circuit, [comp("R1"), comp("R2")], "p");
  noisy.wires.push({ id: "Wx", a: pin("R2", 0), b: pin("R1", 1), waypoints: [{ x: 120, y: 160 }] }, { id: "Wy", a: pin("R1", 0), b: pin("R1", 0) });
  const target = baseCircuit();
  const viaInternal = pasteClipboard(target, noisy, 1, { sameProject: false });
  const viaText = pasteClipboard(target, parseClipboardText(JSON.stringify(noisy)), 1, { sameProject: false });
  assert.equal(viaInternal.wires.length, 3);
  assert.deepEqual(viaInternal, viaText);
  assert.deepEqual(viaInternal.wires.map((wire) => wire.waypoints ?? null), [[{ x: 160, y: 100 }], [{ x: 160, y: 200 }], null], "경로는 (붙여넣기 간격만큼 옮겨져) 그대로 따라온다");
});

// ---- 7: ids are never reused

test("id 발급은 단조 증가: 삭제한 S1의 id를 새 센서가 물려받지 않고, undo/redo로 낮아지지 않는다", () => {
  const circuit = sensorCircuit();
  const state = { projectId: "p1", circuit };
  const allocator = allocatorFor(state);
  allocator.observe(circuit.components);
  assert.equal(allocator.next("S", circuit.components), "S2", "읽어 들인 회로(S1)에서 이어서 센다");
  // S1·S2를 지운 뒤에도 S3부터
  circuit.components = circuit.components.filter((component) => component.id !== "S1");
  assert.equal(allocator.next("S", circuit.components), "S3");
  const snapshot = structuredClone(circuit);
  circuit.components = []; // undo가 되돌려도 allocator는 기억한다
  circuit.components = snapshot.components;
  assert.equal(allocator.next("S", circuit.components), "S4");
  assert.equal(allocatorFor({ projectId: "p1", idAllocators: state.idAllocators }), allocator, "같은 프로젝트는 같은 allocator");
  assert.notEqual(allocatorFor({ projectId: "p2", idAllocators: state.idAllocators }), allocator, "새 프로젝트는 새 allocator(회로에서 다시 시작)");
  assert.equal(createIdAllocator().next("R", [{ id: "R7" }, { id: "Rx" }, { id: "R12abc" }]), "R8", "숫자로만 된 꼬리만 센다");
  assert.equal(componentIdPrefix("CURRENT_SENSOR"), "S");
  assert.equal(componentIdPrefix("OPAMP_IDEAL"), "U");
});

test("S1을 지우고 같은 id를 쓰는 새 센서를 놓아도, 붙여넣은 F1은 그 센서에 묶이지 않는다", () => {
  const { state, session, commands, notices } = harness(sensorCircuit());
  setSingleSelection(state, comp("F1"));
  commands.copySelection();
  // S1을 지운다 (아직 아무 id도 발급한 적 없는 상태: 읽어 들인 회로의 S1이 기억되어야 한다)
  setSingleSelection(state, comp("S1"));
  commands.deleteSelection();
  assert.deepEqual(state.circuit.components.map((component) => component.id), ["F1"]);
  // 새 센서를 놓는다 (editor-input의 nextId와 같은 경로)
  const id = allocatorFor(state).next(componentIdPrefix("CURRENT_SENSOR"), state.circuit.components);
  assert.equal(id, "S2", "S1을 다시 쓰지 않는다");
  session.mutate(() => state.circuit.components.push({ id, type: "CURRENT_SENSOR", x: 500, y: 300, rotation: 0, props: { ref: id } }));
  commands.pasteSelection();
  const pasted = state.circuit.components.find((component) => component.type === "CCCS" && component.id !== "F1");
  assert.ok(pasted, "붙여넣기 성공");
  assert.equal(pasted.control, undefined, "S1은 이제 없으므로 제어 참조를 지운다");
  assert.ok(notices.some(([text]) => text.includes("제어 대상을 다시 선택하세요")));
});

test("복제·붙여넣기·배선 분할로 생기는 id도 allocator를 거친다(부품·접속점·배선)", () => {
  const circuit = baseCircuit({ junctions: [{ id: "J1", x: 150, y: 100 }], wires: [{ id: "W1", a: pin("R1", 1), b: { junctionId: "J1" } }, { id: "W2", a: { junctionId: "J1" }, b: pin("R2", 0) }] });
  const allocator = createIdAllocator();
  const first = cloneComponentSet(circuit, ["R1", "R2"], 40, { junctionIds: ["J1"], allocator });
  assert.deepEqual([...first.idMap], [["R1", "R3"], ["R2", "R4"]]);
  assert.deepEqual(first.wires.map((wire) => wire.id), ["W3", "W4"]);
  assert.deepEqual([...first.junctionMap], [["J1", "J2"]]);
  // 첫 복제본을 회로에 넣지 않았어도(취소) 다음 복제는 다른 id
  const second = cloneComponentSet(circuit, ["R1"], 40, { allocator });
  assert.deepEqual([...second.idMap], [["R1", "R5"]]);
  const split = splitWireAtJunction(circuit, "W1", { x: 125, y: 100 }, null, allocator);
  assert.equal(split.junction.id, "J3", "분할로 생기는 접속점도 이미 쓴 J1·J2 위에서 이어 센다");
  assert.deepEqual(split.splitWireIds, ["W5", "W6"], "새 배선도 (복제가 쓴 W3·W4 다음)");
});

// ---- 8: async readText after a project switch

test("readText가 프로젝트 전환 뒤에 끝나면 새 프로젝트에 붙여넣지 않는다", async () => {
  const { state, commands, statuses } = harness(baseCircuit());
  const clip = buildClipboard(state.circuit, [comp("R1")], "someone-else");
  const text = serializeClipboard(clip);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  await withNavigator({ readText: async () => { await gate; return text; } }, async () => {
    commands.pasteSelection(); // internal clipboard is empty: asks the system clipboard
    // the user opens another project before the read finishes
    state.projectId = "project-2";
    state.circuit = baseCircuit({ components: [R("R9", 400, 400)] });
    release();
    await tick();
    assert.deepEqual(state.circuit.components.map((component) => component.id), ["R9"], "새 프로젝트는 그대로");
    assert.ok(!statuses.some(([message]) => message.includes("개 붙여넣기")), "붙여넣기 알림도 없다");
  });
});

test("같은 프로젝트에서 끝난 readText는 붙여넣고, 더 새 붙여넣기 요청이 있으면 오래된 요청은 버린다", async () => {
  const { state, commands } = harness(baseCircuit());
  const text = serializeClipboard(buildClipboard(state.circuit, [comp("R1")], "elsewhere"));
  await withNavigator({ readText: async () => text }, async () => {
    commands.pasteSelection();
    await tick();
    assert.equal(state.circuit.components.length, 3, "같은 프로젝트: 붙여넣어진다");
  });
  const second = harness(baseCircuit());
  let releaseFirst, releaseSecond;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const secondGate = new Promise((resolve) => { releaseSecond = resolve; });
  let calls = 0;
  await withNavigator({ readText: async () => { calls += 1; await (calls === 1 ? firstGate : secondGate); return text; } }, async () => {
    second.commands.pasteSelection();
    second.commands.pasteSelection();
    releaseSecond(); releaseFirst();
    await tick();
    assert.equal(second.state.circuit.components.length, 3, "두 번 눌렀어도 오래된 요청은 버려져 한 번만");
  });
});

// ---- 9: group rotation is exact

test("그룹 회전: 격자 밖 좌표도 시계 → 반시계로 정확히 제자리로 돌아온다(요소별 격자 스냅 없음)", () => {
  const make = () => baseCircuit({
    components: [R("R1", 13.37, 7.25), R("R2", 101.1, 55.55), R("R3", 200, 100), R("R4", -33.3, 91.7)],
    junctions: [{ id: "J1", x: 77.7, y: -12.4 }],
    wires: [{ id: "W1", a: pin("R1", 1), b: pin("R2", 0), waypoints: [{ x: 31.3, y: 17.9 }, { x: 99.9, y: 3.3 }] }],
  });
  const selection = [comp("R1"), comp("R2"), comp("R3"), comp("R4"), { kind: "junction", id: "J1" }];
  for (const [first, second] of [[1, -1], [-1, 1]]) {
    const circuit = make();
    const before = structuredClone(circuit);
    rotateGroup(circuit, selection, first, comp("R2"));
    assert.notDeepEqual(circuit.components.map((c) => [c.x, c.y]), before.components.map((c) => [c.x, c.y]), "실제로 돌았다");
    assert.deepEqual(circuit.components.find((c) => c.id === "R2") && [circuit.components[1].x, circuit.components[1].y], [101.1, 55.55], "피벗은 제자리");
    rotateGroup(circuit, selection, second, comp("R2"));
    assert.deepEqual(circuit, before, `방향 ${first} 다음 ${second}: 좌표 정확히 복원`);
  }
  const circuit = make();
  const before = structuredClone(circuit);
  for (let i = 0; i < 4; i += 1) rotateGroup(circuit, selection, 1, comp("R1"));
  assert.deepEqual(circuit, before, "시계 방향 네 번도 제자리");
  // 피벗이 선택에 없거나 배선이면 마지막으로 고른 부품이 피벗
  const wirePivot = make();
  rotateGroup(wirePivot, selection, 1, { kind: "wire", id: "W1" });
  assert.deepEqual([wirePivot.components[3].x, wirePivot.components[3].y], [-33.3, 91.7], "마지막 항목(R4)이 제자리");
});

test("그룹 회전: 격자 위 배치는 격자 위에 남는다", () => {
  const circuit = baseCircuit({ components: [R("R1", 160, 120), R("R2", 240, 160), R("R3", 200, 40)] });
  rotateGroup(circuit, [comp("R1"), comp("R2"), comp("R3")], 1, comp("R1"));
  for (const component of circuit.components) { assert.equal(component.x % 20, 0); assert.equal(component.y % 20, 0); }
});

// ---- 10: duplicate respects the limits

test("복제(Ctrl+D)도 편집 한도를 지킨다: 넘으면 거부하고 알림을 띄우며 회로는 그대로", () => {
  const full = baseCircuit({ components: Array.from({ length: CIRCUIT_LIMITS.components }, (_, index) => R(`R${index + 1}`, index * 10, 0)) });
  const { state, commands, statuses, notices } = harness(full);
  setSingleSelection(state, comp("R1"));
  commands.cloneSelection();
  assert.equal(state.circuit.components.length, CIRCUIT_LIMITS.components, "부품 수 그대로");
  assert.ok(statuses.some(([text, kind]) => kind === "error" && text.includes("복제 거부") && text.includes("편집 한도")));
  assert.ok(notices.some(([text, kind]) => kind === "error" && text.includes("복제 거부")));
  setSelectionItems(state, [comp("R1"), comp("R2")]);
  commands.cloneSelection();
  assert.equal(state.circuit.components.length, CIRCUIT_LIMITS.components, "여러 개 복제도 같은 검사");
  assert.equal(notices.length, 2);
  // 한도 안에서는 그대로 복제된다
  const room = harness(baseCircuit());
  setSingleSelection(room.state, comp("R1"));
  room.commands.cloneSelection();
  assert.equal(room.state.circuit.components.length, 3);
  assert.equal(room.notices.length, 0);
  assert.equal(additionLimitReason(baseCircuit(), { components: [], wires: [], junctions: [] }), null);
  assert.ok(additionLimitReason(baseCircuit(), { components: new Array(CIRCUIT_LIMITS.components), wires: [], junctions: [] }));
  assert.ok(additionLimitReason(baseCircuit({ junctions: new Array(CIRCUIT_LIMITS.junctions).fill({}) }), { junctions: [{}] }), "접속점 한도");
});

// ---- 11: one token per shortcut

/** A gate with a manual timer queue, so a test chooses whether the native event or the fallback timer comes first. */
function manualGate() {
  const queue = [];
  let clock = 0;
  const gate = createClipboardShortcutGate({ now: () => clock, setTimer: (callback) => { const timer = { callback, live: true }; queue.push(timer); return timer; }, clearTimer: (timer) => { timer.live = false; } });
  return { gate, advance: (ms) => { clock += ms; }, fire: () => { for (const timer of queue.splice(0)) if (timer.live) { timer.live = false; timer.callback(); } }, pending: () => queue.filter((timer) => timer.live).length };
}

function pasteRig() {
  const rig = harness(baseCircuit());
  const text = serializeClipboard(buildClipboard(rig.state.circuit, [comp("R1")], rig.state.projectId));
  setSingleSelection(rig.state, comp("R1"));
  rig.commands.copySelection(); // fills the internal clipboard
  const timers = manualGate();
  const run = (action, token) => { if (action === "paste") rig.commands.pasteSelection({ token }); else rig.commands.copySelection({ cut: action === "cut", token }); };
  return { ...rig, ...timers, text, run };
}

test("붙여넣기: 0 ms 대체 경로가 먼저 실행된 뒤 native paste가 와도 두 번 붙여넣지 않는다", () => {
  const { state, commands, gate, fire, run, text } = pasteRig();
  gate.arm("paste", run);
  fire(); // fallback first: internal clipboard pasted
  assert.equal(state.circuit.components.length, 3);
  const token = gate.native("paste"); // the native event arrives late, carrying the same payload
  commands.pasteSelection({ clipboardData: nativeData(text), token });
  assert.equal(state.circuit.components.length, 3, "두 번째 경로는 아무것도 하지 않는다");
});

test("붙여넣기: native paste가 먼저 오면 대체 경로는 취소되고, 억지로 실행돼도 아무것도 하지 않는다", () => {
  const { state, commands, gate, fire, pending, run, text } = pasteRig();
  const armed = gate.arm("paste", run);
  const token = gate.native("paste");
  assert.equal(token, armed, "같은 키 입력의 토큰");
  assert.equal(pending(), 0, "타이머 취소");
  commands.pasteSelection({ clipboardData: nativeData(text), token });
  assert.equal(state.circuit.components.length, 3);
  fire();
  run("paste", token); // 취소를 놓친 경우에도
  assert.equal(state.circuit.components.length, 3, "한 번만");
});

test("붙여넣기: 대체 경로가 비동기 readText 중일 때 native가 먼저 끝나도, 읽기가 나중에 끝나도 한 번만 붙여넣는다", async () => {
  for (const order of ["native-first", "read-first"]) {
    const rig = harness(baseCircuit()); // internal clipboard empty: the key fallback asks the system clipboard
    const text = serializeClipboard(buildClipboard(rig.state.circuit, [comp("R1")], "elsewhere"));
    const timers = manualGate();
    let release;
    const hold = new Promise((resolve) => { release = resolve; });
    await withNavigator({ readText: async () => { await hold; return text; } }, async () => {
      timers.gate.arm("paste", (action, token) => rig.commands.pasteSelection({ token }));
      timers.fire(); // fallback ran: readText pending
      const token = timers.gate.native("paste");
      if (order === "native-first") {
        rig.commands.pasteSelection({ clipboardData: nativeData(text), token });
        assert.equal(rig.state.circuit.components.length, 3);
        release(); await tick();
      } else {
        release(); await tick();
        assert.equal(rig.state.circuit.components.length, 3, "읽기가 먼저 끝나면 그쪽이 붙여넣는다");
        rig.commands.pasteSelection({ clipboardData: nativeData(text), token });
      }
      assert.equal(rig.state.circuit.components.length, 3, order);
    });
  }
});

test("복사·잘라내기도 같은 토큰: 두 경로가 모두 와도 한 번만 실행된다", () => {
  const { state, commands, gate, fire, run } = pasteRig();
  setSingleSelection(state, comp("R2"));
  gate.arm("cut", run);
  fire();
  assert.deepEqual(state.circuit.components.map((component) => component.id), ["R1"], "잘라내기 실행");
  setSingleSelection(state, comp("R1"));
  const token = gate.native("cut");
  let written = 0;
  commands.copySelection({ cut: true, clipboardData: { setData: () => { written += 1; } }, token });
  assert.equal(written, 0, "이미 처리된 키 입력의 늦은 native cut은 아무것도 쓰지 않고");
  assert.deepEqual(state.circuit.components.map((component) => component.id), ["R1"], "R1을 또 지우지도 않는다");
});

test("native 이벤트가 키 입력과 무관하면(메뉴 붙여넣기, 시간 초과, 다른 동작) 새 토큰을 받는다", () => {
  const { gate, advance, run } = pasteRig();
  const standalone = gate.native("paste");
  assert.equal(standalone.done, false);
  const armed = gate.arm("paste", run);
  assert.notEqual(gate.native("copy"), armed, "다른 동작의 native는 이 키 입력의 것이 아니다");
  gate.arm("paste", run);
  advance(5000);
  const late = gate.native("paste");
  assert.equal(late.done, false);
  assert.equal(late.claim(), true);
  assert.equal(late.claim(), false, "토큰은 한 번만 가져갈 수 있다");
  // 키 입력 하나에는 native 이벤트 하나만 속한다: 이어지는 두 번째 native는 자기 토큰을 받는다
  const press = gate.arm("paste", run);
  assert.equal(gate.native("paste"), press);
  assert.notEqual(gate.native("paste"), press, "두 번째 native paste는 같은 키 입력의 것이 아니다");
});
