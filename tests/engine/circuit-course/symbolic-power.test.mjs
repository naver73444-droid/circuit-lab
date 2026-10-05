import test from 'node:test';import assert from 'node:assert/strict';
import {solveSymbolicProblem} from '../../../src/circuit-course-problem-symbolic.js';
const base={problemKind:'single',basis:'rms',topology:'series',elements:'RL',singleGoal:'power',symbolVoltage:'V_s',symbolOmega:'ω',symbolR:'R',symbolL:'L',symbolC:'C',symbolZ:'Z_s'};
for(const [topology,basis]of [['series','rms'],['parallel','rms'],['series','peak']])test('single '+topology+' '+basis+' power request includes distinct apparent magnitude in VA',()=>{
  const r=solveSymbolicProblem({...base,topology,basis});assert.equal(r.status,'valid');const a=r.solution.answers.find(a=>a.label==='피상전력 |S|');assert.ok(a,'explicit requested magnitude');assert.equal(a.unit,'VA');assert.match(a.text,/√\(P²\+Q²\)/);assert.match(a.text,/V_s/);
  assert.ok(r.solution.answers.some(a=>a.label==='복소전력 S'));assert.ok(r.solution.steps.some(s=>s.formula.includes('|S|=√(P²+Q²)')));
  if(topology==='parallel')assert.ok(!a.text.includes('/|('),'admittance magnitude supports zero-admittance limit');
  if(basis==='peak')assert.ok(a.text.includes('/2'),'peak square includes RMS factor one half');
});
for(const [connection,voltageKnown,multiplier]of [['Y','line',1],['Y','phase',3],['delta','line',3]])test('balanced '+connection+' '+voltageKnown+' total magnitude preserves total-power multiplier',()=>{
  const r=solveSymbolicProblem({...base,problemKind:'three',connection,voltageKnown,threeGoal:'power'});assert.equal(r.status,'valid');const a=r.solution.answers.find(a=>a.label==='총 피상전력 |S₃|');assert.ok(a);assert.equal(a.unit,'VA');assert.match(a.text,/√\(P²\+Q²\)/);assert.equal(a.text.includes('3×'),multiplier===3);assert.ok(a.text.includes('/|Z_s|'));assert.ok(r.solution.answers.some(a=>a.label==='총 복소전력 S₃'));assert.ok(r.solution.steps.some(s=>s.formula.includes('|S₃|=√(P²+Q²)')));
});
test('unrelated current goal stays focused on requested current',()=>{const r=solveSymbolicProblem({...base,singleGoal:'current'});assert.equal(r.status,'valid');assert.ok(r.solution.answers.every(a=>a.unit==='A'));assert.ok(!r.solution.answers.some(a=>a.label.includes('피상')));});
