import test from 'node:test';
import assert from 'node:assert/strict';
import { EXPERIMENTS as coax } from '../src/em-course-coaxial.js';
import { EXPERIMENTS as magnetic } from '../src/em-course-magnetostatics.js';

const all = [...coax, ...magnetic];
const byId = id => all.find(definition => definition.id === id);
const required = ['status','title','reason','givens','assumptions','conditions','laws','steps','answers','regions','boundaries','limitations'].sort();
const value = (result, key) => result.scalars.find(item => item.key === key)?.value;
const answer = (result, quantity) => result.answers.find(item => item.quantity === quantity);
const EPS0 = 8.8541878188e-12, MU0 = 1.25663706127e-6;
function near(actual, expected, absolute = 1e-18, relative = 1e-10) {
  assert.ok(Number.isFinite(actual));
  assert.ok(Math.abs(actual - expected) <= absolute + relative * Math.abs(expected), `${actual} != ${expected}`);
}
function combinations(controls) {
  return controls.reduce((entries, control) => entries.flatMap(entry => control.choices.map(choice => ({ ...entry, [control.key]: choice.value }))), [{}]);
}
function checkSchema(result) {
  assert.deepEqual(Object.keys(result).sort(), required);
  assert.ok(['supported','unsupported'].includes(result.status));
  for (const key of ['title','reason']) assert.equal(typeof result[key], 'string');
  for (const key of ['assumptions','conditions','limitations']) {
    assert.ok(Array.isArray(result[key]));
    assert.ok(result[key].every(item => typeof item === 'string'));
  }
  const rows = { givens: ['symbol','meaning','unit','constraint'], laws: ['name','formula'],
    steps: ['title','formula','explanation'], answers: ['quantity','formula','unit','direction'],
    regions: ['condition','formula','explanation'], boundaries: ['condition','formula','explanation'] };
  for (const [key, fields] of Object.entries(rows)) {
    assert.ok(Array.isArray(result[key]));
    for (const row of result[key]) for (const field of fields) assert.equal(typeof row[field], 'string');
  }
  if (result.status === 'supported') {
    assert.equal(result.reason, '');
    assert.ok(result.givens.length && result.laws.length && result.steps.length && result.answers.length);
  } else {
    assert.ok(result.reason);
    assert.deepEqual(result.answers, []);
  }
  // Return data is inert plain strings, never an executable expression graph.
  assert.ok(!JSON.stringify(result).includes('<script'));
  assert.ok(result.limitations.some(item => item.includes('CAS')));
}

test('all seven owned definitions expose exact common schema for every structural branch', () => {
  assert.deepEqual(all.map(item => item.id), ['coax-charge','coax-voltage','wire-current','loop-axis','coax-current','coax-current-thick','coax-current-surface']);
  let branches = 0;
  for (const definition of all) {
    assert.ok(Array.isArray(definition.symbolicControls));
    assert.equal(typeof definition.symbolic, 'function');
    for (const control of definition.symbolicControls) {
      assert.ok(control.choices.some(choice => choice.value === control.initial));
      assert.ok(control.choices.length >= 2);
    }
    checkSchema(definition.symbolic());
    for (const options of combinations(definition.symbolicControls)) {
      checkSchema(definition.symbolic(options));
      branches++;
    }
  }
  assert.equal(branches, 26); // 8 electrostatic + 2 wire + 4 loop + 12 coax current.
});

test('structural selection rejects physical sample parameters and invalid/unknown choices', () => {
  for (const definition of all) {
    for (const options of [null, [], new Date(), 3, { current: 3 }, { a: .001, voltage: 100 }, { unknown: 0 },
      { [definition.symbolicControls[0].key]: NaN }, { [definition.symbolicControls[0].key]: Infinity },
      { [definition.symbolicControls[0].key]: '0' }, { [definition.symbolicControls[0].key]: 44 }]) {
      const result = definition.symbolic(options);
      checkSchema(result);
      assert.equal(result.status, 'unsupported');
    }
    assert.equal(definition.symbolic(Object.create(null)).status, 'supported');
  }
});

