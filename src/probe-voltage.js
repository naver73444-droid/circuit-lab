// Voltage probes, read from a result. A probe on a pin, wire or junction reads that node against ground; a probe across a part
// (`across: true`, set by the V probe tool on a part's body) reads pin 1 minus pin 2 — the passive sign convention, so with the part's
// current probe I(R1) (into pin 1) the product V·I is the power the part takes. Pure, no DOM.

export const isAcrossProbe = (probe) => probe?.kind === "voltage" && probe.across === true;
/** Parts a voltage can be read across: two pins (a magnetic part or an op amp has more and is probed pin by pin). */
export const ACROSS_PIN_COUNT = 2;
export const acrossProbeKey = (componentId) => `V:${componentId}:across`;
export const acrossProbeLabel = (component) => `V(${component?.props?.ref ?? component?.id})`;

const own = (object, key) => (object && Object.hasOwn(object, key) ? object[key] : undefined);

/** The result nodes a voltage probe reads: [node] against ground, or [pin 1 node, pin 2 node] across a part; null when not in the result. */
export function voltageProbeNodes(topology, probe) {
  if (probe.junctionId !== undefined) {
    const node = own(topology?.nodeIdByJunction, probe.junctionId);
    return node === undefined ? null : [node];
  }
  if (isAcrossProbe(probe)) {
    const a = own(topology?.nodeIdByPin, `${probe.componentId}:0`), b = own(topology?.nodeIdByPin, `${probe.componentId}:1`);
    return a === undefined || b === undefined ? null : [a, b];
  }
  const node = own(topology?.nodeIdByPin, `${probe.componentId}:${probe.pin}`);
  return node === undefined ? null : [node];
}

/** The probe's value in one result point: a number (DC, transient) or a phasor { re, im } (AC); undefined when a node is missing. */
export function voltageAt(nodeVoltages, nodes) {
  const a = own(nodeVoltages, nodes[0]);
  if (nodes.length === 1 || a === undefined) return a;
  const b = own(nodeVoltages, nodes[1]);
  if (b === undefined) return undefined;
  return typeof a === "number" && typeof b === "number" ? a - b : { re: (a.re ?? a) - (b.re ?? b), im: (a.im ?? 0) - (b.im ?? 0) };
}
