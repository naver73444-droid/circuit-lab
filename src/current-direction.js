import { CURRENT_GEOMETRY_VERSION, localPin } from "./circuit-geometry.js";
import { secondaryCurrentKey } from "./circuit-engine.js";
import { engineering } from "./scope-model.js";

/**
 * Current direction for display. The solver keeps one fixed sign per part (the "engine reference": pin 1→2, p→n, 1a→1b / 2a→2b,
 * output→reference); nothing here changes a solved number.
 *
 * - DC and the instantaneous value of a transient are shown as a magnitude with the direction the current really flows
 *   (actualCurrentDirection: "2.91 A (2→1)"), so a part placed backwards or rotated never shows a negative current.
 * - AC phasors (and the signed scope waveforms) keep a reference direction. A part can flip its reference (component.flipCurrent,
 *   and flipCurrent2 for the second winding of a magnetic part) to match a textbook figure: the shown phasor/waveform is then ×(−1).
 */

const OUTPUT_PN_TYPES = new Set(["VCVS", "VCCS", "CURRENT_SENSOR", "CCCS", "CCVS"]);
const OPAMP_TYPES = new Set(["OPAMP", "OPAMP_IDEAL"]);

const MAGNETIC_TYPES = new Set(["COUPLED_L", "XFMR_IDEAL"]);

/** Absolute floor of the "no current" band (A); results are also compared with the largest current of the same sample. */
const ZERO_FLOOR = 1e-15;
const ZERO_RELATIVE = 1e-12;

/** Coupled inductors and the ideal transformer have two windings, each with its own current (probe.winding 1 or 2). */
export const isMagneticPart = (component) => MAGNETIC_TYPES.has(component?.type);

/** The key of a current probe's series in a result point's componentCurrents (winding 2 of a magnetic part lives under `<id>#2`). */
export function probeCurrentKey(probe) {
  return probe?.winding === 2 ? secondaryCurrentKey(probe.componentId) : probe?.componentId;
}

/** Which winding (1 or 2) a point on the canvas belongs to: the left half of the part in its own frame is winding 1, the right half winding 2. */
export function magneticWindingAt(component, point) {
  const angle = ((component?.rotation ?? 0) * Math.PI) / 180;
  const dx = point.x - component.x;
  const dy = point.y - component.y;
  return dx * Math.cos(angle) + dy * Math.sin(angle) > 0 ? 2 : 1;
}

// ---- reference flip (display only, stored as optional component fields)

/** The component field that flips a winding's shown reference direction (true = flipped, absent = engine reference). */
export const currentFlipKey = (winding = 1) => (winding === 2 ? "flipCurrent2" : "flipCurrent");

export function isCurrentReferenceFlipped(component, winding = 1) {
  if (!component || component.type === "GND") return false;
  if (winding === 2 && !isMagneticPart(component)) return false;
  return component[currentFlipKey(winding)] === true;
}

/** −1 when the shown reference is the reverse of the engine reference, else +1. */
export const currentReferenceSign = (component, winding = 1) => (isCurrentReferenceFlipped(component, winding) ? -1 : 1);

/** Flip a winding's shown reference in place (an unflipped part carries no field at all). Returns the new state. */
export function toggleCurrentReference(component, winding = 1) {
  if (!component || component.type === "GND" || (winding === 2 && !isMagneticPart(component))) return false;
  const key = currentFlipKey(winding);
  if (component[key] === true) { delete component[key]; return false; }
  component[key] = true;
  return true;
}

/** Opened files: keep only `true` flags that belong to the part (flipCurrent2 only on magnetic parts, nothing on GND). */
export function sanitizeCurrentReferences(components) {
  for (const component of components ?? []) {
    if (!component || typeof component !== "object") continue;
    for (const winding of [1, 2]) {
      const key = currentFlipKey(winding);
      if (!Object.hasOwn(component, key)) continue;
      const allowed = component[key] === true && component.type !== "GND" && (winding === 1 || isMagneticPart(component));
      if (!allowed) delete component[key];
    }
  }
  return components;
}

