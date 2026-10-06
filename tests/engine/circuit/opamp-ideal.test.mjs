import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { componentDefaults, deserializeCircuit, pinCount, serializeCircuit, simulateACAtFrequency, simulateDC, simulateTransient } from "../../../src/circuit-engine.js";
import { localPin, pinPosition } from "../../../src/circuit-geometry.js";
import { deserializeProject, serializeProject } from "../../../src/project-format.js";
import { buildResultsCSV } from "../../../src/csv-format.js";
import { parseCSV } from "../../helpers/csv.mjs";
import { cloneComponentSet } from "../../../src/circuit-edit.js";

const cloneSelectedComponent = (circuit, componentId, offset = 40) => cloneComponentSet(circuit, [componentId], offset).components[0] ?? null;
import { peakToRms, phasorPolar, wrapPhaseDifference } from "../../../src/phasor-format.js";
import { phasorFromPolar } from "../../helpers/complex.mjs";

describe("ideal op amp basics", () => {
  const VABS = 1e-9, VREL = 1e-8, IABS = 1e-11, IREL = 1e-8;

  const close = (actual, expected, abs = VABS, rel = VREL) => assert.ok(Math.abs(actual - expected) <= abs + rel * Math.abs(expected), `${actual} != ${expected}`);

  const cclose = (actual, expected, abs = VABS, rel = VREL) => { close(actual.re, expected.re, abs, rel); close(actual.im, expected.im, abs, rel); };

  function makeCircuit(definition) {
    const components = definition.map(item => ({ id: item.id, type: item.type, props: { ref: item.id, ...item.props } }));
    components.push({ id: "G1", type: "GND", props: { ref: "GND" } });
    const nets = new Map([["0", [{ componentId: "G1", pin: 0 }]]]);
    for (const item of definition) item.nets.forEach((net, pin) => {
      if (!nets.has(net)) nets.set(net, []);
      nets.get(net).push({ componentId: item.id, pin });
    });
    const junctions = [...nets].map(([net], index) => ({ id: `J${index}`, x: index * 20, y: 0 }));
    const junctionByNet = new Map([...nets.keys()].map((net, index) => [net, junctions[index].id]));
    const wires = [];
    for (const [net, endpoints] of nets) for (const endpoint of endpoints) wires.push({ id: `W${wires.length + 1}`, a: endpoint, b: { junctionId: junctionByNet.get(net) } });
    return { version: 1, geometryVersion: 2, components, wires, junctions };
  }

  const voltage = (id, dc = 0, acMagnitude = 0, acPhase = 0, amplitude = 0) => ({
    id, type: "V", props: { mode: amplitude ? "SIN" : "DC", dc: String(dc), offset: "0", amplitude: String(amplitude), frequency: "1k", phase: "0", acMagnitude: String(acMagnitude), acPhase: String(acPhase) },
  });

  const resistor = (id, value) => ({ id, type: "R", props: { value: String(value) } });

  const ideal = { id: "U1", type: "OPAMP_IDEAL", props: {} };

  function follower({ dc = 1, ac = 0, phase = 0, amplitude = 0, load = 1000, legacy = false } = {}) {
    return makeCircuit([
      { ...voltage("V1", dc, ac, phase, amplitude), nets: ["in", "0"] },
      { ...ideal, type: legacy ? "OPAMP" : "OPAMP_IDEAL", props: legacy ? { gain: "100k" } : {}, nets: ["in", "out", "out"] },
      { ...resistor("RL", load), nets: ["out", "0"] },
    ]);
  }

  function inverting({ dc = 1, ac = 0, phase = 0, amplitude = 0, load = 1000 } = {}) {
    return makeCircuit([
      { ...voltage("V1", dc, ac, phase, amplitude), nets: ["vin", "0"] },
      { ...resistor("RIN", 10000), nets: ["vin", "sum"] },
      { ...resistor("RF", 20000), nets: ["out", "sum"] },
      { ...ideal, nets: ["0", "sum", "out"] }, { ...resistor("RL", load), nets: ["out", "0"] },
    ]);
  }

  function noninverting({ dc = 1, ac = 0, phase = 0, amplitude = 0, load = 1000 } = {}) {
    return makeCircuit([
      { ...voltage("V1", dc, ac, phase, amplitude), nets: ["in", "0"] },
      { ...resistor("RG", 10000), nets: ["sum", "0"] }, { ...resistor("RF", 20000), nets: ["out", "sum"] },
      { ...ideal, nets: ["in", "sum", "out"] }, { ...resistor("RL", load), nets: ["out", "0"] },
    ]);
  }

  function summing({ transient = false } = {}) {
    return makeCircuit([
      { ...voltage("V1", transient ? 0 : 1, transient ? 0 : 1, 0, transient ? 1 : 0), nets: ["v1", "0"] },
      { ...voltage("V2", transient ? 0 : 2, transient ? 2 : 2, transient ? 0 : 90, transient ? 2 : 0), nets: ["v2", "0"] },
      { ...resistor("R1", 10000), nets: ["v1", "sum"] }, { ...resistor("R2", 20000), nets: ["v2", "sum"] },
      { ...resistor("RF", 10000), nets: ["out", "sum"] }, { ...ideal, nets: ["0", "sum", "out"] },
      { ...resistor("RL", 1000), nets: ["out", "0"] },
    ]);
  }

  const node = (result, id, pin = 0) => result.points[0].nodeVoltages[result.topology.nodeIdByPin[`${id}:${pin}`]];

  const pointNode = (result, point, id, pin = 0) => point.nodeVoltages[result.topology.nodeIdByPin[`${id}:${pin}`]];

  test("type, defaults and geometry are explicit without gain", () => {
    assert.equal(pinCount("OPAMP_IDEAL"), 3);
    assert.deepEqual(componentDefaults("OPAMP_IDEAL", 2), { ref: "U2" });
    assert.deepEqual(localPin("OPAMP_IDEAL", 0), { x: -40, y: -20 });
    assert.deepEqual(localPin("OPAMP_IDEAL", 1), { x: -40, y: 20 });
    assert.deepEqual(localPin("OPAMP_IDEAL", 2), { x: 40, y: 0 });
  });

  for (const [name, circuit, expectedV, expectedI] of [
    ["follower", follower(), 1, -0.001], ["inverting", inverting(), -2, 0.0021],
    ["noninverting", noninverting(), 3, -0.0031], ["summing", summing(), -2, 0.0022],
  ]) test(`DC ${name}: ideal constraint, branch sign and output KCL`, () => {
    const result = simulateDC(circuit), output = node(result, "U1", 2), plus = node(result, "U1", 0), minus = node(result, "U1", 1);
    close(output, expectedV); close(plus, minus); close(result.points[0].componentCurrents.U1, expectedI, IABS, IREL);
    const outgoing = circuit.components.filter(c => c.type === "R").reduce((sum, c) => {
      const n0 = node(result, c.id, 0), n1 = node(result, c.id, 1);
      if (Math.abs(n0 - output) <= VABS) return sum + result.points[0].componentCurrents[c.id];
      if (Math.abs(n1 - output) <= VABS) return sum - result.points[0].componentCurrents[c.id];
      return sum;
    }, 0);
    close(outgoing + result.points[0].componentCurrents.U1, 0, 1e-10, 1e-8);
  });

  test("load change preserves follower voltage and recomputes branch current", () => {
    const result = simulateDC(follower({ load: 2000 }));
    close(node(result, "U1", 2), 1); close(result.points[0].componentCurrents.U1, -0.0005, IABS, IREL);
    const high = simulateDC(follower({ dc: 10 })); close(node(high, "U1", 2), 10); close(high.points[0].componentCurrents.U1, -0.01, IABS, IREL);
  });

  test("ideal input pins draw zero current", () => {
    const circuit = makeCircuit([
      { ...voltage("V1", 1), nets: ["vin", "0"] }, { ...resistor("RIN", 10000), nets: ["vin", "plus"] },
      { ...ideal, nets: ["plus", "out", "out"] }, { ...resistor("RL", 1000), nets: ["out", "0"] },
    ]);
    const result = simulateDC(circuit);
    close(node(result, "U1", 0), 1); close(result.points[0].componentCurrents.RIN, 0, 1e-12, 0);
  });

  for (const frequency of [10, 1000, 100000]) for (const [name, circuit, gain] of [
    ["follower", follower({ dc: 0, ac: 1, phase: 30 }), 1],
    ["inverting", inverting({ dc: 0, ac: 1, phase: 30 }), -2],
    ["noninverting", noninverting({ dc: 0, ac: 1, phase: 30 }), 3],
  ]) test(`AC ${name} ${frequency} Hz is frequency-independent ideal gain`, () => {
    const result = simulateACAtFrequency(circuit, frequency);
    const input = node(result, "V1", 0), output = node(result, "U1", 2);
    cclose(output, { re: input.re * gain, im: input.im * gain });
    cclose(node(result, "U1", 0), node(result, "U1", 1));
  });

  test("AC summing produces -1-j1 V", () => {
    const result = simulateACAtFrequency(summing(), 1000);
    cclose(node(result, "U1", 2), { re: -1, im: -1 });
  });

  for (const step of ["10u", "5u"]) for (const [name, circuit, factor] of [
    ["follower", follower({ dc: 0, amplitude: 1 }), t => Math.sin(2 * Math.PI * 1000 * t)],
    ["inverting", inverting({ dc: 0, amplitude: 1 }), t => -2 * Math.sin(2 * Math.PI * 1000 * t)],
    ["noninverting", noninverting({ dc: 0, amplitude: 1 }), t => 3 * Math.sin(2 * Math.PI * 1000 * t)],
    ["summing", summing({ transient: true }), t => -2 * Math.sin(2 * Math.PI * 1000 * t)],
  ]) test(`transient ${name} ${step}: no delay, settling or clipping`, () => {
    const result = simulateTransient(circuit, { start: "0", end: "2m", step });
    result.points.forEach((point, index) => close(pointNode(result, point, "U1", 2), factor(result.xValues[index])));
  });

  test("contradictory and non-unique ideal circuits fail explicitly", () => {
    const contradiction = makeCircuit([
      { ...voltage("VP", 1), nets: ["plus", "0"] }, { ...voltage("VM", 0), nets: ["minus", "0"] },
      { ...ideal, nets: ["plus", "minus", "out"] }, { ...resistor("RL", 1000), nets: ["out", "0"] },
    ]);
    assert.throws(() => simulateDC(contradiction), error => error.code === "SINGULAR" || error.code === "IDEAL_CONSTRAINT_CONFLICT");
    const nonUnique = makeCircuit([{ ...ideal, nets: ["0", "0", "out"] }, { ...resistor("RL", 1000), nets: ["out", "0"] }]);
    assert.throws(() => simulateDC(nonUnique), error => error.code === "SINGULAR");
  });

  test("positive feedback still has the algebraic solution 0 V", () => {
    const circuit = makeCircuit([
      { ...voltage("V1", 1), nets: ["vin", "0"] }, { ...resistor("RIN", 10000), nets: ["vin", "out"] },
      { ...ideal, nets: ["out", "0", "out"] }, { ...resistor("RL", 1000), nets: ["out", "0"] },
    ]);
    close(node(simulateDC(circuit), "U1", 2), 0);
  });

  test("legacy finite-gain follower remains distinct", () => {
    const result = simulateDC(follower({ legacy: true }));
    close(node(result, "U1", 2), 100000 / 100001, 1e-12, 1e-10);
    assert.notEqual(node(result, "U1", 2), 1);
    assert.equal(result.topology.nodeIdByPin["U1:1"], result.topology.nodeIdByPin["U1:2"]);
  });

  test("JSON and CSV preserve explicit type, probe color and SI branch sign", () => {
    const circuit = follower();
    const probes = [{ kind: "current", componentId: "U1", key: "I:U1", label: "I(U1, 출력→내부 기준 GND)", color: "#80bfff" }];
    const text = serializeProject({ title: "ideal", subtitle: "MNA", circuit, settings: { analysis: "dc", phasorFrequency: "1000" }, probes });
    const restored = deserializeProject(text);
    assert.equal(restored.circuit.components.find(c => c.id === "U1").type, "OPAMP_IDEAL");
    assert.equal(restored.circuit.components.find(c => c.id === "U1").props.gain, undefined);
    assert.deepEqual(restored.probes, probes);
    assert.equal(deserializeCircuit(serializeCircuit(circuit)).components.find(c => c.id === "U1").type, "OPAMP_IDEAL");
    const result = simulateDC(restored.circuit), raw = result.points.map(point => point.componentCurrents.U1);
    assert.deepEqual(parseCSV(buildResultsCSV(result, [{ probe: probes[0], raw }])), [["operating_point", "I(U1, 출력→내부 기준 GND)_A"], ["0", "-0.001"]]);
  });

  test("follower project fixture loads and is numerically exact", () => {
    const project = deserializeProject(readFileSync(new URL("../../fixtures/opamp-ideal-follower.json", import.meta.url), "utf8"));
    const result = simulateDC(project.circuit);
    close(node(result, "U1", 2), 1);
    close(result.points[0].componentCurrents.U1, -0.001, IABS, IREL);
    assert.equal(project.probes.length, 2);
  });

  test("contradiction project fixture fails instead of returning a result", () => {
    const project = deserializeProject(readFileSync(new URL("../../fixtures/opamp-ideal-contradiction.json", import.meta.url), "utf8"));
    assert.throws(() => simulateDC(project.circuit), error => error.code === "SINGULAR" || error.code === "IDEAL_CONSTRAINT_CONFLICT");
  });

});

