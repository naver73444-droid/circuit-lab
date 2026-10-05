import test from 'node:test';
import assert from 'node:assert/strict';
import {sequenceTransform,convolutionFrame,exponentialProduct,cursorDomain} from '../src/signals-visual.js';
import {rectangleConvolution,exponentialConvolution} from '../src/signals-course-model.js';
test('independent DT transform contract drops noninteger mappings and reverses integer grid',()=>{
  assert.deepEqual(sequenceTransform([2,4,6],-1,2,1),[{k:-1,n:0,value:2},{k:1,n:1,value:6}]);
  assert.deepEqual(sequenceTransform([2,4,6],-1,-1,0).map(v=>v.value),[6,4,2]);
  assert.throws(()=>sequenceTransform([1],0,0,1));assert.throws(()=>sequenceTransform([1],0,1.5,1));
});
test('independent DT convolution offsets, signed/zero terms and outside support',()=>{
  const frame=convolutionFrame([1,2,-1],[2,1],-1,2,2);
  assert.deepEqual(frame.output,{start:1,values:[2,5,0,-1]});
  assert.deepEqual(frame.terms.map(v=>v.product),[1,4,-0]);assert.equal(frame.sum,5);
  for(const n of [0,1,2,3,4,5])assert.equal(convolutionFrame([1,2,-1],[2,1],-1,2,n).sum,({1:2,2:5,3:0,4:-1}[n]||0));
});
test('CT rectangle visual cursor uses exact independent overlap fixtures',()=>{
  assert.deepEqual([-.5,0,.5,1,1.5,2,2.5,3].map(t=>rectangleConvolution(t,2,1).y),[0,0,.5,1,1,1,.5,0]);
});
test('CT exponential integrand and exact output agree with independent contract',()=>{
  assert.equal(exponentialProduct(-.1,1,1,2),0);assert.equal(exponentialProduct(.1,-1,1,2),0);
  assert.ok(Math.abs(exponentialProduct(.25,1,1,2)-Math.exp(-1.75))<1e-12);
  assert.ok(Math.abs(exponentialConvolution(1,1,1)-1/Math.E)<1e-12);
  assert.ok(Math.abs(exponentialConvolution(1,1,2)-(Math.exp(-1)-Math.exp(-2)))<1e-12);
});
test('DT cursor domain is an integer grid and includes both zero-support ends',()=>{
  assert.deepEqual(cursorDomain('convolution',{family:'sequence'},{output:{start:1,values:[2,5,0,-1]}}),{min:0,max:5,step:1,unit:'n [sample]'});
});
