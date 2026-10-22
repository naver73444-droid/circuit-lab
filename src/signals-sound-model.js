// Sound-spectrum lesson (pure, no DOM / Web Audio): what the harmonics of a test tone should be, how to read them out of
// an AnalyserNode-style spectrum, and the frames signals-panes-view draws. The audio itself lives in signals-sound-audio.js.
// Levels are relative to the fundamental: L_k = 20·log10(|c_k|/|c_1|) dB, so the fundamental is 0 dB.
// Course convention (Ch 04 Fourier series): pulse train of duty d has c_k = A·d·sinc(kd), sinc(u) = sin(πu)/(πu).
import { choiceControl } from './signals-axis.js';
import { formatNumber, niceTicks } from './signals-util.js';

export const SOUND_FAMILIES = [
  { value: 'square', label: '사각파 (듀티 50%)' },
  { value: 'sawtooth', label: '톱니파' },
  { value: 'triangle', label: '삼각파' },
  { value: 'pulse', label: '펄스파 (듀티 d)' },
  { value: 'sine', label: '사인파' },
];
export const INPUT_MODES = [
  { value: 0, label: '루프백 (마이크 없이)' },
  { value: 1, label: '마이크 (스피커로 재생)' },
  { value: 2, label: '마이크만 (외부 소리)' },
];
export const LOOPBACK = 0;
export const MICROPHONE = 1;
export const MIC_ONLY = 2;

export const TABLE_HARMONICS = 8; // rows of the k | 이론 | 측정 table
export const PLOT_HARMONICS = 10; // the spectrum pane shows 0 … (K + ½)·f₀
export const DB_FLOOR = -60;      // bottom of the spectrum pane (relative dB)
export const NOISE_MARGIN = 10;   // a harmonic less than this many dB above its local noise is "잡음 수준"
const LOCAL_SPAN = 48;            // bins on each side used for the local noise around a harmonic
export const ABSENT_REL = -80;    // dB below the fundamental: numerical leftovers of a band-limited tone, not a harmonic
const PEAK_HALF = 3;              // bins on each side searched for the peak (the Blackman main lobe)
const ZERO = 1e-9;

export const sinc = (u) => (Math.abs(u) < 1e-12 ? 1 : Math.sin(Math.PI * u) / (Math.PI * u));

// ---------------------------------------------------------------- theory
// |c_k| / |c_1| of the test tones (0 = the harmonic does not exist).
export function harmonicRatio(family, k, d = 0.25) {
  if (!Number.isSafeInteger(k) || k < 1) throw new RangeError('고조파 번호 k는 1 이상의 정수입니다.');
  if (family === 'sine') return k === 1 ? 1 : 0;
  if (family === 'square') return k % 2 === 1 ? 1 / k : 0;
  if (family === 'sawtooth') return 1 / k;
  if (family === 'triangle') return k % 2 === 1 ? 1 / (k * k) : 0;
  if (family === 'pulse') {
    if (!(d > 0 && d < 1)) throw new RangeError('듀티 d는 0과 1 사이입니다.');
    const kd = k * d;
    if (Math.abs(kd - Math.round(kd)) < ZERO) return 0; // sin(πkd) = 0 exactly: a missing harmonic
    return Math.abs(sinc(kd)) / Math.abs(sinc(d));
  }
  throw new RangeError(`지원하지 않는 파형입니다: ${family}`);
}

export const levelDb = (ratio) => (ratio > 0 ? 20 * Math.log10(ratio) : null);

export function theoryRows(family, d, count = TABLE_HARMONICS) {
  return Array.from({ length: count }, (_, i) => {
    const k = i + 1;
    const ratio = harmonicRatio(family, k, d);
    return { k, ratio, db: levelDb(ratio) };
  });
}

// Harmonics that fit below Nyquist (the tone generator cannot make more), at most `max`.
export function harmonicLimit(f0, sampleRate, max = 64) {
  if (!(f0 > 0) || !(sampleRate > 0)) return 0;
  return Math.max(0, Math.min(max, Math.floor((sampleRate / 2 - 1) / f0)));
}

// Coefficients for AudioContext.createPeriodicWave: a pulse of duty d centred on t = 0 (even, so only cosines).
// real[k] = 2·d·sinc(kd) for k ≥ 1; real[0] = 0 keeps DC away from the speaker; imag = 0.
export function pulseWaveCoefficients(d, count) {
  if (!(d > 0 && d < 1) || !Number.isSafeInteger(count) || count < 1) throw new RangeError('듀티 d와 고조파 개수를 확인하세요.');
  const real = new Float32Array(count + 1);
  const imag = new Float32Array(count + 1);
  for (let k = 1; k <= count; k++) {
    const kd = k * d;
    real[k] = Math.abs(kd - Math.round(kd)) < ZERO ? 0 : 2 * d * sinc(kd);
  }
  return { real, imag };
}

