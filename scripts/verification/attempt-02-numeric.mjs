import { writeFile } from "node:fs/promises";
import { simulateTransient } from "../../src/circuit-engine.js";

function circuitFromBranches(branches) {
  const components = [...branches.map(([id, type, , , props]) => ({ id, type, props: { ref: id, ...props } })), { id: "G1", type: "GND", props: { ref: "GND" } }];
  const nets = new Map([["0", [{ componentId: "G1", pin: 0 }]]]);
  for (const [id, , a, b] of branches) for (const [pin, net] of [[0, a], [1, b]]) {
    if (!nets.has(net)) nets.set(net, []);
    nets.get(net).push({ componentId: id, pin });
  }
  const wires = [];
  for (const ends of nets.values()) for (const end of ends.slice(1)) wires.push({ id: `W${wires.length + 1}`, a: { ...ends[0] }, b: { ...end } });
  return { version: 1, components, wires };
}

const parallel = () => circuitFromBranches([
  ["C1", "C", "a", "0", { value: "1u", ic: "5" }],
  ["C2", "C", "a", "0", { value: "3u", ic: "5" }],
  ["R1", "R", "a", "0", { value: "1k" }],
]);
const triangle = () => circuitFromBranches([
  ["C1", "C", "a", "0", { value: "1u", ic: "3" }],
  ["C2", "C", "b", "0", { value: "2u", ic: "1" }],
  ["C3", "C", "a", "b", { value: "3u", ic: "2" }],
  ["R1", "R", "a", "0", { value: "1k" }],
  ["R2", "R", "b", "0", { value: "2k" }],
]);
const sine = () => circuitFromBranches([
  ["C1", "C", "a", "0", { value: "1u", ic: "5" }],
  ["R1", "R", "a", "0", { value: "1k" }],
  ["V1", "V", "a", "0", { mode: "SIN", dc: "0", offset: "5", amplitude: "2", frequency: "1k", phase: "0", acMagnitude: "7", acPhase: "23" }],
]);

function voltage(result, id, index) {
  return result.points[index].nodeVoltages[result.topology.nodeIdByPin[`${id}:0`]];
}
function exp2x2([[a, b], [c, d]], time, [v0, v1]) {
  const halfTrace = (a + d) / 2;
  const delta = Math.sqrt(((a - d) / 2) ** 2 + b * c);
  const scale = Math.exp(halfTrace * time), ch = Math.cosh(delta * time), sh = Math.sinh(delta * time) / delta;
  return [scale * ((ch + sh * (a - halfTrace)) * v0 + sh * b * v1), scale * (sh * c * v0 + (ch + sh * (d - halfTrace)) * v1)];
}
function selectedIndexes(result, quantum) {
  const indexes = [];
  for (let index = 1; index < result.xValues.length; index += 1) {
    const ratio = result.xValues[index] / quantum;
    if (Math.abs(ratio - Math.round(ratio)) <= 1e-8) indexes.push(index);
  }
  return indexes;
}
function maximumError(result, indexes, expected) {
  let maximum = 0;
  for (const index of indexes) for (const error of expected(result, index)) maximum = Math.max(maximum, Math.abs(error));
  return maximum;
}
function energyMaximumIncrease(result, energy) {
  let previous = energy(result, 0), maximum = -Infinity;
  for (let index = 1; index < result.points.length; index += 1) {
    const current = energy(result, index);
    maximum = Math.max(maximum, current - previous);
    previous = current;
  }
  return maximum;
}
function summarize(runs, quantum, expected, energy) {
  const common = runs.map((result) => maximumError(result, selectedIndexes(result, quantum), expected));
  const full = runs.map((result) => maximumError(result, result.xValues.map((_, index) => index).slice(1), expected));
  return {
    stepsSeconds: runs.map((result) => result.xValues[1] - result.xValues[0]),
    sampleCounts: runs.map((result) => result.xValues.length),
    commonQuantumSeconds: quantum,
    commonSampleCounts: runs.map((result) => selectedIndexes(result, quantum).length),
    commonMaximumErrors: common,
    commonSuccessiveRatios: [common[1] / common[0], common[2] / common[1]],
    fullSampleMaximumErrors: full,
    fullSuccessiveRatios: [full[1] / full[0], full[2] / full[1]],
    energyMaximumStepIncreaseJoules: energy ? runs.map((result) => energyMaximumIncrease(result, energy)) : null,
  };
}

