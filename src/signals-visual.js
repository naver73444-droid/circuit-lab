// Bounded visual coordinates for the existing textbook models, not a solver.
import { discreteConvolution, affineSignal, pulseSeriesCoefficient, rectangleFT, finiteDTFT, samplingAlias } from './signals-course-model.js';
import {renderConvolutionVisual,convolutionDomain} from './signals-convolution-view.js';

export function sequenceTransform(x,start,a,b) {
  if(!Array.isArray(x)||!x.length||x.length>64||!x.every(Number.isFinite)||![start,a,b].every(Number.isSafeInteger)||!a)throw new RangeError('이산 시간축에는 정수 인덱스와 0이 아닌 정수 배율이 필요합니다.');
  const kept=x.map((value,i)=>({k:start+i,n:(start+i+b)/a,value})).filter(p=>Number.isInteger(p.n)).sort((p,q)=>p.n-q.n);
  return kept;
}
export function convolutionFrame(x,h,xStart,hStart,n) {
  const output=discreteConvolution(x,h,xStart,hStart);
  if(!Number.isSafeInteger(n))throw new RangeError('관측 n은 정수입니다.');
  const terms=x.map((value,i)=>{const k=xStart+i,j=n-k-hStart,shifted=j>=0&&j<h.length?h[j]:0;return{k,x:value,h:shifted,product:value*shifted};});
  return {terms,sum:terms.reduce((sum,p)=>sum+p.product,0),output};
}
export function exponentialProduct(tau,t,a,b) {
  // Endpoints do not change the integral. Draw the interior, not Dirac impulses.
  if(![tau,t,a,b].every(Number.isFinite)||a<=0||b<=0)throw new RangeError('유한 좌표와 양의 감쇠율이 필요합니다.');
  return tau<0||tau>t?0:Math.exp(-a*tau-b*(t-tau));
}
export function cursorDomain(id,o,p) {
  if(id!=='convolution'||!p)return null;
  return convolutionDomain(o,p);
}
const sample=(fn,lo,hi,count=321)=>Array.from({length:count},(_,i)=>{const x=lo+(hi-lo)*i/(count-1);return[x,fn(x)];});
const withJumps=(fn,lo,hi,jumps,count=701)=>{
  const edges=jumps.filter(x=>x>lo&&x<hi),epsilon=Math.max(1e-12,(hi-lo)*1e-10);
  const points=sample(fn,lo,hi,count).filter(([x])=>!edges.some(b=>Math.abs(x-b)<epsilon));
  for(const b of edges)points.push([b,fn(b-epsilon)],[b,fn(b)],[b,fn(b+epsilon)]);
  return points.sort((a,b)=>a[0]-b[0]);
};
const fmt=n=>Number(n.toPrecision(5)).toString();

