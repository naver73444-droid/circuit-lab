import test from 'node:test';
import assert from 'node:assert/strict';
import {solveSymbolicProblem,symbolicCourseExperiment}from'../src/circuit-course-problem-symbolic.js';
import{PROBLEM_EXPERIMENT,solveCourseProblem}from'../src/circuit-course-problem.js';
import{EXPERIMENTS,initialParameters,evaluateExperiment}from'../src/circuit-course-registry.js';
const near=(a,b,t=1e-8)=>assert.ok(Number.isFinite(a)&&Math.abs(a-b)<=t,a+' != '+b);
const base=()=>({...initialParameters(PROBLEM_EXPERIMENT),solutionMode:'symbolic'});
const valid=p=>{const r=solveSymbolicProblem(p);assert.equal(r.status,'valid',r.reason);return r;};
test('all five course areas and worksheet start with symbolic law/derivation and no invented numeric curves',()=>{
 for(const e of EXPERIMENTS){const p=initialParameters(e),r=evaluateExperiment(e.id,p);assert.equal(r.status,'valid',e.id+': '+r.reason);assert.ok(r.symbolic);assert.ok(r.solution.steps.length>=4);assert.equal(r.traces.length,0);assert.equal(r.power,undefined);}
});
test('RLC series and parallel templates omit absent components and preserve capacitive/inductive signs',()=>{
 const rl=valid({...base(),elements:'RL'}).solution.canonical;
 assert.equal(rl.Z,'R+j(ω·L)');assert.ok(!rl.Z.includes('C'));
 const rc=valid({...base(),elements:'RC'}).solution.canonical;
 assert.equal(rc.Z,'R−j(1/(ω·C))');
 const all=valid({...base(),elements:'RLC'}).solution.canonical;
 assert.equal(all.Z,'R+j(ω·L−1/(ω·C))');
 const parallel=valid({...base(),topology:'parallel',elements:'RLC'}).solution.canonical;
 assert.equal(parallel.Y,'1/R+j(ω·C−1/(ω·L))');
 assert.ok(parallel.Q.startsWith('−'));assert.ok(parallel.phi.startsWith('−atan2'));
});
test('pure R L C simplify PF/phase and Q signs with correct physical domains',()=>{
 for(const topology of['series','parallel']){
  const r=valid({...base(),topology,elements:'R',singleGoal:'pf'}).solution.canonical;assert.equal(r.Q,'0');assert.equal(r.pf,'1');assert.equal(r.phi,'0');
  const l=valid({...base(),topology,elements:'L',singleGoal:'pf'}).solution.canonical;assert.equal(l.P,'0');assert.equal(l.pf,'0');assert.equal(l.phi,'π/2');assert.ok(!l.Q.startsWith('−'));
  const c=valid({...base(),topology,elements:'C',singleGoal:'pf'}).solution.canonical;assert.equal(c.P,'0');assert.equal(c.phi,'−π/2');assert.ok(c.Q.startsWith('−'));
 }
 const lc=valid({...base(),elements:'LC'});assert.ok(lc.solution.notes.some(n=>n.includes('Z=0')));assert.ok(lc.solution.notes.some(n=>n.includes('Y=0')));
});
test('symbol names are editable and do not admit arbitrary expressions or dimension aliases',()=>{
 const r=valid({...base(),symbolR:'R1',symbolL:'L_a',symbolVoltage:'V_s',symbolOmega:'w'});
 assert.ok(r.solution.canonical.Z.includes('R1'));assert.ok(r.solution.canonical.Z.includes('w·L_a'));
 for(const p of[{...base(),symbolR:'R+jX'},{...base(),symbolVoltage:'123'},{...base(),symbolR:'V'},{...base(),symbolL:''}])assert.equal(solveSymbolicProblem(p).status,'invalid');
});
test('series RL and RC textual relations agree with independent 3±j4 numeric fixtures',()=>{
 for(const elements of['RL','RC']){
  const symbolic=valid({...base(),elements,singleGoal:'power'}).solution.canonical;
  const omega=100*Math.PI,R=3,L=4/omega,C=1/(4*omega),X=elements==='RL'?omega*L:-1/(omega*C),V2=10000;
  const P=V2*R/(R*R+X*X),Q=V2*X/(R*R+X*X);
  near(P,1200);near(Q,elements==='RL'?1600:-1600);
  const numeric=solveCourseProblem({...base(),solutionMode:'numeric',voltage:100,frequencyHz:50,sourceAngle:0,elements,r:R,l:L,c:C});
  near(numeric.power.pWatts,P);near(numeric.power.qVars,Q);
  assert.ok(symbolic.P.includes('R'));assert.ok(symbolic.Q.includes(elements==='RL'?'ω·L':'−1/(ω·C)'));
 }
});
test('parallel admittance symbolic relation gives Q=-|V|²B and correct independent fixture',()=>{
 const r=valid({...base(),topology:'parallel',elements:'RLC',singleGoal:'power'});
 const G=1/100,B=1/200-1/100;near(10000*G,100);near(-10000*B,50);
 assert.equal(r.solution.canonical.Y,'1/R+j(ω·C−1/(ω·L))');assert.ok(r.solution.canonical.Q.includes('ω·C−1/(ω·L)'));
});
test('RMS versus peak factors are retained in phasor, power and RLC template relations',()=>{
 const rms=symbolicCourseExperiment('power',{basis:'rms'}),peak=symbolicCourseExperiment('power',{basis:'peak'});
 assert.equal(rms.solution.canonical.factor,1);assert.equal(peak.solution.canonical.factor,.5);assert.ok(peak.solution.answers[0].text.startsWith('½'));
 const phi=Math.acos(.6);near(peak.solution.canonical.factor*100*20*Math.cos(phi),600);near(rms.solution.canonical.factor*100*20*Math.cos(phi),1200);
 const p=valid({...base(),basis:'peak'});assert.equal(p.solution.canonical.voltageSquare,'|V|²/2');
 const phasor=symbolicCourseExperiment('phasor-wave',{basis:'peak'});assert.equal(phasor.solution.canonical.rms,'(V/√2)');assert.ok(phasor.solution.notes.some(n=>n.includes('위상 미정')));
});
test('balanced Y delta symbolic complex relations include ±30 and power factor1/3 correctly',()=>{
 for(const connection of['Y','delta'])for(const voltageKnown of['line','phase']){
  const r=valid({...base(),problemKind:'three',connection,voltageKnown,threeGoal:'power'});
  const c=r.solution.canonical;assert.equal(c.powerMultiplier,connection==='Y'&&voltageKnown==='line'?1:3);
  const v=voltageKnown==='phase'&&connection==='Y'?400/Math.sqrt(3):400,den=100;
  near(c.powerMultiplier*v*v*8/den,connection==='Y'?12800:38400);near(c.powerMultiplier*v*v*6/den,connection==='Y'?9600:28800);
  assert.ok(r.solution.steps.some(s=>s.substitution.includes('e^(−jπ/6)')));
  if(connection==='delta')assert.ok(c.Ia.includes('e^(−jπ/6)'));
 }
});
test('single Y delta capacitor templates agree with fixed correction fixtures and state feasibility',()=>{
 const single=valid({...base(),problemKind:'correction',phases:'1'}).solution.canonical;assert.equal(single.capacitorMultiplier,1);
 near(750/(single.capacitorMultiplier*2*Math.PI*60*120**2)*1e6,138.15533254504802);
 const target=10000*Math.sqrt(1-.95**2)/.95;
 for(const connection of['Y','delta']){
  const r=valid({...base(),problemKind:'correction',phases:'3',connection});const c=r.solution.canonical;
  near((7500-target)/(c.capacitorMultiplier*2*Math.PI*50*400**2)*1e6,connection==='Y'?83.818134080331:27.939378026777);
  assert.ok(r.solution.notes.some(n=>n.includes('커패시터만')));
 }
});
test('supported symbol goals give requested expressions without numbers or fake substitutions',()=>{
 for(const goal of['current','impedance','branch','power','pf']){const r=valid({...base(),singleGoal:goal});assert.equal(r.solution.asked,goal);assert.ok(r.solution.answers.every(a=>typeof a.text==='string'));assert.ok(r.solution.steps.every(s=>typeof s.formula==='string'));}
 assert.equal(solveSymbolicProblem({...base(),elements:''}).status,'invalid');
 assert.equal(solveSymbolicProblem({...base(),problemKind:'unbalanced'}).status,'invalid');
});

