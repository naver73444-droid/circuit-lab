import { preserveCourseFocus } from './course-focus.js';
import { EXPERIMENTS, getExperiment, COURSE_ROADMAP } from './em-course-registry.js';
import { createCourseView, createRadialProfileView } from './em-course-view.js';
import { inductionAfterStructural, inductionAfterNumeric, inductionNumericReason } from './course-illustration-contract.js';
import { renderSymbolic } from './course-symbolic-view.js';
import { appendCourseMath } from './course-math-view.js';
import { plainText, siComplex, siText, siVector } from './em-format.js';

const statusLabel = { valid: '유효', singular: '특이점', boundary: '경계', invalid: '입력 오류', unsupported: '지원 범위 밖' };
const format = plainText;
const list = (parent, values) => { parent.replaceChildren(); for (const text of values || []) { const item = document.createElement('li'); item.textContent = String(text); parent.append(item); } };

export function createEMCourseController(root, { onClose } = {}) {
  const events = new AbortController(), listen = { signal: events.signal }, records = new Map();
  let active = false, selectedId = EXPERIMENTS.find(d=>d.id==='coax-current')?.id || EXPERIMENTS[0]?.id;
  root.innerHTML = `<div class="em-course-shell">
    <header class="em-course-header"><div><strong>대학 전자기학 실험실</strong><p>모델의 가정과 범위를 확인하고, 측정점을 옮겨 비교하세요.</p></div><label>실험 선택<select id="em-course-select"></select></label><button id="em-course-back" type="button">2D 자유실험실로 돌아가기</button></header>
    <div class="em-course-layout">
      <section class="em-course-controls"><p id="em-course-kind" class="em-course-badge"></p><p id="em-course-description"></p>
        <form id="em-course-form"><button id="em-course-start-problem" type="button">내 문제 수치로 시작</button><details id="em-course-problem-settings"><summary>문제 메모 · 지원 범위</summary><label>문제 설명 메모<textarea id="em-course-question" rows="3" placeholder="문제 설명을 메모하고, 선택한 실험의 수치·조건을 아래에 직접 입력하세요."></textarea></label><p>계산은 선택한 실험 모델과 입력 수치로 합니다. 문장·사진 자동해석이나 임의 형상 해석은 지원하지 않습니다.</p></details><fieldset><legend>문제의 수치 · 모델 조건</legend><div id="em-course-parameters"></div></fieldset>
        <fieldset><legend>측정점 (m)</legend><div class="em-course-probe-grid">${['x','y','z'].map((axis,i)=>`<label>${axis}<input data-em-course-probe="${i}" inputmode="decimal" value="0"></label>`).join('')}</div></fieldset>
        <div class="em-course-actions"><button class="primary" type="submit">입력 적용</button><button id="em-course-reset" type="button">기본값</button></div></form>
        <p id="em-course-input-note" hidden>미적용 입력이 있습니다. 측정값은 마지막 적용 기준입니다.</p><p id="em-course-error" role="alert" hidden></p><details><summary>가정 · 범위 · 특이점</summary><strong>가정</strong><ul id="em-course-assumptions"></ul><strong>유효 범위</strong><ul id="em-course-validity"></ul><strong>특이점·경계</strong><ul id="em-course-singularities"></ul></details>
      </section>
      <section class="em-course-stage"><div class="em-course-stage-heading"><strong id="em-course-title"></strong><span id="em-course-quick-check"></span><label>표시 벡터<select id="em-course-vector"></select></label></div><p id="em-course-gesture">빈 곳을 클릭하거나 끌어 측정점을 이동하세요.</p>
        <div class="em-course-actions"><button id="em-course-zoom-in" type="button">확대</button><button id="em-course-zoom-out" type="button">축소</button><button id="em-course-zoom-reset" type="button">보기 초기화</button></div><canvas id="em-course-canvas" aria-label="전자기학 실험의 측정점과 장 방향" tabindex="0"></canvas><p id="em-course-region"></p><details open><summary>해석식 · 비교 기준</summary><div id="em-course-formulas"></div></details>
      </section>
      <aside class="em-course-results"><div class="em-course-result-heading"><strong>측정값 · SI</strong><span id="em-course-status"></span></div><section class="em-course-answer"><label>구할 값<select id="em-course-requested"></select></label><output id="em-course-answer" aria-live="polite"></output><details><summary>SI 변환 · 식 대입</summary><p id="em-course-substitution"></p><p>아래 해석식과 가정에 입력한 값을 대입한 결과입니다. 부호와 전위·위상 기준을 확인하세요.</p></details></section><div class="em-course-result-heading"><strong>수치 검증</strong><button id="em-course-verify" type="button">검증 실행</button></div><p id="em-course-check-summary"></p><dl id="em-course-values"></dl><ul id="em-course-notes"></ul>
        <details><summary>수치 검증 상세 · 방법/오차</summary><div id="em-course-checks"></div></details><details><summary>근거 자료</summary><ul id="em-course-references"></ul></details>
      </aside>
    </div><details class="em-course-roadmap"><summary>학부 과정 범위 · 구현/예정 상태</summary><div id="em-course-roadmap-items"></div></details>
  </div>`;
  const $ = selector => root.querySelector(selector);

  root.querySelector('.em-course-header strong').textContent='전자기학 · 장과 기호 풀이';
  root.querySelector('.em-course-header p').textContent='조건을 고르고, 관측점을 움직이며 적용되는 식을 확인하세요.';
  const numericPanel=document.createElement('details');numericPanel.id='em-course-numeric-results';
  const numericSummary=document.createElement('summary');numericSummary.textContent='선택 수치 · SI 값 · 검증';numericPanel.append(numericSummary);
  const results=root.querySelector('.em-course-results');while(results.firstChild)numericPanel.append(results.firstChild);
  const symbolicPanel=document.createElement('section');symbolicPanel.className='em-course-symbolic-panel';
  symbolicPanel.innerHTML='<h3>문자의 조건으로 풀기</h3><div id="em-course-symbolic-controls"></div><div id="em-course-active-branch" aria-live="polite"></div><div id="em-course-symbolic"></div>';
  results.append(symbolicPanel,numericPanel);
  const illustration=document.createElement('details');illustration.id='em-course-illustration';
  const illustrationSummary=document.createElement('summary');illustrationSummary.textContent='선택 수치로 시각화 · 입력';illustration.append(illustrationSummary);
  const controls=root.querySelector('.em-course-controls');controls.parentNode.removeChild(controls);illustration.append(controls);
  const stage=root.querySelector('.em-course-stage');stage.append(illustration);
  const visual=document.createElement('div');visual.className='em-course-visual-controls';visual.innerHTML='<label><input id="em-course-show-vectors" type="checkbox" checked>벡터 방향</label><label><input id="em-course-show-lines" type="checkbox" checked>대칭 장선</label><label>표시 밀도<input id="em-course-density" type="range" min="3" max="10" value="7"></label><label id="em-course-normalize-label"><input id="em-course-normalize" type="checkbox" checked>r/a · B/B₀</label><p>표시 밀도와 화살표 길이는 물리적 세기를 바꾸지 않습니다.</p>';
  stage.insertBefore(visual,$('#em-course-canvas'));
  const radial=document.createElement('canvas');radial.id='em-course-radial-canvas';radial.tabIndex=0;radial.setAttribute('aria-label','동축 반경별 자기장 그래프: 드래그하면 관측 반경 이동');
  stage.insertBefore(radial,$('#em-course-region'));
  const context=document.createElement('p');context.id='em-course-illustration-context';stage.insertBefore(context,$('#em-course-canvas'));
  $('#em-course-formulas').parentElement.open=false;
  $('#em-course-start-problem').textContent='내 수치 예시 입력';


  const catalog=document.createElement('details');catalog.id='em-course-catalog';
  const catalogSummary=document.createElement('summary');catalogSummary.textContent='다른 문제 선택';catalog.append(catalogSummary);
  const topicLabel=document.createElement('label');topicLabel.textContent='분야';const topic=document.createElement('select');topic.id='em-course-topic';topicLabel.append(topic);catalog.append(topicLabel);
  const header=root.querySelector('.em-course-header');catalog.append(header.querySelector('label'));header.append(catalog);
  // Navigation belongs outside the folded example picker and remains reachable when scrolling.
  const navigation=document.createElement('nav');navigation.className='em-course-navigation';navigation.setAttribute('aria-label','전자기학 예제 탐색');
  const back=$('#em-course-back');back.textContent='← 자유실험실';navigation.append(back);
  const listButton=document.createElement('button');listButton.id='em-course-list';listButton.type='button';listButton.textContent='예제 목록';listButton.setAttribute('aria-controls','em-course-catalog');listButton.setAttribute('aria-expanded','false');navigation.append(listButton);
  const navigationStyle=document.createElement('style');navigationStyle.textContent='#em-course-root .em-course-navigation{position:sticky;top:0;z-index:20;display:flex;flex:0 0 auto;gap:8px;padding:8px;background:var(--panel,#172332);border:1px solid var(--line,#536478);border-radius:10px;box-shadow:0 3px 8px #0003}#em-course-root .em-course-navigation button{min-height:44px;padding:8px 14px;font-weight:600}#em-course-root .em-course-navigation #em-course-back{border-color:var(--accent,#b7a261)}#em-course-root .em-course-header{scroll-margin-top:72px}@media(max-width:520px){#em-course-root .em-course-navigation button{flex:1;min-width:0;padding:8px;font-size:14px}}';
  root.querySelector('.em-course-shell').prepend(navigationStyle,navigation);
  listButton.addEventListener('click',()=>{catalog.open=true;header.scrollIntoView({block:'start'});$('#em-course-select').focus({preventScroll:true});},listen);
  catalog.addEventListener('toggle',()=>listButton.setAttribute('aria-expanded',String(catalog.open)),listen);
  const questionTitle=header.querySelector('strong');questionTitle.id='em-course-question-title';header.querySelector('p').id='em-course-question-intro';
  symbolicPanel.querySelector('h3').textContent='현재 답';
  const conditions=document.createElement('details');conditions.id='em-course-condition-settings';const conditionSummary=document.createElement('summary');conditionSummary.textContent='문제 조건 바꾸기';conditions.append(conditionSummary,$('#em-course-symbolic-controls'));
  const solution=document.createElement('details');solution.id='em-course-solution';const solutionSummary=document.createElement('summary');solutionSummary.textContent='풀이 보기';solution.append(solutionSummary,$('#em-course-symbolic'));
  symbolicPanel.append(solution,conditions);
  const advanced=document.createElement('details');advanced.id='em-course-advanced';const advancedSummary=document.createElement('summary');advancedSummary.textContent='그래프 · 수치 · 표시 설정';advanced.append(advancedSummary);
  const displaySettings=document.createElement('details');displaySettings.id='em-course-view-settings';const displaySummary=document.createElement('summary');displaySummary.textContent='표시 설정';displaySettings.append(displaySummary,visual,$('#em-course-vector').parentElement,$('#em-course-zoom-in').parentElement);
  const graphPanel=document.createElement('details');graphPanel.id='em-course-graph-panel';const graphSummary=document.createElement('summary');graphSummary.textContent='B(r) 그래프';graphPanel.append(graphSummary,radial);
  advanced.append(graphPanel,illustration,numericPanel,displaySettings,context,$('#em-course-region'),$('#em-course-formulas').parentElement,root.querySelector('.em-course-roadmap'));
  results.append(advanced);$('#em-course-quick-check').hidden=true;
  const radiusControl=document.createElement('div');radiusControl.id='em-course-radius-control';radiusControl.innerHTML='<label for="em-course-radius">관측 반경 <span>형상 예시</span></label><input id="em-course-radius" type="range" min="0" max="4.5" step="0.01" value="2" aria-label="동축 관측 반경 r/a"><div class="em-course-radius-footer"><output id="em-course-radius-value"></output><button id="em-course-probe-reset" type="button">관측점 초기화</button></div>';
  stage.insertBefore(radiusControl,$('#em-course-canvas').nextSibling);

  const groupName=id=>id.startsWith('gauss-')?'가우스법칙':id.startsWith('wave-')?'파동·반사':id.startsWith('transmission-')?'전송선':['faraday-loop','motional-rod'].includes(id)?'자기유도':['dielectric-interface','layered-plate'].includes(id)?'유전체·경계':(id.startsWith('coax-current')||['wire-current','loop-axis','ampere-wire'].includes(id))?'정자계·암페어':'정전계·정전용량';
  for (const item of COURSE_ROADMAP) { const p = document.createElement('p'); p.textContent = `${item.status === 'implemented' ? '구현' : '미지원/예정'} · ${item.title}: ${item.description}`; $('#em-course-roadmap-items').append(p); }

  for(const name of new Set(EXPERIMENTS.map(d=>groupName(d.id)))){const option=document.createElement('option');option.value=name;option.textContent=name;topic.append(option);}
  function refreshProblemChoices(name=groupName(selectedId)){
    topic.value=name;const select=$('#em-course-select');select.replaceChildren();
    const choices=EXPERIMENTS.filter(d=>groupName(d.id)===name);
    if(!choices.some(d=>d.id===selectedId)){const blank=document.createElement('option');blank.value='';blank.textContent='문제를 선택하세요';select.append(blank);}
    for(const def of choices){const option=document.createElement('option');option.value=def.id;option.textContent=def.title;select.append(option);}select.value=choices.some(d=>d.id===selectedId)?selectedId:'';
  }
  topic.addEventListener('change',()=>refreshProblemChoices(topic.value),listen);

  const definition = () => getExperiment(selectedId);
  const defaults = def => Object.fromEntries((def.parameters || []).map(item => [item.key, item.initial]));
  const evaluate = (def, params, point) => {
    try { return def.evaluate({ ...params }, [...point]); }
    catch (error) { return { status: 'invalid', reason: error.message, vectors: {}, scalars: [] }; }
  };
  const profiles=(def,params)=>{
    if(typeof def.profile!=='function')return[];
    const output=def.profile({...params},81);
    if(!Array.isArray(output)||output.some(series=>!Array.isArray(series.points)||series.points.length>2048||series.points.some(p=>!Number.isFinite(p.coordinate)||!Number.isFinite(p.value))))throw new TypeError('유한한 profile 표본이 필요합니다.');
    return output;
  };
  const record = () => {
    if (!records.has(selectedId)) { const def = definition(), params = defaults(def), point = [...(def.probeDefault || [1,0,0])]; records.set(selectedId, { params, point, result: evaluate(def,params,point), profiles:profiles(def,params), checks: [], checked: false, checkError: '', error: '', vectorKey: '',drafts:{params:{},points:{}},viewScale:fittedViewScale(def,params),viewScaleManual:false,problemMode:false,problemPending:false,question:'',requestedKey:'',requestedLabel:'',symbolicOptions:Object.fromEntries((def.symbolicControls||[]).map(c=>[c.key,c.initial])),symbolic:null,display:{vectors:false,lines:true,density:4,normalized:true} }); }
    return records.get(selectedId);
  };
  const fittedViewScale = (def, params) => {
    if (def.id !== 'faraday-loop' || !(params.area > 0)) return 1;
    const radius = Math.sqrt(params.area / Math.PI);
    return Math.max(.01, Math.min(100, 2.5 * radius / def.view.extent));
  };
  const view = createCourseView($('#em-course-canvas'), point => {
    if (!active) return;
    const data = record(); data.point = point; data.result = evaluate(definition(),data.params,point);data.drafts.points={};if(!Object.keys(data.drafts.params).length)data.error='';syncProbe(); renderResult();
  });
  const radialView=createRadialProfileView($('#em-course-radial-canvas'),radius=>{
    if(!active)return;const data=record(),old=Math.hypot(data.point[0],data.point[1]),angle=old?Math.atan2(data.point[1],data.point[0]):0;
    data.point=[radius*Math.cos(angle),radius*Math.sin(angle),data.point[2]];data.result=evaluate(definition(),data.params,data.point);data.drafts.points={};syncProbe();renderResult();
  });
  function renderSymbolicDefinition(){
    const def=definition(),data=record(),controls=$('#em-course-symbolic-controls');controls.replaceChildren();
    for(const control of def.symbolicControls||[]){const label=document.createElement('label'),select=document.createElement('select');label.append(document.createTextNode(control.label));select.dataset.emSymbolicControl=control.key;
      for(const choice of control.choices||[]){const option=document.createElement('option');option.value=String(choice.value);option.textContent=choice.label;select.append(option);}select.value=String(data.symbolicOptions[control.key]??control.initial);label.append(select);controls.append(label);}
    try{data.symbolic=typeof def.symbolic==='function'?def.symbolic({...data.symbolicOptions}):{status:'unsupported',title:def.title,reason:'이 모델의 기호 풀이 연결을 준비 중입니다. 수치 예시는 아래에서 확인할 수 있습니다.'};}
    catch(error){data.symbolic={status:'unsupported',title:def.title,reason:'기호 조건을 해석할 수 없습니다: '+error.message};}
    renderSymbolic($('#em-course-symbolic'),data.symbolic);highlightSymbolic();
  }
  function highlightSymbolic(){
    const def=definition(),data=record(),region=data.result?.region,box=$('#em-course-symbolic');
    let activeIndex=(def.symbolicAnswer?.pieces||[]).findIndex(item=>item.region===region);
    if(activeIndex<0)activeIndex=(data.symbolic?.regions||[]).findIndex(item=>item.region===region);
    const isBoundary=['inner-interface','inner-current-sheet','outer-current-sheet','outer-inner-interface','outer-interface'].includes(region),radius=['inner-interface','inner-current-sheet'].includes(region)?'a':region==='outer-interface'?'c':'b';
    const atAxis=def.id.startsWith('coax-current')&&Math.hypot(data.point[0],data.point[1])===0;
    const boundaryIndex=atAxis?(data.symbolic?.boundaries||[]).findIndex(item=>item.condition.replace(/\s/g,'')==='r=0'):isBoundary?(data.symbolic?.boundaries||[]).findIndex(item=>item.condition.replace(/\s/g,'')==='r='+radius):-1;
    box.querySelectorAll('[data-symbolic-region-index]').forEach(node=>{node.dataset.active=String(Number(node.dataset.symbolicRegionIndex)===activeIndex);});
    box.querySelectorAll('[data-symbolic-boundary-index]').forEach(node=>{node.dataset.active=String(Number(node.dataset.symbolicBoundaryIndex)===boundaryIndex);});
    if(def.id.startsWith('coax-current')&&data.symbolicOptions.innerMode===1&&data.symbolicOptions.outerMode===1){box.querySelectorAll('[data-active]').forEach(n=>n.dataset.active='false');$('#em-course-active-branch').textContent='이 조합은 기호 풀이만 제공합니다. 수치 관측점 연동은 표시하지 않습니다.';return;}
    const chosen=isBoundary||atAxis?data.symbolic?.boundaries?.[boundaryIndex]:data.symbolic?.regions?.[activeIndex];
    const direction=data.result?.vectors?.B,zero=direction&&direction.every(v=>v===0);
    const answer=$('#em-course-active-branch');
    if(data.symbolic?.status!=='supported'){answer.textContent=data.symbolic?.reason||'이 조건의 답은 지원하지 않습니다.';return;}
    answer.replaceChildren();
    const note=text=>{const p=document.createElement('p');p.textContent=text;answer.append(p);};
    if(chosen){const formulas=def.id.startsWith('coax-current')?chosen.formula.split(';').map(t=>t.trim()).filter(t=>/^B/.test(t)):chosen.formula.split(';').slice(0,2);
      note(chosen.condition);appendCourseMath(answer,formulas.length?formulas.join('\n'):chosen.formula);
      if(def.id.startsWith('coax-current'))note(zero?'방향 없음 (B=0)':isBoundary?'표면의 안쪽·바깥쪽 극한':data.params.current<0?'I<0: −φ · 시계':'I>0: +φ · 반시계');
    }else{const answers=data.symbolic.answers||[],primary=['faraday-loop','motional-rod'].includes(def.id)?answers.filter(a=>/^ΦB|^ℰ(?:\(|$)/.test(a.quantity)):answers.slice(0,2);for(const item of primary){appendCourseMath(answer,item.formula);if(item.direction)note(item.direction);}}
    const numericReason=inductionNumericReason(def.id,data.symbolicOptions);if(numericReason)note(numericReason);
    if(['wire-current','loop-axis'].includes(def.id)){
      if(data.params.current===0&&zero)answer.textContent='I=0인 수치 예시: B=H=0\n방향 없음. 일반 문자식은 풀이 보기에서 확인하세요.';
      else note('수치 예시 I='+data.params.current+' A: '+(def.id==='loop-axis'?(data.params.current<0?'−z':'+z'):(data.params.current<0?'−φ · 시계':'+φ · 반시계')));
    }

  }
  function syncProbe() { const def = definition(), data = record(); root.querySelectorAll('[data-em-course-probe]').forEach((input,i) => { input.value = data.drafts.points[i]??Number(data.point[i].toPrecision(7)); input.disabled = ['axis-only','profile'].includes(def.view?.kind) && i !== 2; }); }
  function showError(message) { $('#em-course-error').hidden = !message; $('#em-course-error').textContent = message; }
  function renderAnswer(){
    const data=record(),result=data.result,items=[],units={E:'V/m',D:'C/m²',B:'T',H:'A/m'};
    for(const [key,v] of Object.entries(result.vectors||{}))if(Array.isArray(v)&&v.every(Number.isFinite)){items.push({key:'vector:'+key,label:key+' 벡터',text:`${key}=${siVector(v,units[key]||'')}`});items.push({key:'magnitude:'+key,label:'|'+key+'| 크기',text:`|${key}|=${siText(Math.hypot(...v),units[key]||'')}`});}
    for(const s of result.scalars||[])if(Number.isFinite(s.value))items.push({key:'scalar:'+s.key,label:s.label,text:`${s.label}=${siText(s.value,s.unit||'')}`});
    for(const p of result.phasors||[])if(Number.isFinite(p.re)&&Number.isFinite(p.im))items.push({key:'phasor:'+p.key,label:p.label+' 위상자',text:`${p.label}=${siComplex(p.re,p.im,p.unit||'',{polar:false})} · ${p.reference||''}`});
    if(!data.requestedKey&&items.length){const first=items.find(i=>i.key==='phasor:voltage')||items[0];data.requestedKey=first.key;data.requestedLabel=first.label;}
    const select=$('#em-course-requested');select.replaceChildren();
    for(const item of items){const option=document.createElement('option');option.value=item.key;option.textContent=item.label;select.append(option);}
    let item=items.find(i=>i.key===data.requestedKey);
    if(data.requestedKey&&!item){const option=document.createElement('option');option.value=data.requestedKey;option.textContent=data.requestedLabel+' · 유한 단일값 없음';select.append(option);}
    select.value=data.requestedKey;
    const infinity=data.requestedKey==='scalar:swr'&&(result.notes||[]).some(n=>n.includes('SWR')&&n.includes('무한'));
    $('#em-course-answer').textContent=data.numericIllustrationSupported===false?'이 구조 조건은 기호 풀이만 표시합니다. 일치하는 수치 모델이 연결되지 않았습니다.':data.problemMode&&data.problemPending?'필요한 수치·조건을 입력하고 적용하세요. 아직 문제의 답을 표시하지 않습니다.':item?item.text:infinity?'SWR = ∞ (완전반사 · 유한 숫자 없음)':`요청한 값은 이 위치/모델에서 유한 단일값으로 표시할 수 없습니다. ${result.reason||''}`;
    $('#em-course-substitution').textContent=data.problemMode&&data.problemPending?'입력 조건 미완성':(definition().parameters||[]).map(p=>`${p.label}: ${siText(data.params[p.key],p.unit)}`).join(' · ')+` · 측정점 ${siVector(data.point,'m')}`;
  }
  function runChecks() {
    const def = definition(), data = record(); data.checkError = '';
    if(data.numericIllustrationSupported===false||data.problemMode&&data.problemPending){renderChecks();return;}
    try { data.checks = typeof def.verify === 'function' ? def.verify({ ...data.params }) : []; if (!Array.isArray(data.checks)) throw new TypeError('검증 결과 형식 오류'); data.checked = true; }
    catch (error) { data.checks = []; data.checked = false; data.checkError = error.message; }
    renderChecks();
  }
  function renderChecks() {
    const data = record(), container = $('#em-course-checks'); container.replaceChildren();
    if(data.numericIllustrationSupported===false){$('#em-course-check-summary').textContent='선택한 기호 조건의 수치 모델은 연결되지 않았습니다.';$('#em-course-quick-check').textContent='기호 풀이만';$('#em-course-quick-check').dataset.status='skipped';return;}
    if(data.problemMode&&data.problemPending){$('#em-course-check-summary').textContent='문제 조건 입력 후 검증합니다.';$('#em-course-quick-check').textContent='문제 입력 중';$('#em-course-quick-check').dataset.status='skipped';return;}
    const passed = data.checks.filter(row => row.status === 'pass').length, failed = data.checks.filter(row => row.status === 'fail').length;
    $('#em-course-check-summary').textContent = data.checkError ? '검증 오류: ' + data.checkError : data.checked ? `${passed} 통과 · ${failed} 실패 · ${data.checks.length-passed-failed} 미판정 (마지막 적용된 모델 입력 기준)` : '아직 실행하지 않았습니다. 검증 실행으로 현재 입력을 확인하세요.';
    $('#em-course-quick-check').textContent=data.checkError?'검증 오류':data.checked?`검증 ${passed} 통과 · ${failed} 비교불일치 · ${data.checks.length-passed-failed} 미판정`:'검증 전';
    $('#em-course-quick-check').dataset.status=data.checkError||failed?'fail':data.checked&&data.checks.length&&passed===data.checks.length?'pass':'skipped';
    for (const row of data.checks) {
      const block = document.createElement('div'); block.className = 'em-course-check'; block.dataset.status = row.status;
      const title = document.createElement('strong'); title.textContent = `${row.status === 'pass' ? 'PASS' : row.status === 'fail' ? '비교 불일치' : ['unconverged','inconclusive'].includes(row.status)?'수치 미수렴/미판정':'미판정/범위 제외'} · ${row.label}`;
      const numbers = document.createElement('p'); numbers.textContent = `수치 ${siText(row.actual,row.unit||'')} / 기준 ${siText(row.expected,row.unit||'')}`;
      const detail = document.createElement('p'); detail.textContent = [row.method, row.reason, `허용오차 abs ${row.absTolerance ?? '—'} / rel ${row.relTolerance ?? '—'}`].filter(Boolean).join(' · ');
      block.append(title,numbers,detail); container.append(block);
    }
  }
  function renderResult() {
    const def = definition(), data = record(), result = data.result || { status: 'invalid' }, values = $('#em-course-values'); values.replaceChildren();
    $('#em-course-status').textContent = statusLabel[result.status] || result.status; $('#em-course-status').dataset.status = result.status;
    $('#em-course-region').textContent = [result.region && '측정 영역: ' + result.region, result.reason].filter(Boolean).join(' · ');
    const addValue = (label,value) => { const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;values.append(dt,dd); };
    const pending=data.problemMode&&data.problemPending,unpicturedCoax=def.id.startsWith('coax-current')&&data.symbolicOptions.innerMode===1&&data.symbolicOptions.outerMode===1,unmappedParameterChoice=(def.symbolicControls||[]).some(c=>{const p=def.parameters.find(p=>p.key===c.key),v=data.symbolicOptions[c.key];return p&&typeof v==='number'&&(p.min!==undefined&&v<p.min||p.max!==undefined&&v>p.max);}),inductionReason=inductionNumericReason(def.id,data.symbolicOptions),unpicturedModel=unpicturedCoax||unmappedParameterChoice||Boolean(inductionReason);data.numericIllustrationSupported=!unpicturedModel;$('#em-course-illustration').hidden=Boolean(inductionReason);
    const units = { E:'V/m',D:'C/m²',B:'T',H:'A/m' }, keys = [];
    if (result.status === 'valid') {
      for (const [key,vector] of Object.entries(result.vectors || {})) { if (!Array.isArray(vector) || !vector.every(Number.isFinite)) continue; keys.push(key); addValue(`${key} (x, y, z)`,siVector(vector,units[key] || '')); addValue(`|${key}|`,siText(Math.hypot(...vector),units[key] || '')); }
    } else addValue('계산 상태', result.reason || '이 측정 위치에서는 장을 표시하지 않습니다.');
    // Boundary results may carry finite one-sided limits or a continuous potential.
    for(const item of result.scalars || [])if(Number.isFinite(item.value))addValue(item.label || item.key,siText(item.value,item.unit || ''));
    for(const phasor of result.phasors || [])if(Number.isFinite(phasor.re)&&Number.isFinite(phasor.im)){
      addValue(`${phasor.label} · 복소/극형`,siComplex(phasor.re,phasor.im,phasor.unit || ''));
    }
    const references=[...new Set((result.phasors || []).map(p=>p.reference).filter(Boolean))];
    const vectorSelect = $('#em-course-vector'), choices = keys.length ? keys : [''];
    vectorSelect.disabled=!keys.length||definition().view?.kind==='profile';$('#em-course-show-lines').disabled=!def.id.startsWith('coax-current')&&def.view?.kind!=='azimuthal';
    if ([...vectorSelect.options].map(o=>o.value).join() !== choices.join()) { vectorSelect.replaceChildren(); for (const key of choices) { const option=document.createElement('option');option.value=key;option.textContent=key||'벡터 없음';vectorSelect.append(option); } }
    if (!choices.includes(data.vectorKey)) data.vectorKey=choices[0];vectorSelect.value=data.vectorKey;
    list($('#em-course-notes'),[...(result.notes || []),...references.map(r=>'위상자 기준: '+r)]);showError(data.error);
    $('#em-course-input-note').hidden=!Object.keys(data.drafts.params).length&&!Object.keys(data.drafts.points).length;
    $('#em-course-values').hidden=pending||unpicturedModel;$('#em-course-canvas').hidden=pending||unpicturedModel;$('#em-course-verify').disabled=pending||unpicturedModel;$('#em-course-status').textContent=unpicturedModel?'수치 시현 미연결':pending?'문제 입력 중':statusLabel[result.status]||result.status;
    renderAnswer();highlightSymbolic();
    const coax=def.id.startsWith('coax-current');radiusControl.hidden=!coax||unpicturedModel;graphPanel.hidden=!coax;
    if(coax){const ratio=Math.hypot(data.point[0],data.point[1])/data.params.a;$('#em-course-radius').max=String(Math.max(1,(data.params.c||data.params.b)/data.params.a*1.5));$('#em-course-radius').value=String(ratio);$('#em-course-radius-value').textContent='r/a = '+Number(ratio.toPrecision(3));}
$('#em-course-radial-canvas').hidden=!coax||pending||unpicturedCoax;$('#em-course-normalize-label').hidden=!coax;
    for(const [id,key]of [['em-course-show-vectors','vectors'],['em-course-show-lines','lines'],['em-course-normalize','normalized']])$('#'+id).checked=data.display[key];$('#em-course-density').value=data.display.density;
    $('#em-course-illustration-context').textContent=coax?'형상 예시: b/a='+Number((data.params.b/data.params.a).toPrecision(4))+(data.params.c?' · c/a='+Number((data.params.c/data.params.a).toPrecision(4)):'')+' · B₀=μI/(2πa). 정답은 옆의 문자식이며 이 비율은 시각화 예시입니다.':'수치 예시의 단면입니다. 기호 정답과 가정은 옆 풀이 패널에서 확인하세요.';
    if(unmappedParameterChoice)$('#em-course-illustration-context').textContent='선택한 기호 특수 조건은 옆의 문자식으로 풉니다. 일치하는 수치 모델이 연결되지 않아 그래프와 수치 답을 표시하지 않습니다.';
    if(unpicturedCoax)$('#em-course-illustration-context').textContent='표면 내부 전류 + 두꺼운 외부 귀환의 기호해는 옆에 표시됩니다. 이 조합의 수치 장 모델은 연결되지 않아 단면·그래프를 표시하지 않습니다.';
    const separate=(def.symbolicControls||[]).filter(c=>!def.parameters.some(p=>p.key===c.key)&&data.symbolicOptions[c.key]!==c.initial&&!(['wire-current','loop-axis'].includes(def.id)&&c.key==='direction'));
    if(separate.some(c=>!['faraday-loop','motional-rod'].includes(def.id)||c.key==='normalOrientation')||data.symbolic?.status==='unsupported')$('#em-course-illustration-context').textContent+=' 현재 기호 조건과 수치 그림은 별도입니다. '+separate.map(c=>c.label+': '+(c.choices.find(v=>v.value===data.symbolicOptions[c.key])?.label||'')).join(' · ')+' — 그림은 아래 수치 입력의 예시이며 선택한 특수 조건의 해로 간주하지 마세요.';
    const unresolved=(data.profiles||[]).filter(p=>p.sampling?.status==='unresolved');for(const p of unresolved){const li=document.createElement('li');li.textContent=p.sampling?.reason||p.notes?.join(' ')||'표본 해상도 제한: 이 곡선은 그리지 않습니다.';$('#em-course-notes').append(li);}
    view.update({ definition:def,params:data.params,point:data.point,result,vectorKey:data.vectorKey,viewScale:data.viewScale,profiles:data.profiles,display:data.display });
    radialView.update({definition:def,params:data.params,point:data.point,result,profiles:data.profiles,normalized:data.display.normalized});
  }
  function renderDefinition() {
    const restoreFocus=preserveCourseFocus(root,['data-em-symbolic-control','data-em-course-parameter','data-em-course-probe']);
    const def=definition(),data=record();refreshProblemChoices();$('#em-course-question-title').textContent=def.id.startsWith('coax-current')?'동축 도체의 자기장':def.title;$('#em-course-question-intro').textContent=def.id.startsWith('coax-current')?'내부 +I, 외부 −I. 반경 r에서 자기장은?':def.description||''; $('#em-course-select').value=selectedId;$('#em-course-title').textContent=def.title;$('#em-course-description').textContent=def.description || '';
    $('#em-course-kind').textContent = def.modelKind === 'finite-integration' ? '유한 형상 · 적분 모델' : def.modelKind === 'boundary-solver' ? '경계값 수치해석' : '대칭·가정에 따른 해석 모델';
    $('#em-course-gesture').textContent=def.id==='faraday-loop'?'고정 루프의 수치 예시입니다. 자속·기전력은 루프 전체의 값입니다.':def.id==='motional-rod'?'선택한 시각의 이동 도선입니다. 위치 x₀+vt는 수치 입력으로 바꿉니다.':def.view?.kind==='axis-only'?'축 위의 흰 점을 움직여 답을 확인하세요.':def.view?.kind==='profile'?'그래프에서 관측 위치를 옮겨 답을 확인하세요.':def.id.startsWith('coax-current')?'흰 점을 끌거나 아래 반경을 조절하세요.':'흰 점을 끌어 관측 위치를 바꾸세요.';
    const paramsRoot=$('#em-course-parameters');paramsRoot.replaceChildren();
    for(const item of def.parameters || []) {
      const options=item.key==='control'&&item.min===0&&item.max===1?[[0,'고정 전하 Q'],[1,'고정 전압 V']]:item.key==='closedCircuit'?[[0,'개방 · 기전력만'],[1,'닫힘 · 전류도 계산']]:item.key==='loadMode'?[[0,'복소 부하 R+jX'],[1,'개방'],[2,'단락']]:item.key==='orientation'?[[-1,'시계 방향'],[1,'반시계 방향']]:null;
      const label=document.createElement('label'),text=document.createElement('span'),input=document.createElement(options?'select':'input');
      text.textContent=options?item.label.split(':')[0]:`${item.label} (${item.displayUnit ?? item.unit ?? '무차원'})`;
      input.dataset.emCourseParameter=item.key;input.inputMode='decimal';
      if(options)for(const [value,title] of options){const option=document.createElement('option');option.value=value;option.textContent=title;input.append(option);}
      if(options&&data.problemMode){const blank=document.createElement('option');blank.value='';blank.textContent='조건 선택';input.prepend(blank);}
      input.value=data.drafts.params[item.key]??data.params[item.key]/(item.displayScale || 1);label.append(text,input);paramsRoot.append(label);
    }
    $('#em-course-question').value=data.question;$('#em-course-problem-settings').open=data.problemMode;
    syncProbe();list($('#em-course-assumptions'),def.assumptions);list($('#em-course-validity'),def.validity);list($('#em-course-singularities'),def.singularities);
    const formulas=$('#em-course-formulas');formulas.replaceChildren();for(const item of def.formulas || []){const label=document.createElement('strong');label.className='em-course-formula-label';label.textContent=item.label+(item.unit?' ['+item.unit+']':'');formulas.append(label);appendCourseMath(formulas,item.text);}
    const refs=$('#em-course-references');refs.replaceChildren();for(const ref of def.references || []){const li=document.createElement('li'),a=document.createElement('a');a.textContent=ref.title;try{const url=new URL(ref.url);if(!['https:','http:'].includes(url.protocol))continue;a.href=url.href;a.target='_blank';a.rel='noopener noreferrer';li.append(a);refs.append(li);}catch{ /* invalid reference omitted */ }}
    renderSymbolicDefinition();renderResult();renderChecks();restoreFocus();
  }
  function applyInputs() {
    const def=definition(),data=record(),params={},point=[];
    try {
      const raw=Object.fromEntries([...root.querySelectorAll('[data-em-course-parameter]')].map(input=>[input.dataset.emCourseParameter,input.value.trim()]));
      const unused=key=>key==='resistance'&&raw.closedCircuit==='0'||['parallel-plate','layered-plate'].includes(def.id)&&(key==='voltage'&&raw.control==='0'||key==='charge'&&raw.control==='1')||def.id==='transmission-lossless'&&['1','2'].includes(raw.loadMode)&&['loadResistance','loadReactance'].includes(key);
      for(const item of def.parameters || []){const text=raw[item.key];if(data.problemMode&&unused(item.key)){params[item.key]=0;continue;}const number=Number(text)*(item.displayScale || 1);if(!text||!Number.isFinite(number))throw new Error(item.label+'에 유한한 숫자를 입력하세요.');if(item.min!==undefined&&number<item.min||item.max!==undefined&&number>item.max)throw new Error(item.label+'의 허용 범위를 벗어났습니다.');params[item.key]=number;}
      root.querySelectorAll('[data-em-course-probe]').forEach((input,i)=>{if(['axis-only','profile'].includes(def.view?.kind)&&i!==2){point[i]=0;return;}const text=input.value.trim();if(!text||!Number.isFinite(Number(text)))throw new Error('측정점에 유한한 숫자를 입력하세요.');point[i]=Number(text);});
      const result=evaluate(def,params,point);if(result.status==='invalid')throw new Error(result.reason || '모델 입력이 올바르지 않습니다.');
      const nextProfiles=profiles(def,params);
      const inductionSync=inductionAfterNumeric(def.id,params,data.symbolicOptions,data.illustrationMemory);data.symbolicOptions=inductionSync.options;data.illustrationMemory=inductionSync.memory;
      data.params=params;data.point=point;data.result=result;data.profiles=nextProfiles;if (!data.viewScaleManual) data.viewScale=fittedViewScale(def,params);data.error='';data.problemPending=false;data.drafts={params:{},points:{}};data.checked=false;data.checks=[];if(['wire-current','loop-axis'].includes(def.id))data.symbolicOptions.direction=params.current<0?1:0;for(const control of def.symbolicControls||[])if(control.choices.some(c=>c.value===params[control.key]))data.symbolicOptions[control.key]=params[control.key];renderSymbolicDefinition();renderResult();runChecks();
    } catch(error){data.error=error.message;showError(data.error);}
  }
  $('#em-course-symbolic-controls').addEventListener('change',event=>{
    const key=event.target.dataset.emSymbolicControl;if(!key)return;const def=definition(),data=record(),control=def.symbolicControls.find(c=>c.key===key),choice=control.choices.find(c=>String(c.value)===event.target.value);if(!choice)return;
    data.symbolicOptions[key]=choice.value;
    if(['alignment','fieldRegime','motionRegime'].includes(key)&&['faraday-loop','motional-rod'].includes(def.id)){const synced=inductionAfterStructural(def.id,data.params,data.symbolicOptions,key,data.illustrationMemory);data.params=synced.params;data.illustrationMemory=synced.memory;data.result=evaluate(def,data.params,data.point);data.profiles=profiles(def,data.params);delete data.drafts.params[{alignment:'theta',fieldRegime:'omega',motionRegime:'velocity'}[key]];data.checked=false;data.checks=[];}
    // These current templates use a magnitude; preserve the example's magnitude
    // while aligning its signed current with the selected physical direction.
    if(['wire-current','loop-axis'].includes(def.id)&&key==='direction'){
      data.params={...data.params,current:(choice.value===1?-1:1)*Math.abs(data.params.current)};
      data.result=evaluate(def,data.params,data.point);data.profiles=profiles(def,data.params);
      delete data.drafts.params.current;data.checked=false;data.checks=[];
    }
    if(def.id.startsWith('coax-current')){
      const options={...data.symbolicOptions},targetId=options.innerMode===1&&options.outerMode===1?null:options.outerMode===1?'coax-current-thick':options.innerMode===1?'coax-current-surface':'coax-current';
      if(targetId&&targetId!==selectedId){const oldParams={...data.params},oldPoint=[...data.point];selectedId=targetId;const target=record(),next=definition();target.symbolicOptions=options;target.params={...target.params,...Object.fromEntries(next.parameters.filter(p=>oldParams[p.key]!==undefined).map(p=>[p.key,oldParams[p.key]]))};target.point=oldPoint;target.result=evaluate(next,target.params,target.point);target.profiles=profiles(next,target.params);target.checked=false;target.checks=[];renderDefinition();return;}
    }
    if(def.parameters.some(p=>p.key===key&&(p.min===undefined||choice.value>=p.min)&&(p.max===undefined||choice.value<=p.max))&&typeof choice.value==='number'){data.params={...data.params,[key]:choice.value};data.result=evaluate(def,data.params,data.point);data.profiles=profiles(def,data.params);delete data.drafts.params[key];data.checked=false;data.checks=[];}
    renderDefinition();
  },listen);
  for(const [id,key]of [['em-course-show-vectors','vectors'],['em-course-show-lines','lines'],['em-course-normalize','normalized'],['em-course-density','density']])$('#'+id).addEventListener('input',event=>{record().display[key]=key==='density'?Number(event.target.value):event.target.checked;renderResult();},listen);
  $('#em-course-form').addEventListener('submit',event=>{event.preventDefault();applyInputs();},listen);
  $('#em-course-form').addEventListener('input',event=>{
    const data=record(),element=event.target;
    if(element.id==='em-course-question'){data.question=element.value;return;}
    if(element.dataset.emCourseParameter)data.drafts.params[element.dataset.emCourseParameter]=element.value;
    else if(element.dataset.emCourseProbe!==undefined)data.drafts.points[element.dataset.emCourseProbe]=element.value;
    $('#em-course-input-note').hidden=false;
    if(data.problemMode){data.problemPending=true;renderResult();}
  },listen);
  $('#em-course-start-problem').addEventListener('click',()=>{const data=record();data.problemMode=true;data.problemPending=true;data.drafts={params:Object.fromEntries(definition().parameters.map(p=>[p.key,''])),points:{0:'',1:'',2:''}};if(['axis-only','profile'].includes(definition().view?.kind)){data.drafts.points[0]='0';data.drafts.points[1]='0';}data.error='';renderDefinition();},listen);
  $('#em-course-requested').addEventListener('change',()=>{const data=record(),select=$('#em-course-requested');data.requestedKey=select.value;data.requestedLabel=select.selectedOptions[0]?.textContent||'';renderAnswer();},listen);
  $('#em-course-select').addEventListener('change',()=>{if(!$('#em-course-select').value)return;catalog.open=false;selectedId=$('#em-course-select').value;renderDefinition();listButton.focus({preventScroll:true});},listen);
  $('#em-course-vector').addEventListener('change',()=>{record().vectorKey=$('#em-course-vector').value;renderResult();},listen);
  $('#em-course-reset').addEventListener('click',()=>{records.delete(selectedId);renderDefinition();runChecks();},listen);
  $('#em-course-verify').addEventListener('click',runChecks,listen);
  for(const [id,factor] of [['em-course-zoom-in',.75],['em-course-zoom-out',4/3],['em-course-zoom-reset',null]])$('#'+id).addEventListener('click',()=>{const data=record(),next=factor?data.viewScale*factor:fittedViewScale(definition(),data.params);if(next>=.01&&next<=100){data.viewScale=next;data.viewScaleManual=Boolean(factor);renderResult();}},listen);

  $('#em-course-radius').addEventListener('input',event=>{const data=record(),r=Number(event.target.value)*data.params.a,old=Math.hypot(data.point[0],data.point[1]),angle=old?Math.atan2(data.point[1],data.point[0]):0;data.point=[r*Math.cos(angle),r*Math.sin(angle),data.point[2]];data.result=evaluate(definition(),data.params,data.point);data.drafts.points={};syncProbe();renderResult();},listen);
  $('#em-course-probe-reset').addEventListener('click',()=>{const data=record();data.point=[...definition().probeDefault];data.result=evaluate(definition(),data.params,data.point);data.drafts.points={};syncProbe();renderResult();},listen);
  for(const panel of [advanced,graphPanel])panel.addEventListener('toggle',()=>{if(panel.open)renderResult();},listen);

  $('#em-course-back').addEventListener('click',()=>{onClose?.();root.ownerDocument.getElementById('em-course-open')?.focus();},listen);
  renderDefinition();
  return { activate(){active=true;view.activate();radialView.activate();renderResult();},deactivate(){active=false;view.deactivate();radialView.deactivate();},inspect(){return structuredClone({active,selectedId,records:Object.fromEntries(records),view:view.inspect(),radialView:radialView.inspect()});},destroy(){events.abort();view.destroy();radialView.destroy();active=false;} };
}
