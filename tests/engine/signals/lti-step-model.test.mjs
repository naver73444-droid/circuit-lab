import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ODE2_PRESETS, ODE2_FAMILIES, secondOrderStep, ode2Controls, ode2Cursor, ode2Frame, ode2Describe, ode2Read, ode2Formula, ode2Tangent,
} from '../../../src/signals-lti-step-model.js';
import { LTI_FAMILIES, ltiLesson, ltiFrame, hasTimeMarker } from '../../../src/signals-lti-model.js';
import { rlcH } from '../../../src/signals-freq-model.js';
import { parseCourseMath } from '../../../src/course-math-view.js';

const near = (a, b, tol = 1e-10) => assert.ok(Math.abs(a - b) <= tol, `${a} versus ${b}`);
const E = Math.exp;
const review = (extra = {}) => secondOrderStep({ a1: 3, a0: 2, b0: 1, y0: 3, dy0: 0, ...extra });
const rlc = (extra = {}) => secondOrderStep({ a1: 2, a0: 26, b0: 26, y0: 0, dy0: 0, ...extra });

test('복습 p9: y″+3y′+2y=u(t), y(0)=3, y′(0)=0 → 근 −1,−2, yₚ=1/2, c₁=5, c₂=−5/2', () => {
  const sol = review();
  assert.equal(sol.kind, 'over');
  near(sol.roots[0][0], -1); near(sol.roots[1][0], -2);
  near(sol.steady, 0.5);
  near(sol.coeffs[0], 5); near(sol.coeffs[1], -2.5);
  // 손계산: c₁+c₂=3−0.5, −c₁−2c₂=0 → c₁=5, c₂=−2.5
  for (const t of [0, 0.3, 1, 2.5, 6]) near(sol.y(t), 5 * E(-t) - 2.5 * E(-2 * t) + 0.5);
  near(sol.y(1), 2.00105899776568);
  assert.equal(sol.y(-0.1), null); // 초기값이 있는 y의 t<0 이력은 주어지지 않음
  assert.equal(sol.dy(-0.1), null);
});

test('같은 시스템의 초기 이완: s=0.5−e^(−t)+0.5e^(−2t), h=e^(−t)−e^(−2t), h 최대 1/4 at t=ln2', () => {
  const sol = review();
  for (const t of [0.05, 0.4, 1, 3, 5.5]) {
    near(sol.s(t), 0.5 - E(-t) + 0.5 * E(-2 * t));
    near(sol.h(t), E(-t) - E(-2 * t));
  }
  assert.equal(sol.s(0), 0); assert.equal(sol.h(0), 0);
  assert.equal(sol.s(-1), 0); assert.equal(sol.h(-1), 0);
  near(sol.s(30), 0.5); // s(∞)=b₀/a₀=0.5, e^(−30)≈1e−13
  near(sol.h(Math.LN2), 0.25); // h′=−e^(−t)+2e^(−2t)=0 → e^(−t)=1/2
});

test('Ex 2.19: y″+2y′+26y=26u(t) → 근 −1±j5, yₚ=1, d₁=−1, d₂=−0.2; s·h 폐형식', () => {
  const sol = rlc();
  assert.equal(sol.kind, 'under');
  near(sol.roots[0][0], -1); near(Math.abs(sol.roots[0][1]), 5);
  near(sol.steady, 1);
  near(sol.coeffs[0], -1); near(sol.coeffs[1], -0.2);
  for (const t of [0, 0.1, 0.3, 1, 2, 5]) {
    near(sol.s(t), 1 - E(-t) * (Math.cos(5 * t) + 0.2 * Math.sin(5 * t)));
    near(sol.h(t), 5.2 * E(-t) * Math.sin(5 * t));
    near(sol.y(t), sol.s(t)); // 초기값 0이면 y=s
  }
  near(sol.s(1), 0.9662002189880795);
  near(sol.h(1), -1.8343963367017915);
});

