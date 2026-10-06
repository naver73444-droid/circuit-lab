/**
 * 파라미터 스윕 계획·병합 모델 (DOM 없음).
 *   1) planSweep: 값 문자열 목록(+라벨)을 만든다. 모든 값은 엔진 parseValue로 검증한다.
 *   2) applySweepValue / buildSweepCircuits: 회로 사본에 값을 넣는다(원본 불변).
 *   3) mergeSweepResults: N개 해석 결과를 한 프로브의 겹쳐 그리기(overlay) 시리즈로 합친다.
 * 해석 실행(simulate)은 이 모듈이 하지 않는다 — 호출 측이 buildSweepCircuits 결과로 실행한다.
 */
import { parseValue } from "./circuit-engine.js";
import { acMagnitudeLevel, acPhaseDegrees } from "./plot-format.js";
import { engineering } from "./scope-model.js";

export const SWEEP_MAX_COUNT = 10;
export const SWEEP_COLORS = Object.freeze(["#80bfff", "#f5bc79", "#c5a2f2", "#8ed4ad", "#ff969e", "#d7d783", "#83d2db", "#eea7d0", "#b0b8c4", "#a3e07a"]);

const UNIT_BY_TYPE = { R: "Ω", C: "F", L: "H", V: "V", I: "A" };
// R/C/L 값과 OP AMP 개방루프 이득(스윕 가능한 유일한 속성, 엔진도 0보다 커야 함)은 양수만 허용
const POSITIVE_TYPES = new Set(["R", "C", "L", "OPAMP"]);
const PREFIXES = [[-15, "f"], [-12, "p"], [-9, "n"], [-6, "u"], [-3, "m"], [0, ""], [3, "k"], [6, "meg"], [9, "g"], [12, "t"]];
const PREFIX_BY_EXPONENT = new Map(PREFIXES);

/** parseValue가 다시 읽을 수 있는 SI 문자열. 예: 1500 -> "1.5k", 2.2e6 -> "2.2meg" ('M'은 쓰지 않음). */
export function formatSIValue(value, digits = 4) {
  if (!Number.isFinite(value)) return String(value);
  if (value === 0) return "0";
  const magnitude = Math.abs(value);
  if (magnitude < 1e-15 || magnitude >= 1e15) return Number(value.toPrecision(digits)).toExponential().replace("e+", "e");
  let exponent = Math.max(-15, Math.min(12, 3 * Math.floor(Math.log10(magnitude) / 3 + 1e-12)));
  let mantissa = Number((value / 10 ** exponent).toPrecision(digits));
  if (Math.abs(mantissa) >= 1000 && exponent < 12) {
    exponent += 3;
    mantissa = Number((value / 10 ** exponent).toPrecision(digits));
  }
  return `${mantissa}${PREFIX_BY_EXPONENT.get(exponent)}`;
}

function parseNumber(input, label) {
  try {
    return { ok: true, value: parseValue(input, label) };
  } catch (error) {
    return { ok: false, reason: error?.message ?? `${label}을(를) 해석할 수 없습니다.` };
  }
}

/**
 * 스윕 계획.
 *   baseValue: 현재 값 문자열(예: "1k") — from/to를 생략했을 때 기준(from=base/10, to=base×10)이며 유효성도 검사한다.
 *   spec: {from, to, count(1..10, 기본 5), scale:"lin"|"log"(기본 "log")}  — from/to는 "100", "10k" 같은 문자열 가능
 *   options: {type:"R"|"C"|"L"|"V"|"I"|…, ref:"R1", unit:"Ω"}  — type이 R/C/L이면 양수만 허용
 * 성공: {ok:true, scale, count, values:[{index, value, text, label, isBase}]}   (value = parseValue(text), 즉 실제 해석에 쓰일 값)
 * 실패: {ok:false, reason}
 */
