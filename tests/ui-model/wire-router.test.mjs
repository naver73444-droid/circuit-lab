import { test } from "node:test";
import assert from "node:assert/strict";
import { simulate } from "../../src/circuit-engine.js";
import { cloneExample, examples } from "../../src/examples.js";
import { pinPosition, routeWirePoints } from "../../src/circuit-geometry.js";
import { cloneComponentSet, splitWireAtJunction } from "../../src/circuit-edit.js";
import { applyGroupOffset, captureGroupOrigins, moveGroup } from "../../src/group-edit.js";
import {
  bodyBox, createRoutingContext, newWireShape, pinOutwardDirection, previewRoute, rerouteWires, routeWireGeometry, simplifyRoute, wiresFollowingMove,
  captureWireShapes, restoreWireShapes,
} from "../../src/wire-router.js";

const part = (id, type, x, y, rotation = 0) => ({ id, type, x, y, rotation, props: {} });
const pin = (componentId, index) => ({ componentId, pin: index });
const circuitOf = (components, wires = [], junctions = []) => ({ geometryVersion: 2, components, wires, junctions });
const onGrid = (value) => Math.abs(value / 20 - Math.round(value / 20)) < 1e-9;

/** The drawn polyline of a wire, exactly as the canvas draws it. */
function drawn(circuit, wire) {
  const position = (end) => end.junctionId !== undefined
    ? circuit.junctions.find((junction) => junction.id === end.junctionId)
    : pinPosition(circuit.components.find((item) => item.id === end.componentId), end.pin, 2);
  return routeWirePoints(wire, position(wire.a), position(wire.b), 2);
}
function assertOrthogonal(points, what) {
  for (let index = 0; index + 1 < points.length; index += 1) {
    const [p, q] = [points[index], points[index + 1]];
    assert.ok(Math.abs(p.x - q.x) < 1e-9 || Math.abs(p.y - q.y) < 1e-9, `${what}: segment ${index} is diagonal (${p.x},${p.y})→(${q.x},${q.y})`);
  }
  for (const point of points) assert.ok(onGrid(point.x) && onGrid(point.y), `${what}: (${point.x},${point.y}) is off the grid`);
}
const bends = (points) => Math.max(0, points.length - 2);
/** Grid cells a polyline passes through (both ends included). */
function cellsOf(points) {
  const cells = [];
  for (let index = 0; index + 1 < points.length; index += 1) {
    const [p, q] = [points[index], points[index + 1]];
    const steps = Math.round((Math.abs(q.x - p.x) + Math.abs(q.y - p.y)) / 20);
    for (let step = index ? 1 : 0; step <= steps; step += 1) cells.push({ x: p.x + Math.sign(q.x - p.x) * 20 * step, y: p.y + Math.sign(q.y - p.y) * 20 * step });
  }
  return cells;
}
function unitEdges(points) {
  const edges = new Set(), cells = cellsOf(points);
  for (let index = 0; index + 1 < cells.length; index += 1) {
    const [p, q] = [cells[index], cells[index + 1]];
    edges.add([`${p.x},${p.y}`, `${q.x},${q.y}`].sort().join("|"));
  }
  return edges;
}
const firstDirection = (points) => ({ x: Math.sign(points[1].x - points[0].x), y: Math.sign(points[1].y - points[0].y) });
const lastDirection = (points) => ({ x: Math.sign(points.at(-1).x - points.at(-2).x), y: Math.sign(points.at(-1).y - points.at(-2).y) });
const DIRS = [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }];

test("핀 바깥 방향: 부품 회전을 따라 핀이 향하는 축(오른쪽 0, 아래 1, 왼쪽 2, 위 3)", () => {
  assert.equal(pinOutwardDirection(part("R1", "R", 0, 0), 0), 2);
  assert.equal(pinOutwardDirection(part("R1", "R", 0, 0), 1), 0);
  assert.equal(pinOutwardDirection(part("R1", "R", 0, 0, 90), 0), 3, "90° 돌린 저항의 0번 핀은 위");
  assert.equal(pinOutwardDirection(part("G1", "GND", 0, 0), 0), 3, "접지 핀은 위");
  assert.equal(pinOutwardDirection(part("U1", "OPAMP", 0, 0), 2), 0, "OP AMP 출력은 오른쪽");
  assert.equal(pinOutwardDirection(part("E1", "VCVS", 0, 0), 3), 1, "VCVS 제어 - 핀은 아래");
});

