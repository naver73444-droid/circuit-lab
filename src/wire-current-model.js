import { endpointKey, pinKey } from "./circuit-engine.js";

/**
 * Wire currents for the "전류 흐름" view. Pure: no DOM, no solver call.
 *
 * The solver gives one current per component (componentCurrents[id], SPICE style: it enters pin 1 and leaves pin 2; an OP AMP
 * output current enters pin 3 and returns through the implicit reference). Wires carry no solver variable, so the current of a
 * wire is derived with KCL on the wire graph of its net: every component pin injects its current into the net, and a wire that
 * is a bridge of that graph must carry exactly the injection of the side it cuts off.
 *
 * A wire that lies on a cycle of wires (two wires between the same endpoints, a loop through several junctions) has no defined
 * split, so it gets `current: null` (state "loop"). A net whose injections do not cancel is also left undefined, unless it has
 * a GND, which absorbs the difference (that is where an OP AMP output current returns).
 *
 * The engine ties EVERY GND part to the same 0 V node, so all GND pins are one vertex of the graph (an implicit, zero-resistance
 * connection between them). A wire that closes a cycle through that vertex (a wire from one GND to another, or a path that leaves
 * and re-enters GND) therefore has no determined current even when its net balances.
 *
 * The topology (which wires are bridges of which piece) does not depend on the currents, so analyzeWireNets() can be computed once
 * per circuit geometry and reused for every sample; wireCurrents() only does the per-sample sums.
 */

const GROUND_KEY = "GND";

/** Current entering the component at each pin, for a branch current `current` (pin 1 -> pin 2 through the part). */
export function pinCurrentsInto(component, current) {
  const type = component?.type;
  if (type === "GND") return [0];
  if (type === "OPAMP" || type === "OPAMP_IDEAL") return [0, 0, current];
  if (type === "VCVS" || type === "VCCS") return [current, -current, 0, 0];
  return [current, -current];
}

/**
 * The current-independent part: wire graph (all GND pins merged into one vertex) split into connected pieces, each with its DFS
 * order, tree parents and which tree edges are bridges.
 * @returns {{wires: object[], index: Map<string, number>, ground: number, pieces: object[]}}
 */
export function analyzeWireNets(circuit) {
  const wires = circuit?.wires ?? [];
  const groundIds = new Set((circuit?.components ?? []).filter((component) => component.type === "GND").map((component) => component.id));
  const keyOf = (end) => (end?.componentId !== undefined && groundIds.has(end.componentId) ? GROUND_KEY : endpointKey(end));
  const index = new Map(); // vertex key -> vertex number
  const edges = []; // vertex number -> [{ to, wire, sign }]
  const vertexOf = (key) => {
    let id = index.get(key);
    if (id === undefined) { id = edges.length; index.set(key, id); edges.push([]); }
    return id;
  };
  wires.forEach((wire, wireIndex) => {
    const a = vertexOf(keyOf(wire.a));
    const b = vertexOf(keyOf(wire.b));
    edges[a].push({ to: b, wire: wireIndex, sign: 1 });
    edges[b].push({ to: a, wire: wireIndex, sign: -1 });
  });

  const discovery = new Array(edges.length).fill(-1);
  const low = new Array(edges.length).fill(0);
  let counter = 0;
  const pieces = [];
  for (let root = 0; root < edges.length; root += 1) {
    if (discovery[root] !== -1) continue;
    // Iterative DFS collecting this connected piece: visit order, tree edges and low-links (bridge detection by edge id).
    const order = [root];
    const parent = new Map(); // vertex -> { vertex, edge, sign }
    const stack = [{ vertex: root, next: 0, via: -1 }];
    discovery[root] = counter; low[root] = counter; counter += 1;
    const edgeIds = new Set();
    while (stack.length) {
      const frame = stack.at(-1);
      const { vertex } = frame;
      if (frame.next < edges[vertex].length) {
        const edge = edges[vertex][frame.next++];
        edgeIds.add(edge.wire);
        if (edge.wire === frame.via) continue;
        if (discovery[edge.to] === -1) {
          discovery[edge.to] = counter; low[edge.to] = counter; counter += 1;
          parent.set(edge.to, { vertex, edge: edge.wire, sign: edge.sign });
          order.push(edge.to);
          stack.push({ vertex: edge.to, next: 0, via: edge.wire });
        } else {
          low[vertex] = Math.min(low[vertex], discovery[edge.to]);
        }
      } else {
        stack.pop();
        const up = parent.get(vertex);
        if (up) low[up.vertex] = Math.min(low[up.vertex], low[vertex]);
      }
    }
    const bridges = new Set(); // child vertices whose tree edge to the parent is a bridge
    for (let i = order.length - 1; i > 0; i -= 1) {
      const up = parent.get(order[i]);
      if (low[order[i]] > discovery[up.vertex]) bridges.add(order[i]);
    }
    pieces.push({ order, parent, bridges, edgeIds: [...edgeIds] });
  }
  return { wires, index, ground: index.has(GROUND_KEY) ? index.get(GROUND_KEY) : -1, pieces };
}

