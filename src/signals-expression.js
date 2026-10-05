// Restricted arithmetic AST. No JavaScript evaluation and no property access.
// Single source of truth for every limit shown in messages/help. `depth` counts only
// parenthesis groups and function calls; `unary` bounds a chain of leading +/- signs.
// `cost` is a static backstop on work (AST-node evaluations). With nodes<=96 and cells<=1024 the estimate is at most 12,976,128, so it only guards future limit changes and cannot trigger today (the measured worst case, 1024 cells x 95 nodes, prepares in ~0.1 s); `timeBudgetMs` is the guard that bounds slow devices.
export const EXPRESSION_LIMITS=Object.freeze({length:256,depth:20,unary:20,nodes:96,amplitude:10000,intermediate:1e10,minCells:32,maxCells:1024,outputPoints:129,cost:13e6,timeBudgetMs:1000});
const fail=message=>{throw new RangeError(message);};
export function parseSignalExpression(source) {
  source=String(source);if(!source.trim()||source.length>EXPRESSION_LIMITS.length)fail(`식은 1~${EXPRESSION_LIMITS.length}자로 입력하세요.`);
  let at=0,count=0;
  const skip=()=>{while(/\s/.test(source[at]||'')&&at<source.length)at++;};
  const peek=()=>{skip();return source[at];};
  const node=(kind,extra)=>{if(++count>EXPRESSION_LIMITS.nodes)fail('식의 연산 수가 제한을 넘었습니다.');return{kind,...extra};};
  // `depth` = open '(' groups and function calls only; leading +/- signs use the separate `unary` chain counter.
  const expression=depth=>{let left=term(depth);while(peek()==='+'||peek()==='-'){const op=source[at++];left=node('binary',{op,left,right:term(depth)});}return left;};
  const term=depth=>{let left=atom(depth,0);while(peek()==='*'||peek()==='/'){const op=source[at++];left=node('binary',{op,left,right:atom(depth,0)});}return left;};
  const open=depth=>{if(depth>=EXPRESSION_LIMITS.depth)fail(`괄호 깊이는 ${EXPRESSION_LIMITS.depth} 이하입니다.`);return depth+1;};
  const atom=(depth,unary)=>{
    const c=peek();
    if(c==='+'||c==='-'){if(unary>=EXPRESSION_LIMITS.unary)fail(`연속 부호(+/-)는 ${EXPRESSION_LIMITS.unary}개 이하입니다.`);at++;return node('unary',{op:c,arg:atom(depth,unary+1)});}
    if(c==='('){const inner=open(depth);at++;const value=expression(inner);if(peek()!==')')fail('닫는 괄호가 필요합니다.');at++;return value;}
    const rest=source.slice(at),number=rest.match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/);
    if(number){at+=number[0].length;const value=Number(number[0]);if(!Number.isFinite(value)||Math.abs(value)>1e6||(value===0&&/[1-9]/.test(number[0].split(/[eE]/)[0])))fail('상수 범위는 ±10⁶이며 비영 값의 수치 underflow는 지원하지 않습니다.');return node('number',{value});}
    const name=rest.match(/^[a-zA-Z]+/);if(!name)fail('지원 문법: 숫자, t, pi, e, + − * /, 괄호, u/rect/exp/sin/cos.');at+=name[0].length;
    if(name[0]==='t')return node('time',{});
    if(name[0]==='pi'||name[0]==='e')return node('number',{value:name[0]==='pi'?Math.PI:Math.E});
    if(!['u','rect','exp','sin','cos'].includes(name[0])||peek()!=='(')fail('지원하지 않는 이름/함수입니다. 곱셈은 *로 입력하세요.');
    const inner=open(depth);at++;const arg=expression(inner);if(peek()!==')')fail('함수의 닫는 괄호가 필요합니다.');at++;return node('call',{name:name[0],arg});
  };
  const ast=expression(0);if(peek()!==undefined)fail('남은 미지원 문자 또는 암시적 곱셈이 있습니다.');return ast;
}
export function signalValue(ast,t) {
  let value;
  if(ast.kind==='number')value=ast.value;
  else if(ast.kind==='time')value=t;
  else if(ast.kind==='unary')value=(ast.op==='-'?-1:1)*signalValue(ast.arg,t);
  else if(ast.kind==='binary'){const l=signalValue(ast.left,t),r=signalValue(ast.right,t);if(ast.op==='/'&&r===0)fail('0으로 나눌 수 없습니다.');value=ast.op==='+'?l+r:ast.op==='-'?l-r:ast.op==='*'?l*r:l/r;}
  else {const a=signalValue(ast.arg,t);value=ast.name==='u'?(a===0?.5:a>0?1:0):ast.name==='rect'?(Math.abs(a)===.5?.5:Math.abs(a)<.5?1:0):Math[ast.name](a);}
  if(!Number.isFinite(value)||Math.abs(value)>EXPRESSION_LIMITS.intermediate)fail('비유한 값 또는 중간 연산 범위 초과입니다.');return value;
}
// Conservative interval check rejects potential poles anywhere in the declared
// input window, including poles which fall between numerical samples.
// x(t)*x(t) is a square, not a product of two independent intervals: strip leading signs
// and compare the remaining subtrees structurally (so both t*t and -t*t are recognised).
const strip=ast=>{let sign=1;while(ast.kind==='unary'){if(ast.op==='-')sign=-sign;ast=ast.arg;}return{sign,base:ast};};
const sameAst=(a,b)=>{
  if(a.kind!==b.kind)return false;
  if(a.kind==='number')return Object.is(a.value,b.value);if(a.kind==='time')return true;
  if(a.kind==='unary')return a.op===b.op&&sameAst(a.arg,b.arg);
  if(a.kind==='call')return a.name===b.name&&sameAst(a.arg,b.arg);
  return a.op===b.op&&sameAst(a.left,b.left)&&sameAst(a.right,b.right);
};
export function signalBounds(ast,T) {
  if(ast.kind==='number')return[ast.value,ast.value];if(ast.kind==='time')return[-T,T];
  if(ast.kind==='unary'){const[l,h]=signalBounds(ast.arg,T);return ast.op==='-'?[-h,-l]:[l,h];}
  if(ast.kind==='call'){const[l,h]=signalBounds(ast.arg,T);if(ast.name==='sin'||ast.name==='cos')return[-1,1];if(ast.name==='u'||ast.name==='rect')return[0,1];const result=[Math.exp(l),Math.exp(h)];if(!result.every(Number.isFinite)||result[1]>1e10)fail('지수의 창 안 중간값이 너무 큽니다. 창 크기를 줄이세요.');return result;}
  const[a,b]=signalBounds(ast.left,T),[c,d]=signalBounds(ast.right,T);
  if(ast.op==='*'){const l=strip(ast.left),r=strip(ast.right);if(sameAst(l.base,r.base)){const[x,y]=signalBounds(l.base,T),hi=Math.max(x*x,y*y),lo=x<=0&&y>=0?0:Math.min(x*x,y*y);return l.sign*r.sign>0?[lo,hi]:[-hi,0-lo];}}
  if(ast.op==='+')return[a+c,b+d];if(ast.op==='-')return[a-d,b-c];
  if(ast.op==='/'&&c<=0&&d>=0)fail('입력 창에서 분모가 0일 가능성이 있는 식은 지원하지 않습니다.');
  const v=ast.op==='*'?[a*c,a*d,b*c,b*d]:[a/c,a/d,b/c,b/d];return[Math.min(...v),Math.max(...v)];
}
export function windowSignal(ast,t,T) {
  if(t < -T || t > T)return 0;
  const value=signalValue(ast,t);if(Math.abs(value)>EXPRESSION_LIMITS.amplitude)fail('입력 창에서 신호 진폭은 ±10000 이하여야 합니다.');return value;
}
const countNodes=ast=>ast.kind==='binary'?1+countNodes(ast.left)+countNodes(ast.right):ast.kind==='unary'||ast.kind==='call'?1+countNodes(ast.arg):1;
// Deterministic work estimate in AST-node evaluations: x on the midpoint grid, both signals on
// the validation grid, and one h evaluation per cell for every output point.
export function estimateCustomCost(xAst,hAst,cells) {
  const nx=countNodes(xAst),nh=countNodes(hAst);return cells*(2*nx+nh*(EXPRESSION_LIMITS.outputPoints+1));
}
export function prepareCustomConvolution(xSource,hSource,T,requestedDt) {
  const started=performance.now();
  if(!Number.isFinite(T)||T<.05||T>20||!Number.isFinite(requestedDt)||requestedDt<=0)fail('T는 0.05~20 s, Δτ는 양수여야 합니다.');
  const cells=Math.ceil(2*T/requestedDt);if(cells<EXPRESSION_LIMITS.minCells||cells>EXPRESSION_LIMITS.maxCells)fail(`적분 구간 수 ${EXPRESSION_LIMITS.minCells}~${EXPRESSION_LIMITS.maxCells}가 되도록 Δτ 또는 T를 조절하세요.`);
  const xAst=parseSignalExpression(xSource),hAst=parseSignalExpression(hSource);signalBounds(xAst,T);signalBounds(hAst,T);
  if(estimateCustomCost(xAst,hAst,cells)>EXPRESSION_LIMITS.cost)fail('계산량(노드×적분 구간×표본)이 한도를 넘었습니다. 식을 줄이거나 적분 구간 수를 줄이세요.');
  const dt=2*T/cells,taus=Array.from({length:cells},(_,i)=>-T+(i+.5)*dt),xValues=taus.map(t=>windowSignal(xAst,t,T));
  // Validate the plotted grid too; evaluation remains bounded by explicit caps.
  for(let i=0;i<=cells;i++){const t=-T+i*dt;windowSignal(xAst,t,T);windowSignal(hAst,t,T);}
  const data={custom:true,xSource,hSource,T,dt,cells,xAst,hAst,taus,xValues};
  const points=EXPRESSION_LIMITS.outputPoints;
  // The elapsed-time budget is the effective guard on slow devices; the static cost cap above is only a backstop and never fires within the current node/cell limits.
  data.output=Array.from({length:points},(_,i)=>{if(performance.now()-started>EXPRESSION_LIMITS.timeBudgetMs)fail(`계산 시간 안전 한도 ${EXPRESSION_LIMITS.timeBudgetMs/1000}초를 넘었습니다. 식이나 적분 구간 수를 줄이세요.`);const t=-2*T+4*T*i/(points-1);return[t,customConvolutionAt(data,t)];});
  return data;
}
export function customConvolutionAt(p,t) {
  if(!Number.isFinite(t)||Math.abs(t)>2*p.T+1e-9)fail('출력 시간은 선언된 ±2T 범위입니다.');
  let sum=0;for(let i=0;i<p.cells;i++)sum+=p.xValues[i]*windowSignal(p.hAst,t-p.taus[i],p.T);
  const value=sum*p.dt;if(!Number.isFinite(value)||Math.abs(value)>4e9)fail('수치 적분 결과 범위를 넘었습니다.');return value;
}
