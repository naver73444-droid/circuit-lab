// Supported textbook-style families, not a general symbolic algebra engine.
const choice = (key, label, values) => ({ key, label, initial: values[0][0], choices: values.map(([value, label]) => ({ value, label })) });
export const SIGNALS_LESSONS = [
  { id: 'time', title: '1 · 기본 신호와 시간축', picture: '원래 시간 τ → τ=at−b → 새 시간 t', controls: [choice('family','기본 신호',[['rect','직사각'],['exp','감쇠 지수'],['step','계단'],['cos','정현파'],['sequence','유한 이산수열']]), choice('sign','시간 방향',[['positive','a>0'],['negative','a<0']])] },
  { id: 'convolution', title: '2 · LTI와 컨볼루션', picture: '뒤집기 h(−τ) → 이동 h(t−τ) → 겹침 적분 → y(t)', controls: [choice('family','입력·충격응답',[['rect','직사각 × 직사각'],['exp','우측 지수 × 우측 지수'],['sequence','유한 이산수열 × 유한 이산수열']])] },
  { id: 'series', title: '3 · Fourier 급수', picture: '주기 신호 → 정수배 주파수 kω₀ → 계수 cₖ', controls: [choice('family','주기 신호',[['pulse','중심 직사각 펄스열'],['cos','위상 있는 코사인']])] },
  { id: 'fourier', title: '4 · Fourier 변환', picture: '시간 신호 → 주파수 성분 · CT ω [rad/s] / DT Ω [rad/sample]', controls: [choice('family','변환할 신호',[['exp','우측 감쇠 지수'],['rect','중심 직사각'],['cos','코사인 · 분포'],['step','계단 · 분포'],['sequence','유한 이산수열 · DTFT']])] },
  { id: 'roc', title: '5 · Laplace / Z와 ROC', picture: '대수식 + 수렴영역 ROC → 신호의 방향·안정성', controls: [choice('domain','변환',[['laplace','양측 Laplace'],['z','양측 Z']]), choice('side','시간 지지',[['right','우측 신호'],['left','좌측 신호']])] },
  { id: 'sampling', title: '6 · 표본화와 aliasing', picture: '연속 신호 → 간격 Tₛ=1/fₛ → 샘플 · |f|<fₛ/2에서 유일 복원', controls: [] }
];
export const SIGNALS_CONVENTIONS = 'CT: X(ω)=∫x(t)e^(−jωt)dt, x(t)=(1/2π)∫X(ω)e^(jωt)dω. DT: X(e^jΩ)는 2π 주기. ω=2πf [rad/s], Ω=2πf/fₛ [rad/sample].';
export function getSignalsLesson(id) { const l=SIGNALS_LESSONS.find(l=>l.id===id); if(!l) throw new RangeError('지원하지 않는 학습 단계입니다.'); return l; }
export function initialSignalsOptions(id) { return Object.fromEntries(getSignalsLesson(id).controls.map(c=>[c.key,c.initial])); }
const given = (symbol,meaning,constraint='',unit='') => ({symbol,meaning,constraint,unit});
const law = (name,formula) => ({name,formula});
const step = (title,formula,explanation='') => ({title,formula,explanation});
const answer = (quantity,formula) => ({quantity,formula});
export function evaluateSignalsLesson(id, options={}) {
  let lesson, o;
  try { lesson=getSignalsLesson(id); o={...initialSignalsOptions(id),...options}; for(const c of lesson.controls) if(!c.choices.some(v=>v.value===o[c.key])) throw new RangeError(c.label+': 지원하지 않는 조건입니다.'); for(const key of Object.keys(options)) if(!lesson.controls.some(c=>c.key===key)) throw new RangeError('알 수 없는 문자 조건: '+key); }
  catch(error) { return {status:'unsupported',title:'신호 및 시스템',reason:error.message,limitations:['명시된 함수족과 구조 조건만 지원합니다.']}; }
  const s={status:'supported',title:lesson.title,givens:[],assumptions:[],conditions:[],laws:[],steps:[],answers:[],regions:[],boundaries:[],limitations:['작성한 지원모델 예제입니다. 사용자 교재의 원문 문제나 범용 CAS 풀이가 아닙니다.']};
  if(id==='time') {
    const dt=o.family==='sequence', v=dt?'n':'t', q=dt?'k':'τ';
    s.givens=[given('a','시간축 배율',dt?'0이 아닌 정수':'0이 아닌 실수'),given('b','시간축 내부 이동',dt?'정수':'실수',dt?'sample':'s'),given('A','진폭','실수')];
    s.conditions=[o.sign==='positive'?'a>0':'a<0'];
    s.laws=[law('시간 좌표를 직접 대응',`${q}=a${v}−b, ${v}=(${q}+b)/a`)];
    s.steps=[step('원 신호의 좌표 찾기',`${q} → (${q}+b)/a`,'원래 위치에 먼저 b를 더한 뒤 a로 나눕니다. 새 그래프를 순서대로 만들 때는 x(a·)를 만든 뒤 b/a만큼 이동합니다.'),step('방향과 폭',o.sign==='positive'?'방향 유지, 폭 /|a|, 이동 b/a':'방향 반전, 폭 /|a|, 이동 b/a','x(a(t−b))는 x(at−b)와 달라 이동이 b입니다.')];
    const forms={rect:'x(t)=A r_T(t); r_T는 0<t<T에서 1, t=0,T에서 1/2, 그 밖에서 0',exp:'x(t)=A e^(−αt)u(t), α>0',step:'x(t)=A u(t)',cos:'x(t)=A cos(ω₀t+φ), ω₀>0',sequence:'x[k]=xₖ (0≤k<N), 그 밖은 0'};
    s.assumptions=[forms[o.family]];
    if(o.family==='rect') {s.givens.push(given('T','원래 폭','T>0','s'));s.answers=[answer('변환 신호','y(t)=A (0<at−b<T), A/2 (at−b=0,T), 0 (그 밖)'),answer('내부 구간',o.sign==='positive'?'b/a<t<(T+b)/a':'(T+b)/a<t<b/a')];}
    if(o.family==='exp') {s.givens.push(given('α','감쇠율','α>0','1/s'));s.answers=[answer('변환 신호','y(t)=A e^(−α(at−b))u(at−b)')];}
    if(o.family==='step') s.answers=[answer('변환 신호','y(t)=A u(at−b)'),answer('켜진 구간',o.sign==='positive'?'t>b/a':'t<b/a')];
    if(o.family==='cos') {s.givens.push(given('ω₀','원 각주파수','ω₀>0','rad/s'),given('φ','위상','','rad'));s.answers=[answer('변환 신호','y(t)=A cos(aω₀t+φ−ω₀b)'),answer('주기','T_y=2π/(|a|ω₀)')];}
    if(dt) {s.givens=s.givens.filter(v=>v.symbol!=='A');s.givens.push(given('N','수열 길이','양의 정수'));s.answers=[answer('변환 수열','y[n]=x[an−b]'),answer('대응 표본','n=(k+b)/a가 정수인 원 표본만 남는다.')];s.limitations.push('이산 비정수 배율/이동과 보간은 지원하지 않습니다. |a|>1은 일부 원 표본을 생략합니다.');}
    s.boundaries=[{condition:dt?'정수 격자':'계단·직사각 경계',explanation:dt?'DT u[n]=1 (n≥0), δ[n]은 보통 수열입니다.':'CT u(0)=1/2 관례, 직사각 양 끝은 A/2로 표시합니다. 단일점 값은 적분을 바꾸지 않습니다. Dirac δ(t)는 보통 함수값이 아닌 분포입니다.'}];
  }
  if(id==='convolution') {
    const dt=o.family==='sequence';
    s.assumptions=['영 초기상태의 선형 시불변(LTI) 시스템; 입력 x와 충격응답 h가 주어진다.'];
    s.laws=[law('LTI 출력',dt?'y[n]=Σₖ x[k]h[n−k]':'y(t)=∫₋∞^∞ x(τ)h(t−τ)dτ')];
    if(o.family==='rect') {
      s.givens=[given('A,B','두 진폭','실수'),given('T₁,T₂','두 직사각 폭','T₁,T₂>0','s')];s.conditions=['x(t)=A·1_{0<t<T₁}, h(t)=B·1_{0<t<T₂}'];
      s.steps=[step('반전 후 이동','h(t−τ)≠0 ⇔ t−T₂<τ<t'),step('겹침 구간','L=max(0,t−T₂), U=min(T₁,t)'),step('면적을 출력으로','y(t)=AB∫_L^U dτ=AB max(0,U−L)','겹치는 폭과 출력 그래프의 관측점을 같은 t에 연결합니다.')];
      s.answers=[answer('출력','y(t)=AB max(0,min(T₁,t)−max(0,t−T₂))')];
      s.regions=[{condition:'t≤0 또는 t≥T₁+T₂',formula:'y=0'},{condition:'0<t<m, m=min(T₁,T₂)',formula:'y=ABt'},{condition:'m≤t≤M, M=max(T₁,T₂)',formula:'y=ABm'},{condition:'M<t<T₁+T₂',formula:'y=AB(T₁+T₂−t)'}];
    } else if(o.family==='exp') {
      s.givens=[given('α,β','감쇠율','α,β>0','1/s')];s.conditions=['x=e^(−αt)u(t), h=e^(−βt)u(t)'];
      s.steps=[step('지지 교집합','t≥0이면 0≤τ≤t; t<0이면 겹침 없음'),step('적분','y=e^(−βt)∫₀ᵗ e^((β−α)τ)dτ')];s.answers=[answer('서로 다른 감쇠율','y(t)=[e^(−αt)−e^(−βt)]/(β−α)·u(t), α≠β'),answer('동일한 감쇠율','y(t)=t e^(−αt)u(t), α=β')];
    } else {
      s.givens=[given('x₀…x₍N−1₎, h₀…h₍M−1₎','유한 이산수열'),given('nₓ,nₕ','첫 표본의 인덱스','정수')];
      s.conditions=['지지 밖의 표본은 0'];s.steps=[step('출력의 시작과 끝','n_start=nₓ+nₕ, n_end=nₓ+nₕ+N+M−2'),step('겹치는 정수만 더하기','k∈[nₓ,nₓ+N−1]∩[n−nₕ−M+1,n−nₕ]')];s.answers=[answer('출력','y[n]=Σₖ x[k]h[n−k], 길이 N+M−1')];
    }
    s.limitations.push('임의 연속 함수의 자동 적분과 초기조건 있는 시스템의 전체 응답은 지원하지 않습니다.');
  }
  if(id==='series') {
    s.givens=[given('A','진폭','실수'),given('T₀','주기','T₀>0','s')];s.laws=[law('복소 Fourier 급수','x(t)=Σₖ cₖe^(jkω₀t), cₖ=(1/T₀)∫_{한 주기}x(t)e^(−jkω₀t)dt, ω₀=2π/T₀')];
    if(o.family==='pulse') {s.givens.push(given('D','듀티비','0<D<1'));s.conditions=['각 주기의 중심 |t|<DT₀/2에서 A, 그 밖에서 0'];s.steps=[step('펄스 구간만 적분','cₖ=(A/T₀)∫₋ᴰᵀ₀⁄₂^ᴰᵀ₀⁄₂ e^(−jkω₀t)dt'),step('DC는 별도 극한','c₀=AD')];s.answers=[answer('계수','c₀=AD; cₖ=A sin(πkD)/(πk), k≠0'),answer('합성','x_FS(t)=Σₖ cₖe^(jkω₀t)')];s.boundaries=[{condition:'펄스 불연속점',formula:'Fourier 급수의 수렴값=A/2',explanation:'양측 극한의 평균으로 수렴하며 유한항 합성에는 Gibbs 현상이 있습니다.'}];}
    else {s.givens.push(given('φ','위상','','rad'));s.conditions=['x(t)=A cos(ω₀t+φ)'];s.steps=[step('Euler 분해','x=(A/2)e^(jφ)e^(jω₀t)+(A/2)e^(−jφ)e^(−jω₀t)')];s.answers=[answer('계수','c₁=(A/2)e^(jφ), c₋₁=(A/2)e^(−jφ), 나머지 cₖ=0')];}
    s.limitations.push('다른 주기 함수·DT Fourier 급수의 자동 전개는 미지원입니다.');
  }
  if(id==='fourier') {
    const dt=o.family==='sequence';s.givens=[given('A','진폭','실수')];s.laws=[law(dt?'DTFT 정의와 역변환':'CT Fourier 변환과 역변환',dt?'X(e^jΩ)=Σₙx[n]e^(−jΩn); x[n]=(1/2π)∫₋π^πX(e^jΩ)e^(jΩn)dΩ':'X(ω)=∫₋∞^∞x(t)e^(−jωt)dt; x(t)=(1/2π)∫₋∞^∞X(ω)e^(jωt)dω')];
    if(o.family==='exp') {s.givens.push(given('α','감쇠율','α>0','1/s'));s.conditions=['x=A e^(−αt)u(t)'];s.steps=[step('지지 구간 적분','X=A∫₀^∞e^(-(α+jω)t)dt','α>0이므로 무한대 경계항이 0입니다.')];s.answers=[answer('CTFT','X(ω)=A/(α+jω)')];}
    if(o.family==='rect') {s.givens.push(given('T','폭','T>0','s'));s.conditions=['x=A, |t|<T/2; 그 밖은 0'];s.steps=[step('유한 구간 적분','X=A∫₋ᵀ⁄₂^ᵀ⁄₂e^(−jωt)dt=2A sin(ωT/2)/ω')];s.answers=[answer('CTFT','X(ω)=AT sincᵤ(ωT/2), sincᵤ(v)=sin(v)/v'),answer('영 주파수 극한','X(0)=AT')];}
    if(o.family==='cos') {s.givens.push(given('ω₀','각주파수','ω₀>0','rad/s'),given('φ','위상','','rad'));s.conditions=['x=A cos(ω₀t+φ)'];s.steps=[step('복소 지수로 분해','e^(jω₀t) ↔ 2πδ(ω−ω₀)')];s.answers=[answer('분포 CTFT','X(ω)=πA[e^(jφ)δ(ω−ω₀)+e^(−jφ)δ(ω+ω₀)]')];}
    if(o.family==='step') {s.conditions=['x=A u(t), u(0)=1/2'];s.steps=[step('감쇠 지수의 분포 극한','X=lim_{α→0+} A/(α+jω)','일반 함수의 점별 극한만으로 DC 성분을 얻을 수 없습니다.')];s.answers=[answer('분포 CTFT','X(ω)=Aπδ(ω)+A PV[1/(jω)]')];}
    if(dt) {s.givens=[given('x₀…x₍N−1₎','유한 표본'),given('n₀','첫 인덱스','정수')];s.conditions=['x[n₀+k]=xₖ, 0≤k<N; 그 밖은 0'];s.steps=[step('유한합','X=Σₖ₌₀ᴺ⁻¹xₖe^(−jΩ(n₀+k))'),step('정수 인덱스의 주기성','e^(−j(Ω+2π)n)=e^(−jΩn)')];s.answers=[answer('DTFT','X(e^jΩ)=e^(−jΩn₀)Σₖ₌₀ᴺ⁻¹xₖe^(−jΩk); X(Ω+2π)=X(Ω)')];}
    s.boundaries=[{condition:dt?'주파수 단위':'분포·정규화',explanation:dt?'Ω는 rad/sample입니다. 물리 주파수 f가 주어지면 Ω=2πf/fₛ입니다.':'ω는 rad/s, f는 Hz, ω=2πf. Dirac δ는 무한 높이의 보통 그래프가 아닙니다. PV는 Cauchy 주값이며 분포 답에는 수치 그래프를 제공하지 않습니다.'}];
  }
  if(id==='roc') {
    const right=o.side==='right', z=o.domain==='z';
    s.givens=[given(z?'a':'α',z?'지수 밑':'감쇠율',z?'실수 a≠0':'α>0',z?'':'1/s')];
    if(z) {s.conditions=[right?'x[n]=aⁿu[n]':'x[n]=aⁿu[−n−1]'];s.laws=[law('양측 Z 변환','X(z)=Σₙ₌₋∞^∞x[n]z^(−n)')];s.steps=[step('등비급수 수렴',right?'Σₙ₌₀^∞(a/z)ⁿ, |a/z|<1':'Σₘ₌₁^∞(z/a)ᵐ, |z/a|<1')];s.answers=[answer('대수식',right?'X(z)=1/(1−az⁻¹)=z/(z−a)':'X(z)=−1/(1−az⁻¹)=−z/(z−a)'),answer('ROC',right?'|z|>|a|':'|z|<|a|'),answer('h[n]=x[n]일 때 BIBO 안정 조건',right?'|a|<1 (단위원이 ROC 안)':'|a|>1 (단위원이 ROC 안)'),answer('인과성',right?'h[n]=0 for n<0: 인과적':'h[n]은 n<0에서 존재: 비인과적')];}
    else {s.conditions=[right?'x(t)=e^(−αt)u(t)':'x(t)=e^(−αt)u(−t)'];s.laws=[law('양측 Laplace 변환','X(s)=∫₋∞^∞x(t)e^(−st)dt')];s.steps=[step('끝점 수렴',right?'∫₀^∞e^(−(s+α)t)dt; Re(s+α)>0':'∫₋∞^0e^(−(s+α)t)dt; Re(s+α)<0')];s.answers=[answer('대수식',right?'X(s)=1/(s+α)':'X(s)=−1/(s+α)'),answer('ROC',right?'Re(s)>−α':'Re(s)<−α'),answer('h(t)=x(t)일 때 BIBO 안정성',right?'α>0: jω축이 ROC 안, 절대적분 가능':'α>0: jω축이 ROC 밖, 불안정'),answer('인과성',right?'h(t)=0 for t<0: 인과적':'h(t)은 t<0에서 존재: 비인과적')];}
    s.boundaries=[{condition:'pole과 ROC 경계',explanation:'pole은 ROC에 포함되지 않습니다. 같은 유리식에도 ROC에 따라 다른 신호가 대응할 수 있습니다. Fourier 변환은 jω축/단위원이 ROC 안일 때만 직접 대입합니다.'}];if(z&&!right)s.boundaries.push({condition:'z=0',formula:'X(0)=0',explanation:'음수 인덱스만 있는 합은 z의 양수 거듭제곱입니다. −z/(z−a)로 표현하면 z=0 값도 정의되며 z⁻¹ 표기의 겉보기 특이점을 피합니다.'});s.limitations.push('양측 지수 한 항만 지원합니다. 임의 극점·다중 ROC·미분방정식 초기조건 자동 풀이는 미지원입니다.');
  }
  if(id==='sampling') {
    s.givens=[given('A','진폭','실수'),given('f₀','정현파 주파수','f₀≥0','Hz'),given('fₛ','표본화율','fₛ>0','sample/s'),given('φ','위상','','rad')];s.conditions=['x(t)=A cos(2πf₀t+φ), Tₛ=1/fₛ'];s.laws=[law('표본화','x[n]=x(nTₛ)'),law('스펙트럼 복제','xₛ(t)=Σₙx(nTₛ)δ(t−nTₛ); Xₛ(ω)=(1/Tₛ)ΣₖX(ω−kωₛ), ωₛ=2πfₛ')];s.steps=[step('샘플의 주파수','x[n]=A cos(Ω₀n+φ), Ω₀=2πf₀/fₛ'),step('대표 주파수로 접기','f_w=((f₀+fₛ/2) mod fₛ)−fₛ/2 ∈[−fₛ/2,fₛ/2)','mod는 비음수 나머지입니다. f_w<0이면 양의 대표 주파수 |f_w|에서 위상은 −φ입니다.')];s.answers=[answer('alias 대표','f_alias=|f_w|'),answer('보장되는 복원 범위','대역제한 B<fₛ/2 ⇔ fₛ>2B; 정현파는 f₀<fₛ/2'),answer('Nyquist 경계','f₀=fₛ/2이면 x[n]=A(−1)ⁿcosφ; sin 성분은 소실되어 임의 위상의 유일 복원을 보장하지 못한다.')];s.limitations.push('이상적인 표본화·정현파 alias 예시만 지원하며 실제 anti-alias 필터 설계·양자화는 미지원입니다.');
  }
  return s;
}

