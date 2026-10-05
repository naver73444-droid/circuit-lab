import { EPS0, MU0 } from './em-course-constants.js';

const GAUSS = {
  title: 'OpenStax University Physics 2 §6.2: 포획 전하와 외부 전하',
  url: 'https://openstax.org/books/university-physics-volume-2/pages/6-2-explaining-gausss-law',
};
const SYMMETRY = {
  title: 'OpenStax University Physics 2 §6.3: 구·원통·평면 대칭',
  url: 'https://openstax.org/books/university-physics-volume-2/pages/6-3-applying-gausss-law',
};
const AMPERE = {
  title: 'OpenStax University Physics 2 §12.5: 암페어 법칙과 균일 전류 원통',
  url: 'https://openstax.org/books/university-physics-volume-2/pages/12-5-amperes-law',
};
const MIT = {
  title: 'MIT 6.013 §2.1 및 §2.6: D 전속과 H 순환 (SI 구성식)',
  url: 'https://ocw.mit.edu/courses/6-013-electromagnetics-and-applications-spring-2009/d3be4ea78b036a6362230fb41780cf54_MIT6_013S09_notes.pdf',
};
const parameter = (key, label, unit, displayUnit, displayScale, initial, min, max) =>
  ({ key, label, unit, displayUnit, displayScale, initial, min, max });
const epsilon = parameter('epsilonR', '균일 상대 유전율 εr', '1', '1', 1, 1, 1, 1000);
const length = (key, label, initial) => parameter(key, label, 'm', 'cm', 0.01, initial, 1e-9, 10);
const scalar = (key, label, value, unit) => ({ key, label, value, unit });
const excluded = (status, reason, region = '') => ({ status, reason, region, vectors: {}, scalars: [], notes: [] });
function validate(definition, params, point) {
  if (!params || ![Object.prototype, null].includes(Object.getPrototypeOf(params)))
    return 'SI 매개변수는 일반 객체여야 합니다.';
  if (Object.values(params).some(value => typeof value !== 'number' || !Number.isFinite(value)))
    return '모든 매개변수는 유한한 SI 숫자여야 합니다.';
  for (const entry of definition.parameters) {
    const value = params[entry.key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < entry.min || value > entry.max)
      return entry.key + ': 필수 SI 입력이 없거나 표시된 허용 범위를 벗어납니다.';
  }
  if (!Array.isArray(point) || point.length !== 3 ||
    ![0, 1, 2].every(i => typeof point[i] === 'number' && Number.isFinite(point[i])))
    return '관측점은 유한한 숫자 3개로 구성된 미터 배열이어야 합니다.';
  return '';
}
function result(status, region, vectors, scalars, notes, reason = '') {
  if (![...Object.values(vectors).flat(), ...scalars.map(s => s.value)].every(Number.isFinite))
    return excluded('invalid', '계산 결과가 유한한 수치 범위를 벗어납니다.', region);
  return { status, reason, region, vectors, scalars, notes };
}
function electrostatic(D, params, scalars, region, notes) {
  const E = D.map(v => v / (EPS0 * params.epsilonR));
  return result('valid', region, { E, D }, scalars, notes);
}
function fluxScalars(enclosed, params) {
  return [scalar('enclosedCharge', '포획 자유전하 Qenc', enclosed, 'C'),
    scalar('fluxD', '닫힌 면의 ∮D·n dA (해석값)', enclosed, 'C'),
    scalar('fluxE', '닫힌 면의 ∮E·n dA (해석값)', enclosed / (EPS0 * params.epsilonR), 'V m')];
}
function skipped(label, reason) {
  return { label, method: 'domain validation', actual: 0, expected: 0, unit: '1',
    absTolerance: 0, relTolerance: 0, status: 'skipped', reason };
}
function check(label, method, actual, expected, unit, absTolerance, relTolerance = 2e-10) {
  if (![actual, expected].every(Number.isFinite)) return skipped(label, '검증 값이 유한하지 않습니다.');
  const pass = Math.abs(actual - expected) <= absTolerance + relTolerance * Math.abs(expected);
  return { label, method, actual, expected, unit, absTolerance, relTolerance,
    status: pass ? 'pass' : 'fail', reason: pass ? '' : '독립 적분값의 허용오차를 초과했습니다.' };
}
// Adaptive Simpson on u=cos(theta), specialized to this axial Gaussian sphere.
// Reuse endpoints/midpoints and integrate evaluator E/D with actual outward normals.
// Halving a Simpson panel changes the leading h^4 error by 1/16, hence /15.
// Returned actuals are raw refined quadrature, never the enclosed-charge oracle.
function sphereIntegral(params, toleranceD, toleranceE) {
  const maxSamples = 2047, maxDepth = 32;
  let sampleCount = 0, limitReason = '';
  const R = params.radius, areaFactor = 2 * Math.PI * R * R;
  function sample(u) {
    sampleCount++;
    const sx = Math.sqrt(1 - u * u);
    const evaluated = gaussPoint.evaluate(params, [R * sx, 0, params.centerZ + R * u]);
    if (evaluated.status !== 'valid') return null;
    const D = areaFactor * (evaluated.vectors.D[0] * sx + evaluated.vectors.D[2] * u);
    const E = areaFactor * (evaluated.vectors.E[0] * sx + evaluated.vectors.E[2] * u);
    return Number.isFinite(D) && Number.isFinite(E) ? { D, E } : null;
  }
  const simpson = (a, b, left, middle, right) => ({
    D: (b - a) / 6 * (left.D + 4 * middle.D + right.D),
    E: (b - a) / 6 * (left.E + 4 * middle.E + right.E),
  });
  const leaf = (integral, errorD, errorE, absoluteD, absoluteE) =>
    ({ ...integral, errorD, errorE, absoluteD, absoluteE });
  function refine(a, b, left, middle, right, whole, tolD, tolE, depth) {
    if (sampleCount + 2 > maxSamples) {
      limitReason = '2047개 표면 표본 예산';
      return leaf(whole, Math.abs(whole.D), Math.abs(whole.E), Math.abs(whole.D), Math.abs(whole.E));
    }
    const midpoint = (a + b) / 2;
    const lm = sample((a + midpoint) / 2), rm = sample((midpoint + b) / 2);
    if (!lm || !rm) return null;
    const one = simpson(a, midpoint, left, lm, middle);
    const two = simpson(midpoint, b, middle, rm, right);
    const combined = { D: one.D + two.D, E: one.E + two.E };
    const errorD = Math.abs(combined.D - whole.D) / 15;
    const errorE = Math.abs(combined.E - whole.E) / 15;
    const absoluteD = (b - a) / 12 * (Math.abs(left.D) + 4 * Math.abs(lm.D) +
      2 * Math.abs(middle.D) + 4 * Math.abs(rm.D) + Math.abs(right.D));
    const absoluteE = (b - a) / 12 * (Math.abs(left.E) + 4 * Math.abs(lm.E) +
      2 * Math.abs(middle.E) + 4 * Math.abs(rm.E) + Math.abs(right.E));
    if (errorD <= tolD && errorE <= tolE)
      return leaf(combined, errorD, errorE, absoluteD, absoluteE);
    if (depth >= maxDepth) {
      limitReason = '최대 분할 깊이 32';
      return leaf(combined, errorD, errorE, absoluteD, absoluteE);
    }
    const l = refine(a, midpoint, left, lm, middle, one, tolD / 2, tolE / 2, depth + 1);
    if (!l) return null;
    const r = refine(midpoint, b, middle, rm, right, two, tolD / 2, tolE / 2, depth + 1);
    if (!r) return null;
    return leaf({ D: l.D + r.D, E: l.E + r.E }, l.errorD + r.errorD, l.errorE + r.errorE,
      l.absoluteD + r.absoluteD, l.absoluteE + r.absoluteE);
  }
  const left = sample(-1), middle = sample(0), right = sample(1);
  if (!left || !middle || !right) return null;
  const integral = refine(-1, 1, left, middle, right, simpson(-1, 1, left, middle, right),
    toleranceD, toleranceE, 0);
  if (!integral) return null;
  // Cancellation can make exterior flux tiny even when individual patches are large.
  // Include a roundoff floor proportional to the integral of |field·normal|.
  integral.errorD += 32 * Number.EPSILON * integral.absoluteD;
  integral.errorE += 32 * Number.EPSILON * integral.absoluteE;
  if (!Object.values(integral).every(Number.isFinite)) return null;
  const converged = !limitReason && integral.errorD <= toleranceD && integral.errorE <= toleranceE;
  return { ...integral, sampleCount, converged,
    reason: converged ? '' : '구면 수치 적분 수렴 미확보: ' +
      (limitReason || '반올림 포함 추정 오차가 목표보다 큽니다.') +
      '. 해석 모델의 물리 실패가 아니라 적분 해상도 한계입니다.' };
}


