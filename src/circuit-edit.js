import { componentDefaults, endpointKey, parseValue, pinCount } from "./circuit-engine.js";
import { circuitGeometryVersion, projectSplitPoint, snapPoint, splitRouteWaypoints } from "./circuit-geometry.js";

export { endpointKey };

export function endpointsEqual(first, second) {
  return endpointKey(first) === endpointKey(second);
}

/** Does this wire endpoint still point at something that exists (a junction, or an in-range pin of a part)? */
export function endpointExists(circuit, endpoint) {
  if (!endpoint || typeof endpoint !== "object") return false;
  if (endpoint.junctionId !== undefined) return (circuit.junctions ?? []).some((junction) => junction.id === endpoint.junctionId);
  const component = circuit.components?.find((item) => item.id === endpoint.componentId);
  return Boolean(component) && Number.isInteger(endpoint.pin) && endpoint.pin >= 0 && endpoint.pin < pinCount(component.type);
}

export function nextEntityId(items, prefix) {
  const used = new Set(items.map((item) => item.id));
  let index = 1;
  while (used.has(`${prefix}${index}`)) index += 1;
  return `${prefix}${index}`;
}

/**
 * Split a wire with a new junction. `allocator` (see id-allocator.js) makes the new junction and wire ids never-reused ones; without it the
 * first free ids are taken.
 */
export function splitWireAtJunction(circuit, wireId, point, routePoints = null, allocator = null) {
  const copy = structuredClone({ ...circuit, junctions: circuit.junctions ?? [] });
  const index = copy.wires.findIndex((wire) => wire.id === wireId);
  if (index < 0) throw new Error(`배선을 찾을 수 없습니다: ${wireId}`);
  const original = copy.wires[index];
  const projected = routePoints
    ? projectSplitPoint(routePoints, point, circuitGeometryVersion(copy))
    : { point: snapPoint(point) };
  const snapped = projected.point;
  if (routePoints?.length >= 2) {
    const first = routePoints[0];
    const last = routePoints.at(-1);
    const equal = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-9;
    if (equal(snapped, first) || equal(snapped, last)) {
      const endpoint = structuredClone(equal(snapped, first) ? original.a : original.b);
      const junction = endpoint.junctionId ? copy.junctions.find((item) => item.id === endpoint.junctionId) : null;
      return { circuit: copy, junction, endpoint, unchanged: true, replacementWireId: wireId, splitWireIds: [wireId] };
    }
  }
  const split = routePoints ? splitRouteWaypoints(routePoints, snapped) : { first: [], second: [] };
  const junction = {
    id: allocator ? allocator.next("J", copy.junctions) : nextEntityId(copy.junctions, "J"),
    x: snapped.x,
    y: snapped.y,
  };
  const firstId = allocator ? allocator.next("W", copy.wires) : nextEntityId(copy.wires, "W");
  const secondId = allocator ? allocator.next("W", copy.wires) : nextEntityId([...copy.wires, { id: firstId }], "W");
  copy.junctions.push(junction);
  copy.wires.splice(index, 1,
    { id: firstId, a: original.a, b: { junctionId: junction.id }, waypoints: split.first },
    { id: secondId, a: { junctionId: junction.id }, b: original.b, waypoints: split.second },
  );
  return { circuit: copy, junction, endpoint: { junctionId: junction.id }, unchanged: false, replacementWireId: firstId, splitWireIds: [firstId, secondId] };
}

export function retargetWireProbes(probes, wireId, replacementWireId, split = null) {
  return probes.map((probe) => {
    if (probe.wireId !== wireId) return probe;
    const anchor = probe.junctionId !== undefined ? { junctionId: probe.junctionId } : { componentId: probe.componentId, pin: probe.pin };
    const matching = split?.circuit.wires.find((wire) => split.splitWireIds.includes(wire.id) && (endpointsEqual(wire.a, anchor) || endpointsEqual(wire.b, anchor)));
    return { ...probe, wireId: matching?.id ?? replacementWireId };
  });
}

export function deleteJunctionFromCircuit(circuit, junctionId, probes = []) {
  const incidentWireIds = new Set(
    circuit.wires
      .filter((wire) => wire.a?.junctionId === junctionId || wire.b?.junctionId === junctionId)
      .map((wire) => wire.id),
  );
  return {
    circuit: {
      ...circuit,
      junctions: (circuit.junctions ?? []).filter((junction) => junction.id !== junctionId),
      wires: circuit.wires.filter((wire) => !incidentWireIds.has(wire.id)),
    },
    probes: probes.filter((probe) => probe.junctionId !== junctionId && !incidentWireIds.has(probe.wireId)),
    removedWireIds: [...incidentWireIds],
  };
}