export function planSweep(baseValue, spec = {}, options = {}) {
  const { type = null, ref = "" } = options;
  const unit = options.unit ?? UNIT_BY_TYPE[type] ?? "";
  const scale = spec.scale ?? "log";
  if (scale !== "lin" && scale !== "log") return { ok: false, reason: "스윕 방식은 선형(lin) 또는 로그(log)만 지원합니다." };
  const count = spec.count === undefined ? 5 : Number(spec.count);
  if (!Number.isInteger(count) || count < 1) return { ok: false, reason: "스윕 점 수는 1 이상의 정수여야 합니다." };
  if (count > SWEEP_MAX_COUNT) return { ok: false, reason: `스윕 점은 최대 ${SWEEP_MAX_COUNT}개까지입니다.` };

  let base = null;
  if (baseValue !== undefined && baseValue !== null && baseValue !== "") {
    const parsed = parseNumber(baseValue, "현재 값");
    if (!parsed.ok) return { ok: false, reason: parsed.reason };
    base = parsed.value;
  }
  let from;
  let to;
  if (spec.from === undefined || spec.from === "" || spec.to === undefined || spec.to === "") {
    if (base === null || !(base > 0)) return { ok: false, reason: "시작·끝 값을 입력하세요." };
  }
  for (const [name, input, fallback] of [["시작 값", spec.from, base / 10], ["끝 값", spec.to, base * 10]]) {
    let value = fallback;
    if (input !== undefined && input !== "") {
      const parsed = parseNumber(input, name);
      if (!parsed.ok) return { ok: false, reason: parsed.reason };
      value = parsed.value;
    }
    if (name === "시작 값") from = value; else to = value;
  }
  if (!Number.isFinite(from) || !Number.isFinite(to)) return { ok: false, reason: "시작·끝 값이 너무 커서 계산할 수 없습니다." };
  if (POSITIVE_TYPES.has(type) && !(from > 0 && to > 0)) return { ok: false, reason: `${ref || type} 값은 0보다 커야 합니다.` };
  if (scale === "log" && !(from > 0 && to > 0)) return { ok: false, reason: "로그 스윕은 0보다 큰 값만 쓸 수 있습니다. 선형 스윕을 사용하세요." };
  if (count > 1 && from === to) return { ok: false, reason: "시작 값과 끝 값이 같아 여러 점을 만들 수 없습니다." };

  // 로그: log10 공간에서 보간(범위가 1e-300…1e300이어도 to/from 오버플로 없음), 선형: (1−t)·from + t·to(to−from 오버플로 없음).
  // 양 끝점은 원래 값으로 고정한다.
  const lowLog = scale === "log" ? Math.log10(from) : 0;
  const highLog = scale === "log" ? Math.log10(to) : 0;
  const raw = Array.from({ length: count }, (_, i) => {
    if (count === 1 || i === 0) return from;
    if (i === count - 1) return to;
    const t = i / (count - 1);
    return scale === "log" ? 10 ** ((1 - t) * lowLog + t * highLog) : (1 - t) * from + t * to;
  });
  if (!raw.every(Number.isFinite)) return { ok: false, reason: "스윕 값을 계산할 수 없습니다(범위가 너무 큼)." };
  // 서로 다른 값 문자열이 되도록 유효숫자를 늘려 가며 만든다.
  let texts = null;
  let textDigits = 3;
  for (let digits = 3; digits <= 12; digits += 1) {
    const candidate = raw.map((value) => formatSIValue(value, digits));
    const parsed = candidate.map((text) => parseNumber(text, "스윕 값"));
    if (parsed.some((entry) => !entry.ok)) return { ok: false, reason: parsed.find((entry) => !entry.ok).reason };
    const values = parsed.map((entry) => entry.value);
    const distinct = new Set(candidate).size === candidate.length;
    // 정밀도가 충분한지(목표값과 1e-3 이내) + 구분 가능한지
    const accurate = values.every((value, i) => raw[i] === 0 ? value === 0 : Math.abs(value - raw[i]) <= Math.abs(raw[i]) * 1e-3);
    if (distinct && accurate) { texts = candidate; textDigits = digits; break; }
  }
  if (!texts) return { ok: false, reason: "스윕 값을 서로 구분되는 값으로 만들 수 없습니다." };
  const values = texts.map((text, index) => {
    const value = parseValue(text);
    return {
      index,
      value,
      text,
      label: `${ref ? `${ref} = ` : ""}${engineering(value, unit, Math.max(4, textDigits))}`, // 값 문자열이 구분되는 유효숫자만큼 표시해 라벨도 구분
      isBase: base !== null && Math.abs(value - base) <= Math.abs(base) * 1e-9,
    };
  });
  if (POSITIVE_TYPES.has(type) && values.some((entry) => !(entry.value > 0))) return { ok: false, reason: `${ref || type} 값은 0보다 커야 합니다.` };
  return { ok: true, scale, count, values };
}

