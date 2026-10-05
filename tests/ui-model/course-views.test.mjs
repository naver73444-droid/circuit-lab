import test from "node:test";
import assert from "node:assert/strict";
import { preserveCourseFocus } from "../../src/course-focus.js";
import { parseCourseMath, appendCourseMath } from "../../src/course-math-view.js";
import { symbolicText, renderSymbolic } from "../../src/course-symbolic-view.js";
import { EXPERIMENTS } from "../../src/em-course-registry.js";
import { formatNumber } from "../../src/circuit-course-view.js";
import { parseProblemQuantity } from "../../src/circuit-course-problem.js";

function node(attribute, value, extras = {}) {
  return {
    isConnected: true, disabled: false, selectionStart: null, selectionEnd: null,
    hasAttribute: key => key === attribute,
    getAttribute: key => key === attribute ? value : null,
    focus(options) { this.focused = options; },
    setSelectionRange(...range) { this.selection = range; },
    ...extras,
  };
}

function fixture(active, replacements = []) {
  return {
    ownerDocument: { activeElement: active },
    contains: target => target === active,
    querySelectorAll: () => replacements,
  };
}

test('focus helper restores replaced text input and selection without scrolling', () => {
  const active = node('data-key', 'expression', { selectionStart: 1, selectionEnd: 4, selectionDirection: 'backward' });
  const replacement = node('data-key', 'expression', { selectionStart: 0 });
  const restore = preserveCourseFocus(fixture(active, [replacement]), ['data-key']);
  active.isConnected = false;
  restore();
  assert.deepEqual(replacement.focused, { preventScroll: true });
  assert.deepEqual(replacement.selection, [1, 4, 'backward']);
});

test('focus helper matches attribute values literally, including CSS-special characters', () => {
  const value = 'R["x"]';
  const active = node('data-key', value);
  const wrong = node('data-key', 'R');
  const replacement = node('data-key', value);
  const restore = preserveCourseFocus(fixture(active, [wrong, replacement]), ['data-key']);
  active.isConnected = false; restore();
  assert.equal(wrong.focused, undefined);
  assert.deepEqual(replacement.focused, { preventScroll: true });
});

test('focus helper does not steal focus from a still-connected control or outside the root', () => {
  const active = node('data-key', 'a'), replacement = node('data-key', 'a');
  const root = fixture(active, [replacement]);
  preserveCourseFocus(root, ['data-key'])();
  assert.equal(replacement.focused, undefined);
  root.contains = () => false;
  const restore = preserveCourseFocus(root, ['data-key']);
  active.isConnected = false; restore();
  assert.equal(replacement.focused, undefined);
});

test('focus helper ignores missing and disabled replacement controls', () => {
  for (const replacements of [[], [node('data-key', 'a', { disabled: true })]]) {
    const active = node('data-key', 'a');
    const restore = preserveCourseFocus(fixture(active, replacements), ['data-key']);
    active.isConnected = false;
    assert.doesNotThrow(restore);
    assert.equal(replacements[0]?.focused, undefined);
  }
});

test('focus helper handles empty button attributes and text-to-select replacement safely', () => {
  const active = node('data-reset', '', { selectionStart: 0, selectionEnd: 3 });
  const replacement = node('data-reset', '');
  const restore = preserveCourseFocus(fixture(active, [replacement]), ['data-reset']);
  active.isConnected = false; restore();
  assert.deepEqual(replacement.focused, { preventScroll: true });
  assert.equal(replacement.selection, undefined);
});

const all=(ast,tag)=>!ast?[]:[...(ast.tag===tag?[ast]:[]),...ast.children.flatMap(child=>all(child,tag))];

const text=ast=>ast.text??ast.children.map(text).join('');

test('fractions preserve the complete explicit denominator and power association',()=>{
  const simple=parseCourseMath('A/(2πr)');assert.equal(simple.tag,'mfrac');assert.equal(text(simple.children[0]),'A');assert.equal(text(simple.children[1]),'(2πr)');
  const nested=parseCourseMath('1/(r²+a²)^(3/2)');assert.equal(nested.tag,'mfrac');const denominator=nested.children[1];assert.equal(denominator.tag,'msup');assert.equal(text(denominator.children[0]),'(r2+a2)');assert.equal(denominator.children[1].tag,'mfrac');assert.deepEqual(denominator.children[1].children.map(text),['3','2']);
  const difference=parseCourseMath('(a+b)/(c+d)');assert.deepEqual(difference.children.map(text),['(a+b)','(c+d)']);
});