// One period of the ideal tone, x(t) with t in periods (0 … 1), peak 1 (the pulse also starts with its high part centred on 0).
export function idealWave(family, phase, d = 0.25) {
  const u = phase - Math.floor(phase);
  if (family === 'sine') return Math.sin(2 * Math.PI * u);
  if (family === 'square') return u < 0.5 ? 1 : -1;
  if (family === 'sawtooth') return u < 0.5 ? 2 * u : 2 * u - 2; // rises through 0 at t = 0 like the Web Audio sawtooth
  if (family === 'triangle') return u < 0.25 ? 4 * u : u < 0.75 ? 2 - 4 * u : 4 * u - 4;
  if (family === 'pulse') return (u < d / 2 || u > 1 - d / 2) ? 1 - d : -d; // zero mean, like the DC-free generator
  throw new RangeError(`지원하지 않는 파형입니다: ${family}`);
}

// ---------------------------------------------------------------- measurement (AnalyserNode dB data)
const binHz = (sampleRate, fftSize) => sampleRate / fftSize;

// Level (and frequency) of the strongest bin within ±halfWidth bins of `hz`, refined by a parabola through its neighbours.
export function peakNear(db, { sampleRate, fftSize }, hz, halfWidth = PEAK_HALF) {
  const width = binHz(sampleRate, fftSize);
  const centre = Math.round(hz / width);
  let best = -1;
  for (let i = Math.max(1, centre - halfWidth); i <= Math.min(db.length - 2, centre + halfWidth); i++) {
    if (Number.isFinite(db[i]) && (best < 0 || db[i] > db[best])) best = i;
  }
  if (best < 0) return { hz, db: -Infinity };
  return refine(db, best, width);
}

function refine(db, i, width) {
  const a = db[i - 1];
  const b = db[i];
  const c = db[i + 1];
  if (![a, b, c].every(Number.isFinite)) return { hz: i * width, db: b };
  const den = a - 2 * b + c;
  const shift = den < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den)) : 0;
  return { hz: (i + shift) * width, db: b - 0.25 * (a - c) * shift };
}

// An AnalyserNode bin holds |(1/N)·Σ w[n]·x[n]·e^(−j2πkn/N)| with the Blackman window (mean 0.42), so a sine of amplitude
// A peaks at A·0.42/2 (−13.6 dB for a full-scale sine). sineLevelDb gives the sine amplitude in dBFS (full scale = 0 dB).
// It is exact for a tone on a bin and within about 1 dB between bins; the relative levels (rel) need no correction at all.
export const SINE_DB_CORRECTION = 20 * Math.log10(2 / 0.42);
export const sineLevelDb = (db) => db + SINE_DB_CORRECTION;

// Median of the finite bins: a robust "noise floor" for a spectrum that is mostly empty between the harmonics.
export function noiseFloor(db) {
  const values = Array.from(db).filter(Number.isFinite).sort((x, y) => x - y);
  if (!values.length) return -Infinity;
  const mid = values.length >> 1;
  return values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
}

// Median of the bins around `hz` (±LOCAL_SPAN), leaving out the peak's own main lobe: the noise a harmonic must beat.
function localNoise(db, spec, hz) {
  const centre = Math.round(hz / binHz(spec.sampleRate, spec.fftSize));
  const around = [];
  for (let i = Math.max(1, centre - LOCAL_SPAN); i <= Math.min(db.length - 1, centre + LOCAL_SPAN); i++) {
    if (Math.abs(i - centre) > 2 * PEAK_HALF) around.push(db[i]);
  }
  return noiseFloor(around);
}

// Measured level of every harmonic relative to the fundamental; `noisy` marks the ones that do not stand out of the
// noise around them (the maximum over a few noise bins easily sits ~6 dB over their median, hence the 10 dB margin).
export function measureHarmonics(db, spec, f0, count = TABLE_HARMONICS) {
  const floor = noiseFloor(db);
  const peaks = Array.from({ length: count }, (_, i) => peakNear(db, spec, (i + 1) * f0));
  const ref = peaks[0]?.db ?? -Infinity;
  return {
    floor,
    fundamental: ref,
    rows: peaks.map((p, i) => ({
      k: i + 1,
      hz: p.hz,
      db: p.db,
      rel: Number.isFinite(ref) && Number.isFinite(p.db) ? p.db - ref : null,
      noisy: !Number.isFinite(p.db) || p.db < localNoise(db, spec, (i + 1) * f0) + NOISE_MARGIN || p.db - ref < ABSENT_REL,
    })),
  };
}