/** The id prefix of a new part of this type ("R", "G" for GND and VCCS, "U" for OP AMPs ...). */
export function componentIdPrefix(type) {
  if (type === "GND") return "G";
  if (["OPAMP", "OPAMP_IDEAL"].includes(type)) return "U";
  return { VCVS: "E", VCCS: "G", CURRENT_SENSOR: "S", CCCS: "F", CCVS: "H" }[type] ?? type;
}

/** The reference prefix a new part of this type gets ("R", "C", "U" …); null for parts whose reference carries no number (GND). */
function referencePrefix(type) {
  try {
    const ref = componentDefaults(type, 1).ref;
    return type === "GND" ? null : ref.slice(0, -1);
  } catch { return null; }
}

/**
 * The reference label a copy gets: the original's label when no other part uses it (cutting and pasting back keeps "R1"), otherwise the
 * next free one for the type, counted from the new id's number exactly like placing a new part (R3, R4 …). `used` is updated.
 */
export function referenceForCopy(type, originalRef, newId, used) {
  const prefix = referencePrefix(type);
  if (prefix === null || typeof originalRef !== "string") return originalRef;
  if (originalRef && !used.has(originalRef)) { used.add(originalRef); return originalRef; }
  let index = Number(/\d+/.exec(newId)?.[0] ?? 1) || 1;
  while (used.has(`${prefix}${index}`)) index += 1;
  const ref = `${prefix}${index}`;
  used.add(ref);
  return ref;
}

const endpointInSet = (end, componentIds, junctionIds) => end?.junctionId !== undefined ? junctionIds.has(end.junctionId) : componentIds.has(end?.componentId);

/**
 * A self-contained copy of some parts (and optionally junctions) of a circuit: the items themselves plus every wire whose two
 * ends both lie inside the set. Wires that leave the set are dropped. Nothing in it shares references with the circuit.
 */
export function extractFragment(circuit, componentIds, junctionIds = []) {
  const components = new Set(componentIds), junctions = new Set(junctionIds);
  return structuredClone({
    components: circuit.components.filter((component) => components.has(component.id)),
    junctions: (circuit.junctions ?? []).filter((junction) => junctions.has(junction.id)),
    wires: circuit.wires.filter((wire) => endpointInSet(wire.a, components, junctions) && endpointInSet(wire.b, components, junctions)),
  });
}

/**
 * Instantiate a fragment into `circuit` (which is not modified): fresh ids that cannot collide with the circuit or each other,
 * every position/waypoint shifted by `offset`, wire endpoints and controlled-source references that point inside the fragment remapped.
 * A reference to an element that is not part of the fragment keeps its (external) id, unless `resolveControl(elementId, component)` is given and
 * says no: then the reference is removed (the part's id is listed in `clearedControls`) instead of silently binding to whatever shares the id.
 * Copies get a free reference label (R3 …) instead of repeating the original's.
 * `allocator` (id-allocator.js) hands out ids above everything ever issued in the project, so a copy can never take the id of a part that
 * was deleted (and that a clipboard or another part may still point at); without it the first free ids are used.
 */
