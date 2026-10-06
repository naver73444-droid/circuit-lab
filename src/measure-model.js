/**
 * 파형 자동 측정 모델 (순수 함수, DOM 없음).
 *
 * 모든 값은 solver가 낸 "원 표본(raw samples)" 기준입니다. 보간은 아래 항목에서만 쓰고
 * 각 항목의 note에 명시합니다.
 *   - 주기/주파수: 교차 시각을 인접 표본 사이 선형보간(기본은 상승 교차, 상승 교차가 부족하고 하강 교차가 더 많으면 하강 교차 — 3주기 창처럼 시작점이 기준 수준에 걸린 경우). 누락 구간(gap)을 사이에 둔 교차·주기는 이어 붙이지 않고,
 *     한 연속 구간 안에서 완전한 주기가 2개 이상 있는 경우(가장 많은 구간)만 측정한다.
 *   - 상승시간: 10%·90% 교차점을 인접 표본 사이 선형보간
 *   - −3 dB 주파수: log10(f)–dB 선형보간(모든 주파수가 0보다 커야 하며, 교차 구간이 누락 구간에 걸치면 측정 불가)
 * 유한하지 않은 표본(NaN/±Infinity/null)은 "빈 구간"으로 취급하며 그 구간은 적분하거나
 * 선을 이어 보간하지 않습니다.
 */
import { engineering } from "./scope-model.js";

export const MEASURE_BASIS = "표본 기준";
export const MEASURE_DEFAULTS = Object.freeze({
  hysteresis: 0.1,      // 주기 검출: Vpp 대비 히스테리시스 폭(한쪽)
  riseLow: 0.1,
  riseHigh: 0.9,
  settleBand: 0.02,     // 정착 시간 ±2 %
  finalFraction: 0.02,  // 최종값: 마지막 2 % 표본 평균
  cutoffDropDb: 10 * Math.log10(2), // 3.0103 dB (반전력점)
});

const finite = (value) => typeof value === "number" && Number.isFinite(value);

function item(id, label, value, unit, note = null, extra = {}) {
  const ok = finite(value);
  return {
    id,
    label,
    value: ok ? value : null,
    unit,
    note: ok ? note : (note ?? "측정할 수 없습니다."),
    text: ok ? engineering(value, unit) : `측정 불가${note ? ` — ${note}` : ""}`,
    ...extra,
  };
}

/**
 * x/y에서 유한한 쌍만 골라 낸다. gapBefore[k]는 k번째 유효 표본 앞에 빠진 표본이 있었는지 여부.
 * x는 비감소여야 한다(아니면 ok:false). trailingGap은 마지막 유효 표본 뒤에 누락이 있었는지.
 */
export function prepareSamples(x, y) {
  if (!x || !y || typeof x.length !== "number" || x.length !== y.length) {
    return { ok: false, reason: "x와 y의 표본 수가 다릅니다.", x: [], y: [], gapBefore: [], dropped: 0, gaps: 0, trailingGap: false };
  }
  const xs = [];
  const ys = [];
  const gapBefore = [];
  let pending = false;
  let dropped = 0;
  let gaps = 0;
  for (let index = 0; index < x.length; index += 1) {
    if (!finite(x[index]) || !finite(y[index])) { pending = true; dropped += 1; continue; }
    if (xs.length && x[index] < xs.at(-1)) {
      return { ok: false, reason: "x 값이 증가하는 순서가 아닙니다.", x: [], y: [], gapBefore: [], dropped, gaps };
    }
    const gap = pending && xs.length > 0;
    if (gap) gaps += 1;
    gapBefore.push(gap);
    xs.push(x[index]);
    ys.push(y[index]);
    pending = false;
  }
  // trailingGap: 마지막 유효 표본 뒤에 누락 표본이 있었는지(기록 끝까지 확인되지 않음)
  return { ok: true, x: xs, y: ys, gapBefore, dropped, gaps, trailingGap: pending && xs.length > 0 };
}

