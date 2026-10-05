import { phasorPolar, wrapPhaseDifference } from './phasor-format.js';
export function parsePracticeNumber(text) {
  const value = String(text).trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value)) throw new Error('실수·허수에 유효한 숫자를 입력하세요. 예: -2.5, 3e-3');
  const n = Number(value);
  if (!Number.isFinite(n) || Math.abs(n) > 1e150) throw new Error('연습 입력은 절댓값 1e150 이하의 유한한 숫자만 지원합니다.');
  if (n === 0 && /[1-9]/.test(value.split(/e/i)[0])) throw new Error('입력이 너무 작아 0으로 반올림됩니다. 지수를 조정하세요.');
  return n;
}
const finite = z => z && [z.re, z.im].every(Number.isFinite);
export function practiceOperations(a, b) {
  if (!finite(a) || !finite(b)) throw new Error('유한한 복소수 두 개가 필요합니다.');
  const scale = Math.max(Math.abs(b.re), Math.abs(b.im));
  const br = scale ? b.re/scale : 0, bi = scale ? b.im/scale : 0;
  const denominator = br*br + bi*bi;
  const quotient = scale ? { re: ((a.re/scale)*br+(a.im/scale)*bi)/denominator, im: ((a.im/scale)*br-(a.re/scale)*bi)/denominator } : null;
  return { A: a, B: b, 'A+B': {re:a.re+b.re,im:a.im+b.im}, 'A−B': {re:a.re-b.re,im:a.im-b.im},
    'A×B': {re:a.re*b.re-a.im*b.im,im:a.re*b.im+a.im*b.re}, 'A÷B': finite(quotient) ? quotient : null,
    divisionIssue: scale === 0 ? 'B=0으로 나눌 수 없습니다.' : !finite(quotient) ? '연산 결과가 표현 범위를 넘었습니다.' : null };
}
/** Polar magnitude is nonnegative; angle is in degrees, not radians. */
export function polarToRectangular(magnitude, angleDegrees) {
  if (![magnitude, angleDegrees].every(Number.isFinite) || magnitude < 0 || magnitude > 1e150) throw new Error('극형 크기는 0 이상 1e150 이하, 위상은 유한한 도 단위여야 합니다.');
  const radians = (angleDegrees % 360) * Math.PI / 180;
  return { re: magnitude * Math.cos(radians), im: magnitude * Math.sin(radians) };
}
export function relativePhase(a, b) {
  if (!finite(a) || !finite(b)) return null;
  const pa = phasorPolar(a), pb = phasorPolar(b);
  if (pa.angleDegrees === null || pb.angleDegrees === null) return null;
  return wrapPhaseDifference(pa.angleDegrees, pb.angleDegrees);
}
