// Circuit-level ideal induction models. No DOM, storage, network or registration effects.
const FARADAY = { title: 'OpenStax University Physics 2 §13.1: Faraday law',
  url: 'https://openstax.org/books/university-physics-volume-2/pages/13-1-faradays-law' };
const LENZ = { title: 'OpenStax University Physics 2 §13.2: Lenz law',
  url: 'https://openstax.org/books/university-physics-volume-2/pages/13-2-lenzs-law' };
const MOTION = { title: 'OpenStax University Physics 2 §13.3: motional emf and energy',
  url: 'https://openstax.org/books/university-physics-volume-2/pages/13-3-motional-emf' };
const parameter = (key, label, unit, displayUnit, displayScale, initial, min, max) =>
  ({ key, label, unit, displayUnit, displayScale, initial, min, max });
const time = parameter('time', '시각 t', 's', 's', 1, 0.1, 0, 1000);
const resistance = parameter('resistance', '전체 회로 저항 R (닫힘일 때만 사용)', 'Ω', 'Ω', 1, 2, 0, 1e9);
const closedCircuit = parameter('closedCircuit', '회로 닫힘: 0=개방, 1=닫힘', '1', '1', 1, 0, 0, 1);
const scalar = (key, label, value, unit) => ({ key, label, value, unit });
const excluded = (status, reason, region = '') =>
  ({ status, reason, region, vectors: {}, scalars: [], notes: [] });

// Exact represented cardinal inputs have exact zeros; no small-value threshold/clamp.
function cosRad(angle) {
  return Math.abs(angle) === Math.PI / 2 ? 0 : Math.cos(angle);
}
function sinRad(angle) {
  return angle === 0 || Math.abs(angle) === Math.PI || Math.abs(angle) === 2 * Math.PI
    ? 0 : Math.sin(angle);
}
function validate(definition, params, point) {
  if (!params || (Object.getPrototypeOf(params) !== Object.prototype &&
      Object.getPrototypeOf(params) !== null)) return 'SI 매개변수는 일반 객체여야 합니다.';
  if (Object.values(params).some(v => typeof v !== 'number' || !Number.isFinite(v)))
    return '모든 SI 매개변수는 유한한 숫자여야 합니다.';
  for (const entry of definition.parameters) {
    const value = params[entry.key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < entry.min || value > entry.max)
      return entry.key + ': 표시된 SI 범위 안의 유한한 숫자가 필요합니다. 자동 보정하지 않습니다.';
  }
  if (params.closedCircuit !== 0 && params.closedCircuit !== 1)
    return 'closedCircuit은 정확히 숫자 0 또는 1이어야 합니다.';
  if (!Array.isArray(point) || point.length !== 3 ||
      ![0, 1, 2].every(i => typeof point[i] === 'number' && Number.isFinite(point[i])))
    return '관측점은 미터 단위의 유한한 숫자 3개 배열이어야 합니다.';
  return '';
}
function circuitError(params) {
  return params.closedCircuit === 1 && params.resistance === 0
    ? excluded('singular', 'R=0인 닫힌 회로의 전류는 이 순수 저항 모델로 결정할 수 없습니다. 자기 인덕턴스가 필요합니다.', 'ideal-short')
    : null;
}
function circuitScalars(params, emf) {
  if (!params.closedCircuit) return [];
  const current = emf / params.resistance;
  return [scalar('current', '양의 순환 기준 전류 I', current, 'A'),
    scalar('joulePower', '저항 발열 I²R', current * (params.resistance * current), 'W')];
}
function direction(emf, normal) {
  if (emf === 0) return '기전력=0: 이 순간 양/음의 유도 방향이 없습니다.';
  return emf > 0
    ? normal + '에서 본 반시계 방향 기전력: 양의 순환.'
    : normal + '에서 본 시계 방향 기전력: 음의 순환.';
}
function result(params, B, scalars, notes, region) {
  if (![B, ...scalars.map(s => s.value)].every(Number.isFinite))
    return excluded('invalid', '입력의 결과가 유한 배정밀도 수치 범위를 벗어납니다. 값 보정 없이 거절합니다.', region);
  return { status: 'valid', reason: '', region, vectors: { B: [0, 0, B] }, scalars, notes };
}
function check(label, method, actual, expected, unit, absTolerance = 1e-12, relTolerance = 2e-6) {
  if (![actual, expected, absTolerance, relTolerance].every(Number.isFinite))
    return skipped(label, '검산 값이 유한 수치 범위를 벗어났습니다.');
  const pass = Math.abs(actual - expected) <= absTolerance + relTolerance * Math.abs(expected);
  return { label, method, actual, expected, unit, absTolerance, relTolerance,
    status: pass ? 'pass' : 'fail', reason: pass ? '' : '독립 검산의 허용 오차를 초과했습니다.' };
}
function skipped(label, reason) {
  return { label, method: 'domain / numerical resolution validation', actual: 0, expected: 0,
    unit: '1', absTolerance: 0, relTolerance: 0, status: 'skipped', reason };
}
const value = (output, key) => output.scalars.find(s => s.key === key)?.value;

