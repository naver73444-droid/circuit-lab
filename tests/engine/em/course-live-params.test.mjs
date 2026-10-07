import test from 'node:test';
import assert from 'node:assert/strict';
import { EXPERIMENTS, getExperiment } from '../../../src/em-course-registry.js';
import { formatParam, paramSpec, parseParam, rangeFromValue, shortLabel, valueFromRange } from '../../../src/em-course-params.js';
import { advanceTime, clampTime, instantProfiles, SWEEP_SECONDS, TIME_EXPERIMENTS, timeSpec, timeTrace } from '../../../src/em-course-time.js';

const defaults = definition => Object.fromEntries(definition.parameters.map(p => [p.key, p.initial]));
const parameterOf = (id, key) => getExperiment(id).parameters.find(p => p.key === key);

test('every parameter of all 43 experiments gets a usable control, and its example value is representable', () => {
  assert.equal(EXPERIMENTS.length, 43); // 23 original + 20 Hayt Ch.8 lecture experiments
  for (const definition of EXPERIMENTS) {
    for (const parameter of definition.parameters) {
      const spec = paramSpec(parameter);
      assert.ok(['select', 'range', 'number'].includes(spec.kind), `${definition.id}.${parameter.key}`);
      assert.ok(spec.label.length > 0 && !/s[(（]/.test(spec.label), `short label of ${parameter.key}: "${spec.label}"`); // a parenthetical note moves to spec.note
      if (spec.kind === 'range') {
        assert.ok(spec.lo < spec.hi && spec.lo >= parameter.min && spec.hi <= parameter.max, `${parameter.key} slider range`);
        const back = valueFromRange(spec, rangeFromValue(spec, parameter.initial));
        const tolerance = 1e-3 * Math.max(Math.abs(parameter.initial), 1e-12);
        assert.ok(Math.abs(back - parameter.initial) <= tolerance, `${parameter.key}: ${parameter.initial} -> ${back}`);
      }
      if (spec.kind === 'select') assert.ok(spec.options.some(([value]) => value === parameter.initial), `${parameter.key} offers its default`);
      const typed = parseParam(spec, formatParam(spec, parameter.initial));
      assert.equal(typed.ok, true, `${definition.id}.${parameter.key}: ${typed.error}`);
      assert.ok(Math.abs(typed.value - parameter.initial) <= 1e-4 * Math.max(Math.abs(parameter.initial), 1e-12));
    }
  }
});

test('every slider position of every parameter can be evaluated (invalid combinations are reported, not crashed)', () => {
  for (const definition of EXPERIMENTS) {
    const base = defaults(definition);
    for (const parameter of definition.parameters) {
      const spec = paramSpec(parameter);
      if (spec.kind !== 'range') continue;
      for (const t of [0, 0.25, 0.5, 0.75, 1]) {
        const params = { ...base, [parameter.key]: valueFromRange(spec, t) };
        assert.ok(Object.values(params).every(Number.isFinite), `${definition.id}.${parameter.key} stays finite`);
        try { definition.evaluate(params, definition.probeDefault); } catch { /* a thrown validation is caught by the course */ }
      }
    }
  }
});

test('slider scales: log is geometric, linear is arithmetic, integers stay integers', () => {
  const radius = paramSpec(parameterOf('gauss-point', 'radius'));
  assert.equal(radius.scale, 'log');
  const middle = Math.sqrt(radius.lo * radius.hi);
  assert.ok(Math.abs(valueFromRange(radius, 0.5) - middle) / middle < 1e-3);
  const turns = paramSpec(parameterOf('faraday-loop', 'turns'));
  for (const t of [0, 0.13, 0.5, 0.77, 1]) assert.ok(Number.isInteger(valueFromRange(turns, t)));
  const theta = paramSpec(parameterOf('faraday-loop', 'theta'));
  assert.equal(theta.scale, 'linear');
  assert.equal(valueFromRange(theta, 0), -Math.PI);
  assert.equal(valueFromRange(theta, 1), Math.PI);
  const charge = paramSpec(parameterOf('gauss-point', 'charge'));
  assert.ok(charge.lo < 0 && charge.hi > 0, 'a signed parameter gets a symmetric slider');
});

test('choice parameters and zero-valued ones', () => {
  assert.equal(paramSpec(parameterOf('faraday-loop', 'closedCircuit')).kind, 'select');
  assert.equal(paramSpec(parameterOf('transmission-lossless', 'loadMode')).options.length, 3);
  assert.equal(paramSpec(parameterOf('dielectric-interface', 'sigmaFree')).kind, 'number', 'an example value of 0 has no meaningful slider');
  assert.equal(paramSpec(parameterOf('ampere-wire', 'wireRadius')).kind, 'number');
  assert.equal(shortLabel('내부 도체 반경 a (축 기준)'), '내부 도체 반경 a');
  assert.equal(shortLabel('제어: 0=고정 Q, 1=고정 V'), '제어');
});

test('typed values: display units, ranges, integers and rejects (no clamping)', () => {
  const area = paramSpec(parameterOf('faraday-loop', 'area'));
  assert.deepEqual(parseParam(area, '200'), { ok: true, value: 0.02 });
  assert.equal(parseParam(area, '').ok, false);
  assert.equal(parseParam(area, 'abc').ok, false);
  assert.match(parseParam(area, '-1').error, /범위 밖/);
  assert.match(parseParam(area, '1e9').error, /범위 밖/);
  const turns = paramSpec(parameterOf('faraday-loop', 'turns'));
  assert.match(parseParam(turns, '2.5').error, /정수/);
  assert.deepEqual(parseParam(turns, '60'), { ok: true, value: 60 });
  assert.equal(formatParam(area, 0.02), '200');
});

test('exactly the five time-dependent experiments have a scrubber, and every time in it is valid', () => {
  const found = EXPERIMENTS.filter(d => timeSpec(d, defaults(d))).map(d => d.id);
  assert.deepEqual(found.sort(), [...TIME_EXPERIMENTS].sort());
  for (const id of TIME_EXPERIMENTS) {
    const definition = getExperiment(id), params = defaults(definition), spec = timeSpec(definition, params);
    assert.ok(spec.max > spec.min && spec.max <= parameterOf(id, 'time').max);
    for (let i = 0; i <= 20; i += 1) {
      const t = spec.min + (spec.max - spec.min) * i / 20;
      const result = definition.evaluate({ ...params, time: t }, definition.probeDefault);
      assert.equal(result.status, 'valid', `${id} at t=${t}: ${result.reason}`);
    }
  }
});

test('scrubber ranges follow the parameters', () => {
  const faraday = getExperiment('faraday-loop');
  assert.ok(Math.abs(timeSpec(faraday, { ...defaults(faraday), omega: 2 * Math.PI }).max - 2) < 1e-12, 'two periods of B(t)');
  assert.equal(timeSpec(faraday, { ...defaults(faraday), omega: 0 }).max, 1);
  const rod = getExperiment('motional-rod'), rodParams = defaults(rod);
  assert.ok(Math.abs(timeSpec(rod, { ...rodParams, velocity: 3, x0: 0.2, railLength: 2 }).max - 0.985 * 1.8 / 3) < 1e-12);
  assert.ok(Math.abs(timeSpec(rod, { ...rodParams, velocity: -2, x0: 1, railLength: 2 }).max - 0.985 * 0.5) < 1e-12);
  assert.equal(timeSpec(rod, { ...rodParams, velocity: 0 }).max, 1);
  const wave = getExperiment('wave-medium');
  assert.ok(Math.abs(timeSpec(wave, { ...defaults(wave), frequency: 1e8 }).max - 2e-8) < 1e-20);
  assert.equal(timeSpec(wave, { ...defaults(wave), frequency: 1 }).max, 1, 'limited by the parameter maximum');
  assert.equal(timeSpec(getExperiment('coax-current'), {}), null);
});

test('playback advances through the sweep and wraps', () => {
  const spec = { min: 0, max: 8 };
  assert.equal(advanceTime(spec, 0, 1), 8 / SWEEP_SECONDS);
  assert.equal(advanceTime(spec, 7.5, 1), 1.5, 'wraps past the end');
  assert.equal(clampTime(spec, 9), 8);
  assert.equal(clampTime(spec, -1), 0);
});

test('emf(t) traces exist for induction and not for waves', () => {
  const faraday = getExperiment('faraday-loop'), params = defaults(faraday), spec = timeSpec(faraday, params);
  const trace = timeTrace(faraday, params, spec);
  assert.equal(trace.points.length, 120);
  assert.equal(trace.unit, 'V');
  const amplitude = params.turns * params.area * params.omega * Math.abs(params.B0) * Math.cos(params.theta);
  const peak = Math.max(...trace.points.map(p => Math.abs(p.value)));
  assert.ok(Math.abs(peak - amplitude) / amplitude < 0.02, 'peak emf = N A omega B0 cos(theta)');
  const rod = getExperiment('motional-rod'), rodParams = defaults(rod);
  const rodTrace = timeTrace(rod, rodParams, timeSpec(rod, rodParams));
  assert.ok(rodTrace.points.every(p => Math.abs(p.value - rodTrace.points[0].value) < 1e-9), 'constant velocity: constant emf');
  const wave = getExperiment('wave-medium');
  assert.equal(timeTrace(wave, defaults(wave), timeSpec(wave, defaults(wave))), null);
});

test('instantaneous profiles follow the clock and stay inside the amplitude envelope', () => {
  const wave = getExperiment('wave-medium'), params = defaults(wave);
  const envelope = wave.profile({ ...params }, 81)[0].points;
  const domain = [envelope[0].coordinate, envelope.at(-1).coordinate];
  const at = t => instantProfiles(wave, { ...params, time: t }, domain)[0];
  const first = at(0), later = at(2.5e-9);
  assert.equal(first.points.length, 161);
  assert.ok(first.points.every(p => Math.abs(p.value) <= params.amplitude + 1e-9), 'inside the envelope');
  assert.notDeepEqual(first.points.map(p => p.value), later.points.map(p => p.value), 'the wave moves');
  // a travelling wave is a shifted copy: the value at z + v dt at time t + dt equals the value at z at time t
  const velocity = 1.49896229e8 / 1, dt = 1e-9, shift = velocity * dt;
  const zero = first.points.find(p => Math.abs(p.coordinate) < 0.01), moved = at(dt);
  const target = moved.points.reduce((best, p) => (Math.abs(p.coordinate - (zero.coordinate + shift)) < Math.abs(best.coordinate - (zero.coordinate + shift)) ? p : best));
  assert.ok(Math.abs(target.value - zero.value) < 0.35, `${target.value} vs ${zero.value}`);
  const line = getExperiment('transmission-lossless'), lineParams = defaults(line);
  const volts = instantProfiles(line, lineParams, [-1, 0])[0];
  const probe = line.evaluate({ ...lineParams }, [0, 0, -0.25]).scalars.find(s => s.key === 'voltage').value;
  const sampled = volts.points.reduce((best, p) => (Math.abs(p.coordinate + 0.25) < Math.abs(best.coordinate + 0.25) ? p : best));
  assert.ok(Math.abs(sampled.value - probe) < 0.05 * Math.abs(probe) + 0.05);
  assert.equal(instantProfiles(getExperiment('coax-current'), {}, [0, 1]), null);
  assert.equal(instantProfiles(wave, params, [1, 1]), null);
});