test("중간점 없이 두 핀: 격자 위 직교 경로, 핀에서 바깥으로 먼저 나가고 끝 핀에는 바깥쪽에서 들어간다", () => {
  const circuit = circuitOf([part("R1", "R", 100, 100), part("R2", "R", 300, 200, 90), part("G1", "GND", 100, 300)]);
  const context = createRoutingContext(circuit);
  for (const [a, b] of [[pin("R1", 1), pin("R2", 0)], [pin("R1", 0), pin("G1", 0)], [pin("R2", 1), pin("G1", 0)]]) {
    const geometry = routeWireGeometry(context, a, b);
    const route = geometry.route;
    assertOrthogonal(route, `${a.componentId}→${b.componentId}`);
    const from = circuit.components.find((item) => item.id === a.componentId), to = circuit.components.find((item) => item.id === b.componentId);
    assert.deepEqual(firstDirection(route), DIRS[pinOutwardDirection(from, a.pin)], "첫 구간은 시작 핀의 바깥 방향");
    const inward = DIRS[pinOutwardDirection(to, b.pin)];
    assert.deepEqual(lastDirection(route), { x: -inward.x || 0, y: -inward.y || 0 }, "마지막 구간은 끝 핀 바깥쪽에서 들어온다");
    assert.deepEqual(geometry.anchors, [], "자동 경로는 사용자 경유점이 없다");
    assert.deepEqual(drawn(circuit, { a, b, waypoints: geometry.waypoints }), route, "저장한 waypoints를 기존 렌더러가 그대로 그린다");
  }
});

test("꺾임 수 최소: 마주 보는 핀이 한 줄이면 0, 어긋나면 Z(2)이고 가로 구간은 가운데에서 꺾인다; 핀→접속점은 L(1)", () => {
  const circuit = circuitOf([part("R1", "R", 0, 0), part("R2", "R", 300, 0), part("R3", "R", 300, 100)], [], [{ id: "J1", x: 200, y: 200 }]);
  const context = createRoutingContext(circuit);
  const straight = routeWireGeometry(context, pin("R1", 1), pin("R2", 0)).route;
  assert.equal(bends(straight), 0);
  assert.deepEqual(straight, [{ x: 40, y: 0 }, { x: 260, y: 0 }]);
  const z = routeWireGeometry(context, pin("R1", 1), pin("R3", 0)).route;
  assert.equal(bends(z), 2);
  assert.deepEqual(z, [{ x: 40, y: 0 }, { x: 160, y: 0 }, { x: 160, y: 100 }, { x: 260, y: 100 }], "Z의 세로 구간은 두 핀 사이 가운데");
  const l = routeWireGeometry(context, pin("R1", 1), { junctionId: "J1" }).route;
  assert.equal(bends(l), 1);
});

test("다른 부품 몸체를 가로지르지 않는다 (사이에 놓인 저항을 돌아간다)", () => {
  const blocker = part("R9", "R", 160, 0, 90);
  const circuit = circuitOf([part("R1", "R", 0, 0), part("R2", "R", 320, 0), blocker]);
  const route = routeWireGeometry(createRoutingContext(circuit), pin("R1", 1), pin("R2", 0)).route;
  assertOrthogonal(route, "우회 경로");
  const box = bodyBox(blocker);
  for (const cell of cellsOf(route)) assert.ok(!(cell.x >= box.x0 && cell.x <= box.x1 && cell.y >= box.y0 && cell.y <= box.y1), `(${cell.x},${cell.y})는 R9 몸체 안`);
  // R9의 핀도 지나지 않는다 (지나면 연결된 것처럼 보인다)
  for (const index of [0, 1]) {
    const p = pinPosition(blocker, index);
    assert.ok(!cellsOf(route).some((cell) => cell.x === p.x && cell.y === p.y), "다른 부품의 핀을 지나지 않는다");
  }
});

test("핀이 상대 반대쪽을 향해도 바깥으로 한 칸 이상 나간 뒤 돌아간다", () => {
  // R1의 0번 핀(왼쪽)에서 오른쪽에 있는 R2로
  const circuit = circuitOf([part("R1", "R", 0, 0), part("R2", "R", 300, 100)]);
  const route = routeWireGeometry(createRoutingContext(circuit), pin("R1", 0), pin("R2", 0)).route;
  assertOrthogonal(route, "돌아가는 경로");
  assert.equal(route[1].x < route[0].x && route[1].y === route[0].y, true, "먼저 왼쪽(바깥)으로 나간다");
  const box = bodyBox(circuit.components[0]);
  for (const cell of cellsOf(route).slice(1)) assert.ok(!(cell.x > box.x0 && cell.x < box.x1 && cell.y >= box.y0 && cell.y <= box.y1), "자기 몸체도 가로지르지 않는다");
});

