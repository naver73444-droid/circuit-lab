import test from "node:test";
import assert from "node:assert/strict";
import { CircuitError, componentDefaults, simulateAC, simulateDC, simulateTransient } from "../src/circuit-engine.js";

// Engine phase 2: LU factorization (real, cached per dt for linear transient) and
// split re/im complex LU. GOLDEN values were produced by the previous
// Gauss-Jordan engine (git 683a083); the new solver must agree to 1e-9.

// BUILDERS-BEGIN
const item = (id, type, props, nets, control) => ({ id, type, x: 100, y: 100, rotation: 0, props: { ...componentDefaults(type), ref: id, ...props }, ...(control ? { control } : {}), nets });
function make(specs) {
  const all = [...specs, item("GND", "GND", {}, ["0"])];
  const components = all.map(({ nets, ...component }) => component);
  const groups = new Map(), wires = [];
  all.forEach((component) => component.nets.forEach((net, pin) => {
    if (!groups.has(net)) groups.set(net, []);
    groups.get(net).push({ componentId: component.id, pin });
  }));
  for (const endpoints of groups.values()) for (let index = 1; index < endpoints.length; index += 1) wires.push({ id: `W${wires.length + 1}`, a: endpoints[0], b: endpoints[index] });
  return { version: 3, geometryVersion: 2, components, wires, junctions: [] };
}
const SIN = { mode: "SIN", amplitude: "2", frequency: "1k", offset: "0.5", dc: "1", acMagnitude: "1" };
function ladder(count, { resistor = "1k", diode = false } = {}) {
  const specs = [item("V1", "V", { mode: "SIN", dc: "0", amplitude: "1", frequency: "1k", offset: "0", phase: "0", acMagnitude: "1", acPhase: "0" }, ["n0", "0"])];
  for (let index = 1; index <= count; index += 1) {
    specs.push(item(`R${index}`, "R", { value: resistor }, [`n${index - 1}`, `n${index}`]));
    specs.push(item(`C${index}`, "C", { value: "100n", ic: "0" }, [`n${index}`, "0"]));
  }
  if (diode) specs.push(item("D1", "D", {}, [`n${count}`, "0"]));
  return make(specs);
}
const CIRCUITS = {
  opampInverting: () => make([item("V1", "V", SIN, ["a", "0"]), item("R1", "R", { value: "1k" }, ["a", "n"]), item("Rf", "R", { value: "10k" }, ["n", "out"]), item("Cf", "C", { value: "10n" }, ["n", "out"]), item("U1", "OPAMP", {}, ["0", "n", "out"]), item("RL", "R", { value: "2k" }, ["out", "0"])]),
  opampIdeal: () => make([item("V1", "V", SIN, ["a", "0"]), item("R1", "R", { value: "1k" }, ["a", "n"]), item("Rf", "R", { value: "10k" }, ["n", "out"]), item("Cf", "C", { value: "10n" }, ["n", "out"]), item("U1", "OPAMP_IDEAL", {}, ["0", "n", "out"]), item("RL", "R", { value: "2k" }, ["out", "0"])]),
  vcvs: () => make([item("V1", "V", SIN, ["a", "0"]), item("R1", "R", { value: "1k" }, ["a", "b"]), item("C1", "C", { value: "100n" }, ["b", "0"]), item("E1", "VCVS", { g: "5" }, ["e", "0", "b", "0"]), item("Ro", "R", { value: "300" }, ["e", "out"]), item("RL", "R", { value: "1k" }, ["out", "0"]), item("C2", "C", { value: "47n" }, ["out", "0"])]),
  vccs: () => make([item("V1", "V", SIN, ["a", "0"]), item("R1", "R", { value: "1k" }, ["a", "b"]), item("C1", "C", { value: "100n" }, ["b", "0"]), item("G1", "VCCS", { gm: "2mS" }, ["out", "0", "b", "0"]), item("RL", "R", { value: "1k" }, ["out", "0"]), item("L2", "L", { value: "10m" }, ["out", "0"])]),
  cccs: () => make([item("V1", "V", SIN, ["a", "0"]), item("R1", "R", { value: "5k" }, ["a", "b"]), item("S1", "CURRENT_SENSOR", {}, ["b", "0"]), item("F1", "CCCS", { beta: "3" }, ["out", "0"], { kind: "branchCurrent", elementId: "S1", direction: 1 }), item("RL", "R", { value: "1k" }, ["out", "0"]), item("C1", "C", { value: "20n" }, ["out", "0"])]),
  ccvs: () => make([item("V1", "V", SIN, ["a", "0"]), item("R1", "R", { value: "5k" }, ["a", "b"]), item("S1", "CURRENT_SENSOR", {}, ["b", "0"]), item("H1", "CCVS", { rm: "2k" }, ["e", "0"], { kind: "branchCurrent", elementId: "S1", direction: 1 }), item("Ro", "R", { value: "300" }, ["e", "out"]), item("RL", "R", { value: "1k" }, ["out", "0"]), item("C1", "C", { value: "20n" }, ["out", "0"])]),
  rlcPulse: () => make([item("V1", "V", { mode: "PULSE", pulseV1: "0", pulseV2: "5", pulseRise: "10u", pulseFall: "10u", pulseWidth: "1m", pulsePeriod: "2m" }, ["a", "0"]), item("R1", "R", { value: "50" }, ["a", "b"]), item("L1", "L", { value: "10m", ic: "10m" }, ["b", "c"]), item("C1", "C", { value: "1u", ic: "1" }, ["c", "0"])]),
};
const TRANSIENT = { analysis: "transient", start: "0", end: "3m", step: "1u" };
const AC = { startFrequency: "10", endFrequency: "1meg", pointsPerDecade: 20 };
const nodeOf = (result, key) => result.topology.nodeIdByPin[key];
// Flat sample vectors: transient -> [V(node), I(first source)] at fixed indices; AC -> re/im pairs.
function transientSamples(circuit, settings, probes, currents, indices) {
  const result = simulateTransient(circuit, settings);
  const last = result.points.length - 1;
  const out = [];
  for (const raw of indices) {
    const index = raw < 0 ? last + raw + 1 : raw;
    for (const key of probes) out.push(result.points[index].nodeVoltages[nodeOf(result, key)]);
    for (const id of currents) out.push(result.points[index].componentCurrents[id]);
  }
  return out;
}
function acSamples(circuit, settings, probes, currents, indices) {
  const result = simulateAC(circuit, settings);
  const last = result.points.length - 1;
  const out = [];
  for (const raw of indices) {
    const index = raw < 0 ? last + raw + 1 : raw;
    for (const key of probes) { const z = result.points[index].nodeVoltages[nodeOf(result, key)]; out.push(z.re, z.im); }
    for (const id of currents) { const z = result.points[index].componentCurrents[id]; out.push(z.re, z.im); }
  }
  return out;
}
const CASES = {
  "ladder10 transient 1000 steps": () => transientSamples(ladder(10), { analysis: "transient", start: "0", end: "2m", step: "2u" }, ["C10:0", "C1:0", "C5:0"], ["V1", "R1"], [1, 10, 100, 500, -1]),
  "ladder10 transient irregular last dt": () => transientSamples(ladder(10), { analysis: "transient", start: "0", end: "1.0003m", step: "7u" }, ["C10:0", "C3:0"], ["V1"], [1, 50, -2, -1]),
  "ladder10 R=2k transient (same dt, other circuit)": () => transientSamples(ladder(10, { resistor: "2k" }), { analysis: "transient", start: "0", end: "2m", step: "2u" }, ["C10:0", "C1:0"], ["V1"], [1, 100, -1]),
  "ladder18 transient": () => transientSamples(ladder(18), { analysis: "transient", start: "0", end: "4m", step: "5u" }, ["C18:0", "C9:0", "C1:0"], ["V1"], [1, 20, 400, -1]),
  "ladder10 AC": () => acSamples(ladder(10), AC, ["C10:0", "C5:0"], ["V1"], [0, 25, 50, 75, -1]),
  "ladder18 AC": () => acSamples(ladder(18), AC, ["C18:0", "C9:0"], ["V1"], [0, 30, 60, -1]),
  "diode ladder transient": () => transientSamples(ladder(5, { diode: true }), { analysis: "transient", start: "0", end: "1m", step: "2u" }, ["C5:0", "C1:0"], ["V1", "D1"], [1, 100, 250, -1]),
  "diode ladder AC": () => acSamples(ladder(5, { diode: true }), AC, ["C5:0"], ["V1", "D1"], [0, 40, -1]),
  ...Object.fromEntries(Object.entries(CIRCUITS).flatMap(([name, build]) => {
    const probes = ["R1:0", "R1:1"];
    const currents = ["V1"];
    return [
      [`${name} transient`, () => transientSamples(build(), TRANSIENT, probes, currents, [1, 200, 1500, -1])],
      [`${name} AC`, () => acSamples(build(), AC, probes, currents, [0, 30, 60, -1])],
    ];
  })),
};
// BUILDERS-END

