import { EPS0, MU0 } from './em-course-constants.js';

// e^{j omega t}; peak/cos phasors. +z wave has E_x, H_y.
const REFERENCE = 'peak/cos; e^{jωt}; incident +z e^{-jβz}; phase at z=0';
const SOURCE = 'https://ocw.mit.edu/courses/6-013-electromagnetics-and-applications-spring-2009/d3be4ea78b036a6362230fb41780cf54_MIT6_013S09_notes.pdf';
const PHASE_LIMIT = 2 ** 20;
const scalar = (key, label, value, unit) => ({ key, label, value, unit });
const phasor = (key, label, re, im, unit) => ({ key, label, re, im, unit, reference: REFERENCE });
const excluded = (status, reason, region = '') => ({ status, reason, region, vectors: {}, scalars: [], notes: [] });
const finiteTree = value => typeof value === 'number' ? Number.isFinite(value)
  : Array.isArray(value) ? value.every(finiteTree)
    : value && typeof value === 'object' ? Object.values(value).every(finiteTree) : true;
const complex = (amplitude, angle) => [amplitude * Math.cos(angle), amplitude * Math.sin(angle)];
const sum = (a, b) => [a[0] + b[0], a[1] + b[1]];
const scale = (a, n) => a.map(x => x * n);
const realAt = (a, angle) => a[0] * Math.cos(angle) - a[1] * Math.sin(angle);
function inputError(p, point, interfaced) {
  if (!p || (Object.getPrototypeOf(p) !== Object.prototype && Object.getPrototypeOf(p) !== null)
    || !Object.values(p).every(x => typeof x === 'number' && Number.isFinite(x))) return '매개변수는 유한 SI 숫자를 가진 일반 객체여야 합니다.';
  const keys = interfaced ? ['epsilonR1', 'muR1', 'epsilonR2', 'muR2'] : ['epsilonR', 'muR'];
  if (keys.some(key => !(p[key] > 0)) || !(p.frequency > 0) || !(p.amplitude >= 0)
    || !Number.isFinite(p.phase) || !Number.isFinite(p.time)) return '양의 εr·μr·주파수, 음이 아닌 피크 진폭, 유한 위상·시간이 필요합니다.';
  if (!Array.isArray(point) || point.length !== 3 || !point.every(x => typeof x === 'number' && Number.isFinite(x))) return '점은 유한 숫자 3개의 미터 좌표여야 합니다.';
  return '';
}
function material(er, mr, frequency) {
  const epsilon = EPS0 * er, mu = MU0 * mr;
  const eta = Math.sqrt(mu) / Math.sqrt(epsilon);
  const slowness = Math.sqrt(mu) * Math.sqrt(epsilon);
  const velocity = 1 / slowness, omega = 2 * Math.PI * frequency, beta = omega * slowness, wavelength = velocity / frequency;
  if (![epsilon, mu, eta, velocity, omega, beta, wavelength].every(x => Number.isFinite(x) && x > 0)) return null;
  return { epsilon, mu, eta, velocity, omega, beta, wavelength };
}
function prepare(p, point, interfaced) {
  const reason = inputError(p, point, interfaced);
  if (reason) return { error: excluded('invalid', reason) };
  if (['conductivity', 'attenuation', 'incidenceAngle'].some(k => p[k] !== undefined && p[k] !== 0)) {
    return { error: excluded('unsupported', '손실·감쇠·경사 입사는 이 무손실 정상입사 모델의 지원 범위 밖입니다.') };
  }
  const m1 = material(interfaced ? p.epsilonR1 : p.epsilonR, interfaced ? p.muR1 : p.muR, p.frequency);
  const m2 = interfaced ? material(p.epsilonR2, p.muR2, p.frequency) : m1;
  if (!m1 || !m2) return { error: excluded('invalid', '유도 물성·주파수가 유한 양수 수치 범위를 벗어났습니다.') };
  const angles = [p.phase, m1.omega * p.time, (point[2] > 0 ? m2.beta : m1.beta) * point[2]];
  if (angles.some(x => !Number.isFinite(x) || Math.abs(x) > PHASE_LIMIT)) return { error: excluded('invalid', '위상 인수의 수치 해상도 범위(2^20 rad)를 벗어났습니다. 좌표를 clamp하지 않습니다.') };
  // Scaled impedances avoid overflow of eta1+eta2.
  const maximum = Math.max(m1.eta, m2.eta), n1 = m1.eta / maximum, n2 = m2.eta / maximum;
  const gamma = interfaced ? (n2 - n1) / (n2 + n1) : 0;
  const transmission = interfaced ? 2 * n2 / (n1 + n2) : 1;
  const reflectance = gamma * gamma, transmittance = interfaced ? 4 * n1 * n2 / ((n1 + n2) ** 2) : 1;
  const incidentPower = p.amplitude * (p.amplitude / m1.eta) / 2;
  if (!(n1 > 0 && n2 > 0 && transmittance > 0) || !Number.isFinite(incidentPower)
    || (p.amplitude > 0 && (!(incidentPower > 0) || !(incidentPower * transmittance > 0)))) {
    return { error: excluded('invalid', '입사/투과 전력 또는 물성 대비의 수치 표현 범위를 벗어났습니다.') };
  }
  return { m1, m2, gamma, transmission, reflectance, transmittance };
}
function amplitudes(p, z, state, interfaced) {
  const { m1, m2, gamma, transmission } = state;
  if (interfaced && z > 0) {
    const E = complex(p.amplitude * transmission, p.phase - m2.beta * z);
    return { E, H: scale(E, 1 / m2.eta), medium: m2, region: 'medium-2' };
  }
  const incident = complex(p.amplitude, p.phase - m1.beta * z);
  const reflected = complex(p.amplitude * gamma, p.phase + m1.beta * z);
  return { E: sum(incident, reflected), H: scale(sum(incident, scale(reflected, -1)), 1 / m1.eta), medium: m1, region: interfaced ? 'medium-1' : 'homogeneous-medium' };
}
function evaluate(p, point, interfaced = false) {
  const state = prepare(p, point, interfaced);
  if (state.error) return state.error;
  if (interfaced && point[2] === 0) return excluded('boundary', 'z=0는 재료 경계입니다. 접선 E·H는 연속이지만 D·B의 재료별 값을 위해 좌·우 극한을 선택하세요.', 'interface');
  const { E, H, medium: m, region } = amplitudes(p, point[2], state, interfaced);
  const ex = realAt(E, m.omega * p.time), hy = realAt(H, m.omega * p.time);
  const averageS = .5 * (E[0] * H[0] + E[1] * H[1]);
  const averageEnergy = .25 * (m.epsilon * Math.hypot(...E) ** 2 + m.mu * Math.hypot(...H) ** 2);
  const result = { status: 'valid', reason: '', region,
    vectors: { E: [ex, 0, 0], D: [m.epsilon * ex, 0, 0], H: [0, hy, 0], B: [0, m.mu * hy, 0] },
    scalars: [scalar('impedance', '파동 임피던스 η', m.eta, 'Ω'), scalar('velocity', '위상 속도 v', m.velocity, 'm/s'),
      scalar('beta', '위상 상수 β', m.beta, 'rad/m'), scalar('wavelength', '파장 λ', m.wavelength, 'm'),
      scalar('poyntingZ', '순간 Poynting S_z', ex * hy, 'W/m²'), scalar('averagePoyntingZ', '평균 Poynting S_z', averageS, 'W/m²'),
      scalar('averageEnergyDensity', '평균 전자기 에너지 밀도', averageEnergy, 'J/m³')],
    phasors: [phasor('electricX', 'E_x', ...E, 'V/m'), phasor('magneticY', 'H_y', ...H, 'A/m')],
    notes: ['E는 x, H는 y 방향. 반사파 H는 E에 대해 부호가 반전되어 에너지가 -z로 흐릅니다.', '위상자·진폭은 피크값이며 평균 전력은 Re(E×H*)/2입니다.'] };
  if (interfaced) result.scalars.push(
    scalar('gammaE', '전기장 반사 계수 Γ_E', state.gamma, '1'), scalar('transmissionE', '전기장 투과 계수 T_E', state.transmission, '1'),
    scalar('reflectance', '전력 반사율 R', state.reflectance, '1'), scalar('transmittance', '전력 투과율 T', state.transmittance, '1'));
  if (!finiteTree(result) || (p.amplitude > 0 && (!(Math.hypot(...E) > 0) || !(Math.hypot(...H) > 0) || !(averageEnergy > 0) || !(averageS > 0)))) return excluded('invalid', '장의 수치 연산이 유한 표현 범위를 벗어났습니다.');
  return result;
}
function row(label, method, actual, expected, unit, relTolerance = 2e-5, absTolerance = 1e-12) {
  if (![actual, expected].every(Number.isFinite)) return { label, method, status: 'skipped', reason: '검증의 유한 수치 범위를 벗어났습니다.', unit };
  const pass = Math.abs(actual - expected) <= absTolerance + relTolerance * Math.abs(expected);
  return { label, method, actual, expected, unit, relTolerance, absTolerance, status: pass ? 'pass' : 'fail', reason: pass ? '' : '독립 미분/적분과 수치 허용오차 불일치' };
}
function verify(p, interfaced = false) {
  const state = prepare(p, [0, 0, 0], interfaced);
  if (state.error) return [{ label: '파동 독립 검증', method: 'Maxwell residual / time quadrature', status: 'skipped', reason: state.error.reason, unit: '1' }];
  const { m1, m2 } = state, step = m1.wavelength / 65536, z = -m1.wavelength / 8;
  const e0 = evaluate(p, [0, 0, z], interfaced), em = evaluate(p, [0, 0, z - step], interfaced), ep = evaluate(p, [0, 0, z + step], interfaced);
  if ([e0, em, ep].some(r => r.status !== 'valid')) return [{ label: 'Maxwell 미분', method: 'central spatial derivative', status: 'skipped', reason: e0.reason || em.reason || ep.reason, unit: 'V/m²' }];
  const E = e0.phasors[0], H = e0.phasors[1], derivative = (i, key) => (ep.phasors[i][key] - em.phasors[i][key]) / (2 * step);
  const rows = [
    row('dE_x/dz 실수부', 'central derivative vs -jωμH_y', derivative(0, 're'), m1.omega * m1.mu * H.im, 'V/m²'),
    row('dE_x/dz 허수부', 'central derivative vs -jωμH_y', derivative(0, 'im'), -m1.omega * m1.mu * H.re, 'V/m²'),
    row('dH_y/dz 실수부', 'central derivative vs -jωεE_x', derivative(1, 're'), m1.omega * m1.epsilon * E.im, 'A/m²'),
    row('dH_y/dz 허수부', 'central derivative vs -jωεE_x', derivative(1, 'im'), -m1.omega * m1.epsilon * E.re, 'A/m²') ];
  let sumPower = 0;
  for (let i = 0; i < 256; i++) {
    const angle = 2 * Math.PI * (i + .5) / 256;
    sumPower += realAt([E.re, E.im], angle) * realAt([H.re, H.im], angle) / 256;
  }
  rows.push(row('시간 평균 Poynting', '256 midpoint samples over a cycle', sumPower, p.amplitude ** 2 / (2 * m1.eta) * state.transmittance, 'W/m²', 1e-10));
  if (interfaced) {
    const left = amplitudes(p, 0, state, true);
    const rightE = complex(p.amplitude * state.transmission, p.phase), rightH = scale(rightE, 1 / m2.eta);
    for (const [key, values, target, unit] of [['E', left.E, rightE, 'V/m'], ['H', left.H, rightH, 'A/m']]) {
      values.forEach((actual, i) => rows.push(row('접선 ' + key + (i ? ' 허수부' : ' 실수부'), 'one-sided interface limit', actual, target[i], unit, 1e-10)));
    }
    rows.push(row('무손실 R+T', 'impedance-weighted transmitted power balance', state.reflectance + state.transmittance, 1, '1', 1e-11));
  }
  return rows;
}
function profile(p, count = 81, interfaced = false) {
  if (!Number.isInteger(count) || count < 2 || count > 513) return [];
  const state = prepare(p, [0, 0, 0], interfaced);
  if (state.error) return [];
  const extent = state.m1.wavelength;
  const series = ['|E_x(z)|', '|H_y(z)|'].map((label, i) => ({ label, unit: i ? 'A/m' : 'V/m', coordinateUnit: 'm', points: [], reference: REFERENCE + '; z=0 interface, limits for tangential E/H' }));
  for (let i = 0; i < count; i++) {
    const z = -extent + 2 * extent * i / (count - 1);
    if (prepare(p, [0, 0, z], interfaced).error) return [];
    const value = amplitudes(p, z, state, interfaced);
    const magnitudes = [Math.hypot(...value.E), Math.hypot(...value.H)];
    if (!magnitudes.every(Number.isFinite)) return [];
    magnitudes.forEach((magnitude, k) => series[k].points.push({ coordinate: z, value: magnitude }));
  }
  return series;
}

