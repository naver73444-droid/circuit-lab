import { EPS0 } from './em-course-constants.js';

// These are homogeneous electrostatic models, not dielectric boundary solvers.
const K = 1 / (4 * Math.PI * EPS0);
const DISTRIBUTIONS = {
  title: 'OpenStax University Physics 2 §5.5: charge distributions',
  url: 'https://openstax.org/books/university-physics-volume-2/pages/5-5-calculating-electric-fields-of-charge-distributions',
};
const GAUSS = {
  title: 'OpenStax University Physics 2 §6.3: Gauss law',
  url: 'https://openstax.org/books/university-physics-volume-2/pages/6-3-applying-gausss-law',
};
const DIELECTRIC = {
  title: 'OpenStax University Physics 2 §8.4: capacitor with a dielectric',
  url: 'https://openstax.org/books/university-physics-volume-2/pages/8-4-capacitor-with-a-dielectric',
};
const parameter = (key, label, unit, displayUnit, displayScale, initial, min, max) =>
  ({ key, label, unit, displayUnit, displayScale, initial, min, max });
const epsilon = parameter('epsilonR', '상대 유전율 εr', '1', '1', 1, 1, 1, 1000);
const lambda = parameter('lambda', '선전하 밀도 λ (부호 포함)', 'C/m', 'nC/m', 1e-9, 2e-9, -1e-6, 1e-6);
const sigma = parameter('sigma', '면전하 밀도 σ (부호 포함)', 'C/m²', 'nC/m²', 1e-9, 4e-9, -1e-6, 1e-6);
const zero = [0, 0, 0];
const scalar = (key, label, value, unit) => ({ key, label, value, unit });
const potential = (value, label) => scalar('potential', label, value, 'V');
const excluded = (status, reason, region = '') =>
  ({ status, reason, region, vectors: {}, scalars: [], notes: [] });

function validate(definition, params, point) {
  if (!params || (Object.getPrototypeOf(params) !== Object.prototype && Object.getPrototypeOf(params) !== null))
    return 'SI 매개변수는 일반 객체여야 합니다.';
  if (Object.values(params).some(value => typeof value !== 'number' || !Number.isFinite(value)))
    return '모든 SI 매개변수는 유한한 숫자여야 합니다.';
  for (const entry of definition.parameters) {
    const value = params[entry.key];
    if (!Number.isFinite(value) || value < entry.min || value > entry.max)
      return entry.key + ': 표시된 SI 허용 범위의 유한한 숫자가 필요합니다.';
  }
  if (!Array.isArray(point) || point.length !== 3 ||
      ![0, 1, 2].every(index => typeof point[index] === 'number' && Number.isFinite(point[index])))
    return '관측점은 미터 단위의 유한한 숫자 3개 배열이어야 합니다.';
  return '';
}

function field(E, params, scalars, region, notes = []) {
  const D = E.map(value => EPS0 * params.epsilonR * value);
  if (![...E, ...D, ...scalars.map(entry => entry.value)].every(Number.isFinite))
    return excluded('invalid', '이 입력의 결과는 배정밀도 수치 범위를 벗어납니다.', region);
  return { status: 'valid', reason: '', region, vectors: { E, D }, scalars, notes };
}

function check(label, method, actual, expected, unit, relTolerance = 2e-6, absTolerance = 1e-12) {
  if (!Number.isFinite(actual) || !Number.isFinite(expected))
    return skipped(label, '독립 검증 계산이 배정밀도 범위를 벗어났습니다.');
  const pass = Math.abs(actual - expected) <= absTolerance + relTolerance * Math.abs(expected);
  return { label, method, actual, expected, unit, absTolerance, relTolerance,
    status: pass ? 'pass' : 'fail', reason: pass ? '' : '독립 검증의 허용 오차를 초과했습니다.' };
}
function skipped(label, reason) {
  return { label, method: 'domain validation', actual: 0, expected: 0, unit: '1',
    absTolerance: 0, relTolerance: 0, status: 'skipped', reason };
}
function at(definition, params, point) {
  const result = definition.evaluate(params, point);
  return result.status === 'valid' ? result : null;
}

const infiniteLine = {
  id: 'line-infinite', title: '무한 선전하', topic: 'electrostatics',
  modelKind: 'analytic-symmetry',
  description: 'z축의 부호 있는 균일 선전하: 반지름에 따른 E, D와 기준 반지름에 대한 전위.',
  parameters: [lambda, epsilon,
    parameter('rRef', '전위 기준 반지름 rref', 'm', 'cm', 0.01, 0.1, 1e-6, 10)],
  probeDefault: [0.04, 0, 0],
  view: { kind: 'radial', plane: 'xy', extent: 0.2, probeAxes: [0, 1] },
  assumptions: ['무한히 가늘고 긴 z축 선전하, 균일한 λ.', '공간 전체가 선형·등방·균질 유전체 ε=ε0εr이다.'],
  validity: ['r>0; V(rref)=0인 전위 차이만 정의한다.', '무한 선전하는 V(∞)=0을 사용할 수 없다.',
    'λ=0이면 전하원을 제거한 것으로 보며 축에서도 E=D=V=0이다.'],
  singularities: ['λ≠0인 z축(r=0)에서 E와 전위가 특이하다. 거리 클램프를 하지 않는다.'],
  formulas: [
    { label: '전기장', text: 'E = λ/(2π ε r) r̂; r=√(x²+y²)', unit: 'V/m' },
    { label: '전위 차이', text: 'V(r)−V(rref) = λ/(2π ε) ln(rref/r)', unit: 'V' },
    { label: '전기 변위', text: 'D = εE', unit: 'C/m²' },
  ],
  references: [DISTRIBUTIONS, GAUSS],
  symbolicControls: [
    { key: 'reference', label: '전위 조건', initial: 0, choices: [
      { value: 0, label: '유한 rRef에서 V=0' }, { value: 1, label: '두 유한 반지름 r1,r2의 전위 차이' },
      { value: 2, label: '무한대 V=0 (비영 무한선에서 불가)' }] },
  ],
  symbolic: symbolicInfiniteLine,
  evaluate(params, point) {
    const error = validate(infiniteLine, params, point);
    if (error) return excluded('invalid', error);
    if (params.lambda === 0)
      return field([...zero], params, [potential(0, 'V(r)−V(rref)')], 'uncharged', ['λ=0: 전하원 없음.']);
    const r = Math.hypot(point[0], point[1]);
    if (r === 0) return excluded('singular', '전하가 있는 이상적 선전하의 z축입니다.', 'charged-line');
    // Unit vector times magnitude avoids squaring a very small radius.
    const magnitude = params.lambda / (2 * Math.PI * EPS0 * params.epsilonR * r);
    const V = params.lambda / (2 * Math.PI * EPS0 * params.epsilonR) *
      (Math.log(params.rRef) - Math.log(r));
    return field([magnitude * (point[0] / r), magnitude * (point[1] / r), 0], params,
      [potential(V, 'V(r)−V(rref)')], 'homogeneous-dielectric', ['전위 기준: V(rref)=0. V(∞)=0은 불가능.']);
  },
  verify(params) {
    const probe = [params?.rRef, 0, 0];
    const result = at(infiniteLine, params, probe);
    if (!result) return [skipped('가우스 법칙 / 전위 기울기', '유효하지 않은 매개변수 또는 검증점입니다.')];
    let flux = 0;
    const n = 128, r = params.rRef;
    for (let index = 0; index < n; index++) {
      const angle = 2 * Math.PI * (index + 0.5) / n;
      const nx = Math.cos(angle), ny = Math.sin(angle);
      const D = infiniteLine.evaluate(params, [r * nx, r * ny, 0]).vectors.D;
      flux += (D[0] * nx + D[1] * ny) * 2 * Math.PI * r / n; // Cylinder length = 1 m.
    }
    const center = 1.3 * r, h = center * 1e-5;
    const low = at(infiniteLine, params, [center - h, 0, 0]);
    const high = at(infiniteLine, params, [center + h, 0, 0]);
    const middle = at(infiniteLine, params, [center, 0, 0]);
    return [
      check('길이 1 m 원통의 D 플럭스', '128 angular flux samples; ∮D·dA = enclosed charge',
        flux, params.lambda, 'C', 2e-10, 1e-20),
      low && high && middle
        ? check('E = −∂V/∂r', 'central finite difference of referenced potential',
          -(high.scalars[0].value - low.scalars[0].value) / (2 * h), middle.vectors.E[0], 'V/m', 2e-7)
        : skipped('전위 기울기', '전위 미분용 검증점이 수치 범위를 벗어났습니다.'),
    ];
  },
};

