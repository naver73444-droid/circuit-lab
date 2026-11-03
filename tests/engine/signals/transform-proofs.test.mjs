// 푸리에 변환 성질 증명 예시(Ch04_4 p11 sin 변조, p12 음수 스케일링, p16 적분)의 순수 계약.
// 기대값은 helper 반환값을 다시 조합하지 않고 독립 폐형식 또는 중점 합으로 계산한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROOF_FAMILIES, isProofFamily, proofControls, normalizeProof, proofLines, proofFormula, proofRead, proofDescribe, proofFrame,
  scaledExponential, scaledExponentialSpectrum, sinModulationSpectrum, integratedRectangle, integralSpectrum,
} from '../../../src/signals-transform-proofs.js';
import { TRANSFORM_FAMILIES, transformLesson, transformFrame, describeTransform } from '../../../src/signals-transform-model.js';
import { parseCourseMath } from '../../../src/course-math-view.js';

const near = (a, b, tol, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} versus ${b} (tol ${tol})`);
const TAU = 2 * Math.PI;
const sincRef = (u) => (u === 0 ? 1 : Math.sin(Math.PI * u) / (Math.PI * u));
const FAMILIES = ['proof-scale', 'proof-sin', 'proof-integral'];

// ---------------------------------------------------------------- 음수 스케일링 (p12)
test('p12 설계 예 a=−2: y(t)=e^(2t)u(−t), Y(ω)=1/(2−jω), ω=2에서 1/4+j/4', () => {
  near(scaledExponential(-2, -1), Math.exp(-2), 1e-12); // e^(2·(−1))
  assert.equal(scaledExponential(-2, 1), 0); // u(−t)=0
  assert.equal(scaledExponential(-2, 0), null); // t=0은 점프
  const y0 = scaledExponentialSpectrum(-2, 0);
  near(y0.re, 0.5, 1e-12); near(y0.im, 0, 1e-12); // 1/2
  const y2 = scaledExponentialSpectrum(-2, 2 / TAU);
  near(y2.re, 0.25, 1e-12); near(y2.im, 0.25, 1e-12); // 1/(2−j2)=(2+j2)/8
  near(Math.hypot(y2.re, y2.im), Math.SQRT2 / 4, 1e-12);
  near(Math.atan2(y2.im, y2.re), Math.PI / 4, 1e-12);
  // a=+2: 1/(2+j2)=(2−j2)/8 — 크기는 같고 허수부는 반대
  const p2 = scaledExponentialSpectrum(2, 2 / TAU);
  near(p2.re, 0.25, 1e-12); near(p2.im, -0.25, 1e-12);
});

test('스케일링 일반값: 오른쪽/왼쪽 지수의 독립 중점 적분과 복소값이 일치', () => {
  // y(t)=e^(−at)u(at): a>0이면 t∈[0, 20/a], a<0이면 t∈[20/a, 0]. t=0에서 나눠 양쪽 2만 점씩(한쪽은 0).
  const midpoint = (a, f) => {
    let re = 0;
    let im = 0;
    const L = 20 / Math.abs(a);
    for (const [lo, hi] of [[-L, 0], [0, L]]) {
      const n = 20000;
      const h = (hi - lo) / n;
      for (let k = 0; k < n; k++) {
        const t = lo + (k + 0.5) * h;
        const x = a * t > 0 ? Math.exp(-a * t) : 0;
        re += x * Math.cos(TAU * f * t) * h;
        im -= x * Math.sin(TAU * f * t) * h;
      }
    }
    return { re, im };
  };
  for (const a of [-3, -0.25, 0.25, 3]) {
    for (const f of [0, 0.3, -0.3, 1, -1]) {
      const got = scaledExponentialSpectrum(a, f);
      const ref = midpoint(a, f);
      near(got.re, ref.re, 2e-5, `a=${a} f=${f} re`);
      near(got.im, ref.im, 2e-5, `a=${a} f=${f} im`);
    }
  }
});

// ---------------------------------------------------------------- sin 변조 (p11)
test('p11 설계 기본 T=2, f₀=2: Y(+2 Hz)=−j, Y(−2 Hz)=+j, Y(0)=0 (sinc(8)=0)', () => {
  const plus = sinModulationSpectrum({ T: 2, f0: 2 }, 2);
  const minus = sinModulationSpectrum({ T: 2, f0: 2 }, -2);
  const zero = sinModulationSpectrum({ T: 2, f0: 2 }, 0);
  near(plus.re, 0, 1e-12); near(plus.im, -1, 1e-12);
  near(minus.re, 0, 1e-12); near(minus.im, 1, 1e-12);
  near(zero.re, 0, 1e-12); near(zero.im, 0, 1e-12);
});

test('변조 중첩 T=2, f₀=0.6: 다른 로브도 복소수로 더해 Y(0.6)=j[sinc(2.4)−1]', () => {
  const v = sinModulationSpectrum({ T: 2, f0: 0.6 }, 0.6);
  const expected = Math.sin(2.4 * Math.PI) / (2.4 * Math.PI) - 1; // [T sinc(2f₀T) − T sinc(0)]/2, T=2
  near(v.re, 0, 1e-12);
  near(v.im, expected, 1e-12);
  near(v.im, -0.8738622118932238, 1e-12);
});

test('sin 변조: [−T/2, T/2] 중점 합(2만 점)과 일치', () => {
  const T = 2;
  for (const f0 of [0.6, 2, 3]) {
    for (const f of [0, 0.37, -0.37, f0, -f0]) {
      let re = 0;
      let im = 0;
      const n = 20000;
      const h = T / n;
      for (let k = 0; k < n; k++) {
        const t = -T / 2 + (k + 0.5) * h;
        const y = Math.sin(TAU * f0 * t);
        re += y * Math.cos(TAU * f * t) * h;
        im -= y * Math.sin(TAU * f * t) * h;
      }
      const got = sinModulationSpectrum({ T, f0 }, f);
      near(got.re, re, 2e-6, `f0=${f0} f=${f} re`);
      near(got.im, im, 2e-6, `f0=${f0} f=${f} im`);
    }
  }
});

// ---------------------------------------------------------------- 적분 (p16)
test('p16 설계 T=1: 누적 적분 0 → 직선 → 1', () => {
  for (const [t, y] of [[-1, 0], [-0.25, 0.25], [0, 0.5], [0.25, 0.75], [1, 1]]) near(integratedRectangle(1, t), y, 1e-12, `t=${t}`);
  near(integratedRectangle(2, 0), 1, 1e-12); // 넓이 T의 절반
});

test('적분 정규 부분: ω=π에서 −j·2/π², jωY_r=X(ω)', () => {
  const r = integralSpectrum(1, 0.5).regular;
  near(r.re, 0, 1e-12);
  near(r.im, -2 / Math.PI ** 2, 1e-12); // sinc(1/2)/(jπ) = (2/π)/(jπ)
  near(r.im, -0.20264236728467555, 1e-12);
  for (const w of [0.5, -0.5, Math.PI, -Math.PI, 3, -3]) {
    const v = integralSpectrum(1, w / TAU).regular;
    // jω·(re + j·im) = −ω·im + jω·re
    near(-w * v.im, sincRef(w / TAU), 1e-12, `ω=${w}`);
    near(w * v.re, 0, 1e-12);
  }
});

test('δ와 축 변경: f축 면적 T/2, ω축 2π·T/2=πT; f=0의 정규 부분은 null', () => {
  for (const [T, hz] of [[1, 0.5], [2, 1]]) {
    const { regular, impulse } = integralSpectrum(T, 0);
    assert.equal(regular, null);
    assert.equal(impulse.atHz, 0);
    near(impulse.areaHz, hz, 1e-12);
    near(TAU * impulse.areaHz, Math.PI * T, 1e-12);
  }
});

// ---------------------------------------------------------------- 오류·정규화
test('a=0과 비유한 수, T≤0은 한국어 RangeError', () => {
  for (const fn of [() => scaledExponential(0, 1), () => scaledExponentialSpectrum(0, 1), () => scaledExponential(NaN, 1), () => scaledExponentialSpectrum(1, Infinity)]) {
    assert.throws(fn, (e) => e instanceof RangeError && /[가-힣]/.test(e.message));
  }
  assert.throws(() => sinModulationSpectrum({ T: 0, f0: 1 }, 0), RangeError);
  assert.throws(() => sinModulationSpectrum({ T: 2, f0: NaN }, 0), RangeError);
  assert.throws(() => integratedRectangle(-1, 0), RangeError);
  assert.throws(() => integralSpectrum(0, 1), RangeError);
  assert.throws(() => integralSpectrum(1, NaN), RangeError);
  assert.throws(() => proofFrame('rect', {}), RangeError);
  assert.throws(() => proofControls('nope'), RangeError);
});

test('normalize: a=0 → 0.25와 note, 증명 줄은 정수 1~4', () => {
  const zero = normalizeProof('proof-scale', { a: 0, line: 1 });
  assert.equal(zero.params.a, 0.25);
  assert.equal(zero.note, 'a=0은 제외합니다. 0.25로 표시합니다.');
  const fine = normalizeProof('proof-scale', { a: -2, line: 2 });
  assert.equal(fine.note, '');
  assert.equal('a' in fine.params, false); // 정규화할 키만
  for (const [raw, line] of [[2.5, 3], [0, 1], [7, 4], [-1, 1], [NaN, 1], [4, 4]]) assert.equal(normalizeProof('proof-sin', { line: raw }).params.line, line, String(raw));
  // lesson 훅도 같은 결과, 다른 예시는 null
  assert.deepEqual(transformLesson.normalize('proof-scale', { a: 0, line: 1 }), zero);
  assert.equal(transformLesson.normalize('rect', { T: 1 }), null);
  // 표시 어댑터는 normalize 없이 중간값(a=0, line=2.5)을 받아도 안전하다
  const raw = Object.freeze({ a: 0, line: 2.5, axis: 1 });
  assert.match(proofDescribe('proof-scale', raw), /^줄 3\/4/);
  assert.doesNotMatch(proofFormula('proof-scale', raw), /NaN|Infinity|undefined/);
  assert.equal(raw.a, 0); // 입력 객체는 그대로
});

test('controls: 사양의 범위·기본값, 증명 줄 라벨', () => {
  const scale = proofControls('proof-scale');
  assert.deepEqual(scale.map((c) => c.key), ['a', 'line', 'axis']);
  assert.deepEqual([scale[0].min, scale[0].max, scale[0].step, scale[0].initial], [-3, 3, 0.25, -2]);
  assert.deepEqual([scale[1].label, scale[1].min, scale[1].max, scale[1].step, scale[1].initial, scale[1].integer], ['증명 줄', 1, 4, 1, 1, true]);
  assert.equal(scale[2].initial, 1); // ω축
  const sin = proofControls('proof-sin', { axis: 1 });
  assert.deepEqual(sin.map((c) => c.key), ['f0', 'line', 'axis']);
  assert.deepEqual([sin[0].min, sin[0].max, sin[0].step, sin[0].initial, sin[0].unit], [0.5, 3, 0.1, 2, 'rad/s']);
  near(sin[0].displayScale, TAU, 1e-12);
  assert.equal(proofControls('proof-sin', { axis: 0 })[0].unit, 'Hz');
  assert.deepEqual(proofControls('proof-integral').map((c) => c.key), ['line', 'axis']);
});

// ---------------------------------------------------------------- 증명 줄
test('증명 줄: 길이 4, 식은 파싱 가능, 줄 수를 늘리고 줄이면 정확히 앞 n줄만', () => {
  for (const family of FAMILIES) {
    const lines = proofLines(family, {});
    assert.equal(lines.length, 4);
    for (const { formula, reason } of lines) {
      for (const part of formula.split(';').map((s) => s.trim())) assert.ok(parseCourseMath(part), `${family}: ${part}`);
      assert.match(reason, /[가-힣]/);
    }
    const first = proofFormula(family, { line: 1 });
    for (const n of [1, 2, 3, 4, 3, 2, 1]) {
      const text = proofFormula(family, { line: n });
      lines.forEach((l, i) => assert.equal(text.includes(l.formula), i < n, `${family} n=${n} line ${i + 1}`));
      assert.match(text, /^X\(ω\)=∫ x\(t\) e\^\(−jωt\) dt; x\(t\)=\(1\/2π\)∫ X\(ω\) e\^\(jωt\) dω;/);
      assert.match(proofDescribe(family, { line: n }), new RegExp(`^줄 ${n}/4 · `));
      for (const part of text.split(';').map((s) => s.trim())) assert.ok(parseCourseMath(part), `${family} n=${n}: ${part}`);
    }
    assert.equal(proofFormula(family, { line: 1 }), first);
  }
  // 스케일링 2·3줄은 a의 부호에 따라 경계와 계수가 달라진다
  const neg = proofLines('proof-scale', { a: -2 });
  const pos = proofLines('proof-scale', { a: 2 });
  assert.match(neg[1].formula, /∫_\(∞\)\^\(−∞\)/);
  assert.match(pos[1].formula, /∫_\(−∞\)\^\(∞\)/);
  assert.match(neg[2].formula, /^Y\(ω\)=−\(1\/a\)/);
  assert.match(pos[2].formula, /^Y\(ω\)=\(1\/a\)/);
  assert.equal(neg[3].formula, 'Y(ω)=(1/|a|) X(ω/a)');
  assert.match(proofFormula('proof-scale', { a: -2, line: 4 }), /y\(t\)=e\^\(2t\)u\(−t\); Y\(ω\)=\(1\/2\)·1\/\(1\+jω\/\(−2\)\); Y\(2\)=0\.25\+j0\.25/);
});

test('p11: 지수의 j를 빠뜨리지 않고, 마지막 줄은 e^(∓jπ/2) 위상 인자', () => {
  const text = proofFormula('proof-sin', { line: 4 });
  assert.ok(text.includes('sin(ω₀t)=[e^(jω₀t)−e^(−jω₀t)]/(2j)'));
  assert.doesNotMatch(text, /e\^\(−?ω₀t\)/); // 강의 중간 식의 j 누락을 옮기지 않음
  assert.ok(text.includes('Y(ω)=[e^(−jπ/2)X(ω−ω₀)+e^(jπ/2)X(ω+ω₀)]/2'));
  assert.match(text, /Y\(ω₀\)=−j1; Y\(−ω₀\)=j1/);
  // 크기를 따로 더하지 않는다: 일반 f₀에서는 ±f₀ 판독값의 크기가 1이 아님
  assert.match(proofDescribe('proof-sin', { f0: 2 }), /±f₀ 판독값의 크기가 1/);
  assert.doesNotMatch(proofDescribe('proof-sin', { f0: 0.6 }), /크기가 1(?!이 아님)/);
  assert.doesNotMatch(proofRead('proof-sin'), /두 봉우리/);
});

test('p16: 적분 라벨·U(ω)·표본화 성질, jw 오타·Multiplication 소제목을 옮기지 않음', () => {
  const text = proofFormula('proof-integral', { line: 4 });
  assert.ok(text.includes('y(t)=∫_(−∞)^(t) x(λ) dλ=(x*u)(t)'));
  assert.ok(text.includes('U(ω)=πδ(ω)+PV{1/(jω)}'));
  assert.ok(text.includes('X(ω)δ(ω)=X(0)δ(ω)'));
  assert.ok(text.includes('Y(ω)=πX(0)δ(ω)+PV{X(ω)/(jω)}'));
  assert.doesNotMatch(text, /jw|Multiplication/);
  assert.match(proofFrame('proof-integral', {}).panes[0].title, /∫x\(λ\)dλ/);
  assert.match(proofRead('proof-integral'), /PV/);
});

test('read: 20~159자 한국어, lesson이 proof에 위임', () => {
  for (const family of FAMILIES) {
    const text = proofRead(family);
    assert.ok(text.length >= 20 && text.length <= 159 && /[가-힣]/.test(text), family);
    assert.equal(transformLesson.read(family, {}), text);
    assert.equal(transformLesson.formula(family, { line: 2 }), proofFormula(family, { line: 2 }));
    assert.equal(transformLesson.describe({ family, params: { line: 3 } }), proofDescribe(family, { line: 3 }));
    assert.deepEqual(transformLesson.controls(family, { axis: 1 }), proofControls(family, { axis: 1 }));
    assert.deepEqual(transformFrame(family, { line: 2 }), proofFrame(family, { line: 2 }));
    assert.equal(describeTransform(family, { line: 1 }), proofDescribe(family, { line: 1 }));
  }
});

test('자유 예시 맨 뒤에 세 증명, 그 앞의 예시·따라가기는 그대로', () => {
  assert.deepEqual(TRANSFORM_FAMILIES.slice(-3).map((f) => f.value), FAMILIES);
  assert.deepEqual(PROOF_FAMILIES.map((f) => f.label), ['성질 증명 · 음수 스케일링', '성질 증명 · sin 변조', '성질 증명 · 적분과 δ']);
  assert.equal(TRANSFORM_FAMILIES.filter((f) => isProofFamily(f.value)).length, 3);
  assert.equal(transformLesson.initialFamily, 'rect');
  assert.equal(transformLesson.guide.steps.length, 5);
  assert.equal(isProofFamily('guide:train'), false);
});

// ---------------------------------------------------------------- 프레임
// 슬라이더 끝값·중간값·기본값 조합
function paramSets(family) {
  const out = [];
  for (const axis of [0, 1]) {
    const controls = proofControls(family, { axis }).filter((c) => c.key !== 'axis');
    for (const pick of [(c) => c.initial, (c) => c.min, (c) => c.max, (c) => (c.min + c.max) / 2]) {
      out.push({ ...Object.fromEntries(controls.map((c) => [c.key, pick(c)])), axis });
    }
  }
  return out;
}

test('모든 끝값 프레임: 세 칸, 유한 좌표, 증명 줄과 무관한 그래프', () => {
  for (const family of FAMILIES) {
    for (const params of paramSets(family)) {
      const frame = proofFrame(family, params);
      assert.equal(frame.split, true);
      assert.equal(frame.panes.length, 3);
      for (const pane of frame.panes) {
        assert.ok(pane.x[1] > pane.x[0] && pane.y[1] > pane.y[0], `${family} ${pane.title}`);
        for (const item of pane.lines ?? []) {
          for (const [x, y] of item.pts) {
            assert.ok(Number.isFinite(x), `${family} x=${x}`);
            assert.ok(y === null || Number.isNaN(y) || Number.isFinite(y), `${family} y=${y}`);
          }
        }
        for (const s of pane.segments ?? []) assert.ok([s.x1, s.y1, s.x2, s.y2].every(Number.isFinite));
        for (const j of pane.jumps ?? []) for (const { x, left, right } of j.list) assert.ok([x, left, right].every(Number.isFinite));
        assert.doesNotMatch(pane.title, /NaN|undefined|Infinity/);
      }
      assert.doesNotMatch(proofDescribe(family, params), /NaN|undefined|Infinity/);
      assert.doesNotMatch(proofFormula(family, params), /NaN|undefined|Infinity/);
      assert.deepEqual(proofFrame(family, { ...params, line: 1 }), proofFrame(family, { ...params, line: 4 }));
    }
  }
});

test('스케일링 프레임: t=0의 점프는 선을 잇지 않고 양쪽 극한을 열린 원으로', () => {
  const frame = proofFrame('proof-scale', { a: -2, axis: 1 });
  const time = frame.panes[0];
  const y = time.lines.find((l) => l.cls === 'c1').pts;
  assert.ok(y.some(([t, v]) => t === 0 && Number.isNaN(v)));
  const jump = time.jumps.find((j) => j.cls === 'c1').list;
  assert.equal(jump.length, 1);
  near(jump[0].x, 0, 1e-12);
  near(jump[0].left, 1, 1e-6); // e^(2t) → 1 (t→0⁻)
  near(jump[0].right, 0, 1e-12); // u(−t)=0 (t→0⁺)
  assert.equal(time.x[0], -4); assert.equal(time.x[1], 4);
  // 주파수 칸: ω∈[−10, 10] rad/s, f축은 같은 물리 범위
  near(frame.panes[1].x[1], 10, 1e-12);
  near(proofFrame('proof-scale', { a: -2, axis: 0 }).panes[1].x[1], 10 / TAU, 1e-12);
});

test('sin 프레임: Re Y는 0, Im Y 곡선, 주파수 범위 ±(f₀+3/T)', () => {
  for (const axis of [0, 1]) {
    const frame = proofFrame('proof-sin', { f0: 2, axis });
    const k = axis === 1 ? TAU : 1;
    near(frame.panes[1].x[1], (2 + 1.5) * k, 1e-12);
    assert.ok(frame.panes[1].lines[0].pts.every(([, v]) => v === 0));
    const im = frame.panes[2].lines[0].pts;
    const at = im.reduce((best, p) => (Math.abs(p[0] - 2 * k) < Math.abs(best[0] - 2 * k) ? p : best));
    near(at[1], sinModulationSpectrum({ T: 2, f0: 2 }, at[0] / k).im, 1e-12);
    assert.equal(frame.panes[0].jumps.find((j) => j.cls === 'cm').list.length, 2); // Π 경계 ±1 s
  }
});

test('적분 프레임: 원점 정규 부분은 끊고, 축별 δ 면적 π / 1/2, 같은 물리 주파수에서 같은 값', () => {
  const w = proofFrame('proof-integral', { axis: 1 });
  const f = proofFrame('proof-integral', { axis: 0 });
  for (const [frame, k, label] of [[w, TAU, '면적 π'], [f, 1, '면적 1/2']]) {
    const re = frame.panes[1];
    assert.equal(re.segments.length, 1);
    assert.equal(re.segments[0].x1, 0);
    assert.deepEqual(re.texts.map((t) => t.text), [label]);
    const im = frame.panes[2];
    assert.deepEqual(im.y, [-2, 2]);
    const pts = im.lines[0].pts;
    const breaks = pts.filter(([, v]) => v === null);
    assert.equal(breaks.length, 1);
    assert.equal(breaks[0][0], 0);
    for (const [x, v] of pts) if (v !== null) assert.ok(Math.abs(x / k) * TAU >= 0.5 - 1e-12, `|ω|<0.5 drawn at ${x}`);
    assert.ok(pts.every(([x, v]) => v === null || Math.abs(v) <= 2), 'Im 축 [−2, 2] 안');
    assert.ok(im.texts.some((t) => t.text === '원점 발산 · 가운데 구간 생략'));
  }
  // 정규 부분은 X(f)=X(ω): 같은 표본 순서에서 같은 값
  const a = w.panes[2].lines[0].pts;
  const b = f.panes[2].lines[0].pts;
  assert.equal(a.length, b.length);
  a.forEach((p, i) => { if (p[1] !== null) { near(p[1], b[i][1], 1e-12); near(p[0] / b[i][0], TAU, 1e-9); } });
  // 시간의 적분 결과는 축 변경 전후 동일
  assert.deepEqual(w.panes[0], f.panes[0]);
  // 판독값: ω=π와 f=0.5가 같은 −j·2/π²
  assert.match(proofDescribe('proof-integral', { axis: 1 }), /ω=π rad\/s: 정규 부분 −j0\.2026 · 원점 δ 면적 π/);
  assert.match(proofDescribe('proof-integral', { axis: 0 }), /f=0\.5 Hz: 정규 부분 −j0\.2026 · 원점 δ 면적 0\.5/);
});

test('스케일링·sin 판독은 축을 바꿔도 같은 복소값', () => {
  const read = (family, axis) => proofDescribe(family, { axis }).split(': ').slice(1).join(': ');
  assert.equal(read('proof-scale', 0), read('proof-scale', 1));
  assert.match(read('proof-scale', 1), /^Y=0\.25\+j0\.25, \|Y\|=0\.3536, 위상 0\.7854 rad/);
  assert.equal(read('proof-sin', 0), read('proof-sin', 1));
});
