// Lesson 6 (pure): sampling a cosine, its alias, and the spectrum replicas at k*fs +- f0.
import { samplingAlias } from './signals-course-model.js';
import { controlDefaults, formatNumber } from './signals-util.js';
import { dtPeriod, normalizedFrequency } from './signals-axis.js';

export const SAMPLING_AXIS = 30; // Hz, half-width of the spectrum plot
const TAU = 2 * Math.PI;

export const samplingControls = () => [
  { key: 'f0', label: 'f₀ 신호 주파수', min: 0.5, max: 10, step: 0.1, initial: 7, unit: 'Hz' },
  { key: 'fs', label: 'fₛ 표본화율', min: 2, max: 20, step: 0.5, initial: 10, unit: 'Hz' },
  // +-3.15 (just past pi) so that 0 lies on the 0.05 grid; the cosine is 2*pi periodic anyway.
  { key: 'phi', label: 'φ 위상', min: -3.15, max: 3.15, step: 0.05, initial: 0, unit: 'rad' },
];

// Visible time window: at least one second, at least two periods of the signal.
export const timeSpan = (f0) => Math.max(1, 2 / f0);

export function samplingFrame({ f0, fs, phi }) {
  const alias = samplingAlias(f0, fs);
  const span = timeSpan(f0);
  const samples = [];
  for (let n = 0; n / fs <= span + 1e-9; n++) {
    const t = n / fs;
    samples.push({ n, t, y: Math.cos(TAU * f0 * t + phi) });
  }
  // Spectrum of x[n]: lines of the cosine at +-f0, repeated every fs.
  // Lines that land on the same frequency (f0 a multiple of fs: both replicas fall on 0) are merged into one.
  const lines = [];
  const kMax = Math.ceil((SAMPLING_AXIS + f0) / fs);
  for (let k = -kMax; k <= kMax; k++) {
    for (const sign of [-1, 1]) {
      const f = sign * f0 + k * fs;
      if (Math.abs(f) > SAMPLING_AXIS) continue;
      const entry = { f, k, sign, original: k === 0, inBand: Math.abs(f) < fs / 2 };
      const twin = lines.find((line) => Math.abs(line.f - f) < 1e-9);
      if (!twin) lines.push(entry);
      else if (entry.original && !twin.original) Object.assign(twin, entry);
    }
  }
  return {
    alias,
    span,
    samples,
    lines,
    signal: (t) => Math.cos(TAU * f0 * t + phi),
    // Ideal reconstruction from the samples: the tone folded into [-fs/2, fs/2).
    reconstruction: (t) => Math.cos(TAU * alias.signedHz * t + phi),
    overlap: fs < 2 * f0,
    nyquist: fs / 2,
  };
}

export function describeSampling({ f0, fs }) {
  const { aliasHz, status } = samplingAlias(f0, fs);
  const hz = (v) => `${formatNumber(v)} Hz`;
  if (aliasHz === 0 && status === 'aliased') return `fₛ=${hz(fs)} < 2f₀=${hz(2 * f0)}: f₀가 fₛ의 정수배라 f_alias = 0 Hz (DC) · 표본이 모두 같은 값으로 보입니다`;
  if (status === 'alias-free') return `fₛ=${hz(fs)} > 2f₀=${hz(2 * f0)}: 알리아싱 없음 · 복원 주파수 ${hz(aliasHz)} = f₀`;
  if (status === 'nyquist-boundary') return `fₛ=2f₀: Nyquist 경계 · 위상에 따라 표본이 0이 될 수 있어 유일 복원이 안 됩니다.`;
  return `fₛ=${hz(fs)} < 2f₀=${hz(2 * f0)}: 알리아싱 · f_alias=${hz(aliasHz)} (f₀=${hz(f0)}로 복원되지 않음)`;
}

// Ch 1.4 relation between the CT tone and its DT sinusoid: Omega0 = w0 Ts, F0 = f0 / fs, period N = k / F0 (rational F0 only).
export function describeNormalized({ f0, fs }) {
  const { F0, Omega0 } = normalizedFrequency(f0, fs);
  const period = dtPeriod(F0);
  const tail = period.periodic ? `DT 주기 N=k/F₀=${period.N} 표본` : 'F₀가 무리수라 DT 신호는 비주기';
  return `Ω₀=ω₀Tₛ=${formatNumber(Omega0)} rad, F₀=f₀/fₛ=${formatNumber(F0)} (Ω₀=2πF₀) · ${tail}`;
}

// ---- lesson description consumed by the controller -------------------------------------------

export const samplingLesson = {
  id: 'sampling',
  families: null,
  initialFamily: 'cos',
  controls: samplingControls,
  scrub: false,
  read: () => '[이후 진도·참고] fₛ를 2f₀ 아래로 내리면 같은 표본을 지나는 더 느린 사인(alias)이 생기고 스펙트럼 복제가 기저대역에 겹칩니다.',
  formula: () => 'x[n]=cos(2πf₀n/fₛ+φ); f_alias=|((f₀+fₛ/2) mod fₛ)−fₛ/2|; fₛ>2f₀',
  describe: ({ params }) => `${describeSampling(params)} · ${describeNormalized(params)}`,
};