const GOLDEN = {
  "ladder10 transient 1000 steps": [8.89298513551736e-20, 0.000241744048613728, 3.31119853152753e-11, -0.0000123242958347389, 0.0000123242958347389, 1.13829135984048e-14, 0.0119036391615309, 1.30004286298306e-7, -0.000113429594402773, 0.000113429594402773, 0.00000241158505067277, 0.44848626732627, 0.00526299679908522, -0.000502570248968883, 0.000502570248968884, 0.0233446814374814, -0.277614855280718, 0.0137836594058854, -0.000277614855280718, 0.000277614855280718, 0.0294724395061073, -0.285264609347297, -0.00191771631492654, -0.000285264609347296, 0.000285264609347296],
  "ladder10 transient irregular last dt": [3.69414311501024e-14, 0.000010295746552714, -0.0000412580647989619, 0.000194194325576091, 0.187263194021971, -0.00020410424106039, 0.023125691902892, -0.142670236785213, -0.000254293021722, 0.0233969748469516, -0.143356164361372, -0.000275175509410458],
  "ladder10 R=2k transient (same dt, other circuit)": [1.04196148243611e-22, 0.000123208312981509, -0.00000622141578518555, 1.01463417513507e-8, 0.319295167865687, -0.000315880674214733, 0.00943501901344309, -0.288560904768713, -0.000144280452384356],
  "ladder18 transient": [2.33892470139826e-26, 2.65078907375878e-14, 0.00143072395039037, -0.0000299800351277379, 1.88604174989721e-16, 1.38105103394465e-7, 0.182921678948389, -0.000404863573344084, 0.00272261415535719, 0.0217710166908193, -0.283640966259815, -0.000283640966259815, 0.00777501034146741, 0.0154113664788979, -0.286741314196535, -0.000286741314196534],
  "ladder10 AC": [0.907469929515179, -0.31945407115898, 0.936321668713034, -0.23349194851763, -0.0000141003621705152, -0.0000589198073269015, -0.128472448904738, -0.103640932936239, 0.0971378297624867, -0.268803712933649, -0.000235523976274689, -0.000179966582950039, -0.0000312788453671429, -0.00000574560903974676, -0.0010095567704481, 0.0049512469709078, -0.000784723669437201, -0.000272539465982334, -2.77299308963798e-16, -1.6486897570317e-16, 4.99792936282992e-9, -1.72333762293111e-8, -0.000998406886898635, -0.0000281896000235358, -1.04225136580307e-28, -3.15264574403548e-30, 1.62510822168209e-16, -1.02100801608274e-14, -0.000999994934030643, -0.00000159152927413882],
  "ladder18 AC": [0.454489454450071, -0.595881366652111, 0.61691425093242, -0.459719790237558, -0.0000477998959019212, -0.0000723431523435569, 0.00484484540700902, 0.00281443217674816, -0.0543244176605103, -0.0185868150196497, -0.000307464794449174, -0.000223762126695071, -6.18729334784164e-16, 1.21061276547591e-15, 1.66347460898752e-8, 3.18490795708341e-8, -0.000956631885831758, -0.000142421500776687, -4.28579682704112e-51, -2.38982297312556e-52, 1.87664034125852e-27, -6.54897373358473e-26, -0.000999994934030643, -0.00000159152927413882],
  "diode ladder transient": [3.37489899038532e-11, 0.000241744048613728, -0.0000123242958347389, 1.3055702098988e-21, 0.0065651642940322, 0.44848828100116, -0.000502568235293994, 2.89135114213905e-13, 0.119450184085356, 0.322903211308767, 0.000322903211308767, 1.00585099897735e-10, 0.0508433572122498, -0.267724120038117, -0.000267724120038117, 6.14820312557454e-12],
  "diode ladder AC": [0.992543925248566, -0.093667577574574, -0.00000215853552245739, -0.0000312504714116706, 3.83962833751863e-11, -3.62350396806863e-12, -0.0833564310143435, -0.0188207643262184, -0.000517156023898254, -0.000289309826666249, -3.22462015529375e-12, -7.28075989408834e-13, 1.46262004604416e-16, -1.02103905255015e-14, -0.000999994934030643, -0.00000159152927413882, 5.65810462686329e-27, -3.94986093829845e-25],
  "opampInverting transient": [0.512566287931118, 5.07485796870072e-7, -0.000512565780445321, 2.40211303259031, 0.000163929586771479, -0.00240194910300354, 0.500000000000001, 0.000139821397898614, -0.000499860178602102, 0.499999999999999, -0.0000398323835809181, -0.00050003983238358],
  "opampInverting AC": [1, 0, 0.0000999850547474455, -6.28161811373714e-7, -0.000999900014945253, -6.28161811373714e-10, 1, 0, 0.0000961922430504275, -0.0000191106955309451, -0.00099990380775695, -1.91106955309451e-8, 1, 0, 0.00000247066243140359, -0.000015522077695748, -0.000999997529337569, -1.5522077695748e-8, 1, 0, 2.53325114082544e-10, -1.59152948338621e-7, -0.000999999999746675, -1.59152948338621e-10],
  "opampIdeal transient": [0.512566287931118, 0, -0.000512566287931118, 2.40211303259031, 0, -0.00240211303259031, 0.500000000000001, 0, -0.000500000000000001, 0.499999999999999, 0, -0.000499999999999999],
  "opampIdeal AC": [1, 0, 0, 0, -0.001, 0, 1, 0, 0, 0, -0.001, 0, 1, 0, 0, 0, -0.001, 0, 1, 0, 0, 0, -0.001, 0],
  "vcvs transient": [0.512566287931118, 0.00507491374189226, -0.000507491374189226, 2.40211303259031, 1.63940324891037, -0.000762709783679934, 0.500000000000001, 1.39840665636938, 0.000898406656369379, 0.499999999999999, -0.398406525069026, -0.000898406525069024],
  "vcvs AC": [1, 0, 0.999960523140879, -0.00628293726675839, -3.94768591204051e-8, -0.00000628293726675839, 1, 0, 0.962020935754162, -0.19114563799587, -0.0000379790642458378, -0.00019114563799587, 1, 0, 0.0247045230318576, -0.155223096134648, -0.000975295476968142, -0.000155223096134648, 1, 0, 0.00000253302317483579, -0.00159154539948736, -0.000999997466976825, -0.00000159154539948736],
  "vccs transient": [0.512566287931118, 0.00507491374189226, -0.000507491374189226, 2.40211303259031, 1.63940324891037, -0.000762709783679935, 0.500000000000001, 1.39840665636938, 0.000898406656369378, 0.499999999999999, -0.398406525069022, -0.000898406525069021],
  "vccs AC": [1, 0, 0.99996052314088, -0.00628293726675839, -3.94768591204051e-8, -0.00000628293726675839, 1, 0, 0.962020935754162, -0.19114563799587, -0.0000379790642458375, -0.00019114563799587, 1, 0, 0.0247045230318576, -0.155223096134648, -0.000975295476968142, -0.000155223096134648, 1, 0, 0.00000253302317483579, -0.00159154539948736, -0.000999997466976825, -0.00000159154539948736],
  "cccs transient": [0.512566287931118, 0, -0.000102513257586224, 2.40211303259031, 0, -0.000480422606518061, 0.500000000000001, 0, -0.0001, 0.499999999999999, 0, -0.0000999999999999997],
  "cccs AC": [1, 0, 0, 0, -0.0002, 0, 1, 0, 0, 0, -0.0002, 0, 1, 0, 0, 0, -0.0002, 0, 1, 0, 0, 0, -0.0002, 0],
  "ccvs transient": [0.512566287931118, 0, -0.000102513257586224, 2.40211303259031, 0, -0.000480422606518061, 0.500000000000001, 0, -0.0001, 0.499999999999999, 0, -0.0000999999999999997],
  "ccvs AC": [1, 0, 0, 0, -0.0002, 0, 1, 0, 0, 0, -0.0002, 0, 1, 0, 0, 0, -0.0002, 0, 1, 0, 0, 0, -0.0002, 0],
  "rlcPulse transient": [0.5, 0.00502437568400182, -0.00989951248631971, 5, 3.97775611576105, -0.0204448776847785, 0, -0.788253416120966, -0.0157650683224189, 5, 5.04472092600647, 0.000894418520129309],
  "rlcPulse AC": [1, 0, 0.999990129713704, -0.00314168567394409, -1.97405725928343e-7, -0.0000628337134788819, 1, 0, 0.989415648239211, -0.102334369879297, -0.000211687035215776, -0.00204668739758593, 1, 0, 0.993378140875963, 0.0811049326846331, -0.000132437182480749, 0.00162209865369266, 1, 0, 0.999999366739795, 0.000795776227251749, -1.26652040993588e-8, 0.000015915524545035],
};

