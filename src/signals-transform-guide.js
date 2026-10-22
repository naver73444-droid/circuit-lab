// Guided mode ("따라가기") of the Fourier transform lesson (pure, no DOM): five short steps in the order of the course
// (week 6, Ch 04-2): the periodic extension turning into one pulse, the pulse itself (Ex 4.12), a shift that only turns the
// phase (Ex 4.13), the impulse limit (Ex 4.14) and the one-/two-sided exponential (Ex 4.15, 4.16).
// Every step names its sliders, quick presets, the frame for signals-panes-view, a plain-language read-out and the formula
// with the current numbers filled in. Values stay in seconds and Hz inside; the axis choice only relabels (ω = 2πf).
// Course convention: X(ω) = ∫ x(t) e^{−jωt} dt, X(f) = X(ω) at ω = 2πf, sinc(u) = sin(πu)/(πu).
import { breakWraps, formatNumber, formatQuantity, jumpList, midpointRect, niceTicks, sampleCurve } from './signals-util.js';
import { axisSymbol, axisUnit, choiceControl, freqAxisControl, isOmega, toAxis } from './signals-axis.js';

const TAU = 2 * Math.PI;
export const sinc = (u) => (Math.abs(u) < 1e-12 ? 1 : Math.sin(Math.PI * u) / (Math.PI * u));

// Step 1 uses the numbers of the course figure: one pulse of height 1 and width 0.1 s, repeated every T0.
export const TRAIN = { A: 1, tau: 0.1, freqSpan: 30, timeSpan: 1.2 };
// Step 3 shifts a fixed pulse (A = 1, width 1 s).
export const SHIFTED = { A: 1, tau: 1 };
// Step 5 draws the exponentials on |ω| <= 10 rad/s so that the corner ω = a (0.25 ... 4) is always inside.
export const EXP_OMEGA_SPAN = 10;

// short: the step bar's label; tiny: the one-word label of a phone, where the five buttons share one line.
export const GUIDE_STEPS = [
  { id: 'train', title: '① 펄스열에서 펄스 하나로', short: '① 급수→변환', tiny: '① 급수' },
  { id: 'pulse', title: '② 펄스 하나: 넓이와 폭 (Ex 4.12)', short: '② 넓이·폭', tiny: '② 넓이' },
  { id: 'shift', title: '③ 옮기면 위상만 바뀜 (Ex 4.13)', short: '③ 이동·위상', tiny: '③ 이동' },
  { id: 'impulse', title: '④ 폭을 0으로: δ(t) ↔ 1 (Ex 4.14)', short: '④ 임펄스', tiny: '④ 임펄스' },
  { id: 'exp', title: '⑤ 지수 신호: 복소수와 실수 (Ex 4.15·4.16)', short: '⑤ 지수', tiny: '⑤ 지수' },
];
export const guideStepIndex = (id) => GUIDE_STEPS.findIndex((s) => s.id === id);

const SHAPES = [{ value: 0, label: '한쪽 e^(−at)u(t)' }, { value: 1, label: '양쪽 e^(−a|t|)' }];

// ---------------------------------------------------------------- controls and presets
export function guideControls(stepId, params = {}) {
  const axis = freqAxisControl(0);
  if (stepId === 'train') return [{ key: 'T0', label: 'T₀ 주기', min: 0.2, max: 4, step: 0.05, initial: 0.25, unit: 's' }, axis];
  if (stepId === 'pulse') {
    return [
      { key: 'T', label: 'τ 폭', min: 0.25, max: 4, step: 0.05, initial: 1, unit: 's' },
      { key: 'A', label: 'A 높이', min: 0.25, max: 4, step: 0.25, initial: 1, unit: '' }, axis,
    ];
  }
  if (stepId === 'shift') return [{ key: 't0', label: 't₀ 이동', min: -2, max: 2, step: 0.05, initial: 0.5, unit: 's' }, axis];
  if (stepId === 'impulse') return [{ key: 'a', label: 'a 폭 (넓이 1)', min: 0.05, max: 2, step: 0.05, initial: 1, unit: 's' }, axis];
  if (stepId === 'exp') {
    return [
      choiceControl('shape', '모양', SHAPES, 0),
      { key: 'a', label: 'a 감쇠', min: 0.25, max: 4, step: 0.05, initial: 1, unit: '1/s' }, axis,
    ];
  }
  throw new RangeError(`따라가기 단계가 아닙니다: ${stepId}`);
}

