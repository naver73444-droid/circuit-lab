import { CURRENT_GEOMETRY_VERSION, circuitGeometryVersion } from "./circuit-geometry.js";
import { classifyCircuitConnections, connectionFrequency } from "./circuit-status.js";
import { currentProbeLabel } from "./current-direction.js";
import { nextAvailableProbeColor, removeProbeByKey } from "./ui-model.js";

const HISTORY_LIMIT = 100;
export const PROBE_COLORS = ["#80bfff", "#f5bc79", "#c5a2f2", "#8ed4ad", "#ff969e", "#d7d783", "#83d2db", "#eea7d0"];

/** Editable project state. The shared state object also carries run results and pointer state owned by other modules. */
export function createEditorState() {
  return {
    circuit: { version: 1, geometryVersion: CURRENT_GEOMETRY_VERSION, components: [], wires: [], junctions: [] },
    settings: { analysis: "dc", start: "0", end: "5m", step: "10u", startFrequency: "10", endFrequency: "100k", pointsPerDecade: "30", phasorFrequency: "159.155" },
    title: "새 회로",
    subtitle: "빈 캔버스에서 시작하세요",
    selected: null,
    probes: [],
    history: [],
    future: [],
    learningId: null,
    generation: 0,
    intent: "auto",
    manualSettingKeys: new Set(),
  };
}

/**
 * The only path that edits the circuit: mutate() records history, applies the change, bumps the generation and
 * re-renders; restore()/undo()/redo() replay snapshots. Everything that reacts to a change is injected.
 */
export function createEditorSession(deps) {
  const { state, inputDrafts, synchronizeIntent, markStale, scheduleAutoRun, renderAll, resetProjectSession, refreshProbeViews, closeProbeContextMenu, confirmDiscardDrafts } = deps;
  let connectionCache = null;

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

  function recordProbeEdit() {
    pushCapped(state.history, snapshot());
    state.future = [];
  }

  function snapshot() {
    return JSON.stringify({ circuit: state.circuit, settings: state.settings, title: state.title, subtitle: state.subtitle, probes: state.probes, learningId: state.learningId, intent: state.intent, manualSettingKeys: [...state.manualSettingKeys] });
  }

  function restore(serialized) {
    const saved = JSON.parse(serialized);
    resetProjectSession();
    state.circuit = { ...saved.circuit, junctions: saved.circuit.junctions ?? [] };
    state.settings = saved.settings;
    state.title = saved.title;
    state.subtitle = saved.subtitle;
    state.probes = saved.probes ?? [];
    state.learningId = saved.learningId ?? null;
    state.intent = saved.intent ?? "manual";
    state.manualSettingKeys = new Set(saved.manualSettingKeys ?? []);
    synchronizeIntent();
    state.selected = null;
    state.pendingPin = null;
    state.pendingWaypoints = [];
    bumpGeneration();
    markStale();
    renderAll();
    scheduleAutoRun();
  }

  function mutate(change, { history = true, auto = true } = {}) {
    if (history) {
      pushCapped(state.history, snapshot());
      state.future = [];
    }
    change();
    inputDrafts.retainComponents(new Set(state.circuit.components.map((item) => item.id)));
    synchronizeIntent();
    bumpGeneration();
    markStale();
    renderAll();
    if (auto) scheduleAutoRun();
  }

  function addVoltageProbe(componentId, pin, wireId = null) {
    const key = `V:${componentId}:${pin}`;
    if (state.probes.some((probe) => probe.key === key)) return;
    const component = state.circuit.components.find((item) => item.id === componentId);
    recordProbeEdit();
    state.probes.push({ key, kind: "voltage", componentId, pin, wireId, label: `V(${component?.props?.ref ?? componentId}.${pin + 1})`, color: nextAvailableProbeColor(PROBE_COLORS, state.probes) });
    refreshProbeViews();
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
  }

  function addCurrentProbe(componentId) {
    const key = `I:${componentId}`;
    if (state.probes.some((probe) => probe.key === key)) return;
    const component = state.circuit.components.find((item) => item.id === componentId);
    if (!component || component.type === "GND") return;
    recordProbeEdit();
    state.probes.push({ key, kind: "current", componentId, label: currentProbeLabel(component, circuitGeometryVersion(state.circuit)), color: nextAvailableProbeColor(PROBE_COLORS, state.probes) });
    refreshProbeViews();
  }

  function removeProbe(key) {
    recordProbeEdit();
    state.probes = removeProbeByKey(state.probes, key);
    closeProbeContextMenu();
    refreshProbeViews();
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
    pushCapped(state.history, before);
    state.future = [];
    bumpGeneration();
    markStale();
    renderAll();
    scheduleAutoRun();
  }

  return { currentConnections, snapshot, restore, mutate, bumpGeneration, commitMove, undo, redo, addVoltageProbe, addVoltageProbeEndpoint, addCurrentProbe, removeProbe };
}