/** 누락 구간을 건너뛴 사다리꼴 구간 목록과 총 길이. */
function intervalsOf(prep) {
  const list = [];
  let length = 0;
  for (let k = 1; k < prep.x.length; k += 1) {
    if (prep.gapBefore[k]) continue;
    const dx = prep.x[k] - prep.x[k - 1];
    list.push({ a: prep.y[k - 1], b: prep.y[k], dx });
    length += dx;
  }
  return { list, length };
}

/**
 * 사다리꼴 평균과 RMS를 중간 오버플로·언더플로 없이 계산한다.
 * 평균은 (0.5a+0.5b)·(dx/길이)의 합, RMS는 사용된 표본의 최대 |y|로 정규화한 뒤 제곱한다.
 */
function weightedMeanRms(prep) {
  const { list, length } = intervalsOf(prep);
  if (length > 0) {
    let scale = 0;
    for (const { a, b } of list) scale = Math.max(scale, Math.abs(a), Math.abs(b));
    let mean = 0;
    let power = 0;
    for (const { a, b, dx } of list) {
      const weight = dx / length;
      mean += (0.5 * a + 0.5 * b) * weight;
      if (scale > 0) power += 0.5 * ((a / scale) ** 2 + (b / scale) ** 2) * weight;
    }
    return { mean, rms: scale > 0 ? scale * Math.sqrt(Math.max(0, power)) : 0, integrated: true };
  }
  const n = prep.y.length;
  let scale = 0;
  for (const value of prep.y) scale = Math.max(scale, Math.abs(value));
  let mean = 0;
  let power = 0;
  for (const value of prep.y) {
    mean += value / n;
    if (scale > 0) power += (value / scale) ** 2 / n;
  }
  return { mean, rms: n === 1 ? Math.abs(prep.y[0]) : (scale > 0 ? scale * Math.sqrt(power) : 0), integrated: false };
}

function medianStep(prep) {
  const steps = [];
  for (let k = 1; k < prep.x.length; k += 1) if (!prep.gapBefore[k]) steps.push(prep.x[k] - prep.x[k - 1]);
  if (!steps.length) return null;
  steps.sort((a, b) => a - b);
  return steps[Math.floor(steps.length / 2)];
}

function unitsFor({ xUnit = "", yUnit = "" } = {}) {
  return {
    xUnit,
    yUnit,
    frequencyUnit: xUnit === "s" ? "Hz" : (xUnit ? `1/${xUnit}` : ""),
  };
}

/** min / max / Vpp / 평균 / RMS. 평균·RMS는 사다리꼴 적분(불균일 간격 허용)을 구간 길이로 나눈 값. */
export function measureStats(x, y, options = {}) {
  const prep = options.prepared ?? prepareSamples(x, y);
  const { yUnit } = unitsFor(options);
  const fail = (reason) => ({
    min: item("min", "최솟값", null, yUnit, reason),
    max: item("max", "최댓값", null, yUnit, reason),
    vpp: item("vpp", "피크-피크", null, yUnit, reason),
    mean: item("mean", "평균", null, yUnit, reason),
    rms: item("rms", "RMS", null, yUnit, reason),
  });
  if (!prep.ok) return fail(prep.reason);
  if (!prep.y.length) return fail("유효한 표본이 없습니다.");
  let minimum = Infinity;
  let maximum = -Infinity;
  let minAt = 0;
  let maxAt = 0;
  prep.y.forEach((value, index) => {
    if (value < minimum) { minimum = value; minAt = index; }
    if (value > maximum) { maximum = value; maxAt = index; }
  });
  const { mean, rms, integrated } = weightedMeanRms(prep);
  let integralNote = prep.gaps || prep.dropped ? `누락 표본 ${prep.dropped}개 구간은 적분에서 제외` : null;
  if (!integrated) integralNote = prep.y.length === 1 ? "표본이 1개뿐이라 그 값을 그대로 사용" : "적분 구간 길이가 0이라 단순 평균 사용";
  return {
    min: item("min", "최솟값", minimum, yUnit, null, { index: minAt, at: prep.x[minAt] }),
    max: item("max", "최댓값", maximum, yUnit, null, { index: maxAt, at: prep.x[maxAt] }),
    vpp: item("vpp", "피크-피크", maximum - minimum, yUnit),
    mean: item("mean", "평균", mean, yUnit, integralNote ?? "사다리꼴 적분 / 구간 길이"),
    rms: item("rms", "RMS", rms, yUnit, integralNote ?? "사다리꼴 적분 / 구간 길이"),
  };
}

