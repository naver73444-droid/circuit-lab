import test from 'node:test';
import assert from 'node:assert/strict';
import { parseProblemQuantity, solveCourseProblem, PROBLEM_EXPERIMENT } from '../../../src/circuit-course-problem.js';
import { initialParameters, evaluateExperiment } from '../../../src/circuit-course-registry.js';
const near = (a,b,t=1e-8)=>assert.ok(Number.isFinite(a)&&Math.abs(a-b)<=t,a+' != '+b);
const base = ()=>({...initialParameters(PROBLEM_EXPERIMENT),solutionMode:'numeric',voltage:100,frequencyHz:50,sourceAngle:0,r:3,l:4/(100*Math.PI)});
const valid = p => {const r=evaluateExperiment('problem',p);assert.equal(r.status,'valid',r.reason);return r;};
test('manual worksheet starts blank and never invents missing conditions or source voltage',()=>{
  const r=evaluateExperiment('problem',{...initialParameters(PROBLEM_EXPERIMENT),solutionMode:'numeric'});assert.equal(r.status,'invalid');assert.equal(r.solution,undefined);
  for(const key of ['voltage','frequencyHz','r','l']){const p=base();p[key]=null;const r=solveCourseProblem(p);assert.equal(r.status,'invalid');assert.equal(r.solution,undefined);}
});
test('compatible quantity prefixes and angular frequency convert to SI',()=>{
  near(parseProblemQuantity('10 kΩ','resistance','ohm'),10000);
  near(parseProblemQuantity('2 MΩ','resistance','ohm'),2e6);
  near(parseProblemQuantity('20 mΩ','resistance','ohm'),.02);
  near(parseProblemQuantity('12.732395447351627 mH','inductance','mH'),4/(100*Math.PI));
  near(parseProblemQuantity('100µF','capacitance','uF'),1e-4);
  near(parseProblemQuantity('100 nF','capacitance','uF'),1e-7);
  near(parseProblemQuantity('0.4 kV','voltage','V'),400);
  near(parseProblemQuantity('0.05 kHz','frequency','Hz'),50);
  near(parseProblemQuantity(String(100*Math.PI)+' rad/s','frequency','Hz'),50);
  near(parseProblemQuantity('0.5235987755982988 rad','angle','deg'),30);
  near(parseProblemQuantity('1 kW','power','W'),1000);
  near(parseProblemQuantity('7.5 kvar','reactive','var'),7500);
  near(parseProblemQuantity('20','inductance','mH'),.02);
});
test('incompatible, ambiguous, missing or nonfinite quantity text is rejected',()=>{
  for(const text of ['', ' ', '10 V','1 kW','12banana','1e999 Ω','1e-999 Ω','0x10 Ω'])assert.throws(()=>parseProblemQuantity(text,'resistance','ohm'));
  assert.throws(()=>parseProblemQuantity('1 mh','inductance','mH'));
  assert.throws(()=>parseProblemQuantity('60 hz','frequency','Hz'));
});
test('manually typed RL values produce requested current, actual substitutions and independent checks',()=>{
  const p=base();p.r=parseProblemQuantity('3Ω','resistance','ohm');p.l=parseProblemQuantity('12.732395447351627mH','inductance','mH');p.problemText='내 문제: 전류를 구하라.';
  const r=valid(p);near(r.I.re,12);near(r.I.im,-16);near(r.solution.answers[0].value,20);
  assert.equal(r.solution.answers[0].unit,'A');assert.equal(r.solution.statement,p.problemText);assert.equal(r.solution.answers.length,1);
  assert.ok(r.solution.steps.some(s=>s.formula==='I=V_RMS Y_eq'));
  assert.ok(r.solution.steps.some(s=>s.substitution.includes('12.732')||s.substitution.includes('0.012732')));
  assert.ok(r.checks.every(c=>c.pass));near(r.power.pWatts,1200);near(r.power.qVars,1600);
});
test('peak and RMS versions of a manually specified problem give same current/power',()=>{
  const rms=valid(base()),peak=valid({...base(),basis:'peak',voltage:100*Math.SQRT2,sourceAngle:30});
  near(peak.power.pWatts,1200);near(peak.power.qVars,1600);near(peak.solution.answers[0].value,rms.solution.answers[0].value);
  assert.equal(peak.solution.steps[0].formula,'V_RMS=V_peak/√2');
});
test('parallel RC worksheet requested impedance and power use capacitive sign',()=>{
  const p={...base(),topology:'parallel',elements:'RC',r:100,c:1/(200*100*Math.PI),singleGoal:'power'};
  const r=valid(p);near(r.power.pWatts,100);near(r.power.qVars,-50);assert.equal(r.solution.answers.length,3);assert.ok(r.checks.every(c=>c.pass));
  const z=valid({...p,singleGoal:'impedance'});near(z.Z.re,80);near(z.Z.im,-40);
});
test('balanced given Vab angle is converted to Van; requested line currents match independent fixture',()=>{
  const p={...base(),problemKind:'three',voltage:400,voltageKnown:'line',sourceAngle:30,r:8,x:6,connection:'Y',threeGoal:'line-current'};
  const r=valid(p);near(r.phaseVoltages[0].im,0);near(r.power.pWatts,12800);near(r.power.qVars,9600);near(r.lineCurrentRms,23.094010767585033);
  assert.equal(r.solution.answers.length,3);assert.ok(r.solution.steps.some(s=>s.formula==='S₃=Σ(V상 I상*)=3 Van Ia*'));assert.ok(r.checks.every(c=>c.pass));
});
test('given Y phase voltage and delta branch voltage magnitude/angle are interpreted correctly',()=>{
  const p={...base(),problemKind:'three',voltageKnown:'phase',r:8,x:6,connection:'Y',voltage:400/Math.sqrt(3),sourceAngle:0,threeGoal:'phase-voltage'};
  const y=valid(p);near(y.loadVoltageRms,400/Math.sqrt(3));near(y.power.pWatts,12800);
  const d=valid({...p,connection:'delta',voltage:400,sourceAngle:30,r:24,x:18,threeGoal:'phase-current'});near(d.lineCurrentRms,y.lineCurrentRms);near(d.power.qVars,9600);
});
test('given impedance permits frequency-free 3phase answer but no invented waveform',()=>{
  const r=valid({...base(),problemKind:'three',voltage:400,sourceAngle:30,r:8,x:6,connection:'Y',frequencyHz:null,threeGoal:'power'});
  near(r.power.pWatts,12800);assert.equal(r.traces.length,0);assert.equal(r.frequencyHz,null);assert.ok(r.solution.notes.some(n=>n.includes('생략')));
  assert.equal(solveCourseProblem({...base(),frequencyHz:null}).status,'invalid');
});
test('correction worksheet reports each capacitor, unchanged P, current and independently checked target Q',()=>{
  const p={...base(),problemKind:'correction',voltage:400,phases:'3',connection:'delta',pWatts:10000,qVars:7500,targetPF:.95,correctionGoal:'capacitance'};
  const r=valid(p);near(r.solution.answers[0].value,27.939378026777);near(r.qCapacitorVars,-4213.158948211369);assert.ok(r.checks.every(c=>c.pass));
  const current=valid({...p,correctionGoal:'source-current'});near(current.solution.answers[1].value,15.1934281365691);
  const impossible=solveCourseProblem({...p,qVars:-7500});assert.equal(impossible.status,'unsupported');assert.equal(impossible.solution,undefined);
});
test('unsupported topology/goal, zero frequency and invalid component values never fabricate solutions',()=>{
  for(const p of [{...base(),problemKind:'arbitrary'},{...base(),topology:'bridge'},{...base(),singleGoal:'line-current'},{...base(),frequencyHz:0},{...base(),l:-1},{...base(),r:0}]){
    const r=solveCourseProblem(p);assert.notEqual(r.status,'valid');assert.equal(r.solution,undefined);
  }
});
test('advertised problems are explicitly fictional and have correct fixed independent outcomes',()=>{
  for(const e of PROBLEM_EXPERIMENT.examples){assert.ok(e.label.includes('가상'));const r=valid({...initialParameters(PROBLEM_EXPERIMENT),...e.values});assert.ok(r.solution.statement.includes('가상'));assert.ok(r.checks.every(c=>c.pass));}
});
