// AC display basis of the circuit editor (peak | rms): only the display changes; the solver, stored values and the average power do not.
import test from "node:test";
import assert from "node:assert/strict";
import { simulateACAtFrequency } from "../../src/circuit-engine.js";
import { cloneExample } from "../../src/examples.js";
import { componentReadout, hoverReadout, nodeReadout } from "../../src/node-readout-model.js";
import { buildResultsCSV } from "../../src/csv-format.js";
import { parseCSV } from "../helpers/csv.mjs";
import { AC_BASES, acScale, amplitudeText, averagePowerFormula, averagePowerLabel, basisSuffix, complexPowerOfPeakPhasors, fromPeak, levelOffsetDb, normalizeAcBasis, scaleComplex, toPeak, unitWithBasis } from "../../src/ac-basis.js";

const near = (actual, expected, rel, label = "") => assert.ok(Math.abs(actual - expected) <= rel * Math.abs(expected) + 1e-300, `${label} ${actual} vs ${expected}`);
const phasorAt = (example) => simulateACAtFrequency(example.circuit, example.settings.phasorFrequency);
const transformer = cloneExample("ideal-transformer"), coils = cloneExample("coupled-coils");

test("basis names and factor: peak keeps the numbers, rms divides amplitudes by √2 and never touches the phase", () => {
  assert.deepEqual([...AC_BASES], ["peak", "rms"]);
  assert.equal(normalizeAcBasis("rms"), "rms");
  for (const odd of ["PEAK", "", undefined, null, 3]) assert.equal(normalizeAcBasis(odd), "peak");
  assert.equal(acScale("peak"), 1); near(acScale("rms"), 1 / Math.SQRT2, 1e-15);
  near(fromPeak(10, "rms"), 10 / Math.SQRT2, 1e-15); assert.equal(fromPeak(10, "peak"), 10);
  const z = { re: 3, im: -4 }, back = scaleComplex(z, "rms");
  near(Math.hypot(back.re, back.im), 5 / Math.SQRT2, 1e-14);
  near(Math.atan2(back.im, back.re), Math.atan2(z.im, z.re), 1e-14, "phase");
  assert.equal(scaleComplex(z, "peak"), z, "peak returns the same object");
  near(levelOffsetDb("rms"), -3.0103, 1e-4); assert.equal(levelOffsetDb("peak"), 0);
  assert.equal(unitWithBasis("V", "rms"), "V (rms)"); assert.equal(unitWithBasis("A", "peak"), "A (peak)"); assert.equal(unitWithBasis("V", "other"), "V (peak)");
  assert.equal(basisSuffix("rms"), "_rms"); assert.equal(basisSuffix("peak"), "_pk");
});

test("input round trip: the rms value typed → stored peak → shown rms is the typed value; the textbook 120 V rms is 169.7056… V peak", () => {
  assert.equal(amplitudeText(120 * Math.SQRT2, "rms"), "120");
  assert.equal(amplitudeText(169.7056274847714, "rms"), "120");
  assert.equal(amplitudeText(12 * Math.SQRT2, "rms"), "12");
  assert.equal(amplitudeText(12, "peak"), "12");
  for (const typed of [1, 0.5, 120, 230, 1e3, 3.3, 0.001, 17.32050808, 4.7e-3]) {
    const stored = toPeak(typed, "rms");
    near(stored, typed * Math.SQRT2, 1e-14);
    assert.equal(Number(amplitudeText(stored, "rms")), Number(typed.toPrecision(12)), `${typed} rms`);
    near(fromPeak(toPeak(typed, "rms"), "rms"), typed, 1e-14);
  }
  // the example sources hold exactly the textbook rms × √2 (as typed text, 15–16 digits)
  near(Number(transformer.circuit.components.find((c) => c.id === "V1").props.acMagnitude), 120 * Math.SQRT2, 1e-15);
  near(Number(coils.circuit.components.find((c) => c.id === "V1").props.acMagnitude), 12 * Math.SQRT2, 1e-15);
});

