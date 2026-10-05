import test from 'node:test';
import assert from 'node:assert/strict';
import { EXPERIMENTS as boundaries } from '../../../src/em-course-boundaries.js';
import { EXPERIMENTS as integrals } from '../../../src/em-course-integrals.js';
const all = [...boundaries, ...integrals], [face, plate] = boundaries, [point, line, sheet, wire] = integrals;
const initial = d => Object.fromEntries(d.parameters.map(p => [p.key, p.initial]));
const scalar = (r, key) => r.scalars.find(s => s.key === key).value;
const answer = (data, key) => { const a = data.answers.find(a => a.quantity === key); assert.ok(a, key); return a; };
const near = (a, b, abs = 1e-11) => assert.ok(Math.abs(a - b) <= abs + 2e-12 * Math.abs(b), a + ' != ' + b);
const units = {
  '1': [0,0,0,0], 'm': [1,0,0,0], 'm²': [2,0,0,0], 'C': [0,0,1,1],
  'C/m': [-1,0,1,1], 'C/m²': [-2,0,1,1], 'F/m': [-3,-1,4,2],
  'F': [-2,-1,4,2], 'm²/F': [4,1,-4,-2], 'V': [2,1,-3,-1],
  'V/m': [1,1,-3,-1], 'V m': [3,1,-3,-1], 'J': [2,1,-2,0],
  'A': [0,0,0,1], 'H/m': [1,1,-2,-2], 'A/m': [-1,0,0,1],
  'T': [0,1,-2,-1], 'T m': [1,1,-2,-1],
};
const given = (value, unit) => ({ value, dimension: units[unit], zero: value === 0 });
const env = entries => Object.fromEntries(Object.entries(entries).map(([key, [value, unit]]) => [key, given(value, unit)]));
// Test-only restricted arithmetic parser. It reads emitted mathematical strings,
// performs independent substitution and SI dimension algebra; never evals JavaScript.
function substitute(formula, values) {
  const source = formula.slice(formula.indexOf('=') + 1).replaceAll('−', '-').replaceAll('·', '*').replaceAll('²', '^2');
  const names = Object.keys(values).sort((a,b) => b.length-a.length);
  let at = 0;
  const whitespace = () => { while (/\s/.test(source[at] ?? '') && at < source.length) at++; };
  function atom() {
    whitespace();
    if (source[at] === '(') {
      at++; const value = expression(); whitespace(); assert.equal(source[at++], ')'); return value;
    }
    const name = names.find(n => source.startsWith(n, at));
    if (name) { at += name.length; return values[name]; }
    const number = source.slice(at).match(/^(?:\d+(?:\.\d*)?|\.\d+)/);
    assert.ok(number, 'unrecognized symbolic atom at ' + source.slice(at));
    at += number[0].length; return given(Number(number[0]), '1');
  }
  function unary() {
    whitespace(); const c = source[at];
    if (c === '+' || c === '-') { at++; const a = unary(); return { ...a, value: c === '-' ? -a.value : a.value }; }
    let a = atom(); whitespace();
    if (source[at] === '^') {
      at++; const b = atom(); assert.deepEqual(b.dimension, units['1']);
      assert.ok(Number.isInteger(b.value));
      a = { value: a.value ** b.value, dimension: a.dimension.map(x => x * b.value), zero: a.zero && b.value > 0 };
    }
    return a;
  }
  function product() {
    let a = unary(); whitespace();
    while (source[at] === '*' || source[at] === '/') {
      const op = source[at++], b = unary(), sign = op === '*' ? 1 : -1;
      a = { value: op === '*' ? a.value * b.value : a.value / b.value,
        dimension: a.dimension.map((x,i) => x + sign*b.dimension[i]), zero: a.zero || (op === '*' && b.zero) };
      whitespace();
    }
    return a;
  }
  function expression() {
    let a = product(); whitespace();
    while (source[at] === '+' || source[at] === '-') {
      const op = source[at++], b = product();
      if (!a.zero && !b.zero) assert.deepEqual(a.dimension, b.dimension, 'sum must use compatible SI dimensions');
      a = { value: op === '+' ? a.value + b.value : a.value - b.value,
        dimension: a.zero ? b.dimension : a.dimension, zero: a.zero && b.zero };
      whitespace();
    }
    return a;
  }
  const result = expression(); whitespace(); assert.equal(at, source.length, 'entire math formula must be parsed');
  assert.ok(Number.isFinite(result.value)); return result;
}
function checkedFormula(item, values) {
  const r = substitute(item.formula, values);
  if (!r.zero) assert.deepEqual(r.dimension, units[item.unit], item.quantity + ' SI units');
  return r.value;
}
const fullKeys = ['status','title','reason','givens','assumptions','conditions','laws','steps','answers','regions','boundaries','limitations'];
function schema(data) {
  assert.deepEqual(Object.keys(data).sort(), [...fullKeys].sort());
  assert.ok(['supported','unsupported'].includes(data.status));
  assert.equal(typeof data.title, 'string'); assert.equal(typeof data.reason, 'string');
  for (const key of fullKeys.slice(3)) assert.ok(Array.isArray(data[key]));
  for (const g of data.givens) for (const key of ['symbol','meaning','unit','constraint']) assert.equal(typeof g[key], 'string');
  for (const g of data.laws) for (const key of ['name','formula']) assert.equal(typeof g[key], 'string');
  for (const g of data.steps) for (const key of ['title','formula','explanation']) assert.equal(typeof g[key], 'string');
  for (const g of data.answers) for (const key of ['quantity','formula','unit','direction']) assert.equal(typeof g[key], 'string');
  for (const key of ['regions','boundaries']) for (const g of data[key])
    for (const field of ['condition','formula','explanation']) assert.equal(typeof g[field], 'string');
  if (data.status === 'unsupported') { assert.ok(data.reason); assert.deepEqual(data.answers, []); }
  else { assert.ok(data.givens.length && data.laws.length && data.steps.length && data.answers.length); }
  assert.ok(data.limitations.some(s => s.includes('CAS')));
}
function combinations(controls, i=0, previous={}) {
  return i === controls.length ? [previous] :
    controls[i].choices.flatMap(c => combinations(controls, i+1, { ...previous, [controls[i].key]: c.value }));
}