// Independent geometric flux integration in two tangent directions u and v.
// 128 equal surface cells. u=(cosθ,0,-sinθ), v=(0,1,0); (u×v)z=cosθ.
function surfaceFlux(params, t) {
  const c = Math.cos(params.theta), u = [c, 0, -Math.sin(params.theta)], v = [0, 1, 0];
  const normalZ = u[0] * v[1] - u[1] * v[0];
  const cellArea = params.area / 128;
  let flux = 0;
  for (let i = 0; i < 128; i++) flux += params.B0 * Math.cos(params.omega * t) * normalZ * cellArea;
  return flux;
}
function loopDerivativeCheck(params, output) {
  if (params.omega === 0 || params.B0 === 0 || params.area === 0 || cosRad(params.theta) === 0)
    return check('자속 변화가 없는 극한', 'surface flux is constant / identically zero by geometry',
      value(output, 'emf'), 0, 'V', 1e-14, 0);
  // Phase step .001 rad; bounded work (four flux integrations, 512 cells).
  const h = 1e-3 / params.omega, t = params.time;
  if (!Number.isFinite(h) || h === 0 || t + h === t || t - h === t)
    return skipped('자속 수치미분', '현재 시각과 주파수에서 차분 시각을 구별할 수 없습니다.');
  const flux = [-2, -1, 1, 2].map(k => params.turns * surfaceFlux(params, t + k * h));
  const derivative = (flux[0] - 8 * flux[1] + 8 * flux[2] - flux[3]) / (12 * h);
  const amplitude = Math.abs(params.turns * params.area * params.B0 * params.omega * cosRad(params.theta));
  const roundoff = 64 * Number.EPSILON * Math.max(...flux.map(Math.abs)) / h;
  const emf = value(output, 'emf');
  if (emf !== 0 && Math.abs(emf) < roundoff)
    return skipped('자속 수치미분', '자속 차가 배정밀도 분해능보다 작습니다. 해석식 결과를 수치미분 PASS로 꾸미지 않습니다.');
  return check('emf = −dΛ/dt', 'five-point derivative of 128-cell surface quadrature; phase step .001 rad',
    emf, -derivative, 'V', 2e-10 * amplitude + roundoff, 2e-6);
}
const commonValidity = [
  '입력은 SI, 각도는 rad, time≥0. 관측점은 주어진 외부 균일 B만 표본화하며 자속·기전력은 전체 회로 양이다.',
  'closedCircuit=0이면 저항값과 무관하게 전류·발열·자기력은 표시하지 않는다. 닫힘=1, R>0일 때만 I=emf/R.',
  '일반 유도 E의 공간 분포, 정전기 전위, 유도 전류의 자기장은 계산하지 않는다. B 벡터는 인가장만 의미한다.',
  '자기/상호 인덕턴스·정전용량·복사·역작용·강자성 코어는 제외한 준정적 이상 모델이다.',
];

const symbolicCircuit = { key: 'closedCircuit', label: '회로 조건', initial: 0,
  choices: [{ value: 0, label: '개방: 기전력만' }, { value: 1, label: '닫힌 순수 저항 회로: R>0' }] };
const symbolicNormal = { key: 'normalOrientation', label: '양의 법선·순환 기준', initial: 0,
  choices: [{ value: 0, label: '기본 법선, 오른손 순환' }, { value: 1, label: '반대 법선, 반대 순환' }] };
const loopSymbolicControls = [symbolicCircuit, symbolicNormal,
  { key: 'alignment', label: '고정 루프 법선의 배치', initial: 0,
    choices: [{ value: 0, label: '일반 고정 각 θ' }, { value: 1, label: '기본 법선과 +z 평행: θ=0' },
      { value: 2, label: '기본 법선과 +z 수직: θ=π/2' }] },
  { key: 'fieldRegime', label: '인가 자기장의 시간 조건', initial: 0,
    choices: [{ value: 0, label: 'B₀ cos(ωt), ω>0' }, { value: 1, label: '정적 B₀: ω=0' }] }];
const rodSymbolicControls = [symbolicCircuit, symbolicNormal,
  { key: 'motionRegime', label: '도선 운동 조건', initial: 0,
    choices: [{ value: 0, label: '일정 부호 속도 v≠0' }, { value: 1, label: '정지: v=0' }] }];

function symbolicSelection(controls, options) {
  if (!options || (Object.getPrototypeOf(options) !== Object.prototype &&
      Object.getPrototypeOf(options) !== null)) return { error: '구조 조건은 일반 객체여야 합니다.' };
  if (Reflect.ownKeys(options).some(key => !controls.some(c => c.key === key)))
    return { error: 'symbolic에는 선언된 구조 조건만 전달합니다. 수치 물리값이나 알 수 없는 조건은 지원하지 않습니다.' };
  const selected = {};
  for (const control of controls) {
    const chosen = Object.hasOwn(options, control.key) ? options[control.key] : control.initial;
    if (!control.choices.some(choice => choice.value === chosen))
      return { error: control.key + ': 선언된 숫자 구조 선택값만 지원합니다.' };
    selected[control.key] = chosen;
  }
  return { selected };
}
const given = (symbol, meaning, unit, constraint) => ({ symbol, meaning, unit, constraint });
const answer = (quantity, expression, unit, direction) =>
  ({ quantity, formula: quantity + ' = ' + expression, unit, direction });