const finiteLine = {
  id: 'line-finite', title: '유한 선전하 (일반 위치)', topic: 'electrostatics',
  modelKind: 'finite-integration',
  description: 'x축 [xStart,xEnd] 선분을 일반 관측점에서 정확히 적분한 벡터장.',
  parameters: [lambda, epsilon,
    parameter('xStart', '선분 시작 x', 'm', 'cm', 0.01, -0.1, -10, 10),
    parameter('xEnd', '선분 끝 x', 'm', 'cm', 0.01, 0.1, -10, 10)],
  probeDefault: [0, 0, 0.1],
  view: { kind: 'plane-normal', plane: 'xz', extent: 0.3, probeAxes: [0, 2] },
  assumptions: ['x축 위의 이상적 얇은 선분에 균일한 부호 있는 λ.', '공간 전체가 균질 유전체이다.'],
  validity: ['xStart<xEnd, 전하 선분 밖의 일반 3차원 관측점.', '일반 Coulomb 벡터 적분의 해석적 원시함수를 사용한다.',
    '수직이등분선 공식만으로 일반 위치를 계산하지 않는다.', '유한 전하원은 V(∞)=0을 사용한다.',
    'λ=0이면 전하원 없음으로 선분 위에서도 E=D=V=0.'],
  singularities: ['λ≠0일 때 선분과 양 끝점 위에서 특이하다. 선분의 바깥 연장선은 유효하다.'],
  formulas: [
    { label: '일반 적분', text: 'E(P) = λ/(4π ε) ∫[xStart,xEnd] (P−(s,0,0))/|P−(s,0,0)|³ ds', unit: 'V/m' },
    { label: '전위', text: 'V(P) = λ/(4π ε) ∫[xStart,xEnd] ds/|P−(s,0,0)|; V(∞)=0', unit: 'V' },
    { label: '전기 변위', text: 'D = εE', unit: 'C/m²' },
  ],
  references: [DISTRIBUTIONS],
  symbolicControls: [
    { key: 'geometry', label: '관측 위치 조건', initial: 0, choices: [
      { value: 0, label: '일반 위치 ρ>0' }, { value: 1, label: '수직이등분선 x=(a+b)/2' },
      { value: 2, label: '오른쪽 축 연장선 x>b' }, { value: 3, label: '왼쪽 축 연장선 x<a' },
      { value: 4, label: '전하 선분/끝점 위 (비영 전하에서 특이)' }] },
  ],
  symbolic: symbolicFiniteLine,
  evaluate(params, point) {
    const error = validate(finiteLine, params, point);
    if (error) return excluded('invalid', error);
    if (!(params.xStart < params.xEnd)) return excluded('invalid', 'xStart < xEnd여야 합니다.');
    if (params.lambda === 0)
      return field([...zero], params, [potential(0, 'V (∞ 기준)')], 'uncharged', ['λ=0: 전하원 없음.']);
    const [x, y, z] = point;
    const rho = Math.hypot(y, z), length = params.xEnd - params.xStart;
    const a = x - params.xStart, b = x - params.xEnd;
    const factor = K * params.lambda / params.epsilonR;
    if (rho === 0) {
      if (x >= params.xStart && x <= params.xEnd)
        return excluded('singular', '전하 선분 또는 끝점 위의 관측점입니다.', 'charged-line');
      const near = x > params.xEnd ? b : -a, far = near + length;
      const Ex = Math.sign(a) * factor * (length / far) / near;
      return field([Ex, 0, 0], params, [potential(factor * Math.log1p(length / near), 'V (∞ 기준)')],
        'homogeneous-dielectric', ['선분 바깥 연장선의 일반 해석식.']);
    }
    const ra = Math.hypot(a, rho), rb = Math.hypot(b, rho);
    const radiusDifference = length * ((a + b) / (ra + rb));
    const Ex = factor * (radiusDifference / ra) / rb;
    // Rationalize cancellation when both endpoint vectors point to the same side.
    const angularDifference = a * b > 0
      ? (rho / ra) * (rho / rb) * length * ((a + b) / (a * rb + b * ra))
      : a / ra - b / rb;
    const radial = factor * (angularDifference / rho);
    const integralV = b >= 0
      ? Math.log1p((length + radiusDifference) / (b + rb))
      : a <= 0
        ? Math.log1p((length - radiusDifference) / (-a + ra))
        : Math.asinh(a / rho) - Math.asinh(b / rho);
    return field([Ex, radial * (y / rho), radial * (z / rho)], params,
      [potential(factor * integralV, 'V (∞ 기준)')], 'homogeneous-dielectric');
  },
  verify(params) {
    const length = params?.xEnd - params?.xStart;
    const point = [(params?.xStart + params?.xEnd) / 2 + 0.2 * length, 0.4 * length, 0.6 * length];
    const result = at(finiteLine, params, point);
    if (!result) return [skipped('일반 위치 Coulomb 적분', '매개변수 또는 검증점이 유효하지 않습니다.')];
    const E = [0, 0, 0], n = 1024, step = length / n;
    let V = 0;
    for (let index = 0; index < n; index++) {
      const delta = [point[0] - params.xStart - (index + 0.5) * step, point[1], point[2]];
      const distance = Math.hypot(...delta), dq = params.lambda * step;
      for (let axis = 0; axis < 3; axis++) E[axis] += (K / params.epsilonR) * dq * delta[axis] / distance ** 3;
      V += (K / params.epsilonR) * dq / distance;
    }
    return [
      ...E.map((value, axis) => check('일반 위치 E' + ['x', 'y', 'z'][axis],
        '1024 midpoint Coulomb charge elements; no analytic antiderivative',
        result.vectors.E[axis], value, 'V/m')),
      check('일반 위치 전위', '1024 midpoint charge elements integrating dq/(4π ε r)',
        result.scalars[0].value, V, 'V'),
    ];
  },
};

