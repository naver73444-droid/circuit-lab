import test from "node:test";
import assert from "node:assert/strict";
import { CLIPBOARD_FORMAT, COORDINATE_LIMIT, MAX_CLIPBOARD_ITEMS, buildClipboard, clipboardLimitReason, controlsNeedingTarget, parseClipboardText, pasteClipboard, pasteRejection } from "../../src/clipboard-model.js";
import { cloneComponentSet, endpointExists, referenceForCopy } from "../../src/circuit-edit.js";
import { serializeCircuit } from "../../src/circuit-engine.js";
import { cloneExample } from "../../src/examples.js";

// 리뷰 보완: 시스템 클립보드 검증 강화, 제어원 외부 참조, 조각 단위 검증, 참조 라벨.

const comp = (id) => ({ kind: "component", id });
const part = (extra = {}) => ({ id: "R1", type: "R", x: 100, y: 100, rotation: 0, props: { ref: "R1", value: "1k" }, ...extra });
const wrap = (extra = {}) => JSON.stringify({ format: CLIPBOARD_FORMAT, version: 1, components: [part()], junctions: [], wires: [], ...extra });

/** V1 - R1 - R2 - GND divider plus a CCCS F1 controlled by sensor S1. */
function sample() {
  const { circuit } = cloneExample("divider");
  circuit.version = 3;
  circuit.components.push(
    { id: "S1", type: "CURRENT_SENSOR", x: 520, y: 160, rotation: 0, props: { ref: "S1" } },
    { id: "F1", type: "CCCS", x: 520, y: 300, rotation: 0, props: { ref: "F1", beta: "2" }, control: { kind: "branchCurrent", elementId: "S1", direction: 1 } },
  );
  circuit.junctions = [];
  return circuit;
}

test("시스템 클립보드 검증: 좌표는 유한하고 ±1e6 이내", () => {
  assert.ok(parseClipboardText(wrap()));
  for (const x of [COORDINATE_LIMIT + 1, -COORDINATE_LIMIT - 1, 1e300, null, "1"]) assert.equal(parseClipboardText(wrap({ components: [part({ x })] })), null, String(x));
  assert.equal(parseClipboardText(wrap().replace('"x":100', '"x":1e999')), null, "JSON.parse가 Infinity로 읽는 값");
  assert.ok(parseClipboardText(wrap({ components: [part({ x: COORDINATE_LIMIT, y: -COORDINATE_LIMIT })] })), "경계값은 허용");
  assert.equal(parseClipboardText(wrap({ junctions: [{ id: "J1", x: 2e6, y: 0 }] })), null, "접속점 좌표도");
  const wire = { id: "W1", a: { componentId: "R1", pin: 0 }, b: { componentId: "R2", pin: 0 }, waypoints: [{ x: 5e6, y: 0 }] };
  assert.equal(parseClipboardText(wrap({ components: [part(), part({ id: "R2" })], wires: [wire] })), null, "꺾임점 좌표도");
});

test("시스템 클립보드 검증: 회전은 0/90/180/270으로 정규화하고 그 밖은 거부", () => {
  for (const [raw, expected] of [[0, 0], [90, 90], [180, 180], [270, 270], [-90, 270], [450, 90], [360, 0]]) assert.equal(parseClipboardText(wrap({ components: [part({ rotation: raw })] })).components[0].rotation, expected, `rotation ${raw}`);
  for (const bad of [45, 1, 90.5, "90", null]) assert.equal(parseClipboardText(wrap({ components: [part({ rotation: bad })] })), null, `rotation ${bad}`);
});

test("시스템 클립보드 검증: props는 문자열·숫자·불리언만, 알 수 없는 필드는 버린다", () => {
  const clean = parseClipboardText(wrap({ components: [part({ evil: "x", props: { ref: "R1", value: "1k", flag: true, n: 3 } })], extra: 1 }));
  assert.deepEqual(clean.components[0], { id: "R1", type: "R", x: 100, y: 100, rotation: 0, props: { ref: "R1", value: "1k", flag: true, n: 3 } }, "알 수 없는 필드 제거");
  assert.equal(Object.hasOwn(clean, "extra"), false);
  for (const props of [{ value: { nested: 1 } }, { value: null }, { value: [1] }]) assert.equal(parseClipboardText(wrap({ components: [part({ props })] })), null, JSON.stringify(props));
  assert.equal(parseClipboardText(wrap({ components: [part({ props: { value: "x".repeat(600) } })] })), null, "너무 긴 문자열");
  assert.equal(parseClipboardText(wrap({ components: [part({ id: "__proto__" })] })), null, "예약 id");
  assert.equal(parseClipboardText(wrap({ components: [part({ type: "constructor" })] })), null, "프로토타입 이름은 부품 종류가 아니다");
});

