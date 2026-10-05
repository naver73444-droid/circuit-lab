import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePointChargeWorld, validateEMSources } from '../src/em-playground-physics.js';

const C=299792458,MU=1.25663706127e-6,K=MU*C*C/(4*Math.PI),A=K*1e-9;
const close=(actual,expected,abs=1e-8,rel=1e-10)=>assert.ok(Math.abs(actual-expected)<=abs+rel*Math.abs(expected),`${actual} != ${expected}`);
const vector=(actual,expected,abs=1e-8)=>actual.forEach((value,index)=>close(value,expected[index],abs));
const finite=(extra={})=>({id:'f',type:'finite-line',lambda:1e-9,start:[0,0,-1],end:[0,0,1],enabled:true,visible:true,...extra});
const infinite=(extra={})=>({id:'i',type:'infinite-line',lambda:1e-9,position:[0,0,0],direction:[0,0,1],sRef:1,displayLength:4,enabled:true,visible:true,...extra});

test('P06 finite line closed form, endpoint reversal and lambda sign',()=>{
  const expectedV=2*A*Math.asinh(1),expectedE=[Math.SQRT2*A,0,0];
  let result=evaluatePointChargeWorld([finite()],[1,0,0]);vector(result.E,expectedE);close(result.potential,expectedV);vector(result.gradV,expectedE.map(v=>-v));
  result=evaluatePointChargeWorld([finite({start:[0,0,1],end:[0,0,-1]})],[1,0,0]);vector(result.E,expectedE);close(result.potential,expectedV);
  result=evaluatePointChargeWorld([finite({lambda:-1e-9})],[1,0,0]);vector(result.E,expectedE.map(v=>-v));close(result.potential,-expectedV);
});

test('P07 finite line outside-axis limit stays valid on both sides and near the axis',()=>{
  let result=evaluatePointChargeWorld([finite()],[0,0,2]);vector(result.E,[0,0,2*A/3]);close(result.potential,A*Math.log(3));
  result=evaluatePointChargeWorld([finite()],[0,0,-2]);vector(result.E,[0,0,-2*A/3]);close(result.potential,A*Math.log(3));
  result=evaluatePointChargeWorld([finite()],[1e-6,0,2]);assert.equal(result.status,'valid');close(result.E[0],4*A*1e-6/9,5e-6,0);close(result.E[1],0);close(result.E[2],2*A/3);close(result.potential,A*Math.log(3));
});

test('P08 lambda-fixed length change and translation preserve their independent expectations',()=>{
  let result=evaluatePointChargeWorld([finite({start:[0,0,-2],end:[0,0,2]})],[1,0,0]);vector(result.E,[4*A/Math.sqrt(5),0,0]);close(result.potential,2*A*Math.asinh(2));
  result=evaluatePointChargeWorld([finite({start:[1,2,-1],end:[1,2,1]})],[2,2,0]);vector(result.E,[Math.SQRT2*A,0,0]);close(result.potential,2*A*Math.asinh(1));
});

test('P09 infinite line reference potential and direction invariance',()=>{
  let result=evaluatePointChargeWorld([infinite()],[1,0,0]);vector(result.E,[2*A,0,0]);close(result.potential,0);
  result=evaluatePointChargeWorld([infinite({direction:[0,0,-1],displayLength:10})],[2,0,0]);vector(result.E,[A,0,0]);close(result.potential,-2*A*Math.log(2));
  const shifted=evaluatePointChargeWorld([infinite({sRef:2})],[2,0,0]);vector(shifted.E,[A,0,0]);close(shifted.potential,0);
});

test('P10 mixed point and infinite line superpose and reorder',()=>{
  const point={id:'p',type:'point',q:1e-9,position:[0,0,0],enabled:true,visible:true},line=infinite();
  const first=evaluatePointChargeWorld([point,line],[1,0,0]),second=evaluatePointChargeWorld([line,point],[1,0,0]);vector(first.E,[3*A,0,0]);close(first.potential,A);vector(second.E,first.E);close(second.potential,first.potential);
});

test('line validation and exclusion distinguish finite segment from infinite axis',()=>{
  assert.throws(()=>validateEMSources([finite({end:[0,0,-1]})]),/1 µm/);
  assert.throws(()=>validateEMSources([infinite({direction:[0,0,0]})]),/방향/);
  assert.throws(()=>validateEMSources([infinite({sRef:0})]),/0.001/);
  assert.equal(evaluatePointChargeWorld([finite()],[0,0,0]).status,'excluded');
  assert.equal(evaluatePointChargeWorld([finite()],[0,0,2]).status,'valid');
  assert.equal(evaluatePointChargeWorld([infinite()],[0,0,2]).status,'excluded');
  assert.equal(evaluatePointChargeWorld([finite({lambda:0})],[0,0,0]).status,'valid');
});