const infiniteSheet = {
  id: 'sheet-infinite', title: '무한 절연 면전하', topic: 'electrostatics',
  modelKind: 'analytic-symmetry',
  description: 'z=0의 균일한 절연 면전하 양쪽에서의 E와 D. 도체 표면 모델과 구분한다.',
  parameters: [sigma, epsilon],
  probeDefault: [0, 0, 0.03],
  view: { kind: 'plane-normal', plane: 'xz', extent: 0.1, probeAxes: [0, 2] },
  assumptions: ['z=0의 이상적 무한 절연 면에 부호 있는 균일 자유 면전하 σ.',
    '양쪽은 동일한 균질 유전체 ε=ε0εr이다. 도체 표면의 σ/ε 공식이 아니다.'],
  validity: ['z≠0; V(0)=0에 대한 전위 차이를 사용한다.', '무한 면전하는 V(∞)=0을 사용할 수 없다.',
    'σ=0이면 전하원 없음으로 z=0에서도 E=D=V=0.'],
  singularities: ['σ≠0일 때 z=0에서 법선 전기장이 불연속이므로 boundary; 평균값을 반환하지 않는다.'],
  formulas: [
    { label: '전기장', text: 'E = σ/(2ε) sign(z) ẑ', unit: 'V/m' },
    { label: '전위 차이', text: 'V(z)−V(0) = −σ|z|/(2ε)', unit: 'V' },
    { label: '전기 변위', text: 'D = εE; Dz(0+)−Dz(0−)=σ', unit: 'C/m²' },
  ],
  references: [DISTRIBUTIONS, GAUSS],
  symbolicControls: [
    { key: 'side', label: '관측 영역', initial: 0, choices: [
      { value: 0, label: '면 양쪽 z≠0' }, { value: 1, label: '위쪽 z>0' }, { value: 2, label: '아래쪽 z<0' }] },
    { key: 'reference', label: '전위 기준', initial: 0, choices: [
      { value: 0, label: '면에서 V(0)=0' }, { value: 1, label: '유한 기준 좌표 zRef에서 V=0' }] },
  ],
  symbolic: symbolicSheet,
  evaluate(params, point) {
    const error = validate(infiniteSheet, params, point);
    if (error) return excluded('invalid', error);
    if (params.sigma === 0)
      return field([...zero], params, [potential(0, 'V(z)−V(0)')], 'uncharged', ['σ=0: 전하원 없음.']);
    const z = point[2];
    if (z === 0) return excluded('boundary', '전하 면에서 법선 E의 두 극한이 다릅니다.', 'charged-sheet');
    const magnitude = params.sigma / (2 * EPS0 * params.epsilonR);
    return field([0, 0, magnitude * Math.sign(z)], params,
      [potential(-magnitude * Math.abs(z), 'V(z)−V(0)')], z > 0 ? 'above-sheet' : 'below-sheet',
      ['V(0)=0은 연속 전위의 기준이며 면 위 E를 정의하지 않는다. V(∞)=0은 불가능.']);
  },
  verify(params) {
    const top = at(infiniteSheet, params, [0, 0, 0.03]), bottom = at(infiniteSheet, params, [0, 0, -0.03]);
    if (!top || !bottom) return [skipped('면전하 검증', '매개변수 또는 검증점이 유효하지 않습니다.')];
    const h = 1e-6;
    const low = at(infiniteSheet, params, [0, 0, 0.03 - h]), high = at(infiniteSheet, params, [0, 0, 0.03 + h]);
    return [
      check('필박스 D 플럭스 (면적 0.01 m²)', 'Gaussian pillbox; opposing outward normals',
        (top.vectors.D[2] - bottom.vectors.D[2]) * 0.01, params.sigma * 0.01, 'C', 1e-10, 1e-20),
      low && high
        ? check('E = −∂V/∂z', 'central finite difference away from the charged boundary',
          -(high.scalars[0].value - low.scalars[0].value) / (2 * h), top.vectors.E[2], 'V/m', 2e-7)
        : skipped('전위 기울기', '미분용 검증점이 유효하지 않습니다.'),
    ];
  },
};

const diskAxis = {
  id: 'disk-axis', title: '원판 면전하 (축상 전용)', topic: 'electrostatics',
  modelKind: 'finite-integration',
  description: 'xy평면의 균일 원판 전하가 z축에 만드는 장과 전위. 축 밖 계산은 지원하지 않는다.',
  parameters: [{ ...sigma, initial: 1e-9 }, epsilon,
    parameter('radius', '원판 반지름 R', 'm', 'cm', 0.01, 0.1, 1e-6, 10)],
  probeDefault: [0, 0, 0.1],
  view: { kind: 'axis-only', plane: 'xz', extent: 0.3, probeAxes: [2] },
  assumptions: ['원점 중심, xy평면의 얇은 원판에 균일한 부호 있는 σ.', '공간 전체가 동일한 균질 유전체이다.'],
  validity: ['x=y=0인 z축만 지원한다. 축 밖은 unsupported.', 'V(∞)=0을 사용한다.',
    'σ=0이면 축 위 모든 점에서 E=D=V=0; 축 밖은 여전히 unsupported.'],
  singularities: ['σ≠0인 원판 중심 z=0에서 E의 양쪽 극한이 달라 boundary를 반환한다.'],
  formulas: [
    { label: '축상 전기장', text: 'Ez = σ/(2ε) [sign(z) − z/√(z²+R²)]; z≠0', unit: 'V/m' },
    { label: '축상 전위', text: 'V = σ/(2ε) [√(z²+R²) − |z|]; V(∞)=0', unit: 'V' },
    { label: '전기 변위', text: 'D = εE', unit: 'C/m²' },
  ],
  references: [DISTRIBUTIONS],
  symbolicControls: [
    { key: 'side', label: '관측 영역', initial: 0, choices: [
      { value: 0, label: 'z축 양쪽 z≠0' }, { value: 1, label: '위쪽 축 z>0' },
      { value: 2, label: '아래쪽 축 z<0' }, { value: 3, label: '축 밖 (지원 안 함)' }] },
    { key: 'reference', label: '전위 기준', initial: 0, choices: [
      { value: 0, label: '무한대에서 V=0' }, { value: 1, label: '중심 전위 V(0)=0' }] },
  ],
  symbolic: symbolicDisk,
  evaluate(params, point) {
    const error = validate(diskAxis, params, point);
    if (error) return excluded('invalid', error);
    if (point[0] !== 0 || point[1] !== 0)
      return excluded('unsupported', '원판 모델은 x=y=0인 z축 관측점만 지원합니다.', 'off-axis');
    if (params.sigma === 0)
      return field([...zero], params, [potential(0, 'V (∞ 기준)')], 'uncharged', ['σ=0: 전하원 없음.']);
    const z = point[2];
    if (z === 0) return excluded('boundary', '전하 원판 중심의 E는 두 법선 극한을 가집니다.', 'charged-disk');
    const distance = Math.hypot(z, params.radius);
    // Rationalized differences preserve the point-charge far-field limit.
    const difference = params.radius * (params.radius / distance) / (1 + Math.abs(z) / distance);
    const V = params.sigma / (2 * EPS0 * params.epsilonR) * difference;
    const Ez = params.sigma / (2 * EPS0 * params.epsilonR) * Math.sign(z) * (difference / distance);
    return field([0, 0, Ez], params, [potential(V, 'V (∞ 기준)')], z > 0 ? 'positive-axis' : 'negative-axis');
  },
  verify(params) {
    const z = 0.7 * params?.radius;
    const result = at(diskAxis, params, [0, 0, z]);
    if (!result) return [skipped('원판 축상 적분', '매개변수 또는 검증점이 유효하지 않습니다.')];
    const n = 1024, step = params.radius / n;
    let Ez = 0, V = 0;
    for (let index = 0; index < n; index++) {
      const r = (index + 0.5) * step, distance = Math.hypot(r, z);
      const dq = params.sigma * 2 * Math.PI * r * step;
      Ez += (K / params.epsilonR) * dq * z / distance ** 3;
      V += (K / params.epsilonR) * dq / distance;
    }
    return [
      check('원판 축상 Ez', '1024 independent concentric-ring midpoint elements', result.vectors.E[2], Ez, 'V/m'),
      check('원판 축상 V', '1024 independent ring elements integrating dq/(4π ε r)', result.scalars[0].value, V, 'V'),
    ];
  },
};

