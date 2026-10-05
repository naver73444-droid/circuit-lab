import test from "node:test";
import assert from "node:assert/strict";
import { buildClipboard, parseClipboardText, pasteClipboard, serializeClipboard, PASTE_STEP } from "../../src/clipboard-model.js";
import { cloneComponentSet, deleteSelectionFromCircuit, extractFragment, remapFragment } from "../../src/circuit-edit.js";
import { serializeCircuit } from "../../src/circuit-engine.js";
import { cloneExample } from "../../src/examples.js";

const comp = (id) => ({ kind: "component", id });
const unique = (list) => new Set(list).size === list.length;

/** V1 - R1 - J1 - R2 - GND divider plus a CCCS F1 controlled by sensor S1, with one junction J1 on the R1-R2 wire. */
function sample() {
  const { circuit } = cloneExample("divider");
  circuit.version = 3;
  circuit.components.push(
    { id: "S1", type: "CURRENT_SENSOR", x: 520, y: 160, rotation: 0, props: { ref: "S1" } },
    { id: "F1", type: "CCCS", x: 520, y: 300, rotation: 0, props: { ref: "F1", beta: "2" }, control: { kind: "branchCurrent", elementId: "S1", direction: 1 } },
  );
  circuit.junctions = [{ id: "J1", x: 360, y: 230 }];
  circuit.wires = [
    { id: "W1", a: { componentId: "V1", pin: 0 }, b: { componentId: "R1", pin: 0 } },
    { id: "W2", a: { componentId: "R1", pin: 1 }, b: { junctionId: "J1" }, waypoints: [] },
    { id: "W5", a: { junctionId: "J1" }, b: { componentId: "R2", pin: 0 } },
    { id: "W3", a: { componentId: "R2", pin: 1 }, b: { componentId: "G1", pin: 0 } },
    { id: "W6", a: { componentId: "S1", pin: 1 }, b: { componentId: "F1", pin: 0 }, waypoints: [{ x: 560, y: 160 }, { x: 560, y: 300 }] },
  ];
  return circuit;
}

test("붙여넣기: id가 모두 새로 만들어지고 서로 겹치지 않으며 원본 회로는 바뀌지 않는다", () => {
  const circuit = sample();
  const before = structuredClone(circuit);
  const clip = buildClipboard(circuit, [comp("R1"), comp("R2")]);
  const pasted = pasteClipboard(circuit, clip, 1);
  assert.deepEqual(circuit, before);
  const allIds = [...circuit.components, ...pasted.components].map((item) => item.id);
  assert.ok(unique(allIds), allIds.join());
  assert.deepEqual(pasted.components.map((item) => item.id), ["R3", "R4"]);
  assert.ok(unique([...circuit.wires, ...pasted.wires].map((wire) => wire.id)));
});

test("내부 배선은 유지하고 밖으로 나가는 배선은 버린다 (접속점이 복사에 없으면 그 배선도 버린다)", () => {
  const circuit = sample();
  assert.deepEqual(buildClipboard(circuit, [comp("R1"), comp("R2")]).wires, []);
  const withJunction = buildClipboard(circuit, [comp("R1"), comp("R2"), { kind: "junction", id: "J1" }]);
  assert.deepEqual(withJunction.wires.map((wire) => wire.id).sort(), ["W2", "W5"]);
  const pasted = pasteClipboard(circuit, withJunction, 1);
  assert.equal(pasted.junctions.length, 1);
  assert.notEqual(pasted.junctions[0].id, "J1");
  const [r3, r4] = pasted.components;
  const ends = pasted.wires.flatMap((wire) => [wire.a, wire.b]);
  assert.ok(ends.every((end) => end.junctionId === pasted.junctions[0].id || [r3.id, r4.id].includes(end.componentId)), "붙여넣은 배선은 새 id만 가리킨다");
  assert.ok(!ends.some((end) => end.componentId === "R1" || end.componentId === "R2" || end.junctionId === "J1"), "원본 id를 가리키지 않는다");
  assert.deepEqual(buildClipboard(circuit, [comp("R1")]).wires, [], "V1-R1 같은 외부 배선은 복사되지 않는다");
});

test("제어원 참조: 사본 안의 대상은 새 id로, 사본 밖의 대상은 원래 id를 유지한다", () => {
  const circuit = sample();
  const both = pasteClipboard(circuit, buildClipboard(circuit, [comp("S1"), comp("F1")]), 1);
  const s2 = both.components.find((item) => item.type === "CURRENT_SENSOR");
  const f2 = both.components.find((item) => item.type === "CCCS");
  assert.equal(f2.control.elementId, s2.id, "함께 복사한 센서를 가리킨다");
  assert.notEqual(s2.id, "S1");
  assert.equal(f2.control.direction, 1);
  assert.equal(both.wires.length, 1, "S1-F1 배선 유지");
  const only = pasteClipboard(circuit, buildClipboard(circuit, [comp("F1")]), 1);
  assert.equal(only.components[0].control.elementId, "S1", "대상이 복사에 없으면 외부 id 유지");
  assert.equal(circuit.components.find((item) => item.id === "F1").control.elementId, "S1", "원본 불변");
});

