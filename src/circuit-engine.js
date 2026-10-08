import { UnionFind } from "./union-find.js";

export class CircuitError extends Error {
  constructor(code, message, hint = "", details = null) {
    super(message);
    this.name = "CircuitError";
    this.code = code;
    this.hint = hint;
    this.details = details;
  }
}

const TYPE_PINS = {
  R: 2,
  C: 2,
  L: 2,
  V: 2,
  I: 2,
  D: 2,
  GND: 1,
  OPAMP: 3,
  OPAMP_IDEAL: 3,
  VCVS: 4,
  VCCS: 4,
  CURRENT_SENSOR: 2,
  CCCS: 2,
  CCVS: 2,
  COUPLED_L: 4,
  XFMR_IDEAL: 4,
};

const DEFAULTS = {
  R: { ref: "R", value: "1k" },
  C: { ref: "C", value: "1u", ic: "0" },
  L: { ref: "L", value: "10m", ic: "0" },
  V: {
    ref: "V",
    mode: "DC",
    dc: "5",
    amplitude: "5",
    frequency: "60",
    offset: "0",
    phase: "0",
    pulseV1: "0",
    pulseV2: "5",
    pulseDelay: "0",
    pulseRise: "0",
    pulseFall: "0",
    pulseWidth: "1",
    pulsePeriod: "2",
    acMagnitude: "1",
    acPhase: "0",
  },
  I: {
    ref: "I",
    mode: "DC",
    dc: "1m",
    amplitude: "1m",
    frequency: "60",
    offset: "0",
    phase: "0",
    pulseV1: "0",
    pulseV2: "1m",
    pulseDelay: "0",
    pulseRise: "0",
    pulseFall: "0",
    pulseWidth: "1",
    pulsePeriod: "2",
    acMagnitude: "1m",
    acPhase: "0",
  },
  D: { ref: "D", is: "1e-12", n: "1" },
  GND: { ref: "GND" },
  OPAMP: { ref: "U", gain: "100k" },
  OPAMP_IDEAL: { ref: "U" },
  VCVS: { ref: "E", g: "1" },
  VCCS: { ref: "G", gm: "1mS" },
  CURRENT_SENSOR: { ref: "S" },
  CCCS: { ref: "F", beta: "1" },
  CCVS: { ref: "H", rm: "1k" },
  // 자기결합: 핀 1a·1b(1차), 2a·2b(2차), 점은 1a와 2a. dots="opposite"이면 2차의 점이 2b로 옮겨진다.
  COUPLED_L: { ref: "K", L1: "10m", L2: "10m", coupling: "k", k: "0.5", M: "5m", dots: "same", ic1: "0", ic2: "0" },
  XFMR_IDEAL: { ref: "T", n: "2", dots: "same" },
};

export function componentDefaults(type, index = 1) {
  const base = DEFAULTS[type];
  if (!base) throw new CircuitError("UNKNOWN_COMPONENT", `지원하지 않는 부품 종류입니다: ${type}`);
  return { ...base, ref: `${base.ref}${type === "GND" ? "" : index}` };
}

export function pinCount(type) {
  return Object.hasOwn(TYPE_PINS, type) ? TYPE_PINS[type] : 0;
}

export const isKnownComponentType = (type) => typeof type === "string" && Object.hasOwn(TYPE_PINS, type);

/** Editing limits of one circuit; validateCircuitStructure() enforces them and paste checks them before it mutates anything. */
export const CIRCUIT_LIMITS = Object.freeze({ components: 256, wires: 2048, junctions: 1024 });

// Successful string parses only (failures embed the caller's label in their
// message, so they are never cached). Bounded; cleared wholesale when full.
const PARSE_VALUE_CACHE_LIMIT = 1024;
const parseValueCache = new Map();

export function parseValue(input, label = "값") {
  if (typeof input === "number") {
    if (!Number.isFinite(input)) throw new CircuitError("INVALID_VALUE", `${label}이(가) 유한한 수가 아닙니다.`);
    return input;
  }
  if (typeof input === "string") {
    const cached = parseValueCache.get(input);
    if (cached !== undefined) return cached;
    const parsed = parseValueUncached(input, label);
    if (parseValueCache.size >= PARSE_VALUE_CACHE_LIMIT) parseValueCache.clear();
    parseValueCache.set(input, parsed);
    return parsed;
  }
  return parseValueUncached(input, label);
}

function parseValueUncached(input, label) {
  const raw = String(input ?? "").trim().replaceAll("Ω", "ohm").replaceAll("µ", "u").replaceAll("μ", "u");
  const match = raw.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*([A-Za-z]*)$/);
  if (!match) throw new CircuitError("INVALID_VALUE", `${label} '${input}'을(를) 해석할 수 없습니다.`, "예: 1k, 10u, 5, 2.2meg");
  const numberParts = match[1].match(/^([+-]?)(\d+(?:\.\d*)?|\.\d+)(?:[eE]([+-]?\d+))?$/);
  const sign = numberParts[1];
  const mantissa = numberParts[2];
  let decimalExponent = BigInt(numberParts[3] ?? "0");
  let suffix = match[2];
  const isBareUnit = (value) => value === "F" || ["v", "a", "s", "hz", "h", "ohm", "deg"].includes(value.toLowerCase());
  if (!isBareUnit(suffix) && suffix !== "") {
    const lower = suffix.toLowerCase();
    if (lower.startsWith("meg")) {
      decimalExponent += 6n;
      suffix = suffix.slice(3);
    } else if (suffix.startsWith("M")) {
      decimalExponent += 6n;
      suffix = suffix.slice(1);
    } else {
      const prefix = lower[0] ?? "";
      const table = { t: 12n, g: 9n, k: 3n, m: -3n, u: -6n, n: -9n, p: -12n, f: -15n };
      if (Object.hasOwn(table, prefix)) {
        decimalExponent += table[prefix];
        suffix = suffix.slice(1);
      }
    }
  }
  const unit = suffix.toLowerCase();
  const knownUnits = ["", "v", "a", "s", "hz", "h", "f", "ohm", "deg"];
  if (!knownUnits.includes(unit)) throw new CircuitError("INVALID_VALUE", `${label}의 단위 '${suffix}'을(를) 지원하지 않습니다.`);
  const value = Number(`${sign}${mantissa}e${decimalExponent}`);
  const sourceIsZero = !/[1-9]/.test(mantissa);
  if (!Number.isFinite(value) || (!sourceIsZero && value === 0)) throw new CircuitError("INVALID_VALUE", `${label}이(가) 유한한 수가 아닙니다.`);
  return value;
}

function positiveValue(input, label) {
  const value = parseValue(input, label);
  if (!(value > 0)) throw new CircuitError("INVALID_VALUE", `${label}은(는) 0보다 커야 합니다.`);
  return value;
}

const COEFFICIENT_NUMBER = "[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?";
const COEFFICIENT_DIMENSIONLESS = new RegExp(`^${COEFFICIENT_NUMBER}(?:meg|[TGMkmunpf])?$`);
const COEFFICIENT_SIEMENS = new RegExp(`^${COEFFICIENT_NUMBER}(?:(?:meg|[TGMkmunpf])?S|meg|[TGMkmunpf])?$`);
const COEFFICIENT_OHMS = new RegExp(`^${COEFFICIENT_NUMBER}(?:(?:meg|[TGMkmunpf])?(?:ohm)?|ohm)?$`);

function controlledCoefficient(component) {
  const props = component.props ?? {};
  const specification = {
    VCVS: { key: "g", fallback: "1", label: "전압 이득 g", dimension: "dimensionless" },
    VCCS: { key: "gm", fallback: "1mS", label: "상호컨덕턴스 gm", dimension: "siemens" },
    CCCS: { key: "beta", fallback: "1", label: "전류 이득 beta", dimension: "dimensionless" },
    CCVS: { key: "rm", fallback: "1k", label: "전달저항 rm", dimension: "ohms" },
  }[component.type];
  if (!specification) throw new CircuitError("INVALID_VALUE", `${component.type}은(는) 종속원 계수 타입이 아닙니다.`);
  const input = props[specification.key] ?? specification.fallback;
  const label = `${props.ref ?? component.id} ${specification.label}`;
  const normalized = String(input ?? "").trim().replaceAll("Ω", "ohm").replaceAll("µ", "u").replaceAll("μ", "u");
  const pattern = specification.dimension === "dimensionless" ? COEFFICIENT_DIMENSIONLESS : specification.dimension === "siemens" ? COEFFICIENT_SIEMENS : COEFFICIENT_OHMS;
  if (!pattern.test(normalized)) {
    const hint = specification.dimension === "dimensionless" ? "예: 4, -2, 1k" : specification.dimension === "siemens" ? "예: 3m, 3mS, 20uS" : "예: 2k, 2kohm, 2kΩ";
    throw new CircuitError("INVALID_VALUE", `${label} '${input}'의 단위가 올바르지 않습니다.`, hint);
  }
  return parseValue(normalized, label);
}

/** The solver stores the second winding current of a 4-pin magnetic part next to the first one, under this key. */
export const secondaryCurrentKey = (componentId) => `${componentId}#2`;

const COUPLING_TOLERANCE = 1e-9;

function dotsSign(component) {
  const dots = component.props?.dots ?? "same";
  if (dots !== "same" && dots !== "opposite") throw new CircuitError("INVALID_VALUE", `${component.props?.ref ?? component.id}의 점 위치 '${dots}'을(를) 지원하지 않습니다.`, "same 또는 opposite");
  return dots === "opposite" ? -1 : 1;
}

/**
 * Parameters of a COUPLED_L part (Alexander-Sadiku 13.2~13.3). Dots sit on pins 1a and 2a; with dots="opposite" the
 * mutual inductance enters with the opposite sign (`mutual` = sign*M). `coupling` chooses which of k and M is the input.
 */
export function coupledInductorParameters(component) {
  const p = component.props ?? {};
  const label = p.ref ?? component.id;
  const L1 = positiveValue(p.L1 ?? "10m", `${label} L1`);
  const L2 = positiveValue(p.L2 ?? "10m", `${label} L2`);
  const root = Math.sqrt(L1 * L2);
  let k;
  let M;
  if (p.coupling === "M") {
    M = parseValue(p.M ?? "5m", `${label} 상호 인덕턴스 M`);
    if (M < 0 || M > root * (1 + COUPLING_TOLERANCE)) throw new CircuitError("INVALID_VALUE", `${label}의 M은 0 이상 √(L1·L2) 이하여야 합니다 (결합계수 k=M/√(L1L2)가 0~1).`, `현재 √(L1·L2) = ${Number(root.toPrecision(6))} H`);
    M = Math.min(M, root);
    k = M / root;
  } else {
    k = parseValue(p.k ?? "0.5", `${label} 결합계수 k`);
    if (!(k >= 0 && k <= 1)) throw new CircuitError("INVALID_VALUE", `${label}의 결합계수 k는 0 이상 1 이하여야 합니다.`, "k=1은 완전 결합이라 코일 방정식이 특이해질 수 있습니다. 필요하면 0.999처럼 1보다 작게 두세요.");
    M = k * root;
  }
  const sign = dotsSign(component);
  const ic1 = parseValue(p.ic1 ?? 0, `${label} 1차 초기 전류`);
  const ic2 = parseValue(p.ic2 ?? 0, `${label} 2차 초기 전류`);
  return { L1, L2, k, M, sign, mutual: sign * M, ic1, ic2 };
}

/** Parameters of an XFMR_IDEAL part: v2 = ratio*v1 and i1 = -ratio*i2 with ratio = ±n (both currents into the pins, dots on 1a and 2a). */
export function idealTransformerParameters(component) {
  const p = component.props ?? {};
  const n = positiveValue(p.n ?? "2", `${p.ref ?? component.id} 권수비 n`);
  const sign = dotsSign(component);
  return { n, sign, ratio: sign * n };
}

function validateBranchControl(component, componentsById) {
  const control = component.control;
  const label = component.props?.ref ?? component.id;
  if (!control || typeof control !== "object" || Array.isArray(control) || control.kind !== "branchCurrent" || typeof control.elementId !== "string" || ![-1, 1].includes(control.direction)) {
    throw new CircuitError("INVALID_CONTROL", `${label}의 제어 전류 참조가 올바르지 않습니다.`, "센서 또는 독립 전압원과 방향 ±1을 선택하세요.");
  }
  const target = componentsById.get(control.elementId);
  if (!target) throw new CircuitError("MISSING_CONTROL", `${label}의 제어 대상 '${control.elementId}'이(가) 없습니다.`, "대상을 다시 선택하세요. 삭제된 ID를 임의 대상이나 0 A로 바꾸지 않습니다.");
  if (!["V", "CURRENT_SENSOR"].includes(target.type)) throw new CircuitError("INVALID_CONTROL", `${label}의 제어 대상 ${target.props?.ref ?? target.id}은(는) 센서 또는 독립 전압원이 아닙니다.`);
  return target;
}


