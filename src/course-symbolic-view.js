import { appendCourseMath } from './course-math-view.js';

export function symbolicText(data) {
  const lines=[data.title||'기호 해석'];
  const section=(title,items)=>{if(items?.length)lines.push('',title,...items);};
  section('주어진 문자와 단위',(data.givens||[]).map(g=>g.symbol+': '+g.meaning+(g.unit?' ['+g.unit+']':'')+(g.constraint?' — '+g.constraint:'')));
  section('가정',data.assumptions);section('선택 조건',data.conditions);
  section('적용 법칙',(data.laws||[]).map(l=>l.name+'\n'+l.formula));
  section('유도 과정',(data.steps||[]).map((s,i)=>(i+1)+'. '+s.title+[s.formula,s.explanation].filter(Boolean).map(t=>'\n'+t).join('')));
  section('기호 답안',(data.answers||[]).map(a=>a.quantity+(a.unit?' ['+a.unit+']':'')+'\n'+a.formula+(a.direction?'\n방향: '+a.direction:'')));
  for(const [title,items]of [['구간별 해',data.regions],['경계 한계',data.boundaries]])section(title,(items||[]).map(i=>[i.condition,i.formula,i.explanation].filter(Boolean).join('\n')));
  section('지원 범위',data.limitations);return lines.join('\n');
}

export function renderSymbolic(container, data, {copyData=data}={}) {
  container.replaceChildren();container.classList.add('course-symbolic');
  const style=document.createElement('style');style.textContent=`.course-symbolic{font:15px/1.65 system-ui,sans-serif;overflow-wrap:anywhere}.course-symbolic h3{font-size:18px;margin:8px 0}.course-symbolic h4{font-size:15px;margin:16px 0 6px}.course-symbolic p{margin:6px 0}.course-symbolic pre{font:15px/1.65 ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere;margin:6px 0;padding:10px;border:1px solid #667080;border-radius:8px}.course-symbolic ul,.course-symbolic ol{padding-left:24px;margin:6px 0}.course-symbolic .course-symbolic-region{border-left:3px solid #73b8da;padding-left:12px;margin:12px 0}.course-symbolic .course-symbolic-answer{border:1px solid #79b494;border-radius:10px;padding:10px;margin:10px 0}.course-symbolic .course-symbolic-givens{display:flex;flex-wrap:wrap;gap:8px 20px}.course-symbolic .course-symbolic-givens p{flex:1 1 240px}@media(max-width:760px){.course-symbolic pre{font-size:14px}}`;container.append(style);
  const element=(tag,text,parent=container)=>{const node=document.createElement(tag);node.textContent=text||'';parent.append(node);return node;};
  element('h3',data?.title||'기호 해석');
  if(data?.status!=='supported'){element('p',data?.reason||'선택한 조건의 기호해를 지원하지 않습니다.');if(data?.limitations?.length){const ul=element('ul');for(const text of data.limitations)element('li',text,ul);}return;}
  const copy=element('button','풀이 복사');copy.type='button';copy.dataset.symbolicCopy='';
  const copyStatus=element('span');copyStatus.setAttribute('role','status');copyStatus.style.marginLeft='8px';
  copy.onclick=async()=>{const text=symbolicText(copyData);try{await navigator.clipboard.writeText(text);container.querySelector('[data-symbolic-copy-fallback]')?.remove();copyStatus.textContent='풀이를 복사했습니다.';}catch{copyStatus.textContent='아래 선택된 텍스트를 직접 복사하세요.';let fallback=container.querySelector('[data-symbolic-copy-fallback]');if(!fallback){fallback=element('textarea');fallback.readOnly=true;fallback.dataset.symbolicCopyFallback='';fallback.setAttribute('aria-label','복사할 전체 풀이');fallback.style.cssText='width:100%;min-height:180px';copyStatus.after(fallback);}fallback.value=text;fallback.focus();fallback.select();}};
  element('h4','주어진 문자와 조건');const givens=element('div');givens.className='course-symbolic-givens';
  for(const item of data.givens||[])element('p',`${item.symbol}: ${item.meaning}${item.unit?' ['+item.unit+']':''}${item.constraint?' · '+item.constraint:''}`,givens);
  for(const [title,items] of [['가정',data.assumptions],['적용 조건',data.conditions]])if(items?.length){element('h4',title);const ul=element('ul');for(const text of items)element('li',text,ul);}
  if(data.answers?.length){element('h4','기호 정답');for(const answer of data.answers){const box=element('div');box.className='course-symbolic-answer';element('strong',answer.quantity+(answer.unit?' ['+answer.unit+']':''),box);appendCourseMath(box,answer.formula);if(answer.direction)element('p','방향: '+answer.direction,box);}}
  if(data.laws?.length){element('h4','적용 법칙');for(const law of data.laws){element('p',law.name);appendCourseMath(container,law.formula);}}
  if(data.steps?.length){const details=element('details');details.className='course-derivation';element('summary','유도 과정 · 단계별 설명',details);const ol=element('ol','',details);for(const step of data.steps){const li=element('li','',ol);element('strong',step.title,li);if(step.formula)appendCourseMath(li,step.formula);if(step.explanation)element('p',step.explanation,li);}}
  for(const [title,items] of [['구간별 해',data.regions],['경계와 한계',data.boundaries]])if(items?.length){element('h4',title);for(const [index,item] of items.entries()){const box=element('div');box.className='course-symbolic-region';if(items===data.regions)box.dataset.symbolicRegionIndex=index;else box.dataset.symbolicBoundaryIndex=index;element('strong',item.condition,box);if(item.formula)appendCourseMath(box,item.formula);if(item.explanation)element('p',item.explanation,box);}}
  if(data.limitations?.length){element('h4','지원 범위');const ul=element('ul');for(const text of data.limitations)element('li',text,ul);}
}
