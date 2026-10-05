import test from 'node:test';
import assert from 'node:assert/strict';
import { EXPERIMENTS } from '../src/em-course-electrostatics.js';
import { EPS0 } from '../src/em-course-constants.js';

const models = Object.fromEntries(EXPERIMENTS.map(model => [model.id, model]));
const defaults = id => Object.fromEntries(models[id].parameters.map(p => [p.key, p.initial]));
const scalar = (result, key) => result.scalars.find(row => row.key === key).value;
const schema = ['status', 'title', 'reason', 'givens', 'assumptions', 'conditions', 'laws', 'steps', 'answers', 'regions', 'boundaries', 'limitations'].sort();
const answerBy = (data, quantity) => data.answers.find(row => row.quantity === quantity);
const dim = {
  λ: [1, 0, -1], σ: [1, 0, -2], ε: [1, -1, -1],
  Q: [1, 0, 0], V: [0, 1, 0], E: [0, 1, -1], Eρ: [0, 1, -1],
  r: [0, 0, 1], rRef: [0, 0, 1], r1: [0, 0, 1], r2: [0, 0, 1],
  a: [0, 0, 1], b: [0, 0, 1], x: [0, 0, 1], y: [0, 0, 1], z: [0, 0, 1],
  ρ: [0, 0, 1], u: [0, 0, 1], v: [0, 0, 1], Ra: [0, 0, 1], Rb: [0, 0, 1],
  L: [0, 0, 1], R: [0, 0, 1], zRef: [0, 0, 1], A: [0, 0, 2], d: [0, 0, 1],
};
const units = { 'V/m': [0, 1, -1], 'C/m²': [1, 0, -2], V: [0, 1, 0],
  C: [1, 0, 0], F: [1, -1, 0], J: [1, 1, 0] };
const dimensionless = [0, 0, 0];
const plusDims = (a, b, sign = 1) => (a || dimensionless).map((v, i) => v + sign * (b || dimensionless)[i]);
function near(actual, expected, absolute = 1e-9, relative = 1e-9) {
  assert.ok(Number.isFinite(actual));
  assert.ok(Math.abs(actual - expected) <= absolute + relative * Math.abs(expected),
    actual + ' ≠ ' + expected);
}

