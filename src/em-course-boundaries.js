import { EPS0 } from './em-course-constants.js';

const MIT = {
  title: 'MIT 6.013 §2.6 경계조건 및 §3.1 직렬 커패시터 (법선 방향 변환 명시)',
  url: 'https://ocw.mit.edu/courses/6-013-electromagnetics-and-applications-spring-2009/d3be4ea78b036a6362230fb41780cf54_MIT6_013S09_notes.pdf',
};
const DIELECTRIC = {
  title: 'OpenStax University Physics 2 §8.4: 고정 전하와 유전체',
  url: 'https://openstax.org/books/university-physics-volume-2/pages/8-4-capacitor-with-a-dielectric',
};
const parameter = (key, label, unit, displayUnit, displayScale, initial, min, max) =>
  ({ key, label, unit, displayUnit, displayScale, initial, min, max });
const permittivity = (key, label, initial) => parameter(key, label, '1', '1', 1, initial, 1, 1000);
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
function limits(E1, E2, D1, D2) {
  return ['x', 'y', 'z'].flatMap((axis, i) => [
    scalar('E1' + axis, '매질 1 한쪽 극한 E' + axis, E1[i], 'V/m'),
    scalar('E2' + axis, '매질 2 한쪽 극한 E' + axis, E2[i], 'V/m'),
    scalar('D1' + axis, '매질 1 한쪽 극한 D' + axis, D1[i], 'C/m²'),
    scalar('D2' + axis, '매질 2 한쪽 극한 D' + axis, D2[i], 'C/m²'),
  ]);
}
function skipped(label, reason) {
  return { label, method: 'domain validation', actual: 0, expected: 0, unit: '1',
    absTolerance: 0, relTolerance: 0, status: 'skipped', reason };
}
function check(label, method, actual, expected, unit, absTolerance, relTolerance = 2e-10) {
  if (![actual, expected].every(Number.isFinite)) return skipped(label, '검증 값이 유한하지 않습니다.');
  const pass = Math.abs(actual - expected) <= absTolerance + relTolerance * Math.abs(expected);
  return { label, method, actual, expected, unit, absTolerance, relTolerance,
    status: pass ? 'pass' : 'fail', reason: pass ? '' : '독립 물리 제약의 허용오차를 초과했습니다.' };
}

