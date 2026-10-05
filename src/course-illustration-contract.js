// UI-only mapping between structural templates and existing numeric examples.
// Numeric values never enter the symbolic evaluator.
export function inductionNumericReason(id, options) {
  return ['faraday-loop', 'motional-rod'].includes(id) && options.normalOrientation === 1
    ? '반대 법선의 기호 풀이입니다. 기존 수치 모델은 기본 법선만 지원하므로 그림·SI 값·수치 검증을 표시하지 않습니다.' : '';
}

export function inductionAfterStructural(id, params, options, key, memory = {}) {
  const next = { ...params }, remembered = { ...memory };
  if (id === 'faraday-loop') {
    if (key === 'alignment') {
      remembered.generalAngle ??= params.theta;
      next.theta = options.alignment === 1 ? 0 : options.alignment === 2 ? Math.PI / 2 : remembered.generalAngle;
    }
    if (key === 'fieldRegime') {
      remembered.activeOmega ??= params.omega > 0 ? params.omega : 4;
      next.omega = options.fieldRegime === 1 ? 0 : remembered.activeOmega;
    }
  }
  if (id === 'motional-rod' && key === 'motionRegime') {
    remembered.movingVelocity ??= params.velocity !== 0 ? params.velocity : 3;
    next.velocity = options.motionRegime === 1 ? 0 : remembered.movingVelocity;
  }
  return { params: next, memory: remembered };
}

export function inductionAfterNumeric(id, params, options, memory = {}) {
  const next = { ...options }, remembered = { ...memory };
  if (id === 'faraday-loop') {
    next.alignment = params.theta === 0 ? 1 : params.theta === Math.PI / 2 ? 2 : 0;
    next.fieldRegime = params.omega === 0 ? 1 : 0;
    if (next.alignment === 0) remembered.generalAngle = params.theta;
    if (params.omega > 0) remembered.activeOmega = params.omega;
  }
  if (id === 'motional-rod') {
    next.motionRegime = params.velocity === 0 ? 1 : 0;
    if (params.velocity !== 0) remembered.movingVelocity = params.velocity;
  }
  return { options: next, memory: remembered };
}