const inductionSymbolicLimitations = [
  '기존 두 이상 유도 모델의 조건별 기호 템플릿이다. 범용 CAS나 자유 문장 방정식 해석기가 아니다.',
  '문자 B₀,B,A,N,θ,ω,t,l,v,x₀,L,R에 수치 예시를 대입하지 않는다. 수치 시현은 별도 evaluate/verify의 선택 기능이다.',
  'ΦB는 지정 면의 자속 Wb, Λ=NΦB는 자속 연계 Wb, ℰ는 지정 순환의 기전력 V이다.',
  '일반 유도 E의 공간 분포, 정전기 전위, 유도 전류의 자기장은 계산하지 않는다. B는 인가장이다.',
  '자기/상호 인덕턴스·정전용량·복사·역작용·코어 효과·임의 공간장과 기하를 지원하지 않는다.',
  '개방 권선의 ℰ는 지정한 가상 폐곡선 기준이다. 실제 측정 리드 경로에 따른 단자 전압은 이 템플릿의 답이 아니다.',
];
function symbolicFrame(title, error = '') {
  return { status: error ? 'unsupported' : 'supported', title, reason: error,
    givens: [], assumptions: [], conditions: [], laws: [], steps: [], answers: [],
    regions: [], boundaries: [], limitations: [...inductionSymbolicLimitations] };
}
function signedExpression(expression, negative) {
  return expression === '0' ? '0' : negative ? '−' + expression : expression;
}
function loopSymbolic(options = {}) {
  const parsed = symbolicSelection(loopSymbolicControls, options);
  const data = symbolicFrame('고정 루프의 Faraday·Lenz 기호풀이', parsed.error);
  if (parsed.error) return data;
  const { closedCircuit: closed, normalOrientation: reverse, alignment, fieldRegime } = parsed.selected;
  const staticField = fieldRegime === 1, perpendicular = alignment === 2;
  const projection = alignment === 0 ? ' cos(θ)' : '';
  const B = staticField ? 'B₀' : 'B₀ cos(ω t)';
  const fluxMagnitude = perpendicular ? '0' : 'A ' + B + projection;
  const flux = signedExpression(fluxMagnitude, reverse);
  const linkage = fluxMagnitude === '0' ? '0' : signedExpression('N ' + fluxMagnitude, reverse);
  const emfMagnitude = staticField || perpendicular ? '0' : 'N A ω B₀ sin(ω t)' + projection;
  const emf = signedExpression(emfMagnitude, reverse);
  const selectedNormal = reverse ? '−n₀' : 'n₀';
  const circulation = '양의 순환은 ' + selectedNormal + ' 쪽에서 본 반시계 방향; 음의 값은 그 반대.';
  data.givens = [
    given('B₀', '+z 기준 인가 자기장 진폭', 'T', '부호 포함'),
    given('A', '한 턴의 고정 면적', 'm²', 'A≥0; A=0은 축퇴한 수학적 극한'),
    given('N', '동일 자속을 갖는 직렬 권선 턴 수', '1', '양의 정수'),
    given('θ', '기본 법선 n₀=(sinθ,0,cosθ)의 고정 각', 'rad',
      alignment === 0 ? '−π≤θ≤π' : alignment === 1 ? 'θ=0' : 'θ=π/2'),
    given('ω', '인가장 각주파수', 'rad/s', staticField ? 'ω=0' : 'ω>0'),
    given('t', '시각', 's', 't≥0'),
    ...(closed ? [given('R', '닫힌 회로 전체 저항', 'Ω', 'R>0')] : []),
  ];
  data.assumptions = ['모든 턴에서 인가장이 균일하며 면적과 선택 법선은 시간에 따라 고정된다.',
    '선택 법선 n=' + selectedNormal + '; 기하의 기본 법선 n₀=(sinθ,0,cosθ).',
    closed ? '닫힌 순수 저항 회로; 자기 인덕턴스와 과도응답은 무시한다.' : '개방 회로: 정의된 닫힌 전류 경로가 없다.'];
  data.conditions = ['B(t)=' + B + ' ẑ; A,N,θ는 시간에 무관하다.',
    alignment === 0 ? '일반 고정 각: n₀·ẑ=cosθ.' : alignment === 1
      ? '평행 배치: n₀·ẑ=1.' : '수직 배치: n₀·ẑ=0.',
    '선택 법선의 투영 n·ẑ=' + (perpendicular ? '0' : reverse ? '−' + (alignment === 0 ? 'cosθ' : '1')
      : alignment === 0 ? 'cosθ' : '1') + '.',
    circulation, closed ? '폐회로 및 R>0에서만 I=ℰ/R, PJ=I²R.' : '개방 회로에서 I,PJ를 정의하거나 0으로 채우지 않는다.'];
  data.laws = [
    { name: '자속·자속 연계', formula: 'ΦB=∫S B·n dA; Λ=NΦB' },
    { name: 'Faraday 법칙과 Lenz 부호', formula: 'ℰ=−dΛ/dt' },
    { name: '변압기·운동 항 구분', formula: 'ℰ=ℰtransformer+ℰmotional; 고정 회로에서 ℰmotional=0' },
    ...(closed ? [{ name: '순수 저항 회로와 에너지', formula: 'I=ℰ/R; PJ=I²R=ℰ I≥0' }] : []),
  ];
  data.steps = [
    { title: '조건으로 면의 투영 결정', formula: 'n=' + selectedNormal + '; n·ẑ=' +
      (perpendicular ? '0' : signedExpression(alignment === 0 ? 'cos(θ)' : '1', reverse)),
    explanation: '먼저 법선과 양의 순환을 고정한다. 법선 반전은 자속과 기전력의 부호 기준을 함께 바꾼다.' },
    { title: '면적분에서 한 턴 자속', formula: 'ΦB(t) = ' + flux,
      explanation: perpendicular ? 'B와 면의 법선이 수직이므로 모든 면 요소의 내적이 0이다.'
        : '균일 인가장과 고정 법선은 면적분 밖으로 나오며 ∫S dA=A이다.' },
    { title: 'N턴 연계 후 시간 미분', formula: 'Λ(t) = ' + linkage + '\nℰ(t) = −dΛ/dt = ' + emf,
      explanation: staticField ? 'ω=0으로 B와 면이 모두 일정하여 연계 자속의 시간 미분이 0이다.'
        : perpendicular ? '연계 자속이 모든 시각에 0이므로 미분도 0이다.'
          : 'd cos(ωt)/dt=−ω sin(ωt); Faraday의 음수와 결합해 표시된 부호가 나온다.' },
    { title: '기전력 원인과 Lenz 방향', formula: 'ℰtransformer(t) = ' + emf + '; ℰmotional(t) = 0',
      explanation: '변화 원인은 B(t)뿐이다. 양의 연계 자속 증가에 음의 순환으로 반응한다. 운동 항을 중복 합산하지 않는다.' },
    ...(closed ? [{ title: '기호 전류와 저항 열', formula: 'I(t) = ' + (emfMagnitude === '0' ? '0' : emf + ' / R') +
      '\nPJ(t) = ' + (emfMagnitude === '0' ? '0' : '(' + emfMagnitude + ')² / R'),
    explanation: 'R>0의 폐회로에서만 전류를 정의한다. 열은 법선 기준 반전과 무관하며 외부 장 발생장치가 에너지를 공급한다.' }]
      : [{ title: '개방 조건에서 답 범위', formula: 'ℰ만 정의; I,PJ는 답에서 제외',
        explanation: '저항 수치 예시가 있어도 폐회로가 지정되지 않으면 ℰ/R로 전류를 만들어내지 않는다.' }]),
  ];
  data.answers = [answer('Bz(t)', B, 'T', '+z 기준 부호 성분; B=Bz ẑ'),
    answer('ΦB(t)', flux, 'Wb', '선택 법선 ' + selectedNormal + ' 기준'),
    answer('Λ(t)', linkage, 'Wb', '선택 법선과 권선 순환 기준'),
    answer('ℰ(t)', emf, 'V', emfMagnitude === '0' ? '유도 방향 없음: 기전력=0' : circulation),
    answer('ℰtransformer(t)', emf, 'V', 'B의 시간변화 항, 지정 순환 기준'),
    answer('ℰmotional(t)', '0', 'V', '고정 면적·법선: 운동 항 없음'),
    ...(closed ? [answer('I(t)', emfMagnitude === '0' ? '0' : emf + ' / R', 'A',
      emfMagnitude === '0' ? '전류=0 (R>0의 폐회로)' : circulation),
      answer('PJ(t)', emfMagnitude === '0' ? '0' : '(' + emfMagnitude + ')² / R', 'W',
        'PJ≥0; 외부 장 발생장치가 공급하는 저항 열')] : []),
  ];
  data.regions = [{ condition: 'A>0', formula: 'ΦB(t) = ' + flux + '; ℰ(t) = ' + emf,
    explanation: '인가장이 면 전체에서 균일한 실제 고정 면적의 모델이다.' },
    { condition: 'A=0', formula: 'ΦB=Λ=ℰ=0',
      explanation: '축퇴한 수학적 극한만 허용하며 실제 0면적 권선을 뜻하지 않는다.' }];
  data.boundaries = [
    { condition: 'θ=π/2 또는 −π/2', formula: 'n·ẑ=0; ΦB=Λ=ℰ=0',
      explanation: '일반 각 식의 수직 극한. 가까운 각의 작은 값을 임의로 0으로 보정하지 않는다.' },
    { condition: 'ω→0, 유한 t', formula: 'B→B₀; ℰ→0',
      explanation: '정적장 분기와 연속으로 연결된다. 정적 비영 자속은 기전력을 만들지 않는다.' },
    ...(staticField ? [] : [{ condition: 'ωt=kπ, 정수 k', formula: 'sin(ωt)=0; ℰ=0',
      explanation: '연계 자속의 시간 전환점이다. 자속 자체가 0이라는 뜻은 아니다.' }]),
    ...(closed ? [{ condition: 'R=0 (폐회로)', formula: 'I와 PJ 미결정; ℰ/R로 나누지 않음',
      explanation: '저항 모델의 singular 조건이며 ℰ=0이어도 유한 전류 답을 주장하지 않는다.' }] : []),
  ];
  data.limitations.push('회전 루프는 포함하지 않는다. 여기서 θ와 A는 시간에 따라 고정된다.');
  return data;
}
function rodSymbolic(options = {}) {
  const parsed = symbolicSelection(rodSymbolicControls, options);
  const data = symbolicFrame('이동 도선의 운동 기전력·Lenz 기호풀이', parsed.error);
  if (parsed.error) return data;
  const { closedCircuit: closed, normalOrientation: reverse, motionRegime } = parsed.selected;
  const stationary = motionRegime === 1;
  const x = stationary ? 'x₀' : 'x₀ + v t';
  const area = stationary ? 'l x₀' : 'l (x₀ + v t)';
  const flux = signedExpression('B ' + area, reverse);
  const emf = stationary ? '0' : signedExpression('B l v', !reverse);
  const normal = reverse ? '−ẑ' : '+ẑ';
  const circulation = '양의 순환은 ' + normal + ' 쪽에서 본 반시계; 이동 도선에서는 ' + (reverse ? '−y' : '+y') + ' 방향.';
  data.givens = [given('B', '+z 기준 정적 균일 인가 자기장', 'T', '부호 포함, 시간에 일정'),
    given('l', '도선 길이 및 레일 간격', 'm', 'l>0'),
    given('v', '+x 기준 일정 도선 속도', 'm/s', stationary ? 'v=0' : 'v≠0, 부호 포함'),
    given('x₀', 't=0의 도선 위치', 'm', '0≤x₀≤L'),
    given('L', '유효 레일 끝의 x 좌표', 'm', 'L>0'),
    given('t', '시각', 's', 't≥0'),
    ...(closed ? [given('R', '폐회로 전체 저항', 'Ω', 'R>0')] : [])];
  data.assumptions = ['고정 레일 y=0,l과 연결선 x=0, 도선 x(t). 인가 B는 면 전체에서 공간적으로 균일한 정적장이다.',
    '한 턴 N=1; 면의 선택 법선 n=' + normal + '.',
    closed ? '순수 저항 폐회로. 외력이 일정 속도를 유지하며 마찰·자기 인덕턴스·과도응답을 무시한다.'
      : '개방 도선: 전류 경로가 닫히지 않아 자기력과 저항 열을 계산하지 않는다.'];
  data.conditions = ['x(t) = ' + x + '; 0<x(t)<L; l>0, L>0.',
    stationary ? 'v=0: 면적이 시간에 일정하다.' : 'v≠0: 시간 범위는 0<x₀+vt<L를 만족하는 구간이다.',
    'B와 법선은 시간에 일정하다.', circulation,
    closed ? 'R>0인 폐회로에서만 I,자기력,외력,전력을 정의한다.' : '개방 조건: I,자기력,외력,저항 열은 답에서 제외한다.'];
  data.laws = [{ name: '자속·한 턴 연계', formula: 'ΦB=∫S B·n dA; Λ=ΦB (N=1)' },
    { name: '움직이는 회로의 Faraday 법칙', formula: 'ℰ=∮C (E+u×B)·dl=−dΦB/dt' },
    { name: '정적장과 운동 기전력', formula: 'ℰtransformer=0; ℰmotional=∮C (u×B)·dl' },
    ...(closed ? [{ name: '순수 저항 회로', formula: 'I=ℰ/R' },
      { name: 'Lorentz 자기력·에너지', formula: 'Fmag=I ∫rod dl×B; Pext=−Fmag,x v=I²R' }] : [])];
  data.steps = [
    { title: '운동으로 면적 결정', formula: 'x(t) = ' + x + '; A(t) = ' + area,
      explanation: '레일 간격 l과 현재 도선 위치의 곱이다. 먼저 유효 레일 내부 조건을 적용한다.' },
    { title: '법선 내적과 자속', formula: 'ΦB(t) = ' + flux + '; Λ(t)=ΦB(t)',
      explanation: '선택 법선 반전은 자속 부호를 반전한다. B 자체의 물리 방향을 바꾸지는 않는다.' },
    { title: '자속 미분으로 기전력', formula: 'ℰ(t) = −dΦB/dt = ' + emf,
      explanation: stationary ? 'v=0이면 면적과 장이 모두 일정하여 자속 미분이 0이다.'
        : 'B와 l은 일정, dx/dt=v이다. Faraday의 음수를 선택 순환 기준에 적용한다.' },
    { title: 'v×B 선적분으로 같은 답 확인', formula: 'u×B = −v B ŷ; dlrod 방향=' + (reverse ? '−ŷ' : '+ŷ') +
      '\nℰmotional(t) = ' + emf + '; ℰtransformer(t)=0',
      explanation: '고정 레일에서 u=0이다. 자속 미분과 운동 선적분은 같은 기전력의 두 유도법이며 서로 더하지 않는다.' },
    ...(closed ? [{ title: '전류의 기준 부호와 물리 자기력', formula: 'I(t) = ' + (stationary ? '0' : emf + ' / R') +
      '\nIrod,y = ' + (stationary ? '0' : '−B l v / R') + '; Fmag,x = ' + (stationary ? '0' : '−B² l² v / R'),
    explanation: '법선 반전은 I와 dl을 함께 반전한다. 실제 도선 전류와 자기력은 기준 선택과 무관하며 v에 반대한다.' },
    { title: '외력 공급전력과 저항 열', formula: stationary ? 'Fext,x=Pext=PJ=0' :
      'Fext,x=B² l² v/R; Pext=PJ=B² l² v²/R',
    explanation: '등속 유지 외력은 자기력 반대이며 공급 전력이 저항 열과 같다. 정적 B의 변압기 항을 다시 더하지 않는다.' }]
      : [{ title: '개방 조건에서 답 범위', formula: 'ℰ만 정의; I,Fmag,Fext,PJ,Pext는 답에서 제외',
        explanation: '닫힌 전류 경로를 지정하지 않은 도선에 ℰ/R 전류나 Lenz 자기력을 꾸며내지 않는다.' }]),
  ];
  data.answers = [answer('x(t)', x, 'm', '+x 기준 위치'),
    answer('A(t)', area, 'm²', '면적 크기; 법선은 별도로 ' + normal),
    answer('ΦB(t)', flux, 'Wb', normal + ' 기준 자속'),
    answer('Λ(t)', flux, 'Wb', '한 턴의 지정 순환 기준'),
    answer('ℰ(t)', emf, 'V', stationary ? '정지: 기전력=0' : circulation),
    answer('ℰmotional(t)', emf, 'V', '면적 변화 운동 항; 지정 순환 기준'),
    answer('ℰtransformer(t)', '0', 'V', '정적 B의 시간변화 순환 항 없음'),
    ...(closed ? [answer('I(t)', stationary ? '0' : emf + ' / R', 'A', stationary ? '정지: I=0, R>0' : circulation),
      answer('Fmag,x(t)', stationary ? '0' : '−B² l² v / R', 'N', '실제 +x 성분; v≠0,B≠0이면 속도에 반대'),
      answer('Fext,x(t)', stationary ? '0' : 'B² l² v / R', 'N', '자기력 반대로 일정 속도를 유지'),
      answer('PJ(t)', stationary ? '0' : 'B² l² v² / R', 'W', 'PJ≥0; 기준 법선과 무관'),
      answer('Pext(t)', stationary ? '0' : 'B² l² v² / R', 'W', '외력이 공급하는 전력=PJ')] : []),
  ];
  data.regions = [{ condition: '0<x(t)<L', formula: 'ΦB(t) = ' + flux + '; ℰ(t) = ' + emf,
    explanation: '레일 내부에서만 폐회로 기하가 유지된다.' },
    { condition: 'x(t)<0 또는 x(t)>L', formula: 'unsupported: 이 템플릿의 회로 답 없음',
      explanation: '접촉 소실과 회로 topology 변화를 지원하지 않으며 위치를 레일 끝으로 보정하지 않는다.' }];
  data.boundaries = [
    { condition: 'x(t)→0⁺', formula: 'ΦB→0; 내부 기전력의 한쪽 극한 = ' + emf,
      explanation: 'x=0 자체는 축퇴 경계이며 내부 한쪽 극한과 동일 상태로 계산하지 않는다.' },
    { condition: 'x(t)→L⁻', formula: 'ΦB→' + signedExpression('B l L', reverse) + '; 내부 기전력의 한쪽 극한 = ' + emf,
      explanation: 'x=L 자체는 레일 끝 접촉 경계. 접촉 소실 뒤 전류를 예측하지 않는다.' },
    { condition: 'v→0, 고정 x₀ 내부', formula: 'ℰ→0; ΦB→' + signedExpression('B l x₀', reverse),
      explanation: '정지 분기와 연결되며 자속이 남아도 유도가 없는 상태다.' },
    ...(closed ? [{ condition: 'R=0 (폐회로)', formula: 'I,Fmag,PJ 미결정',
      explanation: '순수 저항 모델의 singular 조건이다. 기전력이 0이어도 인덕턴스 없이 전류를 정하지 않는다.' }] : []),
  ];
  return data;
}