// Test-only, bounded expression interpreter for this template's displayed scalar answers.
// No eval/Function/CAS or user text is executed. It independently checks unit algebra.
function substitute(formula, values) {
  const expression = formula.slice(formula.indexOf(' = ') + 3).replaceAll('−', '-')
    .replaceAll('·', '*').replaceAll('²', '^2');
  const tokens = expression.match(/(?:\d+(?:\.\d+)?|[\p{L}_][\p{L}\p{N}_]*|[()+*/^\-])/gu) || [];
  assert.equal(tokens.join(''), expression.replaceAll(' ', ''), formula);
  let cursor = 0;
  const peek = () => tokens[cursor];
  const take = () => tokens[cursor++];
  const record = (value, dimensions) => ({ value, dimensions });
  const add = () => {
    let left = multiply();
    while (peek() === '+' || peek() === '-') {
      const op = take(), right = multiply();
      if (left.dimensions && right.dimensions) assert.deepEqual(left.dimensions, right.dimensions, 'add/sub unit mismatch: ' + formula);
      left = record(op === '+' ? left.value + right.value : left.value - right.value, left.dimensions || right.dimensions);
    }
    return left;
  };
  const multiply = () => {
    let left = unary();
    while (peek() === '*' || peek() === '/') {
      const op = take(), right = unary();
      left = record(op === '*' ? left.value * right.value : left.value / right.value,
        plusDims(left.dimensions, right.dimensions, op === '*' ? 1 : -1));
    }
    return left;
  };
  const unary = () => {
    if (peek() === '+' || peek() === '-') {
      const op = take(), child = unary();
      return record(op === '-' ? -child.value : child.value, child.dimensions);
    }
    return power();
  };
  const power = () => {
    let base = primary();
    if (peek() === '^') {
      take(); const exponent = unary();
      assert.deepEqual(exponent.dimensions || dimensionless, dimensionless);
      base = record(base.value ** exponent.value, (base.dimensions || dimensionless).map(v => v * exponent.value));
    }
    return base;
  };
  const primary = () => {
    const token = take();
    if (token === '(') {
      const child = add(); assert.equal(take(), ')'); return child;
    }
    if (/^\d/.test(token)) return record(Number(token), Number(token) === 0 ? null : dimensionless);
    if (peek() === '(') {
      take(); const argument = add(); assert.equal(take(), ')');
      if (token === 'sqrt') return record(Math.sqrt(argument.value), argument.dimensions.map(v => v / 2));
      if (token === 'abs') return record(Math.abs(argument.value), argument.dimensions);
      if (token === 'sign') return record(Math.sign(argument.value), dimensionless);
      assert.ok(['ln', 'asinh'].includes(token), 'unsupported test operator ' + token);
      assert.deepEqual(argument.dimensions || dimensionless, dimensionless, 'dimensioned logarithm: ' + formula);
      return record(token === 'ln' ? Math.log(argument.value) : Math.asinh(argument.value), dimensionless);
    }
    if (token === 'π') return record(Math.PI, dimensionless);
    assert.ok(Object.hasOwn(values, token), 'missing substitution ' + token + ' for ' + formula);
    assert.ok(dim[token], 'missing dimension of ' + token);
    return record(values[token], dim[token]);
  };
  const result = add();
  assert.equal(cursor, tokens.length);
  return result;
}
function checkAnswer(data, quantity, values, expected, absolute = 1e-9) {
  const row = answerBy(data, quantity);
  assert.ok(row, 'missing answer ' + quantity);
  const actual = substitute(row.formula, values);
  if (actual.dimensions) assert.deepEqual(actual.dimensions, units[row.unit], row.formula + ' units ' + row.unit);
  near(actual.value, expected, absolute);
  return actual.value;
}
function branches(model) {
  let rows = [{}];
  for (const control of model.symbolicControls) {
    rows = rows.flatMap(options => control.choices.map(choice => ({ ...options, [control.key]: choice.value })));
  }
  return rows;
}

test('all five definitions expose the exact common schema and structural-only controls', () => {
  let count = 0, supported = 0, unsupported = 0;
  for (const model of EXPERIMENTS) {
    assert.ok(model.symbolicControls.length > 0);
    const { symbolic } = model;
    assert.deepEqual(symbolic(), symbolic(Object.fromEntries(model.symbolicControls.map(c => [c.key, c.initial]))));
    for (const control of model.symbolicControls) {
      assert.ok(control.label && control.choices.some(c => c.value === control.initial));
      assert.equal(new Set(control.choices.map(c => c.value)).size, control.choices.length);
    }
    for (const options of branches(model)) {
      const before = structuredClone(options), data = symbolic(options);
      count++;
      assert.deepEqual(options, before);
      assert.deepEqual(Object.keys(data).sort(), schema);
      assert.ok(data.title && data.limitations.some(text => text.includes('범용 CAS')));
      assert.ok(['supported', 'unsupported'].includes(data.status));
      for (const key of schema.filter(key => !['status', 'title', 'reason'].includes(key))) assert.ok(Array.isArray(data[key]));
      for (const row of data.givens) for (const key of ['symbol', 'meaning', 'unit', 'constraint']) assert.equal(typeof row[key], 'string');
      for (const row of data.laws) for (const key of ['name', 'formula']) assert.equal(typeof row[key], 'string');
      for (const row of data.steps) for (const key of ['title', 'formula', 'explanation']) assert.equal(typeof row[key], 'string');
      for (const row of data.answers) for (const key of ['quantity', 'formula', 'unit', 'direction']) assert.equal(typeof row[key], 'string');
      for (const row of [...data.regions, ...data.boundaries]) for (const key of ['condition', 'formula', 'explanation']) assert.equal(typeof row[key], 'string');
      const text = JSON.stringify(data);
      assert.ok(!/<\/?[a-z]+>/i.test(text));
      assert.ok(!text.includes('8.8541878188') && !text.includes('2e-9'));
      if (data.status === 'supported') {
        supported++;
        assert.equal(data.reason, '');
        assert.ok(data.laws.length && data.steps.length && data.answers.length && data.conditions.length);
      } else {
        unsupported++;
        assert.ok(data.reason);
        assert.deepEqual(data.answers, []);
      }
    }
  }
  assert.equal(count, 26);
  assert.equal(supported, 22);
  assert.equal(unsupported, 4);
});