export function pinKey(componentId, pin) {
  return `pin:${componentId}:${pin}`;
}

function publicPinKey(componentId, pin) {
  return `${componentId}:${pin}`;
}

export function junctionKey(junctionId) {
  return `junction:${junctionId}`;
}

/** The one union-find key of a wire endpoint (pin or junction); every net resolver in the app uses it. */
export function endpointKey(endpoint) {
  return endpoint?.junctionId !== undefined ? junctionKey(endpoint.junctionId) : pinKey(endpoint?.componentId, endpoint?.pin);
}

function validateComponent(component) {
  if (!Object.hasOwn(TYPE_PINS, component.type)) throw new CircuitError("UNKNOWN_COMPONENT", `지원하지 않는 부품입니다: ${component.type}`);
  const p = component.props ?? {};
  if (component.type === "R") positiveValue(p.value, `${p.ref ?? component.id} 저항`);
  if (component.type === "C") {
    positiveValue(p.value, `${p.ref ?? component.id} 커패시턴스`);
    parseValue(p.ic ?? 0, `${p.ref ?? component.id} 초기 전압`);
  }
  if (component.type === "L") {
    positiveValue(p.value, `${p.ref ?? component.id} 인덕턴스`);
    parseValue(p.ic ?? 0, `${p.ref ?? component.id} 초기 전류`);
  }
  if (component.type === "D") {
    positiveValue(p.is ?? "1e-12", `${p.ref ?? component.id} Is`);
    positiveValue(p.n ?? "1", `${p.ref ?? component.id} n`);
  }
  if (component.type === "OPAMP") positiveValue(p.gain ?? "100k", `${p.ref ?? component.id} 개방루프 이득`);
  if (["VCVS", "VCCS", "CCCS", "CCVS"].includes(component.type)) controlledCoefficient(component);
  if (component.type === "COUPLED_L") coupledInductorParameters(component);
  if (component.type === "XFMR_IDEAL") idealTransformerParameters(component);
  if (component.type === "V" || component.type === "I") validateSource(component);
}

function validateSource(component) {
  const p = component.props ?? {};
  const label = p.ref ?? component.id;
  const mode = p.mode ?? "DC";
  if (!['DC', 'SIN', 'PULSE'].includes(mode)) throw new CircuitError("INVALID_SOURCE", `${label}의 소스 모드 '${mode}'을(를) 지원하지 않습니다.`);
  parseValue(p.dc ?? 0, `${label} DC`);
  parseValue(p.acMagnitude ?? 0, `${label} AC 크기`);
  parseValue(p.acPhase ?? 0, `${label} AC 위상`);
  if (mode === "SIN") {
    parseValue(p.offset ?? 0, `${label} 오프셋`);
    parseValue(p.amplitude ?? 0, `${label} 진폭`);
    positiveValue(p.frequency ?? 60, `${label} 주파수`);
    parseValue(p.phase ?? 0, `${label} 위상`);
  }
  if (mode === "PULSE") {
    parseValue(p.pulseV1 ?? 0, `${label} PULSE 초기값`);
    parseValue(p.pulseV2 ?? 0, `${label} PULSE 최종값`);
    const delay = parseValue(p.pulseDelay ?? 0, `${label} PULSE 지연`);
    const rise = parseValue(p.pulseRise ?? 0, `${label} PULSE 상승시간`);
    const fall = parseValue(p.pulseFall ?? 0, `${label} PULSE 하강시간`);
    const width = positiveValue(p.pulseWidth ?? 1, `${label} PULSE 폭`);
    const period = positiveValue(p.pulsePeriod ?? 2, `${label} PULSE 주기`);
    if (delay < 0 || rise < 0 || fall < 0) throw new CircuitError("INVALID_SOURCE", `${label}의 지연·상승·하강시간은 음수일 수 없습니다.`);
    if (period < rise + width + fall) throw new CircuitError("INVALID_SOURCE", `${label}의 PULSE 주기가 상승+폭+하강보다 짧습니다.`);
  }
}

