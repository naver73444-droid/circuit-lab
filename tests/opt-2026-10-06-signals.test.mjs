import test from 'node:test';
import assert from 'node:assert/strict';
import {EXPRESSION_LIMITS,parseSignalExpression,signalBounds,signalValue,prepareCustomConvolution,estimateCustomCost} from '../src/signals-expression.js';
import {ensureCourseStyle} from '../src/course-style.js';
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