test("시스템 클립보드 검증: 자기 자신으로 가는 배선과 중복 배선은 제거, 없는 핀은 거부", () => {
  const two = [part(), part({ id: "R2", x: 200 })];
  const w = (id, a, b) => ({ id, a, b });
  const cleaned = parseClipboardText(wrap({ components: two, wires: [
    w("W1", { componentId: "R1", pin: 0 }, { componentId: "R2", pin: 0 }),
    w("W2", { componentId: "R2", pin: 0 }, { componentId: "R1", pin: 0 }),
    w("W3", { componentId: "R1", pin: 1 }, { componentId: "R1", pin: 1 }),
    w("W4", { componentId: "R1", pin: 1 }, { componentId: "R2", pin: 1 }),
  ] }));
  assert.deepEqual(cleaned.wires.map((wire) => wire.id), ["W1", "W4"], "역방향 중복 W2와 자기 루프 W3 제거");
  assert.equal(parseClipboardText(wrap({ components: two, wires: [w("W1", { componentId: "R1", pin: 99 }, { componentId: "R2", pin: 0 })] })), null, "pin 99");
  assert.equal(parseClipboardText(wrap({ components: two, wires: [w("W1", { componentId: "R1", pin: 2 }, { componentId: "R2", pin: 0 })] })), null, "저항은 핀 2개뿐");
  assert.equal(parseClipboardText(wrap({ components: two, wires: [w("W1", { componentId: "R1", pin: 0, junctionId: "J1" }, { componentId: "R2", pin: 0 })] })), null, "핀과 접속점을 함께 가리키는 끝");
});

test("제어 참조 모양 검사와 source 보존", () => {
  const f = { id: "F1", type: "CCCS", x: 0, y: 0, props: { ref: "F1" } };
  const ok = parseClipboardText(wrap({ source: "p-1", components: [{ ...f, control: { kind: "branchCurrent", elementId: "S1", direction: -1, junk: 1 } }] }));
  assert.deepEqual(ok.components[0].control, { kind: "branchCurrent", elementId: "S1", direction: -1 });
  assert.equal(ok.source, "p-1");
  assert.equal(parseClipboardText(wrap({ components: [{ ...f, control: { kind: "branchCurrent", elementId: "S1", direction: 2 } }] })).components[0].control, undefined, "잘못된 제어 참조는 버린다(붙일 때 다시 고르게 됨)");
  assert.equal(parseClipboardText(wrap({ components: [part({ control: { kind: "branchCurrent", elementId: "S1", direction: 1 } })] })).components[0].control, undefined, "제어원이 아닌 부품의 control은 버린다");
  assert.equal(parseClipboardText(wrap({ source: 5 })).source, undefined);
});

test("복사와 붙여넣기는 같은 개수 한도를 쓴다", () => {
  const many = Array.from({ length: MAX_CLIPBOARD_ITEMS }, (_, index) => part({ id: `R${index + 1}` }));
  assert.ok(parseClipboardText(wrap({ components: many })), "500개는 허용");
  assert.equal(parseClipboardText(wrap({ components: [...many, part({ id: "R501" })] })), null, "501개는 붙여넣기 거부");
  const circuit = { components: [...many, part({ id: "R501" })], wires: [], junctions: [] };
  const clip = buildClipboard(circuit, circuit.components.map((c) => comp(c.id)));
  assert.match(clipboardLimitReason(clip), /500개까지/, "501개는 복사 거부 사유");
  assert.equal(clipboardLimitReason(buildClipboard(sample(), [comp("R1")])), null);
});

test("제어원 외부 참조: 다른 프로젝트로 붙이면 지우고, 같은 프로젝트라도 대상이 없으면 지운다", () => {
  const circuit = sample();
  const clip = buildClipboard(circuit, [comp("F1")], "proj-A");
  assert.equal(clip.source, "proj-A");
  const same = pasteClipboard(circuit, clip, 1, { sameProject: true });
  assert.equal(same.components[0].control.elementId, "S1", "같은 프로젝트·대상 존재: 유지");
  assert.equal(controlsNeedingTarget(same), 0);
  const other = pasteClipboard(circuit, clip, 1, { sameProject: false });
  assert.equal(other.components[0].control, undefined, "다른 프로젝트: 이름이 같은 S1에 묶이지 않고 지운다");
  assert.deepEqual(other.clearedControls, [other.components[0].id]);
  assert.equal(controlsNeedingTarget(other), 1);
  const without = { ...circuit, components: circuit.components.filter((item) => item.id !== "S1") };
  assert.equal(pasteClipboard(without, clip, 1, { sameProject: true }).components[0].control, undefined, "대상이 사라졌으면 지운다");
  const wrongType = { ...circuit, components: circuit.components.map((item) => item.id === "S1" ? { ...item, type: "R" } : item) };
  assert.equal(pasteClipboard(wrongType, clip, 1).components[0].control, undefined, "같은 id지만 센서·전압원이 아니면 지운다");
  const both = pasteClipboard(circuit, buildClipboard(circuit, [comp("S1"), comp("F1")], "proj-A"), 1, { sameProject: false });
  assert.equal(both.components.find((c) => c.type === "CCCS").control.elementId, both.components.find((c) => c.type === "CURRENT_SENSOR").id, "조각 안 참조는 프로젝트가 달라도 새 id로 이어진다");
  assert.equal(controlsNeedingTarget(both), 0);
  assert.equal(circuit.components.find((c) => c.id === "F1").control.elementId, "S1", "원본 불변");
});