export function validateCircuitStructure(circuit) {
  if (!circuit || typeof circuit !== "object" || !Array.isArray(circuit.components) || !Array.isArray(circuit.wires)) {
    throw new CircuitError("INVALID_FILE", "회로의 components와 wires 배열이 필요합니다.");
  }
  if (circuit.geometryVersion !== undefined && ![1, 2].includes(circuit.geometryVersion)) {
    throw new CircuitError("INVALID_FILE", `지원하지 않는 geometry version입니다: ${circuit.geometryVersion}`);
  }
  if (circuit.components.length > CIRCUIT_LIMITS.components || circuit.wires.length > CIRCUIT_LIMITS.wires || (circuit.junctions?.length ?? 0) > CIRCUIT_LIMITS.junctions) {
    throw new CircuitError("CIRCUIT_TOO_LARGE", "교육용 편집 한도(부품 256, 배선 2048, 접속점 1024)를 초과했습니다.", "회로를 작은 실험 단위로 나누세요. 데이터를 임의로 잘라 계산하지 않습니다.");
  }
  const componentsById = new Map();
  for (const component of circuit.components) {
    if (!component || typeof component !== "object" || typeof component.id !== "string" || component.id.length === 0) {
      throw new CircuitError("BAD_COMPONENT", "부품 ID가 없거나 올바른 문자열이 아닙니다.");
    }
    if (["__proto__", "prototype", "constructor"].includes(component.id) || component.id.length > 128) throw new CircuitError("BAD_COMPONENT", "부품 ID가 예약어이거나 너무 깁니다.");
    // "<id>#2" is the result key of a second winding current (secondaryCurrentKey), so a part id may not contain '#' or it could collide with it.
    if (component.id.includes("#")) throw new CircuitError("BAD_COMPONENT", `부품 ID에는 '#'를 쓸 수 없습니다 (두 번째 권선 전류 결과 키와 겹칩니다): ${component.id}`);
    for (const key of ["x", "y", "rotation"]) if (component[key] !== undefined && !Number.isFinite(component[key])) throw new CircuitError("BAD_COMPONENT", `${component.id}의 ${key}은(는) 유한한 수여야 합니다.`);
    if (componentsById.has(component.id)) throw new CircuitError("BAD_COMPONENT", `부품 ID가 중복됩니다: ${component.id}`);
    if (!Object.hasOwn(TYPE_PINS, component.type)) throw new CircuitError("UNKNOWN_COMPONENT", `지원하지 않는 부품입니다: ${component.type}`);
    if (component.props !== undefined && (component.props === null || typeof component.props !== "object" || Array.isArray(component.props))) {
      throw new CircuitError("BAD_COMPONENT", `${component.id}의 props가 올바른 객체가 아닙니다.`);
    }
    if (["VCVS", "VCCS", "CCCS", "CCVS"].includes(component.type)) controlledCoefficient(component);
    componentsById.set(component.id, component);
  }
  for (const component of circuit.components) if (component.type === "CCCS" || component.type === "CCVS") validateBranchControl(component, componentsById);
  const junctionIds = new Set();
  const junctions = circuit.junctions ?? [];
  if (!Array.isArray(junctions)) throw new CircuitError("BAD_JUNCTION", "junctions는 배열이어야 합니다.");
  for (const junction of junctions) {
    if (!junction || typeof junction.id !== "string" || !junction.id || junctionIds.has(junction.id)) {
      throw new CircuitError("BAD_JUNCTION", `접속점 ID가 없거나 중복됩니다: ${junction?.id ?? "(없음)"}`);
    }
    if (["__proto__", "prototype", "constructor"].includes(junction.id) || junction.id.length > 128) throw new CircuitError("BAD_JUNCTION", "접속점 ID가 예약어이거나 너무 깁니다.");
    if (!Number.isFinite(junction.x) || !Number.isFinite(junction.y)) {
      throw new CircuitError("BAD_JUNCTION", `${junction.id}의 좌표가 유한한 수가 아닙니다.`);
    }
    junctionIds.add(junction.id);
  }
  const wireIds = new Set();
  for (const wire of circuit.wires) {
    if (!wire || typeof wire !== "object" || typeof wire.id !== "string" || wire.id.length === 0 || wireIds.has(wire.id)) {
      throw new CircuitError("BAD_WIRE", `배선 ID가 없거나 중복됩니다: ${wire?.id ?? "(없음)"}`);
    }
    if (["__proto__", "prototype", "constructor"].includes(wire.id) || wire.id.length > 128) throw new CircuitError("BAD_WIRE", "배선 ID가 예약어이거나 너무 깁니다.");
    wireIds.add(wire.id);
    if (wire.waypoints !== undefined) {
      if (!Array.isArray(wire.waypoints) || wire.waypoints.some((point) => !point || !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
        throw new CircuitError("BAD_WIRE", `${wire.id}의 waypoint 좌표가 올바르지 않습니다.`);
      }
    }
    // anchors: the bend points the user clicked on an automatically routed wire (wire-router.js); same rule as waypoints.
    if (wire.anchors !== undefined && (!Array.isArray(wire.anchors) || wire.anchors.some((point) => !point || !Number.isFinite(point.x) || !Number.isFinite(point.y)))) {
      throw new CircuitError("BAD_WIRE", `${wire.id}의 경유점 좌표가 올바르지 않습니다.`);
    }
    for (const endpoint of [wire.a, wire.b]) {
      const hasAnyPinField = endpoint && (endpoint.componentId !== undefined || endpoint.pin !== undefined);
      const hasPin = endpoint && endpoint.componentId !== undefined && endpoint.pin !== undefined;
      const hasJunction = endpoint && endpoint.junctionId !== undefined;
      if ((hasJunction && hasAnyPinField) || (!hasJunction && !hasPin)) throw new CircuitError("BAD_WIRE", "배선 끝점은 핀 또는 접속점 하나만 참조해야 합니다.");
      if (hasJunction) {
        if (typeof endpoint.junctionId !== "string" || !junctionIds.has(endpoint.junctionId)) {
          throw new CircuitError("BAD_WIRE", `존재하지 않는 접속점입니다: ${endpoint.junctionId ?? "(없음)"}`);
        }
        continue;
      }
      const component = componentsById.get(endpoint.componentId);
      if (!component || !Number.isInteger(endpoint.pin) || endpoint.pin < 0 || endpoint.pin >= pinCount(component.type)) {
        throw new CircuitError("BAD_WIRE", `존재하지 않는 핀입니다: ${endpoint?.componentId ?? "(없음)"}:${endpoint?.pin ?? "(없음)"}`);
      }
    }
  }
  return circuit;
}

export function buildTopology(circuit) {
  validateCircuitStructure(circuit);
  const components = circuit.components;
  const wires = circuit.wires;
  const junctions = circuit.junctions ?? [];
  if (!components.some((component) => component.type === "GND")) {
    throw new CircuitError("NO_GROUND", "접지가 없습니다.", "회로에 GND를 하나 이상 배치하고 연결하세요.");
  }
  const pins = [];
  for (const component of components) {
    validateComponent(component);
    for (let pin = 0; pin < pinCount(component.type); pin += 1) pins.push(pinKey(component.id, pin));
  }
  const uf = new UnionFind([...pins, ...junctions.map((junction) => junctionKey(junction.id))], (key) => new CircuitError("BAD_WIRE", `존재하지 않는 핀입니다: ${key}`));
  for (const wire of wires) {
    if (!wire?.a || !wire?.b) throw new CircuitError("BAD_WIRE", "배선 끝점 정보가 없습니다.");
    uf.union(endpointKey(wire.a), endpointKey(wire.b));
  }
  const groundRoots = new Set(
    components.filter((component) => component.type === "GND").map((component) => uf.find(pinKey(component.id, 0))),
  );
  const groundRoot = [...groundRoots][0];
  for (const root of groundRoots) uf.union(groundRoot, root);

  const adjacency = new Map();
  const addEdge = (a, b) => {
    if (a === b) return;
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    if (!adjacency.has(b)) adjacency.set(b, new Set());
    adjacency.get(a).add(b);
    adjacency.get(b).add(a);
  };
  for (const component of components) {
    const componentRoots = [];
    for (let pin = 0; pin < pinCount(component.type); pin += 1) componentRoots.push(uf.find(pinKey(component.id, pin)));
    if (["VCVS", "CURRENT_SENSOR", "CCVS"].includes(component.type)) { addEdge(componentRoots[0], componentRoots[1]); continue; }
    if (["VCCS", "CCCS"].includes(component.type)) continue;
    // Magnetic coupling carries no galvanic path: each winding is its own pair of terminals.
    if (component.type === "COUPLED_L" || component.type === "XFMR_IDEAL") { addEdge(componentRoots[0], componentRoots[1]); addEdge(componentRoots[2], componentRoots[3]); continue; }
    for (let i = 1; i < componentRoots.length; i += 1) addEdge(componentRoots[0], componentRoots[i]);
  }
  const canonicalGround = uf.find(groundRoot);
  const visited = new Set([canonicalGround]);
  const queue = [canonicalGround];
  while (queue.length) {
    const current = queue.shift();
    for (const next of adjacency.get(current) ?? []) {
      const canonical = uf.find(next);
      if (!visited.has(canonical)) {
        visited.add(canonical);
        queue.push(canonical);
      }
    }
  }
  const floating = [];
  for (const component of components) {
    for (let pin = 0; pin < pinCount(component.type); pin += 1) {
      const root = uf.find(pinKey(component.id, pin));
      if (!visited.has(root)) floating.push(`${component.props?.ref ?? component.id}.${pin + 1}`);
    }
  }
  if (floating.length) {
    const magnetic = components.some((component) => component.type === "COUPLED_L" || component.type === "XFMR_IDEAL");
    throw new CircuitError("FLOATING_NODE", `접지 기준에 연결되지 않은 노드가 있습니다: ${[...new Set(floating)].slice(0, 8).join(", ")}`, magnetic ? "떠 있는 부분 회로를 GND 기준망에 연결하세요. 결합 인덕터·변압기의 1차와 2차는 서로 절연되어 있으므로 2차 회로에도 GND를 하나 연결해야 합니다." : "떠 있는 부분 회로를 GND 기준망에 연결하세요.");
  }

  const rootToNode = new Map([[canonicalGround, 0]]);
  let nextNode = 1;
  const nodeIdByPin = {};
  for (const component of components) {
    for (let pin = 0; pin < pinCount(component.type); pin += 1) {
      const root = uf.find(pinKey(component.id, pin));
      if (!rootToNode.has(root)) rootToNode.set(root, nextNode++);
      nodeIdByPin[publicPinKey(component.id, pin)] = rootToNode.get(root);
    }
  }
  const nodeIdByJunction = {};
  for (const junction of junctions) {
    const root = uf.find(junctionKey(junction.id));
    // An unattached drawing junction (or wire-only island) has no electrical
    // unknown. Keep it editable, but do not invent a floating matrix row/0 V.
    if (rootToNode.has(root)) nodeIdByJunction[junction.id] = rootToNode.get(root);
  }
  for (const component of components.filter((item) => item.type === "V")) {
    const a = nodeIdByPin[publicPinKey(component.id, 0)];
    const b = nodeIdByPin[publicPinKey(component.id, 1)];
    const dc = sourceValue(component, 0, "dc");
    if (a === b && Math.abs(dc) > 1e-15) {
      throw new CircuitError("VOLTAGE_SOURCE_SHORT", `${component.props?.ref ?? component.id}의 두 단자가 같은 net인데 전압이 0이 아닙니다.`, "전압원 단락 또는 잘못된 배선을 확인하세요.");
    }
  }
  // nodeFor is called per component, per pin, per solved point; memoize the
  // string-key lookup (topology is immutable once built).
  const nodeForCache = new Map();
  return {
    nodeCount: nextNode - 1,
    nodeIdByPin,
    nodeIdByJunction,
    nodeFor(componentId, pin) {
      let pins = nodeForCache.get(componentId);
      if (pins === undefined) {
        pins = [];
        nodeForCache.set(componentId, pins);
      }
      let node = pins[pin];
      if (node === undefined) {
        node = nodeIdByPin[publicPinKey(componentId, pin)];
        if (node !== undefined) pins[pin] = node;
      }
      return node;
    },
  };
}

function sourceValue(component, time, purpose = "transient") {
  const p = component.props ?? {};
  if (purpose === "dc") return parseValue(p.dc ?? 0, `${p.ref ?? component.id} DC`);
  if (purpose === "ac") {
    const magnitude = parseValue(p.acMagnitude ?? 0, `${p.ref ?? component.id} AC 크기`);
    const phase = (parseValue(p.acPhase ?? 0, `${p.ref ?? component.id} AC 위상`) * Math.PI) / 180;
    return complex(magnitude * Math.cos(phase), magnitude * Math.sin(phase));
  }
  const mode = p.mode ?? "DC";
  if (mode === "DC") return parseValue(p.dc ?? 0, `${p.ref ?? component.id} DC`);
  if (mode === "SIN") {
    const offset = parseValue(p.offset ?? 0, `${p.ref ?? component.id} 오프셋`);
    const amplitude = parseValue(p.amplitude ?? 0, `${p.ref ?? component.id} 진폭`);
    const frequency = parseValue(p.frequency ?? 60, `${p.ref ?? component.id} 주파수`);
    const phase = (parseValue(p.phase ?? 0, `${p.ref ?? component.id} 위상`) * Math.PI) / 180;
    return offset + amplitude * Math.sin(2 * Math.PI * frequency * time + phase);
  }
  const v1 = parseValue(p.pulseV1 ?? 0, `${p.ref ?? component.id} PULSE 초기값`);
  const v2 = parseValue(p.pulseV2 ?? 0, `${p.ref ?? component.id} PULSE 최종값`);
  const delay = parseValue(p.pulseDelay ?? 0, `${p.ref ?? component.id} PULSE 지연`);
  const rise = parseValue(p.pulseRise ?? 0, `${p.ref ?? component.id} PULSE 상승시간`);
  const fall = parseValue(p.pulseFall ?? 0, `${p.ref ?? component.id} PULSE 하강시간`);
  const width = parseValue(p.pulseWidth ?? 1, `${p.ref ?? component.id} PULSE 폭`);
  const period = parseValue(p.pulsePeriod ?? 2, `${p.ref ?? component.id} PULSE 주기`);
  if (time <= delay) return v1;
  const local = (time - delay) % period;
  if (rise > 0 && local < rise) return v1 + ((v2 - v1) * local) / rise;
  if (local < rise + width) return v2;
  if (fall > 0 && local < rise + width + fall) return v2 + ((v1 - v2) * (local - rise - width)) / fall;
  return v1;
}

function constraintLabel(constraint) {
  return `${constraint.ref} [${constraint.componentId}] ${constraint.pinLabel} = ${Number(constraint.value.toPrecision(8))} V`;
}

function voltageConstraintInput(component, analysis) {
  const p = component.props ?? {};
  if (component.type === "C") return `IC=${p.ic ?? "0"}`;
  if (component.type === "L" || component.type === "COUPLED_L") return "DC short=0 V";
  if (component.type === "CURRENT_SENSOR") return "0 V current sensor";
  if (component.type === "VCVS") return `g=${component.props?.g ?? "1"}, Vout=g·(Vcp−Vcn)`;
  if (analysis === "dc") return `DC=${p.dc ?? "0"}`;
  const mode = p.mode ?? "DC";
  if (mode === "SIN") return `SIN offset=${p.offset ?? "0"}, amplitude=${p.amplitude ?? "0"}, frequency=${p.frequency ?? "60"}, phase=${p.phase ?? "0"}`;
  if (mode === "PULSE") return `PULSE v1=${p.pulseV1 ?? "0"}, v2=${p.pulseV2 ?? "0"}, delay=${p.pulseDelay ?? "0"}, rise=${p.pulseRise ?? "0"}, fall=${p.pulseFall ?? "0"}, width=${p.pulseWidth ?? "1"}, period=${p.pulsePeriod ?? "2"}`;
  return `DC=${p.dc ?? "0"}`;
}

function voltageConstraintPath(graph, start, end) {
  if (start === end) return { value: 0, constraints: [] };
  const queue = [{ node: start, value: 0, constraints: [] }];
  const visited = new Set([start]);
  while (queue.length) {
    const current = queue.shift();
    for (const edge of graph.get(current.node) ?? []) {
      if (visited.has(edge.node)) continue;
      const next = { node: edge.node, value: current.value + edge.value, constraints: [...current.constraints, edge.constraint] };
      if (edge.node === end) return next;
      visited.add(edge.node);
      queue.push(next);
    }
  }
  return null;
}

export function analyzeIdealVoltageConstraints(circuit, { analysis = "dc", start = 0, ignoreConstraintIds = new Set() } = {}) {
  const topology = buildTopology(circuit);
  const constraints = [];
  // Keep mandatory independent sources first. Only an added capacitor constraint may be omitted.
  const ordered = analysis === "initial"
    ? [...circuit.components].sort((a, b) => Number(a.type !== "V") - Number(b.type !== "V"))
    : circuit.components;
  for (const component of ordered) {
    if (analysis === "dc" && component.type === "COUPLED_L") {
      if (ignoreConstraintIds.has(component.id)) continue;
      for (const [first, second, pinLabel] of [[0, 1, "1→2"], [2, 3, "3→4"]]) {
        constraints.push({ componentId: component.id, ref: component.props?.ref ?? component.id, type: component.type, pinLabel, a: topology.nodeFor(component.id, first), z: topology.nodeFor(component.id, second), value: 0, input: voltageConstraintInput(component, analysis), role: "DC 결합 코일 단락" });
      }
      continue;
    }
    let value;
    let role;
    if ((analysis === "dc" || analysis === "initial") && component.type === "CURRENT_SENSOR") {
      value = 0;
      role = "0 V 전류 센서";
    } else if (analysis === "dc" && component.type === "V") {
      value = sourceValue(component, 0, "dc");
      role = "DC 전압원";
    } else if (analysis === "dc" && component.type === "L") {
      value = 0;
      role = "DC 인덕터 단락";
    } else if (analysis === "initial" && component.type === "V") {
      value = sourceValue(component, start, "transient");
      role = `t=${Number(start.toPrecision(8))} s 전압원`;
    } else if (analysis === "initial" && component.type === "C") {
      value = parseValue(component.props?.ic ?? 0, `${component.props?.ref ?? component.id} 초기 전압`);
      role = "커패시터 초기 전압";
    } else continue;
    if (ignoreConstraintIds.has(component.id)) continue;
    constraints.push({
      componentId: component.id,
      ref: component.props?.ref ?? component.id,
      type: component.type,
      pinLabel: "1→2",
      a: topology.nodeFor(component.id, 0),
      z: topology.nodeFor(component.id, 1),
      value,
      input: voltageConstraintInput(component, analysis),
      role,
    });
  }
  const graph = new Map();
  const conflicts = [];
  const redundancies = [];
  const addEdge = (from, to, value, constraint) => {
    if (!graph.has(from)) graph.set(from, []);
    graph.get(from).push({ node: to, value, constraint });
  };
  for (const constraint of constraints) {
    const path = voltageConstraintPath(graph, constraint.a, constraint.z);
    if (path) {
      const tolerance = 1e-9 + 1e-9 * Math.max(Math.abs(path.value), Math.abs(constraint.value));
      const detail = { expected: path.value, actual: constraint.value, tolerance, constraints: [...path.constraints, constraint] };
      if (Math.abs(path.value - constraint.value) > tolerance) conflicts.push(detail);
      else redundancies.push(detail);
      continue;
    }
    addEdge(constraint.a, constraint.z, constraint.value, constraint);
    addEdge(constraint.z, constraint.a, -constraint.value, constraint);
  }
  return { analysis, start, constraints, conflicts, redundancies };
}

function tiedIdealOpamps(circuit) {
  const topology = buildTopology(circuit);
  return circuit.components.filter((component) => component.type === "OPAMP_IDEAL" && topology.nodeFor(component.id, 0) === topology.nodeFor(component.id, 1));
}

function refinedConstraintError(error, circuit, analysis, start = 0) {
  if (!(error instanceof CircuitError) || error.code !== "SINGULAR") return error;
  const diagnostic = analyzeIdealVoltageConstraints(circuit, { analysis, start });
  const conflict = diagnostic.conflicts[0];
  if (conflict) {
    const initial = analysis === "initial";
    return new CircuitError(
      initial ? "INITIAL_CONDITION_CONFLICT" : "IDEAL_CONSTRAINT_CONFLICT",
      `${initial ? "초기" : "DC"} 이상 전압 제약이 모순입니다: ${conflict.constraints.map(constraintLabel).join(" ↔ ")}.`,
      initial
        ? "전압원의 시작값과 커패시터 IC를 같은 방향·값으로 맞추거나 회로 연결을 명시적으로 바꾸세요. 시간 간격 축소는 이 대수 모순을 해결하지 않습니다."
        : "DC에서 인덕터는 0 V 단락입니다. 직렬저항·배선·소스값 등 물리 모델을 명시적으로 바꾸세요. L의 IC나 시간 간격 변경은 DC 모순을 해결하지 않습니다.",
      { certainty: "confirmed", reason: "ideal-voltage-conflict", analysis: initial ? "transient-initial" : "dc", ...conflict },
    );
  }
  // An ideal op amp whose + and - inputs are the same node has an empty constraint row, so the MNA matrix is singular
  // no matter what else is attached. When redundant ideal constraints (e.g. parallel capacitor ICs, whose duplicate
  // equation is skipped at the transient start anyway) would otherwise take the blame, name the op amp instead.
  // Without such a redundancy the plain SINGULAR error is kept.
  const redundancy = diagnostic.redundancies[0];
  const tiedOpamp = redundancy ? tiedIdealOpamps(circuit)[0] : undefined;
  if (tiedOpamp) {
    const ref = tiedOpamp.props?.ref ?? tiedOpamp.id;
    return new CircuitError(
      "IDEAL_OPAMP_INPUT_TIED",
      `이상 연산증폭기 ${ref} [${tiedOpamp.id}]의 +/− 입력이 같은 노드에 묶여 있어 op amp 제약(V+ = V−)이 출력을 정하지 못합니다.`,
      "비반전·반전 입력을 서로 다른 노드에 연결하고, 출력에서 반전 입력으로 피드백을 구성하세요.",
      { certainty: "confirmed", reason: "ideal-opamp-inputs-tied", analysis: analysis === "initial" ? "transient-initial" : analysis, componentId: tiedOpamp.id, ref },
    );
  }
  if (redundancy) {
    return new CircuitError(
      "IDEAL_CONSTRAINT_REDUNDANCY",
      `같은 이상 전압 제약이 중복되어 branch 전류가 하나로 정해지지 않습니다: ${redundancy.constraints.map(constraintLabel).join(" ↔ ")}.`,
      "중복 이상 전압원·단락 가지 중 하나를 제거하거나 작은 직렬저항 등 실제 소자 모델을 명시적으로 추가하세요.",
      { certainty: "confirmed", reason: "ideal-voltage-redundancy", analysis: analysis === "initial" ? "transient-initial" : analysis, ...redundancy },
    );
  }
  return error;
}

function assertMatrixSize(size) {
  if (size > 128) throw new CircuitError("ANALYSIS_BUDGET", "동시 미지수 128개를 초과했습니다.", "현재의 동기식 교육용 해석기는 작은 회로용입니다. 회로를 나누어 계산하세요.");
}

// Work model (flops-ish units). Linear transients factor once per distinct dt (the LU cache holds
// at most LU_CACHE_LIMIT of them) and then only substitute (n^2) per step; diode circuits run a
// Newton loop that refactors every iteration (typically ~10, hard-capped at 120 by the solver).
const BUDGET_LIMIT = 200_000_000;
const BUDGET_NEWTON_TYPICAL = 10;
const BUDGET_NEWTON_WORST = 120;
const BUDGET_NEWTON_HARD_CAP = 1_500_000_000;

function assertAnalysisBudget(circuit, topology, mode, points = 1) {
  const size = makeBranchMap(circuit, mode, topology.nodeCount).size;
  assertMatrixSize(size);
  const cube = size ** 3;
  const hasDiode = circuit.components.some((component) => component.type === "D");
  let cost;
  let hardCost = 0;
  if (mode === "transient" && !hasDiode) cost = cube * LU_CACHE_LIMIT + size ** 2 * points;
  else if (mode === "transient" || mode === "dc") {
    cost = cube * points * (hasDiode ? BUDGET_NEWTON_TYPICAL : 1);
    if (hasDiode) hardCost = cube * points * BUDGET_NEWTON_WORST;
  } else cost = cube * points;
  if (cost > BUDGET_LIMIT || hardCost > BUDGET_NEWTON_HARD_CAP) {
    throw new CircuitError("ANALYSIS_BUDGET", "요청한 계산량이 현재 해석기의 안전 한도를 초과했습니다.", "시간/주파수 범위를 줄이거나 표본 수를 줄이세요. 정확도와 dt 수렴을 별도로 확인하세요.");
  }
}

function zeros(rows, columns = rows) {
  assertMatrixSize(Math.max(rows, columns));
  return Array.from({ length: rows }, () => Array(columns).fill(0));
}

function nodeIndex(node) {
  return node === 0 ? -1 : node - 1;
}

function stampConductance(A, a, b, g) {
  const ia = nodeIndex(a);
  const ib = nodeIndex(b);
  if (ia >= 0) A[ia][ia] += g;
  if (ib >= 0) A[ib][ib] += g;
  if (ia >= 0 && ib >= 0) {
    A[ia][ib] -= g;
    A[ib][ia] -= g;
  }
}

function stampCurrent(b, a, z, current) {
  const ia = nodeIndex(a);
  const iz = nodeIndex(z);
  if (ia >= 0) b[ia] -= current;
  if (iz >= 0) b[iz] += current;
}

function stampVoltage(A, b, a, z, branch, voltage) {
  const ia = nodeIndex(a);
  const iz = nodeIndex(z);
  if (ia >= 0) {
    A[ia][branch] += 1;
    A[branch][ia] += 1;
  }
  if (iz >= 0) {
    A[iz][branch] -= 1;
    A[branch][iz] -= 1;
  }
  b[branch] += voltage;
}

// A pivot is singular only when it fails BOTH checks: it is below the old
// absolute 1e-14 AND negligible relative to the largest entry of its ORIGINAL
// column (cancellation residue is ~1e-16 of that scale). So uniformly tiny but
// well-conditioned systems (1e15 ohm dividers) solve, and columns with +-1
// coupling entries or huge gains (floating sources, op-amps) keep solving as
// they did with the absolute rule. An all-zero column is always singular.
const PIVOT_ABSOLUTE_TOLERANCE = 1e-14;
const PIVOT_RELATIVE_TOLERANCE = 1e-12;
const PIVOT_ABSOLUTE_FLOOR = 1e-300;

// LU with partial pivoting on flat Float64Array storage (n^3/3 instead of the
// n^3 of Gauss-Jordan). Pivot choice and the singular test are the same as the
// Gauss-Jordan elimination it replaces: the largest |entry| of the (reduced)
// column wins, and it must pass the hybrid absolute/relative test above.
// Reusable scratch buffers for one-shot solves (Newton iterations, DC, initial
// state): small systems are dominated by typed-array allocation otherwise. The
// solver is synchronous and never re-entered, so one module-level set is safe.
let scratchSize = 0;
let scratchLu = new Float64Array(0);
let scratchScale = new Float64Array(0);
let scratchPivots = new Int32Array(0);
let scratchX = new Float64Array(0);

function ensureScratch(n) {
  if (n <= scratchSize) return;
  scratchSize = n;
  scratchLu = new Float64Array(n * n);
  scratchScale = new Float64Array(n);
  scratchPivots = new Int32Array(n);
  scratchX = new Float64Array(n);
}

// In-place LU: `lu` holds the n*n row-major matrix on entry and L (unit lower,
// multipliers) + U on exit; `columnScale` holds the original column maxima.
function luFactorInPlace(lu, columnScale, pivots, n) {
  for (let column = 0; column < n; column += 1) {
    let pivot = column;
    let best = Math.abs(lu[column * n + column]);
    for (let row = column + 1; row < n; row += 1) {
      const magnitude = Math.abs(lu[row * n + column]);
      if (magnitude > best) { pivot = row; best = magnitude; }
    }
    if (best < PIVOT_ABSOLUTE_TOLERANCE && best <= Math.max(columnScale[column] * PIVOT_RELATIVE_TOLERANCE, PIVOT_ABSOLUTE_FLOOR)) throw new CircuitError("SINGULAR", "회로 방정식이 특이행렬입니다.", "떠 있는 노드, 이상적 전원 단락·모순, 병렬 이상 전원을 확인하세요.");
    pivots[column] = pivot;
    if (pivot !== column) {
      for (let k = 0; k < n; k += 1) {
        const swap = lu[column * n + k];
        lu[column * n + k] = lu[pivot * n + k];
        lu[pivot * n + k] = swap;
      }
    }
    const base = column * n;
    const divisor = lu[base + column];
    for (let row = column + 1; row < n; row += 1) {
      const offset = row * n;
      const factor = lu[offset + column] / divisor;
      lu[offset + column] = factor;
      if (factor === 0) continue;
      for (let k = column + 1; k < n; k += 1) lu[offset + k] -= factor * lu[base + k];
    }
  }
}

function luSubstitute(lu, pivots, n, b, x) {
  for (let index = 0; index < n; index += 1) x[index] = b[index];
  for (let column = 0; column < n; column += 1) {
    const pivot = pivots[column];
    if (pivot !== column) { const swap = x[column]; x[column] = x[pivot]; x[pivot] = swap; }
  }
  for (let row = 1; row < n; row += 1) {
    const offset = row * n;
    let sum = x[row];
    for (let k = 0; k < row; k += 1) sum -= lu[offset + k] * x[k];
    x[row] = sum;
  }
  for (let row = n - 1; row >= 0; row -= 1) {
    const offset = row * n;
    let sum = x[row];
    for (let k = row + 1; k < n; k += 1) sum -= lu[offset + k] * x[k];
    x[row] = sum / lu[offset + row];
  }
  const result = new Array(n);
  for (let index = 0; index < n; index += 1) {
    const value = x[index];
    if (!Number.isFinite(value)) throw new CircuitError("NUMERIC_FAILURE", "해석 결과에 비유한 수가 발생했습니다.");
    result[index] = value;
  }
  return result;
}

function loadMatrix(A, n, lu, columnScale) {
  columnScale.fill(0, 0, n);
  for (let row = 0; row < n; row += 1) {
    const source = A[row];
    for (let column = 0; column < n; column += 1) {
      const value = source[column];
      lu[row * n + column] = value;
      columnScale[column] = Math.max(columnScale[column], Math.abs(value));
    }
  }
}

function solveLinear(A, b) {
  const n = b.length;
  ensureScratch(n);
  loadMatrix(A, n, scratchLu, scratchScale);
  luFactorInPlace(scratchLu, scratchScale, scratchPivots, n);
  return luSubstitute(scratchLu, scratchPivots, n, b, scratchX);
}

// Persistent factorization (kept in the per-dt cache): owns its buffers and a copy
// of the original matrix for the exact-reuse check.
function luFactor(A, n) {
  const original = new Float64Array(n * n);
  const columnScale = new Float64Array(n);
  loadMatrix(A, n, original, columnScale);
  const lu = new Float64Array(original);
  const pivots = new Int32Array(n);
  luFactorInPlace(lu, columnScale, pivots, n);
  return { n, original, lu, pivots, x: new Float64Array(n) };
}

function luSolve(factor, b) {
  return luSubstitute(factor.lu, factor.pivots, factor.n, b, factor.x);
}

// Linear transient: A depends only on the actual step dt, so the LU factors are
// reused per exact dt. The freshly stamped A is compared with the matrix the
// cached factors came from (O(n^2)), so the reuse is exact even if a future
// stamp starts depending on something else. Never used for the diode Newton path.
const LU_CACHE_LIMIT = 32;

function solveLinearCached(cache, key, A, b) {
  const n = b.length;
  let entry = cache.get(key);
  if (entry) {
    const original = entry.original;
    let same = entry.n === n;
    for (let row = 0; same && row < n; row += 1) {
      const source = A[row];
      const offset = row * n;
      for (let column = 0; column < n; column += 1) if (source[column] !== original[offset + column]) { same = false; break; }
    }
    if (same) return luSolve(entry, b);
    cache.delete(key);
  }
  entry = luFactor(A, n);
  if (cache.size >= LU_CACHE_LIMIT) cache.delete(cache.keys().next().value);
  cache.set(key, entry);
  return luSolve(entry, b);
}

function makeBranchMap(circuit, mode, nodeCount, skippedConstraints = new Set()) {
  const map = new Map();
  let index = nodeCount;
  for (const component of circuit.components) {
    const voltageBranch = component.type === "V" || component.type === "OPAMP" || component.type === "OPAMP_IDEAL" || component.type === "VCVS" || component.type === "CURRENT_SENSOR" || component.type === "CCVS";
    const inductorBranch = component.type === "L" && mode !== "ac" && mode !== "initial";
    const initialCapacitorBranch = component.type === "C" && mode === "initial";
    if ((voltageBranch || inductorBranch || initialCapacitorBranch) && !skippedConstraints.has(component.id)) map.set(component.id, index++);
    // XFMR_IDEAL: one unknown (the primary current i1); COUPLED_L: i1 and i2 (none while the transient start state is solved).
    if (component.type === "XFMR_IDEAL") map.set(component.id, index++);
    if (component.type === "COUPLED_L" && mode !== "initial") { map.set(component.id, index++); map.set(secondaryCurrentKey(component.id), index++); }
  }
  return { map, size: index };
}

// Per-simulation memo (keyed by the topology object built for one circuit):
// branch maps without skipped constraints and the "has a diode" flag are
// identical for every solved point, so compute them once.
const topologySimulationCache = new WeakMap();

function simulationCache(topology) {
  let cache = topologySimulationCache.get(topology);
  if (!cache) {
    cache = { branchMaps: new Map(), hasDiode: undefined };
    topologySimulationCache.set(topology, cache);
  }
  return cache;
}

function cachedBranchMap(circuit, mode, topology, skippedConstraints) {
  if (skippedConstraints && skippedConstraints.size) return makeBranchMap(circuit, mode, topology.nodeCount, skippedConstraints);
  const cache = simulationCache(topology);
  let result = cache.branchMaps.get(mode);
  if (!result) {
    result = makeBranchMap(circuit, mode, topology.nodeCount);
    cache.branchMaps.set(mode, result);
  }
  return result;
}

function cachedHasDiode(circuit, topology) {
  const cache = simulationCache(topology);
  if (cache.hasDiode === undefined) cache.hasDiode = circuit.components.some((component) => component.type === "D");
  return cache.hasDiode;
}

function controlledBranch(component, branchMap) {
  const branch = branchMap.get(component.control?.elementId);
  if (branch === undefined) throw new CircuitError("INVALID_CONTROL", `${component.props?.ref ?? component.id}의 제어 branch를 찾을 수 없습니다.`);
  return { branch, direction: component.control.direction };
}

function addRealCoefficient(A, rowNode, columnNode, value) {
  const row = nodeIndex(rowNode), column = nodeIndex(columnNode);
  if (row >= 0 && column >= 0) A[row][column] += value;
}

function stampRealControlledSource(A, topology, component, branchMap) {
  const p = topology.nodeFor(component.id, 0), n = topology.nodeFor(component.id, 1);
  const coefficient = controlledCoefficient(component);
  if (component.type === "CCCS") {
    const control = controlledBranch(component, branchMap);
    const pIndex = nodeIndex(p), nIndex = nodeIndex(n);
    if (pIndex >= 0) A[pIndex][control.branch] += coefficient * control.direction;
    if (nIndex >= 0) A[nIndex][control.branch] -= coefficient * control.direction;
    return;
  }
  if (component.type === "CCVS") {
    const branch = branchMap.get(component.id);
    const control = controlledBranch(component, branchMap);
    const pIndex = nodeIndex(p), nIndex = nodeIndex(n);
    if (pIndex >= 0) { A[pIndex][branch] += 1; A[branch][pIndex] += 1; }
    if (nIndex >= 0) { A[nIndex][branch] -= 1; A[branch][nIndex] -= 1; }
    A[branch][control.branch] -= coefficient * control.direction;
    return;
  }
  const cp = topology.nodeFor(component.id, 2), cn = topology.nodeFor(component.id, 3);
  if (component.type === "VCCS") {
    addRealCoefficient(A, p, cp, coefficient); addRealCoefficient(A, p, cn, -coefficient);
    addRealCoefficient(A, n, cp, -coefficient); addRealCoefficient(A, n, cn, coefficient);
    return;
  }
  const branch = branchMap.get(component.id);
  const pIndex = nodeIndex(p), nIndex = nodeIndex(n), cpIndex = nodeIndex(cp), cnIndex = nodeIndex(cn);
  if (pIndex >= 0) A[pIndex][branch] += 1;
  if (nIndex >= 0) A[nIndex][branch] -= 1;
  if (pIndex >= 0) A[branch][pIndex] += 1;
  if (nIndex >= 0) A[branch][nIndex] -= 1;
  if (cpIndex >= 0) A[branch][cpIndex] -= coefficient;
  if (cnIndex >= 0) A[branch][cnIndex] += coefficient;
}

function addBranchEntry(A, row, column, value) {
  if (row >= 0 && column >= 0) A[row][column] += value;
}

/**
 * Coupled inductors, v1 = L1 di1/dt + M di2/dt, v2 = M di1/dt + L2 di2/dt (M signed by the dot placement), i1/i2 into pins 1a/2a.
 * DC: both windings are 0 V shorts. Transient (backward Euler): row b1 is v1 - (L1/dt) i1 - (M/dt) i2 = -(L1 i1' + M i2')/dt, row b2 likewise.
 * Transient start state: both windings are current sources (ic1, ic2).
 */
function stampRealCoupledInductor(A, b, topology, component, branchMap, mode, context) {
  const parameters = coupledInductorParameters(component);
  const n1a = topology.nodeFor(component.id, 0), n1b = topology.nodeFor(component.id, 1), n2a = topology.nodeFor(component.id, 2), n2b = topology.nodeFor(component.id, 3);
  const key2 = secondaryCurrentKey(component.id);
  const previous1 = context.inductorCurrents?.get(component.id) ?? 0;
  const previous2 = context.inductorCurrents?.get(key2) ?? 0;
  if (mode === "initial") {
    stampCurrent(b, n1a, n1b, previous1);
    stampCurrent(b, n2a, n2b, previous2);
    return;
  }
  const b1 = branchMap.get(component.id), b2 = branchMap.get(key2);
  stampVoltage(A, b, n1a, n1b, b1, 0);
  stampVoltage(A, b, n2a, n2b, b2, 0);
  if (mode !== "transient") return;
  const { L1, L2, mutual } = parameters;
  const inverse = 1 / context.dt;
  A[b1][b1] -= L1 * inverse; A[b1][b2] -= mutual * inverse;
  A[b2][b1] -= mutual * inverse; A[b2][b2] -= L2 * inverse;
  b[b1] -= (L1 * previous1 + mutual * previous2) * inverse;
  b[b2] -= (mutual * previous1 + L2 * previous2) * inverse;
}

/** Ideal transformer: unknown x = i1 (into 1a). KCL: 1a +x, 1b -x, 2a -x/ratio, 2b +x/ratio; constraint v2 - ratio*v1 = 0. Same in DC, transient and the start state. */
function stampRealIdealTransformer(A, topology, component, branchMap) {
  const { ratio } = idealTransformerParameters(component);
  const n1a = nodeIndex(topology.nodeFor(component.id, 0)), n1b = nodeIndex(topology.nodeFor(component.id, 1));
  const n2a = nodeIndex(topology.nodeFor(component.id, 2)), n2b = nodeIndex(topology.nodeFor(component.id, 3));
  const branch = branchMap.get(component.id);
  addBranchEntry(A, n1a, branch, 1); addBranchEntry(A, n1b, branch, -1);
  addBranchEntry(A, n2a, branch, -1 / ratio); addBranchEntry(A, n2b, branch, 1 / ratio);
  addBranchEntry(A, branch, n2a, 1); addBranchEntry(A, branch, n2b, -1);
  addBranchEntry(A, branch, n1a, -ratio); addBranchEntry(A, branch, n1b, ratio);
}

const DIODE_MAX_FORWARD_VOLTAGE = 0.8;

function diodeParameters(component) {
  const saturation = parseValue(component.props?.is ?? "1e-12");
  const factor = parseValue(component.props?.n ?? "1");
  return { saturation, thermal: 0.02585 * factor };
}

function diodeModelCurrent(component, voltage) {
  if (voltage > DIODE_MAX_FORWARD_VOLTAGE) return { supported: false, current: Number.NaN };
  const { saturation, thermal } = diodeParameters(component);
  return { supported: true, current: saturation * Math.expm1(voltage / thermal) };
}

// The Newton stabilization floor is not the physical small-signal derivative.
function diodeSmallSignalConductance(component, voltage) {
  const { saturation, thermal } = diodeParameters(component);
  const conductance = saturation / thermal * Math.exp(voltage / thermal);
  if (!Number.isFinite(conductance)) throw new CircuitError("NUMERIC_FAILURE", "다이오드 소신호 도함수가 유한하지 않습니다.");
  return conductance;
}

function diodeLinearization(component, voltage) {
  const { saturation, thermal } = diodeParameters(component);
  const limitedVoltage = Math.min(DIODE_MAX_FORWARD_VOLTAGE, voltage);
  const exponential = Math.exp(limitedVoltage / thermal);
  const current = saturation * (exponential - 1);
  const conductance = Math.max(saturation / thermal, (saturation * exponential) / thermal);
  return { conductance, currentEquivalent: current - conductance * limitedVoltage };
}

function valueAtNode(solution, node) {
  return node === 0 ? 0 : solution[node - 1];
}

function solveRealPoint(circuit, topology, mode, context) {
  const { map: branchMap, size } = cachedBranchMap(circuit, mode, topology, context.skippedConstraints);
  let guess = context.guess ? [...context.guess] : Array(size).fill(0);
  if (guess.length !== size) guess = Array(size).fill(0);
  const hasDiode = cachedHasDiode(circuit, topology);
  const maxIterations = hasDiode ? 120 : 1;
  let solution = guess;
  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const A = zeros(size);
    const b = Array(size).fill(0);
    const diodeTangents = [];
    for (const component of circuit.components) {
      const a = topology.nodeFor(component.id, 0);
      const z = pinCount(component.type) > 1 ? topology.nodeFor(component.id, 1) : 0;
      const p = component.props ?? {};
      if (component.type === "R") stampConductance(A, a, z, 1 / parseValue(p.value));
      if (component.type === "I") stampCurrent(b, a, z, sourceValue(component, context.time ?? 0, mode === "dc" ? "dc" : "transient"));
      if (component.type === "V" && branchMap.has(component.id)) stampVoltage(A, b, a, z, branchMap.get(component.id), sourceValue(component, context.time ?? 0, mode === "dc" ? "dc" : "transient"));
      if (component.type === "CURRENT_SENSOR") stampVoltage(A, b, a, z, branchMap.get(component.id), 0);
      if (component.type === "C") {
        if (mode === "transient") {
          const g = parseValue(p.value) / context.dt;
          stampConductance(A, a, z, g);
          stampCurrent(b, a, z, -g * (context.capacitorVoltages.get(component.id) ?? 0));
        }
        if (mode === "initial" && branchMap.has(component.id)) {
          stampVoltage(A, b, a, z, branchMap.get(component.id), context.capacitorVoltages.get(component.id) ?? 0);
        }
      }
      if (component.type === "L") {
        if (mode === "initial") {
          stampCurrent(b, a, z, context.inductorCurrents.get(component.id) ?? 0);
        } else {
          const branch = branchMap.get(component.id);
          stampVoltage(A, b, a, z, branch, 0);
          if (mode === "transient") {
            const resistance = parseValue(p.value) / context.dt;
            A[branch][branch] -= resistance;
            b[branch] -= resistance * (context.inductorCurrents.get(component.id) ?? 0);
          }
        }
      }
      if (component.type === "D") {
        const voltage = valueAtNode(solution, a) - valueAtNode(solution, z);
        const { conductance, currentEquivalent } = diodeLinearization(component, voltage);
        stampConductance(A, a, z, conductance);
        stampCurrent(b, a, z, currentEquivalent);
        diodeTangents.push({ component, a, z, conductance, currentEquivalent });
      }
      if (component.type === "OPAMP") {
        const plus = a;
        const minus = z;
        const out = topology.nodeFor(component.id, 2);
        const branch = branchMap.get(component.id);
        const outputIndex = nodeIndex(out);
        if (outputIndex >= 0) {
          A[outputIndex][branch] += 1;
          A[branch][outputIndex] += 1;
        }
        const plusIndex = nodeIndex(plus);
        const minusIndex = nodeIndex(minus);
        const gain = parseValue(p.gain ?? "100k");
        if (plusIndex >= 0) A[branch][plusIndex] -= gain;
        if (minusIndex >= 0) A[branch][minusIndex] += gain;
      }
      if (component.type === "OPAMP_IDEAL") {
        const out = topology.nodeFor(component.id, 2);
        const branch = branchMap.get(component.id);
        const outputIndex = nodeIndex(out);
        if (outputIndex >= 0) A[outputIndex][branch] += 1;
        const plusIndex = nodeIndex(a);
        const minusIndex = nodeIndex(z);
        if (plusIndex >= 0) A[branch][plusIndex] += 1;
        if (minusIndex >= 0) A[branch][minusIndex] -= 1;
      }
      if (component.type === "COUPLED_L") stampRealCoupledInductor(A, b, topology, component, branchMap, mode, context);
      if (component.type === "XFMR_IDEAL") stampRealIdealTransformer(A, topology, component, branchMap);
      if (["VCVS", "VCCS", "CCCS", "CCVS"].includes(component.type)) stampRealControlledSource(A, topology, component, branchMap);
    }
    const candidate = !hasDiode && mode === "transient" && context.luCache
      ? solveLinearCached(context.luCache, context.dt, A, b)
      : solveLinear(A, b);
    if (!hasDiode) {
      solution = candidate;
      break;
    }
    const delta = Math.max(...candidate.map((value, index) => Math.abs(value - solution[index])));
    const damping = iteration < 8 ? 0.5 : 1;
    solution = candidate.map((value, index) => solution[index] + damping * (value - solution[index]));
    let maximumResidual = 0;
    const unsupported = [];
    for (const tangent of diodeTangents) {
      const voltage = valueAtNode(solution, tangent.a) - valueAtNode(solution, tangent.z);
      const model = diodeModelCurrent(tangent.component, voltage);
      if (!model.supported) {
        unsupported.push(tangent.component.props?.ref ?? tangent.component.id);
        continue;
      }
      const tangentCurrent = tangent.conductance * voltage + tangent.currentEquivalent;
      const residual = Math.abs(model.current - tangentCurrent);
      const tolerance = 1e-12 + 1e-8 * Math.max(1e-3, Math.abs(model.current));
      maximumResidual = Math.max(maximumResidual, residual / tolerance);
    }
    if (damping === 1 && delta < 1e-9 && !unsupported.length && maximumResidual <= 1) break;
    if ((damping === 1 && delta < 1e-9 && unsupported.length) || iteration === maxIterations - 1) {
      if (unsupported.length) {
        throw new CircuitError(
          "DIODE_MODEL_RANGE",
          `${[...new Set(unsupported)].join(", ")}의 순방향 전압이 간략 다이오드 모델 지원 범위 0.8 V를 초과합니다.`,
          "직렬 저항과 소스 값을 확인하거나 더 완전한 다이오드 모델을 사용하세요.",
        );
      }
      throw new CircuitError("NO_CONVERGENCE", "다이오드 Newton 반복이 원 모델 잔차 기준으로 수렴하지 않았습니다.", "해석기의 수치 한계일 수 있어 입력값이 틀렸다는 뜻은 아닙니다. 시간 간격을 줄이거나, 소스 진폭을 낮추거나, 다이오드에 직렬 저항을 추가해 보세요.");
    }
  }
  return { solution, branchMap };
}