const gaussPoint = {
  id: 'gauss-point', title: '가우스 전속: 점전하와 구면', topic: 'integrals',
  modelKind: 'analytic-symmetry',
  description: '원점 점전하와 z축 중심 구면. 외부 전하의 국소 장과 닫힌 면의 순전속을 구분합니다.',
  parameters: [
    parameter('charge', '원점 자유 점전하 q', 'C', 'nC', 1e-9, 4e-9, -1e-3, 1e-3),
    epsilon, length('radius', '가우스 구면 반지름 R', 0.3),
    parameter('centerZ', '구면 중심 zc (전하는 원점)', 'm', 'cm', 0.01, 0, -10, 10),
  ],
  probeDefault: [0.2, 0, 0],
  view: { kind: 'radial', plane: 'xz', extent: 1, probeAxes: [0, 2] },
  assumptions: ['원점 점전하, 균일·선형·등방 유전체. 적분 면은 (0,0,zc) 중심 구면 하나.',
    '닫힌 면의 법선은 항상 바깥쪽. D 전속은 자유전하, E 전속은 Qfree/ε.',
    '구면 중심을 옮기면 표면 장은 균일하지 않으므로 E×면적 shortcut을 사용하지 않는다.'],
  validity: ['면 바깥 전하는 국소 E에 기여하지만 순전속에는 0 기여.',
    '임의 형상 solver 없음; 구면 해석 포획값과 실제 구면 샘플 적분만 비교.',
    '전위 기준은 설정하지 않으며 전위를 반환하지 않는다.'],
  singularities: ['q≠0일 때 원점 singular. 전하가 구면 위에 놓이면 boundary이며 포획량/전속을 임의로 ½q로 정하지 않는다.',
    '구면 적분은 국소 분할 오차를 추정하여 정밀화; 최대 2048평가 안에 수렴을 확보하지 못하면 skipped (해석값은 유효). 거리 clamp 없음.'],
  formulas: [
    { label: '점전하 장', text: 'D=q/(4πr²) r̂, E=D/ε', unit: 'C/m²' },
    { label: '포획 전하', text: '|zc|<R: Qenc=q; |zc|>R: Qenc=0', unit: 'C' },
    { label: '닫힌 면 전속', text: '∮D·n dA=Qenc, ∮E·n dA=Qenc/ε', unit: 'C' },
  ],
  references: [GAUSS, SYMMETRY, MIT],
  evaluate(params, point) {
    const error = validate(gaussPoint, params, point);
    if (error) return excluded('invalid', error);
    const r = Math.hypot(...point);
    if (!Number.isFinite(r)) return excluded('invalid', '관측점 반경이 유한한 수치 범위를 벗어납니다.');
    if (params.charge !== 0 && r === 0) return excluded('singular', '원점의 이상 점전하에서 장은 정의되지 않습니다.', 'point-source');
    if (params.charge !== 0 && Math.abs(params.centerZ) === params.radius)
      return excluded('boundary', '점전하가 가우스 구면 위에 있습니다. 단일 포획 전하/전속을 지정하지 않습니다.', 'source-on-surface');
    const enclosed = Math.abs(params.centerZ) < params.radius ? params.charge : 0;
    const dr = params.charge === 0 ? 0 : params.charge / (4 * Math.PI) / r / r;
    if (params.charge !== 0 && dr === 0) return excluded('invalid', '비영 장이 부동소수점 표현 범위 아래로 내려갑니다.');
    const D = params.charge === 0 ? [0, 0, 0] : point.map(v => dr * (v / r));
    return electrostatic(D, params, [...fluxScalars(enclosed, params),
      scalar('surfaceRadius', '구면 반지름 R', params.radius, 'm'),
      scalar('surfaceCenterZ', '구면 중심 zc', params.centerZ, 'm')],
    'homogeneous-point-field', ['바깥 법선 구면; ∮D는 포획 자유전하만 세며, 국소장은 외부 전하도 포함합니다.']);
  },
  verify(params) {
    const sample = gaussPoint.evaluate(params, [params?.radius, 0, params?.centerZ]);
    if (sample.status !== 'valid') return [skipped('구면 전속 적분', sample.reason)];
    const enclosed = Math.abs(params.centerZ) < params.radius ? params.charge : 0;
    const expectedE = enclosed / (EPS0 * params.epsilonR);
    // Physical comparison tolerances are unchanged. Require a tenfold error margin.
    const targetD = (1e-15 + 2e-5 * Math.abs(enclosed)) / 10;
    const targetE = (1e-4 + 2e-5 * Math.abs(expectedE)) / 10;
    const integral = sphereIntegral(params, targetD, targetE);
    if (!integral) return [skipped('구면 전속 적분', '적분 면이 특이점/경계 또는 수치 표현 범위를 지납니다.')];
    const row = (label, method, actual, expected, unit, absTolerance, relTolerance, estimatedError) => {
      const checked = check(label, method, actual, expected, unit, absTolerance, relTolerance);
      return { ...checked, estimatedError, sampleCount: integral.sampleCount,
        ...(integral.converged ? {} : { status: 'skipped', reason: integral.reason }) };
    };
    return [
      row('구면 D 전속 / 포획 자유전하', 'adaptive Simpson outward D flux; local error |S2−S1|/15',
        integral.D, enclosed, 'C', 1e-15, 2e-5, integral.errorD),
      row('구면 E 전속 / Qenc/ε', 'adaptive Simpson of evaluated E with outward normal',
        integral.E, expectedE, 'V m', 1e-4, 2e-5, integral.errorE),
      row('구면 적분 오차 추정 / 수렴', 'summed local refinement errors plus cancellation roundoff floor',
        integral.errorD, 0, 'C', targetD, 0, integral.errorD),
    ];
  },
};