/** The valid flip fields of a part as a fresh object ({} when none): for code that copies only known fields (clipboard text). */
export function currentReferenceFields(component) {
  const fields = {};
  for (const winding of [1, 2]) if (isCurrentReferenceFlipped(component, winding)) fields[currentFlipKey(winding)] = true;
  return fields;
}

/** A solved current (number or {re, im}) in the shown reference: ×(−1) when `sign` is −1. */
export function signedCurrent(value, sign = 1) {
  if (sign !== -1 || value === undefined || value === null) return value;
  if (typeof value === "object") return { re: -value.re, im: -value.im };
  return -value;
}

// ---- descriptors (pin pairs and arrows in the part's own frame)

function endpointNames(component, winding) {
  if (isMagneticPart(component)) return winding === 2 ? ["2a", "2b"] : ["1a", "1b"];
  if (OPAMP_TYPES.has(component.type)) return ["출력", component.type === "OPAMP_IDEAL" ? "내부 기준 GND" : "기준"];
  if (OUTPUT_PN_TYPES.has(component.type)) return ["p", "n"];
  return ["1", "2"];
}

/** The engine reference of a part (winding): positive solver current flows from `from` to `to`. */
export function currentDirectionDescriptor(component, geometryVersion = CURRENT_GEOMETRY_VERSION, winding = 1) {
  if (!component || component.type === "GND") return null;
  const names = endpointNames(component, winding);
  const label = `${names[0]}→${names[1]}`;
  if (isMagneticPart(component)) {
    const first = winding === 2 ? 2 : 0;
    return {
      kind: "pin-pair",
      label,
      names,
      from: localPin(component.type, first, geometryVersion),
      to: localPin(component.type, first + 1, geometryVersion),
      fromPin: first,
      toPin: first + 1,
      offset: winding === 2 ? -14 : 14,
      padding: 4,
      reversed: false,
    };
  }
  if (OPAMP_TYPES.has(component.type)) {
    const output = localPin(component.type, 2, geometryVersion);
    return {
      kind: "output-reference",
      label,
      names,
      from: output,
      to: { x: output.x * 0.3, y: output.y * 0.3 },
      fromPin: 2,
      toPin: null,
      reversed: false,
    };
  }
  return {
    kind: "pin-pair",
    label,
    names,
    from: localPin(component.type, 0, geometryVersion),
    to: localPin(component.type, 1, geometryVersion),
    fromPin: 0,
    toPin: 1,
    reversed: false,
  };
}

/** The same pin pair pointing the other way. The arrow stays on the same side of the part (`base` keeps the drawing frame). */
export function reverseDirection(direction) {
  if (!direction) return null;
  const names = [direction.names[1], direction.names[0]];
  return {
    ...direction,
    label: `${names[0]}→${names[1]}`,
    names,
    from: direction.to,
    to: direction.from,
    fromPin: direction.toPin,
    toPin: direction.fromPin,
    reversed: !direction.reversed,
    base: direction.base ?? direction,
  };
}

/** The reference direction shown to the user: the engine reference, reversed when the part (winding) is flipped. */
export function referenceDirection(component, geometryVersion = CURRENT_GEOMETRY_VERSION, winding = 1) {
  const engine = currentDirectionDescriptor(component, geometryVersion, winding);
  return engine && isCurrentReferenceFlipped(component, winding) ? reverseDirection(engine) : engine;
}

/** The band treated as "no current" for a sample whose largest current is `scale` (A). */
export const currentZeroTolerance = (scale = 0) => ZERO_FLOOR + ZERO_RELATIVE * (Number.isFinite(scale) ? Math.abs(scale) : 0);

/** Largest |current| of one result point (real values only): the scale of the zero band. */
export function pointCurrentScale(componentCurrents) {
  let largest = 0;
  for (const value of Object.values(componentCurrents ?? {})) if (Number.isFinite(value)) largest = Math.max(largest, Math.abs(value));
  return largest;
}

