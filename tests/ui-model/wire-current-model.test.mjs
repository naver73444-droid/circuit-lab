import test from "node:test";
import assert from "node:assert/strict";
import { simulate, componentDefaults } from "../../src/circuit-engine.js";
import { examples } from "../../src/examples.js";
import { flowSampleIndex, flowSpeedClass, peakComponentCurrent, pinCurrentsInto, wireCurrents } from "../../src/wire-current-model.js";

const example = (id) => examples.find((item) => item.id === id);
const part = (id, type, props = {}) => ({ id, type, x: 0, y: 0, rotation: 0, props: { ...componentDefaults(type, 1), ...props } });
const end = (text) => (text.includes(":") ? { componentId: text.split(":")[0], pin: Number(text.split(":")[1]) } : { junctionId: text });
const wire = (id, a, b) => ({ id, a: end(a), b: end(b) });
const close = (actual, expected, label) => assert.ok(Math.abs(actual - expected) <= 1e-9 * Math.max(1, Math.abs(expected)) + 1e-12, `${label}: ${actual} != ${expected}`);

test("divider (DC): every wire carries the loop current, signs follow wire a to b", () => {
  const { circuit } = example("divider");
  const result = simulate(circuit, { analysis: "dc" });
  const { byWire, maxAbs } = wireCurrents({ circuit, componentCurrents: result.points[0].componentCurrents });
  // V1 pin 1 (+) -> R1 -> R2 -> GND, back into V1 pin 2: W1..W3 run along their a to b; W4 is declared V1.2 -> GND so it runs against it.
  close(byWire.W1.current, 5e-3, "W1");
  close(byWire.W2.current, 5e-3, "W2");
  close(byWire.W3.current, 5e-3, "W3");
  close(byWire.W4.current, -5e-3, "W4");
  for (const entry of Object.values(byWire)) assert.equal(entry.state, "flow");
  close(maxAbs, 5e-3, "max");
});

test("series RC (transient): the same current in every wire at the chosen sample, charging current decays", () => {
  const { circuit, settings } = example("rc-charge");
  const result = simulate(circuit, { analysis: "transient", ...settings });
  const at = (index) => wireCurrents({ circuit, componentCurrents: result.points[index].componentCurrents });
  const early = at(5), late = at(result.points.length - 1);
  for (const sample of [early, late]) {
    const values = ["W1", "W2", "W3"].map((id) => sample.byWire[id].current);
    close(values[1], values[0], "W2 vs W1");
    close(values[2], values[0], "W3 vs W1");
    close(sample.byWire.W4.current, -values[0], "W4 returns the current");
  }
  assert.ok(early.byWire.W2.current > late.byWire.W2.current && late.byWire.W2.current > 0);
  close(early.byWire.W2.current, result.points[5].componentCurrents.C1, "W2 = C1 current");
});

test("a node with three branches splits through junction wires", () => {
  const circuit = {
    components: [part("V1", "V", { dc: "12" }), part("R1", "R", { value: "1k" }), part("R2", "R", { value: "2k" }), part("R3", "R", { value: "4k" }), part("G1", "GND")],
    junctions: [{ id: "J1", x: 0, y: 0 }, { id: "J2", x: 0, y: 0 }],
    wires: [
      wire("Wv", "V1:0", "J1"), wire("Wa", "J1", "R1:0"), wire("Wb", "J1", "R2:0"), wire("Wc", "J1", "R3:0"),
      wire("Wa2", "R1:1", "J2"), wire("Wb2", "R2:1", "J2"), wire("Wc2", "R3:1", "J2"), wire("Wg", "J2", "G1:0"), wire("Wr", "V1:1", "G1:0"),
    ],
  };
  const result = simulate(circuit, { analysis: "dc" });
  const { byWire } = wireCurrents({ circuit, componentCurrents: result.points[0].componentCurrents });
  const [a, b, c] = [12e-3, 6e-3, 3e-3];
  close(byWire.Wa.current, a, "Wa");
  close(byWire.Wb.current, b, "Wb");
  close(byWire.Wc.current, c, "Wc");
  close(byWire.Wv.current, a + b + c, "Wv = sum of the branches");
  close(byWire.Wg.current, a + b + c, "Wg");
  close(byWire.Wa2.current, a, "Wa2");
  close(byWire.Wr.current, -(a + b + c), "Wr is declared against the current");
});

test("wires that form a loop inside one net have no defined current; the rest of the net still does", () => {
  const circuit = {
    components: [part("V1", "V", { dc: "10" }), part("R1", "R", { value: "1k" }), part("R2", "R", { value: "1k" }), part("G1", "GND")],
    junctions: [],
    wires: [
      wire("W1", "V1:0", "R1:0"),
      wire("W2", "R1:1", "R2:0"), wire("W2b", "R1:1", "R2:0"), // two wires between the same pins: the split is undefined
      wire("W3", "R2:1", "G1:0"), wire("W4", "V1:1", "G1:0"),
    ],
  };
  const result = simulate(circuit, { analysis: "dc" });
  const { byWire } = wireCurrents({ circuit, componentCurrents: result.points[0].componentCurrents });
  assert.deepEqual(byWire.W2, { current: null, state: "loop" });
  assert.deepEqual(byWire.W2b, { current: null, state: "loop" });
  close(byWire.W1.current, 5e-3, "W1");
  close(byWire.W3.current, 5e-3, "W3");
});