/** 부품에서 스윕 가능한 속성 목록 [{key, label, unit}] */
export function sweepableProps(component) {
  if (!component) return [];
  const p = component.props ?? {};
  switch (component.type) {
    case "R": return [{ key: "value", label: "저항", unit: "Ω" }];
    case "C": return [{ key: "value", label: "커패시턴스", unit: "F" }];
    case "L": return [{ key: "value", label: "인덕턴스", unit: "H" }];
    case "V":
    case "I": {
      const unit = component.type === "V" ? "V" : "A";
      const props = [];
      const mode = p.mode ?? "DC";
      if (mode === "DC") props.push({ key: "dc", label: "DC 값", unit });
      if (mode === "SIN") props.push({ key: "amplitude", label: "peak 진폭", unit }, { key: "frequency", label: "SIN 주파수", unit: "Hz" });
      if (mode === "PULSE") props.push({ key: "pulseV2", label: "PULSE 높은 값", unit });
      props.push({ key: "acMagnitude", label: "AC peak 크기", unit });
      return props;
    }
    case "OPAMP": return [{ key: "gain", label: "개방루프 이득", unit: "" }];
    default: return [];
  }
}

/** 회로 사본에 값을 넣는다. 반환 {ok, circuit} | {ok:false, reason}. 원본은 변경하지 않는다. */
export function applySweepValue(circuit, componentId, key, text) {
  const component = circuit?.components?.find((item) => item.id === componentId);
  if (!component) return { ok: false, reason: "스윕할 부품을 찾을 수 없습니다." };
  if (!sweepableProps(component).some((prop) => prop.key === key)) return { ok: false, reason: `${component.props?.ref ?? component.id}의 '${key}' 속성은 스윕할 수 없습니다.` };
  const parsed = parseNumber(text, "스윕 값");
  if (!parsed.ok) return { ok: false, reason: parsed.reason };
  if ((POSITIVE_TYPES.has(component.type) || key === "frequency") && !(parsed.value > 0)) return { ok: false, reason: "이 속성은 0보다 큰 값이어야 합니다." };
  const copy = structuredClone(circuit);
  const target = copy.components.find((item) => item.id === componentId);
  target.props = { ...(target.props ?? {}), [key]: text };
  return { ok: true, circuit: copy };
}

/** plan.values 각각에 대한 회로 사본 [{index, text, label, circuit}] — 호출 측이 이것으로 해석을 실행한다. */
export function buildSweepCircuits(circuit, componentId, key, plan) {
  if (!plan?.ok) return { ok: false, reason: plan?.reason ?? "스윕 계획이 없습니다." };
  const entries = [];
  for (const value of plan.values) {
    const applied = applySweepValue(circuit, componentId, key, value.text);
    if (!applied.ok) return applied;
    entries.push({ index: value.index, text: value.text, label: value.label, circuit: applied.circuit });
  }
  return { ok: true, entries };
}

/** 자기 속성만 읽는다("toString" 같은 상속 키가 함수로 새어 나오지 않게). */
const own = (object, key) => (object !== null && typeof object === "object" && Object.hasOwn(object, key) ? object[key] : undefined);

function unwrapResult(entry) {
  if (!entry) return { error: "해석 결과가 없습니다." };
  if (entry.ok === false) return { error: entry.reason ?? entry.error?.message ?? "해석에 실패했습니다." };
  if (entry.error && !entry.points) return { error: entry.error?.message ?? String(entry.error) };
  const result = entry.result ?? entry;
  if (!result?.points?.length) return { error: "해석 결과가 비어 있습니다." };
  return { result };
}

function rawSeries(result, probe) {
  if (probe.kind === "voltage") {
    const node = probe.junctionId !== undefined
      ? own(result.topology?.nodeIdByJunction, probe.junctionId)
      : own(result.topology?.nodeIdByPin, `${probe.componentId}:${probe.pin}`);
    if (!Number.isInteger(node)) return { error: "프로브 노드가 이 결과에 없습니다." };
    const raw = result.points.map((point) => own(point?.nodeVoltages, node));
    if (raw.some((value) => value === undefined)) return { error: "프로브 노드 전압이 이 결과에 없습니다." };
    return { raw, baseUnit: "V" };
  }
  if (probe.kind === "current") {
    const raw = result.points.map((point) => own(point?.componentCurrents, probe.componentId));
    if (raw.some((value) => value === undefined)) return { error: "프로브 부품 전류가 이 결과에 없습니다." };
    return { raw, baseUnit: "A" };
  }
  return { error: "지원하지 않는 프로브 종류입니다." };
}

