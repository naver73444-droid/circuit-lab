// Restricted arithmetic AST. No JavaScript evaluation and no property access.
export const EXPRESSION_LIMITS=Object.freeze({length:256,depth:20,nodes:96,amplitude:10000,intermediate:1e10,maxCells:1024,outputPoints:129});
const fail=message=>{throw new RangeError(message);};
export function parseSignalExpression(source) {
  source=String(source);if(!source.trim()||source.length>EXPRESSION_LIMITS.length)fail('식은 1~256자로 입력하세요.');
  let at=0,count=0;
  const skip=()=>{while(/\s/.test(source[at]||'')&&at<source.length)at++;};
  const peek=()=>{skip();return source[at];};
  const node=(kind,extra)=>{if(++count>EXPRESSION_LIMITS.nodes)fail('식의 연산 수가 제한을 넘었습니다.');return{kind,...extra};};
  const expression=(depth=0)=>{if(depth>20)fail('괄호 깊이는 20 이하입니다.');let left=term(depth+1);while(peek()==='+'||peek()==='-'){const op=source[at++];left=node('binary',{op,left,right:term(depth+1)});}return left;};
  const term=depth=>{let left=atom(depth+1);while(peek()==='*'||peek()==='/'){const op=source[at++];left=node('binary',{op,left,right:atom(depth+1)});}return left;};
  const atom=depth=>{
    if(depth>20)fail('식의 중첩이 너무 깊습니다.');const c=peek();
    if(c==='+'||c==='-'){at++;return node('unary',{op:c,arg:atom(depth+1)});}
    if(c==='('){at++;const value=expression(depth+1);if(peek()!==')')fail('닫는 괄호가 필요합니다.');at++;return value;}
    const rest=source.slice(at),number=rest.match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/);
    if(number){at+=number[0].length;const value=Number(number[0]);if(!Number.isFinite(value)||Math.abs(value)>1e6||(value===0&&/[1-9]/.test(number[0].split(/[eE]/)[0])))fail('상수 범위는 ±10⁶이며 비영 값의 수치 underflow는 지원하지 않습니다.');return node('number',{value});}
    const name=rest.match(/^[a-zA-Z]+/);if(!name)fail('지원 문법: 숫자, t, pi, e, + − * /, 괄호, u/rect/exp/sin/cos.');at+=name[0].length;
    if(name[0]==='t')return node('time',{});
    if(name[0]==='pi'||name[0]==='e')return node('number',{value:name[0]==='pi'?Math.PI:Math.E});
    if(!['u','rect','exp','sin','cos'].includes(name[0])||peek()!=='(')fail('지원하지 않는 이름/함수입니다. 곱셈은 *로 입력하세요.');
    at++;const arg=expression(depth+1);if(peek()!==')')fail('함수의 닫는 괄호가 필요합니다.');at++;return node('call',{name:name[0],arg});
  };
  const ast=expression();if(peek()!==undefined)fail('남은 미지원 문자 또는 암시적 곱셈이 있습니다.');return ast;
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
export function signalBounds(ast,T) {
  if(ast.kind==='number')return[ast.value,ast.value];if(ast.kind==='time')return[-T,T];
  if(ast.kind==='unary'){const[l,h]=signalBounds(ast.arg,T);return ast.op==='-'?[-h,-l]:[l,h];}
  if(ast.kind==='call'){const[l,h]=signalBounds(ast.arg,T);if(ast.name==='sin'||ast.name==='cos')return[-1,1];if(ast.name==='u'||ast.name==='rect')return[0,1];const result=[Math.exp(l),Math.exp(h)];if(!result.every(Number.isFinite)||result[1]>1e10)fail('지수의 창 안 중간값이 너무 큽니다. 창 크기를 줄이세요.');return result;}
  const[a,b]=signalBounds(ast.left,T),[c,d]=signalBounds(ast.right,T);
  if(ast.op==='+')return[a+c,b+d];if(ast.op==='-')return[a-d,b-c];
  if(ast.op==='/'&&c<=0&&d>=0)fail('입력 창에서 분모가 0일 가능성이 있는 식은 지원하지 않습니다.');
  const v=ast.op==='*'?[a*c,a*d,b*c,b*d]:[a/c,a/d,b/c,b/d];return[Math.min(...v),Math.max(...v)];
}
export function windowSignal(ast,t,T) {
  if(t < -T || t > T)return 0;
  const value=signalValue(ast,t);if(Math.abs(value)>EXPRESSION_LIMITS.amplitude)fail('입력 창에서 신호 진폭은 ±10000 이하여야 합니다.');return value;
}
export function prepareCustomConvolution(xSource,hSource,T,requestedDt) {
  const started=performance.now();
  if(!Number.isFinite(T)||T<.05||T>20||!Number.isFinite(requestedDt)||requestedDt<=0)fail('T는 0.05~20 s, Δτ는 양수여야 합니다.');
  const cells=Math.ceil(2*T/requestedDt);if(cells<32||cells>1024)fail('적분 구간 수 32~1024가 되도록 Δτ 또는 T를 조절하세요.');
  const xAst=parseSignalExpression(xSource),hAst=parseSignalExpression(hSource);signalBounds(xAst,T);signalBounds(hAst,T);
  const dt=2*T/cells,taus=Array.from({length:cells},(_,i)=>-T+(i+.5)*dt),xValues=taus.map(t=>windowSignal(xAst,t,T));
  // Validate the plotted grid too; evaluation remains bounded by explicit caps.
  for(let i=0;i<=cells;i++){const t=-T+i*dt;windowSignal(xAst,t,T);windowSignal(hAst,t,T);}
  const data={custom:true,xSource,hSource,T,dt,cells,xAst,hAst,taus,xValues};
  data.output=Array.from({length:129},(_,i)=>{if(performance.now()-started>1000)fail('계산 시간 예산 1초를 넘었습니다. 식이나 적분 구간 수를 줄이세요.');const t=-2*T+4*T*i/128;return[t,customConvolutionAt(data,t)];});
  return data;
}
export function customConvolutionAt(p,t) {
  if(!Number.isFinite(t)||Math.abs(t)>2*p.T+1e-9)fail('출력 시간은 선언된 ±2T 범위입니다.');
  let sum=0;for(let i=0;i<p.cells;i++)sum+=p.xValues[i]*windowSignal(p.hAst,t-p.taus[i],p.T);
  const value=sum*p.dt;if(!Number.isFinite(value)||Math.abs(value)>4e9)fail('수치 적분 결과 범위를 넘었습니다.');return value;
}