/** 주기·주파수: 히스테리시스 슈미트 트리거로 상승 교차를 찾고 교차 시각은 선형보간. */
export function measurePeriod(x, y, options = {}) {
  const prep = options.prepared ?? prepareSamples(x, y);
  const units = unitsFor(options);
  const hysteresisFraction = options.hysteresis ?? MEASURE_DEFAULTS.hysteresis;
  const none = (reason) => ({
    period: item("period", "주기", null, units.xUnit, reason),
    frequency: item("frequency", "주파수", null, units.frequencyUnit, reason),
    cycles: 0,
  });
  if (!prep.ok) return none(prep.reason);
  const count = prep.y.length;
  if (count < 4) return none("표본이 너무 적습니다.");
  const stats = measureStats(null, null, { prepared: prep, ...options });
  const vpp = stats.vpp.value;
  if (!(vpp > 0)) return none("신호가 일정해서 주기를 정의할 수 없습니다.");
  const level = options.level === "mean" ? stats.mean.value : (stats.max.value + stats.min.value) / 2;
  const half = vpp * hysteresisFraction;

  // 연속 구간(누락 표본으로 끊기지 않은 구간)별로 슈미트 트리거를 따로 돌린다. 구간을 가로지르는 교차·주기는 만들지 않는다.
  const segments = [];
  for (let start = 0; start < count;) {
    let end = start + 1;
    while (end < count && !prep.gapBefore[end]) end += 1;
    segments.push([start, end]);
    start = end;
  }
  let best = null; // 완전한 주기가 가장 많은 구간(동률이면 앞쪽)
  let bestFalling = null;
  for (const [start, end] of segments) {
    let state = null; // "low" | "high" | null(대역 안)
    const rising = [];
    const falling = [];
    for (let i = start; i < end; i += 1) {
      const value = prep.y[i];
      if (state === null) {
        if (value <= level - half) state = "low";
        else if (value >= level + half) state = "high";
        continue;
      }
      if (state === "low" && value >= level + half) {
        state = "high";
        let j = i;
        while (j > start && prep.y[j] >= level) j -= 1;
        // j: level 미만인 마지막 표본, j+1: 처음으로 level 이상이 된 표본
        if (prep.y[j] >= level) continue; // 구간 처음부터 위에 있던 신호(교차 없음)
        const y0 = prep.y[j];
        const y1 = prep.y[j + 1];
        const fraction = y1 === y0 ? 0 : (level - y0) / (y1 - y0);
        rising.push(prep.x[j] + fraction * (prep.x[j + 1] - prep.x[j]));
      } else if (state === "high" && value <= level - half) {
        state = "low";
        let j = i;
        while (j > start && prep.y[j] <= level) j -= 1;
        // j: level 초과인 마지막 표본, j+1: 처음으로 level 이하가 된 표본
        if (prep.y[j] <= level) continue;
        const y0 = prep.y[j];
        const y1 = prep.y[j + 1];
        const fraction = y1 === y0 ? 0 : (level - y0) / (y1 - y0);
        falling.push(prep.x[j] + fraction * (prep.x[j + 1] - prep.x[j]));
      }
    }
    if (!best || rising.length > best.rising.length) best = { rising };
    if (!bestFalling || falling.length > bestFalling.falling.length) bestFalling = { falling };
  }
  let rising = best?.rising ?? [];
  let edgeName = "상승";
  // 상승 교차만으로 완전한 주기 2개가 안 나오고 하강 교차가 더 많으면 하강 교차로 측정(예: 사인 3주기 창).
  if (rising.length < 3 && (bestFalling?.falling.length ?? 0) > rising.length) { rising = bestFalling.falling; edgeName = "하강"; }
  const cycles = rising.length - 1;
  if (cycles < 2) {
    const where = segments.length > 1 ? `한 연속 구간 안에서 ` : "";
    return { ...none(`${where}완전한 주기가 2개 이상 필요합니다(감지된 ${edgeName} 교차 ${rising.length}개, 완전한 주기 ${Math.max(0, cycles)}개${segments.length > 1 ? `, 연속 구간 ${segments.length}개` : ""}).`), cycles: Math.max(0, cycles) };
  }
  const period = (rising.at(-1) - rising[0]) / cycles;
  if (!(period > 0)) return { ...none("주기가 0 이하로 계산되었습니다."), cycles };
  let worst = 0;
  for (let k = 1; k < rising.length; k += 1) worst = Math.max(worst, Math.abs((rising[k] - rising[k - 1]) / period - 1));
  const base = `${edgeName} 교차 ${rising.length}개의 평균 간격, 교차 시각은 인접 표본 선형보간 · 기준 수준 ${options.level === "mean" ? "평균" : "최소·최대 중점"}${segments.length > 1 ? " · 누락 구간을 가로지르지 않고 가장 긴(주기가 많은) 연속 구간만 사용" : ""}`;
  const note = worst > 0.1 ? `${base} · 주기 간 편차 최대 ${(worst * 100).toFixed(1)} % (비주기 신호일 수 있음)` : base;
  return {
    period: item("period", "주기", period, units.xUnit, note, { cycles }),
    frequency: item("frequency", "주파수", 1 / period, units.frequencyUnit, note, { cycles }),
    cycles,
  };
}

