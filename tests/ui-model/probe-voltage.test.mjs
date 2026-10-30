// Voltage across a part (V probe on the part's body): pin 1 − pin 2 from DC and AC results, saved in project files, and found by the
// probe-removal target of the part.
import test from "node:test";
import assert from "node:assert/strict";
import { voltageProbeNodes, voltageAt, acrossProbeKey, isAcrossProbe } from "../../src/probe-voltage.js";
import { simulateDC, simulateACAtFrequency } from "../../src/circuit-engine.js";
import { cloneExample } from "../../src/examples.js";
import { deserializeProject, serializeProject } from "../../src/project-format.js";
import { probeKeysForTarget } from "../../src/ui-model.js";

const across = (componentId) => ({ key: acrossProbeKey(componentId), kind: "voltage", componentId, across: true, wireId: null, label: `V(${componentId})`, color: "#80bfff" });

test("across a part: DC divider 10 V → V(R1) = V(R2) = 5 V with + at pin 1; a node probe is unchanged", () => {
  const { circuit } = cloneExample("divider"), result = simulateDC(circuit);
  for (const id of ["R1", "R2"]) assert.equal(voltageAt(result.points[0].nodeVoltages, voltageProbeNodes(result.topology, across(id))), 5);
  assert.equal(voltageAt(result.points[0].nodeVoltages, voltageProbeNodes(result.topology, { kind: "voltage", componentId: "R2", pin: 0 })), 5);
  assert.equal(isAcrossProbe(across("R1")), true);
  assert.equal(voltageProbeNodes(result.topology, across("nope")), null);
});

test("across a part in AC: the phasors add up to the source (KVL), V_R leads V_C by 90°", () => {
  const { circuit } = cloneExample("rc-lowpass"), result = simulateACAtFrequency(circuit, "159.155");
  const v = (id) => voltageAt(result.points[0].nodeVoltages, voltageProbeNodes(result.topology, across(id)));
  const vr = v("R1"), vc = v("C1"), vs = v("V1");
  assert.ok(Math.abs(vr.re + vc.re - vs.re) < 1e-12 && Math.abs(vr.im + vc.im - vs.im) < 1e-12, "V_R + V_C = V_s");
  const lead = (Math.atan2(vr.im, vr.re) - Math.atan2(vc.im, vc.re)) * 180 / Math.PI;
  assert.ok(Math.abs(lead - 90) < 1e-6, String(lead));
});

test("project files keep a voltage across a two-pin part and refuse one on a three-pin part or with a pin", () => {
  const { circuit } = cloneExample("divider");
  const text = serializeProject({ title: "t", subtitle: "", circuit, settings: { analysis: "dc" }, probes: [across("R1")] });
  assert.deepEqual(deserializeProject(text).probes, [across("R1")]);
  const opamp = cloneExample("opamp").circuit;
  assert.throws(() => deserializeProject(serializeProject({ title: "t", subtitle: "", circuit: opamp, settings: { analysis: "dc" }, probes: [across("U1")] })), /프로브/);
  assert.throws(() => deserializeProject(serializeProject({ title: "t", subtitle: "", circuit, settings: { analysis: "dc" }, probes: [{ ...across("R1"), pin: 0 }] })), /프로브/);
});

test("the part's probe target finds its voltage-across probe as well as its current probe", () => {
  const probes = [across("R1"), { key: "I:R1", kind: "current", componentId: "R1" }, { key: "V:R1:0", kind: "voltage", componentId: "R1", pin: 0 }];
  assert.deepEqual(probeKeysForTarget(probes, { kind: "component", componentId: "R1" }), ["V:R1:across", "I:R1"]);
  assert.deepEqual(probeKeysForTarget(probes, { kind: "pin", componentId: "R1", pin: 0 }), ["V:R1:0"]);
});
