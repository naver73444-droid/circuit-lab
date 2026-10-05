import test from 'node:test';
import assert from 'node:assert/strict';
import { EXPERIMENTS } from '../../../src/em-course-induction.js';

const byId = Object.fromEntries(EXPERIMENTS.map(e => [e.id, e]));
const defaults = e => Object.fromEntries(e.parameters.map(p => [p.key, p.initial]));
const numeric = (out, key) => out.scalars.find(s => s.key === key)?.value;
const byQuantity = {
  'Bz(t)': 'Bz', 'x(t)': 'position', 'A(t)': 'area', 'ΦB(t)': 'flux', 'Λ(t)': 'linkage',
  'ℰ(t)': 'emf', 'ℰtransformer(t)': 'transformerEmf', 'ℰmotional(t)': 'motionalEmf',
  'I(t)': 'current', 'PJ(t)': 'joulePower', 'Pext(t)': 'mechanicalPower',
  'Fmag,x(t)': 'magneticForceX', 'Fext,x(t)': 'externalForceX',
};
const units = { Bz: 'T', position: 'm', area: 'm²', flux: 'Wb', linkage: 'Wb', emf: 'V',
  transformerEmf: 'V', motionalEmf: 'V', current: 'A', joulePower: 'W', mechanicalPower: 'W',
  magneticForceX: 'N', externalForceX: 'N' };
// SI base dimensions [kg,m,s,A]. radians/turn count are dimensionless.
const dimension = { T: [1, 0, -2, -1], m: [0, 1, 0, 0], 'm²': [0, 2, 0, 0],
  Wb: [1, 2, -2, -1], V: [1, 2, -3, -1], A: [0, 0, 0, 1],
  W: [1, 2, -3, 0], N: [1, 1, -2, 0], '1': [0, 0, 0, 0] };
const variableDims = { B0: dimension.T, B: dimension.T, A: dimension['m²'], N: dimension['1'],
  theta: dimension['1'], omega: [0, 0, -1, 0], t: [0, 0, 1, 0],
  l: dimension.m, v: [0, 1, -1, 0], x0: dimension.m, L: dimension.m, R: [1, 2, -3, -2] };