const dielectricInterface = {
  id: 'dielectric-interface', title: '평면 유전체 경계: 한쪽 장 입력', topic: 'boundaries',
  modelKind: 'analytic-symmetry',
  description: 'z=0 평면에서 n=+z (매질 1→2). 주어진 E₁과 자유 표면전하로 E₂를 결정합니다.',
  parameters: [
    permittivity('epsilon1R', '매질 1 상대 유전율 ε₁r', 2),
    permittivity('epsilon2R', '매질 2 상대 유전율 ε₂r', 5),
    parameter('sigmaFree', '자유 계면전하 σfree (부호 포함)', 'C/m²', 'nC/m²', 1e-9, 0, -1, 1),
    ...[['E1x', '입력 E₁x (접선)', 30], ['E1y', '입력 E₁y (접선)', 0], ['E1z', '입력 E₁z (법선)', 40]]
      .map(([key, label, value]) => parameter(key, label, 'V/m', 'V/m', 1, value, -1e9, 1e9)),
  ],
  probeDefault: [0, 0, 0.05],
  view: { kind: 'plane-normal', plane: 'xz', extent: 0.2, probeAxes: [0, 2] },
  assumptions: ['정전장, 무한 평면, 각 영역의 균일 장; 선형·등방 유전체 ε=ε₀εr.',
    '매질 1: z<0, 매질 2: z>0. 법선은 매질 1에서 2로 향하는 +z.',
    'E₁은 외부 전극/전하가 정한 한쪽 입력이다. 유전율만으로 장을 결정할 수 없다.'],
  validity: ['ε₁r, ε₂r≥1; 자유 표면전하와 E₁의 부호를 그대로 사용한다.',
    '전역 전극 형상·비균일 전하·비등방 매질의 경계값 문제를 풀지 않는다.',
    '전위의 기준을 정하지 않았으므로 전위를 반환하지 않는다.'],
  singularities: ['z=0에서 단일 E/D를 지정하지 않고 양쪽 극한 성분을 표시한다. 이상적인 표면전하의 장 점프이며 거리 clamp 없음.'],
  formulas: [
    { label: '접선 E 연속', text: 'E₂x=E₁x, E₂y=E₁y', unit: 'V/m' },
    { label: '자유전하와 법선 D', text: 'D₂z−D₁z=σfree; E₂z=(ε₁E₁z+σfree)/ε₂', unit: 'C/m²' },
    { label: '구성식', text: 'Dᵢ=εᵢEᵢ, εᵢ=ε₀εᵢr', unit: 'C/m²' },
  ],
  references: [MIT],
  evaluate(params, point) {
    const error = validate(dielectricInterface, params, point);
    if (error) return excluded('invalid', error);
    const e1 = EPS0 * params.epsilon1R, e2 = EPS0 * params.epsilon2R;
    const E1 = [params.E1x, params.E1y, params.E1z];
    const E2 = [params.E1x, params.E1y, (e1 * params.E1z + params.sigmaFree) / e2];
    const D1 = E1.map(v => e1 * v), D2 = E2.map(v => e2 * v);
    const values = [...limits(E1, E2, D1, D2),
      scalar('sigmaFree', '자유 계면전하 σfree', params.sigmaFree, 'C/m²'),
      scalar('normalDJump', 'D₂z−D₁z (n=+z)', D2[2] - D1[2], 'C/m²')];
    const notes = ['n=+z: 매질 1→2. MIT 자료의 매질 1 안쪽 법선과 반대이므로 D₂−D₁로 표기.',
      '이 입력에 부합하는 균일 양측 장; 임의 일반 형상 경계 해결 결과가 아닙니다.'];
    if (point[2] === 0)
      return result('boundary', 'dielectric-interface', {}, values, notes, '계면에서는 단일 장 대신 양측 극한을 표시합니다.');
    const first = point[2] < 0;
    return result('valid', first ? 'medium-1' : 'medium-2',
      { E: first ? E1 : E2, D: first ? D1 : D2 }, values, notes);
  },
  verify(params) {
    const a = dielectricInterface.evaluate(params, [0, 0, -0.01]);
    const b = dielectricInterface.evaluate(params, [0, 0, 0.01]);
    if (a.status !== 'valid' || b.status !== 'valid') return [skipped('경계 적분', a.reason || b.reason)];
    // Unit-area outward pillbox, normal +z on the medium2 cap and -z on medium1.
    // Two rectangles of unit tangential length; opposite vertical segments cancel.
    return [
      check('단위면적 pillbox 자유전하', 'outward D cap flux / A vs supplied σfree',
        b.vectors.D[2] - a.vectors.D[2], params.sigmaFree, 'C/m²', 1e-20),
      ...[0, 1].map(i => check('접선 ' + 'xy'[i] + ' 방향 정전장 순환',
        'closed rectangle: E₁t L−E₂t L, L=1 m; normal legs cancel',
        a.vectors.E[i] - b.vectors.E[i], 0, 'V', 1e-10)),
    ];
  },
};

function layerSolution(params) {
  const e1 = EPS0 * params.epsilon1R, e2 = EPS0 * params.epsilon2R;
  const reciprocal = params.d1 / e1 + params.d2 / e2;
  const capacitance = params.area / reciprocal;
  const D = params.control === 0 ? params.charge / params.area : params.voltage / reciprocal;
  return { e1, e2, C: capacitance, D, E1: D / e1, E2: D / e2,
    Q: D * params.area, V: D * reciprocal, total: params.d1 + params.d2 };
}

