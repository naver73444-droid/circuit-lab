import { EPS0 } from './em-course-constants.js';

const reference = {
  title: 'OpenStax University Physics 2 §8.1 — Cylindrical capacitor',
  url: 'https://openstax.org/books/university-physics-volume-2/pages/8-1-capacitors-and-capacitance',
};
const scalar = (key, label, value, unit) => ({ key, label, value, unit });
const excluded = (status, reason, region = '') => ({ status, reason, region, vectors: {}, scalars: [], notes: [] });

function validate(params, point, control) {
  if (!params || (Object.getPrototypeOf(params) !== Object.prototype && Object.getPrototypeOf(params) !== null)
    || !Object.values(params).every(value => typeof value === 'number' && Number.isFinite(value))) {
    return '매개변수는 유한한 SI 숫자로 이루어진 평범한 객체여야 합니다.';
  }
  if (!['a', 'b', 'c', 'epsilonR', control].every(key => Number.isFinite(params[key]))) {
    return '반경 a,b,c, 상대유전율 epsilonR 및 제어값을 모두 유한한 SI 숫자로 입력하세요.';
  }
  if (!(0 < params.a && params.a < params.b && params.b < params.c)) return '반경은 0 < a < b < c 순서여야 합니다.';
  if (!(params.epsilonR > 0)) return '균질 선형 유전체의 상대유전율은 양수여야 합니다.';
  if (!Array.isArray(point) || point.length !== 3 || !point.every(value => typeof value === 'number' && Number.isFinite(value))) {
    return '관측점은 유한한 미터 단위 숫자 세 개여야 합니다.';
  }
  return '';
}

function physicalState(params, control) {
  const { a, b, epsilonR } = params;
  // log1p preserves thin gaps; the second branch avoids overflow in b/a.
  const ratioMinusOne = (b - a) / a;
  const logRatio = Number.isFinite(ratioMinusOne) ? Math.log1p(ratioMinusOne) : Math.log(b) - Math.log(a);
  const epsilon = EPS0 * epsilonR;
  const capacitance = (2 * Math.PI * epsilon) / logRatio;
  const lambda = control === 'lambda' ? params.lambda : capacitance * params.voltage;
  const deltaV = control === 'voltage' ? params.voltage : lambda / capacitance;
  return { epsilon, capacitance, lambda, deltaV, logRatio };
}

function finiteState(state) {
  return Object.values(state).every(Number.isFinite) && state.epsilon > 0 && state.capacitance > 0 && state.logRatio > 0
    && (state.lambda === 0 ? state.deltaV === 0 : state.deltaV !== 0);
}

