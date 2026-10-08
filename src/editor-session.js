import { CURRENT_GEOMETRY_VERSION, circuitGeometryVersion } from "./circuit-geometry.js";
import { endpointExists } from "./circuit-edit.js";
import { classifyCircuitConnections, connectionFrequency } from "./circuit-status.js";
import { currentProbeLabel, isMagneticPart, toggleCurrentReference } from "./current-direction.js";
import { nextAvailableProbeColor, removeProbeByKey } from "./ui-model.js";
import { allocatorFor } from "./id-allocator.js";

const HISTORY_LIMIT = 100;
/** Default idle window of a coalescing group (wheel ticks). */
export const GROUP_IDLE_MS = 400;
export const PROBE_COLORS = ["#80bfff", "#f5bc79", "#c5a2f2", "#8ed4ad", "#ff969e", "#d7d783", "#83d2db", "#eea7d0"];

const pageToken = Math.random().toString(36).slice(2, 10);
let projectCounter = 0;
/** An id for "this project in this page": clipboard fragments carry it so a paste can tell a different project (or tab) from the same one. */
export const newProjectId = () => `${pageToken}-${(projectCounter += 1).toString(36)}`;

/** The analysis settings of an empty project; every project replacement starts from these, never from the previous project. */
export const defaultSettings = () => ({ analysis: "dc", start: "0", end: "5m", step: "10u", startFrequency: "10", endFrequency: "100k", pointsPerDecade: "30", phasorFrequency: "159.155" });

/** Editable project state. The shared state object also carries run results and pointer state owned by other modules. */
export function createEditorState() {
  return {
    projectId: newProjectId(),
    circuit: { version: 1, geometryVersion: CURRENT_GEOMETRY_VERSION, components: [], wires: [], junctions: [] },
    settings: defaultSettings(),
    title: "새 회로",
    subtitle: "빈 캔버스에서 시작하세요",
    selected: null,
    selection: new Set(),
    probes: [],
    history: [],
    future: [],
    learningId: null,
    generation: 0,
    intent: "auto",
  };
}

/**
 * The only path that edits the circuit: mutate() records history, applies the change, bumps the generation and
 * re-renders; restore()/undo()/redo() replay snapshots. Everything that reacts to a change is injected.
 */