function assertClose(actual, expected, label) {
  assert.equal(actual.length, expected.length, `${label}: sample count`);
  const scale = Math.max(...expected.map(Math.abs));
  actual.forEach((value, index) => {
    const tolerance = 1e-9 * Math.abs(expected[index]) + 1e-11 * scale;
    assert.ok(Math.abs(value - expected[index]) <= tolerance, `${label}[${index}]: ${value} vs ${expected[index]} (tol ${tolerance})`);
  });
}

test("engine2: LU solver agrees with the previous Gauss-Jordan engine to 1e-9", () => {
  for (const [name, run] of Object.entries(CASES)) assertClose(run(), GOLDEN[name], name);
  assert.deepEqual(Object.keys(GOLDEN).sort(), Object.keys(CASES).sort());
});

test("engine2: transient results are deterministic and independent between runs sharing a dt", () => {
  const first = simulateTransient(ladder(10), { analysis: "transient", start: "0", end: "1m", step: "2u" });
  simulateTransient(ladder(10, { resistor: "5k" }), { analysis: "transient", start: "0", end: "1m", step: "2u" });
  const second = simulateTransient(ladder(10), { analysis: "transient", start: "0", end: "1m", step: "2u" });
  assert.deepEqual(second.points, first.points);
  const slower = simulateTransient(ladder(10, { resistor: "5k" }), { analysis: "transient", start: "0", end: "1m", step: "2u" });
  assert.notDeepEqual(slower.points.at(-1).nodeVoltages, first.points.at(-1).nodeVoltages);
});

