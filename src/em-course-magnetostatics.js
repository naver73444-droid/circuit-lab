import { MU0 } from './em-course-constants.js';

const scalar = (key, label, value, unit) => ({ key, label, value, unit });
const excluded = (status, reason, region = '') => ({ status, reason, region, vectors: {}, scalars: [], notes: [] });

function validate(params, point, loop = false) {
  if (!params || (Object.getPrototypeOf(params) !== Object.prototype && Object.getPrototypeOf(params) !== null)
    || !Object.values(params).every(value => typeof value === 'number' && Number.isFinite(value))
    || !Number.isFinite(params.current)) return '전류를 포함한 모든 매개변수는 평범한 객체의 유한한 SI 숫자여야 합니다.';
  if (loop && (!Number.isFinite(params.radius) || params.radius <= 0)) return '루프 반경 radius는 양의 유한한 미터 값이어야 합니다.';
  if (!Array.isArray(point) || point.length !== 3 || !point.every(value => typeof value === 'number' && Number.isFinite(value))) {
    return '관측점은 유한한 미터 단위 숫자 세 개여야 합니다.';
  }
  return '';
}

function wireEvaluate(params, point) {
  const error = validate(params, point);
  if (error) return excluded('invalid', error);
  const [x, y] = point, r = Math.hypot(x, y);
  if (!Number.isFinite(r)) return excluded('invalid', '관측 반경이 유한한 계산 범위를 벗어납니다.');
  if (r === 0) return excluded('singular', '이상적인 무한 세선의 z축 위에서는 장을 정의하지 않습니다. 거리 clamp를 사용하지 않습니다.', 'wire-axis');
  const hPhi = params.current / r / (2 * Math.PI), bPhi = MU0 * hPhi;
  const H = [-hPhi * (y / r), hPhi * (x / r), 0], B = H.map(value => MU0 * value);
  if (![hPhi, bPhi, ...B, ...H].every(Number.isFinite) || (params.current !== 0 && (hPhi === 0 || bPhi === 0))) {
    return excluded('invalid', '자기장 값이 유한한 부동소수점 계산 범위를 벗어납니다.');
  }
  return { status: 'valid', reason: '', region: 'vacuum', vectors: { B, H },
    scalars: [scalar('radius', '전류축까지 거리 ρ', r, 'm'), scalar('Bphi', '방위각 성분 Bφ', bPhi, 'T'), scalar('Hphi', '방위각 성분 Hφ', hPhi, 'A/m')],
    notes: ['양의 전류는 +z 방향. +z에서 바라볼 때 B와 H는 반시계 방향입니다.', '진공 B=μ₀H. z에 무관하며 실제 도체 내부장은 이 세선 모델에 포함하지 않습니다.'] };
}

function loopEvaluate(params, point) {
  const error = validate(params, point, true);
  if (error) return excluded('invalid', error);
  const rho = Math.hypot(point[0], point[1]);
  if (!Number.isFinite(rho)) return excluded('invalid', '관측 반경이 유한한 계산 범위를 벗어납니다.');
  if (point[2] === 0 && rho === params.radius) return excluded('singular', '이상적인 세선 루프 위에서는 자기장이 특이합니다.', 'loop-wire');
  if (point[0] !== 0 || point[1] !== 0) return excluded('unsupported', '이 실험은 x=y=0인 z축상의 해만 제공합니다. 축상식을 축 밖에 적용하지 않습니다.', 'off-axis');
  const z = point[2], distance = Math.hypot(params.radius, z), ratio = params.radius / distance;
  const hz = (params.current / distance / 2) * ratio * ratio, bz = MU0 * hz;
  if (!Number.isFinite(distance) || ![hz, bz].every(Number.isFinite) || (params.current !== 0 && (hz === 0 || bz === 0))) {
    return excluded('invalid', '축상 자기장 값이 유한한 부동소수점 계산 범위를 벗어납니다.');
  }
  return { status: 'valid', reason: '', region: 'loop-axis', vectors: { B: [0, 0, bz], H: [0, 0, hz] },
    scalars: [scalar('z', '중심으로부터 축상 좌표 z', z, 'm'), scalar('Bz', '축상 자기장 Bz', bz, 'T'), scalar('Hz', '축상 자기장 Hz', hz, 'A/m')],
    notes: ['루프는 xy평면, 중심은 원점. +z에서 보았을 때 반시계 전류를 +I로 정의합니다.',
      '양의 I에서는 z의 양쪽 모두 Bz>0. z의 부호만 바꾸면 Bz와 Hz는 같습니다.', '중심 z=0은 유효합니다. 이 결과로 축 밖의 2D 장 지도를 구성할 수 없습니다.'] };
}

function checkRow(label, method, actual, expected, unit, relTolerance = 2e-6) {
  const absTolerance = unit === 'T' ? 1e-15 : 1e-10;
  if (![actual, expected].every(Number.isFinite)) return { label, method, unit, status: 'skipped', reason: '수치 적분 값이 유한한 계산 범위를 벗어납니다.' };
  const pass = Math.abs(actual - expected) <= absTolerance + relTolerance * Math.abs(expected);
  return { label, method, actual, expected, unit, absTolerance, relTolerance,
    status: pass ? 'pass' : 'fail', reason: pass ? '' : 'Biot–Savart 적분과 해석값의 차이가 허용오차를 초과했습니다.' };
}

function wireVerify(params) {
  const point = [.03, .04, 0], analytic = wireEvaluate(params, point);
  const method = 'independent Biot–Savart quadrature, 1024 cells; infinite z=ρ tan θ';
  if (analytic.status !== 'valid') return [{ label: '무한 직선전류 Biot–Savart 적분', method, status: 'skipped', reason: analytic.reason, unit: 'T' }];
  const r = Math.hypot(point[0], point[1]), count = 1024, step = Math.PI / count;
  let bx = 0, by = 0;
  for (let i = 0; i < count; i++) {
    const theta = -Math.PI / 2 + (i + .5) * step;
    const z = r * Math.tan(theta), dz = r * step / (Math.cos(theta) ** 2);
    const distance = Math.hypot(r, z);
    // dl (+z) cross displacement (-source to probe) = [-y,x,0] dz.
    const weight = (MU0 * params.current / (4 * Math.PI)) * (dz / distance) / distance / distance;
    bx += -point[1] * weight;
    by += point[0] * weight;
  }
  return [checkRow('직선전류 Bx 방향 및 크기', method, bx, analytic.vectors.B[0], 'T'),
    checkRow('직선전류 By 방향 및 크기', method, by, analytic.vectors.B[1], 'T')];
}