function realPoint(circuit, topology, solved, mode, context) {
  const nodeVoltages = { 0: 0 };
  for (let node = 1; node <= topology.nodeCount; node += 1) nodeVoltages[node] = valueAtNode(solved.solution, node);
  const componentCurrents = {};
  for (const component of circuit.components) {
    const a = topology.nodeFor(component.id, 0);
    const z = pinCount(component.type) > 1 ? topology.nodeFor(component.id, 1) : 0;
    const voltage = nodeVoltages[a] - nodeVoltages[z];
    const p = component.props ?? {};
    if (component.type === "R") componentCurrents[component.id] = voltage / parseValue(p.value);
    if (component.type === "C") {
      if (mode === "transient") componentCurrents[component.id] = (parseValue(p.value) * (voltage - (context.capacitorVoltages.get(component.id) ?? 0))) / context.dt;
      else if (mode === "initial") componentCurrents[component.id] = solved.solution[solved.branchMap.get(component.id)] ?? 0;
      else componentCurrents[component.id] = 0;
    }
    if (component.type === "L") componentCurrents[component.id] = mode === "initial" ? context.inductorCurrents.get(component.id) ?? 0 : solved.solution[solved.branchMap.get(component.id)] ?? 0;
    if (["V", "OPAMP", "OPAMP_IDEAL", "VCVS", "CURRENT_SENSOR", "CCVS"].includes(component.type)) componentCurrents[component.id] = solved.solution[solved.branchMap.get(component.id)] ?? 0;
    if (component.type === "VCCS") {
      const cp = topology.nodeFor(component.id, 2), cn = topology.nodeFor(component.id, 3);
      componentCurrents[component.id] = controlledCoefficient(component) * (nodeVoltages[cp] - nodeVoltages[cn]);
    }
    if (component.type === "CCCS") {
      const control = controlledBranch(component, solved.branchMap);
      componentCurrents[component.id] = controlledCoefficient(component) * control.direction * (solved.solution[control.branch] ?? 0);
    }
    if (component.type === "I") componentCurrents[component.id] = sourceValue(component, context.time ?? 0, mode === "dc" ? "dc" : "transient");
    if (component.type === "D") {
      const model = diodeModelCurrent(component, voltage);
      if (!model.supported) {
        throw new CircuitError("DIODE_MODEL_RANGE", `${p.ref ?? component.id}의 순방향 전압이 간략 다이오드 모델 지원 범위 0.8 V를 초과합니다.`);
      }
      componentCurrents[component.id] = model.current;
    }
    if (component.type === "COUPLED_L") {
      const key2 = secondaryCurrentKey(component.id);
      componentCurrents[component.id] = mode === "initial" ? context.inductorCurrents.get(component.id) ?? 0 : solved.solution[solved.branchMap.get(component.id)] ?? 0;
      componentCurrents[key2] = mode === "initial" ? context.inductorCurrents.get(key2) ?? 0 : solved.solution[solved.branchMap.get(key2)] ?? 0;
    }
    if (component.type === "XFMR_IDEAL") {
      const primary = solved.solution[solved.branchMap.get(component.id)] ?? 0;
      componentCurrents[component.id] = primary;
      componentCurrents[secondaryCurrentKey(component.id)] = -primary / idealTransformerParameters(component).ratio;
    }
    if (component.type === "GND") componentCurrents[component.id] = 0;
  }
  return { nodeVoltages, componentCurrents };
}

