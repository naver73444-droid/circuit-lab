import { parseValue } from "./circuit-engine.js";

function number(value, fallback = 0) {
  try { return parseValue(value); } catch { return fallback; }
}
/** A V/I source whose waveform changes: a sine with a non-zero amplitude or a square whose levels differ (a 0 Vpp sine is a DC level). */
const isPeriodicSource = (component) => ["V", "I"].includes(component.type) && (component.props?.mode === "SIN"
  ? number(component.props.amplitude, NaN) !== 0
  : component.props?.mode === "PULSE" && number(component.props.pulseV1, NaN) !== number(component.props.pulseV2, NaN));

/** Heuristic display/analysis defaults, NOT a substitute for circuit poles or solver validation. */
export function suggestAnalysis(circuit, previous, intent = "auto") {
  if (intent === "manual") return { settings: { ...previous }, reason: "직접 설정한 조건을 사용합니다." };
  const sources = circuit.components.filter((component) => ["V", "I"].includes(component.type));
  const capacitors = circuit.components.filter((component) => component.type === "C").map((component) => number(component.props?.value)).filter((value) => value > 0);
  const inductors = circuit.components.filter((component) => component.type === "L").map((component) => number(component.props?.value)).filter((value) => value > 0);
  const resistors = circuit.components.filter((component) => component.type === "R").map((component) => number(component.props?.value)).filter((value) => value > 0);
  const timeSources = sources.filter(isPeriodicSource);
  const analysis = intent === "auto" ? (timeSources.length || capacitors.length || inductors.length ? "transient" : "dc") : intent;
  const settings = { ...previous, analysis };
  if (analysis === "dc") return { settings, reason: `${intent === "auto" ? "자동: " : ""}DC 동작점 (C 개방 · L 단락)` };
  if (analysis === "ac") return { settings, reason: "AC 주파수 응답 · 범위는 아래에서 조정" };
  const fastScales = [];
  const slowScales = [];
  const warnings = [];
  const rMin = resistors.length ? Math.min(...resistors) : 0;
  const rMax = resistors.length ? Math.max(...resistors) : 0;
  if (rMax && capacitors.length) {
    slowScales.push(5 * rMax * capacitors.reduce((a, b) => a + b, 0));
    fastScales.push(rMin * Math.min(...capacitors) / 50);
  }
  if (rMin && inductors.length) {
    slowScales.push(5 * inductors.reduce((a, b) => a + b, 0) / rMin);
    fastScales.push(Math.min(...inductors) / rMax / 50);
  }
  if (capacitors.length && inductors.length) {
    const period = 2 * Math.PI * Math.sqrt(Math.max(...capacitors) * Math.max(...inductors));
    slowScales.push(3 * period); fastScales.push(period / 150);
  }
  const passiveWindow = slowScales.length ? Math.max(...slowScales) : 0;
  let focusedStep = false;
  for (const source of timeSources) {
    const props = source.props ?? {};
    const period = props.mode === "SIN" ? 1 / number(props.frequency, 60) : number(props.pulsePeriod);
    if (props.mode === "PULSE" && passiveWindow > 0 && number(props.pulseWidth) >= passiveWindow * 2 && period >= passiveWindow * 3) {
      slowScales.push(number(props.pulseDelay) + number(props.pulseRise) + passiveWindow);
      const rise = number(props.pulseRise); if (rise > 0) fastScales.push(rise / 20);
      focusedStep = true;
      continue;
    }
    if (period > 0 && Number.isFinite(period)) { fastScales.push(period / 150); slowScales.push(period * 3); }
    if (props.mode === "PULSE") {
      for (const key of ["pulseRise", "pulseFall", "pulseWidth"]) {
        const edge = number(props[key]); if (edge > 0) fastScales.push(edge / 20);
      }
      slowScales.push(number(props.pulseDelay) + (period > 0 ? period * 2 : 0));
    }
  }
  const end = Math.max(1e-12, Math.min(1e6, slowScales.length ? Math.max(...slowScales) : .005));
  const desiredStep = Math.max(1e-18, Math.min(end / 500, ...fastScales.filter((value) => value > 0 && Number.isFinite(value))));
  const step = Math.max(desiredStep, end / 20000);
  if (step > desiredStep * 1.01) warnings.push("sample-limit");
  settings.start = "0";
  settings.end = String(Number(end.toPrecision(10)));
  // Round upward to avoid creating 20,002 points through decimal conversion.
  settings.step = String(step * (1 + 1e-10));
  const limited = warnings.length ? " · 빠른 변화가 표본 한도를 넘었습니다. 구간을 줄이세요" : "";
  return { settings, reason: `${intent === "auto" ? "자동: " : ""}시간응답${focusedStep ? " · 첫 계단응답 중심" : ""} · 회로 값으로 범위 자동 설정${limited}` };
}