function loopVerify(params) {
  const method = 'independent vector Biot–Savart quadrature, 512 angular cells per point';
  const error = validate(params, [0, 0, 0], true);
  if (error) return [{ label: '루프 축상 Biot–Savart 적분', method, status: 'skipped', reason: error, unit: 'T' }];
  const rows = [], count = 512, step = 2 * Math.PI / count;
  for (const zRatio of [0, 1, -1]) {
    const analytic = loopEvaluate(params, [0, 0, zRatio * params.radius]);
    if (analytic.status !== 'valid') {
      rows.push({ label: `루프 z=${zRatio}R`, method, status: 'skipped', reason: analytic.reason, unit: 'T' });
      continue;
    }
    const integral = [0, 0, 0];
    // Dimensionless full-vector dl×displacement integral; physical prefactor
    // keeps tiny/large radii from overflowing the geometric powers.
    for (let i = 0; i < count; i++) {
      const phi = (i + .5) * step;
      const source = [Math.cos(phi), Math.sin(phi), 0];
      const tangent = [-Math.sin(phi) * step, Math.cos(phi) * step, 0];
      const displacement = [-source[0], -source[1], zRatio];
      const distance = Math.hypot(...displacement);
      const cross = [tangent[1] * displacement[2], -tangent[0] * displacement[2], tangent[0] * displacement[1] - tangent[1] * displacement[0]];
      for (let axis = 0; axis < 3; axis++) integral[axis] += cross[axis] / distance ** 3;
    }
    const factor = (params.current / params.radius) * (MU0 / (4 * Math.PI));
    for (let axis = 0; axis < 3; axis++) rows.push(checkRow(`루프 z=${zRatio}R, B${'xyz'[axis]}`, method,
      integral[axis] * factor, analytic.vectors.B[axis], 'T', 1e-10));
  }
  return rows;
}

const current = { key: 'current', label: '전류 I (부호로 방향 지정)', unit: 'A', displayUnit: 'A', displayScale: 1, initial: 3, min: -100, max: 100 };

function coaxValidate(params, point, model) {
  const error = validate(params, point);
  if (error) return error;
  const keys = model === 'thick' ? ['a', 'b', 'c', 'muR'] : ['a', 'b', 'muR'];
  if (!keys.every(key => Number.isFinite(params[key]))) return 'a,b,μᵣ (유한 두께 모델은 c도 포함)를 유한 SI 숫자로 입력하세요.';
  if (!(0 < params.a && params.a < params.b) || (model === 'thick' && !(params.b < params.c))) return '축 기준 반경은 0<a<b, 유한 두께에서는 0<a<b<c여야 합니다. b는 a부터의 간격이 아닙니다.';
  if (!(params.muR > 0) || !Number.isFinite(MU0 * params.muR) || MU0 * params.muR === 0) return '선형 균질 매질 μ=μ₀μᵣ가 양의 유한한 수치 범위에 있어야 합니다.';
  return '';
}

function coaxRadialState(params, r, model) {
  const { a, b, c, current: drive } = params;
  let fraction, region;
  if (r < a) { fraction = model === 'surface' ? 0 : (r / a) ** 2; region = 'inner-conductor'; }
  else if (r <= b) { fraction = 1; region = r === a ? 'inner-interface' : r === b ? 'outer-inner-interface' : 'gap'; }
  else if (model === 'thick' && r < c) {
    // Difference-of-squares in normalized factors preserves thin annuli and
    // avoids cancellation of nearly equal squared radii near c.
    fraction = ((c - r) / (c - b)) * ((1 + r / c) / (1 + b / c));
    region = 'outer-conductor';
  } else { fraction = 0; region = model === 'thick' && r === c ? 'outer-interface' : 'exterior'; }
  const enclosed = drive * fraction;
  // For a uniform core, compute H~r directly so tiny r² does not invent a zero
  // field through an underflowed enclosed-current intermediate.
  const hPhi = r === 0 ? 0 : r < a && model !== 'surface'
    ? (drive / a / (2 * Math.PI)) * (r / a) : enclosed / r / (2 * Math.PI);
  const bPhi = (MU0 * params.muR) * hPhi;
  return { fraction, enclosed, hPhi, bPhi, region };
}

function coaxCurrentEvaluate(params, point, model) {
  const error = coaxValidate(params, point, model);
  if (error) return excluded('invalid', error);
  const r = Math.hypot(point[0], point[1]);
  if (!Number.isFinite(r)) return excluded('invalid', '관측 반경이 유한한 계산 범위를 벗어납니다.');
  const mu = MU0 * params.muR;
  const common = [scalar('radius', '축 기준 반경 r', r, 'm'), scalar('permeability', '균질 투자율 μ=μ₀μᵣ', mu, 'H/m'),
    scalar('gapWidth', '도체 사이 간격 b−a', params.b - params.a, 'm')];
  const notes = ['r과 b는 공통 z축에서 잰 반경입니다. 내부 표면부터의 간격은 b−a입니다.',
    '반환 B는 자기선속밀도(T), H는 자기장 세기(A/m)입니다. 자기선속 Φ(Wb)는 지정한 면의 ∫B·dS이며 이 문제에는 면이 주어지지 않았습니다.',
    'I>0이면 내부 전류 +z, 외부 귀환 −z. B,H는 +φ=(−y/r,x/r,0), +z에서 보아 반시계입니다. I<0이면 반전됩니다.',
    '기호 구간식과 암페어 유도가 답의 기준입니다. 숫자는 선택한 입력의 비교 표본입니다.'];
  const sheet = (model === 'surface' && r === params.a) || (model !== 'thick' && r === params.b);
  if (sheet) {
    const innerSheet = r === params.a;
    const fullH = params.current / r / (2 * Math.PI), fullB = mu * fullH;
    if (![fullH, fullB].every(Number.isFinite) || (params.current !== 0 && (fullH === 0 || fullB === 0))) return excluded('invalid', '표면전류 장의 극한이 유한한 계산 범위를 벗어납니다.');
    const inside = innerSheet ? 0 : 1, outside = innerSheet ? 1 : 0;
    return { status: 'boundary', region: innerSheet ? 'inner-current-sheet' : 'outer-current-sheet',
      reason: `얇은 원통 표면전류 r=${innerSheet ? 'a' : 'b'}: 단일 장 대신 안쪽/바깥쪽 극한을 표시합니다.`, vectors: {},
      scalars: [...common,
        scalar('enclosedCurrentInside', '포함전류 Ienc(r⁻)', inside * params.current, 'A'), scalar('enclosedCurrentOutside', '포함전류 Ienc(r⁺)', outside * params.current, 'A'),
        scalar('HphiInside', '안쪽 극한 Hφ(r⁻)', inside * fullH, 'A/m'), scalar('HphiOutside', '바깥쪽 극한 Hφ(r⁺)', outside * fullH, 'A/m'),
        scalar('BphiInside', '안쪽 극한 Bφ(r⁻)', inside * fullB, 'T'), scalar('BphiOutside', '바깥쪽 극한 Bφ(r⁺)', outside * fullB, 'T')],
      notes: [...notes, innerSheet ? 'a의 표면전류 Kz=I/(2πa): Hφ(a⁺)−Hφ(a⁻)=Kz.' : 'b의 귀환 표면전류 Kz=−I/(2πb): Hφ(b⁺)−Hφ(b⁻)=Kz.'] };
  }
  const state = coaxRadialState(params, r, model);
  if (![state.fraction, state.enclosed, state.hPhi, state.bPhi].every(Number.isFinite)
    || (params.current !== 0 && r > 0 && (((state.fraction > 0 || (r < params.a && model !== 'surface')) && state.enclosed === 0)
      || ((state.fraction > 0 || (r < params.a && model !== 'surface')) && (state.hPhi === 0 || state.bPhi === 0))))) {
    return excluded('invalid', '포함전류 또는 자기장 값이 유한한 부동소수점 범위를 벗어납니다.');
  }
  const direction = r === 0 ? [0, 0, 0] : [-point[1] / r, point[0] / r, 0];
  const H = direction.map(component => component * state.hPhi), B = direction.map(component => component * state.bPhi);
  return { status: 'valid', reason: '', region: r === 0 ? 'axis' : state.region, vectors: { B, H },
    scalars: [...common, scalar('enclosedCurrent', '포함전류 Ienc(r)', state.enclosed, 'A'),
      scalar('Hphi', '방위각 자기장 세기 Hφ(r)', state.hPhi, 'A/m'), scalar('Bphi', '방위각 자기선속밀도 Bφ(r)', state.bPhi, 'T')],
    notes: [...notes, r === 0 ? '축에서는 φ 방향이 정의되지 않지만 대칭에 따른 벡터 B=H=0입니다.' :
      model !== 'surface' && r === params.a ? '균일 DC 실체 도체의 a 경계에서는 Ienc,Hφ,Bφ가 연속입니다.' :
        model === 'thick' && (r === params.b || r === params.c) ? '유한 부피 전류의 경계에서는 Ienc,Hφ,Bφ가 연속입니다.' :
          state.region === 'exterior' ? '동일 크기의 +I와 −I가 완전히 포함되어 외부 자기장은 정확히 상쇄됩니다.' :
            model === 'surface' && r < params.a ? '내부 표면전류 모델: r<a에는 전류가 포함되지 않아 B=H=0입니다. 균일 DC와 다릅니다.' : '암페어 법칙: ∮H·dl=Ienc(r).'] };
}

