import test from 'node:test';
import assert from 'node:assert/strict';
import { samplingLesson, describeNormalized, describeSampling } from '../../../src/signals-sampling-model.js';
import { rocLesson, ROC_FAMILIES, LATER } from '../../../src/signals-roc-model.js';
import { SIGNALS_LESSONS } from '../../../src/signals-course-model.js';

test('Laplace/Z and sampling are labelled as later material in the lesson list, the title and the read line', () => {
  for (const id of ['roc', 'sampling']) {
    const lesson = SIGNALS_LESSONS.find((l) => l.id === id);
    assert.equal(lesson.later, true);
    assert.match(lesson.tab, /참고/);
    assert.match(lesson.title, /이후 진도\(참고\)/);
  }
  assert.equal(LATER, '[이후 진도·참고] ');
  for (const { value } of ROC_FAMILIES) {
    const text = rocLesson.read(value);
    assert.ok(text.startsWith(LATER), value);
    assert.ok(text.length > 20 && text.length < 160, `${value}: ${text.length}`);
  }
  assert.ok(samplingLesson.read().startsWith(LATER));
  assert.ok(samplingLesson.read().length < 160);
});

test('Ch 1.4 relation in the sampling readout: Omega0 = w0 Ts = 2 pi f0/fs, F0 = f0/fs, period N = k/F0', () => {
  // f0 = 7 Hz sampled at 10 Hz: F0 = 0.7 = 7/10 -> N = 10 samples, Omega0 = 1.4 pi
  assert.match(describeNormalized({ f0: 7, fs: 10 }), /Ω₀=ω₀Tₛ=4\.4 rad, F₀=f₀\/fₛ=0\.7 \(Ω₀=2πF₀\) · DT 주기 N=k\/F₀=10 표본/);
  // f0 = 1 Hz at fs = 4 Hz: F0 = 1/4 -> N = 4
  assert.match(describeNormalized({ f0: 1, fs: 4 }), /F₀=f₀\/fₛ=0\.25 .* N=k\/F₀=4 표본/);
  // F0 = 0.15 (3/20) -> N = 20 as in cos(0.3 pi n - pi/10)
  assert.match(describeNormalized({ f0: 1.5, fs: 10 }), /F₀=f₀\/fₛ=0\.15 .* N=k\/F₀=20 표본/);
  // irrational F0 -> aperiodic (the slider values are decimals, so make one with sqrt(2))
  assert.match(describeNormalized({ f0: Math.SQRT2, fs: 1 }), /무리수라 DT 신호는 비주기/);
  const lesson = samplingLesson.describe({ params: { f0: 7, fs: 10, phi: 0 } });
  assert.ok(lesson.startsWith(describeSampling({ f0: 7, fs: 10 })));
  assert.match(lesson, /Ω₀=ω₀Tₛ/);
  assert.doesNotMatch(lesson, /NaN|undefined/);
});
