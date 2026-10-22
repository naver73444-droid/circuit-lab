// Sound-spectrum lesson model. Expected values never come from the model's own formulas: harmonic levels are checked
// against a direct numerical Fourier integral of each waveform written out here, the pulse's PeriodicWave coefficients are
// synthesized back into samples, and the harmonic picker reads a spectrum this file builds itself (known harmonics + noise →
// Blackman window → its own FFT → dB, the way an AnalyserNode reports it).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DB_FLOOR, INPUT_MODES, MIC_ONLY, MICROPHONE, SINE_DB_CORRECTION, SOUND_FAMILIES, harmonicLimit, harmonicRatio, levelDb,
  measureHarmonics, noiseFloor, peakNear, pulseWaveCoefficients, sineLevelDb, soundFrame, soundLesson, spectrumCurve, strongestPeak,
  theoryRows, waveWindow,
} from '../../../src/signals-sound-model.js';

const TAU = 2 * Math.PI;
const close = (actual, expected, tol, label) => assert.ok(Math.abs(actual - expected) <= tol, `${label}: ${actual} vs ${expected}`);

// The test tones over one period u ∈ [0, 1), written out independently of the model.
const WAVES = {
  sine: (u) => Math.sin(TAU * u),
  square: (u) => (u < 0.5 ? 1 : -1),
  sawtooth: (u) => (u < 0.5 ? 2 * u : 2 * u - 2),
  triangle: (u) => (u < 0.25 ? 4 * u : u < 0.75 ? 2 - 4 * u : 4 * u - 4),
};
const pulse = (d) => (u) => (u < d / 2 || u > 1 - d / 2 ? 1 : 0);

// |c_k| = |∫₀¹ x(u) e^{−j2πku} du| by the midpoint rule.
function coefficient(x, k, n = 200000) {
  let re = 0;
  let im = 0;
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) / n;
    re += x(u) * Math.cos(TAU * k * u);
    im -= x(u) * Math.sin(TAU * k * u);
  }
  return Math.hypot(re, im) / n;
}

test('theory: |c_k|/|c_1| of every test tone equals the numerical Fourier integral of its time definition', () => {
  for (const [family, x] of Object.entries(WAVES)) {
    const c1 = coefficient(x, 1);
    for (let k = 1; k <= 9; k++) close(harmonicRatio(family, k), coefficient(x, k) / c1, 2e-4, `${family} k=${k}`);
  }
  for (const d of [0.1, 0.25, 0.3, 0.5]) {
    const x = pulse(d);
    const c1 = coefficient(x, 1);
    for (let k = 1; k <= 12; k++) close(harmonicRatio('pulse', k, d), coefficient(x, k) / c1, 2e-4, `pulse d=${d} k=${k}`);
  }
  // exact zeros (not just small numbers) where kd is an integer, and the course levels in dB
  assert.equal(harmonicRatio('pulse', 4, 0.25), 0);
  assert.equal(harmonicRatio('pulse', 8, 0.25), 0);
  assert.equal(harmonicRatio('pulse', 2, 0.5), 0);
  assert.equal(levelDb(0), null);
  close(levelDb(harmonicRatio('square', 3)), -9.542, 1e-3, 'square k=3');
  close(levelDb(harmonicRatio('sawtooth', 2)), -6.021, 1e-3, 'sawtooth k=2');
  close(levelDb(harmonicRatio('triangle', 3)), -19.085, 1e-3, 'triangle k=3');
  assert.deepEqual(theoryRows('square', 0.25, 4).map((r) => r.db === null), [false, true, false, true]);
  assert.throws(() => harmonicRatio('square', 0));
  assert.throws(() => harmonicRatio('pulse', 1, 1));
  assert.throws(() => harmonicRatio('noise', 1));
});

test('pulse PeriodicWave: Σ real[k] cos(2πku) rebuilds the zero-mean pulse away from its edges; no DC, no sine terms', () => {
  for (const d of [0.25, 0.3]) {
    const { real, imag } = pulseWaveCoefficients(d, 600);
    assert.equal(real[0], 0, 'no DC to the speaker');
    assert.ok(imag.every((v) => v === 0), 'even pulse: cosines only');
    let worst = 0;
    for (let i = 0; i < 400; i++) {
      const u = (i + 0.5) / 400;
      const edge = Math.min(Math.abs(u - d / 2), Math.abs(u - (1 - d / 2)));
      if (edge < 0.02) continue; // Gibbs ringing next to the jumps
      let sum = 0;
      for (let k = 1; k < real.length; k++) sum += real[k] * Math.cos(TAU * k * u);
      worst = Math.max(worst, Math.abs(sum - (pulse(d)(u) - d)));
    }
    assert.ok(worst < 0.02, `d=${d}: largest error away from the edges ${worst}`);
  }
  assert.equal(harmonicLimit(440, 48000), 54);
  assert.equal(harmonicLimit(110, 48000, 64), 64);
  assert.equal(harmonicLimit(0, 48000), 0);
});