// Symbolic-only structural templates. No physical sample values or CAS.
const waveSymbolicControls = [
  { key: 'materialMode', label: '매질 조건', initial: 0, choices: [{ value: 0, label: '양의 실수 ε·μ 매질' }, { value: 1, label: '진공 ε₀·μ₀' }] },
  { key: 'propagation', label: '진행 방향', initial: 0, choices: [{ value: 0, label: '+z 진행' }, { value: 1, label: '−z 진행' }] }
];
const interfaceSymbolicControls = [
  { key: 'incidenceSide', label: '입사 쪽', initial: 0, choices: [{ value: 0, label: '매질1 → 매질2 (+z)' }, { value: 1, label: '매질2 → 매질1 (−z)' }] },
  { key: 'impedanceRelation', label: '목표/입사 임피던스', initial: 0, choices: [
    { value: 0, label: '일반 η_t, η_i' }, { value: 1, label: 'η_t = η_i 정합' },
    { value: 2, label: 'η_t > η_i' }, { value: 3, label: 'η_t < η_i' }
  ] }
];
function waveSymbolicBase(title) {
  return { status: 'supported', title, reason: '', givens: [], assumptions: [], conditions: [],
    laws: [], steps: [], answers: [], regions: [], boundaries: [],
    limitations: ['명시된 무손실 평면파의 기호 템플릿이며 범용 CAS·자유문장 풀이기가 아닙니다.',
      '손실·분산·경사 입사·비선형/이방성·고차모드·안테나 해석은 지원하지 않습니다.',
      '기호식의 정의역은 수학적 매질 모델입니다. 선택적 수치 예시의 위상/부동소수점 범위·프로파일 제한은 별도입니다.'] };
}
function waveStructuralOptions(options, controls) {
  if (!options || (Object.getPrototypeOf(options) !== Object.prototype && Object.getPrototypeOf(options) !== null)) return null;
  if (Object.keys(options).some(key => !controls.some(c => c.key === key))) return null;
  const selected = {};
  for (const control of controls) {
    const value = Object.hasOwn(options, control.key) ? options[control.key] : control.initial;
    if (!control.choices.some(choice => choice.value === value)) return null;
    selected[control.key] = value;
  }
  return selected;
}
function waveSymbolicUnsupported(title) {
  return { ...waveSymbolicBase(title), status: 'unsupported', reason: '구조 조건의 선택값만 받습니다. 물리 수치·알 수 없는 키·잘못된 enum은 기호풀이 입력이 아닙니다.' };
}
const waveGiven = (symbol, meaning, unit, constraint) => ({ symbol, meaning, unit, constraint });
const waveAnswer = (quantity, formula, unit, direction = '') => ({ quantity, formula, unit, direction });
function mediumSymbolic(options = {}) {
  const title = '무손실 매질 평면파의 문자 풀이';
  const selected = waveStructuralOptions(options, waveSymbolicControls);
  if (!selected) return waveSymbolicUnsupported(title);
  const vacuum = selected.materialMode === 1, reverse = selected.propagation === 1;
  const epsilon = vacuum ? 'ε₀' : 'ε', mu = vacuum ? 'μ₀' : 'μ';
  const sign = reverse ? '−' : '+', phase = reverse ? 'ωt + βz + φ' : 'ωt − βz + φ';
  const spatial = reverse ? 'e^{+jβz}' : 'e^{−jβz}';
  const magneticSign = reverse ? '−' : '';
  const data = waveSymbolicBase(title);
  data.givens = [
    waveGiven(epsilon, vacuum ? '진공 유전율' : '균질 매질 유전율', 'F/m', epsilon + ' > 0'),
    waveGiven(mu, vacuum ? '진공 투자율' : '균질 매질 투자율', 'H/m', mu + ' > 0'),
    waveGiven('E₀', '전기장 피크 진폭', 'V/m', 'E₀ ≥ 0'),
    waveGiven('f', '주파수', 'Hz', 'f > 0'), waveGiven('φ', 'z=0 피크/cos 위상', 'rad', 'φ ∈ ℝ'),
    waveGiven('z', '진행축 관측 좌표', 'm', 'z ∈ ℝ'), waveGiven('t', '관측 시각', 's', 't ∈ ℝ')
  ];
  data.assumptions = ['선형·균질·등방성 무손실 매질, 자유 전하·전류 없음', 'x 선형 편광; 시간 관례 e^{jωt}, 피크/cos 위상자',
    vacuum ? 'ε=ε₀, μ=μ₀인 진공' : 'ε,μ가 양의 실수인 일반 매질', '단일 ' + sign + 'z 진행파, 반사파 없음'];
  data.conditions = [epsilon + '>0, ' + mu + '>0, f>0, E₀≥0', 'k̂=' + sign + 'ẑ, E 편광축 x̂', 'z,t는 실수; 횡방향 x,y에 무관'];
  data.laws = [{ name: '시간조화 Maxwell 방정식', formula: '∇×Ẽ=−jωμH̃; ∇×H̃=jωεẼ' },
    { name: '구성 관계', formula: 'D̃=εẼ; B̃=μH̃' }, { name: '평균 Poynting', formula: '⟨S⟩=Re(Ẽ×H̃*)/2' }];
  data.steps = [
    { title: '파동 방정식', formula: '∂²Ẽ_x/∂z² + β²Ẽ_x = 0; β²=ω²' + mu + epsilon, explanation: '소스가 없는 균질 Maxwell 식의 curl을 한 번 더 취합니다.' },
    { title: '물성과 위상', formula: 'η=√(' + mu + '/' + epsilon + '); v=1/√(' + mu + epsilon + '); ω=2πf; β=ω/v; λ=v/f', explanation: '선택한 진행 방향은 공간 지수의 부호로 정합니다.' },
    { title: '자기장 방향', formula: 'H̃=(k̂×Ẽ)/η=' + magneticSign + 'ŷ(E₀/η)e^{jφ}' + spatial, explanation: 'ẑ×x̂=ŷ이므로 진행을 뒤집으면 H와 에너지 흐름 방향이 바뀝니다.' },
    { title: '실제 장과 전력', formula: 'E=Re(Ẽe^{jωt}); H=Re(H̃e^{jωt}); ⟨u⟩=' + epsilon + 'E₀²/2', explanation: '피크값의 평균 전력에는 1/2, 평균 전기·자기 에너지 각각에는 1/4가 들어갑니다.' }
  ];
  data.answers = [
    waveAnswer('η', 'η = √(' + mu + ' / ' + epsilon + ')', 'Ω'),
    waveAnswer('v', 'v = 1 / √(' + mu + ' · ' + epsilon + ')', 'm/s'),
    waveAnswer('β', 'β = ω / v', 'rad/m'), waveAnswer('λ', 'λ = v / f', 'm'),
    waveAnswer('Ẽ', 'Ẽ = x̂ E₀ e^{jφ} ' + spatial, 'V/m', '편광축 x̂; 위상 진행은 ' + sign + 'z'),
    waveAnswer('H̃', 'H̃ = ' + magneticSign + 'ŷ (E₀/η) e^{jφ} ' + spatial, 'A/m', reverse ? 'Ẽ_x에 대한 H̃_y 부호는 음; k̂=−ẑ' : 'Ẽ_x에 대한 H̃_y 부호는 양; k̂=+ẑ'),
    waveAnswer('E,H', 'E=x̂E₀cos(' + phase + '); H=' + magneticSign + 'ŷ(E₀/η)cos(' + phase + ')', 'V/m, A/m', 'E⊥H⊥k'),
    waveAnswer('⟨S_z⟩', '⟨S_z⟩ = ' + magneticSign + 'E₀² / (2 · η)', 'W/m²', sign + 'z 에너지 흐름; E₀=0이면 0'),
    waveAnswer('⟨u⟩', '⟨u⟩ = ' + epsilon + ' · E₀² / 2', 'J/m³'),
    waveAnswer('D̃,B̃', 'D̃=' + epsilon + 'Ẽ; B̃=' + mu + 'H̃', 'C/m², T')
  ];
  data.regions = [{ condition: '모든 z∈ℝ', formula: 'Ẽ,H̃는 위의 단일 진행파', explanation: '동일한 양의 실수 물성이 전체 공간에 적용됩니다.' }];
  data.boundaries = [{ condition: 'z=0', formula: 'Ẽ(0)=x̂E₀e^{jφ}; H̃(0)=' + magneticSign + 'ŷ(E₀/η)e^{jφ}', explanation: '위상의 기준면이지 재료 경계·특이점은 아닙니다.' }];
  data.limitations.push('기존 선택적 수치 evaluator는 +z,x 편광 좌표계입니다. −z 기호 분기는 같은 모델의 좌표 반사로 검증합니다.');
  return data;
}
function interfaceSymbolic(options = {}) {
  const title = '정상입사 재료 경계의 문자 풀이';
  const selected = waveStructuralOptions(options, interfaceSymbolicControls);
  if (!selected) return waveSymbolicUnsupported(title);
  const reverse = selected.incidenceSide === 1, matched = selected.impedanceRelation === 1;
  const i = reverse ? '₂' : '₁', t = reverse ? '₁' : '₂';
  const incoming = reverse ? 'z>0' : 'z<0', transmitted = reverse ? 'z<0' : 'z>0';
  const sign = reverse ? '−' : '+', magneticSign = reverse ? '−' : '';
  const incidentSpatial = reverse ? 'e^{+jβ₂z}' : 'e^{−jβ₁z}';
  const reflectedSpatial = reverse ? 'e^{−jβ₂z}' : 'e^{+jβ₁z}';
  const transmittedSpatial = reverse ? 'e^{+jβ₁z}' : 'e^{−jβ₂z}';
  const etaI = 'η' + i, etaT = 'η' + t;
  const relations = ['임피던스 크기 관계 미지정', etaT + '=' + etaI, etaT + '>' + etaI, etaT + '<' + etaI];
  const gamma = matched ? '0' : '(' + etaT + ' − ' + etaI + ') / (' + etaT + ' + ' + etaI + ')';
  const transmission = matched ? '1' : '2 · ' + etaT + ' / (' + etaT + ' + ' + etaI + ')';
  const Einc = matched ? 'x̂ A ' + incidentSpatial : 'x̂ A (' + incidentSpatial + ' + Γ_E ' + reflectedSpatial + ')';
  const Hinc = matched ? magneticSign + 'ŷ (A/' + etaI + ') ' + incidentSpatial
    : magneticSign + 'ŷ (A/' + etaI + ') (' + incidentSpatial + ' − Γ_E ' + reflectedSpatial + ')';
  const Et = 'x̂ A T_E ' + transmittedSpatial, Ht = magneticSign + 'ŷ (A T_E/' + etaT + ') ' + transmittedSpatial;
  const data = waveSymbolicBase(title);
  data.givens = [
    waveGiven('ε₁,ε₂', '각 반공간의 유전율', 'F/m', 'ε₁>0, ε₂>0'), waveGiven('μ₁,μ₂', '각 반공간의 투자율', 'H/m', 'μ₁>0, μ₂>0'),
    waveGiven('E₀', '입사 전기장 피크', 'V/m', 'E₀≥0'), waveGiven('φ', '경계 기준 입사 위상', 'rad', 'φ∈ℝ'),
    waveGiven('f', '공통 주파수', 'Hz', 'f>0'), waveGiven('z', '경계 기준 위치', 'm', '매질1:z<0; 매질2:z>0'),
    waveGiven('t', '관측 시각', 's', 't∈ℝ')
  ];
  data.assumptions = ['무한 평면 z=0에서 정상입사, x 편광, e^{jωt} 피크/cos', '양쪽 선형·균질·등방성·무손실; 자유 표면전하·표면전류 없음',
    '입사 매질' + i + '에서 ' + sign + 'z 진행; 반대쪽에서 오는 추가 입사파 없음'];
  data.conditions = ['모든 ε_k,μ_k>0, k=1,2; f>0', relations[selected.impedanceRelation], 'A=E₀e^{jφ}; η_k=√(μ_k/ε_k); β_k=ω√(μ_kε_k); ω=2πf'];
  data.laws = [{ name: '접선 전기장 연속', formula: 'Ẽ_i(0)+Ẽ_r(0)=Ẽ_t(0)' },
    { name: '접선 자기장 연속', formula: '(Ẽ_i(0)−Ẽ_r(0))/' + etaI + '=Ẽ_t(0)/' + etaT },
    { name: '피크 평균 전력', formula: '⟨S⟩=Re(Ẽ×H̃*)/2' }];
  const phaseAnswer = matched ? '반사파 없음; 반사 위상은 정의하지 않음'
    : selected.impedanceRelation === 2 ? 'Δφ_E,r=0 (Γ_E>0)' : selected.impedanceRelation === 3 ? 'Δφ_E,r=π (Γ_E<0)' : 'Γ_E>0: Δφ_E,r=0; Γ_E<0: Δφ_E,r=π; Γ_E=0: 위상 미정';
  data.steps = [
    { title: '진행 방향과 반사파', formula: 'Ẽ_i=x̂A' + incidentSpatial + '; Ẽ_r=x̂AΓ_E' + reflectedSpatial + '; H̃_r 부호는 반대', explanation: '반사파가 반대 방향으로 진행하므로 H는 E와 같은 반사 부호를 쓰지 않습니다.' },
    { title: '계수의 연립 경계조건', formula: '1+Γ_E=T_E; (1−Γ_E)/' + etaI + '=T_E/' + etaT, explanation: '경계에서 두 위상자가 모든 시각에 같은 접선 E,H를 만들어야 합니다.' },
    { title: '선택된 조건의 계수', formula: 'Γ_E=' + gamma + '; T_E=' + transmission, explanation: relations[selected.impedanceRelation] + '; ' + phaseAnswer },
    { title: '전력과 임피던스 인자', formula: 'R=Γ_E²; T=(' + etaI + '/' + etaT + ')T_E²; R+T=1', explanation: '전기장 투과 진폭이 1보다 커도 목표 매질의 임피던스 인자가 전력 보존을 결정합니다.' }
  ];
  data.answers = [
    waveAnswer('Γ_E', 'Γ_E = ' + gamma, '1', phaseAnswer), waveAnswer('T_E', 'T_E = ' + transmission, '1'),
    waveAnswer('R', matched ? 'R = 0' : 'R = Γ_E²', '1'),
    waveAnswer('T', matched ? 'T = 1' : 'T = (' + etaI + ' / ' + etaT + ') · T_E²', '1'),
    waveAnswer('⟨S_z⟩', '⟨S_z⟩ = ' + magneticSign + 'E₀² · T / (2 · ' + etaI + ')', 'W/m²', sign + 'z 순 에너지 흐름'),
    waveAnswer('Ẽ,H̃', incoming + ': Ẽ=' + Einc + '; H̃=' + Hinc + '\n' + transmitted + ': Ẽ=' + Et + '; H̃=' + Ht, 'V/m, A/m', '입사/투과 ' + sign + 'z; 반사는 반대 방향'),
    waveAnswer('D̃,B̃', '매질k에서 D̃_k=ε_kẼ_k; B̃_k=μ_kH̃_k', 'C/m², T', '접선 E,H 편광축을 따릅니다.')
  ];
  data.regions = [
    { condition: incoming, formula: 'Ẽ=' + Einc + '; H̃=' + Hinc, explanation: '입사 매질' + i + ': ' + (matched ? '정합으로 반사파 없음' : '입사파와 반사파 중첩') },
    { condition: transmitted, formula: 'Ẽ=' + Et + '; H̃=' + Ht, explanation: '목표 매질' + t + ': ' + sign + 'z 투과파만 존재' }
  ];
  data.boundaries = [{ condition: 'z=0', formula: 'Ẽ(0−)=Ẽ(0+)=x̂AT_E; H̃(0−)=H̃(0+)=' + magneticSign + 'ŷAT_E/' + etaT, explanation: '접선 E,H는 연속. 접선 D,B는 각 ε,μ로 정해지는 양측 극한이며 단일 값을 임의 선택하지 않습니다.' },
    { condition: etaT + '=' + etaI, formula: 'Γ_E=0; T_E=1; R=0; T=1', explanation: '속도나 ε,μ가 개별적으로 달라도 임피던스가 같으면 반사가 없습니다.' }];
  data.limitations.push('기존 수치 evaluator는 매질1에서 +z 입사입니다. 반대 입사는 매질/좌표를 반사시킨 동일 모델로 검증합니다.');
  return data;
}

