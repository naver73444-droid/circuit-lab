// Lossless TEM only. e^{j omega t}, peak/cos. Load z=0; input z=-length.
// Forward voltage at load reference: Vplus e^{-j beta z}; +z current convention.
const REFERENCE = 'peak/cos; e^{jωt}; load z=0, input z=-length; I positive +z; V+ at load';
const SOURCE = 'https://ocw.mit.edu/courses/6-013-electromagnetics-and-applications-spring-2009/d3be4ea78b036a6362230fb41780cf54_MIT6_013S09_notes.pdf';
const PHASE_LIMIT = 2 ** 20;
const scalar = (key, label, value, unit) => ({ key, label, value, unit });
const phasor = (key, label, c, unit) => ({ key, label, re: c[0], im: c[1], unit, reference: REFERENCE });
const excluded = (status, reason, region = '') => ({ status, reason, region, vectors: {}, scalars: [], notes: [] });
const finiteTree = value => typeof value === 'number' ? Number.isFinite(value)
  : Array.isArray(value) ? value.every(finiteTree)
    : value && typeof value === 'object' ? Object.values(value).every(finiteTree) : true;
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const scale = (a, n) => [a[0] * n, a[1] * n];
const multiply = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const exp = angle => [Math.cos(angle), Math.sin(angle)];
const abs = c => Math.hypot(...c);
function divide(a, b) {
  const normalization = Math.max(Math.abs(b[0]), Math.abs(b[1]));
  if (normalization === 0 || !Number.isFinite(normalization)) return null;
  const re = b[0] / normalization, im = b[1] / normalization, denominator = re * re + im * im;
  const x = a[0] / normalization, y = a[1] / normalization;
  const result = [(x * re + y * im) / denominator, (y * re - x * im) / denominator];
  return result.every(Number.isFinite) ? result : null;
}
const realAt = (c, angle) => c[0] * Math.cos(angle) - c[1] * Math.sin(angle);
function prepare(p, point) {
  if (!p || (Object.getPrototypeOf(p) !== Object.prototype && Object.getPrototypeOf(p) !== null)
    || !Object.values(p).every(x => typeof x === 'number' && Number.isFinite(x))
    || !['z0', 'velocity', 'frequency', 'length', 'amplitude', 'phase', 'time', 'loadMode', 'loadResistance', 'loadReactance'].every(k => Number.isFinite(p[k]))) {
    return { error: excluded('invalid', '매개변수는 모든 필수 키를 가진 유한 SI 숫자 일반 객체여야 합니다.') };
  }
  if (!(p.z0 > 0 && p.velocity > 0 && p.frequency > 0 && p.length > 0 && p.amplitude >= 0)
    || ![0, 1, 2].includes(p.loadMode)) return { error: excluded('invalid', 'Z₀·속도·주파수·길이는 양수, 진폭은 음이 아닌 값, loadMode는 0/1/2여야 합니다.') };
  if (!Array.isArray(point) || point.length !== 3 || !point.every(x => typeof x === 'number' && Number.isFinite(x))) return { error: excluded('invalid', '점은 유한 숫자 3개의 미터 좌표여야 합니다.') };
  if (p.loadMode === 0 && p.loadResistance < 0) return { error: excluded('unsupported', '음의 부하 저항/능동 부하는 지원하지 않습니다.') };
  if (['attenuation', 'seriesResistance', 'shuntConductance'].some(k => p[k] !== undefined && p[k] !== 0)) return { error: excluded('unsupported', '손실·감쇠 모델은 지원하지 않습니다.') };
  const omega = 2 * Math.PI * p.frequency, beta = omega / p.velocity, wavelength = p.velocity / p.frequency;
  const inductancePerLength = p.z0 / p.velocity, capacitancePerLength = 1 / p.z0 / p.velocity;
  const delay = p.length / p.velocity;
  if (![omega, beta, wavelength, inductancePerLength, capacitancePerLength, delay].every(x => Number.isFinite(x) && x > 0)
    || !Number.isFinite(2 * delay)) return { error: excluded('invalid', '유도 파라미터가 유한 양수 수치 범위를 벗어났습니다.') };
  if ([p.phase, omega * p.time, beta * p.length, beta * point[2]].some(x => !Number.isFinite(x) || Math.abs(x) > PHASE_LIMIT)) return { error: excluded('invalid', '위상 인수의 수치 해상도 범위(2^20 rad)를 벗어났습니다. 좌표를 clamp하지 않습니다.') };
  let gamma, absorbedFraction;
  if (p.loadMode === 1) { gamma = [1, 0]; absorbedFraction = 0; }
  else if (p.loadMode === 2) { gamma = [-1, 0]; absorbedFraction = 0; }
  else {
    const normalization = Math.max(p.z0, p.loadResistance, Math.abs(p.loadReactance));
    const r = p.loadResistance / normalization, x = p.loadReactance / normalization, z = p.z0 / normalization;
    gamma = divide([r - z, x], [r + z, x]);
    absorbedFraction = 4 * r * z / ((r + z) ** 2 + x * x);
  }
  const rho = p.loadMode !== 0 || p.loadResistance === 0 ? 1 : gamma ? abs(gamma) : NaN;
  if (!gamma || ![...gamma, rho, absorbedFraction].every(Number.isFinite) || (p.loadMode === 0 && p.loadResistance > 0 && (rho >= 1 || absorbedFraction <= 0))) return { error: excluded('invalid', '반사/흡수 비율의 수치 표현 범위를 벗어났습니다. |Γ|를 clamp하지 않습니다.') };
  return { omega, beta, wavelength, inductancePerLength, capacitancePerLength, delay, gamma, rho, absorbedFraction };
}
function normalizedAt(z, state) {
  const forward = exp(-state.beta * z), reflected = multiply(state.gamma, exp(state.beta * z));
  return { voltage: add(forward, reflected), current: add(forward, scale(reflected, -1)), forward, reflected };
}
function impedanceAt(p, z, state) {
  const normalized = normalizedAt(z, state);
  // Only totally reflecting loads can have a real-axis impedance pole. This is a
  // floating-point cancellation envelope, NOT a distance clamp or a finite cap.
  // Propagation phase multiplication/reduction uncertainty grows with electrical
  // length. Within this budget a pole and a tiny detuning are numerically
  // inseparable; it is not a claim that the physical detuning is exactly zero.
  const currentTolerance = Number.EPSILON * (64 + 16 * (1 + Math.abs(state.beta * z)));
  if (state.rho === 1 && abs(normalized.current) <= currentTolerance) return { pole: true, currentTolerance };
  const impedance = divide(scale(normalized.voltage, p.z0), normalized.current);
  return impedance ? { impedance } : { error: true };
}
function evaluate(p, point) {
  const state = prepare(p, point);
  if (state.error) return state.error;
  if (point[0] !== 0 || point[1] !== 0) return excluded('unsupported', '전송선은 z축상의 V·I 모델입니다. 3D 장을 생성하지 않습니다.', 'off-axis');
  const z = point[2];
  if (z < -p.length || z > 0) return excluded('unsupported', '유한 선 구간 -length≤z≤0 밖은 지원하지 않습니다.', 'outside-line');
  const normalized = normalizedAt(z, state), drive = scale(exp(p.phase), p.amplitude);
  const voltage = multiply(drive, normalized.voltage), current = scale(multiply(drive, normalized.current), 1 / p.z0);
  const input = impedanceAt(p, -p.length, state), local = impedanceAt(p, z, state);
  if (input.error || local.error) return excluded('invalid', '임피던스의 유한 수치 범위를 벗어났습니다.');
  const incidentPower = p.amplitude * (p.amplitude / p.z0) / 2;
  const reflectedPower = incidentPower * state.rho * state.rho, averagePower = incidentPower * state.absorbedFraction;
  const voltageMagnitude = abs(voltage), currentMagnitude = abs(current);
  const averageEnergy = .25 * (state.capacitancePerLength * voltageMagnitude ** 2 + state.inductancePerLength * currentMagnitude ** 2);
  const boundary = z === 0 || z === -p.length, singular = input.pole || local.pole;
  const result = { status: singular ? 'singular' : boundary ? 'boundary' : 'valid',
    reason: singular ? '입력 또는 관측점이 임피던스 극점이거나 현재 위상 정밀도로 극점과 미소 이탈을 구별할 수 없습니다. 해당 Z를 생략하고 유한 V·I를 보존합니다.'
      : boundary ? '부하/입력 단자 경계입니다. 선측 V·I 극한을 표시합니다.' : '',
    region: z === 0 ? 'load-terminal' : z === -p.length ? 'input-terminal' : 'line-interior',
    vectors: {},
    scalars: [scalar('z', '부하 기준 위치 z', z, 'm'), scalar('voltage', '순간 전압', realAt(voltage, state.omega * p.time), 'V'),
      scalar('current', '+z 순간 전류', realAt(current, state.omega * p.time), 'A'),
      scalar('voltageMagnitude', '전압 피크 포락선 |V|', voltageMagnitude, 'V'), scalar('currentMagnitude', '전류 피크 포락선 |I|', currentMagnitude, 'A'),
      scalar('gammaMagnitude', '|Γ_L|', state.rho, '1'), scalar('beta', '위상 상수 β', state.beta, 'rad/m'), scalar('wavelength', '파장 λ', state.wavelength, 'm'),
      scalar('incidentPower', '입사 평균 전력', incidentPower, 'W'), scalar('reflectedPower', '반사 평균 전력', reflectedPower, 'W'),
      scalar('averagePower', '순 평균 전달 전력', averagePower, 'W'), scalar('averageEnergyPerLength', '평균 저장 에너지/길이', averageEnergy, 'J/m'),
      scalar('oneWayDelay', '편도 전파 시간', state.delay, 's'), scalar('roundTripDelay', '왕복 전파 시간', 2 * state.delay, 's')],
    phasors: [phasor('voltage', 'V(z)', voltage, 'V'), phasor('current', 'I(z)', current, 'A'),
      phasor('gammaLoad', 'Γ_L', state.gamma, '1'), phasor('gammaPosition', 'Γ(z)=Γ_L e^{2jβz}', multiply(state.gamma, exp(2 * state.beta * z)), '1')],
    notes: ['부하 z=0, 입력 z=-length. V⁺는 부하 위치에서의 입사 피크값이며 전류 기준은 +z입니다.', '평균 전력=Re(VI*)/2; 피크와 RMS를 혼동하지 않습니다. 지연은 전파 시간이며 과도 응답을 계산한 결과가 아닙니다.'] };
  if (input.impedance) result.phasors.push(phasor('inputImpedance', 'Z_in', input.impedance, 'Ω'));
  if (local.impedance) result.phasors.push(phasor('positionImpedance', 'Z(z)', local.impedance, 'Ω'));
  if (state.rho < 1) result.scalars.push(scalar('swr', '전압 정재파비 SWR', (1 + state.rho) / (1 - state.rho), '1'));
  else result.notes.push('SWR은 |Γ|=1에서 무한대이므로 유한 숫자를 제공하지 않습니다.');
  if (p.amplitude === 0) result.notes.push('구동이 0입니다. Γ·Z는 선/부하 특성으로 정의하지만 관측 V/I=0/0으로 계산하지 않습니다.');
  if (input.pole) result.notes.push('입력 극점/미분해 근접극점: inputImpedance 생략. 전기적 길이에 따른 위상 반올림 오차를 포함합니다.');
  if (local.pole) result.notes.push('관측점 극점/미분해 근접극점: positionImpedance 생략. 전기적 길이에 따른 위상 반올림 오차를 포함합니다.');
  if (!finiteTree(result) || (p.amplitude > 0 && (!(incidentPower > 0) || (voltageMagnitude === 0 && currentMagnitude === 0)))) return excluded('invalid', '전력·장 또는 임피던스 연산이 유한 수치 범위를 벗어났습니다.');
  return result;
}
function row(label, method, actual, expected, unit, relTolerance = 2e-5, absTolerance = 1e-12) {
  if (![actual, expected].every(Number.isFinite)) return { label, method, status: 'skipped', reason: '검증의 유한 수치 범위 밖입니다.', unit };
  const pass = Math.abs(actual - expected) <= absTolerance + relTolerance * Math.abs(expected);
  return { label, method, actual, expected, unit, relTolerance, absTolerance, status: pass ? 'pass' : 'fail', reason: pass ? '' : '독립 미분/적분 검증 불일치' };
}
function verify(p) {
  const state = prepare(p, [0, 0, 0]);
  if (state.error) return [{ label: '전송선 독립 검증', method: 'telegrapher residual / cycle power quadrature', status: 'skipped', reason: state.error.reason, unit: '1' }];
  const z = -p.length / 2, step = Math.min(p.length / 8, state.wavelength / 65536);
  const center = evaluate(p, [0, 0, z]), left = evaluate(p, [0, 0, z - step]), right = evaluate(p, [0, 0, z + step]);
  if ([center, left, right].some(r => !r.phasors?.length) || step === 0 || z - step === z || z + step === z) return [{ label: '전신 방정식 미분', method: 'central spatial derivative', status: 'skipped', reason: center.reason || left.reason || right.reason || '미분 간격을 표현할 수 없습니다.', unit: 'V/m' }];
  const V = center.phasors[0], I = center.phasors[1], derivative = (i, k) => (right.phasors[i][k] - left.phasors[i][k]) / (2 * step);
  const rows = [
    row('dV/dz 실수부', 'central derivative vs -jωL′I', derivative(0, 're'), state.omega * state.inductancePerLength * I.im, 'V/m'),
    row('dV/dz 허수부', 'central derivative vs -jωL′I', derivative(0, 'im'), -state.omega * state.inductancePerLength * I.re, 'V/m'),
    row('dI/dz 실수부', 'central derivative vs -jωC′V', derivative(1, 're'), state.omega * state.capacitancePerLength * V.im, 'A/m'),
    row('dI/dz 허수부', 'central derivative vs -jωC′V', derivative(1, 'im'), -state.omega * state.capacitancePerLength * V.re, 'A/m') ];
  let average = 0;
  for (let i = 0; i < 256; i++) {
    const angle = 2 * Math.PI * (i + .5) / 256;
    average += realAt([V.re, V.im], angle) * realAt([I.re, I.im], angle) / 256;
  }
  rows.push(row('독립 시간 평균 전력', '256 midpoint cycle samples vs incident minus reflected / load absorbed power', average, p.amplitude * (p.amplitude / p.z0) / 2 * state.absorbedFraction, 'W', 1e-10));
  if (p.loadMode === 0) {
    const load = evaluate(p, [0, 0, 0]);
    if (load.phasors?.length) {
      const voltage = load.phasors[0], current = load.phasors[1];
      const expected = multiply([p.loadResistance, p.loadReactance], [current.re, current.im]);
      rows.push(row('부하 V=Z_L I 실수부', 'complex Ohm boundary residual', voltage.re, expected[0], 'V', 1e-10),
        row('부하 V=Z_L I 허수부', 'complex Ohm boundary residual', voltage.im, expected[1], 'V', 1e-10));
    } else rows.push({ label: '부하 경계 잔차', method: 'complex Ohm boundary residual', status: 'skipped', reason: load.reason, unit: 'V' });
  }
  if (state.rho === 0) {
    let energy = 0;
    for (let i = 0; i < 128; i++) {
      const r = evaluate(p, [0, 0, -p.length * (i + .5) / 128]);
      if (!r.scalars.length) return [...rows, { label: '정합 저장 에너지', method: '128 midpoint spatial integral', status: 'skipped', reason: r.reason, unit: 'J' }];
      energy += r.scalars.find(s => s.key === 'averageEnergyPerLength').value * p.length / 128;
    }
    rows.push(row('정합 저장 에너지', '128 midpoint spatial integral vs P_incident × propagation time', energy, p.amplitude * (p.amplitude / p.z0) / 2 * state.delay, 'J', 1e-10, 1e-18));
  }
  return rows;
}
function profile(p, count = 81) {
  // count is the requested MINIMUM. Resolve the λ/2 standing-envelope period
  // with at least six intervals; do not render a capped, aliased full-line trace.
  const maxCount = 513;
  if (!Number.isInteger(count) || count < 2 || count > maxCount) return [];
  const state = prepare(p, [0, 0, 0]);
  if (state.error || !evaluate(p, [0, 0, 0]).phasors?.length) return [];
  const varying = state.rho > 0 && p.amplitude > 0;
  const maxStep = varying ? state.wavelength / 12 : p.length;
  if (!(maxStep > 0)) return [];
  const requiredCount = varying ? Math.ceil(12 * (p.length / state.wavelength)) + 1 : 2;
  const resolved = requiredCount <= maxCount;
  const actualCount = resolved ? Math.max(count, requiredCount) : 0;
  const sampling = { status: resolved ? 'resolved' : 'unresolved', requestedCount: count,
    requiredCount, actualCount, maxCount, maxStep };
  if (resolved) sampling.step = p.length / (actualCount - 1);
  const notes = resolved ? [] : [
    '정재파 프로파일 미해상: 파장당 최소 12구간에 ' + requiredCount
      + '점이 필요하지만 상한은 513점입니다. 선 길이를 줄이거나 주파수를 낮추세요. 오해를 막기 위해 선 데이터를 생략합니다.'
  ];
  const series = ['|V(z)|', '|I(z)|'].map((label, i) => ({ label, unit: i ? 'A' : 'V',
    coordinateUnit: 'm', points: [], reference: REFERENCE, sampling: { ...sampling }, notes: [...notes] }));
  if (!resolved) return series;
  for (let i = 0; i < actualCount; i++) {
    const z = i === actualCount - 1 ? 0 : -p.length + p.length * i / (actualCount - 1);
    const r = evaluate(p, [0, 0, z]);
    if (!r.phasors?.length) return [];
    r.phasors.slice(0, 2).forEach((c, k) => series[k].points.push({ coordinate: z, value: Math.hypot(c.re, c.im) }));
  }
  return series;
}

