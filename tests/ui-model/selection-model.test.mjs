import test from "node:test";
import assert from "node:assert/strict";
import {
  allItems, clearSelection, componentBounds, describeSelection, isSelected, marqueeHits, normalizeRect, segmentIntersectsRect,
  selectedItems, selectedKeys, selectionKey, setSelectionItems, setSingleSelection, toggleSelection,
} from "../../src/selection-model.js";
import { cloneExample } from "../../src/examples.js";

const fresh = () => ({ selected: null, selection: new Set() });
const comp = (id) => ({ kind: "component", id });

test("선택 키는 종류별로 구분되고 단일 선택이 primary와 집합을 함께 맞춘다", () => {
  const state = fresh();
  setSingleSelection(state, comp("R1"));
  assert.deepEqual(state.selected, comp("R1"));
  assert.deepEqual([...state.selection], ["component:R1"]);
  assert.equal(selectionKey("wire", "R1") === selectionKey("component", "R1"), false, "같은 id라도 종류가 다르면 다른 항목");
  clearSelection(state);
  assert.equal(state.selected, null);
  assert.equal(state.selection.size, 0);
});

test("selected만 직접 바꾼 외부 코드도 selectedKeys로 읽으면 일관된다", () => {
  const state = { selected: comp("R9"), selection: new Set(["component:R1", "component:R2"]) };
  assert.deepEqual([...selectedKeys(state)], ["component:R9"], "집합에 없는 primary는 단일 선택으로 취급");
  assert.equal(isSelected(state, "component", "R1"), false);
  assert.deepEqual(selectedItems({ selected: null, selection: new Set(["component:R1"]) }), [], "primary가 없으면 선택 없음");
  assert.equal(selectedKeys({ selected: comp("R1") }).size, 1, "selection 필드가 없어도 동작");
});

test("Shift+클릭 토글: 추가하면 primary가 되고, 빼면 남은 것 중 하나로 이동하며, 마지막 하나를 빼면 선택 없음", () => {
  const state = fresh();
  setSingleSelection(state, comp("R1"));
  assert.equal(toggleSelection(state, comp("R2")), true);
  assert.equal(toggleSelection(state, { kind: "wire", id: "W1" }), true);
  assert.deepEqual(state.selected, { kind: "wire", id: "W1" });
  assert.deepEqual([...selectedKeys(state)].sort(), ["component:R1", "component:R2", "wire:W1"]);
  assert.equal(toggleSelection(state, comp("R2")), false, "primary가 아닌 항목을 빼도 primary 유지");
  assert.deepEqual(state.selected, { kind: "wire", id: "W1" });
  assert.equal(toggleSelection(state, { kind: "wire", id: "W1" }), false, "primary를 빼면 다른 항목이 primary");
  assert.deepEqual(state.selected, comp("R1"));
  toggleSelection(state, comp("R1"));
  assert.equal(state.selected, null);
  assert.equal(state.selection.size, 0);
});

test("setSelectionItems: 중복은 합쳐지고 primary 지정이 집합 밖이면 마지막 항목", () => {
  const state = fresh();
  setSelectionItems(state, [comp("A"), comp("B"), comp("A")], comp("A"));
  assert.equal(state.selection.size, 2);
  assert.deepEqual(state.selected, comp("A"));
  setSelectionItems(state, [comp("A"), comp("B")], comp("Z"));
  assert.deepEqual(state.selected, comp("B"));
  setSelectionItems(state, []);
  assert.equal(state.selected, null);
});

test("allItems는 부품·배선·접속점을 모두 담고 describeSelection이 종류별로 센다", () => {
  const { circuit } = cloneExample("divider");
  circuit.junctions = [{ id: "J1", x: 360, y: 230 }];
  const items = allItems(circuit);
  assert.deepEqual(describeSelection(items), { total: 9, components: 4, wires: 4, junctions: 1 });
});

test("normalizeRect는 끌기 방향과 무관하게 정규화한다", () => {
  assert.deepEqual(normalizeRect({ x: 50, y: 10 }, { x: 20, y: 40 }), { x0: 20, y0: 10, x1: 50, y1: 40 });
});