function lineIntegral(params, count) {
  let d = 0, e = 0;
  for (let i = 0; i < count; i++) {
    const theta = (i + 0.5) * 2 * Math.PI / count;
    const nx = Math.cos(theta), ny = Math.sin(theta);
    const sampled = gaussLine.evaluate(params, [params.radius * nx, params.radius * ny, 0]);
    if (sampled.status !== 'valid') return null;
    const area = params.radius * params.height * 2 * Math.PI / count;
    d += (sampled.vectors.D[0] * nx + sampled.vectors.D[1] * ny) * area;
    e += (sampled.vectors.E[0] * nx + sampled.vectors.E[1] * ny) * area;
  }
  return { D: d, E: e };
}
const gaussLine = {
  id: 'gauss-line', title: '가우스 전속: 무한 선과 원통', topic: 'integrals',
  modelKind: 'analytic-symmetry',
  description: 'z축 선전하와 동축 닫힌 원통: 옆면 전속, 양 뚜껑 0, Qenc=λL.',
  parameters: [
    parameter('lambda', '자유 선전하 밀도 λ', 'C/m', 'nC/m', 1e-9, 2e-9, -1e-3, 1e-3),
    epsilon, length('radius', '가우스 원통 반지름 R', 0.1), length('height', '가우스 원통 높이 L', 0.4),
  ],
  probeDefault: [0.1, 0, 0],
  view: { kind: 'radial', plane: 'xy', extent: 0.3, probeAxes: [0, 1] },
  assumptions: ['무한 z축 선전하; 균일 ε. 가우스 원통은 선전하와 동축.',
    '바깥 법선: 옆면 r̂, 뚜껑 ±ẑ. D/E에는 z성분이 없어 뚜껑 전속 0.'],
  validity: ['장 관측점은 r>0 (λ=0이면 원점도 정상). 전속 적분은 R,L>0.',
    '선이 뚜껑을 관통하는 점에서 장은 특이하지만 법선 성분 0의 부정적분으로 뚜껑 기여가 0.',
    '일반 유한 선·치우친 원통·비균일 유전체는 이 모델 범위 밖. 전위 미제공.'],
  singularities: ['λ≠0인 z축 장은 singular; 선전하와 적분면의 교차를 유한한 장으로 가장하지 않는다. 거리 clamp 없음.'],
  formulas: [
    { label: '선전하 장', text: 'D=λ/(2πr) r̂; E=D/ε', unit: 'C/m²' },
    { label: '옆면과 뚜껑', text: 'ΦD,side=Dr 2πRL; ΦD,caps=0; Qenc=λL', unit: 'C' },
  ],
  references: [GAUSS, SYMMETRY, MIT],
  evaluate(params, point) {
    const error = validate(gaussLine, params, point);
    if (error) return excluded('invalid', error);
    const r = Math.hypot(point[0], point[1]);
    if (!Number.isFinite(r)) return excluded('invalid', '반경이 유한한 수치 범위를 벗어납니다.');
    if (params.lambda !== 0 && r === 0) return excluded('singular', '이상 선전하 축에서 장은 정의되지 않습니다.', 'line-axis');
    const dr = params.lambda === 0 ? 0 : params.lambda / (2 * Math.PI) / r;
    if (params.lambda !== 0 && dr === 0) return excluded('invalid', '비영 장이 수치 표현 범위 아래입니다.');
    const D = params.lambda === 0 ? [0, 0, 0] : [dr * (point[0] / r), dr * (point[1] / r), 0];
    const enclosed = params.lambda * params.height;
    return electrostatic(D, params, [...fluxScalars(enclosed, params),
      scalar('sideFluxD', '옆면 D 전속', enclosed, 'C'), scalar('capsFluxD', '양 뚜껑 D 전속', 0, 'C'),
      scalar('surfaceRadius', '원통 반지름', params.radius, 'm'), scalar('surfaceHeight', '원통 높이', params.height, 'm')],
    'homogeneous-line-field', ['전속은 입력 R,L의 닫힌 원통 값; 프로브 위치에서의 국소장과 구분합니다.']);
  },
  verify(params) {
    const sample = gaussLine.evaluate(params, [params?.radius, 0, 0]);
    if (sample.status !== 'valid') return [skipped('원통 전속 적분', sample.reason)];
    const coarse = lineIntegral(params, 128), fine = lineIntegral(params, 256);
    if (!coarse || !fine) return [skipped('원통 전속 적분', '옆면의 장이 정의되지 않습니다.')];
    return [
      check('원통 D 전속 / λL', '256 outward side patches; caps have D·±z=0 (improper limit)',
        fine.D, params.lambda * params.height, 'C', 1e-20),
      check('원통 E 전속 / λL/ε', '256 evaluated E·n side patches plus zero caps',
        fine.E, params.lambda * params.height / (EPS0 * params.epsilonR), 'V m', 1e-10),
      check('원통 표본 수렴 128→256', 'separate side-patch sums', fine.D, coarse.D, 'C', 1e-20),
    ];
  },
};