function lastWindow(prep, fraction) {
  const count = prep.y.length;
  const size = Math.max(1, Math.ceil(count * fraction));
  return prep.y.slice(count - size);
}

/** 최종값(마지막 2 % 표본 평균). */
export function measureFinalValue(x, y, options = {}) {
  const prep = options.prepared ?? prepareSamples(x, y);
  const { yUnit } = unitsFor(options);
  if (!prep.ok) return item("final", "최종값", null, yUnit, prep.reason);
  if (!prep.y.length) return item("final", "최종값", null, yUnit, "유효한 표본이 없습니다.");
  const tail = lastWindow(prep, options.finalFraction ?? MEASURE_DEFAULTS.finalFraction);
  const value = tail.reduce((sum, v) => sum + v, 0) / tail.length;
  return item("final", "최종값", value, yUnit, `마지막 ${tail.length}개 표본 평균${prep.trailingGap ? " · 기록 끝에 누락 표본이 있어 마지막 유효 표본 기준" : ""}`);
}

function crossingAfter(prep, startIndex, threshold, sign) {
  for (let i = Math.max(1, startIndex); i < prep.y.length; i += 1) {
    if (sign * (prep.y[i] - threshold) >= 0 && sign * (prep.y[i - 1] - threshold) < 0) {
      if (prep.gapBefore[i]) return { index: i, time: null };
      const y0 = prep.y[i - 1];
      const y1 = prep.y[i];
      const fraction = y1 === y0 ? 0 : (threshold - y0) / (y1 - y0);
      return { index: i, time: prep.x[i - 1] + fraction * (prep.x[i] - prep.x[i - 1]) };
    }
  }
  return null;
}