export function simulateDC(circuit) {
  const topology = buildTopology(circuit);
  assertAnalysisBudget(circuit, topology, "dc");
  let solved;
  try {
    solved = solveRealPoint(circuit, topology, "dc", { time: 0 });
  } catch (error) {
    throw refinedConstraintError(error, circuit, "dc");
  }
  return {
    analysis: "dc",
    xValues: [0],
    points: [realPoint(circuit, topology, solved, "dc", {})],
    topology: { nodeIdByPin: topology.nodeIdByPin, nodeIdByJunction: topology.nodeIdByJunction },
  };
}

function initialSourceDerivative(component, time) {
  const p = component.props ?? {};
  if ((p.mode ?? "DC") === "DC") return 0;
  if (p.mode === "SIN") {
    const omega = 2 * Math.PI * parseValue(p.frequency ?? 60);
    return parseValue(p.amplitude ?? 0) * omega * Math.cos(omega * time + parseValue(p.phase ?? 0) * Math.PI / 180);
  }
  const delay = parseValue(p.pulseDelay ?? 0);
  // Match sourceValue's pre-edge convention at t <= delay, including a delay-zero step.
  if (time <= delay) return 0;
  const rise = parseValue(p.pulseRise ?? 0);
  const fall = parseValue(p.pulseFall ?? 0);
  const width = parseValue(p.pulseWidth ?? 1);
  const local = (time - delay) % parseValue(p.pulsePeriod ?? 2);
  const difference = parseValue(p.pulseV2 ?? 0) - parseValue(p.pulseV1 ?? 0);
  if (rise > 0 && local < rise) return difference / rise;
  if (fall > 0 && local >= rise + width && local < rise + width + fall) return -difference / fall;
  return 0;
}