/**
 * Where a real (DC or instantaneous) solver current really flows. `value` is in the engine reference (the solver's sign).
 * Returns {zero, magnitude, sign, direction, label}: `direction` is the descriptor pointing the real way (null at ≈0) and `label`
 * its pin text ("2→1", "1b→1a", "n→p", "기준→출력"), empty at ≈0.
 */
export function actualCurrentDirection(component, value, { geometryVersion = CURRENT_GEOMETRY_VERSION, winding = 1, scale = 0 } = {}) {
  const engine = currentDirectionDescriptor(component, geometryVersion, winding);
  if (!engine || !Number.isFinite(value)) return null;
  const magnitude = Math.abs(value);
  if (magnitude <= currentZeroTolerance(scale)) {
    return { zero: true, magnitude: 0, sign: 0, direction: null, label: "" };
  }
  const direction = value > 0 ? engine : reverseDirection(engine);
  return { zero: false, magnitude, sign: value > 0 ? 1 : -1, direction, label: direction.label };
}

/** "2.91 A (2→1)" for a real solver current, "0 A" in the zero band. */
export function actualCurrentText(component, value, options = {}) {
  const actual = actualCurrentDirection(component, value, options);
  if (!actual) return "";
  return actual.zero ? "0 A" : `${engineering(actual.magnitude, "A")} (${actual.label})`;
}

export function currentProbeLabel(component, geometryVersion = CURRENT_GEOMETRY_VERSION, winding = 1) {
  const direction = referenceDirection(component, geometryVersion, winding);
  if (!direction) return "";
  const ref = component.props?.ref ?? component.id;
  if (isMagneticPart(component)) {
    const name = `${ref}.${winding === 2 ? 2 : 1}`;
    // A winding in its default reference (into its dot-side pin a) keeps the short textbook-style name.
    return isCurrentReferenceFlipped(component, winding) ? `I(${name}, 기준 ${direction.label})` : `I(${name})`;
  }
  return `I(${ref}, 기준 ${direction.label})`;
}

export function currentArrowGeometry(direction) {
  const base = direction?.base ?? direction;
  if (!base?.from || !base?.to) return null;
  const dx = base.to.x - base.from.x;
  const dy = base.to.y - base.from.y;
  const length = Math.hypot(dx, dy);
  if (!Number.isFinite(length) || length < 1) return null;
  const ux = dx / length, uy = dy / length;
  const nx = -uy, ny = ux;
  const padding = base.padding ?? (base.kind === "output-reference" ? 2 : 11);
  const offset = base.offset ?? (base.kind === "output-reference" ? -15 : -23);
  let start = { x: base.from.x + ux * padding + nx * offset, y: base.from.y + uy * padding + ny * offset };
  let end = { x: base.to.x - ux * padding + nx * offset, y: base.to.y - uy * padding + ny * offset };
  // A reversed direction is drawn on the same line, pointing the other way.
  const sx = direction.reversed ? -ux : ux, sy = direction.reversed ? -uy : uy;
  if (direction.reversed) [start, end] = [end, start];
  const headLength = 7, headWidth = 5;
  return {
    start,
    end,
    unit: { x: sx, y: sy },
    head: [
      end,
      { x: end.x - sx * headLength + nx * headWidth, y: end.y - sy * headLength + ny * headWidth },
      { x: end.x - sx * headLength - nx * headWidth, y: end.y - sy * headLength - ny * headWidth },
    ],
  };
}

export function currentDirectionGuide(analysis) {
  if (analysis === "ac") return "AC 페이저는 화살표(기준 방향) 기준 · 부품 속성에서 기준 뒤집기 가능";
  if (analysis === "transient") return "판독·화살표는 그 시점에 실제로 흐르는 방향과 크기 · 그래프 파형은 기준 방향 부호(±)";
  return "값·화살표는 실제로 흐르는 방향과 크기 · 0 A 근처는 방향 없음";
}
