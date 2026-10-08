import { CircuitError, deserializeCircuit, parseValue, pinCount, serializeCircuit } from "./circuit-engine.js";
import { isSafeColor } from "./safe-dom.js";
import { sanitizeCurrentReferences } from "./current-direction.js";

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function importedNumber(settings, key, { positive = false, nonnegative = false } = {}) {
  let value;
  try {
    value = parseValue(settings[key], `분석 설정 ${key}`);
  } catch {
    throw new CircuitError("INVALID_FILE", `분석 설정 ${key}이(가) 유효한 수가 아닙니다.`);
  }
  if ((positive && !(value > 0)) || (nonnegative && value < 0)) {
    throw new CircuitError("INVALID_FILE", `분석 설정 ${key}의 범위가 올바르지 않습니다.`);
  }
  return value;
}

export function validateProjectSettings(settings, importedKeys = new Set(Object.keys(settings ?? {}))) {
  if (!plainObject(settings)) throw new CircuitError("INVALID_FILE", "분석 설정이 올바른 객체가 아닙니다.");
  if (settings.analysis !== undefined && !["dc", "transient", "ac"].includes(settings.analysis)) {
    throw new CircuitError("INVALID_FILE", "지원하지 않는 분석 설정입니다.");
  }
  if (settings.analysis === "transient") {
    const start = importedKeys.has("start") ? importedNumber(settings, "start", { nonnegative: true }) : undefined;
    const end = importedKeys.has("end") ? importedNumber(settings, "end") : undefined;
    if (importedKeys.has("step")) importedNumber(settings, "step", { positive: true });
    if (start !== undefined && end !== undefined && !(end > start)) throw new CircuitError("INVALID_FILE", "transient 종료시간은 시작시간보다 커야 합니다.");
  }
  if (settings.analysis === "ac") {
    const start = importedKeys.has("startFrequency") ? importedNumber(settings, "startFrequency", { positive: true }) : undefined;
    const end = importedKeys.has("endFrequency") ? importedNumber(settings, "endFrequency", { positive: true }) : undefined;
    if (importedKeys.has("pointsPerDecade")) importedNumber(settings, "pointsPerDecade", { positive: true });
    if (importedKeys.has("phasorFrequency")) importedNumber(settings, "phasorFrequency", { positive: true });
    if (start !== undefined && end !== undefined && end < start) throw new CircuitError("INVALID_FILE", "AC 끝 주파수는 시작 주파수 이상이어야 합니다.");
  }
  return settings;
}

export function serializeProject(project) {
  const components = project.circuit?.components ?? [];
  const version = components.some((component) => ["COUPLED_L", "XFMR_IDEAL"].includes(component.type))
    ? 4
    : components.some((component) => ["CURRENT_SENSOR", "CCCS", "CCVS"].includes(component.type))
    ? 3
    : components.some((component) => component.type === "VCVS" || component.type === "VCCS") ? 2 : 1;
  const circuit = JSON.parse(serializeCircuit({ ...project.circuit, version }));
  return JSON.stringify({
    format: "circuit-lab",
    version,
    title: project.title,
    subtitle: project.subtitle,
    circuit,
    settings: project.settings,
    probes: project.probes,
  }, null, 2);
}