// Initial values of a step; the frequency axis carries over from the step the learner comes from.
export function guideDefaults(stepId, axis = 0) {
  const params = Object.fromEntries(guideControls(stepId).map((c) => [c.key, c.initial]));
  params.axis = axis === 1 ? 1 : 0;
  return params;
}

// Quick presets ("해 보기" buttons): the course values of each example.
export function guideChips(stepId) {
  if (stepId === 'train') return [0.25, 0.5, 1, 2].map((T0) => ({ label: `T₀ = ${formatNumber(T0)} s`, params: { T0 } }));
  if (stepId === 'pulse') {
    return [[1, 1], [2, 0.5], [0.5, 2]].map(([A, T]) => ({ label: `높이 ${formatNumber(A)} · 폭 ${formatNumber(T)}`, params: { A, T } }));
  }
  if (stepId === 'shift') {
    return [
      { label: '0<t<τ 로 (t₀ = τ/2)', params: { t0: 0.5 } },
      { label: '가운데 (t₀ = 0)', params: { t0: 0 } },
      { label: '왼쪽 (t₀ = −1.5)', params: { t0: -1.5 } },
    ];
  }
  if (stepId === 'impulse') return [2, 1, 0.2, 0.1].map((a) => ({ label: `a = ${formatNumber(a)} s`, params: { a } }));
  if (stepId === 'exp') {
    return [
      { label: '한쪽 · a = 1', params: { shape: 0, a: 1 } },
      { label: '양쪽 · a = 1', params: { shape: 1, a: 1 } },
      { label: '한쪽 · a = 3', params: { shape: 0, a: 3 } },
    ];
  }
  return [];
}

// Which slider a drag in the time pane moves (only the shift step).
export const guideDragKey = (stepId) => (stepId === 'shift' ? 't0' : null);

// ---------------------------------------------------------------- spectra (f in Hz)
// Step 1: weight of the k-th line, T0·c_k = A·tau·sinc(k f0 tau) (c_k of the pulse train, Ex 4.7 with d = tau/T0).
export const trainLine = (T0, k) => TRAIN.A * TRAIN.tau * sinc((k * TRAIN.tau) / T0);
export const trainEnvelope = (f) => TRAIN.A * TRAIN.tau * sinc(f * TRAIN.tau);

// Lines strictly inside the main lobe |f| < 1/tau: |k| < T0/tau.
export function linesInMainLobe(T0) {
  const m = T0 / TRAIN.tau;
  return 2 * Math.ceil(m - 1e-9) - 1;
}

// Complex X(f) of the guided signals.
export function guideSpectrum(stepId, raw, f) {
  const p = { ...guideDefaults(stepId), ...raw };
  if (stepId === 'train') return { re: trainEnvelope(f), im: 0 };
  if (stepId === 'pulse') return { re: p.A * p.T * sinc(f * p.T), im: 0 };
  if (stepId === 'shift') {
    const real = SHIFTED.A * SHIFTED.tau * sinc(f * SHIFTED.tau);
    const angle = -TAU * f * p.t0;
    return { re: real * Math.cos(angle), im: real * Math.sin(angle) };
  }
  if (stepId === 'impulse') return { re: sinc(f * p.a), im: 0 };
  if (stepId === 'exp') {
    const w = TAU * f;
    const den = p.a * p.a + w * w;
    return p.shape === 1 ? { re: (2 * p.a) / den, im: 0 } : { re: p.a / den, im: -w / den };
  }
  throw new RangeError(`따라가기 단계가 아닙니다: ${stepId}`);
}

function guideSignal(stepId, p, t) {
  if (stepId === 'train') {
    const m = Math.round(t / p.T0);
    return TRAIN.A * midpointRect(t - m * p.T0, -TRAIN.tau / 2, TRAIN.tau / 2);
  }
  if (stepId === 'pulse') return p.A * midpointRect(t, -p.T / 2, p.T / 2);
  if (stepId === 'shift') return SHIFTED.A * midpointRect(t, p.t0 - SHIFTED.tau / 2, p.t0 + SHIFTED.tau / 2);
  if (stepId === 'impulse') return midpointRect(t, -p.a / 2, p.a / 2) / p.a;
  if (p.shape === 1) return Math.exp(-p.a * Math.abs(t));
  return t < 0 ? 0 : t === 0 ? 0.5 : Math.exp(-p.a * t);
}

