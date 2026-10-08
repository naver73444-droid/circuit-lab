// Pure helpers for the "build a circuit -> run -> see the result" flow of a first-time user (no DOM):
//  - suggestProbes(): the probes the empty waveform panel offers to add in one step, and the node chips it lists;
//  - suggestGroundFix(): where a GND goes when a circuit has none (the source's negative terminal).
import { endpointKey, junctionKey, pinCount, pinKey } from "./circuit-engine.js";
import { circuitGeometryVersion, localPin, pinPosition, snapPoint } from "./circuit-geometry.js";
import { currentProbeLabel } from "./current-direction.js";
import { UnionFind } from "./union-find.js";

const PASSIVE = new Set(["R", "C", "L", "D"]);
const OPAMP_TYPES = new Set(["OPAMP", "OPAMP_IDEAL"]);
const OPAMP_OUTPUT_PIN = 2;
const MAX_SUGGESTED_VOLTAGES = 2;
const MAX_NODE_CHIPS = 8;

const refOf = (component) => component.props?.ref ?? component.id;
const voltageSpec = (component, pin) => ({ kind: "voltage", key: `V:${component.id}:${pin}`, componentId: component.id, pin, label: `V(${refOf(component)}.${pin + 1})` });

/**
 * The electrical nodes of a circuit as drawn (wires, junctions and pins joined), each with its pins, whether it is ground, and whether it
 * is a terminal of an independent voltage source. Wires that point at missing pins are ignored, so a half-edited circuit still works.
 */
export function circuitNodes(circuit) {
  const components = circuit?.components ?? [];
  const keys = [
    ...components.flatMap((component) => Array.from({ length: pinCount(component.type) }, (_, pin) => pinKey(component.id, pin))),
    ...(circuit?.junctions ?? []).map((junction) => junctionKey(junction.id)),
  ];
  const known = new Set(keys);
  const uf = new UnionFind(keys);
  for (const wire of circuit?.wires ?? []) {
    const a = endpointKey(wire?.a), b = endpointKey(wire?.b);
    if (known.has(a) && known.has(b)) uf.union(a, b);
  }
  const nodes = new Map();
  const rootOf = (componentId, pin) => uf.find(pinKey(componentId, pin));
  components.forEach((component) => {
    for (let pin = 0; pin < pinCount(component.type); pin += 1) {
      const root = rootOf(component.id, pin);
      if (!nodes.has(root)) nodes.set(root, { root, order: nodes.size, pins: [], componentIds: new Set(), ground: false, source: false });
      const node = nodes.get(root);
      node.pins.push({ component, pin });
      node.ground ||= component.type === "GND";
      if (component.type !== "GND") node.componentIds.add(component.id);
    }
  });
  for (const component of components) {
    if (component.type !== "V") continue;
    for (let pin = 0; pin < 2; pin += 1) nodes.get(rootOf(component.id, pin)).source = true;
  }
  return { nodes, rootOf };
}

/** Steps from the driving sources to every node, walking through parts but never through ground (ground would make everything 2 apart). */
function sourceDistances(circuit, { nodes, rootOf }) {
  const neighbours = new Map([...nodes.keys()].map((root) => [root, new Set()]));
  for (const component of circuit.components ?? []) {
    const roots = Array.from({ length: pinCount(component.type) }, (_, pin) => rootOf(component.id, pin));
    for (const a of roots) for (const b of roots) if (a !== b) neighbours.get(a).add(b);
  }
  const startsFor = (type) => (circuit.components ?? []).filter((component) => component.type === type)
    .flatMap((component) => [0, 1].map((pin) => rootOf(component.id, pin))).filter((root) => !nodes.get(root).ground);
  const starts = [...new Set(startsFor("V").length ? startsFor("V") : startsFor("I"))];
  const distance = new Map(starts.map((root) => [root, 0]));
  const queue = [...starts];
  while (queue.length) {
    const root = queue.shift();
    for (const next of neighbours.get(root)) {
      if (distance.has(next) || nodes.get(next).ground) continue;
      distance.set(next, distance.get(root) + 1);
      queue.push(next);
    }
  }
  // Without any source every node counts as equally far: the drawing order decides.
  return (root) => (nodes.get(root).ground ? Infinity : distance.get(root) ?? (starts.length ? -1 : 0));
}

/**
 * The pin a voltage probe of this node goes on, so its label names the part a student reads the voltage across: an op amp output first,
 * then the passive part leading furthest away from the source (a part whose other end is ground — the output element — wins).
 */