// Strongest component between lo and hi Hz (for "마이크만").
export function strongestPeak(db, spec, lo = 60, hi = 8000) {
  const width = binHz(spec.sampleRate, spec.fftSize);
  let best = -1;
  for (let i = Math.max(1, Math.ceil(lo / width)); i <= Math.min(db.length - 2, Math.floor(hi / width)); i++) {
    if (Number.isFinite(db[i]) && (best < 0 || db[i] > db[best])) best = i;
  }
  return best < 0 ? null : refine(db, best, width);
}

// The spectrum curve for the plot: max-hold of the bins in `points` buckets on [0, hi], each relative to `ref` dB.
export function spectrumCurve(db, spec, hi, ref, points = 480) {
  const width = binHz(spec.sampleRate, spec.fftSize);
  const last = Math.min(db.length - 1, Math.floor(hi / width));
  const out = [];
  for (let p = 0; p < points; p++) {
    const from = Math.floor((p * last) / points);
    const to = Math.max(from, Math.floor(((p + 1) * last) / points) - 1);
    let m = -Infinity;
    for (let i = from; i <= to; i++) if (db[i] > m) m = db[i];
    const y = Number.isFinite(m) ? Math.max(DB_FLOOR, Math.min(6, m - ref)) : DB_FLOOR;
    out.push([((from + to) / 2) * width, y]);
  }
  return out;
}

// About two periods of the captured wave, starting at a rising zero crossing, normalised to peak 1 (the shape is the point).
export function waveWindow(samples, sampleRate, f0) {
  const n = Math.min(samples.length - 1, Math.max(16, Math.round((2 * sampleRate) / f0)));
  let start = 0;
  for (let i = 1; i < samples.length - n; i++) if (samples[i - 1] < 0 && samples[i] >= 0) { start = i; break; }
  let peak = 0;
  for (let i = start; i < start + n; i++) peak = Math.max(peak, Math.abs(samples[i]));
  const scale = peak > 1e-6 ? 1 / peak : 0;
  const pts = [];
  const step = Math.max(1, Math.floor(n / 600));
  for (let i = 0; i < n; i += step) pts.push([(1000 * i) / sampleRate, samples[start + i] * scale]);
  return pts;
}

// ---------------------------------------------------------------- controls, frames, words
export function soundControls(family) {
  const controls = [{ key: 'f0', label: 'f₀ 기본 주파수', min: 110, max: 1000, step: 10, initial: 440, unit: 'Hz' }];
  if (family === 'pulse') controls.push({ key: 'd', label: 'd 듀티', min: 0.05, max: 0.5, step: 0.05, initial: 0.25, unit: '' });
  controls.push(
    { key: 'gain', label: '음량', min: 2, max: 30, step: 2, initial: 10, unit: '%' },
    choiceControl('input', '입력', INPUT_MODES, LOOPBACK),
  );
  return controls;
}

const dbText = (db) => (db === null ? '없음' : `${formatNumber(db, 3)} dB`);

// Frame of the two panes: the (ideal or captured) wave over two periods and the spectrum in dB relative to the fundamental.
// `live` (optional) = { curve, wave, rows } from the audio while it runs.
export function soundFrame(family, params, live = null) {
  const f0 = params.f0 ?? 440;
  const d = params.d ?? 0.25;
  const micOnly = params.input === MIC_ONLY;
  const hiHz = micOnly ? 4000 : (PLOT_HARMONICS + 0.5) * f0;
  const periodMs = 1000 / f0;
  const wave = live?.wave ?? (micOnly ? [] : Array.from({ length: 401 }, (_, i) => {
    const t = (2 * periodMs * i) / 400;
    return [t, idealWave(family, t / periodMs, d)];
  }));
  const waveHi = micOnly ? (live?.wave?.at(-1)?.[0] ?? 10) : 2 * periodMs;
  const timePane = {
    title: live?.wave ? '들어온 파형 (최댓값으로 정규화) · t [ms]' : (micOnly ? '마이크 파형 · 소리를 켜면 보입니다 · t [ms]' : '이론 파형 두 주기 · t [ms]'),
    x: [0, Math.max(waveHi, 1e-3)], y: [-1.25, 1.25], xTicks: niceTicks(0, waveHi, 4), yTicks: [-1, 0, 1], h: 120,
    lines: [{ cls: 'c3 thin', pts: wave }],
  };
  const theory = [];
  const absent = [];
  if (!micOnly) {
    for (let k = 1; k <= PLOT_HARMONICS; k++) {
      const db = levelDb(harmonicRatio(family, k, d));
      if (db === null) absent.push([k * f0, DB_FLOOR]);
      else theory.push([k * f0, Math.max(DB_FLOOR, db)]);
    }
  }
  const spectrumPane = {
    title: micOnly ? '스펙트럼 · 가장 센 성분 기준 dB · f [Hz]' : '스펙트럼 · 기본파 기준 dB (선 = 이론) · f [Hz]',
    x: [0, hiHz], y: [DB_FLOOR, 6], xTicks: niceTicks(0, hiHz, 5), yTicks: [-60, -40, -20, 0],
    stems: [{ cls: 'c2', pts: theory, base: DB_FLOOR }, { cls: 'cm', pts: absent, base: DB_FLOOR, hollowFrom: -1 }],
    lines: live?.curve ? [{ cls: 'c1 thin', pts: live.curve }] : [],
    // measured harmonics that stand out of the noise; the missing ones are already the hollow theory markers
    dots: (live?.rows ?? []).filter((r) => r.rel !== null && !r.noisy && r.hz <= hiHz).map((r) => ({ cls: 'c1', x: r.hz, y: Math.max(DB_FLOOR, Math.min(6, r.rel)) })),
  };
  const legend = micOnly
    ? [{ cls: 'c3', text: '파형' }, { cls: 'c1', text: '측정 스펙트럼' }]
    : [{ cls: 'c3', text: live?.wave ? '들어온 파형' : '이론 파형' }, { cls: 'c2', text: '이론 |c_k|/|c_1|' }, { cls: 'cm', text: '○ 이론상 없음' }, { cls: 'c1', text: '측정 (● 고조파)' }];
  return { panes: [timePane, spectrumPane], legend };
}