test("기존 배선과 같은 선분 위로 겹쳐 달리지 않는다 (교차는 허용)", () => {
  // W1: R1 → R2 가로 직선. 새 배선 R3 → R4가 같은 줄을 따라가면 다른 노드와 겹친다.
  const circuit = circuitOf([part("R1", "R", 0, 0), part("R2", "R", 400, 0), part("R3", "R", 0, 100, 90), part("R4", "R", 400, 100, 90)]);
  const first = newWireShape(circuit, pin("R1", 1), pin("R2", 0));
  circuit.wires.push({ id: "W1", a: pin("R1", 1), b: pin("R2", 0), ...first });
  const context = createRoutingContext(circuit);
  const second = routeWireGeometry(context, pin("R3", 0), pin("R4", 0)).route; // 두 핀 모두 위(y=0 줄)를 향함
  assertOrthogonal(second, "두 번째 배선");
  const shared = [...unitEdges(second)].filter((edge) => unitEdges(drawn(circuit, circuit.wires[0])).has(edge));
  assert.deepEqual(shared, [], "공유하는 단위 선분이 없다");
  // 십자로 가로지르는 배선은 그대로 허용된다
  const crossing = circuitOf([part("R1", "R", 0, 0), part("R2", "R", 400, 0), part("R3", "R", 200, -200, 90), part("R4", "R", 200, 200, 90)]);
  crossing.wires.push({ id: "W1", a: pin("R1", 1), b: pin("R2", 0), ...newWireShape(crossing, pin("R1", 1), pin("R2", 0)) });
  const vertical = routeWireGeometry(createRoutingContext(crossing), pin("R3", 1), pin("R4", 0)).route;
  assert.equal(bends(vertical), 0, "곧게 가로지른다");
});

test("중간점을 찍으면 그 점을 지나고, 찍은 점 사이는 직교(L자)로 정리된다", () => {
  const circuit = circuitOf([part("R1", "R", 0, 0), part("R2", "R", 400, 200)]);
  const anchors = [{ x: 140, y: -100 }, { x: 300, y: 60 }];
  const shape = newWireShape(circuit, pin("R1", 1), pin("R2", 0), anchors);
  assert.deepEqual(shape.anchors, anchors);
  const route = drawn(circuit, { a: pin("R1", 1), b: pin("R2", 0), waypoints: shape.waypoints });
  assertOrthogonal(route, "경유점 경로");
  const cells = cellsOf(route);
  for (const anchor of anchors) assert.ok(cells.some((cell) => cell.x === anchor.x && cell.y === anchor.y), `경유점 (${anchor.x},${anchor.y})를 지난다`);
});

test("그리는 중 미리보기: 핀 위 포인터는 그 핀의 방향으로 들어가고, 고정 부분은 마지막 경유점까지", () => {
  const circuit = circuitOf([part("R1", "R", 0, 0), part("R2", "R", 300, 100)]);
  const free = previewRoute(circuit, pin("R1", 1), [], { x: 200, y: 200 });
  assertOrthogonal(free.live, "빈 점까지");
  assert.deepEqual(free.fixed, []);
  const onPin = previewRoute(circuit, pin("R1", 1), [], pinPosition(circuit.components[1], 0));
  assert.deepEqual(onPin.route, routeWireGeometry(createRoutingContext(circuit), pin("R1", 1), pin("R2", 0)).route, "완성될 배선과 같은 경로");
  const through = previewRoute(circuit, pin("R1", 1), [{ x: 100, y: -60 }], { x: 200, y: 200 });
  assert.deepEqual(through.fixed.at(-1), { x: 100, y: -60 });
  assert.deepEqual(through.live[0], { x: 100, y: -60 });
});

test("부품 50개 회로에서도 미리보기 한 번(맥락 만들기 + 경로)이 빠르다", () => {
  const components = [];
  for (let row = 0; row < 5; row += 1) for (let column = 0; column < 10; column += 1) components.push(part(`R${row * 10 + column + 1}`, "R", column * 160, row * 120, (row + column) % 2 ? 90 : 0));
  const circuit = circuitOf(components);
  for (let index = 0; index + 1 < components.length; index += 2) circuit.wires.push({ id: `W${index}`, a: pin(components[index].id, 1), b: pin(components[index + 1].id, 0), ...newWireShape(circuit, pin(components[index].id, 1), pin(components[index + 1].id, 0)) });
  const started = performance.now();
  let count = 0;
  for (let step = 0; step < 20; step += 1) {
    const result = previewRoute(circuit, pin("R1", 0), [], { x: 1500 - step * 20, y: 560 });
    if (result) count += 1;
  }
  const perFrame = (performance.now() - started) / 20;
  assert.equal(count, 20);
  assert.ok(perFrame < 40, `미리보기 한 프레임 ${perFrame.toFixed(1)} ms`);
});

