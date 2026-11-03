import test from 'node:test';
import assert from 'node:assert/strict';
import { coefficientRow, coefficientRows, TABLE_ROWS } from '../../../src/signals-series-coefficients.js';
import { SERIES_WAVES, SERIES_DEFAULTS, SPEC_OPTIONS, TFS_SPEC, seriesLesson, formatPhase } from '../../../src/signals-series-model.js';

const near = (a, b, tol = 1e-12) => assert.ok(Math.abs(a - b) <= tol, `${a} versus ${b}`);
// Same angle modulo 2*pi.
const sameAngle = (a, b, tol = 1e-12) => { near(Math.cos(a), Math.cos(b), tol); near(Math.sin(a), Math.sin(b), tol); };
const sinc = (u) => (u === 0 ? 1 : Math.sin(Math.PI * u) / (Math.PI * u));

test('Review p19~21: 중심 펄스열 T0=3, d=1/3, N=10 — 표 11행이 c_k=sin(πk/3)/(πk)와 일치', () => {
  const rows = coefficientRows('pulse', 1 / 3, 10);
  assert.equal(rows.length, 11);
  for (const r of rows) {
    const c = r.k === 0 ? 1 / 3 : Math.sin((Math.PI * r.k) / 3) / (Math.PI * r.k); // 손계산: c_k = d sinc(kd)
    near(r.c.re, c);
    near(r.c.im, 0);
    near(r.a, r.k === 0 ? c : 2 * c);
    near(r.d, r.k === 0 ? c : 2 * Math.abs(c));
    if (r.k > 0) near(r.b, 0);
  }
  // 사양 §5.3 표의 소수(10자리 반올림) — 오차 6e-11
  const table = [
    [0, 0.3333333333, 0.3333333333], [1, 0.5513288954, 0.5513288954], [2, 0.2756644477, 0.2756644477], [3, 0, 0],
    [4, -0.1378322239, 0.1378322239], [5, -0.1102657791, 0.1102657791], [6, 0, 0], [7, 0.0787612708, 0.0787612708],
    [8, 0.0689161119, 0.0689161119], [9, 0, 0], [10, -0.0551328895, 0.0551328895],
  ];
  for (const [k, a, d] of table) { near(rows[k].a, a, 6e-11); near(rows[k].d, d, 6e-11); }
  // p19 막대의 소수 셋째 자리: a1=0.551, a2=0.276, a4=−0.138, a5=−0.110, a7=0.079
  assert.deepEqual([1, 2, 4, 5, 7].map((k) => rows[k].a.toFixed(3)), ['0.551', '0.276', '-0.138', '-0.110', '0.079']);
});

test('DC 예외와 위상: b0·φ0는 null, k=3·6·9 위상 미정의, k=4·5·10은 +π', () => {
  const rows = coefficientRows('pulse', 1 / 3, 10);
  assert.equal(rows[0].b, null);
  assert.equal(rows[0].phi, null);
  near(rows[0].phase, 0); // ∠c0는 c0≠0이면 계산 가능 (c0=1/3 > 0)
  for (const k of [3, 6, 9]) { assert.equal(rows[k].phase, null, `k=${k}`); assert.equal(rows[k].phi, null, `k=${k}`); }
  for (const k of [4, 5, 10]) { assert.equal(rows[k].phase, Math.PI, `k=${k}`); assert.equal(rows[k].phi, Math.PI, `k=${k}`); }
  for (const k of [1, 2, 7, 8]) assert.equal(rows[k].phase, 0, `k=${k}`);
  assert.equal(formatPhase(Math.PI), 'π');
  assert.equal(formatPhase(-Math.PI / 3), '−π/3');
  assert.equal(formatPhase(-2 * Math.PI / 3), '−2π/3');
  assert.equal(formatPhase(null), '—');
});

test('이동 펄스열 T0=3, d=1/3 (Ex 4.1·4.2·4.6): c_k = d sinc(kd) e^(−jπkd)', () => {
  const r1 = coefficientRow('pulse0', 1 / 3, 1);
  near(r1.a, Math.sqrt(3) / (2 * Math.PI)); // 2Re: 2·(√3/(4π))
  near(r1.b, 3 / (2 * Math.PI)); // −2Im: 2·3/(4π)
  near(r1.c.re, Math.sqrt(3) / (4 * Math.PI));
  near(r1.c.im, -3 / (4 * Math.PI));
  sameAngle(r1.phi, -Math.PI / 3);
  const r2 = coefficientRow('pulse0', 1 / 3, 2);
  near(r2.a, -Math.sqrt(3) / (4 * Math.PI));
  near(r2.b, 3 / (4 * Math.PI));
  sameAngle(r2.phi, -2 * Math.PI / 3);
  // 일반 k: c_k = d sinc(kd) e^(−jπkd)
  for (let k = 1; k <= 25; k++) {
    const mag = (1 / 3) * sinc(k / 3);
    const r = coefficientRow('pulse0', 1 / 3, k);
    near(r.c.re, mag * Math.cos(Math.PI * k / 3));
    near(r.c.im, -mag * Math.sin(Math.PI * k / 3));
  }
});

