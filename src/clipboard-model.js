import { CIRCUIT_LIMITS, isKnownComponentType, pinCount, validateCircuitStructure } from "./circuit-engine.js";
import { remapFragment, extractFragment } from "./circuit-edit.js";
import { GRID_SIZE } from "./circuit-geometry.js";

/**
 * Internal clipboard for Ctrl+C / Ctrl+X / Ctrl+V (DOM 없음). A clipboard is a plain fragment — parts, junctions and the wires
 * that connect two of them — so it can also travel as JSON through the system clipboard. Pasting never touches the clipboard
 * contents: every paste instantiates fresh ids, remaps wires and controlled-source references inside the copy, and shifts the
 * result by PASTE_STEP per paste so repeated pastes cascade instead of stacking.
 *
 * `source` identifies the project the fragment was copied from. A controlled source whose target is NOT part of the fragment keeps its
 * reference only when it is pasted into that same project and the target still exists; otherwise the reference is cleared (and the
 * caller tells the user to pick a target again) instead of binding to an unrelated element that happens to share the id.
 */
export const CLIPBOARD_FORMAT = "circuit-lab-clipboard";
export const CLIPBOARD_VERSION = 1;
export const PASTE_STEP = 2 * GRID_SIZE;
/** One cap for copy and paste: parts + junctions, wires, JSON length. */
export const MAX_CLIPBOARD_ITEMS = 500;
export const MAX_CLIPBOARD_WIRES = 2 * MAX_CLIPBOARD_ITEMS;
export const MAX_CLIPBOARD_TEXT = 2_000_000;
/** Coordinates beyond this are not a drawing but a hostile or corrupt clip. */
export const COORDINATE_LIMIT = 1e6;

const MAX_PROPS = 64;
const MAX_PROP_TEXT = 512;
const MAX_WAYPOINTS = 200;
const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);

/** Copy the parts and junctions of `items` (selection items) with their internal wires. null when nothing copyable is selected. */
export function buildClipboard(circuit, items, source = "") {
  const componentIds = items.filter((item) => item.kind === "component").map((item) => item.id);
  const junctionIds = items.filter((item) => item.kind === "junction").map((item) => item.id);
  const fragment = extractFragment(circuit, componentIds, junctionIds);
  if (!fragment.components.length && !fragment.junctions.length) return null;
  return { format: CLIPBOARD_FORMAT, version: CLIPBOARD_VERSION, ...(source ? { source: String(source) } : {}), ...fragment };
}

export const serializeClipboard = (clipboard) => JSON.stringify(clipboard);

/** Why a clipboard cannot be copied (the same limits parseClipboardText applies on paste), or null when it fits. */
export function clipboardLimitReason(clip) {
  const count = clip.components.length + clip.junctions.length;
  if (count > MAX_CLIPBOARD_ITEMS) return `한 번에 복사할 수 있는 항목은 ${MAX_CLIPBOARD_ITEMS}개까지입니다 (선택 ${count}개)`;
  if (clip.wires.length > MAX_CLIPBOARD_WIRES) return `한 번에 복사할 수 있는 배선은 ${MAX_CLIPBOARD_WIRES}개까지입니다 (선택 ${clip.wires.length}개)`;
  if (serializeClipboard(clip).length > MAX_CLIPBOARD_TEXT) return "복사할 내용이 너무 큽니다";
  return null;
}

const finite = (value) => typeof value === "number" && Number.isFinite(value);
const coordinate = (value) => finite(value) && Math.abs(value) <= COORDINATE_LIMIT;
const idOf = (value) => typeof value === "string" && value.length > 0 && value.length <= 64 && !FORBIDDEN_KEYS.has(value);
const plainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const quarterTurn = (value) => {
  if (!finite(value) || value % 90 !== 0) return null;
  return ((value % 360) + 360) % 360;
};

function cleanProps(props) {
  if (props === undefined) return {};
  if (!plainObject(props)) return null;
  const entries = Object.entries(props);
  if (entries.length > MAX_PROPS) return null;
  const clean = {};
  for (const [key, value] of entries) {
    if (key.length > 64 || FORBIDDEN_KEYS.has(key)) return null;
    if (typeof value === "string") { if (value.length > MAX_PROP_TEXT) return null; }
    else if (typeof value === "number") { if (!Number.isFinite(value)) return null; }
    else if (typeof value !== "boolean") return null;
    clean[key] = value;
  }
  return clean;
}

function cleanControl(type, control) {
  if (!["CCCS", "CCVS"].includes(type) || !plainObject(control)) return null;
  if (control.kind !== "branchCurrent" || !idOf(control.elementId) || ![-1, 1].includes(control.direction)) return null;
  return { kind: "branchCurrent", elementId: control.elementId, direction: control.direction };
}