test("a triangle of wires among three junctions is a loop, its tail wires are not", () => {
  const circuit = {
    components: [part("V1", "V", { dc: "5" }), part("R1", "R", { value: "1k" }), part("G1", "GND")],
    junctions: [{ id: "J1", x: 0, y: 0 }, { id: "J2", x: 0, y: 0 }, { id: "J3", x: 0, y: 0 }],
    wires: [wire("Wt", "V1:0", "J1"), wire("A", "J1", "J2"), wire("B", "J2", "J3"), wire("C", "J3", "J1"), wire("Wo", "J2", "R1:0"), wire("Wg", "R1:1", "G1:0"), wire("Wr", "V1:1", "G1:0")],
  };
  const result = simulate(circuit, { analysis: "dc" });
  const { byWire } = wireCurrents({ circuit, componentCurrents: result.points[0].componentCurrents });
  for (const id of ["A", "B", "C"]) assert.equal(byWire[id].state, "loop");
  close(byWire.Wt.current, 5e-3, "Wt");
  close(byWire.Wo.current, 5e-3, "Wo");
});

test("an OP AMP output current returns through the single GND of its net", () => {
  const circuit = {
    components: [part("V1", "V", { dc: "1" }), part("U1", "OPAMP_IDEAL"), part("R1", "R", { value: "1k" }), part("G1", "GND")],
    junctions: [],
    // Follower: V1+ -> U1 pin 1; U1 pin 2 tied to the output (pin 3); the load R1 hangs on the output.
    wires: [wire("W1", "V1:0", "U1:0"), wire("W2", "U1:2", "U1:1"), wire("W3", "U1:2", "R1:0"), wire("W4", "R1:1", "G1:0"), wire("W5", "V1:1", "G1:0")],
  };
  const result = simulate(circuit, { analysis: "dc" });
  const { byWire } = wireCurrents({ circuit, componentCurrents: result.points[0].componentCurrents });
  close(byWire.W3.current, 1e-3, "output to load");
  close(byWire.W4.current, 1e-3, "load to GND");
  close(byWire.W1.current, 0, "ideal inputs draw nothing");
});

test("a net whose currents do not cancel and has no GND stays undefined", () => {
  const circuit = { components: [part("I1", "I", { dc: "1m" }), part("R1", "R", { value: "1k" })], junctions: [], wires: [wire("W1", "I1:1", "R1:0")] };
  const { byWire } = wireCurrents({ circuit, componentCurrents: { I1: 1e-3, R1: 0 } });
  assert.deepEqual(byWire.W1, { current: null, state: "unbalanced" });
});

test("a part without a solver current makes its nets unknown instead of guessing", () => {
  const circuit = { components: [part("R1", "R"), part("R2", "R"), part("G1", "GND")], junctions: [], wires: [wire("W1", "R1:1", "R2:0"), wire("W2", "R2:1", "G1:0")] };
  const { byWire } = wireCurrents({ circuit, componentCurrents: { R2: 1e-3 } });
  assert.equal(byWire.W1.state, "unknown");
  assert.equal(byWire.W2.state, "flow");
});

test("pin currents: two-pin parts enter pin 1 and leave pin 2, OP AMP only drives its output pin", () => {
  assert.deepEqual(pinCurrentsInto({ type: "R" }, 2), [2, -2]);
  assert.deepEqual(pinCurrentsInto({ type: "VCVS" }, 2), [2, -2, 0, 0]);
  assert.deepEqual(pinCurrentsInto({ type: "OPAMP" }, 2), [0, 0, 2]);
  assert.deepEqual(pinCurrentsInto({ type: "GND" }, 2), [0]);
});

test("sample choice: DC is the operating point, transient follows the cursor else the last sample, AC is not drawn", () => {
  assert.equal(flowSampleIndex(null, 0), null);
  assert.equal(flowSampleIndex({ analysis: "dc", points: [{}] }, 3), 0);
  const transient = { analysis: "transient", points: [{}, {}, {}, {}] };
  assert.equal(flowSampleIndex(transient, 1), 1);
  assert.equal(flowSampleIndex(transient, null), 3);
  assert.equal(flowSampleIndex(transient, 9), 3);
  assert.equal(flowSampleIndex({ analysis: "ac", points: [{}, {}] }, 0), null);
});

test("speed classes bucket the magnitude relative to the largest wire current", () => {
  assert.equal(flowSpeedClass(1, 1), 4);
  assert.equal(flowSpeedClass(0.2, 1), 3);
  assert.equal(flowSpeedClass(0.05, 1), 2);
  assert.equal(flowSpeedClass(0.01, 1), 1);
  assert.equal(flowSpeedClass(0.001, 1), 0);
  assert.equal(flowSpeedClass(0, 1), 0);
  assert.equal(flowSpeedClass(1e-15, 1e-15), 0);
});

test("the reference current is the peak over the whole run, so a decaying transient slows down", () => {
  const { circuit, settings } = example("rc-charge");
  const result = simulate(circuit, { analysis: "transient", ...settings });
  const peak = peakComponentCurrent(result);
  assert.ok(peak > 4e-3 && peak <= 5.1e-3, "peak is the initial charging current of about 5 mA");
  assert.equal(peakComponentCurrent(result), peak, "cached");
  const last = wireCurrents({ circuit, componentCurrents: result.points.at(-1).componentCurrents });
  assert.ok(flowSpeedClass(Math.abs(last.byWire.W2.current), Math.max(last.maxAbs, peak)) <= 1, "nearly settled: slowest class");
  const early = wireCurrents({ circuit, componentCurrents: result.points[1].componentCurrents });
  assert.equal(flowSpeedClass(Math.abs(early.byWire.W2.current), Math.max(early.maxAbs, peak)), 4, "start: fastest class");
  assert.equal(peakComponentCurrent(null), 0);
});
