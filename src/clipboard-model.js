import { pinCount } from "./circuit-engine.js";
import { remapFragment, extractFragment } from "./circuit-edit.js";
import { GRID_SIZE } from "./circuit-geometry.js";

/**
 * Internal clipboard for Ctrl+C / Ctrl+X / Ctrl+V (DOM 없음). A clipboard is a plain fragment — parts, junctions and the wires
 * that connect two of them — so it can also travel as JSON through the system clipboard. Pasting never touches the clipboard
 * contents: every paste instantiates fresh ids, remaps wires and controlled-source references inside the copy, and shifts the
 * result by PASTE_STEP per paste so repeated pastes cascade instead of stacking.
 */
export const CLIPBOARD_FORMAT = "circuit-lab-clipboard";
export const CLIPBOARD_VERSION = 1;
export const PASTE_STEP = 2 * GRID_SIZE;
const MAX_ITEMS = 500;

/** Copy the parts and junctions of `items` (selection items) with their internal wires. null when nothing copyable is selected. */
export function buildClipboard(circuit, items) {
  const componentIds = items.filter((item) => item.kind === "component").map((item) => item.id);
  const junctionIds = items.filter((item) => item.kind === "junction").map((item) => item.id);
  const fragment = extractFragment(circuit, componentIds, junctionIds);
  if (!fragment.components.length && !fragment.junctions.length) return null;
  return { format: CLIPBOARD_FORMAT, version: CLIPBOARD_VERSION, ...fragment };
}

export const serializeClipboard = (clipboard) => JSON.stringify(clipboard);

const finite = (value) => typeof value === "number" && Number.isFinite(value);
const idOf = (value) => typeof value === "string" && value.length > 0 && value.length <= 64;
const endpointOk = (end) => end && typeof end === "object" && (idOf(end.junctionId) || (idOf(end.componentId) && Number.isInteger(end.pin) && end.pin >= 0));

/** Shape check for text that came from the system clipboard. Returns a clipboard object or null (never throws). */
export function parseClipboardText(text) {
  if (typeof text !== "string" || text.length > 2_000_000 || !text.includes(CLIPBOARD_FORMAT)) return null;
  let payload;
  try { payload = JSON.parse(text); } catch { return null; }
  if (payload?.format !== CLIPBOARD_FORMAT || payload.version !== CLIPBOARD_VERSION) return null;
  const { components, junctions = [], wires = [] } = payload;
  if (![components, junctions, wires].every(Array.isArray) || components.length + junctions.length > MAX_ITEMS || wires.length > MAX_ITEMS * 2) return null;
  const componentIds = new Set(), junctionIds = new Set();
  for (const component of components) {
    if (!component || !idOf(component.id) || componentIds.has(component.id) || !pinCount(component.type) || !finite(component.x) || !finite(component.y) || (component.rotation !== undefined && !finite(component.rotation))) return null;
    if (component.props !== undefined && (typeof component.props !== "object" || component.props === null || Array.isArray(component.props))) return null;
    componentIds.add(component.id);
  }
  for (const junction of junctions) {
    if (!junction || !idOf(junction.id) || junctionIds.has(junction.id) || !finite(junction.x) || !finite(junction.y)) return null;
    junctionIds.add(junction.id);
  }
  const known = (end) => end.junctionId !== undefined ? junctionIds.has(end.junctionId) : componentIds.has(end.componentId);
  for (const wire of wires) {
    if (!wire || !endpointOk(wire.a) || !endpointOk(wire.b) || !known(wire.a) || !known(wire.b)) return null;
    if (wire.waypoints !== undefined && (!Array.isArray(wire.waypoints) || wire.waypoints.length > 200 || !wire.waypoints.every((point) => finite(point?.x) && finite(point?.y)))) return null;
  }
  if (!components.length && !junctions.length) return null;
  return structuredClone({ format: CLIPBOARD_FORMAT, version: CLIPBOARD_VERSION, components, junctions, wires });
}

/** Instantiate the clipboard into `circuit` (unchanged): {components, wires, junctions, idMap, junctionMap, offset}. `pasteIndex` ≥ 0 scales the shift. */
export function pasteClipboard(circuit, clipboard, pasteIndex = 1) {
  const offset = PASTE_STEP * pasteIndex;
  return { ...remapFragment(circuit, clipboard, offset), offset };
}
