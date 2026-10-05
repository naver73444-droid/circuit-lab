import {rectangleConvolution,exponentialConvolution} from './signals-course-model.js';
import {customConvolutionAt,windowSignal,EXPRESSION_LIMITS} from './signals-expression.js';
const views=new WeakMap();
const format=n=>Number(n.toPrecision(5)).toString();
export function convolutionDomain(o,p){
  if(o.family==='sequence')return{min:p.output.start-1,max:p.output.start+p.output.values.length,step:1,unit:'n [sample]'};
  if(p.custom)return{min:-2*p.T,max:2*p.T,step:p.dt,unit:'t [s]'};
  const end=o.family==='rect'?p.T1+p.T2:8/Math.min(p.a,p.b);return{min:-.1*end,max:1.1*end,step:end/100,unit:'t [s]'};
}
const samples=(fn,lo,hi,count=257)=>Array.from({length:count},(_,i)=>{const x=lo+(hi-lo)*i/(count-1);return[x,fn(x)];});
function jumpSamples(fn,lo,hi,edges){const points=samples(fn,lo,hi);for(const x of edges.filter(x=>x>=lo&&x<=hi)){const d=(hi-lo)*1e-9;points.push([x,fn(x-d)],[x,fn(x+d)]);}return points.sort((a,b)=>a[0]-b[0]);}