const parameter = (key, label, unit, initial, min, max, displayScale = 1, displayUnit = unit) => ({ key, label, unit, initial, min, max, displayScale, displayUnit });
const excitation = [
  parameter('frequency', '주파수 f', 'Hz', 1e8, 1, 1e12, 1e6, 'MHz'),
  parameter('amplitude', '입사 전기장 피크', 'V/m', 10, 0, 1e6),
  parameter('phase', 'z=0 기준 위상', 'rad', 0, -100, 100),
  parameter('time', '관측 시각', 's', 0, -1, 1, 1e-9, 'ns') ];
const metadata = {
  topic: 'waves', modelKind: 'analytic-symmetry', view: { kind: 'profile', plane: 'xz', extent: 3, probeAxes: [0, 2] },
  assumptions: ['선형·균질·등방성, ε·μ가 양의 실수인 무손실 매질', '단일 주파수, x 선형 편광, e^{jωt} 피크/cos 관례', '무한 횡단면의 평면파; 반사파 이외 외부 소스 없음'],
  validity: ['재료별 정상 평면파. 손실·분산·고차모드·방사·안테나 해석 제외', '유한 수치 및 각 위상 인수 |φ|≤2^20 rad 범위'],
  singularities: ['양의 유한 물성에서 장의 공간 특이점 없음', '정상입사 실험의 z=0 재료 경계는 boundary로 반환'],
  references: [{ title: 'MIT 6.013 notes §2.3, §2.7, §9.1', url: SOURCE }] };