// ---------------------------------------------------------------- a spectrum built here, like an AnalyserNode reports it
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -TAU / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k);
        const wi = Math.sin(ang * k);
        const a = i + k;
        const b = a + len / 2;
        const xr = re[b] * wr - im[b] * wi;
        const xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
      }
    }
  }
}
function analyserDb(samples) {
  const n = samples.length;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const w = 0.42 - 0.5 * Math.cos((TAU * i) / n) + 0.08 * Math.cos((2 * TAU * i) / n); // Blackman (AnalyserNode)
    re[i] = samples[i] * w;
  }
  fft(re, im);
  const db = new Float32Array(n / 2);
  for (let k = 0; k < n / 2; k++) db[k] = 20 * Math.log10(Math.hypot(re[k], im[k]) / n + 1e-12);
  return db;
}
function tone(amplitudes, f0, sampleRate, n, noise = 1e-4) {
  let seed = 12345;
  const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 - 0.5; };
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let v = noise * random();
    amplitudes.forEach((a, idx) => { v += a * Math.sin((TAU * (idx + 1) * f0 * i) / sampleRate); });
    out[i] = v;
  }
  return out;
}
const SPEC = { sampleRate: 48000, fftSize: 16384 };

test('measurement: the harmonic picker reads relative levels within ±0.5 dB and flags missing harmonics as noise', () => {
  for (const f0 of [440, 263, 997]) {
    const amps = Array.from({ length: 12 }, (_, i) => ((i + 1) % 2 === 1 ? 0.2 / (i + 1) : 0)); // a square wave's harmonics
    const db = analyserDb(tone(amps, f0, SPEC.sampleRate, SPEC.fftSize));
    const m = measureHarmonics(db, SPEC, f0, 8);
    assert.equal(m.rows.length, 8);
    close(m.rows[0].rel, 0, 1e-9, `${f0}: the fundamental is the reference`);
    for (const row of m.rows) {
      if (row.k % 2 === 1) {
        assert.equal(row.noisy, false, `${f0}: k=${row.k} is present`);
        close(row.rel, 20 * Math.log10(1 / row.k), 0.5, `${f0}: k=${row.k}`);
        close(row.hz, row.k * f0, SPEC.sampleRate / SPEC.fftSize / 2, `${f0}: k=${row.k} frequency`);
      } else {
        assert.equal(row.noisy, true, `${f0}: k=${row.k} is missing`);
      }
    }
    assert.ok(m.floor < m.fundamental - 60, `${f0}: the floor is far below the tone`);
  }
});

test('absolute level: sineLevelDb turns the windowed bin level back into the sine amplitude in dBFS; relative levels need no correction', () => {
  const width = SPEC.sampleRate / SPEC.fftSize;
  for (const amplitude of [1, 0.3, 0.05]) {
    const f0 = 150 * width; // on a bin: exact
    const m = measureHarmonics(analyserDb(tone([amplitude, 0, amplitude / 3], f0, SPEC.sampleRate, SPEC.fftSize, 0)), SPEC, f0, 3);
    close(m.fundamental, 20 * Math.log10(amplitude * 0.21), 0.01, `A=${amplitude}: the raw bin is 13.6 dB under the amplitude`);
    close(sineLevelDb(m.fundamental), 20 * Math.log10(amplitude), 0.01, `A=${amplitude}: corrected to dBFS`);
    close(m.rows[2].rel, 20 * Math.log10(1 / 3), 0.05, `A=${amplitude}: k=3 relative level unchanged`);
  }
  // half a bin off: the Blackman main lobe loses 1.1 dB, the parabola through the neighbours wins most of it back
  const off = measureHarmonics(analyserDb(tone([0.3], 150.5 * width, SPEC.sampleRate, SPEC.fftSize, 0)), SPEC, 150.5 * width, 1);
  const error = sineLevelDb(off.fundamental) - 20 * Math.log10(0.3);
  assert.ok(Math.abs(error) < 1.2, `half a bin off: ${error} dB`);
  close(SINE_DB_CORRECTION, 13.555, 1e-3, 'the correction 20·log10(2/0.42)');
});