function coaxCurrentProfile(params, count, model) {
  if (coaxValidate(params, [0, 0, 0], model) || !Number.isInteger(count) || count < 2 || count > 512) return [];
  const end = 1.5 * (model === 'thick' ? params.c : params.b);
  if (!Number.isFinite(end)) return [];
  const coordinates = new Set(Array.from({ length: count }, (_, i) => end * (i / (count - 1))));
  coordinates.add(params.a); coordinates.add(params.b); if (model === 'thick') coordinates.add(params.c);
  const series = [
    { key: 'Bphi', label: 'Bφ(r) · 자기선속밀도', unit: 'T' },
    { key: 'Hphi', label: 'Hφ(r) · 자기장 세기', unit: 'A/m' },
    { key: 'enclosedCurrent', label: 'Ienc(r) · 포함전류', unit: 'A' },
  ].map(signal => ({ ...signal, coordinateKey: 'r', coordinateUnit: 'm', points: [] }));
  for (const coordinate of [...coordinates].sort((a, b) => a - b)) {
    const result = coaxCurrentEvaluate(params, [coordinate, 0, 0], model);
    if (!['valid', 'boundary'].includes(result.status)) return [];
    const fields = new Map(result.scalars.map(item => [item.key, item.value]));
    for (const data of series) {
      if (result.status === 'boundary') {
        data.points.push({ coordinate, value: fields.get(data.key + 'Inside'), side: 'inside' },
          { coordinate, value: fields.get(data.key + 'Outside'), side: 'outside' });
      } else data.points.push({ coordinate, value: fields.get(data.key) });
    }
  }
  return series;
}

function coaxCurrentVerify(params, model) {
  const method = 'independent current-density radial midpoint integral and vector H·dl angular quadrature';
  const error = coaxValidate(params, [0, 0, 0], model);
  if (error) return [{ label: '동축전류 암페어 적분', method, unit: 'A', status: 'skipped', reason: error }];
  const radii = [params.a / 2, params.a + (params.b - params.a) / 2];
  if (model === 'thick') radii.push(params.b + (params.c - params.b) / 2);
  const outer = model === 'thick' ? params.c : params.b;
  radii.push(outer * 1.25);
  const rows = [], count = 256;
  // Independent integration of specified J_z over actual disk/annular area.
  // Sheet-current contributions are discrete physical surface terms.
  const integrateCurrent = radius => {
    let enclosed = model === 'surface' ? (radius > params.a ? params.current : 0) : 0;
    if (model !== 'surface') {
      const max = Math.min(radius / params.a, 1), du = max / count;
      for (let i = 0; i < count; i++) enclosed += params.current * 2 * ((i + .5) * du) * du;
    }
    if (model === 'thick' && radius > params.b) {
      const upper = Math.min(radius, params.c), denominator = (params.c - params.b) * (1 + params.b / params.c);
      const width = (upper - params.b) / count;
      for (let i = 0; i < count; i++) {
        const sampleRadius = params.b + (i + .5) * width;
        enclosed -= params.current * 2 * (sampleRadius / params.c) * (width / denominator);
      }
    } else if (model !== 'thick' && radius > params.b) enclosed -= params.current;
    return enclosed;
  };
  for (const r of radii) {
    let actual = 0, reason = '', expected = integrateCurrent(r);
    if (!Number.isFinite(r) || r === 0 || r === params.a || r === params.b || (model === 'thick' && r === params.c)) reason = '검증 경로가 유한 양의 반경에서 경계와 분리되지 않습니다.';
    for (let i = 0; !reason && i < count; i++) {
      const angle = (i + .5) * 2 * Math.PI / count;
      const result = coaxCurrentEvaluate(params, [r * Math.cos(angle), r * Math.sin(angle), 0], model);
      if (result.status !== 'valid') { reason = result.reason; break; }
      const tangent = [-Math.sin(angle), Math.cos(angle), 0];
      actual += (result.vectors.H[0] * tangent[0] + result.vectors.H[1] * tangent[1]) * (r * 2 * Math.PI / count);
    }
    const label = `반경 r=${r} m: ∮H·dl ↔ ∫Jz dA + 표면전류`;
    if (reason || ![actual, expected].every(Number.isFinite)) rows.push({ label, method, unit: 'A', status: 'skipped', reason: reason || '적분이 유한한 수치 범위를 벗어납니다.' });
    else {
      const absTolerance = 1e-10, relTolerance = 1e-10;
      const pass = Math.abs(actual - expected) <= absTolerance + relTolerance * Math.abs(params.current);
      rows.push({ label, method, actual, expected, unit: 'A', absTolerance, relTolerance,
        status: pass ? 'pass' : 'fail', reason: pass ? '' : '독립 포함전류 적분과 H 순환이 허용오차 안에서 일치하지 않습니다.' });
    }
  }
  return rows;
}