test('홀 방형파 (Ex 4.4), k=1: a=0, b=4/π, c=−j2/π, d=4/π, φ=−π/2; 짝수 k 위상 null', () => {
  const r = coefficientRow('odd', undefined, 1);
  near(r.a, 0);
  near(r.b, 4 / Math.PI);
  near(r.c.re, 0);
  near(r.c.im, -2 / Math.PI);
  near(r.d, 4 / Math.PI);
  near(r.phi, -Math.PI / 2);
  for (const k of [2, 4, 6, 8, 10]) assert.equal(coefficientRow('odd', undefined, k).phase, null, `k=${k}`);
  assert.equal(coefficientRow('odd', undefined, 0).phase, null); // c0 = 0
});

test('모든 파형·여러 듀티에서 k≥1 변환 항등식: a−jb=2c, d=√(a²+b²)=2|c|, φ=atan2(−b,a)=arg c', () => {
  for (const { value: wave } of SERIES_WAVES) {
    for (const D of [0.1, 0.2, 0.3, 1 / 3]) {
      for (let k = 0; k <= 25; k++) {
        const r = coefficientRow(wave, D, k);
        if (k === 0) { near(r.a, r.c.re); near(r.d, r.c.re); assert.equal(r.b, null); continue; }
        near(r.a, 2 * r.c.re);
        near(r.b, -2 * r.c.im);
        near(r.d, Math.hypot(r.a, r.b));
        near(r.d, 2 * r.mag);
        if (r.phi !== null) sameAngle(r.phi, Math.atan2(-r.b, r.a));
        if (r.phi !== null) sameAngle(r.phi, Math.atan2(r.c.im, r.c.re));
        if (r.phi !== null) assert.ok(r.phi > -Math.PI && r.phi <= Math.PI, `${wave} k=${k}: ${r.phi}`);
      }
    }
  }
});

test('표 행 수: N=1·10·25 → 2·11·11, 단일 행 함수는 25차까지 정상', () => {
  assert.equal(TABLE_ROWS, 10);
  assert.equal(coefficientRows('pulse', 1 / 3, 1).length, 2);
  assert.equal(coefficientRows('pulse', 1 / 3, 10).length, 11);
  assert.equal(coefficientRows('pulse', 1 / 3, 25).length, 11);
  const r25 = coefficientRow('tri', undefined, 25);
  near(r25.a, 2 * 4 / (Math.PI * 25) ** 2); // c_k = 4/(πk)², k 홀수
});

test('T0는 계수를 바꾸지 않고 formula의 ω0만 바꿈', () => {
  const a = seriesLesson.formula('pulse', { N: 10, T0: 3, D: 1 / 3, spec: TFS_SPEC });
  const b = seriesLesson.formula('pulse', { N: 10, T0: 6, D: 1 / 3, spec: TFS_SPEC });
  assert.match(a, /T₀=3 s, ω₀=2π\/T₀=2\.094 rad\/s/);
  assert.match(b, /T₀=6 s, ω₀=2π\/T₀=1\.047 rad\/s/);
  assert.match(a, /c₁=√3\/\(2π\)≈0\.2757, a₁=0\.5513, b₁=0, d₁=0\.5513, φ₁=0/);
  assert.match(seriesLesson.formula('pulse0', { N: 4, T0: 3, D: 1 / 3, spec: TFS_SPEC }), /a₁=0\.2757, b₁=0\.4775, d₁=0\.5513, φ₁=−π\/3/);
  assert.match(a, /^x_N\(t\)=a₀\+Σ/); // 유한 합은 부분합 x_N (보충 1)
});

test('스펙트럼 선택지 3 = 삼각 aₖ·bₖ (TFS); 기존 N·T0·d 기본값·간격은 그대로', () => {
  assert.deepEqual(SPEC_OPTIONS.map((o) => o.value), [0, 1, 2, 3]);
  assert.equal(TFS_SPEC, 3);
  assert.match(SPEC_OPTIONS[3].label, /TFS/);
  const controls = seriesLesson.controls('pulse');
  const by = Object.fromEntries(controls.map((c) => [c.key, c]));
  assert.deepEqual([by.N.min, by.N.max, by.N.step, by.N.initial], [1, 25, 1, 7]);
  assert.deepEqual([by.T0.min, by.T0.max, by.T0.step, by.T0.initial], [0.5, 6, 0.5, 3]);
  assert.deepEqual([by.D.min, by.D.max, by.D.step, by.D.initial], [3 / 60, 57 / 60, 1 / 60, 1 / 3]);
  assert.equal(by.spec.max, 3);
  assert.deepEqual(SERIES_DEFAULTS.pulse, { T0: 3, D: 1 / 3, N: 7 });
});

test('잘못된 입력은 RangeError: 파형, N 범위/정수, k 범위, 펄스 D 범위', () => {
  assert.throws(() => coefficientRow('nope', 0.5, 1), RangeError);
  assert.throws(() => coefficientRows('nope', 0.5, 3), RangeError);
  for (const N of [0, 26, 2.5, NaN]) assert.throws(() => coefficientRows('pulse', 1 / 3, N), RangeError, `N=${N}`);
  for (const k of [-1, 26, 1.5]) assert.throws(() => coefficientRow('pulse', 1 / 3, k), RangeError, `k=${k}`);
  for (const D of [0, 1, -0.2, NaN]) assert.throws(() => coefficientRow('pulse', D, 1), RangeError, `D=${D}`);
});