const parallelPlate = {
  id: 'parallel-plate', title: '유전체 평행판 (고정 Q / 고정 V)', topic: 'electrostatics',
  modelKind: 'analytic-symmetry',
  description: '틈을 완전히 채운 유전체의 평행판 근사. 전하 제어와 전압 제어를 구분한다.',
  parameters: [
    parameter('control', '제어 조건 (0=고정 Q, 1=고정 V)', '1', '1', 1, 0, 0, 1),
    parameter('charge', 'z=0 판의 전하 Q (고정 Q에서 사용)', 'C', 'nC', 1e-9, 1e-9, -1e-6, 1e-6),
    parameter('voltage', 'V(0)−V(d) (고정 V에서 사용)', 'V', 'V', 1, 10, -1e6, 1e6),
    parameter('area', '유효 판 면적 A', 'm²', 'cm²', 1e-4, 0.01, 1e-8, 100),
    parameter('distance', '판 간격 d', 'm', 'mm', 0.001, 0.01, 1e-6, 10),
    epsilon,
  ],
  probeDefault: [0, 0, 0.005],
  view: { kind: 'plane-normal', plane: 'xz', extent: 0.025, probeAxes: [0, 2] },
  assumptions: ['이상적 평행판은 z=0과 z=d에 놓이며 전하는 +Q와 −Q이다.',
    '유전체가 틈 전체를 채운다. 선형·등방·균질이며 자유 전하는 판에만 있다.',
    '측면 무한 평면 근사로 가장자리 장을 무시한다. A는 Q와 정전용량 환산 면적이다.',
    '고정 Q(분리된 전원): εr 증가 시 E,V 감소. 고정 V(연결된 전원): E 유지, Q,D 증가.'],
  validity: ['εr≥1, A>0, d>0, control은 정확히 0 또는 1이다.',
    'E,D 계산은 0<z<d만 지원한다. 판 바깥은 unsupported.',
    '전위 기준은 V(d)=0; 입력 voltage는 V(0)−V(d)이다.',
    '제어값 Q 또는 V가 0이면 틈 안의 E,D,전위,에너지는 0이다. 다른 제어값은 사용하지 않는다.'],
  singularities: ['z=0 또는 z=d의 도체-유전체 계면은 boundary. 한쪽 값을 선택하지 않는다.'],
  formulas: [
    { label: '정전용량', text: 'C = ε0 εr A/d', unit: 'F' },
    { label: '고정 Q (control=0)', text: 'Dz=Q/A; Ez=Q/(εA); V(0)−V(d)=Q/C', unit: 'V/m' },
    { label: '고정 V (control=1)', text: 'Ez=V/d; Dz=εV/d; Q=CV', unit: 'V/m' },
    { label: '전위와 에너지', text: 'V(z)=Ez(d−z), V(d)=0; U=QV/2', unit: 'V; J' },
  ],
  references: [DISTRIBUTIONS, DIELECTRIC],
  symbolicControls: [
    { key: 'control', label: '제어 조건', initial: 0, choices: [
      { value: 0, label: '고정 Q (전원 분리)' }, { value: 1, label: '고정 V (전원 연결)' }] },
    { key: 'reference', label: '위치 전위 기준', initial: 0, choices: [
      { value: 0, label: '위 판 V(d)=0' }, { value: 1, label: '아래 판 V(0)=0' }] },
  ],
  symbolic: symbolicPlate,
  evaluate(params, point) {
    const error = validate(parallelPlate, params, point);
    if (error) return excluded('invalid', error);
    if (params.control !== 0 && params.control !== 1)
      return excluded('invalid', 'control은 0(고정 Q) 또는 1(고정 V)이어야 합니다.');
    const z = point[2];
    if (z === 0 || z === params.distance)
      return excluded('boundary', '도체-유전체 계면에서 장의 한쪽 극한을 선택해야 합니다.', 'plate-interface');
    if (z < 0 || z > params.distance)
      return excluded('unsupported', '이 평행판 근사는 판 사이의 유전체 영역만 지원합니다.', 'outside-gap');
    const capacitance = EPS0 * params.epsilonR * params.area / params.distance;
    const voltage = params.control === 0 ? params.charge / capacitance : params.voltage;
    const charge = params.control === 0 ? params.charge : capacitance * voltage;
    const Ez = voltage / params.distance;
    return field([0, 0, Ez], params, [
      potential(Ez * (params.distance - z), 'V(z), V(d)=0'),
      scalar('capacitance', '정전용량 C', capacitance, 'F'),
      scalar('charge', 'z=0 판의 전하 Q', charge, 'C'),
      scalar('voltage', '판 전위차 V(0)−V(d)', voltage, 'V'),
      scalar('energy', '저장 에너지 U', 0.5 * charge * voltage, 'J'),
    ], 'dielectric-gap', [params.control === 0 ? '고정 Q: voltage 입력은 사용하지 않는다.' : '고정 V: charge 입력은 사용하지 않는다.',
      'V(d)=0; 판 바깥과 가장자리 장은 이 모델의 계산 대상 밖이다.']);
  },
  verify(params) {
    const d = params?.distance;
    const result = at(parallelPlate, params, [0, 0, 0.5 * d]);
    if (!result) return [skipped('평행판 검증', '매개변수 또는 검증점이 유효하지 않습니다.')];
    let voltageIntegral = 0;
    for (let index = 0; index < 128; index++) {
      const sample = parallelPlate.evaluate(params, [0, 0, d * (index + 0.5) / 128]);
      voltageIntegral += sample.vectors.E[2] * d / 128;
    }
    const h = d * 1e-5;
    const low = at(parallelPlate, params, [0, 0, 0.5 * d - h]), high = at(parallelPlate, params, [0, 0, 0.5 * d + h]);
    const controlCheck = params.control === 0
      ? check('고정 Q: 판의 자유 전하', 'Gaussian face flux D·A compared with prescribed free charge',
        result.vectors.D[2] * params.area, params.charge, 'C', 1e-10, 1e-20)
      : check('고정 V: 판 전압', '128 midpoint line-integral samples of E compared with prescribed voltage',
        voltageIntegral, params.voltage, 'V', 1e-10);
    return [controlCheck, low && high
      ? check('틈 내부 E = −∂V/∂z', 'central finite difference of referenced potential',
        -(high.scalars[0].value - low.scalars[0].value) / (2 * h), result.vectors.E[2], 'V/m', 2e-7)
      : skipped('전위 기울기', '미분용 검증점이 유효하지 않습니다.')];
  },
};

// Symbolic teaching templates for the existing supported models.
// They describe derivations as plain text; they are not a CAS or a numeric evaluator.
const templateLimitation = '선택된 모델의 기호풀이 템플릿이다. 범용 CAS, 자유문장 해석 또는 임의 형상 해석기가 아니다.';
const homogeneousLimitation = 'ε는 공간 전체의 동일한 선형·등방 유전율이다. 공간별 ε 치환으로 비균질 경계값 해석을 주장하지 않는다.';
const given = (symbol, meaning, unit, constraint) => ({ symbol, meaning, unit, constraint });
const law = (name, formula) => ({ name, formula });
const step = (title, formula, explanation) => ({ title, formula, explanation });
const answer = (quantity, formula, unit, direction = '스칼라') => ({ quantity, formula, unit, direction });
const region = (condition, formula, explanation) => ({ condition, formula, explanation });
const epsilonGiven = () => [
  given('ε', '균질 매질의 유전율; ε=ε0·εr', 'F/m', 'ε>0; 이 정전기 유전체 모델은 εr≥1'),
  given('ε0', '진공 유전율', 'F/m', '양의 물리 상수; 문자로 유지'),
  given('εr', '상대 유전율', '1', 'εr≥1'),
];
const coulombLaw = () => law('Coulomb 법칙과 중첩', 'dE = dq·(P−P′)/(4·π·ε·|P−P′|³)');
const constitutiveLaw = () => law('균질 유전체의 구성 관계', 'D = ε·E');
const potentialLaw = () => law('정전기 전위 차이', 'V(P)−V(Pref) = −∫[Pref→P] E·dl');

