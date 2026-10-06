// Shared pieces of the live course tools: field builders, validation, evaluation, and textbook-expectation checks. Pure, no DOM.
// Tool values are stored as internal RMS numbers; amplitude fields are shown and typed in the display basis (peak or RMS).
import { closeTo, basisFactor } from './circuit-course-complex.js';
import { parseCourseNumber } from './circuit-course-format.js';

export const num = (key, label, unit, initial, min, max, extra = {}) => ({ kind: 'number', key, label, unit, initial, min, max, ...extra });
export const amp = (key, label, unit, initial, min, max, extra = {}) => num(key, label, unit, initial, min, max, { amplitude: true, ...extra });
export const choice = (key, label, initial, choices, extra = {}) => ({ kind: 'select', key, label, initial, choices, ...extra });
export const textField = (key, label, initial, extra = {}) => ({ kind: 'text', key, label, initial, maxLength: 200, ...extra });
export const angleField = (key, label, initial, extra = {}) => num(key, label, '°', initial, -36000, 36000, { slider: { min: -180, max: 180, step: 1 }, ...extra });
export const heading = (key, label, extra = {}) => ({ kind: 'heading', key, label, ...extra });

export const isShown = (field, values) => !field.showIf || field.showIf(values);
export const dataFields = def => def.fields.filter(f => f.kind !== 'heading');
export const initialValues = def => Object.fromEntries(dataFields(def).map(f => [f.key, f.initial]));
export const sliderOf = (field, values) => (typeof field.slider === 'function' ? field.slider(values) : field.slider ?? null);
export const labelOf = (field, values) => (typeof field.label === 'function' ? field.label(values) : field.label);
const nameOf = field => field.name ?? (typeof field.label === 'string' ? field.label : field.key);
export const unitOf = (field, values) => (typeof field.unit === 'function' ? field.unit(values) : field.unit ?? '');
export const toDisplay = (field, value, basis) => (field.amplitude ? value * basisFactor(basis) : value);
export const fromDisplay = (field, value, basis) => (field.amplitude ? value / basisFactor(basis) : value);

// One field at a time: used for per-field messages while typing as well as for the whole-form check (values are internal).
export function validateField(field, value) {
  if (field.kind === 'select') {
    if (!field.choices.some(([key]) => key === value)) throw new RangeError(nameOf(field) + ': 선택값을 확인하세요.');
  } else if (field.kind === 'text') {
    if (typeof value !== 'string' || value.length > field.maxLength) throw new RangeError(nameOf(field) + ': ' + field.maxLength + '자 이하의 글이어야 합니다.');
  } else if (!Number.isFinite(value) || value < field.min || value > field.max) throw new RangeError(nameOf(field) + ': ' + field.min + ' ~ ' + field.max + ' 범위의 숫자가 필요합니다.');
  return value;
}
export function validateValues(def, values) {
  for (const field of dataFields(def)) if (isShown(field, values)) validateField(field, values[field.key]);
}

// Draft text of a number: ten significant digits, no float noise (0.30000000000000004 → 0.3).
export const draftText = n => String(Number(n.toPrecision(10)));
export const FIELD_KEPT = ' 마지막 유효 값을 쓰고 있습니다.';
/**
 * Re-read every shown number field from its on-screen text before a calculation. A draft that still equals the text of the stored value is
 * left exactly as stored; a different one is parsed and range-checked. Returns { candidate, errors } — errors is { fieldKey: message } for each
 * shown field whose text cannot be used, so one bad field is never hidden by editing another.
 */
export function reviewDrafts(def, values, drafts, basis) {
  const candidate = { ...values }, errors = {};
  for (const field of dataFields(def)) {
    if (field.kind !== 'number' || !isShown(field, candidate) || drafts[field.key] === undefined) continue;
    if (drafts[field.key] === draftText(toDisplay(field, values[field.key], basis))) continue;
    try { const internal = fromDisplay(field, parseCourseNumber(drafts[field.key]), basis); validateField(field, internal); candidate[field.key] = internal; } catch (e) { errors[field.key] = e.message + FIELD_KEPT; }
  }
  return { candidate, errors };
}

export function evaluateTool(def, values, basis = 'rms') {
  try {
    validateValues(def, values);
    const result = def.evaluate(values, { basis, k: basisFactor(basis) });
    return result.status === 'valid' ? { ...result, values: result.values ?? {}, basis } : result;
  } catch (e) { return { status: 'invalid', reason: e.message }; }
}

// Textbook expectation: { key | get, label, value, unit, rel (default 0.1 %), abs, note }. A key points into result.values (display basis).
export function verifyExpectations(result, expect = []) {
  return expect.map(e => {
    const actual = e.get ? e.get(result) : result.values?.[e.key];
    const rel = e.rel ?? 1e-3, abs = e.abs ?? 0;
    return { label: e.label, unit: e.unit ?? '', expected: e.value, actual, rel, abs, note: e.note ?? '', pass: actual !== undefined && closeTo(actual, e.value, rel, abs) };
  });
}
// Preset numbers are written the way the textbook prints them: amplitude fields in the preset's own basis (default rms).
export function presetValues(def, preset) {
  const basis = preset.basis ?? 'rms', out = initialValues(def);
  for (const field of dataFields(def)) if (Object.hasOwn(preset.values, field.key)) out[field.key] = fromDisplay(field, preset.values[field.key], basis);
  return out;
}
export function verifyPreset(def, preset) {
  const result = evaluateTool(def, presetValues(def, preset), preset.basis ?? 'rms');
  if (result.status !== 'valid') return { status: 'invalid', reason: result.reason, rows: [], pass: false };
  const rows = verifyExpectations(result, preset.expect);
  return { status: 'valid', rows, pass: rows.every(r => r.pass), result };
}

// A polar (magnitude, angle) pair is what textbooks print: these named values feed the expectation checks.
export function putPolar(values, key, z, k = 1) {
  const m = Math.hypot(z.re, z.im);
  values[key + 'Mag'] = m * k;
  values[key + 'Ang'] = m === 0 ? 0 : Math.atan2(z.im, z.re) * 180 / Math.PI;
}
export const metric = (label, text, unit = '') => ({ label, text, unit });
