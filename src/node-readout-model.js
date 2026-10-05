/**
 * 호버 판독(readout) 모델 — 핀/노드/배선/접속점의 전압, 부품의 전류·전압·전력. DOM 없음.
 *
 * 핀→노드 매핑은 엔진과 동일하게 result.topology(= buildTopology 결과의 nodeIdByPin / nodeIdByJunction)를
 * 쓰고, result.topology가 없을 때만 buildTopology(circuit)로 다시 계산한다.
 *
 * 부호 규칙(엔진과 동일): 2단자 부품의 전류는 pin 1→pin 2 방향(양수), 전압은 V(pin1) − V(pin2).
 * 수동 부호 규칙이므로 p = v·i > 0 이면 소비(흡수), < 0 이면 공급.
 * AC는 페이저이며 크기는 peak(최댓값) 기준이다(앱의 AC 설정과 동일).
 */
import { buildTopology, pinCount } from "./circuit-engine.js";
import { currentDirectionDescriptor } from "./current-direction.js";
import { acMagnitudeLevel, acPhaseDegrees } from "./measurement-format.js";
import { engineering, nearestSampleIndex } from "./scope-model.js";

const TYPE_NAMES = {
  R: "저항", C: "커패시터", L: "인덕터", V: "전압원", I: "전류원", D: "다이오드", GND: "접지",
  OPAMP: "OP AMP", OPAMP_IDEAL: "이상 OP AMP", VCVS: "VCVS", VCCS: "VCCS", CURRENT_SENSOR: "전류 센서", CCCS: "CCCS", CCVS: "CCVS",
};

const isComplex = (value) => value !== null && typeof value === "object" && Number.isFinite(value.re) && Number.isFinite(value.im);
const fail = (reason) => ({ ok: false, reason });

function refOf(component) {
  return component?.props?.ref ?? component?.id ?? "?";
}

/** {nodeIdByPin, nodeIdByJunction} — result.topology 우선, 없으면 회로에서 계산(실패하면 null). */
export function topologyFor(circuit, result) {
  if (result?.topology?.nodeIdByPin) return { nodeIdByPin: result.topology.nodeIdByPin, nodeIdByJunction: result.topology.nodeIdByJunction ?? {}, source: "result" };
  try {
    const topology = buildTopology(circuit);
    return { nodeIdByPin: topology.nodeIdByPin, nodeIdByJunction: topology.nodeIdByJunction, source: "circuit" };
  } catch {
    return null;
  }
}

/**
 * target: {kind:"pin", componentId, pin} | {kind:"junction", junctionId} | {kind:"wire", wireId} | {kind:"node", nodeId}
 * 반환: nodeId(number) | null
 */
export function nodeIdForTarget(circuit, result, target) {
  if (!target) return null;
  if (target.kind === "node") return Number.isInteger(target.nodeId) ? target.nodeId : null;
  const topology = topologyFor(circuit, result);
  if (!topology) return null;
  const byEndpoint = (endpoint) => {
    if (!endpoint) return null;
    const node = endpoint.junctionId !== undefined ? topology.nodeIdByJunction[endpoint.junctionId] : topology.nodeIdByPin[`${endpoint.componentId}:${endpoint.pin}`];
    return node ?? null;
  };
  if (target.kind === "pin") return byEndpoint({ componentId: target.componentId, pin: target.pin });
  if (target.kind === "junction") return byEndpoint({ junctionId: target.junctionId });
  if (target.kind === "wire") {
    const wire = circuit?.wires?.find((item) => item.id === target.wireId);
    return wire ? (byEndpoint(wire.a) ?? byEndpoint(wire.b)) : null;
  }
  return null;
}

/** 노드에 연결된 핀 목록 ["R1.2", "C1.1", …] (1부터 세는 핀 번호). */
export function pinsOnNode(circuit, result, nodeId, limit = 4) {
  const topology = topologyFor(circuit, result);
  if (!topology) return [];
  const byId = new Map((circuit?.components ?? []).map((component) => [component.id, component]));
  const labels = [];
  for (const component of circuit?.components ?? []) {
    if (component.type === "GND") continue;
    for (let pin = 0; pin < pinCount(component.type); pin += 1) {
      if (topology.nodeIdByPin[`${component.id}:${pin}`] === nodeId) labels.push(`${refOf(byId.get(component.id))}.${pin + 1}`);
    }
  }
  return labels.length > limit ? [...labels.slice(0, limit), `외 ${labels.length - limit}개`] : labels;
}