function symbolicFrame(title) {
  return { status: 'supported', title, reason: '', givens: [], assumptions: [], conditions: [],
    laws: [], steps: [], answers: [], regions: [], boundaries: [], limitations: [templateLimitation, homogeneousLimitation] };
}
function unsupportedSymbolic(title, reason, additions = {}) {
  return { ...symbolicFrame(title), ...additions, status: 'unsupported', reason, answers: [] };
}
function structuralSelection(definition, options) {
  if (!options || (Object.getPrototypeOf(options) !== Object.prototype && Object.getPrototypeOf(options) !== null))
    return { error: '기호 조건은 일반 객체여야 합니다.' };
  const controls = definition.symbolicControls;
  for (const key of Object.keys(options)) {
    if (!controls.some(control => control.key === key))
      return { error: '알 수 없는 기호 조건: ' + key + '. 수치 물리값을 symbolic에 전달하지 않습니다.' };
  }
  const selected = {};
  for (const control of controls) {
    const value = Object.hasOwn(options, control.key) ? options[control.key] : control.initial;
    if (!control.choices.some(choice => choice.value === value))
      return { error: control.key + ': 정의된 구조 조건 중 하나를 선택해야 합니다.' };
    selected[control.key] = value;
  }
  return { selected };
}
function symbolicInfiniteLine(options = {}) {
  const selection = structuralSelection(infiniteLine, options);
  if (selection.error) return unsupportedSymbolic('무한 선전하의 기호풀이', selection.error);
  const { reference } = selection.selected;
  if (reference === 2) return unsupportedSymbolic('무한 선전하: 무한대 전위 기준 불가',
    'λ≠0인 무한 선전하의 전위 적분은 로그로 발산하므로 V(∞)=0을 지정할 수 없습니다.', {
      givens: [given('λ', 'z축 균일 선전하 밀도', 'C/m', 'λ≠0, 부호 포함'), ...epsilonGiven()],
      assumptions: ['이상적 무한 z축 선전하와 균질 매질.'],
      conditions: ['r>0', 'λ≠0', '요청 기준: V(∞)=0'],
      laws: [potentialLaw()],
      steps: [step('무한대까지 적분', '∫[r→∞] λ/(2·π·ε·s) ds 는 발산',
        '유한한 기준 반지름을 선택하거나 두 유한 반지름 사이의 전위 차이를 구해야 한다.')],
      limitations: [templateLimitation, 'λ=0인 제거된 전하원은 예외적으로 E=D=V=0이다. 비영 전하의 발산을 유한값으로 바꾸지 않는다.'],
    });
  const data = symbolicFrame('무한 선전하: 가우스 법칙 → 전위 차이');
  data.givens = [
    given('λ', 'z축의 균일 선전하 밀도', 'C/m', 'λ∈ℝ; 부호 포함'),
    given('r', 'z축으로부터 관측점까지 거리; r=√(x²+y²)', 'm', 'r>0'),
    ...epsilonGiven(),
    ...(reference === 0
      ? [given('rRef', '전위 기준 반지름', 'm', 'rRef>0; V(rRef)=0')]
      : [given('r1', '전위 차이 시작 반지름', 'm', 'r1>0'), given('r2', '전위 차이 끝 반지름', 'm', 'r2>0')]),
  ];
  data.assumptions = ['z축에 무한 균일 선전하. 모든 z에서 동일하며 원통 대칭이다.'];
  data.conditions = ['r>0', 'ε=ε0·εr, εr≥1',
    reference === 0 ? 'rRef>0; V(rRef)=0' : 'r1>0, r2>0; 두 유한 반지름의 전위 차이'];
  data.laws = [law('자유 전하에 대한 가우스 법칙', '∮D·dA = Qfree,enc'), constitutiveLaw(), potentialLaw()];
  data.steps = [
    step('가우스 면과 포함 전하', 'Qfree,enc = λ·ℓ; ∮D·dA = 2·π·r·ℓ·Dr',
      '반지름 r, 길이 ℓ의 원통을 잡는다. 끝면 플럭스는 0이고 옆면 D는 일정하다.'),
    step('반지름 방향 장', '2·π·r·ℓ·Dr = λ·ℓ → Dr=λ/(2·π·r), Er=Dr/ε',
      '길이 ℓ가 소거된다. λ의 부호를 유지한다.'),
    reference === 0
      ? step('유한 기준의 전위 적분', 'V(r)−V(rRef) = −∫[rRef→r] λ/(2·π·ε·s) ds = λ·ln(rRef/r)/(2·π·ε)',
        'V(rRef)=0을 명시한다. 무한대 기준을 사용하지 않는다.')
      : step('두 반지름의 전위 적분', 'V(r2)−V(r1) = −∫[r1→r2] λ/(2·π·ε·s) ds = −λ·ln(r2/r1)/(2·π·ε)',
        '절대 전위의 영점을 정하지 않아도 두 유한 반지름 사이의 차이는 유일하다.'),
  ];
  data.answers = [
    answer('Er', 'Er = λ/(2·π·ε·r)', 'V/m', 'E=Er·r̂; r̂=(x/r,y/r,0). λ>0이면 축에서 바깥쪽, λ<0이면 축 쪽.'),
    answer('Dr', 'Dr = λ/(2·π·r)', 'C/m²', 'D=Dr·r̂; E와 같은 부호의 반지름 방향.'),
    reference === 0
      ? answer('V', 'V = λ·ln(rRef/r)/(2·π·ε)', 'V')
      : answer('ΔV', 'ΔV = −λ·ln(r2/r1)/(2·π·ε)', 'V'),
  ];
  data.regions = [region('r>0', 'E=λ·r̂/(2·π·ε·r); D=λ·r̂/(2·π·r)', '반지름에만 의존하며 z에 무관하다.')];
  data.boundaries = [
    region('r=0, λ≠0', 'E와 V는 특이; 단일 유한값 없음', 'r̂도 축에서 정의되지 않는다.'),
    region('λ=0', 'E=D=V=0', '전하원을 제거한 정책으로 축에서도 영장이다.'),
  ];
  data.limitations.push('λ≠0이면 V(∞)=0은 불가능하다. 유한 반지름 기준만 지원한다.');
  return data;
}
function symbolicFiniteLine(options = {}) {
  const selection = structuralSelection(finiteLine, options);
  if (selection.error) return unsupportedSymbolic('유한 선전하의 기호풀이', selection.error);
  const { geometry } = selection.selected;
  if (geometry === 4) return unsupportedSymbolic('유한 선전하: 전하 선분 위',
    'λ≠0인 이상적 선분 또는 끝점 위에서는 Coulomb 장과 전위가 특이합니다.', {
      givens: [given('a,b', 'x축 선분의 시작·끝 좌표', 'm', 'a<b'),
        given('λ', '균일 선전하 밀도', 'C/m', 'λ≠0')],
      conditions: ['ρ=0', 'a≤x≤b', 'λ≠0'],
      boundaries: [region('λ=0', 'E=D=V=0', '제거된 전하원은 별도 영장 예외이다.')],
    });
  const data = symbolicFrame('유한 선전하: 일반 Coulomb 적분');
  data.givens = [
    given('a', 'x축 선분 시작 좌표 (수치 API xStart)', 'm', 'a<b'),
    given('b', 'x축 선분 끝 좌표 (수치 API xEnd)', 'm', 'a<b'),
    given('λ', '균일 선전하 밀도', 'C/m', 'λ∈ℝ; 부호 포함'),
    given('x,y,z', '관측점 P의 직교 좌표', 'm', '전하 선분 밖'),
    given('ρ', 'x축으로부터 횡방향 거리; ρ=√(y²+z²)', 'm', geometry < 2 ? 'ρ>0' : 'ρ=0'),
    ...epsilonGiven(),
  ];
  data.assumptions = ['x축 [a,b]에 균일한 얇은 선전하. 일반 벡터 Coulomb 적분을 사용한다.', '유한 전하원이므로 V(∞)=0.'];
  const geometryCondition = ['ρ>0, x는 임의', 'ρ>0, x=(a+b)/2', 'ρ=0, x>b', 'ρ=0, x<a'][geometry];
  data.conditions = ['a<b', 'ε=ε0·εr, εr≥1', geometryCondition, 'V(∞)=0'];
  data.laws = [coulombLaw(), constitutiveLaw(),
    law('유한 전하원의 전위', 'V(P) = ∫ dq/(4·π·ε·|P−P′|); V(∞)=0')];
  data.steps = [
    step('전하 요소와 벡터', 'dq=λ·ds; P′=(s,0,0); P−P′=(x−s,y,z)',
      's는 a부터 b까지 변화한다. 거리와 방향 모두 s에 따라 달라진다.'),
    step('일반 벡터 적분', 'E = λ/(4·π·ε)·∫[a→b] (x−s,y,z)/((x−s)²+ρ²)^(3/2) ds',
      '수직이등분선 조건이 없으면 Ex를 임의로 0으로 만들지 않는다.'),
  ];
  if (geometry < 2) {
    data.givens.push(
      given('u,v', '끝점까지의 축방향 차이; u=x−a, v=x−b', 'm', 'u−v=b−a>0'),
      given('Ra,Rb', '각 끝점까지의 거리; Ra=√(u²+ρ²), Rb=√(v²+ρ²)', 'm', 'Ra>0, Rb>0'),
    );
    data.steps.push(step('원시함수', '∫ dt/(t²+ρ²)^(3/2)=t/(ρ²·√(t²+ρ²)); ∫ dt/√(t²+ρ²)=asinh(t/ρ)',
      't=x−s로 치환하고 두 끝점의 기여를 뺀다.'));
    if (geometry === 0) {
      data.answers = [
        answer('Ex', 'Ex = λ/(4·π·ε)·(1/Rb−1/Ra)', 'V/m', 'x̂ 성분. 일반 위치에서 Ex≠0일 수 있다.'),
        answer('Eρ', 'Eρ = λ/(4·π·ε·ρ)·(u/Ra−v/Rb)', 'V/m', 'ρ̂=(0,y/ρ,z/ρ); λ의 부호에 따라 횡방향이 바뀐다.'),
        answer('Ey', 'Ey = Eρ·y/ρ', 'V/m', 'ŷ 성분'),
        answer('Ez', 'Ez = Eρ·z/ρ', 'V/m', 'ẑ 성분'),
        answer('V', 'V = λ/(4·π·ε)·(asinh(u/ρ)−asinh(v/ρ))', 'V'),
      ];
      data.steps.push(step('끝점 평가', 'Ex = λ·(1/Rb−1/Ra)/(4·π·ε); Eρ = λ·(u/Ra−v/Rb)/(4·π·ε·ρ)',
        'E=Ex·x̂+Eρ·ρ̂이며 Ey,Ez는 횡방향 단위벡터로 투영한다.'));
    } else {
      data.givens.push(given('L', '선분 길이; L=b−a', 'm', 'L>0'));
      data.steps.push(step('수직이등분선 조건 적용', 'x=(a+b)/2 → u=L/2, v=−L/2, Ra=Rb; Ex=0',
        '이 선택 조건에서만 끝점의 축방향 기여가 소거된다.'));
      data.answers = [
        answer('Ex', 'Ex = 0', 'V/m', '수직이등분선의 대칭으로 x̂ 성분 소거'),
        answer('Eρ', 'Eρ = λ·L/(4·π·ε·ρ·sqrt(ρ²+(L/2)²))', 'V/m', 'ρ̂=(0,y/ρ,z/ρ), 부호 있는 λ.'),
        answer('Ey', 'Ey = Eρ·y/ρ', 'V/m', 'ŷ 성분'),
        answer('Ez', 'Ez = Eρ·z/ρ', 'V/m', 'ẑ 성분'),
        answer('V', 'V = λ·asinh(L/(2·ρ))/(2·π·ε)', 'V'),
      ];
    }
  } else {
    data.steps.push(step('선분 바깥의 축상 적분', 'E = λ·x̂/(4·π·ε)·∫[a→b] (x−s)/|x−s|³ ds',
      geometry === 2 ? 'x>b이므로 x−s>0이다.' : 'x<a이므로 x−s<0이다. 거리 절댓값을 유지한다.'));
    data.answers = [
      answer('Ex', geometry === 2 ? 'Ex = λ/(4·π·ε)·(1/(x−b)−1/(x−a))'
        : 'Ex = λ/(4·π·ε)·(1/(b−x)−1/(a−x))', 'V/m',
      geometry === 2 ? 'λ>0이면 +x̂, λ<0이면 −x̂.' : 'λ>0이면 −x̂, λ<0이면 +x̂.'),
      answer('Ey', 'Ey = 0', 'V/m', '축상 횡방향 성분 없음'),
      answer('Ez', 'Ez = 0', 'V/m', '축상 횡방향 성분 없음'),
      answer('V', geometry === 2 ? 'V = λ·ln((x−a)/(x−b))/(4·π·ε)'
        : 'V = λ·ln((b−x)/(a−x))/(4·π·ε)', 'V'),
    ];
    data.steps.push(step('양의 거리로 끝점 평가', geometry === 2 ? 'x−a>x−b>0' : 'b−x>a−x>0',
      'ln의 인자는 양수이며 축상 장은 일반 적분의 유효 극한이다.'));
  }
  data.answers.push(answer('D', 'D = ε·E', 'C/m²', 'E와 같은 방향의 벡터; 각 성분에 ε를 곱한다.'));
  data.regions = [
    region(geometryCondition, 'E,V는 위 선택 조건의 식', '특수 위치 식을 다른 위치에 적용하지 않는다.'),
    region('관측 거리 ≫ L', 'E → λ·L·R̂/(4·π·ε·R²); V → λ·L/(4·π·ε·R)', '유한 총전하 Q=λL의 점전하 극한. R은 선분 중심으로부터 먼 관측 거리이다.'),
  ];
  data.boundaries = [
    region('ρ=0, a≤x≤b, λ≠0', 'E,V 특이', '끝점도 포함한다. 양 끝점의 ε 거리 clamp를 하지 않는다.'),
    region('ρ=0, x<a 또는 x>b', '유효한 축 연장선 식', '전하 선분 자체와 구분한다.'),
    region('λ=0', 'E=D=V=0', '제거된 전하원은 선분 위에서도 영장이다.'),
  ];
  data.limitations.push('균일한 x축 선분만 지원한다. 선택된 위치 조건과 원시함수로 기호풀이하며 임의 선전하 분포를 자동 적분하지 않는다.');
  return data;
}
function symbolicSheet(options = {}) {
  const selection = structuralSelection(infiniteSheet, options);
  if (selection.error) return unsupportedSymbolic('무한 절연 면전하의 기호풀이', selection.error);
  const { side, reference } = selection.selected;
  const data = symbolicFrame('무한 절연 면전하: 필박스 → 양쪽 장과 전위');
  const sideCondition = ['z≠0 (양쪽)', 'z>0 (위쪽)', 'z<0 (아래쪽)'][side];
  const signed = side === 0 ? 'sign(z)' : side === 1 ? '1' : '−1';
  data.givens = [
    given('σ', 'z=0 절연 면의 균일 자유 면전하 밀도', 'C/m²', 'σ∈ℝ; 부호 포함'),
    given('z', '면에 수직인 관측점 좌표', 'm', sideCondition),
    ...epsilonGiven(),
    ...(reference === 1 ? [given('zRef', '유한 전위 기준점의 법선 좌표', 'm', 'zRef∈ℝ; V(zRef)=0')] : []),
  ];
  data.assumptions = ['이상적 무한 절연 면이 z=0에 있고 양쪽 매질은 동일하다.', '도체 표면 모델이 아니다. x,y 평행이동 대칭이다.'];
  data.conditions = [sideCondition, 'ε=ε0·εr, εr≥1', reference === 0 ? 'V(0)=0' : 'V(zRef)=0, 유한한 zRef'];
  data.laws = [law('가우스 법칙', '∮D·dA = σ·A'), constitutiveLaw(), potentialLaw()];
  data.steps = [
    step('필박스의 두 면', 'Dz(0+)·A−Dz(0−)·A = σ·A; Dz(0−)=−Dz(0+)',
      '면 양쪽의 바깥 법선이 반대이며 대칭으로 두 장의 크기가 같다.'),
    step('부호 있는 장', 'Dz(0+)=σ/2; Dz(0−)=−σ/2; Ez=Dz/ε',
      '2의 인자는 두 면에서 나온다. 도체 한쪽 표면의 σ/ε와 혼동하지 않는다.'),
    step('선택한 관측 영역', 'Ez = σ·' + signed + '/(2·ε)',
      side === 0 ? '법선 좌표의 부호로 방향을 유지한다.' : side === 1 ? '위쪽에서는 양의 σ가 +z 방향이다.' : '아래쪽에서는 양의 σ가 −z 방향이다.'),
    step('연속 전위 적분', reference === 0 ? 'V(z) = −σ·abs(z)/(2·ε)'
      : 'V(z) = −σ·(abs(z)−abs(zRef))/(2·ε)',
      '전위는 면에서 연속이다. 기준점과 관측점이 면의 다른 쪽이어도 절댓값 식을 쓴다.'),
  ];
  data.answers = [
    answer('Ez', side === 0 ? 'Ez = σ·sign(z)/(2·ε)' : side === 1 ? 'Ez = σ/(2·ε)' : 'Ez = −σ/(2·ε)',
      'V/m', 'E=Ez·ẑ; 양의 σ는 면에서 멀어지는 방향, 음의 σ는 면 쪽.'),
    answer('Dz', side === 0 ? 'Dz = σ·sign(z)/2' : side === 1 ? 'Dz = σ/2' : 'Dz = −σ/2',
      'C/m²', 'D=Dz·ẑ'),
    answer('V', reference === 0 ? 'V = −σ·abs(z)/(2·ε)' : 'V = −σ·(abs(z)−abs(zRef))/(2·ε)', 'V'),
  ];
  data.regions = [
    region('z>0', 'Ez=σ/(2·ε); Dz=σ/2', '위쪽 법선 +ẑ.'),
    region('z<0', 'Ez=−σ/(2·ε); Dz=−σ/2', '아래쪽 법선 −ẑ.'),
  ];
  data.boundaries = [
    region('z=0, σ≠0', 'Ez(0+)=σ/(2·ε); Ez(0−)=−σ/(2·ε); Dz(0+)−Dz(0−)=σ',
      '장에는 두 법선 극한이 있으며 면 위의 평균 장을 답으로 정하지 않는다. 전위는 연속이다.'),
    region('σ=0', 'E=D=V=0', '제거된 면전하는 면 위에서도 영장이다.'),
  ];
  data.limitations.push('무한 면전하에는 V(∞)=0을 지정할 수 없다. 서로 다른 두 매질의 경계 문제는 이 모델 밖이다.');
  return data;
}
function symbolicDisk(options = {}) {
  const selection = structuralSelection(diskAxis, options);
  if (selection.error) return unsupportedSymbolic('원판 축상 기호풀이', selection.error);
  const { side, reference } = selection.selected;
  if (side === 3) return unsupportedSymbolic('원판: 축 밖의 관측점',
    '기존 원판 모델은 z축 전용입니다. 축상 공식을 축 밖에 적용하지 않습니다.', {
      givens: [given('R', 'xy평면 원판 반지름', 'm', 'R>0'), given('σ', '균일 면전하 밀도', 'C/m²', '부호 포함')],
      conditions: ['x≠0 또는 y≠0'],
      limitations: [templateLimitation, '축 밖 원판장과 타원 적분 해석은 지원하지 않는다. σ=0이어도 축 밖 API 영역은 확장하지 않는다.'],
    });
  const data = symbolicFrame('원판 축상: 고리 적분 → 축상 장과 전위');
  const sideCondition = ['z≠0 (양쪽 축)', 'z>0 (위쪽 축)', 'z<0 (아래쪽 축)'][side];
  data.givens = [
    given('σ', 'xy평면 원판의 균일 면전하 밀도', 'C/m²', 'σ∈ℝ; 부호 포함'),
    given('R', '원판 반지름', 'm', 'R>0'),
    given('z', '축상 관측점 좌표', 'm', sideCondition),
    ...epsilonGiven(),
  ];
  data.assumptions = ['원점 중심의 얇은 균일 원판과 동일한 양쪽 매질.', 'x=y=0인 z축 전용. 고리의 횡방향 성분은 대칭으로 소거된다.'];
  data.conditions = ['R>0', 'x=y=0', sideCondition, reference === 0 ? 'V(∞)=0' : 'V(0)=0 (중심 전위의 영점)', 'ε=ε0·εr, εr≥1'];
  data.laws = [coulombLaw(), constitutiveLaw(),
    law('유한 원판의 전위', 'dV = dq/(4·π·ε·sqrt(s²+z²)); V∞(∞)=0')];
  data.steps = [
    step('동심 고리 전하', 'dq=σ·2·π·s·ds; 0≤s≤R',
      's는 적분용 고리 반지름이다. R이나 관측점 거리와 구분한다.'),
    step('축상 성분 적분', 'Ez=σ·z/(2·ε)·∫[0→R] s/(s²+z²)^(3/2) ds',
      'z의 부호를 유지한다. 음의 축에서도 같은 벡터 적분을 쓴다.'),
    step('끝점 평가', 'Ez=σ/(2·ε)·(sign(z)−z/sqrt(z²+R²))',
      'z/abs(z)=sign(z), z≠0이다. 중심의 한쪽 극한과 중심에서의 장을 구분한다.'),
    step('관측 축 조건 적용', side === 0 ? 'z/abs(z)=sign(z), z≠0'
      : side === 1 ? 'z>0 → sign(z)=1' : 'z<0 → sign(z)=−1',
      side === 0 ? '축 양쪽의 부호를 보존한다.' : side === 1 ? '위쪽 축의 양의 σ는 +z 방향이다.' : '아래쪽 축의 양의 σ는 −z 방향이다.'),
    step('전위 고리 적분', 'V∞(z)=σ/(2·ε)·∫[0→R] s/sqrt(s²+z²) ds = σ·(sqrt(z²+R²)−abs(z))/(2·ε)',
      '유한 원판이므로 이 V∞는 무한대 기준이다.'),
    ...(reference === 1 ? [step('중심 전위로 기준 변경', 'V(z)=V∞(z)−V∞(0); V∞(0)=σ·R/(2·ε)',
      '중심의 전위는 유한하고 연속이다. 중심의 E가 단일값이 아닌 사실은 그대로 유지한다.')] : []),
  ];
  const signExpression = side === 0 ? 'sign(z)' : side === 1 ? '1' : '−1';
  data.answers = [
    answer('Ez', 'Ez = σ/(2·ε)·(' + signExpression + '−z/sqrt(z²+R²))', 'V/m',
      'E=Ez·ẑ; σ>0에서 위쪽은 +ẑ, 아래쪽은 −ẑ. σ<0이면 반대.'),
    answer('Dz', 'Dz = σ/2·(' + signExpression + '−z/sqrt(z²+R²))', 'C/m²', 'D=Dz·ẑ'),
    answer('V', reference === 0 ? 'V = σ/(2·ε)·(sqrt(z²+R²)−abs(z))'
      : 'V = σ/(2·ε)·(sqrt(z²+R²)−abs(z)−R)', 'V'),
  ];
  data.regions = [
    region(sideCondition + ', x=y=0', '위의 축상 식', '축 밖에는 적용하지 않는다.'),
    region('|z|≫R', 'Ez → σ·R²·sign(z)/(4·ε·z²)', '총전하 Q=σπR²의 점전하 장 극한.'),
    region('R≫|z|>0', 'Ez → σ·sign(z)/(2·ε)', '무한 절연 면전하 극한.'),
  ];
  data.boundaries = [
    region('z=0, σ≠0', 'Ez(0+)=σ/(2·ε); Ez(0−)=−σ/(2·ε)',
      '중심 장은 boundary이며 단일값을 지정하지 않는다. 중심의 전위는 두 쪽에서 동일하다.'),
    region('z=0', reference === 0 ? 'V∞(0)=σ·R/(2·ε)' : 'V(0)=0',
      '전위만의 기준값이며 면 위 E를 뜻하지 않는다.'),
    region('σ=0, x=y=0', 'E=D=V=0', '전하원을 제거한 경우 축 전체에서 영장이다.'),
  ];
  data.limitations.push('축 밖 장, 원판 가장자리에서의 일반 3D 장, 비균일 원판 분포는 지원하지 않는다.');
  return data;
}
function symbolicPlate(options = {}) {
  const selection = structuralSelection(parallelPlate, options);
  if (selection.error) return unsupportedSymbolic('유전체 평행판 기호풀이', selection.error);
  const { control, reference } = selection.selected;
  const fixedQ = control === 0;
  const data = symbolicFrame('유전체 평행판: ' + (fixedQ ? '고정 Q (전원 분리)' : '고정 V (전원 연결)'));
  data.givens = [
    given('A', '유효 판 면적', 'm²', 'A>0'),
    given('d', 'z=0 및 z=d 판 사이의 간격', 'm', 'd>0'),
    given('z', '틈 내부 관측 좌표', 'm', '0<z<d'),
    ...epsilonGiven(),
    fixedQ ? given('Q', 'z=0 판의 고정 자유 전하; 반대 판에는 −Q', 'C', 'Q∈ℝ; 부호 포함')
      : given('V', '고정 판 전위차 V(0)−V(d)', 'V', 'V∈ℝ; 부호 포함'),
  ];
  data.assumptions = ['유전체가 틈 전체를 채운 이상적 평행판. 가장자리 효과를 무시한다.',
    '평행면 대칭과 동일한 반대 전하. area는 총 Q와 C 환산 면적이며 유한 가장자리 장을 계산하지 않는다.',
    fixedQ ? '전원 분리: Q가 일정하고 V는 유전율에 따라 변한다.' : '전원 연결: V가 일정하고 Q는 유전율에 따라 변한다.'];
  data.conditions = ['A>0, d>0, 0<z<d', 'ε=ε0·εr, εr≥1',
    fixedQ ? '제어 조건: 고정 Q' : '제어 조건: 고정 V=V(0)−V(d)',
    reference === 0 ? '전위 기준: V(d)=0' : '전위 기준: V(0)=0'];
  data.laws = [law('가우스 법칙과 도체 표면의 자유 전하', 'Dgap·n = σfree; σfree=Q/A'),
    constitutiveLaw(), potentialLaw(), law('정전용량과 저장 에너지', 'Q=C·V; U=Q·V/2')];
  data.steps = [
    step('틈의 균일 장', 'Dz=Q/A; Ez=Dz/ε; V(0)−V(d)=∫[0→d] Ez dz=Ez·d',
      'z=0 판의 부호 있는 Q가 +z 성분의 부호를 결정한다.'),
    step('정전용량 도출', 'V=Q·d/(ε·A) → C=Q/V=ε·A/d',
      'Q=V=0에서 비율 0/0을 계산하지 않고 기하학적 선형 관계의 계수 C를 정의한다.'),
    fixedQ
      ? step('고정 Q 조건 적용', 'Ez=Q/(ε·A); Dz=Q/A; V=Q·d/(ε·A); U=Q²·d/(2·ε·A)',
        'εr 증가 시 E,V,U는 감소하고 Q,D는 일정하다.')
      : step('고정 V 조건 적용', 'Ez=V/d; Dz=ε·V/d; Q=ε·A·V/d; U=ε·A·V²/(2·d)',
        'εr 증가 시 E,V는 일정하고 Q,D,U가 증가한다.'),
    step('전위 영점 선택', reference === 0 ? 'Φ(z)=Ez·(d−z); Φ(d)=0' : 'Φ(z)=−Ez·z; Φ(0)=0',
      'Φ는 위치 전위, V는 판 전위차이다. 영점 선택이 E,D,C,Q,U를 바꾸지 않는다.'),
  ];
  data.answers = [
    answer('C', 'C = ε·A/d', 'F'),
    answer('Ez', fixedQ ? 'Ez = Q/(ε·A)' : 'Ez = V/d', 'V/m', 'E=Ez·ẑ; 제어 Q 또는 V의 부호가 +z/−z 방향을 정한다.'),
    answer('Dz', fixedQ ? 'Dz = Q/A' : 'Dz = ε·V/d', 'C/m²', 'D=Dz·ẑ; 양의 제어값은 +z 방향.'),
    fixedQ ? answer('V', 'V = Q·d/(ε·A)', 'V')
      : answer('Q', 'Q = ε·A·V/d', 'C'),
    answer('Φ', reference === 0
      ? fixedQ ? 'Φ = Q·(d−z)/(ε·A)' : 'Φ = V·(d−z)/d'
      : fixedQ ? 'Φ = −Q·z/(ε·A)' : 'Φ = −V·z/d', 'V'),
    answer('U', fixedQ ? 'U = Q²·d/(2·ε·A)' : 'U = ε·A·V²/(2·d)', 'J', '스칼라; U≥0'),
  ];
  data.regions = [
    region('0<z<d', '위의 균질 유전체 틈 식', 'x,y에 무관한 평행면 근사.'),
    region('z<0 또는 z>d', 'unsupported', '기존 평가기의 지원 범위 밖이다. 바깥 장을 가짜 0으로 채우지 않는다.'),
  ];
  data.boundaries = [
    region('z=0', fixedQ ? 'Ez(0+)=Q/(ε·A); Dz(0+)=Q/A'
      : 'Ez(0+)=V/d; Dz(0+)=ε·V/d', '틈 쪽 한쪽 극한이다. 계면 자체의 단일 장을 지정하지 않는다.'),
    region('z=d', fixedQ ? 'Ez(d−)=Q/(ε·A); Dz(d−)=Q/A'
      : 'Ez(d−)=V/d; Dz(d−)=ε·V/d', '틈 쪽 한쪽 극한이다. 도체/외부 쪽과 구분한다.'),
    region(fixedQ ? 'Q=0' : 'V=0', 'E=D=Φ=Q=V=U=0; C=ε·A/d>0',
      '틈 내부의 영장. 제거된 구동에서도 판 계면의 평가 상태는 boundary이다.'),
  ];
  data.limitations.push('부분 충전/층상 유전체, 가장자리 장, 실제 유전체 파괴 및 임의 도체 경계값 해석은 지원하지 않는다.');
  return data;
}

export const EXPERIMENTS = [infiniteLine, finiteLine, infiniteSheet, diskAxis, parallelPlate];