function guideEdges(stepId, p, lo, hi) {
  if (stepId === 'train') {
    const edges = [];
    for (let m = Math.floor(lo / p.T0) - 1; m <= Math.ceil(hi / p.T0) + 1; m++) edges.push(m * p.T0 - TRAIN.tau / 2, m * p.T0 + TRAIN.tau / 2);
    return edges;
  }
  if (stepId === 'pulse') return [-p.T / 2, p.T / 2];
  if (stepId === 'shift') return [p.t0 - SHIFTED.tau / 2, p.t0 + SHIFTED.tau / 2];
  if (stepId === 'impulse') return [-p.a / 2, p.a / 2];
  return [0]; // the jump of u(t) (one-sided) or the kink of e^(-a|t|) (two-sided)
}

const TIME_RANGES = { train: [-TRAIN.timeSpan, TRAIN.timeSpan], pulse: [-4, 4], shift: [-4, 4], impulse: [-2.5, 2.5], exp: [-4, 4] };
// Frequency windows in Hz (fixed per step so that a narrower signal visibly widens its spectrum).
const FREQ_RANGES = { train: [-TRAIN.freqSpan, TRAIN.freqSpan], pulse: [-4, 4], shift: [-4, 4], impulse: [-5, 5], exp: [-EXP_OMEGA_SPAN / TAU, EXP_OMEGA_SPAN / TAU] };

const PHASE_TICKS = [{ value: -Math.PI, label: '−π' }, { value: 0, label: '0' }, { value: Math.PI, label: 'π' }];
const PHASE_FLOOR = 0.02; // phase is hidden where |X| < 2 % of its peak (same rule as the free lesson)
const tick = (value) => Number(value.toPrecision(3));

function timePane(stepId, p, top, title, extra = {}) {
  const [lo, hi] = TIME_RANGES[stepId];
  const count = stepId === 'train' ? 1400 : 700;
  const fn = (t) => guideSignal(stepId, p, t);
  const edges = guideEdges(stepId, p, lo, hi);
  const curve = sampleCurve(fn, lo, hi, count, edges, { gaps: true });
  return {
    title, x: [lo, hi], y: [-0.25 * top, 1.4 * top], xTicks: niceTicks(lo, hi, 4), yTicks: [0, tick(top)],
    areas: [{ cls: 'c1', pts: curve }], lines: [{ cls: 'c1', pts: curve }],
    jumps: [{ cls: 'c1', list: jumpList(fn, edges, lo, hi) }],
    ...extra,
  };
}

function freqWindow(stepId, axis) {
  const [lo, hi] = FREQ_RANGES[stepId];
  const x = [toAxis(lo, axis), toAxis(hi, axis)];
  return { lo, hi, x, xTicks: niceTicks(x[0], x[1], 4) };
}

function sampleSpectrum(stepId, p, part, count = 700) {
  const { lo, hi } = freqWindow(stepId, p.axis);
  const pts = [];
  for (let i = 0; i < count; i++) {
    const f = lo + ((hi - lo) * i) / (count - 1);
    const v = guideSpectrum(stepId, p, f);
    pts.push([toAxis(f, p.axis), part(v, f)]);
  }
  return pts;
}