function coaxSymbolicAnswer(model) {
  const pieces = [model === 'surface'
    ? { region: 'inner-conductor', condition: '0≤r<a', enclosedCurrent: '0', Hphi: '0', Bphi: '0' }
    : { region: 'inner-conductor', condition: '0≤r<a', enclosedCurrent: 'I r²/a²', Hphi: 'I r/(2πa²)', Bphi: 'μ I r/(2πa²)' },
  { region: 'gap', condition: 'a<r<b', enclosedCurrent: 'I', Hphi: 'I/(2πr)', Bphi: 'μ I/(2πr)' }];
  if (model === 'thick') pieces.push({ region: 'outer-conductor', condition: 'b<r<c', enclosedCurrent: 'I(c²−r²)/(c²−b²)',
    Hphi: 'I(c²−r²)/[2πr(c²−b²)]', Bphi: 'μ I(c²−r²)/[2πr(c²−b²)]' });
  pieces.push({ region: 'exterior', condition: model === 'thick' ? 'r>c' : 'r>b', enclosedCurrent: 'I+(−I)=0', Hphi: '0', Bphi: '0' });
  const boundaries = model === 'surface'
    ? [{ radius: 'a', kind: 'sheet-jump', IencMinus: '0', IencPlus: 'I', HphiMinus: '0', HphiPlus: 'I/(2πa)', BphiMinus: '0', BphiPlus: 'μ I/(2πa)' }]
    : [{ radius: 'a', kind: 'continuous', enclosedCurrent: 'I', Hphi: 'I/(2πa)', Bphi: 'μ I/(2πa)' }];
  if (model === 'thick') boundaries.push({ radius: 'b', kind: 'continuous', enclosedCurrent: 'I', Hphi: 'I/(2πb)', Bphi: 'μ I/(2πb)' },
    { radius: 'c', kind: 'continuous', enclosedCurrent: '0', Hphi: '0', Bphi: '0' });
  else boundaries.push({ radius: 'b', kind: 'sheet-jump', IencMinus: 'I', IencPlus: '0', HphiMinus: 'I/(2πb)', HphiPlus: '0', BphiMinus: 'μ I/(2πb)', BphiPlus: '0' });
  return {
    title: '문자형 답: 반경별 자기장의 크기와 방향',
    symbols: [
      { key: 'current', symbol: 'I', meaning: '내부 +z 전류; 외부 귀환은 −I', unit: 'A' },
      { key: 'a', symbol: 'a', meaning: '공통 축에서 잰 내부 도체 반경', unit: 'm' },
      { key: 'b', symbol: 'b', meaning: '공통 축에서 잰 외부 도체의 반경(유한 두께에서는 안쪽 반경); 간격은 b−a', unit: 'm' },
      ...(model === 'thick' ? [{ key: 'c', symbol: 'c', meaning: '외부 도체 바깥 반경', unit: 'm' }] : []),
      { key: 'muR', symbol: 'μ=μ₀μᵣ', meaning: '모든 구간에 같은 선형 균질 투자율', unit: 'H/m' },
      { key: 'radius', symbol: 'r=√(x²+y²)', meaning: '관측점의 축 기준 반경', unit: 'm' },
    ],
    derivation: [
      { equation: model === 'surface' ? 'Kinner=I/(2πa), Kouter=−I/(2πb)' : 'Jinner=I/(πa²)', explanation: model === 'surface' ? '전류가 얇은 원통 표면에만 분포합니다.' : '실체 내부 도체의 DC 전류 밀도는 균일합니다.' },
      ...(model === 'thick' ? [{ equation: 'Jouter=−I/[π(c²−b²)]', explanation: '외부 실체 도체의 단면에 귀환 전류가 균일합니다.' }] : []),
      { equation: 'Ienc(r)=∫disk(r) Jz dA + 포획한 표면전류', explanation: '반경별 포함전류는 아래 구간식입니다.' },
      { equation: '∮H·dl=2πr Hφ(r)=Ienc(r)', explanation: '무한 길이 동축 대칭으로 H는 원의 접선 방향이고 원 위에서 크기가 일정합니다.' },
      { equation: 'Hφ(r)=Ienc(r)/(2πr), Bφ(r)=μ Hφ(r)', explanation: 'r>0에서 암페어 법칙과 선형 매질 관계를 적용합니다. r=0에서는 대칭으로 B=H=0입니다.' },
    ], pieces, boundaries,
    direction: { vector: 'B=Bφ φ̂, H=Hφ φ̂', basis: 'φ̂=(−y/r,x/r,0)', positiveCurrent: '+φ (오른손 법칙; +z에서 보아 반시계)', negativeCurrent: '−φ', axis: 'r=0: B=H=0; φ̂는 미정', cancellation: '외부에서 +I−I=0' },
    fluxDistinction: { density: 'B [T]', flux: 'Φ=∫S B·n dS [Wb]', note: '면 S가 지정되지 않았으므로 Φ를 계산한 것으로 표시하지 않습니다.' },
  };
}