const loop = {
  id: 'faraday-loop', title: '고정 루프: Faraday·Lenz', topic: 'induction', modelKind: 'analytic-circuit',
  description: '고정된 면적과 법선에서 시간변화 B가 만든 자속 연계와 변압기 기전력. 전류는 정의된 저항 회로에서만 계산한다.',
  parameters: [
    parameter('B0', '자기장 부호 포함 진폭 B₀ (+z 기준)', 'T', 'T', 1, 0.3, -100, 100),
    parameter('area', '한 턴 면적 A', 'm²', 'cm²', 1e-4, 0.02, 0, 10),
    parameter('theta', '법선과 +z 사이 각 θ', 'rad', 'rad', 1, Math.PI / 3, -Math.PI, Math.PI),
    parameter('omega', '각주파수 ω', 'rad/s', 'rad/s', 1, 4, 0, 1e4),
    parameter('turns', '동일 자속을 갖는 직렬 턴 수 N', '1', '1', 1, 50, 1, 1e4),
    time, closedCircuit, resistance,
  ],
  probeDefault: [0, 0, 0],
  view: { kind: 'radial', plane: 'xz', extent: 1, probeAxes: [0, 2] },
  assumptions: [
    '모든 턴의 면적 A, 법선 n=(sinθ,0,cosθ)는 고정. 법선 쪽에서 본 반시계 순환이 양이다.',
    '인가장 B=(0,0,B₀ cos(ωt))가 각 턴 전체에서 공간적으로 균일하다. 장 발생장치의 세부 공간해는 범위 밖이다.',
    '회로 폐쇄를 명시하면 전체 R의 순수 저항 회로이며, 전류의 과도응답과 자기 인덕턴스는 무시한다.',
  ],
  validity: [...commonValidity, 'N은 양의 정수. A=0은 축퇴한 수학적 극한으로 Φ=Λ=emf=0; 실제 0면적 권선이 존재한다는 뜻은 아니다.',
    'θ=±π/2이면 자속과 기전력=0. B₀=0 또는 ω=0도 유효한 무유도 극한. B₀의 음수는 인가장 방향 반전이다.'],
  singularities: ['닫힌 회로 R=0이면 singular. 균일 인가장 자체에는 공간 특이점이 없다.'],
  formulas: [
    { label: '공통 자속과 연계', text: 'ΦB = ∫ B·dA; Λ = NΦB; emf = −dΛ/dt', unit: 'Wb; V' },
    { label: '고정 루프', text: 'ΦB = A B₀ cos(ωt) cosθ; emf = +N A ω B₀ sin(ωt) cosθ', unit: 'Wb; V' },
    { label: '원인 분리', text: 'emf_transformer = −N A cosθ dB/dt; emf_motional = 0 (A,θ 고정)', unit: 'V' },
    { label: '저항 회로', text: '닫힘=1, R>0: I=emf/R; P=I²R (외부 B 발생장치가 에너지 공급)', unit: 'A; W' },
  ],
  references: [FARADAY, LENZ],
  symbolicControls: loopSymbolicControls, symbolic: loopSymbolic,
  evaluate(params, point) {
    const error = validate(loop, params, point);
    if (error) return excluded('invalid', error);
    if (!Number.isInteger(params.turns)) return excluded('invalid', 'turns는 양의 정수여야 합니다.');
    const circuit = circuitError(params);
    if (circuit) return circuit;
    const phase = params.omega * params.time, B = params.B0 * cosRad(phase);
    const projection = cosRad(params.theta);
    const flux = params.area * B * projection, linkage = params.turns * flux;
    const emf = params.turns * params.area * params.omega * params.B0 * sinRad(phase) * projection;
    return result(params, B, [
      scalar('flux', '한 턴 자속 ΦB (지정 법선 기준)', flux, 'Wb'),
      scalar('linkage', 'N턴 자속 연계 Λ', linkage, 'Wb'),
      scalar('emf', '전체 유도 기전력 (양의 순환 기준)', emf, 'V'),
      scalar('transformerEmf', 'B 시간변화 항', emf, 'V'),
      scalar('motionalEmf', '운동 항 (정지 루프)', 0, 'V'),
      ...circuitScalars(params, emf),
    ], [
      '자속 변화 원인: B(t). 면적 A와 법선 θ는 고정이므로 운동 항을 더하지 않는다.',
      direction(emf, '지정 법선 n 방향'),
      'Lenz: 양의 자속 연계가 감소하면 양의 기전력, 증가하면 음의 기전력. 변화 자체에 반대한다.',
      params.closedCircuit ? '전류는 기전력과 같은 순환 부호이며 저항 열의 에너지는 외부 장 발생장치가 공급한다.'
        : '개방 회로: 기전력만 계산. 정의된 닫힌 회로가 없으므로 I=emf/R를 표시하지 않는다.',
      ...(params.area === 0 ? ['A=0: 축퇴한 수학적 무자속 극한.'] : []),
      'B는 인가장만 표시한다. 유도 E의 공간해나 전위는 계산하지 않는다.',
    ], 'fixed-loop-prescribed-field');
  },
  verify(params) {
    const output = loop.evaluate(params, loop.probeDefault);
    if (output.status !== 'valid') return [skipped('고정 루프 검산', output.status + ': ' + output.reason)];
    const rows = [check('ΦB = ∫ B·dA', '128-cell tangent-basis surface quadrature',
      value(output, 'flux'), surfaceFlux(params, params.time), 'Wb', 1e-13, 1e-10),
      loopDerivativeCheck(params, output)];
    if (params.closedCircuit) rows.push(check('회로 공급전력 = 저항 열', 'signed emf*I versus I²R',
      value(output, 'emf') * value(output, 'current'), value(output, 'joulePower'), 'W', 1e-12, 1e-10));
    else rows.push(skipped('전류·저항 열 검산', '개방 회로에는 정의된 전류가 없습니다.'));
    return rows;
  },
};
const rod = {
  id: 'motional-rod', title: '이동 도선: 운동 기전력', topic: 'induction', modelKind: 'analytic-circuit',
  description: '정적 B 속 레일 위 도선이 회로 면적을 바꾸며 만드는 기전력과 Lenz 자기력·전력.',
  parameters: [
    parameter('B', '정적 자기장 B (+z 부호)', 'T', 'T', 1, 0.5, -100, 100),
    parameter('length', '레일 간격 / 도선 길이 l', 'm', 'cm', 0.01, 0.4, 1e-6, 10),
    parameter('velocity', '도선 속도 v (+x 부호)', 'm/s', 'm/s', 1, 3, -100, 100),
    parameter('x0', 't=0의 도선 위치 x₀', 'm', 'cm', 0.01, 0.2, 0, 10),
    parameter('railLength', '유효 레일 끝 x', 'm', 'm', 1, 2, 1e-6, 10),
    time, closedCircuit, resistance,
  ],
  probeDefault: [0, 0, 0],
  view: { kind: 'radial', plane: 'xz', extent: 1, probeAxes: [0, 2] },
  assumptions: [
    '고정 레일 y=0,l, 고정 연결선 x=0, 이동 도선 x=x₀+vt. 인가 B는 회로 전체에서 균일한 정적 +z 부호장이다.',
    '한 턴, 법선 +z. +z에서 본 반시계 순환이 양이며 오른쪽 이동 도선에서는 +y 방향이다.',
    '일정 속도를 유지하는 외력이 존재한다. 레일·도선 접촉 저항과 마찰은 별도 모델이 없고 전체 R에만 저항을 부여한다.',
  ],
  validity: [...commonValidity, 'l>0, 0≤x₀≤railLength, 현재 도선은 0<x(t)<railLength에서만 지원한다.',
    'v=0 또는 B=0이면 유효한 무유도 상태. 방향 반전은 v 또는 B의 부호 반전으로 지정한다.',
    '관측점은 회로 전체 양의 위치를 바꾸지 않는다. 도선 위치는 x₀+vt로만 계산한다.'],
  singularities: ['닫힌 R=0은 singular. 레일 끝 x=0,railLength는 boundary로 계산을 보류한다.',
    'x<0 또는 x>railLength는 unsupported; 접촉 소실/회로 topology 변화를 계산하지 않는다.'],
  formulas: [
    { label: '공통 자속과 연계', text: 'ΦB = ∫ B·dA = B l x; Λ=ΦB (N=1); emf=−dΛ/dt', unit: 'Wb; V' },
    { label: '운동 기전력', text: 'emf = ∮ (v×B)·dl = −B l v (정의한 양의 순환); transformer 항=0', unit: 'V' },
    { label: 'Lenz 자기력', text: '닫힘=1, R>0: I=emf/R; Fmag,x=I l B; Fext,x=−Fmag,x', unit: 'A; N' },
    { label: '에너지', text: 'Pext=−Fmag,x v = I²R≥0; 정적 B의 변화율 항을 다시 더하지 않는다.', unit: 'W' },
  ],
  references: [FARADAY, LENZ, MOTION],
  symbolicControls: rodSymbolicControls, symbolic: rodSymbolic,
  evaluate(params, point) {
    const error = validate(rod, params, point);
    if (error) return excluded('invalid', error);
    if (params.x0 > params.railLength) return excluded('invalid', '초기 도선 위치 x₀가 유효 레일 길이를 초과합니다.');
    const x = params.x0 + params.velocity * params.time;
    if (x < 0 || x > params.railLength)
      return excluded('unsupported', '도선이 유효 레일 밖입니다. 회로 접촉/topology 변화를 지원하지 않습니다.', 'outside-rails');
    if (x === 0 || x === params.railLength)
      return excluded('boundary', '도선이 레일 끝에 있습니다. 축퇴/접촉 소실의 한쪽 극한만 유효하며 끝점 자체는 계산하지 않습니다.', 'rail-end');
    const circuit = circuitError(params);
    if (circuit) return circuit;
    const flux = params.B * params.length * x, emf = -params.B * params.length * params.velocity;
    const circuitValues = circuitScalars(params, emf);
    if (params.closedCircuit) {
      const current = emf / params.resistance, force = current * params.length * params.B;
      circuitValues.push(scalar('magneticForceX', '이동 도선의 자기력 Fmag,x', force, 'N'),
        scalar('externalForceX', '등속 유지 외력 Fext,x', -force, 'N'),
        scalar('mechanicalPower', '외력이 공급하는 전력 Fext,x v', -force * params.velocity, 'W'));
    }
    return result(params, params.B, [
      scalar('position', '현재 도선 위치 x(t)', x, 'm'),
      scalar('area', '회로 면적 l x(t)', params.length * x, 'm²'),
      scalar('flux', '한 턴 자속 ΦB (+z 법선)', flux, 'Wb'),
      scalar('linkage', '자속 연계 Λ (한 턴)', flux, 'Wb'),
      scalar('emf', '유도 기전력 (반시계 양)', emf, 'V'),
      scalar('transformerEmf', 'B 시간변화 항 (정적 B)', 0, 'V'),
      scalar('motionalEmf', '면적 변화 운동 항', emf, 'V'),
      ...circuitValues,
    ], [
      '자속 변화 원인: 면적 A=l x(t). B와 법선은 고정. −dΦ/dt와 v×B 선적분은 같은 기전력을 구하는 두 방법이다.',
      '변압기 항=0; 두 방법의 기전력을 합산하지 않는다.', direction(emf, '+z 방향'),
      params.closedCircuit ? 'Lenz 자기력은 v≠0, B≠0에서 속도에 반대하며 외력이 공급한 전력은 저항 열과 같다.'
        : '개방 회로: 기전력만 계산한다. 닫힌 전류 경로가 없어 I·자기력·발열은 표시하지 않는다.',
      '일반 유도 E의 공간 분포나 정전기 전위를 계산하지 않는다.',
    ], 'moving-rod-uniform-static-field');
  },
  verify(params) {
    const output = rod.evaluate(params, rod.probeDefault);
    if (output.status !== 'valid') return [skipped('이동 도선 검산', output.status + ': ' + output.reason)];
    // Right rod path is +y; cross(v,B)y = vz*Bx - vx*Bz.
    const velocity = [params.velocity, 0, 0], B = output.vectors.B;
    const crossY = velocity[2] * B[0] - velocity[0] * B[2];
    let integral = 0;
    for (let i = 0; i < 128; i++) integral += crossY * params.length / 128;
    const rows = [check('운동 기전력의 부호', '128-segment oriented (v×B) line integral along +y rod',
      value(output, 'emf'), integral, 'V', 1e-12, 1e-10)];
    const x = value(output, 'position'), speed = Math.abs(params.velocity);
    if (speed === 0) rows.push(check('정지 도선 자속 미분', 'constant area and field', value(output, 'emf'), 0, 'V', 1e-14, 0));
    else {
      const h = Math.min(x, params.railLength - x) / (4 * speed);
      const low = params.x0 + params.velocity * (params.time - h);
      const high = params.x0 + params.velocity * (params.time + h);
      if (!Number.isFinite(h) || h === 0 || high === low || params.time + h === params.time)
        rows.push(skipped('자속 수치미분', '레일 경계 근처 또는 미소 속도에서 차분을 분해할 수 없습니다.'));
      else rows.push(check('emf = −dΦ/dt', 'central difference of geometric rectangle flux (interior stencil)',
        value(output, 'emf'), -(params.B * params.length * high - params.B * params.length * low) / (2 * h),
        'V', 1e-12 + 64 * Number.EPSILON * Math.abs(value(output, 'flux')) / h, 2e-6));
    }
    if (params.closedCircuit) rows.push(check('외력 전력 = 저항 열', 'Lorentz force mechanical work versus independent resistive dissipation',
      value(output, 'mechanicalPower'), value(output, 'joulePower'), 'W', 1e-12, 1e-10));
    else rows.push(skipped('전류·Lenz 자기력·열 검산', '개방 회로에는 정의된 전류가 없습니다.'));
    return rows;
  },
};
export const EXPERIMENTS = [loop, rod];