function representativePin(node, distanceOf, rootOf) {
  const opampOut = node.pins.find(({ component, pin }) => OPAMP_TYPES.has(component.type) && pin === OPAMP_OUTPUT_PIN);
  if (opampOut) return opampOut;
  const passive = node.pins.filter(({ component }) => PASSIVE.has(component.type))
    .map((entry) => ({ entry, far: distanceOf(rootOf(entry.component.id, 1 - entry.pin)) }));
  if (passive.length) return passive.reduce((best, item) => (item.far > best.far ? item : best)).entry;
  return node.pins.find(({ component }) => component.type !== "GND" && component.type !== "V") ?? node.pins.find(({ component }) => component.type !== "GND") ?? null;
}

/**
 * Probes for a circuit that has none. Voltage: 1–2 output-like nodes — not ground, not a voltage-source terminal, at least two parts —
 * the ones furthest from the source first (an op amp output breaks ties); a circuit whose only node is the source node (everything in
 * parallel with the source) gets that node. Current: the first voltage source (else the first current source).
 * `nodes` lists every non-ground node once as a chip (suggested ones first) so the student can pick another one.
 */
export function suggestProbes(circuit) {
  const empty = { voltage: [], current: null, probes: [], nodes: [] };
  if (!circuit?.components?.length) return empty;
  let graph;
  try { graph = circuitNodes(circuit); } catch { return empty; }
  const { nodes, rootOf } = graph;
  const distanceOf = sourceDistances(circuit, graph);
  const usable = [...nodes.values()].filter((node) => !node.ground && node.componentIds.size > 0);
  const opampOutput = (node) => node.pins.some(({ component, pin }) => OPAMP_TYPES.has(component.type) && pin === OPAMP_OUTPUT_PIN);
  const rank = (a, b) => distanceOf(b.root) - distanceOf(a.root) || Number(opampOutput(b)) - Number(opampOutput(a)) || a.order - b.order;
  let outputs = usable.filter((node) => !node.source && node.componentIds.size >= 2).sort(rank);
  if (!outputs.length) outputs = usable.filter((node) => node.source && node.componentIds.size >= 2).sort(rank);
  const specFor = (node) => {
    const chosen = representativePin(node, distanceOf, rootOf);
    return chosen ? voltageSpec(chosen.component, chosen.pin) : null;
  };
  const voltage = outputs.slice(0, MAX_SUGGESTED_VOLTAGES).map(specFor).filter(Boolean);
  const suggestedRoots = new Set(outputs.slice(0, MAX_SUGGESTED_VOLTAGES).map((node) => node.root));
  const others = usable.filter((node) => !suggestedRoots.has(node.root)).sort((a, b) => a.order - b.order);
  const chips = [...voltage, ...others.map(specFor).filter(Boolean)].slice(0, MAX_NODE_CHIPS);
  const sourcePart = circuit.components.find((component) => component.type === "V") ?? circuit.components.find((component) => component.type === "I");
  const current = sourcePart
    ? { kind: "current", key: `I:${sourcePart.id}`, componentId: sourcePart.id, label: currentProbeLabel(sourcePart, circuitGeometryVersion(circuit), 1) }
    : null;
  return { voltage, current, probes: [...voltage, ...(current ? [current] : [])], nodes: chips };
}

/**
 * A circuit without any GND: put one under the negative terminal (pin 2) of the first voltage source — else a current source, else the
 * first two-terminal part — on the grid, below whatever already sits there. null when the circuit already has a GND or nothing to attach to.
 */
export function suggestGroundFix(circuit) {
  const components = circuit?.components ?? [];
  if (!components.length || components.some((component) => component.type === "GND")) return null;
  const source = components.find((component) => component.type === "V") ?? components.find((component) => component.type === "I")
    ?? components.find((component) => pinCount(component.type) >= 2);
  if (!source) return null;
  const pin = 1;
  const geometryVersion = circuitGeometryVersion(circuit);
  const at = pinPosition(source, pin, geometryVersion);
  const reach = Math.abs(localPin("GND", 0, geometryVersion).y);
  let point = snapPoint({ x: at.x, y: at.y + 20 + reach });
  const occupied = (candidate) => components.some((component) => Math.abs(component.x - candidate.x) < 40 && Math.abs(component.y - candidate.y) < 40);
  for (let step = 0; step < 6 && occupied(point); step += 1) point = { x: point.x, y: point.y + 40 };
  const terminal = ["V", "I"].includes(source.type) ? "− 단자" : `${pin + 1}번 핀`;
  return { sourceId: source.id, pin, x: point.x, y: point.y, label: `GND 추가 (${refOf(source)} ${terminal})` };
}
