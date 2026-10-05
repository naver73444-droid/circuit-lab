import { parseValue } from "./circuit-engine.js";

const PASSIVE_RANGES = { R: [0, 6], C: [-12, -3], L: [-9, 1] };

export function sourceInlineDescriptor(component, analysis) {
  const props = component.props ?? {};
  if (component.type === "VCVS") return { prop: "g", label: "전압 이득", unit: "V/V", value: props.g ?? "1" };
  if (component.type === "VCCS") return { prop: "gm", label: "상호컨덕턴스", unit: "S", value: props.gm ?? "1mS" };
  if (component.type === "CCCS") return { prop: "beta", label: "전류 이득", unit: "A/A", value: props.beta ?? "1" };
  if (component.type === "CCVS") return { prop: "rm", label: "전달저항", unit: "Ω", value: props.rm ?? "1k" };
  const unit = component.type === "I" ? "A" : "V";
  const mode = props.mode ?? "DC";
  if (analysis === "ac") return { prop: "acMagnitude", label: "AC peak", unit: `${unit}pk`, value: props.acMagnitude ?? "0" };
  if (analysis === "dc") return { prop: "dc", label: "DC bias", unit, value: props.dc ?? "0" };
  if (mode === "SIN") return { prop: "amplitude", label: "SIN peak", unit: `${unit}pk`, value: props.amplitude ?? "0" };
  if (mode === "PULSE") return { prop: "pulseV2", label: "PULSE high", unit, value: props.pulseV2 ?? "0" };
  return { prop: "dc", label: "DC level", unit, value: props.dc ?? "0" };
}

export function controlledSourceInputModel(type, input) {
  if (!["VCVS", "VCCS", "CCCS", "CCVS"].includes(type)) return null;
  const normalized = String(input ?? "").trim().replaceAll("Ω", "ohm").replaceAll("µ", "u").replaceAll("μ", "u");
  if (normalized === "" || normalized === "+" || normalized === "-" || /[eE][+-]?$/.test(normalized)) return { status: "editing" };
  const number = "[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?";
  const pattern = type === "VCVS" || type === "CCCS"
    ? new RegExp(`^${number}(?:meg|[TGMkmunpf])?$`)
    : type === "VCCS"
      ? new RegExp(`^${number}(?:(?:meg|[TGMkmunpf])?S|meg|[TGMkmunpf])?$`)
      : new RegExp(`^${number}(?:(?:meg|[TGMkmunpf])?(?:ohm)?|ohm)?$`);
  if (!pattern.test(normalized)) return { status: "invalid" };
  try { return { status: "valid", value: parseValue(normalized) }; }
  catch { return { status: "invalid" }; }
}

export function controlReferenceModel(circuit, component) {
  if (!["CCCS", "CCVS"].includes(component?.type)) return null;
  const targets = (circuit?.components ?? [])
    .filter((item) => item.type === "V" || item.type === "CURRENT_SENSOR")
    .map((item) => ({ id: item.id, label: item.props?.ref ?? item.id, type: item.type }));
  const control = component.control;
  if (!control || control.kind !== "branchCurrent" || typeof control.elementId !== "string" || ![-1, 1].includes(control.direction)) {
    return { status: "invalid", reason: "제어 대상과 방향을 선택하세요.", targets };
  }
  const target = (circuit.components ?? []).find((item) => item.id === control.elementId);
  if (!target) return { status: "missing", reason: `삭제되거나 없는 제어 ID: ${control.elementId}`, targets };
  if (!["V", "CURRENT_SENSOR"].includes(target.type)) return { status: "wrong-type", reason: "센서 또는 독립 전압원만 제어할 수 있습니다.", targets };
  return { status: "valid", target, targets, direction: control.direction };
}

function portQuantity(value, unit) {
  if (!value || value.kind === "undefined") return { text: "미정", detail: value?.reason ?? "계산할 수 없습니다." };
  if (value.kind === "infinite") return { text: `∞ ${unit}`, detail: "검증된 이상 전류원형" };
  if (value.kind === "zero") return { text: `0 ${unit}`, detail: "이상 전압원형" };
  const magnitude = Number(value.value);
  if (!Number.isFinite(magnitude)) return { text: "미정", detail: "비유한 수치는 표시하지 않습니다." };
  return { text: `${magnitude.toLocaleString("ko-KR", { maximumSignificantDigits: 7 })} ${unit}`, detail: "유한값" };
}

export function formatPortResult(result) {
  if (!result?.equivalent) return null;
  const vth = portQuantity(result.equivalent.vth, "V");
  const rth = portQuantity(result.equivalent.rth, "Ω");
  const inorton = portQuantity(result.equivalent.in, "A");
  const details = [];
  if (result.classification === "ideal-voltage") {
    details.push("이상 전압원형 · Rth=0 Ω");
    details.push(`단락전류 미정 · ${inorton.detail}`);
    if (result.trials?.short?.status === "error") details.push(`단락 시험 불가 (${result.trials.short.error.code}) · ${result.trials.short.error.message}`);
  }
  if (result.classification === "ideal-current") {
    details.push("이상 전류원형 · Rth=∞ Ω");
    details.push(`개방전압 미정 · ${vth.detail}`);
    if (result.trials?.open?.status === "error") details.push(`개방 시험 불가 (${result.trials.open.error.code}) · ${result.trials.open.error.message}`);
  }
  return {
    vth,
    rth,
    in: inorton,
    classification: result.classification,
    equation: result.directions?.equation ?? "V=Vth+Rth·I_into=Vth−Rth·I_load",
    details,
  };
}

export function passiveSliderModel(type, value) {
  if (!Object.hasOwn(PASSIVE_RANGES, type)) return null;
  try {
    const numeric = parseValue(value);
    if (!(numeric > 0)) return null;
    const [min, max] = PASSIVE_RANGES[type];
    const exponent = Math.log10(numeric);
    return { min, max, value: Math.max(min, Math.min(max, exponent)), outside: exponent < min || exponent > max };
  } catch {
    return null;
  }
}

export function probeKeysForTarget(probes, target) {
  return probes.filter((probe) => {
    if (target.kind === "chip") return probe.key === target.key;
    if (target.kind === "component") return probe.kind === "current" && probe.componentId === target.componentId;
    if (target.kind === "pin") return probe.kind === "voltage" && probe.componentId === target.componentId && probe.pin === target.pin;
    if (target.kind === "wire") return probe.kind === "voltage" && probe.wireId === target.wireId;
    if (target.kind === "junction") return probe.kind === "voltage" && probe.junctionId === target.junctionId;
    return false;
  }).map((probe) => probe.key);
}

export function removeProbeByKey(probes, key) {
  return probes.filter((probe) => probe.key !== key);
}

export function nextAvailableProbeColor(palette, probes) {
  const used = new Set(probes.map((probe) => probe.color));
  return palette.find((color) => !used.has(color)) ?? palette[probes.length % palette.length];
}