function coaxCurrentDefinition(model) {
  const symbolicAnswer = coaxSymbolicAnswer(model);
  const symbolicControls = [
    { key: 'innerMode', label: '내부 전류 분포', initial: model === 'surface' ? 1 : 0,
      choices: [{ value: 0, label: '균일 DC 체적전류' }, { value: 1, label: 'r=a 표면전류' }] },
    { key: 'outerMode', label: '외부 귀환 도체', initial: model === 'thick' ? 1 : 0,
      choices: [{ value: 0, label: 'r=b 얇은 원통 표면' }, { value: 1, label: 'b<r<c 균일 체적전류' }] },
  ];
  return {
    id: model === 'thick' ? 'coax-current-thick' : model === 'surface' ? 'coax-current-surface' : 'coax-current',
    title: model === 'thick' ? '동축 전류 — 유한 두께 귀환 도체' : model === 'surface' ? '동축 전류 — 내부 표면전류 모델' : '동축 전류 — 균일 DC 내부 도체',
    topic: 'magnetostatics', modelKind: 'analytic-symmetry',
    description: '내부 +I와 외부 −I의 무한 동축 직선 도체: 기호 구간식으로 B,H,Ienc의 반경별 크기·방향을 설명합니다.',
    parameters: [
      { key: 'a', label: '내부 도체 반경 a (축 기준)', unit: 'm', displayUnit: 'mm', displayScale: 1e-3, initial: .01, min: 1e-6, max: 1 },
      { key: 'b', label: model === 'thick' ? '외부 도체 안쪽 반경 b (축 기준; 간격 b−a)' : '외부 얇은 도체 반경 b (축 기준; 간격 b−a)', unit: 'm', displayUnit: 'mm', displayScale: 1e-3, initial: .03, min: 1e-6, max: 1 },
      ...(model === 'thick' ? [{ key: 'c', label: '외부 도체 바깥 반경 c (축 기준)', unit: 'm', displayUnit: 'mm', displayScale: 1e-3, initial: .04, min: 1e-6, max: 1 }] : []),
      { key: 'muR', label: '균질 상대투자율 μᵣ (μ=μ₀μᵣ)', unit: '1', displayUnit: '1', displayScale: 1, initial: 1, min: .001, max: 1000 }, { ...current },
    ], probeDefault: [.02, 0, 0], view: { kind: 'coax-cross-section', plane: 'xy', extent: .06, probeAxes: [0, 1], profileAxis: 'r' },
    signals: [{ key: 'Bphi', symbol: 'Bφ(r)', label: '방위각 자기선속밀도', unit: 'T' },
      { key: 'Hphi', symbol: 'Hφ(r)', label: '방위각 자기장 세기', unit: 'A/m' },
      { key: 'enclosedCurrent', symbol: 'Ienc(r)', label: '암페어 경로의 포함전류', unit: 'A' }], symbolicAnswer,
    assumptions: ['공통 z축을 가진 무한 동축 직선 도체의 정상 전류. 나선 코일이나 솔레노이드가 아닙니다.',
      '내부 전류 +I, 외부 귀환 −I이며 외부장이 없습니다. I는 부호 있는 기호입니다.',
      '전체 공간에 하나의 선형 균질 등방 투자율 μ=μ₀μᵣ. 공간별 μ 경계·포화·이력은 제외합니다.',
      model === 'surface' ? '내부 도체 전류는 r=a의 얇은 표면에만 흐르며 r<a의 체적전류는 0입니다.' : '내부 실체 도체 r<a에 +I가 균일한 DC 전류 밀도로 분포합니다. 표피효과는 적용하지 않습니다.',
      model === 'thick' ? '외부 실체 도체 b<r<c에 −I가 균일한 단면 전류 밀도로 분포합니다.' : '외부 귀환 −I는 r=b의 얇은 원통 표면에 흐릅니다.'],
    validity: [model === 'thick' ? '0<a<b<c, μᵣ>0. 모든 반경은 공통 축 기준이며 도체 간 간격은 b−a.' : '0<a<b, μᵣ>0. b는 축 기준 반경이며 a에서의 간격은 b−a.',
      '기호 구간해와 유도단계가 주된 답이며, 기본 숫자·fixture는 보조 검증입니다.',
      'B는 자기선속밀도(T)입니다. 면이 주어지지 않은 자기선속 Φ(Wb)를 반환하지 않습니다.',
      '축에서는 B=H=0. 반환값과 렌더 화살표 정규화는 분리합니다.'],
    singularities: [model === 'surface' ? 'r=a,b의 얇은 표면전류는 boundary이며 양측 극한을 표시합니다.' :
      model === 'thick' ? '균일 체적전류의 a,b,c에서 B,H,Ienc는 연속이며 valid입니다.' : '균일 DC 도체의 a에서는 연속; 얇은 외부 귀환 b에서는 boundary 양측 극한입니다.',
      '비유한 숫자, 반경 순서 오류, 파생량의 수치 범위 초과는 invalid. 임의 거리 clamp를 사용하지 않습니다.'],
    formulas: [
      ...symbolicAnswer.derivation.map((step, i) => ({ label: `기호 유도 ${i + 1}`, text: step.equation + ' — ' + step.explanation, unit: '' })),
      ...symbolicAnswer.pieces.map(piece => ({ label: `기호 구간 ${piece.condition}`, text: `Ienc=${piece.enclosedCurrent}; Hφ=${piece.Hphi}; Bφ=${piece.Bphi}`, unit: 'A; A/m; T' })),
      ...symbolicAnswer.boundaries.map(boundary => ({ label: `경계 r=${boundary.radius}`, unit: 'A; A/m; T',
        text: boundary.kind === 'continuous' ? `연속: Ienc=${boundary.enclosedCurrent}; Hφ=${boundary.Hphi}; Bφ=${boundary.Bphi}` :
          `양측 극한: Ienc⁻=${boundary.IencMinus}, Ienc⁺=${boundary.IencPlus}; Hφ⁻=${boundary.HphiMinus}, Hφ⁺=${boundary.HphiPlus}; Bφ⁻=${boundary.BphiMinus}, Bφ⁺=${boundary.BphiPlus}` })),
      { label: '방향·축', text: 'B=Bφφ̂, H=Hφφ̂; φ̂=(−y/r,x/r,0). I>0: +φ; I<0: −φ; r=0: B=H=0', unit: 'T; A/m' },
      { label: '선속과 선속밀도', text: 'B [T] ≠ Φ [Wb]; Φ=∫S B·n dS는 지정된 면 S가 필요', unit: '' },
    ], references: [{ title: 'OpenStax University Physics 2 §12.5 — Ampère’s law and uniform solid wire',
      url: 'https://openstax.org/books/university-physics-volume-2/pages/12-5-amperes-law' }],
    symbolicControls, symbolic: (options = {}) => coaxCurrentSymbolic(options, symbolicControls),
    evaluate: (params, point) => coaxCurrentEvaluate(params, point, model),
    verify: params => coaxCurrentVerify(params, model), profile: (params, count = 81) => coaxCurrentProfile(params, count, model),
  };
}

function unsupportedSymbolic(title, reason, conditions = []) {
  return { status: 'unsupported', title, reason, givens: [], assumptions: [], conditions, laws: [], steps: [], answers: [], regions: [], boundaries: [],
    limitations: ['지원 모델의 기호 템플릿이며 범용 CAS·임의 문제 문장의 해석기가 아닙니다.'] };
}

function selectSymbolic(options, controls) {
  if (!options || (Object.getPrototypeOf(options) !== Object.prototype && Object.getPrototypeOf(options) !== null)) return { error: '구조 조건의 평범한 객체가 필요합니다.' };
  const selected = Object.fromEntries(controls.map(item => [item.key, item.initial]));
  for (const [key, value] of Object.entries(options)) {
    const item = controls.find(control => control.key === key);
    if (!item || !item.choices.some(choice => choice.value === value)) return { error: 'symbolic에는 정의된 구조 선택값만 입력하세요. I·반경·μ 등 숫자 예시는 별도입니다.' };
    selected[key] = value;
  }
  return { selected };
}

