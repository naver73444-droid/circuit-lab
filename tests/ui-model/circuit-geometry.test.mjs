import test from "node:test";
import assert from "node:assert/strict";
import { appendFixedWaypoint, localPin, pinPosition, projectSplitPoint, routeWirePoints, snapPoint, circuitGeometryVersion } from "../../src/circuit-geometry.js";

test("20-unit 표시 격자와 새 geometry의 모든 단자가 같은 좌표 계약을 쓴다", () => {
  assert.deepEqual(snapPoint({ x: 31, y: -29 }), { x: 40, y: -20 });
  assert.deepEqual(localPin("GND", 0, 1), { x: 0, y: -28 });
  assert.deepEqual(localPin("OPAMP", 1, 1), { x: -45, y: 18 });
  for (const type of ["R", "C", "L", "V", "I", "D", "GND", "OPAMP"]) {
    const count = type === "GND" ? 1 : type === "OPAMP" ? 3 : 2;
    for (const rotation of [0, 90, 180, 270]) {
      for (let pin = 0; pin < count; pin += 1) {
        const position = pinPosition({ type, x: 100, y: 140, rotation }, pin, 2);
        assert.ok(Math.abs(position.x / 20 - Math.round(position.x / 20)) <= 1e-9, `${type}/${rotation}/${pin} x`);
        assert.ok(Math.abs(position.y / 20 - Math.round(position.y / 20)) <= 1e-9, `${type}/${rotation}/${pin} y`);
      }
    }
  }
});

test("고정 waypoint는 클릭한 점을 지나고 endpoint 이동 때 내부점이 보존된다", () => {
  const start = { x: 0, y: 0 };
  let fixed = appendFixedWaypoint(start, [], { x: 40, y: 40 });
  fixed = appendFixedWaypoint(start, fixed, { x: 80, y: 60 });
  assert.deepEqual(fixed, [{ x: 40, y: 0 }, { x: 40, y: 40 }, { x: 80, y: 40 }, { x: 80, y: 60 }]);
  const wire = { waypoints: fixed };
  assert.deepEqual(routeWirePoints(wire, start, { x: 120, y: 100 }, 2), [
    { x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }, { x: 80, y: 40 },
    { x: 80, y: 60 }, { x: 120, y: 60 }, { x: 120, y: 100 },
  ]);
  const moved = routeWirePoints(wire, { x: 0, y: 20 }, { x: 140, y: 100 }, 2);
  assert.deepEqual(moved.slice(2, 6), fixed);
  assert.deepEqual(routeWirePoints({ waypoints: [] }, { x: 160, y: 200 }, { x: 360, y: 120 }, 2), [
    { x: 160, y: 200 }, { x: 260, y: 200 }, { x: 260, y: 120 }, { x: 360, y: 120 },
  ]);
});

test("degenerate wire geometry is explicitly rejected", () => {
  assert.throws(() => projectSplitPoint([], { x: 0, y: 0 }), RangeError);
  assert.throws(() => projectSplitPoint([{ x: 0, y: 0 }], { x: 0, y: 0 }), RangeError);
});

const expectedPins = [
  { x: -40, y: 0 },
  { x: 40, y: 0 },
  { x: 0, y: -40 },
  { x: 0, y: 40 },
];

test("geometry1, omitted geometry and geometry2 keep four distinct controlled pins", () => {
  for (const type of ["VCVS", "VCCS"]) {
    for (const geometryVersion of [1, circuitGeometryVersion({}), 2]) {
      const pins = [0, 1, 2, 3].map((pin) => localPin(type, pin, geometryVersion));
      assert.deepEqual(pins, expectedPins);
      assert.equal(new Set(pins.map(({ x, y }) => `${x},${y}`)).size, 4);
    }
  }
});

test("controlled pin rotation matches the independent rotation equation", () => {
  for (const type of ["VCVS", "VCCS"]) for (const geometryVersion of [1, 2]) for (const rotation of [0, 90, 180, 270]) {
    const component = { type, x: 140, y: 220, rotation };
    const angle = rotation * Math.PI / 180;
    expectedPins.forEach((local, pin) => {
      const expected = {
        x: component.x + local.x * Math.cos(angle) - local.y * Math.sin(angle),
        y: component.y + local.x * Math.sin(angle) + local.y * Math.cos(angle),
      };
      const actual = pinPosition(component, pin, geometryVersion);
      assert.ok(Math.abs(actual.x - expected.x) <= 1e-9);
      assert.ok(Math.abs(actual.y - expected.y) <= 1e-9);
    });
  }
});

const project = {
  title: "VCVS/VCCS",
  subtitle: "controlled sources",
  circuit: {
    version: 2, geometryVersion: 2, junctions: [],
    components: [
      { id: "E1", type: "VCVS", x: 200, y: 200, rotation: 90, props: { ref: "E1", g: "4" } },
      { id: "G1", type: "VCCS", x: 400, y: 200, rotation: 0, props: { ref: "G1", gm: "3mS" } },
      { id: "GND", type: "GND", x: 300, y: 400, rotation: 0, props: { ref: "GND" } },
    ],
    wires: [
      { id: "W1", a: { componentId: "E1", pin: 1 }, b: { componentId: "GND", pin: 0 } },
      { id: "W2", a: { componentId: "E1", pin: 3 }, b: { componentId: "GND", pin: 0 } },
      { id: "W3", a: { componentId: "G1", pin: 1 }, b: { componentId: "GND", pin: 0 } },
      { id: "W4", a: { componentId: "G1", pin: 3 }, b: { componentId: "GND", pin: 0 } },
    ],
  },
  settings: { analysis: "dc" },
  probes: [
    { key: "V:E1:0", kind: "voltage", componentId: "E1", pin: 0, label: "V(E1.p)", color: "#80bfff" },
    { key: "I:G1", kind: "current", componentId: "G1", label: "I(G1,p→n)", color: "#f5bc79" },
  ],
};

test("four-pin geometry reuses exact rotation transform", () => {
  assert.deepEqual([0, 1, 2, 3].map((pin) => localPin("VCVS", pin)), [{ x: -40, y: 0 }, { x: 40, y: 0 }, { x: 0, y: -40 }, { x: 0, y: 40 }]);
  const component = project.circuit.components[0];
  assert.deepEqual(pinPosition(component, 0), { x: 200, y: 160 });
  assert.deepEqual(pinPosition(component, 2), { x: 240, y: 200 });
});

test("new two-pin geometry reuses the existing rotation equation", () => {
  for (const type of ["CURRENT_SENSOR", "CCCS", "CCVS"]) for (const version of [1, 2]) {
    assert.deepEqual([localPin(type, 0, version), localPin(type, 1, version)], [{ x: -40, y: 0 }, { x: 40, y: 0 }]);
    assert.deepEqual(pinPosition({ type, x: 100, y: 120, rotation: 90 }, 0, version), { x: 100, y: 80 });
  }
});