const gaussSheet = {
  id: 'gauss-sheet', title: '가우스 전속: 무한 면과 pillbox', topic: 'integrals',
  modelKind: 'analytic-symmetry',
  description: '절연 전하 면 z=0과 평행 뚜껑 pillbox. 면 밖 pillbox는 국소장≠0이어도 순전속=0.',
  parameters: [
    parameter('sigma', '자유 면전하 밀도 σ', 'C/m²', 'nC/m²', 1e-9, 4e-9, -1e-3, 1e-3),
    epsilon, parameter('area', 'pillbox 각 뚜껑 면적 A', 'm²', 'cm²', 1e-4, 0.03, 1e-10, 100),
    length('halfHeight', 'pillbox 반높이 h', 0.05),
    parameter('centerZ', 'pillbox 중심 zc', 'm', 'cm', 0.01, 0, -10, 10),
  ],
  probeDefault: [0, 0, 0.05],
  view: { kind: 'plane-normal', plane: 'xz', extent: 0.2, probeAxes: [0, 2] },
  assumptions: ['무한 절연 면전하 (도체 한쪽 표면 모델과 다름), 균일 ε, z=0.',
    'pillbox 뚜껑은 xy에 평행; 면적 A, 높이 2h, 중심 zc. 법선 위 +z, 아래 −z.',
    '옆면 법선은 xy 방향이라 E/D 옆면 전속 0.'],
  validity: ['Qenc=σA는 pillbox가 면을 가로지를 때만 성립.',
    '면을 가로지르지 않으면 입사/출사 전속이 상쇄된다. 순전속 0은 국소장 0을 의미하지 않는다.',
    '전위 기준은 설정하지 않으며 전위를 반환하지 않는다.'],
  singularities: ['σ≠0의 z=0은 한쪽 장이 서로 다른 boundary; 뚜껑이 면에 닿으면 적분량은 boundary.',
    'σ=0이면 전하 면이 없어 장과 전속 모두 0. 거리 clamp 없음.'],
  formulas: [
    { label: '양쪽 장', text: 'D(z≠0)=sign(z) σ/2 ẑ; E=D/ε', unit: 'C/m²' },
    { label: '뚜껑 전속', text: 'ΦD=A[D(zc+h)−D(zc−h)]; Qenc=σA if |zc|<h, else 0', unit: 'C' },
  ],
  references: [GAUSS, SYMMETRY, MIT],
  evaluate(params, point) {
    const error = validate(gaussSheet, params, point);
    if (error) return excluded('invalid', error);
    if (params.sigma !== 0 && Math.abs(params.centerZ) === params.halfHeight)
      return excluded('boundary', 'pillbox 뚜껑이 전하 면에 놓여 단일 포획량/전속을 지정할 수 없습니다.', 'cap-on-sheet');
    const topD = Math.sign(params.centerZ + params.halfHeight) * params.sigma / 2;
    const bottomD = Math.sign(params.centerZ - params.halfHeight) * params.sigma / 2;
    const enclosed = Math.abs(params.centerZ) < params.halfHeight ? params.sigma * params.area : 0;
    const values = [...fluxScalars(enclosed, params),
      scalar('topFluxD', '위 뚜껑 D 전속 (n=+z)', topD * params.area, 'C'),
      scalar('bottomFluxD', '아래 뚜껑 D 전속 (n=−z)', -bottomD * params.area, 'C'),
      scalar('sideFluxD', '옆면 D 전속', 0, 'C'),
      scalar('area', '각 뚜껑 면적 A', params.area, 'm²'),
      scalar('centerZ', 'pillbox 중심', params.centerZ, 'm'), scalar('halfHeight', 'pillbox 반높이', params.halfHeight, 'm')];
    const notes = ['닫힌 pillbox의 바깥 법선. 면 바깥 pillbox는 국소 E/D가 있어도 순전속 0.'];
    if (params.sigma !== 0 && point[2] === 0) {
      const dz = params.sigma / 2, ez = dz / (EPS0 * params.epsilonR);
      return result('boundary', 'charged-sheet', {}, [...values,
        scalar('EzMinus', 'z⁻ 극한 E', -ez, 'V/m'), scalar('EzPlus', 'z⁺ 극한 E', ez, 'V/m'),
        scalar('DzMinus', 'z⁻ 극한 D', -dz, 'C/m²'), scalar('DzPlus', 'z⁺ 극한 D', dz, 'C/m²')],
      notes, '전하 면의 단일 장 대신 양측 극한을 표시합니다.');
    }
    return electrostatic([0, 0, Math.sign(point[2]) * params.sigma / 2], params, values,
      point[2] < 0 ? 'below-sheet' : 'above-sheet', notes);
  },
  verify(params) {
    const a = gaussSheet.evaluate(params, [0, 0, params?.centerZ + params?.halfHeight]);
    const b = gaussSheet.evaluate(params, [0, 0, params?.centerZ - params?.halfHeight]);
    if (a.status !== 'valid' || b.status !== 'valid') return [skipped('pillbox 전속 적분', a.reason || b.reason)];
    let d = 0, e = 0;
    // 128 equal-area patches per face; face normals have opposite signs.
    for (const [evaluated, normal] of [[a, 1], [b, -1]])
      for (let i = 0; i < 128; i++) {
        d += normal * evaluated.vectors.D[2] * params.area / 128;
        e += normal * evaluated.vectors.E[2] * params.area / 128;
      }
    const enclosed = Math.abs(params.centerZ) < params.halfHeight ? params.sigma * params.area : 0;
    return [
      check('pillbox D 전속 / 포획 자유전하', '256 oriented cap patches; side normal perpendicular to field',
        d, enclosed, 'C', 1e-20),
      check('pillbox E 전속 / Qenc/ε', 'opposite outward cap normals; incoming flux subtracts',
        e, enclosed / (EPS0 * params.epsilonR), 'V m', 1e-10),
    ];
  },
};

function currentInside(params, r) {
  return params.wireRadius === 0 || r >= params.wireRadius ? params.current :
    params.current * (r / params.wireRadius) ** 2;
}
function circulationIntegral(params, count) {
  let h = 0, b = 0;
  for (let i = 0; i < count; i++) {
    const theta = params.orientation * (i + 0.5) * 2 * Math.PI / count;
    const x = Math.cos(theta), y = Math.sin(theta);
    const sampled = ampereWire.evaluate(params, [params.pathRadius * x, params.pathRadius * y, 0]);
    if (sampled.status !== 'valid') return null;
    const dl = params.orientation * params.pathRadius * 2 * Math.PI / count;
    h += (-sampled.vectors.H[0] * y + sampled.vectors.H[1] * x) * dl;
    b += (-sampled.vectors.B[0] * y + sampled.vectors.B[1] * x) * dl;
  }
  return { H: h, B: b };
}
const ampereWire = {
  id: 'ampere-wire', title: '암페어 순환: 무한 선전류 / 균일 원통', topic: 'integrals',
  modelKind: 'analytic-symmetry',
  description: 'z축 정상 전류, 동축 원 경로. 포획 전류와 경로 방향으로 H/B의 순환 부호를 확인합니다.',
  parameters: [
    parameter('current', '+z 방향 총 전류 I (부호 포함)', 'A', 'A', 1, 3, -1e6, 1e6),
    parameter('muR', '균일 상대 투자율 μr', '1', '1', 1, 1, 1e-3, 1000),
    parameter('wireRadius', '전류 원통 반경 a: 0=이상 선, 양수=균일 J', 'm', 'cm', 0.01, 0, 0, 10),
    length('pathRadius', '동축 원 경로 반지름 R', 0.1),
    parameter('orientation', '+z에서 본 경로: +1=반시계, −1=시계', '1', '1', 1, 1, -1, 1),
  ],
  probeDefault: [0.1, 0, 0],
  view: { kind: 'azimuthal', plane: 'xy', extent: 0.3, probeAxes: [0, 1] },
  assumptions: ['무한 z축 정상 전류. a=0 이상 선전류; a>0 균일 Jz=I/(πa²) 원통.',
    '모든 영역은 동일한 선형 μ=μ₀μr. 강자성/skin effect/변위전류/시간변화 없음.',
    '경로는 xy의 동축 원. +z에서 본 반시계 경로의 면 법선은 +z.'],
  validity: ['orientation은 정확히 ±1; a는 0 또는 ≥1 nm; R>0.',
    '순환은 입력 경로의 값, B/H 벡터는 프로브 위치의 값. 경로 반전은 벡터 자체를 바꾸지 않는다.',
    '일반 경로와 비균일 전류의 solver는 없으며 원 경로 적분만 제공한다.'],
  singularities: ['a=0,I≠0일 때 축 singular. a>0 축은 B=H=0으로 정상.',
    '원통 표면 r=a는 J의 경계: H/B는 연속이며 양측 극한을 표시. 경계 경로의 수치 검증은 skipped.',
    '반경 clamp 없음; 너무 작은 비영 반경은 명시적 입력 범위 오류.'],
  formulas: [
    { label: '국소 장', text: 'Hφ=I r/(2πa²) (r<a); Hφ=I/(2πr) (r≥a); B=μH', unit: 'A/m' },
    { label: '포획 전류', text: 'Ienc=orientation·I·(R/a)² (R<a); else orientation·I', unit: 'A' },
    { label: '순환', text: '∮H·dl=Ienc; ∮B·dl=μIenc', unit: 'A' },
  ],
  references: [AMPERE, MIT],
  evaluate(params, point) {
    const error = validate(ampereWire, params, point);
    if (error) return excluded('invalid', error);
    if (params.orientation !== 1 && params.orientation !== -1)
      return excluded('invalid', 'orientation은 정확히 +1 또는 −1이어야 합니다.');
    if (params.wireRadius > 0 && params.wireRadius < 1e-9)
      return excluded('invalid', 'wireRadius는 0(이상 선) 또는 1 nm 이상이어야 합니다.');
    const r = Math.hypot(point[0], point[1]);
    if (!Number.isFinite(r)) return excluded('invalid', '반경이 유한한 수치 범위를 벗어납니다.');
    if (r === 0 && params.wireRadius === 0 && params.current !== 0)
      return excluded('singular', '비영 이상 선전류의 축에서 장은 정의되지 않습니다.', 'filament-axis');
    const mu = MU0 * params.muR;
    const h = params.current === 0 || r === 0 ? 0 : params.wireRadius > 0 && r < params.wireRadius ?
      params.current / (2 * Math.PI) / params.wireRadius * (r / params.wireRadius) :
      params.current / (2 * Math.PI) / r;
    if (params.current !== 0 && r > 0 && h === 0)
      return excluded('invalid', '비영 장이 수치 표현 범위 아래입니다.');
    const enclosed = params.orientation * currentInside(params, params.pathRadius);
    const values = [
      scalar('enclosedCurrent', '경로 법선 기준 Ienc', enclosed, 'A'),
      scalar('circulationH', '∮H·dl (해석값)', enclosed, 'A'),
      scalar('circulationB', '∮B·dl (해석값)', mu * enclosed, 'T m'),
      scalar('pathRadius', '원 경로 반지름', params.pathRadius, 'm'),
      scalar('orientation', '경로 방향 (+z에서)', params.orientation, '1'),
    ];
    const notes = ['양의 전류에서 H/B는 +z에서 본 반시계. 경로만 반전하면 순환과 Ienc만 반전.',
      params.wireRadius === 0 ? '이상 선전류 모델.' : '균일 전류 원통 모델; 경로 안의 전류 면적만 포획.'];
    if (params.wireRadius > 0 && r === params.wireRadius)
      return result('boundary', 'current-cylinder-surface', {}, [...values,
        scalar('HphiMinus', 'r⁻ 극한 Hφ', h, 'A/m'), scalar('HphiPlus', 'r⁺ 극한 Hφ', h, 'A/m'),
        scalar('BphiMinus', 'r⁻ 극한 Bφ', mu * h, 'T'), scalar('BphiPlus', 'r⁺ 극한 Bφ', mu * h, 'T')],
      notes, '균일 μ에서 장은 연속입니다. J 경계의 양측 극한을 표시합니다.');
    const H = r === 0 ? [0, 0, 0] : [-h * (point[1] / r), h * (point[0] / r), 0];
    return result('valid', params.wireRadius > 0 && r < params.wireRadius ? 'uniform-current-interior' : 'wire-exterior',
      { H, B: H.map(v => mu * v) }, values, notes);
  },
  verify(params) {
    const sample = ampereWire.evaluate(params, [params?.pathRadius, 0, 0]);
    if (sample.status !== 'valid') return [skipped('원 경로 순환', sample.reason)];
    const coarse = circulationIntegral(params, 128), fine = circulationIntegral(params, 256);
    if (!coarse || !fine) return [skipped('원 경로 순환', '경로가 특이점/원통 경계를 지납니다.')];
    // Integrate the independently specified uniform current density over the disk.
    // Each annulus has area π(r_outer²-r_inner²), not a pointwise field estimate.
    let expected = params.current;
    if (params.wireRadius > 0 && params.pathRadius < params.wireRadius) {
      expected = 0;
      const J = params.current / (Math.PI * params.wireRadius * params.wireRadius);
      for (let i = 0; i < 128; i++) {
        const r0 = i * params.pathRadius / 128, r1 = (i + 1) * params.pathRadius / 128;
        expected += J * Math.PI * (r1 - r0) * (r1 + r0);
      }
    }
    expected *= params.orientation;
    return [
      check('H 순환 / 포획 전류', '256 tangent samples vs 128 current-density disk annuli (inside)',
        fine.H, expected, 'A', 1e-12),
      check('B 순환 / μIenc', '256 evaluated B·dl samples with oriented tangent',
        fine.B, MU0 * params.muR * expected, 'T m', 1e-15),
      check('원 경로 표본 수렴 128→256', 'separate oriented tangent sums', fine.H, coarse.H, 'A', 1e-12),
    ];
  },
};