const layeredPlate = {
  id: 'layered-plate', title: '2층 평행판: 고정 Q / 고정 V', topic: 'boundaries',
  modelKind: 'analytic-symmetry',
  description: '직렬 유전체, 자유 계면전하 0. 제어량에 따라 전하·전압·전기장·에너지 반응을 구분합니다.',
  parameters: [
    parameter('area', '판 면적 A', 'm²', 'cm²', 1e-4, 0.02, 1e-10, 100),
    parameter('d1', '층 1 두께 d₁', 'm', 'mm', 1e-3, 0.001, 1e-9, 10),
    parameter('d2', '층 2 두께 d₂', 'm', 'mm', 1e-3, 0.002, 1e-9, 10),
    permittivity('epsilon1R', '층 1 상대 유전율 ε₁r', 2),
    permittivity('epsilon2R', '층 2 상대 유전율 ε₂r', 5),
    parameter('control', '제어: 0=고정 Q, 1=고정 V', '1', '1', 1, 0, 0, 1),
    parameter('charge', '고정 Q: 아래판 전하 (control=0)', 'C', 'nC', 1e-9, 2e-9, -1e-3, 1e-3),
    parameter('voltage', '고정 V: V(0)−V(위판) (control=1)', 'V', 'V', 1, 12, -1e9, 1e9),
  ],
  probeDefault: [0, 0, 0.0005],
  view: { kind: 'plane-normal', plane: 'xz', extent: 0.004, probeAxes: [0, 2] },
  assumptions: ['무한판/프린징 무시의 1차원 모델; 면적 A는 총 Q와 C를 정한다.',
    '완전도체 아래판 z=0, 위판 z=d₁+d₂; 균형 자유전하 ±Q, 외부장 0.',
    '층 1과 2 계면 z=d₁에는 자유전하 없음. D 법선은 두 층에서 같다.',
    '0: 고립판 고정 Q, 1: 전압원 고정 V. 비활성 입력은 제어값으로 사용하지 않는다.'],
  validity: ['A,d₁,d₂>0; ε₁r,ε₂r≥1; control은 정확히 0 또는 1.',
    'V(위판)=0을 전위 기준으로 사용; Q>0, V>0일 때 E는 +z.',
    '유전율 공간 재척도로 일반 Coulomb장을 바꾸는 모델이 아니다.'],
  singularities: ['양 판과 층 계면에서 양측 극한; 전위는 연속. 두께 0 입력은 invalid이며 clamp하지 않는다.'],
  formulas: [
    { label: '직렬 정전용량', text: 'C=A/(d₁/ε₁+d₂/ε₂)', unit: 'F' },
    { label: '제어량', text: '고정 Q: D=Q/A; 고정 V: D=V/(d₁/ε₁+d₂/ε₂)', unit: 'C/m²' },
    { label: '층별 전기장', text: 'Eᵢ=D/εᵢ; V=E₁d₁+E₂d₂; σfree,interface=0', unit: 'V/m' },
    { label: '에너지', text: 'U=½A(D²d₁/ε₁+D²d₂/ε₂)=½QV', unit: 'J' },
  ],
  references: [MIT, DIELECTRIC],
  evaluate(params, point) {
    const error = validate(layeredPlate, params, point);
    if (error) return excluded('invalid', error);
    if (params.control !== 0 && params.control !== 1)
      return excluded('invalid', 'control은 0(고정 Q) 또는 1(고정 V)이어야 합니다.');
    const s = layerSolution(params), z = point[2];
    const energy = 0.5 * s.Q * s.V;
    const potential = z <= 0 ? s.V : z >= s.total ? 0 :
      z <= params.d1 ? s.E1 * (params.d1 - z) + s.E2 * params.d2 : s.E2 * (s.total - z);
    const values = [
      scalar('capacitance', '직렬 정전용량 C', s.C, 'F'),
      scalar('charge', '아래판 Q', s.Q, 'C'), scalar('voltage', 'V(0)−V(위판)', s.V, 'V'),
      scalar('potential', 'V(z), 위판 V=0 기준', potential, 'V'),
      scalar('energy', '저장 에너지 U', energy, 'J'),
      scalar('E1z', '층 1 E 법선', s.E1, 'V/m'), scalar('E2z', '층 2 E 법선', s.E2, 'V/m'),
      scalar('D1z', '층 1 D 법선', s.D, 'C/m²'), scalar('D2z', '층 2 D 법선', s.D, 'C/m²'),
      scalar('sigmaFreeInterface', '계면 자유전하', 0, 'C/m²'),
    ];
    const notes = [params.control === 0 ? '고정 Q: charge 입력 사용; voltage 입력은 사용하지 않습니다.' :
      '고정 V: voltage 입력 사용; charge 입력은 사용하지 않습니다.',
      '양쪽 외부는 균형판 가정에 따라 E=D=0. 전위 기준은 위판입니다.'];
    if (z === 0 || z === params.d1 || z === s.total) {
      const lower = z === 0, upper = z === s.total;
      const em = lower ? 0 : s.E1, ep = upper ? 0 : lower ? s.E1 : s.E2;
      const dm = lower ? 0 : s.D, dp = upper ? 0 : s.D;
      // At the upper plate the lower-side dielectric is layer2.
      const eMinus = upper ? s.E2 : em;
      return result('boundary', lower ? 'lower-plate' : upper ? 'upper-plate' : 'layer-interface', {},
        [...values, scalar('EzMinus', 'z⁻ 한쪽 극한 E', eMinus, 'V/m'),
          scalar('EzPlus', 'z⁺ 한쪽 극한 E', ep, 'V/m'),
          scalar('DzMinus', 'z⁻ 한쪽 극한 D', dm, 'C/m²'),
          scalar('DzPlus', 'z⁺ 한쪽 극한 D', dp, 'C/m²'),
          scalar('sigmaFreeBoundary', 'D(z⁺)−D(z⁻): 자유 표면전하', dp - dm, 'C/m²')],
        notes, '단일 장 대신 양측 극한을 표시합니다. 전위는 연속입니다.');
    }
    const inside = z > 0 && z < s.total;
    const e = !inside ? 0 : z < params.d1 ? s.E1 : s.E2;
    return result('valid', !inside ? 'exterior-conductor-potential' : z < params.d1 ? 'layer-1' : 'layer-2',
      { E: [0, 0, e], D: [0, 0, inside ? s.D : 0] }, values, notes);
  },
  verify(params) {
    const first = layeredPlate.evaluate(params, [0, 0, params?.d1 / 2]);
    const second = layeredPlate.evaluate(params, [0, 0, params?.d1 + params?.d2 / 2]);
    if (first.status !== 'valid' || second.status !== 'valid')
      return [skipped('층상 적분 검증', first.reason || second.reason)];
    let integratedVoltage = 0, integratedEnergy = 0;
    // Split at the interface. Never sample a discontinuity or average E across it.
    for (const [start, thickness, er] of [[0, params.d1, params.epsilon1R], [params.d1, params.d2, params.epsilon2R]]) {
      for (let i = 0; i < 256; i++) {
        const evaluated = layeredPlate.evaluate(params, [0, 0, start + (i + 0.5) * thickness / 256]);
        if (evaluated.status !== 'valid') return [skipped('층상 적분 검증', evaluated.reason)];
        const E = evaluated.vectors.E[2], dz = thickness / 256;
        integratedVoltage += E * dz;
        integratedEnergy += 0.5 * EPS0 * er * E * E * params.area * dz;
      }
    }
    const get = key => first.scalars.find(s => s.key === key).value;
    return [
      check('층별 선적분과 판 전압', '512 midpoint samples, split at interface: ∫E dz',
        integratedVoltage, get('voltage'), 'V', 1e-10),
      check('체적 에너지와 ½QV', '512 samples: ∫½εE² A dz vs capacitor work',
        integratedEnergy, 0.5 * get('charge') * get('voltage'), 'J', 1e-20),
      check('계면 자유전하 0', 'outward D cap flux / A', second.vectors.D[2] - first.vectors.D[2], 0, 'C/m²', 1e-20),
    ];
  },
};


