import { snapPoint } from "./circuit-geometry.js";

/**
 * Whole-selection geometry edits (DOM 없음): move and rotate. They change the circuit in place, so callers run them inside
 * session.mutate()/mutateGrouped() (one history entry) or, for a pointer drag, apply them each frame and commit once at the end.
 *
 * Only parts and junctions have a position. A wire follows its endpoints; its fixed waypoints are absolute, so a wire whose BOTH ends
 * move with the group has its waypoints moved/rotated too (the group stays rigid), while a wire with one fixed end keeps them.
 */
export function movableItems(items) {
  return items.filter((item) => item.kind === "component" || item.kind === "junction");
}

/** Positions at the start of a gesture: {components, junctions: [{id, x, y}], wires: [{id, waypoints, anchors?}]}. Plain data (JSON-safe). */
export function captureGroupOrigins(circuit, items) {
  const movable = movableItems(items);
  const componentIds = new Set(movable.filter((item) => item.kind === "component").map((item) => item.id));
  const junctionIds = new Set(movable.filter((item) => item.kind === "junction").map((item) => item.id));
  const moves = (end) => end?.junctionId !== undefined ? junctionIds.has(end.junctionId) : componentIds.has(end?.componentId);
  return {
    components: circuit.components.filter((component) => componentIds.has(component.id)).map((component) => ({ id: component.id, x: component.x, y: component.y, rotation: component.rotation ?? 0 })),
    junctions: (circuit.junctions ?? []).filter((junction) => junctionIds.has(junction.id)).map((junction) => ({ id: junction.id, x: junction.x, y: junction.y })),
    wires: circuit.wires.filter((wire) => ((Array.isArray(wire.waypoints) && wire.waypoints.length) || (Array.isArray(wire.anchors) && wire.anchors.length)) && moves(wire.a) && moves(wire.b))
      .map((wire) => ({ id: wire.id, waypoints: structuredClone(wire.waypoints ?? []), ...(Array.isArray(wire.anchors) ? { anchors: structuredClone(wire.anchors) } : {}) })),
  };
}

/**
 * Put every captured item at origin + (dx, dy). Idempotent, so a drag can call it every frame. With `snap` each item (and each waypoint) lands
 * on the grid by itself, so a group that contained an off-grid item does not drag the others off the grid; restoring uses the exact origins.
 */
export function applyGroupOffset(circuit, origins, dx, dy, { snap = false } = {}) {
  const place = (origin) => snap ? snapPoint({ x: origin.x + dx, y: origin.y + dy }) : { x: origin.x + dx, y: origin.y + dy };
  const components = new Map(circuit.components.map((component) => [component.id, component]));
  const junctions = new Map((circuit.junctions ?? []).map((junction) => [junction.id, junction]));
  const wires = new Map(circuit.wires.map((wire) => [wire.id, wire]));
  for (const origin of origins.components) { const item = components.get(origin.id); if (item) Object.assign(item, place(origin)); }
  for (const origin of origins.junctions) { const item = junctions.get(origin.id); if (item) Object.assign(item, place(origin)); }
  for (const origin of origins.wires) {
    const wire = wires.get(origin.id);
    if (!wire) continue;
    wire.waypoints = origin.waypoints.map(place);
    if (origin.anchors) wire.anchors = origin.anchors.map(place); // the clicked points of a routed wire (wire-router) travel with it
  }
}

export const restoreGroupOrigins = (circuit, origins) => applyGroupOffset(circuit, origins, 0, 0);

/** The ids of every part/junction/wire whose geometry changes when the group moves (for partial rendering). */
export function groupFootprint(origins) {
  return { components: origins.components.map((item) => item.id), junctions: origins.junctions.map((item) => item.id), wires: origins.wires.map((item) => item.id) };
}