export function createEditorSession(deps) {
  const { state, inputDrafts, synchronizeIntent, markStale, scheduleAutoRun, renderAll, resetProjectSession, beforeHistoryRestore, afterHistoryRestore, beforeProjectBoundary, refreshProbeViews, closeProbeContextMenu, confirmDiscardDrafts, onCommitted, onPendingWireDropped } = deps;
  let connectionCache = null;
  // Open coalescing group (wheel ticks, held arrow keys): { key, generation, timer }.
  let editGroup = null;

  /** Tell the autosave (or anything else) that a committed edit just happened. Never throws into the editor. */
  function committed() {
    try { onCommitted?.(); } catch { /* a failing observer must not break editing */ }
  }

  function pushCapped(list, entry) {
    list.push(entry);
    if (list.length > HISTORY_LIMIT) list.shift();
  }

  function currentConnections() {
    const key = `${state.generation}:${state.settings.analysis}:${state.settings.phasorFrequency}:${state.settings.startFrequency}`;
    if (connectionCache?.circuit === state.circuit && connectionCache.key === key) return connectionCache.value;
    const value = classifyCircuitConnections(state.circuit, state.settings.analysis, { frequency: connectionFrequency(state.settings) });
    connectionCache = { circuit: state.circuit, key, value };
    return value;
  }

  /**
   * Ids already in the project count as used for good (see id-allocator.js): remembered before every edit, because the edit may delete them, and
   * after a restore, so undo/redo can never lower what was issued.
   */
  function rememberIds() {
    const circuit = state.circuit;
    allocatorFor(state).observe(circuit.components, circuit.junctions, circuit.wires);
  }

  /** Every history write goes through here: it ends the open coalescing group, so a later grouped edit (wheel, held arrow) starts its own entry. */
  function recordHistory(entry) {
    closeEditGroup();
    pushCapped(state.history, entry);
    state.future = [];
  }

  function recordProbeEdit() {
    recordHistory(snapshot());
  }

  function snapshot() {
    return JSON.stringify({ projectId: state.projectId, circuit: state.circuit, settings: state.settings, title: state.title, subtitle: state.subtitle, probes: state.probes, learningId: state.learningId, intent: state.intent });
  }

  /**
   * Replay a snapshot (undo/redo). Within one project only the in-flight run is cancelled and the result turns stale: scope zoom/cursors,
   * the port selection and the sweep form stay. A snapshot that belongs to another project (undoing a new/open/example) resets the session.
   */
  function restore(serialized) {
    const saved = JSON.parse(serialized);
    closeEditGroup();
    if (saved.projectId && saved.projectId !== state.projectId) {
      // Undo/redo into another project is a replacement like new/open/example: the leaving project is flushed and its slot rotated to prev
      // before the restored one is saved, otherwise the next save would overwrite it (own=B, prev=A -> undo -> own=A, prev=A, B lost).
      try { beforeProjectBoundary?.(); } catch { /* the autosave bookkeeping must not break undo */ }
      resetProjectSession();
    } else beforeHistoryRestore?.();
    if (saved.projectId) state.projectId = saved.projectId;
    rememberIds(); // what the state being left behind used
    state.circuit = { ...saved.circuit, junctions: saved.circuit.junctions ?? [] };
    rememberIds();
    state.settings = saved.settings;
    state.title = saved.title;
    state.subtitle = saved.subtitle;
    state.probes = saved.probes ?? [];
    state.learningId = saved.learningId ?? null;
    state.intent = saved.intent ?? "manual";
    synchronizeIntent();
    state.selected = null;
    state.selection = new Set();
    state.pendingPin = null;
    state.pendingWaypoints = [];
    afterHistoryRestore?.();
    bumpGeneration();
    markStale();
    renderAll();
    scheduleAutoRun();
    committed();
  }

  /** A half-drawn wire whose start part or junction was just deleted must not survive: finishing it would wire a pin that no longer exists. */
  function dropDanglingPendingWire() {
    if (!state.pendingPin || endpointExists(state.circuit, state.pendingPin)) return;
    state.pendingPin = null;
    state.pendingWaypoints = [];
    state.pointer = null;
    try { onPendingWireDropped?.(); } catch { /* the hint text is cosmetic */ }
  }

  function mutate(change, { history = true, auto = true, autosave = true } = {}) {
    rememberIds();
    if (history) recordHistory(snapshot());
    change();
    dropDanglingPendingWire();
    inputDrafts.retainComponents(new Set(state.circuit.components.map((item) => item.id)));
    synchronizeIntent();
    bumpGeneration();
    markStale();
    renderAll();
    if (auto) scheduleAutoRun();
    if (autosave) committed();
  }

  /**
   * mutate() that folds repeated calls with the same key into ONE history entry: the first call records history, later calls
   * made within idleMs (and with no other edit in between) replay on top of it. Used for wheel value steps and held arrow keys.
   */
  function mutateGrouped(key, change, { idleMs = GROUP_IDLE_MS } = {}) {
    const open = editGroup !== null && editGroup.key === key && editGroup.generation === state.generation;
    if (editGroup) clearTimeout(editGroup.timer);
    mutate(change, { history: !open });
    const group = { key, generation: state.generation, timer: null };
    group.timer = setTimeout(() => { if (editGroup === group) editGroup = null; }, idleMs);
    editGroup = group;
  }

  /** End the open coalescing group (only the one named by `key`, when given) so the next grouped edit starts a new history entry. */
  function closeEditGroup(key) {
    if (!editGroup || (key !== undefined && editGroup.key !== key)) return;
    clearTimeout(editGroup.timer);
    editGroup = null;
  }

  function addVoltageProbe(componentId, pin, wireId = null) {
    const key = `V:${componentId}:${pin}`;
    if (state.probes.some((probe) => probe.key === key)) return;
    const component = state.circuit.components.find((item) => item.id === componentId);
    recordProbeEdit();
    state.probes.push({ key, kind: "voltage", componentId, pin, wireId, label: `V(${component?.props?.ref ?? componentId}.${pin + 1})`, color: nextAvailableProbeColor(PROBE_COLORS, state.probes) });
    refreshProbeViews();
    committed();
  }

  function addVoltageProbeEndpoint(endpoint, wireId = null) {
    if (endpoint.componentId !== undefined) return addVoltageProbe(endpoint.componentId, endpoint.pin, wireId);
    const junction = (state.circuit.junctions ?? []).find((item) => item.id === endpoint.junctionId);
    if (!junction) return;
    const key = `V:J:${junction.id}`;
    if (state.probes.some((probe) => probe.key === key)) return;
    recordProbeEdit();
    state.probes.push({ key, kind: "voltage", junctionId: junction.id, wireId, label: `V(${junction.id})`, color: nextAvailableProbeColor(PROBE_COLORS, state.probes) });
    refreshProbeViews();
    committed();
  }

  function addCurrentProbe(componentId, winding = 1) {
    const component = state.circuit.components.find((item) => item.id === componentId);
    if (!component || component.type === "GND") return;
    // Only the two magnetic parts carry a second winding current.
    const second = winding === 2 && isMagneticPart(component);
    const key = second ? `I:${componentId}:2` : `I:${componentId}`;
    if (state.probes.some((probe) => probe.key === key)) return;
    recordProbeEdit();
    state.probes.push({ key, kind: "current", componentId, ...(second ? { winding: 2 } : {}), label: currentProbeLabel(component, circuitGeometryVersion(state.circuit), second ? 2 : 1), color: nextAvailableProbeColor(PROBE_COLORS, state.probes) });
    refreshProbeViews();
    committed();
  }

  /**
   * Flip the shown reference direction of a part's (winding's) current. Display only, like a probe edit: one undo step and a save,
   * but no new generation, no stale result and no re-run; the probe label, scope sign, phasors and canvas arrow follow.
   */
  function flipCurrentReference(componentId, winding = 1) {
    const component = state.circuit.components.find((item) => item.id === componentId);
    if (!component || component.type === "GND" || (winding === 2 && !isMagneticPart(component))) return;
    recordProbeEdit();
    toggleCurrentReference(component, winding);
    refreshProbeViews();
    committed();
  }

  function removeProbe(key) {
    recordProbeEdit();
    state.probes = removeProbeByKey(state.probes, key);
    closeProbeContextMenu();
    refreshProbeViews();
    committed();
  }

  function undo() {
    if (!state.history.length || !confirmDiscardDrafts()) return;
    pushCapped(state.future, snapshot());
    restore(state.history.pop());
  }

  function redo() {
    if (!state.future.length || !confirmDiscardDrafts()) return;
    pushCapped(state.history, snapshot());
    restore(state.future.pop());
  }

  function bumpGeneration() {
    state.generation += 1;
  }

  /** Commit a finished drag: the pre-drag snapshot becomes one undo step. */
  function commitMove(before) {
    rememberIds();
    recordHistory(before);
    bumpGeneration();
    markStale();
    renderAll();
    scheduleAutoRun();
    committed();
  }

  return { currentConnections, snapshot, restore, mutate, bumpGeneration, commitMove, mutateGrouped, closeEditGroup, undo, redo, addVoltageProbe, addVoltageProbeEndpoint, addCurrentProbe, removeProbe, flipCurrentReference };
}