/**
 * N개 해석 결과를 한 프로브의 오버레이 시리즈로 병합.
 *   plan: planSweep 결과, results: plan.values와 같은 순서의 엔진 결과(또는 {ok:false, reason}/null — 건너뜀)
 *   probe: 프로젝트 probe {key, kind:"voltage"|"current", componentId, pin | junctionId, label, color}
 *   options: {acView:"magnitude"|"phase", palette}
 * 반환: {ok, analysis, sharedX, xValues, series:[{key, label, color, sweepIndex, sweepText, sweepValue, quantity, unit, baseUnit, xValues, raw, values}], skipped:[{index, label, reason}]}
 *   - 시리즈 라벨: `${probe.label} @ ${스윕 라벨}` (스윕 값마다 서로 다름), 색: 팔레트를 index 순서로 (서로 다름)
 *   - AC: acView에 따라 dB 크기(quantity dBV/dBA) 또는 위상(°)
 */
export function mergeSweepResults({ plan, results, probe, acView = "magnitude", palette = SWEEP_COLORS } = {}) {
  if (!plan?.ok || !Array.isArray(results)) return { ok: false, reason: "스윕 계획과 결과가 필요합니다.", series: [], skipped: [] };
  if (!probe) return { ok: false, reason: "프로브를 선택하세요.", series: [], skipped: [] };
  const series = [];
  const skipped = [];
  let analysis = null;
  plan.values.forEach((entry, index) => {
    const label = entry.label;
    const unwrapped = unwrapResult(results[index]);
    if (unwrapped.error) { skipped.push({ index, label, reason: unwrapped.error }); return; }
    const { result } = unwrapped;
    const extracted = rawSeries(result, probe);
    if (extracted.error) { skipped.push({ index, label, reason: extracted.error }); return; }
    analysis ??= result.analysis;
    let values;
    let unit = extracted.baseUnit;
    let quantity = extracted.baseUnit;
    if (result.analysis === "ac" || result.analysis === "ac-point") {
      if (acView === "phase") { values = extracted.raw.map(acPhaseDegrees); unit = "°"; quantity = "°"; }
      else {
        const levels = extracted.raw.map((value) => acMagnitudeLevel(value, extracted.baseUnit));
        values = levels.map((level) => level.value);
        unit = quantity = levels[0].unit;
      }
    } else values = extracted.raw.slice();
    series.push({
      key: `${probe.key ?? probe.label}#sweep${index}`,
      label: `${probe.label} @ ${label}`,
      color: palette[index % palette.length],
      sweepIndex: index,
      sweepText: entry.text,
      sweepValue: entry.value,
      quantity,
      unit,
      baseUnit: extracted.baseUnit,
      xValues: result.xValues.slice(),
      raw: extracted.raw,
      values,
    });
  });
  if (!series.length) return { ok: false, reason: skipped[0]?.reason ?? "병합할 결과가 없습니다.", analysis, series, skipped };
  const first = series[0].xValues;
  const sharedX = series.every((item) => item.xValues.length === first.length && item.xValues.every((value, i) => value === first[i]));
  return { ok: true, analysis, sharedX, xValues: first, series, skipped };
}

/**
 * 인스펙터의 "스윕" 대상: R·C·L의 값과 간략 OP AMP의 개방루프 이득만 (그 외 부품은 null).
 * 반환: {componentId, ref, type, key, unit, base} — base는 현재 값 문자열.
 */
export function sweepTarget(component) {
  if (!component || !["R", "C", "L", "OPAMP"].includes(component.type)) return null;
  const prop = sweepableProps(component)[0];
  if (!prop) return null;
  return {
    componentId: component.id,
    ref: component.props?.ref ?? component.id,
    type: component.type,
    key: prop.key,
    unit: prop.unit,
    base: String(component.props?.[prop.key] ?? ""),
  };
}

/** 시작·끝 입력 칸이 비어 있을 때 쓰이는 기본값(현재 값의 1/10 ~ 10배) 문자열. 기준값이 양수가 아니면 null. */
export function sweepDefaults(base) {
  const parsed = parseNumber(base, "현재 값");
  if (!parsed.ok || !(parsed.value > 0)) return null;
  const from = formatSIValue(parsed.value / 10);
  const to = formatSIValue(parsed.value * 10);
  return Number.isFinite(parsed.value * 10) ? { from, to } : null;
}