/**
 * 시점 선택. selection: {index} 또는 {x}(가장 가까운 표본). 생략하면 첫 표본(DC/단일 페이저는 항상 0).
 * 반환: {index, x, mode, xText} | null   mode: "dc" | "transient" | "ac"
 */
export function resolveSample(result, selection = {}) {
  if (!result?.points?.length) return null;
  const mode = result.analysis === "dc" ? "dc" : result.analysis === "transient" ? "transient" : "ac";
  const xValues = result.xValues ?? [];
  let index;
  if (mode === "dc" || result.analysis === "ac-point" || result.points.length === 1) index = 0;
  else if (Number.isFinite(selection.x)) index = nearestSampleIndex(xValues, selection.x);
  else index = Number.isInteger(selection.index) ? selection.index : 0;
  if (!Number.isInteger(index) || index < 0 || index >= result.points.length) return null;
  const x = xValues[index];
  const xText = mode === "dc" ? "직류 동작점" : mode === "transient" ? `t = ${engineering(x, "s")}` : `f = ${engineering(x, "Hz")}`;
  return { index, x, mode, xText };
}

function phasorInfo(value, baseUnit) {
  const magnitude = Math.hypot(value.re, value.im);
  const phaseDeg = acPhaseDegrees(value);
  const level = magnitude > 0 ? acMagnitudeLevel(value, baseUnit) : { value: Number.NEGATIVE_INFINITY, unit: baseUnit === "V" ? "dBV" : "dBA" };
  const text = phaseDeg === null
    ? `0 ${baseUnit}`
    : `${engineering(magnitude, baseUnit)} ∠ ${Number(phaseDeg.toPrecision(4))}°`;
  return { re: value.re, im: value.im, magnitude, phaseDeg, level: level.value, levelUnit: level.unit, levelText: engineering(level.value, level.unit), text };
}

/** 실수 또는 복소 값을 {value, unit, text, phasor?} 로. AC면 value는 크기(peak). */
function quantity(value, unit) {
  if (isComplex(value)) {
    const phasor = phasorInfo(value, unit);
    return { value: phasor.magnitude, unit, text: phasor.text, phasor };
  }
  return { value, unit, text: engineering(value, unit) };
}

function csub(a, b) { return { re: a.re - b.re, im: a.im - b.im }; }

function nodeValue(point, nodeId) {
  const value = point?.nodeVoltages?.[nodeId];
  return value === undefined ? null : value;
}

/** 핀/노드/배선/접속점 호버: 노드 전압. */
export function nodeReadout({ circuit, result, target, index, x } = {}) {
  const sample = resolveSample(result, { index, x });
  if (!sample) return fail("표시할 해석 결과가 없거나 시점이 범위를 벗어났습니다.");
  const nodeId = nodeIdForTarget(circuit, result, target);
  if (nodeId === null) return fail("이 위치는 전기적으로 연결된 노드가 아닙니다(미배선 또는 해석에 포함되지 않음).");
  const value = nodeValue(result.points[sample.index], nodeId);
  if (value === null) return fail("이 노드의 해석 값이 없습니다.");
  const voltage = quantity(value, "V");
  const pins = pinsOnNode(circuit, result, nodeId);
  const title = nodeId === 0 ? "GND (기준 노드)" : `노드 N${nodeId}${pins.length ? ` · ${pins.join(", ")}` : ""}`;
  const lines = [`전압 ${voltage.text}`];
  if (voltage.phasor) lines.push(`${voltage.phasor.levelText}`);
  lines.push(sample.xText);
  return {
    ok: true,
    kind: "node",
    nodeId,
    title,
    pins,
    mode: sample.mode,
    sample,
    voltage,
    lines,
    text: `${title} — ${lines.join(" · ")}`,
  };
}

