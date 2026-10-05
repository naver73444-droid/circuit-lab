import test from "node:test";
import assert from "node:assert/strict";
import { componentDefaults, simulateDC, simulateTransient } from "../src/circuit-engine.js";

function item(id, type, props, nets) { return { id, type, x: 100, y: 100, rotation: 0, props, nets }; }
function make(specs) {
  const all = [...specs, item("GND", "GND", { ref: "GND" }, ["0"])];
  const components = all.map(({ nets, ...component }) => component), groups = new Map(), wires = [];
  all.forEach((component) => component.nets.forEach((net, pin) => { if (!groups.has(net)) groups.set(net, []); groups.get(net).push({ componentId: component.id, pin }); }));
  for (const endpoints of groups.values()) for (let i = 1; i < endpoints.length; i += 1) wires.push({ id: `W${wires.length + 1}`, a: endpoints[0], b: endpoints[i] });
  return { version: 2, geometryVersion: 2, components, wires, junctions: [] };
}
const v = (id, dc, nets) => item(id, "V", { ...componentDefaults("V"), ref: id, dc: String(dc) }, nets);
const r = (id, value, nets) => item(id, "R", { ref: id, value: String(value) }, nets);
const dep = (type, value, nets) => item("DEP", type, type === "VCVS" ? { ref: "E1", g: String(value) } : { ref: "G1", gm: String(value) }, nets);
const voltage = (result, point, id, pin = 0) => point.nodeVoltages[result.topology.nodeIdByPin[`${id}:${pin}`]];

test("CIRCUIT-014 coefficient dimensions accept zero/negative/SI and reject foreign units", () => {
  for (const value of ["0", "-2", "1k"]) assert.doesNotThrow(() => simulateDC(make([v("VC", 1, ["cp", "0"]), dep("VCVS", value, ["out", "0", "cp", "0"]), r("RL", "1k", ["out", "0"])])));
  for (const value of ["0", "-1m", "3mS", "20uS", "1k"]) assert.doesNotThrow(() => simulateDC(make([v("VC", 1, ["cp", "0"]), dep("VCCS", value, ["out", "0", "cp", "0"]), r("RL", "1k", ["out", "0"])])));
  for (const [type, values] of [["VCVS", ["1V", "2S", "NaN"]], ["VCCS", ["3s", "2A", "1V", "1ohm"]]]) for (const value of values) {
    assert.throws(() => simulateDC(make([v("VC", 1, ["cp", "0"]), dep(type, value, ["out", "0", "cp", "0"]), r("RL", "1k", ["out", "0"])])), (error) => error.code === "INVALID_VALUE");
  }
});

test("CIRCUIT-014 VCVS feedback is simultaneous while redundant and conflicting constraints fail", () => {
  const feedback = make([v("ONE", 1, ["one", "0"]), dep("VCVS", 2, ["out", "0", "one", "out"]), r("RL", "1k", ["out", "0"])]);
  const solved = simulateDC(feedback); assert.ok(Math.abs(voltage(solved, solved.points[0], "DEP") - 2 / 3) < 1e-9);
  const nonunique = make([dep("VCVS", 1, ["out", "0", "out", "0"]), r("RL", "1k", ["out", "0"])]);
  assert.throws(() => simulateDC(nonunique), (error) => error.code === "SINGULAR");
  const conflict = make([v("VC", 2, ["cp", "0"]), dep("VCVS", 4, ["out", "0", "cp", "0"]), v("FORCE", 7, ["out", "0"]), r("RL", "2k", ["out", "0"])]);
  assert.throws(() => simulateDC(conflict), (error) => ["SINGULAR", "IDEAL_CONSTRAINT_CONFLICT"].includes(error.code));
});

test("CIRCUIT-014 VCCS zero conductance and isolated control networks fail explicitly", () => {
  const zeroConductance = make([dep("VCCS", "-1mS", ["out", "0", "out", "0"]), r("RL", "1k", ["out", "0"])]);
  assert.throws(() => simulateDC(zeroConductance), (error) => error.code === "SINGULAR");
  const contradictory = make([dep("VCCS", "-1mS", ["out", "0", "out", "0"]), r("RL", "1k", ["out", "0"]), item("I1", "I", { ...componentDefaults("I"), ref: "I1", dc: "1m" }, ["0", "out"])]);
  assert.throws(() => simulateDC(contradictory), (error) => error.code === "SINGULAR");
  for (const [type, value] of [["VCVS", "0"], ["VCCS", "0"]]) {
    const floating = make([dep(type, value, ["out", "0", "floating-a", "floating-b"]), r("RL", "1k", ["out", "0"])]);
    assert.throws(() => simulateDC(floating), (error) => error.code === "FLOATING_NODE");
  }
});

test("CIRCUIT-014 conflicting VCVS output capacitor IC never returns a fake first sample", () => {
  const candidate = make([
    v("VC", 2, ["cp", "0"]), dep("VCVS", 4, ["out", "0", "cp", "0"]), r("RL", "2k", ["out", "0"]),
    item("C1", "C", { ref: "C1", value: "1u", ic: "7" }, ["out", "0"]),
  ]);
  assert.throws(() => simulateTransient(candidate, { start: "0", end: "1m", step: "250u" }), (error) => ["SINGULAR", "IDEAL_CONSTRAINT_CONFLICT", "INITIAL_DERIVATIVE_UNSUPPORTED"].includes(error.code));
});
