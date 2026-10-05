// Presentation only. No evaluation, algebraic rewriting, HTML parsing or network dependency.
const NS = 'http://www.w3.org/1998/Math/MathML';
const subscript = Object.fromEntries(Array.from('₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎ₐₑₕᵢⱼₖₗₘₙₒₚᵣₛₜᵤᵥₓ').map((c,i)=>[c,Array.from('0123456789+−=()aehijklmnoprstuvx')[i]]));
const superscript = Object.fromEntries(Array.from('⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿⁱᵃᵇᶜᵈᵉᶠᵍʰʲᵏˡᵐᵒᵖʳˢᵗᵘᵛʷˣʸᶻ').map((c,i)=>[c,Array.from('0123456789+−=()niabcdefghjklmoprstuvwxyz')[i]]));
const node = (tag, children = [], text = null, attrs = {}) => ({ tag, children, text, attrs });
const row = children => children.length === 1 ? children[0] : node('mrow', children);
const op = text => node('mo', [], text);
const token = text => node(/^\d+(?:\.\d*)?$/.test(text) ? 'mn' : 'mi', [], text);
const functions = new Set(['sin','cos','tan','ln','log','exp','sinh','cosh','tanh','Re','Im','max','min','abs','sgn']);
const identifier = /^[A-Za-zΑ-Ωα-ωϕϵℰℓℝℂ∞∂∇Δ]+/u;
const comparison = new Set(Array.from('=<>≤≥≠≈≡→⇒↔∝∈∉:,'));
const productOperator = new Set(['·','×','*','⋅']);

class NotationParser {
  constructor(source) {
    // Explicit textbook shorthand ∫a^b / ∫r₁^r₂ denotes the two integration limits.
    this.source = source.replace(/([∫∮])([A-Za-zΑ-Ωα-ω][₀-₉ᵣₙₐᵢ]*|\d+)\^([A-Za-zΑ-Ωα-ω][₀-₉ᵣₙₐᵢ]*|\d+)/gu,'$1_{$2}^{$3}');
    this.at = 0; this.depth = 0;
  }
  peek() { while (/\s/u.test(this.source[this.at] || '') && this.at < this.source.length) this.at++; return this.source[this.at]; }
  take() { const c=this.peek(); this.at++; return c; }
  fail() { throw new SyntaxError('지원 문법 밖의 식'); }
  expression(stop) {
    if (++this.depth > 32) this.fail();
    const items=[this.sum(stop)];
    while (this.peek() && this.peek()!==stop && comparison.has(this.peek())) { items.push(op(this.take()),this.sum(stop)); }
    this.depth--; return row(items);
  }
  sum(stop) {
    const items=[this.product(stop)];
    while (['+','−','-','±','∓'].includes(this.peek()) && this.peek()!==stop) { items.push(op(this.take()),this.product(stop)); }
    return row(items);
  }
  product(stop) {
    const items=[];
    while (['+','−','-','±','∓'].includes(this.peek())) items.push(op(this.take()));
    items.push(this.atom());
    while (this.peek() && this.peek()!==stop) {
      const c=this.peek();
      if (comparison.has(c)||['+','−','-','±','∓',')',']','}'].includes(c)) break;
      if (c==='/') { this.take(); const denominator=this.atom(); items.splice(0,items.length,node('mfrac',[row(items.slice()),denominator])); }
      else if (productOperator.has(c)) { items.push(op(this.take()),this.atom()); }
      else items.push(this.atom());
    }
    return row(items);
  }
  argument() {
    if (['(','[','{'].includes(this.peek())) return this.group(true);
    // Bare script tokens must be unambiguous; compound powers require delimiters.
    const rest=this.source.slice(this.at),match=rest.match(/^(?:\d+(?:\.\d*)?|[A-Za-zΑ-Ωα-ω∞](?:[₀-₉ᵣₙₐᵢ]+)?)/u);
    if(!match||/^[A-Za-zΑ-Ωα-ω_^]/u.test(rest.slice(match[0].length)))this.fail();
    this.at+=match[0].length;const nested=new NotationParser(match[0]);const out=nested.expression();if(nested.peek())this.fail();return out;
  }
  group(strip=false) {
    const open=this.take(),close={'(':')','[':']','{':'}'}[open];
    if(this.peek()===close) {this.take();return row([op(open),op(close)]);}
    const inner=this.expression(close);if(this.take()!==close)this.fail();
    return strip ? inner : row([op(open),inner,op(close)]);
  }
  unicodeScript(map) {
    let text=''; while(map[this.peek()]) text+=map[this.take()];
    if(['+','−','='].includes(text))return op(text);
    const nested=new NotationParser(text);const out=nested.expression();if(nested.peek())this.fail();return out;
  }
  atom() {
    let base=this.primary(),lower=null,upper=null;
    while(this.peek()) {
      const c=this.peek();
      if(c==='_'||c==='^') {this.take();let value;
        const label=c==='_'?this.source.slice(this.at).match(/^[A-Za-zΑ-Ωα-ω][A-Za-zΑ-Ωα-ω0-9_]*/u):null;
        if(label){this.at+=label[0].length;value=token(label[0]);value.attrs.mathvariant='normal';}else value=this.argument();
        if(c==='_'){if(lower)this.fail();lower=value;}else{if(upper)this.fail();upper=value;}}
      else if(subscript[c]){if(lower)this.fail();lower=this.unicodeScript(subscript);}
      else if(superscript[c]){if(upper)this.fail();upper=this.unicodeScript(superscript);}
      else if(c==='̂'||c==='⃗'||c==='̄'||c==='̃'){this.take();base=node('mover',[base,op(c==='̂'?'^':c==='⃗'?'→':c==='̃'?'~':'¯')],null,{accent:'true'});}
      else if(c==='′'||c==='″'){this.take();if(upper)this.fail();upper=op(c);}
      else break;
    }
    const limits=base.tag==='mo'&&['∫','∮','∯','∑','Σ','∏'].includes(base.text);
    if(lower&&upper)base=node(limits?'munderover':'msubsup',[base,lower,upper]);
    else if(lower)base=node(limits?'munder':'msub',[base,lower]);
    else if(upper)base=node(limits?'mover':'msup',[base,upper]);
    return base;
  }
  primary() {
    const c=this.peek();if(!c)this.fail();
    if(['(','[','{'].includes(c))return this.group();
    if(c==='|'){this.take();const inner=this.expression('|');if(this.take()!=='|')this.fail();return row([op('|'),inner,op('|')]);}
    if(c==='√'){this.take();if(['(','[','{'].includes(this.peek()))return node('msqrt',[this.argument()]);
      const literal=this.source.slice(this.at).match(/^\d+(?:\.\d*)?/u);if(!literal||subscript[this.source[this.at+literal[0].length]]||superscript[this.source[this.at+literal[0].length]]||['^','_'].includes(this.source[this.at+literal[0].length]))this.fail();
      this.at+=literal[0].length;return node('msqrt',[token(literal[0])]);}
    if(['∫','∮','∯','∑','Σ','∏'].includes(c)){this.take();return op(c);}
    const rest=this.source.slice(this.at),number=rest.match(/^(?:\d+(?:\.\d*)?|\.\d+)/u);
    if(number){this.at+=number[0].length;return token(number[0]);}
    const name=rest.match(identifier);
    if(name){this.at+=name[0].length;const base=token(name[0]);if(functions.has(name[0])){base.attrs.mathvariant='normal';if(this.peek()==='(')return row([base,this.group()]);}return base;}
    if(['!','⊥','∥','⋯','…'].includes(c)){this.take();return op(c);}
    this.fail();
  }
}

