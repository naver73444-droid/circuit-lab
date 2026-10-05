import { parseValue } from "./circuit-engine.js";

function number(value, fallback = 0) {
  try { return parseValue(value); } catch { return fallback; }
}

/** Heuristic display/analysis defaults, NOT a substitute for circuit poles or solver validation. */
export function suggestAnalysis(circuit, previous, intent = "auto") {
  if (intent === "manual") return { settings: { ...previous }, reason: "직접 설정한 조건을 사용합니다." };
  const sources = circuit.components.filter((component) => ["V", "I"].includes(component.type));
  const capacitors = circuit.components.filter((component) => component.type === "C").map((component) => number(component.props?.value)).filter((value) => value > 0);
  const inductors = circuit.components.filter((component) => component.type === "L").map((component) => number(component.props?.value)).filter((value) => value > 0);
  const resistors = circuit.components.filter((component) => component.type === "R").map((component) => number(component.props?.value)).filter((value) => value > 0);
  const timeSources = sources.filter((component) => ["SIN", "PULSE"].includes(component.props?.mode));
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
