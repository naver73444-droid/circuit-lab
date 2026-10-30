// Netlist text → laid-out editor circuit (netlist-import.js): the two circuits of a lab sheet (RC and RL first order), the reading rules,
// the layout (each part placed once, grounds under grounded pins, no overlapping bodies) and the MNA results against closed forms.
import test from "node:test";
import assert from "node:assert/strict";
import { parseNetlist, layoutNetlist, describePart, editorValue, inferredSettings, CLAUDE_PROMPT } from "../../../src/netlist-import.js";
import { simulateACAtFrequency, simulateDC, parseValue } from "../../../src/circuit-engine.js";
import { deserializeProject, serializeProject } from "../../../src/project-format.js";
import { bodyBox } from "../../../src/wire-router.js";

const mag = (z) => Math.hypot(z.re, z.im);
const deg = (z) => (Math.atan2(z.im, z.re) * 180) / Math.PI;
const near = (actual, expected, tolerance, label) => assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} vs ${expected}`);
const open = (text) => {
  const parsed = parseNetlist(text);
  assert.deepEqual(parsed.errors, []);
  const layout = layoutNetlist(parsed);
  // It must survive the same validation as a saved project file.
  const project = deserializeProject(serializeProject({ title: layout.title, subtitle: layout.subtitle, circuit: layout.circuit, settings: { analysis: "dc" }, probes: [] }));
  return { parsed, layout, circuit: project.circuit };
};
const nodeVoltage = (result, id, pin) => result.points[0].nodeVoltages[result.topology.nodeIdByPin[`${id}:${pin}`]];

// The two circuits of the 10/29 lab sheet, written the way the Claude prompt asks for them.
const RC = `\`\`\`spice
* RC 1차 회로 (실험 1-1)
* 신호 5Vpp 1kHz 구형파, C는 11nF와 47nF 각각
V1 in 0 PULSE(-2.5 2.5 0 1u 1u 0.5m 1m)
R1 in out 1.5kΩ
C1 out 0 11nF
.tran 5u 3m
.probe V(in) V(out)
\`\`\``;
const RL = `* RL 1차 회로 (실험 2)
* 5Vpp 10kHz 정현파
V1 in 0 SIN(0 2.5 10k) AC 2.5
L1 in mid 10mH
R1 mid 0 0.5k
.probe V(in) V(mid)`;

test("lab sheet RC: a fenced block with units reads as V1, R1, C1 and a ±2.5 V 1 kHz square wave; title, note, analysis and probes come along", () => {
  const { parsed, layout } = open(RC);
  assert.equal(parsed.title, "RC 1차 회로 (실험 1-1)");
  assert.deepEqual(parsed.description, ["신호 5Vpp 1kHz 구형파, C는 11nF와 47nF 각각"]);
  assert.deepEqual(parsed.parts.map((p) => [p.ref, p.type, p.nodes.join(" ")]), [["V1", "V", "in 0"], ["R1", "R", "in out"], ["C1", "C", "out 0"]]);
  assert.deepEqual(parsed.parts[0].props, { mode: "PULSE", pulseV1: "-2.5", pulseV2: "2.5", pulseDelay: "0", pulseRise: "1u", pulseFall: "1u", pulseWidth: "0.5m", pulsePeriod: "1m" });
  assert.equal(parsed.parts[1].props.value, "1.5k");
  assert.equal(parsed.parts[2].props.value, "11n");
  assert.deepEqual(layout.settings, { analysis: "transient", step: "5u", end: "3m", start: "0" });
  assert.deepEqual(layout.probes, [{ kind: "voltage", componentId: "V1", pin: 0 }, { kind: "voltage", componentId: "R1", pin: 1 }]);
  assert.equal(describePart(parsed.parts[0]), "V1  전압원  in – 접지  펄스 -2.5 V ↔ 2.5 V, 주기 1 ms (1 kHz), 폭 500 µs");
  assert.equal(describePart(parsed.parts[2]), "C1  커패시터  out – 접지  11 nF");
});