test('electrostatic fixed charge/voltage symbolic branches match independent substitution and evaluator', () => {
  const geometry = { a: .001, b: .004, c: .005, epsilonR: 2.5 }, epsilon = EPS0 * geometry.epsilonR;
  const r = .002, logRatio = Math.log(geometry.b / geometry.a), capacitance = 2 * Math.PI * epsilon / logRatio;
  for (const definition of coax) for (const control of [0, 1]) for (const reference of [0, 1]) {
    const symbolic = definition.symbolic({ control, reference });
    const evaluator = byId(control === 0 ? 'coax-charge' : 'coax-voltage');
    const drive = control === 0 ? { lambda: 1e-9 } : { voltage: 100 };
    const lambda = control === 0 ? 1e-9 : capacitance * 100;
    const deltaV = control === 0 ? lambda / capacitance : 100;
    // Direct substitution into independently written Gauss/potential formulas.
    const er = control === 0 ? lambda / (2 * Math.PI * epsilon * r) : deltaV / (r * logRatio);
    const outerPotential = control === 0 ? lambda * Math.log(geometry.b / r) / (2 * Math.PI * epsilon)
      : deltaV * Math.log(geometry.b / r) / logRatio;
    const referencedPotential = reference === 0 ? outerPotential : outerPotential - deltaV;
    const evaluated = evaluator.evaluate({ ...geometry, ...drive }, [r, 0, 0]);
    near(evaluated.vectors.E[0], er, 1e-7);
    near(value(evaluated, 'potential') - (reference === 1 ? value(evaluated, 'deltaV') : 0), referencedPotential, 1e-11);
    const eFormula = answer(symbolic, 'E(r)').formula;
    assert.ok(eFormula.includes(control === 0 ? 'λ/(2πεr)' : 'ΔV/[r ln(b/a)]'));
    const vFormula = answer(symbolic, 'V(r)').formula;
    assert.ok(vFormula.includes(reference === 0 ? 'ln(b/r)' : 'ln(r/a)'));
    assert.ok(symbolic.conditions.includes(reference === 0 ? 'V(b)=0; V(a)=ΔV' : 'V(a)=0; V(b)=−ΔV'));
    near(value(evaluated, 'capacitancePerLength'), 1.00325919895e-10);
    near(evaluated.vectors.E[0], control === 0 ? 3595.02071447 : 36067.3760222, 1e-7);
    assert.equal(answer(symbolic, 'C′').unit, 'F/m');
    assert.equal(answer(symbolic, 'E(r)').unit, 'V/m');
    assert.equal(answer(symbolic, 'D(r)').unit, 'C/m²');
    assert.equal(answer(symbolic, 'V(r)').unit, 'V');
  }
});

test('fixed-control conditions correctly predict epsilon scaling; potential reference shifts no fields', () => {
  for (const control of [0, 1]) {
    const definition = byId(control === 0 ? 'coax-charge' : 'coax-voltage');
    const drive = control === 0 ? { lambda: 1e-9 } : { voltage: 100 };
    const params = { a: .001, b: .004, c: .005, epsilonR: 2.5, ...drive };
    const first = definition.evaluate(params, [.002, 0, 0]);
    const second = definition.evaluate({ ...params, epsilonR: 10 }, [.002, 0, 0]);
    const symbolic = definition.symbolic({ control });
    const scaling = symbolic.steps.find(step => step.title === '정전용량과 선택된 제어량');
    assert.ok(scaling.explanation.includes(control === 0 ? 'λ,D는 유지' : 'λ,D,C′가 비례 증가'));
    near(second.vectors.E[0], first.vectors.E[0] * (control === 0 ? .25 : 1), 1e-7);
    near(second.vectors.D[0], first.vectors.D[0] * (control === 0 ? 1 : 4));
    const outer = definition.symbolic({ control, reference: 0 }), inner = definition.symbolic({ control, reference: 1 });
    assert.equal(answer(outer, 'E(r)').formula, answer(inner, 'E(r)').formula);
    assert.equal(answer(outer, 'D(r)').formula, answer(inner, 'D(r)').formula);
    assert.notEqual(answer(outer, 'V(r)').formula, answer(inner, 'V(r)').formula);
  }
});

test('electrostatic boundaries and axis symbolic domains agree with numeric sided limits', () => {
  for (const control of [0, 1]) {
    const definition = byId(control === 0 ? 'coax-charge' : 'coax-voltage');
    const params = { a: .001, b: .004, c: .005, epsilonR: 2.5, ...(control === 0 ? { lambda: 1e-9 } : { voltage: 100 }) };
    const symbolic = definition.symbolic({ control, reference: 1 });
    for (const key of ['a', 'b', 'c']) {
      const boundary = definition.evaluate(params, [params[key], 0, 0]);
      assert.equal(boundary.status, 'boundary');
      assert.ok(symbolic.boundaries.some(row => row.condition === `r=${key}`));
      if (key === 'a') assert.equal(value(boundary, 'ErInside'), 0);
      if (key === 'b') assert.equal(value(boundary, 'ErOutside'), 0);
      if (key === 'c') assert.equal(value(boundary, 'DrInside'), value(boundary, 'DrOutside'));
    }
    const axis = definition.evaluate(params, [0, 0, 0]);
    assert.equal(axis.status, 'valid');
    assert.ok(symbolic.regions[0].condition.includes('0≤r'));
    assert.ok(symbolic.regions[0].formula.includes('V=0'));
    assert.ok(symbolic.boundaries[0].formula.includes('Dᵣ(a⁺)−Dᵣ(a⁻)=λ/(2πa)'));
  }
});