for (const model of EXPERIMENTS) {
  test(model.id + ': no physical sample inputs or invalid structural selections accepted', () => {
    for (const options of [null, [], 1, 'text', { lambda: 2e-9 }, { epsilonR: 3 }, { point: [0, 0, 1] },
      { [model.symbolicControls[0].key]: NaN }, { [model.symbolicControls[0].key]: -1 },
      { [model.symbolicControls[0].key]: '0' }, { [model.symbolicControls[0].key]: undefined }]) {
      const data = model.symbolic(options);
      assert.equal(data.status, 'unsupported');
      assert.ok(data.reason);
      assert.deepEqual(data.answers, []);
    }
    assert.equal(model.symbolic(Object.create(null)).status, 'supported');
  });
}

for (const reference of [0, 1]) {
  test('infinite line reference=' + reference + ': displayed formulas substitute fixtures, signs, dimensions', () => {
    const data = models['line-infinite'].symbolic({ reference });
    for (const sign of [-1, 0, 1]) {
      const p = { ...defaults('line-infinite'), epsilonR: 3, lambda: sign * 2e-9 };
      const values = { λ: p.lambda, ε: EPS0 * p.epsilonR, r: 0.04, rRef: 0.1, r1: 0.1, r2: 0.04 };
      const actual = models['line-infinite'].evaluate(p, [0.04, 0, 0]);
      checkAnswer(data, 'Er', values, actual.vectors.E[0]);
      checkAnswer(data, 'Dr', values, actual.vectors.D[0], 1e-20);
      const V = checkAnswer(data, reference === 0 ? 'V' : 'ΔV', values, scalar(actual, 'potential'));
      near(actual.vectors.E[0], sign * 299.585059539, 1e-8);
      near(V, sign * 10.9802805385);
    }
    assert.ok(data.answers[0].direction.includes('(x/r,y/r,0)'));
  });
}
test('infinite line infinity condition reports divergence without a claimed answer', () => {
  const data = models['line-infinite'].symbolic({ reference: 2 });
  assert.equal(data.status, 'unsupported');
  assert.ok(data.reason.includes('발산') && data.steps.some(row => row.formula.includes('∞')));
  assert.deepEqual(data.answers, []);
  assert.ok(data.conditions.includes('λ≠0'));
});

