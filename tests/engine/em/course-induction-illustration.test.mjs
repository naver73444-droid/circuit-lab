import test from 'node:test';import assert from 'node:assert/strict';
import {inductionAfterStructural,inductionAfterNumeric,inductionNumericReason} from '../../../src/course-illustration-contract.js';
import {getExperiment} from '../../../src/em-course-registry.js';
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<=1e-12*Math.max(1,Math.abs(expected)),`${actual} vs ${expected}`);
const scalar=(out,key)=>out.scalars.find(s=>s.key===key)?.value;
const loop=getExperiment('faraday-loop'),rod=getExperiment('motional-rod');
const defaults=d=>Object.fromEntries(d.parameters.map(p=>[p.key,p.initial]));
const lp={...defaults(loop),B0:.4,area:.2,theta:Math.PI/3,turns:10,omega:3,time:.5,closedCircuit:1,resistance:5};
const options={closedCircuit:1,normalOrientation:0,alignment:0,fieldRegime:0};
for(const [name,key,choice]of [['parallel','alignment',1],['perpendicular','alignment',2],['static','fieldRegime',1]])test('induction structural '+name+' agrees with independent flux/emf law',()=>{
  const selected={...options,[key]:choice};const mapped=inductionAfterStructural(loop.id,lp,selected,key);const p=mapped.params,out=loop.evaluate(p,[0,0,0]);assert.equal(out.status,'valid');
  const expectedFlux=p.area*p.B0*Math.cos(p.omega*p.time)*Math.cos(p.theta),expectedEmf=p.turns*p.area*p.omega*p.B0*Math.sin(p.omega*p.time)*Math.cos(p.theta);
  near(scalar(out,'flux'),expectedFlux);near(scalar(out,'emf'),expectedEmf);near(scalar(out,'current'),expectedEmf/p.resistance);
  const symbolic=loop.symbolic(selected);assert.equal(symbolic.status,'supported');assert.equal(inductionNumericReason(loop.id,selected),'');
  if(name!=='parallel'){near(scalar(out,'emf'),0);assert.equal(symbolic.answers.find(a=>a.quantity==='ℰ(t)').formula,'ℰ(t) = 0');}
});
test('induction ordinary angle/frequency examples restore after special conditions',()=>{
  let a=inductionAfterStructural(loop.id,lp,{...options,alignment:2},'alignment');a=inductionAfterStructural(loop.id,a.params,options,'alignment',a.memory);assert.equal(a.params.theta,lp.theta);
  let b=inductionAfterStructural(loop.id,lp,{...options,fieldRegime:1},'fieldRegime');b=inductionAfterStructural(loop.id,b.params,options,'fieldRegime',b.memory);assert.equal(b.params.omega,lp.omega);
  assert.deepEqual(lp,{...defaults(loop),B0:.4,area:.2,theta:Math.PI/3,turns:10,omega:3,time:.5,closedCircuit:1,resistance:5});
});
test('induction numeric input selects exact structural conditions without changing signs',()=>{
  let s=inductionAfterNumeric(loop.id,{...lp,theta:0,omega:0},options);assert.equal(s.options.alignment,1);assert.equal(s.options.fieldRegime,1);
  s=inductionAfterNumeric(loop.id,{...lp,theta:Math.PI/2},options);assert.equal(s.options.alignment,2);
  s=inductionAfterNumeric(loop.id,{...lp,theta:-Math.PI/2},options);assert.equal(s.options.alignment,0);
  assert.equal(loop.evaluate({...lp,theta:0,omega:0},[0,0,0]).status,'valid');
});
test('stationary/moving rod maps velocity and retains original signed example',()=>{
  const rp={...defaults(rod),velocity:-.5,x0:1,time:.2},o={closedCircuit:0,normalOrientation:0,motionRegime:1};let a=inductionAfterStructural(rod.id,rp,o,'motionRegime');assert.equal(a.params.velocity,0);const out=rod.evaluate(a.params,[0,0,0]);assert.equal(out.status,'valid');near(scalar(out,'emf'),0);
  a=inductionAfterStructural(rod.id,a.params,{...o,motionRegime:0},'motionRegime',a.memory);assert.equal(a.params.velocity,-.5);const moving=rod.evaluate(a.params,[0,0,0]);near(scalar(moving,'emf'),-rp.B*rp.length*rp.velocity);
  assert.equal(inductionAfterNumeric(rod.id,{...rp,velocity:0},o).options.motionRegime,1);assert.equal(inductionAfterNumeric(rod.id,rp,o).options.motionRegime,0);
});
test('reversed normal remains symbolic and is explicitly unavailable numerically',()=>{
  for(const d of [loop,rod]){const selected={normalOrientation:1};assert.equal(d.symbolic(selected).status,'supported');assert.match(inductionNumericReason(d.id,selected),/基本|기본 법선/);assert.equal(inductionNumericReason(d.id,{normalOrientation:0}),'');}
});