export function deserializeProject(text, fallbackSettings = {}) {
  if (typeof text !== "string" || text.length > 4_000_000) throw new CircuitError("INVALID_FILE", "프로젝트 JSON은 4,000,000자 이내여야 합니다.");
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new CircuitError("INVALID_FILE", "JSON 파일을 읽을 수 없습니다.");
  }
  const wrapped = payload?.format === "circuit-lab";
  if (wrapped && ![1, 2, 3, 4].includes(payload.version)) throw new CircuitError("INVALID_FILE", "Circuit Lab 버전 1, 2, 3 또는 4 프로젝트 파일이 아닙니다.");
  if (wrapped && payload.circuit?.version !== payload.version) throw new CircuitError("INVALID_FILE", "프로젝트와 회로 version이 일치하지 않습니다.");
  if (wrapped && payload.settings !== undefined && !plainObject(payload.settings)) {
    throw new CircuitError("INVALID_FILE", "분석 설정이 올바른 객체가 아닙니다.");
  }
  if (wrapped && payload.probes !== undefined && !Array.isArray(payload.probes)) {
    throw new CircuitError("INVALID_FILE", "프로브 목록이 올바른 배열이 아닙니다.");
  }
  for (const key of ["title", "subtitle"]) {
    if (wrapped && payload[key] !== undefined && (typeof payload[key] !== "string" || payload[key].length > 2000)) throw new CircuitError("INVALID_FILE", `${key}은(는) 2000자 이내 문자열이어야 합니다.`);
  }
  const settings = { ...fallbackSettings };
  const settingKeys = ["analysis", "start", "end", "step", "startFrequency", "endFrequency", "pointsPerDecade", "phasorFrequency"];
  if (wrapped) for (const key of settingKeys) {
    if (payload.settings?.[key] === undefined) continue;
    const value = payload.settings[key];
    if ((typeof value !== "string" && typeof value !== "number") || String(value).length > 128 || (typeof value === "number" && !Number.isFinite(value))) throw new CircuitError("INVALID_FILE", `분석 설정 ${key}이(가) 올바르지 않습니다.`);
    if (key === "analysis" && !["dc", "transient", "ac"].includes(value)) throw new CircuitError("INVALID_FILE", "지원하지 않는 해석 종류입니다.");
    settings[key] = value;
  }
  if (wrapped) validateProjectSettings(settings, new Set(Object.keys(payload.settings ?? {})));
  const circuit = deserializeCircuit(JSON.stringify(wrapped ? payload.circuit : payload));
  // Optional display field (no version bump): flipCurrent / flipCurrent2 = true flips a part's shown current reference. Anything else is dropped.
  sanitizeCurrentReferences(circuit.components);
  const probes = wrapped ? structuredClone(payload.probes ?? []) : [];
  if (wrapped) {
    const componentIds = new Set(circuit.components.map((component) => component.id));
    const componentById = new Map(circuit.components.map((component) => [component.id, component]));
    const wireIds = new Set(circuit.wires.map((wire) => wire.id));
    const junctionIds = new Set((circuit.junctions ?? []).map((junction) => junction.id));
    const probeKeys = new Set();
    for (const probe of probes) {
      const validObject = plainObject(probe) && typeof probe.key === "string" && typeof probe.label === "string" && isSafeColor(probe.color) && probe.key.length <= 256 && probe.label.length <= 1000 && !probeKeys.has(probe.key);
      const component = componentById.get(probe?.componentId);
      const maximumPin = component ? pinCount(component.type) - 1 : -1;
      const hasComponentTarget = probe?.componentId !== undefined || probe?.pin !== undefined;
      const hasJunctionTarget = probe?.junctionId !== undefined;
      const validVoltage = probe?.kind === "voltage" && hasComponentTarget !== hasJunctionTarget && (
        (typeof probe.componentId === "string" && componentIds.has(probe.componentId) && Number.isInteger(probe.pin) && probe.pin >= 0 && probe.pin <= maximumPin) ||
        (typeof probe.junctionId === "string" && junctionIds.has(probe.junctionId))
      );
      const validCurrent = probe?.kind === "current" && typeof probe.componentId === "string" && componentIds.has(probe.componentId)
        && (probe.winding === undefined || (probe.winding === 2 && ["COUPLED_L", "XFMR_IDEAL"].includes(component?.type)));
      const validWire = probe?.wireId === undefined || probe.wireId === null || (typeof probe.wireId === "string" && wireIds.has(probe.wireId));
      if (!validObject || (!validVoltage && !validCurrent) || !validWire) {
        throw new CircuitError("INVALID_FILE", "프로브의 참조, 색 또는 고유 ID가 올바르지 않습니다.");
      }
      probeKeys.add(probe.key);
    }
  }
  return {
    wrapped,
    circuit,
    settings,
    probes,
    title: wrapped ? payload.title : undefined,
    subtitle: wrapped ? payload.subtitle : undefined,
  };
}