function cleanEndpoint(end) {
  if (!plainObject(end)) return null;
  if (end.junctionId !== undefined) return end.componentId === undefined && end.pin === undefined && idOf(end.junctionId) ? { junctionId: end.junctionId } : null;
  return idOf(end.componentId) && Number.isInteger(end.pin) && end.pin >= 0 ? { componentId: end.componentId, pin: end.pin } : null;
}

const endpointText = (end) => end.junctionId !== undefined ? `J:${end.junctionId}` : `P:${end.componentId}:${end.pin}`;

/**
 * The one wire normalisation every paste path goes through (the internal clipboard and text from the system clipboard): a wire from a
 * pin to itself is dropped, and so is a wire that is an EXACT duplicate of an earlier one — the same two ends (either way round) AND the
 * same bend points (read from the other end when the ends are swapped). Parallel wires between the same ends that take different routes
 * are separate drawings and stay. Returns new wire objects only for what it keeps (the originals are not modified).
 */
export function normalizeClipboardWires(wires) {
  const kept = [], seen = new Set();
  for (const wire of wires ?? []) {
    const keyA = endpointText(wire.a), keyB = endpointText(wire.b);
    if (keyA === keyB) continue;
    const points = Array.isArray(wire.waypoints) ? wire.waypoints : [];
    const forward = keyA < keyB;
    const route = (forward ? points : [...points].reverse()).map((point) => `${point.x},${point.y}`).join(";");
    const signature = `${forward ? keyA : keyB}|${forward ? keyB : keyA}|${route}`;
    if (seen.has(signature)) continue;
    seen.add(signature);
    kept.push(wire);
  }
  return kept;
}

/**
 * Shape check and normalisation for text that came from the system clipboard. Returns a NEW clipboard object holding only the known
 * fields (anything else is dropped) or null (never throws). Coordinates must be finite and within COORDINATE_LIMIT, rotations are turned
 * into 0/90/180/270, props keep only string/number/boolean values, wires must connect existing pins/junctions of the fragment, and
 * self-loops and exact duplicate wires (same ends AND same bend points) are removed; parallel wires on different routes are kept.
 */
export function parseClipboardText(text) {
  if (typeof text !== "string" || text.length > MAX_CLIPBOARD_TEXT || !text.includes(CLIPBOARD_FORMAT)) return null;
  let payload;
  try { payload = JSON.parse(text); } catch { return null; }
  if (!plainObject(payload) || payload.format !== CLIPBOARD_FORMAT || payload.version !== CLIPBOARD_VERSION) return null;
  const { components, junctions = [], wires = [] } = payload;
  if (![components, junctions, wires].every(Array.isArray) || components.length + junctions.length > MAX_CLIPBOARD_ITEMS || wires.length > MAX_CLIPBOARD_WIRES) return null;
  const cleanComponents = [], cleanJunctions = [], cleanWires = [];
  const typeById = new Map(), junctionIds = new Set();
  for (const component of components) {
    if (!plainObject(component) || !idOf(component.id) || typeById.has(component.id) || !isKnownComponentType(component.type) || !pinCount(component.type)) return null;
    if (!coordinate(component.x) || !coordinate(component.y)) return null;
    const rotation = component.rotation === undefined ? undefined : quarterTurn(component.rotation);
    if (rotation === null) return null;
    const props = cleanProps(component.props);
    if (!props) return null;
    const control = cleanControl(component.type, component.control);
    cleanComponents.push({ id: component.id, type: component.type, x: component.x, y: component.y, ...(rotation !== undefined ? { rotation } : {}), props, ...(control ? { control } : {}) });
    typeById.set(component.id, component.type);
  }
  for (const junction of junctions) {
    if (!plainObject(junction) || !idOf(junction.id) || junctionIds.has(junction.id) || !coordinate(junction.x) || !coordinate(junction.y)) return null;
    cleanJunctions.push({ id: junction.id, x: junction.x, y: junction.y });
    junctionIds.add(junction.id);
  }
  const known = (end) => end.junctionId !== undefined ? junctionIds.has(end.junctionId) : typeById.has(end.componentId) && end.pin < pinCount(typeById.get(end.componentId));
  const parsedWires = [];
  for (const wire of wires) {
    if (!plainObject(wire)) return null;
    const a = cleanEndpoint(wire.a), b = cleanEndpoint(wire.b);
    if (!a || !b || !known(a) || !known(b)) return null;
    let waypoints;
    if (wire.waypoints !== undefined) {
      if (!Array.isArray(wire.waypoints) || wire.waypoints.length > MAX_WAYPOINTS || !wire.waypoints.every((point) => plainObject(point) && coordinate(point.x) && coordinate(point.y))) return null;
      waypoints = wire.waypoints.map((point) => ({ x: point.x, y: point.y }));
    }
    parsedWires.push({ id: typeof wire.id === "string" && wire.id.length <= 64 && !FORBIDDEN_KEYS.has(wire.id) ? wire.id : `W${parsedWires.length + 1}`, a, b, ...(waypoints ? { waypoints } : {}) });
  }
  cleanWires.push(...normalizeClipboardWires(parsedWires));
  if (!cleanComponents.length && !cleanJunctions.length) return null;
  const source = typeof payload.source === "string" && payload.source.length <= 64 ? payload.source : "";
  return { format: CLIPBOARD_FORMAT, version: CLIPBOARD_VERSION, ...(source ? { source } : {}), components: cleanComponents, junctions: cleanJunctions, wires: cleanWires };
}

