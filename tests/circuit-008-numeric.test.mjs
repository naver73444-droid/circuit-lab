import test from 'node:test';
import assert from 'node:assert/strict';
import { simulateTransient } from '../src/circuit-engine.js';

function circuitFromBranches(branches) {
  const components = [
    ...branches.map(([id, type, , , props]) => ({ id, type, props: { ref: id, ...props } })),
    { id: 'G1', type: 'GND', props: { ref: 'GND' } },
  ];
  const nets = new Map([['0', [{ componentId: 'G1', pin: 0 }]]]);
  for (const [id, , a, b] of branches) for (const [pin, net] of [[0, a], [1, b]]) {
    if (!nets.has(net)) nets.set(net, []);
    nets.get(net).push({ componentId: id, pin });
  }
  const wires = [];
  for (const ends of nets.values()) for (const end of ends.slice(1)) wires.push({ id: `W${wires.length + 1}`, a: ends[0], b: end });
  return { version: 1, components, wires };
}

const parallel = () => circuitFromBranches([
  ['C1', 'C', 'a', '0', { value: '1u', ic: '5' }],
  ['C2', 'C', 'a', '0', { value: '3u', ic: '5' }],
  ['R1', 'R', 'a', '0', { value: '1k' }],
]);

const triangle = () => circuitFromBranches([
  ['C1', 'C', 'a', '0', { value: '1u', ic: '3' }],
  ['C2', 'C', 'b', '0', { value: '2u', ic: '1' }],
  ['C3', 'C', 'a', 'b', { value: '3u', ic: '2' }],
  ['R1', 'R', 'a', '0', { value: '1k' }],
  ['R2', 'R', 'b', '0', { value: '2k' }],
]);

function nodeVoltage(result, id, pin = 0, index = 0) {
  return result.points[index].nodeVoltages[result.topology.nodeIdByPin[`${id}:${pin}`]];
}