for (const geometry of [0, 1, 2, 3]) {
  test('finite line geometry=' + geometry + ': general and special displayed expressions match vector evaluator', () => {
    const data = models['line-finite'].symbolic({ geometry });
    const point = geometry === 0 ? [0.07, 0.04, 0.08] : geometry === 1 ? [0, 0, 0.1] : geometry === 2 ? [0.3, 0, 0] : [-0.3, 0, 0];
    for (const sign of [-1, 0, 1]) {
      const p = { ...defaults('line-finite'), lambda: sign * 2e-9 };
      const [x, y, z] = point, ρ = Math.hypot(y, z), u = x - p.xStart, v = x - p.xEnd;
      const values = { λ: p.lambda, ε: EPS0, a: p.xStart, b: p.xEnd, x, y, z, ρ, u, v, Ra: Math.hypot(u, ρ), Rb: Math.hypot(v, ρ), L: p.xEnd - p.xStart };
      const actual = models['line-finite'].evaluate(p, point);
      checkAnswer(data, 'Ex', values, actual.vectors.E[0]);
      if (geometry < 2) values.Eρ = checkAnswer(data, 'Eρ', values, Math.hypot(actual.vectors.E[1], actual.vectors.E[2]) * sign);
      checkAnswer(data, 'Ey', values, actual.vectors.E[1]);
      checkAnswer(data, 'Ez', values, actual.vectors.E[2]);
      checkAnswer(data, 'V', values, scalar(actual, 'potential'));
      for (let axis = 0; axis < 3; axis++) checkAnswer(data, 'D', { ...values, E: actual.vectors.E[axis] }, actual.vectors.D[axis], 1e-20);
      if (geometry === 1) near(actual.vectors.E[2], sign * 254.206352571, 1e-8);
    }
  });
}
test('finite-line structural conditions change steps and directions without claiming symmetry at a general point', () => {
  const general = models['line-finite'].symbolic(), bisector = models['line-finite'].symbolic({ geometry: 1 });
  assert.notEqual(answerBy(general, 'Ex').formula, answerBy(bisector, 'Ex').formula);
  assert.ok(bisector.conditions.includes('ρ>0, x=(a+b)/2'));
  const left = models['line-finite'].symbolic({ geometry: 3 }), right = models['line-finite'].symbolic({ geometry: 2 });
  assert.ok(answerBy(left, 'Ex').direction.includes('−x̂'));
  assert.ok(answerBy(right, 'Ex').direction.includes('+x̂'));
  const source = models['line-finite'].symbolic({ geometry: 4 });
  assert.equal(source.status, 'unsupported');
  assert.ok(source.reason.includes('특이'));
});

for (const side of [0, 1, 2]) for (const reference of [0, 1]) {
  test('sheet side=' + side + ' reference=' + reference + ': law factor, signed normal, potential and dimensions', () => {
    const data = models['sheet-infinite'].symbolic({ side, reference });
    const zs = side === 0 ? [0.03, -0.03] : [side === 1 ? 0.03 : -0.03];
    for (const z of zs) for (const sign of [-1, 0, 1]) {
      const p = { ...defaults('sheet-infinite'), sigma: sign * 4e-9, epsilonR: 2 }, zRef = -0.015;
      const values = { σ: p.sigma, ε: 2 * EPS0, z, zRef };
      const actual = models['sheet-infinite'].evaluate(p, [1, -2, z]);
      checkAnswer(data, 'Ez', values, actual.vectors.E[2]);
      checkAnswer(data, 'Dz', values, actual.vectors.D[2], 1e-20);
      const base = reference === 0 ? 0 : scalar(models['sheet-infinite'].evaluate(p, [0, 0, zRef]), 'potential');
      checkAnswer(data, 'V', values, scalar(actual, 'potential') - base);
      near(actual.vectors.E[2], sign * Math.sign(z) * 112.940906661, 1e-8);
      near(scalar(actual, 'potential'), sign * -3.38822719982);
    }
    assert.ok(data.boundaries.some(row => row.formula.includes('Dz(0+)−Dz(0−)=σ')));
    assert.ok(data.limitations.some(row => row.includes('V(∞)=0')));
  });
}
for (const side of [0, 1, 2]) for (const reference of [0, 1]) {
  test('disk side=' + side + ' reference=' + reference + ': axis-only field, center reference, signed source and units', () => {
    const data = models['disk-axis'].symbolic({ side, reference });
    const zs = side === 0 ? [0.1, -0.1] : [side === 1 ? 0.1 : -0.1];
    for (const z of zs) for (const sign of [-1, 0, 1]) {
      const p = { ...defaults('disk-axis'), sigma: sign * 1e-9 };
      const values = { σ: p.sigma, ε: EPS0, R: 0.1, z };
      const actual = models['disk-axis'].evaluate(p, [0, 0, z]);
      checkAnswer(data, 'Ez', values, actual.vectors.E[2]);
      checkAnswer(data, 'Dz', values, actual.vectors.D[2], 1e-20);
      const centerPotential = reference === 0 ? 0 : p.sigma * p.radius / (2 * EPS0);
      checkAnswer(data, 'V', values, scalar(actual, 'potential') - centerPotential);
      near(actual.vectors.E[2], sign * Math.sign(z) * 16.53981, 5e-6, 0);
    }
    assert.ok(data.conditions.includes('x=y=0'));
  });
}
test('disk axis outside is unsupported; center potential remains finite but center field is two-sided', () => {
  for (const reference of [0, 1]) {
    const outside = models['disk-axis'].symbolic({ side: 3, reference });
    assert.equal(outside.status, 'unsupported');
    assert.deepEqual(outside.answers, []);
    const data = models['disk-axis'].symbolic({ reference });
    assert.ok(data.boundaries.some(row => row.formula.includes('Ez(0+)') && row.formula.includes('Ez(0−)')));
    assert.ok(data.boundaries.some(row => row.condition === 'z=0' && row.formula.includes(reference === 0 ? 'σ·R' : 'V(0)=0')));
  }
});