/**
 * Instantiate the clipboard into `circuit` (unchanged): {components, wires, junctions, idMap, junctionMap, clearedControls, offset}.
 * `pasteIndex` ≥ 0 scales the shift. A controlled source whose target is outside the fragment keeps its reference only when `sameProject`
 * is true and the target (a V source or current sensor) exists in `circuit`; otherwise the reference is cleared.
 * `allocator` (id-allocator.js) gives the pasted items ids that were never used in this project.
 */
export function pasteClipboard(circuit, clipboard, pasteIndex = 1, { sameProject = true, allocator = null } = {}) {
  const offset = PASTE_STEP * pasteIndex;
  // The internal clipboard holds wires as they are in the circuit; apply the same normalisation as for parsed text, so the result never depends on the paste path.
  clipboard = { ...clipboard, wires: normalizeClipboardWires(clipboard.wires) };
  const resolveControl = (elementId) => sameProject && circuit.components.some((component) => component.id === elementId && ["V", "CURRENT_SENSOR"].includes(component.type));
  return { ...remapFragment(circuit, clipboard, offset, { resolveControl, allocator }), offset };
}

/** How many pasted current-controlled sources have no (valid) control target and need one chosen. */
export const controlsNeedingTarget = (pasted) => pasted.components.filter((component) => ["CCCS", "CCVS"].includes(component.type) && !component.control).length;

/**
 * Would adding these parts, junctions and wires push the circuit past the editing limits? The message, or null when it fits.
 * Paste and duplicate (Ctrl+D) share this pre-check, so neither can build a circuit that the validators reject afterwards.
 */
export function additionLimitReason(circuit, added) {
  if (circuit.components.length + (added.components?.length ?? 0) > CIRCUIT_LIMITS.components
    || circuit.wires.length + (added.wires?.length ?? 0) > CIRCUIT_LIMITS.wires
    || (circuit.junctions?.length ?? 0) + (added.junctions?.length ?? 0) > CIRCUIT_LIMITS.junctions) {
    return `교육용 편집 한도(부품 ${CIRCUIT_LIMITS.components}, 배선 ${CIRCUIT_LIMITS.wires}, 접속점 ${CIRCUIT_LIMITS.junctions})를 넘습니다`;
  }
  return null;
}

/**
 * Check only what a paste adds: the pasted parts, junctions and wires on their own (plus stand-ins for the controlled sources' targets), and
 * the circuit-size limits of the combined result. Errors that already exist elsewhere in the circuit do not block a paste.
 * Returns null when fine, otherwise the message.
 */
export function pasteRejection(circuit, pasted) {
  const limit = additionLimitReason(circuit, pasted);
  if (limit) return limit;
  const stubs = new Map();
  const stub = (id, type) => { if (!stubs.has(id)) stubs.set(id, { id, type, x: 0, y: 0, props: {} }); return id; };
  const pastedIds = new Set(pasted.components.map((component) => component.id));
  const components = pasted.components.map((component) => {
    if (!["CCCS", "CCVS"].includes(component.type)) return component;
    const target = component.control?.elementId;
    const external = target !== undefined && !pastedIds.has(target) ? circuit.components.find((item) => item.id === target) : null;
    // A control that is missing (cleared on purpose) is validated against a stand-in: it is reported in the inspector, it does not block the paste.
    const elementId = external ? stub(external.id, external.type) : target !== undefined && pastedIds.has(target) ? target : stub("__paste_target__", "CURRENT_SENSOR");
    return { ...component, control: { kind: "branchCurrent", elementId, direction: component.control?.direction === -1 ? -1 : 1 } };
  });
  try {
    validateCircuitStructure({ geometryVersion: circuit.geometryVersion, components: [...components, ...stubs.values()], wires: pasted.wires, junctions: pasted.junctions });
  } catch (error) {
    return error.message;
  }
  return null;
}