/** 계단 응답 분석: 10–90 % 상승시간과 ±2 % 정착 시간. 계단형이 아니면 둘 다 null. */
export function measureStepResponse(x, y, options = {}) {
  const prep = options.prepared ?? prepareSamples(x, y);
  const units = unitsFor(options);
  const none = (reason) => ({
    riseTime: item("riseTime", "상승시간 (10–90 %)", null, units.xUnit, reason),
    settlingTime: item("settlingTime", "정착 시간 (±2 %)", null, units.xUnit, reason),
    initial: null,
    final: null,
  });
  if (!prep.ok) return none(prep.reason);
  const count = prep.y.length;
  if (count < 6) return none("표본이 너무 적습니다.");
  const stats = measureStats(null, null, { prepared: prep, ...options });
  const vpp = stats.vpp.value;
  if (!(vpp > 0)) return none("신호가 일정해서 계단 응답이 아닙니다.");
  const initial = options.initial ?? prep.y[0];
  const fin = options.final ?? lastWindow(prep, options.finalFraction ?? MEASURE_DEFAULTS.finalFraction).reduce((s, v, _, a) => s + v / a.length, 0);
  const amplitude = fin - initial;
  if (Math.abs(amplitude) < 0.5 * vpp) return none("계단 응답이 아닙니다(시작값과 최종값 차이가 신호 변동폭에 비해 작음).");
  const sign = amplitude > 0 ? 1 : -1;
  // 중앙(50 %) 교차가 한 번뿐인지(히스테리시스 ±10 %) 확인 — 주기 신호·진동은 제외
  const midLevel = initial + 0.5 * amplitude;
  const band = 0.1 * Math.abs(amplitude);
  let state = null;
  let crossings = 0;
  for (const value of prep.y) {
    const relative = sign * (value - midLevel);
    if (state === null) { if (relative <= -band) state = "low"; else if (relative >= band) state = "high"; continue; }
    if (state === "low" && relative >= band) { state = "high"; crossings += 1; }
    else if (state === "high" && relative <= -band) { state = "low"; crossings += 1; }
  }
  if (crossings !== 1) return none(`단일 계단 응답이 아닙니다(중앙 교차 ${crossings}회).`);

  const lowFraction = options.riseLow ?? MEASURE_DEFAULTS.riseLow;
  const highFraction = options.riseHigh ?? MEASURE_DEFAULTS.riseHigh;
  const low = crossingAfter(prep, 1, initial + lowFraction * amplitude, sign);
  const high = low ? crossingAfter(prep, low.index, initial + highFraction * amplitude, sign) : null;
  let riseTime;
  let riseGap = false;
  if (low && high) for (let k = low.index + 1; k <= high.index; k += 1) if (prep.gapBefore[k]) riseGap = true;
  if (!low || !high || low.time === null || high.time === null) {
    riseTime = item("riseTime", "상승시간 (10–90 %)", null, units.xUnit, "10 %·90 % 교차점을 찾을 수 없습니다(누락 구간에 걸친 교차 포함).");
  } else if (riseGap) {
    riseTime = item("riseTime", "상승시간 (10–90 %)", null, units.xUnit, "10 %와 90 % 교차점 사이에 누락 표본이 있어 상승시간을 확인할 수 없습니다.");
  } else {
    const rise = high.time - low.time;
    const step = medianStep(prep);
    let note = `기준: 시작값 ${engineering(initial, units.yUnit)} → 최종값 ${engineering(fin, units.yUnit)}, 10 %·90 % 교차점은 인접 표본 선형보간`;
    if (step !== null && rise < 2 * step) note += " · 표본 간격이 상승시간과 비슷해 정확도가 낮습니다";
    riseTime = item("riseTime", "상승시간 (10–90 %)", rise, units.xUnit, note, { t10: low.time, t90: high.time });
  }

  const tolerance = (options.settleBand ?? MEASURE_DEFAULTS.settleBand) * Math.abs(amplitude);
  let lastOutside = -1;
  for (let i = 0; i < count; i += 1) if (Math.abs(prep.y[i] - fin) > tolerance) lastOutside = i;
  let settlingTime;
  let settleGap = prep.trailingGap;
  for (let k = lastOutside + 1; k < count; k += 1) if (k > 0 && prep.gapBefore[k]) settleGap = true;
  if (settleGap) {
    settlingTime = item("settlingTime", "정착 시간 (±2 %)", null, units.xUnit, prep.trailingGap
      ? "기록 끝에 누락 표본이 있어 끝까지 대역에 머무는지 확인할 수 없습니다."
      : "정착 이후 구간에 누락 표본이 있어 대역 유지를 확인할 수 없습니다.");
  } else if (lastOutside === count - 1) {
    settlingTime = item("settlingTime", "정착 시간 (±2 %)", null, units.xUnit, "기록 구간 안에서 최종값 ±2 % 대역에 머물지 못했습니다(더 길게 해석하세요).");
  } else {
    const at = lastOutside < 0 ? prep.x[0] : prep.x[lastOutside + 1];
    settlingTime = item("settlingTime", "정착 시간 (±2 %)", at - prep.x[0], units.xUnit, "기록 시작 기준, 이후 구간 끝까지 최종값 ±2 % 대역 유지(표본 기준)", { at });
  }
  return { riseTime, settlingTime, initial, final: fin };
}

