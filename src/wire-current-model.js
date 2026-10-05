import { endpointKey } from "./circuit-edit.js";

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
 * exactly one GND pin, which absorbs the difference (that is where an OP AMP output current returns).
 */

/** Current entering the component at each pin, for a branch current `current` (pin 1 -> pin 2 through the part). */
export function pinCurrentsInto(component, current) {
  const type = component?.type;
  if (type === "GND") return [0];
  if (type === "OPAMP" || type === "OPAMP_IDEAL") return [0, 0, current];
  if (type === "VCVS" || type === "VCCS") return [current, -current, 0, 0];
  return [current, -current];
}

/**
 * @param {{circuit: object, componentCurrents: Record<string, number>}} input
 * @returns {{byWire: Record<string, {current: number|null, state: "flow"|"loop"|"unbalanced"|"unknown"}>, maxAbs: number}}
 *   `current` is positive when it flows from wire.a to wire.b.
 */
export function wireCurrents({ circuit, componentCurrents }) {
  const wires = circuit?.wires ?? [];
  const byWire = {};
  const vertices = new Map(); // key -> { injection, ground, bad, edges: [{ to, wire, sign }] }
  const vertexOf = (key) => {
    if (!vertices.has(key)) vertices.set(key, { key, injection: 0, ground: false, bad: false, edges: [] });
    return vertices.get(key);
  };
  wires.forEach((wire, index) => {
    const a = vertexOf(endpointKey(wire.a));
    const b = vertexOf(endpointKey(wire.b));
    a.edges.push({ to: b, wire: index, sign: 1 });
    b.edges.push({ to: a, wire: index, sign: -1 });
  });

  let largest = 0;
  for (const component of circuit?.components ?? []) {
    const raw = componentCurrents?.[component.id];
    const into = Number.isFinite(raw) || component.type === "GND" ? pinCurrentsInto(component, Number.isFinite(raw) ? raw : 0) : null;
    const count = into ? into.length : 4;
    for (let pin = 0; pin < count; pin += 1) {
      const vertex = vertices.get(`P:${component.id}:${pin}`);
      if (!vertex) continue;
      if (!into) { vertex.bad = true; continue; }
      vertex.injection -= into[pin]; // current leaving the pin into the wires
      if (component.type === "GND") vertex.ground = true;
      largest = Math.max(largest, Math.abs(into[pin]));
    }
  }
  const tolerance = 1e-6 * largest + 1e-18;

  const discovery = new Map();
  const low = new Map();
  let maxAbs = 0;
  const setAll = (edgeIds, state) => { for (const id of edgeIds) byWire[wires[id].id] = { current: null, state }; };

  for (const root of vertices.values()) {
    if (discovery.has(root.key)) continue;
    // Iterative DFS collecting this connected piece: visit order, tree edges and low-links (bridge detection by edge id).
    const order = [];
    const parent = new Map(); // key -> { vertex, edge }
    const stack = [{ vertex: root, next: 0, via: -1 }];
    discovery.set(root.key, discovery.size);
    low.set(root.key, discovery.get(root.key));
    order.push(root);
    const edgeIds = new Set();
    while (stack.length) {
      const frame = stack.at(-1);
      const { vertex } = frame;
      if (frame.next < vertex.edges.length) {
        const edge = vertex.edges[frame.next++];
        edgeIds.add(edge.wire);
        if (edge.wire === frame.via) continue;
        if (!discovery.has(edge.to.key)) {
          discovery.set(edge.to.key, discovery.size);
          low.set(edge.to.key, discovery.get(edge.to.key));
          parent.set(edge.to.key, { vertex, edge });
          order.push(edge.to);
          stack.push({ vertex: edge.to, next: 0, via: edge.wire });
        } else {
          low.set(vertex.key, Math.min(low.get(vertex.key), discovery.get(edge.to.key)));
        }
      } else {
        stack.pop();
        const up = parent.get(vertex.key);
        if (up) low.set(up.vertex.key, Math.min(low.get(up.vertex.key), low.get(vertex.key)));
      }
    }

    if (order.some((vertex) => vertex.bad)) { setAll(edgeIds, "unknown"); continue; }
    const total = order.reduce((sum, vertex) => sum + vertex.injection, 0);
    const sinks = order.filter((vertex) => vertex.ground);
    const absorbed = new Map();
    if (Math.abs(total) > tolerance) {
      if (sinks.length !== 1) { setAll(edgeIds, "unbalanced"); continue; }
      absorbed.set(sinks[0].key, -total);
    }
    // Subtree sums, children before parents (reverse visit order).
    const sum = new Map(order.map((vertex) => [vertex.key, vertex.injection + (absorbed.get(vertex.key) ?? 0)]));
    const bridges = new Set();
    for (let i = order.length - 1; i > 0; i -= 1) {
      const vertex = order[i];
      const up = parent.get(vertex.key);
      sum.set(up.vertex.key, sum.get(up.vertex.key) + sum.get(vertex.key));
      if (low.get(vertex.key) > discovery.get(up.vertex.key)) {
        // Everything injected below leaves through this wire toward the parent: parent->child current is -sum.
        const current = up.edge.sign * -sum.get(vertex.key);
        const safe = Math.abs(current) <= tolerance ? 0 : current;
        byWire[wires[up.edge.wire].id] = { current: safe, state: "flow" };
        bridges.add(up.edge.wire);
        maxAbs = Math.max(maxAbs, Math.abs(safe));
      }
    }
    for (const id of edgeIds) if (!bridges.has(id)) byWire[wires[id].id] = { current: null, state: "loop" };
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