// A bounded AST is independently inspectable in tests and never accepts arbitrary HTML.
export function parseCourseMath(source) {
  source=String(source??'');
  if(!source.trim()||source.length>4096||/[가-힣ㄱ-ㅎㅏ-ㅣ\n;]/u.test(source))return null;
  try {const parser=new NotationParser(source);const result=parser.expression();return parser.peek()?null:result;}catch{return null;}
}

export const COURSE_MATH_CSS = `.course-math{min-width:0;max-width:100%;margin:10px 0;font:18px/1.5 system-ui,sans-serif;white-space:normal;overflow-wrap:normal}.course-math-line{max-width:100%;overflow-x:auto;overflow-y:hidden;padding:10px 3px;overscroll-behavior-x:contain}.course-math math{font-family:"Cambria Math","STIX Two Math",math;display:block;width:max-content;min-width:0;margin:0;white-space:nowrap;text-align:left}.course-math-fallback{font:15px/1.65 ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere;margin:7px 0}.course-math-note{display:block;font:11px/1.4 system-ui,sans-serif;color:#aebed0}.course-math-original{font:12px/1.5 system-ui,sans-serif;border:0!important;padding:0!important;margin:5px 0}.course-math-original summary{font-weight:400!important;min-height:0!important;color:#aebed0}.course-math-original pre{white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.5 ui-monospace,monospace!important}.course-symbolic details.course-derivation{border:1px solid #536478;border-radius:8px;padding:10px;margin:16px 0}.course-symbolic .course-derivation>summary{cursor:pointer;font-weight:600}.em-course-formula-label{display:block;font:13px/1.5 system-ui,sans-serif;color:#bacbdb;margin-top:10px}#em-course-active-branch{white-space:normal;min-width:0}#em-course-active-branch .course-math{font-size:23px}#em-course-active-branch p{font:14px/1.6 system-ui,sans-serif;margin:8px 0}@media(max-width:520px){.course-math{font-size:17px}#em-course-active-branch .course-math{font-size:20px}}`;

function materialize(doc,ast) {
  const element=doc.createElementNS(NS,ast.tag);
  if(ast.text!==null)element.textContent=ast.text;
  for(const [key,value] of Object.entries(ast.attrs))element.setAttribute(key,value);
  for(const child of ast.children)element.append(materialize(doc,child));
  return element;
}

export function appendCourseMath(parent, source, {showOriginal=false}={}) {
  const doc=parent.ownerDocument,original=String(source??''),box=doc.createElement('div');
  box.className='course-math';box.dataset.mathSource=original;parent.append(box);
  // Style is local to a host document, including independent same-origin previews.
  if(!doc.querySelector('style[data-course-math-style]')){const style=doc.createElement('style');style.dataset.courseMathStyle='';style.textContent=COURSE_MATH_CSS;(doc.head||box).append(style);}
  let fallback=false;
  for(const part of original.split(/[;\n]/u).map(s=>s.trim()).filter(Boolean)) {
    const ast=parseCourseMath(part);
    if(ast){const line=doc.createElement('div');line.className='course-math-line';const math=doc.createElementNS(NS,'math');math.setAttribute('display','block');math.setAttribute('aria-label',part);math.append(materialize(doc,ast));line.append(math);box.append(line);}
    else {fallback=true;const text=doc.createElement('p');text.className='course-math-fallback';text.textContent=part;box.append(text);}
  }
  if(fallback){const note=doc.createElement('small');note.className='course-math-note';note.textContent='일부 표기는 원문으로 표시합니다.';box.append(note);}
  if(showOriginal){const details=doc.createElement('details');details.className='course-math-original';const summary=doc.createElement('summary');summary.textContent='원문 표기';const pre=doc.createElement('pre');pre.textContent=original;details.append(summary,pre);box.append(details);}
  return box;
}
