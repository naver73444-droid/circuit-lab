/**
 * Y–Δ conversion on a circuit (DOM 없음): recognise a Y or a Δ among three resistors and rewrite it into the equivalent other form.
 *
 * Net mapping is the solver's own (buildTopology/nodeFor, so two GND symbols are one net); a circuit the solver rejects (no GND yet,
 * floating part) falls back to the same wire/GND union-find so a half-built circuit can still be converted.
 *
 * Rewrite rules (everything else in the circuit, including other parts on the corner nodes, stays connected):
 *  - Y→Δ: the centre node must hold nothing but the three arms. The arms, their wires and the centre junctions go; three resistors join
 *    A–B, B–C, C–A. Each corner keeps its place in the network: the wire that led to the removed arm outer pin is reused as the anchor.
 *  - Δ→Y: the three edges go; a new junction (centre) joins three resistors from A, B, C.
 *  A removed pin is replaced by an "anchor": the endpoint its single wire led to, or (several wires / none) a new junction at the pin, so
 *  connectivity and probes on the corners survive. Voltage probes on a removed outer pin move to its anchor; probes that only existed
 *  on removed parts (centre, resistor current) are dropped.
 */
import { CIRCUIT_LIMITS, buildTopology, componentDefaults, endpointKey, pinCount, validateCircuitStructure } from "./circuit-engine.js";
import { UnionFind } from "./union-find.js";
import { GRID_SIZE, circuitGeometryVersion, pinPosition, snapPoint } from "./circuit-geometry.js";
import { createIdAllocator } from "./id-allocator.js";
import { convertDeltaToY, convertYToDelta, parseResistance, resistanceCircuitText, resistanceText } from "./y-delta-model.js";

const refOf = (component) => component?.props?.ref ?? component?.id;
const isEnd = (end, other) => endpointKey(end) === endpointKey(other);

/** { pin(componentId, pin) → net key, junction(id) → net key } with the solver's net semantics. */
function createNetResolver(circuit) {
  try {
    const topology = buildTopology(circuit);
    return {
      pin: (componentId, pin) => `n${topology.nodeFor(componentId, pin)}`,
      junction: (id) => (topology.nodeIdByJunction[id] !== undefined ? `n${topology.nodeIdByJunction[id]}` : `j:${id}`),
    };
  } catch {
    const keys = [];
    for (const component of circuit.components) for (let pin = 0; pin < pinCount(component.type); pin += 1) keys.push(endpointKey({ componentId: component.id, pin }));
    for (const junction of circuit.junctions ?? []) keys.push(endpointKey({ junctionId: junction.id }));
    const sets = new UnionFind(keys);
    const safeUnion = (a, b) => { try { sets.union(a, b); } catch { /* dangling wire end: ignored like a floating one */ } };
    for (const wire of circuit.wires) if (wire?.a && wire?.b) safeUnion(endpointKey(wire.a), endpointKey(wire.b));
    const grounds = circuit.components.filter((component) => component.type === "GND").map((component) => endpointKey({ componentId: component.id, pin: 0 }));
    for (const ground of grounds.slice(1)) safeUnion(grounds[0], ground);
    return {
      pin: (componentId, pin) => `u${sets.find(endpointKey({ componentId, pin }))}`,
      junction: (id) => `u${sets.find(endpointKey({ junctionId: id }))}`,
    };
  }
}

const netOfEndpoint = (resolver, end) => (end?.junctionId !== undefined ? resolver.junction(end.junctionId) : resolver.pin(end.componentId, end.pin));

const none = (reason) => ({ kind: null, reason });

/**
 * What the three resistors (ids) form.
 *   { kind: "Y", resistors: [RA, RB, RC], center, outer: [netA, netB, netC], arms: [{ id, outerPin, centerPin }] }
 *   { kind: "Δ", resistors: [RAB, RBC, RCA], nodes: [netA, netB, netC], edges: [{ id, pinAt: { [net]: pin } }] }
 *   { kind: null, reason }   (Korean reason)
 * Resistors are ordered as they appear in the circuit's part list; the outer node of the first one is A, and so on.
 */
