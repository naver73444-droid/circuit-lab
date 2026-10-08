import { endpointKey, pinCount } from "./circuit-engine.js";
import { GRID_SIZE, appendFixedWaypoint, circuitGeometryVersion, localPin, normalizePoints, pinPosition, routeWirePoints } from "./circuit-geometry.js";

/**
 * Automatic orthogonal wire routing (DOM 없음).
 *
 * A wire is still stored as {a, b, waypoints} and drawn by routeWirePoints(); the router only decides the waypoints. A routed wire also
 * keeps `anchors`: the bend points the user clicked ([] = fully automatic). When a part moves, the wire is routed again through its
 * anchors, so the user's points stay and the automatic corners are recomputed. A wire without `anchors` (saved before routing existed)
 * is drawn exactly as stored; once one of its ends moves, its stored waypoints are kept as anchors.
 *
 * Routing is A* on the GRID_SIZE grid over (cell, heading) states: cost = length + a bend penalty, so the path with the fewest bends
 * among the short ones wins. Part bodies (their symbol box, see bodyBox), other pins and junctions are not passable; running along
 * a wire of ANOTHER node costs a lot (two wires on one segment look like one node), touching its corner or end costs less, a plain
 * crossing almost nothing. Wires of the node being wired are free to share (they are one node anyway). A pin is left and entered along its outward axis. The search stays in a window around the two points, so a
 * route costs about the same however big the circuit is.
 */

const G = GRID_SIZE;
const DIRS = [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }];
export const ROUTE_COST = Object.freeze({ step: 1, bend: 4, overlap: 60, vertex: 25, cross: 1 });
const MARGINS = [8, 30];
const OFFSET = 1 << 15;
const cellKey = (ix, iy) => (ix + OFFSET) * 65536 + (iy + OFFSET);
const edgeKey = (ix, iy, vertical) => cellKey(ix, iy) * 2 + (vertical ? 1 : 0);
const onGrid = (value) => Number.isFinite(value) && Math.abs(value / G - Math.round(value / G)) < 1e-6;
const isGridPoint = (point) => Boolean(point) && onGrid(point.x) && onGrid(point.y);
const cell = (value) => Math.round(value / G);
const reverse = (dir) => (dir + 2) % 4;

/** 0 right, 1 down, 2 left, 3 up for the dominant axis of a vector; null for a zero vector. */
export function directionIndex(vector) {
  if (!vector || (Math.abs(vector.x) < 1e-9 && Math.abs(vector.y) < 1e-9)) return null;
  if (Math.abs(vector.x) >= Math.abs(vector.y)) return vector.x > 0 ? 0 : 2;
  return vector.y > 0 ? 1 : 3;
}

/** The direction (0..3) a pin points away from its part: the dominant axis of its local offset, turned with the part. */
export function pinOutwardDirection(component, pin, geometryVersion = 2) {
  const local = localPin(component.type, pin, geometryVersion);
  if (!local) return null;
  const angle = ((component.rotation ?? 0) * Math.PI) / 180;
  return directionIndex({ x: local.x * Math.cos(angle) - local.y * Math.sin(angle), y: local.x * Math.sin(angle) + local.y * Math.cos(angle) });
}