test('Ex 2.19의 h 극값: h′=5.2e^(−t)(5cos5t−sin5t)=0 → t=θ/5, (θ+π)/5, θ=atan5', () => {
  const sol = rlc();
  const theta = Math.atan(5);
  const t1 = theta / 5;
  const t2 = (theta + Math.PI) / 5;
  near(t1, 0.2746801533890032);
  near(t2, 0.9029986841069618);
  near(sol.h(t1), Math.sqrt(26) * E(-t1)); // sin(θ)=5/√26 → 5.2·5/√26=√26
  near(sol.h(t1), 3.874312065735859);
  near(sol.h(t2), -2.0668993482406526);
  // 화면 소수 4자리
  assert.match(ode2Describe('ode2-rlc', {}, t1), /h=3\.8743/);
  for (const t of [t1 - 1e-3, t1 + 1e-3]) assert.ok(sol.h(t) < sol.h(t1));
});

test('임계감쇠 (계산 전용, UI 프리셋 아님): a₁=4, a₀=4, b₀=4 → s=1−(1+2t)e^(−2t), h=4te^(−2t)', () => {
  const sol = secondOrderStep({ a1: 4, a0: 4, b0: 4 });
  assert.equal(sol.kind, 'critical');
  for (const t of [0, 0.2, 1, 3, 5]) {
    near(sol.s(t), 1 - (1 + 2 * t) * E(-2 * t));
    near(sol.h(t), 4 * t * E(-2 * t));
  }
  assert.ok(!ODE2_FAMILIES.some((f) => ODE2_PRESETS[f.value].a1 ** 2 === 4 * ODE2_PRESETS[f.value].a0));
});

test('초기값을 바꾸면 y(0)=y₀, y′(0)=v₀만 바뀌고 s·h·yₚ는 그대로', () => {
  for (const [make, base] of [[review, review()], [rlc, rlc()]]) {
    for (const y0 of [-5, 0, 5]) {
      for (const dy0 of [-5, 0, 5]) {
        const sol = make({ y0, dy0 });
        near(sol.y(0), y0);
        near(sol.dy(0), dy0);
        near(sol.steady, base.steady);
        for (const t of [0, 0.2, 1.3, 4]) { near(sol.s(t), base.s(t)); near(sol.h(t), base.h(t)); }
      }
    }
  }
});

test('미분·DE 검산: s 중앙차분 = h, y″+a₁y′+a₀y=b₀ (t=0.1~4.5)', () => {
  const d = 1e-5;
  const cases = [[{ a1: 3, a0: 2, b0: 1, y0: 3, dy0: 0 }], [{ a1: 2, a0: 26, b0: 26, y0: -2, dy0: 4 }], [{ a1: 4, a0: 4, b0: 4, y0: 1, dy0: -3 }]];
  for (const [p] of cases) {
    const sol = secondOrderStep(p);
    for (let t = 0.1; t <= 4.5 + 1e-9; t += 0.2) {
      near((sol.s(t + d) - sol.s(t - d)) / (2 * d), sol.h(t), 1e-7);
      near((sol.y(t + d) - sol.y(t - d)) / (2 * d), sol.dy(t), 1e-7);
      const ypp = (sol.dy(t + d) - sol.dy(t - d)) / (2 * d);
      near(ypp + p.a1 * sol.dy(t) + p.a0 * sol.y(t), p.b0, 1e-6);
    }
  }
});

test('시스템 이득 대조: rlcH(2,26,0).re=1=s(∞) (y″+2y′+26y=x 의 1/26 이득과 혼동하지 않음)', () => {
  near(rlcH(2, 26, 0).re, 1, 1e-12);
  near(rlc().s(40), 1, 1e-12);
  near(secondOrderStep({ a1: 2, a0: 26, b0: 1 }).s(40), 1 / 26, 1e-12);
});