/** Keyboard move by (dx, dy) world units. Returns the number of moved items. */
export function moveGroup(circuit, items, dx, dy) {
  const origins = captureGroupOrigins(circuit, items);
  const base = origins.components[0] ?? origins.junctions[0];
  if (!base) return 0;
  // The first item is snapped to the grid and sets the delta; every item (and waypoint) is then snapped itself, so nothing ends up off-grid.
  const target = snapPoint({ x: base.x + dx, y: base.y + dy });
  applyGroupOffset(circuit, origins, target.x - base.x, target.y - base.y, { snap: true });
  return origins.components.length + origins.junctions.length;
}

/**
 * The point a group turns around. It is `pivot` ({kind, id}, normally the primary selection) when that is a movable item of the group; otherwise (e.g. the primary is
 * a wire) the last part of `items` (the one clicked last); with no part at all, the centre of the group's bounds snapped to the grid.
 */
export function rotationPivot(origins, items, pivot = null) {
  const inGroup = pivot?.kind === "junction" ? origins.junctions.find((origin) => origin.id === pivot.id) : pivot?.kind === "component" ? origins.components.find((origin) => origin.id === pivot.id) : null;
  if (inGroup) return { x: inGroup.x, y: inGroup.y };
  const lastComponent = [...items].reverse().find((item) => item.kind === "component" && origins.components.some((origin) => origin.id === item.id));
  if (lastComponent) { const origin = origins.components.find((entry) => entry.id === lastComponent.id); return { x: origin.x, y: origin.y }; }
  const points = [...origins.components, ...origins.junctions];
  const xs = points.map((point) => point.x), ys = points.map((point) => point.y);
  return snapPoint({ x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 });
}

/** Float noise from `center + (p - center)` arithmetic (about 1e-13) is removed; a coordinate that really has more digits than that is left untouched. */
const quiet = (value) => {
  const rounded = Math.round(value * 1e9) / 1e9;
  return Math.abs(rounded - value) <= 1e-10 ? rounded : value;
};

/**
 * Rotate by 90° steps (direction +1 clockwise on screen, −1 counter-clockwise).
 * One part: in place. Several parts/junctions: rigidly around rotationPivot() — which stays exactly where it is. Nothing is snapped to the grid
 * (a per-item snap moves the effective pivot for off-grid parts, so the opposite turn would not restore the layout): a grid layout stays on the
 * grid because the pivot is a part position or a grid point, and an off-grid layout turns and turns back to its exact coordinates.
 * Part angles are always normalised to 0..270.
 */
export function rotateGroup(circuit, items, direction = 1, pivot = null) {
  const origins = captureGroupOrigins(circuit, items);
  const count = origins.components.length + origins.junctions.length;
  if (!count) return 0;
  const turn = (((direction * 90) % 360) + 360) % 360;
  if (count === 1 && origins.components.length === 1) {
    const component = circuit.components.find((item) => item.id === origins.components[0].id);
    component.rotation = ((((component.rotation ?? 0) + direction * 90) % 360) + 360) % 360;
    return 1;
  }
  const center = rotationPivot(origins, items, pivot);
  const rotate = (point) => {
    const x = point.x - center.x, y = point.y - center.y;
    return direction >= 0 ? { x: quiet(center.x - y), y: quiet(center.y + x) } : { x: quiet(center.x + y), y: quiet(center.y - x) };
  };
  const components = new Map(circuit.components.map((component) => [component.id, component]));
  const junctions = new Map((circuit.junctions ?? []).map((junction) => [junction.id, junction]));
  const wires = new Map(circuit.wires.map((wire) => [wire.id, wire]));
  for (const origin of origins.components) {
    const component = components.get(origin.id);
    Object.assign(component, rotate(origin));
    component.rotation = (((origin.rotation + turn) % 360) + 360) % 360;
  }
  for (const origin of origins.junctions) Object.assign(junctions.get(origin.id), rotate(origin));
  for (const origin of origins.wires) {
    const wire = wires.get(origin.id);
    wire.waypoints = origin.waypoints.map(rotate);
    if (origin.anchors) wire.anchors = origin.anchors.map(rotate);
  }
  return count;
}
