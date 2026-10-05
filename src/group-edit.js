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

/** Positions at the start of a gesture: {components, junctions: [{id, x, y}], wires: [{id, waypoints}]}. Plain data (JSON-safe). */
export function captureGroupOrigins(circuit, items) {
  const movable = movableItems(items);
  const componentIds = new Set(movable.filter((item) => item.kind === "component").map((item) => item.id));
  const junctionIds = new Set(movable.filter((item) => item.kind === "junction").map((item) => item.id));
  const moves = (end) => end?.junctionId !== undefined ? junctionIds.has(end.junctionId) : componentIds.has(end?.componentId);
  return {
    components: circuit.components.filter((component) => componentIds.has(component.id)).map((component) => ({ id: component.id, x: component.x, y: component.y, rotation: component.rotation ?? 0 })),
    junctions: (circuit.junctions ?? []).filter((junction) => junctionIds.has(junction.id)).map((junction) => ({ id: junction.id, x: junction.x, y: junction.y })),
    wires: circuit.wires.filter((wire) => Array.isArray(wire.waypoints) && wire.waypoints.length && moves(wire.a) && moves(wire.b)).map((wire) => ({ id: wire.id, waypoints: structuredClone(wire.waypoints) })),
  };
}

/** Put every captured item at origin + (dx, dy). Idempotent, so a drag can call it every frame. */
export function applyGroupOffset(circuit, origins, dx, dy) {
  const components = new Map(circuit.components.map((component) => [component.id, component]));
  const junctions = new Map((circuit.junctions ?? []).map((junction) => [junction.id, junction]));
  const wires = new Map(circuit.wires.map((wire) => [wire.id, wire]));
  for (const origin of origins.components) { const item = components.get(origin.id); if (item) { item.x = origin.x + dx; item.y = origin.y + dy; } }
  for (const origin of origins.junctions) { const item = junctions.get(origin.id); if (item) { item.x = origin.x + dx; item.y = origin.y + dy; } }
  for (const origin of origins.wires) { const wire = wires.get(origin.id); if (wire) wire.waypoints = origin.waypoints.map((point) => ({ x: point.x + dx, y: point.y + dy })); }
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
  // The first item is snapped to the grid; everyone else moves by the same delta so the group stays rigid.
  const target = snapPoint({ x: base.x + dx, y: base.y + dy });
  applyGroupOffset(circuit, origins, target.x - base.x, target.y - base.y);
  return origins.components.length + origins.junctions.length;
}

/**
 * Rotate by 90° steps (direction +1 clockwise on screen, −1 counter-clockwise).
 * One part: in place. Several parts/junctions: rigidly around a pivot item (default: the first one) that stays where it is, so every
 * position stays on the grid and a turn followed by the opposite turn restores the layout exactly.
 * `pivot` is {kind, id} of one of the items.
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
  const pivotOrigin = (pivot?.kind === "junction" ? origins.junctions : origins.components).find((origin) => origin.id === pivot?.id) ?? origins.components[0] ?? origins.junctions[0];
  const center = { x: pivotOrigin.x, y: pivotOrigin.y };
  const rotate = (point) => {
    const x = point.x - center.x, y = point.y - center.y;
    return direction >= 0 ? { x: center.x - y, y: center.y + x } : { x: center.x + y, y: center.y - x };
  };
  const components = new Map(circuit.components.map((component) => [component.id, component]));
  const junctions = new Map((circuit.junctions ?? []).map((junction) => [junction.id, junction]));
  const wires = new Map(circuit.wires.map((wire) => [wire.id, wire]));
  for (const origin of origins.components) {
    const component = components.get(origin.id);
    Object.assign(component, rotate(origin));
    component.rotation = (origin.rotation + turn) % 360;
  }
  for (const origin of origins.junctions) Object.assign(junctions.get(origin.id), rotate(origin));
  for (const origin of origins.wires) wires.get(origin.id).waypoints = origin.waypoints.map(rotate);
  return count;
}
