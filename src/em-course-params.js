// Live parameter controls of the course: how an experiment parameter becomes a slider or a choice, and how
// slider positions and typed text map to SI values. Pure: no DOM. The experiment definitions are not touched.

// Parameters that are really a choice between a few named cases.
const CHOICES = {
  control: { match: p => p.min === 0 && p.max === 1, options: [[0, '고정 전하 Q'], [1, '고정 전압 V']] },
  closedCircuit: { match: () => true, options: [[0, '개방 · 기전력만'], [1, '닫힘 · 전류도 계산']] },
  loadMode: { match: () => true, options: [[0, '복소 부하 R+jX'], [1, '개방'], [2, '단락']] },
  orientation: { match: () => true, options: [[-1, '시계 방향'], [1, '반시계 방향']] },
};
const INTEGER_KEYS = new Set(['turns']);
const SPREAD = 30; // a log slider covers initial/30 ... initial*30 (within the parameter's own limits)
const SIGNED_SPAN = 3; // a signed slider covers +-3 x |initial|

/** Short label for a control: the first clause, without the parenthetical notes. */
export function shortLabel(label) {
  return String(label).replace(/\s*[(（][^)）]*[)）]/g, '').split(':')[0].replace(/\s+/g, ' ').trim();
}

const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));

/**
 * Control description for one parameter: { key, kind: 'select' | 'range' | 'number', ... }.
 * 'range' has lo / hi / scale ('log' | 'linear'); typed numbers may use the parameter's full min..max.
 * The slider range is practical (around the example's value) rather than the full validity range, which can span
 * a dozen decades.
 */
export function paramSpec(param) {
  const { key, min, max, initial } = param;
  const displayScale = param.displayScale || 1;
  const unit = param.displayUnit ?? param.unit ?? '';
  const spec = {
    key, label: shortLabel(param.label), fullLabel: param.label, min, max, initial,
    displayScale, unit: unit === '1' ? '' : unit, integer: INTEGER_KEYS.has(key) || undefined,
  };
  // A parameter may carry its own named cases: choices = [[value, label], ...] (the Hayt Ch.8 lecture experiments do).
  if (Array.isArray(param.choices)) return { ...spec, kind: 'select', options: param.choices };
  const choice = CHOICES[key];
  if (choice?.match(param)) return { ...spec, kind: 'select', options: choice.options };
  if (param.unit === 'rad' && Number.isFinite(min) && Number.isFinite(max)) return { ...spec, kind: 'range', scale: 'linear', lo: min, hi: max };
  if (min > 0) {
    const lo = Math.max(min, initial / SPREAD), hi = Math.min(max, initial * SPREAD);
    return lo < hi ? { ...spec, kind: 'range', scale: 'log', lo, hi } : { ...spec, kind: 'number' };
  }
  if (min === 0) {
    const hi = initial > 0 ? Math.min(max, initial * 4) : 0;
    return hi > 0 ? { ...spec, kind: 'range', scale: 'linear', lo: 0, hi } : { ...spec, kind: 'number' };
  }
  if (min < 0 && max > 0 && initial !== 0) {
    const extent = SIGNED_SPAN * Math.abs(initial);
    return { ...spec, kind: 'range', scale: 'linear', lo: Math.max(min, -extent), hi: Math.min(max, extent) };
  }
  return { ...spec, kind: 'number' };
}

const round4 = value => Number(value.toPrecision(4));

/** Slider position t in [0, 1] -> SI value (rounded to 4 significant digits in display units, clamped to min..max). */
export function valueFromRange(spec, t) {
  const fraction = clamp(t, 0, 1);
  let value = spec.scale === 'log' ? spec.lo * (spec.hi / spec.lo) ** fraction : spec.lo + (spec.hi - spec.lo) * fraction;
  if (spec.integer) value = Math.round(value);
  else value = round4(value / spec.displayScale) * spec.displayScale;
  return clamp(value, spec.min, spec.max);
}

/** SI value -> slider position in [0, 1] (a value outside the slider's range sits at the nearer end). */
export function rangeFromValue(spec, value) {
  if (!(spec.hi > spec.lo)) return 0;
  const fraction = spec.scale === 'log'
    ? Math.log(clamp(value, spec.lo, spec.hi) / spec.lo) / Math.log(spec.hi / spec.lo)
    : (clamp(value, spec.lo, spec.hi) - spec.lo) / (spec.hi - spec.lo);
  return clamp(fraction, 0, 1);
}

/** SI value as text in the control's display unit. */
export function formatParam(spec, value) {
  const shown = value / spec.displayScale;
  if (shown === 0) return '0';
  const text = String(Number(shown.toPrecision(5)));
  return /e/.test(text) || Math.abs(shown) < 1e-4 ? Number(shown.toPrecision(4)).toExponential() : text;
}

/** Typed text (display unit) -> { ok: true, value } in SI, or { ok: false, error }. No clamping: out of range is rejected. */
export function parseParam(spec, text) {
  const raw = String(text ?? '').trim();
  if (!raw) return { ok: false, error: `${spec.label}: 값을 입력하세요.` };
  const number = Number(raw);
  if (!Number.isFinite(number)) return { ok: false, error: `${spec.label}: 유한한 숫자를 입력하세요.` };
  const value = number * spec.displayScale;
  if (spec.integer && !Number.isInteger(value)) return { ok: false, error: `${spec.label}: 정수여야 합니다.` };
  const tolerance = Math.abs(value) * 1e-12;
  if (value < spec.min - tolerance || value > spec.max + tolerance) {
    const range = `${formatParam(spec, spec.min)} … ${formatParam(spec, spec.max)}${spec.unit ? ` ${spec.unit}` : ''}`;
    return { ok: false, error: `${spec.label}: ${range} 범위 밖입니다.` };
  }
  return { ok: true, value: clamp(value, spec.min, spec.max) };
}

/** Subject (분야) an experiment belongs to; the subject list follows the selected experiment. */
export function topicOf(id) {
  if (id.startsWith('force-')) return '자기력·토크';
  if (id.startsWith('matter-')) return '자성체·경계';
  if (id.startsWith('mcircuit-')) return '자기회로';
  if (id.startsWith('induct-')) return '에너지·인덕턴스';
  if (id.startsWith('gauss-')) return '가우스법칙';
  if (id.startsWith('wave-')) return '파동·반사';
  if (id.startsWith('transmission-')) return '전송선';
  if (['faraday-loop', 'motional-rod'].includes(id)) return '자기유도';
  if (['dielectric-interface', 'layered-plate'].includes(id)) return '유전체·경계';
  if (id.startsWith('coax-current') || ['wire-current', 'loop-axis', 'ampere-wire'].includes(id)) return '정자계·암페어';
  return '정전계·정전용량';
}