test('six definitions conform to common schema for every structural combination', () => {
  let count = 0;
  for (const d of all) {
    assert.ok(d.symbolicControls.length);
    for (const c of d.symbolicControls) {
      assert.deepEqual(Object.keys(c).sort(), ['key','label','initial','choices'].sort());
      assert.ok(c.choices.some(v => v.value === c.initial));
    }
    schema(d.symbolic()); assert.equal(d.symbolic().status, 'supported');
    for (const options of combinations(d.symbolicControls)) { schema(d.symbolic(options)); count++; }
  }
  assert.equal(count, 72);
});
test('structural control changes alter conditions, derivation or answer, with no physical sample input', () => {
  for (const d of all) {
    const defaults = Object.fromEntries(d.symbolicControls.map(c => [c.key,c.initial]));
    const basic = d.symbolic();
    for (const c of d.symbolicControls) for (const choice of c.choices.filter(x => x.value !== c.initial)) {
      const changed = d.symbolic({ ...defaults, [c.key]:choice.value });
      assert.notDeepEqual(changed, basic, d.id + ':' + c.key);
    }
    for (const options of [initial(d), { charge:4e-9 }, { epsilonR:1 }, { surprise:0 }, null, [], new Date()])
      assert.equal(d.symbolic(options).status, 'unsupported');
    for (const c of d.symbolicControls) {
      for (const value of [NaN, Infinity, '0', 12345, undefined]) assert.equal(d.symbolic({ [c.key]:value }).status, 'unsupported');
    }
    assert.ok(!JSON.stringify(basic).includes('4e-9'));
    assert.ok(!JSON.stringify(basic).includes('8.854187'));
  }
});
test('symbolic calls preserve input/options and return independent plain data', () => {
  for (const d of all) {
    const options = Object.fromEntries(d.symbolicControls.map(c => [c.key,c.initial])), before = structuredClone(options);
    const result = d.symbolic(options); assert.deepEqual(options,before);
    result.answers[0].formula = 'test mutation';
    assert.notEqual(d.symbolic().answers[0].formula, 'test mutation');
    assert.equal(d.symbolic(Object.assign(Object.create(null),options)).status, 'supported');
  }
});
test('interface forward/inverse signed surface-charge formulas substitute independently with SI units', () => {
  const eps = 8.8541878188e-12;
  for (const sigma of [0, eps*10, -eps*10]) {
    const values = env({ 'ε₁':[2*eps,'F/m'], 'ε₂':[5*eps,'F/m'], 'E₁n':[40,'V/m'], 'σf':[sigma,'C/m²'] });
    const forward = face.symbolic();
    const e2 = checkedFormula(answer(forward,'E₂n'), values);
    near(e2, sigma === 0 ? 16 : sigma > 0 ? 18 : 14);
    const numeric = face.evaluate({ ...initial(face), sigmaFree:sigma }, [0,0,1]);
    near(e2,numeric.vectors.E[2]);
    const inverse = face.symbolic({ fieldInput:1 });
    near(checkedFormula(answer(inverse,'E₁n'), { ...values, 'E₂n':given(e2,'V/m') }),40);
  }
  const noCharge = face.symbolic({ surfaceCharge:1 });
  const e2 = checkedFormula(answer(noCharge,'E₂n'), env({ 'ε₁':[2*eps,'F/m'], 'ε₂':[5*eps,'F/m'], 'E₁n':[40,'V/m'] }));
  near(e2,16); assert.ok(!answer(noCharge,'E₂n').formula.includes('σf'));
});
test('interface reversed normal changes medium regions and Cartesian vector orientation', () => {
  const data = face.symbolic({ normalDirection:-1 });
  assert.equal(data.regions[0].condition,'z>0'); assert.equal(data.regions[1].condition,'z<0');
  assert.ok(answer(data,'E₂').direction.includes('−ẑ'));
  const eps = 8.8541878188e-12, sigma=eps*10;
  const normalE = checkedFormula(answer(data,'E₂n'),env({ 'ε₁':[2*eps,'F/m'],'ε₂':[5*eps,'F/m'],'E₁n':[40,'V/m'],'σf':[sigma,'C/m²'] }));
  near(-normalE,face.evaluate({ ...initial(face),E1z:-40,sigmaFree:-sigma },[0,0,1]).vectors.E[2]);
  const unresolved=face.symbolic({ fieldInput:2 }); assert.equal(unresolved.status,'unsupported'); assert.deepEqual(unresolved.answers,[]);
});
test('layer fixed Q/V templates independently substitute capacitance, charge, fields and energy', () => {
  const eps=8.8541878188e-12;
  for (const control of [0,1]) {
    const data=plate.symbolic({ control }), values=env({
      A:[.02,'m²'],'d₁':[.001,'m'],'d₂':[.002,'m'],'ε₁':[2*eps,'F/m'],'ε₂':[5*eps,'F/m'],Q:[2e-9,'C'],V:[12,'V'],
    });
    const s=checkedFormula(answer(data,'S'),values); values.S=given(s,'m²/F');
    const c=checkedFormula(answer(data,'C'),values); near(c,1.9675972930666668e-10,1e-23);
    const dn=checkedFormula(answer(data,'Dₙ'),values); values['Dₙ']=given(dn,'C/m²');
    const r=plate.evaluate({ ...initial(plate),control },[0,0,.0005]);
    near(dn,scalar(r,'D1z'),1e-22);
    near(checkedFormula(answer(data,control ? 'Q':'V'),values),scalar(r,control ? 'charge':'voltage'),control ? 1e-22:1e-11);
    near(checkedFormula(answer(data,'E₁z'),values),control ? 6666.666666666667 : 5647.045333038401);
    near(checkedFormula(answer(data,'E₂z'),values),control ? 2666.666666666667 : 2258.8181332153604);
    near(checkedFormula(answer(data,'U'),values),scalar(r,'energy'),1e-22);
  }
});
test('layer potential reference is a constant shift; piecewise potentials meet all boundaries', () => {
  const eps=8.8541878188e-12, q=2e-9, dn=q/.02, voltage=10.164681599469121;
  for (const potentialReference of [0,1]) {
    const data=plate.symbolic({ potentialReference });
    const values=env({ 'Dₙ':[dn,'C/m²'],'ε₁':[2*eps,'F/m'],'ε₂':[5*eps,'F/m'],'d₁':[.001,'m'],'d₂':[.002,'m'],d:[.003,'m'] });
    for (const [row,z] of [[1,0],[1,.0005],[1,.001],[2,.001],[2,.002],[2,.003]]) {
      const symbolicV=substitute(data.regions[row].formula,{ ...values,z:given(z,'m') });
      assert.deepEqual(symbolicV.dimension,units.V);
      const numeric=plate.evaluate(initial(plate),[0,0,z]);
      near(symbolicV.value,scalar(numeric,'potential')-(potentialReference ? voltage:0));
    }
    assert.equal(data.boundaries.length,3); assert.ok(data.boundaries[1].formula.includes('D_z⁺−D_z⁻=0'));
  }
});
test('point inside/outside and reversed closed normal keep local field but branch total flux', () => {
  const eps=8.8541878188e-12, values=env({q:[4e-9,'C'],r:[.2,'m'],'ε':[eps,'F/m'],'π':[Math.PI,'1']});
  for (const sourceLocation of [0,1]) for (const orientation of [1,-1]) {
    const data=point.symbolic({ sourceLocation,orientation });
    near(checkedFormula(answer(data,'D_r'),values),7.957747154594766e-9,1e-22);
    near(checkedFormula(answer(data,'E_r'),values),898.7551786170799);
    near(checkedFormula(answer(data,'Qenc'),values),sourceLocation ? 0:4e-9,1e-22);
    near(checkedFormula(answer(data,'ΦD'),values),sourceLocation ? 0:orientation*4e-9,1e-22);
    const numeric=point.evaluate({ ...initial(point),centerZ:sourceLocation ? .36:0 },[.2,0,0]);
    near(checkedFormula(answer(data,'ΦE'),values),orientation*scalar(numeric,'fluxE'));
    assert.ok(data.answers[1].direction.includes('바꾸지 않음'));
  }
  assert.equal(point.symbolic({ sourceLocation:2 }).status,'unsupported');
  const absent=point.symbolic({ sourceLocation:2,zeroSource:1 });
  assert.equal(absent.status,'supported'); assert.equal(checkedFormula(answer(absent,'D_r'),{}),0);
});
test('line total flux and radial fields use separate geometry, normal reversal changes flux only', () => {
  const eps=8.8541878188e-12, values=env({ 'λ':[2e-9,'C/m'],L:[.4,'m'],r:[.1,'m'],'ε':[eps,'F/m'],'π':[Math.PI,'1'] });
  for (const orientation of [1,-1]) {
    const data=line.symbolic({ orientation });
    near(checkedFormula(answer(data,'E_r'),values),359.5020714468319);
    near(checkedFormula(answer(data,'Qenc'),values),8e-10,1e-22);
    near(checkedFormula(answer(data,'ΦD'),values),orientation*8e-10,1e-22);
    assert.ok(data.boundaries[1].explanation.includes('유한한 0으로 대체하지'));
  }
  assert.equal(checkedFormula(answer(line.symbolic({ zeroSource:1 }),'E_r'),{}),0);
});
test('sheet straddle/above/below oriented cap algebra matches independent enclosed charge and units', () => {
  const eps=8.8541878188e-12, values=env({ 'σ':[4e-9,'C/m²'],A:[.03,'m²'],'ε':[eps,'F/m'] });
  for (const surfacePlacement of [0,1,2]) for (const orientation of [1,-1]) {
    const data=sheet.symbolic({ surfacePlacement,orientation });
    const top=checkedFormula(answer(data,'ΦD,top'),values), bottom=checkedFormula(answer(data,'ΦD,bottom'),values);
    const expected=surfacePlacement === 0 ? orientation*1.2e-10:0;
    near(top+bottom,expected,1e-22); near(checkedFormula(answer(data,'ΦD'),values),expected,1e-22);
    near(checkedFormula(answer(data,'Qenc'),values),surfacePlacement===0 ? 1.2e-10:0,1e-22);
    near(substitute(data.regions[0].formula,values).value,225.88181332153604);
    near(substitute(data.regions[1].formula,values).value,-225.88181332153604);
    const centerZ=[0,.2,-.2][surfacePlacement], numeric=sheet.evaluate({ ...initial(sheet),centerZ },[0,0,.1]);
    near(checkedFormula(answer(data,'ΦE'),values),orientation*scalar(numeric,'fluxE'));
  }
  assert.equal(sheet.symbolic({ surfacePlacement:3 }).status,'unsupported');
  assert.equal(sheet.symbolic({ surfacePlacement:3,zeroSource:1 }).status,'supported');
});
test('Ampere filament/cylinder and path orientation substitute signed enclosed current, H/B and units', () => {
  const mu=1.25663706127e-6, values=env({ I:[3,'A'],R:[.1,'m'],r:[.1,'m'],a:[.2,'m'],'μ':[mu,'H/m'],'π':[Math.PI,'1'] });
  for (const wireMode of [0,1]) for (const orientation of [1,-1]) {
    const pathRegion=wireMode ? 1:0, data=wire.symbolic({ wireMode,pathRegion,orientation });
    near(checkedFormula(answer(data,'Ienc(R)'),values),orientation*(wireMode ? .75:3));
    near(checkedFormula(answer(data,'ΓH'),values),orientation*(wireMode ? .75:3));
    near(checkedFormula(answer(data,'ΓB'),values),orientation*(wireMode ? .75:3)*mu,1e-18);
    const field=wireMode ? data.regions[0]:answer(data,'H(r)');
    const h=substitute(field.formula,values); assert.deepEqual(h.dimension,units['A/m']);
    near(h.value,wireMode ? 1.193662073189215:4.77464829275686);
    const numeric=wire.evaluate({ ...initial(wire),wireRadius:wireMode ? .2:0,orientation },[.1,0,0]);
    near(h.value,numeric.vectors.H[1]); near(mu*h.value,numeric.vectors.B[1],1e-18);
    assert.ok(answer(data,'B(r)').direction.includes('바뀌지 않음'));
  }
});
test('Ampere uniform cylinder boundaries and on-surface path remain symbolic and continuous', () => {
  const values=env({ I:[3,'A'],a:[.2,'m'],r:[.2,'m'],'π':[Math.PI,'1'] });
  const data=wire.symbolic({ wireMode:1,pathRegion:2 });
  near(substitute(data.regions[0].formula,values).value,substitute(data.regions[1].formula,values).value);
  assert.equal(data.status,'supported'); assert.ok(data.boundaries[1].explanation.includes('연속'));
  const zero=substitute(data.regions[0].formula,{ ...values,r:given(0,'m') }); near(zero.value,0);
  assert.equal(wire.symbolic({ wireMode:0,pathRegion:1 }).status,'unsupported');
  assert.equal(wire.symbolic({ wireMode:0,pathRegion:2 }).status,'unsupported');
  assert.equal(checkedFormula(answer(wire.symbolic({ zeroSource:1 }),'ΓB'),{}),0);
});

test('reference, normal and cap placement choices explicitly change derivation and answer domains', () => {
  const upper=plate.symbolic(), lower=plate.symbolic({ potentialReference:1 });
  assert.notDeepEqual(upper.steps,lower.steps);
  assert.notEqual(answer(upper,'V(z)').formula,answer(lower,'V(z)').formula);
  assert.notDeepEqual(face.symbolic().steps,face.symbolic({ normalDirection:-1 }).steps);
  const above=sheet.symbolic({ surfacePlacement:1 }), below=sheet.symbolic({ surfacePlacement:2 });
  assert.notDeepEqual(above.steps,below.steps);
  assert.notEqual(answer(above,'ΦD,top').formula,answer(below,'ΦD,top').formula);
  const exterior=wire.symbolic({ wireMode:1,pathRegion:0 }), surface=wire.symbolic({ wireMode:1,pathRegion:2 });
  assert.notDeepEqual(exterior.steps,surface.steps);
  assert.notEqual(answer(exterior,'Ienc(R)').direction,answer(surface,'Ienc(R)').direction);
});