function coaxCurrentSymbolic(options, controls) {
  const title = '무한 동축 직선 도체의 자기장 — 기호 풀이';
  const selection = selectSymbolic(options, controls);
  if (selection.error) return unsupportedSymbolic(title, selection.error);
  const innerSurface = selection.selected.innerMode === 1, outerThick = selection.selected.outerMode === 1;
  // Adapt the existing symbolicAnswer, preserving it for existing consumers.
  // The fourth combination changes only the symbolic template; it adds no
  // numerical evaluator or calculation feature to this module.
  const data = coaxSymbolicAnswer(outerThick ? 'thick' : innerSurface ? 'surface' : 'thin');
  if (innerSurface && outerThick) {
    data.pieces[0] = { ...data.pieces[0], enclosedCurrent: '0', Hphi: '0', Bphi: '0' };
    data.boundaries[0] = coaxSymbolicAnswer('surface').boundaries[0];
  }
  const condition = outerThick ? '0<a<b<c' : '0<a<b';
  return {
    status: 'supported', title, reason: '',
    givens: data.symbols.map(item => ({ symbol: item.symbol, meaning: item.meaning, unit: item.unit,
      constraint: item.key === 'current' ? 'I는 부호 있는 실수' : item.key === 'muR' ? 'μ=μ₀μᵣ>0' : item.key === 'radius' ? 'r≥0' : condition })),
    assumptions: ['공통 z축을 가진 무한 동축 직선 도체, 정상 전류, 외부장 없음. 나선 코일이 아닙니다.',
      '내부 총전류 +I와 외부 총전류 −I가 균형을 이룹니다.', '모든 구간이 동일한 선형 균질 등방 투자율 μ이며 μ 경계·포화·이력은 제외합니다.',
      innerSurface ? '내부 전류는 r=a 표면에만 분포하고 내부 체적전류는 없습니다.' : '실체 내부 도체 r<a에 균일 DC 체적전류가 분포합니다.',
      outerThick ? '외부 귀환은 b<r<c의 실체 도체 단면에 균일하게 분포합니다.' : '외부 귀환은 r=b의 얇은 원통 표면에 분포합니다.',
      'a,b,c는 공통 축 기준 반경입니다. 도체 사이 간격은 b−a입니다.'],
    conditions: [condition, 'μ>0, r≥0, I는 부호 포함', innerSurface ? '내부 표면전류 Kz=I/(2πa)' : '내부 균일 DC Jz=I/(πa²)',
      outerThick ? '외부 체적전류 Jz=−I/[π(c²−b²)]' : '외부 표면전류 Kz=−I/(2πb)'],
    laws: [{ name: '암페어 법칙 (자유전류)', formula: '∮H·dl=Ienc(r)' },
      { name: '포함전류', formula: 'Ienc(r)=∫disk(r) Jz dA + 포획한 표면전류' },
      { name: '선형 균질 매질', formula: 'B=μH' }],
    steps: [
      { title: '선택된 내부 전류 밀도', formula: innerSurface ? 'Kinner=I/(2πa); r<a: Ienc=0' : 'Jinner=I/(πa²); r<a: Ienc=Jinner πr²=I r²/a²',
        explanation: innerSurface ? 'r=a의 표면을 포획해야 +I가 포함됩니다.' : '도체 내부에서는 포획한 단면 면적에 비례하여 전류가 증가합니다.' },
      { title: '선택된 귀환 전류 밀도', formula: outerThick ? 'Jouter=−I/[π(c²−b²)]; b<r<c: Ienc=I+Jouter π(r²−b²)=I(c²−r²)/(c²−b²)' : 'Kouter=−I/(2πb); r>b: Ienc=I+(−I)=0',
        explanation: outerThick ? '귀환 전류는 포함된 annulus 면적에 비례해 점차 내부 전류를 상쇄합니다.' : '얇은 귀환 표면을 넘어가면 −I 전체가 포함되어 상쇄됩니다.' },
      { title: '동축 대칭의 원형 경로', formula: 'r>0: ∮H·dl=2πr Hφ(r)=Ienc(r)', explanation: 'H는 원의 접선이며 동일 반경에서 크기가 같습니다. r=0은 대칭으로 벡터 0입니다.' },
      { title: '자기장과 방향', formula: 'Hφ(r)=Ienc(r)/(2πr), Bφ(r)=μHφ(r); B=Bφ φ̂, H=Hφ φ̂', explanation: 'φ̂=(−y/r,x/r,0). I 부호로 방향을 결정하고 각 구간의 Ienc를 대입합니다.' },
    ],
    answers: [
      { quantity: 'Ienc(r)', formula: data.pieces.map(piece => `${piece.condition}: ${piece.enclosedCurrent}`).join('\n'), unit: 'A', direction: 'z 법선 기준; 외부 귀환은 −I' },
      { quantity: 'H(r)', formula: 'r>0: H=Ienc(r)/(2πr) φ̂; r=0: H=0', unit: 'A/m', direction: 'I>0: +φ, I<0: −φ; 외부 상쇄 시 방향 미정' },
      { quantity: 'B(r)', formula: 'B=μH; 아래 구간별 Bφ 식을 적용', unit: 'T', direction: 'φ̂=(−y/r,x/r,0); +I는 +z에서 보아 반시계; −I는 시계' },
    ],
    regions: data.pieces.map(piece => ({ condition: piece.condition,
      formula: `Ienc=${piece.enclosedCurrent}; Hφ=${piece.Hphi}; Bφ=${piece.Bphi}`,
      explanation: piece.region === 'inner-conductor' ? innerSurface ? '내부 표면전류를 아직 포함하지 않아 장은 0입니다.' : '균일 DC 단면의 부분 전류를 포함합니다.' :
        piece.region === 'gap' ? '내부 +I 전체만 포함합니다.' : piece.region === 'outer-conductor' ? '부분 귀환 전류를 포함하여 장이 감소합니다.' : '균형 +I−I 전체를 포함하여 외부 장이 0입니다.' })),
    boundaries: [{ condition: 'r=0', formula: 'B=H=Ienc=0', explanation: '축에서 φ̂는 미정이지만 대칭으로 벡터 장은 0입니다.' },
      ...data.boundaries.map(boundary => ({ condition: `r=${boundary.radius}`,
        formula: boundary.kind === 'continuous' ? `Ienc=${boundary.enclosedCurrent}; Hφ=${boundary.Hphi}; Bφ=${boundary.Bphi}` :
          `Ienc⁻=${boundary.IencMinus}, Ienc⁺=${boundary.IencPlus}; Hφ⁻=${boundary.HphiMinus}, Hφ⁺=${boundary.HphiPlus}; Bφ⁻=${boundary.BphiMinus}, Bφ⁺=${boundary.BphiPlus}`,
        explanation: boundary.kind === 'continuous' ? '체적전류 경계에서 Ienc,Hφ,Bφ는 연속입니다.' : '표면전류로 인해 양측 극한이 다릅니다. 표면의 단일 장값을 지정하지 않습니다.' })),
      { condition: 'I=0', formula: 'Ienc=H=B=0', explanation: '영장에는 방향이 없습니다. 얇은 표면의 양측 극한도 모두 0이며 기존 수치 API의 boundary 분류는 유지됩니다.' }],
    limitations: ['지원 분포의 기호 템플릿이며 범용 CAS·임의 나선 코일/솔레노이드 해석기가 아닙니다.',
      'B는 자기선속밀도(T)입니다. Φ=∫S B·n dS(Wb)는 지정된 면 S가 필요하며 여기서는 그 값을 주장하지 않습니다.',
      '시간변화·실제 표피효과·손실·μ 경계·외부장·전류 불균형은 지원하지 않습니다.',
      '표면 내부+유한 두께 외부 조합도 기호식으로 제공합니다. 그 조합의 새 수치 evaluator는 추가하지 않습니다.',
      '구조 조건 선택은 기호해용입니다. 별도 숫자 예시는 해당 기존 실험의 evaluate/verify/profile 가정을 따릅니다.'],
  };
}