const ode = [[-454.54545454545456, -136.36363636363637], [-272.72727272727275, -181.8181818181818]];
const n1Runs = ["40u", "20u", "10u"].map((step) => simulateTransient(parallel(), { start: 0, end: "4m", step }));
const n2Runs = ["40u", "20u", "10u"].map((step) => simulateTransient(triangle(), { start: 0, end: "4m", step }));
const n3Runs = ["10u", "5u", "2.5u"].map((step) => simulateTransient(sine(), { start: 0, end: "1m", step }));
const n1Initial = n1Runs[0].points[0].componentCurrents;
const n2Initial = n2Runs[0].points[0].componentCurrents;
const n3Initial = n3Runs[0].points[0].componentCurrents;

const report = {
  schema: 1,
  contract: { initialExcluded: true, ratioLimit: 0.7, n1n2FinestVoltageLimit: 0.02, n3FinestCurrentLimit: 0.0001, energyIncreaseLimitJoules: 1e-12 },
  N1: {
    initial: { voltage: voltage(n1Runs[0], "C1", 0), currents: n1Initial, kclResidual: n1Initial.R1 + n1Initial.C1 + n1Initial.C2 },
    ...summarize(n1Runs, 40e-6, (result, index) => [voltage(result, "C1", index) - 5 * Math.exp(-result.xValues[index] / 0.004)], (result, index) => 0.5 * 4e-6 * voltage(result, "C1", index) ** 2),
  },
  N2: {
    initial: { va: voltage(n2Runs[0], "C1", 0), vb: voltage(n2Runs[0], "C2", 0), currents: n2Initial, kclA: n2Initial.C1 + n2Initial.C3 + n2Initial.R1, kclB: n2Initial.C2 - n2Initial.C3 + n2Initial.R2 },
    ...summarize(n2Runs, 40e-6, (result, index) => { const [va, vb] = exp2x2(ode, result.xValues[index], [3, 1]); return [voltage(result, "C1", index) - va, voltage(result, "C2", index) - vb]; }, (result, index) => { const va = voltage(result, "C1", index), vb = voltage(result, "C2", index); return 0.5 * (1e-6 * va ** 2 + 2e-6 * vb ** 2 + 3e-6 * (va - vb) ** 2); }),
  },
  N3: {
    initial: { voltage: voltage(n3Runs[0], "C1", 0), currents: n3Initial, kclResidual: n3Initial.C1 + n3Initial.R1 + n3Initial.V1 },
    ...summarize(n3Runs, 10e-6, (result, index) => [result.points[index].componentCurrents.C1 - 1e-6 * 4 * Math.PI * 1000 * Math.cos(2 * Math.PI * 1000 * result.xValues[index])]),
  },
};
for (const key of ["N1", "N2", "N3"]) {
  const item = report[key];
  const limit = key === "N3" ? report.contract.n3FinestCurrentLimit : report.contract.n1n2FinestVoltageLimit;
  item.pass = item.commonSuccessiveRatios.every((ratio) => ratio <= report.contract.ratioLimit) && item.commonMaximumErrors.at(-1) <= limit;
  if (item.energyMaximumStepIncreaseJoules) item.pass &&= item.energyMaximumStepIncreaseJoules.every((increase) => increase <= report.contract.energyIncreaseLimitJoules);
}
report.pass = report.N1.pass && report.N2.pass && report.N3.pass;

const text = `${JSON.stringify(report, null, 2)}\n`;
if (process.argv[2]) await writeFile(process.argv[2], text, "utf8");
process.stdout.write(text);
if (!report.pass) process.exitCode = 1;
