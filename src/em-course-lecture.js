// Shared pieces of the Hayt Ch.8 lecture experiments (forces, materials, magnetic circuits, inductance). Pure: no DOM.
//
// An experiment here is a closed-form model with one sweep coordinate: the "probe" of the course screen is point[2], read as
// the coordinate named by view.coordinate (a distance, an angle, a field strength ...). defineLecture() adds the common
// plumbing around a model: input validation, finite-value guard, sanitised profile series, a static symbolic solution.
import { MU0 } from './em-course-constants.js';

export { MU0 };
export const TWO_PI = 2 * Math.PI;
export const FOUR_PI = 4 * Math.PI;

/** parameter(key, label, SI unit, display unit, display scale, initial, min, max, extra) */
export const parameter = (key, label, unit, displayUnit, displayScale, initial, min, max, extra = {}) =>
  ({ key, label, unit, displayUnit, displayScale, initial, min, max, ...extra });

/** A parameter that is a choice between named cases: choices = [[value, label], ...]. */
export const choiceParameter = (key, label, initial, choices) => parameter(key, label, '1', '1', 1, initial,
  Math.min(...choices.map(c => c[0])), Math.max(...choices.map(c => c[0])), { choices });

export const scalar = (key, label, value, unit) => ({ key, label, value, unit });
export const excluded = (status, reason, region = '') => ({ status, reason, region, vectors: {}, scalars: [], notes: [] });
export const series = (key, label, unit, coordinateKey, coordinateUnit, points) => ({ key, label, unit, coordinateKey, coordinateUnit, points });
export const linspace = (lo, hi, count) => Array.from({ length: count }, (_, i) => lo + (hi - lo) * i / (count - 1));
export const rad2deg = angle => angle * 180 / Math.PI;

/** One row of verify(): an independent number against the closed form. */
export function checkRow(label, method, actual, expected, unit, relTolerance = 1e-9, absTolerance = 0) {
  if (![actual, expected].every(Number.isFinite)) return skippedRow(label, '검산 값이 유한한 수치 범위를 벗어납니다.', method, unit);
  const pass = Math.abs(actual - expected) <= absTolerance + relTolerance * Math.abs(expected);
  return { label, method, actual, expected, unit, absTolerance, relTolerance,
    status: pass ? 'pass' : 'fail', reason: pass ? '' : '독립 계산과 해석식의 차이가 허용오차를 초과했습니다.' };
}
export const skippedRow = (label, reason, method = 'domain validation', unit = '') => ({ label, method, unit, status: 'skipped', reason });

// ---- references --------------------------------------------------------------------------------------------------------
const HAYT_URL = 'https://openlibrary.org/isbn/9780073380667';
export const hayt = (section, topic) => ({ title: `Hayt & Buck, Engineering Electromagnetics 8판 — Ch.8 §${section} ${topic}`, url: HAYT_URL });
const OPENSTAX = 'https://openstax.org/books/university-physics-volume-2/pages/';
export const openstax = (page, title) => ({ title: `OpenStax University Physics 2 ${title}`, url: OPENSTAX + page });
export const REF = {
  motion: openstax('11-3-motion-of-a-charged-particle-in-a-magnetic-field', '§11.3 — Motion of a charged particle in a magnetic field'),
  conductor: openstax('11-4-magnetic-force-on-a-current-carrying-conductor', '§11.4 — Magnetic force on a current-carrying conductor'),
  loop: openstax('11-5-force-and-torque-on-a-current-loop', '§11.5 — Force and torque on a current loop'),
  parallel: openstax('12-3-magnetic-force-between-two-parallel-currents', '§12.3 — Magnetic force between two parallel currents'),
  matter: openstax('12-7-magnetism-in-matter', '§12.7 — Magnetism in matter'),
  mutual: openstax('14-1-mutual-inductance', '§14.1 — Mutual inductance'),
  self: openstax('14-2-self-inductance-and-inductors', '§14.2 — Self-inductance and inductors'),
  energy: openstax('14-3-energy-in-a-magnetic-field', '§14.3 — Energy in a magnetic field'),
};

// ---- validation --------------------------------------------------------------------------------------------------------
export function validateInputs(parameters, params, point) {
  if (!params || typeof params !== 'object') return '매개변수는 SI 숫자를 담은 객체여야 합니다.';
  for (const item of parameters) {
    const value = params[item.key];
    if (typeof value !== 'number' || !Number.isFinite(value)) return `${item.key}: 유한한 SI 숫자가 필요합니다.`;
    if (value < item.min || value > item.max) return `${item.key}: ${item.min} … ${item.max} ${item.unit === '1' ? '' : item.unit} 범위 밖입니다. 자동 보정하지 않습니다.`;
    if (item.choices && !item.choices.some(choice => choice[0] === value)) return `${item.key}: 정의된 선택값이 아닙니다.`;
  }
  if (point !== undefined && (!Array.isArray(point) || point.length !== 3 || !point.every(v => typeof v === 'number' && Number.isFinite(v)))) {
    return '관측점은 유한한 숫자 세 개여야 합니다. 이 실험은 point[2]를 스윕 좌표로 읽습니다.';
  }
  return '';
}