// Supported geometry templates; structural enums never receive physical samples.
const integralChoice = (key, label, initial, choices) =>
  ({ key, label, initial, choices: choices.map(([value, text]) => ({ value, label: text })) });
const normalControl = () => integralChoice('orientation', '닫힌 면 법선 방향', 1, [[1, '바깥 법선'], [-1, '안쪽 법선']]);
const absentControl = symbol => integralChoice('zeroSource', '원천 조건', 0, [[0, '부호 있는 ' + symbol + '≠0'], [1, symbol + '=0 (원천 없음)']]);
const integralGiven = (symbol, meaning, unit, constraint) => ({ symbol, meaning, unit, constraint });
function integralOptions(controls, options) {
  if (!options || ![Object.prototype, null].includes(Object.getPrototypeOf(options)))
    return { reason: '구조 조건은 일반 객체여야 합니다.' };
  for (const key of Object.keys(options)) {
    const control = controls.find(c => c.key === key);
    if (!control || !control.choices.some(c => c.value === options[key]))
      return { reason: key + ': 지원하는 구조 enum을 선택하세요. 물리 수치는 별도 예시 입력입니다.' };
  }
  return { values: Object.fromEntries(controls.map(c => [c.key, options[c.key] ?? c.initial])) };
}
function integralSymbolicResult(title) {
  return { status: 'supported', title, reason: '', givens: [], assumptions: [], conditions: [],
    laws: [], steps: [], answers: [], regions: [], boundaries: [],
    limitations: ['이 결과는 지원된 대칭 모델의 기호 유도 템플릿이며 범용 CAS·자유 문장 solver가 아닙니다.',
      '수치 예시/샘플링의 수렴 한계와 기호 식의 정의역을 구분합니다.'] };
}
function gaussSymbolicBase(title, orientation) {
  const out = integralSymbolicResult(title);
  out.givens.push(integralGiven('ε', '공간 전체의 균일 유전율 ε=ε₀εr', 'F/m', 'ε>0'));
  out.assumptions = ['정전장, 공간 전체에 균일·선형·등방 유전체.',
    orientation === 1 ? '닫힌 면 S의 법선 n̂는 바깥쪽.' : '닫힌 면 S의 법선 n̂는 안쪽; 표준 가우스 바깥 법선의 반대.'];
  out.laws = [{ name: '자유전하 가우스 법칙', formula: orientation === 1 ? 'ΦD=∮S D·n̂ dA=Qenc' : 'ΦD=∮S D·n̂ dA=−Qenc' },
    { name: '균일 유전체 구성식', formula: 'D=εE; ΦE=ΦD/ε' }];
  out.limitations.push('ΦD 단위 C와 ΦE 단위 V m를 구분합니다. 외부 전하의 국소 장은 순전속 0이어도 존재합니다.',
    '임의 형상/비균일 유전체 solver 없음. 무한 전하 모델의 V(∞)=0을 주장하지 않습니다.');
  return out;
}

