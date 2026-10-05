import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { componentDefaults } from "../src/circuit-engine.js";
import { analyzeDCPort } from "../src/port-analysis.js";

const contract = JSON.parse(readFileSync(new URL("./fixtures/CIRCUIT-016/contracts.json", import.meta.url), "utf8"));
const item = (id, type, props, nets, control) => ({ id, type, x: 100, y: 100, rotation: 0, props, ...(control ? { control } : {}), nets });
const resistor = (id, value, nets) => item(id, "R", { ref: id, value }, nets);
const source = (id, type, dc, nets) => item(id, type, { ...componentDefaults(type), ref: id, mode: "DC", dc }, nets);

function make(specs) {
  const all = [...specs, item("GND", "GND", { ref: "GND" }, ["0"])];
  const components = all.map(({ nets, ...component }) => component);
  const groups = new Map(), wires = [];
  all.forEach((component) => component.nets.forEach((net, pin) => {
    if (!groups.has(net)) groups.set(net, []);
    groups.get(net).push({ componentId: component.id, pin });
  }));
  for (const endpoints of groups.values()) for (let index = 1; index < endpoints.length; index += 1) wires.push({ id: `W${wires.length + 1}`, a: endpoints[0], b: endpoints[index] });
  return { version: 3, geometryVersion: 2, components, wires, junctions: [] };
}

const request = (p, n, externalLoadIds = []) => ({ p, n, externalLoadIds });
const close = (actual, expected, absolute, relative = contract.tolerances.relative) => assert.ok(Math.abs(actual - expected) <= absolute + relative * Math.abs(expected), `${actual} != ${expected}`);

function basic() {
  return make([
    source("V1", "V", "12", ["a", "0"]), resistor("R1", "2k", ["a", "p"]), resistor("R2", "4k", ["p", "0"]), resistor("RL", "4k", ["p", "0"]),
  ]);
}

test("CIRCUIT-016 basic Thevenin/Norton values, load predictions and reversed port", () => {
  const circuit = basic();
  const original = JSON.stringify(circuit);
  const normal = analyzeDCPort(circuit, request({ componentId: "RL", pin: 0 }, { componentId: "RL", pin: 1 }, ["RL"]));
  close(normal.equivalent.vth.value, contract.basic.vth, contract.tolerances.voltageAbs);
  close(normal.equivalent.rth.value, contract.basic.rth, contract.tolerances.resistanceAbs);
  close(normal.equivalent.in.value, contract.basic.in, contract.tolerances.currentAbs);
  close(normal.trials.current.voltage, contract.basic.trialVoltage, contract.tolerances.voltageAbs);
  close(normal.equivalent.residual, 0, contract.tolerances.voltageAbs + contract.basic.rth * contract.tolerances.currentAbs, 0);
  for (const load of contract.basic.loads) {
    const voltage = normal.equivalent.vth.value * load.resistance / (normal.equivalent.rth.value + load.resistance);
    close(voltage, load.voltage, contract.tolerances.voltageAbs);
    close(voltage / load.resistance, load.current, contract.tolerances.currentAbs);
  }
  const reversed = analyzeDCPort(circuit, request({ componentId: "RL", pin: 1 }, { componentId: "RL", pin: 0 }, ["RL"]));
  close(reversed.equivalent.vth.value, -contract.basic.vth, contract.tolerances.voltageAbs);
  close(reversed.equivalent.rth.value, contract.basic.rth, contract.tolerances.resistanceAbs);
  close(reversed.equivalent.in.value, -contract.basic.in, contract.tolerances.currentAbs);
  assert.equal(JSON.stringify(circuit), original);
});

test("CIRCUIT-016 dependent sources remain active and negative resistance is retained", () => {
  const active = make([
    resistor("R1", "1k", ["p", "0"]),
    item("G1", "VCCS", { ref: "G1", gm: "-0.5mS" }, ["p", "0", "p", "0"]),
  ]);
  const activeResult = analyzeDCPort(active, request({ componentId: "R1", pin: 0 }, { componentId: "R1", pin: 1 }));
  close(activeResult.equivalent.rth.value, contract.active.rth, contract.tolerances.resistanceAbs);
  close(activeResult.trials.current.voltage, contract.active.trialVoltage, contract.tolerances.voltageAbs);

  const negative = make([
    resistor("R1", "1k", ["p", "0"]),
    item("G1", "VCCS", { ref: "G1", gm: "-2mS" }, ["p", "0", "p", "0"]),
    source("I1", "I", "1m", ["0", "p"]),
  ]);
  const negativeResult = analyzeDCPort(negative, request({ componentId: "R1", pin: 0 }, { componentId: "R1", pin: 1 }));
  close(negativeResult.equivalent.vth.value, contract.negative.vth, contract.tolerances.voltageAbs);
  close(negativeResult.equivalent.rth.value, contract.negative.rth, contract.tolerances.resistanceAbs);
  close(negativeResult.equivalent.in.value, contract.negative.in, contract.tolerances.currentAbs);
});

test("CIRCUIT-016 zeroed independent V and sensor branches stay available to CCCS", () => {
  for (const targetType of ["V", "CURRENT_SENSOR"]) {
    const target = targetType === "V"
      ? source("V0", "V", "7", ["b", "0"])
      : item("S1", "CURRENT_SENSOR", { ref: "S1" }, ["b", "0"]);
    const targetId = targetType === "V" ? "V0" : "S1";
    const circuit = make([
      resistor("R1", "1k", ["p", "b"]), target,
      item("F1", "CCCS", { ref: "F1", beta: "1" }, ["p", "0"], { kind: "branchCurrent", elementId: targetId, direction: 1 }),
    ]);
    const result = analyzeDCPort(circuit, request({ componentId: "R1", pin: 0 }, { componentId: "F1", pin: 1 }));
    close(result.equivalent.rth.value, contract.branchReference.rth, contract.tolerances.resistanceAbs);
    close(result.trials.current.voltage, contract.branchReference.trialVoltage, contract.tolerances.voltageAbs);
  }
});

test("CIRCUIT-016 ideal voltage and verified ideal current ports use explicit tagged states", () => {
  const idealVoltage = make([source("V1", "V", "5", ["p", "0"])]);
  const voltage = analyzeDCPort(idealVoltage, request({ componentId: "V1", pin: 0 }, { componentId: "V1", pin: 1 }));
  close(voltage.equivalent.vth.value, contract.idealVoltage.vth, contract.tolerances.voltageAbs);
  assert.equal(voltage.equivalent.rth.kind, contract.idealVoltage.rthKind);
  assert.equal(voltage.equivalent.in.kind, contract.idealVoltage.inKind);
  assert.equal(voltage.trials.short.status, "error");

  const idealCurrent = make([source("I1", "I", "2m", ["0", "p"])]);
  const current = analyzeDCPort(idealCurrent, request({ componentId: "I1", pin: 1 }, { componentId: "I1", pin: 0 }));
  assert.equal(current.classification, "ideal-current");
  assert.equal(current.equivalent.vth.kind, contract.idealCurrent.vthKind);
  assert.equal(current.equivalent.rth.kind, contract.idealCurrent.rthKind);
  close(current.equivalent.in.value, contract.idealCurrent.in, contract.tolerances.currentAbs);
  close(current.trials.clamps.oneVolt.branchCurrent, current.trials.clamps.twoVolt.branchCurrent, contract.tolerances.currentAbs);
});
