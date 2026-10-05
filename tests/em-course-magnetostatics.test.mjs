import test from 'node:test';
import assert from 'node:assert/strict';
import { EXPERIMENTS } from '../src/em-course-magnetostatics.js';
import { MU0 } from '../src/em-course-constants.js';

const wire = EXPERIMENTS.find(experiment => experiment.id === 'wire-current');
const loop = EXPERIMENTS.find(experiment => experiment.id === 'loop-axis');
const loopParams = Object.freeze({ radius: .1, current: 2 });
const FIXTURE = Object.freeze({ wireBx: -9.59999999873e-6, wireBy: 7.19999999905e-6,
  loopCenter: 1.25663706127e-5, loopAtRadius: 4.44288293757e-6 });
function near(actual, expected, absolute = 1e-18, relative = 1e-10) {
  assert.ok(Number.isFinite(actual));
  assert.ok(Math.abs(actual - expected) <= absolute + relative * Math.abs(expected), `${actual} != ${expected}`);
}
function excluded(result, status) {
  assert.equal(result.status, status);
  assert.ok(result.reason);
  assert.deepEqual(result.vectors, {});
  assert.deepEqual(result.scalars, []);
}

test('new course MU0 and experiment metadata agree with contract', () => {
  assert.equal(MU0, 1.25663706127e-6);
  assert.deepEqual(EXPERIMENTS.map(item => item.id), ['wire-current', 'loop-axis', 'coax-current', 'coax-current-thick', 'coax-current-surface']);
  assert.equal(loop.view.kind, 'axis-only');
  assert.deepEqual(loop.view.probeAxes, [2]);
  for (const experiment of EXPERIMENTS) {
    assert.equal(experiment.topic, 'magnetostatics');
    for (const key of ['assumptions', 'validity', 'singularities', 'formulas', 'references']) assert.ok(experiment[key].length > 0);
    assert.equal(experiment.evaluate(Object.fromEntries(experiment.parameters.map(item => [item.key, item.initial])), experiment.probeDefault).status, 'valid');
  }
});

test('straight +z current independent signed vector fixture and H', () => {
  const result = wire.evaluate({ current: 3 }, [.03, .04, 0]);
  assert.equal(result.status, 'valid');
  near(result.vectors.B[0], FIXTURE.wireBx);
  near(result.vectors.B[1], FIXTURE.wireBy);
  assert.equal(result.vectors.B[2], 0);
  near(result.vectors.H[0], -7.639437268410976, 1e-10);
  near(result.vectors.H[1], 5.729577951308232, 1e-10);
});

test('wire circulation follows right hand rule, current sign and z invariance', () => {
  const positiveX = wire.evaluate({ current: 3 }, [.05, 0, 0]);
  assert.ok(positiveX.vectors.B[1] > 0);
  near(positiveX.vectors.B[0], 0);
  const positiveY = wire.evaluate({ current: 3 }, [0, .05, 999]);
  assert.ok(positiveY.vectors.B[0] < 0);
  near(positiveY.vectors.B[1], 0);
  const negative = wire.evaluate({ current: -3 }, [.03, .04, -9]);
  near(negative.vectors.B[0], -FIXTURE.wireBx);
  near(negative.vectors.B[1], -FIXTURE.wireBy);
  assert.deepEqual(wire.evaluate({ current: 3 }, [.03, .04, 0]).vectors,
    wire.evaluate({ current: 3 }, [.03, .04, 42]).vectors);
});

test('straight current axis singularity is explicit including zero current', () => {
  for (const current of [3, 0, -3]) for (const z of [0, 1]) excluded(wire.evaluate({ current }, [0, 0, z]), 'singular');
  const nearWire = wire.evaluate({ current: 3 }, [1e-12, 0, 0]);
  assert.equal(nearWire.status, 'valid');
  near(nearWire.vectors.B[1], 599999.9999206384, 1e-7);
  assert.ok(nearWire.vectors.B[1] > 1e5); // No renderer clamp enters the physics output.
});

test('loop center and z=+-R independent SI fixture', () => {
  const center = loop.evaluate(loopParams, [0, 0, 0]);
  assert.equal(center.status, 'valid');
  near(center.vectors.B[2], FIXTURE.loopCenter);
  near(center.vectors.H[2], 10, 1e-12);
  for (const z of [.1, -.1]) {
    const result = loop.evaluate(loopParams, [0, 0, z]);
    assert.equal(result.status, 'valid');
    near(result.vectors.B[2], FIXTURE.loopAtRadius);
    assert.equal(result.vectors.B[0], 0);
    assert.equal(result.vectors.B[1], 0);
    near(result.vectors.H[2], 3.5355339059327378, 1e-12);
  }
});