const pointControls = [
  integralChoice('sourceLocation', '점전하와 구면의 위치 관계', 0, [[0, '구면 안'], [1, '구면 밖'], [2, '구면 위']]),
  normalControl(), absentControl('q'),
];
Object.assign(gaussPoint, {
  symbolicControls: pointControls,
  symbolic(options = {}) {
    const selected = integralOptions(pointControls, options);
    if (selected.reason) return { ...integralSymbolicResult('점전하와 구면 전속'), status: 'unsupported', reason: selected.reason };
    const { sourceLocation, orientation, zeroSource } = selected.values;
    const out = gaussSymbolicBase('점전하: 구면 포획 조건으로 전속 유도', orientation);
    const flux = zeroSource || sourceLocation === 1 ? '0' : orientation === 1 ? 'q' : '−q';
    out.givens.push(integralGiven('q', '원점의 자유 점전하', 'C', zeroSource ? 'q=0' : 'q≠0, 부호 포함'),
      integralGiven('R', '가우스 구면 반지름', 'm', 'R>0'),
      integralGiven('zc', '구면 중심 (0,0,zc)의 z 좌표', 'm', 'zc는 부호 포함'),
      integralGiven('r', '국소 관측점의 원점 거리', 'm', zeroSource ? 'r≥0' : 'r>0'));
    out.assumptions.push('전하는 원점; 닫힌 구면은 원점과 반드시 동심일 필요가 없습니다.');
    out.conditions = [sourceLocation === 0 ? '|zc|<R' : sourceLocation === 1 ? '|zc|>R' : '|zc|=R',
      zeroSource ? '전하가 없어 장의 원점 특이성도 사라짐' : 'q≠0: 원점 국소 장은 정의되지 않음'];
    out.steps = [{ title: '점전하 국소 장', formula: zeroSource ? 'D=E=0' : 'D_r=q/(4πr²); E_r=D_r/ε',
      explanation: 'r̂는 원점에서 관측점 방향; 구면 중심 방향과 구분합니다.' },
      { title: '포획 여부', formula: zeroSource || sourceLocation === 1 ? 'Qenc=0' : sourceLocation === 0 ? 'Qenc=q' : '점전하가 적분면 위에 있음',
        explanation: '구면 안의 자유전하만 셉니다. 밖의 전하가 국소장을 0으로 만들지는 않습니다.' },
      { title: '법칙에 포획량 적용', formula: sourceLocation === 2 && !zeroSource ? '통상적 전속 적분의 원천 교차' : 'ΦD=' + flux + '; ΦE=ΦD/ε',
        explanation: orientation === 1 ? '바깥 법선을 적용합니다.' : '안쪽 법선으로 반전하면 전속만 부호 반전; 실제 장은 그대로입니다.' }];
    out.boundaries = [{ condition: '|zc|=R, q≠0', formula: 'Qenc와 통상 ΦD/ΦE의 단일값 미지정',
      explanation: '원천이 구면 위입니다. ½q나 임의 clamp를 넣지 않습니다.' },
      { condition: 'r=0', formula: zeroSource ? 'D=E=0' : 'D/E 미정의', explanation: zeroSource ? '원천 없음.' : '이상 점전하의 특이점.' }];
    if (sourceLocation === 2 && !zeroSource) return { ...out, status: 'unsupported',
      reason: '비영 점전하가 구면 위에 있습니다. 통상 닫힌 전속의 유한 기호 답을 지정할 수 없습니다.' };
    out.answers = [
      { quantity: 'D_r', formula: zeroSource ? 'D_r = 0' : 'D_r = q/(4·π·r²)', unit: 'C/m²', direction: 'D=D_r r̂; r̂=(x,y,z)/r, q의 부호 포함' },
      { quantity: 'E_r', formula: zeroSource ? 'E_r = 0' : 'E_r = q/(4·π·ε·r²)', unit: 'V/m', direction: 'E=E_r r̂; 면 법선 반전은 국소 방향을 바꾸지 않음' },
      { quantity: 'Qenc', formula: 'Qenc = ' + (zeroSource || sourceLocation === 1 ? '0' : 'q'), unit: 'C', direction: '물리적 포획 전하는 법선 반전과 무관' },
      { quantity: 'ΦD', formula: 'ΦD = ' + flux, unit: 'C', direction: orientation === 1 ? '바깥 법선 순전속' : '안쪽 법선 순전속' },
      { quantity: 'ΦE', formula: 'ΦE = ' + (flux === '0' ? '0' : flux + '/ε'), unit: 'V m', direction: '같은 선택 법선' },
    ];
    out.regions = [{ condition: sourceLocation === 0 ? '|zc|<R' : sourceLocation === 1 ? '|zc|>R' : 'q=0',
      formula: 'ΦD = ' + flux, explanation: sourceLocation === 1 && !zeroSource ? '비영 국소장과 순전속 0이 동시에 성립합니다.' : '선택된 포획 조건.' }];
    return out;
  },
});

const lineControls = [normalControl(), absentControl('λ')];
Object.assign(gaussLine, {
  symbolicControls: lineControls,
  symbolic(options = {}) {
    const selected = integralOptions(lineControls, options);
    if (selected.reason) return { ...integralSymbolicResult('무한 선전하 원통 전속'), status: 'unsupported', reason: selected.reason };
    const { orientation, zeroSource } = selected.values;
    const out = gaussSymbolicBase('무한 선전하: 닫힌 원통 전속 유도', orientation);
    const flux = zeroSource ? '0' : orientation === 1 ? 'λ·L' : '−λ·L';
    out.givens.push(integralGiven('λ', 'z축의 자유 선전하 밀도', 'C/m', zeroSource ? 'λ=0' : 'λ≠0, 부호 포함'),
      integralGiven('R, L', '동축 가우스 원통의 반경과 높이', 'm', 'R>0, L>0'),
      integralGiven('r', '국소 관측점의 축까지 거리', 'm', zeroSource ? 'r≥0' : 'r>0'));
    out.assumptions.push('무한 균일 z축 선전하, 닫힌 원통은 선과 동축.');
    out.conditions = ['r=√(x²+y²)', '원통의 옆면과 양쪽 뚜껑을 모두 포함'];
    out.steps = [{ title: '대칭', formula: 'D=D_r r̂, D_z=0', explanation: '회전/병진 대칭으로 반경 방향 장만 남습니다.' },
      { title: '원천 길이 적분', formula: zeroSource ? 'Qenc=0' : 'Qenc=∫λ dz=λL', explanation: '높이 L 안의 선전하를 포획합니다.' },
      { title: '옆면과 뚜껑', formula: orientation === 1 ? 'ΦD=2πRL D_r(R)+0+0' : 'ΦD=−2πRL D_r(R)+0+0',
        explanation: '뚜껑 ±z 법선에 장이 수직이므로 전속 0; 선 교차점은 부정적분으로 해석.' },
      { title: '반경 장 풀기', formula: zeroSource ? 'D_r=0' : 'D_r=λ/(2πr)', explanation: '법선 반전은 적분의 양쪽 부호를 함께 바꾸므로 국소 장은 불변.' }];
    out.answers = [{ quantity: 'D_r', formula: zeroSource ? 'D_r = 0' : 'D_r = λ/(2·π·r)', unit: 'C/m²', direction: 'r̂=(x/r,y/r,0); λ>0 바깥, λ<0 안쪽' },
      { quantity: 'E_r', formula: zeroSource ? 'E_r = 0' : 'E_r = λ/(2·π·ε·r)', unit: 'V/m', direction: 'D와 같은 반경 방향' },
      { quantity: 'Qenc', formula: 'Qenc = ' + (zeroSource ? '0' : 'λ·L'), unit: 'C', direction: '법선 반전과 무관' },
      { quantity: 'ΦD', formula: 'ΦD = ' + flux, unit: 'C', direction: orientation === 1 ? '옆면 법선 +r̂' : '옆면 법선 −r̂' },
      { quantity: 'ΦE', formula: 'ΦE = ' + (zeroSource ? '0' : flux + '/ε'), unit: 'V m', direction: '선택 법선의 닫힌 순전속' }];
    out.regions = [{ condition: zeroSource ? 'r≥0, λ=0' : 'r>0, λ≠0', formula: zeroSource ? 'E=D=0' : 'E_r=λ/(2πεr)', explanation: '원통 R,L은 적분 형상; 국소 반경 r과 구분.' }];
    out.boundaries = [{ condition: 'r=0', formula: zeroSource ? 'E=D=0' : 'E/D 미정의', explanation: '비영 이상 선전하 축은 특이점.' },
      { condition: '선과 원통 뚜껑의 교차점', formula: '뚜껑 ΦD=0 (법선 성분의 부정적분)', explanation: '그 점의 장을 유한한 0으로 대체하지 않습니다.' }];
    return out;
  },
});