// Structural symbolic templates only. Numerical illustrations stay in evaluate/verify.
const boundaryChoice = (key, label, initial, choices) =>
  ({ key, label, initial, choices: choices.map(([value, text]) => ({ value, label: text })) });
function boundaryOptions(controls, options) {
  if (!options || ![Object.prototype, null].includes(Object.getPrototypeOf(options)))
    return { reason: '구조 조건은 일반 객체여야 합니다.' };
  for (const key of Object.keys(options)) {
    const control = controls.find(c => c.key === key);
    if (!control || !control.choices.some(c => c.value === options[key]))
      return { reason: key + ': 지원하는 구조 조건을 선택하세요. 물리 수치는 기호 풀이 입력이 아닙니다.' };
  }
  return { values: Object.fromEntries(controls.map(c => [c.key, options[c.key] ?? c.initial])) };
}
function boundarySymbolicResult(title) {
  return { status: 'supported', title, reason: '', givens: [], assumptions: [], conditions: [],
    laws: [], steps: [], answers: [], regions: [], boundaries: [],
    limitations: ['지원된 정전장 모델의 기호 유도 템플릿이며 범용 CAS·자유 문장 해석기가 아닙니다.',
      '물리량은 문자로 유지합니다. 수치 예시와 그림은 별도의 선택 사항입니다.'] };
}
const boundaryGiven = (symbol, meaning, unit, constraint) => ({ symbol, meaning, unit, constraint });
const interfaceControls = [
  boundaryChoice('fieldInput', '알려진 한쪽 장', 0, [[0, 'E₁ 주어짐'], [1, 'E₂ 주어짐'], [2, '한쪽 장 미지정']]),
  boundaryChoice('surfaceCharge', '자유 계면전하 조건', 0, [[0, '부호 있는 σf 주어짐'], [1, 'σf=0']]),
  boundaryChoice('normalDirection', '매질 1→2 법선', 1, [[1, 'n̂=+ẑ'], [-1, 'n̂=−ẑ']]),
];
Object.assign(dielectricInterface, {
  symbolicControls: interfaceControls,
  symbolic(options = {}) {
    const out = boundarySymbolicResult('평면 유전체 계면: 한쪽 장으로 다른 쪽 장 유도');
    const selected = boundaryOptions(interfaceControls, options);
    if (selected.reason) return { ...out, status: 'unsupported', reason: selected.reason };
    const { fieldInput, surfaceCharge, normalDirection } = selected.values;
    const n = normalDirection === 1 ? '+ẑ' : '−ẑ', known = fieldInput === 1 ? '₂' : '₁';
    out.givens = [boundaryGiven('ε₁, ε₂', '매질의 유전율 (εᵢ=ε₀εᵢr)', 'F/m', 'ε₁>0, ε₂>0'),
      boundaryGiven('σf', '매질 1→2 법선으로 정의한 자유 표면전하', 'C/m²', surfaceCharge ? 'σf=0' : 'σf는 부호 포함')];
    if (fieldInput !== 2) out.givens.push(boundaryGiven('E' + known, '외부 조건이 정한 한쪽 균일 전기장', 'V/m', '접선·법선 성분이 주어짐'));
    out.assumptions = ['정전장, 무한 평면 z=0, 각 매질에서 균일한 장, 선형·등방 유전체.',
      'n̂는 항상 매질 1→2이며 현재 n̂=' + n + '. 유전율만으로 장을 추측하지 않습니다.'];
    out.conditions = [normalDirection === 1 ? '매질 1: z<0; 매질 2: z>0' : '매질 1: z>0; 매질 2: z<0',
      'Eᵢn=Eᵢ·n̂; Eᵢt=Eᵢ−Eᵢn n̂', surfaceCharge ? '자유 계면전하 없음: σf=0' : '자유 계면전하 σf가 주어짐'];
    out.laws = [{ name: '정전장 폐곡선 적분', formula: '∮E·dl=0 ⇒ E₂t=E₁t' },
      { name: '가우스 법칙 pillbox', formula: 'n̂·(D₂−D₁)=σf' }, { name: '선형 구성식', formula: 'Dᵢ=εᵢEᵢ' }];
    out.steps = [{ title: '성분 분해', formula: normalDirection === 1 ? 'Eᵢ=Eᵢt+Eᵢn n̂; Eᵢn=Eᵢz' : 'Eᵢ=Eᵢt+Eᵢn n̂; Eᵢn=−Eᵢz', explanation: '법선은 매질 번호와 함께 정의합니다.' },
      { title: '접선 연속', formula: 'E₂t=E₁t', explanation: '얇은 직사각 폐경로의 정전장 순환이 0입니다.' },
      { title: '법선 점프', formula: surfaceCharge ? 'ε₂·E₂n=ε₁·E₁n' : 'ε₂·E₂n−ε₁·E₁n=σf',
        explanation: '바깥 pillbox의 두 뚜껑 기여가 자유 표면전하와 같습니다.' }];
    out.boundaries = [{ condition: 'z=0', formula: 'E₁t=E₂t; D₂n−D₁n=σf',
      explanation: '계면에서 단일 법선 장 대신 양쪽 극한을 구분합니다.' }];
    out.limitations.push('임의 전극 형상·비균일 장·비등방 유전체 경계값 문제는 미지원. 전위 기준을 정하지 않아 V는 반환하지 않습니다.');
    if (fieldInput === 2) return { ...out, status: 'unsupported',
      reason: '한쪽 장 또는 전역 전극·전하 조건이 없습니다. ε₁, ε₂, σf만으로 장은 결정되지 않습니다.' };
    const target = fieldInput === 0 ? '₂' : '₁';
    const normalFormula = fieldInput === 0 ?
      (surfaceCharge ? 'E₂n = ε₁·E₁n/ε₂' : 'E₂n = (ε₁·E₁n+σf)/ε₂') :
      (surfaceCharge ? 'E₁n = ε₂·E₂n/ε₁' : 'E₁n = (ε₂·E₂n−σf)/ε₁');
    out.steps.push({ title: '주어진 쪽에서 미지 쪽으로 풀기', formula: normalFormula,
      explanation: 'E' + known + ' 입력과 선택한 계면전하 조건을 사용합니다.' });
    out.answers = [{ quantity: 'E' + target + 'n', formula: normalFormula, unit: 'V/m', direction: '법선 성분은 n̂=' + n + ' 기준의 부호 있는 스칼라' },
      { quantity: 'E' + target + 't', formula: 'E' + target + 't = E' + known + 't', unit: 'V/m', direction: '접선 벡터는 양쪽 동일' },
      { quantity: 'E' + target, formula: 'E' + target + ' = E' + known + 't+E' + target + 'n n̂', unit: 'V/m', direction: 'n̂=' + n + '; 성분의 부호가 실제 방향을 결정' },
      { quantity: 'D' + target, formula: 'D' + target + ' = ε' + target + ' E' + target, unit: 'C/m²', direction: '각 매질의 E 방향 (εᵢ>0)' }];
    out.regions = [{ condition: normalDirection === 1 ? 'z<0' : 'z>0', formula: 'E=E₁, D=ε₁E₁', explanation: '매질 1의 한쪽 장.' },
      { condition: normalDirection === 1 ? 'z>0' : 'z<0', formula: 'E=E₂, D=ε₂E₂', explanation: '매질 2의 한쪽 장.' }];
    return out;
  },
});

