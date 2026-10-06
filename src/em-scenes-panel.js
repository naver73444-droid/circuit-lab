// "기본 모델": the built-in models (point charge, dipole, line current, loop, plane wave) as live forms.
// Typing a valid number applies it at once; a number that cannot be applied is marked and the last valid model stays.
import { EMInputError } from './em-physics.js';
import { escapeHtml } from './safe-dom.js';
import { parseEMNumber } from './em-source-edit.js';

// parseEMNumber lives in the pure em-source-edit.js; it is re-exported here for the scene forms' callers.
export { parseEMNumber };

const DIRECTIONS = ['x', '-x', 'y', '-y', 'z', '-z'];
const directionVector = name => {
  const sign = name.startsWith('-') ? -1 : 1, axis = name.at(-1);
  return [axis === 'x' ? sign : 0, axis === 'y' ? sign : 0, axis === 'z' ? sign : 0];
};
const directionName = vector => {
  const index = vector.findIndex(Math.abs);
  return `${vector[index] < 0 ? '-' : ''}${'xyz'[index]}`;
};

// Field descriptors per model: id, label (with unit), how to read it from the model, and how to turn the raw
// inputs back into model fields.
const number = (id, label, read) => ({ id, label, type: 'number', read });
const direction = (id, label, read) => ({ id, label, type: 'direction', read });
const SCENES = {
  charge: {
    title: '점전하',
    fields: [
      number('q', '전하 q (nC)', m => m.q * 1e9), number('x', 'x (m)', m => m.position[0]),
      number('y', 'y (m)', m => m.position[1]), number('z', 'z (m)', m => m.position[2]),
    ],
    derive: raw => ({ q: raw.q * 1e-9, position: [raw.x, raw.y, raw.z] }),
  },
  dipole: {
    title: '전기쌍극자',
    fields: [
      number('q', '+전하 q (nC)', m => m.q * 1e9), number('separation', '간격 (m)', m => m.separation),
      direction('axis', '+q 방향', m => directionName(m.axis)),
    ],
    derive: raw => ({ q: raw.q * 1e-9, separation: raw.separation, axis: directionVector(raw.axis) }),
  },
  line: {
    title: '무한 직선전류',
    fields: [number('current', '전류 I (A)', m => m.current), direction('direction', '+I 방향', m => directionName(m.direction))],
    derive: raw => ({ current: raw.current, direction: directionVector(raw.direction) }),
  },
  loop: {
    title: '원형 전류고리',
    fields: [
      number('current', '전류 I (A)', m => m.current), number('radius', '반지름 R (m)', m => m.radius),
      direction('normal', '법선 (여기서 볼 때 +I는 반시계)', m => directionName(m.normal)),
    ],
    derive: raw => ({ current: raw.current, radius: raw.radius, normal: directionVector(raw.normal) }),
  },
  wave: {
    title: '진공 평면파',
    fields: [
      number('amplitude', 'E 최대 (V/m)', m => m.amplitude), number('frequency', '주파수 (Hz)', m => m.frequency),
      number('phaseDeg', '위상 (°)', m => m.phase * 180 / Math.PI), direction('direction', '진행 방향', m => directionName(m.direction)),
    ],
    derive: raw => {
      const dir = directionVector(raw.direction), polarization = Math.abs(dir[0]) === 1 ? [0, 1, 0] : [1, 0, 0];
      return {
        amplitude: raw.amplitude, frequency: raw.frequency, direction: dir, polarization,
        phase: ((raw.phaseDeg % 360) + 360) % 360 * Math.PI / 180,
      };
    },
  },
};

const directionOptions = value => DIRECTIONS.map(item =>
  `<option value="${item}"${item === value ? ' selected' : ''}>${item.startsWith('-') ? '−' : '+'}${item.at(-1)}</option>`).join('');

/** Raw input texts -> numbers (direction fields stay names). Throws on the first unusable number. */
export function readRaw(scene, inputs) {
  const raw = {};
  for (const field of SCENES[scene].fields) {
    const text = inputs[field.id];
    raw[field.id] = field.type === 'direction' ? text : parseEMNumber(text);
  }
  return raw;
}

/** Model fields from numbers returned by readRaw(). */
export const deriveFields = (scene, raw) => SCENES[scene].derive(raw);
export const sceneTitle = name => SCENES[name]?.title ?? '';
export const sceneFieldIds = name => SCENES[name].fields.map(field => field.id);

/**
 * Live form for the active scene. `host` receives the inputs; `onApplied()` runs after a successful change.
 * Returns { show(sceneName | null), refresh(), error() }.
 */
export function createScenesPanel({ host, store, onApplied, onError, signal }) {
  let scene = null;
  const inputsOf = () => Object.fromEntries([...host.querySelectorAll('[data-em-model]')].map(input => [input.dataset.emModel, input.value]));

  function build() {
    host.replaceChildren();
    if (!scene) return;
    const model = store.state.models[scene];
    host.innerHTML = SCENES[scene].fields.map(field => {
      const value = field.read(model);
      const control = field.type === 'direction'
        ? `<select data-em-model="${field.id}">${directionOptions(value)}</select>`
        : `<input data-em-model="${field.id}" inputmode="decimal" value="${escapeHtml(String(Number(value.toPrecision(6))))}">`;
      return `<label>${escapeHtml(field.label)}${control}</label>`;
    }).join('');
  }

  function apply(target) {
    try {
      const fields = SCENES[scene].derive(readRaw(scene, inputsOf()));
      const applied = store.apply(fields);
      if (!applied) throw new EMInputError(store.state.error || '입력을 적용할 수 없습니다.');
      host.querySelectorAll('[aria-invalid]').forEach(node => node.removeAttribute('aria-invalid'));
      onError('');
      onApplied();
    } catch (error) {
      target?.setAttribute('aria-invalid', 'true');
      onError(`${error.message} · 마지막 유효한 값을 유지합니다.`);
    }
  }
  host.addEventListener('input', event => { if (event.target.matches('[data-em-model]')) apply(event.target); }, { signal });
  host.addEventListener('change', event => { if (event.target.matches('[data-em-model]')) apply(event.target); }, { signal });

  return {
    show(name) { scene = name && SCENES[name] ? name : null; build(); },
    /** Re-read values the model changed on its own (the focused field keeps what the user is typing). */
    refresh() {
      if (!scene) return;
      const model = store.state.models[scene];
      for (const field of SCENES[scene].fields) {
        const input = host.querySelector(`[data-em-model="${field.id}"]`);
        if (!input || input === document.activeElement) continue;
        const value = field.read(model);
        input.value = field.type === 'direction' ? value : String(Number(value.toPrecision(6)));
      }
    },
  };
}