test('잘못된 수치 거부: 비유한, a₁·a₀≤0, b₀<0, 범위 밖 초기값', () => {
  const ok = { a1: 3, a0: 2, b0: 1 };
  for (const bad of [{ a1: 0 }, { a1: -1 }, { a0: 0 }, { a0: 1001 }, { b0: -1 }, { b0: 1001 }, { a1: NaN }, { a0: Infinity }, { y0: 101 }, { dy0: -101 }, { y0: NaN }]) {
    assert.throws(() => secondOrderStep({ ...ok, ...bad }), RangeError, JSON.stringify(bad));
  }
  assert.doesNotThrow(() => secondOrderStep({ ...ok, b0: 0 }));
  assert.throws(() => ode2Controls('nope'), RangeError);
  assert.throws(() => ode2Frame('nope', {}, 0), RangeError);
});

test('중근 경계 양쪽 연속성: a₀=4(1±2e−10)의 과감쇠·부족감쇠가 중근 해와 1e−7 이내 (t≤5)', () => {
  const base = secondOrderStep({ a1: 4, a0: 4, b0: 4, y0: 2, dy0: -1 });
  for (const a0 of [4 * (1 - 2e-10), 4 * (1 + 2e-10), 4 * (1 - 1e-9), 4 * (1 + 1e-9)]) {
    const sol = secondOrderStep({ a1: 4, a0, b0: a0, y0: 2, dy0: -1 }); // b₀=a₀: yₚ=1로 같게
    assert.equal(sol.kind, a0 < 4 ? 'over' : 'under', `a0=${a0}`);
    for (const t of [0, 0.5, 1, 2.5, 5]) {
      near(sol.y(t), base.y(t), 1e-7);
      near(sol.s(t), base.s(t), 1e-7);
      near(sol.h(t), base.h(t), 1e-7);
    }
  }
  assert.equal(secondOrderStep({ a1: 4, a0: 4 * (1 + 5e-11), b0: 4 }).kind, 'critical'); // |Δ|≤1e−10·max(1,a₁²,4a₀)
});

test('controls·cursor: 초기값 슬라이더 두 개, 시간 표식 0~6 s / 0~5 s', () => {
  const r = ode2Controls('ode2-review');
  assert.deepEqual(r.map((c) => [c.key, c.min, c.max, c.step, c.initial]), [['y0', -5, 5, 0.5, 3], ['dy0', -5, 5, 0.5, 0]]);
  const e = ode2Controls('ode2-rlc');
  assert.deepEqual(e.map((c) => [c.key, c.initial, c.unit]), [['y0', 0, 'V'], ['dy0', 0, 'V/s']]);
  assert.deepEqual(ode2Cursor('ode2-review'), { min: 0, max: 6, step: 0.01, initial: 1, unit: 's', symbol: 't', discrete: false });
  const c = ode2Cursor('ode2-rlc');
  assert.deepEqual([c.min, c.max, c.step, c.initial], [0, 5, 0.01, 0.3]);
});

test('프레임: 두 칸 같은 x 범위·눈금, 유한 좌표, h칸 고정 축, 접선 길이 0.25 s·기울기 h', () => {
  for (const { value: family } of ODE2_FAMILIES) {
    const preset = ODE2_PRESETS[family];
    for (const params of [{}, { y0: -5, dy0: 5 }, { y0: 5, dy0: -5 }]) {
      for (const cursor of [0, 0.01, preset.cursorInitial, preset.tMax / 2, preset.tMax]) {
        const frame = ode2Frame(family, params, cursor);
        const [top, bottom] = frame.panes;
        assert.deepEqual(top.x, bottom.x);
        assert.deepEqual(top.xTicks, bottom.xTicks);
        assert.deepEqual(bottom.y, family === 'ode2-review' ? [-0.05, 0.3] : [-2.5, 4.5]);
        for (const pane of frame.panes) for (const line of pane.lines) for (const [x, y] of line.pts) assert.ok(Number.isFinite(x) && Number.isFinite(y), `${family} ${x} ${y}`);
        const seg = top.segments[0];
        near(seg.x2 - seg.x1, 0.25, 1e-12);
        assert.ok(seg.x1 >= 0 && seg.x2 <= preset.tMax + 1e-12);
        const sol = secondOrderStep({ ...preset, ...params });
        near((seg.y2 - seg.y1) / (seg.x2 - seg.x1), sol.h(cursor), 1e-10);
        near(top.dots[0].y, sol.s(cursor)); // 시각 점은 s 위
        near(bottom.dots[0].y, sol.h(cursor));
        near(top.hlines[0].y, preset.b0 / preset.a0);
      }
    }
  }
  near(ode2Frame('ode2-rlc', {}, 0).panes[1].dots[0].y, 0, 0); // t=0: 2차 h는 연속 0
  near(ode2Tangent('ode2-review', {}, 6).x1, 5.75, 1e-12); // End에서도 길이 0.25
});