const sheetControls = [
  integralChoice('surfacePlacement', 'pillbox와 전하면 관계', 0,
    [[0, '면을 가로지름'], [1, '면 위쪽'], [2, '면 아래쪽'], [3, '뚜껑이 면에 닿음']]),
  normalControl(), absentControl('σ'),
];
Object.assign(gaussSheet, {
  symbolicControls: sheetControls,
  symbolic(options = {}) {
    const selected = integralOptions(sheetControls, options);
    if (selected.reason) return { ...integralSymbolicResult('면전하 pillbox 전속'), status: 'unsupported', reason: selected.reason };
    const { surfacePlacement, orientation, zeroSource } = selected.values;
    const out = gaussSymbolicBase('무한 절연 전하면: pillbox 전속 유도', orientation);
    const positionCondition = ['|zc|<h', 'zc>h', 'zc<−h', '|zc|=h'][surfacePlacement];
    const enclosed = zeroSource || surfacePlacement !== 0 ? '0' : 'σ·A';
    const flux = enclosed === '0' ? '0' : orientation === 1 ? enclosed : '−σ·A';
    const topSign = surfacePlacement === 2 ? -orientation : orientation;
    const bottomSign = surfacePlacement === 0 || surfacePlacement === 2 ? orientation : -orientation;
    const cap = sign => zeroSource ? '0' : (sign === 1 ? '' : '−') + 'σ·A/2';
    out.givens.push(integralGiven('σ', 'z=0 절연면의 자유 면전하 밀도', 'C/m²', zeroSource ? 'σ=0' : 'σ≠0, 부호 포함'),
      integralGiven('A', '각 뚜껑의 면적', 'm²', 'A>0'),
      integralGiven('h', 'pillbox 반높이', 'm', 'h>0'), integralGiven('zc', 'pillbox 중심 z좌표', 'm', positionCondition),
      integralGiven('z', '국소 관측 높이', 'm', zeroSource ? '모든 z' : '장 관측은 z≠0'));
    out.assumptions.push('무한 절연 전하면 (도체의 한쪽 표면과 다름), 뚜껑은 xy에 평행.');
    out.conditions = [positionCondition, '위 뚜껑 z=zc+h, 아래 뚜껑 z=zc−h',
      orientation === 1 ? '위 n̂=+ẑ, 아래 n̂=−ẑ' : '위 n̂=−ẑ, 아래 n̂=+ẑ'];
    out.steps = [{ title: '평면 대칭', formula: zeroSource ? 'E=D=0' : 'D_z(z)=sign(z)σ/2; E_z=D_z/ε',
      explanation: '양쪽으로 동일한 크기의 장; σ/ε인 도체 한쪽 식과 구분합니다.' },
      { title: '포획 면전하', formula: surfacePlacement === 3 && !zeroSource ? '원천 면이 뚜껑 위' : 'Qenc=' + enclosed,
        explanation: surfacePlacement === 0 ? 'pillbox 안의 전하 면적 A만 포획.' : '면 바깥 pillbox는 전하를 포함하지 않습니다.' },
      { title: '양 뚜껑과 옆면', formula: orientation === 1 ? 'ΦD=A[D_z(zc+h)−D_z(zc−h)]' : 'ΦD=−A[D_z(zc+h)−D_z(zc−h)]',
        explanation: '옆면 장의 법선 성분은 0이고, 두 뚜껑 법선은 반대입니다.' }];
    out.boundaries = [{ condition: 'z=0, σ≠0', formula: 'D_z⁻=−σ/2, D_z⁺=σ/2; E_z⁻=−σ/(2ε), E_z⁺=σ/(2ε)',
      explanation: '단일 관측 장 없음. D의 +z 방향 점프는 자유 면전하 σ.' },
      { condition: '|zc|=h, σ≠0', formula: '통상 pillbox 포획량/전속의 단일값 미지정', explanation: '전하 면이 뚜껑에 놓임; ½σA를 임의로 부여하지 않습니다.' }];
    if (surfacePlacement === 3 && !zeroSource) return { ...out, status: 'unsupported',
      reason: '비영 전하 면이 pillbox 뚜껑과 겹칩니다. 통상 적분의 단일 전속 답을 지정하지 않습니다.' };
    out.steps.push({ title: '선택한 위치의 각 뚜껑 장',
      formula: zeroSource ? 'D_z(zc+h)=D_z(zc−h)=0' :
        'D_z(zc+h)=' + (surfacePlacement === 2 ? '−σ/2' : 'σ/2') +
        '; D_z(zc−h)=' + (surfacePlacement === 0 || surfacePlacement === 2 ? '−σ/2' : 'σ/2'),
      explanation: '면의 위/아래 위치를 먼저 적용하고 선택한 법선으로 각 뚜껑 전속을 더합니다.' });
    out.answers = [{ quantity: 'E_z(z)', formula: zeroSource ? 'E_z(z) = 0' : 'E_z(z) = sign(z)·σ/(2·ε)', unit: 'V/m', direction: 'E=E_z ẑ; σ>0 면에서 멀어지고 σ<0 면으로 향함' },
      { quantity: 'Qenc', formula: 'Qenc = ' + enclosed, unit: 'C', direction: '물리적 포획량; 선택 법선과 무관' },
      { quantity: 'ΦD,top', formula: 'ΦD,top = ' + cap(topSign), unit: 'C', direction: '선택된 위 뚜껑 법선' },
      { quantity: 'ΦD,bottom', formula: 'ΦD,bottom = ' + cap(bottomSign), unit: 'C', direction: '선택된 아래 뚜껑 법선' },
      { quantity: 'ΦD', formula: 'ΦD = ' + flux, unit: 'C', direction: '닫힌 순전속; 입사 전속은 부호를 포함' },
      { quantity: 'ΦE', formula: 'ΦE = ' + (flux === '0' ? '0' : flux + '/ε'), unit: 'V m', direction: '선택된 닫힌 면 법선' }];
    out.regions = [{ condition: 'z>0', formula: zeroSource ? 'E_z = 0' : 'E_z = σ/(2·ε)', explanation: '위쪽 국소장.' },
      { condition: 'z<0', formula: zeroSource ? 'E_z = 0' : 'E_z = −σ/(2·ε)', explanation: '아래쪽 국소장.' },
      { condition: positionCondition, formula: 'ΦD = ' + flux,
        explanation: surfacePlacement === 1 || surfacePlacement === 2 ? '국소장≠0이어도 위/아래 입출 전속 상쇄로 순전속 0.' : '선택된 원천 포획 조건.' }];
    if (zeroSource) out.boundaries = [{ condition: '모든 z 및 모든 pillbox 위치, σ=0', formula: 'E=D=ΦD=ΦE=0', explanation: '전하 면이 없어 경계의 장 점프도 사라집니다.' }];
    return out;
  },
});