const wireSymbolicControls = [{ key: 'direction', label: '전류 방향 (I는 음이 아닌 크기)', initial: 0,
  choices: [{ value: 0, label: '+z' }, { value: 1, label: '−z' }] }];
const loopSymbolicControls = [
  { key: 'direction', label: '+z에서 본 전류 방향 (I는 음이 아닌 크기)', initial: 0,
    choices: [{ value: 0, label: '반시계' }, { value: 1, label: '시계' }] },
  { key: 'observation', label: '관측 위치의 구조 조건', initial: 0,
    choices: [{ value: 0, label: 'z축상 x=y=0' }, { value: 1, label: '축 밖 (이 모델 미지원)' }] },
];

function wireSymbolic(options) {
  const title = '무한 직선 세선 전류의 기호 풀이', selection = selectSymbolic(options, wireSymbolicControls);
  if (selection.error) return unsupportedSymbolic(title, selection.error);
  const reversed = selection.selected.direction === 1, sign = reversed ? '−' : '';
  return {
    status: 'supported', title, reason: '',
    givens: [{ symbol: 'I', meaning: '선택한 z 방향으로 흐르는 전류의 크기', unit: 'A', constraint: 'I≥0' },
      { symbol: 'ρ=√(x²+y²)', meaning: 'z축 세선에서 관측점까지 반경', unit: 'm', constraint: 'ρ>0' },
      { symbol: 'μ₀', meaning: '진공 투자율', unit: 'H/m', constraint: '진공 μ=μ₀' }],
    assumptions: ['z축의 무한 길이 이상적 세선, 정상 전류, 진공, 외부장 없음.', reversed ? '전류는 −z 방향이며 선택한 I는 그 음이 아닌 크기입니다.' : '전류는 +z 방향이며 선택한 I는 그 음이 아닌 크기입니다.'],
    conditions: ['ρ>0, z는 임의 실수, I≥0', `부호 있는 전류 Iz=${sign}I`],
    laws: [{ name: '암페어 법칙', formula: '∮H·dl=Iz' }, { name: '진공 구성 관계', formula: 'B=μ₀H' }],
    steps: [{ title: '대칭과 경로', formula: 'H=Hφ φ̂, ∮H·dl=2πρHφ', explanation: '원형 경로는 +z 법선을 따른 +φ 방향으로 잡습니다.' },
      { title: '선택된 전류 포획', formula: `2πρHφ=${sign}I`, explanation: reversed ? '−z 전류는 +z 법선의 경로를 음의 부호로 통과합니다.' : '+z 전류는 경로를 양의 부호로 통과합니다.' },
      { title: '장과 방향', formula: `Hφ=${sign}I/(2πρ), Bφ=${sign}μ₀I/(2πρ)`, explanation: 'φ̂=(−y/ρ,x/ρ,0); 장은 z에 무관합니다.' }],
    answers: [{ quantity: 'H', formula: `H=${sign}I/(2πρ) φ̂`, unit: 'A/m', direction: reversed ? '−φ; +z에서 보아 시계' : '+φ; +z에서 보아 반시계' },
      { quantity: 'B', formula: `B=${sign}μ₀I/(2πρ) φ̂; |B|=μ₀I/(2πρ)`, unit: 'T', direction: reversed ? '−φ; +z에서 보아 시계' : '+φ; +z에서 보아 반시계' }],
    regions: [{ condition: 'ρ>0', formula: `Hφ=${sign}I/(2πρ); Bφ=${sign}μ₀I/(2πρ)`, explanation: '세선 밖 진공 영역입니다.' }],
    boundaries: [{ condition: 'ρ=0', formula: '이상적 세선 축은 계산 영역에서 제외', explanation: 'I>0에서 크기가 발산합니다. 기존 수치 모델은 I=0에서도 세선 축을 singular로 제외합니다.' },
      { condition: 'I=0, ρ>0', formula: 'B=H=0', explanation: '영장에는 방향을 지정하지 않습니다.' }],
    limitations: ['지원 세선의 기호 템플릿이며 범용 CAS가 아닙니다.', '유한 길이, 실체 도체 내부 전류 분포, 외부장, 진공 이외 매질은 이 실험의 범위 밖입니다.',
      'B(T)와 면을 통한 Φ(Wb)는 다릅니다. 지정한 면 없이 Φ 값을 반환하지 않습니다.'],
  };
}