function evaluate(params, point, control) {
  const error = validate(params, point, control);
  if (error) return excluded('invalid', error);
  const state = physicalState(params, control);
  if (!finiteState(state) || (params[control] !== 0 && state.lambda === 0)) {
    return excluded('invalid', '입력에서 파생된 ε, λ, ΔV 또는 C′가 유한한 부동소수점 범위를 벗어납니다.');
  }
  const { a, b, c } = params;
  const { epsilon, capacitance, lambda, deltaV, logRatio } = state;
  const r = Math.hypot(point[0], point[1]);
  if (!Number.isFinite(r)) return excluded('invalid', '관측 반경이 유한한 계산 범위를 벗어납니다.');
  const scalars = [
    scalar('deltaV', '내부 도체 − 외부 도체 전압 ΔV', deltaV, 'V'),
    scalar('capacitancePerLength', '단위 길이당 정전용량 C′', capacitance, 'F/m'),
    scalar('lambda', '내부 도체 선전하 밀도 λ', lambda, 'C/m'),
    scalar('epsilon', '유전체 유전율 ε', epsilon, 'F/m'),
    scalar('radius', '축으로부터 반경 r', r, 'm'),
  ];
  const notes = ['전위 기준: 외부 도체(b ≤ r ≤ c) 및 외부 공간 V = 0.',
    control === 'voltage' ? '고정 ΔV: ε 증가 시 E와 V는 유지되고 λ, D, C′가 증가합니다.' : '고정 λ: ε 증가 시 E와 ΔV가 감소하고 D는 유지됩니다.'];
  if (r === a || r === b || r === c) {
    const surface = r === a ? 'a' : r === b ? 'b' : 'c';
    const displacement = lambda / (2 * Math.PI) / r;
    const field = displacement / epsilon;
    const erMinus = r === b ? field : 0;
    const erPlus = r === a ? field : 0;
    const drMinus = r === b ? displacement : 0;
    const drPlus = r === a ? displacement : 0;
    if (![erMinus, erPlus, drMinus, drPlus].every(Number.isFinite)
      || (r !== c && lambda !== 0 && (field === 0 || displacement === 0))) {
      return excluded('invalid', '표면의 양측 극한이 유한한 계산 범위를 벗어납니다.');
    }
    return {
      status: 'boundary', reason: `도체 표면 r = ${surface}: 단일 장값 대신 r→${surface}⁻ 및 r→${surface}⁺ 극한을 표시합니다.`,
      region: `surface-${surface}`, vectors: {},
      scalars: [scalar('potential', '전위 V (외부 도체 기준)', r === a ? deltaV : 0, 'V'), ...scalars,
        scalar('ErInside', '안쪽 극한 Eᵣ(r⁻)', erMinus, 'V/m'), scalar('ErOutside', '바깥쪽 극한 Eᵣ(r⁺)', erPlus, 'V/m'),
        scalar('DrInside', '안쪽 극한 Dᵣ(r⁻)', drMinus, 'C/m²'), scalar('DrOutside', '바깥쪽 극한 Dᵣ(r⁺)', drPlus, 'C/m²')],
      notes: [...notes, 'D의 도체측 값은 정전장 0에 대응합니다. 유전체측 D의 점프는 자유 표면전하와 일치합니다.',
        surface === 'c' ? '균형 전하와 외부장 없음 가정으로 c 양측 E와 D는 모두 0입니다.' : '반경 증가 방향의 성분이며, 음의 λ에서는 부호가 반전됩니다.'],
    };
  }
  let vectors = { E: [0, 0, 0], D: [0, 0, 0] };
  let potential = r < a ? deltaV : 0;
  const region = r < a ? 'inner-conductor' : r < b ? 'dielectric' : r < c ? 'outer-conductor' : 'exterior';
  if (region === 'dielectric') {
    const dr = lambda / (2 * Math.PI) / r;
    const er = control === 'voltage' ? params.voltage / logRatio / r : dr / epsilon;
    const x = point[0] / r, y = point[1] / r;
    vectors = { E: [er * x, er * y, 0], D: [dr * x, dr * y, 0] };
    potential = deltaV * (Math.log1p((b - r) / r) / logRatio);
    if (![er, dr, potential, ...vectors.E, ...vectors.D].every(Number.isFinite)
      || (lambda !== 0 && (er === 0 || dr === 0))) {
      return excluded('invalid', '장 또는 전위가 유한한 부동소수점 계산 범위를 벗어납니다.');
    }
  }
  return { status: 'valid', reason: '', region, vectors,
    scalars: [scalar('potential', '전위 V (외부 도체 기준)', potential, 'V'), ...scalars], notes };
}