test("average power is the same number in both bases: ½·Re(V_pk·I_pk*) = Re(V_rms·I_rms*); only the formula label differs", () => {
  const v = { re: 100, im: 50 }, i = { re: 3, im: -2 };
  const s = complexPowerOfPeakPhasors(v, i), vr = scaleComplex(v, "rms"), ir = scaleComplex(i, "rms");
  near(s.P, vr.re * ir.re + vr.im * ir.im, 1e-14, "Re(V_rms I_rms*)"); near(s.Q, vr.im * ir.re - vr.re * ir.im, 1e-14, "Im(V_rms I_rms*)");
  near(s.apparent, Math.hypot(vr.re, vr.im) * Math.hypot(ir.re, ir.im), 1e-14, "|S| = V_rms I_rms");
  assert.ok(/½·Re/.test(averagePowerLabel("peak")) && /peak/.test(averagePowerLabel("peak")));
  assert.ok(/rms/.test(averagePowerLabel("rms")) && !/½/.test(averagePowerLabel("rms")));
  assert.equal(averagePowerFormula("peak"), "P = ½·Re(V_pk·I_pk*)"); assert.equal(averagePowerFormula("rms"), "P = Re(V_rms·I_rms*)");
  // example 13.8: the 20 Ω load dissipates the textbook 615.4 W
  const result = phasorAt(transformer), point = result.points[0], vo = point.nodeVoltages[result.topology.nodeIdByPin["R2:0"]], io = point.componentCurrents.R2;
  near(complexPowerOfPeakPhasors(vo, io).P, 615.4, 1e-3, "P of the 20 Ω load");
  assert.ok(Math.abs(complexPowerOfPeakPhasors(vo, io).Q) < 1e-6, "a resistor takes no reactive power");
});

test("read-outs: rms divides the amplitude by √2, keeps the phase, shifts the dB level by −3.0103 dB and marks the text; peak text is unchanged", () => {
  const result = phasorAt(transformer);
  const peak = componentReadout({ circuit: transformer.circuit, result, componentId: "T1" });
  const rms = componentReadout({ circuit: transformer.circuit, result, componentId: "T1", acBasis: "rms" });
  assert.equal(peak.ok, true); assert.equal(rms.ok, true);
  near(peak.current.value, 11.09 * Math.SQRT2, 1e-3, "peak |I1|"); near(rms.current.value, 11.09, 1e-3, "rms |I1| = the textbook number");
  near(rms.current.value * Math.SQRT2, peak.current.value, 1e-12);
  near(rms.current.phasor.phaseDeg, peak.current.phasor.phaseDeg, 1e-12, "phase");
  near(rms.current.phasor.level - peak.current.phasor.level, -3.0103, 1e-4, "dB");
  assert.ok(!/rms/.test(peak.current.text) && /\(rms\)/.test(rms.current.text), `${peak.current.text} | ${rms.current.text}`);
  assert.ok(/\(rms\)/.test(rms.current.phasor.levelText) && !/rms/.test(peak.current.phasor.levelText));
  assert.ok(rms.lines.some((line) => line.includes("(rms)")) && !peak.lines.some((line) => line.includes("rms")));
  // default (no acBasis argument) is peak: nothing that already worked changes
  assert.deepEqual(componentReadout({ circuit: transformer.circuit, result, componentId: "T1" }), peak);
  // node and hover read-outs: |Vo| = 110.9 V rms
  const node = nodeReadout({ circuit: transformer.circuit, result, target: { kind: "pin", componentId: "R2", pin: 0 }, acBasis: "rms" });
  assert.equal(node.ok, true); near(node.voltage.value, 110.9, 1e-3, "|Vo| rms");
  const hover = hoverReadout({ circuit: transformer.circuit, result, target: { kind: "pin", componentId: "R2", pin: 0 }, acBasis: "rms" });
  near(hover.voltage.value, 110.9, 1e-3);
  // the second winding too (coupled coils: the winding currents of example 13.1 are 13.01 A and 2.91 A rms)
  const k = componentReadout({ circuit: coils.circuit, result: phasorAt(coils), componentId: "K1", acBasis: "rms" });
  near(k.current.value, 13.01, 1e-3, "|I1| rms"); near(k.current2.value, 2.91, 1e-3, "|I2| rms");
});