test("engine2: many distinct step sizes still solve (factor cache stays bounded)", () => {
  // A pulse source never changes A, so only dt matters; the final step is shorter.
  const circuit = ladder(4);
  for (let step = 1; step <= 40; step += 1) {
    const result = simulateTransient(circuit, { analysis: "transient", start: "0", end: `${step * 3 + 0.37}u`, step: `${step}u` });
    assert.ok(result.points.every((point) => Object.values(point.nodeVoltages).every(Number.isFinite)));
  }
});

test("engine2: backward-Euler RC step matches the closed form of the discrete recurrence", () => {
  const circuit = make([item("V1", "V", { mode: "DC", dc: "5" }, ["a", "0"]), item("R1", "R", { value: "1k" }, ["a", "b"]), item("C1", "C", { value: "1u", ic: "0" }, ["b", "0"])]);
  const result = simulateTransient(circuit, { analysis: "transient", start: "0", end: "5m", step: "10u" });
  const node = nodeOf(result, "C1:0");
  const ratio = 1 / (1 + 10e-6 / (1000 * 1e-6));
  result.points.forEach((point, index) => {
    const expected = 5 * (1 - ratio ** index);
    assert.ok(Math.abs(point.nodeVoltages[node] - expected) <= 1e-12 * 5 + 1e-9 * Math.abs(expected), `step ${index}`);
  });
});

