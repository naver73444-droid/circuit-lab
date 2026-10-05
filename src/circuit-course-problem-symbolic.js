// Validated symbolic templates for supported ideal AC topologies; not a general CAS.
const names = { symbolR:'R', symbolL:'L', symbolC:'C', symbolOmega:'ω', symbolVoltage:'V', symbolZ:'Z', symbolP:'P', symbolQ:'Q', symbolPF:'pf_t' };
const fixedSymbolNames = new Map([
  ['j','허수단위'],['e','자연상수'],['t','시간'],['π','원주율'],
  ...['S','PF','Y','Ia','Ib','Ic','Iab','Ica','Van','Vbn','Vcn','Vab','V_RMS','Z_eq','Y_eq','C_each'].map(name=>[name,'풀이의 고정 결과 기호'])
]);
const symbolRoles = {V:'symbolVoltage',I:'symbolCurrent',R:'symbolR',L:'symbolL',C:'symbolC',Z:'symbolZ',P:'symbolP',Q:'symbolQ',ω:'symbolOmega',φ:'symbolPhi'};
function validateSymbolRole(value,key) {
  const fixed=fixedSymbolNames.get(value),other=symbolRoles[value];
  if(fixed || other && other!==key)throw new RangeError('기호 '+value+'는 '+(fixed||'다른 물리량의 고정 기호')+'로 사용됩니다. 이 입력에는 V_s, R_load처럼 구별되는 이름을 쓰세요.');
}
function symbol(p,key) {
  const value=p[key]??names[key];
  if(typeof value!=='string'||!/^[A-Za-zΑ-ω_][A-Za-z0-9Α-ω_]{0,23}$/u.test(value))throw new RangeError('기호 '+names[key]+': R1, V_s, ω 같은 단일 변수 이름을 입력하세요. 임의 수식 입력은 지원하지 않습니다.');
  validateSymbolRole(value,key);
  return value;
}
const A=(label,text,unit='')=>({label,text,unit});
const step=(label,formula,substitution,result)=>({label,formula,substitution,result});
function ensureChoice(v,values,label){if(!values.includes(v))throw new RangeError(label+': 지원되는 유형을 선택하세요.');}
export function solveSymbolicProblem(p){
  try{
    ensureChoice(p.problemKind,['single','three','correction'],'문제 유형');
    ensureChoice(p.basis,['rms','peak'],'전압 진폭');
    const V=symbol(p,'symbolVoltage'),w=symbol(p,'symbolOmega'),rms=p.basis==='peak'?'('+V+'/√2)':V;
    const v2=p.basis==='peak'?'|'+V+'|²/2':'|'+V+'|²';
    const symbols=[V,w],givens=['전압 '+V+'는 '+(p.basis==='peak'?'peak 복소 페이저':'RMS 복소 페이저'),'시간 기준 e^(j'+w+'t), 정현파 정상상태'];
    const notes=['지원 유형의 문자식 템플릿입니다. 범용 CAS·자유문장·사진 자동 풀이를 수행하지 않습니다.',
      '기호 이름을 바꾸어도 물리량의 의미와 단위는 유지됩니다. 전류는 부하 + 단자로 들어가는 수동부호입니다.',
      '기호 조건만으로 실제 크기·위상과 그래프를 정할 수 없습니다. 숫자 시각화 모드에서 같은 조건에 값을 대입하세요.'];
    const steps=[step('RMS 기준으로 통일','V_RMS='+rms,p.basis==='peak'?'peak → RMS: 진폭을 √2로 나눔':'입력 페이저가 RMS이므로 추가 계수 없음','|V_RMS|²='+v2)];
    let answers,goal,components=[],domains=['ω>0. 기호 전압이 0이면 전류 위상·역률은 미정입니다.'];
    let canonical;
    if(p.problemKind==='single'){
      ensureChoice(p.topology,['series','parallel'],'RLC 연결');ensureChoice(p.elements,['R','L','C','RL','RC','LC','RLC'],'소자 조합');
      goal=p.singleGoal;
      const R=p.elements.includes('R')?symbol(p,'symbolR'):null,L=p.elements.includes('L')?symbol(p,'symbolL'):null,C=p.elements.includes('C')?symbol(p,'symbolC'):null;
      for(const v of [R,L,C])if(v)symbols.push(v);
      if(R)components.push({kind:'R',symbol:R,Z:R,Y:'1/'+R});
      if(L)components.push({kind:'L',symbol:L,Z:'j'+w+'·'+L,Y:'−j/('+w+'·'+L+')'});
      if(C)components.push({kind:'C',symbol:C,Z:'−j/('+w+'·'+C+')',Y:'j'+w+'·'+C});
      givens.push((p.topology==='series'?'직렬 ':'병렬 ')+p.elements,...components.map(c=>c.kind+'='+c.symbol));
      domains.push('존재하는 R/L/C 값은 양수. LC 직렬에서 Z=0이면 비영 전압의 유한 전류 해가 없고 V=0이면 전류 미정입니다.',
        '병렬 Y=0은 개방 등가: 공급 전류 0, 분기 전류는 존재할 수 있습니다. Z의 유한값과 PF는 정할 수 없습니다.');
      const X=(L?w+'·'+L:'')+(C?(L?'−':'−')+'1/('+w+'·'+C+')':'');
      const B=(C?w+'·'+C:'')+(L?'−1/('+w+'·'+L+')':'');
      const Req=R??'0',G=R?'1/'+R:'0';
      const x=X||'0',b=B||'0';
      const Z=p.topology==='series'?(R?R+(X?(X.startsWith('−')?'−j('+X.slice(1)+')':'+j('+X+')'):''):'j('+x+')'):'1/('+G+'+j('+b+'))';
      const Y=p.topology==='parallel'?G+(B?(B.startsWith('−')?'−j('+B.slice(1)+')':'+j('+B+')'):''):'1/('+Z+')';
      let I=p.topology==='series'?rms+'/('+Z+')':rms+'×('+Y+')';
      const den='('+Req+'²+('+x+')²)';
      let S=p.topology==='series'?v2+'×('+Req+'+j('+x+'))/'+den:v2+'×('+G+'−j('+b+'))';
      let P=p.topology==='series'?v2+'×'+Req+'/'+den:v2+'×('+G+')';
      let Q=p.topology==='series'?v2+'×('+x+')/'+den:'−('+v2+')×('+b+')';
      let pf=p.topology==='series'?Req+'/√'+den:G+'/√(('+G+')²+('+b+')²)';
      let phi=p.topology==='series'?'atan2('+x+','+Req+')':'−atan2('+b+','+G+')';
      if(components.length===1){
        if(R){I=rms+'/'+R;S=v2+'/'+R;P=S;Q='0';pf='1';phi='0';}
        if(L){I='−j('+rms+')/('+w+'·'+L+')';Q='('+v2+')/('+w+'·'+L+')';S='j('+Q+')';P='0';pf='0';phi='π/2';}
        if(C){I='j'+w+'·'+C+'('+rms+')';Q='−('+v2+')×'+w+'·'+C;S='j('+Q+')';P='0';pf='0';phi='−π/2';}
      }
      canonical={kind:'single',topology:p.topology,elements:p.elements,Z,Y,I,S,P,Q,pf,phi,rms,voltageSquare:v2};
      steps.push(...components.map(c=>step(c.kind+' 임피던스·어드미턴스','Z_R=R; Z_L=jωL; Z_C=1/(jωC)','이 유형에 존재하는 '+c.kind+'만 포함','Z_'+c.kind+'='+c.Z+' Ω, Y_'+c.kind+'='+c.Y+' S')));
      steps.push(step('등가 회로',p.topology==='series'?'Z_eq=Σ Z_k':'Y_eq=Σ Y_k, Z_eq=1/Y_eq',components.map(c=>p.topology==='series'?c.Z:c.Y).join(' + '),'Z_eq='+Z+' Ω; Y_eq='+Y+' S'));
      steps.push(step('전원 전류','I=V_RMS/Z_eq=V_RMS Y_eq','V_RMS='+rms,'I='+I+' A RMS'));
      steps.push(step('켤레를 사용한 복소전력','S=V_RMS I*=|V_RMS|²/Z_eq*','전류의 위상을 켤레로 뒤집음','S='+S+' VA'));
      steps.push(step('피상전력의 크기','|S|=√(P²+Q²)=|V_RMS| |I_RMS|','복소전력 S와 피상전력 |S|는 구별합니다.','|S|='+(p.topology==='parallel'?v2+'|('+Y+')|':v2+'/|('+Z+')|')+' VA'));
      steps.push(step('유효·무효전력과 역률','P=Re(S), Q=Im(S), PF=P/|S|, φ=∠V−∠I','P='+P+' W; Q='+Q+' var','PF='+pf+'; φ='+phi));
      if(goal==='current')answers=[A('전원 전류 I RMS',I,'A')];
      else if(goal==='impedance')answers=[A('등가 임피던스 Z',Z,'Ω'),A('등가 어드미턴스 Y',Y,'S')];
      else if(goal==='branch')answers=components.flatMap(c=>p.topology==='series'?[A(c.kind+' 전압','('+I+')×('+c.Z+')','V RMS'),A(c.kind+' 전류',I,'A RMS')]:[A(c.kind+' 전압',rms,'V RMS'),A(c.kind+' 전류',rms+'×('+c.Y+')','A RMS')]);
      else if(goal==='power')answers=[A('복소전력 S',S,'VA'),A('유효전력 P',P,'W'),A('무효전력 Q',Q,'var'),A('피상전력 |S|','√(P²+Q²) = '+(p.topology==='parallel'?v2+'|('+Y+')|':v2+'/|('+Z+')|'),'VA')];
      else if(goal==='pf')answers=[A('역률 PF',pf),A('위상차 φ',phi,'rad')];
      else throw new RangeError('단상 회로에서 지원하지 않는 구할 값입니다.');
      notes.push('Q>0이면 유도성/전류 지상, Q<0이면 용량성/전류 진상. 병렬에서는 Q=−|V_RMS|² Im(Y)이므로 B의 부호가 반대입니다.');
    }else if(p.problemKind==='three'){
      ensureChoice(p.connection,['Y','delta'],'3상 부하');ensureChoice(p.voltageKnown,['line','phase'],'주어진 전압 종류');
      const Z=symbol(p,'symbolZ');symbols.push(Z);goal=p.threeGoal;
      const knownVan=p.connection==='Y'&&p.voltageKnown==='phase';
      const Van=knownVan?rms:'('+rms+'/√3)e^(−jπ/6)';
      const Vab=knownVan?'√3('+rms+')e^(jπ/6)':rms;
      const loadV=p.connection==='Y'?Van:Vab,loadI='('+loadV+')/'+Z;
      const Ia=p.connection==='Y'?loadI:'√3('+loadI+')e^(−jπ/6)';
      const k=p.connection==='Y'&&p.voltageKnown==='line'?1:3;
      const S=(k===1?'':'3×')+'('+v2+')/'+Z+'*',P=(k===1?'':'3×')+'('+v2+') Re('+Z+')/|'+Z+'|²',Q=(k===1?'':'3×')+'('+v2+') Im('+Z+')/|'+Z+'|²';
      canonical={kind:'three',connection:p.connection,voltageKnown:p.voltageKnown,Van,Vab,loadV,loadI,Ia,S,P,Q,rms,voltageSquare:v2,powerMultiplier:k};
      givens.push('균형 abc · '+(p.connection==='Y'?'Y':'Δ')+' · 상 임피던스 '+Z, V+'='+ (knownVan?'Van':p.voltageKnown==='line'?'Vab (선간)':'Vab (Δ 부하 상전압)'));
      domains.push(Z+'≠0, Re('+Z+')≥0. 균형 동일 부하만 지원하며 불평형/중성선 이동은 제외합니다.');
      steps.push(step('abc 상순서','Vbn=Van e^(−j2π/3), Vcn=Van e^(j2π/3)','Vab=Van−Vbn=√3 Van e^(jπ/6)','Van='+Van+'; Vab='+Vab));
      steps.push(step('상전압·상전류',p.connection==='Y'?'V상=Van, I상=Van/Z':'V상=Vab, Iab=Vab/Z','Z상='+Z,'V상='+loadV+'; I상='+loadI));
      steps.push(step('선전류',p.connection==='Y'?'Ia=I상':'Ia=Iab−Ica=√3 Iab e^(−jπ/6)','Y: 선전류=상전류 / Δ: 30° 지연 포함','Ia='+Ia+'; Ib=Ia e^(−j2π/3); Ic=Ia e^(j2π/3)'));
      steps.push(step('총 피상전력의 크기','|S₃|=√(P²+Q²)=3 |V상_RMS| |I상_RMS|','P,Q는 각각 총 유효·무효전력입니다.','|S₃|='+(k===1?'':'3×')+'('+v2+')/|'+Z+'| VA'));
      steps.push(step('3상 총 전력','S₃=3 V상 I상*=3 Van Ia*','선간 전압을 쓸 때 S₃=√3 Vab Ia*e^(−jπ/6)','S₃='+S+' VA; P='+P+' W; Q='+Q+' var'));
      if(goal==='line-current')answers=[A('Ia 선전류',Ia,'A RMS'),A('Ib 선전류','('+Ia+')e^(−j2π/3)','A RMS'),A('Ic 선전류','('+Ia+')e^(j2π/3)','A RMS')];
      else if(goal==='phase-current')answers=[A('첫 부하 상전류',loadI,'A RMS'),A('둘째 부하 상전류','('+loadI+')e^(−j2π/3)','A RMS'),A('셋째 부하 상전류','('+loadI+')e^(j2π/3)','A RMS')];
      else if(goal==='phase-voltage')answers=[A('첫 부하 상전압',loadV,'V RMS'),A('둘째 부하 상전압','('+loadV+')e^(−j2π/3)','V RMS'),A('셋째 부하 상전압','('+loadV+')e^(j2π/3)','V RMS')];
      else if(goal==='power')answers=[A('총 복소전력 S₃',S,'VA'),A('총 유효전력 P',P,'W'),A('총 무효전력 Q',Q,'var'),A('총 피상전력 |S₃|','√(P²+Q²) = '+(k===1?'':'3×')+'('+v2+')/|'+Z+'|','VA')];
      else if(goal==='pf')answers=[A('역률','Re('+Z+')/|'+Z+'|'),A('전류 지상각 φ','arg('+Z+')','rad')];
      else throw new RangeError('3상에서 지원하지 않는 구할 값입니다.');
      notes.push('위 식은 복소 페이저입니다. |V선|·|I선| 크기식의 √3만 복소수에 그대로 적용하면 30° 오류가 생깁니다.');
    }else{
      ensureChoice(p.phases,['1','3'],'전원 상수');ensureChoice(p.connection,['Y','delta'],'C뱅크 결선');
      const P=symbol(p,'symbolP'),Q=symbol(p,'symbolQ'),PF=symbol(p,'symbolPF');symbols.push(P,Q,PF);goal=p.correctionGoal;
      const qTarget=P+' tan(acos('+PF+'))',den=p.phases==='3'&&p.connection==='delta'?'3×'+w+'×('+v2+')':w+'×('+v2+')';
      const C='('+Q+'−'+qTarget+')/('+den+')',currentDen=(p.phases==='3'?'√3':'')+'|'+rms+'|';
      const before='√('+P+'²+'+Q+'²)/('+currentDen+')',after=P+'/('+PF+'×'+currentDen+')';
      canonical={kind:'correction',C,qTarget,sourceCurrentBefore:before,sourceCurrentAfter:after,rms,voltageSquare:v2,capacitorMultiplier:p.phases==='3'&&p.connection==='delta'?3:1};
      givens.push('총 부하 '+P+' W, '+Q+' var; 목표 지상 PF='+PF,p.phases==='3'?'균형 3상, '+V+'는 선간전압; C뱅크 '+p.connection:V+'는 단상 부하 단자전압');
      domains.push(P+'>0, 0<'+PF+'≤1, '+Q+'≥'+qTarget+'. 이 부등식이 맞지 않으면 커패시터만으로 목표를 만들 수 없습니다.');
      steps.push(step('목표 무효전력','φ_t=acos(PF_t), Q_t=P tan(φ_t)','φ_t=acos('+PF+')','Q_t='+qTarget+' var'));
      steps.push(step('C가 공급할 무효전력','Q_C=Q_t−Q≤0','Q_C='+qTarget+'−'+Q,'부하 P는 보상 전후 일정'));
      steps.push(step('각 커패시터 값','Q_C=−Nω C |V_C|²',p.phases==='3'?(p.connection==='delta'?'Δ: N=3, V_C=V선':'Y: N=3, V_C=V선/√3'):'단상: N=1, V_C=V','C_each='+C+' F'));
      steps.push(step('공급 전류','|S|=√(P²+Q²)',p.phases==='3'?'|I선|=|S₃|/(√3|V선|)':'|I|=|S|/|V|','보상 전 '+before+' A; 보상 후 '+after+' A'));
      if(goal==='capacitance')answers=[A('각 보상 커패시터 C_each',C,'F'),A('커패시터 총 Q',qTarget+'−'+Q,'var')];
      else if(goal==='source-current')answers=[A('보상 전 공급 전류',before,'A RMS'),A('보상 후 공급 전류',after,'A RMS')];
      else if(goal==='power')answers=[A('보상 후 P',P,'W'),A('보상 후 Q',qTarget,'var'),A('보상 후 |S|',P+'/'+PF,'VA')];
      else if(goal==='pf')answers=[A('보상 후 역률',PF),A('보상 후 지상각','acos('+PF+')','rad')];
      else throw new RangeError('역률보상에서 지원하지 않는 구할 값입니다.');
      notes.push('C_each는 각 소자의 값입니다. 동일 총 보상 Q에서 C_Y=3 C_Δ. 과보상 조건은 Q_after<0입니다.');
    }
    if(new Set(symbols).size!==symbols.length)throw new RangeError('서로 다른 물리량에 같은 기호 이름을 사용하지 마세요.');
    return{status:'valid',displayKind:'symbolic',frequencyHz:null,phasors:[],traces:[],checks:[],symbolic:true,
      solution:{symbolic:true,statement:String(p.problemText??''),givens,asked:goal,answers,steps,notes:[...domains,...notes],inputOrigin:'symbolic-template',canonical,components,
        waveform:'v(t)=√2 |'+rms+'| cos('+w+'t+arg('+rms+')); i(t)=√2 |I| cos('+w+'t+arg(I))'}};
  }catch(e){return{status:'invalid',reason:e.message};}
}