test("average power in the hover read-out: 615.4 W in both bases, the label names the shown basis", () => {
  const result = phasorAt(transformer);
  const peak = componentReadout({ circuit: transformer.circuit, result, componentId: "R2" });
  const rms = componentReadout({ circuit: transformer.circuit, result, componentId: "R2", acBasis: "rms" });
  assert.ok(peak.power && rms.power);
  near(peak.power.value, 615.4, 1e-3, "peak P"); assert.equal(rms.power.value, peak.power.value, "the same number");
  assert.equal(rms.power.text, peak.power.text);
  assert.equal(peak.power.label, averagePowerLabel("peak")); assert.equal(rms.power.label, averagePowerLabel("rms"));
  near(rms.voltage.value, 110.9, 1e-3); near(rms.current.value, 110.9 / 20, 1e-3);
  near(rms.power.value, rms.voltage.value * rms.current.value, 1e-3, "P = V_rms I_rms for a resistor");
});

test("scope axis titles: AC levels are dB of the peak amplitude and the title says so, whatever the phasor panel shows", async () => {
  const { LABELS } = await import("../../src/scope-view.js");
  assert.match(LABELS.dBV, /\(peak\)/); assert.match(LABELS.dBA, /\(peak\)/);
  assert.doesNotMatch(LABELS.V + LABELS.A + LABELS["°"], /peak|rms/, "time-domain and phase titles carry no basis");
});

test("CSV: no basis argument keeps the old file; peak / rms mark the headers (_pk / _rms), write the magnitude level in that basis, and leave phase and frequency alone", () => {
  const result = phasorAt(coils), probes = [{ kind: "current", componentId: "K1", label: "I(K1.1)" }, { kind: "voltage", componentId: "R1", pin: 0, label: "V(R1.1)" }];
  const series = [{ probe: probes[0], raw: [result.points[0].componentCurrents.K1, { re: 0.5, im: -0.25 }] }, { probe: probes[1], raw: [{ re: 10, im: 5 }, { re: 0, im: 0 }] }];
  const meta = { analysis: "ac", xValues: [0.159, 0.318] };
  const legacy = parseCSV(buildResultsCSV(meta, series)), peak = parseCSV(buildResultsCSV(meta, series, "peak")), rms = parseCSV(buildResultsCSV(meta, series, "rms"));
  assert.deepEqual(legacy[0], ["frequency_Hz", "I(K1.1)_magnitude_dBA", "I(K1.1)_phase_deg", "V(R1.1)_magnitude_dBV", "V(R1.1)_phase_deg"]);
  assert.deepEqual(peak[0], ["frequency_Hz", "I(K1.1)_magnitude_dBA_pk", "I(K1.1)_phase_deg", "V(R1.1)_magnitude_dBV_pk", "V(R1.1)_phase_deg"]);
  assert.deepEqual(rms[0], ["frequency_Hz", "I(K1.1)_magnitude_dBA_rms", "I(K1.1)_phase_deg", "V(R1.1)_magnitude_dBV_rms", "V(R1.1)_phase_deg"]);
  assert.deepEqual(peak.slice(1), legacy.slice(1), "peak values are the legacy values");
  for (let row = 1; row < 3; row += 1) {
    for (const col of [1, 3]) {
      const a = Number(rms[row][col]), b = Number(peak[row][col]);
      if (Number.isFinite(b)) near(a - b, -3.0103, 1e-4, `row ${row} col ${col}`);
      else assert.equal(rms[row][col], peak[row][col], "−∞ stays −∞");
    }
    for (const col of [0, 2, 4]) assert.equal(rms[row][col], peak[row][col], "frequency and phase do not change");
  }
  // other analyses ignore the basis
  const dc = { analysis: "dc", xValues: [0] };
  const dcSeries = [{ probe: { kind: "voltage", label: "V1" }, raw: [5] }];
  assert.deepEqual(parseCSV(buildResultsCSV(dc, dcSeries, "rms")), parseCSV(buildResultsCSV(dc, dcSeries)));
});