/** The readable positive values of one part type (R, C or L). */
const positiveValues = (circuit, type) => circuit.components.filter((component) => component.type === type).map((component) => number(component.props?.value)).filter((value) => value > 0 && Number.isFinite(value));
/** A transient run's start, end and step as numbers, or null when one cannot be read. */
function readWindow(settings) {
  try { return { start: parseValue(settings.start ?? 0), end: parseValue(settings.end), step: parseValue(settings.step) }; } catch { return null; }
}

/** The fastest natural time scale of the R, L, C values (R·C, L/R, √(LC)), or 0 when the circuit has none. A heuristic like the one above. */
export function fastestTimeConstant(circuit) {
  const r = positiveValues(circuit, "R"), c = positiveValues(circuit, "C"), l = positiveValues(circuit, "L");
  const scales = [];
  if (r.length && c.length) scales.push(Math.min(...r) * Math.min(...c));
  if (r.length && l.length) scales.push(Math.min(...l) / Math.max(...r));
  if (l.length && c.length) scales.push(Math.sqrt(Math.min(...l) * Math.min(...c)));
  return scales.length ? Math.min(...scales) : 0;
}

const floor125 = (value) => { const decade = 10 ** Math.floor(Math.log10(value)); return [5, 2, 1].map((m) => m * decade).find((step) => step <= value * (1 + 1e-9)) ?? decade; };

/**
 * The step a transient run actually uses: the set step, or a finer one when it leaves fewer than 10 samples per fastest time constant
 * (the curve turns into visible corners and the drawn peak falls short: 1.5 kΩ·47 nF at 10 µs peaks at 2.9 mA, not 3.3 mA). The finer step is
 * τ/20 on a 1-2-5 grid, never past the solver's 20 000 points. The settings stay as typed; null when nothing changes.
 */
export function refinedTransientStep(circuit, settings) {
  const run = readWindow(settings);
  if (!run) return null;
  const { start, end, step } = run;
  const tau = fastestTimeConstant(circuit);
  if (!(tau > 0) || !(end > start) || !(step > tau / 10)) return null;
  const limit = (end - start) / 19990;
  const finer = Math.max(floor125(tau / 20), limit);
  return finer < step * 0.999 ? { step: finer, tau } : null;
}

/**
 * Oscilloscope "정상상태" (steady state, triggered): a run long enough for the start-up transient to die out, shown from a rising edge
 * of the first periodic source, as a triggered scope shows a repeating signal. Returns null when the run is not transient or no V/I
 * source is a sine or a square that changes (a 0 Vpp sine is a DC level); { refused } (a sentence) when the settling time is so long that the window would get fewer than 20
 * samples per period of any source; else { end, step, trigger, span, source } in seconds: run 0…end, keep trigger…trigger+span.
 *   settle  = 10·ΣR·ΣC and 10·ΣL·Σ(1/R) (conservative passive RC/RL bounds; 5 envelope time constants for 2RC or 2L/R), at least
 *             one period, counted from the moment a delayed square starts;
 *   trigger = the first rising edge after settle: a square's delay + k·T (+ rise + width when V1 > V2), a sine's upward zero crossing.
 * The span keeps the typed length (end − start); the step is the given one, coarsened only to stay within 20 000 points, and set so
 * that the trigger falls on a sample.
 */
