import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSignalExpression,signalValue,prepareCustomConvolution,customConvolutionAt} from '../src/signals-expression.js';
import {playbackCursor} from '../src/signals-playback.js';
import {discreteConvolution} from '../src/signals-course-model.js';
const near=(a,b,tol=1e-10)=>assert.ok(Math.abs(a-b)<=tol,`${a} vs ${b}`);
test('restricted grammar and conventions are independent of JavaScript',()=>{
  near(signalValue(parseSignalExpression('cos(pi*t)+sin(pi/2)-2/4'),0),1.5);
  assert.equal(signalValue(parseSignalExpression('u(t)'),0),.5);assert.equal(signalValue(parseSignalExpression('rect(t)'),.5),.5);
  for(const source of ['globalThis','alert(1)','t.constructor','t[0]','1;2','2t','t**2','t^2','Infinity','1e-999','exp()','(()=>1)()','1'.repeat(257),'('.repeat(25)+'t'+')'.repeat(25)])assert.throws(()=>parseSignalExpression(source),source);
});
test('independent CT rectangle fixture and DT offset exact values',()=>{
  const p=prepareCustomConvolution('u(t)-u(t-2)','u(t)-u(t-1)',4,.02);
  for(const[t,y]of [[-.5,0],[0,0],[.5,.5],[1,1],[1.5,1],[2,1],[2.5,.5],[3,0]])near(customConvolutionAt(p,t),y,1e-12);
  assert.deepEqual(discreteConvolution([1,2,-1],[2,1],-1,2),{start:1,values:[2,5,0,-1]});
});
test('both signals are zero outside their windows, with signed constant oracle',()=>{
  const p=prepareCustomConvolution('1','-2',1,.01);
  for(const[t,y]of [[-2,0],[-1,-2],[0,-4],[1,-2],[2,0]])near(customConvolutionAt(p,t),y);
});
test('truncated exponential near full support and after truncation',()=>{
  const p=prepareCustomConvolution('exp(-t)*u(t)','exp(-t)*u(t)',2,.01);
  near(customConvolutionAt(p,1),Math.exp(-1),1e-12);
  near(customConvolutionAt(p,3),Math.exp(-3),1e-12); // overlap [1,2], not full t*exp(-t)
  near(customConvolutionAt(p,4),0);
});
test('integration resource bounds, intermediate overflow and hidden poles reject',()=>{
  for(const args of [['1','1',30,.1],['1','1',4,.000001],['1','1',4,1],['1/(t-0.123)','1',4,.02],['exp(1000)','1',4,.02],['10001','1',4,.02]])assert.throws(()=>prepareCustomConvolution(...args));
});
test('elapsed frame timing is refresh-rate independent and DT remains integer',()=>{
  const d={min:-2,max:2};near(playbackCursor(-2,3000,d,1),-1);near(playbackCursor(-2,1500,d,2),-1);
  assert.equal(playbackCursor(0,249,{min:0,max:5},1,true),0);assert.equal(playbackCursor(0,500,{min:0,max:5},1,true),1);
  assert.equal(playbackCursor(0,99999,{min:0,max:5},1,true),5);
});
test('a narrow off-grid spike still fails safely when the current cursor samples it',()=>{
  const p=prepareCustomConvolution('1','10001*rect((t-0.123456)/0.000001)',4,.02);
  assert.throws(()=>customConvolutionAt(p,p.taus[0]+.123456),/진폭/);
});
test('bounded maximal arithmetic AST workload is finite and measured',()=>{
  const expr=Array(32).fill('sin(t)').join('+');const started=performance.now();const p=prepareCustomConvolution(expr,expr,4,8/1024);const prepMs=performance.now()-started;
  const currentStart=performance.now();for(let i=0;i<30;i++)customConvolutionAt(p,i/30);const pointMs=(performance.now()-currentStart)/30;
  console.log(JSON.stringify({kind:'bounded1024cell95nodeWorkload',prepMs,currentPointMeanMs:pointMs}));assert.ok(p.output.every(v=>Number.isFinite(v[1])));assert.equal(p.output.length,129);
});