test("붙여넣을 때마다 2칸(40) 밀려 겹치지 않고, 꺾임점도 같이 이동한다", () => {
  const circuit = sample();
  const clip = buildClipboard(circuit, [comp("S1"), comp("F1")]);
  assert.equal(PASTE_STEP, 40);
  const first = pasteClipboard(circuit, clip, 1);
  const second = pasteClipboard({ ...circuit, components: [...circuit.components, ...first.components], wires: [...circuit.wires, ...first.wires] }, clip, 2);
  assert.deepEqual(first.components.map((c) => [c.x, c.y]), [[560, 200], [560, 340]]);
  assert.deepEqual(second.components.map((c) => [c.x, c.y]), [[600, 240], [600, 380]]);
  assert.deepEqual(first.wires[0].waypoints, [{ x: 600, y: 200 }, { x: 600, y: 340 }]);
  assert.ok(unique([...circuit.components, ...first.components, ...second.components].map((c) => c.id)), "두 번 붙여넣어도 id 유일");
});

test("붙여넣은 결과가 회로 검증(serializeCircuit)을 통과한다", () => {
  const circuit = sample();
  const clip = buildClipboard(circuit, [comp("S1"), comp("F1"), comp("R1")]);
  const pasted = pasteClipboard(circuit, clip, 1);
  assert.doesNotThrow(() => serializeCircuit({ ...circuit, components: [...circuit.components, ...pasted.components], wires: [...circuit.wires, ...pasted.wires], junctions: [...circuit.junctions, ...pasted.junctions] }));
});

test("복사할 부품·접속점이 없으면 null (배선만 선택)", () => {
  assert.equal(buildClipboard(sample(), [{ kind: "wire", id: "W1" }]), null);
  assert.equal(buildClipboard(sample(), []), null);
});

test("시스템 클립보드 JSON 왕복과 잘못된 입력 거부", () => {
  const circuit = sample();
  const clip = buildClipboard(circuit, [comp("R1"), comp("R2"), { kind: "junction", id: "J1" }]);
  const parsed = parseClipboardText(serializeClipboard(clip));
  assert.deepEqual(parsed, clip);
  assert.notEqual(parsed, clip, "새 객체");
  const bads = [
    "", "not json", "{}",
    JSON.stringify({ format: "circuit-lab-clipboard", version: 9, components: [] }),
    JSON.stringify({ ...clip, components: [{ id: "X", type: "NOPE", x: 0, y: 0 }] }),
    JSON.stringify({ ...clip, components: [{ ...clip.components[0], x: "1" }] }),
    JSON.stringify({ ...clip, wires: [{ id: "W9", a: { componentId: "ZZ", pin: 0 }, b: { componentId: "R1", pin: 0 } }] }),
    JSON.stringify({ ...clip, components: [clip.components[0], clip.components[0]] }),
    "xxxxxxxxxxcircuit-lab-clipboard",
  ];
  for (const bad of bads) assert.equal(parseClipboardText(bad), null, bad.slice(0, 60));
  assert.equal(parseClipboardText(null), null);
  assert.equal(parseClipboardText(JSON.stringify({ format: "circuit-lab-clipboard", version: 1, components: [] })), null, "비어 있음");
});

test("cloneComponentSet은 기존 계약을 유지하고(부품 사이 배선만, 외부 제어 id 유지) 접속점은 옵션으로 복제한다", () => {
  const circuit = sample();
  const plain = cloneComponentSet(circuit, ["S1", "F1"]);
  assert.equal(plain.components.length, 2);
  assert.equal(plain.wires.length, 1);
  assert.equal(plain.junctions.length, 0);
  assert.deepEqual([...plain.idMap], [["S1", "S2"], ["F1", "F2"]]);
  const withJ = cloneComponentSet(circuit, ["R1", "R2"], 40, { junctionIds: ["J1"] });
  assert.equal(withJ.junctions.length, 1);
  assert.equal(withJ.wires.length, 2);
  const fragment = extractFragment(circuit, ["R1"], []);
  fragment.components[0].props.value = "9k";
  assert.equal(circuit.components.find((c) => c.id === "R1").props.value, "1k", "조각은 원본과 참조를 공유하지 않는다");
  assert.equal(remapFragment(circuit, fragment, 0).components[0].x, 360, "offset 0이면 제자리");
});

test("deleteSelectionFromCircuit: 부품·접속점·배선을 한 번에 지우고 딸린 배선·프로브도 정리한다", () => {
  const circuit = sample();
  const probes = [{ key: "I:R1", kind: "current", componentId: "R1" }, { key: "V:W3", kind: "voltage", componentId: "R2", pin: 1, wireId: "W3" }, { key: "I:V1", kind: "current", componentId: "V1" }];
  const before = structuredClone(circuit);
  const deleted = deleteSelectionFromCircuit(circuit, [comp("R1"), { kind: "junction", id: "J1" }, { kind: "wire", id: "W3" }], probes);
  assert.deepEqual(circuit, before, "입력 불변");
  assert.deepEqual(deleted.circuit.components.map((c) => c.id), ["V1", "R2", "G1", "S1", "F1"]);
  assert.deepEqual(deleted.circuit.wires.map((w) => w.id), ["W6"]);
  assert.deepEqual(deleted.circuit.junctions, []);
  assert.deepEqual(deleted.probes.map((p) => p.key), ["I:V1"]);
});
