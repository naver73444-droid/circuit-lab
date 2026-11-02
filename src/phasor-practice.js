import { phasorPolar, wrapPhaseDifference } from './phasor-format.js';

const finite = z => z && [z.re, z.im].every(Number.isFinite);
/** Phase of a against b in degrees, wrapped to (−180, 180]; null when either is zero (no phase) or not finite. */
export function relativePhase(a, b) {
  if (!finite(a) || !finite(b)) return null;
  const pa = phasorPolar(a), pb = phasorPolar(b);
  if (pa.angleDegrees === null || pb.angleDegrees === null) return null;
  return wrapPhaseDifference(pa.angleDegrees, pb.angleDegrees);
}