test('wire direction branches have correct independently fixed vector and axis exclusion', () => {
  const definition = byId('wire-current');
  for (const direction of [0, 1]) {
    const symbolic = definition.symbolic({ direction }), sign = direction === 0 ? 1 : -1;
    const evaluated = definition.evaluate({ current: sign * 3 }, [.03, .04, 7]);
    near(evaluated.vectors.B[0], sign * -9.59999999873e-6);
    near(evaluated.vectors.B[1], sign * 7.19999999905e-6);
    assert.ok(answer(symbolic, 'B').formula.startsWith(direction === 0 ? 'B=μ₀I' : 'B=−μ₀I'));
    assert.ok(answer(symbolic, 'B').direction.startsWith(direction === 0 ? '+φ' : '−φ'));
    assert.ok(symbolic.conditions.includes('ρ>0, z는 임의 실수, I≥0'));
    assert.equal(definition.evaluate({ current: sign * 3 }, [0, 0, 0]).status, 'singular');
    assert.ok(symbolic.boundaries.some(row => row.condition === 'ρ=0'));
    assert.equal(answer(symbolic, 'B').unit, 'T');
    assert.equal(answer(symbolic, 'H').unit, 'A/m');
  }
});

test('loop direction, center and both axis sides agree with immutable Biot-Savart fixtures', () => {
  const definition = byId('loop-axis');
  for (const direction of [0, 1]) {
    const symbolic = definition.symbolic({ direction, observation: 0 }), sign = direction === 0 ? 1 : -1;
    for (const z of [0, .1, -.1]) {
      const evaluated = definition.evaluate({ radius: .1, current: sign * 2 }, [0, 0, z]);
      near(evaluated.vectors.B[2], sign * (z === 0 ? 1.25663706127e-5 : 4.44288293757e-6));
    }
    assert.ok(answer(symbolic, 'B(z)').formula.startsWith(direction === 0 ? 'B=μ₀' : 'B=−μ₀'));
    assert.ok(symbolic.steps.some(step => step.formula.includes('Bz(−z)=Bz(z)')));
    assert.ok(symbolic.boundaries.find(row => row.condition === 'z=0, x=y=0').formula.includes(direction === 0 ? 'Bz=μ₀I/(2R)' : 'Bz=−μ₀I/(2R)'));
    const unsupported = definition.symbolic({ direction, observation: 1 });
    assert.equal(unsupported.status, 'unsupported');
    assert.deepEqual(unsupported.answers, []);
    assert.ok(unsupported.conditions[0].includes('x²+y²>0'));
    assert.equal(definition.evaluate({ radius: .1, current: 2 }, [.01, 0, .1]).status, 'unsupported');
  }
});