test("engine2: SINGULAR detection, codes and messages are unchanged", () => {
  const currentOnly = make([item("I1", "I", {}, ["a", "0"])]);
  const seriesCaps = make([item("V1", "V", { dc: "5" }, ["a", "0"]), item("C1", "C", {}, ["a", "b"]), item("C2", "C", {}, ["b", "0"])]);
  const parallelSources = make([item("V1", "V", { dc: "5" }, ["a", "0"]), item("V2", "V", { dc: "3" }, ["a", "0"])]);
  const isSingular = (message) => (error) => error instanceof CircuitError && error.code === "SINGULAR" && error.message === message;
  assert.throws(() => simulateDC(currentOnly), isSingular("회로 방정식이 특이행렬입니다."));
  assert.throws(() => simulateTransient(currentOnly, { analysis: "transient", start: "0", end: "1m", step: "100u" }), isSingular("회로 방정식이 특이행렬입니다."));
  assert.throws(() => simulateDC(seriesCaps), isSingular("회로 방정식이 특이행렬입니다."));
  assert.throws(() => simulateAC(currentOnly, { startFrequency: "10", endFrequency: "1k", pointsPerDecade: 3 }), isSingular("AC 회로 방정식이 특이행렬입니다."));
  assert.throws(() => simulateAC(parallelSources, { startFrequency: "10", endFrequency: "1k", pointsPerDecade: 3 }), isSingular("AC 회로 방정식이 특이행렬입니다."));
  assert.throws(() => simulateDC(parallelSources), (error) => error instanceof CircuitError && error.code === "IDEAL_CONSTRAINT_CONFLICT");
  assert.throws(() => simulateDC(make([item("R1", "R", {}, ["x", "y"]), item("V1", "V", {}, ["a", "0"]), item("R2", "R", {}, ["a", "0"])])), (error) => error instanceof CircuitError && error.code === "FLOATING_NODE");
});

test("engine2: uniformly tiny but well-conditioned systems still solve (scale-aware pivot test)", () => {
  const circuit = make([item("V1", "V", { dc: "5" }, ["a", "0"]), item("R1", "R", { value: "1e15" }, ["a", "b"]), item("R2", "R", { value: "1e15" }, ["b", "0"])]);
  const result = simulateDC(circuit);
  assert.ok(Math.abs(result.points[0].nodeVoltages[nodeOf(result, "R1:1")] - 2.5) < 1e-9);
});

test("engine2: analysis budget stays conservative", () => {
  const huge = ladder(60);
  assert.throws(() => simulateTransient(huge, { analysis: "transient", start: "0", end: "20m", step: "1u" }), (error) => error instanceof CircuitError && error.code === "ANALYSIS_BUDGET");
});