/** The part's symbol box in world coordinates: its pins, but at least ±30 × ±20 around the centre, turned with the part. */
export function bodyBox(component, geometryVersion = 2) {
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

function endpointPoint(circuit, endpoint, version, componentById, junctionById) {
  if (endpoint?.junctionId !== undefined) {
    const junction = junctionById.get(endpoint.junctionId);
    return junction ? { x: junction.x, y: junction.y } : null;
  }
  const component = componentById.get(endpoint?.componentId);
  return component ? pinPosition(component, endpoint.pin, version) : null;
}

/**
 * Everything a route has to keep clear of, built once per edit: blocked cells (part bodies), pin and junction cells, and the cells,
 * corners and unit edges of the wires already drawn (except `excludeWireIds`, e.g. the wires being routed again).
 */
export function createRoutingContext(circuit, { excludeWireIds = [] } = {}) {
  const version = circuitGeometryVersion(circuit);
  const componentById = new Map((circuit.components ?? []).map((component) => [component.id, component]));
  const junctionById = new Map((circuit.junctions ?? []).map((junction) => [junction.id, junction]));
  // Electrical nodes: wire endpoints joined by wires (all of them, also the excluded ones: they still connect).
  const parent = new Map();
  const find = (key) => { let root = key; while (parent.has(root) && parent.get(root) !== root) root = parent.get(root); return root; };
  for (const wire of circuit.wires ?? []) {
    if (!wire?.a || !wire?.b) continue;
    const a = find(endpointKey(wire.a)), b = find(endpointKey(wire.b));
    if (!parent.has(a)) parent.set(a, a);
    if (a !== b) parent.set(b, a);
  }
  const netOf = (endpoint) => { try { return find(endpointKey(endpoint)); } catch { return null; } };
  const context = { version, componentById, junctionById, netOf, blocked: new Set(), pins: new Set(), edges: new Map(), cells: new Map(), vertices: new Map() };
  for (const component of componentById.values()) {
    for (let pin = 0; pin < pinCount(component.type); pin += 1) {
      const position = pinPosition(component, pin, version);
      if (isGridPoint(position)) context.pins.add(cellKey(cell(position.x), cell(position.y)));
    }
    const box = bodyBox(component, version);
    if (![box.x0, box.y0, box.x1, box.y1].every(Number.isFinite)) continue;
    for (let ix = Math.ceil(box.x0 / G - 1e-6); ix <= Math.floor(box.x1 / G + 1e-6); ix += 1) {
      for (let iy = Math.ceil(box.y0 / G - 1e-6); iy <= Math.floor(box.y1 / G + 1e-6); iy += 1) context.blocked.add(cellKey(ix, iy));
    }
  }
  for (const junction of junctionById.values()) if (isGridPoint(junction)) context.pins.add(cellKey(cell(junction.x), cell(junction.y)));
  const excluded = new Set(excludeWireIds);
  for (const wire of circuit.wires ?? []) {
    if (excluded.has(wire.id)) continue;
    const a = endpointPoint(circuit, wire.a, version, componentById, junctionById);
    const b = endpointPoint(circuit, wire.b, version, componentById, junctionById);
    if (a && b) addRouteToContext(context, routeWirePoints(wire, a, b, version), netOf(wire.a));
  }
  return context;
}

const mark = (map, key, net) => { if (!map.has(key)) map.set(key, new Set()); map.get(key).add(net); };
/** Is `key` used by a wire of a node other than the ones in `own`? */
const foreign = (map, key, own) => {
  const nets = map.get(key);
  if (!nets) return false;
  for (const net of nets) if (net === null || !own?.has(net)) return true;
  return false;
};

/** Mark a drawn polyline of node `net` as occupied, so the next route of another node keeps off its segments and corners. */
export function addRouteToContext(context, points, net = null) {
  const route = normalizePoints(points);
  for (const point of route) if (isGridPoint(point)) mark(context.vertices, cellKey(cell(point.x), cell(point.y)), net);
  for (let index = 0; index + 1 < route.length; index += 1) {
    const p = route[index], q = route[index + 1];
    if (!isGridPoint(p) || !isGridPoint(q)) continue;
    const px = cell(p.x), py = cell(p.y), qx = cell(q.x), qy = cell(q.y);
    if (px !== qx && py !== qy) continue;
    const vertical = px === qx;
    const from = vertical ? Math.min(py, qy) : Math.min(px, qx), to = vertical ? Math.max(py, qy) : Math.max(px, qx);
    for (let step = from; step <= to; step += 1) {
      const [x, y] = vertical ? [px, step] : [step, py];
      mark(context.cells, cellKey(x, y), net);
      if (step < to) mark(context.edges, edgeKey(x, y, vertical), net);
    }
  }
}

/** The cost of one grid step from (x, y) in `dir`, or Infinity when the next cell may not be entered. `own`: the nets being wired. */
function stepCost(context, x, y, dir, turning, isEnd, obstacles, own) {
  const nx = x + DIRS[dir].x, ny = y + DIRS[dir].y, next = cellKey(nx, ny);
  let cost = ROUTE_COST.step + (turning ? ROUTE_COST.bend : 0);
  if (!obstacles) return cost;
  if (!isEnd && (context.blocked.has(next) || context.pins.has(next))) return Infinity;
  if (turning && foreign(context.cells, cellKey(x, y), own)) cost += ROUTE_COST.vertex; // a corner on another wire reads as a T-junction
  const vertical = dir === 1 || dir === 3;
  if (foreign(context.edges, vertical ? edgeKey(nx, Math.min(y, ny), true) : edgeKey(Math.min(x, nx), ny, false), own)) cost += ROUTE_COST.overlap;
  if (!isEnd) {
    if (foreign(context.vertices, next, own)) cost += ROUTE_COST.vertex;
    else if (foreign(context.cells, next, own)) cost += ROUTE_COST.cross;
  }
  return cost;
}

class MinHeap {
  constructor() { this.items = []; }
  get size() { return this.items.length; }
  push(priority, value) {
    const items = this.items;
    items.push([priority, value]);
    let index = items.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (items[parent][0] <= items[index][0]) break;
      [items[parent], items[index]] = [items[index], items[parent]];
      index = parent;
    }
  }
  pop() {
    const items = this.items, top = items[0], last = items.pop();
    if (items.length) {
      items[0] = last;
      let index = 0;
      for (;;) {
        const left = index * 2 + 1, right = left + 1;
        let smallest = index;
        if (left < items.length && items[left][0] < items[smallest][0]) smallest = left;
        if (right < items.length && items[right][0] < items[smallest][0]) smallest = right;
        if (smallest === index) break;
        [items[smallest], items[index]] = [items[index], items[smallest]];
        index = smallest;
      }
    }
    return top;
  }
}