export function remapFragment(circuit, fragment, offset = 40, { resolveControl = null, allocator = null } = {}) {
  const reserved = [...circuit.components];
  const usedRefs = new Set(circuit.components.map((component) => component.props?.ref).filter((ref) => typeof ref === "string"));
  const idMap = new Map();
  for (const original of fragment.components) {
    const id = allocator ? allocator.next(componentIdPrefix(original.type), circuit.components) : nextEntityId(reserved, componentIdPrefix(original.type));
    idMap.set(original.id, id);
    reserved.push({ id });
  }
  const reservedJunctions = [...(circuit.junctions ?? [])];
  const junctionMap = new Map();
  for (const original of fragment.junctions ?? []) {
    const id = allocator ? allocator.next("J", circuit.junctions) : nextEntityId(reservedJunctions, "J");
    junctionMap.set(original.id, id);
    reservedJunctions.push({ id });
  }
  const clearedControls = [];
  const components = fragment.components.map((original) => {
    const component = { ...structuredClone(original), id: idMap.get(original.id), ...snapPoint({ x: original.x + offset, y: original.y + offset }) };
    if (component.props && typeof component.props.ref === "string") component.props.ref = referenceForCopy(component.type, component.props.ref, component.id, usedRefs);
    if (component.control?.elementId && idMap.has(component.control.elementId)) component.control.elementId = idMap.get(component.control.elementId);
    else if (component.control && resolveControl && !resolveControl(component.control.elementId, component)) { delete component.control; clearedControls.push(component.id); }
    return component;
  });
  const junctions = (fragment.junctions ?? []).map((original) => ({ ...structuredClone(original), id: junctionMap.get(original.id), ...snapPoint({ x: original.x + offset, y: original.y + offset }) }));
  const remapEnd = (end) => {
    const copy = structuredClone(end);
    if (copy.junctionId !== undefined) copy.junctionId = junctionMap.get(end.junctionId);
    else copy.componentId = idMap.get(end.componentId);
    return copy;
  };
  const inside = (end) => end?.junctionId !== undefined ? junctionMap.has(end.junctionId) : idMap.has(end?.componentId);
  const wires = [];
  for (const original of fragment.wires ?? []) {
    if (!inside(original.a) || !inside(original.b)) continue;
    const wire = structuredClone(original);
    wire.id = allocator ? allocator.next("W", circuit.wires) : nextEntityId([...circuit.wires, ...wires], "W");
    wire.a = remapEnd(original.a);
    wire.b = remapEnd(original.b);
    if (Array.isArray(wire.waypoints)) wire.waypoints = wire.waypoints.map((point) => snapPoint({ x: point.x + offset, y: point.y + offset }));
    wires.push(wire);
  }
  return { components, wires, junctions, idMap, junctionMap, clearedControls };
}

export function cloneComponentSet(circuit, componentIds, offset = 40, { junctionIds = [], allocator = null } = {}) {
  return remapFragment(circuit, extractFragment(circuit, componentIds, junctionIds), offset, { allocator });
}

export function classifyNumericInput(input, { positive = false } = {}) {
  const value = String(input ?? "").trim();
  if (value === "" || value === "+" || value === "-" || /[eE][+-]?$/.test(value)) return { status: "editing" };
  try {
    const numeric = parseValue(value);
    if (positive && !(numeric > 0)) return { status: "invalid" };
    return { status: "valid", value: numeric };
  } catch {
    return { status: "invalid" };
  }
}

export function acceptsRunGeneration(startGeneration, currentGeneration) {
  return startGeneration === currentGeneration;
}

/** Remove a component together with incident wires and probes anchored to those wires. */
export function deleteComponentFromCircuit(circuit, componentId, probes = []) {
  const removedWireIds = new Set(circuit.wires.filter((wire) => wire.a?.componentId === componentId || wire.b?.componentId === componentId).map((wire) => wire.id));
  return {
    circuit: { ...circuit, components: circuit.components.filter((component) => component.id !== componentId), wires: circuit.wires.filter((wire) => !removedWireIds.has(wire.id)) },
    probes: probes.filter((probe) => probe.componentId !== componentId && !removedWireIds.has(probe.wireId)),
    removedWireIds: [...removedWireIds],
  };
}

/**
 * Delete a mixed selection ({kind: "component" | "wire" | "junction", id}) in one pass: parts first (their wires and probes go with them),
 * then junctions (their wires go with them), then the explicitly selected wires. The input is not modified.
 */
export function deleteSelectionFromCircuit(circuit, items, probes = []) {
  let current = circuit, currentProbes = probes;
  for (const item of items.filter((entry) => entry.kind === "component")) {
    const deleted = deleteComponentFromCircuit(current, item.id, currentProbes);
    current = deleted.circuit; currentProbes = deleted.probes;
  }
  for (const item of items.filter((entry) => entry.kind === "junction")) {
    const deleted = deleteJunctionFromCircuit(current, item.id, currentProbes);
    current = deleted.circuit; currentProbes = deleted.probes;
  }
  const wireIds = new Set(items.filter((entry) => entry.kind === "wire").map((entry) => entry.id));
  if (wireIds.size) {
    current = { ...current, wires: current.wires.filter((wire) => !wireIds.has(wire.id)) };
    currentProbes = currentProbes.filter((probe) => !wireIds.has(probe.wireId));
  }
  return { circuit: current, probes: currentProbes };
}
