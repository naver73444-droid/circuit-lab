// Ready-made magnetostatic set-ups of the plane sandbox (Hayt 8.1-8.3 and the Ampere's law review). Pure: no DOM.
// Each preset is built for the viewed plane: wires point toward the viewer (dots), "a" is the horizontal and "b" the vertical axis.
import { MU0, add3, scale3 } from './em-physics.js';
import { planeBasis } from './em-current-field.js';

export const CURRENT_PRESETS = Object.freeze({
  pair: '평행 도선 쌍 (I₁=I₂=10 A, d=0.2 m)',
  'wire-ampere': '한 도선 + 암페어 루프',
  sheets: '면전류 두 장 (K, −K)',
  'wire-loop': '직선전류 + 전류 루프',
});

/** Expected numbers a preset is built to show (for the tests and the hint text). */
export const PRESET_FACTS = Object.freeze({
  pairForcePerLength: MU0 * 10 * 10 / (2 * Math.PI * 0.2), // 1.0e-4 N/m
  sheetsFieldBetween: MU0 * 20, // mu0 K
  sheetPressure: MU0 * 20 * 20 / 2, // mu0 K^2 / 2
});

const at = (plane, u, v, fixed = 0) => {
  const { a, b, n } = planeBasis(plane);
  return add3(add3(scale3(a, u), scale3(b, v)), scale3(n, fixed));
};

/**
 * { sources, selectedId, view: { span }, ampere, chips, sensor, note } for a preset name; null for an unknown name.
 * `ampere` is an Ampere loop ({ shape, center, radius, halfWidth, halfHeight, orientation }) or null.
 */
export function currentPreset(name, plane = 'xy') {
  const { b, n } = planeBasis(plane);
  if (name === 'pair') {
    return {
      sources: [
        { id: 'W1', type: 'wire', current: 10, position: at(plane, -0.1, 0), direction: n },
        { id: 'W2', type: 'wire', current: 10, position: at(plane, 0.1, 0), direction: n },
      ],
      selectedId: 'W1', view: { span: 0.8 }, ampere: null, chips: { force: true, ampere: false }, sensor: at(plane, 0, 0.3),
      note: 'F/ℓ = μ₀I₁I₂/(2πd) = 1.0e-4 N/m, 같은 방향 전류는 끌어당깁니다.',
    };
  }
  if (name === 'wire-ampere') {
    return {
      sources: [{ id: 'W1', type: 'wire', current: 10, position: at(plane, 0, 0), direction: n }],
      selectedId: 'W1', view: { span: 2 }, chips: { force: false, ampere: true }, sensor: at(plane, 0.5, 0.5),
      ampere: { shape: 'circle', center: at(plane, 0.3, 0), radius: 0.8, halfWidth: 1, halfHeight: 0.7, orientation: 1 },
      note: '경로를 도선에서 비켜 놓아도 ∮H·dl = I내부 = 10 A, H는 경로 위에서 일정하지 않습니다.',
    };
  }
  if (name === 'sheets') {
    return {
      sources: [
        { id: 'K1', type: 'sheet', K: 20, position: at(plane, 0, 0.3), normal: b, direction: n },
        { id: 'K2', type: 'sheet', K: -20, position: at(plane, 0, -0.3), normal: b, direction: n },
      ],
      selectedId: 'K1', view: { span: 1.2 }, ampere: null, chips: { force: true, ampere: false }, sensor: at(plane, 0, 0),
      note: '두 판 사이 B = μ₀K, 바깥은 0. 판이 받는 힘 μ₀K²/2 (서로 밀어냄).',
    };
  }
  if (name === 'wire-loop') {
    return {
      sources: [
        { id: 'W1', type: 'wire', current: 10, position: at(plane, 0.9, 0), direction: n },
        { id: 'L1', type: 'loop', current: 5, position: at(plane, 0, 0), radius: 0.5, normal: b },
      ],
      selectedId: 'L1', view: { span: 1.8 }, ampere: null, chips: { force: true, ampere: false }, sensor: at(plane, 0, 0.6),
      note: '도선과 같은 평면에 놓인 루프: F = μ₀I₁I₂(D/√(D²−R²) − 1), 가까운 변의 전류가 반대 방향이면 밀려납니다.',
    };
  }
  return null;
}

const CHIP_NAMES = Object.freeze({ lines: '자기장선', contours: '등크기선', mcolor: '|B| 색', arrows: 'B 화살표', ampere: '암페어 루프', force: '힘' });
export const PRESET_COURSE_HINT = '직사각 루프 변별 힘 풀이: 문제 풀이 ▸ 자기력·토크';

/** "힘 켬 · 암페어 루프 끔" for the chips a preset flips (before: current chip values); '' when none changes. */
export function presetChipChanges(preset, before = {}) {
  return Object.entries(preset?.chips ?? {})
    .filter(([name, value]) => name in CHIP_NAMES && (before[name] === true) !== (value === true))
    .map(([name, value]) => `${CHIP_NAMES[name]} ${value ? '켬' : '끔'}`).join(' · ');
}

/** The text under the plane after a preset loaded: title, note, which chips it changed, and where the rectangular-loop force is solved. */
export function presetNoteText(name, preset, chipsBefore = {}) {
  const changes = presetChipChanges(preset, chipsBefore);
  return [`${CURRENT_PRESETS[name]}: ${preset.note}`, changes && `바뀐 칩: ${changes}`, PRESET_COURSE_HINT].filter(Boolean).join('\n');
}