test("componentBounds: 회전한 부품의 경계 상자는 핀과 기호를 덮고 90도에서 가로세로가 바뀐다", () => {
  const flat = componentBounds({ id: "R1", type: "R", x: 100, y: 100, rotation: 0 });
  assert.deepEqual(flat, { x0: 60, y0: 80, x1: 140, y1: 120 });
  const tall = componentBounds({ id: "R1", type: "R", x: 100, y: 100, rotation: 90 });
  assert.ok(Math.abs(tall.x0 - 80) < 1e-9 && Math.abs(tall.x1 - 120) < 1e-9 && Math.abs(tall.y0 - 60) < 1e-9 && Math.abs(tall.y1 - 140) < 1e-9);
  const gnd = componentBounds({ id: "G1", type: "GND", x: 0, y: 0, rotation: 0 });
  assert.equal(gnd.y0, -40, "접지 핀(0,-40)까지");
});

test("segmentIntersectsRect: 안쪽·교차·바깥·평행 선분", () => {
  const rect = { x0: 0, y0: 0, x1: 100, y1: 100 };
  assert.equal(segmentIntersectsRect({ x: 10, y: 10 }, { x: 20, y: 20 }, rect), true, "완전히 안");
  assert.equal(segmentIntersectsRect({ x: -50, y: 50 }, { x: 150, y: 50 }, rect), true, "가로질러 통과");
  assert.equal(segmentIntersectsRect({ x: -50, y: 150 }, { x: 150, y: 150 }, rect), false, "아래로 벗어난 평행선");
  assert.equal(segmentIntersectsRect({ x: 120, y: 0 }, { x: 120, y: 100 }, rect), false, "오른쪽 바깥 수직선");
  assert.equal(segmentIntersectsRect({ x: 100, y: 100 }, { x: 150, y: 150 }, rect), true, "모서리 접촉");
});

test("marqueeHits: 부품은 경계가 겹치면, 배선은 기본적으로 경로 전체가 상자 안일 때만 잡힌다", () => {
  const { circuit } = cloneExample("divider"); // V1(160,240) R1(360,160) R2(360,300) G1(260,400)
  const around = marqueeHits(circuit, { x0: 330, y0: 100, x1: 390, y1: 210 });
  assert.deepEqual(around.filter((hit) => hit.kind === "component").map((hit) => hit.id), ["R1"]);
  assert.deepEqual(around.filter((hit) => hit.kind === "wire"), []);
  const crossing = marqueeHits(circuit, { x0: 330, y0: 100, x1: 390, y1: 210 }, { wires: "crossing" });
  assert.deepEqual(crossing.filter((hit) => hit.kind === "wire").map((hit) => hit.id).sort(), ["W1", "W2"]);
  const all = marqueeHits(circuit, { x0: 0, y0: 0, x1: 600, y1: 600 });
  assert.deepEqual(describeSelection(all), { total: 8, components: 4, wires: 4, junctions: 0 });
  assert.deepEqual(marqueeHits(circuit, { x0: 700, y0: 0, x1: 800, y1: 50 }), []);
});

test("marqueeHits: 접속점은 점이 상자 안일 때, 배선 경로는 꺾임점(waypoint)까지 검사한다", () => {
  const circuit = {
    version: 1, geometryVersion: 2,
    components: [{ id: "R1", type: "R", x: 100, y: 100, rotation: 0, props: {} }, { id: "R2", type: "R", x: 300, y: 100, rotation: 0, props: {} }],
    junctions: [{ id: "J1", x: 200, y: 60 }],
    wires: [{ id: "W1", a: { componentId: "R1", pin: 1 }, b: { componentId: "R2", pin: 0 }, waypoints: [{ x: 180, y: 100 }, { x: 180, y: 20 }, { x: 260, y: 20 }, { x: 260, y: 100 }] }],
  };
  const narrow = marqueeHits(circuit, { x0: 150, y0: 40, x1: 220, y1: 80 }, { wires: "crossing" });
  assert.deepEqual(narrow.map((hit) => hit.kind + ":" + hit.id).sort(), ["junction:J1", "wire:W1"]);
  const contained = marqueeHits(circuit, { x0: 90, y0: 0, x1: 350, y1: 140 });
  assert.ok(contained.some((hit) => hit.kind === "wire" && hit.id === "W1"), "경로 전체가 안에 있으면 배선 선택");
  assert.equal(marqueeHits(circuit, { x0: 150, y0: 40, x1: 220, y1: 80 }).some((hit) => hit.kind === "wire"), false);
});