// ---------------------------------------------------------------- frames for signals-panes-view
export function guideFrame(stepId, raw) {
  const p = { ...guideDefaults(stepId), ...raw };
  const axis = p.axis;
  const sym = axisSymbol(axis);
  const unit = axisUnit(axis);
  const win = freqWindow(stepId, axis);

  if (stepId === 'train') {
    const peak = TRAIN.A * TRAIN.tau;
    const K = Math.floor((TRAIN.freqSpan * p.T0) + 1e-9);
    const stems = [];
    for (let k = -K; k <= K; k++) stems.push([toAxis(k / p.T0, axis), trainLine(p.T0, k)]);
    const zero = toAxis(1 / TRAIN.tau, axis);
    return {
      split: true,
      panes: [
        timePane('train', p, TRAIN.A, `x̃(t): 폭 τ=0.1 s 펄스를 T₀마다 반복 · t [s]`),
        {
          title: `T₀·c_k (선)와 X(${sym})=Aτ·sinc (점선) · ${sym} [${unit}]`, x: win.x, y: [-0.3 * peak, 1.3 * peak], xTicks: win.xTicks, yTicks: [0, tick(peak)],
          stems: [{ cls: 'c2', pts: stems }],
          lines: [{ cls: 'c4 dash', pts: sampleSpectrum('train', p, (v) => v.re) }],
          texts: [
            { cls: 'c4', x: zero, y: 0, text: isOmega(axis) ? '2π/τ' : '1/τ', dy: -8 },
            { cls: 'c4', x: -zero, y: 0, text: isOmega(axis) ? '−2π/τ' : '−1/τ', dy: -8 },
          ],
        },
      ],
      legend: [{ cls: 'c1', text: 'x̃(t) 펄스열' }, { cls: 'c2', text: 'T₀·c_k 선 스펙트럼' }, { cls: 'c4 dash', text: `X(${sym}) 펄스 하나의 변환` }],
    };
  }

  if (stepId === 'pulse') {
    const peak = p.A * p.T;
    const zero = 1 / p.T;
    const spectrum = sampleSpectrum('pulse', p, (v) => v.re);
    const texts = [{ cls: 'c4', x: 0, y: peak, text: `X(0) = Aτ = ${formatNumber(peak)}`, dy: -8 }];
    if (zero <= FREQ_RANGES.pulse[1] + 1e-9) texts.push({ cls: 'cm', x: toAxis(zero, axis), y: 0, text: isOmega(axis) ? '2π/τ' : '1/τ', dy: 16 });
    return {
      split: true,
      panes: [
        timePane('pulse', p, Math.max(p.A, 0.5), 'x(t) = AΠ(t/τ) · t [s]', {
          texts: [{ cls: 'c1', x: 0, y: p.A, text: `넓이 Aτ = ${formatNumber(peak)}`, dy: -8 }], // above the top edge: a narrow pulse on a phone cannot hold the label
        }),
        {
          title: `X(${sym}) = Aτ·sinc — 실수 (음수 구간도 그대로) · ${sym} [${unit}]`, x: win.x, y: [-0.3 * peak, 1.32 * peak], xTicks: win.xTicks, yTicks: [0, tick(peak)],
          areas: [{ cls: 'c2', pts: spectrum }], lines: [{ cls: 'c2', pts: spectrum }],
          dots: [{ cls: 'c4', x: 0, y: peak }],
          texts,
        },
      ],
      legend: [{ cls: 'c1', text: 'x(t) 펄스 하나' }, { cls: 'c2', text: `X(${sym}) 스펙트럼` }, { cls: 'c4 mk', text: 'X(0) = 넓이' }],
    };
  }

  if (stepId === 'shift') {
    const peak = SHIFTED.A * SHIFTED.tau;
    const magnitude = sampleSpectrum('shift', p, (v) => Math.hypot(v.re, v.im));
    const phase = breakWraps(sampleSpectrum('shift', p, (v) => (Math.hypot(v.re, v.im) > PHASE_FLOOR * peak ? Math.atan2(v.im, v.re) : null)));
    // The straight line beta(f) = -2 pi f t0 near the origin, where it is still inside (-pi, pi).
    const reach = Math.abs(p.t0) > 1e-9 ? Math.min(win.hi, 1 / (2 * Math.abs(p.t0))) : win.hi;
    const line = [[toAxis(-reach, axis), TAU * reach * p.t0], [toAxis(reach, axis), -TAU * reach * p.t0]];
    return {
      split: true,
      panes: [
        timePane('shift', p, SHIFTED.A, 'x(t − t₀): 폭 1 s 펄스를 t₀만큼 이동 · t [s]', {
          y: [-0.25 * SHIFTED.A, 1.75 * SHIFTED.A], // extra headroom: the t₀ arrow and its label stay clear of the pane title on a phone
          segments: Math.abs(p.t0) > 0.04 ? [{ cls: 'c4', x1: 0, y1: 1.2, x2: p.t0, y2: 1.2 }] : [],
          texts: [{ cls: 'c4', x: p.t0 / 2, y: 1.2, text: `t₀ = ${formatQuantity(p.t0, 's')}`, dy: -6 }],
        }),
        {
          title: `|X(${sym})| = Aτ|sinc| — t₀와 상관없이 그대로 · ${sym} [${unit}]`, x: win.x, y: [-0.08 * peak, 1.3 * peak], xTicks: win.xTicks, yTicks: [0, tick(peak)],
          areas: [{ cls: 'c2', pts: magnitude }], lines: [{ cls: 'c2', pts: magnitude }],
        },
        {
          title: `θ(${sym}) [rad]: 점선 = 직선 β, 실선 = θ (−π~π로 접힘)`, x: win.x, y: [-Math.PI * 1.15, Math.PI * 1.15], xTicks: win.xTicks, yTicks: PHASE_TICKS,
          lines: [{ cls: 'c4 dash', pts: line }, { cls: 'c3 thin', pts: phase }],
        },
      ],
      legend: [
        { cls: 'c1', text: 'x(t − t₀)' }, { cls: 'c2', text: `|X(${sym})| 크기` }, { cls: 'c3', text: 'θ 위상 (접힘)' },
        { cls: 'c4 dash', text: isOmega(axis) ? 'β = −ω t₀ 직선' : 'β = −2πf t₀ 직선' },
      ],
    };
  }

  if (stepId === 'impulse') {
    const top = 1 / p.a;
    const spectrum = sampleSpectrum('impulse', p, (v) => v.re);
    const zero = 1 / p.a;
    const texts = zero <= FREQ_RANGES.impulse[1] + 1e-9 ? [{ cls: 'cm', x: toAxis(zero, axis), y: 0, text: isOmega(axis) ? '2π/a' : '1/a', dy: 16 }] : [];
    return {
      split: true,
      panes: [
        timePane('impulse', p, top, 'q_a(t) = (1/a)Π(t/a): 넓이는 항상 1 · t [s]', {
          texts: [{ cls: 'c1', x: 0, y: top, text: `높이 1/a = ${formatNumber(top)}`, dy: -8 }], // above the top edge, like step ②: beside the pulse it ran into the edge on a phone
        }),
        {
          title: `Q(${sym}) = sinc(fa) · ${sym} [${unit}]`, x: win.x, y: [-0.3, 1.32], xTicks: win.xTicks, yTicks: [0, 1],
          areas: [{ cls: 'c2', pts: spectrum }], lines: [{ cls: 'c2', pts: spectrum }], hlines: [{ cls: 'cm dash', y: 1 }],
          texts,
        },
      ],
      legend: [{ cls: 'c1', text: 'q_a(t) 넓이 1 펄스' }, { cls: 'c2', text: `Q(${sym}) 스펙트럼` }, { cls: 'cm dash', text: '1 (임펄스의 스펙트럼)' }],
    };
  }

  // exp
  const twoSided = p.shape === 1;
  const peak = twoSided ? 2 / p.a : 1 / p.a;
  const re = sampleSpectrum('exp', p, (v) => v.re);
  const im = sampleSpectrum('exp', p, (v) => v.im);
  const corner = toAxis(p.a / TAU, axis); // ω = a
  return {
    split: true,
    panes: [
      timePane('exp', p, 1, twoSided ? 'x(t) = e^(−a|t|): 좌우 대칭 · t [s]' : 'x(t) = e^(−at)u(t): 한쪽으로 치우침 · t [s]'),
      {
        title: `X(${sym}): 실수부(실선)·허수부(점선) · ${sym} [${unit}]`, x: [toAxis(FREQ_RANGES.exp[0], axis), toAxis(FREQ_RANGES.exp[1], axis)],
        y: [-0.7 * (1 / p.a), 1.3 * peak], xTicks: win.xTicks, yTicks: [0, tick(peak)],
        lines: [{ cls: 'c2', pts: re }, { cls: 'c4 dash', pts: im }],
        vlines: [{ cls: 'cm dash', x: corner }, { cls: 'cm dash', x: -corner }],
        texts: [{ cls: 'cm', x: corner, y: 1.3 * peak, text: isOmega(axis) ? 'ω = a' : 'f = a/2π', dy: 14 }],
      },
    ],
    legend: [{ cls: 'c1', text: 'x(t)' }, { cls: 'c2', text: '실수부 Re X' }, { cls: 'c4 dash', text: twoSided ? '허수부 Im X = 0' : '허수부 Im X' }, { cls: 'cm dash', text: isOmega(axis) ? 'ω = ±a' : 'f = ±a/2π' }],
  };
}