/**
 * Resolve currents in compatible capacitor constraint cycles without assigning the
 * whole current to whichever initial-voltage branch happened to be retained.
 * At known initial voltages, C*dV/dt plus independent voltage-source branch currents
 * balances the known R/D/I/L currents. One derivative gauge per C/V island removes
 * only a common-mode derivative; capacitor voltage differences remain physical.
 */
function resolveInitialCapacitorCurrents(circuit, topology, point, time) {
  if (circuit.components.some((component) => ["OPAMP", "OPAMP_IDEAL", "VCVS", "CURRENT_SENSOR", "CCCS", "CCVS", "COUPLED_L", "XFMR_IDEAL"].includes(component.type))) {
    throw new CircuitError("INITIAL_DERIVATIVE_UNSUPPORTED", "중복 커패시터 초기제약과 이상 제약·전류제어 종속원이 함께 있는 회로의 초기 전류는 아직 지원하지 않습니다.", "임의로 0 A를 표시하지 않고 중단했습니다. 독립 전압원 또는 중복 없는 검증 회로로 나누어 확인하세요.");
  }
  const capacitors = circuit.components.filter((component) => component.type === "C");
  const sources = circuit.components.filter((component) => component.type === "V");
  const branches = [...capacitors, ...sources];
  const nodes = [...new Set(branches.flatMap((component) => [topology.nodeFor(component.id, 0), topology.nodeFor(component.id, 1)]))];
  const sets = new UnionFind(nodes);
  for (const component of branches) sets.union(topology.nodeFor(component.id, 0), topology.nodeFor(component.id, 1));
  const references = new Map();
  for (const node of nodes) {
    const root = sets.find(node);
    if (!references.has(root) || node === 0) references.set(root, node);
  }
  const localNodes = new Map();
  let nodeCount = 0;
  for (const node of nodes) localNodes.set(node, references.get(sets.find(node)) === node ? 0 : ++nodeCount);
  const size = nodeCount + sources.length;
  const A = zeros(size);
  const b = Array(size).fill(0);
  const capacitanceScale = Math.max(...capacitors.map((component) => parseValue(component.props.value)));
  for (const component of capacitors) {
    stampConductance(A, localNodes.get(topology.nodeFor(component.id, 0)), localNodes.get(topology.nodeFor(component.id, 1)), parseValue(component.props.value) / capacitanceScale);
  }
  for (const component of circuit.components) {
    if (["C", "V", "GND"].includes(component.type)) continue;
    const first = topology.nodeFor(component.id, 0);
    const second = topology.nodeFor(component.id, 1);
    const current = point.componentCurrents[component.id] / capacitanceScale;
    const a = localNodes.get(first);
    const z = localNodes.get(second);
    if (a > 0) b[a - 1] -= current;
    if (z > 0) b[z - 1] += current;
  }
  sources.forEach((component, index) => {
    stampVoltage(A, b, localNodes.get(topology.nodeFor(component.id, 0)), localNodes.get(topology.nodeFor(component.id, 1)), nodeCount + index, initialSourceDerivative(component, time));
  });
  const solution = solveLinear(A, b);
  const derivative = (node) => valueAtNode(solution, localNodes.get(node));
  const currents = { ...point.componentCurrents };
  for (const component of capacitors) {
    currents[component.id] = parseValue(component.props.value) * (derivative(topology.nodeFor(component.id, 0)) - derivative(topology.nodeFor(component.id, 1)));
  }
  sources.forEach((component, index) => { currents[component.id] = solution[nodeCount + index] * capacitanceScale; });
  return { ...point, componentCurrents: currents };
}