function near(actual, expected, absolute = 1e-12, relative = 1e-11) {
  assert.ok(Number.isFinite(actual));
  assert.ok(Math.abs(actual - expected) <= absolute + relative * Math.abs(expected),
    'actual=' + actual + ' expected=' + expected);
}
// Test-only parser for the returned plain mathematical RHS. No eval or CAS.
// It supports only named givens, numeric constants, +,-, implicit product, /, ^, sin/cos.
function parseFormula(expression, givens) {
  const normalized = expression.replaceAll('−', '-').replaceAll('²', '^2').replaceAll('·', '*')
    .replaceAll('B₀', 'B0').replaceAll('x₀', 'x0').replaceAll('θ', 'theta').replaceAll('ω', 'omega');
  const tokens = [];
  const lexer = /\s*(?:([A-Za-z][A-Za-z0-9]*)|(\d+(?:\.\d+)?)|([()+*/^\-]))/y;
  let at = 0;
  while (at < normalized.length) {
    lexer.lastIndex = at;
    const match = lexer.exec(normalized);
    assert.ok(match, 'unsupported test expression token at ' + normalized.slice(at));
    tokens.push(match[1] ?? match[2] ?? match[3]); at = lexer.lastIndex;
  }
  let index = 0;
  const node = (value, dims, zero = false) => ({ value, dims, zero });
  const expect = token => assert.equal(tokens[index++], token);
  function atom() {
    const token = tokens[index++];
    if (token === '(') { const a = sum(); expect(')'); return a; }
    if (token === 'sin' || token === 'cos') {
      expect('('); const a = sum(); expect(')');
      assert.deepEqual(a.dims, dimension['1'], 'trig argument must be dimensionless/radian');
      return node(Math[token](a.value), dimension['1']);
    }
    if (/^\d/.test(token)) return node(Number(token), dimension['1'], Number(token) === 0);
    assert.ok(Object.hasOwn(givens, token) && Object.hasOwn(variableDims, token), 'unbound symbol: ' + token);
    return node(givens[token], variableDims[token]);
  }
  function power() {
    const base = atom();
    if (tokens[index] !== '^') return base;
    index++; const exponent = unary();
    assert.deepEqual(exponent.dims, dimension['1']);
    assert.ok(Number.isInteger(exponent.value));
    return node(base.value ** exponent.value, base.dims.map(v => v * exponent.value), base.zero);
  }
  function unary() {
    if (tokens[index] === '-') { index++; const a = unary(); return node(-a.value, a.dims, a.zero); }
    return power();
  }
  function product() {
    let a = unary();
    while (index < tokens.length) {
      const token = tokens[index];
      const implicit = token === '(' || /^[A-Za-z0-9]/.test(token);
      if (token !== '*' && token !== '/' && !implicit) break;
      if (!implicit) index++;
      const b = unary(), divide = token === '/';
      a = node(divide ? a.value / b.value : a.value * b.value,
        a.dims.map((v, i) => v + (divide ? -b.dims[i] : b.dims[i])), a.zero);
    }
    return a;
  }
  function sum() {
    let a = product();
    while (tokens[index] === '+' || tokens[index] === '-') {
      const op = tokens[index++], b = product();
      if (!a.zero && !b.zero) assert.deepEqual(a.dims, b.dims, 'addition requires equal physical dimensions');
      a = node(op === '+' ? a.value + b.value : a.value - b.value, a.zero ? b.dims : a.dims, a.zero && b.zero);
    }
    return a;
  }
  const result = sum();
  assert.equal(index, tokens.length, 'all symbolic tokens must be consumed');
  assert.ok(Number.isFinite(result.value));
  return result;
}
function symbolicValue(output, quantity, givens) {
  const entry = output.answers.find(a => a.quantity === quantity);
  assert.ok(entry, 'missing symbolic answer ' + quantity);
  const prefix = quantity + ' = ';
  assert.ok(entry.formula.startsWith(prefix));
  return parseFormula(entry.formula.slice(prefix.length), givens);
}
function selections(controls, index = 0, selected = {}) {
  if (index === controls.length) return [selected];
  return controls[index].choices.flatMap(c => selections(controls, index + 1,
    { ...selected, [controls[index].key]: c.value }));
}
function caseFor(e, options, time = 0.13) {
  const p = defaults(e), orientation = options.normalOrientation ? -1 : 1;
  let givens;
  if (e.id === 'faraday-loop') {
    const baseTheta = options.alignment === 1 ? 0 : options.alignment === 2 ? Math.PI / 2 : Math.PI / 3;
    Object.assign(p, { B0: 0.3, area: 0.02, turns: 50, resistance: 3, omega: options.fieldRegime ? 0 : 4,
      theta: options.normalOrientation ? (baseTheta === 0 ? Math.PI : baseTheta - Math.PI) : baseTheta,
      closedCircuit: options.closedCircuit, time });
    givens = { B0: p.B0, A: p.area, N: p.turns, theta: baseTheta, omega: p.omega, t: time, R: p.resistance };
  } else {
    Object.assign(p, { B: 0.5, length: 0.4, velocity: options.motionRegime ? 0 : 3,
      x0: 0.2, railLength: 2, resistance: 2, closedCircuit: options.closedCircuit, time });
    givens = { B: p.B, l: p.length, v: p.velocity, x0: p.x0, L: p.railLength, t: time, R: p.resistance };
  }
  return { p, givens, orientation };
}
function exactSchema(data) {
  assert.deepEqual(Object.keys(data).sort(), ['status', 'title', 'reason', 'givens', 'assumptions',
    'conditions', 'laws', 'steps', 'answers', 'regions', 'boundaries', 'limitations'].sort());
  assert.ok(['supported', 'unsupported'].includes(data.status));
  assert.ok(data.title.length);
  for (const key of ['givens', 'assumptions', 'conditions', 'laws', 'steps', 'answers', 'regions', 'boundaries', 'limitations'])
    assert.ok(Array.isArray(data[key]));
  for (const g of data.givens) assert.deepEqual(Object.keys(g).sort(), ['symbol', 'meaning', 'unit', 'constraint'].sort());
  for (const law of data.laws) assert.deepEqual(Object.keys(law).sort(), ['name', 'formula'].sort());
  for (const step of data.steps) assert.deepEqual(Object.keys(step).sort(), ['title', 'formula', 'explanation'].sort());
  for (const a of data.answers) assert.deepEqual(Object.keys(a).sort(), ['quantity', 'formula', 'unit', 'direction'].sort());
  for (const row of [...data.regions, ...data.boundaries])
    assert.deepEqual(Object.keys(row).sort(), ['condition', 'formula', 'explanation'].sort());
  function visit(value) {
    if (typeof value === 'string') {
      assert.ok(!/<\/?(?:script|svg|span|div|img)\b/i.test(value));
      assert.ok(!value.includes('\\(') && !value.includes('\\frac'));
    } else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') Object.values(value).forEach(visit);
  }
  visit(data);
}