// Mount once per applied input; animation only updates attributes/text. In
// particular the range, SVG roots, axes and static output paths stay connected.
export function renderConvolutionVisual(parent,state,{playing=false,reducedMotion=false}={}) {
  let view=views.get(parent);
  if(!view||view.p!==state.numeric||view.family!==state.options.family||!parent.contains(view.root)){
    view=mount(parent,state);views.set(parent,view);
  }
  view.update(state,playing,reducedMotion);
}
function mount(parent,state){
  parent.replaceChildren();const doc=parent.ownerDocument,p=state.numeric,family=state.options.family,dt=family==='sequence',domain=convolutionDomain(state.options,p);
  const el=(tag,text,parent,attrs={})=>{const n=doc.createElement(tag);if(text!==undefined)n.textContent=text;for(const[k,v]of Object.entries(attrs))n.setAttribute(k,String(v));parent.append(n);return n;};
  const sv=(tag,attrs,parent,text)=>{const n=doc.createElementNS('http://www.w3.org/2000/svg',tag);for(const[k,v]of Object.entries(attrs))n.setAttribute(k,String(v));if(text!==undefined)n.textContent=text;parent.append(n);return n;};
  const root=el('div',undefined,parent,{'data-signals-stable-view':''});
  const controls=el('div',undefined,root,{class:'signals-cursor'}),label=el('label',dt?'관측 n · 정수 표본별 곱과 합':'관측 t · 연속 이동과 적분',controls);
  const slider=el('input',undefined,label,{type:'range',min:domain.min,max:domain.max,step:dt?1:'any','data-signals-cursor':''});
  const actions=el('div',undefined,controls,{class:'signals-playback'});
  for(const[action,text]of [['previous','← 한 단계'],['play','재생'],['next','한 단계 →']])el('button',text,actions,{type:'button','data-signals-play':action});
  const previous=actions.querySelector('[data-signals-play="previous"]'),play=actions.querySelector('[data-signals-play="play"]'),next=actions.querySelector('[data-signals-play="next"]');
  const jumps={};for(const[action,text]of [['first','처음'],['zero','0으로'],['last','끝']])jumps[action]=el('button',text,actions,{type:'button','data-signals-jump':action});
  const speedLabel=el('label','재생 속도',controls),speed=el('select',undefined,speedLabel,{'data-signals-speed':''});for(const v of [.25,.5,1,2])el('option',`${v}×`,speed,{value:v});
  const motionNote=el('p','',controls,{class:'signals-caption','data-signals-motion-note':''});
  const status=el('p','',root,{'data-signals-overlap':'',role:'status','aria-live':'off'});
  if(p.custom)el('p',`직접 입력의 근사 결과 · x와 h 모두 [−${p.T}, ${p.T}] s 밖에서는 0으로 가정. 중점 적분 Δτ=${format(p.dt)} s (${p.cells}구간). 입력·곱 그림은 257점, 출력 곡선은 ${EXPRESSION_LIMITS.outputPoints}점 사이를 선으로 이었습니다. 창 절단·표본화 오차가 있으며 좁은 펄스는 누락될 수 있습니다.`,root,{class:'signals-caption','data-signals-custom-notice':''});
  const plot=(title,xlo,xhi,maxY,{stem=false,fill=false}={})=>{
    const card=el('section',undefined,root,{class:'signals-graph-card'});el('h3',title,card);
    const svg=sv('svg',{viewBox:'0 0 680 240',role:'img','aria-label':title,'data-signals-plot':stem?'stem':'continuous'},card);sv('title',{},svg,title);
    maxY=Math.max(.01,maxY);const px=x=>55+595*(x-xlo)/(xhi-xlo),py=y=>112-78*y/maxY;
    sv('line',{x1:55,y1:112,x2:650,y2:112,stroke:'#839cae'},svg);
    for(const y of [-maxY,0,maxY])sv('text',{x:2,y:py(y)+5,fill:'#d7e5f0','font-size':20},svg,format(y));
    for(let i=0;i<=4;i++){const x=xlo+(xhi-xlo)*i/4;sv('text',{x:px(x),y:221,fill:'#d7e5f0','font-size':20,'text-anchor':'middle'},svg,format(x));}
    const series=(color,points)=>{
      if(stem){const nodes=points.map(()=>({line:sv('line',{stroke:color,'stroke-width':2,'data-signals-stem':''},svg),dot:sv('circle',{r:3.5,fill:color},svg)}));return next=>next.forEach(([x,y],i)=>{const n=nodes[i];n.line.setAttribute('x1',px(x));n.line.setAttribute('x2',px(x));n.line.setAttribute('y1',py(0));n.line.setAttribute('y2',py(y));n.dot.setAttribute('cx',px(x));n.dot.setAttribute('cy',py(y));});}
      const area=fill?sv('polygon',{fill:color,opacity:.22},svg):null,line=sv('polyline',{fill:'none',stroke:color,'stroke-width':2},svg);
      return points=>{line.setAttribute('points',points.map(([x,y])=>`${px(x)},${py(y)}`).join(' '));if(area&&points.length)area.setAttribute('points',[[points[0][0],0],...points,[points.at(-1)[0],0]].map(([x,y])=>`${px(x)},${py(y)}`).join(' '));};
    };
    const marker=sv('circle',{r:6,fill:'#ffe19a',hidden:true,'data-signals-output-marker':''},svg);
    const caption=el('p','',card,{class:'signals-caption'});
    return{series,caption,mark:(x,y)=>{marker.removeAttribute('hidden');marker.setAttribute('cx',px(x));marker.setAttribute('cy',py(y));}};
  };
  let update;
  if(dt){
    const lo=Math.min(p.xStart,domain.min-p.hStart-p.h.length+1)-1,hi=Math.max(p.xStart+p.x.length-1,domain.max-p.hStart)+1;
    const maxX=Math.max(...p.x.map(Math.abs),.01),maxH=Math.max(...p.h.map(Math.abs),.01);
    const a=plot('1 · 원 입력 x[k]',lo,hi,maxX,{stem:true}),b=plot('2 · 뒤집고 이동한 h[n−k]',lo,hi,maxH,{stem:true}),c=plot('3 · 곱 x[k]h[n−k]',lo,hi,maxX*maxH,{stem:true}),d=plot('4 · 정수 출력 y[n]',domain.min,domain.max,Math.max(...p.output.values.map(Math.abs),.01),{stem:true});
    const xpoints=p.x.map((v,i)=>[p.xStart+i,v]);a.series('#9de4d8',xpoints)(xpoints);a.caption.textContent='k [sample] · 진폭';
    const moveH=b.series('#d0acff',p.h.map(()=>[0,0])),products=c.series('#9de4d8',xpoints),out=p.output.values.map((v,i)=>[p.output.start+i,v]);d.series('#9de4d8',out)(out);c.caption.textContent='k [sample] · 곱';d.caption.textContent='n [sample] · 표본 사이 보간 없음';
    update=n=>{n=Math.round(n);const terms=p.x.map((v,i)=>{const k=p.xStart+i,j=n-k-p.hStart;return[k,v*(j>=0&&j<p.h.length?p.h[j]:0)];}),sum=terms.reduce((s,v)=>s+v[1],0);moveH(p.h.map((v,i)=>[n-p.hStart-i,v]));products(terms);d.mark(n,sum);b.caption.textContent=`k [sample] · n=${n}`;status.textContent=`n=${n}: ${terms.map(v=>format(v[1])).join(' + ')} = ${format(sum)} = y[${n}]`;};
  }else{
    const end=family==='rect'?p.T1+p.T2:family==='exp'?8/Math.min(p.a,p.b):p.T;
    const lo=p.custom?-p.T:-.15*end,hi=p.custom?p.T:1.15*end;
    const rect=(t,T)=>t===0||t===T?.5:t>0&&t<T?1:0;
    const xf=p.custom?t=>windowSignal(p.xAst,t,p.T):family==='rect'?t=>rect(t,p.T1):t=>t<0?0:Math.exp(-p.a*t);
    const hbase=p.custom?t=>windowSignal(p.hAst,t,p.T):family==='rect'?t=>rect(t,p.T2):t=>t<0?0:Math.exp(-p.b*t);
    const yfn=p.custom?t=>customConvolutionAt(p,t):family==='rect'?t=>rectangleConvolution(t,p.T1,p.T2).y:t=>exponentialConvolution(t,p.a,p.b);
    const xpoints=jumpSamples(xf,lo,hi,p.custom?[]:family==='rect'?[0,p.T1]:[0]);
    const inputMax=p.custom?Math.max(...samples(xf,-p.T,p.T,513).map(v=>Math.abs(v[1])),...samples(hbase,-p.T,p.T,513).map(v=>Math.abs(v[1])),.01):1;
    const output=p.custom?p.output:samples(yfn,domain.min,domain.max);
    const a=plot('1 · x(τ)와 뒤집고 이동한 h(t−τ)',lo,hi,inputMax),b=plot('2 · 곱과 적분 면적',lo,hi,inputMax*inputMax,{fill:true}),c=plot(p.custom?'3 · 유한창 근사 출력':'3 · 정확한 출력',domain.min,domain.max,Math.max(...output.map(v=>Math.abs(v[1])),.01));
    a.series('#9de4d8',xpoints)(xpoints);const moving=a.series('#d0acff',[]),product=b.series('#9de4d8',[]);c.series('#9de4d8',output)(output);
    a.caption.textContent=`τ [s] · 청록 x / 보라 h(t−τ)${p.custom?' · 적분 창만 표시':' · 단위 진폭 예시'}`;b.caption.textContent='τ [s] · x(τ)h(t−τ), 음영의 적분';c.caption.textContent='t [s] · y(t) [진폭²·s]';
    update=t=>{const h=tau=>hbase(t-tau),edges=p.custom?[]:family==='rect'?[t-p.T2,t]:[t];moving(jumpSamples(h,lo,hi,edges));
      let points;if(!p.custom&&family==='rect'){const r=rectangleConvolution(t,p.T1,p.T2);points=r.width>0?[[r.lower,0],[r.lower,1],[r.upper,1],[r.upper,0]]:[[0,0]];}else points=jumpSamples(tau=>xf(tau)*h(tau),lo,hi,p.custom?[]:[0,t]);
      product(points);const y=yfn(t);c.mark(t,y);status.textContent=`t=${format(t)} s · ${p.custom?'근사':'정확한'} y(t)=${format(y)} (진폭²·s)`;};
  }
  return{p,family,root,update:(state,playing,reduced)=>{slider.value=String(state.cursor);slider.setAttribute('aria-valuetext',`${format(state.cursor)} · ${domain.unit}`);speed.value=String(state.speed||1);play.textContent=playing?'일시정지':'재생';play.setAttribute('aria-pressed',String(playing));play.disabled=reduced;previous.disabled=state.cursor<=domain.min;next.disabled=state.cursor>=domain.max;jumps.first.disabled=state.cursor<=domain.min;jumps.last.disabled=state.cursor>=domain.max;jumps.zero.disabled=domain.min>0||domain.max<0;motionNote.textContent=reduced?'동작 줄이기 설정: 자동 재생 대신 수동 슬라이더/한 단계를 이용하세요.':dt?'정수 n만 이동합니다. 중간의 비정수 결과는 만들지 않습니다.':'시간에 비례해 이동합니다. 입력 편집·다른 탭/창으로 이동하면 멈춥니다.';update(state.cursor);}};
}
