import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { componentDefaults, complexMagnitude, complexPhaseDegrees, deserializeCircuit, pinCount, serializeCircuit, simulateAC, simulateDC, simulateTransient, simulateACAtFrequency } from "../../../src/circuit-engine.js";
import { cloneComponentSet, cloneSelectedComponent, deleteComponentFromCircuit } from "../../../src/circuit-edit.js";
import { deserializeProject, serializeProject } from "../../../src/project-format.js";

describe("VCVS and VCCS", () => {
  const contract = JSON.parse(readFileSync(new URL("../../fixtures/controlled-voltage-sources.json", import.meta.url), "utf8"));

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

  test("defaults, pins and DC signs follow the independent contract", () => {
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

  test("sign, common-mode, identity and zero coefficients are simultaneous", () => {
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

  test("AC uses the same complex control voltage at 100 Hz and 1 kHz", () => {
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

  test("transient uses the same-time control sample including t0", () => {
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

  test("controlled inputs draw no current in the loaded sense network", () => {
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

  test("circuit JSON uses v2 only for controlled sources", () => {
    const candidate = basic("VCVS", 4, 2000);
    const text = serializeCircuit(candidate); assert.equal(JSON.parse(text).version, 2);
    assert.deepEqual(deserializeCircuit(text), JSON.parse(text));
    const legacy = circuit([component("R1", "R", { ref: "R1", value: "1k" }, ["x", "0"], 0)]);
    legacy.version = 1; assert.equal(JSON.parse(serializeCircuit(legacy)).version, 1);
    const disguised = JSON.parse(text); disguised.version = 1;
    assert.throws(() => deserializeCircuit(JSON.stringify(disguised)), (error) => error.code === "INVALID_FILE");
  });
});

describe("VCVS and VCCS failure modes", () => {
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

  test("coefficient dimensions accept zero/negative/SI and reject foreign units", () => {
    for (const value of ["0", "-2", "1k"]) assert.doesNotThrow(() => simulateDC(make([v("VC", 1, ["cp", "0"]), dep("VCVS", value, ["out", "0", "cp", "0"]), r("RL", "1k", ["out", "0"])])));
    for (const value of ["0", "-1m", "3mS", "20uS", "1k"]) assert.doesNotThrow(() => simulateDC(make([v("VC", 1, ["cp", "0"]), dep("VCCS", value, ["out", "0", "cp", "0"]), r("RL", "1k", ["out", "0"])])));
    for (const [type, values] of [["VCVS", ["1V", "2S", "NaN"]], ["VCCS", ["3s", "2A", "1V", "1ohm"]]]) for (const value of values) {
      assert.throws(() => simulateDC(make([v("VC", 1, ["cp", "0"]), dep(type, value, ["out", "0", "cp", "0"]), r("RL", "1k", ["out", "0"])])), (error) => error.code === "INVALID_VALUE");
    }
  });

  test("VCVS feedback is simultaneous while redundant and conflicting constraints fail", () => {
    const feedback = make([v("ONE", 1, ["one", "0"]), dep("VCVS", 2, ["out", "0", "one", "out"]), r("RL", "1k", ["out", "0"])]);
    const solved = simulateDC(feedback); assert.ok(Math.abs(voltage(solved, solved.points[0], "DEP") - 2 / 3) < 1e-9);
    const nonunique = make([dep("VCVS", 1, ["out", "0", "out", "0"]), r("RL", "1k", ["out", "0"])]);
    assert.throws(() => simulateDC(nonunique), (error) => error.code === "SINGULAR");
    const conflict = make([v("VC", 2, ["cp", "0"]), dep("VCVS", 4, ["out", "0", "cp", "0"]), v("FORCE", 7, ["out", "0"]), r("RL", "2k", ["out", "0"])]);
    assert.throws(() => simulateDC(conflict), (error) => ["SINGULAR", "IDEAL_CONSTRAINT_CONFLICT"].includes(error.code));
  });

  test("VCCS zero conductance and isolated control networks fail explicitly", () => {
    const zeroConductance = make([dep("VCCS", "-1mS", ["out", "0", "out", "0"]), r("RL", "1k", ["out", "0"])]);
    assert.throws(() => simulateDC(zeroConductance), (error) => error.code === "SINGULAR");
    const contradictory = make([dep("VCCS", "-1mS", ["out", "0", "out", "0"]), r("RL", "1k", ["out", "0"]), item("I1", "I", { ...componentDefaults("I"), ref: "I1", dc: "1m" }, ["0", "out"])]);
    assert.throws(() => simulateDC(contradictory), (error) => error.code === "SINGULAR");
    for (const [type, value] of [["VCVS", "0"], ["VCCS", "0"]]) {
      const floating = make([dep(type, value, ["out", "0", "floating-a", "floating-b"]), r("RL", "1k", ["out", "0"])]);
      assert.throws(() => simulateDC(floating), (error) => error.code === "FLOATING_NODE");
    }
  });

  test("conflicting VCVS output capacitor IC never returns a fake first sample", () => {
    const candidate = make([
      v("VC", 2, ["cp", "0"]), dep("VCVS", 4, ["out", "0", "cp", "0"]), r("RL", "2k", ["out", "0"]),
      item("C1", "C", { ref: "C1", value: "1u", ic: "7" }, ["out", "0"]),
    ]);
    assert.throws(() => simulateTransient(candidate, { start: "0", end: "1m", step: "250u" }), (error) => ["SINGULAR", "IDEAL_CONSTRAINT_CONFLICT", "INITIAL_DERIVATIVE_UNSUPPORTED"].includes(error.code));
  });
});

describe("CCCS and CCVS", () => {
  const contract = JSON.parse(readFileSync(new URL("../../fixtures/controlled-current-sources.json", import.meta.url), "utf8"));

  const item = (id, type, props, nets, control) => ({ id, type, x: 100, y: 100, rotation: 0, props, ...(control ? { control } : {}), nets });

  const source = (id, props, nets) => item(id, "V", { ...componentDefaults("V"), ref: id, ...props }, nets);

  const resistor = (id, value, nets) => item(id, "R", { ref: id, value }, nets);

  const sensor = (id, nets) => item(id, "CURRENT_SENSOR", { ref: id }, nets);

  const dependent = (type, value, controlId, direction = 1, nets = ["out", "0"]) => item(
    type === "CCCS" ? "F1" : "H1", type,
    type === "CCCS" ? { ref: "F1", beta: String(value) } : { ref: "H1", rm: String(value) },
    nets, { kind: "branchCurrent", elementId: controlId, direction },
  );

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

  function base(type, { controlId = "S1", direction = 1, coefficient = type === "CCCS" ? "3" : "2k", sourceProps = { dc: "5" } } = {}) {
    return make([
      source("V1", sourceProps, ["a", "0"]), resistor("R1", "5k", ["a", "b"]), sensor("S1", ["b", "0"]),
      dependent(type, coefficient, controlId, direction), resistor("RL", "1k", ["out", "0"]),
    ]);
  }

  const node = (result, id, pin = 0) => result.topology.nodeIdByPin[`${id}:${pin}`];

  const realVoltage = (result, point, id, pin = 0) => point.nodeVoltages[node(result, id, pin)];

  const close = (actual, expected, absolute, relative = 0) => assert.ok(Math.abs(actual - expected) <= absolute + relative * Math.abs(expected), `${actual} != ${expected}`);

  test("DC sensor, CCCS and CCVS satisfy independent signs and KCL", () => {
    for (const [type, expected] of [["CCCS", contract.dc.cccs], ["CCVS", contract.dc.ccvs]]) {
      const result = simulateDC(base(type));
      const point = result.points[0];
      close(point.componentCurrents.S1, contract.dc.sensorCurrent, 1e-11, 1e-8);
      close(realVoltage(result, point, type === "CCCS" ? "F1" : "H1"), expected.outputVoltage, 1e-9, 1e-8);
      close(point.componentCurrents[type === "CCCS" ? "F1" : "H1"], expected.outputCurrent, 1e-11, 1e-8);
      close(point.componentCurrents[type === "CCCS" ? "F1" : "H1"] + point.componentCurrents.RL, 0, 1e-10);
      close(point.componentCurrents.R1 - point.componentCurrents.S1, 0, 1e-12);
    }
  });

  test("direct V branch reference and single/double reversals preserve defined signs", () => {
    for (const type of ["CCCS", "CCVS"]) {
      const expected = type === "CCCS" ? contract.dc.cccs.outputVoltage : contract.dc.ccvs.outputVoltage;
      const direct = simulateDC(base(type, { controlId: "V1", direction: -1 })).points[0];
      const directResult = simulateDC(base(type, { controlId: "V1", direction: -1 }));
      close(realVoltage(directResult, directResult.points[0], type === "CCCS" ? "F1" : "H1"), expected, 1e-9, 1e-8);
      const reversed = simulateDC(base(type, { direction: -1 }));
      close(realVoltage(reversed, reversed.points[0], type === "CCCS" ? "F1" : "H1"), -expected, 1e-9, 1e-8);
      assert.ok(Number.isFinite(direct.componentCurrents.V1));
    }
  });

  test("AC uses the same instantaneous control branch phasor", () => {
    const phase = contract.ac.phaseDegrees * Math.PI / 180;
    for (const [type, magnitude] of [["CCCS", -3], ["CCVS", 2]]) {
      const circuit = base(type, { sourceProps: { dc: "0", acMagnitude: "5", acPhase: String(contract.ac.phaseDegrees) } });
      const result = simulateACAtFrequency(circuit, contract.ac.frequency), point = result.points[0];
      const value = point.nodeVoltages[node(result, type === "CCCS" ? "F1" : "H1")];
      close(value.re, magnitude * Math.cos(phase), 1e-9, 1e-8);
      close(value.im, magnitude * Math.sin(phase), 1e-9, 1e-8);
      close(point.componentCurrents.S1.re, .001 * Math.cos(phase), 1e-11, 1e-8);
      close(point.componentCurrents.S1.im, .001 * Math.sin(phase), 1e-11, 1e-8);
    }
  });

  test("transient has five same-time sensor/dependent samples", () => {
    for (const [type, scale] of [["CCCS", -3], ["CCVS", 2]]) {
      const circuit = base(type, { sourceProps: { mode: "SIN", dc: "0", offset: "0", amplitude: "5", frequency: "1k", phase: "0" } });
      const result = simulateTransient(circuit, { start: "0", end: "1m", step: "250u" });
      assert.equal(result.points.length, contract.transient.samples);
      result.points.forEach((point, index) => {
        const time = result.xValues[index], sine = Math.sin(2 * Math.PI * 1000 * time);
        close(time, index * .00025, 1e-15);
        close(point.componentCurrents.S1, .001 * sine, 1e-11, 1e-8);
        close(realVoltage(result, point, type === "CCCS" ? "F1" : "H1"), scale * sine, 1e-9, 1e-8);
      });
    }
  });

  test("mutually controlled CCVS loops solve simultaneously and singular cases fail", () => {
    const mutual = (rm, v1, v2) => make([
      source("V1", { dc: String(v1) }, ["a1", "0"]), resistor("R1", "1k", ["a1", "x1"]),
      item("H1", "CCVS", { ref: "H1", rm: String(rm) }, ["x1", "y1"], { kind: "branchCurrent", elementId: "S2", direction: 1 }), sensor("S1", ["y1", "0"]),
      source("V2", { dc: String(v2) }, ["a2", "0"]), resistor("R2", "1k", ["a2", "x2"]),
      item("H2", "CCVS", { ref: "H2", rm: String(rm) }, ["x2", "y2"], { kind: "branchCurrent", elementId: "S1", direction: 1 }), sensor("S2", ["y2", "0"]),
    ]);
    const solved = simulateDC(mutual("500", 1, 2)), point = solved.points[0];
    close(point.componentCurrents.S1, 0, 1e-11); close(point.componentCurrents.S2, .002, 1e-11, 1e-8);
    close(realVoltage(solved, point, "H1", 0) - realVoltage(solved, point, "H1", 1), 1, 1e-9, 1e-8);
    close(realVoltage(solved, point, "H2", 0) - realVoltage(solved, point, "H2", 1), 0, 1e-9);
    assert.throws(() => simulateDC(mutual("1k", 1, 1)), (error) => error.code === "SINGULAR");
    assert.throws(() => simulateDC(mutual("1k", 1, 2)), (error) => error.code === "SINGULAR");
  });
});

describe("control references", () => {
  const circuit = {
    version: 3, geometryVersion: 2, junctions: [],
    components: [
      { id: "V1", type: "V", x: 80, y: 100, rotation: 0, props: { ref: "supply", mode: "DC", dc: "1", acMagnitude: "0", acPhase: "0" } },
      { id: "S1", type: "CURRENT_SENSOR", x: 200, y: 100, rotation: 0, props: { ref: "sense" } },
      { id: "F1", type: "CCCS", x: 320, y: 100, rotation: 0, props: { ref: "F1", beta: "2" }, control: { kind: "branchCurrent", elementId: "S1", direction: 1 } },
      { id: "GND", type: "GND", x: 200, y: 240, rotation: 0, props: { ref: "GND" } },
    ],
    wires: [
      { id: "W1", a: { componentId: "V1", pin: 0 }, b: { componentId: "S1", pin: 0 } },
      { id: "W2", a: { componentId: "V1", pin: 1 }, b: { componentId: "GND", pin: 0 } },
      { id: "W3", a: { componentId: "S1", pin: 1 }, b: { componentId: "GND", pin: 0 } },
      { id: "W4", a: { componentId: "F1", pin: 1 }, b: { componentId: "GND", pin: 0 } },
    ],
  };

  test("v3 preserves permanent control IDs and lower-version disguises fail", () => {
    const raw = serializeCircuit(circuit); assert.equal(JSON.parse(raw).version, 3);
    assert.deepEqual(deserializeCircuit(raw).components.find((item) => item.id === "F1").control, circuit.components[2].control);
    const project = { title: "v3", subtitle: "control", circuit, settings: { analysis: "dc" }, probes: [{ key: "I:S1", kind: "current", componentId: "S1", label: "I(sense)", color: "#80bfff" }] };
    const text = serializeProject(project); assert.equal(JSON.parse(text).version, 3);
    assert.deepEqual(deserializeProject(text).probes, project.probes);
    for (const version of [1, 2]) { const disguised = JSON.parse(raw); disguised.version = version; assert.throws(() => deserializeCircuit(JSON.stringify(disguised)), (error) => error.code === "INVALID_FILE"); }
  });

  test("missing, wrong-type and invalid-direction controls fail without substitution", () => {
    for (const control of [
      { kind: "branchCurrent", elementId: "MISSING", direction: 1 },
      { kind: "branchCurrent", elementId: "GND", direction: 1 },
      { kind: "branchCurrent", elementId: "S1", direction: 0 },
      { kind: "branchCurrent", elementId: "S1", direction: 2 },
    ]) {
      const copy = structuredClone(circuit); copy.components.find((item) => item.id === "F1").control = control;
      assert.throws(() => simulateDC(copy), (error) => ["MISSING_CONTROL", "INVALID_CONTROL"].includes(error.code));
      assert.throws(() => serializeCircuit(copy), (error) => ["MISSING_CONTROL", "INVALID_CONTROL"].includes(error.code));
    }
  });

  test("beta/rm dimensions reject foreign units and accept zero/negative", () => {
    for (const [type, prop, good, bad] of [
      ["CCCS", "beta", ["0", "-2", "1k"], ["1A", "2S"]],
      ["CCVS", "rm", ["0", "-2k", "2kΩ", "2kohm"], ["1V", "2S"]],
    ]) for (const value of [...good, ...bad]) {
      const copy = structuredClone(circuit), component = copy.components.find((item) => item.id === "F1");
      component.type = type; component.props = { ref: type, [prop]: value };
      const action = () => serializeCircuit(copy);
      if (good.includes(value)) assert.doesNotThrow(action); else assert.throws(action, (error) => error.code === "INVALID_VALUE");
    }
  });

  test("set clone remaps internal control and internal wires while single clone keeps external ID", () => {
    const connected = structuredClone(circuit);
    connected.wires.push({ id: "WINTERNAL", a: { componentId: "S1", pin: 0 }, b: { componentId: "F1", pin: 0 } });
    const group = cloneComponentSet(connected, ["S1", "F1"]);
    const clonedSensor = group.components.find((item) => item.type === "CURRENT_SENSOR");
    const clonedDependent = group.components.find((item) => item.type === "CCCS");
    assert.equal(clonedDependent.control.elementId, clonedSensor.id);
    assert.equal(group.wires.length, 1);
    assert.deepEqual([group.wires[0].a.componentId, group.wires[0].b.componentId], [clonedSensor.id, clonedDependent.id]);
    assert.equal(circuit.components.find((item) => item.id === "F1").control.elementId, "S1");
    const single = cloneSelectedComponent(circuit, "F1");
    assert.equal(single.control.elementId, "S1");
  });

  test("target deletion preserves dangling ID and blocks run/save", () => {
    const deleted = deleteComponentFromCircuit(circuit, "S1").circuit;
    assert.equal(deleted.components.find((item) => item.id === "F1").control.elementId, "S1");
    assert.throws(() => simulateDC(deleted), (error) => error.code === "MISSING_CONTROL");
    assert.throws(() => serializeCircuit(deleted), (error) => error.code === "MISSING_CONTROL");
  });
});