test("붙여넣기 검증은 붙이는 조각만 본다: 회로의 다른 오류는 막지 않고, 없는 핀·한도 초과는 막는다", () => {
  const circuit = sample();
  const broken = { ...circuit, components: [...circuit.components, { id: "F9", type: "CCCS", x: 0, y: 0, props: { ref: "F9", beta: "1" } }] };
  assert.throws(() => serializeCircuit(broken), "기존 회로는 제어 대상 없는 F9 때문에 이미 오류");
  const clip = buildClipboard(circuit, [comp("R1"), comp("R2")]);
  assert.equal(pasteRejection(broken, pasteClipboard(broken, clip, 1)), null, "무관한 기존 오류는 붙여넣기를 막지 않는다");
  const cleared = pasteClipboard(circuit, buildClipboard(circuit, [comp("F1")], "x"), 1, { sameProject: false });
  assert.equal(pasteRejection(circuit, cleared), null, "지워진 제어 대상은 인스펙터에서 고치게 두고 붙여넣기는 허용");
  const pasted = pasteClipboard(circuit, clip, 1);
  pasted.wires.push({ id: "WX", a: { componentId: pasted.components[0].id, pin: 99 }, b: { componentId: pasted.components[1].id, pin: 0 }, waypoints: [] });
  assert.match(pasteRejection(circuit, pasted), /핀/, "존재하지 않는 핀");
  const full = { ...circuit, components: Array.from({ length: 256 }, (_, i) => ({ id: `Q${i}`, type: "R", x: 0, y: 0, props: {} })) };
  assert.match(pasteRejection(full, pasteClipboard(full, clip, 1)), /한도/);
});

test("복제·붙여넣기 참조 라벨: 원본(R1)과 겹치면 다음 빈 라벨, 비어 있으면 그대로", () => {
  const circuit = sample();
  const pasted = pasteClipboard(circuit, buildClipboard(circuit, [comp("R1"), comp("R2")]), 1);
  assert.deepEqual(pasted.components.map((c) => [c.id, c.props.ref]), [["R3", "R3"], ["R4", "R4"]]);
  const afterCut = { ...circuit, components: circuit.components.filter((c) => c.id !== "R1") };
  assert.equal(pasteClipboard(afterCut, buildClipboard(circuit, [comp("R1")]), 1).components[0].props.ref, "R1", "잘라낸 뒤 붙이면 R1이 비어 있으니 그대로");
  const custom = { ...circuit, components: circuit.components.map((c) => c.id === "R1" ? { ...c, props: { ...c.props, ref: "Rload" } } : c) };
  assert.equal(pasteClipboard(custom, buildClipboard(custom, [comp("R1")]), 1).components[0].props.ref, "R3", "자기 자신과 겹치는 사용자 라벨도 새 라벨");
  const twice = { ...custom, components: [...custom.components, { id: "R3", type: "R", x: 0, y: 0, props: { ref: "Rload", value: "1k" } }] };
  assert.equal(pasteClipboard(twice, buildClipboard(twice, [comp("R1")]), 1).components[0].props.ref, "R4", "겹치는 사용자 라벨은 새 라벨");
  assert.equal(pasteClipboard(circuit, buildClipboard(circuit, [comp("G1")]), 1).components[0].props.ref, "GND", "접지는 번호 없는 라벨 유지");
  const used = new Set(["R1", "R3"]);
  assert.equal(referenceForCopy("R", "R1", "R3", used), "R4", "후보 R3도 쓰였으면 건너뛴다");
  assert.equal(referenceForCopy("C", "C1", "C1", new Set()), "C1");
  assert.equal(referenceForCopy("R", undefined, "R5", new Set()), undefined);
  assert.equal(cloneComponentSet(circuit, ["R1"]).components[0].props.ref, "R3", "Ctrl+D 복제도 같은 규칙");
});

test("endpointExists: 접속점과 범위 안의 핀만 존재로 본다", () => {
  const circuit = { ...sample(), junctions: [{ id: "J1", x: 0, y: 0 }] };
  assert.equal(endpointExists(circuit, { componentId: "R1", pin: 1 }), true);
  assert.equal(endpointExists(circuit, { componentId: "R1", pin: 2 }), false);
  assert.equal(endpointExists(circuit, { componentId: "R9", pin: 0 }), false);
  assert.equal(endpointExists(circuit, { junctionId: "J1" }), true);
  assert.equal(endpointExists(circuit, { junctionId: "J9" }), false);
  assert.equal(endpointExists(circuit, null), false);
});