function powerEntry(component, voltage, current, mode) {
  if (mode === "ac") {
    if (component.type !== "R" || !isComplex(voltage) || !isComplex(current)) return null;
    // 평균 전력 = ½·Re(V·I*) (V, I 가 peak 페이저일 때)
    const value = 0.5 * (voltage.re * current.re + voltage.im * current.im);
    return { value, unit: "W", text: engineering(value, "W"), label: "평균 소비 전력(peak 페이저 기준 ½·Re(V·I*))", kind: "dissipated" };
  }
  if (!["R", "V", "I", "D", "C", "L"].includes(component.type)) return null;
  if (!Number.isFinite(voltage) || !Number.isFinite(current)) return null;
  const value = voltage * current;
  if (component.type === "R") return { value, unit: "W", text: engineering(value, "W"), label: "소비 전력", kind: "dissipated" };
  const kind = Math.abs(value) < 1e-15 ? "none" : value > 0 ? "absorbed" : "supplied";
  const label = kind === "supplied" ? "공급 전력" : kind === "absorbed" ? "흡수 전력" : "전력";
  return { value, unit: "W", text: `${engineering(Math.abs(value), "W")}`, label, kind, signed: value };
}

/** 부품 호버: 전류, 양단 전압, (저항·2단자 소자) 전력, 핀별 전압. */
export function componentReadout({ circuit, result, componentId, index, x } = {}) {
  const sample = resolveSample(result, { index, x });
  if (!sample) return fail("표시할 해석 결과가 없거나 시점이 범위를 벗어났습니다.");
  const component = circuit?.components?.find((item) => item.id === componentId);
  if (!component) return fail("부품을 찾을 수 없습니다.");
  const point = result.points[sample.index];
  const topology = topologyFor(circuit, result);
  const ref = refOf(component);
  const title = `${ref} (${TYPE_NAMES[component.type] ?? component.type})`;
  const pins = [];
  for (let pin = 0; pin < pinCount(component.type); pin += 1) {
    const nodeId = topology?.nodeIdByPin[`${component.id}:${pin}`];
    const raw = nodeId === undefined ? null : nodeValue(point, nodeId);
    pins.push({ pin, label: `${ref}.${pin + 1}`, nodeId: nodeId ?? null, voltage: raw === null ? null : quantity(raw, "V") });
  }
  const base = { ok: true, kind: "component", componentId, ref, type: component.type, title, mode: sample.mode, sample, pins };
  if (component.type === "GND") {
    return { ...base, current: null, voltage: quantity(sample.mode === "ac" ? { re: 0, im: 0 } : 0, "V"), power: null, lines: ["기준 전위 0 V", sample.xText], text: `${title} — 기준 전위 0 V` };
  }

  const descriptor = currentDirectionDescriptor(component);
  const rawCurrent = point?.componentCurrents?.[component.id];
  const current = rawCurrent === undefined ? null : { ...quantity(rawCurrent, "A"), direction: descriptor?.label ?? "" };

  let rawVoltage = null;
  let voltageLabel = "";
  if (pins.length >= 2 && component.type !== "OPAMP" && component.type !== "OPAMP_IDEAL") {
    const a = pins[0].nodeId === null ? null : nodeValue(point, pins[0].nodeId);
    const b = pins[1].nodeId === null ? null : nodeValue(point, pins[1].nodeId);
    if (a !== null && b !== null) rawVoltage = isComplex(a) ? csub(a, b) : a - b;
    voltageLabel = `V(${ref}.1) − V(${ref}.2)`;
  } else if (pins.length === 3) {
    // OP AMP: 출력 핀(3번) 전압을 기준(GND) 대비로 표시
    rawVoltage = pins[2].nodeId === null ? null : nodeValue(point, pins[2].nodeId);
    voltageLabel = `V(${ref}.3) 출력`;
  }
  const voltage = rawVoltage === null ? null : { ...quantity(rawVoltage, "V"), label: voltageLabel };
  const power = rawVoltage !== null && rawCurrent !== undefined && pins.length === 2 ? powerEntry(component, rawVoltage, rawCurrent, sample.mode) : null;

  const lines = [];
  if (current) lines.push(`전류 ${current.text}${current.direction ? ` (${current.direction})` : ""}`);
  if (voltage) lines.push(`전압 ${voltage.text}`);
  if (power) lines.push(`${power.label} ${power.text}`);
  lines.push(sample.xText);
  return { ...base, current, voltage, power, lines, text: `${title} — ${lines.join(" · ")}` };
}

/**
 * 한 번에: target.kind 가 "component" 면 부품 판독, 그 외(pin/junction/wire/node)는 노드 판독.
 *   target: {kind:"component", componentId} | {kind:"pin", componentId, pin} | …
 */
export function hoverReadout({ circuit, result, target, index, x } = {}) {
  if (target?.kind === "component") return componentReadout({ circuit, result, componentId: target.componentId, index, x });
  return nodeReadout({ circuit, result, target, index, x });
}