// ---------------------------------------------------------------- words
const BODIES = {
  train: '주기 신호는 선 스펙트럼(푸리에 급수), 펄스 하나는 연속 스펙트럼(푸리에 변환)입니다. 펄스열의 주기 T₀를 늘리면 선 간격 f₀=1/T₀가 좁아지는데, 선 높이에 T₀를 곱한 T₀·c_k는 늘 같은 점선 위에 놓입니다. T₀→∞이면 선이 빈틈없이 차서 점선 X(f) 자체가 됩니다.',
  pulse: '펄스 하나의 푸리에 변환은 sinc 모양의 실수 함수입니다. f=0에서의 높이 X(0)는 펄스의 넓이 Aτ와 같고, 첫 영점은 1/τ에 있습니다. 그래서 시간에서 좁은 펄스일수록 주파수에서는 넓게 퍼집니다.',
  shift: '펄스를 t₀만큼 옮겨도 크기 |X|는 바뀌지 않고, 위상의 직선 부분 β(f)=−2πf·t₀만 주파수에 비례해 기울어집니다. sinc가 음수인 구간에서는 θ(f)=β(f)±π가 되고(교재 오류로 표시된 부분), −π~π로 접어서 그리기 때문에 위상 그래프가 톱니처럼 보입니다.',
  impulse: '넓이를 1로 유지한 채 폭 a를 줄이면 펄스는 점점 높고 좁아져 임펄스 δ(t)가 됩니다. 스펙트럼 sinc(fa)의 첫 영점 1/a는 바깥으로 밀려나서, a→0이면 모든 주파수에서 1인 평평한 스펙트럼이 됩니다.',
  exp: {
    0: 'e^(−at)u(t)처럼 한쪽으로 치우친 신호의 변환은 복소수입니다. 실수부는 좌우 대칭(우함수), 허수부는 반대칭(기함수)이고, ω=a에서 크기가 X(0)의 1/√2, 위상이 −π/4입니다. RC 저역통과 H(ω)=1/(1+jωRC)와 같은 모양이라 다음 레슨 "주파수 응답"으로 이어집니다.',
    1: 'e^(−a|t|)처럼 좌우 대칭인 신호는 허수부가 사라져 변환이 순실수입니다: X(ω)=2a/(a²+ω²). 한쪽 지수와 비교하면 시간에서의 대칭이 주파수에서 "실수냐 복소수냐"를 정한다는 것을 볼 수 있습니다.',
  },
};
const TRIES = {
  train: 'T₀를 0.25 s에서 2 s 쪽으로 늘려 보세요. 영점(1/τ=10 Hz)은 그대로이고 선만 촘촘해집니다.',
  pulse: '넓이를 1로 둔 세 경우를 눌러 비교해 보세요. X(0)는 그대로이고 영점만 움직입니다.',
  shift: '시간 그래프의 펄스를 끌거나 t₀를 움직여 보세요. 위쪽 크기 그래프는 꿈쩍도 하지 않습니다.',
  impulse: 'a를 2 → 1 → 0.2 → 0.1 순서로 줄여 보세요.',
  exp: '모양을 "양쪽"으로 바꿔 허수부(점선)가 사라지는 것을 보고, a를 키워 시간과 주파수 폭을 비교해 보세요.',
};