// Structural symbolic specializations of this existing lossless model; no CAS.
const transmissionSymbolicControls = [
  { key: 'loadMode', label: '기호 부하 조건', initial: 0, choices: [
    { value: 0, label: '유한 수동 R_L+jX_L' }, { value: 1, label: '이상 개방' },
    { value: 2, label: '이상 단락' }, { value: 3, label: '정합 Z_L=Z₀' }, { value: 4, label: '순리액턴스 jX_L' }
  ] },
  { key: 'lengthClass', label: '전기적 길이 조건', initial: 0, choices: [
    { value: 0, label: '일반 ℓ>0' }, { value: 1, label: 'ℓ=λ/4' }, { value: 2, label: 'ℓ=λ/2' }
  ] }
];
function transmissionSymbolic(options = {}) {
  const title = '무손실 전송선의 문자 풀이';
  const data = { status: 'supported', title, reason: '', givens: [], assumptions: [], conditions: [],
    laws: [], steps: [], answers: [], regions: [], boundaries: [],
    limitations: ['선택된 기존 무손실 TEM 모델의 기호 템플릿이며 범용 CAS·임의 네트워크 풀이기가 아닙니다.',
      '손실·분산·능동부하·고차모드·안테나·다중반사 과도 응답은 지원하지 않습니다.',
      '수치 프로파일의 미해상 경고/513점 상한·부동소수점 위상 오차는 선택적 예시의 한계이며 기호식 실패가 아닙니다.'] };
  const unsupported = () => ({ ...data, status: 'unsupported', reason: '구조 조건 loadMode/lengthClass의 enum만 받습니다. 물리 수치나 알 수 없는 키는 허용하지 않습니다.' });
  if (!options || (Object.getPrototypeOf(options) !== Object.prototype && Object.getPrototypeOf(options) !== null)
    || Object.keys(options).some(key => !transmissionSymbolicControls.some(c => c.key === key))) return unsupported();
  const selected = {};
  for (const control of transmissionSymbolicControls) {
    const value = Object.hasOwn(options, control.key) ? options[control.key] : control.initial;
    if (!control.choices.some(choice => choice.value === value)) return unsupported();
    selected[control.key] = value;
  }
  const mode = selected.loadMode, lengthClass = selected.lengthClass;
  const open = mode === 1, short = mode === 2, matched = mode === 3, reactive = mode === 4;
  const given = (symbol, meaning, unit, constraint) => ({ symbol, meaning, unit, constraint });
  const answer = (quantity, formula, unit, direction = '') => ({ quantity, formula, unit, direction });
  data.givens = [
    given('Z₀', '실수 특성 임피던스', 'Ω', 'Z₀>0'), given('v', '위상/전파 속도', 'm/s', 'v>0'),
    given('f', '단일 주파수', 'Hz', 'f>0'), given('ℓ', '입력에서 부하까지 선 길이', 'm', 'ℓ>0'),
    given('V⁺', '부하 z=0에 기준을 둔 입사 피크 복소 위상자', 'V', 'V⁺∈ℂ; 0도 허용'),
    given('z', '부하 기준 관측 좌표', 'm', '−ℓ≤z≤0'), given('t', '관측 시각', 's', 't∈ℝ')
  ];
  if (mode === 0) data.givens.push(given('R_L', '부하 저항', 'Ω', 'R_L≥0'), given('X_L', '부호 포함 부하 리액턴스', 'Ω', 'X_L∈ℝ; Z_L=R_L+jX_L'));
  if (reactive) data.givens.push(given('X_L', '순리액턴스의 부호 포함 크기', 'Ω', 'X_L∈ℝ, X_L≠0; Z_L=jX_L'));
  const lengthCondition = lengthClass === 1 ? 'ℓ=λ/4; βℓ=π/2' : lengthClass === 2 ? 'ℓ=λ/2; βℓ=π' : 'ℓ>0; βℓ는 일반 전기적 길이';
  const loadCondition = open ? '개방: Ĩ(0)=0, 유한 Z_L로 치환하지 않음' : short ? '단락: Ṽ(0)=0, Z_L=0'
    : matched ? '정합: Z_L=Z₀ (R_L=Z₀, X_L=0)' : reactive ? '순리액턴스: Z_L=jX_L, X_L≠0' : '유한 수동 부하: Z_L=R_L+jX_L, R_L≥0';
  const gamma = open ? '1' : short ? '−1' : matched ? '0' : reactive ? '(jX_L − Z₀) / (jX_L + Z₀)' : '(Z_L − Z₀) / (Z_L + Z₀)';
  const V = open ? 'Ṽ(z)=2V⁺cos(βz)' : short ? 'Ṽ(z)=−2jV⁺sin(βz)' : matched ? 'Ṽ(z)=V⁺e^{−jβz}' : 'Ṽ(z)=V⁺(e^{−jβz}+Γ_L e^{+jβz})';
  const I = open ? 'Ĩ(z)=−2j(V⁺/Z₀)sin(βz)' : short ? 'Ĩ(z)=2(V⁺/Z₀)cos(βz)' : matched ? 'Ĩ(z)=(V⁺/Z₀)e^{−jβz}' : 'Ĩ(z)=(V⁺/Z₀)(e^{−jβz}−Γ_L e^{+jβz})';
  let inputFormula, inputDomain;
  if (matched) { inputFormula = 'Z_in = Z₀'; inputDomain = '모든 ℓ>0, 입력 극점 없음'; }
  else if (lengthClass === 1) {
    if (open) { inputFormula = 'Z_in = 0'; inputDomain = '개방의 ¼파장 변환은 입력 단락'; }
    else if (short) { inputFormula = 'Z_in: pole; 유한 값 없음'; inputDomain = '단락의 ¼파장 변환은 입력 개방'; }
    else if (reactive) { inputFormula = 'Z_in = −j · Z₀² / X_L'; inputDomain = 'X_L≠0'; }
    else { inputFormula = 'Z_in = Z₀² / Z_L'; inputDomain = 'Z_L≠0이면 유한; Z_L=0이면 입력 극점'; }
  } else if (lengthClass === 2) {
    if (open) { inputFormula = 'Z_in: pole; 유한 값 없음'; inputDomain = '개방의 ½파장 변환은 입력 개방'; }
    else if (short) { inputFormula = 'Z_in = 0'; inputDomain = '단락의 ½파장 변환은 입력 단락'; }
    else if (reactive) { inputFormula = 'Z_in = j · X_L'; inputDomain = 'X_L≠0'; }
    else { inputFormula = 'Z_in = Z_L'; inputDomain = '유한 Z_L'; }
  } else if (open) {
    inputFormula = 'Z_in = −j · Z₀ · cot(βℓ)'; inputDomain = 'sin(βℓ)≠0; sin(βℓ)=0이면 입력 극점';
  } else if (short) {
    inputFormula = 'Z_in = j · Z₀ · tan(βℓ)'; inputDomain = 'cos(βℓ)≠0; cos(βℓ)=0이면 입력 극점';
  } else if (reactive) {
    inputFormula = 'Z_in = j · Z₀ · (X_L cos(βℓ)+Z₀ sin(βℓ)) / (Z₀ cos(βℓ)−X_L sin(βℓ))';
    inputDomain = 'Z₀ cos(βℓ)−X_L sin(βℓ)≠0; 0이면 입력 극점';
  } else {
    inputFormula = 'Z_in = Z₀ · (Z_L cos(βℓ)+jZ₀ sin(βℓ)) / (Z₀ cos(βℓ)+jZ_L sin(βℓ))';
    inputDomain = '분모≠0이면 유한; R_L>0이면 실수 축 위치의 극점 없음; R_L=0은 전류 영점 조건 확인';
  }
  const totallyReflecting = open || short || reactive;
  const swr = matched ? 'SWR = 1' : totallyReflecting ? 'SWR = ∞ (|Γ_L|=1; 유한 숫자 없음)' : 'SWR = (1+|Γ_L|)/(1−|Γ_L|), |Γ_L|<1; |Γ_L|=1이면 ∞';
  const power = matched ? 'P_net = |V⁺|² / (2 · Z₀)' : totallyReflecting ? 'P_net = 0'
    : 'P_net = |V⁺|² · (1−|Γ_L|²) / (2 · Z₀)';
  data.assumptions = ['균일 무손실 단일 TEM, L′>0,C′>0, e^{jωt} 피크/cos', '부하 z=0, 입력 z=−ℓ, 선축 전류 양의 방향 +z',
    'V⁺는 부하 기준 입사 위상자; 소스 임피던스/입사 진폭 결정 문제는 별도', loadCondition];
  data.conditions = ['Z₀>0, v>0, f>0, −ℓ≤z≤0', lengthCondition, loadCondition, inputDomain];
  data.laws = [
    { name: '무손실 전신 방정식', formula: 'dṼ/dz=−jωL′Ĩ; dĨ/dz=−jωC′Ṽ' },
    { name: '부하 경계조건', formula: open ? 'Ĩ(0)=0' : short ? 'Ṽ(0)=0' : matched ? 'Ṽ(0)=Z₀Ĩ(0)' : reactive ? 'Ṽ(0)=jX_L Ĩ(0)' : 'Ṽ(0)=Z_L Ĩ(0)' },
    { name: '평균 전력', formula: 'P_net=Re(ṼĨ*)/2=P_inc−P_ref' }
  ];
  data.steps = [
    { title: '전파 파라미터', formula: 'ω=2πf; β=ω/v; λ=v/f; Z₀=√(L′/C′); L′=Z₀/v; C′=1/(Z₀v)', explanation: '두 전신 방정식으로 파동 방정식과 특성 임피던스를 구합니다.' },
    { title: '반사계수의 경계 해', formula: 'Γ_L=' + gamma, explanation: loadCondition + '. 반사 전류에는 전압과 반대 부호가 붙습니다.' },
    { title: '선상의 위상자', formula: V + '; ' + I, explanation: '입사는 +z, 반사는 −z로 진행합니다. exp(−jβz)와 exp(+jβz)를 결합합니다.' },
    { title: '입력으로의 전달', formula: 'Ṽ(−ℓ)=Ṽ(0)cos(βℓ)+jZ₀Ĩ(0)sin(βℓ); Ĩ(−ℓ)=Ĩ(0)cos(βℓ)+jṼ(0)sin(βℓ)/Z₀', explanation: '부하 상태를 ABCD 행렬로 전파한 뒤 구동과 독립인 정규화 V/I를 취합니다.' },
    { title: '길이 조건 적용', formula: inputFormula, explanation: lengthCondition + '; ' + inputDomain },
    { title: '정재파와 전력', formula: swr + '; ' + power, explanation: '피크 복소 진폭이므로 평균 전력에 1/2가 필요합니다. 부하가 수동이면 순전력은 음이 아닙니다.' }
  ];
  data.answers = [
    answer('Γ_L', 'Γ_L = ' + gamma, '1', '전압 반사는 −z; 전류 반사 부호는 반대'),
    answer('Ṽ(z)', V, 'V', '+z 입사/−z 반사'), answer('Ĩ(z)', I, 'A', '기준 전류 +z; 반사 전류는 음의 진행 방향'),
    answer('Z_in', inputFormula, 'Ω', inputDomain),
    answer('Z(z)', 'Z(z)=Z₀(1+Γ_L e^{2jβz})/(1−Γ_L e^{2jβz})', 'Ω', '1−Γ_L e^{2jβz}≠0인 위치만 유한'),
    answer('SWR', swr, '1', '선 전체의 포락선 최대/최소 비; 국소 비율 아님'),
    answer('P_inc', 'P_inc = |V⁺|² / (2 · Z₀)', 'W', '+z 입사'),
    answer('P_net', power, 'W', '양수이면 +z 순전달; 개방/단락/순리액턴스는 평균0'),
    answer('V(t),I(t)', 'V(z,t)=Re(Ṽ(z)e^{jωt}); I(z,t)=Re(Ĩ(z)e^{jωt})', 'V, A'),
    answer('⟨u′⟩', '⟨u′⟩=(C′|Ṽ|²+L′|Ĩ|²)/4', 'J/m'),
    answer('τ', 'τ = ℓ / v', 's', '편도 전파 시간; 왕복2τ, 과도 응답 시뮬레이션 아님')
  ];
  if (matched) data.answers.push(answer('U_line', 'U_line = P_inc · τ', 'J', '정합 선의 주기 평균 저장 에너지'));
  data.regions = [{ condition: '−ℓ<z<0', formula: V + '; ' + I, explanation: '유한 선 내부의 V/I만 해석하며 3D E/H를 만들지 않습니다.' },
    { condition: 'z<−ℓ 또는 z>0', formula: '이 선 모델의 정의역 밖', explanation: '소스 또는 부하 외부의 장/회로를 임의 연장하지 않습니다.' }];
  data.boundaries = [
    { condition: 'z=0', formula: loadCondition, explanation: '선측 위상자 극한에 부하 경계조건을 적용합니다.' },
    { condition: 'z=−ℓ', formula: inputFormula, explanation: inputDomain + '; 단자 경계는 관측 위치를 뜻합니다.' },
    { condition: 'Γ_L e^{2jβz}=1', formula: '정규화 Ĩ(z)=0; Z(z)는 pole, 유한 값 없음', explanation: '전체 반사 부하에서만 실수 위치에 발생. 유한 V/I 장을 보존하고 무한 임피던스 숫자를 꾸미지 않습니다.' },
    { condition: 'V⁺=0', formula: 'Ṽ=Ĩ=0, P_net=0; Γ_L과 Z의 특성은 부하로 별도 정의', explanation: '구동 V/I=0/0으로 임피던스를 결정하지 않습니다. SWR도 반사계수에서 정의하는 선 특성이며, 무구동 포락선의 0/0 측정비는 정의하지 않습니다.' }
  ];
  if (!matched) data.boundaries.push({ condition: '|Γ_L|=1', formula: 'SWR=∞; P_net=0', explanation: '유한 수동 클래스에서도 R_L=0이면 이 조건이 포함됩니다.' });
  data.limitations.push('기호 loadMode3(정합)/4(순리액턴스)는 수치 loadMode0의 조건 특수화입니다. 수치 loadMode enum은 기존0/1/2를 유지합니다.');
  return data;
}

