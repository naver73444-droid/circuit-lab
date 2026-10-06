import { UnionFind } from "./union-find.js";
import { endpointKey, junctionKey, parseValue, pinCount, pinKey, validateCircuitStructure } from "./circuit-engine.js";


function conductiveForAnalysis(component, analysis, frequency) {
  if (["R", "V", "L", "D", "VCVS", "CURRENT_SENSOR", "CCVS"].includes(component.type)) return true;
  if (component.type === "C") return analysis === "transient" || (analysis === "ac" && frequency > 0);
  return false;
}

export const CONNECTION_STATUS_META = {
  unwired: { badge: "!", label: "미배선 핀", short: "핀에 배선이 없습니다." },
  "no-ground": { badge: "G", label: "GND 없는 연결 묶음", short: "이어진 부분에 GND가 없습니다." },
  "analysis-floating": { badge: "F", label: "기준 경로 없음", short: "현재 해석에서 GND로 이어지는 경로가 없습니다." },
  "solver-check": { badge: "?", label: "해석 후 확인", short: "OP AMP가 있어 해석 결과로 확인합니다." },
  referenced: { badge: "✓", label: "GND 기준 경로", short: "GND로 이어져 있습니다." },
};

export function classifyCircuitConnections(circuit, analysis = "dc", { frequency = 0 } = {}) {
  validateCircuitStructure(circuit);
  const components = circuit.components;
  const junctions = circuit.junctions ?? [];
  const keys = [
    ...components.flatMap((component) => Array.from({ length: pinCount(component.type) }, (_, pin) => pinKey(component.id, pin))),
    ...junctions.map((junction) => junctionKey(junction.id)),
  ];
  const electrical = new UnionFind(keys);
  const physical = new UnionFind(keys);
  const incident = new Map(keys.map((key) => [key, 0]));
  for (const wire of circuit.wires) {
    const a = endpointKey(wire.a);
    const b = endpointKey(wire.b);
    electrical.union(a, b);
    physical.union(a, b);
    incident.set(a, (incident.get(a) ?? 0) + 1);
    incident.set(b, (incident.get(b) ?? 0) + 1);
  }
  for (const component of components) {
    const first = pinKey(component.id, 0);
    for (let pin = 1; pin < pinCount(component.type); pin += 1) physical.union(first, pinKey(component.id, pin));
  }

  const islandInfo = new Map();
  for (const component of components) {
    const root = physical.find(pinKey(component.id, 0));
    if (!islandInfo.has(root)) islandInfo.set(root, { hasGround: false, hasOpamp: false });
    const info = islandInfo.get(root);
    info.hasGround ||= component.type === "GND";
    info.hasOpamp ||= component.type === "OPAMP" || component.type === "OPAMP_IDEAL";
  }

  const graph = new Map();
  const addEdge = (a, b) => {
    if (a === b) return;
    if (!graph.has(a)) graph.set(a, new Set());
    if (!graph.has(b)) graph.set(b, new Set());
    graph.get(a).add(b);
    graph.get(b).add(a);
  };
  for (const component of components) {
    if (!conductiveForAnalysis(component, analysis, frequency)) continue;
    const roots = Array.from({ length: pinCount(component.type) }, (_, pin) => electrical.find(pinKey(component.id, pin)));
    if (["VCVS", "CURRENT_SENSOR", "CCVS"].includes(component.type)) { addEdge(roots[0], roots[1]); continue; }
    for (let pin = 1; pin < roots.length; pin += 1) addEdge(roots[0], roots[pin]);
  }
  const reachable = new Set();
  const queue = [];
  for (const ground of components.filter((component) => component.type === "GND")) {
    const root = electrical.find(pinKey(ground.id, 0));
    if (!reachable.has(root)) { reachable.add(root); queue.push(root); }
  }
  while (queue.length) {
    const root = queue.shift();
    for (const next of graph.get(root) ?? []) if (!reachable.has(next)) { reachable.add(next); queue.push(next); }
  }

  const byComponent = {};
  for (const component of components) {
    const pins = Array.from({ length: pinCount(component.type) }, (_, pin) => pinKey(component.id, pin));
    const missingPins = pins.map((key, pin) => ({ key, pin })).filter(({ key }) => (incident.get(key) ?? 0) === 0).map(({ pin }) => pin + 1);
    const island = islandInfo.get(physical.find(pins[0]));
    const floatingPins = pins.map((key, pin) => ({ root: electrical.find(key), pin })).filter(({ root }) => !reachable.has(root)).map(({ pin }) => pin + 1);
    let status = "referenced";
    if (missingPins.length) status = "unwired";
    else if (!island.hasGround) status = "no-ground";
    else if (floatingPins.length) status = island.hasOpamp ? "solver-check" : "analysis-floating";
    byComponent[component.id] = {
      status,
      ...CONNECTION_STATUS_META[status],
      missingPins,
      floatingPins,
      analysis,
    };
  }
  const counts = Object.values(byComponent).reduce((result, item) => {
    result[item.status] = (result[item.status] ?? 0) + 1;
    return result;
  }, {});
  return { byComponent, counts, analysis, limitation: "사전 reference 경로 검사이며 실제 MNA 수렴·전압원 모순은 실행 결과가 최종 판정합니다." };
}

export function connectionFrequency(settings) {
  if (settings?.analysis !== "ac") return 0;
  try { return parseValue(settings.phasorFrequency ?? settings.startFrequency ?? 0); }
  catch { return 0; }
}