/** Corner points of a cell path. */
function cornersOf(cells) {
  const points = [cells[0]];
  for (let index = 1; index + 1 < cells.length; index += 1) {
    const [p, c, n] = [cells[index - 1], cells[index], cells[index + 1]];
    if ((c.x - p.x) !== (n.x - c.x) || (c.y - p.y) !== (n.y - c.y)) points.push(c);
  }
  if (cells.length > 1) points.push(cells.at(-1));
  return points.map((point) => ({ x: point.x * G, y: point.y * G }));
}

function search(context, from, to, { startDir, startHeading, endDir, margin, obstacles, own }) {
  const fx = cell(from.x), fy = cell(from.y), tx = cell(to.x), ty = cell(to.y);
  const x0 = Math.min(fx, tx) - margin, y0 = Math.min(fy, ty) - margin;
  const width = Math.max(fx, tx) + margin - x0 + 1, height = Math.max(fy, ty) + margin - y0 + 1;
  const total = width * height * 4;
  const cost = new Float64Array(total).fill(Infinity);
  const parent = new Int32Array(total).fill(-1);
  const heap = new MinHeap();
  const stateOf = (x, y, dir) => (((x - x0) * height + (y - y0)) * 4) + dir;
  const inside = (x, y) => x >= x0 && y >= y0 && x < x0 + width && y < y0 + height;
  const goalDir = endDir === null || endDir === undefined ? null : reverse(endDir);
  const heuristic = (x, y) => Math.abs(x - tx) + Math.abs(y - ty);
  const relax = (x, y, dir, base, extra, from) => {
    const nx = x + DIRS[dir].x, ny = y + DIRS[dir].y;
    if (!inside(nx, ny)) return;
    const isEnd = nx === tx && ny === ty;
    const step = stepCost(context, x, y, dir, false, isEnd, obstacles, own);
    if (!Number.isFinite(step)) return;
    const value = base + extra + step;
    const state = stateOf(nx, ny, dir);
    if (value >= cost[state]) return;
    cost[state] = value;
    parent[state] = from;
    heap.push(value + heuristic(nx, ny), state);
  };
  for (let dir = 0; dir < 4; dir += 1) {
    if (startDir !== null && startDir !== undefined && dir !== startDir) continue;
    let extra = 0;
    if ((startDir === null || startDir === undefined) && startHeading !== null && startHeading !== undefined && dir !== startHeading) {
      extra = dir === reverse(startHeading) ? 2 * ROUTE_COST.bend : ROUTE_COST.bend;
    }
    relax(fx, fy, dir, 0, extra, -1);
  }
  let found = -1;
  while (heap.size) {
    const [priority, state] = heap.pop();
    const dir = state % 4, flat = (state - dir) / 4;
    const x = Math.floor(flat / height) + x0, y = (flat % height) + y0;
    const value = cost[state];
    if (priority > value + heuristic(x, y) + 1e-9) continue; // a stale entry: this state was reached cheaper since

    if (x === tx && y === ty) {
      if (goalDir === null || dir === goalDir) { found = state; break; }
      continue; // reached the pin from the wrong side: a route has to come round
    }
    for (let next = 0; next < 4; next += 1) {
      if (next === reverse(dir)) continue;
      const nx = x + DIRS[next].x, ny = y + DIRS[next].y;
      if (!inside(nx, ny)) continue;
      const isEnd = nx === tx && ny === ty;
      const step = stepCost(context, x, y, next, next !== dir, isEnd, obstacles, own);
      if (!Number.isFinite(step)) continue;
      const reached = value + step;
      const target = stateOf(nx, ny, next);
      if (reached >= cost[target]) continue;
      cost[target] = reached;
      parent[target] = state;
      heap.push(reached + heuristic(nx, ny), target);
    }
  }
  if (found < 0) return null;
  const cells = [];
  for (let state = found; state >= 0; state = parent[state]) {
    const dir = state % 4, flat = (state - dir) / 4;
    cells.push({ x: Math.floor(flat / height) + x0, y: (flat % height) + y0 });
  }
  cells.push({ x: fx, y: fy });
  cells.reverse();
  return { points: cornersOf(cells), cost: cost[found] };
}