test("lab sheet RC layout: source at the left with + up, R on the top row, C under its node, a ground under each grounded pin; DC steady state is right", () => {
  const { circuit } = open(RC);
  const at = (id) => circuit.components.find((c) => c.id === id);
  assert.ok(at("V1").x < at("R1").x && at("R1").x < at("C1").x, "left to right: V1, R1, C1");
  assert.equal(at("V1").rotation, 90); assert.equal(at("C1").rotation, 90); assert.equal(at("R1").rotation, 0);
  assert.ok(at("R1").y < at("C1").y, "R1 on the top row");
  assert.equal(circuit.components.filter((c) => c.type === "GND").length, 2, "one ground symbol per grounded pin");
  assert.equal(circuit.wires.length, 4);
  // DC: the capacitor is open, so with a DC source the output follows the input.
  const dc = structuredClone(circuit);
  Object.assign(dc.components.find((c) => c.id === "V1").props, { mode: "DC", dc: "2.5" });
  const result = simulateDC(dc);
  near(nodeVoltage(result, "C1", 0).re ?? nodeVoltage(result, "C1", 0), 2.5, 1e-9, "V(out) = 2.5 V");
});

test("lab sheet RL: at 10 kHz the MNA phasors match |V_R| = Vm·R/|R + jωL| and the lag atan(ωL/R)", () => {
  const { circuit, layout } = open(RL);
  assert.equal(layout.settings.analysis, "transient", "a SIN source without .tran gets three periods");
  assert.equal(layout.settings.end, "0.0003"); assert.equal(layout.settings.step, "5e-7");
  const w = 2 * Math.PI * 1e4, R = 500, L = 0.01, Vm = 2.5;
  const result = simulateACAtFrequency(circuit, "10k");
  const vr = nodeVoltage(result, "R1", 0);
  near(mag(vr), Vm * R / Math.hypot(R, w * L), 1e-9, "|V_R|");
  near(deg(vr), -Math.atan(w * L / R) * 180 / Math.PI, 1e-6, "∠V_R");
  const vl = { re: nodeVoltage(result, "L1", 0).re - vr.re, im: nodeVoltage(result, "L1", 0).im - vr.im };
  near(deg(vl) - deg(vr), 90, 1e-6, "V_L leads V_R by 90°");
});

test("layouts: parallel parts, a bridge, an inverting amplifier and a rectifier place every part once without overlapping bodies, and nothing is left unconnected", () => {
  const circuits = {
    parallel: "V1 a 0 DC 10\nR1 a b 1k\nR2 b 0 2k\nR3 b 0 2k\nC1 b 0 1u\nR4 a b 3k",
    bridge: "V1 a 0 DC 5\nR1 a b 1k\nR2 a c 2k\nR3 b 0 2k\nR4 c 0 1k\nR5 b c 10k",
    inverting: "V1 in 0 SIN(0 1 1k)\nR1 in n 1k\nR2 n out 10k\nU1 0 n out\nR3 out 0 10k",
    rectifier: "V1 in 0 SIN(0 5 60)\nD1 in out\nR1 out 0 1k\nC1 out 0 100u",
    ladder: "V1 1 0 DC 12\nR1 1 2 1k\nR2 2 0 1k\nR3 2 3 1k\nR4 3 0 1k\nR5 3 4 1k\nR6 4 0 1k",
  };
  for (const [name, text] of Object.entries(circuits)) {
    const { parsed, circuit } = open(text);
    const parts = circuit.components.filter((c) => c.type !== "GND");
    assert.deepEqual(parts.map((c) => c.id).sort(), parsed.parts.map((p) => p.ref).sort(), name + ": every part once");
    const boxes = circuit.components.map((c) => ({ id: c.id, ...bodyBox(c) }));
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      const overlap = a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      assert.ok(!overlap, `${name}: ${a.id} and ${b.id} overlap`);
    }
    // Every pin is on a wire (the editor's connectivity check would flag a floating pin).
    const wired = new Set(circuit.wires.flatMap((w) => [w.a, w.b]).map((e) => e.componentId + ":" + e.pin));
    for (const c of circuit.components) for (let pin = 0; pin < (c.type === "GND" ? 1 : c.type === "OPAMP_IDEAL" ? 3 : 2); pin++) assert.ok(wired.has(c.id + ":" + pin), `${name}: ${c.id} pin ${pin} is wired`);
  }
  // The inverting amplifier computes −R2/R1.
  const { circuit } = open(circuits.inverting);
  const dc = structuredClone(circuit);
  Object.assign(dc.components.find((c) => c.id === "V1").props, { mode: "DC", dc: "0.3" });
  const out = nodeVoltage(simulateDC(dc), "R3", 0);
  near(out.re ?? out, -3, 1e-9, "Vout = −(R2/R1)·Vin");
});