test('all existing experiments expose exact symbolic API and structural-only controls', () => {
  assert.deepEqual(EXPERIMENTS.map(e => e.id), ['faraday-loop', 'motional-rod']);
  for (const e of EXPERIMENTS) {
    assert.equal(typeof e.symbolic, 'function');
    assert.ok(e.symbolicControls.length >= 3);
    for (const c of e.symbolicControls) {
      assert.deepEqual(Object.keys(c).sort(), ['key', 'label', 'initial', 'choices'].sort());
      assert.ok(c.choices.some(ch => ch.value === c.initial));
      assert.ok(c.choices.every(ch => typeof ch.value === 'number' && ch.label));
    }
    const { symbolic } = e;
    const d = symbolic();
    exactSchema(d); assert.equal(d.status, 'supported');
    assert.ok(d.laws.length && d.steps.length >= 4 && d.answers.length);
    assert.ok(d.limitations.some(s => s.includes('범용 CAS')));
    assert.ok(d.limitations.some(s => s.includes('수치 예시')));
    assert.deepEqual(d, symbolic(Object.fromEntries(e.symbolicControls.map(c => [c.key, c.initial]))));
    assert.ok(!d.answers.some(a => a.quantity.startsWith('I(')));
  }
});
test('all 24 loop and 8 rod combinations substitute correctly and have matching SI dimensions', () => {
  for (const e of EXPERIMENTS) {
    const branches = selections(e.symbolicControls);
    assert.equal(branches.length, e.id === 'faraday-loop' ? 24 : 8);
    for (const options of branches) {
      const data = e.symbolic(options), { p, givens, orientation } = caseFor(e, options);
      const out = e.evaluate(p, [0, 0, 0]);
      exactSchema(data); assert.equal(out.status, 'valid');
      for (const a of data.answers) {
        const key = byQuantity[a.quantity], parsed = symbolicValue(data, a.quantity, givens);
        assert.equal(a.unit, units[key], a.quantity);
        if (!parsed.zero) assert.deepEqual(parsed.dims, dimension[a.unit], a.quantity + ' dimensions');
        let expected = key === 'Bz' ? out.vectors.B[2] : numeric(out, key);
        if (e.id === 'motional-rod' && ['flux', 'linkage', 'emf', 'motionalEmf', 'current'].includes(key))
          expected *= orientation;
        near(parsed.value, expected, 1e-12, 1e-11);
      }
      for (const key of ['I(t)', 'PJ(t)', 'Fmag,x(t)', 'Fext,x(t)', 'Pext(t)']) {
        if (!options.closedCircuit || (e.id === 'faraday-loop' && key.startsWith('F')) ||
            (e.id === 'faraday-loop' && key === 'Pext(t)'))
          assert.ok(!data.answers.some(a => a.quantity === key), 'undefined circuit answer must be absent');
      }
    }
  }
});
test('independent frozen loop fixture values are produced by actual returned formulas', () => {
  const e = byId['faraday-loop'], options = { closedCircuit: 1, normalOrientation: 0, alignment: 0, fieldRegime: 0 };
  const data = e.symbolic(options), { givens } = caseFor(e, options, Math.PI / 8);
  near(symbolicValue(data, 'ℰ(t)', givens).value, 0.6);
  near(symbolicValue(data, 'I(t)', givens).value, 0.2);
  near(symbolicValue(data, 'PJ(t)', givens).value, 0.12);
  givens.t = Math.PI / 16;
  near(symbolicValue(data, 'ΦB(t)', givens).value, 0.0021213203435596424);
  near(symbolicValue(data, 'Λ(t)', givens).value, 0.10606601717798213);
  near(symbolicValue(data, 'ℰ(t)', givens).value, 0.4242640687119285);
});
test('independent frozen rod fixture values and reversal preserve actual Lorentz force and heat', () => {
  for (const normalOrientation of [0, 1]) {
    const e = byId['motional-rod'], options = { closedCircuit: 1, normalOrientation, motionRegime: 0 };
    const data = e.symbolic(options), { givens, orientation } = caseFor(e, options, 0.1);
    for (const [quantity, expected] of Object.entries({
      'x(t)': 0.5, 'A(t)': 0.2, 'ΦB(t)': 0.1 * orientation, 'Λ(t)': 0.1 * orientation,
      'ℰ(t)': -0.6 * orientation, 'I(t)': -0.3 * orientation,
      'Fmag,x(t)': -0.06, 'Fext,x(t)': 0.06, 'PJ(t)': 0.18, 'Pext(t)': 0.18 }))
      near(symbolicValue(data, quantity, givens).value, expected);
    assert.ok(data.answers.find(a => a.quantity === 'I(t)').direction.includes(normalOrientation ? '−y' : '+y'));
  }
});
test('each structural selector changes conditions/derivation/answers including circulation direction', () => {
  for (const e of EXPERIMENTS) {
    const basic = e.symbolic();
    for (const c of e.symbolicControls) for (const choice of c.choices.filter(ch => ch.value !== c.initial)) {
      const modified = e.symbolic({ [c.key]: choice.value });
      assert.notDeepEqual(modified.conditions, basic.conditions);
      assert.notDeepEqual(modified.steps, basic.steps);
      assert.notDeepEqual(modified.answers, basic.answers);
    }
  }
});
test('open circuits omit R and current/force/power; closed circuits require positive R and state R0 singular domain', () => {
  for (const e of EXPERIMENTS) {
    const open = e.symbolic({ closedCircuit: 0 }), closed = e.symbolic({ closedCircuit: 1 });
    assert.ok(!open.givens.some(g => g.symbol === 'R'));
    assert.ok(!open.answers.some(a => ['I(t)', 'PJ(t)', 'Fmag,x(t)', 'Fext,x(t)', 'Pext(t)'].includes(a.quantity)));
    assert.ok(closed.givens.some(g => g.symbol === 'R' && g.constraint === 'R>0'));
    assert.ok(closed.boundaries.some(b => b.condition.includes('R=0') && b.explanation.includes('singular')));
    const p = { ...defaults(e), closedCircuit: 1, resistance: 0 };
    assert.equal(e.evaluate(p, [0, 0, 0]).status, 'singular');
  }
});
test('symbolic physical inputs are never silently substituted or ignored; malformed structure unsupported', () => {
  for (const e of EXPERIMENTS) {
    const malformed = [null, [], 'x', 1, new Date(), { closedCircuit: true }, { closedCircuit: '1' },
      { closedCircuit: 2 }, { normalOrientation: NaN }, { normalOrientation: Infinity },
      { area: 0.02 }, { B0: 0.3 }, { R: 2 }, { time: 0.1 }, defaults(e), { [Symbol('x')]: 0 }];
    for (const options of malformed) {
      const data = e.symbolic(options);
      exactSchema(data); assert.equal(data.status, 'unsupported');
      assert.ok(data.reason.length); assert.deepEqual(data.answers, []);
    }
    const nullProto = Object.assign(Object.create(null), { closedCircuit: 1 });
    assert.equal(e.symbolic(nullProto).status, 'supported');
  }
  assert.equal(byId['faraday-loop'].symbolic({ alignment: 3 }).status, 'unsupported');
  assert.equal(byId['motional-rod'].symbolic({ motionRegime: -1 }).status, 'unsupported');
});
test('symbolic selection is pure; returned nested objects are fresh on repeated calls', () => {
  for (const e of EXPERIMENTS) {
    const options = Object.freeze({ closedCircuit: 1, normalOrientation: 1 });
    const before = e.symbolic(options);
    assert.deepEqual(options, { closedCircuit: 1, normalOrientation: 1 });
    const changed = e.symbolic(options);
    changed.givens[0].symbol = 'mutated'; changed.answers[0].formula = 'mutated';
    changed.conditions.push('mutated'); changed.limitations.push('mutated');
    assert.deepEqual(e.symbolic(options), before);
  }
});
test('loop perpendicular/static/degenerate-area symbolic limits match numeric evaluator', () => {
  const e = byId['faraday-loop'];
  for (const options of [{ closedCircuit: 1, alignment: 2 }, { closedCircuit: 1, fieldRegime: 1 }]) {
    const data = e.symbolic(options);
    for (const q of ['ℰ(t)', 'ℰtransformer(t)', 'ℰmotional(t)', 'I(t)', 'PJ(t)'])
      assert.equal(data.answers.find(a => a.quantity === q).formula, q + ' = 0');
    if (options.alignment === 2) assert.equal(data.answers.find(a => a.quantity === 'ΦB(t)').formula, 'ΦB(t) = 0');
  }
  const options = { closedCircuit: 1, normalOrientation: 1, alignment: 0, fieldRegime: 0 };
  const { p, givens } = caseFor(e, options);
  p.area = 0; givens.A = 0;
  const data = e.symbolic(options), out = e.evaluate(p, [0, 0, 0]);
  assert.ok(data.regions.some(r => r.condition === 'A=0' && r.explanation.includes('축퇴')));
  near(symbolicValue(data, 'ΦB(t)', givens).value, numeric(out, 'flux'));
  near(symbolicValue(data, 'ℰ(t)', givens).value, 0);
  assert.ok(data.boundaries.some(b => b.condition.includes('ω→0')));
});
test('rod domain explicitly excludes endpoints/outside while retaining signed one-sided flux limits', () => {
  const e = byId['motional-rod'];
  for (const normalOrientation of [0, 1]) {
    const options = { closedCircuit: 1, normalOrientation, motionRegime: 0 };
    const data = e.symbolic(options), { givens, orientation } = caseFor(e, options);
    assert.ok(data.conditions.some(c => c.includes('0<x(t)<L')));
    assert.ok(data.regions.some(r => r.condition.includes('x(t)>L') && r.formula.includes('unsupported')));
    const upper = data.boundaries.find(b => b.condition === 'x(t)→L⁻');
    const expression = upper.formula.slice('ΦB→'.length).split(';')[0];
    near(parseFormula(expression, givens).value, orientation * 0.4);
    assert.ok(upper.explanation.includes('接触') || upper.explanation.includes('접촉'));
    assert.ok(data.boundaries.find(b => b.condition === 'x(t)→0⁺').formula.startsWith('ΦB→0'));
  }
  for (const x0 of [0, 2]) assert.equal(e.evaluate({ ...defaults(e), x0, velocity: 0 }, [0, 0, 0]).status, 'boundary');
  assert.equal(e.evaluate({ ...defaults(e), x0: 1, velocity: 3, time: 1 }, [0, 0, 0]).status, 'unsupported');
});
test('independent symbolic flux finite differences give signed emf for all structural branches', () => {
  for (const e of EXPERIMENTS) for (const options of selections(e.symbolicControls)) {
    const data = e.symbolic(options), { givens } = caseFor(e, options, 0.1), h = 1e-4;
    const plus = symbolicValue(data, 'Λ(t)', { ...givens, t: givens.t + h }).value;
    const minus = symbolicValue(data, 'Λ(t)', { ...givens, t: givens.t - h }).value;
    near(symbolicValue(data, 'ℰ(t)', givens).value, -(plus - minus) / (2 * h), 1e-9, 2e-6);
    const transformer = symbolicValue(data, 'ℰtransformer(t)', givens).value;
    const motion = symbolicValue(data, 'ℰmotional(t)', givens).value;
    near(transformer + motion, symbolicValue(data, 'ℰ(t)', givens).value);
    if (e.id === 'faraday-loop') near(motion, 0);
    else near(transformer, 0);
  }
});
test('rod signed-field/velocity substitutions obey Lenz force and energy for either normal convention', () => {
  const e = byId['motional-rod'];
  for (const normalOrientation of [0, 1]) for (const B of [-0.5, 0.5]) for (const v of [-3, 3]) {
    const options = { closedCircuit: 1, normalOrientation, motionRegime: 0 };
    const data = e.symbolic(options), { givens } = caseFor(e, options, 0.1);
    Object.assign(givens, { B, v, x0: 1 });
    const force = symbolicValue(data, 'Fmag,x(t)', givens).value;
    const heat = symbolicValue(data, 'PJ(t)', givens).value;
    assert.ok(force * v < 0);
    near(-force * v, heat); assert.ok(heat > 0);
    near(symbolicValue(data, 'Pext(t)', givens).value, heat);
  }
});