test('초기값을 바꿔도 h 곡선 좌표는 완전히 같고, s 점선은 초기값이 0이 아닐 때만', () => {
  const a = ode2Frame('ode2-review', { y0: 3, dy0: 0 }, 1);
  const b = ode2Frame('ode2-review', { y0: -2, dy0: 4.5 }, 1);
  assert.deepEqual(a.panes[1].lines, b.panes[1].lines);
  assert.notDeepEqual(a.panes[0].lines[0].pts, b.panes[0].lines[0].pts);
  assert.equal(a.panes[0].lines.length, 2); // y와 초기 이완 s
  assert.equal(ode2Frame('ode2-review', { y0: 0, dy0: 0 }, 1).panes[0].lines.length, 1);
  assert.ok(a.legend.some((l) => /초기 이완 s의 접선/.test(l.text)));
});

test('읽기·수식: p9 계수 결정식과 Ex 2.19 d₁·d₂, s·h 해석식', () => {
  const p9 = ode2Formula('ode2-review', {});
  for (const part of ['c₁+c₂=3−0.5=2.5', '−c₁−2c₂=0', 'c₁=5,c₂=−2.5', 's(t)=0.5−e^(−t)+0.5e^(−2t)', 'h(t)=ds/dt=e^(−t)−e^(−2t)']) assert.ok(p9.includes(part), part);
  const ex = ode2Formula('ode2-rlc', {});
  // Ex 2.19: y(0)=0, y′(0)=0, yₚ=1, σ=−1, β=5 → d₁=0−1=−1, d₂=(0−(−1)(−1))/5=−0.2. 값은 한 번만 적는다(같은 줄 반복 없음).
  for (const part of ['d₁=y(0)−yₚ=−1, d₂=(y′(0)−σd₁)/β=−0.2', 's(t)=1−e^(−t)[cos(5t)+0.2sin(5t)]', 'h(t)=ds/dt=5.2e^(−t)sin(5t)']) assert.ok(ex.includes(part), part);
  assert.equal(ex.split('; ').filter((l) => l.startsWith('d₁=')).length, 1);
  for (const formula of [p9, ex]) for (const part of formula.split(';').map((s) => s.trim())) assert.ok(parseCourseMath(part), part); // 수식 칸에 글로 떨어지는 줄 없음
  assert.match(ode2Describe('ode2-review', {}, 1), /y=2\.0011/);
  for (const { value } of ODE2_FAMILIES) {
    const text = ode2Read(value);
    assert.match(text, /[가-힣]/);
    assert.ok(text.length > 20 && text.length < 160);
  }
});

test('LTI 레슨 연결: 새 두 예시와 RC 계단응답만 시간 표식, 위임 결과가 같음', () => {
  const values = LTI_FAMILIES.map((f) => f.value);
  assert.ok(values.includes('ode2-review') && values.includes('ode2-rlc'));
  assert.equal(ltiLesson.initialFamily, 'step');
  for (const v of values) assert.equal(hasTimeMarker(v), v === 'step' || v.startsWith('ode2-'), v);
  assert.deepEqual(ltiLesson.cursor('ode2-rlc', {}), ode2Cursor('ode2-rlc'));
  assert.deepEqual(ltiFrame('ode2-review', { y0: 1, dy0: 2 }, 0.5), ode2Frame('ode2-review', { y0: 1, dy0: 2 }, 0.5));
  assert.equal(ltiLesson.formula('ode2-rlc', {}), ode2Formula('ode2-rlc', {}));
  assert.equal(ltiLesson.cursor('nat-a', {}), null);
});