function loopSymbolic(options) {
  const title = '원형 전류 루프 축상 자기장의 기호 풀이', selection = selectSymbolic(options, loopSymbolicControls);
  if (selection.error) return unsupportedSymbolic(title, selection.error);
  if (selection.selected.observation === 1) return unsupportedSymbolic(title, '축상식은 x²+y²>0인 축 밖의 장을 계산하지 않습니다. 일반 루프장/CAS 해를 주장하지 않습니다.', ['x²+y²>0: 이 축상 모델의 정의역 밖']);
  const reversed = selection.selected.direction === 1, sign = reversed ? '−' : '';
  return {
    status: 'supported', title, reason: '',
    givens: [{ symbol: 'I', meaning: '선택한 시계/반시계 방향의 전류 크기', unit: 'A', constraint: 'I≥0' },
      { symbol: 'R', meaning: '원점 중심 xy평면 원형 세선의 반경', unit: 'm', constraint: 'R>0' },
      { symbol: 'z', meaning: '루프 중심으로부터 축상 좌표', unit: 'm', constraint: '임의 실수, x=y=0' },
      { symbol: 'μ₀', meaning: '진공 투자율', unit: 'H/m', constraint: 'μ=μ₀' }],
    assumptions: ['원점 중심의 xy평면 원형 이상 세선, 정상 전류, 진공, 외부장 없음.', reversed ? '+z에서 바라본 시계 전류입니다.' : '+z에서 바라본 반시계 전류입니다.'],
    conditions: ['R>0, I≥0, x=y=0, −∞<z<∞', 'z=0 중심도 유효', reversed ? '전류의 법선/자기 모멘트는 −z' : '전류의 법선/자기 모멘트는 +z'],
    laws: [{ name: 'Biot–Savart 법칙', formula: 'dB=μ₀ I/(4π) (dl×Robs)/|Robs|³' }, { name: '진공 구성 관계', formula: 'H=B/μ₀' }],
    steps: [{ title: '축상 기하', formula: '|Robs|=√(R²+z²), dl⊥Robs', explanation: '모든 전류 요소에서 관측점까지의 거리가 같습니다.' },
      { title: '쌍대칭의 횡성분 상쇄', formula: 'Bx=By=0; dBz의 투영 인자=R/√(R²+z²)', explanation: '서로 반대인 요소의 횡성분이 상쇄되고 축성분은 합쳐집니다.' },
      { title: '전체 루프 적분', formula: `∮dl=2πR; Bz=${sign}μ₀ I R²/[2(R²+z²)^(3/2)]`, explanation: reversed ? '시계 전류는 축성분에 음의 부호를 줍니다.' : '반시계 전류는 축성분에 양의 부호를 줍니다.' },
      { title: '양쪽 축과 중심', formula: `Bz(−z)=Bz(z); Bz(0)=${sign}μ₀I/(2R)`, explanation: 'z는 제곱으로 들어갑니다. z의 부호를 바꿔도 자기장 방향은 반전되지 않습니다.' }],
    answers: [{ quantity: 'B(z)', formula: `B=${sign}μ₀ I R²/[2(R²+z²)^(3/2)] ẑ`, unit: 'T', direction: reversed ? 'z의 양쪽에서 −z (I>0)' : 'z의 양쪽에서 +z (I>0)' },
      { quantity: 'H(z)', formula: `H=${sign}I R²/[2(R²+z²)^(3/2)] ẑ`, unit: 'A/m', direction: reversed ? '−z' : '+z' }],
    regions: [{ condition: 'x=y=0, z>0', formula: `Bz=${sign}μ₀ I R²/[2(R²+z²)^(3/2)]`, explanation: '법선 방향은 선택한 전류 방향으로 결정됩니다.' },
      { condition: 'x=y=0, z<0', formula: 'Bz(−z)=Bz(z)', explanation: '반대쪽 축에서도 동일한 부호입니다.' }],
    boundaries: [{ condition: 'z=0, x=y=0', formula: `Bz=${sign}μ₀I/(2R); Hz=${sign}I/(2R)`, explanation: '루프 중심은 유효하며 축상식이 연속입니다.' },
      { condition: 'I=0, x=y=0', formula: 'B=H=0', explanation: '영장에는 방향을 지정하지 않습니다.' },
      { condition: 'x²+y²>0', formula: '축 밖은 unsupported; ρ=R,z=0의 이상적 루프 선은 singular', explanation: '축상식을 축 밖에 일반화하지 않습니다.' }],
    limitations: ['축상 루프의 기호 템플릿이며 범용 CAS나 일반 위치의 루프장 solver가 아닙니다.',
      '유한 선경·자성체·시간변화·외부장·축 밖 장은 지원하지 않습니다.', 'B(T)는 자기선속밀도입니다. Φ(Wb)는 지정한 면을 통한 적분이며 여기서는 제공하지 않습니다.'],
  };
}

export const EXPERIMENTS = [{
  id: 'wire-current', title: '무한 직선전류 — B와 H', topic: 'magnetostatics', modelKind: 'analytic-symmetry',
  description: 'z축의 무한 세선 전류가 만드는 방위각 자기장과 오른손 법칙.',
  parameters: [{ ...current }], probeDefault: [.03, .04, 0],
  view: { kind: 'azimuthal', plane: 'xy', extent: .1, probeAxes: [0, 1] },
  assumptions: ['z축을 따르는 무한 길이 이상적 세선, 정상 전류, 진공 μ=μ₀.', '양의 전류는 +z 방향. 외부 자기장은 없습니다.'],
  validity: ['ρ=√(x²+y²)>0인 진공 영역만 지원하며 z에 무관합니다.', '실제 도체 반경이나 내부 전류 밀도는 모델링하지 않습니다.', '렌더 크기 정규화와 반환 SI 물리값을 분리합니다.'],
  singularities: ['ρ=0인 세선 축은 전류값과 관계없이 singular로 표시합니다. 거리 clamp나 가짜 영장을 넣지 않습니다.'],
  formulas: [{ label: '자기장', text: 'B = μ₀I/(2πρ) φ̂; φ̂ = (−y/ρ, x/ρ, 0)', unit: 'T' },
    { label: '자기장 세기', text: 'H = I/(2πρ) φ̂; B=μ₀H', unit: 'A/m' }],
  references: [{ title: 'OpenStax University Physics 2 §12.2 — Thin straight wire',
    url: 'https://openstax.org/books/university-physics-volume-2/pages/12-2-magnetic-field-due-to-a-thin-straight-wire' }],
  symbolicControls: wireSymbolicControls, symbolic: (options = {}) => wireSymbolic(options),
  evaluate: wireEvaluate, verify: wireVerify,
}, {
  id: 'loop-axis', title: '원형 전류 루프 — 축상 B와 H', topic: 'magnetostatics', modelKind: 'analytic-symmetry',
  description: 'xy평면 원형 세선 루프의 z축상 자기장. 중심 및 양쪽 축의 부호를 비교합니다.',
  parameters: [{ key: 'radius', label: '루프 반경 R', unit: 'm', displayUnit: 'cm', displayScale: .01, initial: .1, min: 1e-5, max: 10 }, { ...current, initial: 2 }],
  probeDefault: [0, 0, .1], view: { kind: 'axis-only', plane: 'xz', extent: .3, probeAxes: [2] },
  assumptions: ['원점 중심, xy평면의 반경 R>0인 이상적 세선 원형 루프, 정상 전류, 진공 μ=μ₀.', '+z에서 본 반시계 방향을 +I로 정의합니다. 외부 자기장은 없습니다.'],
  validity: ['x=y=0인 z축만 지원합니다. z=0 중심은 유효합니다.', '양의 전류에서 z>0와 z<0 모두 Bz,Hz는 +z 방향.', '축상식은 축 밖의 일반장이나 2D 장 지도에 적용하지 않습니다.', '반환값은 렌더 화살표 길이와 독립된 SI 값입니다.'],
  singularities: ['축 밖은 unsupported이며, z=0,ρ=R의 이상적 루프 선은 singular입니다.', '부동소수점 범위를 벗어나는 입력의 계산은 invalid로 표시합니다.'],
  formulas: [{ label: '축상 자기장', text: 'Bz = μ₀ I R²/[2(R²+z²)^(3/2)]; Bx=By=0', unit: 'T' },
    { label: '자기장 세기', text: 'Hz = Bz/μ₀', unit: 'A/m' }, { label: '중심', text: 'Bz(0)=μ₀I/(2R)', unit: 'T' }],
  references: [{ title: 'OpenStax University Physics 2 §12.4 — Axis of a current loop',
    url: 'https://openstax.org/books/university-physics-volume-2/pages/12-4-magnetic-field-of-a-current-loop' }],
  symbolicControls: loopSymbolicControls, symbolic: (options = {}) => loopSymbolic(options),
  evaluate: loopEvaluate, verify: loopVerify,
}, ...['thin', 'thick', 'surface'].map(coaxCurrentDefinition)];