export function renderSignalsVisual(parent,state,id,{playing=false,reducedMotion=false}={}) {
  if(id==='convolution')return renderConvolutionVisual(parent,state,{playing,reducedMotion});
  const doc=parent.ownerDocument,p=state.numeric,o=state.options;
  const node=(tag,text,container=parent,attrs={})=>{const e=doc.createElement(tag);if(text!==undefined)e.textContent=text;for(const[k,v]of Object.entries(attrs))e.setAttribute(k,String(v));container.append(e);return e;};
  const svgNode=(tag,attrs,container,text)=>{const e=doc.createElementNS('http://www.w3.org/2000/svg',tag);for(const[k,v]of Object.entries(attrs))e.setAttribute(k,String(v));if(text!==undefined)e.textContent=text;container.append(e);return e;};
  // Convolution owns its stable animated DOM; these views render only on apply.
  parent.replaceChildren();
  const card=(title)=>{const c=node('section',undefined,parent,{class:'signals-graph-card'});node('h3',title,c);return c;};
  const plot=(container,series,{xmin,xmax,label,stem=false}={})=>{
    if(xmin===xmax){xmin-=1;xmax+=1;}
    const values=series.flatMap(s=>s.points.map(q=>q[1]));let ymin=Math.min(0,...values),ymax=Math.max(0,...values);if(ymin===ymax)ymax=ymin+1;const pad=(ymax-ymin)*.15;ymin-=pad;ymax+=pad;
    const svg=svgNode('svg',{viewBox:'0 0 680 240',role:'img','aria-label':label,'data-signals-plot':stem?'stem':'continuous'},container);svgNode('title',{},svg,label);
    const px=x=>55+595*(x-xmin)/(xmax-xmin),py=y=>195-165*(y-ymin)/(ymax-ymin);
    svgNode('line',{x1:55,y1:py(0),x2:650,y2:py(0),stroke:'#839cae'},svg);
    if(xmin<=0&&xmax>=0)svgNode('line',{x1:px(0),y1:30,x2:px(0),y2:195,stroke:'#536b80'},svg);
    for(const v of new Set([ymin+pad,0,ymax-pad]))svgNode('text',{x:3,y:py(v)+4,fill:'#d7e5f0','font-size':20},svg,fmt(v));
    for(let i=0;i<=4;i++){const x=xmin+(xmax-xmin)*i/4;svgNode('text',{x:px(x),y:222,fill:'#d7e5f0','font-size':20,'text-anchor':'middle'},svg,fmt(x));}
    for(const s of series){const color=s.color||'#9de4d8';
      if(stem){for(const[x,y]of s.points){svgNode('line',{x1:px(x),y1:py(0),x2:px(x),y2:py(y),stroke:color,'stroke-width':2,'data-signals-stem':''},svg);svgNode('circle',{cx:px(x),cy:py(y),r:3.5,fill:color},svg);}}
      else {
        svgNode('polyline',{points:s.points.map(([x,y])=>`${px(x)},${py(y)}`).join(' '),fill:'none',stroke:color,'stroke-width':2},svg);
      }
    }
    node('p',label,container,{class:'signals-caption'});
    return svg;
  };
  const single=(container,points,options)=>plot(container,[{points}],options);
  if(id==='time'){
    if(o.family==='sequence'){
      const transformed=sequenceTransform(p.x,p.start,p.a,p.b),original=p.x.map((v,i)=>[p.start+i,v]);
      const lo=Math.min(p.start,...transformed.map(v=>v.n))-1,hi=Math.max(p.start+p.x.length-1,...transformed.map(v=>v.n))+1;
      single(card('원 신호 x[k]'),original,{xmin:lo,xmax:hi,label:'k [sample] · 진폭',stem:true});
      single(card('변환 y[n]=x[an−b]'),transformed.map(v=>[v.n,v.value]),{xmin:lo,xmax:hi,label:'n [sample] · 진폭 · 표본 사이 보간 없음',stem:true});
      node('p',`a=${p.a}, b=${p.b} · 정수 n=(k+b)/a인 표본만 유지. ${transformed.length}/${p.x.length}개 표본 대응.`,parent,{'data-signals-mapping':''});return;
    }
    const lo=Math.min(-1,p.b/p.a,(p.b+1)/p.a)-1/Math.abs(p.a),hi=Math.max(2,p.b/p.a,(p.b+1)/p.a)+1/Math.abs(p.a);
    const c=card('원 신호와 시간 변환 비교');node('p','청록 x(t) · 보라 y(t)=x(at−b). 단위 진폭, rect T=1 s / exp α=1 s⁻¹ / cos f=1 Hz.',c,{class:'signals-caption'});
    const count=o.family==='cos'?Math.max(1025,Math.ceil((hi-lo)*Math.max(1,Math.abs(p.a))*32)+1):1025;
    if(count>16001){node('p','이 비교 범위의 정현파는 화면 해상도를 넘습니다. 배율/이동을 줄여 확인하세요. 기호답과 입력은 유지됩니다.',c);return;}
    const edges=o.family==='rect'?[0,1]:o.family==='cos'?[]:[0];
    plot(c,[{points:withJumps(t=>affineSignal(o.family,t,1,0),lo,hi,edges,count)},{points:withJumps(t=>affineSignal(o.family,t,p.a,p.b),lo,hi,edges.map(v=>(v+p.b)/p.a),count),color:'#d0acff'}],{xmin:lo,xmax:hi,label:'t [s] · 진폭'});
    node('p',`원 좌표 τ=0 → t=${fmt(p.b/p.a)} s, τ=1 → t=${fmt((p.b+1)/p.a)} s. 경계 u(0)=1/2; 화면은 유한 구간의 예시입니다.`,c);return;
  }
  if(id==='series'){
    single(card('Fourier 급수 계수'),Array.from({length:15},(_,i)=>[i-7,pulseSeriesCoefficient(1,p.D,i-7)]),{xmin:-8,xmax:8,label:'정수 고조파 k · 실수 계수 cₖ',stem:true});return;
  }
  if(id==='fourier'){
    const max=o.family==='sequence'?2*Math.PI:10,fn=o.family==='rect'?w=>rectangleFT(1,p.T,w):o.family==='exp'?w=>1/Math.hypot(p.a,w):w=>{const z=finiteDTFT(p.x,w,p.start);return Math.hypot(z.re,z.im);};
    single(card('주파수 영역'),sample(fn,-max,max,2049),{xmin:-max,xmax:max,label:o.family==='rect'?'ω [rad/s] · 실수 X(ω)':o.family==='exp'?'ω [rad/s] · |X(ω)|':'Ω [rad/sample] · |X(eʲΩ)| · 2π 주기'});return;
  }
  if(id==='sampling'){
    const a=samplingAlias(p.f,p.fs);node('p',`f_alias=${a.aliasHz.toFixed(6)} Hz · ${a.status==='alias-free'?'복원 엄밀범위 안':a.status==='nyquist-boundary'?'Nyquist 경계 · 임의 위상 유일 복원 불가':'aliasing'}`,parent,{'data-signals-alias':''});
    const c=card('연속시간 신호와 같은 표본을 만드는 alias');
    if(p.f/p.fs<=8)plot(c,[{points:sample(t=>Math.cos(2*Math.PI*p.f*t+p.phase),0,16/p.fs,2049)},{points:sample(t=>Math.cos(2*Math.PI*a.aliasHz*t+a.phaseSign*p.phase),0,16/p.fs,2049),color:'#d0acff'}],{xmin:0,xmax:16/p.fs,label:'t [s] · 청록 원 신호 / 보라 alias'});else node('p','높은 f₀/fₛ에서 연속 곡선 해상도가 부족하여 곡선을 생략합니다. 아래 실제 표본만 확인하세요.',c);
    single(card('이산시간 표본 x[n]'),Array.from({length:17},(_,n)=>[n,Math.cos(a.omega*n+p.phase)]),{xmin:0,xmax:16,label:'n [sample] · 표본 사이 연결선 없음',stem:true});
  }
}
