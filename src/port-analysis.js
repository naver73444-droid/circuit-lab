import { CircuitError, componentDefaults, pinCount, simulateDC, validateCircuitStructure } from "./circuit-engine.js";
import { UnionFind } from "./union-find.js";

const TRIAL_CURRENT = 1e-3;
const TRIAL_VOLTAGE = 1;

const pinKey = (componentId, pin) => `pin:${componentId}:${pin}`;
const junctionKey = (junctionId) => `junction:${junctionId}`;
const endpointKey = (endpoint) => endpoint?.junctionId !== undefined
  ? junctionKey(endpoint.junctionId)
  : pinKey(endpoint?.componentId, endpoint?.pin);

function uniqueId(prefix, used) {
  let index = 1;
  while (used.has(`${prefix}${index}`)) index += 1;
  const id = `${prefix}${index}`;
  used.add(id);
  return id;
}

function createNetResolver(circuit) {
  validateCircuitStructure(circuit);
  const keys = [];
  for (const component of circuit.components) for (let pin = 0; pin < pinCount(component.type); pin += 1) keys.push(pinKey(component.id, pin));
  for (const junction of circuit.junctions ?? []) keys.push(junctionKey(junction.id));
  const uf = new UnionFind(keys, (key) => new CircuitError("PORT_ENDPOINT_MISSING", `포트 끝점이 없습니다: ${key}`));
  for (const wire of circuit.wires) uf.union(endpointKey(wire.a), endpointKey(wire.b));
  const grounds = circuit.components.filter((component) => component.type === "GND").map((component) => pinKey(component.id, 0));
  for (let index = 1; index < grounds.length; index += 1) uf.union(grounds[0], grounds[index]);
  return {
    root(endpoint) { return uf.find(endpointKey(endpoint)); },
    rootForPin(componentId, pin) { return uf.find(pinKey(componentId, pin)); },
  };
}

function validatePortRequest(circuit, request) {
  if (!request || typeof request !== "object") throw new CircuitError("PORT_REQUEST_INVALID", "DC 포트 요청이 없습니다.");
  const resolver = createNetResolver(circuit);
  const pRoot = resolver.root(request.p);
  const nRoot = resolver.root(request.n);
  if (pRoot === nRoot) throw new CircuitError("PORT_SAME_NET", "포트 p와 n은 서로 다른 net이어야 합니다.");
  if (circuit.components.some((component) => component.type === "D")) {
    throw new CircuitError("PORT_NONLINEAR_UNSUPPORTED", "다이오드가 포함된 회로의 전역 DC 테브난·노턴 등가는 지원하지 않습니다.", "AC·동작점 소신호 등가는 후속 범위입니다.");
  }
  const loadIds = [...new Set(request.externalLoadIds ?? [])];
  const components = new Map(circuit.components.map((component) => [component.id, component]));
  for (const id of loadIds) {
    const load = components.get(id);
    if (!load) throw new CircuitError("PORT_LOAD_MISSING", `제외할 외부 부하 '${id}'이(가) 없습니다.`);
    if (load.type === "GND") throw new CircuitError("PORT_LOAD_BOUNDARY", "GND 기준은 외부 부하 집합에서 제거할 수 없습니다.");
  }
  const removed = new Set(loadIds);
  if (removed.size) {
    const selectedRoots = new Set();
    const remainingRoots = new Set();
    for (const component of circuit.components) for (let pin = 0; pin < pinCount(component.type); pin += 1) {
      (removed.has(component.id) ? selectedRoots : remainingRoots).add(resolver.rootForPin(component.id, pin));
    }
    const boundaryRoots = [...selectedRoots].filter((root) => remainingRoots.has(root));
    if (boundaryRoots.length !== 2 || !boundaryRoots.includes(pRoot) || !boundaryRoots.includes(nRoot)) {
      throw new CircuitError("PORT_LOAD_BOUNDARY", "선택한 외부 부하 집합의 원망 접속 경계가 포트 p/n 두 net과 정확히 일치하지 않습니다.", "직렬·병렬 내부망은 함께 선택할 수 있지만 원망과 연결되는 제3 net은 허용하지 않습니다.");
    }
  }
  const dependent = circuit.components.find((component) => ["CCCS", "CCVS"].includes(component.type) && removed.has(component.control?.elementId));
  if (dependent) throw new CircuitError("PORT_LOAD_IS_CONTROL", `${dependent.props?.ref ?? dependent.id}이(가) 제외 부하를 제어 전류 대상으로 참조합니다.`, "제어 branch를 제거한 등가는 지원하지 않습니다.");
  return { resolver, pRoot, nRoot, loadIds, removed };
}