describe("ideal op amp branch current and KCL", () => {
  const contract = JSON.parse(readFileSync(new URL("../../fixtures/opamp-ideal-contract.json", import.meta.url), "utf8"));

  const T = contract.tolerances;

  const close = (actual, expected, abs = T.voltageAbsV, rel = T.voltageRel) => assert.ok(
    Math.abs(actual - expected) <= abs + rel * Math.abs(expected), `${actual} != ${expected}`,
  );

  const cclose = (actual, expected, abs = T.voltageAbsV, rel = T.voltageRel) => {
    close(actual.re, expected.re, abs, rel); close(actual.im, expected.im, abs, rel);
  };

  const cadd = (a, b) => ({ re: a.re + b.re, im: a.im + b.im });

  const cscale = (a, scale) => ({ re: a.re * scale, im: a.im * scale });

  function makeCircuit(definition) {
    const components = definition.map((item, index) => ({
      id: item.id, type: item.type, x: 80 + index * 80, y: 120, rotation: 0,
      props: { ref: item.id, ...item.props },
    }));
    components.push({ id: "G1", type: "GND", x: 80, y: 300, rotation: 0, props: { ref: "GND" } });
    const nets = new Map([["0", [{ componentId: "G1", pin: 0 }]]]);
    const fixtureNetByPin = {};
    for (const item of definition) item.nets.forEach((net, pin) => {
      fixtureNetByPin[`${item.id}:${pin}`] = net;
      if (!nets.has(net)) nets.set(net, []);
      nets.get(net).push({ componentId: item.id, pin });
    });
    fixtureNetByPin["G1:0"] = "0";
    const junctions = [...nets].map(([net], index) => ({ id: `J${index}`, x: index * 20, y: 0 }));
    const junctionByNet = new Map([...nets.keys()].map((net, index) => [net, junctions[index].id]));
    const wires = [];
    for (const [net, endpoints] of nets) for (const endpoint of endpoints) {
      wires.push({ id: `W${wires.length + 1}`, a: endpoint, b: { junctionId: junctionByNet.get(net) } });
    }
    return { circuit: { version: 1, geometryVersion: 2, components, wires, junctions }, fixtureNetByPin };
  }

  const voltage = (id, { dc = 0, ac = 0, acPhase = 0, amplitude = 0 } = {}) => ({
    id, type: "V", props: {
      mode: amplitude ? "SIN" : "DC", dc: String(dc), offset: "0", amplitude: String(amplitude),
      frequency: "1k", phase: "0", acMagnitude: String(ac), acPhase: String(acPhase),
    },
  });

  const resistor = (id, value) => ({ id, type: "R", props: { value: String(value) } });

  const ideal = { id: "U1", type: "OPAMP_IDEAL", props: {} };

  function follower({ load = 1000, dc = 1, ac = 0, acPhase = 0, amplitude = 0, decoy = false } = {}) {
    const parts = [
      { ...voltage("V1", { dc, ac, acPhase, amplitude }), nets: ["in", "0"] },
      { ...ideal, nets: ["in", "out", "out"] }, { ...resistor("RL", load), nets: ["out", "0"] },
    ];
    if (decoy) parts.push(
      { ...voltage("VDECOY", { dc: 1 }), nets: ["same-voltage-other-net", "0"] },
      { ...resistor("RDECOY", 1000), nets: ["same-voltage-other-net", "0"] },
    );
    return makeCircuit(parts);
  }

  function inverting({ load = 1000, dc = 1, ac = 0, acPhase = 0, amplitude = 0 } = {}) {
    return makeCircuit([
      { ...voltage("V1", { dc, ac, acPhase, amplitude }), nets: ["vin", "0"] },
      { ...resistor("RIN", 10000), nets: ["vin", "sum"] }, { ...resistor("RF", 20000), nets: ["out", "sum"] },
      { ...ideal, nets: ["0", "sum", "out"] }, { ...resistor("RL", load), nets: ["out", "0"] },
    ]);
  }

  function noninverting({ load = 1000, dc = 1, ac = 0, acPhase = 0, amplitude = 0 } = {}) {
    return makeCircuit([
      { ...voltage("V1", { dc, ac, acPhase, amplitude }), nets: ["in", "0"] },
      { ...resistor("RG", 10000), nets: ["sum", "0"] }, { ...resistor("RF", 20000), nets: ["out", "sum"] },
      { ...ideal, nets: ["in", "sum", "out"] }, { ...resistor("RL", load), nets: ["out", "0"] },
    ]);
  }

  function summing({ load = 1000, transient = false } = {}) {
    return makeCircuit([
      { ...voltage("V1", transient ? { amplitude: 1 } : { dc: 1, ac: 1 }), nets: ["v1", "0"] },
      { ...voltage("V2", transient ? { amplitude: 2 } : { dc: 2, ac: 2, acPhase: 90 }), nets: ["v2", "0"] },
      { ...resistor("R1", 10000), nets: ["v1", "sum"] }, { ...resistor("R2", 20000), nets: ["v2", "sum"] },
      { ...resistor("RF", 10000), nets: ["out", "sum"] }, { ...ideal, nets: ["0", "sum", "out"] },
      { ...resistor("RL", load), nets: ["out", "0"] },
    ]);
  }

  function seriesInputFollower({ dc = 1, ac = 0, acPhase = 0, amplitude = 0 } = {}) {
    return makeCircuit([
      { ...voltage("V1", { dc, ac, acPhase, amplitude }), nets: ["vin", "0"] },
      { ...resistor("RPLUS", 10000), nets: ["vin", "plus"] },
      { ...resistor("RMINUS", 20000), nets: ["out", "minus"] },
      { ...ideal, nets: ["plus", "minus", "out"] }, { ...resistor("RL", 1000), nets: ["out", "0"] },
    ]);
  }

  const builders = { follower, inverting, noninverting, summing };

  const firstPoint = result => result.points[0];

  const nodeId = (result, id, pin) => result.topology.nodeIdByPin[`${id}:${pin}`];

  const voltageAt = (result, point, id, pin) => point.nodeVoltages[nodeId(result, id, pin)];

  function externalCurrentAtNode(bundle, result, point, targetNode) {
    let total = typeof point.componentCurrents.U1 === "number" ? 0 : { re: 0, im: 0 };
    for (const component of bundle.circuit.components) {
      if (component.type === "GND" || component.type === "OPAMP_IDEAL") continue;
      const current = point.componentCurrents[component.id];
      if (current === undefined) continue;
      for (const pin of [0, 1]) if (nodeId(result, component.id, pin) === targetNode) {
        const signed = pin === 0 ? current : (typeof current === "number" ? -current : cscale(current, -1));
        total = typeof total === "number" ? total + signed : cadd(total, signed);
      }
    }
    return total;
  }

  function assertOutputKcl(bundle, result, point) {
    const external = externalCurrentAtNode(bundle, result, point, nodeId(result, "U1", 2));
    const op = point.componentCurrents.U1;
    if (typeof op === "number") close(external + op, 0, T.outputKclAbsA, T.outputKclRel);
    else cclose(cadd(external, op), { re: 0, im: 0 }, T.outputKclAbsA, T.outputKclRel);
  }

  function expectedBranchCurrent(name, input, output, load) {
    const scale = (value, divisor) => typeof value === "number" ? value / divisor : cscale(value, 1 / divisor);
    let outgoing = scale(output, load);
    if (name === "inverting") outgoing = typeof output === "number" ? outgoing + output / 20000 : cadd(outgoing, scale(output, 20000));
    if (name === "noninverting") {
      const difference = typeof output === "number" ? output - input : cadd(output, cscale(input, -1));
      outgoing = typeof output === "number" ? outgoing + difference / 20000 : cadd(outgoing, scale(difference, 20000));
    }
    if (name === "summing") outgoing = typeof output === "number" ? outgoing + output / 10000 : cadd(outgoing, scale(output, 10000));
    return typeof outgoing === "number" ? -outgoing : cscale(outgoing, -1);
  }

  test("DC KCL selects connected node IDs, not equal voltages", () => {
    const bundle = follower({ decoy: true });
    const result = simulateDC(bundle.circuit), point = firstPoint(result);
    assert.equal(voltageAt(result, point, "U1", 2), voltageAt(result, point, "RDECOY", 0));
    assert.notEqual(nodeId(result, "U1", 2), nodeId(result, "RDECOY", 0));
    assertOutputKcl(bundle, result, point);
    close(point.componentCurrents.U1, -0.001, T.currentAbsA, T.currentRel);
  });

  test("both DC input pins draw zero current through independent series branches", () => {
    const bundle = seriesInputFollower();
    const result = simulateDC(bundle.circuit), point = firstPoint(result);
    close(point.componentCurrents.RPLUS, 0, T.inputCurrentAbsA, 0);
    close(point.componentCurrents.RMINUS, 0, T.inputCurrentAbsA, 0);
    close(voltageAt(result, point, "U1", 0), voltageAt(result, point, "U1", 1));
    assertOutputKcl(bundle, result, point);
  });

  test("all four normal circuits independently recompute RL=2k branch current", () => {
    for (const expected of contract.normalCircuits) {
      const bundle = builders[expected.name]({ load: 2000 });
      const result = simulateDC(bundle.circuit), point = firstPoint(result);
      close(point.componentCurrents.U1, expected.load2kCurrentA, T.currentAbsA, T.currentRel);
      const output = voltageAt(result, point, "U1", 2);
      const input = expected.name === "summing" ? null : voltageAt(result, point, "V1", 0);
      close(point.componentCurrents.U1, expectedBranchCurrent(expected.name, input, output, 2000), T.currentAbsA, T.currentRel);
      assertOutputKcl(bundle, result, point);
    }
  });

  for (const frequency of contract.ac.frequenciesHz) test(`AC currents, KCL, phase and RMS at ${frequency} Hz`, () => {
    const independentInput = phasorFromPolar(contract.ac.inputPeakV, contract.ac.inputPhaseDegrees);
    for (const expected of contract.normalCircuits.filter(item => item.name !== "summing")) {
      const bundle = builders[expected.name]({ dc: 0, ac: 1, acPhase: 30 });
      const result = simulateACAtFrequency(bundle.circuit, frequency), point = firstPoint(result);
      const input = voltageAt(result, point, "V1", 0), output = voltageAt(result, point, "U1", 2);
      cclose(input, independentInput);
      cclose(output, cscale(independentInput, expected.gain));
      cclose(point.componentCurrents.U1, expectedBranchCurrent(expected.name, independentInput, cscale(independentInput, expected.gain), 1000), T.currentAbsA, T.currentRel);
      cclose(voltageAt(result, point, "U1", 0), voltageAt(result, point, "U1", 1));
      assertOutputKcl(bundle, result, point);
      const polar = phasorPolar(output), expectedPhase = expected.gain < 0 ? -150 : 30;
      close(Math.abs(wrapPhaseDifference(polar.angleDegrees, expectedPhase)), 0, T.phaseDegrees, 0);
      close(polar.magnitude, Math.abs(expected.gain));
      close(peakToRms(polar.magnitude), Math.abs(expected.gain) / Math.sqrt(2));
    }
    const sumBundle = summing(), sumResult = simulateACAtFrequency(sumBundle.circuit, frequency), sumPoint = firstPoint(sumResult);
    const sumOutput = voltageAt(sumResult, sumPoint, "U1", 2);
    cclose(sumOutput, { re: contract.ac.summingOutput.reV, im: contract.ac.summingOutput.imV });
    cclose(sumPoint.componentCurrents.U1, expectedBranchCurrent("summing", null, sumOutput, 1000), T.currentAbsA, T.currentRel);
    cclose(voltageAt(sumResult, sumPoint, "U1", 0), voltageAt(sumResult, sumPoint, "U1", 1));
    assertOutputKcl(sumBundle, sumResult, sumPoint);
  });

  test("both AC input series branches are zero", () => {
    const bundle = seriesInputFollower({ dc: 0, ac: 1, acPhase: 30 });
    const result = simulateACAtFrequency(bundle.circuit, 1000), point = firstPoint(result);
    cclose(point.componentCurrents.RPLUS, { re: 0, im: 0 }, T.inputCurrentAbsA, 0);
    cclose(point.componentCurrents.RMINUS, { re: 0, im: 0 }, T.inputCurrentAbsA, 0);
    assertOutputKcl(bundle, result, point);
  });

  for (const step of contract.transient.stepsSeconds) test(`transient branch current and KCL at every sample, dt=${step}`, () => {
    const cases = [
      ["follower", follower({ dc: 0, amplitude: 1 }), t => Math.sin(2 * Math.PI * 1000 * t)],
      ["inverting", inverting({ dc: 0, amplitude: 1 }), t => -2 * Math.sin(2 * Math.PI * 1000 * t)],
      ["noninverting", noninverting({ dc: 0, amplitude: 1 }), t => 3 * Math.sin(2 * Math.PI * 1000 * t)],
      ["summing", summing({ transient: true }), t => -2 * Math.sin(2 * Math.PI * 1000 * t)],
    ];
    for (const [name, bundle, expectedOutput] of cases) {
      const result = simulateTransient(bundle.circuit, { start: 0, end: contract.transient.endSeconds, step });
      result.points.forEach((point, index) => {
        const time = result.xValues[index], output = expectedOutput(time);
        const input = name === "summing" ? null : Math.sin(2 * Math.PI * 1000 * time);
        close(voltageAt(result, point, "U1", 2), output);
        close(voltageAt(result, point, "U1", 0), voltageAt(result, point, "U1", 1));
        close(point.componentCurrents.U1, expectedBranchCurrent(name, input, output, 1000), T.currentAbsA, T.currentRel);
        assertOutputKcl(bundle, result, point);
      });
    }
  });

  test("both transient input series branches remain zero", () => {
    const bundle = seriesInputFollower({ dc: 0, amplitude: 1 });
    const result = simulateTransient(bundle.circuit, { start: 0, end: "2m", step: "10u" });
    for (const point of result.points) {
      close(point.componentCurrents.RPLUS, 0, T.inputCurrentAbsA, 0);
      close(point.componentCurrents.RMINUS, 0, T.inputCurrentAbsA, 0);
      close(voltageAt(result, point, "U1", 0), voltageAt(result, point, "U1", 1));
      assertOutputKcl(bundle, result, point);
    }
  });

  test("ideal op amp plus redundant capacitors rejects the initial derivative", () => {
    const bundle = makeCircuit([
      { id: "C1", type: "C", props: { value: "1u", ic: "1" }, nets: ["n", "0"] },
      { id: "C2", type: "C", props: { value: "2u", ic: "1" }, nets: ["n", "0"] },
      { ...resistor("R1", 1000), nets: ["n", "0"] },
      // A well-posed follower: both inputs are on a driven net, so the only reason to stop is the redundant C pair.
      { ...ideal, nets: ["n", "out", "out"] }, { ...resistor("RL", 1000), nets: ["out", "0"] },
    ]);
    assert.throws(
      () => simulateTransient(bundle.circuit, { start: 0, end: "10u", step: "10u" }),
      error => error.code === "INITIAL_DERIVATIVE_UNSUPPORTED",
    );
  });

  test("rotation, clone and project snapshots preserve ideal type and references", () => {
    const bundle = follower();
    const original = bundle.circuit.components.find(component => component.id === "U1");
    original.x = 100; original.y = 140; original.rotation = 90;
    assert.deepEqual(pinPosition(original, 0, 2), { x: 120, y: 100 });
    assert.deepEqual(pinPosition(original, 1, 2), { x: 80, y: 100 });
    assert.deepEqual(pinPosition(original, 2, 2), { x: 100, y: 180 });
    const clone = cloneSelectedComponent(bundle.circuit, "U1");
    assert.equal(clone.id, "U2"); assert.equal(clone.type, "OPAMP_IDEAL"); assert.equal(clone.rotation, 90);
    assert.equal(clone.props.gain, undefined);
    const probes = [
      { kind: "voltage", componentId: "U1", pin: 2, wireId: "W5", key: "V:U1:2", label: "V(U1.3)", color: "#80bfff" },
      { kind: "current", componentId: "U1", key: "I:U1", label: "I(U1, 출력→내부 기준 GND)", color: "#f5bc79" },
    ];
    const before = serializeProject({ circuit: bundle.circuit, settings: { analysis: "dc" }, probes });
    const editedCircuit = { ...bundle.circuit, components: [...bundle.circuit.components, clone] };
    const after = serializeProject({ circuit: editedCircuit, settings: { analysis: "dc" }, probes });
    const undo = deserializeProject(before), redo = deserializeProject(after);
    assert.equal(undo.circuit.components.some(component => component.id === "U2"), false);
    assert.equal(redo.circuit.components.find(component => component.id === "U2").type, "OPAMP_IDEAL");
    assert.deepEqual(undo.probes, probes); assert.deepEqual(redo.probes, probes);
    assert.ok(undo.circuit.wires.some(wire => wire.id === "W5" && wire.a.componentId === "U1"));
  });

  test("invalid ideal pin, floating ideal and unknown future type reject explicitly", () => {
    const valid = follower().circuit;
    const invalidPin = structuredClone(valid);
    invalidPin.wires[0].a = { componentId: "U1", pin: 3 };
    assert.throws(() => deserializeCircuit(serializeCircuit(invalidPin)), error => error.code === "BAD_WIRE");
    const floating = structuredClone(valid);
    floating.wires = floating.wires.filter(wire => !["U1", "RL"].includes(wire.a.componentId) && !["U1", "RL"].includes(wire.b.componentId));
    assert.throws(() => simulateDC(floating), error => error.code === "FLOATING_NODE");
    const future = structuredClone(valid);
    future.components.find(component => component.id === "U1").type = "OPAMP_REAL_EDU";
    assert.throws(() => deserializeCircuit(serializeCircuit(future)), error => error.code === "UNKNOWN_COMPONENT");
  });
});