export function symbolicCourseExperiment(id,p) {
  if(id==='phasor-wave'){
    const V=symbol(p,'symbolVoltage'),w=symbol(p,'symbolOmega');
    if(V===w)return{status:'invalid',reason:'전압과 각주파수에는 서로 다른 기호 이름을 사용하세요.'};
    const rms=p.basis==='peak'?'('+V+'/√2)':V;
    return{status:'valid',symbolic:true,displayKind:'symbolic',phasors:[],traces:[],checks:[],frequencyHz:null,
      solution:{symbolic:true,inputOrigin:'symbolic-template',asked:'phasor',statement:'',
        givens:[V+'=a+jb=|'+V+'|e^(jθ)',V+'는 '+(p.basis==='peak'?'peak':'RMS')+' 페이저'],
        answers:[A('직교형 → 극형','|'+V+'|=√(a²+b²), θ=atan2(b,a)'),A('RMS 페이저','V_RMS='+(p.basis==='peak'?V+'/√2':V),'V'),A('시간파형','v(t)=√2 |'+rms+'| cos('+w+'t+arg('+rms+'))','V')],
        steps:[step('복소수 직교형','V=a+jb','a=Re('+V+'), b=Im('+V+')','크기=√(a²+b²)'),
          step('위상각과 극형','θ=atan2(b,a)','사분면을 보존하는 atan2 사용',V+'=√(a²+b²)e^(jθ)'),
          step('RMS/peak','V_peak=√2 V_RMS','V_RMS='+rms,'peak 전력식에는 ½, RMS 전력식에는 추가 ½ 없음'),
          step('복소회전 → 실수 파형','v(t)=√2 Re{V_RMS e^(jωt)}','ω='+w+', θ=arg('+V+')','T=2π/'+w+', f='+w+'/(2π)')],
        notes:['0벡터는 위상 미정. ω>0, 코사인·e^(jωt) 기준. 기호만으로 파형의 실제 크기와 주기는 정해지지 않습니다.','지원된 복소수·페이저 변환의 문자식입니다. 자유 수식 CAS가 아닙니다.'],
        waveform:'v(t)=√2 |'+rms+'|cos('+w+'t+arg('+rms+'))',canonical:{kind:'phasor',rms}}};
  }
  if(id==='power'){
    const V=symbol(p,'symbolVoltage'),w=symbol(p,'symbolOmega'),I=p.symbolCurrent??'I',phi=p.symbolPhi??'φ';
    if(!/^[A-Za-zΑ-ω_][A-Za-z0-9Α-ω_]{0,23}$/u.test(I)||!/^[A-Za-zΑ-ω_][A-Za-z0-9Α-ω_]{0,23}$/u.test(phi)||new Set([V,w,I,phi]).size!==4)return{status:'invalid',reason:'전압·전류·위상차는 서로 다른 단일 기호 이름을 사용하세요.'};
    try { validateSymbolRole(I,'symbolCurrent'); validateSymbolRole(phi,'symbolPhi'); } catch(error) { return {status:'invalid',reason:error.message}; }
    const factor=p.basis==='peak'?'½ ':'',product=factor+'|'+V+'||'+I+'|',S=factor+V+I+'*';
    return{status:'valid',symbolic:true,displayKind:'symbolic',phasors:[],traces:[],checks:[],frequencyHz:null,
      solution:{symbolic:true,inputOrigin:'symbolic-template',asked:'power',statement:'',
        givens:[V+'와 '+I+'는 모두 '+(p.basis==='peak'?'peak':'RMS')+' 페이저',phi+'=arg('+V+')−arg('+I+')','전류는 부하의 +단자로 입력'],
        answers:[A('복소전력 S',S,'VA'),A('유효전력 P',product+'cos('+phi+')','W'),A('무효전력 Q',product+'sin('+phi+')','var'),A('피상전력 |S|',product,'VA'),A('역률','cos('+phi+')')],
        steps:[step('전류의 켤레','I*=|I|e^(−j arg I)',V+'=|'+V+'|e^(j arg '+V+'), '+I+'*=|'+I+'|e^(−j arg '+I+')',S+'='+product+'e^(j'+phi+')'),
          step('RMS/peak 계수',p.basis==='peak'?'S=(V_peak/√2)(I_peak*/√2)':'S=V_RMS I_RMS*','같은 진폭 기준을 전압·전류에 적용',S),
          step('전력 성분','e^(jφ)=cosφ+j sinφ','S='+product+'[cos('+phi+')+j sin('+phi+')]','P='+product+'cos('+phi+'), Q='+product+'sin('+phi+')'),
          step('역률·삼각형','|S|²=P²+Q², PF=P/|S|','P/|S|=cos('+phi+')','Q>0: 전류 지상 / Q<0: 전류 진상')],
        notes:['|S|=0이면 PF와 상대위상은 미정. 순수 리액턴스는 P=0이지만 |S|>0이므로 PF=0입니다.',
          'P<0이면 수동부호 기준 이 포트가 유효전력을 전달합니다. 무조건 수동 부하로 해석하지 않습니다.',
          'Q>0 유도성/전압 앞섬·전류 지상. Q<0 용량성/전류 진상. θv=arg(V), θi=arg(I).',
          '문자식의 전력삼각형과 파형법칙만 제시합니다. 실제 삼각형 각도·파형은 수치 조건이 필요합니다.'],
        waveform:'p(t)=P+'+product+'cos(2'+w+'t+arg('+V+')+arg('+I+'))',canonical:{kind:'power',factor:p.basis==='peak'?.5:1,S}}};
  }
  const mapped={...p,solutionMode:'symbolic',basis:p.basis??'rms'};
  if(id==='impedance'){ const r=solveSymbolicProblem({...mapped,problemKind:'single',singleGoal:'impedance'}); if(r.solution)r.solution.answers.push(A('전원 전류 I',r.solution.canonical.I,'A RMS'),A('복소전력 S',r.solution.canonical.S,'VA')); return r; }
  if(id==='three-phase')return solveSymbolicProblem({...mapped,problemKind:'three',voltageKnown:p.voltageKnown??'line',threeGoal:'line-current'});
  if(id==='correction')return solveSymbolicProblem({...mapped,problemKind:'correction',correctionGoal:'capacitance'});
  return{status:'invalid',reason:'지원하지 않는 문자식 영역입니다.'};
}

