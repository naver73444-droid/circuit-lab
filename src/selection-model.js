import { pinCount } from "./circuit-engine.js";
import { circuitGeometryVersion, localPin, pinPosition, routeWirePoints } from "./circuit-geometry.js";

/**
 * Multi-selection model (DOM 없음).
 *
 *   state.selected   기본(primary) 항목 하나 {kind, id} | null — 인스펙터·페이저·포트 패널이 쓰는 기존 계약
 *   state.selection  Set<"kind:id"> — 선택된 모든 항목(부품 component · 배선 wire · 접속점 junction). selected가 있으면 반드시 들어 있다.
 *
 * 외부 모듈이 selected만 직접 바꿔도 깨지지 않도록 읽는 쪽은 selectedKeys()를 쓴다: selected가 selection에 없으면 selected 하나만 선택된 것으로 본다.
 */
export const KINDS = Object.freeze(["component", "wire", "junction"]);
export const selectionKey = (kind, id) => `${kind}:${id}`;
export function parseSelectionKey(key) {
  const at = String(key).indexOf(":");
  return { kind: key.slice(0, at), id: key.slice(at + 1) };
}

/** Non-mutating view of the selection as a Set of keys. */
export function selectedKeys(state) {
  const selected = state.selected;
  if (!selected) return new Set();
  const key = selectionKey(selected.kind, selected.id);
  return state.selection instanceof Set && state.selection.has(key) ? state.selection : new Set([key]);
}

export const selectedItems = (state) => [...selectedKeys(state)].map(parseSelectionKey);
export const isSelected = (state, kind, id) => selectedKeys(state).has(selectionKey(kind, id));
export const selectionSize = (state) => selectedKeys(state).size;

export function clearSelection(state) {
  state.selected = null;
  state.selection = new Set();
}

/** Select exactly one item (or nothing). */
export function setSingleSelection(state, item) {
  if (!item) { clearSelection(state); return; }
  state.selected = { kind: item.kind, id: item.id };
  state.selection = new Set([selectionKey(item.kind, item.id)]);
}

/** Replace the selection by `items`; the primary is `primary` when it is one of them, otherwise the last item. */
export function setSelectionItems(state, items, primary = null) {
  const keys = new Set(items.map((item) => selectionKey(item.kind, item.id)));
  if (!keys.size) { clearSelection(state); return; }
  const wanted = primary && keys.has(selectionKey(primary.kind, primary.id)) ? primary : parseSelectionKey([...keys].at(-1));
  state.selected = { kind: wanted.kind, id: wanted.id };
  state.selection = keys;
}

/** Shift+click: add the item (it becomes the primary) or remove it (the primary falls back to the last remaining item). Returns true when added. */
export function toggleSelection(state, item) {
  const keys = new Set(selectedKeys(state));
  const key = selectionKey(item.kind, item.id);
  const added = !keys.has(key);
  if (added) keys.add(key);
  else keys.delete(key);
  if (!keys.size) { clearSelection(state); return added; }
  const primaryKey = added ? key : state.selected && selectionKey(state.selected.kind, state.selected.id) !== key ? selectionKey(state.selected.kind, state.selected.id) : [...keys].at(-1);
  const primary = parseSelectionKey(primaryKey);
  state.selected = { kind: primary.kind, id: primary.id };
  state.selection = keys;
  return added;
}

/** Every item of the circuit as selection items (Ctrl+A). */
export function allItems(circuit) {
  return [
    ...circuit.components.map((component) => ({ kind: "component", id: component.id })),
    ...circuit.wires.map((wire) => ({ kind: "wire", id: wire.id })),
    ...(circuit.junctions ?? []).map((junction) => ({ kind: "junction", id: junction.id })),
  ];
}

/** Drop items whose entity no longer exists (after a delete, an undo or a project replacement). */
export function pruneSelection(state, circuit) {
  const exists = {
    component: new Set(circuit.components.map((item) => item.id)),
    wire: new Set(circuit.wires.map((item) => item.id)),
    junction: new Set((circuit.junctions ?? []).map((item) => item.id)),
  };
  const items = selectedItems(state).filter((item) => exists[item.kind]?.has(item.id));
  setSelectionItems(state, items, state.selected);
}