export function steadyStateRun(circuit, settings) {
  if (settings?.analysis !== "transient") return null;
  const sources = circuit.components.filter(isPeriodicSource);
  const source = sources[0];
  if (!source) return null;
  const run = readWindow(settings);
  if (!run) return null;
  const { start, end, step } = run;
  const span = end - start;
  if (!(span > 0) || !(step > 0)) return null;
  const p = source.props;
  const periods = sources.map(({ props }) => props.mode === "SIN" ? 1 / number(props.frequency, 60) : number(props.pulsePeriod, 2));
  if (periods.some((value) => !(value > 0) || !Number.isFinite(value))) return null;
  const period = periods[0], shortestPeriod = Math.min(...periods);
  const r = positiveValues(circuit, "R"), c = positiveValues(circuit, "C"), l = positiveValues(circuit, "L");
  const sum = (values) => values.reduce((a, b) => a + b, 0);
  const passive = Math.max(10 * sum(r) * sum(c), 10 * sum(l) * sum(r.map((value) => 1 / value)));
  // First rising edge at or after the settled time: the edge repeats every period from `phase0` (a square's delay is also when it starts).
  const delay = p.mode === "PULSE" ? Math.max(0, number(p.pulseDelay, 0)) : 0;
  const risingOffset = p.mode === "PULSE" && number(p.pulseV1) > number(p.pulseV2) ? number(p.pulseRise) + number(p.pulseWidth, 1) : 0;
  const phase0 = p.mode === "SIN" ? ((-number(p.phase, 0) / 360) % 1 + 1) % 1 * period : delay + risingOffset;
  // `start` is when the square starts (its delay); a refusal asks what the trigger would be without it (start = 0).
  const edgeAfter = (settle, start = delay) => {
    const first = phase0 - delay + start;
    return first + Math.max(0, Math.ceil((start + settle - first) / period - 1e-9)) * period;
  };
  const trigger = edgeAfter(Math.max(period, passive));
  // Within 20 000 points, and a whole number of steps to the trigger so that t = 0 is a sample: the step is shortened to fit, or
  // lengthened when shortening would pass the point limit (a trigger shorter than one step stays off the grid).
  const stepFor = (shown) => {
    const runEnd = trigger + shown;
    let runStep = Math.max(step, runEnd / 19990);
    if (trigger >= runStep) {
      const finer = trigger / Math.ceil(trigger / runStep - 1e-9);
      runStep = runEnd / finer <= 19990 ? finer : trigger / Math.floor(trigger / runStep + 1e-9);
    }
    return runStep;
  };
  const runEnd = trigger + span, runStep = stepFor(span), drawable = (value) => value <= shortestPeriod / 20;
  if (!drawable(runStep)) {
    // Say what made the run too long: the student's own Δt when it alone is longer than a twentieth of the fastest period, the R·L·C
    // settling bound when the run would fit without it (the delay kept), a square's delay when the run would fit without it (the
    // settling kept), a slow trigger source when the run would fit with the fastest source as the trigger, the shown span when it does
    // not fit even after the shortest wait (one fastest period), else the wait and the span together (a delay or settling is named
    // only when there is one; shortening the span is advised only when the same plan with one fastest period shown would pass).
    const s = (value, digits = 3) => Number(value.toPrecision(digits));
    // The advised Δt is rounded down (rounded up it would be refused again), with digits enough to differ from the typed Δt.
    const down = (value, digits) => { const unit = 10 ** (Math.floor(Math.log10(value)) - digits + 1); return s(Math.floor(value / unit + 1e-9) * unit, digits); };
    const fine = shortestPeriod / 20, fits = (runLength) => runLength / 19990 <= fine;
    const waits = [delay > 0 ? `구형 지연 ${s(delay)} s` : "", passive > period ? `R·L·C 정착 약 ${s(passive)} s` : ""].filter(Boolean).join(" + ");
    let digits = 3;
    while (step > fine && digits < 12 && s(step, digits) <= down(fine, digits)) digits += 1;
    const why = step > fine ? `간격 Δt ${s(step, digits)} s가 가장 빠른 전원 주기의 1/20(${down(fine, digits)} s)보다 길어 한 주기에 20점도 못 그립니다 · Δt를 ${down(fine, digits)} s 이하로 줄이세요`
      : passive > period && fits(edgeAfter(period) + span) ? `정상상태까지 약 ${s(trigger)} s가 걸려 한 주기에 20점도 못 그립니다(R·L·C 값을 모두 더해 잡은 보수적 상한) · 정상상태를 끄거나 R·C를 줄이세요`
      : delay > 0 && fits(edgeAfter(Math.max(period, passive), 0) + span) ? `구형 지연 ${s(delay)} s 뒤에야 트리거해 한 주기에 20점도 못 그립니다 · 지연을 줄이거나 정상상태를 끄세요`
      : period > shortestPeriod && fits(span + 2 * shortestPeriod) ? `트리거 전원 주기 ${s(period)} s가 가장 빠른 전원 주기 ${s(shortestPeriod)} s보다 훨씬 길어 한 주기에 20점도 못 그립니다 · 정상상태를 끄세요`
      : !fits(span + shortestPeriod) ? `보이는 구간 ${s(span)} s가 길어 한 주기에 20점도 못 그립니다 · 구간을 줄이세요`
      : `트리거까지 약 ${s(trigger)} s${waits ? `(${waits})` : ""}를 기다린 뒤 ${s(span)} s를 그리면 정해진 점 수(2만 점) 안에서 한 주기에 20점도 못 그립니다 · ${drawable(stepFor(Math.min(span, shortestPeriod))) ? "보이는 구간을 줄이거나 " : ""}정상상태를 끄세요`;
    return { refused: why };
  }
  return { end: runEnd, step: runStep, trigger, span, source: p.ref ?? source.id };
}

/** The part of a run a triggered scope shows: samples from `trigger` on, with time counted from the trigger (t = 0 at the edge). */
export function triggeredResult(result, trigger) {
  const first = result.xValues.findIndex((x) => x >= trigger - 1e-12 * Math.max(1, trigger));
  if (first < 0) return result;
  return { ...result, xValues: result.xValues.slice(first).map((x) => x - trigger), points: result.points.slice(first), trigger };
}

/**
 * Autoset for a generator: the transient run that shows five periods of `frequency` with about 1000 samples per period (step on a
 * 1-2-5 grid; the engine's backward Euler then keeps a sine's amplitude within about 0.1 %),
 * as a scope's Autoset does after the signal changes. { end, step } as editor texts; null for a frequency that is not > 0.
 */
export function generatorTimebase(frequency, start = 0) {
  if (!(frequency > 0) || !Number.isFinite(frequency)) return null;
  const period = 1 / frequency;
  const text = (value) => String(Number(value.toPrecision(6)));
  return { end: text(start + 5 * period), step: text(floor125(period / 1000)) };
}
