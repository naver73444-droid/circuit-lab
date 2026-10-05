import test from 'node:test';
import assert from 'node:assert/strict';
import {formatNumber} from '../src/circuit-course-view.js';
import {parseProblemQuantity} from '../src/circuit-course-problem.js';
import {renderSymbolic} from '../src/course-symbolic-view.js';

const legacy=n=>n===null||n===undefined||!Number.isFinite(n)?'미정':new Intl.NumberFormat('en-US',{maximumSignificantDigits:7,notation:Math.abs(n)>0&&(Math.abs(n)<1e-4||Math.abs(n)>=1e7)?'scientific':'standard'}).format(Object.is(n,-0)?0:n);
test('cached formatNumber is byte-identical to the per-call Intl implementation',()=>{
  const values=[null,undefined,NaN,Infinity,-Infinity,0,-0,1,-1,.5,1/3,-2/3,Math.PI,Math.E,1e-4,9.99999e-5,1e-5,1.23456789e-7,-4.5e-9,1e-300,9999999,9999999.5,1e7,1.2345678e7,-1e7,1e21,1e300,123456.789,1234567.891,0.1+0.2,100,1000,12345678,5e-324,Number.MAX_VALUE];
  let seed=12345;const rand=()=>(seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff;
  for(let i=0;i<3000;i++)values.push((rand()-.5)*10**Math.floor(rand()*30-12));
  for(const v of values)assert.equal(formatNumber(v),legacy(v),String(v));
});
test('unit lookup ignores prototype keys',()=>{
  for(const unit of ['toString','constructor','hasOwnProperty','valueOf'])assert.throws(()=>parseProblemQuantity(`5 ${unit}`,'resistance','ohm'),/단위가 맞지 않습니다/,unit);
  for(const quantity of ['toString','constructor','__proto__'])assert.throws(()=>parseProblemQuantity('5 ohm',quantity,'ohm'),/단위가 맞지 않습니다/,quantity);
  assert.equal(parseProblemQuantity('2 kohm','resistance','ohm'),2000);
  assert.ok(Math.abs(parseProblemQuantity('10 uF','capacitance','F')-10e-6)<1e-18);
  assert.equal(parseProblemQuantity('5','resistance','ohm'),5);
});
test('renderSymbolic uses the container owner document and injects its style once',()=>{
  assert.equal(typeof globalThis.document,'undefined');
  const styles=[];
  const mk=tag=>({tag,children:[],dataset:{},textContent:'',append(...c){this.children.push(...c);},classList:{add(){}},replaceChildren(){this.children=[];}});
  const doc={head:{append:n=>styles.push(n)},querySelector:sel=>styles.find(s=>sel===`style[data-course-style="${s.dataset.courseStyle}"]`)||null,createElement:mk};
  const container=mk('div');container.ownerDocument=doc;
  for(let i=0;i<3;i++)renderSymbolic(container,{title:'t',status:'unsupported',reason:'r'});
  assert.equal(styles.length,1);assert.match(styles[0].textContent,/\.course-symbolic/);
  assert.deepEqual(container.children.map(c=>c.tag),['h3','p']);
});
