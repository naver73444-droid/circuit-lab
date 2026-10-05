import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCourseMath, appendCourseMath } from '../src/course-math-view.js';
import { symbolicText } from '../src/course-symbolic-view.js';
import { EXPERIMENTS } from '../src/em-course-registry.js';

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