export function simulateTransient(circuit, settings = {}) {
  const topology = buildTopology(circuit);
  const start = parseValue(settings.start ?? 0, "시작시간");
  const end = parseValue(settings.end ?? "5m", "종료시간");
  const dt = positiveValue(settings.step ?? "10u", "시간 간격");
  if (start < 0 || end <= start) throw new CircuitError("INVALID_ANALYSIS", "종료시간은 시작시간보다 커야 하고 시작시간은 음수일 수 없습니다.");
  const xValues = [start];
  for (let index = 1; ; index += 1) {
    if (xValues.length >= 20001) throw new CircuitError("TOO_MANY_POINTS", `시간응답 점 수 ${xValues.length + 1}개가 제한 20001개를 초과합니다.`, "시간 간격을 늘리세요.");
    const requestedTime = start + index * dt;
    const time = requestedTime < end ? requestedTime : end;
    if (!(time > xValues[xValues.length - 1])) throw new CircuitError("NUMERIC_FAILURE", "시간 간격이 부동소수점 해상도보다 작습니다.", "시작시각 또는 시간 간격을 조정하세요. 미완료 파형을 정상 결과로 반환하지 않습니다.");
    xValues.push(time);
    if (time === end) break;
  }
  const steps = xValues.length - 1;
  assertAnalysisBudget(circuit, topology, "transient", steps + 1);
  const capacitorVoltages = new Map();
  const inductorCurrents = new Map();
  for (const component of circuit.components) {
    if (component.type === "C") capacitorVoltages.set(component.id, parseValue(component.props?.ic ?? 0));
    if (component.type === "L") inductorCurrents.set(component.id, parseValue(component.props?.ic ?? 0));
    if (component.type === "COUPLED_L") {
      const { ic1, ic2 } = coupledInductorParameters(component);
      inductorCurrents.set(component.id, ic1);
      inductorCurrents.set(secondaryCurrentKey(component.id), ic2);
    }
  }
  const initialDiagnostic = analyzeIdealVoltageConstraints(circuit, { analysis: "initial", start });
  if (initialDiagnostic.conflicts.length) {
    throw refinedConstraintError(new CircuitError("SINGULAR", "초기 이상 전압 제약이 모순입니다."), circuit, "initial", start);
  }
  // A capacitor IC that exactly matches another ideal voltage constraint does not
  // need a second MNA branch at t=start. Keep the IC value for the first sample,
  // but omit only that redundant capacitor equation so the compatible initial
  // state remains solvable. Redundant voltage sources still have indeterminate
  // branch currents and therefore remain an explicit error.
  const skippedConstraints = new Set();
  for (const redundancy of initialDiagnostic.redundancies) {
    const added = redundancy.constraints.at(-1);
    if (added.type === "C") skippedConstraints.add(added.componentId);
  }
  const remainingDiagnostic = skippedConstraints.size
    ? analyzeIdealVoltageConstraints(circuit, { analysis: "initial", start, ignoreConstraintIds: skippedConstraints })
    : initialDiagnostic;
  if (remainingDiagnostic.redundancies.length) {
    const redundancy = remainingDiagnostic.redundancies[0];
    throw new CircuitError(
      "IDEAL_CONSTRAINT_REDUNDANCY",
      `같은 초기 이상 전압 제약이 중복되어 branch 전류가 하나로 정해지지 않습니다: ${redundancy.constraints.map(constraintLabel).join(" ↔ ")}.`,
      "중복 이상 전압원 중 하나를 제거하거나 작은 직렬저항 등 실제 소자 모델을 명시적으로 추가하세요.",
      { certainty: "confirmed", reason: "ideal-voltage-redundancy", analysis: "transient-initial", ...redundancy },
    );
  }
  let initialSolved;
  try {
    initialSolved = solveRealPoint(circuit, topology, "initial", { time: start, capacitorVoltages, inductorCurrents, skippedConstraints });
  } catch (error) {
    throw refinedConstraintError(error, circuit, "initial", start);
  }
  const transientBranches = makeBranchMap(circuit, "transient", topology.nodeCount);
  let guess = Array(transientBranches.size).fill(0);
  for (let node = 1; node <= topology.nodeCount; node += 1) guess[node - 1] = initialSolved.solution[node - 1];
  for (const [componentId, initialIndex] of initialSolved.branchMap) {
    if (transientBranches.map.has(componentId)) guess[transientBranches.map.get(componentId)] = initialSolved.solution[initialIndex];
  }
  for (const component of circuit.components.filter((item) => item.type === "L")) guess[transientBranches.map.get(component.id)] = inductorCurrents.get(component.id);
  for (const component of circuit.components.filter((item) => item.type === "COUPLED_L")) {
    guess[transientBranches.map.get(component.id)] = inductorCurrents.get(component.id);
    guess[transientBranches.map.get(secondaryCurrentKey(component.id))] = inductorCurrents.get(secondaryCurrentKey(component.id));
  }
  let initialPoint = realPoint(circuit, topology, initialSolved, "initial", { dt, time: start, capacitorVoltages, inductorCurrents });
  if (skippedConstraints.size) initialPoint = resolveInitialCapacitorCurrents(circuit, topology, initialPoint, start);
  const points = [initialPoint];
  const luCache = new Map();
  for (let index = 1; index <= steps; index += 1) {
    const time = xValues[index];
    const actualDt = time - xValues[index - 1];
    const context = { time, dt: actualDt, capacitorVoltages, inductorCurrents, guess, luCache };
    const solved = solveRealPoint(circuit, topology, "transient", context);
    const point = realPoint(circuit, topology, solved, "transient", context);
    for (const component of circuit.components) {
      if (component.type === "C") {
        const a = topology.nodeFor(component.id, 0);
        const z = topology.nodeFor(component.id, 1);
        capacitorVoltages.set(component.id, point.nodeVoltages[a] - point.nodeVoltages[z]);
      }
      if (component.type === "L") inductorCurrents.set(component.id, point.componentCurrents[component.id]);
      if (component.type === "COUPLED_L") {
        inductorCurrents.set(component.id, point.componentCurrents[component.id]);
        inductorCurrents.set(secondaryCurrentKey(component.id), point.componentCurrents[secondaryCurrentKey(component.id)]);
      }
    }
    points.push(point);
    guess = solved.solution;
  }
  return { analysis: "transient", xValues, points, topology: { nodeIdByPin: topology.nodeIdByPin, nodeIdByJunction: topology.nodeIdByJunction } };
}

