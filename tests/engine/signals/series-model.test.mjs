import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SERIES_WAVES, MAX_HARMONICS, seriesCoefficients, exactWaveform, partialSum, phasorChain, gibbsOvershoot,
  spectrumLines, seriesLesson, hasJump,
} from '../../../src/signals-series-model.js';
import { pulseSeriesCoefficient } from '../../../src/signals-course-model.js';

const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} versus ${b}`);
const WAVES = SERIES_WAVES.map((w) => w.value);

// Numerical Fourier integrals of the exact waveform over one period (midpoint rule).
function cosineParts(wave, D, k, N = 200000) {
  let c = 0;
  let s = 0;
  for (let i = 0; i < N; i++) {
    const t = -0.5 + (i + 0.5) / N;
    const x = exactWaveform(wave, D, t);
    c += x * Math.cos(2 * Math.PI * k * t);
    s += x * Math.sin(2 * Math.PI * k * t);
  }
  return { c: (2 * c) / N, s: (2 * s) / N };
}

test('amplitude and phase of every harmonic match direct integrals of the waveform', () => {
  for (const wave of WAVES) {
    const { dc, terms } = seriesCoefficients(wave, 0.35, 6);
    let mean = 0;
    for (let i = 0; i < 20000; i++) mean += exactWaveform(wave, 0.35, -0.5 + (i + 0.5) / 20000);
    near(dc, mean / 20000, 2e-4);
    for (const { k, amp, phase } of terms) {
      const { c, s } = cosineParts(wave, 0.35, k);
      near(amp * Math.cos(phase), c, 5e-4); // x = amp cos(2 pi k t + phase)
      near(-amp * Math.sin(phase), s, 5e-4);
    }
  }
});

test('pulse coefficients reuse the course coefficient (DC=D, c_k=sin(pi k D)/(pi k))', () => {
  const { dc, terms } = seriesCoefficients('pulse', 0.3, 5);
  near(dc, 0.3);
  for (const { k, amp } of terms) near(amp, 2 * Math.abs(pulseSeriesCoefficient(1, 0.3, k)));
});

test('many terms reconstruct the exact waveform away from jumps; at a jump the sum is the midpoint', () => {
  for (const wave of WAVES) {
    const c = seriesCoefficients(wave, 0.4, 600);
    for (const t of [-0.37, -0.1, 0.05, 0.31, 0.44]) {
      if (wave === 'pulse' && Math.abs(Math.abs(t) - 0.2) < 0.03) continue;
      near(partialSum(c, 600, t), exactWaveform(wave, 0.4, t), 0.01);
    }
  }
  const pulse = seriesCoefficients('pulse', 0.4, 800);
  near(partialSum(pulse, 800, 0.2), 0.5, 2e-3); // A/2 at the discontinuity
  near(exactWaveform('pulse', 0.4, 0.2), 0.5);
});

test('the chain tip height is the partial sum, for every time, wave and N', () => {
  for (const wave of WAVES) {
    const c = seriesCoefficients(wave, 0.45, MAX_HARMONICS);
    for (const N of [1, 3, 10, 25]) {
      for (const t of [0, 0.137, 0.5, 0.91, 1.7]) {
        const chain = phasorChain(c, N, t);
        assert.equal(chain.length, N + 2);
        near(chain.at(-1).y, partialSum(c, N, t), 1e-12);
      }
    }
  }
});

test('vector k rotates k times faster: after T0/k the chain returns', () => {
  const c = seriesCoefficients('saw', 0.5, 5);
  const a = phasorChain(c, 1, 0.0);
  const b = phasorChain(c, 1, 1.0);
  near(a.at(-1).x, b.at(-1).x, 1e-12);
  const half = phasorChain(c, 2, 0.5); // harmonic 2 completed one turn, harmonic 1 half a turn
  near(half[2].x, -a[2].x, 1e-12);
});

test('Gibbs: about 9% of the jump survives for N large, none for the continuous triangle', () => {
  near(gibbsOvershoot('pulse', 0.5, 100).fraction, 0.0895, 3e-3);
  near(gibbsOvershoot('pulse', 0.2, 60).fraction, 0.0895, 8e-3);
  assert.equal(gibbsOvershoot('tri', 0.5, 25).fraction, 0);
  assert.ok(gibbsOvershoot('saw', 0.5, 200).fraction > 0.05);
  assert.ok(gibbsOvershoot('pulse', 0.5, 25).peak > 1.08);
  assert.equal(hasJump('tri'), false);
});

test('spectrum lines list DC and 25 harmonics with the tri wave odd-only', () => {
  const lines = spectrumLines('tri', 0.5);
  assert.equal(lines.length, MAX_HARMONICS + 1);
  for (const { k, amp } of lines.slice(1)) assert.equal(amp === 0, k % 2 === 0);
  near(spectrumLines('pulse', 0.25)[0].amp, 0.25);
});

test('lesson controls: N integer 1..25, duty only for the pulse', () => {
  const pulse = seriesLesson.controls('pulse');
  assert.deepEqual(pulse.map((c) => c.key), ['N', 'T0', 'D', 'spec', 'axis']);
  assert.equal(pulse[0].min, 1);
  assert.equal(pulse[0].max, 25);
  assert.deepEqual(seriesLesson.controls('saw').map((c) => c.key), ['N', 'T0', 'spec', 'axis']);
  assert.match(seriesLesson.describe({ family: 'pulse', params: { N: 25, D: 0.5 } }), /넘침/);
  assert.match(seriesLesson.describe({ family: 'tri', params: { N: 5 } }), /넘침 없음/);
  assert.throws(() => seriesCoefficients('nope'));
  assert.throws(() => seriesCoefficients('pulse', 1.2, 3));
});

test('peak sentence: "넘침" only when the sum really exceeds the target', () => {
  const small = seriesLesson.describe({ family: 'saw', params: { N: 1 } });
  assert.doesNotMatch(small, /넘침|%/);
  assert.match(small, /목표 1/);
  assert.match(seriesLesson.describe({ family: 'pulse', params: { N: 25, D: 0.5 } }), /넘침/);
  assert.doesNotMatch(seriesLesson.describe({ family: 'saw', params: { N: 2 } }), /넘침/); // peak 0.83
  assert.match(seriesLesson.read('pulse'), /수렴/);
  assert.match(seriesLesson.formula('pulse', { D: 0.5 }), /f₀=1 Hz/);
});