export function describeSelection(items) {
  const counts = { component: 0, wire: 0, junction: 0 };
  for (const item of items) counts[item.kind] += 1;
  return { total: items.length, components: counts.component, wires: counts.wire, junctions: counts.junction };
}

// ---- marquee hit testing -------------------------------------------------------------------------------------------------

export function normalizeRect(a, b) {
  return { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) };
}

const insideRect = (point, rect) => point.x >= rect.x0 && point.x <= rect.x1 && point.y >= rect.y0 && point.y <= rect.y1;
const rectsOverlap = (a, b) => a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0;

/** Liang–Barsky: does the segment a→b touch the rectangle? */
export function segmentIntersectsRect(a, b, rect) {
  let t0 = 0, t1 = 1;
  const dx = b.x - a.x, dy = b.y - a.y;
  const clip = (p, q) => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
    return true;
  };
  return clip(-dx, a.x - rect.x0) && clip(dx, rect.x1 - a.x) && clip(-dy, a.y - rect.y0) && clip(dy, rect.y1 - a.y);
}

/** Axis-aligned bounds of a part's symbol: its pins, but at least ±30 × ±20 around the centre, rotated with the part. */
export function componentBounds(component, geometryVersion = 2) {
  let minX = -30, maxX = 30, minY = -20, maxY = 20;
  for (let pin = 0; pin < pinCount(component.type); pin += 1) {
    const local = localPin(component.type, pin, geometryVersion);
    if (!local) continue;
    minX = Math.min(minX, local.x); maxX = Math.max(maxX, local.x);
    minY = Math.min(minY, local.y); maxY = Math.max(maxY, local.y);
  }
  const angle = ((component.rotation ?? 0) * Math.PI) / 180;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const xs = [], ys = [];
  for (const [x, y] of [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]]) {
    xs.push(component.x + x * cos - y * sin);
    ys.push(component.y + x * sin + y * cos);
  }
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/** The routed polyline of one wire, or [] when an endpoint is missing. */
export function wireRoutePoints(circuit, wire) {
  const version = circuitGeometryVersion(circuit);
  const position = (end) => {
    if (end?.junctionId !== undefined) {
      const junction = (circuit.junctions ?? []).find((item) => item.id === end.junctionId);
      return junction ? { x: junction.x, y: junction.y } : null;
    }
    const component = circuit.components.find((item) => item.id === end?.componentId);
    return component ? pinPosition(component, end.pin, version) : null;
  };
  const a = position(wire.a), b = position(wire.b);
  return a && b ? routeWirePoints(wire, a, b, version) : [];
}

/**
 * Items inside a marquee rectangle (world coordinates).
 *   parts      by crossing — a part is hit when its symbol bounds overlap the box
 *   junctions  hit when the dot is inside the box
 *   wires      wires: "contained" (default) — every point of the route is inside, so a box around a part does not drag in the
 *              long wires that merely pass its edge; "crossing" — any segment touches the box.
 */
export function marqueeHits(circuit, rect, { wires = "contained" } = {}) {
  const version = circuitGeometryVersion(circuit);
  const hits = [];
  for (const component of circuit.components) if (rectsOverlap(componentBounds(component, version), rect)) hits.push({ kind: "component", id: component.id });
  for (const wire of circuit.wires) {
    const route = wireRoutePoints(circuit, wire);
    if (route.length < 2) continue;
    const hit = wires === "crossing"
      ? route.slice(1).some((point, index) => segmentIntersectsRect(route[index], point, rect))
      : route.every((point) => insideRect(point, rect));
    if (hit) hits.push({ kind: "wire", id: wire.id });
  }
  for (const junction of circuit.junctions ?? []) if (insideRect(junction, rect)) hits.push({ kind: "junction", id: junction.id });
  return hits;
}
