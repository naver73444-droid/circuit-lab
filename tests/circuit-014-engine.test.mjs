import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { componentDefaults, complexMagnitude, complexPhaseDegrees, deserializeCircuit, pinCount, serializeCircuit, simulateAC, simulateDC, simulateTransient } from "../src/circuit-engine.js";

const contract = JSON.parse(readFileSync(new URL("./fixtures/CIRCUIT-014/contracts.json", import.meta.url), "utf8"));
const T = contract.tolerances;
const close = (actual, expected, atol, rtol = 0) => assert.ok(Math.abs(actual - expected) <= atol + rtol * Math.abs(expected), `${actual} != ${expected}`);

function component(id, type, props, nets, index) { return { id, type, x: 100 + index * 80, y: 100 + index * 40, rotation: (index % 4) * 90, props, nets }; }
function circuit(specs) {
  const ground = component("GND", "GND", { ref: "GND" }, ["0"], specs.length);
  const items = [...specs, ground];
  const components = items.map(({ nets, ...item }) => item);
  const groups = new Map();
  for (const item of items) item.nets.forEach((net, pin) => { if (!groups.has(net)) groups.set(net, []); groups.get(net).push({ componentId: item.id, pin }); });
  const wires = [];
  for (const endpoints of groups.values()) for (let index = 1; index < endpoints.length; index += 1) wires.push({ id: `W${wires.length + 1}`, a: endpoints[0], b: endpoints[index] });
  return { version: 2, geometryVersion: 2, components, wires, junctions: [] };
}

const voltageSource = (id, value, nets, index = 0, extra = {}) => component(id, "V", { ...componentDefaults("V", index + 1), dc: String(value), ...extra }, nets, index);
const load = (ohms, index = 2) => component("RL", "R", { ref: "RL", value: String(ohms) }, ["out", "0"], index);
function basic(type, coefficient, loadOhms, sourceProps = {}) {
  const dependentProps = type === "VCVS" ? { ref: "E1", g: String(coefficient) } : { ref: "G1", gm: String(coefficient) };
  return circuit([
    voltageSource("VC", 2, ["control", "0"], 0, sourceProps),
    component("DEP", type, dependentProps, ["out", "0", "control", "0"], 1),
    load(loadOhms),
  ]);
}
const node = (result, point, id, pin = 0) => point.nodeVoltages[result.topology.nodeIdByPin[`${id}:${pin}`]];

test("CIRCUIT-014 defaults, pins and DC signs follow the independent contract", () => {
  assert.equal(pinCount("VCVS"), 4); assert.equal(pinCount("VCCS"), 4);
  assert.deepEqual(componentDefaults("VCVS", 2), { ref: "E2", g: "1" });
  assert.deepEqual(componentDefaults("VCCS", 3), { ref: "G3", gm: "1mS" });
  for (const [type, coefficient, loadOhms, expected] of [
    ["VCVS", 4, 2000, contract.dc.vcvs], ["VCCS", "3mS", 1000, contract.dc.vccs],
  ]) {
    const result = simulateDC(basic(type, coefficient, loadOhms));
    const point = result.points[0];
    close(node(result, point, "DEP"), expected.outputVoltage, T.voltageAtol, T.voltageRtol);
    close(point.componentCurrents.DEP, expected.sourceCurrent, T.currentAtol, T.currentRtol);
    close(point.componentCurrents.RL, expected.loadCurrent, T.currentAtol, T.currentRtol);
    close(point.componentCurrents.DEP + point.componentCurrents.RL, 0, T.outputKclAbs);
  }
});

