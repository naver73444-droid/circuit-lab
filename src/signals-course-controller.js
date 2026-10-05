import { SIGNALS_LESSONS, SIGNALS_CONVENTIONS, getSignalsLesson, initialSignalsOptions, evaluateSignalsLesson, parseSignalsNumber, parseSignalsSequence, discreteConvolution, samplingAlias } from './signals-course-model.js';
import { prepareCustomConvolution, EXPRESSION_LIMITS } from './signals-expression.js';
import { ensureCourseStyle } from './course-style.js';
import { playbackCursor } from './signals-playback.js';
import { renderSignalsVisual, cursorDomain } from './signals-visual.js';
import { appendCourseMath } from './course-math-view.js';
import { renderSymbolic } from './course-symbolic-view.js';
import { preserveCourseFocus } from './course-focus.js';

const lessonControls=id=>getSignalsLesson(id).controls.map(c=>id==='convolution'&&c.key==='family'?{...c,choices:[{value:'custom',label:'직접 입력 · 연속식 x(t), h(t)'},{value:'sequence',label:'직접 입력 · 이산수열 x[n], h[n]'},...c.choices.filter(v=>v.value!=='sequence')]}:c);
const numericFields = (id,o) => {
  if(id==='time' && o.family==='sequence') return [['x','x 표본 · 쉼표 구분','2,4,6'],['start','원 시작 인덱스','-1'],['a','정수 배율 a',o.sign==='negative'?'-1':'2'],['b','정수 내부 이동 b','1']];
  if(id==='time' && o.family!=='sequence') return [['a','배율 a',o.sign==='negative'?'-2':'2'],['b','내부 이동 b','1']];
  if(id==='convolution'&&o.family==='custom')return [['xExpression','x(t) 식','u(t)-u(t-2)'],['hExpression','h(t) 식','exp(-t)*u(t)'],['windowT','양쪽 입력 창 ±T [s]','4'],['dt','적분 Δτ [s]','0.02']];
  if(id==='convolution') return o.family==='rect'?[['T1','폭 T₁ [s]','2'],['T2','폭 T₂ [s]','1']]:o.family==='exp'?[['a','감쇠 α [1/s]','1'],['b','감쇠 β [1/s]','2']]:[['x','x 표본 · 쉼표 구분','1,2,1'],['h','h 표본 · 쉼표 구분','1,-1'],['xStart','x 시작 인덱스','0'],['hStart','h 시작 인덱스','0']];
  if(id==='series') return o.family==='pulse'?[['D','듀티비 D','0.5']]:[];
  if(id==='fourier') return o.family==='rect'?[['T','폭 T [s]','2']]:o.family==='exp'?[['a','감쇠 α [1/s]','1']]:o.family==='sequence'?[['x','x 표본 · 쉼표 구분','1,2,1'],['start','시작 인덱스','0']]:[];
  if(id==='sampling') return [['f','f₀ [Hz]','7'],['fs','fₛ [sample/s]','10'],['phase','위상 φ [rad]','0']];
  return [];
};
const styles=`.signals-course{box-sizing:border-box;color:inherit;font:16px/1.5 system-ui,sans-serif;padding:clamp(12px,3vw,28px);max-width:1120px;margin:auto;overflow-wrap:anywhere}.signals-course *{box-sizing:border-box}.signals-course h2{font-size:26px;margin:0 0 12px}.signals-course nav{display:flex;gap:7px;flex-wrap:wrap;margin-bottom:18px}.signals-course button,.signals-course select,.signals-course input{font:inherit;color:inherit;background:#172332;border:1px solid #678099;border-radius:7px;padding:9px;min-height:44px;max-width:100%}.signals-course button{cursor:pointer}.signals-course button:disabled{opacity:.45;cursor:default}.signals-course :is(button,input,select):focus-visible{outline:2px solid #9addf0;outline-offset:2px}.signals-course .signals-numeric form>button{margin:4px 6px 0 0}.signals-course button[aria-current=step]{background:#244d60;border-color:#9addf0}.signals-course label{display:flex;flex-direction:column;gap:4px;min-width:0}.signals-course .signals-controls{display:flex;gap:12px;flex-wrap:wrap;margin:12px 0}.signals-course .signals-controls label{flex:1 1 190px}.signals-course .signals-answer{padding:18px;border:1px solid #81b69f;border-radius:12px;font:17px/1.65 ui-monospace,monospace;white-space:pre-wrap;margin:16px 0}.signals-course .signals-picture{background:#142435;padding:20px;border-radius:12px;text-align:center;font-size:clamp(18px,2.2vw,25px);min-height:130px;display:grid;place-content:center;gap:14px}.signals-course .signals-picture small{font:14px system-ui;color:#b6c8d9}.signals-course details{border-top:1px solid #536478;padding:13px 0}.signals-course summary{cursor:pointer;font-weight:600;min-height:30px}.signals-course pre{white-space:pre-wrap;overflow-wrap:anywhere}.signals-course svg{width:100%;height:auto;display:block;min-width:0}.signals-course .signals-error{color:#ffd1a8;white-space:pre-wrap}.signals-course [hidden]{display:none!important}.signals-course .signals-numeric{padding-top:12px}.signals-course .signals-cursor input{width:100%}.signals-course .signals-cursor{margin:12px 0}.signals-course .signals-graph-card{border:1px solid #536478;border-radius:12px;padding:10px;margin:12px 0;background:#142435}.signals-course .signals-graph-card h3{font-size:17px;margin:4px 0}.signals-course .signals-playback{display:flex;gap:6px;flex-wrap:wrap}.signals-course p{margin:10px 0}.signals-course .signals-caption{font-size:14px;color:#c3d1dd}@media(max-width:520px){.signals-course h2{font-size:22px}.signals-course .signals-answer{font-size:15px;padding:12px}.signals-course nav button{font-size:14px;flex:1 1 145px}}`;