function complex(re = 0, im = 0) {
  return { re, im };
}
function csub(a, b) {
  return complex(a.re - b.re, a.im - b.im);
}
function cmul(a, b) {
  return complex(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
}
function cabs(a) {
  return Math.hypot(a.re, a.im);
}

function complexZeros(size) {
  assertMatrixSize(size);
  return { n: size, re: new Float64Array(size * size), im: new Float64Array(size * size) };
}

function complexVector(size) {
  return { re: new Float64Array(size), im: new Float64Array(size) };
}

function addComplexEntry(A, row, column, re, im = 0) {
  const index = row * A.n + column;
  A.re[index] += re;
  A.im[index] += im;
}

function stampComplexConductance(A, a, b, re, im) {
  const ia = nodeIndex(a);
  const ib = nodeIndex(b);
  if (ia >= 0) addComplexEntry(A, ia, ia, re, im);
  if (ib >= 0) addComplexEntry(A, ib, ib, re, im);
  if (ia >= 0 && ib >= 0) {
    addComplexEntry(A, ia, ib, -re, -im);
    addComplexEntry(A, ib, ia, -re, -im);
  }
}

function stampComplexCurrent(b, a, z, current) {
  const ia = nodeIndex(a);
  const iz = nodeIndex(z);
  if (ia >= 0) { b.re[ia] -= current.re; b.im[ia] -= current.im; }
  if (iz >= 0) { b.re[iz] += current.re; b.im[iz] += current.im; }
}

function stampComplexVoltage(A, b, a, z, branch, voltage) {
  const ia = nodeIndex(a);
  const iz = nodeIndex(z);
  if (ia >= 0) {
    addComplexEntry(A, ia, branch, 1);
    addComplexEntry(A, branch, ia, 1);
  }
  if (iz >= 0) {
    addComplexEntry(A, iz, branch, -1);
    addComplexEntry(A, branch, iz, -1);
  }
  b.re[branch] += voltage.re;
  b.im[branch] += voltage.im;
}

function addComplexCoefficient(A, rowNode, columnNode, value) {
  const row = nodeIndex(rowNode), column = nodeIndex(columnNode);
  if (row >= 0 && column >= 0) addComplexEntry(A, row, column, value);
}

function stampComplexControlledSource(A, topology, component, branchMap) {
  const p = topology.nodeFor(component.id, 0), n = topology.nodeFor(component.id, 1);
  const coefficient = controlledCoefficient(component);
  if (component.type === "CCCS") {
    const control = controlledBranch(component, branchMap);
    const pIndex = nodeIndex(p), nIndex = nodeIndex(n);
    const value = coefficient * control.direction;
    if (pIndex >= 0) addComplexEntry(A, pIndex, control.branch, value);
    if (nIndex >= 0) addComplexEntry(A, nIndex, control.branch, -value);
    return;
  }
  if (component.type === "CCVS") {
    const branch = branchMap.get(component.id);
    const control = controlledBranch(component, branchMap);
    const pIndex = nodeIndex(p), nIndex = nodeIndex(n);
    if (pIndex >= 0) { addComplexEntry(A, pIndex, branch, 1); addComplexEntry(A, branch, pIndex, 1); }
    if (nIndex >= 0) { addComplexEntry(A, nIndex, branch, -1); addComplexEntry(A, branch, nIndex, -1); }
    addComplexEntry(A, branch, control.branch, -(coefficient * control.direction));
    return;
  }
  const cp = topology.nodeFor(component.id, 2), cn = topology.nodeFor(component.id, 3);
  if (component.type === "VCCS") {
    addComplexCoefficient(A, p, cp, coefficient); addComplexCoefficient(A, p, cn, -coefficient);
    addComplexCoefficient(A, n, cp, -coefficient); addComplexCoefficient(A, n, cn, coefficient);
    return;
  }
  const branch = branchMap.get(component.id);
  const pIndex = nodeIndex(p), nIndex = nodeIndex(n), cpIndex = nodeIndex(cp), cnIndex = nodeIndex(cn);
  const add = (row, column, value) => { if (row >= 0 && column >= 0) addComplexEntry(A, row, column, value); };
  add(pIndex, branch, 1); add(nIndex, branch, -1);
  add(branch, pIndex, 1); add(branch, nIndex, -1);
  add(branch, cpIndex, -coefficient); add(branch, cnIndex, coefficient);
}

/** AC counterparts of the two magnetic parts: row b1: v1 - jwL1 i1 - jwM i2 = 0, row b2: v2 - jwM i1 - jwL2 i2 = 0; the ideal transformer is frequency independent. */
function stampComplexCoupledInductor(A, b, topology, component, branchMap, omega) {
  const { L1, L2, mutual } = coupledInductorParameters(component);
  const n1a = topology.nodeFor(component.id, 0), n1b = topology.nodeFor(component.id, 1), n2a = topology.nodeFor(component.id, 2), n2b = topology.nodeFor(component.id, 3);
  const b1 = branchMap.get(component.id), b2 = branchMap.get(secondaryCurrentKey(component.id));
  stampComplexVoltage(A, b, n1a, n1b, b1, complex());
  stampComplexVoltage(A, b, n2a, n2b, b2, complex());
  addComplexEntry(A, b1, b1, 0, -omega * L1); addComplexEntry(A, b1, b2, 0, -omega * mutual);
  addComplexEntry(A, b2, b1, 0, -omega * mutual); addComplexEntry(A, b2, b2, 0, -omega * L2);
}

function stampComplexIdealTransformer(A, topology, component, branchMap) {
  const { ratio } = idealTransformerParameters(component);
  const n1a = nodeIndex(topology.nodeFor(component.id, 0)), n1b = nodeIndex(topology.nodeFor(component.id, 1));
  const n2a = nodeIndex(topology.nodeFor(component.id, 2)), n2b = nodeIndex(topology.nodeFor(component.id, 3));
  const branch = branchMap.get(component.id);
  const add = (row, column, value) => { if (row >= 0 && column >= 0) addComplexEntry(A, row, column, value); };
  add(n1a, branch, 1); add(n1b, branch, -1); add(n2a, branch, -1 / ratio); add(n2b, branch, 1 / ratio);
  add(branch, n2a, 1); add(branch, n2b, -1); add(branch, n1a, -ratio); add(branch, n1b, ratio);
}

// Complex LU with partial pivoting on split re/im Float64Arrays: no per-operation
// object allocation. Same pivot selection (|z| via hypot) and singular test as the
// Gauss-Jordan elimination it replaces. Works in place: A and b are consumed.
function solveComplex(A, b) {
  const n = b.re.length;
  const re = A.re;
  const im = A.im;
  const columnScale = new Float64Array(n);
  for (let row = 0; row < n; row += 1) {
    for (let column = 0; column < n; column += 1) {
      const index = row * n + column;
      columnScale[column] = Math.max(columnScale[column], Math.hypot(re[index], im[index]));
    }
  }
  const pivots = new Int32Array(n);
  for (let column = 0; column < n; column += 1) {
    let pivot = column;
    let best = Math.hypot(re[column * n + column], im[column * n + column]);
    for (let row = column + 1; row < n; row += 1) {
      const magnitude = Math.hypot(re[row * n + column], im[row * n + column]);
      if (magnitude > best) { pivot = row; best = magnitude; }
    }
    if (best < PIVOT_ABSOLUTE_TOLERANCE && best <= Math.max(columnScale[column] * PIVOT_RELATIVE_TOLERANCE, PIVOT_ABSOLUTE_FLOOR)) throw new CircuitError("SINGULAR", "AC 회로 방정식이 특이행렬입니다.", "떠 있는 노드와 이상적 전원 연결을 확인하세요.");
    pivots[column] = pivot;
    if (pivot !== column) {
      for (let k = 0; k < n; k += 1) {
        const first = column * n + k, second = pivot * n + k;
        const swapRe = re[first]; re[first] = re[second]; re[second] = swapRe;
        const swapIm = im[first]; im[first] = im[second]; im[second] = swapIm;
      }
    }
    const base = column * n;
    const pivotRe = re[base + column], pivotIm = im[base + column];
    const denominator = pivotRe * pivotRe + pivotIm * pivotIm;
    for (let row = column + 1; row < n; row += 1) {
      const offset = row * n;
      const entryRe = re[offset + column], entryIm = im[offset + column];
      const factorRe = (entryRe * pivotRe + entryIm * pivotIm) / denominator;
      const factorIm = (entryIm * pivotRe - entryRe * pivotIm) / denominator;
      re[offset + column] = factorRe;
      im[offset + column] = factorIm;
      if (factorRe === 0 && factorIm === 0) continue;
      for (let k = column + 1; k < n; k += 1) {
        const upperRe = re[base + k], upperIm = im[base + k];
        re[offset + k] -= factorRe * upperRe - factorIm * upperIm;
        im[offset + k] -= factorRe * upperIm + factorIm * upperRe;
      }
    }
  }
  const xRe = b.re;
  const xIm = b.im;
  for (let column = 0; column < n; column += 1) {
    const pivot = pivots[column];
    if (pivot !== column) {
      const swapRe = xRe[column]; xRe[column] = xRe[pivot]; xRe[pivot] = swapRe;
      const swapIm = xIm[column]; xIm[column] = xIm[pivot]; xIm[pivot] = swapIm;
    }
  }
  for (let row = 1; row < n; row += 1) {
    const offset = row * n;
    let sumRe = xRe[row], sumIm = xIm[row];
    for (let k = 0; k < row; k += 1) {
      const lowerRe = re[offset + k], lowerIm = im[offset + k];
      sumRe -= lowerRe * xRe[k] - lowerIm * xIm[k];
      sumIm -= lowerRe * xIm[k] + lowerIm * xRe[k];
    }
    xRe[row] = sumRe;
    xIm[row] = sumIm;
  }
  for (let row = n - 1; row >= 0; row -= 1) {
    const offset = row * n;
    let sumRe = xRe[row], sumIm = xIm[row];
    for (let k = row + 1; k < n; k += 1) {
      const upperRe = re[offset + k], upperIm = im[offset + k];
      sumRe -= upperRe * xRe[k] - upperIm * xIm[k];
      sumIm -= upperRe * xIm[k] + upperIm * xRe[k];
    }
    const diagonalRe = re[offset + row], diagonalIm = im[offset + row];
    const denominator = diagonalRe * diagonalRe + diagonalIm * diagonalIm;
    xRe[row] = (sumRe * diagonalRe + sumIm * diagonalIm) / denominator;
    xIm[row] = (sumIm * diagonalRe - sumRe * diagonalIm) / denominator;
  }
  const result = new Array(n);
  for (let index = 0; index < n; index += 1) {
    if (!Number.isFinite(xRe[index]) || !Number.isFinite(xIm[index])) throw new CircuitError("NUMERIC_FAILURE", "AC 결과에 비유한 수가 발생했습니다.");
    result[index] = complex(xRe[index], xIm[index]);
  }
  return result;
}

function solveACPoint(circuit, topology, frequency, dcBias) {
  const omega = 2 * Math.PI * frequency;
  const { map: branchMap, size } = cachedBranchMap(circuit, "ac", topology);
  const A = complexZeros(size);
  const b = complexVector(size);
  for (const component of circuit.components) {
    const a = topology.nodeFor(component.id, 0);
    const z = pinCount(component.type) > 1 ? topology.nodeFor(component.id, 1) : 0;
    const p = component.props ?? {};
    if (component.type === "R") stampComplexConductance(A, a, z, 1 / parseValue(p.value), 0);
    if (component.type === "C") stampComplexConductance(A, a, z, 0, omega * parseValue(p.value));
    if (component.type === "L") stampComplexConductance(A, a, z, 0, -1 / (omega * parseValue(p.value)));
    if (component.type === "I") stampComplexCurrent(b, a, z, sourceValue(component, 0, "ac"));
    if (component.type === "V") stampComplexVoltage(A, b, a, z, branchMap.get(component.id), sourceValue(component, 0, "ac"));
    if (component.type === "CURRENT_SENSOR") stampComplexVoltage(A, b, a, z, branchMap.get(component.id), complex());
    if (component.type === "D") {
      const biasA = dcBias?.nodeVoltages[a] ?? 0;
      const biasZ = dcBias?.nodeVoltages[z] ?? 0;
      const conductance = diodeSmallSignalConductance(component, biasA - biasZ);
      stampComplexConductance(A, a, z, conductance, 0);
    }
    if (component.type === "OPAMP") {
      const plus = a;
      const minus = z;
      const out = topology.nodeFor(component.id, 2);
      const branch = branchMap.get(component.id);
      const outputIndex = nodeIndex(out);
      if (outputIndex >= 0) {
        addComplexEntry(A, outputIndex, branch, 1);
        addComplexEntry(A, branch, outputIndex, 1);
      }
      const gain = parseValue(p.gain ?? "100k");
      const plusIndex = nodeIndex(plus);
      const minusIndex = nodeIndex(minus);
      if (plusIndex >= 0) addComplexEntry(A, branch, plusIndex, -gain);
      if (minusIndex >= 0) addComplexEntry(A, branch, minusIndex, gain);
    }
    if (component.type === "OPAMP_IDEAL") {
      const out = topology.nodeFor(component.id, 2);
      const branch = branchMap.get(component.id);
      const outputIndex = nodeIndex(out);
      if (outputIndex >= 0) addComplexEntry(A, outputIndex, branch, 1);
      const plusIndex = nodeIndex(a);
      const minusIndex = nodeIndex(z);
      if (plusIndex >= 0) addComplexEntry(A, branch, plusIndex, 1);
      if (minusIndex >= 0) addComplexEntry(A, branch, minusIndex, -1);
    }
    if (component.type === "COUPLED_L") stampComplexCoupledInductor(A, b, topology, component, branchMap, omega);
    if (component.type === "XFMR_IDEAL") stampComplexIdealTransformer(A, topology, component, branchMap);
    if (["VCVS", "VCCS", "CCCS", "CCVS"].includes(component.type)) stampComplexControlledSource(A, topology, component, branchMap);
  }
  return { solution: solveComplex(A, b), branchMap };
}

function complexPoint(circuit, topology, solved, frequency, dcBias) {
  const nodeVoltages = { 0: complex() };
  for (let node = 1; node <= topology.nodeCount; node += 1) nodeVoltages[node] = solved.solution[node - 1];
  const componentCurrents = {};
  const omega = 2 * Math.PI * frequency;
  for (const component of circuit.components) {
    const a = topology.nodeFor(component.id, 0);
    const z = pinCount(component.type) > 1 ? topology.nodeFor(component.id, 1) : 0;
    const voltage = csub(nodeVoltages[a], nodeVoltages[z]);
    const p = component.props ?? {};
    if (component.type === "R") componentCurrents[component.id] = complex(voltage.re / parseValue(p.value), voltage.im / parseValue(p.value));
    if (component.type === "C") componentCurrents[component.id] = cmul(voltage, complex(0, omega * parseValue(p.value)));
    if (component.type === "L") componentCurrents[component.id] = cmul(voltage, complex(0, -1 / (omega * parseValue(p.value))));
    if (["V", "OPAMP", "OPAMP_IDEAL", "VCVS", "CURRENT_SENSOR", "CCVS"].includes(component.type)) componentCurrents[component.id] = solved.solution[solved.branchMap.get(component.id)] ?? complex();
    if (component.type === "VCCS") {
      const cp = topology.nodeFor(component.id, 2), cn = topology.nodeFor(component.id, 3);
      componentCurrents[component.id] = cmul(csub(nodeVoltages[cp], nodeVoltages[cn]), complex(controlledCoefficient(component), 0));
    }
    if (component.type === "CCCS") {
      const control = controlledBranch(component, solved.branchMap);
      componentCurrents[component.id] = cmul(solved.solution[control.branch] ?? complex(), complex(controlledCoefficient(component) * control.direction, 0));
    }
    if (component.type === "I") componentCurrents[component.id] = sourceValue(component, 0, "ac");
    if (component.type === "D") {
      const biasVoltage = (dcBias?.nodeVoltages[a] ?? 0) - (dcBias?.nodeVoltages[z] ?? 0);
      const conductance = diodeSmallSignalConductance(component, biasVoltage);
      componentCurrents[component.id] = cmul(voltage, complex(conductance, 0));
    }
    if (component.type === "COUPLED_L") {
      componentCurrents[component.id] = solved.solution[solved.branchMap.get(component.id)] ?? complex();
      componentCurrents[secondaryCurrentKey(component.id)] = solved.solution[solved.branchMap.get(secondaryCurrentKey(component.id))] ?? complex();
    }
    if (component.type === "XFMR_IDEAL") {
      const primary = solved.solution[solved.branchMap.get(component.id)] ?? complex();
      const ratio = idealTransformerParameters(component).ratio;
      componentCurrents[component.id] = primary;
      componentCurrents[secondaryCurrentKey(component.id)] = complex(-primary.re / ratio, -primary.im / ratio);
    }
    if (component.type === "GND") componentCurrents[component.id] = complex();
  }
  return { nodeVoltages, componentCurrents };
}

function acBiasPoint(circuit) {
  try {
    return simulateDC(circuit).points[0];
  } catch (error) {
    if (circuit.components.some((component) => component.type === "D")) throw error;
    return null;
  }
}

export function simulateACAtFrequency(circuit, frequencyValue) {
  const topology = buildTopology(circuit);
  const frequency = positiveValue(frequencyValue, "단일 페이저 주파수");
  assertAnalysisBudget(circuit, topology, "ac");
  const dcBias = acBiasPoint(circuit);
  const solved = solveACPoint(circuit, topology, frequency, dcBias);
  return {
    analysis: "ac-point",
    frequency,
    xValues: [frequency],
    points: [complexPoint(circuit, topology, solved, frequency, dcBias)],
    topology: { nodeIdByPin: topology.nodeIdByPin, nodeIdByJunction: topology.nodeIdByJunction },
  };
}

export function simulateAC(circuit, settings = {}) {
  const topology = buildTopology(circuit);
  const start = positiveValue(settings.startFrequency ?? "10", "시작 주파수");
  const end = positiveValue(settings.endFrequency ?? "1meg", "종료 주파수");
  const pointsPerDecade = positiveValue(settings.pointsPerDecade ?? 20, "decade당 점 수");
  if (!Number.isInteger(pointsPerDecade)) throw new CircuitError("INVALID_ANALYSIS", "decade당 점 수는 1 이상의 정수여야 합니다.");
  if (end <= start) throw new CircuitError("INVALID_ANALYSIS", "AC 종료 주파수는 시작 주파수보다 커야 합니다.");
  if (pointsPerDecade > 200) throw new CircuitError("TOO_MANY_POINTS", "decade당 점 수는 200 이하여야 합니다.");
  const count = Math.ceil((Math.log10(end) - Math.log10(start)) * pointsPerDecade);
  if (!Number.isFinite(count) || count > 20000) throw new CircuitError("TOO_MANY_POINTS", "AC 전체 표본 수는 20001개 이하여야 합니다.");
  assertAnalysisBudget(circuit, topology, "ac", count + 1);
  const dcBias = acBiasPoint(circuit);
  const xValues = [];
  const points = [];
  for (let index = 0; index <= count; index += 1) {
    const frequency = index === count ? end : start * 10 ** (index / pointsPerDecade);
    const solved = solveACPoint(circuit, topology, frequency, dcBias);
    xValues.push(frequency);
    points.push(complexPoint(circuit, topology, solved, frequency, dcBias));
  }
  return { analysis: "ac", xValues, points, topology: { nodeIdByPin: topology.nodeIdByPin, nodeIdByJunction: topology.nodeIdByJunction } };
}

export function simulate(circuit, settings = {}) {
  const analysis = settings.analysis ?? "dc";
  if (analysis === "dc") return simulateDC(circuit);
  if (analysis === "transient") return simulateTransient(circuit, settings);
  if (analysis === "ac") return simulateAC(circuit, settings);
  throw new CircuitError("INVALID_ANALYSIS", `지원하지 않는 해석입니다: ${analysis}`);
}

export function serializeCircuit(circuit) {
  validateCircuitStructure(circuit);
  const hasMagnetic = circuit.components?.some((component) => ["COUPLED_L", "XFMR_IDEAL"].includes(component.type));
  const hasBranchControlled = circuit.components?.some((component) => ["CURRENT_SENSOR", "CCCS", "CCVS"].includes(component.type));
  const version = hasMagnetic ? 4 : hasBranchControlled ? 3 : circuit.components?.some((component) => component.type === "VCVS" || component.type === "VCCS") ? 2 : 1;
  return JSON.stringify({
    version,
    ...(circuit.geometryVersion !== undefined ? { geometryVersion: circuit.geometryVersion } : {}),
    components: circuit.components ?? [],
    wires: circuit.wires ?? [],
    ...(circuit.junctions !== undefined ? { junctions: circuit.junctions } : {}),
  }, null, 2);
}

export function deserializeCircuit(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new CircuitError("INVALID_FILE", "JSON 파일을 읽을 수 없습니다.");
  }
  if (![1, 2, 3, 4].includes(parsed?.version) || !Array.isArray(parsed.components) || !Array.isArray(parsed.wires)) {
    throw new CircuitError("INVALID_FILE", "Circuit Lab 버전 1, 2, 3 또는 4 회로 파일이 아닙니다.");
  }
  const hasMagnetic = parsed.components.some((component) => ["COUPLED_L", "XFMR_IDEAL"].includes(component?.type));
  const hasBranchControlled = parsed.components.some((component) => ["CURRENT_SENSOR", "CCCS", "CCVS"].includes(component?.type));
  const hasVoltageControlled = parsed.components.some((component) => component?.type === "VCVS" || component?.type === "VCCS");
  const requiredVersion = hasMagnetic ? 4 : hasBranchControlled ? 3 : hasVoltageControlled ? 2 : 1;
  if (parsed.version !== requiredVersion) throw new CircuitError("INVALID_FILE", `이 회로 타입 집합은 version ${requiredVersion}로 저장해야 합니다.`);
  validateCircuitStructure(parsed);
  return {
    version: parsed.version,
    ...(parsed.geometryVersion !== undefined ? { geometryVersion: parsed.geometryVersion } : {}),
    components: parsed.components,
    wires: parsed.wires,
    ...(parsed.junctions !== undefined ? { junctions: parsed.junctions } : {}),
  };
}
