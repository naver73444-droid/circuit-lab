// EM sandbox file: a JSON document with the charges, sensor, camera and probe settings. Reading is strict:
// every field is checked (no coercion), unknown keys that could poison objects are refused, and size is capped.
import { validatePoint, validatePointSources } from './em-playground-physics.js';

export const EM_PROJECT_FORMAT = 'circuit-lab-em-playground';
export const EM_PROJECT_VERSION = 1;
export const EM_PROJECT_MAX_BYTES = 1048576;

const clone = value => structuredClone(value);
const MAX_TREE_DEPTH = 16;
const FORBIDDEN_KEYS = ['__proto__', 'constructor', 'prototype'];

function finite(value, label, min = -Infinity, max = Infinity) {
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${label} 범위가 잘못되었습니다.`);
  return value;
}

function text(value, label, { min = 0, max = 128 } = {}) {
  if (typeof value !== 'string' || value.length < min || value.length > max) throw new Error(`${label} 문자열 길이가 잘못되었습니다.`);
  return value;
}

function numericVector(value, label) {
  if (!Array.isArray(value) || value.length !== 3 || value.some(item => typeof item !== 'number' || !Number.isFinite(item))) {
    throw new Error(`${label}는 유한한 숫자 3개여야 합니다.`);
  }
  return value;
}

const isNumber = value => typeof value === 'number' && Number.isFinite(value);

// Shape check of the raw JSON sources before the physics validator sees them (a string "1e-9" must not become a number).
function validateRawSources(value) {
  if (!Array.isArray(value) || value.length > 16) throw new Error('EM source 배열이 잘못되었습니다.');
  for (const source of value) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error('EM source 객체가 잘못되었습니다.');
    text(source.id, 'source ID', { min: 1, max: 64 });
    if (typeof source.enabled !== 'boolean' || typeof source.visible !== 'boolean') throw new Error('source enabled/visible은 boolean이어야 합니다.');
    const type = source.type ?? 'point';
    if (!['point', 'finite-line', 'infinite-line'].includes(type)) throw new Error('알 수 없는 source type입니다.');
    if (type === 'point') {
      if (!isNumber(source.q)) throw new Error('점전하 q는 유한한 숫자여야 합니다.');
      numericVector(source.position, '점전하 좌표');
      continue;
    }
    if (!isNumber(source.lambda)) throw new Error('선전하 lambda는 유한한 숫자여야 합니다.');
    if (type === 'finite-line') {
      numericVector(source.start, '유한선 시작점');
      numericVector(source.end, '유한선 끝점');
    } else {
      numericVector(source.position, '무한선 기준점');
      numericVector(source.direction, '무한선 방향');
      if (!isNumber(source.sRef) || !isNumber(source.displayLength)) throw new Error('무한선 sRef/displayLength는 유한한 숫자여야 합니다.');
    }
  }
}

function inspectTree(value, depth = 0) {
  if (depth > MAX_TREE_DEPTH) throw new Error('EM 파일 중첩 깊이는 16 이하여야 합니다.');
  if (!value || typeof value !== 'object') return;
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_KEYS.includes(key)) throw new Error('EM 파일에 허용되지 않은 키가 있습니다.');
    inspectTree(value[key], depth + 1);
  }
}

function camera(value) {
  if (!value || typeof value !== 'object') throw new Error('EM camera가 없습니다.');
  return {
    yaw: finite(value.yaw, 'camera yaw'),
    pitch: finite(value.pitch, 'camera pitch', -1.55, 1.55),
    distance: finite(value.distance, 'camera distance', 2, 20),
  };
}

function calculus(value) {
  const mode = ['electric', 'radial', 'rotational'].includes(value?.mode) ? value.mode : null;
  const differentialMode = ['analytic', 'numeric'].includes(value?.differentialMode) ? value.differentialMode : 'numeric';
  if (!mode) throw new Error('EM 연산 모드가 잘못되었습니다.');
  numericVector(value.normal, '루프 법선');
  const normal = validatePoint(value.normal, '루프 법선');
  if (!normal.some(Math.abs)) throw new Error('루프 법선은 0일 수 없습니다.');
  return {
    mode, differentialMode, alpha: finite(value.alpha, 'alpha'), h: finite(value.h, 'h', 0.0001, 0.1),
    radius: finite(value.radius, '반경', 0.05, 5), normal,
  };
}

function world(value) {
  if (!value || typeof value !== 'object') throw new Error('EM world가 없습니다.');
  validateRawSources(value.sources);
  numericVector(value.probe, '측정점');
  const sources = validatePointSources(value.sources), probe = validatePoint(value.probe, '측정점');
  const plane = ['xy', 'xz', 'yz'].includes(value.plane) ? value.plane : null;
  if (!plane) throw new Error('EM 단면이 잘못되었습니다.');
  const selectedId = value.selectedId == null ? null : text(value.selectedId, '선택 ID', { min: 1, max: 64 });
  if (selectedId && !sources.some(source => source.id === selectedId)) throw new Error('선택 ID가 원천에 없습니다.');
  // Older files may carry a saved "before the move" snapshot; it is still validated and round-trips.
  let comparison = null;
  if (value.comparison != null) {
    validateRawSources(value.comparison.sources);
    numericVector(value.comparison.probe, '비교 측정점');
    comparison = { sources: validatePointSources(value.comparison.sources), probe: validatePoint(value.comparison.probe, '비교 측정점') };
  }
  return { sources, probe, plane, selectedId, comparison };
}

export function normalizeEMProject(value) {
  inspectTree(value);
  if (value?.format !== EM_PROJECT_FORMAT) throw new Error('EM 전용 파일 식별자가 아닙니다.');
  if (value.version !== EM_PROJECT_VERSION) throw new Error('지원하지 않는 EM 파일 version입니다.');
  const vectorMode = ['E', 'gradV', 'minusGradV'].includes(value.view?.vectorMode) ? value.view.vectorMode : null;
  if (!vectorMode) throw new Error('EM 벡터 표시 모드가 잘못되었습니다.');
  const legendMode = ['auto', 'fixed'].includes(value.legend?.mode) ? value.legend.mode : null;
  if (!legendMode) throw new Error('EM 범례 모드가 잘못되었습니다.');
  let range = null;
  if (legendMode === 'fixed') {
    const min = finite(value.legend.min, '범례 min'), max = finite(value.legend.max, '범례 max');
    if (!(min < max)) throw new Error('고정 범례는 min < max여야 합니다.');
    range = { min, max };
  }
  return {
    format: EM_PROJECT_FORMAT, version: EM_PROJECT_VERSION, world: world(value.world),
    view: { camera: camera(value.view.camera), vectorMode }, calculus: calculus(value.calculus), legend: { mode: legendMode, ...range },
  };
}

export function parseEMProject(source) {
  if (new TextEncoder().encode(String(source)).byteLength > EM_PROJECT_MAX_BYTES) throw new Error('EM 파일은 UTF-8 1 MiB 이하여야 합니다.');
  let value;
  try { value = JSON.parse(String(source)); } catch { throw new Error('EM JSON을 읽을 수 없습니다.'); }
  return normalizeEMProject(value);
}

export function serializeEMProject(value) {
  const source = JSON.stringify(normalizeEMProject(value), null, 2);
  if (new TextEncoder().encode(source).byteLength > EM_PROJECT_MAX_BYTES) throw new Error('EM 파일은 UTF-8 1 MiB 이하여야 합니다.');
  return source;
}

// ---- learning examples -------------------------------------------------------------------------------------------

const point = (id, q, position) => ({ id, type: 'point', q, position, enabled: true, visible: true });
const finiteLine = { id: 'q1', type: 'finite-line', lambda: 1e-9, start: [0, 0, -1], end: [0, 0, 1], enabled: true, visible: true };
const infiniteLine = {
  id: 'q1', type: 'infinite-line', lambda: 1e-9, position: [0, 0, 0], direction: [0, 0, 1], sRef: 1, displayLength: 4,
  enabled: true, visible: true,
};
const probeSettings = (mode, differentialMode, radius) => ({ mode, differentialMode, alpha: 1, h: 0.005, radius, normal: [0, 0, 1] });

export const EM_EXAMPLES = {
  positive: { label: 'A · 양의 단일점', sources: [point('q1', 1e-9, [0, 0, 0])], probe: [1, 0, 0] },
  negative: { label: 'A · 음의 단일점', sources: [point('q1', -1e-9, [0, 0, 0])], probe: [1, 0, 0] },
  sameSign: { label: 'A · 동부호 다중점', sources: [point('q1', 1e-9, [-1, 0, 0]), point('q2', 1e-9, [1, 0, 0])], probe: [0, 1, 0] },
  finite: { label: 'B · 유한선', sources: [finiteLine], probe: [1, 0, 0] },
  infinite: { label: 'B · 무한선', sources: [infiniteLine], probe: [1, 0, 0] },
  mixed: { label: 'B · 점+선 혼합', sources: [point('q1', 1e-9, [-1, 0, 0]), { ...finiteLine, id: 'q2' }], probe: [1, 0, 0] },
  electrostatic: {
    label: 'C · 정전기 curl=0', sources: [point('q1', 1e-9, [0, 0, 0])], probe: [1, 0, 0], calculus: probeSettings('electric', 'analytic', 0.5),
  },
  curl: { label: 'C · 회전 수학장', sources: [], probe: [0, 0, 0], calculus: probeSettings('rotational', 'numeric', 1) },
};

/** A project (same schema as a saved file) holding example `name`, keeping the camera of `base`. */
export function makeExampleProject(name, base) {
  const example = EM_EXAMPLES[name];
  if (!example) throw new Error('알 수 없는 EM 예제입니다.');
  return normalizeEMProject({
    ...clone(base),
    world: {
      ...clone(base.world), sources: clone(example.sources), probe: [...example.probe],
      selectedId: example.sources[0]?.id ?? null, comparison: null,
    },
    calculus: example.calculus ? clone(example.calculus) : clone(base.calculus),
  });
}
