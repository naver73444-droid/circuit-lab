// Netlist text → laid-out editor circuit (netlist-import.js): the two circuits of a lab sheet (RC and RL first order), the reading rules,
// the layout (each part placed once, grounds under grounded pins, no overlapping bodies) and the MNA results against closed forms.
import test from "node:test";
import assert from "node:assert/strict";
import { parseNetlist, layoutNetlist, describePart, editorValue, inferredSettings, CLAUDE_PROMPT } from "../../../src/netlist-import.js";
import { analysisCircuit } from "../../../src/source-model.js";
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
  assert.deepEqual(parsed.parts[0].props, { mode: "PULSE", pulseV1: "-2.5", pulseV2: "2.5", pulseDelay: "0", pulseRise: "1u", pulseFall: "1u", pulseWidth: "0.5m", pulsePeriod: "1m" },
    "the waveform only: DC and AC values follow it (source-model.js)");
  assert.equal(parsed.parts[1].props.value, "1.5k");
  assert.equal(parsed.parts[2].props.value, "11n");
  assert.deepEqual(layout.settings, { analysis: "transient", step: "5u", end: "3m", start: "0" });
  assert.deepEqual(layout.probes, [{ kind: "voltage", componentId: "V1", pin: 0 }, { kind: "voltage", componentId: "R1", pin: 1 }]);
  assert.equal(describePart(parsed.parts[0]), "V1  전압원  in – 접지  구형 5 Vpp · 1 kHz");
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
  // The run reads V1 as a generator: AC = the sine's peak 2.5 V at its phase, SIN phase 0 = cos −90° (the line's "AC 2.5" is not used).
  const result = simulateACAtFrequency(analysisCircuit(circuit).circuit, "10k");
  const vr = nodeVoltage(result, "R1", 0);
  near(mag(vr), Vm * R / Math.hypot(R, w * L), 1e-9, "|V_R|");
  near(deg(vr), -90 - Math.atan(w * L / R) * 180 / Math.PI, 1e-6, "∠V_R lags the source by atan(ωL/R)");
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
    assert.ok(boxes.every((b) => [b.x0, b.y0, b.x1, b.y1].every(Number.isFinite)), "boxes have the x0/y0/x1/y1 the check reads");
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      const overlap = a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
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
  // An "AC" part becomes the sine it stands for (cos phase = AC phase, so SIN phase = AC phase + 90°), at 1 kHz with the DC as offset.
  assert.deepEqual(sources.parts.slice(0, 3).map((p) => p.props), [{ mode: "DC", dc: "5" }, { mode: "SIN", dc: "3", offset: "3", amplitude: "1", frequency: "1k", phase: "120" },
    { mode: "SIN", dc: "0", offset: "0", amplitude: "2m", frequency: "1k", phase: "90" }]);
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