test('all coax distribution combinations have mathematically correct Ienc/B/H substitutions', () => {
  const p = { a: .01, b: .03, c: .04, current: 3, muR: 1 };
  for (const definition of magnetic.filter(item => item.id.startsWith('coax-current'))) for (const innerMode of [0, 1]) for (const outerMode of [0, 1]) {
    const symbolic = definition.symbolic({ innerMode, outerMode });
    assert.ok(symbolic.regions[0].formula.includes(innerMode === 0 ? 'I r²/a²' : 'Ienc=0'));
    assert.equal(symbolic.regions.some(row => row.condition === 'b<r<c'), outerMode === 1);
    if (outerMode === 1) assert.ok(symbolic.regions.find(row => row.condition === 'b<r<c').formula.includes('I(c²−r²)/(c²−b²)'));
    for (const r of [0, .005, .02, .035, .05]) {
      // Independent current-density area integration/substitution, with signed
      // source superposition. The mixed surface/thick symbolic branch is checked
      // against surface evaluator inside and thick evaluator outside the core.
      const core = innerMode === 1 ? (r < p.a ? 0 : p.current) : p.current * Math.min((r / p.a) ** 2, 1);
      const returnFraction = outerMode === 0 ? (r > p.b ? 1 : 0) : r <= p.b ? 0 : Math.min((r * r - p.b * p.b) / (p.c * p.c - p.b * p.b), 1);
      const enclosed = core - p.current * returnFraction;
      const h = r === 0 ? 0 : enclosed / (2 * Math.PI * r), b = MU0 * h;
      const engine = innerMode === 1 && r < p.a ? byId('coax-current-surface') : byId(outerMode === 1 ? 'coax-current-thick' : innerMode === 1 ? 'coax-current-surface' : 'coax-current');
      const evaluated = engine.evaluate(p, [r, 0, 0]);
      assert.equal(evaluated.status, 'valid');
      near(value(evaluated, 'enclosedCurrent'), enclosed, 1e-10);
      near(value(evaluated, 'Hphi'), h, 1e-10);
      near(value(evaluated, 'Bphi'), b);
      if (r === .005) near(b, innerMode === 1 ? 0 : 2.9999999996039017e-5);
      if (r === .035) near(b, outerMode === 1 ? 9.18367346817521e-6 : 0);
    }
    assert.equal(answer(symbolic, 'Ienc(r)').unit, 'A');
    assert.equal(answer(symbolic, 'H(r)').unit, 'A/m');
    assert.equal(answer(symbolic, 'B(r)').unit, 'T');
    assert.ok(symbolic.limitations.some(item => item.includes('Φ=∫S') && item.includes('Wb')));
  }
});

test('coax distribution boundaries select continuity or sheet jump and keep axis finite', () => {
  const p = { a: .01, b: .03, c: .04, current: 3, muR: 1 };
  for (const innerMode of [0, 1]) for (const outerMode of [0, 1]) {
    const symbolic = byId('coax-current').symbolic({ innerMode, outerMode });
    const atA = symbolic.boundaries.find(row => row.condition === 'r=a');
    assert.ok(atA.explanation.includes(innerMode === 0 ? '연속' : '양측'));
    assert.ok(atA.formula.includes(innerMode === 0 ? 'Bφ=μ I/(2πa)' : 'Bφ⁻=0, Bφ⁺=μ I/(2πa)'));
    const engineA = byId(innerMode === 0 ? 'coax-current' : 'coax-current-surface');
    assert.equal(engineA.evaluate(p, [.01,0,0]).status, innerMode === 0 ? 'valid' : 'boundary');
    const atB = symbolic.boundaries.find(row => row.condition === 'r=b');
    assert.ok(atB.explanation.includes(outerMode === 1 ? '연속' : '양측'));
    const engineB = byId(outerMode === 1 ? 'coax-current-thick' : 'coax-current');
    assert.equal(engineB.evaluate(p, [.03,0,0]).status, outerMode === 1 ? 'valid' : 'boundary');
    assert.equal(symbolic.boundaries.some(row => row.condition === 'r=c'), outerMode === 1);
    assert.equal(symbolic.boundaries[0].formula, 'B=H=Ienc=0');
    assert.ok(symbolic.givens.find(row => row.symbol === 'b').meaning.includes('간격은 b−a'));
  }
});

test('definition defaults match original distribution/control and old symbolicAnswer remains intact', () => {
  assert.ok(byId('coax-charge').symbolic().conditions.includes('고정 λ; ΔV=λ/C′는 유도량'));
  assert.ok(byId('coax-voltage').symbolic().conditions.includes('고정 ΔV; λ=C′ΔV는 유도량'));
  for (const [id, innerMode, outerMode] of [['coax-current',0,0],['coax-current-thick',0,1],['coax-current-surface',1,0]]) {
    const definition = byId(id), snapshot = JSON.stringify(definition.symbolicAnswer);
    assert.deepEqual(definition.symbolic(), definition.symbolic({ innerMode, outerMode }));
    definition.symbolic({ innerMode: 1, outerMode: 1 });
    assert.equal(JSON.stringify(definition.symbolicAnswer), snapshot);
  }
});

test('symbolic calls have no numeric parameter dependency or caller/return mutation coupling', () => {
  for (const definition of all) {
    const options = Object.freeze(Object.fromEntries(definition.symbolicControls.map(item => [item.key,item.initial])));
    const first = definition.symbolic(options), expected = JSON.stringify(first);
    const params = Object.freeze(Object.fromEntries(definition.parameters.map(item => [item.key,item.initial])));
    definition.evaluate(params, definition.probeDefault);
    assert.equal(JSON.stringify(definition.symbolic(options)), expected);
    first.answers.length = 0;
    assert.ok(definition.symbolic(options).answers.length > 0);
  }
});
