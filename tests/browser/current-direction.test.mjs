// Browser check of the current-direction display: DC/instantaneous currents read as a magnitude with the real direction (also for parts placed
// backwards or rotated), AC phasors keep a reference direction that the inspector can flip, and textbook example 13.1 shows I2 = 2.91∠14.04° A.
// Same harness as smoke.test.mjs: real server + headless Edge with a throw-away profile, only our own processes are stopped.
import { describe, test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  L, ctx, ev, until, waitFor, settle, navigate, state, click, clickPart, partPoint, press, moveTo, runAnalysis, select,
  startServer, startBrowser, stopAll, leftoverProcessIds, isAlive, assertNoProblems, resetProblems, MOD,
} from "./harness.mjs";
import { serializeProject } from "../../src/project-format.js";
import { componentDefaults } from "../../src/circuit-engine.js";

const part = (id, type, x, y, rotation, props) => ({ id, type, x, y, rotation, props: { ...componentDefaults(type, 1), ...props, ref: id === "G1" ? "GND" : id } });
const wire = (id, a, aPin, b, bPin) => ({ id, a: { componentId: a, pin: aPin }, b: { componentId: b, pin: bPin } });

/** 10 V → R1 (turned 180° and wired backwards: its pin 2 faces the source) → R2 (vertical, forward) → GND. 5 mA flows through both. */
function backwardsProjectHash() {
  const circuit = {
    version: 1, geometryVersion: 2, junctions: [],
    components: [
      part("V1", "V", 100, 240, 90, { mode: "DC", dc: "10" }),
      part("R1", "R", 260, 140, 180, { value: "1k" }),
      part("R2", "R", 420, 240, 90, { value: "1k" }),
      part("G1", "GND", 260, 400, 0, {}),
    ],
    wires: [wire("W1", "V1", 0, "R1", 1), wire("W2", "R1", 0, "R2", 0), wire("W3", "R2", 1, "G1", 0), wire("W4", "V1", 1, "G1", 0)],
  };
  const probes = [
    { key: "I:R1", kind: "current", componentId: "R1", label: "I(R1, 기준 1→2)", color: "#80bfff" },
    { key: "I:R2", kind: "current", componentId: "R2", label: "I(R2, 기준 1→2)", color: "#f5bc79" },
  ];
  const json = JSON.stringify(JSON.parse(serializeProject({ title: "역방향 배치", subtitle: "", circuit, settings: { analysis: "dc" }, probes })));
  return `#p=j.${Buffer.from(json, "utf8").toString("base64url")}`;
}

const chipText = (key) => ev(`document.querySelector('#probe-list [data-probe-key="${key}"]')?.textContent ?? ""`);
const arrowInfo = (id, winding = 1) => ev(`(() => {
  const group = document.querySelector('.component[data-id="${id}"] .current-direction[data-winding="${winding}"]'); if (!group) return null;
  const head = group.querySelector("path"), line = group.querySelector("line"), text = group.querySelector("text");
  const middle = (element) => { if (!element) return null; const r = element.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; };
  const pinAt = (pin) => middle(document.querySelector('.component[data-id="${id}"] .pin[data-pin="' + pin + '"]'));
  return { mode: group.dataset.currentMode, text: text?.textContent ?? "", head: middle(head), line: middle(line), dashed: line ? getComputedStyle(line).strokeDasharray : "", pins: [0, 1, 2, 3].map(pinAt) };
})()`);
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const hoverText = () => ev(`${L}.getHoverReadout().text`);
async function hoverPart(id) {
  const point = await partPoint(id);
  await moveTo(point.x + 40, point.y + 260); // off the part first, so the readout is rebuilt for it
  await moveTo(point.x, point.y);
  await waitFor(async () => (await hoverText()).includes(`${id} (`), `the ${id} readout`);
  return hoverText();
}
async function autoUpdateOff() {
  if ((await state()).autoUpdate) await click("#auto-update");
  assert.equal((await state()).autoUpdate, false);
}