test('measurement helpers: strongest peak, peak refinement, median floor, the plotted curve and the wave window', () => {
  const db = analyserDb(tone([0.3], 398.4, SPEC.sampleRate, SPEC.fftSize));
  const peak = strongestPeak(db, SPEC);
  close(peak.hz, 398.4, 0.5, 'strongest peak');
  const near = peakNear(db, SPEC, 400, 3);
  close(near.hz, 398.4, 0.5, 'peak near 400 Hz finds the 398.4 Hz line');
  assert.equal(noiseFloor(new Float32Array([1, -Infinity, 3, 2, NaN])), 2);
  assert.equal(noiseFloor(new Float32Array([4, 1, 3, 2])), 2.5);
  assert.equal(noiseFloor(new Float32Array([-Infinity])), -Infinity);
  const curve = spectrumCurve(db, SPEC, 4000, peak.db, 200);
  assert.equal(curve.length, 200);
  assert.ok(curve.every(([x, y]) => x >= 0 && x <= 4000 && y >= DB_FLOOR && y <= 6));
  assert.ok(curve.some(([x, y]) => Math.abs(x - 398.4) < 25 && y > -1), 'the line shows near 0 dB at its own frequency');
  // two periods of a captured sine, starting on a rising zero crossing and scaled to peak 1
  const sr = 44100;
  const samples = new Float32Array(4096).map((_, i) => 0.05 * Math.sin((TAU * 300 * i) / sr + 1));
  const pts = waveWindow(samples, sr, 300);
  close(pts.at(-1)[0], 2000 / 300, 0.2, 'about two periods in ms');
  assert.ok(Math.abs(pts[0][1]) < 0.1 && pts[1][1] > pts[0][1], 'starts at a rising zero crossing');
  close(Math.max(...pts.map((p) => Math.abs(p[1]))), 1, 0.01, 'normalised to peak 1');
});

test('frames and words: theory stems vs missing markers, the mic-only frame, read/describe/formula contents', () => {
  const square = soundFrame('square', { f0: 440, d: 0.25, gain: 10, input: 0 });
  assert.equal(square.panes.length, 2);
  const [present, missing] = square.panes[1].stems;
  assert.deepEqual(present.pts.map(([x]) => x / 440), [1, 3, 5, 7, 9]);
  assert.deepEqual(missing.pts.map(([x]) => x / 440), [2, 4, 6, 8, 10]);
  close(present.pts[1][1], -9.542, 1e-3, 'square k=3 stem');
  const pulseFrame = soundFrame('pulse', { f0: 300, d: 0.25, gain: 10, input: 0 });
  assert.deepEqual(pulseFrame.panes[1].stems[1].pts.map(([x]) => x / 300), [4, 8]);
  for (const frame of [square, pulseFrame, soundFrame('sine', { f0: 1000, gain: 10, input: 0 })]) {
    for (const pane of frame.panes) assert.ok([...pane.x, ...pane.y].every(Number.isFinite) && pane.x[1] > pane.x[0], pane.title);
  }
  const micOnly = soundFrame('square', { f0: 440, gain: 10, input: MIC_ONLY });
  assert.deepEqual(micOnly.panes[1].stems.map((s) => s.pts.length), [0, 0], 'no theory without a test tone');
  assert.match(soundLesson.describe({ family: 'square', params: { f0: 440, input: 0 } }), /3번째 −9\.54 dB/);
  assert.match(soundLesson.describe({ family: 'pulse', params: { f0: 440, d: 0.25, input: 0 } }), /4번째 없음/);
  assert.match(soundLesson.read('square', { input: MICROPHONE }), /이어폰/);
  assert.match(soundLesson.read('square', { input: MIC_ONLY }), /마이크만/);
  assert.match(soundLesson.formula('pulse', { d: 0.25 }), /k = 4, 8, 12, …/);
  assert.deepEqual(SOUND_FAMILIES.map((f) => f.value), ['square', 'sawtooth', 'triangle', 'pulse', 'sine']);
  // a band-limited tone leaves numerical leftovers far below the fundamental: they count as missing, not as harmonics
  const quiet = analyserDb(tone([0.3, 0, 0.1, 1e-6], 440, SPEC.sampleRate, SPEC.fftSize, 0));
  assert.equal(measureHarmonics(quiet, SPEC, 440, 4).rows[3].noisy, true, 'a −110 dB leftover is noise level');
  assert.equal(INPUT_MODES.length, 3);
  const controls = soundLesson.controls('pulse');
  assert.deepEqual(controls.map((c) => c.key), ['f0', 'd', 'gain', 'input']);
  assert.ok(controls.find((c) => c.key === 'gain').max <= 30, 'the volume stays well below full scale');
  assert.ok(!soundLesson.controls('square').some((c) => c.key === 'd'), 'duty only for the pulse');
});