/** Cost of an orthogonal grid polyline under the same rules as the search (Infinity if it enters a forbidden cell). */
export function routeCost(context, points, { obstacles = true, own = null } = {}) {
  let total = 0, heading = null;
  for (let index = 0; index + 1 < points.length; index += 1) {
    const p = points[index], q = points[index + 1];
    let x = cell(p.x), y = cell(p.y);
    const tx = cell(q.x), ty = cell(q.y);
    if (x !== tx && y !== ty) return Infinity;
    const dir = directionIndex({ x: tx - x, y: ty - y });
    if (dir === null) continue;
    const last = cell(points.at(-1).x) === tx && cell(points.at(-1).y) === ty && index + 2 === points.length;
    while (x !== tx || y !== ty) {
      const isEnd = last && x + DIRS[dir].x === tx && y + DIRS[dir].y === ty;
      const step = stepCost(context, x, y, dir, heading !== null && heading !== dir, isEnd, obstacles, own);
      if (!Number.isFinite(step)) return Infinity;
      total += step;
      heading = dir;
      x += DIRS[dir].x; y += DIRS[dir].y;
    }
  }
  return total;
}

/** A Z route (two parallel runs joined by one cross run) moves its cross run to the middle when that costs no more. */
function centreZ(context, points, cost, obstacles, own) {
  if (points.length !== 4) return points;
  const [p0, p1, p2, p3] = points;
  const horizontal = p0.y === p1.y && p2.y === p3.y && p1.x === p2.x;
  const vertical = p0.x === p1.x && p2.x === p3.x && p1.y === p2.y;
  if (!horizontal && !vertical) return points;
  const axis = horizontal ? "x" : "y";
  if (Math.sign(p1[axis] - p0[axis]) !== Math.sign(p3[axis] - p2[axis])) return points;
  const low = Math.min(p0[axis], p3[axis]) + G, high = Math.max(p0[axis], p3[axis]) - G;
  const middle = Math.round((p0[axis] + p3[axis]) / 2 / G) * G;
  const candidates = [];
  for (let value = low; value <= high; value += G) candidates.push(value);
  candidates.sort((first, second) => Math.abs(first - middle) - Math.abs(second - middle) || first - second);
  for (const value of candidates) {
    if (value === p1[axis]) return points;
    const moved = horizontal
      ? [p0, { x: value, y: p0.y }, { x: value, y: p3.y }, p3]
      : [p0, { x: p0.x, y: value }, { x: p3.x, y: value }, p3];
    if (routeCost(context, moved, { obstacles, own }) <= cost + 1e-9) return moved;
  }
  return points;
}

