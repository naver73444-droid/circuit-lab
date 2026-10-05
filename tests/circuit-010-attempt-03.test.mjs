import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { simulateTransient } from "../src/circuit-engine.js";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/opamp-ideal-attempt-03-isolation.json", import.meta.url), "utf8"));
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

for (const scenario of fixture.cases) test(`CIRCUIT-010 attempt-03 ${scenario.id}`, () => {
  const circuit = makeCircuit(scenario.parts);
  if (scenario.expectedErrorCode) {
    const observed = captureExpectedError(circuit, scenario.expectedErrorCode);
    console.log(JSON.stringify({ case: scenario.id, expectedCode: scenario.expectedErrorCode, observed }));
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
  console.log(JSON.stringify({ case: scenario.id, expected, observed }));
});