test('counterclockwise positive loop I gives same +Bz on both sides; reversing I reverses B/H', () => {
  for (const z of [0, .03, .1, 1]) {
    const positive = loop.evaluate(loopParams, [0, 0, z]);
    const reflected = loop.evaluate(loopParams, [0, 0, -z]);
    const negative = loop.evaluate({ ...loopParams, current: -2 }, [0, 0, z]);
    assert.ok(positive.vectors.B[2] > 0);
    assert.deepEqual(positive.vectors, reflected.vectors);
    near(negative.vectors.B[2], -positive.vectors.B[2]);
    near(negative.vectors.H[2], -positive.vectors.H[2], 1e-12);
  }
});

test('axis formula refuses every nonzero off-axis component and identifies loop wire', () => {
  for (const point of [[.01, 0, .1], [0, .01, .1], [1e-30, 0, 0], [.1, 0, .001], [0, .02, -.1]]) {
    excluded(loop.evaluate(loopParams, point), 'unsupported');
  }
  excluded(loop.evaluate(loopParams, [.1, 0, 0]), 'singular');
  excluded(loop.evaluate(loopParams, [0, -.1, 0]), 'singular');
  excluded(loop.evaluate({ ...loopParams, current: 0 }, [.01, 0, .1]), 'unsupported');
});

test('zero drive has real zero fields in supported regions and preserves exclusion statuses', () => {
  for (const [experiment, params, point] of [[wire, { current: 0 }, [.03, .04, 0]],
    [loop, { radius: .1, current: 0 }, [0, 0, 0]]]) {
    const result = experiment.evaluate(params, point);
    assert.equal(result.status, 'valid');
    assert.equal(Math.hypot(...result.vectors.B), 0);
    assert.equal(Math.hypot(...result.vectors.H), 0);
  }
});

test('reject nonfinite/missing/non-numeric params, nonpositive radius and malformed probes', () => {
  for (const experiment of EXPERIMENTS) {
    for (const params of [null, [], {}, { radius: .1, current: NaN }, { radius: .1, current: Infinity },
      { radius: .1, current: '3' }, { radius: .1, current: 3, extra: Infinity }]) {
      excluded(experiment.evaluate(params, experiment.probeDefault), 'invalid');
    }
    for (const point of [null, [], [0, 0], [0, 0, 0, 0], [NaN, 0, 0], [0, Infinity, 0], [0, 0, '1']]) {
      excluded(experiment.evaluate({ radius: .1, current: 2 }, point), 'invalid');
    }
  }
  for (const radius of [0, -.1, NaN, Infinity, undefined]) excluded(loop.evaluate({ radius, current: 2 }, [0, 0, 0]), 'invalid');
});

test('overflow and underflow outside finite numeric range are invalid without synthetic fields', () => {
  excluded(wire.evaluate({ current: Number.MAX_VALUE }, [Number.MIN_VALUE, 0, 0]), 'invalid');
  excluded(wire.evaluate({ current: 3 }, [Number.MAX_VALUE, Number.MAX_VALUE, 0]), 'invalid');
  excluded(loop.evaluate({ current: Number.MAX_VALUE, radius: Number.MIN_VALUE }, [0, 0, 0]), 'invalid');
  excluded(loop.evaluate({ current: 2, radius: .1 }, [0, 0, Number.MAX_VALUE]), 'invalid');
});

test('independent wire and full-vector loop quadrature pass normal, reversed and zero drives', () => {
  for (const sign of [1, -1, 0]) {
    for (const [experiment, params, length] of [[wire, { current: sign * 3 }, 2],
      [loop, { radius: .1, current: sign * 2 }, 9]]) {
      const rows = experiment.verify(params);
      assert.equal(rows.length, length);
      for (const row of rows) {
        assert.equal(row.status, 'pass', `${row.label}: ${row.reason}`);
        assert.ok(row.method.includes('Biot'));
        assert.ok(Number.isFinite(row.actual));
        assert.ok(Number.isFinite(row.expected));
      }
    }
  }
});

test('invalid verify never produces pass rows', () => {
  for (const [experiment, params] of [[wire, { current: Infinity }], [loop, { current: 2, radius: 0 }],
    [loop, { current: Number.MAX_VALUE, radius: Number.MIN_VALUE }]]) {
    const rows = experiment.verify(params);
    assert.ok(rows.length > 0);
    assert.ok(rows.every(row => row.status === 'skipped' && row.reason));
  }
});