const parameter = (key, label, unit, initial, min, max, displayScale = 1, displayUnit = unit) => ({ key, label, unit, initial, min, max, displayScale, displayUnit });
export const EXPERIMENTS = [{
  symbolicControls: transmissionSymbolicControls, symbolic: transmissionSymbolic,
  id: 'transmission-lossless', title: '무손실 전송선·반사·정재파', topic: 'transmission', modelKind: 'analytic-symmetry',
  description: '부하를 z=0으로 둔 단일 주파수 TEM 전송선의 복소 V/I, 반사, 입력 임피던스와 전력을 계산합니다.',
  parameters: [parameter('z0', '특성 임피던스 Z₀', 'Ω', 50, .01, 1e6),
    parameter('velocity', '전파 속도 v', 'm/s', 2e8, 1, 1e9, 1e8, '10⁸ m/s'),
    parameter('frequency', '주파수 f', 'Hz', 1e8, 1, 1e12, 1e6, 'MHz'),
    parameter('length', '선 길이 ℓ', 'm', 1, 1e-6, 1e4),
    parameter('amplitude', '부하 기준 입사 V⁺ 피크', 'V', 2, 0, 1e6),
    parameter('phase', '입사 기준 위상', 'rad', 0, -100, 100), parameter('time', '관측 시각', 's', 0, -1, 1, 1e-9, 'ns'),
    parameter('loadMode', '부하: 0=R+jX, 1=개방, 2=단락', '1', 0, 0, 2),
    parameter('loadResistance', '부하 저항 R_L', 'Ω', 100, 0, 1e6), parameter('loadReactance', '부하 리액턴스 X_L', 'Ω', 0, -1e6, 1e6)],
  probeDefault: [0, 0, -.25], view: { kind: 'profile', plane: 'xz', extent: 1, probeAxes: [0, 2] },
  assumptions: ['균일·무손실 단일 TEM 모드, 실수 양수 Z₀·속도', '피크/cos 및 e^{jωt}; 부하 z=0, 입력 z=-ℓ, +z 전류', 'loadMode=0: 수동 R+jX(R≥0); 1: 이상 개방; 2: 이상 단락'],
  validity: ['-ℓ≤z≤0 선축 V/I 모델; 3D E/H는 계산하지 않음', '손실·분산·고차모드·안테나·능동부하·다중반사 과도 응답 제외', '각 위상 인수 |φ|≤2^20 rad; profile count는 요청 최소점 수(2..513), 파장당 12구간으로 증가; 필요점>513은 빈 points와 미해상 경고'],
  singularities: ['|Γ|=1이면 SWR 무한(숫자 생략)', 'Ĩ(z)=0의 극점 또는 위상 정밀도로 구분 불가능한 이탈: ε_machine[64+16(1+|βz|)] 정규화 전류 오차 예산, singular·Z 생략·유한 V/I 보존', '단자 z=-ℓ,0는 boundary로 선측 극한 표시'],
  formulas: [
    { label: '반사·위상자', text: 'Γ_L=(Z_L−Z₀)/(Z_L+Z₀); Ṽ=V⁺(e^{-jβz}+Γ_L e^{jβz}); Ĩ=V⁺(e^{-jβz}−Γ_L e^{jβz})/Z₀', unit: '1, V, A' },
    { label: '입력 임피던스', text: 'Z_in=Z₀(Z_L+jZ₀tanβℓ)/(Z₀+jZ_Ltanβℓ); ℓ=λ/4: Z_in=Z₀²/Z_L', unit: 'Ω' },
    { label: '정재파·전력', text: 'SWR=(1+|Γ_L|)/(1−|Γ_L|); P_net=|V⁺|²(1−|Γ_L|²)/(2Z₀)', unit: '1, W' },
    { label: '전파·에너지', text: 'β=ω/v; L′=Z₀/v, C′=1/(Z₀v); τ=ℓ/v; ⟨u′⟩=(C′|Ṽ|²+L′|Ĩ|²)/4', unit: 'rad/m, H/m, F/m, s, J/m' }],
  references: [{ title: 'MIT 6.013 notes §7.2–7.3: TEM, reflection, quarter-wave transformation', url: SOURCE }],
  evaluate, verify, profile
}];