const READS = {
  square: '사각파는 홀수 고조파만 있고 크기가 1/k로 줄어듭니다: 3번째 −9.5 dB, 5번째 −14 dB. 짝수 자리가 비는지 보세요.',
  sawtooth: '톱니파는 모든 고조파가 1/k로 줄어듭니다: 2번째 −6 dB, 3번째 −9.5 dB. 사각파와 달리 짝수도 있습니다.',
  triangle: '삼각파는 홀수만, 그것도 1/k²로 빨리 줄어듭니다: 3번째 −19 dB. 꺾임만 있는 파형이라 사각파보다 부드럽게 들립니다.',
  pulse: '펄스파는 c_k = A·d·sinc(kd)라 kd가 정수인 고조파가 사라집니다: d = 0.25면 4, 8번째가 비어 있습니다.',
  sine: '사인파는 기본파 하나뿐이라 고조파 자리가 모두 비어 있어야 합니다. 측정에 고조파가 보이면 스피커·마이크의 일그러짐입니다.',
};

export const soundLesson = {
  id: 'sound',
  families: SOUND_FAMILIES,
  initialFamily: 'square',
  controls: (family) => soundControls(family),
  scrub: false,
  read(family, params = {}) {
    if (params.input === MIC_ONLY) return '마이크만: 테스트 음은 끄고 마이크에 들어오는 소리(목소리, 휘파람, 악기)의 스펙트럼과 가장 센 주파수를 봅니다. 휘파람은 거의 사인파입니다.';
    const base = READS[family] ?? '';
    return params.input === MICROPHONE ? `${base} 이어폰은 빼고 스피커로 재생하세요(휴대폰 스피커는 300 Hz 아래가 약합니다).` : base;
  },
  describe({ family, params }) {
    if (params.input === MIC_ONLY) return '소리 켜기를 누르면 마이크 입력을 분석합니다.';
    const rows = theoryRows(family, params.d ?? 0.25, 5).slice(1);
    return `이론: ${rows.map((r) => `${r.k}번째 ${dbText(r.db)}`).join(' · ')} (기본파 = 0 dB)`;
  },
  formula(family, params = {}) {
    const d = params.d ?? 0.25;
    const lines = ['L_k = 20 log₁₀(|c_k|/|c_1|)'];
    if (family === 'square') lines.push('|c_k|/|c_1| = 1/k, k = 1, 3, 5, …', '|c_k| = 0, k = 2, 4, 6, …', 'L_3 = 20 log₁₀(1/3) ≈ −9.54');
    else if (family === 'sawtooth') lines.push('|c_k|/|c_1| = 1/k, k = 1, 2, 3, …', 'L_2 = 20 log₁₀(1/2) ≈ −6.02');
    else if (family === 'triangle') lines.push('|c_k|/|c_1| = 1/k², k = 1, 3, 5, …', '|c_k| = 0, k = 2, 4, 6, …', 'L_3 = 20 log₁₀(1/9) ≈ −19.08');
    else if (family === 'pulse') {
      const gone = [];
      for (let k = 1; k <= 16 && gone.length < 3; k++) if (harmonicRatio('pulse', k, d) === 0) gone.push(k);
      lines.push('c_k = A·d·sinc(kd)', 'sinc(u) = sin(πu)/(πu)', '|c_k| = 0, kd = 1, 2, 3, …');
      // the missing harmonics for the current duty, still as a math line (the read line says it in words)
      if (gone.length) lines.push(`|c_k| = 0, k = ${gone.join(', ')}, …`);
    } else lines.push('x(t) = A sin(2πf₀t)', 'c_k = 0, k ≥ 2');
    return lines.join('\n');
  },
};