const finiteResult = out => Object.values(out.vectors || {}).every(v => v.every(Number.isFinite))
  && (out.scalars || []).every(s => Number.isFinite(s.value));

function staticSymbolic(definition, spec) {
  const limitations = [...(spec.limitations || []), '지원 모델의 기호 템플릿이며 범용 CAS·임의 문제 문장 해석기가 아닙니다.'];
  const unsupported = reason => ({ status: 'unsupported', title: spec.title, reason, givens: [], assumptions: [], conditions: [], laws: [], steps: [],
    answers: [], regions: [], boundaries: [], limitations });
  return (options = {}) => {
    if (!options || Object.keys(options).length) return unsupported('이 실험의 기호 풀이는 선택 조건이 없습니다. 숫자 예시는 조건 슬라이더로 바꿉니다.');
    return {
      status: 'supported', title: spec.title, reason: '',
      givens: spec.givens.map(([symbol, meaning, unit = '', constraint = '']) => ({ symbol, meaning, unit, constraint })),
      assumptions: spec.assumptions || definition.assumptions, conditions: spec.conditions || [],
      laws: spec.laws.map(([name, formula]) => ({ name, formula })),
      steps: spec.steps.map(([title, formula, explanation = '']) => ({ title, formula, explanation })),
      answers: spec.answers.map(([quantity, formula, unit = '', direction = '']) => ({ quantity, formula, unit, direction })),
      regions: spec.regions || [], boundaries: spec.boundaries || [], limitations,
    };
  };
}

/**
 * Build one experiment definition from a compact spec:
 *   id, title, topic, week, sections, description, parameters, probeDefault, view,
 *   validate(params) -> error text | '', compute(params, s, point) -> { region, vectors, scalars, notes, status?, reason? },
 *   profile(params, count) -> series[], verify(params) -> rows[], symbolic (static), assumptions, validity, singularities, formulas, references.
 */
export function defineLecture(spec) {
  const { parameters, probeDefault } = spec;
  const inputError = (params, point) => validateInputs(parameters, params, point) || spec.validate?.(params, point?.[2]) || '';
  const evaluate = (params, point) => {
    const error = inputError(params, point);
    if (error) return excluded('invalid', error);
    const out = spec.compute(params, point[2], point);
    if (out.status && out.status !== 'valid') return { reason: '', region: '', vectors: {}, scalars: [], notes: [], ...out };
    if (!finiteResult(out)) return excluded('invalid', '입력의 결과가 유한 배정밀도 수치 범위를 벗어납니다. 값 보정 없이 거절합니다.', out.region || '');
    return { status: 'valid', reason: '', region: '', vectors: {}, scalars: [], notes: [], ...out };
  };
  const profile = (params, count = 81) => {
    if (inputError(params, probeDefault) || !spec.profile || !Number.isInteger(count) || count < 2 || count > 512) return [];
    return spec.profile(params, count).map(item => ({ ...item, points: item.points.filter(p => Number.isFinite(p.coordinate) && Number.isFinite(p.value)) }))
      .filter(item => item.points.length > 1);
  };
  const verify = params => {
    const error = inputError(params, probeDefault);
    if (error) return [skippedRow(`${spec.title} 검증`, error)];
    return spec.verify(params);
  };
  const definition = {
    id: spec.id, title: spec.title, topic: spec.topic, modelKind: spec.modelKind || 'lecture-closed-form',
    lecture: { week: spec.week, sections: spec.sections }, description: spec.description,
    // Which scalars are the final answers (the first is the default "구할 값") and which only repeat the sweep coordinate.
    answerKeys: spec.answers || [], coordinateKeys: spec.coordinateScalars || [],
    parameters, probeDefault, view: spec.view,
    assumptions: spec.assumptions, validity: spec.validity, singularities: spec.singularities, formulas: spec.formulas, references: spec.references,
    evaluate, verify, profile,
  };
  definition.symbolic = staticSymbolic(definition, spec.symbolic);
  return definition;
}

/** view.coordinate for a sweep along point[2]. `scale` is SI per display unit (point[2] stays SI; only the text and the typed value use it). */
export const coordinate = (key, unit, label, scale = 1) => ({ key, unit, label, scale });
/** An angle swept in radians (point[2]) that the screen shows and accepts in degrees. */
export const angleCoordinate = (key, label) => coordinate(key, '°', label, Math.PI / 180);