export function guideText(stepId, raw = {}) {
  const p = { ...guideDefaults(stepId), ...raw };
  const body = stepId === 'exp' ? BODIES.exp[p.shape === 1 ? 1 : 0] : BODIES[stepId];
  return { body, tryText: TRIES[stepId] };
}

// One plain-language line about what is on screen right now.
export function guideObserve(stepId, raw = {}) {
  const p = { ...guideDefaults(stepId), ...raw };
  const axis = p.axis;
  const freq = (hz) => `${formatNumber(toAxis(hz, axis))} ${axisUnit(axis)}`;
  if (stepId === 'train') {
    const lines = linesInMainLobe(p.T0);
    return `T₀ = ${formatQuantity(p.T0, 's')} → 선 간격 ${isOmega(axis) ? 'ω₀' : 'f₀'} = ${freq(1 / p.T0)}, 첫 영점 ${freq(1 / TRAIN.tau)} 안쪽에 선 ${lines}개. 선 높이 T₀·c_k는 점선을 벗어나지 않습니다.`;
  }
  if (stepId === 'pulse') {
    return `넓이 Aτ = ${formatNumber(p.A * p.T)} → X(0) = ${formatNumber(p.A * p.T)}. 첫 영점 ±${freq(1 / p.T)}${1 / p.T > FREQ_RANGES.pulse[1] + 1e-9 ? '(화면 밖)' : ''}: 폭을 반으로 줄이면 영점이 두 배 바깥으로 갑니다.`;
  }
  if (stepId === 'shift') {
    const slope = -TAU * p.t0;
    const slopeText = isOmega(axis) ? `−t₀ = ${formatNumber(-p.t0)} s` : `−2πt₀ = ${formatNumber(slope)} rad/Hz`;
    return Math.abs(p.t0) < 1e-9
      ? '가운데 놓인 펄스는 우함수라 위상이 0 또는 ±π(sinc가 음수인 구간)뿐입니다. 이제 옮겨 보세요.'
      : `t₀ = ${formatQuantity(p.t0, 's')}: |X|는 그대로, 직선 β의 기울기 ${slopeText}. 위상이 ±π를 넘을 때마다 접혀서 톱니가 됩니다.`;
  }
  if (stepId === 'impulse') {
    const zero = 1 / p.a;
    const flat = zero > FREQ_RANGES.impulse[1];
    return `a = ${formatQuantity(p.a, 's')} → 높이 ${formatNumber(1 / p.a)}, 첫 영점 ${freq(zero)}${flat ? ': 이 화면 안에서는 거의 평평한 1입니다' : ''}.`;
  }
  const corner = isOmega(axis) ? `ω = a = ${formatNumber(p.a)} rad/s` : `f = a/2π = ${formatNumber(p.a / TAU)} Hz`;
  if (p.shape === 1) return `순실수: 허수부 0. X(0) = 2/a = ${formatNumber(2 / p.a)}, ${corner}에서 X = 1/a = ${formatNumber(1 / p.a)} (절반).`;
  return `복소수: X(0) = 1/a = ${formatNumber(1 / p.a)}, ${corner}에서 |X| = ${formatNumber(1 / (Math.SQRT2 * p.a))} (1/√2배), 위상 −π/4. 허수부 극값 ∓1/(2a) = ∓${formatNumber(1 / (2 * p.a))}.`;
}