function cloneWithoutExternalLoads(circuit, validated) {
  const clone = structuredClone(circuit);
  clone.components = clone.components.filter((component) => !validated.removed.has(component.id));
  clone.wires = clone.wires.filter((wire) => ![wire.a, wire.b].some((endpoint) => endpoint.componentId !== undefined && validated.removed.has(endpoint.componentId)));
  clone.junctions ??= [];
  const usedJunctions = new Set(clone.junctions.map((junction) => junction.id));
  const usedWires = new Set(clone.wires.map((wire) => wire.id));
  const anchors = {};
  for (const [name, root] of [["p", validated.pRoot], ["n", validated.nRoot]]) {
    const members = [];
    for (const component of clone.components) for (let pin = 0; pin < pinCount(component.type); pin += 1) {
      if (validated.resolver.rootForPin(component.id, pin) === root) members.push({ componentId: component.id, pin });
    }
    if (!members.length) throw new CircuitError("PORT_LOAD_BOUNDARY", `외부 부하를 제외하면 포트 ${name} net에 원망 끝점이 남지 않습니다.`);
    const junctionId = uniqueId(`PORT_${name.toUpperCase()}_`, usedJunctions);
    clone.junctions.push({ id: junctionId, x: 0, y: 0 });
    const anchor = { junctionId };
    for (const member of members) clone.wires.push({ id: uniqueId("PORT_W_", usedWires), a: anchor, b: member });
    anchors[name] = anchor;
  }
  validateCircuitStructure(clone);
  return { circuit: clone, p: anchors.p, n: anchors.n };
}

function zeroIndependentDC(circuit) {
  const clone = structuredClone(circuit);
  for (const component of clone.components) if (component.type === "V" || component.type === "I") component.props = { ...component.props, dc: "0" };
  return clone;
}

function appendTrial(circuit, p, n, type, value, direction = "p-to-n") {
  const clone = structuredClone(circuit);
  const componentIds = new Set(clone.components.map((component) => component.id));
  const wireIds = new Set(clone.wires.map((wire) => wire.id));
  const id = uniqueId(type === "I" ? "PORT_TRIAL_I_" : "PORT_TRIAL_V_", componentIds);
  const props = { ...componentDefaults(type), ref: id, mode: "DC", dc: String(value) };
  clone.components.push({ id, type, x: 0, y: 0, rotation: 0, props });
  const first = direction === "n-to-p" ? n : p;
  const second = direction === "n-to-p" ? p : n;
  clone.wires.push({ id: uniqueId("PORT_TRIAL_W_", wireIds), a: { componentId: id, pin: 0 }, b: first });
  clone.wires.push({ id: uniqueId("PORT_TRIAL_W_", wireIds), a: { componentId: id, pin: 1 }, b: second });
  return { circuit: clone, id };
}

function readPortVoltage(result, p, n) {
  const pNode = p.junctionId !== undefined ? result.topology.nodeIdByJunction[p.junctionId] : result.topology.nodeIdByPin[`${p.componentId}:${p.pin}`];
  const nNode = n.junctionId !== undefined ? result.topology.nodeIdByJunction[n.junctionId] : result.topology.nodeIdByPin[`${n.componentId}:${n.pin}`];
  if (pNode === undefined || nNode === undefined) throw new CircuitError("PORT_ENDPOINT_MISSING", "해석 결과에서 포트 net을 찾을 수 없습니다.");
  const point = result.points[0];
  return point.nodeVoltages[pNode] - point.nodeVoltages[nNode];
}

function failure(error) {
  return { status: "error", error: { code: error?.code ?? "PORT_ANALYSIS_FAILED", message: error?.message ?? String(error), hint: error?.hint ?? "" } };
}

function solveOpen(circuit, p, n) {
  try {
    const result = simulateDC(circuit);
    return { status: "ok", voltage: readPortVoltage(result, p, n) };
  } catch (error) { return failure(error); }
}

function solveCurrentTrial(circuit, p, n) {
  const trial = appendTrial(circuit, p, n, "I", TRIAL_CURRENT, "n-to-p");
  try {
    const result = simulateDC(trial.circuit);
    return { status: "ok", current: TRIAL_CURRENT, voltage: readPortVoltage(result, p, n) };
  } catch (error) { return failure(error); }
}

function solveVoltageTrial(circuit, p, n, voltage) {
  const trial = appendTrial(circuit, p, n, "V", voltage, "p-to-n");
  try {
    const result = simulateDC(trial.circuit);
    return { status: "ok", voltage, currentInto: -(result.points[0].componentCurrents[trial.id] ?? 0), branchCurrent: result.points[0].componentCurrents[trial.id] ?? 0 };
  } catch (error) { return failure(error); }
}