/**
 * One leg from `from` to `to` (grid points). `startDir`: the first step must go this way (a pin's outward axis). `startHeading`: the
 * direction the wire arrived in (turning costs a bend, turning back two). `endDir`: the outward axis of the pin at `to`, which the last
 * step must come in against. `own`: the nets this wire joins (their wires may be shared). Returns the corner points, or null when either
 * point is off the grid.
 */
export function routeLeg(context, from, to, { startDir = null, startHeading = null, endDir = null, own = null } = {}) {
  if (!isGridPoint(from) || !isGridPoint(to)) return null;
  const start = { x: cell(from.x) * G, y: cell(from.y) * G }, end = { x: cell(to.x) * G, y: cell(to.y) * G };
  if (start.x === end.x && start.y === end.y) return [start];
  for (const obstacles of [true, false]) {
    for (const margin of obstacles ? MARGINS : [4]) {
      const found = search(context, start, end, { startDir, startHeading, endDir, margin, obstacles, own });
      if (found) return centreZ(context, found.points, found.cost, obstacles, own);
    }
  }
  return null;
}

/** Drop repeated points and every point that lies on the straight line through its neighbours (including a turn-back spike). */
export function simplifyRoute(points) {
  let route = normalizePoints(points);
  for (let changed = true; changed;) {
    changed = false;
    for (let index = 1; index + 1 < route.length; index += 1) {
      const [p, c, n] = [route[index - 1], route[index], route[index + 1]];
      if ((p.x === c.x && c.x === n.x) || (p.y === c.y && c.y === n.y)) {
        route = normalizePoints([...route.slice(0, index), ...route.slice(index + 1)]);
        changed = true;
        break;
      }
    }
  }
  return route;
}

const lastHeading = (points) => points.length > 1 ? directionIndex({ x: points.at(-1).x - points.at(-2).x, y: points.at(-1).y - points.at(-2).y }) : null;

/**
 * Route start → anchors… → end leg by leg. `start`/`end` are {point, dir} (dir null for a junction or a free point). Returns the legs
 * (each a corner list starting where the previous one ended), or null when a point is off the grid.
 */
export function routeLegs(context, start, anchors, end, own = null) {
  const stops = [start.point, ...anchors, end.point];
  if (!stops.every(isGridPoint)) return null;
  const legs = [];
  let heading = null;
  for (let index = 0; index + 1 < stops.length; index += 1) {
    const leg = routeLeg(context, stops[index], stops[index + 1], {
      startDir: index === 0 ? start.dir : null,
      startHeading: index === 0 ? null : heading,
      endDir: index + 2 === stops.length ? end.dir : null,
      own,
    });
    if (!leg) return null;
    legs.push(leg);
    heading = lastHeading(leg) ?? heading;
  }
  return legs;
}

/** Join legs into one simplified polyline. */
export function joinLegs(legs) {
  return simplifyRoute(legs.flatMap((leg, index) => (index ? leg.slice(1) : leg)));
}