// An angle as a multiple of π ("0", "π", "−1.5π").
function piText(angle, n) {
  const k = angle / Math.PI;
  if (Math.abs(k) < 1e-9) return '0';
  if (Math.abs(Math.abs(k) - 1) < 1e-9) return k > 0 ? 'π' : '−π';
  return `${n(k)}π`;
}

// The formula with the current numbers: math lines (parsed by course-math-view) and Korean "지금" lines (shown as prose).
export function guideFormula(stepId, raw = {}) {
  const p = { ...guideDefaults(stepId), ...raw };
  const w = isOmega(p.axis);
  const n = (v) => formatNumber(v);
  if (stepId === 'train') {
    return [
      w ? 'c_k·T₀ = Aτ·sinc(kω₀τ/(2π))' : 'c_k·T₀ = Aτ·sinc(k f₀ τ)',
      w ? 'T₀ → ∞: T₀·c_k → X(ω) = Aτ·sinc(ωτ/(2π))' : 'T₀ → ∞: T₀·c_k → X(f) = Aτ·sinc(fτ)',
      w ? `지금: ω₀ = 2π/T₀ = ${n(TAU / p.T0)} rad/s, 첫 영점 2π/τ = ${n(TAU / TRAIN.tau)} rad/s, Aτ = 0.1`
        : `지금: f₀ = 1/T₀ = ${n(1 / p.T0)} Hz, 첫 영점 1/τ = 10 Hz, Aτ = 0.1`,
    ].join('\n');
  }
  if (stepId === 'pulse') {
    return [
      w ? 'X(ω) = ∫x(t)e^(−jωt)dt = Aτ·sinc(ωτ/(2π))' : 'X(f) = ∫x(t)e^(−j2πft)dt = Aτ·sinc(fτ)',
      `X(0) = Aτ = ${n(p.A)}·${n(p.T)} = ${n(p.A * p.T)}`,
      w ? `지금: 첫 영점 ω = 2π/τ = ${n(TAU / p.T)} rad/s` : `지금: 첫 영점 f = 1/τ = ${n(1 / p.T)} Hz`,
    ].join('\n');
  }
  if (stepId === 'shift') {
    // Two sample frequencies for the "지금" line: one in the main lobe (sinc > 0), one in the first negative lobe.
    const sample = (hz) => {
      const v = guideSpectrum('shift', p, hz);
      let theta = Math.atan2(v.im, v.re);
      if (theta <= -Math.PI + 1e-12) theta += TAU; // atan2 may give −π; the drawn phase lives in (−π, π]
      return `${w ? `ω = ${piText(TAU * hz, n)} rad/s` : `f = ${n(hz)} Hz`}에서 β = ${piText(-TAU * hz * p.t0, n)}, θ = ${piText(theta, n)}`;
    };
    return [
      w ? 'x(t − t₀) ↔ X(ω)·e^(−jωt₀)' : 'x(t − t₀) ↔ X(f)·e^(−j2πft₀)',
      w ? '|X(ω)| = Aτ·|sinc(ωτ/(2π))|' : '|X(f)| = Aτ·|sinc(fτ)|',
      // beta is the straight (dashed) line; theta is the drawn phase: beta (plus pi where the sinc is negative), folded into (-pi, pi]
      w ? 'β(ω) = −ω t₀' : 'β(f) = −2πf t₀',
      w ? 'sinc(ωτ/(2π)) > 0: θ(ω) = wrap(β(ω))' : 'sinc(fτ) > 0: θ(f) = wrap(β(f))',
      w ? 'sinc(ωτ/(2π)) < 0: θ(ω) = wrap(β(ω) ± π)' : 'sinc(fτ) < 0: θ(f) = wrap(β(f) ± π)',
      'wrap(φ) = φ + 2πm, −π < wrap(φ) ≤ π',
      w
        ? `지금: t₀ = ${n(p.t0)} s → β 기울기 −t₀ = ${n(-p.t0)} s, sinc < 0인 구간 ${n(TAU / SHIFTED.tau)}~${n(2 * TAU / SHIFTED.tau)} rad/s 등. 예: ${sample(0.75)} · ${sample(1.5)}`
        : `지금: t₀ = ${n(p.t0)} s → β 기울기 −2πt₀ = ${n(-TAU * p.t0)} rad/Hz, sinc < 0인 구간 ${n(1 / SHIFTED.tau)}~${n(2 / SHIFTED.tau)} Hz 등. 예: ${sample(0.75)} · ${sample(1.5)}`,
    ].join('\n');
  }
  if (stepId === 'impulse') {
    return [
      w ? 'q_a(t) = (1/a)Π(t/a) ↔ Q(ω) = sinc(ωa/(2π))' : 'q_a(t) = (1/a)Π(t/a) ↔ Q(f) = sinc(fa)',
      'a → 0: δ(t) ↔ 1',
      w ? `지금: a = ${n(p.a)} s → 첫 영점 2π/a = ${n(TAU / p.a)} rad/s` : `지금: a = ${n(p.a)} s → 첫 영점 1/a = ${n(1 / p.a)} Hz`,
    ].join('\n');
  }
  if (p.shape === 1) {
    return [
      w ? 'X(ω) = 2a/(a² + ω²)' : 'X(f) = 2a/(a² + (2πf)²)',
      'Im X = 0',
      `지금: a = ${n(p.a)} → X(0) = 2/a = ${n(2 / p.a)}, ω = a에서 1/a = ${n(1 / p.a)}`,
    ].join('\n');
  }
  return [
    w ? 'X(ω) = 1/(a + jω) = (a − jω)/(a² + ω²)' : 'X(f) = 1/(a + j2πf) = (a − j2πf)/(a² + (2πf)²)',
    w ? '|X(ω)| = 1/√(a² + ω²), θ(ω) = −tan⁻¹(ω/a)' : '|X(f)| = 1/√(a² + (2πf)²), θ(f) = −tan⁻¹(2πf/a)',
    `지금: a = ${n(p.a)} → X(0) = 1/a = ${n(1 / p.a)}, ω = a에서 |X| = ${n(1 / (Math.SQRT2 * p.a))}, θ = −π/4`,
  ].join('\n');
}

// What the controller needs from a lesson's guide.
export const TRANSFORM_GUIDE = {
  steps: GUIDE_STEPS,
  controls: guideControls,
  defaults: guideDefaults,
  chips: guideChips,
  frame: guideFrame,
  text: guideText,
  observe: guideObserve,
  formula: guideFormula,
  dragKey: guideDragKey,
};