export const EXPERIMENTS = [
  { ...metadata, symbolicControls: waveSymbolicControls, symbolic: mediumSymbolic, id: 'wave-medium', title: '무손실 매질의 평면파', description: '물성과 속도·임피던스, E/H·Poynting 및 피크 위상자를 비교합니다.',
    parameters: [parameter('epsilonR', '상대 유전율 εr', '1', 4, .01, 1e6), parameter('muR', '상대 투자율 μr', '1', 1, .01, 1e6), ...excitation],
    probeDefault: [0, 0, .25],
    formulas: [{ label: '물성', text: 'η=√(μ/ε), v=1/√(με), β=ω/v', unit: 'Ω, m/s, rad/m' },
      { label: '평면파', text: 'Ẽ_x=E₀e^{jφ}e^{-jβz}, H̃_y=Ẽ_x/η; ⟨S_z⟩=E₀²/(2η)', unit: 'V/m, A/m, W/m²' }],
    evaluate: (p, point) => evaluate(p, point), verify: p => verify(p), profile: (p, count) => profile(p, count) },
  { ...metadata, symbolicControls: interfaceSymbolicControls, symbolic: interfaceSymbolic, id: 'wave-interface-normal', title: '정상입사 반사·투과', description: 'z=0 재료 경계에서 접선 장의 연속성과 임피던스를 포함한 전력 보존을 봅니다.',
    parameters: [parameter('epsilonR1', '매질1 εr', '1', 1, .01, 1e6), parameter('muR1', '매질1 μr', '1', 1, .01, 1e6),
      parameter('epsilonR2', '매질2 εr', '1', 4, .01, 1e6), parameter('muR2', '매질2 μr', '1', 1, .01, 1e6), ...excitation],
    probeDefault: [0, 0, -.25],
    formulas: [{ label: '전기장 계수', text: 'Γ_E=(η₂−η₁)/(η₂+η₁), T_E=1+Γ_E', unit: '1' },
      { label: '전력', text: 'R=Γ_E², T=(η₁/η₂)T_E²; R+T=1', unit: '1' },
      { label: '좌표', text: 'z<0: Ẽ=E₀e^{jφ}(e^{-jβ₁z}+Γ_Ee^{jβ₁z}); H̃=E₀e^{jφ}(e^{-jβ₁z}−Γ_Ee^{jβ₁z})/η₁', unit: 'V/m, A/m' }],
    evaluate: (p, point) => evaluate(p, point, true), verify: p => verify(p, true), profile: (p, count) => profile(p, count, true) }
];