/**
 * @param {{circuit: object, componentCurrents: Record<string, number>, nets?: ReturnType<typeof analyzeWireNets>}} input
 *   `nets` is the cached analyzeWireNets(circuit) of the same circuit geometry (computed here when omitted).
 * @returns {{byWire: Record<string, {current: number|null, state: "flow"|"loop"|"unbalanced"|"unknown"}>, maxAbs: number}}
 *   `current` is positive when it flows from wire.a to wire.b.
 */
export function wireCurrents({ circuit, componentCurrents, nets = analyzeWireNets(circuit) }) {
  const { wires, index, ground, pieces } = nets;
  // No prototype: a wire id like "__proto__" or "constructor" must stay plain data.
  const byWire = Object.create(null);
  const injection = new Array(index.size).fill(0);
  const bad = new Array(index.size).fill(false);

  let largest = 0;
  for (const component of circuit?.components ?? []) {
    const raw = componentCurrents?.[component.id];
    const into = Number.isFinite(raw) || component.type === "GND" ? pinCurrentsInto(component, Number.isFinite(raw) ? raw : 0) : null;
    const count = into ? into.length : 4;
    for (let pin = 0; pin < count; pin += 1) {
      const vertex = index.get(component.type === "GND" ? GROUND_KEY : pinKey(component.id, pin));
      if (vertex === undefined) continue;
      if (!into) { bad[vertex] = true; continue; }
      injection[vertex] -= into[pin]; // current leaving the pin into the wires
      largest = Math.max(largest, Math.abs(into[pin]));
    }
  }
  const tolerance = 1e-6 * largest + 1e-18;

  let maxAbs = 0;
  const setAll = (edgeIds, state) => { for (const id of edgeIds) byWire[wires[id].id] = { current: null, state }; };

  for (const { order, parent, bridges, edgeIds } of pieces) {
    if (order.some((vertex) => bad[vertex])) { setAll(edgeIds, "unknown"); continue; }
    const total = order.reduce((sum, vertex) => sum + injection[vertex], 0);
    const sum = new Map(order.map((vertex) => [vertex, injection[vertex]]));
    if (Math.abs(total) > tolerance) {
      // The only place that can take the difference is the (single, merged) GND.
      if (!order.includes(ground)) { setAll(edgeIds, "unbalanced"); continue; }
      sum.set(ground, sum.get(ground) - total);
    }
    // Subtree sums, children before parents (reverse visit order).
    const bridged = new Set();
    for (let i = order.length - 1; i > 0; i -= 1) {
      const vertex = order[i];
      const up = parent.get(vertex);
      sum.set(up.vertex, sum.get(up.vertex) + sum.get(vertex));
      if (bridges.has(vertex)) {
        // Everything injected below leaves through this wire toward the parent: parent->child current is -sum.
        const current = up.sign * -sum.get(vertex);
        const safe = Math.abs(current) <= tolerance ? 0 : current;
        byWire[wires[up.edge].id] = { current: safe, state: "flow" };
        bridged.add(up.edge);
        maxAbs = Math.max(maxAbs, Math.abs(safe));
      }
    }
    for (const id of edgeIds) if (!bridged.has(id)) byWire[wires[id].id] = { current: null, state: "loop" };
  }
  return { byWire, maxAbs };
}

/**
 * Which result sample the view shows: DC (or a single point) is the operating point; otherwise the scope cursor when it points
 * inside the result, else the last sample. Returns null when there is nothing drawable (no result, or AC: phasors, not a time flow).
 */
export function flowSampleIndex(result, cursorIndex) {
  if (!result?.points?.length || result.analysis === "ac") return null;
  if (result.analysis === "dc" || result.points.length <= 1) return 0;
  return Number.isInteger(cursorIndex) && cursorIndex >= 0 && cursorIndex < result.points.length ? cursorIndex : result.points.length - 1;
}

/**
 * Speed class 0..4 from the magnitude relative to a reference current (the run peak, see peakComponentCurrent): 0 draws nothing (negligible), 4 is the fastest.
 * Relative on purpose: the picture answers "where does the current go and where is it big", the units live in the readouts.
 */
export function flowSpeedClass(magnitude, maximum) {
  if (!(maximum > 1e-12) || !(magnitude > 1e-12)) return 0;
  const ratio = magnitude / maximum;
  if (ratio >= 0.316) return 4;
  if (ratio >= 0.1) return 3;
  if (ratio >= 0.0316) return 2;
  if (ratio >= 0.003) return 1;
  return 0;
}

const peakCache = new WeakMap();

/**
 * Largest |component current| over every sample of a result (cached per result object). The speed classes are measured against
 * this reference so a decaying transient visibly slows down instead of always showing its current maximum as "fast".
 */
export function peakComponentCurrent(result) {
  if (!result || typeof result !== "object") return 0;
  if (peakCache.has(result)) return peakCache.get(result);
  let peak = 0;
  for (const point of result.points ?? []) {
    for (const value of Object.values(point?.componentCurrents ?? {})) if (Number.isFinite(value) && Math.abs(value) > peak) peak = Math.abs(value);
  }
  peakCache.set(result, peak);
  return peak;
}