test("부품을 옮기면 붙은 배선이 직교를 유지하며 다시 놓이고, 사용자가 찍은 경유점은 남는다", () => {
  const circuit = circuitOf([part("R1", "R", 0, 0), part("R2", "R", 400, 200)]);
  const anchor = { x: 200, y: -100 };
  circuit.wires.push({ id: "W1", a: pin("R1", 1), b: pin("R2", 0), ...newWireShape(circuit, pin("R1", 1), pin("R2", 0), [anchor]) });
  circuit.wires.push({ id: "W2", a: pin("R1", 0), b: pin("R2", 1), ...newWireShape(circuit, pin("R1", 0), pin("R2", 1)) });
  const items = [{ kind: "component", id: "R2" }];
  moveGroup(circuit, items, 60, 140);
  assert.deepEqual(wiresFollowingMove(circuit, items), ["W1", "W2"]);
  rerouteWires(circuit, wiresFollowingMove(circuit, items));
  for (const wire of circuit.wires) assertOrthogonal(drawn(circuit, wire), wire.id);
  const w1 = circuit.wires[0];
  assert.deepEqual(w1.anchors, [anchor], "경유점은 그대로");
  assert.ok(cellsOf(drawn(circuit, w1)).some((cell) => cell.x === anchor.x && cell.y === anchor.y), "옮긴 뒤에도 경유점을 지난다");
  const moved = circuit.components[1];
  const route = drawn(circuit, w1);
  const inward = DIRS[pinOutwardDirection(moved, 0)];
  assert.deepEqual(lastDirection(route), { x: -inward.x || 0, y: -inward.y || 0 }, "옮긴 부품의 핀에도 바깥쪽에서 들어간다");
});

test("옛 배선(anchors 없음)은 열 때 그대로이고, 끝이 움직이면 저장된 꺾임점을 경유점으로 지킨다; 되돌리면 원래대로", () => {
  const { circuit } = cloneExample("y-network");
  const before = structuredClone(circuit.wires);
  createRoutingContext(circuit);
  assert.deepEqual(circuit.wires, before, "맥락을 만드는 것만으로는 아무것도 바뀌지 않는다");
  const w7 = circuit.wires.find((wire) => wire.id === "W7");
  const shapes = captureWireShapes(circuit, ["W7"]);
  const r4 = circuit.components.find((item) => item.id === "R4");
  r4.y += 40;
  rerouteWires(circuit, ["W7"]);
  assert.deepEqual(w7.anchors, before.find((wire) => wire.id === "W7").waypoints, "저장돼 있던 꺾임점이 경유점이 된다");
  assertOrthogonal(drawn(circuit, w7), "W7");
  r4.y -= 40;
  restoreWireShapes(circuit, shapes);
  assert.deepEqual(circuit.wires, before, "되돌리면 필드까지 원래대로 (anchors 없음)");
});

test("배선 정리: 예제 회로를 모두 자동 경로로 다시 그려도 모든 선분이 직교이고 해석 결과는 같다", () => {
  for (const example of examples) {
    const reference = cloneExample(example.id);
    const tidy = cloneExample(example.id);
    const changed = rerouteWires(tidy.circuit, tidy.circuit.wires.map((wire) => wire.id), { fresh: true });
    assert.equal(changed.length, tidy.circuit.wires.length, `${example.id}: 모든 배선을 다시 그린다`);
    for (const wire of tidy.circuit.wires) {
      assertOrthogonal(drawn(tidy.circuit, wire), `${example.id} ${wire.id}`);
      assert.deepEqual(wire.anchors, [], "정리하면 경유점이 없는 자동 경로");
      assert.deepEqual([wire.a, wire.b], [reference.circuit.wires.find((item) => item.id === wire.id).a, reference.circuit.wires.find((item) => item.id === wire.id).b], "끝점(연결)은 그대로");
    }
    const settings = example.settings;
    const outcome = (circuit) => { try { return simulate(circuit, settings); } catch (error) { return { error: error.code ?? error.message }; } };
    const expected = outcome(reference.circuit);
    assert.ok(!expected.error, `${example.id}: 원래 회로가 풀린다 (${expected.error})`);
    assert.deepEqual(outcome(tidy.circuit), expected, `${example.id}: 해석 결과 동일`);
  }
});