test("CIRCUIT-014 sign, common-mode, identity and zero coefficients are simultaneous", () => {
  for (const type of ["VCVS", "VCCS"]) {
    const loadOhms = type === "VCVS" ? 2000 : 1000;
    const magnitude = type === "VCVS" ? 4 : 0.003;
    const base = node(simulateDC(basic(type, magnitude, loadOhms)), simulateDC(basic(type, magnitude, loadOhms)).points[0], "DEP");
    const negative = simulateDC(basic(type, -magnitude, loadOhms));
    close(node(negative, negative.points[0], "DEP"), -base, T.voltageAtol, T.voltageRtol);
    const reversed = basic(type, magnitude, loadOhms); const dep = reversed.components.find((item) => item.id === "DEP");
    [reversed.wires, dep];
    for (const wire of reversed.wires) for (const end of [wire.a, wire.b]) if (end.componentId === "DEP" && end.pin === 2) end.pin = 3; else if (end.componentId === "DEP" && end.pin === 3) end.pin = 2;
    const reversedResult = simulateDC(reversed); close(node(reversedResult, reversedResult.points[0], "DEP"), -base, T.voltageAtol, T.voltageRtol);
    const twice = structuredClone(reversed); const twiceDep = twice.components.find((item) => item.id === "DEP");
    if (type === "VCVS") twiceDep.props.g = String(-magnitude); else twiceDep.props.gm = String(-magnitude);
    const twiceResult = simulateDC(twice); close(node(twiceResult, twiceResult.points[0], "DEP"), base, T.voltageAtol, T.voltageRtol);
    const zero = simulateDC(basic(type, 0, loadOhms)); close(node(zero, zero.points[0], "DEP"), 0, T.voltageAtol); close(zero.points[0].componentCurrents.DEP, 0, T.currentAtol);
  }
  const common = circuit([
    voltageSource("VCP", 7, ["cp", "0"], 0), voltageSource("VCN", 5, ["cn", "0"], 1),
    component("DEP", "VCVS", { ref: "E1", g: "4" }, ["out", "0", "cp", "cn"], 2), load(2000, 3),
  ]);
  const result = simulateDC(common); close(node(result, result.points[0], "DEP"), 8, T.voltageAtol, T.voltageRtol);
  const commonVccs = structuredClone(common); const commonDep = commonVccs.components.find((item) => item.id === "DEP"); const commonLoad = commonVccs.components.find((item) => item.id === "RL");
  commonDep.type = "VCCS"; commonDep.props = { ref: "G1", gm: "3mS" }; commonLoad.props.value = "1k";
  const commonVccsResult = simulateDC(commonVccs); close(node(commonVccsResult, commonVccsResult.points[0], "DEP"), -6, T.voltageAtol, T.voltageRtol);
  const permuted = structuredClone(common); permuted.components.reverse(); permuted.components.forEach((item, index) => { item.x += index * 20; item.rotation = (item.rotation + 90) % 360; item.props.ref = `renamed-${index}`; });
  const permutedResult = simulateDC(permuted); close(node(permutedResult, permutedResult.points[0], "DEP"), 8, T.voltageAtol, T.voltageRtol);
});

test("CIRCUIT-014 AC uses the same complex control voltage at 100 Hz and 1 kHz", () => {
  for (const [type, coefficient, loadOhms, outputPeak, currentPeak] of [
    ["VCVS", 4, 2000, 8, -0.004], ["VCCS", "3mS", 1000, -6, 0.006],
  ]) {
    const candidate = basic(type, coefficient, loadOhms, { acMagnitude: "2", acPhase: "30" });
    const result = simulateAC(candidate, { startFrequency: "100", endFrequency: "1k", pointsPerDecade: "1" });
    for (const frequency of contract.ac.frequencies) {
      const index = result.xValues.indexOf(frequency); assert.ok(index >= 0);
      const point = result.points[index]; const output = node(result, point, "DEP"); const current = point.componentCurrents.DEP;
      close(complexMagnitude(output), Math.abs(outputPeak), T.voltageAtol, T.voltageRtol);
      close(complexPhaseDegrees(output), outputPeak < 0 ? -150 : 30, T.phaseDegrees);
      close(complexMagnitude(current), Math.abs(currentPeak), T.currentAtol, T.currentRtol);
      close(complexPhaseDegrees(current), currentPeak < 0 ? -150 : 30, T.phaseDegrees);
    }
  }
});