test('shared symbolic schema exposes selected symbols, units and requested answers without numeric substitution',()=>{
 for(const e of EXPERIMENTS){const p=initialParameters(e),r=evaluateExperiment(e.id,p),d=r.symbolicData;assert.equal(d.status,'supported');for(const key of ['givens','assumptions','conditions','laws','steps','answers','regions','boundaries','limitations'])assert.ok(Array.isArray(d[key]),e.id+' '+key);assert.deepEqual(d.answers.map(a=>a.formula),r.solution.answers.map(a=>a.text));assert.ok(d.givens.some(g=>g.unit==='rad/s'));assert.ok(d.givens.some(g=>g.unit==='V'));assert.ok(d.laws.length>=4);}
 const r=evaluateExperiment('problem',{...base(),symbolR:'R_load',symbolOmega:'w_s'});assert.ok(r.symbolicData.givens.some(g=>g.symbol==='R_load'&&g.constraint==='R_load>0'));assert.ok(r.symbolicData.givens.some(g=>g.symbol==='w_s'&&g.constraint==='w_s>0'));
});
test('numeric illustrations retain a symbolic companion from the same structural choices',()=>{
 for(const e of EXPERIMENTS.filter(e=>e.id!=='problem')){const r=evaluateExperiment(e.id,{...initialParameters(e),presentation:'numeric'});assert.equal(r.status,'valid');assert.equal(r.symbolicData.status,'supported');assert.ok(r.symbolicData.answers.length);assert.equal(r.symbolic,undefined);}
 const r=evaluateExperiment('problem',{...base(),solutionMode:'numeric',voltage:100,frequencyHz:50,r:3,l:4/(100*Math.PI)});assert.equal(r.status,'valid',r.reason);near(r.I.im,-16);assert.equal(r.symbolicData.status,'supported');assert.ok(r.symbolicData.answers[0].formula.includes('R'));assert.equal(r.symbolicData.answers[0].formula.includes('100'),false);
});