export function detectYDelta(circuit, resistorIds) {
  if (!Array.isArray(resistorIds) || new Set(resistorIds).size !== 3) return none("저항 3개를 선택하세요.");
  const parts = circuit.components.filter((component) => resistorIds.includes(component.id));
  if (parts.length !== 3) return none("선택한 부품을 회로에서 찾을 수 없습니다.");
  if (parts.some((component) => component.type !== "R")) return none("Y–Δ 변환은 저항 3개에만 쓸 수 있습니다.");
  for (const part of parts) {
    try { parseResistance(part.props?.value, refOf(part)); } catch (error) { return none(`${refOf(part)}의 저항값이 올바르지 않습니다. ${error.message}`); }
  }
  const resolver = createNetResolver(circuit);
  const nets = parts.map((part) => [resolver.pin(part.id, 0), resolver.pin(part.id, 1)]);
  const shorted = parts.findIndex((_, index) => nets[index][0] === nets[index][1]);
  if (shorted >= 0) return none(`${refOf(parts[shorted])}의 양 끝이 같은 노드에 연결돼 있어 Y도 Δ도 아닙니다.`);

  const commons = [...new Set(nets.flat())].filter((net) => nets.every((pair) => pair.includes(net)));
  const allNets = new Set(nets.flat());
  if (commons.length === 2) return none("세 저항이 같은 두 노드 사이에 병렬로 연결돼 있습니다. Y나 Δ가 아닙니다.");
  if (commons.length === 1) {
    const center = commons[0];
    const outer = nets.map((pair) => (pair[0] === center ? pair[1] : pair[0]));
    if (new Set(outer).size !== 3) return none("두 저항의 바깥쪽 끝이 같은 노드입니다. Y가 아닙니다.");
    const selected = new Set(parts.map((part) => part.id));
    const crowded = [];
    for (const component of circuit.components) {
      if (selected.has(component.id)) continue;
      for (let pin = 0; pin < pinCount(component.type); pin += 1) if (resolver.pin(component.id, pin) === center) crowded.push(refOf(component));
    }
    if (crowded.length) return none(`중심 노드에 다른 부품(${[...new Set(crowded)].slice(0, 3).join(", ")})이 연결돼 있어 Y→Δ로 바꿀 수 없습니다.`);
    return {
      kind: "Y", resistors: parts.map((part) => part.id), center, outer,
      arms: parts.map((part, index) => ({ id: part.id, centerPin: nets[index][0] === center ? 0 : 1, outerPin: nets[index][0] === center ? 1 : 0 })),
    };
  }
  if (allNets.size === 3) {
    const pairKeys = nets.map((pair) => [...pair].sort().join("|"));
    if (new Set(pairKeys).size !== 3) return none("두 저항이 같은 두 노드 사이에 있습니다. 삼각형(Δ)이 아닙니다.");
    const shared = nets[0].find((net) => nets[1].includes(net));
    const a = nets[0].find((net) => net !== shared);
    const c = nets[1].find((net) => net !== shared);
    return {
      kind: "Δ", resistors: parts.map((part) => part.id), nodes: [a, shared, c],
      edges: parts.map((part, index) => ({ id: part.id, pinAt: { [nets[index][0]]: 0, [nets[index][1]]: 1 } })),
    };
  }
  return none("세 저항이 한 점에서 만나는 Y 또는 삼각형 Δ로 이어져 있어야 합니다. 직렬·혼합 연결은 변환할 수 없습니다.");
}

/** For the editor selection: the three resistor ids when exactly three parts are selected and all are resistors, else null. */
export function selectedResistorIds(circuit, items) {
  const ids = items.filter((item) => item.kind === "component").map((item) => item.id);
  if (ids.length !== 3) return null;
  const byId = new Map(circuit.components.map((component) => [component.id, component]));
  return ids.every((id) => byId.get(id)?.type === "R") ? ids : null;
}

/** Inspector state of the command: { visible, enabled, kind, label, reason }. */
export function yDeltaCommandState(circuit, items) {
  const ids = selectedResistorIds(circuit, items);
  if (!ids) return { visible: false, enabled: false, kind: null, label: "", reason: "" };
  const detected = detectYDelta(circuit, ids);
  if (!detected.kind) return { visible: true, enabled: false, kind: null, label: "Y–Δ 변환", reason: detected.reason };
  return { visible: true, enabled: true, kind: detected.kind, label: detected.kind === "Y" ? "Y→Δ 변환" : "Δ→Y 변환", reason: "" };
}

// ---- geometry -----------------------------------------------------------------------------------------------------------------