// Optional, bounded numerical illustrations. No evaluation of user expressions.
export function parseSignalsNumber(text, {min=-1e6,max=1e6,integer=false}={}) {
  const t=String(text).trim(); if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(t)) throw new RangeError('유한한 숫자를 입력하세요.');
  const n=Number(t); if(!Number.isFinite(n)||n<min||n>max||(integer&&!Number.isSafeInteger(n))||(n===0&&/[1-9]/.test(t.split(/e/i)[0]))) throw new RangeError('숫자가 지원 범위를 벗어났습니다.');return n;
}
export function parseSignalsSequence(text) { const parts=String(text).trim().split(',');if(parts.length>64||!String(text).trim()) throw new RangeError('쉼표로 구분한 1~64개 표본을 입력하세요.');return parts.map(p=>parseSignalsNumber(p,{min:-1000,max:1000})); }
export function rectangleConvolution(t,T1,T2,A=1,B=1) { for(const n of [t,T1,T2,A,B]) if(!Number.isFinite(n)||Math.abs(n)>1e6) throw new RangeError('유한한 지원값이 필요합니다.');if(T1<=0||T2<=0) throw new RangeError('폭은 양수입니다.'); const lower=Math.max(0,t-T2),upper=Math.min(T1,t),width=Math.max(0,upper-lower);return {lower,upper,width,y:A*B*width}; }
export function exponentialConvolution(t,a,b) { for(const n of [t,a,b]) if(!Number.isFinite(n)||Math.abs(n)>1e6) throw new RangeError('지원값 범위를 확인하세요.');if(a<=0||b<=0) throw new RangeError('감쇠율은 양수입니다.');if(t<0)return 0;const d=Math.abs(b-a),m=Math.min(a,b);return d===0?t*Math.exp(-a*t):Math.exp(-m*t)*(-Math.expm1(-d*t))/d; }
export function discreteConvolution(x,h,xStart=0,hStart=0) { if(!Array.isArray(x)||!Array.isArray(h)||!x.length||!h.length||x.length>64||h.length>64||![...x,...h].every(n=>Number.isFinite(n)&&Math.abs(n)<=1000)||![xStart,hStart].every(n=>Number.isSafeInteger(n)&&Math.abs(n)<=1000))throw new RangeError('유한 수열과 정수 시작 인덱스가 필요합니다.');const values=Array(x.length+h.length-1).fill(0);for(let i=0;i<x.length;i++)for(let j=0;j<h.length;j++)values[i+j]+=x[i]*h[j];return{start:xStart+hStart,values}; }
export function finiteDTFT(x,omega,start=0) { if(!Array.isArray(x)||!x.length||x.length>64||!x.every(n=>Number.isFinite(n)&&Math.abs(n)<=1000)||!Number.isFinite(omega)||Math.abs(omega)>1e6||!Number.isSafeInteger(start)||Math.abs(start)>1000)throw new RangeError('유한 수열/주파수/정수 인덱스를 확인하세요.');return x.reduce((s,v,k)=>({re:s.re+v*Math.cos(omega*(start+k)),im:s.im-v*Math.sin(omega*(start+k))}),{re:0,im:0}); }
export function pulseSeriesCoefficient(A,D,k) { if(!Number.isFinite(A)||Math.abs(A)>1e6||!Number.isFinite(D)||D<=0||D>=1||!Number.isSafeInteger(k)||Math.abs(k)>1000)throw new RangeError('A,D,k 조건을 확인하세요.');return k===0?A*D:A*Math.sin(Math.PI*k*D)/(Math.PI*k); }
export function rectangleFT(A,T,omega) { if(![A,T,omega].every(n=>Number.isFinite(n)&&Math.abs(n)<=1e6)||T<=0)throw new RangeError('직사각 변환 조건을 확인하세요.');const q=omega*T/2;return A*T*(q===0?1:Math.sin(q)/q); }
export function affineSignal(family,t,a,b) { if(![t,a,b].every(n=>Number.isFinite(n)&&Math.abs(n)<=1e4)||a===0||!['rect','step','exp','cos'].includes(family))throw new RangeError('시간 변환 조건을 확인하세요.');const u=a*t-b,heaviside=u===0?.5:u>0?1:0;return family==='rect'?(u===0||u===1?.5:u>0&&u<1?1:0):family==='step'?heaviside:family==='exp'?(u<0?0:Math.exp(-u)*heaviside):Math.cos(2*Math.PI*u); }
export function samplingAlias(f,fs) { if(!Number.isFinite(f)||!Number.isFinite(fs)||f<0||f>1e6||fs<1e-3||fs>1e6)throw new RangeError('f₀≥0, 0.001≤fₛ≤10⁶ 조건입니다.');const wrapped=((f+fs/2)%fs+fs)%fs-fs/2;return{signedHz:wrapped,aliasHz:Math.abs(wrapped),omega:2*Math.PI*wrapped/fs,phaseSign:wrapped<0?-1:1,status:f<fs/2?'alias-free':f===fs/2?'nyquist-boundary':'aliased'}; }