function verify(params, control) {
  const invalid = validate(params, [0, 0, 0], control);
  const label = 'E의 반경 수치 적분 ↔ 도체 전압 ΔV';
  const method = 'independent nested Simpson quadrature, 16→1024 cells, cached ≤1025 samples; convergence checked';
  const skip = reason => [{ label, method, status: 'skipped', reason, unit: 'V' }];
  if (invalid) return skip(invalid);
  const state = physicalState(params, control);
  if (!finiteState(state)) return skip('파생 물리량이 유한한 계산 범위를 벗어납니다.');
  const expected = state.deltaV, absTolerance = 1e-10, relTolerance = 2e-6;
  const tolerance = absTolerance + relTolerance * Math.abs(expected), cache = new Map();
  const span = params.b - params.a;
  // Endpoints use the dielectric-side limits; all other nodes sample actual E.
  // Refinement reuses nodes and estimates discretization error independently
  // of whether the integral happens to match the closed-form voltage.
  const at = index => {
    if (cache.has(index)) return cache.get(index);
    const r = index === 0 ? params.a : index === 1024 ? params.b : params.a + span * (index / 1024);
    if (index !== 0 && index !== 1024 && (r === params.a || r === params.b)) return { error: '적분 노드가 도체 경계와 수치적으로 분리되지 않습니다.' };
    const sample = evaluate(params, [r, 0, 0], control);
    const field = index === 0 || index === 1024
      ? sample.scalars.find(item => item.key === (index === 0 ? 'ErOutside' : 'ErInside'))?.value
      : sample.status === 'valid' && sample.region === 'dielectric' ? sample.vectors.E[0] : undefined;
    if (!Number.isFinite(field)) return { error: sample.reason || '유전체 장을 적분할 수 없습니다.' };
    cache.set(index, field);
    return field;
  };
  let previous, actual, estimatedError;
  for (let cells = 16; cells <= 1024; cells *= 2) {
    let weighted = 0;
    for (let i = 0; i <= cells; i++) {
      const field = at(i * (1024 / cells));
      if (typeof field !== 'number') return skip(field.error);
      weighted += field * (i === 0 || i === cells ? 1 : i % 2 ? 4 : 2);
    }
    actual = (weighted / cells / 3) * span;
    if (!Number.isFinite(actual)) return skip('수치 적분이 유한한 계산 범위를 벗어납니다.');
    if (previous !== undefined) {
      estimatedError = Math.abs(actual - previous) / 15;
      if (estimatedError <= tolerance) {
        const pass = Math.abs(actual - expected) <= tolerance;
        return [{ label, method, actual, expected, estimatedError, sampleCount: cache.size,
          unit: 'V', absTolerance, relTolerance, status: pass ? 'pass' : 'fail',
          reason: pass ? '' : '수렴한 반경 적분값이 해석 전압의 허용오차를 벗어났습니다.' }];
      }
    }
    previous = actual;
  }
  return [{ label, method, actual, expected, estimatedError, sampleCount: cache.size,
    unit: 'V', absTolerance, relTolerance, status: 'skipped',
    reason: '1025개 표본 예산 내에서 반경 적분 수렴을 확보하지 못했습니다. 장 평가값의 물리 실패를 뜻하지 않습니다.' }];
}

function coaxSymbolicControls(control) {
  return [
    { key: 'control', label: '제어 조건', initial: control === 'lambda' ? 0 : 1,
      choices: [{ value: 0, label: '선전하 λ 고정' }, { value: 1, label: '도체 전압 ΔV 고정' }] },
    { key: 'reference', label: '전위 기준', initial: 0,
      choices: [{ value: 0, label: '외부 도체 V(b)=0' }, { value: 1, label: '내부 도체 V(a)=0' }] },
  ];
}