function endpointPosition(circuit, end) {
  if (end.junctionId !== undefined) {
    const junction = (circuit.junctions ?? []).find((item) => item.id === end.junctionId);
    return { x: junction.x, y: junction.y };
  }
  return pinPosition(circuit.components.find((item) => item.id === end.componentId), end.pin, circuitGeometryVersion(circuit));
}

/** Rotation (0/90/180/270) that puts pin 0 on the `from` side and pin 1 on the `to` side along the dominant axis. */
function rotationFor(from, to) {
  const dx = to.x - from.x, dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 0 : 180;
  return dy >= 0 ? 90 : 270;
}

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const average = (points) => ({ x: points.reduce((sum, point) => sum + point.x, 0) / points.length, y: points.reduce((sum, point) => sum + point.y, 0) / points.length });

const RING_ANGLES = [[90, 210, 330], [270, 30, 150]];
const PERMUTATIONS = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
const CROWDED_COST = 400;

function ringAt(middle, radius, degrees) {
  return degrees.map((angle) => snapPoint({ x: middle.x + radius * Math.cos((angle * Math.PI) / 180), y: middle.y - radius * Math.sin((angle * Math.PI) / 180) }));
}

/** Parts whose centre lies so near `point` that a resistor placed there would sit on top of them. */
const crowding = (point, obstacles) => obstacles.filter((other) => distance(other, point) < 70).length;

/**
 * Centres of the three new Δ edges (A–B, B–C, C–A): a triangle ring around `home` (the centroid of the removed arms, where the free
 * room is). Over a few ring sizes, the two ring orientations and the six ways to deal the edges to the three ring slots, the layout with
 * the shortest wiring to the corners wins, and a slot on top of another part (`obstacles`: their centres) is heavily penalised.
 */
export function layoutDeltaEdges(anchors, home, obstacles = []) {
  const middle = snapPoint(home);
  const reach = anchors.map((anchor) => distance(anchor, middle));
  const base = Math.max(80, Math.min(120, Math.round(reach.reduce((sum, value) => sum + value, 0) / reach.length / GRID_SIZE) * GRID_SIZE));
  const edges = [[0, 1], [1, 2], [2, 0]];
  let best = null;
  for (const radius of [base, base + GRID_SIZE, base + 2 * GRID_SIZE, base + 3 * GRID_SIZE]) {
    for (const degrees of RING_ANGLES) {
      const slots = ringAt(middle, radius, degrees);
      for (const order of PERMUTATIONS) {
        const cost = edges.reduce((sum, [from, to], index) => {
          const slot = slots[order[index]];
          return sum + distance(slot, anchors[from]) + distance(slot, anchors[to]) + CROWDED_COST * crowding(slot, obstacles);
        }, (radius - base) / 2);
        if (!best || cost < best.cost - 1e-9) best = { cost, centers: edges.map((_, index) => slots[order[index]]) };
      }
    }
  }
  return best.centers;
}

const HUB_SEARCH_STEPS = 6;

/**
 * The new centre junction (at `home`) and the three arm centres of the new Y, each between the hub and its corner.
 * `obstacles` (centres of the parts that stay) and `junctions` (positions of the existing junctions) keep the result off other parts: the
 * preferred layout (hub at home, arms towards the corners) wins when it is free; otherwise nearby hubs and ring layouts are searched and the
 * least crowded one wins (a part under an arm or the hub costs the same heavy penalty as in layoutDeltaEdges).
 */