export function createSignalsCourseController(host) {
  if(!host||typeof host.querySelector!=='function') throw new TypeError('신호 학습 패널 host가 필요합니다.');
  const doc=host.ownerDocument,win=doc.defaultView;const motion=win.matchMedia?.('(prefers-reduced-motion: reduce)');let timer=null,playStart=0,playCursor=0;let id=SIGNALS_LESSONS[0].id,active=false,destroyed=false;
  const states=new Map();
  const makeState=(lessonId) => ({ options:{...initialSignalsOptions(lessonId),...(lessonId==='convolution'?{family:'custom'}:{})},drafts:{},inputBackup:null,snippetTarget:'xExpression',numeric:null,numericDirty:false,numericError:'',numericUnsupported:false,cursor:0,solutionOpen:false,numericOpen:lessonId==='convolution',initialized:false,speed:1,familyStates:{} });
  for(const l of SIGNALS_LESSONS)states.set(l.id,makeState(l.id));
  const current=()=>states.get(id);
  function el(tag,text,parent,attrs={}) { const n=doc.createElement(tag);if(text!==undefined)n.textContent=text;for(const [k,v]of Object.entries(attrs))n.setAttribute(k,String(v));parent?.append(n);return n; }
  function render() {
    if(destroyed)return;const state=current();
    if(!state.initialized){state.initialized=true;const fields=numericFields(id,state.options);for(const[k,,initial]of fields)if(!Object.hasOwn(state.drafts,k))state.drafts[k]=initial;if(fields.length){calculate(false);return;}}
    const lesson=getSignalsLesson(id),custom=id==='convolution'&&state.options.family==='custom',symbolic=custom?null:evaluateSignalsLesson(id,state.options);
    const restoreFocus=preserveCourseFocus(host,['data-signals-key','data-signals-control','data-signals-lesson','data-signals-calculate','data-signals-reset','data-signals-expression-example','data-signals-sequence-example']);
    host.replaceChildren();const root=el('div',undefined,host,{class:'signals-course'});ensureCourseStyle(host,'signals-course',styles);el('h2','신호 및 시스템',root);
    const nav=el('nav',undefined,root,{'aria-label':'학습 단계'});for(const l of SIGNALS_LESSONS)el('button',l.title,nav,{'type':'button','data-signals-lesson':l.id,...(l.id===id?{'aria-current':'step'}:{})});
    const controls=el('div',undefined,root,{class:'signals-controls'});
    for(const c of lessonControls(id)) {const label=el('label',c.label,controls);const input=el('select',undefined,label,{'data-signals-control':c.key});for(const v of c.choices)el('option',v.label,input,{value:v.value});input.value=state.options[c.key];}
    const picture=el('div',undefined,root,{class:'signals-picture',...(id==='roc'?{'data-signals-condition-context':''}:{})});
    if(id==='roc'){el('small','변환할 신호',picture);for(const condition of symbolic.conditions)appendCourseMath(picture,condition,{showOriginal:true});el('small',symbolic.givens.map(g=>g.constraint).filter(Boolean).join(' · '),picture);}
    else el('div',lesson.picture,picture);if(id!=='roc')el('small','큰그림 · 개념도이며 비례축이 아닙니다.',picture);
    const preview=el('section',undefined,root,{'data-signals-visual-preview':''});
    el('h3','그림으로 확인하기',preview);el('p','아래는 선택한 함수족의 수치 예시입니다. 기호답의 일반 조건과 구별해서 보세요.',preview,{class:'signals-caption'});
    el('p',state.numericError,preview,{class:'signals-error',role:'status','data-signals-numeric-status':''});const projection=el('div',undefined,preview,{'data-signals-projection':''});
    if(state.numericDirty)el('p','수치 조건을 수정했습니다. 예시 계산을 눌러 다시 확인하세요.',projection);else if(state.numeric)renderNumeric(projection);else el('p',id==='roc'?'ROC는 아래 문자 조건과 수렴영역으로 판단합니다.':'이 분포/함수 선택은 보통함수 수치 그래프를 제공하지 않습니다.',projection);
    const box=el('div',undefined,root,{class:'signals-answer','data-signals-answer':''});
    if(custom)el('p','직접 입력한 식의 유한창 근사입니다. 기존 함수족의 기호 정답을 이 식의 정답으로 사용하지 않습니다.',box);else for(const a of symbolic.answers) {el('strong',a.quantity,box);appendCourseMath(box,a.formula,{showOriginal:true});}
    const details=el('details',undefined,root,{'data-signals-solution':''});details.open=state.solutionOpen;el('summary','문자 조건 · 법칙 · 유도 펼치기',details);const symbolicHost=el('div',undefined,details);if(custom)el('p','y(t) ≈ Δτ Σ x(τᵢ)h(t−τᵢ). x와 h는 각각 선언된 입력 창 밖에서 0으로 취급합니다. 일반 해석적 적분/기호 풀이를 생성하지 않습니다.',symbolicHost);else renderSymbolic(symbolicHost,symbolic);
    const numericDetails=el('details',undefined,root,{'data-signals-numeric-details':''});numericDetails.open=state.numericOpen;el('summary',id==='convolution'?'컨볼루션 직접 입력':'예시 조건 바꾸기',numericDetails);if(id==='convolution')root.insertBefore(numericDetails,picture);
    const numeric=el('div',undefined,numericDetails,{class:'signals-numeric'}),fields=numericFields(id,state.options);
    el('p',custom?'u(t), rect(t), exp/sin/cos, 사칙연산 · 곱셈은 *':'기호답을 바꾸지 않는 수치 입력입니다. 아래 그림에서 적용한 값을 확인하세요.',numeric,{class:'signals-caption'});
    if(custom){const help=el('details',undefined,numeric);el('summary','입력 문법·계산 한계',help);el('p',`숫자, t, pi, e, + - * /, 괄호와 u/rect/exp/sin/cos 함수만 지원합니다. ^ 거듭제곱과 암시적 곱셈은 지원하지 않습니다. u(0)=1/2, rect(t)는 |t|<1/2에서 1입니다. 길이${EXPRESSION_LIMITS.length}자/노드${EXPRESSION_LIMITS.nodes}/괄호·함수 중첩${EXPRESSION_LIMITS.depth}/적분${EXPRESSION_LIMITS.minCells}~${EXPRESSION_LIMITS.maxCells}구간, 출력 ${EXPRESSION_LIMITS.outputPoints}점, 계산량 상한(노드×구간×표본)과 사전계산 안전시간 ${EXPRESSION_LIMITS.timeBudgetMs/1000}초입니다. 분모가 창 안 0일 가능성이 있는 식은 보수적으로 거절합니다.`,help);}
    if(fields.length) {
      const form=el('form',undefined,numeric,{'data-signals-numeric-form':''}),row=el('div',undefined,form,{class:'signals-controls'});
      for(const[key,label,initial]of fields){if(!Object.hasOwn(state.drafts,key))state.drafts[key]=initial;const lab=el('label',label,row);const input=el('input',undefined,lab,{'data-signals-key':key,'type':'text',...(!['x','h','xExpression','hExpression'].includes(key)?{'inputmode':'decimal'}:{}),...(key.endsWith('Expression')?{maxlength:EXPRESSION_LIMITS.length}:{})});input.value=state.drafts[key];}
      if(custom){const label=el('label','함수 넣을 곳',form),target=el('select',undefined,label,{'data-signals-snippet-target':''});for(const[key,text]of [['xExpression','x(t)'],['hExpression','h(t)']])el('option',text,target,{value:key});target.value=state.snippetTarget;for(const text of ['u(t)','rect(t)','exp(-t)','sin(2*pi*t)','cos(2*pi*t)'])el('button',text,form,{type:'button','data-signals-snippet':text});el('p','선택한 부분에 삽입 · 곱셈은 *를 직접 입력',form,{class:'signals-caption'});}
      if(id==='convolution'&&['custom','sequence'].includes(state.options.family)){el('button','x ↔ h 바꾸기',form,{type:'button','data-signals-swap':''});const undo=el('button','이전 입력 복구',form,{type:'button','data-signals-restore-input':''});undo.disabled=!state.inputBackup;el('p','도구 사용 직전 입력 1회 복구 · 직접 수정하면 해제',form,{class:'signals-caption'});el('p','',form,{role:'status','data-signals-tool-status':''});}
      if(custom){for(const[k,text]of [['rect','직사각 예제식'],['exp','지수 예제식']])el('button',text,form,{type:'button','data-signals-expression-example':k});}
      if(id==='convolution'&&state.options.family==='sequence')for(const[k,text]of [['basic','기본'],['difference','차분'],['average','3점 평균']])el('button',text,form,{type:'button','data-signals-sequence-example':k});
      el('button',id==='convolution'?'입력으로 컨볼루션 계산':'예시 계산',form,{type:'submit','data-signals-calculate':''});el('button','초기 조건',form,{type:'button','data-signals-reset':''});
      if(id==='convolution'){el('p','',form,{role:'status','data-signals-input-status':''});el('button','그래프 보기',form,{type:'button','data-signals-show-graph':''});syncInputStatus();}
    } else el('p',id==='roc'?'ROC는 위의 문자 조건으로 판단합니다. 이 단계에는 수치 그래프가 없습니다.':'이 선택에는 수치 예시를 제공하지 않습니다. 이산 시간축 보간과 Dirac/PV의 보통함수 그래프는 지원하지 않습니다.',numeric);
    const conventions=el('details',undefined,root);el('summary','관례와 지원 범위',conventions);el('p',SIGNALS_CONVENTIONS,conventions);el('p','지원 함수족: 지수, 계단, 직사각, 정현파, 유한 이산수열. 직접 CT 입력은 제한된 사칙/함수만 수치적으로 계산하며 임의 기호 해석은 지원하지 않습니다.',conventions);
    restoreFocus();
  }
  function syncInputStatus(){const s=current(),valid=Boolean(s.numeric&&!s.numericDirty&&!s.numericError),status=host.querySelector('[data-signals-input-status]'),button=host.querySelector('[data-signals-show-graph]');if(status)status.textContent=s.numericError?'입력 오류 · '+s.numericError:valid?'적용됨 · 현재 입력의 그래프':'미적용 · 계산을 눌러 주세요';if(button)button.disabled=!valid;}
  function renderNumeric(parent=host.querySelector('[data-signals-projection]')) { try{renderSignalsVisual(parent,current(),id,{playing:timer!==null,reducedMotion:Boolean(motion?.matches)});}catch(error){stopPlayback();current().numericDirty=true;current().numericError=error.message;parent.textContent=error.message;syncInputStatus();} }
  function stopPlayback(){if(timer!==null){win.cancelAnimationFrame(timer);timer=null;}const button=host.querySelector('[data-signals-play="play"]');if(button){button.textContent='재생';button.setAttribute('aria-pressed','false');}}
  function advance(direction=1){const s=current(),d=cursorDomain(id,s.options,s.numeric);if(!d||s.numericDirty)return;const next=Math.min(d.max,Math.max(d.min,s.cursor+direction*d.step));s.cursor=s.options.family==='sequence'?Math.round(next):next;if(s.cursor>=d.max)stopPlayback();renderNumeric();}
  function startPlayback(){const s=current(),d=cursorDomain(id,s.options,s.numeric);if(!d||s.numericDirty||motion?.matches||doc.hidden)return;if(s.cursor>=d.max)s.cursor=d.min;playStart=win.performance.now();playCursor=s.cursor;
    const tick=timestamp=>{if(!active||destroyed||doc.hidden||motion?.matches){stopPlayback();return;}const next=playbackCursor(playCursor,timestamp-playStart,d,s.speed,s.options.family==='sequence');if(next!==s.cursor){s.cursor=next;renderNumeric();}if(s.numericDirty||s.cursor>=d.max){stopPlayback();return;}timer=win.requestAnimationFrame(tick);};timer=win.requestAnimationFrame(tick);renderNumeric();
  }
  function onVisibility(){if(doc.hidden)stopPlayback();}
  function onBlur(){stopPlayback();}
  function onMotion(){stopPlayback();if(active&&!current().numericDirty&&current().numeric)renderNumeric();}
  function calculate(reveal=true) {
    stopPlayback();const s=current(),o=s.options,read=(key,opts)=>parseSignalsNumber(s.drafts[key],opts);let p;
    try {
      if(id==='time'){p={a:read('a',{min:-100,max:100,integer:o.family==='sequence'}),b:read('b',{min:-100,max:100,integer:o.family==='sequence'})};if(o.family==='sequence'){p.x=parseSignalsSequence(s.drafts.x);p.start=read('start',{integer:true,min:-1000,max:1000});}if(p.a===0||Math.abs(p.a)<.01||(o.sign==='positive'?p.a<0:p.a>0))throw new RangeError('a는 선택한 부호와 같고 0.01≤|a|≤100이어야 합니다.');}
      if(id==='convolution'){if(o.family==='custom')p=prepareCustomConvolution(s.drafts.xExpression,s.drafts.hExpression,read('windowT',{min:.05,max:20}),read('dt',{min:.00001,max:1}));else if(o.family==='rect')p={T1:read('T1',{min:.001,max:100}),T2:read('T2',{min:.001,max:100})};else if(o.family==='exp')p={a:read('a',{min:.01,max:100}),b:read('b',{min:.01,max:100})};else{p={x:parseSignalsSequence(s.drafts.x),h:parseSignalsSequence(s.drafts.h),xStart:read('xStart',{integer:true,min:-1000,max:1000}),hStart:read('hStart',{integer:true,min:-1000,max:1000})};p.output=discreteConvolution(p.x,p.h,p.xStart,p.hStart);}}
      if(id==='series'){p={D:read('D',{min:.001,max:.999})};}
      if(id==='fourier'){p=o.family==='rect'?{T:read('T',{min:.001,max:100})}:o.family==='exp'?{a:read('a',{min:.01,max:100})}:{x:parseSignalsSequence(s.drafts.x),start:read('start',{integer:true,min:-1000,max:1000})};}
      if(id==='sampling'){p={f:read('f',{min:0,max:10000}),fs:read('fs',{min:.001,max:10000}),phase:read('phase',{min:-100,max:100})};samplingAlias(p.f,p.fs);}
      if(!numericFields(id,o).length)throw new RangeError('이 선택에는 수치 예시가 없습니다.');
      if(id==='time'&&o.family!=='sequence'){const lo=Math.min(p.b/p.a,(p.b+1)/p.a)-2/Math.abs(p.a),hi=Math.max(p.b/p.a,(p.b+1)/p.a)+2/Math.abs(p.a);if(lo < -10000 || hi > 10000){s.numeric=null;s.numericDirty=false;s.numericUnsupported=true;s.numericError='이 시간좌표범위 수치그래프 미지원: 표시 범위가 −10000~10000 s를 벗어납니다. 입력과 기호답은 유지됩니다.';s.numericOpen=true;render();return;}}
      s.numericUnsupported=false;s.numeric=p;s.numericDirty=false;s.numericError='';if(reveal)s.numericOpen=true;s.cursor=id==='convolution'?(o.family==='rect'?Math.min(p.T1,p.T2):o.family==='sequence'?p.output.start:o.family==='custom'?0:1/Math.min(p.a,p.b)):0;render();
    }catch(error){s.numericUnsupported=false;s.numericDirty=true;s.numericError=error.message;s.numericOpen=true;render();}
  }
  function invalidateNumeric() {
    const s=current();
    stopPlayback();s.numeric=null;s.numericUnsupported=false;s.numericDirty=true;s.numericError='';syncInputStatus();
  }
  function switchFamily(family) {
    // Keep the complete applied/draft state, not just strings that would be auto-applied.
    const {familyStates,...saved}=current();
    familyStates[saved.options.family]=saved;
    const next=familyStates[family]||{...makeState(id),options:{...saved.options,family}};
    states.set(id,{...next,familyStates});
  }
  function onInput(event) {
    if(!active||destroyed)return;const t=event.target,s=current();
    if(t.hasAttribute?.('data-signals-snippet-target')){if(['xExpression','hExpression'].includes(t.value))s.snippetTarget=t.value;return;}
    if(t.hasAttribute?.('data-signals-speed')){stopPlayback();s.speed=Number(t.value);renderNumeric();return;}
    if(t.hasAttribute?.('data-signals-cursor')){stopPlayback();if(s.numeric&&!s.numericDirty){s.cursor=Number(t.value);renderNumeric();}return;}
    if(t.dataset?.signalsControl){
      const c=lessonControls(id).find(c=>c.key===t.dataset.signalsControl);
      if(!c?.choices.some(v=>v.value===t.value)||s.options[c.key]===t.value)return;
      stopPlayback();
      if(c.key==='family')switchFamily(t.value);
      else {
        s.options[c.key]=t.value;
        // A sign control changes only a's sign; unrelated sequence/offset drafts survive.
        if(id==='time'&&c.key==='sign'){
          try { const a=parseSignalsNumber(s.drafts.a,{min:-100,max:100,integer:s.options.family==='sequence'});
            if(Math.abs(a)>=.01)s.drafts.a=String((t.value==='negative'?-1:1)*Math.abs(a));
          } catch { /* Keep incomplete input visible for correction. */ }
        }
        if(numericFields(id,s.options).length)invalidateNumeric();
      }
      render();return;
    }
    if(t.dataset?.signalsKey){s.inputBackup=null;const undo=host.querySelector('[data-signals-restore-input]');if(undo)undo.disabled=true;const note=host.querySelector('[data-signals-tool-status]');if(note)note.textContent='';s.drafts[t.dataset.signalsKey]=t.value;invalidateNumeric();host.querySelector('[data-signals-numeric-status]').textContent='';host.querySelector('[data-signals-projection]').textContent='수치 조건을 수정했습니다. 예시 계산을 눌러 다시 확인하세요.';}
  }
  function onClick(event){if(!active||destroyed)return;const b=event.target.closest?.('button');if(!b||!host.contains(b)||b.disabled)return;
    const s=current(),inputTools=id==='convolution'&&['custom','sequence'].includes(s.options.family);
    if(inputTools&&b.hasAttribute('data-signals-restore-input')){if(!s.inputBackup)return;s.drafts={...s.inputBackup};s.inputBackup=null;invalidateNumeric();render();return;}
    if(inputTools&&b.hasAttribute('data-signals-swap')){s.inputBackup={...s.drafts};const pairs=s.options.family==='custom'?[['xExpression','hExpression']]:[['x','h'],['xStart','hStart']];for(const[a,c]of pairs)[s.drafts[a],s.drafts[c]]=[s.drafts[c],s.drafts[a]];invalidateNumeric();render();return;}
    if(inputTools&&s.options.family==='custom'&&b.dataset.signalsSnippet){const text=b.dataset.signalsSnippet;if(!['u(t)','rect(t)','exp(-t)','sin(2*pi*t)','cos(2*pi*t)'].includes(text))return;const key=s.snippetTarget,input=host.querySelector('[data-signals-key="'+key+'"]'),value=s.drafts[key],start=input.selectionStart??value.length,end=input.selectionEnd??start,next=value.slice(0,start)+text+value.slice(end);if(next.length>EXPRESSION_LIMITS.length){host.querySelector('[data-signals-tool-status]').textContent=`${EXPRESSION_LIMITS.length}자 이내로 줄인 뒤 넣어 주세요.`;input.focus({preventScroll:true});input.setSelectionRange(start,end);return;}s.inputBackup={...s.drafts};s.drafts[key]=next;invalidateNumeric();render();const replacement=host.querySelector('[data-signals-key="'+key+'"]');replacement.focus({preventScroll:true});replacement.setSelectionRange(start+text.length,start+text.length);return;}
    if(inputTools&&(b.dataset.signalsExpressionExample||b.dataset.signalsSequenceExample))s.inputBackup={...s.drafts};
    if(b.hasAttribute('data-signals-show-graph')){const s=current();if(!s.numeric||s.numericDirty||s.numericError)return;const target=host.querySelector('[data-signals-cursor]');target?.scrollIntoView({block:'center'});target?.focus({preventScroll:true});return;}
    if(b.dataset.signalsSequenceExample){const s=current();if(id!=='convolution'||s.options.family!=='sequence')return;const presets={basic:['1,2,1','1,1'],difference:['1,2,1','1,-1'],average:['1,2,1','0.3333333333333333,0.3333333333333333,0.3333333333333333']},values=presets[b.dataset.signalsSequenceExample];if(!values)return;Object.assign(s.drafts,{x:values[0],h:values[1],xStart:'0',hStart:'0'});invalidateNumeric();render();return;}
    if(b.dataset.signalsJump){const s=current(),d=cursorDomain(id,s.options,s.numeric);if(!d||s.numericDirty||!s.numeric)return;stopPlayback();const target=b.dataset.signalsJump==='first'?d.min:b.dataset.signalsJump==='last'?d.max:0;if(target<d.min||target>d.max)return;s.cursor=s.options.family==='sequence'?Math.round(target):target;renderNumeric();return;}
    if(b.dataset.signalsExpressionExample){stopPlayback();const s=current();s.drafts.xExpression=b.dataset.signalsExpressionExample==='rect'?'u(t)-u(t-2)':'exp(-t)*u(t)';s.drafts.hExpression=b.dataset.signalsExpressionExample==='rect'?'u(t)-u(t-1)':'exp(-t)*u(t)';invalidateNumeric();render();return;}if(b.dataset.signalsPlay){if(b.dataset.signalsPlay==='play'){if(timer!==null)stopPlayback();else startPlayback();}else{stopPlayback();advance(b.dataset.signalsPlay==='previous'?-1:1);}return;}if(b.dataset.signalsLesson){stopPlayback();id=getSignalsLesson(b.dataset.signalsLesson).id;render();}else if(b.hasAttribute('data-signals-reset')){stopPlayback();states.set(id,makeState(id));render();}}
  function onSubmit(event){if(event.target.matches?.('[data-signals-numeric-form]')){event.preventDefault();if(active&&!destroyed)calculate();}}
  function onToggle(event){if(destroyed||!host.contains(event.target))return;if(event.target.hasAttribute?.('data-signals-solution'))current().solutionOpen=event.target.open;if(event.target.hasAttribute?.('data-signals-numeric-details'))current().numericOpen=event.target.open;}
  host.addEventListener('input',onInput);host.addEventListener('click',onClick);host.addEventListener('submit',onSubmit);host.addEventListener('toggle',onToggle,true);doc.addEventListener('visibilitychange',onVisibility);win.addEventListener('blur',onBlur);motion?.addEventListener?.('change',onMotion);host.hidden=true;host.inert=true;
  // Lazy first render: the initial lesson is computed/rendered on first activate()/inspect(), not at construction.
  let rendered=false;const ensureRendered=()=>{if(!rendered&&!destroyed){rendered=true;render();}};
  return {
    activate(){if(destroyed)return;ensureRendered();active=true;host.hidden=false;host.inert=false;},
    deactivate(){if(destroyed)return;stopPlayback();active=false;host.hidden=true;host.inert=true;},
    inspect(){if(destroyed)return{active:false,destroyed:true,lessonId:id};ensureRendered();const s=current();return JSON.parse(JSON.stringify({active,destroyed,lessonId:id,options:s.options,drafts:s.drafts,status:'supported',numericStatus:s.numericUnsupported?'unsupported':s.numericDirty?(s.numericError?'invalid':'draft'):s.numeric?'valid':'not-run',numeric:s.numericDirty?null:s.numeric,numericError:s.numericError,cursor:s.cursor,playing:timer!==null,symbolic:evaluateSignalsLesson(id,s.options)}));},
    destroy(){if(destroyed)return;stopPlayback();active=false;host.hidden=true;host.inert=true;host.removeEventListener('input',onInput);host.removeEventListener('click',onClick);host.removeEventListener('submit',onSubmit);host.removeEventListener('toggle',onToggle,true);doc.removeEventListener('visibilitychange',onVisibility);win.removeEventListener('blur',onBlur);motion?.removeEventListener?.('change',onMotion);host.replaceChildren();states.clear();destroyed=true;}
  };
}