test("CIRCUIT-014 transient uses the same-time control sample including t0", () => {
  for (const [type, coefficient, loadOhms, voltageFactor, currentFactor] of [
    ["VCVS", 4, 2000, 4, -0.002], ["VCCS", "3mS", 1000, -3, 0.003],
  ]) {
    const candidate = basic(type, coefficient, loadOhms, { mode: "SIN", offset: "0", amplitude: "2", frequency: "1k", phase: "0" });
    const result = simulateTransient(candidate, { start: "0", end: "1m", step: "250u" });
    assert.equal(result.xValues.length, 5);
    result.xValues.forEach((time, index) => {
      close(time, index * 0.00025, T.timeAbs);
      const control = 2 * Math.sin(2 * Math.PI * 1000 * time);
      close(node(result, result.points[index], "VC"), control, T.voltageAtol, T.voltageRtol);
      close(node(result, result.points[index], "DEP"), voltageFactor * control, T.voltageAtol, T.voltageRtol);
      close(result.points[index].componentCurrents.DEP, currentFactor * control, T.currentAtol, T.currentRtol);
    });
  }
});

test("CIRCUIT-014 controlled inputs draw no current in the loaded sense network", () => {
  for (const [type, coefficient, loadOhms, expected] of [["VCVS", 4, 2000, 20 / 3], ["VCCS", "3mS", 1000, -5]]) {
    const candidate = circuit([
      voltageSource("VC", 2, ["source", "0"], 0), component("RS", "R", { ref: "RS", value: "1k" }, ["source", "cp"], 1),
      component("RP", "R", { ref: "RP", value: "5k" }, ["cp", "0"], 2),
      component("DEP", type, type === "VCVS" ? { ref: "E1", g: String(coefficient) } : { ref: "G1", gm: String(coefficient) }, ["out", "0", "cp", "0"], 3), load(loadOhms, 4),
    ]);
    const result = simulateDC(candidate), point = result.points[0];
    close(node(result, point, "DEP", 2), 5 / 3, T.voltageAtol, T.voltageRtol);
    close(node(result, point, "DEP"), expected, T.voltageAtol, T.voltageRtol);
    close(point.componentCurrents.RS - point.componentCurrents.RP, 0, T.inputKclAbs);
  }
  for (const type of ["VCVS", "VCCS"]) {
    const candidate = circuit([
      voltageSource("VCP", 2, ["source-p", "0"], 0), component("RSP", "R", { ref: "RSP", value: "1k" }, ["source-p", "cp"], 1), component("RPP", "R", { ref: "RPP", value: "5k" }, ["cp", "0"], 2),
      voltageSource("VCN", 2, ["source-n", "0"], 3), component("RSN", "R", { ref: "RSN", value: "1k" }, ["source-n", "cn"], 4), component("RPN", "R", { ref: "RPN", value: "5k" }, ["cn", "0"], 5),
      component("DEP", type, type === "VCVS" ? { ref: "E1", g: "4" } : { ref: "G1", gm: "3mS" }, ["out", "0", "cp", "cn"], 6), load(type === "VCVS" ? 2000 : 1000, 7),
    ]);
    const result = simulateDC(candidate), point = result.points[0];
    close(node(result, point, "DEP", 2), 5 / 3, T.voltageAtol, T.voltageRtol); close(node(result, point, "DEP", 3), 5 / 3, T.voltageAtol, T.voltageRtol);
    close(node(result, point, "DEP"), 0, T.voltageAtol); close(point.componentCurrents.DEP, 0, T.currentAtol);
    close(point.componentCurrents.RSP - point.componentCurrents.RPP, 0, T.inputKclAbs); close(point.componentCurrents.RSN - point.componentCurrents.RPN, 0, T.inputKclAbs);
  }
});

test("CIRCUIT-014 circuit JSON uses v2 only for controlled sources", () => {
  const candidate = basic("VCVS", 4, 2000);
  const text = serializeCircuit(candidate); assert.equal(JSON.parse(text).version, 2);
  assert.deepEqual(deserializeCircuit(text), JSON.parse(text));
  const legacy = circuit([component("R1", "R", { ref: "R1", value: "1k" }, ["x", "0"], 0)]);
  legacy.version = 1; assert.equal(JSON.parse(serializeCircuit(legacy)).version, 1);
  const disguised = JSON.parse(text); disguised.version = 1;
  assert.throws(() => deserializeCircuit(JSON.stringify(disguised)), (error) => error.code === "INVALID_FILE");
});