test("review fixes: AC-only sources, no hidden editor defaults, spaced prefixes, op amp supply pins, node case, pasted chat answers, bad analysis settings", () => {
  // "AC 1" alone: a 1 V-peak sine — it previews, opens, and in the AC analysis only it drives the circuit (V2, a DC source, has AC 0).
  const ac = parseNetlist("V1 in 0 AC 1\nV2 b 0 DC 5\nR1 in out 1k\nR2 b out 1k\nR3 out 0 1k\n.ac dec 10 10 1k");
  assert.deepEqual(ac.errors, []);
  assert.equal(describePart(ac.parts[0]), "V1  전압원  in – 접지  사인 2 Vpp · 1 kHz");
  assert.match(ac.warnings[0], /AC 1은\(는\) 1 kHz 사인/);
  const { circuit } = open("V1 in 0 AC 1\nV2 b 0 DC 5\nR1 in out 1k\nR2 b out 1k\nR3 out 0 1k\n.ac dec 10 10 1k");
  near(mag(nodeVoltage(simulateACAtFrequency(analysisCircuit(circuit).circuit, "100"), "R3", 0)), 1 / 3, 1e-9, "|V(out)| = 1/3 (SPICE), not 2/3");
  // A SIN source: the run's DC value is its offset (no hidden 5 V bias), and its AC input is its own peak.
  const sin = analysisCircuit(open("V1 in 0 SIN(0 0.1 1k)\nR1 in a 1k\nR2 a 0 1k").circuit).circuit.components.find((c) => c.id === "V1").props;
  assert.equal(sin.dc, "0"); assert.equal(sin.acMagnitude, "0.1");
  // "1.5 k" and "11 nF" are one value; anything else after a value is pointed out.
  const spaced = parseNetlist("V1 a 0 DC 1\nR1 a b 1.5 k\nC1 b 0 11 nF\nL1 a 0 10m extra");
  assert.deepEqual(spaced.parts.slice(1).map((p) => p.props.value), ["1.5k", "11n", "10m"]);
  assert.ok(spaced.warnings.some((w) => w.includes('"extra"')));
  assert.equal(editorValue("10f", "F"), "10f", "f is femto, not farad");
  // Op amp lines with supply pins are refused (the 4th node would be read as the output).
  assert.match(parseNetlist("V1 a 0 1\nU1 a n vcc vee out\nR1 out 0 1k").errors[0], /±Vcc 전원 핀은 빼세요/);
  // Node names ignore case, as in SPICE; probes too.
  const cased = parseNetlist("V1 IN 0 1\nR1 in OUT 1k\nC1 out 0 1n\n.probe V(Out)");
  assert.deepEqual(cased.warnings, []); assert.deepEqual(cased.probes, [{ kind: "voltage", node: "out" }]);
  // A whole chat answer: only the first fenced block is read, and line numbers still count from the pasted text.
  const chat = parseNetlist("아래와 같습니다.\n```spice\n* RC\nV1 in 0 DC 1\nR1 in out 1M\n```\n사진에서 C 값이 흐립니다.\n```\n* RL\nV1 a 0 1\n```");
  assert.deepEqual(chat.errors, ['5행: R1 값 "1M"을(를) 읽을 수 없습니다. 예: 1.5k, 11n, 10m (메가는 meg)']);
  assert.ok(chat.warnings.some((w) => w.includes("첫 블록(2~6행)만")));
  // Differential probes become two probes with a note; impossible analysis settings stop at the line.
  const diff = parseNetlist("V1 a 0 1\nR1 a b 1k\nR2 b 0 1k\n.probe V(a,b)");
  assert.deepEqual(diff.probes, [{ kind: "voltage", node: "a" }, { kind: "voltage", node: "b" }]);
  for (const bad of [".tran 1u 1m 2m", ".ac dec 50 100k 10", ".ac dec 50 0 1k", ".tran 1n 1"]) assert.equal(parseNetlist("V1 a 0 1\nR1 a 0 1\n" + bad).errors.length, 1, bad);
  assert.equal(parseNetlist("V1 a 0 SIN(0 1)\nR1 a 0 1").errors.length, 1, "SIN needs three values");
  assert.equal(parseNetlist("V1 a 0 PULSE(0 5 0)\nR1 a 0 1").errors.length, 1, "PULSE needs all seven");
  assert.ok(parseNetlist("V1 a 0 SIN(0 1 1k 1m 0)\nR1 a 0 1").warnings.some((w) => w.includes("지연·감쇠")));
  assert.equal(parseNetlist("V1 a 0 1\nC1 a 0 1u IC=bad").errors.length, 1);
  assert.equal(parseNetlist("V1 a 0 1\nC1 a 0 1u IC = 2").parts[1].props.ic, "2");
  // Two very different periods never ask for more than 20000 steps.
  const inferred = inferredSettings(parseNetlist("V1 a 0 PULSE(0 1 0 1n 1n 1u 2u)\nV2 b 0 SIN(0 1 1)\nR1 a b 1k\nR2 b 0 1k").parts);
  assert.ok(Number(inferred.end) / Number(inferred.step) <= 20000.5, JSON.stringify(inferred));
});