/**
 * AC 크기(dB) 곡선의 −3 dB 주파수. 최대값 기준으로 3.0103 dB 내려간 점.
 * 저역통과/고역통과/대역통과를 구분한다. 교차점은 log10(f)–dB 선형보간.
 */
export function measureCutoff(frequencies, magnitudeDb, options = {}) {
  const prep = options.prepared ?? prepareSamples(frequencies, magnitudeDb);
  const none = (reason) => ({ ...item("cutoff", "−3 dB 주파수", null, "Hz", reason), type: null, lower: null, upper: null, bandwidth: null, referenceDb: null });
  if (!prep.ok) return none(prep.reason);
  if (prep.y.length < 3) return none("표본이 너무 적습니다.");
  if (!prep.x.every((f) => f > 0)) return none("주파수는 모두 0보다 커야 합니다(0 또는 음수 주파수 포함).");
  const drop = options.dropDb ?? MEASURE_DEFAULTS.cutoffDropDb;
  let peak = 0;
  prep.y.forEach((value, index) => { if (value > prep.y[peak]) peak = index; });
  const reference = prep.y[peak];
  const target = reference - drop;
  const interpolate = (i0, i1) => {
    const f0 = prep.x[i0];
    const f1 = prep.x[i1];
    const y0 = prep.y[i0];
    const y1 = prep.y[i1];
    const fraction = y1 === y0 ? 0 : (target - y0) / (y1 - y0);
    return 10 ** (Math.log10(f0) + fraction * (Math.log10(f1) - Math.log10(f0)));
  };
  // 교차 구간(인접 두 유효 표본)이 누락 표본에 걸쳐 있으면 보간하지 않고 측정 불가로 둔다.
  let upper = null;
  let blocked = false;
  for (let i = peak + 1; i < prep.y.length; i += 1) if (prep.y[i] <= target) { if (prep.gapBefore[i]) blocked = true; else upper = interpolate(i - 1, i); break; }
  let lower = null;
  for (let i = peak - 1; i >= 0; i -= 1) if (prep.y[i] <= target) { if (prep.gapBefore[i + 1]) blocked = true; else lower = interpolate(i, i + 1); break; }
  if (blocked) return { ...none("−3 dB 교차 구간이 누락 표본에 걸쳐 있어 보간할 수 없습니다."), referenceDb: reference, peakFrequency: prep.x[peak] };
  // 최대값이 해석 범위의 가장자리이고 곡선이 거기서도 가파르게 내려가면(1차 필터 기준 약 0.5 fc 이상) 진짜 통과대역 이득이 범위 밖일 수 있다.
  let edge = false;
  if (peak === 0 && prep.y.length > 1 && prep.x[1] > prep.x[0]) edge = (prep.y[1] - prep.y[0]) / (Math.log10(prep.x[1]) - Math.log10(prep.x[0])) < -3;
  const last = prep.y.length - 1;
  if (peak === last && last > 0 && prep.x[last] > prep.x[last - 1]) edge = (prep.y[last] - prep.y[last - 1]) / (Math.log10(prep.x[last]) - Math.log10(prep.x[last - 1])) > 3;
  const edgeNote = edge ? " · 주의: 통과대역 이득이 해석 범위 밖에 있을 수 있어 범위 안 최대값 기준입니다(주파수 범위를 넓혀 확인하세요)" : "";
  const note = `최대 ${Number(reference.toPrecision(5))} dB 기준 −${Number(drop.toPrecision(5))} dB, log f–dB 선형보간${prep.dropped ? ` · 누락 표본 ${prep.dropped}개 건너뜀` : ""}${edgeNote}`;
  const extra = { referenceDb: reference, peakFrequency: prep.x[peak], lower, upper, edgeReference: edge };
  if (upper !== null && lower !== null) {
    return { ...item("cutoff", "−3 dB 대역폭", upper - lower, "Hz", `대역통과: ${note}`), type: "bandpass", bandwidth: upper - lower, ...extra };
  }
  if (upper !== null) return { ...item("cutoff", "−3 dB 차단 주파수 (저역통과)", upper, "Hz", note), type: "lowpass", bandwidth: null, ...extra };
  if (lower !== null) return { ...item("cutoff", "−3 dB 차단 주파수 (고역통과)", lower, "Hz", note), type: "highpass", bandwidth: null, ...extra };
  return { ...none("해석 주파수 범위 안에서 최대값보다 3 dB 내려간 점이 없습니다."), referenceDb: reference, peakFrequency: prep.x[peak] };
}