test("배선 정리 뒤 다른 노드의 배선끼리 같은 선분을 나눠 쓰지 않는다 (예제 전체; 같은 노드끼리는 합쳐져도 된다)", () => {
  for (const example of examples) {
    const { circuit } = cloneExample(example.id);
    rerouteWires(circuit, circuit.wires.map((wire) => wire.id), { fresh: true });
    const context = createRoutingContext(circuit);
    const owner = new Map();
    for (const wire of circuit.wires) {
      const net = context.netOf(wire.a);
      for (const edge of unitEdges(drawn(circuit, wire))) {
        const other = owner.get(edge);
        if (other) assert.equal(other.net, net, `${example.id}: ${other.id}와 ${wire.id}(다른 노드)가 ${edge}에서 겹친다`);
        owner.set(edge, { id: wire.id, net });
      }
    }
  }
});

test("경로 정리: 같은 직선 위 점과 되돌아가는 뾰족점을 지운다", () => {
  assert.deepEqual(simplifyRoute([{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 40 }]), [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 40 }]);
  assert.deepEqual(simplifyRoute([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 40 }, { x: 100, y: 0 }, { x: 100, y: 80 }]), [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }]);
});

test("경유점은 배선 분할·복제·그룹 이동과 함께 간다", () => {
  const circuit = circuitOf([part("R1", "R", 0, 0), part("R2", "R", 400, 200)]);
  const anchors = [{ x: 100, y: -100 }, { x: 300, y: 300 }];
  circuit.wires.push({ id: "W1", a: pin("R1", 1), b: pin("R2", 0), ...newWireShape(circuit, pin("R1", 1), pin("R2", 0), anchors) });
  const route = drawn(circuit, circuit.wires[0]);
  const split = splitWireAtJunction(circuit, "W1", { x: 200, y: -100 }, route);
  assert.deepEqual(split.circuit.wires.map((wire) => wire.anchors), [[anchors[0]], [anchors[1]]], "분할점 앞뒤로 나뉜다");
  const clone = cloneComponentSet(circuit, ["R1", "R2"], 40);
  assert.deepEqual(clone.wires[0].anchors, anchors.map((point) => ({ x: point.x + 40, y: point.y + 40 })), "복제본의 경유점도 같이 옮겨진다");
  const items = [{ kind: "component", id: "R1" }, { kind: "component", id: "R2" }];
  const origins = captureGroupOrigins(circuit, items);
  applyGroupOffset(circuit, origins, 20, 40, { snap: true });
  assert.deepEqual(circuit.wires[0].anchors, anchors.map((point) => ({ x: point.x + 20, y: point.y + 40 })), "두 끝이 함께 움직이면 경유점도 함께");
  assert.deepEqual(wiresFollowingMove(circuit, items), [], "양 끝이 함께 움직이는 배선은 다시 놓지 않는다(통째로 이동)");
});

test("격자 밖(옛 기하) 끝점은 자동 경로 대신 예전처럼 찍은 점을 L자로 잇는다", () => {
  const circuit = { components: [part("U1", "OPAMP", 0, 0), part("R1", "R", 200, 0)], wires: [], junctions: [] }; // geometryVersion 1: 핀 (45, 0)
  const shape = newWireShape(circuit, pin("U1", 2), pin("R1", 0), [{ x: 100, y: 60 }]);
  assert.equal(shape.anchors, undefined);
  assert.deepEqual(shape.waypoints, [{ x: 100, y: 0 }, { x: 100, y: 60 }]);
});

test("저장 파일의 anchors도 waypoints처럼 검사한다 (좌표가 아니면 거부)", async () => {
  const { validateCircuitStructure } = await import("../../src/circuit-engine.js");
  const base = () => ({ ...circuitOf([part("R1", "R", 0, 0), part("R2", "R", 200, 0)]), wires: [{ id: "W1", a: pin("R1", 1), b: pin("R2", 0), waypoints: [], anchors: [] }] });
  assert.doesNotThrow(() => validateCircuitStructure(base()));
  for (const anchors of ["bad", [{ x: Number.NaN, y: 0 }], [{ x: 20 }]]) {
    const circuit = base();
    circuit.wires[0].anchors = anchors;
    assert.throws(() => validateCircuitStructure(circuit), /경유점/);
  }
});