const plateControls = [
  boundaryChoice('control', '고정 제어량', 0, [[0, '고정 Q (고립판)'], [1, '고정 V (전압원)']]),
  boundaryChoice('potentialReference', '전위 기준', 0, [[0, '위판 V(d)=0'], [1, '아래판 V(0)=0']]),
];
Object.assign(layeredPlate, {
  symbolicControls: plateControls,
  symbolic(options = {}) {
    const out = boundarySymbolicResult('2층 유전체 평행판: 제어량과 전위 기준으로 기호 풀이');
    const selected = boundaryOptions(plateControls, options);
    if (selected.reason) return { ...out, status: 'unsupported', reason: selected.reason };
    const { control, potentialReference } = selected.values;
    const fixedV = control === 1;
    out.givens = [boundaryGiven('A', '판 면적', 'm²', 'A>0'),
      boundaryGiven('d₁, d₂', '각 유전체 층의 두께', 'm', 'd₁>0, d₂>0'),
      boundaryGiven('ε₁, ε₂', '각 층의 유전율', 'F/m', 'ε₁>0, ε₂>0'),
      fixedV ? boundaryGiven('V', '고정 판 전압 V(0)−V(d)', 'V', 'V는 부호 포함') :
        boundaryGiven('Q', '고정 아래판 자유전하; 위판은 −Q', 'C', 'Q는 부호 포함')];
    out.assumptions = ['무한판/프린징 무시의 1차원 정전장, 완전도체판, 선형·등방 층.',
      '내부 계면의 자유전하 0; 균형판 ±Q에 따른 외부 E=D=0.',
      fixedV ? '전압원이 V를 유지하고 Q가 반응합니다.' : '고립판의 Q가 보존되고 V가 반응합니다.'];
    out.conditions = ['아래판 z=0; 층 경계 z=d₁; 위판 z=d=d₁+d₂',
      potentialReference ? '전위 기준 V(0)=0; V(d)=−V' : '전위 기준 V(d)=0; V(0)=V'];
    out.laws = [{ name: '가우스 법칙', formula: 'D₂n−D₁n=0; Dₙ=Q/A' },
      { name: '전압 선적분', formula: 'V(0)−V(d)=∫₀ᵈE_z dz' },
      { name: '구성식과 전하/전압', formula: 'Eᵢ=Dₙ/εᵢ; Q=C·V' }];
    out.steps = [{ title: '균일 D 구하기', formula: 'D₁n=D₂n=Dₙ', explanation: '자유 계면전하가 없으므로 D가 연속입니다.' },
      { title: '층별 전압 합', formula: 'S = d₁/ε₁+d₂/ε₂', explanation: 'V=DₙS이고 S는 두 층의 직렬 기하·재료 계수입니다.' },
      { title: '정전용량', formula: 'C = A/S', explanation: 'Q=A Dₙ를 전압 V=DₙS와 연결합니다.' },
      { title: fixedV ? '전압원 조건' : '고립판 조건', formula: fixedV ? 'Dₙ = V/S' : 'Dₙ = Q/A', explanation: '제어량을 문자 그대로 적용합니다.' }];
    out.answers = [{ quantity: 'S', formula: 'S = d₁/ε₁+d₂/ε₂', unit: 'm²/F', direction: '양의 직렬 계수' },
      { quantity: 'C', formula: 'C = A/S', unit: 'F', direction: 'C>0' },
      { quantity: 'Dₙ', formula: fixedV ? 'Dₙ = V/S' : 'Dₙ = Q/A', unit: 'C/m²', direction: 'n̂=+ẑ; 제어량이 음이면 방향 반전' },
      { quantity: fixedV ? 'Q' : 'V', formula: fixedV ? 'Q = A·V/S' : 'V = Q·S/A', unit: fixedV ? 'C' : 'V', direction: 'Q는 아래판 전하, V는 아래−위 판 전압' },
      { quantity: 'E₁z', formula: 'E₁z = Dₙ/ε₁', unit: 'V/m', direction: '+ẑ 성분; Dₙ의 부호 포함' },
      { quantity: 'E₂z', formula: 'E₂z = Dₙ/ε₂', unit: 'V/m', direction: '+ẑ 성분; Dₙ의 부호 포함' },
      { quantity: 'U', formula: fixedV ? 'U = A·V²/(2·S)' : 'U = Q²·S/(2·A)', unit: 'J', direction: 'U≥0' }];
    out.steps.push({ title: '선택한 기준에서 전위 적분',
      formula: potentialReference ? 'V(z)=−∫₀ᶻ E_z dz; V(0)=0' : 'V(z)=∫ᶻᵈ E_z dz; V(d)=0',
      explanation: '전위 기준을 바꾸면 상수만 이동하며 E=−∇V와 판 전압은 변하지 않습니다.' });
    out.answers.push({ quantity: 'V(z)', unit: 'V', direction: potentialReference ? '아래판 기준 전위' : '위판 기준 전위',
      formula: potentialReference ? 'V(z)=−Dₙ·z/ε₁ (0≤z≤d₁); −Dₙ·(d₁/ε₁+(z−d₁)/ε₂) (d₁≤z≤d)' :
        'V(z)=Dₙ·((d₁−z)/ε₁+d₂/ε₂) (0≤z≤d₁); Dₙ·(d−z)/ε₂ (d₁≤z≤d)' });
    const bottomV = potentialReference ? 'V(z) = 0' : 'V(z) = V';
    const topV = potentialReference ? 'V(z) = −V' : 'V(z) = 0';
    out.regions = [
      { condition: 'z<0', formula: 'E=D=0; ' + bottomV, explanation: '아래판 쪽 외부, 균형판 가정.' },
      { condition: '0<z<d₁', formula: potentialReference ? 'V(z) = −Dₙ·z/ε₁' : 'V(z) = Dₙ·((d₁−z)/ε₁+d₂/ε₂)',
        explanation: 'E_z=Dₙ/ε₁; D_z=Dₙ.' },
      { condition: 'd₁<z<d', formula: potentialReference ? 'V(z) = −Dₙ·(d₁/ε₁+(z−d₁)/ε₂)' : 'V(z) = Dₙ·(d−z)/ε₂',
        explanation: 'E_z=Dₙ/ε₂; D_z=Dₙ.' },
      { condition: 'z>d', formula: 'E=D=0; ' + topV, explanation: '위판 쪽 외부, 전위 기준만 상수 이동.' },
    ];
    out.boundaries = [
      { condition: 'z=0', formula: 'E_z⁻=0, E_z⁺=Dₙ/ε₁; D_z⁺−D_z⁻=Dₙ', explanation: '아래판 자유전하 +Q/A, 전위 연속.' },
      { condition: 'z=d₁', formula: 'E_z⁻=Dₙ/ε₁, E_z⁺=Dₙ/ε₂; D_z⁺−D_z⁻=0', explanation: '자유 계면전하 없음. 전위는 연속이고 E 법선은 일반적으로 점프.' },
      { condition: 'z=d', formula: 'E_z⁻=Dₙ/ε₂, E_z⁺=0; D_z⁺−D_z⁻=−Dₙ', explanation: '위판 자유전하 −Q/A, 전위 연속.' },
    ];
    out.limitations.push('유한판 프린징·비영 자유 계면전하·일반 전극 형상은 미지원.',
      fixedV ? 'ε₁,ε₂를 함께 k배: E/V 불변, D/Q/C/U는 k배.' : 'ε₁,ε₂를 함께 k배: D/Q 불변, E/V/U는 1/k배, C는 k배.');
    return out;
  },
});


export const EXPERIMENTS = [dielectricInterface, layeredPlate];
