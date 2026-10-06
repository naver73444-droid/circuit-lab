// Magnetic force on a current source from the field of all the OTHER sources (Hayt 8.1-8.3). Pure: no DOM.
//
//   wire     force per length   F / l = I d x B_others                         [N/m]
//   segment  net force          F = I (u x integral of B_others dl)            [N]
//   loop     net force          F = closed integral of I dl x B_others         [N]
//   sheet    force per area     F / s = K x B_others, B_others averaged over the two sides (the sheet's own field is left out) [N/m^2]
// Two long parallel wires give mu0 I1 I2 / (2 pi d): equal currents in the same direction attract.
import { MU0, add3, cross3, dot3, norm3, scale3, sub3 } from './em-physics.js';
import { circleBasis, createCurrentEvaluator, isActive } from './em-current-field.js';

const LOOP_SAMPLES = 256;
const SEGMENT_SAMPLES = 128;
const SHEET_OFFSET = 0.002; // m; the two sides are sampled this far from the sheet (outside its 1 mm model zone)

const excluded = reason => ({ status: 'excluded', reason });

// Is the field of the others constant along a wire parallel to `direction`? (parallel wires and sheets seen edge-on only)
function alongUniform(others, direction) {
  return others.every(source => (source.type === 'wire' && norm3(cross3(source.direction, direction)) < 1e-9)
    || (source.type === 'sheet' && Math.abs(dot3(source.normal, direction)) < 1e-9));
}

/**
 * Force on source `id` from the others. Returns null for an unknown / switched-off source, otherwise
 * { status: 'ok', kind: 'perLength' | 'net' | 'perArea', vector, magnitude, unit, uniform, others, theory?, relation? }
 * or { status: 'excluded', reason } when the field of the others is undefined where the source sits.
 * theory / relation (wire pairs): mu0 I1 I2 / (2 pi d) and 'attract' | 'repel' for exactly one other, parallel wire.
 */
export function forceOnSource(sources, id) {
  const source = sources.find(item => item.id === id);
  if (!source || !isActive(source)) return null;
  const others = sources.filter(item => item.id !== id && isActive(item));
  if (!others.length) return { status: 'none', others: 0, reason: '다른 전류 원천이 없어 힘이 없습니다 (자기 자신의 장은 힘을 만들지 않습니다).' };
  const evaluate = createCurrentEvaluator(others);
  const done = (kind, vector, unit, extra = {}) => ({ status: 'ok', kind, vector, magnitude: norm3(vector), unit, others: others.length, ...extra });

  if (source.type === 'wire') {
    const field = evaluate(source.position);
    if (field.status !== 'valid') return excluded('다른 원천의 모델 제외영역과 겹칩니다.');
    const vector = scale3(cross3(source.direction, field.B), source.current);
    const extra = { uniform: alongUniform(others, source.direction), B: field.B };
    if (others.length === 1 && others[0].type === 'wire' && norm3(cross3(others[0].direction, source.direction)) < 1e-9) {
      const other = others[0], delta = sub3(other.position, source.position);
      const across = sub3(delta, scale3(source.direction, dot3(delta, source.direction))), distance = norm3(across);
      const same = source.current * other.current * dot3(source.direction, other.direction);
      extra.theory = MU0 * Math.abs(source.current * other.current) / (2 * Math.PI * distance);
      extra.relation = same > 0 ? 'attract' : 'repel';
      extra.distance = distance;
    }
    return done('perLength', vector, 'N/m', extra);
  }
  if (source.type === 'sheet') {
    const back = scale3(source.normal, -SHEET_OFFSET), front = scale3(source.normal, SHEET_OFFSET);
    const a = evaluate(add3(source.position, back)), b = evaluate(add3(source.position, front));
    if (a.status !== 'valid' || b.status !== 'valid') return excluded('다른 원천의 모델 제외영역과 겹칩니다.');
    const mean = scale3(add3(a.B, b.B), 0.5);
    return done('perArea', scale3(cross3(source.direction, mean), source.K), 'N/m²', { B: mean, uniform: false });
  }
  let force = [0, 0, 0];
  if (source.type === 'segment') {
    const axis = sub3(source.end, source.start), length = norm3(axis), u = scale3(axis, 1 / length);
    let sum = [0, 0, 0];
    for (let i = 0; i < SEGMENT_SAMPLES; i += 1) {
      const field = evaluate(add3(source.start, scale3(axis, (i + 0.5) / SEGMENT_SAMPLES)));
      if (field.status !== 'valid') return excluded('유한 도선이 다른 원천의 모델 제외영역을 지납니다.');
      sum = add3(sum, field.B);
    }
    force = scale3(cross3(u, sum), source.current * length / SEGMENT_SAMPLES);
    return done('net', force, 'N', { uniform: false });
  }
  // loop: sum I dl x B over the wire (counter-clockwise about the normal)
  const { e1, e2 } = circleBasis(source.normal), step = 2 * Math.PI / LOOP_SAMPLES;
  for (let i = 0; i < LOOP_SAMPLES; i += 1) {
    const theta = (i + 0.5) * step, cs = Math.cos(theta), sn = Math.sin(theta);
    const point = add3(source.position, scale3(add3(scale3(e1, cs), scale3(e2, sn)), source.radius));
    const field = evaluate(point);
    if (field.status !== 'valid') return excluded('전류 루프가 다른 원천의 모델 제외영역을 지납니다.');
    const dl = scale3(add3(scale3(e1, -sn), scale3(e2, cs)), source.radius * step);
    force = add3(force, scale3(cross3(dl, field.B), source.current));
  }
  return done('net', force, 'N', { uniform: false });
}