test("reading rules: values, sources, directives and every refusal names its line", () => {
  assert.equal(editorValue("1.5kΩ", ""), "1.5k"); assert.equal(editorValue("11nF", "F"), "11n"); assert.equal(editorValue("10mH", "H"), "10m");
  assert.equal(editorValue("2.2meg", ""), "2.2meg"); assert.equal(editorValue("1M", ""), null, "1M is ambiguous (milli in SPICE, mega elsewhere)");
  assert.equal(parseValue(editorValue("4.7u", "F")), 4.7e-6);
  const sources = parseNetlist("V1 a 0 5\nV2 b 0 DC 3 AC 1 30\nI1 c 0 AC 2m\nR1 a b 1\nR2 b c 1\nR3 c 0 1");
  assert.deepEqual(sources.errors, []);
  assert.deepEqual(sources.parts.slice(0, 3).map((p) => p.props), [{ mode: "DC", dc: "5" }, { mode: "DC", dc: "3", acMagnitude: "1", acPhase: "30" }, { mode: "SIN", acMagnitude: "2m", offset: "0", amplitude: "0" }]);
  assert.deepEqual(parseNetlist("V1 a 0 1\nR1 a 0 1\n.ac dec 40 10 100k").settings, { analysis: "ac", pointsPerDecade: "40", startFrequency: "10", endFrequency: "100k" });
  assert.deepEqual(inferredSettings(parseNetlist("V1 a 0 DC 1\nR1 a 0 1").parts), { analysis: "dc" });
  const bad = parseNetlist("* t\nR1 a 0 1M\nQ1 c b e\nR1 a 0 1k\nZ9 a 0 1\nC1 a\nV1 a 0 TRI(1 2)\n.foo\nR2 a 0 0");
  assert.deepEqual(bad.errors, [
    '2행: R1 값 "1M"을(를) 읽을 수 없습니다. 예: 1.5k, 11n, 10m (메가는 meg)',
    "3행: 트랜지스터(BJT)는 편집기에 없는 부품입니다 (Q1).",
    '5행: "Z9"의 부품 종류를 알 수 없습니다. R, C, L, V, I, D, U로 시작해야 합니다.',
    "6행: C1에 연결 노드 2개가 필요합니다.",
    "7행: TRI(…) 꼴의 전원은 지원하지 않습니다. DC, SIN(…), PULSE(…), AC를 쓰세요.",
    "9행: R2 값은 0보다 커야 합니다.",
  ]);
  assert.ok(bad.warnings.some((w) => w.startsWith("8행: .foo")));
  assert.deepEqual(parseNetlist("R1 a b 1k\nR2 b c 1k").errors, ["접지 노드(0)가 없습니다. 전원의 한쪽을 0에 연결하세요."]);
  assert.ok(parseNetlist("V1 a 0 1\nR1 a 0 1\nR2 a typo 1").warnings.some((w) => w.includes("노드 typo")), "an open node is pointed out");
  assert.throws(() => layoutNetlist(bad), /1M/);
  assert.match(CLAUDE_PROMPT, /PULSE\(-2\.5 2\.5 0 1u 1u 0\.5m 1m\)/);
  assert.match(CLAUDE_PROMPT, /대문자 M은 쓰지 말 것/);
});