export function layoutStarArms(anchors, home, obstacles = [], junctions = []) {
  let base = snapPoint(home);
  if (anchors.some((anchor) => distance(anchor, base) < 40)) base = snapPoint({ x: home.x, y: home.y - 80 });
  const spacedOut = (arms) => arms.every((arm, i) => arms.every((other, j) => i === j || distance(arm, other) >= 60));
  const layoutsAt = (hub) => {
    const degenerate = anchors.some((anchor) => distance(anchor, hub) < 40);
    const towards = degenerate ? null : anchors.map((anchor) => {
      const gap = distance(anchor, hub);
      const reach = Math.max(60, Math.min(100, gap / 2));
      return snapPoint({ x: hub.x + ((anchor.x - hub.x) / gap) * reach, y: hub.y + ((anchor.y - hub.y) / gap) * reach });
    });
    const ring = ringAt(hub, 80, RING_ANGLES[0]);
    return [towards && spacedOut(towards) ? towards : ring, ring, ringAt(hub, 80, RING_ANGLES[1]), ringAt(hub, 100, RING_ANGLES[0]), ringAt(hub, 100, RING_ANGLES[1])];
  };
  const hubCrowding = (hub) => obstacles.filter((other) => distance(other, hub) < 30).length + junctions.filter((other) => distance(other, hub) < 1).length;
  const candidates = [base];
  for (let dy = -HUB_SEARCH_STEPS; dy <= HUB_SEARCH_STEPS; dy += 1) {
    for (let dx = -HUB_SEARCH_STEPS; dx <= HUB_SEARCH_STEPS; dx += 1) if (dx || dy) candidates.push({ x: base.x + dx * GRID_SIZE, y: base.y + dy * GRID_SIZE });
  }
  let best = null;
  candidates.forEach((hub, index) => {
    const onCorner = index > 0 && anchors.some((anchor) => distance(anchor, hub) < 40);
    layoutsAt(hub).forEach((arms, style) => {
      if (!spacedOut(arms)) return;
      const cost = CROWDED_COST * (hubCrowding(hub) + (onCorner ? 1 : 0) + arms.reduce((sum, arm) => sum + crowding(arm, obstacles), 0)) + distance(hub, base) / 2 + style;
      if (!best || cost < best.cost - 1e-9) best = { cost, hub, arms };
    });
  });
  return { hub: best.hub, arms: best.arms };
}

// ---- rewrite ------------------------------------------------------------------------------------------------------------------

/**
 * Take the given pins (all on one net) out of the wiring and return the endpoint their wires now meet at, in `work` (mutated).
 * Wires between the pins vanish; remaining wires that all lead to one same endpoint are dropped and that endpoint becomes the anchor; none or several get a junction
 * placed on the first pin that the remaining wires are re-pointed to.
 */
function detachPins(work, pins, allocator, reserved, removedWires, repointed) {
  const inPins = (end) => end?.componentId !== undefined && pins.some((pin) => isEnd(pin, end));
  const touching = work.wires.filter((wire) => !removedWires.has(wire.id) && (inPins(wire.a) || inPins(wire.b)));
  const between = touching.filter((wire) => inPins(wire.a) && inPins(wire.b));
  for (const wire of between) removedWires.add(wire.id);
  const rest = touching.filter((wire) => !between.includes(wire));
  const far = (wire) => (inPins(wire.a) ? wire.b : wire.a);
  if (rest.length && new Set(rest.map((wire) => endpointKey(far(wire)))).size === 1) {
    // Every remaining wire leads to the same endpoint (usually a corner junction): it is the anchor, and the wires to the removed pins go.
    for (const wire of rest) removedWires.add(wire.id);
    return structuredClone(far(rest[0]));
  }
  const junction = { id: allocator.next("J", reserved.junctions), ...snapPoint(endpointPosition(work, pins[0])) };
  work.junctions.push(junction);
  const anchor = { junctionId: junction.id };
  for (const wire of rest) {
    if (inPins(wire.a)) wire.a = { ...anchor };
    if (inPins(wire.b)) wire.b = { ...anchor };
    repointed.add(wire.id);
  }
  return anchor;
}

const wirePairKey = (wire) => [endpointKey(wire.a), endpointKey(wire.b)].sort().join("|");

/**
 * Re-pointing wires onto a shared anchor can leave two wires with the same two endpoints (in either order) or a wire from an endpoint to itself.
 * Of the re-pointed wires (`repointed`), such redundant ones are dropped; wires the user drew are never touched. Mutates `work`.
 */
