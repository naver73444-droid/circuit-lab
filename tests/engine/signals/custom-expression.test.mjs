import test from "node:test";
import assert from "node:assert/strict";
import { parseSignalExpression, signalValue, prepareCustomConvolution, customConvolutionAt, EXPRESSION_LIMITS, signalBounds, estimateCustomCost } from "../../../src/signals-expression.js";
import { playbackCursor } from "../../../src/signals-playback.js";
import { discreteConvolution } from "../../../src/signals-course-model.js";
import { ensureCourseStyle } from "../../../src/course-style.js";

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

const nest=d=>'('.repeat(d)+'t'+')'.repeat(d);

test('parenthesis depth counts only groups/calls and honours EXPRESSION_LIMITS.depth',()=>{
  assert.equal(EXPRESSION_LIMITS.depth,20);
  for(const d of [1,7,8,15,EXPRESSION_LIMITS.depth])assert.doesNotThrow(()=>parseSignalExpression(nest(d)),`depth ${d}`);
  for(const d of [EXPRESSION_LIMITS.depth+1,25])assert.throws(()=>parseSignalExpression(nest(d)),new RegExp(`${EXPRESSION_LIMITS.depth} 이하`));
  assert.doesNotThrow(()=>parseSignalExpression('exp('.repeat(15)+'t'+')'.repeat(15)));
  assert.equal(signalValue(parseSignalExpression(nest(15)),3),3);
});

test('unary sign chains use a separate bounded counter and flat long sums are not depth-limited',()=>{
  assert.doesNotThrow(()=>parseSignalExpression('-'.repeat(EXPRESSION_LIMITS.unary)+'t'));
  assert.throws(()=>parseSignalExpression('-'.repeat(EXPRESSION_LIMITS.unary+1)+'t'),/연속 부호/);
  assert.doesNotThrow(()=>parseSignalExpression(Array(40).fill('t').join('+')));
  assert.doesNotThrow(()=>parseSignalExpression('2*3*4*5*6*7*8*9*10'));
});

test('squares t*t and -t*t are not treated as independent intervals',()=>{
  for(const[expr,T]of [['1/(1+t*t)',6],['exp(-t*t)',6],['1/(1+t*t)',20],['exp(-t*t)',20],['exp(-(t*t))',6]])assert.doesNotThrow(()=>signalBounds(parseSignalExpression(expr),T),`${expr} T=${T}`);
  assert.deepEqual(signalBounds(parseSignalExpression('t*t'),6),[0,36]);
  assert.deepEqual(signalBounds(parseSignalExpression('-t*t'),6),[-36,0]);
  assert.deepEqual(signalBounds(parseSignalExpression('(t+10)*(t+10)'),3),[49,169]);
});

test('whole convolution prep accepts 1/(1+t*t) and exp(-t*t) at T=6',()=>{
  for(const expr of ['1/(1+t*t)','exp(-t*t)']){const p=prepareCustomConvolution(expr,'u(t)-u(t-1)',6,.02);assert.equal(p.output.length,EXPRESSION_LIMITS.outputPoints);assert.ok(p.output.every(v=>Number.isFinite(v[1])));}
});

test('genuine poles and overflow stay rejected',()=>{
  for(const[expr,T]of [['1/(t-0.123)',4],['1/(t*t)',4],['1/(t*t-1)',4],['1/(1-t*t)',4],['1/(t*(-t))',4],['1/(1+t*(t+0))',6],['exp(t*t)',6],['exp(1000)',4],['1/t',4],['1/(-t*t)',4],['1/(t*t-t*t)',4]])assert.throws(()=>signalBounds(parseSignalExpression(expr),T),RangeError,`${expr} T=${T}`);
});

test('limits are the single source for error text and for the output grid',()=>{
  assert.throws(()=>parseSignalExpression('1'.repeat(EXPRESSION_LIMITS.length+1)),new RegExp(`1~${EXPRESSION_LIMITS.length}자`));
  assert.throws(()=>prepareCustomConvolution('1','1',4,1),new RegExp(`${EXPRESSION_LIMITS.minCells}~${EXPRESSION_LIMITS.maxCells}`));
  assert.throws(()=>prepareCustomConvolution('1','1',4,.000001),new RegExp(`${EXPRESSION_LIMITS.maxCells}`));
  assert.equal(prepareCustomConvolution('1','1',1,.05).output.length,EXPRESSION_LIMITS.outputPoints);
});

test('cost cap is an unreachable backstop for the current node/cell limits (time budget is the real guard)',()=>{
  const worst=EXPRESSION_LIMITS.maxCells*(2*EXPRESSION_LIMITS.nodes+EXPRESSION_LIMITS.nodes*(EXPRESSION_LIMITS.outputPoints+1));
  assert.equal(worst,12976128);
  assert.ok(worst<=EXPRESSION_LIMITS.cost);
  assert.equal(EXPRESSION_LIMITS.timeBudgetMs,1000);
});

test('deterministic cost estimate covers the maximal allowed workload and is monotone',()=>{
  const big=parseSignalExpression(Array(32).fill('sin(t)').join('+')),small=parseSignalExpression('t');
  assert.ok(estimateCustomCost(big,big,EXPRESSION_LIMITS.maxCells)<=EXPRESSION_LIMITS.cost);
  assert.ok(estimateCustomCost(big,big,512)<estimateCustomCost(big,big,1024));
  assert.ok(estimateCustomCost(small,small,1024)<estimateCustomCost(big,big,1024));
  assert.equal(estimateCustomCost(small,small,100),100*(2+(EXPRESSION_LIMITS.outputPoints+1)));
});

test('course stylesheet is injected once per document',()=>{
  const styles=[];
  const doc={head:{append:n=>styles.push(n)},querySelector:sel=>styles.find(s=>sel===`style[data-course-style="${s.dataset.courseStyle}"]`)||null,createElement:()=>({dataset:{}})};
  const node={ownerDocument:doc};
  for(let i=0;i<5;i++)ensureCourseStyle(node,'a','.a{}');
  ensureCourseStyle(node,'b','.b{}');
  assert.deepEqual(styles.map(s=>s.dataset.courseStyle),['a','b']);
});