function coaxSymbolic(options, controls) {
  const title = '동축 축전기의 기호 풀이', empty = reason => ({ status: 'unsupported', title, reason,
    givens: [], assumptions: [], conditions: [], laws: [], steps: [], answers: [], regions: [], boundaries: [],
    limitations: ['지원 모델의 기호 템플릿입니다. 임의 수식·자유서술을 해석하는 범용 CAS가 아닙니다.'] });
  if (!options || (Object.getPrototypeOf(options) !== Object.prototype && Object.getPrototypeOf(options) !== null)) return empty('구조 조건의 평범한 객체가 필요합니다.');
  const selected = Object.fromEntries(controls.map(item => [item.key, item.initial]));
  for (const [key, value] of Object.entries(options)) {
    const item = controls.find(control => control.key === key);
    if (!item || !item.choices.some(choice => choice.value === value)) return empty('symbolic에는 control/reference의 선택값만 입력하세요. λ·전압·반경 등 숫자 예시를 전달할 수 없습니다.');
    selected[key] = value;
  }
  const fixedVoltage = selected.control === 1, innerReference = selected.reference === 1;
  const deltaV = fixedVoltage ? 'ΔV' : 'λ ln(b/a)/(2πε)';
  const field = fixedVoltage ? 'ΔV/[r ln(b/a)]' : 'λ/(2πεr)';
  const displacement = fixedVoltage ? 'εΔV/[r ln(b/a)]' : 'λ/(2πr)';
  const va = innerReference ? '0' : deltaV, vb = innerReference ? `−${fixedVoltage ? 'ΔV' : 'λ ln(b/a)/(2πε)'}` : '0';
  const potential = innerReference
    ? fixedVoltage ? '−ΔV ln(r/a)/ln(b/a)' : '−λ ln(r/a)/(2πε)'
    : fixedVoltage ? 'ΔV ln(b/r)/ln(b/a)' : 'λ ln(b/r)/(2πε)';
  return {
    status: 'supported', title, reason: '',
    givens: [
      { symbol: fixedVoltage ? 'ΔV' : 'λ', meaning: fixedVoltage ? '내부 도체 전위 − 외부 도체 전위를 고정' : '내부 도체 선전하; 외부 도체 선전하는 −λ', unit: fixedVoltage ? 'V' : 'C/m', constraint: '부호 있는 실수' },
      { symbol: 'a,b,c', meaning: '축 기준 내부 반경 a, 외부 도체 안쪽 b·바깥 c; 간격 b−a', unit: 'm', constraint: '0<a<b<c' },
      { symbol: 'ε=ε₀εᵣ', meaning: 'a<r<b 전체의 균질 선형 유전율', unit: 'F/m', constraint: 'εᵣ>0' },
      { symbol: 'r=√(x²+y²)', meaning: '공통 축으로부터 관측 반경', unit: 'm', constraint: 'r≥0' },
    ],
    assumptions: ['무한 길이 동축 이상 도체의 정전 평형; 끝단 효과 없음.', '균형 전하 +λ/−λ와 외부장 없음; 도체 내부 및 외부 E=D=0.',
      '갭 전체가 하나의 균질 등방 선형 유전체입니다. D=εE는 갭에서 적용합니다.',
      fixedVoltage ? '전원이 ΔV를 유지하고 유전체 변화에 따라 λ가 조정됩니다.' : '내부 λ가 유지되고 유전체 변화에 따라 ΔV가 조정됩니다.',
      innerReference ? '전위의 기준은 내부 도체 V(a)=0입니다.' : '전위의 기준은 외부 도체 V(b)=0입니다.'],
    conditions: ['0<a<b<c, ε>0, r≥0', fixedVoltage ? '고정 ΔV; λ=C′ΔV는 유도량' : '고정 λ; ΔV=λ/C′는 유도량',
      innerReference ? 'V(a)=0; V(b)=−ΔV' : 'V(b)=0; V(a)=ΔV'],
    laws: [{ name: '자유전하에 대한 가우스 법칙', formula: '∮D·n̂ dA=Qfree' },
      { name: '선형 유전체', formula: 'D=εE (a<r<b)' }, { name: '전위 차', formula: 'V(r₂)−V(r₁)=−∫r₁^r₂ E·dl' },
      { name: '단위 길이당 정전용량', formula: 'C′=λ/ΔV (0 전하·전압에서는 기하 정의로 연속 확장)' }],
    steps: [
      { title: '갭의 원통 가우스면', formula: '2πrL Dᵣ=λL ⇒ Dᵣ=λ/(2πr), Eᵣ=Dᵣ/ε', explanation: 'a<r<b의 원통 옆면만 전속을 가지며 끝면에는 D의 법선 성분이 없습니다.' },
      { title: '도체 전압 차', formula: 'ΔV=∫a^b Eᵣ dr=λ ln(b/a)/(2πε)', explanation: 'ΔV는 부호를 포함한 V(a)−V(b)입니다.' },
      { title: '정전용량과 선택된 제어량', formula: fixedVoltage ? 'C′=2πε/ln(b/a); λ=C′ΔV; Eᵣ=ΔV/[r ln(b/a)]' : 'C′=2πε/ln(b/a); ΔV=λ/C′; Eᵣ=λ/(2πεr)',
        explanation: fixedVoltage ? 'ε가 증가해도 E와 전위 분포는 유지되고 λ,D,C′가 비례 증가합니다.' : 'ε가 증가하면 E와 ΔV는 감소하고 λ,D는 유지됩니다.' },
      { title: '선택된 기준의 전위 적분', formula: innerReference ? `V(r)=V(a)−∫a^r Eᵣ dr=${potential}` : `V(r)=V(b)+∫r^b Eᵣ dr=${potential}`,
        explanation: '갭에서 적분하고 각 도체에서는 그 표면의 전위가 일정합니다. 기준 변경은 E,D를 바꾸지 않습니다.' },
    ],
    answers: [
      { quantity: 'C′', formula: 'C′=2πε/ln(b/a)', unit: 'F/m', direction: '양의 기하·매질량' },
      { quantity: fixedVoltage ? 'λ' : 'ΔV', formula: fixedVoltage ? 'λ=2πεΔV/ln(b/a)' : 'ΔV=λ ln(b/a)/(2πε)', unit: fixedVoltage ? 'C/m' : 'V', direction: '부호 있는 내부 − 외부 기준' },
      { quantity: 'E(r)', formula: `a<r<b: E=${field} r̂; 도체·외부 E=0`, unit: 'V/m', direction: 'r̂=(x/r,y/r,0); λ 또는 ΔV의 부호로 바깥/안쪽 방향 결정' },
      { quantity: 'D(r)', formula: `a<r<b: D=${displacement} r̂; 도체·외부 D=0`, unit: 'C/m²', direction: 'E와 같은 방향 (ε>0)' },
      { quantity: 'V(r)', formula: `r<a: ${va}; a<r<b: ${potential}; r>b: ${vb}`, unit: 'V', direction: '스칼라; 선택된 도체 기준' },
    ],
    regions: [
      { condition: '0≤r<a', formula: `E=D=0; V=${va}`, explanation: '내부 이상 도체; 축 r=0도 유효합니다.' },
      { condition: 'a<r<b', formula: `Eᵣ=${field}; Dᵣ=${displacement}; V=${potential}`, explanation: '균질 유전체 갭입니다.' },
      { condition: 'b<r<c', formula: `E=D=0; V=${vb}`, explanation: '외부 도체 내부입니다.' },
      { condition: 'r>c', formula: `E=D=0; V=${vb}`, explanation: '균형 전하·외부장 없음 가정에 따른 외부 상쇄입니다.' },
    ],
    boundaries: [
      { condition: 'r=a', formula: `V(a⁻)=V(a⁺)=${va}; Eᵣ(a⁻)=0; Eᵣ(a⁺)=${fixedVoltage ? 'ΔV/[a ln(b/a)]' : 'λ/(2πεa)'}; Dᵣ(a⁺)−Dᵣ(a⁻)=λ/(2πa)`, explanation: '전위 연속, 자유 표면전하에 따른 법선 장의 양측 극한; 단일 E,D를 지정하지 않습니다.' },
      { condition: 'r=b', formula: `V(b⁻)=V(b⁺)=${vb}; Eᵣ(b⁻)=${fixedVoltage ? 'ΔV/[b ln(b/a)]' : 'λ/(2πεb)'}; Eᵣ(b⁺)=0; Dᵣ(b⁺)−Dᵣ(b⁻)=−λ/(2πb)`, explanation: '귀환 전하 표면의 양측 극한; 고정 전압 모드의 λ는 C′ΔV입니다.' },
      { condition: 'r=c', formula: `Eᵣ(c⁻)=Eᵣ(c⁺)=Dᵣ(c⁻)=Dᵣ(c⁺)=0; V(c)=${vb}`, explanation: '균형 전하와 외부장 없음 가정에서 연속입니다. 수치 API는 도체 표면으로 boundary를 유지합니다.' },
    ],
    limitations: ['지원 동축 모델의 기호 템플릿이며 범용 CAS·임의형상 경계값 해석기가 아닙니다.',
      '층상·공간 변화 유전체, 외부장, 비균형 전하, 유한 길이의 끝단 효과를 계산하지 않습니다.',
      '전위 기준은 선택한 도체입니다. 무한 선전하 모델의 무한대 영전위 규칙을 적용하지 않습니다.',
      '구조 조건은 기호해를 선택합니다. 별도 숫자 예시의 기존 evaluate/verify/profile API를 변경하지 않습니다.'],
  };
}