test('Unicode and explicit integration limits, roots, and vector hats have real structure',()=>{
  for(const source of ['∫a^b Eᵣ dr','∫_{a}^{b} Eᵣ dr']){const limits=all(parseCourseMath(source),'munderover')[0];assert.deepEqual(limits.children.map(text),['∫','a','b']);}
  const unicode=all(parseCourseMath('∫₀ᵈ E_z dz'),'munderover')[0];assert.deepEqual(unicode.children.map(text),['∫','0','d']);
  const root=parseCourseMath('E=Q/√(r²+a²) r̂');assert.equal(all(root,'msqrt').length,1);assert.equal(all(root,'mover')[0].attrs.accent,'true');
  assert.equal(all(parseCourseMath('E_z⁺−E_z⁻'),'msubsup').length,2);
  assert.deepEqual(all(parseCourseMath('V=√2 R/√3'),'msqrt').map(n=>text(n.children[0])),['2','3']);
  assert.equal(parseCourseMath('√2²'),null);
});

test('long custom symbols remain complete and unsupported notation fails closed',()=>{
  const source='V_source_long=I_load_1/√(R²+X²)',ast=parseCourseMath(source);assert.ok(ast);assert.deepEqual(all(ast,'msub').map(n=>text(n.children[1])),['source_long','load_1']);
  for(const invalid of ['<img src=x onerror=alert(1)>','A/(B','a^^2','a/','√x²','x^ab','x^a^b','한글 조건 B=0','x?y:z','a'.repeat(4097),'('.repeat(40)+'a'+')'.repeat(40)])assert.equal(parseCourseMath(invalid),null,invalid.slice(0,40));
  assert.equal(all(parseCourseMath('x^r₁'),'msup')[0].children[1].tag,'msub');
});

class FakeElement {
  constructor(doc,tag,ns=null){this.ownerDocument=doc;this.tagName=tag;this.namespaceURI=ns;this.children=[];this.attrs={};this.dataset={};this.textContent='';}
  append(...nodes){this.children.push(...nodes);}
  setAttribute(key,value){this.attrs[key]=value;}
}

const fakeDocument=()=>{const doc={createElement:tag=>new FakeElement(doc,tag),createElementNS:(ns,tag)=>new FakeElement(doc,tag,ns),querySelector:()=>null};doc.head=doc.createElement('head');return doc;};

test('renderer splits formula clauses, preserves source, and never parses markup',()=>{
  const doc=fakeDocument(),host=doc.createElement('div'),source='B=I/(2πr); 도체 안 B=0\n<img src=x onerror=alert(1)>';
  const box=appendCourseMath(host,source,{showOriginal:true});assert.equal(box.dataset.mathSource,source);
  const walk=n=>[n,...n.children.flatMap(walk)],nodes=walk(box);
  assert.equal(nodes.filter(n=>n.tagName==='math').length,1);assert.equal(nodes.find(n=>n.tagName==='math').attrs['aria-label'],'B=I/(2πr)');
  assert.equal(nodes.filter(n=>n.tagName==='img').length,0);assert.ok(nodes.some(n=>n.textContent==='<img src=x onerror=alert(1)>'));assert.ok(nodes.some(n=>n.tagName==='pre'&&n.textContent===source));
});

test('independent text copy contract is unchanged by display rendering',()=>{
  const data={status:'supported',title:'고정 예시',givens:[{symbol:'V_source_long',meaning:'전압',unit:'V',constraint:'실수'}],laws:[{name:'정의',formula:'V_source_long=I_load/R'}],steps:[{title:'대입',formula:'I_load=2',explanation:'예시 설명'}],answers:[{quantity:'답',formula:'V_source_long=2/R',direction:'+x'}]};
  assert.equal(symbolicText(data),'고정 예시\n\n주어진 문자와 단위\nV_source_long: 전압 [V] — 실수\n\n적용 법칙\n정의\nV_source_long=I_load/R\n\n유도 과정\n1. 대입\nI_load=2\n예시 설명\n\n기호 답안\n답\nV_source_long=2/R\n방향: +x');
});

test('several existing EM model families yield structured primary answer notation',()=>{
  const families=['coax-current','loop-axis','faraday-loop','layered-plate'];
  for(const id of families){const def=EXPERIMENTS.find(d=>d.id===id);assert.ok(def,id);const opts=Object.fromEntries((def.symbolicControls||[]).map(c=>[c.key,c.initial]));const result=def.symbolic(opts);assert.equal(result.status,'supported');const asts=result.answers.flatMap(a=>a.formula.split(/[;\n]/).map(parseCourseMath)).filter(Boolean);assert.ok(asts.length,id+' has rendered answer');assert.ok(asts.flatMap(a=>all(a,'mfrac')).length||asts.flatMap(a=>all(a,'msub')).length,id+' has real fraction or subscript');}
});

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