function isPortOnlyIndependentCurrentNetwork(circuit, p, n) {
  const resolver = createNetResolver(circuit);
  const pRoot = resolver.root(p), nRoot = resolver.root(n);
  const components = circuit.components.filter((component) => component.type !== "GND");
  return components.length > 0 && components.every((component) => component.type === "I" && (() => {
    const roots = [resolver.rootForPin(component.id, 0), resolver.rootForPin(component.id, 1)];
    return (roots[0] === pRoot && roots[1] === nRoot) || (roots[0] === nRoot && roots[1] === pRoot);
  })());
}

function finite(value) { return { kind: "finite", value }; }
function undefinedValue(reason) { return { kind: "undefined", value: null, reason }; }

export function analyzeDCPort(circuit, request) {
  const before = JSON.stringify(circuit);
  const validated = validatePortRequest(circuit, request);
  const snapshot = cloneWithoutExternalLoads(circuit, validated);
  const zeroed = zeroIndependentDC(snapshot.circuit);
  const open = solveOpen(snapshot.circuit, snapshot.p, snapshot.n);
  const currentTrial = solveCurrentTrial(zeroed, snapshot.p, snapshot.n);
  const voltageTrial = solveVoltageTrial(zeroed, snapshot.p, snapshot.n, TRIAL_VOLTAGE);
  const short = solveVoltageTrial(snapshot.circuit, snapshot.p, snapshot.n, 0);

  let vth = open.status === "ok" ? finite(open.voltage) : undefinedValue(open.error.message);
  let rth;
  if (currentTrial.status === "ok") {
    const value = currentTrial.voltage / TRIAL_CURRENT;
    rth = value === 0 ? { kind: "zero", value: 0 } : finite(value);
  } else if (voltageTrial.status === "ok" && voltageTrial.currentInto !== 0) {
    rth = finite(TRIAL_VOLTAGE / voltageTrial.currentInto);
  } else {
    rth = undefinedValue(currentTrial.error?.message ?? "시험 여기로 Rth를 구할 수 없습니다.");
  }
  let inorton = short.status === "ok" ? finite(short.branchCurrent) : undefinedValue(short.error.message);
  let classification = "finite-or-partial";
  let clamps = null;
  if (open.status !== "ok" && isPortOnlyIndependentCurrentNetwork(snapshot.circuit, snapshot.p, snapshot.n)) {
    const clamp1 = solveVoltageTrial(snapshot.circuit, snapshot.p, snapshot.n, 1);
    const clamp2 = solveVoltageTrial(snapshot.circuit, snapshot.p, snapshot.n, 2);
    clamps = { oneVolt: clamp1, twoVolt: clamp2 };
    const flat = voltageTrial.status === "ok" && voltageTrial.currentInto === 0
      && clamp1.status === "ok" && clamp2.status === "ok"
      && Math.abs(clamp1.branchCurrent - clamp2.branchCurrent) <= 1e-12;
    if (flat && short.status === "ok") {
      rth = { kind: "infinite", value: null };
      vth = undefinedValue("이상 전류원형 포트의 개방 전압은 정해지지 않습니다.");
      inorton = finite(short.branchCurrent);
      classification = "ideal-current";
    }
  }
  if (vth.kind === "finite" && rth.kind === "zero" && inorton.kind === "undefined") classification = "ideal-voltage";
  if (rth.kind === "undefined" && classification !== "ideal-current") {
    throw new CircuitError("PORT_RTH_UNRESOLVED", "기존 DC 해석으로 포트 저항을 유일하게 구할 수 없습니다.", "내부 이상 branch 비유일 또는 지원 밖 구조를 확인하세요.", { open, currentTrial, voltageTrial, short });
  }
  const residual = vth.kind === "finite" && rth.kind === "finite" && inorton.kind === "finite"
    ? vth.value - rth.value * inorton.value
    : null;
  if (JSON.stringify(circuit) !== before) throw new CircuitError("PORT_MUTATED_INPUT", "포트 분석이 원본 회로를 변경했습니다.");
  return {
    analysis: "dc-port",
    classification,
    port: { p: structuredClone(request.p), n: structuredClone(request.n), externalLoadIds: validated.loadIds },
    directions: { voltage: "Vp−Vn", currentInto: "p에서 원망으로 유입", loadCurrent: "p→n", equation: "V=Vth+Rth·I_into=Vth−Rth·I_load" },
    equivalent: { vth, rth, in: inorton, residual },
    trials: { open, current: currentTrial, voltage: voltageTrial, short, clamps },
  };
}
