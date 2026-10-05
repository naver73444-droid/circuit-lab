import { parseValue } from "./circuit-engine.js";
import { circuitGeometryVersion, projectSplitPoint, snapPoint, splitRouteWaypoints } from "./circuit-geometry.js";

export function endpointKey(endpoint) {
  return endpoint?.junctionId !== undefined
    ? `J:${endpoint.junctionId}`
    : `P:${endpoint?.componentId}:${endpoint?.pin}`;
}

export function endpointsEqual(first, second) {
  return endpointKey(first) === endpointKey(second);
}

export function nextEntityId(items, prefix) {
  const used = new Set(items.map((item) => item.id));
  let index = 1;
  while (used.has(`${prefix}${index}`)) index += 1;
  return `${prefix}${index}`;
}

export function splitWireAtJunction(circuit, wireId, point, routePoints = null) {
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
    id: nextEntityId(copy.junctions, "J"),
    x: snapped.x,
    y: snapped.y,
  };
  const firstId = nextEntityId(copy.wires, "W");
  const secondId = nextEntityId([...copy.wires, { id: firstId }], "W");
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

function componentIdPrefix(type) {
  if (type === "GND") return "G";
  if (["OPAMP", "OPAMP_IDEAL"].includes(type)) return "U";
  return { VCVS: "E", VCCS: "G", CURRENT_SENSOR: "S", CCCS: "F", CCVS: "H" }[type] ?? type;
}

export function cloneComponentSet(circuit, componentIds, offset = 40) {
  const selected = new Set(componentIds);
  const originals = circuit.components.filter((component) => selected.has(component.id));
  const reserved = [...circuit.components];
  const idMap = new Map();
  for (const original of originals) {
    const id = nextEntityId(reserved, componentIdPrefix(original.type));
    idMap.set(original.id, id);
    reserved.push({ id });
  }
  const components = originals.map((original) => {
    const component = {
      ...structuredClone(original),
      id: idMap.get(original.id),
      ...snapPoint({ x: original.x + offset, y: original.y + offset }),
    };
    if (component.control?.elementId && idMap.has(component.control.elementId)) component.control.elementId = idMap.get(component.control.elementId);
    return component;
  });
  const reservedWires = [...circuit.wires];
  const wires = [];
  for (const original of circuit.wires) {
    if (!original.a?.componentId || !original.b?.componentId || !idMap.has(original.a.componentId) || !idMap.has(original.b.componentId)) continue;
    const wire = structuredClone(original);
    wire.id = nextEntityId([...reservedWires, ...wires], "W");
    wire.a.componentId = idMap.get(original.a.componentId);
    wire.b.componentId = idMap.get(original.b.componentId);
    wires.push(wire);
  }
  return { components, wires, idMap };
}

export function cloneSelectedComponent(circuit, componentId, offset = 40) {
  return cloneComponentSet(circuit, [componentId], offset).components[0] ?? null;
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