describe("ideal op amp isolation", () => {
  const fixture = JSON.parse(readFileSync(new URL("../../fixtures/opamp-ideal-isolation.json", import.meta.url), "utf8"));

  const tolerances = fixture.tolerances;

  function close(actual, expected, abs, rel) {
    assert.ok(Number.isFinite(actual), `expected a finite value, received ${actual}`);
    assert.ok(Math.abs(actual - expected) <= abs + rel * Math.abs(expected), `${actual} != ${expected}`);
  }

  function makeCircuit(definition) {
    const components = definition.map((part, index) => ({
      id: part.id,
      type: part.type,
      x: 80 + index * 80,
      y: 120,
      rotation: 0,
      props: { ref: part.id, ...part.props },
    }));
    components.push({ id: "G1", type: "GND", x: 80, y: 300, rotation: 0, props: { ref: "GND" } });
    const endpointsByNet = new Map([["0", [{ componentId: "G1", pin: 0 }]]]);
    for (const part of definition) part.nets.forEach((net, pin) => {
      if (!endpointsByNet.has(net)) endpointsByNet.set(net, []);
      endpointsByNet.get(net).push({ componentId: part.id, pin });
    });
    const junctions = [...endpointsByNet.keys()].map((net, index) => ({ id: `J${index}`, x: index * 20, y: 0, net }));
    const junctionIdByNet = new Map(junctions.map(({ id, net }) => [net, id]));
    const wires = [];
    for (const [net, endpoints] of endpointsByNet) for (const endpoint of endpoints) {
      wires.push({ id: `W${wires.length + 1}`, a: endpoint, b: { junctionId: junctionIdByNet.get(net) } });
    }
    return {
      version: 1,
      geometryVersion: 2,
      components,
      wires,
      junctions: junctions.map(({ net: _net, ...junction }) => junction),
    };
  }

  function captureExpectedError(circuit, expectedCode) {
    let observed;
    try {
      const result = simulateTransient(circuit, fixture.analysis);
      observed = { returnedResult: true, points: result.points.length };
    } catch (error) {
      observed = { returnedResult: false, code: error.code, message: error.message };
    }
    assert.equal(observed.returnedResult, false, "an explicit failure was required; a normal 0 V/0 A result is forbidden");
    assert.equal(observed.code, expectedCode);
    return observed;
  }

  function nodeVoltage(result, point, componentId, pin) {
    return point.nodeVoltages[result.topology.nodeIdByPin[`${componentId}:${pin}`]];
  }

  for (const scenario of fixture.cases) test(`${scenario.id}`, () => {
    const circuit = makeCircuit(scenario.parts);
    if (scenario.expectedErrorCode) {
      const observed = captureExpectedError(circuit, scenario.expectedErrorCode);
      return;
    }

    const result = simulateTransient(circuit, fixture.analysis);
    const expected = scenario.expected;
    assert.deepEqual(result.xValues, expected.timesS);
    assert.equal(result.points.length, 2);
    const observed = result.points.map((point, index) => {
      const n = nodeVoltage(result, point, "U1", 0);
      const out = nodeVoltage(result, point, "U1", 2);
      const plusKcl = point.componentCurrents.R1 + point.componentCurrents.C1;
      const outputKcl = point.componentCurrents.RL + point.componentCurrents.U1;
      close(n, expected.nodeVoltageV[index], tolerances.voltageAbsV, tolerances.voltageRel);
      close(out, expected.nodeVoltageV[index], tolerances.voltageAbsV, tolerances.voltageRel);
      close(n, out, tolerances.voltageAbsV, tolerances.voltageRel);
      close(point.componentCurrents.R1, expected.R1CurrentA[index], tolerances.currentAbsA, tolerances.currentRel);
      close(point.componentCurrents.RL, expected.RLCurrentA[index], tolerances.currentAbsA, tolerances.currentRel);
      close(point.componentCurrents.U1, expected.outputCurrentA[index], tolerances.currentAbsA, tolerances.currentRel);
      close(point.componentCurrents.C1, expected.C1CurrentA[index], tolerances.currentAbsA, tolerances.currentRel);
      close(plusKcl, 0, tolerances.inputCurrentAbsA, 0);
      close(outputKcl, 0, tolerances.outputKclAbsA, tolerances.outputKclRel);
      return {
        timeS: result.xValues[index],
        nV: n,
        outV: out,
        R1A: point.componentCurrents.R1,
        RLA: point.componentCurrents.RL,
        U1A: point.componentCurrents.U1,
        C1A: point.componentCurrents.C1,
        plusPinKclA: plusKcl,
        outputKclA: outputKcl,
      };
    });
  });
});