// Shared plain-string schema; the integrator owns course-symbolic-view.js.
export function courseSymbolicData(result, p = {}) {
  if (result?.status !== 'valid' || !result.solution?.symbolic) return {status:'unsupported', title:'AC 문자 풀이', reason:result?.reason || '지원된 기호 조건이 필요합니다.'};
  const solution=result.solution, kind=solution.canonical?.kind;
  const keys=['symbolVoltage','symbolOmega', ...(kind==='single'?[...solution.canonical.elements].map(k=>'symbol'+k):kind==='three'?['symbolZ']:kind==='correction'?['symbolP','symbolQ','symbolPF']:kind==='power'?['symbolCurrent','symbolPhi']:[])];
  const definitions={symbolVoltage:['전압 복소 페이저 ('+(p.basis==='peak'?'peak':'RMS')+')','V','복소 위상 기준 e^(jωt)'],symbolOmega:['각주파수','rad/s','ω>0'],symbolR:['저항','Ω','R>0'],symbolL:['인덕턴스','H','L>0'],symbolC:['정전용량','F','C>0'],symbolZ:['각 부하 상의 동일 임피던스','Ω','Z≠0, Re(Z)≥0'],symbolP:['보상 전 총 유효전력','W','P>0'],symbolQ:['보상 전 총 무효전력','var','지상 양수, 진상 음수'],symbolPF:['목표 지상 역률','1','0<PF_t≤1'],symbolCurrent:['전류 복소 페이저 ('+(p.basis==='peak'?'peak':'RMS')+')','A','부하 +단자에 들어가는 전류'],symbolPhi:['전압 위상 − 전류 위상','rad','φ=arg(V)−arg(I)']};
  const defaults={...names,symbolCurrent:'I',symbolPhi:'φ'};
  return {status:'supported',title:'AC 문자식 정답 · '+({single:'RLC '+(solution.canonical.topology==='series'?'직렬':'병렬'),three:'균형 abc '+(solution.canonical.connection==='Y'?'Y':'Δ'),correction:'역률 보상',phasor:'복소수와 파형',power:'복소전력'}[kind]||'문제 풀이'),reason:'',
    givens:keys.map(key=>({symbol:p[key]??defaults[key],meaning:definitions[key][0],unit:definitions[key][1],constraint:definitions[key][2].replace(/(?<![A-Za-z0-9_])(R|L|C|Z|P|V|ω|PF_t)(?![A-Za-z0-9_])/gu, token => p[{R:'symbolR',L:'symbolL',C:'symbolC',Z:'symbolZ',P:'symbolP',V:'symbolVoltage',ω:'symbolOmega',PF_t:'symbolPF'}[token]]??(token==='PF_t'?'pf_t':token))})),
    assumptions:['정현파 정상상태, 이상 선형 소자, 공통 각주파수.', '코사인·e^(jωt) 기준. 전류는 부하 +단자로 들어가는 수동부호.'],
    conditions:solution.givens,
    laws:solution.steps.map(item=>({name:item.label,formula:item.formula})),
    steps:solution.steps.map(item=>({title:item.label,formula:item.result,explanation:item.substitution})),
    answers:solution.answers.map(item=>({quantity:item.label,formula:item.text,unit:item.unit,direction:''})),regions:[],boundaries:[],
    limitations:solution.notes};
}