function close(actual, expected, abs, rel, label = '') {
  const tolerance = abs + rel * Math.abs(expected);
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} != ${expected} (tol ${tolerance})`);
}

const closeV = (a, e, label) => close(a, e, 1e-9, 1e-8, label);
const closeI = (a, e, label) => close(a, e, 1e-11, 1e-8, label);
function kcl(value, branches, label) {
  const limit = 1e-10 + 1e-8 * branches.reduce((sum, branch) => sum + Math.abs(branch), 0);
  assert.ok(Math.abs(value) <= limit, `${label}: residual ${value}, limit ${limit}`);
}

function maxError(result, expected) {
  let maximum = 0;
  for (let index = 1; index < result.xValues.length; index += 1) maximum = Math.max(maximum, ...expected(result, index));
  return maximum;
}

function assertConvergence(errors, finestLimit, label) {
  assert.ok(errors[1] < errors[0] && errors[2] < errors[1], `${label}: errors do not decrease: ${errors}`);
  assert.ok(errors[1] / errors[0] <= 0.7 && errors[2] / errors[1] <= 0.7, `${label}: ratios exceed 0.7: ${errors}`);
  assert.ok(errors[2] <= finestLimit, `${label}: finest error ${errors[2]} > ${finestLimit}`);
}

function assertNonIncreasingEnergy(result, energy, label) {
  let previous = energy(result, 0);
  for (let index = 1; index < result.points.length; index += 1) {
    const current = energy(result, index);
    assert.ok(current <= previous + 1e-12, `${label}: energy increased ${previous} -> ${current}`);
    previous = current;
  }
}

function exp2x2(matrix, time, vector) {
  const [[a, b], [c, d]] = matrix;
  const halfTrace = (a + d) / 2;
  const delta = Math.sqrt(((a - d) / 2) ** 2 + b * c);
  const scale = Math.exp(halfTrace * time);
  const cosh = Math.cosh(delta * time);
  const sinhOverDelta = delta === 0 ? time : Math.sinh(delta * time) / delta;
  const m00 = scale * (cosh + sinhOverDelta * (a - halfTrace));
  const m01 = scale * sinhOverDelta * b;
  const m10 = scale * sinhOverDelta * c;
  const m11 = scale * (cosh + sinhOverDelta * (d - halfTrace));
  return [m00 * vector[0] + m01 * vector[1], m10 * vector[0] + m11 * vector[1]];
}

test('CIRCUIT-008 N1: parallel discharge initial derivative, KCL, convergence and energy', () => {
  const initial = simulateTransient(parallel(), { start: 0, end: '40u', step: '40u' });
  const currents = initial.points[0].componentCurrents;
  closeV(nodeVoltage(initial, 'C1'), 5, 'V(0)');
  closeI(currents.R1, 0.005, 'IR(0)');
  closeI(currents.C1, -0.00125, 'IC1(0)');
  closeI(currents.C2, -0.00375, 'IC2(0)');
  kcl(currents.R1 + currents.C1 + currents.C2, [currents.R1, currents.C1, currents.C2], 'node a KCL');
  const runs = ['40u', '20u', '10u'].map((step) => simulateTransient(parallel(), { start: 0, end: '4m', step }));
  const errors = runs.map((result) => maxError(result, (r, index) => [Math.abs(nodeVoltage(r, 'C1', 0, index) - 5 * Math.exp(-r.xValues[index] / 0.004))]));
  assertConvergence(errors, 0.02, 'N1 voltage');
  for (const result of runs) assertNonIncreasingEnergy(result, (r, index) => 0.5 * 4e-6 * nodeVoltage(r, 'C1', 0, index) ** 2, 'N1');
});

test('CIRCUIT-008 N2: capacitor loop independent 2x2 solution, KCL, convergence and energy', () => {
  const initial = simulateTransient(triangle(), { start: 0, end: '40u', step: '40u' });
  const i = initial.points[0].componentCurrents;
  closeV(nodeVoltage(initial, 'C1'), 3, 'Va(0)');
  closeV(nodeVoltage(initial, 'C2'), 1, 'Vb(0)');
  closeI(i.C1, -0.0015, 'IC1(0)'); closeI(i.C2, -0.002, 'IC2(0)'); closeI(i.C3, -0.0015, 'IC3(0)');
  kcl(i.C1 + i.C3 + i.R1, [i.C1, i.C3, i.R1], 'node a KCL');
  kcl(i.C2 - i.C3 + i.R2, [i.C2, i.C3, i.R2], 'node b KCL');
  // -inverse([[4,-3],[-3,5]]e-6) * diag(1e-3, .5e-3), computed independently.
  const ode = [[-454.54545454545456, -136.36363636363637], [-272.72727272727275, -181.8181818181818]];
  const derivative = [ode[0][0] * 3 + ode[0][1], ode[1][0] * 3 + ode[1][1]];
  close(derivative[0], -1500, 1e-9, 1e-12, "Va'(0)"); close(derivative[1], -1000, 1e-9, 1e-12, "Vb'(0)");
  const runs = ['40u', '20u', '10u'].map((step) => simulateTransient(triangle(), { start: 0, end: '4m', step }));
  const errors = runs.map((result) => maxError(result, (r, index) => {
    const [va, vb] = exp2x2(ode, r.xValues[index], [3, 1]);
    return [Math.abs(nodeVoltage(r, 'C1', 0, index) - va), Math.abs(nodeVoltage(r, 'C2', 0, index) - vb)];
  }));
  assertConvergence(errors, 0.02, 'N2 voltage');
  for (const result of runs) assertNonIncreasingEnergy(result, (r, index) => {
    const va = nodeVoltage(r, 'C1', 0, index), vb = nodeVoltage(r, 'C2', 0, index);
    return 0.5 * (1e-6 * va ** 2 + 2e-6 * vb ** 2 + 3e-6 * (va - vb) ** 2);
  }, 'N2');
});

function sineCircuit(phase = '0', ic = '5', reverseSource = false) {
  return circuitFromBranches([
    ['C1', 'C', 'a', '0', { value: '1u', ic }],
    ['R1', 'R', 'a', '0', { value: '1k' }],
    ['V1', 'V', reverseSource ? '0' : 'a', reverseSource ? 'a' : '0', { mode: 'SIN', dc: '0', offset: '5', amplitude: '2', frequency: '1k', phase, acMagnitude: '7', acPhase: '23' }],
  ]);
}

test('CIRCUIT-008 N3: SIN initial derivative, phase, direction and dt convergence', () => {
  const circuit = sineCircuit();
  const acBefore = structuredClone(circuit.components.find((item) => item.id === 'V1').props);
  const initial = simulateTransient(circuit, { start: 0, end: '10u', step: '10u' });
  const i = initial.points[0].componentCurrents;
  closeI(i.C1, 0.0125663706143592, 'SIN IC(0)'); closeI(i.R1, 0.005, 'SIN IR(0)'); closeI(i.V1, -(0.0125663706143592 + 0.005), 'SIN IV(0)');
  kcl(i.C1 + i.R1 + i.V1, [i.C1, i.R1, i.V1], 'SIN KCL');
  assert.deepEqual(circuit.components.find((item) => item.id === 'V1').props, acBefore, 'transient mutated SIN/AC fields');
  const phase = simulateTransient(sineCircuit('90', '7'), { start: 0, end: '10u', step: '10u' });
  closeI(phase.points[0].componentCurrents.C1, 0, 'phase90 IC(0)');
  const reversed = simulateTransient(sineCircuit('0', '-5', true), { start: 0, end: '10u', step: '10u' });
  closeV(nodeVoltage(reversed, 'C1'), -5, 'reversed V(0)');
  closeI(reversed.points[0].componentCurrents.C1, -i.C1, 'reversed capacitor current');
  closeI(reversed.points[0].componentCurrents.R1, -i.R1, 'reversed resistor current');
  const runs = ['10u', '5u', '2.5u'].map((step) => simulateTransient(sineCircuit(), { start: 0, end: '1m', step }));
  const errors = runs.map((result) => maxError(result, (r, index) => {
    const expected = 1e-6 * 4 * Math.PI * 1000 * Math.cos(2 * Math.PI * 1000 * r.xValues[index]);
    return [Math.abs(r.points[index].componentCurrents.C1 - expected)];
  }));
  assertConvergence(errors, 1e-4, 'N3 capacitor current');
});

test('CIRCUIT-008 N4: contradictory ICs reject and order/orientation preserve physical solution', () => {
  const badParallel = parallel(); badParallel.components.find((item) => item.id === 'C2').props.ic = '4';
  assert.throws(() => simulateTransient(badParallel, { start: 0, end: '10u', step: '10u' }), (error) => error.code === 'INITIAL_CONDITION_CONFLICT');
  const badTriangle = triangle(); badTriangle.components.find((item) => item.id === 'C3').props.ic = '1';
  assert.throws(() => simulateTransient(badTriangle, { start: 0, end: '10u', step: '10u' }), (error) => error.code === 'INITIAL_CONDITION_CONFLICT');
  const reference = simulateTransient(parallel(), { start: 0, end: '100u', step: '10u' });
  const reordered = parallel(); reordered.components.reverse();
  const reorderedResult = simulateTransient(reordered, { start: 0, end: '100u', step: '10u' });
  const flipped = parallel(); const c1 = flipped.components.find((item) => item.id === 'C1'); c1.props.ic = '-5';
  // The fixture builder deliberately reuses endpoint objects within a net; clone
  // before flipping so the test changes each serialized endpoint exactly once.
  flipped.wires = flipped.wires.map((wire) => ({
    ...wire,
    a: { ...wire.a, ...(wire.a.componentId === 'C1' ? { pin: 1 - wire.a.pin } : {}) },
    b: { ...wire.b, ...(wire.b.componentId === 'C1' ? { pin: 1 - wire.b.pin } : {}) },
  }));
  const flippedResult = simulateTransient(flipped, { start: 0, end: '100u', step: '10u' });
  for (let index = 0; index < reference.points.length; index += 1) {
    closeV(nodeVoltage(reorderedResult, 'R1', 0, index), nodeVoltage(reference, 'R1', 0, index), `order V ${index}`);
    closeV(nodeVoltage(flippedResult, 'R1', 0, index), nodeVoltage(reference, 'R1', 0, index), `flip V ${index}`);
    closeI(flippedResult.points[index].componentCurrents.C1, -reference.points[index].componentCurrents.C1, `flip I ${index}`);
  }
});

test('CIRCUIT-008 N5: redundant capacitor derivative with OPAMP is explicitly unsupported', () => {
  const circuit = parallel();
  circuit.components.push({ id: 'U1', type: 'OPAMP', props: { ref: 'U1', gain: '100k' } }, { id: 'RL', type: 'R', props: { ref: 'RL', value: '1k' } });
  circuit.wires.push(
    { id: 'WU0', a: { componentId: 'U1', pin: 0 }, b: { componentId: 'G1', pin: 0 } },
    { id: 'WU1', a: { componentId: 'U1', pin: 1 }, b: { componentId: 'G1', pin: 0 } },
    { id: 'WU2', a: { componentId: 'U1', pin: 2 }, b: { componentId: 'RL', pin: 0 } },
    { id: 'WU3', a: { componentId: 'RL', pin: 1 }, b: { componentId: 'G1', pin: 0 } },
  );
  assert.throws(() => simulateTransient(circuit, { start: 0, end: '10u', step: '10u' }), (error) => error.code === 'INITIAL_DERIVATIVE_UNSUPPORTED');
});