const ampereControls = [
  integralChoice('wireMode', '전류 분포', 0, [[0, '이상 선전류 a=0'], [1, '균일 DC 전류 원통 a>0']]),
  integralChoice('pathRegion', '원 경로 위치', 0, [[0, '원천 바깥'], [1, '원통 내부'], [2, '원통 표면']]),
  integralChoice('orientation', '+z에서 본 경로 방향', 1, [[1, '반시계'], [-1, '시계']]), absentControl('I'),
];
Object.assign(ampereWire, {
  symbolicControls: ampereControls,
  symbolic(options = {}) {
    const selected = integralOptions(ampereControls, options);
    const out = integralSymbolicResult('정상 선전류/균일 원통: 암페어 순환과 국소 장');
    if (selected.reason) return { ...out, status: 'unsupported', reason: selected.reason };
    const { wireMode, pathRegion, orientation, zeroSource } = selected.values;
    const sign = orientation === 1 ? '' : '−';
    out.givens = [integralGiven('I', '+z 방향 총 정상 전류', 'A', zeroSource ? 'I=0' : 'I≠0, 부호 포함'),
      integralGiven('μ', '공간 전체의 균일 투자율', 'H/m', 'μ>0'),
      integralGiven('R', 'xy 평면의 동축 원 경로 반경', 'm', 'R>0'),
      integralGiven('r', '국소 관측점의 축까지 거리', 'm', wireMode === 1 || zeroSource ? 'r≥0' : 'r>0')];
    if (wireMode === 1) out.givens.push(integralGiven('a', '균일 전류 원통 반경', 'm', 'a>0'));
    out.assumptions = ['무한 z축 정상 전류, 균일 선형 μ; 변위전류·skin effect 없음.',
      wireMode === 1 ? 'J_z=I/(πa²), r<a에 균일한 체적전류.' : 'a=0 이상 선전류 (표면 원통 모델이 아님).'];
    out.conditions = [wireMode === 1 ? ['R>a', '0<R<a', 'R=a'][pathRegion] : 'a=0, R>0',
      orientation === 1 ? '경로는 +z에서 반시계; 경로면 법선 +ẑ' : '경로는 +z에서 시계; 경로면 법선 −ẑ'];
    out.laws = [{ name: '정자계 암페어 법칙', formula: '∮H·dl=Ienc(R)' }, { name: '균일 구성식', formula: 'B=μH' }];
    out.limitations.push('μ H는 자기선속밀도 B(T); ∮B·dl 단위 T m. 지정 면 없는 ΦB(Wb)는 답으로 주장하지 않습니다.',
      '임의 경로·비균일 전류·유한 전류선의 solver는 미지원. 경로 반전은 실제 장벡터를 바꾸지 않습니다.');
    if (wireMode === 0 && pathRegion !== 0) return { ...out, status: 'unsupported',
      reason: '이상 선 a=0에서 0<R<a 또는 R=a인 유효 원 경로는 없습니다.' };
    const enclosed = zeroSource ? '0' : sign + (wireMode === 1 && pathRegion === 1 ? 'I·R²/a²' : 'I');
    out.steps = [{ title: '포획 전류 적분', formula: zeroSource ? 'Ienc=0' : wireMode === 1 && pathRegion === 1 ?
      'Ienc=' + sign + '∫₀ᴿ J_z 2πr′ dr′=' + enclosed : 'Ienc=' + enclosed,
      explanation: wireMode === 1 && pathRegion === 2 ? 'R=a에서 안쪽 전류 적분과 바깥 총전류의 한쪽 극한이 모두 I; 선택 법선 적용.' : '전류 분포와 경로면 법선을 함께 적용; 내부 원통은 면적 비율만 포획.' },
      { title: '회전 대칭', formula: 'H=Hφ φ̂; 2πr Hφ=물리적 +z 포획전류',
        explanation: '국소 φ̂는 +z에서 반시계; 경로 선택과 독립적으로 정의합니다.' },
      { title: '선택 경로 순환', formula: 'ΓH=Ienc(R); ΓB=μ Ienc(R)', explanation: '원 경로의 접선과 장을 내적합니다.' }];
    out.answers = [{ quantity: 'Ienc(R)', formula: 'Ienc(R) = ' + enclosed, unit: 'A', direction: '선택 경로 법선 기준의 부호 있는 전류; ' + (wireMode === 1 ? ['R>a', '0<R<a', 'R=a'][pathRegion] : 'a=0, R>0') },
      { quantity: 'ΓH', formula: 'ΓH = ' + enclosed, unit: 'A', direction: orientation === 1 ? '반시계 경로 순환' : '시계 경로 순환' },
      { quantity: 'ΓB', formula: 'ΓB = ' + (zeroSource ? '0' : 'μ·' + enclosed), unit: 'T m', direction: '선택 경로 접선 기준' },
      { quantity: 'H(r)', formula: zeroSource ? 'H(r) = 0' : wireMode === 0 ? 'Hφ = I/(2·π·r)' : 'Hφ = I·r/(2πa²) (r<a); I/(2πr) (r≥a)',
        unit: 'A/m', direction: 'H=Hφ φ̂; φ̂=(-y/r,x/r,0), +I 반시계, −I 시계' },
      { quantity: 'B(r)', formula: 'B(r) = μH(r)', unit: 'T', direction: '실제 B/H 방향은 경로 반전으로 바뀌지 않음' }];
    out.regions = wireMode === 1 ? [
      { condition: '0≤r<a', formula: zeroSource ? 'Hφ = 0' : 'Hφ = I·r/(2·π·a²)', explanation: '균일 J의 포획 전류 I r²/a²; 축 r=0은 정상 H=B=0.' },
      { condition: 'r>a', formula: zeroSource ? 'Hφ = 0' : 'Hφ = I/(2·π·r)', explanation: '전체 I 포획; Bφ=μHφ.' },
    ] : [{ condition: zeroSource ? 'r≥0' : 'r>0', formula: zeroSource ? 'Hφ = 0' : 'Hφ = I/(2·π·r)', explanation: '이상 선전류; Bφ=μHφ.' }];
    out.boundaries = wireMode === 1 ?
      [{ condition: 'r=0', formula: 'H=B=0', explanation: '균일 체적전류의 정상 축.' },
        { condition: 'r=a', formula: zeroSource ? 'H=B=0' : 'Hφ⁻=Hφ⁺=I/(2πa); Bφ⁻=Bφ⁺=μI/(2πa)',
          explanation: '표면 자유전류 없음, 균일 μ; J는 경계가 있지만 H/B는 연속. R=a의 기호 순환도 정의됨.' }] :
      [{ condition: 'r=0', formula: zeroSource ? 'H=B=0' : 'H/B 미정의', explanation: zeroSource ? '전류가 없어 특이성 제거.' : '비영 이상 선전류의 특이축.' }];
    return out;
  },
});


export const EXPERIMENTS = [gaussPoint, gaussLine, gaussSheet, ampereWire];