function dropDuplicateWires(work, repointed) {
  const seen = new Set(work.wires.filter((wire) => !repointed.has(wire.id)).map(wirePairKey));
  work.wires = work.wires.filter((wire) => {
    if (!repointed.has(wire.id)) return true;
    if (endpointKey(wire.a) === endpointKey(wire.b)) return false;
    const key = wirePairKey(wire);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Korean reason when the rewritten circuit exceeds the editing limits or is structurally invalid, else null. */
function structureRejection(circuit) {
  const counts = [["부품", circuit.components.length, CIRCUIT_LIMITS.components], ["배선", circuit.wires.length, CIRCUIT_LIMITS.wires], ["접속점", (circuit.junctions ?? []).length, CIRCUIT_LIMITS.junctions]];
  const over = counts.find(([, count, limit]) => count > limit);
  if (over) return `변환하면 ${over[0]}이(가) ${over[1]}개가 되어 교육용 편집 한도(${over[0]} ${over[2]}개)를 넘습니다. 변환하지 않았습니다.`;
  try { validateCircuitStructure(circuit); } catch (error) { return `변환 결과가 올바른 회로 구조가 아닙니다. ${error.message}`; }
  return null;
}

function maxReferenceIndex(circuit, prefix) {
  let top = 0;
  const pattern = new RegExp(`^${prefix}(\\d+)$`);
  for (const component of circuit.components) {
    const match = pattern.exec(refOf(component) ?? "");
    if (match) top = Math.max(top, Number(match[1]));
  }
  return top;
}

function retargetProbes(probes, circuit, removedIds, keptWireIds, removedJunctionIds, anchorOfPin) {
  const byId = new Map(circuit.components.map((component) => [component.id, component]));
  const result = [];
  const keys = new Set();
  for (const probe of probes) {
    let next = probe;
    if (probe.componentId !== undefined && removedIds.has(probe.componentId)) {
      const anchor = probe.kind === "voltage" ? anchorOfPin.get(`${probe.componentId}:${probe.pin}`) : null;
      if (!anchor) continue;
      next = { ...probe, wireId: null };
      delete next.componentId; delete next.pin; delete next.junctionId;
      if (anchor.junctionId !== undefined) Object.assign(next, { key: `V:J:${anchor.junctionId}`, junctionId: anchor.junctionId, label: `V(${anchor.junctionId})` });
      else Object.assign(next, { key: `V:${anchor.componentId}:${anchor.pin}`, componentId: anchor.componentId, pin: anchor.pin, label: `V(${refOf(byId.get(anchor.componentId)) ?? anchor.componentId}.${anchor.pin + 1})` });
    } else if (probe.junctionId !== undefined && removedJunctionIds.has(probe.junctionId)) continue;
    else if (probe.wireId && !keptWireIds.has(probe.wireId)) next = { ...probe, wireId: null };
    if (keys.has(next.key)) continue;
    keys.add(next.key);
    result.push(next);
  }
  return result;
}

/**
 * Rewrite the Y or Δ formed by `resistorIds` into the other form. The input circuit is not modified.
 * Returns { ok: true, circuit, probes, report } where report = { kind: "Y→Δ"|"Δ→Y", removed, added, names, values, texts, message, selection }.
 * Throws RangeError (Korean reason) when the three resistors are not a convertible Y or Δ. When the rewrite itself would not be a valid circuit (it would
 * exceed CIRCUIT_LIMITS, ...) it returns { ok: false, reason } (Korean) instead of a circuit, so the editor can refuse before it mutates anything.
 * `allocator` (id-allocator.js) keeps the new ids unique for the whole project; without one the ids continue after the circuit's own.
 * New reference labels continue after the highest R number in the circuit (the removed R1…R3 are not reused for different values).
 */
export function convertYDeltaInCircuit(circuit, resistorIds, { allocator = createIdAllocator(), probes = [] } = {}) {
  const detected = detectYDelta(circuit, resistorIds);
  if (!detected.kind) throw new RangeError(detected.reason);
  const reserved = { components: circuit.components, wires: circuit.wires, junctions: circuit.junctions ?? [] };
  const work = structuredClone(circuit);
  work.junctions ??= [];
  const byId = new Map(circuit.components.map((component) => [component.id, component]));
  const removedIds = new Set(detected.resistors);
  const removedWires = new Set();
  const removedJunctions = new Set();
  const repointed = new Set();
  const anchorOfPin = new Map();
  const valueOf = (id) => parseResistance(byId.get(id).props.value, refOf(byId.get(id)));
  const [first, second, third] = detected.resistors.map(valueOf);
  let anchors, values, names;

  if (detected.kind === "Y") {
    const converted = convertYToDelta({ RA: first, RB: second, RC: third });
    names = ["RAB", "RBC", "RCA"];
    values = { RAB: converted.RAB, RBC: converted.RBC, RCA: converted.RCA };
    // The centre holds nothing else (checked by detectYDelta): its wires and junctions disappear with the arms.
    const resolver = createNetResolver(circuit);
    for (const wire of circuit.wires) {
      if (netOfEndpoint(resolver, wire.a) === detected.center || netOfEndpoint(resolver, wire.b) === detected.center) removedWires.add(wire.id);
    }
    for (const junction of circuit.junctions ?? []) if (resolver.junction(junction.id) === detected.center) removedJunctions.add(junction.id);
    anchors = detected.arms.map((arm) => {
      const anchor = detachPins(work, [{ componentId: arm.id, pin: arm.outerPin }], allocator, reserved, removedWires, repointed);
      anchorOfPin.set(`${arm.id}:${arm.outerPin}`, anchor);
      return anchor;
    });
  } else {
    const converted = convertDeltaToY({ RAB: first, RBC: second, RCA: third });
    names = ["RA", "RB", "RC"];
    values = { RA: converted.RA, RB: converted.RB, RC: converted.RC };
    anchors = detected.nodes.map((net) => {
      const pins = detected.edges.filter((edge) => Object.hasOwn(edge.pinAt, net)).map((edge) => ({ componentId: edge.id, pin: edge.pinAt[net] }));
      const anchor = detachPins(work, pins, allocator, reserved, removedWires, repointed);
      for (const pin of pins) anchorOfPin.set(`${pin.componentId}:${pin.pin}`, anchor);
      return anchor;
    });
  }

  // Remove the old parts, the wires that were dropped (centre / anchor wires), and anything still pointing at a removed junction.
  const pointsAtRemoved = (end) => (end?.componentId !== undefined && removedIds.has(end.componentId)) || (end?.junctionId !== undefined && removedJunctions.has(end.junctionId));
  work.components = work.components.filter((component) => !removedIds.has(component.id));
  work.wires = work.wires.filter((wire) => !removedWires.has(wire.id) && !pointsAtRemoved(wire.a) && !pointsAtRemoved(wire.b));
  work.junctions = work.junctions.filter((junction) => !removedJunctions.has(junction.id));
  dropDuplicateWires(work, repointed);

  const home = average(detected.resistors.map((id) => byId.get(id)));
  const anchorPoints = anchors.map((anchor) => endpointPosition(work, anchor));
  const added = [];
  const refStart = maxReferenceIndex(circuit, "R");
  const newResistor = (index, center, from, to) => {
    const id = allocator.next("R", reserved.components);
    return { id, type: "R", x: center.x, y: center.y, rotation: rotationFor(from, to), props: { ...componentDefaults("R", refStart + index + 1), ref: `R${refStart + index + 1}`, value: resistanceCircuitText(values[names[index]]) } };
  };
  const connect = (component, pin, end) => work.wires.push({ id: allocator.next("W", reserved.wires), a: { componentId: component.id, pin }, b: structuredClone(end), waypoints: [] });
  if (detected.kind === "Y") {
    const centers = layoutDeltaEdges(anchorPoints, home, work.components);
    [[0, 1], [1, 2], [2, 0]].forEach(([from, to], index) => {
      const component = newResistor(index, centers[index], anchorPoints[from], anchorPoints[to]);
      work.components.push(component);
      connect(component, 0, anchors[from]);
      connect(component, 1, anchors[to]);
      added.push(component.id);
    });
  } else {
    const { hub, arms } = layoutStarArms(anchorPoints, home, work.components, work.junctions);
    const junction = { id: allocator.next("J", reserved.junctions), x: hub.x, y: hub.y };
    work.junctions.push(junction);
    names.forEach((_, index) => {
      const component = newResistor(index, arms[index], anchorPoints[index], hub);
      work.components.push(component);
      connect(component, 0, anchors[index]);
      connect(component, 1, { junctionId: junction.id });
      added.push(component.id);
    });
  }

  const rejection = structureRejection(work);
  if (rejection) return { ok: false, reason: rejection };

  const kind = detected.kind === "Y" ? "Y→Δ" : "Δ→Y";
  const texts = Object.fromEntries(names.map((name) => [name, resistanceText(values[name])]));
  return {
    ok: true,
    circuit: work,
    probes: retargetProbes(probes, circuit, removedIds, new Set(work.wires.map((item) => item.id)), removedJunctions, anchorOfPin),
    report: { kind, removed: [...removedIds], added, names, values, texts, message: `${kind} 변환: ${names.map((name) => `${name}=${texts[name]}`).join(", ")}`, selection: added.map((id) => ({ kind: "component", id })) },
  };
}