const netsOf = (context, ...endpoints) => new Set(endpoints.filter(Boolean).map((endpoint) => context.netOf(endpoint)).filter((net) => net !== null));

/** {point, dir} of a wire endpoint: a pin points outward along its axis, a junction has no preferred side. */
export function endpointRouteInfo(context, endpoint) {
  if (endpoint?.junctionId !== undefined) {
    const junction = context.junctionById.get(endpoint.junctionId);
    return junction ? { point: { x: junction.x, y: junction.y }, dir: null } : null;
  }
  const component = context.componentById.get(endpoint?.componentId);
  if (!component || !Number.isInteger(endpoint.pin)) return null;
  return { point: pinPosition(component, endpoint.pin, context.version), dir: pinOutwardDirection(component, endpoint.pin, context.version) };
}

const cleanAnchors = (anchors) => (Array.isArray(anchors) ? anchors : [])
  .filter((point) => point && Number.isFinite(point.x) && Number.isFinite(point.y))
  .map((point) => ({ x: point.x, y: point.y }));

/**
 * Waypoints for a wire from endpoint `a` through `anchors` to endpoint `b`: {waypoints, anchors}, or null when routing is not possible
 * (an endpoint is missing or off the grid, as in some old drawings) — the caller then keeps its previous behaviour.
 */
export function routeWireGeometry(context, a, b, anchors = []) {
  const start = endpointRouteInfo(context, a), end = endpointRouteInfo(context, b);
  if (!start || !end) return null;
  const fixed = cleanAnchors(anchors);
  const legs = routeLegs(context, start, fixed, end, netsOf(context, a, b));
  if (!legs) return null;
  const route = joinLegs(legs);
  return { waypoints: route.slice(1, -1), anchors: fixed, route };
}

/**
 * The routing fields of a NEW wire a → clicked points → b: {waypoints, anchors} from the router; when the drawing is off the grid (old
 * geometry) the clicked points joined by plain L legs, as wires were drawn before routing ({waypoints} only, no anchors).
 */
export function newWireShape(circuit, a, b, anchors = [], context = createRoutingContext(circuit)) {
  const geometry = routeWireGeometry(context, a, b, anchors);
  if (geometry) return { waypoints: geometry.waypoints, anchors: geometry.anchors };
  const start = endpointRouteInfo(context, a)?.point;
  let waypoints = [];
  if (start) for (const anchor of cleanAnchors(anchors)) waypoints = appendFixedWaypoint(start, waypoints, anchor);
  return { waypoints };
}

/** The pin (or junction) sitting exactly on `point`, as {endpoint, dir}; null when the point is free. `except` is skipped. */
export function endpointAtPoint(context, point, except = null) {
  if (!isGridPoint(point)) return null;
  const same = (p) => Math.abs(p.x - point.x) < 1e-6 && Math.abs(p.y - point.y) < 1e-6;
  for (const component of context.componentById.values()) {
    for (let pin = 0; pin < pinCount(component.type); pin += 1) {
      if (except && except.componentId === component.id && except.pin === pin) continue;
      if (same(pinPosition(component, pin, context.version))) return { endpoint: { componentId: component.id, pin }, dir: pinOutwardDirection(component, pin, context.version) };
    }
  }
  for (const junction of context.junctionById.values()) {
    if (except?.junctionId === junction.id) continue;
    if (same(junction)) return { endpoint: { junctionId: junction.id }, dir: null };
  }
  return null;
}

/**
 * Preview while drawing: the route from `startEndpoint` through the clicked `anchors` to the pointer. When the pointer is on a pin the
 * route enters it the way the finished wire will. Returns {fixed, live, route}: up to the last anchor, the last leg, and the whole route; or null.
 */