const geometry = [
  { key: 'a', label: '내부 도체 반경 a', unit: 'm', displayUnit: 'mm', displayScale: 1e-3, initial: .001, min: 1e-6, max: 1 },
  { key: 'b', label: '외부 도체 안쪽 반경 b', unit: 'm', displayUnit: 'mm', displayScale: 1e-3, initial: .004, min: 1e-6, max: 1 },
  { key: 'c', label: '외부 도체 바깥 반경 c', unit: 'm', displayUnit: 'mm', displayScale: 1e-3, initial: .005, min: 1e-6, max: 1 },
  { key: 'epsilonR', label: '균질 유전체 상대유전율 εᵣ', unit: '1', displayUnit: '1', displayScale: 1, initial: 2.5, min: .01, max: 1000 },
];

function definition(control) {
  const symbolicControls = coaxSymbolicControls(control);
  return {
    id: control === 'lambda' ? 'coax-charge' : 'coax-voltage',
    title: control === 'lambda' ? '동축 케이블 — 고정 선전하 λ' : '동축 케이블 — 고정 전압 ΔV',
    topic: 'electrostatics', modelKind: 'analytic-symmetry',
    description: '균형 전하를 가진 무한 동축 도체의 E, D, 전위 및 단위 길이당 정전용량.',
    parameters: [...geometry.map(parameter => ({ ...parameter })), control === 'lambda'
      ? { key: 'lambda', label: '고정 내부 선전하 밀도 λ', unit: 'C/m', displayUnit: 'nC/m', displayScale: 1e-9, initial: 1e-9, min: -1e-6, max: 1e-6 }
      : { key: 'voltage', label: '고정 도체 전압 ΔV', unit: 'V', displayUnit: 'V', displayScale: 1, initial: 100, min: -1e4, max: 1e4 }],
    probeDefault: [.002, 0, 0], view: { kind: 'coax-cross-section', plane: 'xy', extent: .006, probeAxes: [0, 1] },
    assumptions: ['z축을 공유하는 무한 길이 이상 도체. 끝단 효과를 제외한 정전 평형.',
      '내부 +λ와 외부 −λ의 균형 전하, 외부장 없음. 외부 도체의 전위는 0 V.',
      'a<r<b 전체가 하나의 균질 선형 등방 유전체 ε=ε₀εᵣ. D=εE는 이 유전체에서 적용.',
      control === 'lambda' ? '제어량은 λ이며 ε 변화 중 선전하를 유지합니다.' : '제어량은 ΔV이며 전원에 의해 λ=C′ΔV가 조정됩니다.'],
    validity: ['0<a<b<c, εᵣ>0. 부호 있는 λ/ΔV를 지원합니다.', '전위는 외부 도체를 기준으로 정의합니다.',
      '도체 내부와 외부 E=D=0은 균형 전하/외부장 없음 가정에 한정됩니다.', '렌더링 화살표 크기를 정규화해도 반환 물리값은 SI 원값입니다.'],
    singularities: ['r=a,b,c는 boundary로 분류하고 Eᵣ,Dᵣ의 양측 극한을 표시합니다.',
      'r=0은 내부 도체에 속하며 E=0,V=ΔV로 유효합니다.', '도체 임의 형상·층상 유전체·비균형 전하·외부장을 계산하는 경계값 해석기가 아닙니다.'],
    formulas: [
      { label: '정전용량', text: 'C′ = 2πε / ln(b/a)', unit: 'F/m' },
      { label: '전하와 전압', text: 'λ = C′ΔV', unit: 'C/m' },
      { label: '유전체 장', text: 'a<r<b: E = λ/(2πεr) r̂ = ΔV/[r ln(b/a)] r̂; D = λ/(2πr) r̂', unit: 'V/m; C/m²' },
      { label: '전위', text: 'r<a: V=ΔV; a<r<b: V=ΔV ln(b/r)/ln(b/a); r>b: V=0', unit: 'V' },
      { label: '도체와 외부', text: 'r<a 또는 r>b: E=D=0 (명시된 이상 도체·균형 전하 가정)', unit: 'V/m; C/m²' },
    ], references: [{ ...reference }],
    symbolicControls, symbolic: (options = {}) => coaxSymbolic(options, symbolicControls),
    evaluate: (params, point) => evaluate(params, point, control), verify: params => verify(params, control),
  };
}

export const EXPERIMENTS = [definition('lambda'), definition('voltage')];