/** 두 커서(표본 인덱스 A,B) 사이 차이. slope = Δy/Δx, inverse = 1/|Δx|. */
export function cursorDelta(x, y, indexA, indexB, options = {}) {
  const units = unitsFor(options);
  const fail = (reason) => ({ ok: false, dx: item("dx", "Δx", null, units.xUnit, reason), dy: item("dy", "Δy", null, units.yUnit, reason), slope: item("slope", "기울기 Δy/Δx", null, "", reason), inverse: item("inverse", "1/Δx", null, units.frequencyUnit, reason), note: reason });
  if (!x || !y || x.length !== y.length) return fail("x와 y의 표본 수가 다릅니다.");
  const valid = (i) => Number.isInteger(i) && i >= 0 && i < x.length;
  if (!valid(indexA) || !valid(indexB)) return fail("커서 위치가 표본 범위를 벗어났습니다.");
  if (![x[indexA], x[indexB], y[indexA], y[indexB]].every(finite)) return fail("커서 위치에 유효한 표본이 없습니다(누락 구간).");
  const dx = x[indexB] - x[indexA];
  const dy = y[indexB] - y[indexA];
  const slopeUnit = options.xUnit || options.yUnit ? `${options.yUnit ?? ""}/${options.xUnit ?? ""}` : "";
  const zero = dx === 0 ? "Δx가 0이라 계산할 수 없습니다." : null;
  return {
    ok: true,
    note: MEASURE_BASIS,
    dx: item("dx", "Δx", dx, units.xUnit, MEASURE_BASIS),
    dy: item("dy", "Δy", dy, units.yUnit, MEASURE_BASIS),
    slope: item("slope", "기울기 Δy/Δx", dx === 0 ? null : dy / dx, slopeUnit, zero ?? MEASURE_BASIS),
    inverse: item("inverse", "1/Δx", dx === 0 ? null : 1 / Math.abs(dx), units.frequencyUnit, zero ?? MEASURE_BASIS),
  };
}

/**
 * 한 번에 모두 측정. domain: "time" | "frequency"
 *   time:      최솟값/최댓값/Vpp/평균/RMS/주기/주파수/상승시간/최종값/정착 시간
 *   frequency: 최솟값/최댓값(+발생 주파수), yUnit이 dB 계열이면 −3 dB 주파수
 * 반환: { ok, basis, domain, count, dropped, gaps, items: {id: item}, list: [item...] }
 */
export function measureAll(x, y, options = {}) {
  const domain = options.domain ?? "time";
  const prep = prepareSamples(x, y);
  if (!prep.ok) return { ok: false, reason: prep.reason, basis: MEASURE_BASIS, domain, count: 0, dropped: 0, gaps: 0, items: {}, list: [] };
  const opts = { ...options, prepared: prep };
  const items = {};
  const stats = measureStats(null, null, opts);
  if (domain === "frequency") {
    items.min = stats.min;
    items.max = stats.max;
    if (/^dB/.test(options.yUnit ?? "")) items.cutoff = measureCutoff(null, null, opts);
  } else {
    Object.assign(items, stats);
    const period = measurePeriod(null, null, opts);
    items.period = period.period;
    items.frequency = period.frequency;
    const step = measureStepResponse(null, null, opts);
    items.riseTime = step.riseTime;
    items.final = measureFinalValue(null, null, opts);
    items.settlingTime = step.settlingTime;
  }
  return { ok: true, basis: MEASURE_BASIS, domain, count: prep.y.length, dropped: prep.dropped, gaps: prep.gaps, items, list: Object.values(items) };
}