export function previewRoute(circuit, startEndpoint, anchors, pointer, context = createRoutingContext(circuit)) {
  const start = endpointRouteInfo(context, startEndpoint);
  if (!start || !isGridPoint(pointer)) return null;
  const hit = endpointAtPoint(context, pointer, startEndpoint);
  const legs = routeLegs(context, start, cleanAnchors(anchors), { point: pointer, dir: hit?.dir ?? null }, netsOf(context, startEndpoint, hit?.endpoint));
  if (!legs) return null;
  return { fixed: legs.length > 1 ? joinLegs(legs.slice(0, -1)) : [], live: legs.at(-1), route: joinLegs(legs) };
}

const endpointMoves = (end, componentIds, junctionIds) => end?.junctionId !== undefined ? junctionIds.has(end.junctionId) : componentIds.has(end?.componentId);

/**
 * Wires with exactly one end on a moved part/junction (a wire with both ends moving travels rigidly with the group, see group-edit).
 * `items` are {kind, id} entries.
 */
export function wiresFollowingMove(circuit, items) {
  const componentIds = new Set(items.filter((item) => item.kind === "component").map((item) => item.id));
  const junctionIds = new Set(items.filter((item) => item.kind === "junction").map((item) => item.id));
  return (circuit.wires ?? []).filter((wire) => {
    const a = endpointMoves(wire.a, componentIds, junctionIds), b = endpointMoves(wire.b, componentIds, junctionIds);
    if (a && b) return false;
    return a || b;
  }).map((wire) => wire.id);
}

/**
 * Route these wires again (in place), through their anchors; a wire saved before routing existed keeps its stored waypoints as anchors.
 * `fresh: true` drops every anchor (the "배선 정리" command). Wires that cannot be routed are left as they are. Returns the ids changed.
 */
export function rerouteWires(circuit, wireIds, { fresh = false } = {}) {
  const wanted = new Set(wireIds);
  const wires = (circuit.wires ?? []).filter((wire) => wanted.has(wire.id));
  if (!wires.length) return [];
  const context = createRoutingContext(circuit, { excludeWireIds: [...wanted] });
  const span = (wire) => {
    const a = endpointRouteInfo(context, wire.a)?.point, b = endpointRouteInfo(context, wire.b)?.point;
    return a && b ? Math.abs(a.x - b.x) + Math.abs(a.y - b.y) : Infinity;
  };
  // Short wires first: they have the fewest ways round, the long ones then go around them.
  const ordered = fresh ? [...wires].sort((first, second) => span(first) - span(second)) : wires;
  const changed = [];
  for (const wire of ordered) {
    const anchors = fresh ? [] : Array.isArray(wire.anchors) ? wire.anchors : (wire.waypoints ?? []);
    const geometry = routeWireGeometry(context, wire.a, wire.b, anchors);
    if (!geometry) {
      const a = endpointRouteInfo(context, wire.a)?.point, b = endpointRouteInfo(context, wire.b)?.point;
      if (a && b) addRouteToContext(context, routeWirePoints(wire, a, b, context.version), context.netOf(wire.a));
      continue;
    }
    wire.waypoints = geometry.waypoints;
    wire.anchors = geometry.anchors;
    addRouteToContext(context, geometry.route, context.netOf(wire.a));
    changed.push(wire.id);
  }
  return changed;
}

/** Copy of the routing fields of some wires, for putting them back when a drag is cancelled or returns to where it started. */
export function captureWireShapes(circuit, wireIds) {
  const wanted = new Set(wireIds);
  return (circuit.wires ?? []).filter((wire) => wanted.has(wire.id)).map((wire) => ({
    id: wire.id,
    waypoints: wire.waypoints === undefined ? undefined : structuredClone(wire.waypoints),
    anchors: wire.anchors === undefined ? undefined : structuredClone(wire.anchors),
  }));
}

export function restoreWireShapes(circuit, shapes) {
  const byId = new Map((circuit.wires ?? []).map((wire) => [wire.id, wire]));
  for (const shape of shapes ?? []) {
    const wire = byId.get(shape.id);
    if (!wire) continue;
    for (const key of ["waypoints", "anchors"]) {
      if (shape[key] === undefined) delete wire[key];
      else wire[key] = structuredClone(shape[key]);
    }
  }
}