for (const control of [0, 1]) for (const reference of [0, 1]) {
  test('plate control=' + control + ' reference=' + reference + ': Q/V branch, energy, voltage gauge and units', () => {
    const data = models['parallel-plate'].symbolic({ control, reference });
    for (const sign of [-1, 0, 1]) for (const epsilonR of [1, 4]) {
      const p = { ...defaults('parallel-plate'), control, epsilonR, charge: sign * 1e-9, voltage: sign * 10 };
      const z = 0.004, values = { ε: EPS0 * epsilonR, A: p.area, d: p.distance, z, Q: p.charge, V: p.voltage };
      const actual = models['parallel-plate'].evaluate(p, [0, 0, z]);
      checkAnswer(data, 'C', values, scalar(actual, 'capacitance'), 1e-20);
      checkAnswer(data, 'Ez', values, actual.vectors.E[2]);
      checkAnswer(data, 'Dz', values, actual.vectors.D[2], 1e-20);
      checkAnswer(data, control === 0 ? 'V' : 'Q', values, scalar(actual, control === 0 ? 'voltage' : 'charge'), control === 1 ? 1e-20 : 1e-9);
      const gaugeOffset = reference === 0 ? 0 : scalar(actual, 'voltage');
      checkAnswer(data, 'Φ', values, scalar(actual, 'potential') - gaugeOffset);
      checkAnswer(data, 'U', values, scalar(actual, 'energy'), 1e-20);
      assert.ok(data.boundaries.some(row => row.condition === 'z=0' && row.explanation.includes('한쪽')));
      assert.ok(data.regions.some(row => row.formula === 'unsupported'));
    }
    assert.equal(data.givens.some(g => g.symbol === 'Q'), control === 0);
    assert.equal(data.givens.some(g => g.symbol === 'V'), control === 1);
  });
}
test('changing each supported structural option changes conditions, relevant derivation and answers', () => {
  for (const model of EXPERIMENTS) {
    const initial = model.symbolic();
    for (const control of model.symbolicControls) {
      for (const choice of control.choices.filter(row => row.value !== control.initial)) {
        const changed = model.symbolic({ [control.key]: choice.value });
        if (changed.status === 'unsupported') continue;
        assert.notDeepEqual(changed.conditions, initial.conditions);
        assert.notDeepEqual(changed.steps, initial.steps);
        assert.notDeepEqual(changed.answers, initial.answers);
      }
    }
  }
});

test('symbolic finite line and disk limit formulas agree with independent total-charge limits', () => {
  const finite = models['line-finite'].symbolic({ geometry: 1 });
  const λ = 2e-9, ε = EPS0, L = 0.2, ρ = 100;
  near(substitute(answerBy(finite, 'Eρ').formula, { λ, ε, L, ρ }).value, λ * L / (4 * Math.PI * ε * ρ ** 2), 1e-12, 1e-6);
  const disk = models['disk-axis'].symbolic({ side: 2 });
  const σ = 1e-9, R = 0.1, z = -10;
  near(substitute(answerBy(disk, 'Ez').formula, { σ, ε, R, z }).value, -σ * R ** 2 / (4 * ε * z ** 2), 1e-12, 1e-4);
});