describe("current direction display", { timeout: 300000 }, () => {
  before(async () => { await startServer(); await startBrowser(); });
  beforeEach(() => resetProblems());
  afterEach(async () => { await assertNoProblems("console/network"); });
  after(async () => {
    const started = [ctx.edge?.pid, ctx.server?.pid].filter(Boolean);
    const stopped = await stopAll();
    for (const pid of new Set([...started, ...stopped])) assert.equal(isAlive(pid), false, `process ${pid} should have been stopped`);
    assert.deepEqual(leftoverProcessIds(), [], "no process may still carry the throw-away Edge profile");
  });

  test("DC: a part placed backwards and rotated reads a positive 5 mA with the real direction in the chip, the hover readout and the canvas arrow", async () => {
    await navigate(`/?current-direction=1${backwardsProjectHash()}`);
    await until(`${L}.getState().circuit.components.length === 4`, "the shared circuit");
    await autoUpdateOff();
    await runAnalysis("dc");
    const { result } = await state();
    assert.ok(result.points[0].componentCurrents.R1 < 0, "the solver keeps its pin 1→2 sign: R1 is negative");
    assert.ok(result.points[0].componentCurrents.R2 > 0);

    // probe chips: label = reference, value = magnitude + real direction, never a minus sign
    const r1Chip = await chipText("I:R1"), r2Chip = await chipText("I:R2");
    assert.match(r1Chip, /I\(R1, 기준 1→2\)/);
    assert.match(r1Chip, /5 mA \(2→1\)/, r1Chip);
    assert.match(r2Chip, /5 mA \(1→2\)/, r2Chip);
    assert.doesNotMatch(r1Chip + r2Chip, /[−-]\s?5/, "no negative current");
    assert.match(await ev(`document.querySelector("#probe-list .current-direction-note").textContent`), /실제로 흐르는 방향/);

    // canvas arrows point the real way: R1's tip sits at its pin 1 (where the current leaves), R2's at its pin 2
    const r1 = await arrowInfo("R1"), r2 = await arrowInfo("R2");
    assert.equal(r1.mode, "actual");
    assert.equal(r1.text, "5 mA");
    assert.ok(distance(r1.head, r1.pins[0]) < distance(r1.head, r1.pins[1]), "R1 arrow points to its pin 1");
    assert.ok(distance(r2.head, r2.pins[1]) < distance(r2.head, r2.pins[0]), "R2 arrow points to its pin 2");
    assert.equal(r1.dashed, "none", "a real-direction arrow is solid");

    // hover readout
    const r1Hover = await hoverPart("R1");
    assert.match(r1Hover, /전류 5 mA \(2→1\)/, r1Hover);
    assert.doesNotMatch(r1Hover, /전류 [−-]/);
    assert.match(await hoverPart("R2"), /전류 5 mA \(1→2\)/);
  });

  test("reference flip: the inspector button flips the shown reference (label, chip, saved field) without touching the result, is one undo step and is saved", async () => {
    await navigate(`/?current-direction=2${backwardsProjectHash()}`);
    await until(`${L}.getState().circuit.components.length === 4`, "the shared circuit");
    await autoUpdateOff();
    await runAnalysis("dc");
    const before = await state();
    await clickPart("R1");
    await click("#inspector-tab");
    assert.match(await ev(`document.querySelector("#inspector-content .current-reference").textContent`), /기준 1→2/);
    await click('#inspector-content [data-flip-current="1"]');
    let after = await state();
    assert.equal(after.circuit.components.find((item) => item.id === "R1").flipCurrent, true);
    assert.equal(after.probes.find((probe) => probe.key === "I:R1").label, "I(R1, 기준 2→1)");
    assert.equal(after.stale, false, "a display-only change keeps the result");
    assert.equal(after.generation, before.generation);
    assert.equal(after.historyDepth, before.historyDepth + 1);
    assert.equal(await ev(`document.querySelector('#inspector-content [data-flip-current="1"]').getAttribute("aria-pressed")`), "true");
    assert.match(await chipText("I:R1"), /I\(R1, 기준 2→1\).*5 mA \(2→1\)/, "the DC value still names the real direction");
    // the saved project carries the optional field (autosave goes through the same serializer)
    await ev(`${L}.flushAutosave()`);
    const saved = await ev(`Object.keys(localStorage).filter((key) => key.startsWith("circuit-lab.autosave")).map((key) => localStorage.getItem(key)).join("\\n")`);
    assert.match(saved, /"flipCurrent":\s*true/);
    // undo restores the engine reference
    await press("z", "KeyZ", 90, MOD.ctrl);
    after = await state();
    assert.equal(Object.hasOwn(after.circuit.components.find((item) => item.id === "R1"), "flipCurrent"), false);
  });

  test("AC example 13.1: I(K1.2) uses the textbook direction out of the dot (2b→2a) and shows 2.91∠14.04° A rms; arrows are dashed references", async () => {
    await navigate("/?example=coupled-coils");
    await autoUpdateOff();
    await runAnalysis("ac");
    const snapshot = await state();
    assert.deepEqual(snapshot.probes.map((probe) => probe.label), ["I(K1.1)", "I(K1.2, 기준 2b→2a)", "I(R1, 기준 1→2)"]);
    assert.equal(snapshot.acBasis, "rms");
    await click("#results-tab");
    await until(`!document.getElementById("phasor-panel").hidden`, "the phasor panel");
    await until(`document.getElementById("phasor-validity").dataset.status === "ready"`, "phasor validity ready");
    const values = await ev(`[...document.querySelectorAll("#current-phasor-values .phasor-value")].map((item) => item.textContent)`);
    const secondary = values.find((text) => text.startsWith("I(K1.2"));
    assert.match(secondary, /2\.91\d* A \(rms\) ∠ 14\.03\d*°|2\.91\d* A \(rms\) ∠ 14\.04\d*°/, secondary);
    // the canvas shows the reference direction (dashed, labelled 기준); winding 2 points from 2b (pin 4) up to 2a (pin 3)
    const k2 = await arrowInfo("K1", 2);
    assert.equal(k2.mode, "reference");
    assert.equal(k2.text, "기준");
    assert.notEqual(k2.dashed, "none");
    assert.ok(distance(k2.head, k2.pins[2]) < distance(k2.head, k2.pins[3]), "the winding-2 reference arrow points to 2a");
    // hover readout in AC (the sweep sample under the cursor, here the last one) names the reference of each winding
    const hover = await hoverPart("K1");
    assert.match(hover, /1차 전류 [\d.]+ m?A \(rms\) ∠ [-−\d.]+° \(기준 1a→1b\)/, hover);
    assert.match(hover, /2차 전류 [\d.]+ m?A \(rms\) ∠ [-−\d.]+° \(기준 2b→2a\)/, hover);
    // flipping winding 2 back to the engine reference shows −I2 = 2.91∠−165.96°
    await clickPart("K1");
    await click("#inspector-tab");
    await click('#inspector-content [data-flip-current="2"]');
    assert.equal((await state()).probes[1].label, "I(K1.2)");
    await click("#results-tab");
    await waitFor(async () => (await ev(`[...document.querySelectorAll("#current-phasor-values .phasor-value")].map((item) => item.textContent).find((text) => text.startsWith("I(K1.2)")) ?? ""`)).match(/[-−]165\.9/) !== null, "the flipped phasor");
  });

  test("transient: the scope keeps the signed reference waveform while the readout and arrow give the instantaneous magnitude", async () => {
    await navigate("/?example=rc-charge");
    await autoUpdateOff();
    await runAnalysis("transient");
    assert.match(await ev(`document.getElementById("probe-list").textContent`), /I\(R1, 기준 1→2\)/);
    assert.match(await ev(`document.querySelector("#probe-list .current-direction-note").textContent`), /기준 방향 부호/);
    const arrow = await arrowInfo("R1");
    assert.equal(arrow.mode, "actual");
    assert.match(arrow.text, /^\d/, "a magnitude, no sign");
    const hover = await hoverPart("R1");
    assert.match(hover, /전류 (0 A|[\d.]+ [µmnp]?A \(1→2\))/, hover);
    await settle();
  });
});
