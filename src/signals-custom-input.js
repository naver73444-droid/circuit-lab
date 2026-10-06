// Advanced convolution input (pure): the field definitions and the validation of typed expressions/sequences.
// The restricted expression grammar and its limits live in signals-expression.js.
import { parseSignalsNumber, parseSignalsSequence } from './signals-course-model.js';
import { EXPRESSION_LIMITS, prepareCustomConvolution } from './signals-expression.js';

export const CUSTOM_FIELDS = {
  custom: [
    { key: 'xExpression', label: 'x(t) 식', initial: 'u(t)-u(t-2)', maxLength: EXPRESSION_LIMITS.length },
    { key: 'hExpression', label: 'h(t) 식', initial: 'exp(-t)*u(t)', maxLength: EXPRESSION_LIMITS.length },
    { key: 'windowT', label: '입력 창 ±T [s]', initial: '4' },
    { key: 'dt', label: '적분 간격 Δτ [s]', initial: '0.02' },
  ],
  'custom-dt': [
    { key: 'x', label: 'x[n] 표본 (쉼표)', initial: '1,2,1' },
    { key: 'h', label: 'h[n] 표본 (쉼표)', initial: '1,-1' },
    { key: 'xStart', label: 'x 시작 인덱스', initial: '0' },
    { key: 'hStart', label: 'h 시작 인덱스', initial: '0' },
  ],
};

export const CUSTOM_HELP =
  `식: 숫자, t, pi, e, + − * /, 괄호, u/rect/exp/sin/cos (곱셈은 * 로). 길이 ${EXPRESSION_LIMITS.length}자 이내, `
  + `연산 ${EXPRESSION_LIMITS.nodes}개 이내, 적분 ${EXPRESSION_LIMITS.minCells}~${EXPRESSION_LIMITS.maxCells}구간. `
  + 'x와 h는 ±T 창 밖에서 0으로 취급합니다. 수열은 1~64개 표본.';

export const customDefaults = () => Object.fromEntries(
  Object.values(CUSTOM_FIELDS).flatMap((fields) => fields.map((f) => [f.key, f.initial])),
);

// Throws RangeError with a Korean message when the draft is unsupported; returns the model input otherwise.
export function parseCustomInput(family, drafts) {
  if (family === 'custom') {
    return prepareCustomConvolution(
      drafts.xExpression,
      drafts.hExpression,
      parseSignalsNumber(drafts.windowT, { min: 0.05, max: 20 }),
      parseSignalsNumber(drafts.dt, { min: 0.00001, max: 1 }),
    );
  }
  if (family === 'custom-dt') {
    const index = { integer: true, min: -1000, max: 1000 };
    return {
      x: parseSignalsSequence(drafts.x),
      h: parseSignalsSequence(drafts.h),
      xStart: parseSignalsNumber(drafts.xStart, index),
      hStart: parseSignalsNumber(drafts.hStart, index),
    };
  }
  throw new RangeError('직접 입력 모드가 아닙니다.');
}
