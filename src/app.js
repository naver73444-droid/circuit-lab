import { parseValue } from "./circuit-engine.js";
import { examples } from "./examples.js";
import { createPhasorView } from "./phasor-view.js";
import { ScopeView } from "./scope-view.js";
import { initializeAppearance } from "./theme.js";
import { InputDrafts } from "./input-drafts.js";
import { createPanelController } from "./panel-controller.js";
import { initializePhasorPractice } from "./phasor-practice.js";
import { createLazyController, createWorkspaceTabs } from "./workspace-tabs.js";
import { WORKSPACE_MODULES } from "./module-preload-map.js";
import { initResponsiveEditor } from "./responsive-editor.js";
import { createEditorSession, createEditorState } from "./editor-session.js";
import { createCanvasRenderer } from "./canvas-renderer.js";
import { createAnalysisRunner, createRunState } from "./analysis-runner.js";
import { createInspector } from "./inspector.js";
import { createEditorInput, createInputState } from "./editor-input.js";
import { createProjectIO } from "./project-io.js";
import { createHoverReadout } from "./hover-readout.js";
import { normalizeAcBasis } from "./ac-basis.js";
import { hasShareHash } from "./share-url.js";
import { createFlowLayer } from "./flow-layer.js";
import { createMeasureView } from "./measure-view.js";
import { selectedItems, selectedKeys } from "./selection-model.js";
import { createValueSheet } from "./value-sheet.js";
import { installViewportGuard } from "./viewport-guard.js";
import { createCanvasActions } from "./canvas-actions.js";

const elements = Object.fromEntries([
  "engine-status", "stale-badge", "run-button", "cancel-analysis-button", "palette-list", "circuit-canvas", "wire-layer", "component-layer", "overlay-layer", "flow-layer", "flow-toggle", "flow-hint", "empty-hint",
  "tool-hint", "circuit-count", "canvas-title", "canvas-subtitle", "selection-label", "inspector-content", "analysis-settings",
  "analysis-note", "error-box", "example-select", "undo-button", "redo-button", "rotate-button", "delete-button", "new-button", "save-button",
  "load-button", "file-input", "probe-list", "result-summary", "ac-view-toggle", "wave-plot", "plot-empty", "cursor-readout", "reset-view-button", "csv-button",
  "phasor-panel", "phasor-summary", "voltage-plane-unit", "current-plane-unit", "voltage-phasor-plot", "current-phasor-plot",
  "voltage-phasor-values", "current-phasor-values", "phasor-time-plot", "phasor-time-units", "impedance-learning",
  "clone-button", "tidy-wires-button", "zoom-out-button", "zoom-in-button", "fit-button", "inline-value-editor",
  "connection-summary", "probe-context-menu", "phasor-validity", "small-signal-note",
  "scope-controls", "analysis-intent", "analysis-recommendation", "auto-update", "advanced-analysis",
  "share-button", "canvas-notices", "hover-tip", "marquee-rect",
  "measure-panel", "measure-summary", "measure-body", "cursor-b-button",
  "port-panel", "port-p-button", "port-n-button", "port-load-button", "port-clear-button", "port-run-button", "port-selection", "port-loads", "port-result", "port-status",
].map((id) => [id, document.getElementById(id)]));

// One shared state object; each module owns the slice its factory creates (see the create*State functions).
const state = { ...createEditorState(), ...createInputState(), ...createRunState(), inlineEdit: null /* inspector */ };

// Workspace flags read by the circuit modules. While the circuit workspace is hidden, renders are deferred until it returns.
const workspace = { circuitActive: true, switching: false, discardingDrafts: false, renderDeferred: false };
const isCircuitUiActive = () => workspace.circuitActive && !workspace.switching && !workspace.discardingDrafts;

const inputDrafts = new InputDrafts();
const phasorView = createPhasorView(elements, state, parseValue, () => inputDrafts.size > 0);
const scopeView = new ScopeView(elements["wave-plot"], elements["scope-controls"], elements["cursor-readout"]);
const measureView = createMeasureView({ panel: elements["measure-panel"], summary: elements["measure-summary"], body: elements["measure-body"], bButton: elements["cursor-b-button"], scopeView });
let panels = null;
let workspaceTabs = null;
let canvasActions = null; // phone selection bar + part strip, created once the editor input exists
// Heavy workspace controllers (EM, circuit course, signals) load on first use.
let emLazy = null;
let circuitCourseLazy = null;
let signalsLazy = null;
let workspaceSeq = 0;

function setStatus(text, kind = "ready") {
  elements["engine-status"].textContent = text;
  elements["engine-status"].className = `status-dot ${kind}`;
}
const showInspector = () => panels?.show("inspector");
const showCanvas = () => panels?.showCanvas();
const phasorPanelVisible = () => !panels || panels.isOpen("phasor");

// Modules are created in dependency order; calls that point back to a later module are wrapped in arrows.
const session = createEditorSession({
  state, inputDrafts, renderAll, resetProjectSession, beforeHistoryRestore, afterHistoryRestore, refreshProbeViews,
  beforeProjectBoundary: () => projectIO.retireForBoundary(),
  synchronizeIntent: () => analysis.synchronizeIntent(),
  markStale: () => analysis.markStale(),
  scheduleAutoRun: () => analysis.scheduleAutoRun(),
  closeProbeContextMenu: () => input.closeProbeContextMenu(),
  confirmDiscardDrafts: () => inspector.confirmDiscardDrafts(),
  onCommitted: () => projectIO.noteCommitted(),
  onPendingWireDropped: () => input.restoreToolHint(),
});
const renderer = createCanvasRenderer({
  state, elements, workspace, scopeView, currentConnections: session.currentConnections,
  afterCanvasRender: () => { flow.refresh(); canvasActions?.schedule(); },
  onDragFrame: () => { flow.suspend(); canvasActions?.schedule(); },
  onViewChange: () => canvasActions?.schedule(),
});
const flow = createFlowLayer({ state, elements, scopeView, wireRoutes: renderer.wireRoutes });
// Probe arrows show the real direction at the scope cursor time in a transient run, so they follow the cursor (one frame per move).
scopeView.subscribe((type) => { if (type === "cursor") renderer.refreshCurrentArrows(); });
const analysis = createAnalysisRunner({
  state, elements, workspace, inputDrafts, scopeView, phasorView, renderAll, setStatus, showCanvas, phasorPanelVisible,
  mutate: session.mutate, currentConnections: session.currentConnections, bumpGeneration: session.bumpGeneration, removeProbe: session.removeProbe,
  renderCanvas: renderer.renderCanvas,
  setTool: (tool) => input.setTool(tool),
  commitPendingInputs: () => inspector.commitPendingInputs(),
  updateDraftNotice: (...args) => inspector.updateDraftNotice(...args),
  openProbeContextMenu: (...args) => input.openProbeContextMenu(...args),
  measureView,
  onStaleChange: () => { flow.refresh(); renderer.refreshCurrentArrows(); },
});
const inspector = createInspector({
  state, elements, workspace, inputDrafts, phasorView, renderAll, setStatus, showInspector, isCircuitUiActive,
  mutate: session.mutate, currentConnections: session.currentConnections,
  synchronizeIntent: analysis.synchronizeIntent, cancelScheduledRun: analysis.cancelScheduledRun, markInputDirty: analysis.markInputDirty,
  scheduleAutoRun: analysis.scheduleAutoRun, renderPhasorLearning: analysis.renderPhasorLearning,
  runSweep: analysis.runSweep, clearSweep: analysis.clearSweep,
  flipCurrentReference: (...args) => { session.flipCurrentReference(...args); hover.refresh(); },
});
const hover = createHoverReadout({ state, elements, workspace, scopeView });
const valueSheet = createValueSheet({
  state, inputDrafts, isCircuitUiActive, setStatus, showInspector,
  mutateGrouped: session.mutateGrouped, closeEditGroup: session.closeEditGroup, updateCanvasView: () => renderer.updateCanvasView(),
});
const input = createEditorInput({
  state, elements, workspace, scopeView, renderAll, renderSelection, setStatus, showInspector, showCanvas, isCircuitUiActive, hover,
  openValueSheet: (id) => valueSheet.openFor(id),
  armSelectionBar: () => canvasActions?.arm(),
  applySelection: renderer.applySelection, setMarquee: renderer.setMarquee,
  runAnalysis: () => analysis.runAnalysis(), saveProject: () => projectIO.saveProject(),
  mutate: session.mutate, mutateGrouped: session.mutateGrouped, closeEditGroup: session.closeEditGroup, snapshot: session.snapshot, commitMove: session.commitMove, undo: session.undo, redo: session.redo,
  addVoltageProbe: session.addVoltageProbe, addVoltageProbeEndpoint: session.addVoltageProbeEndpoint, addCurrentProbe: session.addCurrentProbe, removeProbe: session.removeProbe,
  renderCanvas: renderer.renderCanvas, renderOverlay: renderer.renderOverlay, scheduleDragUpdate: renderer.scheduleDragUpdate, cancelDragUpdate: renderer.cancelDragUpdate, scheduleOverlayRender: renderer.scheduleOverlayRender,
  updateCanvasView: renderer.updateCanvasView, endpointPosition: renderer.endpointPosition, pinPosition: renderer.pinPosition, routeForWireId: renderer.routeForWireId,
  renderInspector: inspector.renderInspector, openInlineEditor: inspector.openInlineEditor, closeInlineEditor: inspector.closeInlineEditor,
  assignPortEndpoint: analysis.assignPortEndpoint, presentProbe: analysis.presentProbe, reconcileAnalysis: analysis.reconcileWithCircuit,
});
// Phone: actions over the selected part and the part strip while placing (canvas-actions.js).
canvasActions = createCanvasActions({
  state, isCircuitUiActive, wrap: document.getElementById("canvas-wrap"), canvas: elements["circuit-canvas"],
  commands: { ...input.barCommands, editValue: (id) => { if (!valueSheet.openFor(id)) showInspector(); } },
});
const projectIO = createProjectIO({
  state, elements, resetProjectSession, setStatus,
  mutate: session.mutate, confirmDiscardDrafts: inspector.confirmDiscardDrafts, commitPendingInputs: inspector.commitPendingInputs,
  setTool: input.setTool, fitCanvas: input.fitCanvas, seriesForProbes: analysis.seriesForProbes,
  showCircuitWorkspace: () => showCircuitWorkspace(),
});

/** Clear everything tied to the previous project: pending runs, gestures, drafts, selection, results and port state. */
function resetProjectSession() {
  analysis.cancelScheduledRun();
  analysis.invalidateActiveAnalysis("project-reset");
  analysis.resetSweep();
  measureView.clear();
  state.runSerial += 1;
  input.cancelPointerSessions();
  inputDrafts.clear();
  state.inlineEdit = null;
  elements["inline-value-editor"].classList.add("hidden");
  elements["inline-value-editor"].classList.remove("input-invalid", "input-editing");
  state.selected = null;
  state.selection = new Set();
  state.pendingPin = null;
  state.pendingWaypoints = [];
  state.pointer = null;
  input.restoreToolHint();
  state.result = null;
  state.phasorResult = null;
  state.stale = false;
  state.runState = { status: "not-run", analysis: null, generation: null, error: null };
  state.port = { mode: null, p: null, n: null, loadIds: [], result: null, stale: false, error: null };
  elements["error-box"].classList.add("hidden");
  analysis.updateAnalysisControls();
  input.closeProbeContextMenu();
  scopeView.resetForProject();
  flow.refresh();
  setStatus("해석 준비", "ready");
}

/**
 * Undo/redo inside one project: only what the replay really invalidates is dropped. The in-flight run is cancelled (its result would
 * describe the circuit being left) and drafts/gestures end; the finished result stays, marked stale by the session, and the scope
 * zoom and cursors, the port selection and the sweep form survive.
 */
function beforeHistoryRestore() {
  analysis.cancelScheduledRun();
  analysis.invalidateActiveAnalysis("history-restore");
  state.runSerial += 1;
  input.cancelPointerSessions();
  inputDrafts.clear();
  state.inlineEdit = null;
  elements["inline-value-editor"].classList.add("hidden");
  elements["inline-value-editor"].classList.remove("input-invalid", "input-editing");
  input.closeProbeContextMenu();
}

/** The replayed circuit may lack parts the port selection or sweep form point at. */
function afterHistoryRestore() {
  analysis.reconcileWithCircuit();
  input.restoreToolHint();
}

function updateHistoryButtons() {
  elements["undo-button"].disabled = state.history.length === 0;
  elements["redo-button"].disabled = state.future.length === 0;
}

/** Probe edits redraw only what shows probes; they do not invalidate results. */
function refreshProbeViews() {
  renderer.renderCanvas();
  analysis.renderProbes();
  analysis.renderPlot();
  analysis.renderPhasorLearning();
  updateHistoryButtons();
}

/** Selection changed: toggle the canvas classes (no rebuild) and refresh only what depends on the selection. */
function renderSelection() {
  if (!workspace.circuitActive) { workspace.renderDeferred = true; return; }
  renderer.applySelection();
  inspector.renderInspector();
  analysis.renderPhasorLearning();
  analysis.renderPortPanel();
  syncSelectionButtons();
  hover.refresh();
  valueSheet.sync();
  canvasActions?.schedule();
}

function syncSelectionButtons() {
  const items = selectedItems(state);
  const hasComponent = items.some((item) => item.kind === "component");
  elements["rotate-button"].disabled = !hasComponent;
  elements["clone-button"].disabled = !hasComponent;
  elements["delete-button"].disabled = items.length === 0;
}

function renderAll() {
  if (!workspace.circuitActive) { workspace.renderDeferred = true; return; }
  workspace.renderDeferred = false;
  inspector.updateDraftNotice(false);
  renderer.renderCanvas();
  inspector.renderInspector();
  inspector.renderAnalysisSettings();
  analysis.renderProbes();
  analysis.renderPlot();
  analysis.renderPhasorLearning();
  analysis.renderPortPanel();
  if (state.runState.status === "error" && state.runState.error) analysis.renderFailureDiagnostic(state.runState.error);
  updateHistoryButtons();
  syncSelectionButtons();
  hover.refresh();
  valueSheet.sync();
  elements["stale-badge"].classList.toggle("hidden", !(state.stale || state.runState.status === "stale"));
  analysis.updateAnalysisControls();
}

function activateLazyWorkspace(lazy, name) {
  const seq = ++workspaceSeq;
  lazy.whenReady((controller) => { if (seq === workspaceSeq && workspaceTabs.active === name) controller.activate(); });
}

/** Bring the circuit editor to the front (a share link opened into a tab that was on another workspace). */
function showCircuitWorkspace() {
  if (workspaceTabs.active !== "circuit") workspaceTabs.activate("circuit", false);
}

function setupEvents() {
  document.getElementById("circuit-course-back").addEventListener("click", () => workspaceTabs.activate("circuit"));
  initResponsiveEditor(document, window);
  installViewportGuard(window, document);
  // The help card is a popover: Escape or an outside click closes it.
  const help = document.getElementById("interaction-help");
  document.addEventListener("click", (event) => { if (help.open && !help.contains(event.target)) help.open = false; });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && help.open) { help.open = false; help.querySelector("summary").focus(); } });
  // AC display basis (peak | rms): one switch in the phasor panel header; read-outs, the phasor panel, the CSV and the source hint follow state.acBasis.
  document.addEventListener("click", (event) => {
    const button = event.target.closest?.("[data-ac-basis]");
    if (!button) return;
    const next = normalizeAcBasis(button.dataset.acBasis);
    if (next === state.acBasis) return;
    state.acBasis = next;
    renderAll();
  });
  inspector.attach();
  input.attach();
  hover.attach();
  analysis.attach();
  projectIO.attach();
}

// Warm the lazy workspace modules once the page is idle so the first tab click
// is instant: right after load only the downloads start (modulepreload, no script
// runs), and 1.5 s later the modules are imported. Skipped on Save-Data connections.
function scheduleWorkspacePrefetch(lazies) {
  if (navigator.connection?.saveData) return;
  const idle = (run, timeout) => (typeof requestIdleCallback === "function" ? requestIdleCallback(run, { timeout }) : setTimeout(run, 0));
  const download = () => { for (const lazy of lazies) lazy.preload(); };
  const warm = () => { for (const lazy of lazies) lazy.prefetch(); };
  const start = () => { idle(download, 1000); setTimeout(() => idle(warm, 4000), 1500); };
  if (document.readyState === "complete") start(); else window.addEventListener("load", start, { once: true });
}

function initialize() {
  initializeAppearance(document.getElementById("appearance"), () => {
    renderer.renderCanvas(); analysis.renderProbes(); analysis.renderPhasorLearning(); scopeView.render();
  });
  input.renderPalette();
  elements["example-select"].innerHTML += examples.map((example) => `<option value="${example.id}">${example.name}</option>`).join("");
  panels = createPanelController({
    beforeChange: () => input.cancelInteractions(),
    onChange: () => { if (workspace.circuitActive) { renderer.updateCanvasView(); scopeView.render(); analysis.renderPhasorLearning(); } },
    isActive: () => workspace.circuitActive,
  });
  emLazy = createLazyController({
    host: document.getElementById("em-workspace"),
    load: (retry) => import("./em-controller.js" + retry), modules: WORKSPACE_MODULES.em,
    create: (module, host) => module.createEMController(host),
  });
  circuitCourseLazy = createLazyController({
    host: document.getElementById("circuit-course-host"),
    load: (retry) => import("./circuit-course-controller.js" + retry), modules: WORKSPACE_MODULES["circuit-course"],
    create: (module, host) => module.createCircuitCourseController(host),
  });
  signalsLazy = createLazyController({
    host: document.getElementById("signals-workspace"),
    load: (retry) => import("./signals-course-controller.js" + retry), modules: WORKSPACE_MODULES.signals,
    create: (module, host) => module.createSignalsCourseController(host),
  });
  const lazyWorkspaces = { em: emLazy, signals: signalsLazy, "circuit-course": circuitCourseLazy };
  const requestedWorkspace = new URLSearchParams(location.search).get("workspace");
  const startupWorkspace = Object.hasOwn(lazyWorkspaces, requestedWorkspace) ? requestedWorkspace : document.querySelector('[data-workspace-tab][aria-selected="true"]')?.dataset.workspaceTab;
  lazyWorkspaces[startupWorkspace]?.prefetch();
  workspaceTabs = createWorkspaceTabs({
    onBeforeChange: (from) => {
      workspace.switching = true;
      if (from === "circuit") {
        input.cancelInteractions();
        panels.cancelInteractions();
        workspace.circuitActive = false;
        panels.synchronize();
        valueSheet.sync();
      } else lazyWorkspaces[from]?.controller?.deactivate();
    },
    onIntent: (name) => lazyWorkspaces[name]?.prefetch(),
    onChange: (name) => {
      if (Object.hasOwn(lazyWorkspaces, name)) activateLazyWorkspace(lazyWorkspaces[name], name);
      else {
        workspaceSeq++;
        workspace.circuitActive = true;
        panels.synchronize();
        if (workspace.renderDeferred) renderAll(); else { renderer.updateCanvasView(); scopeView.render(); }
      }
      queueMicrotask(() => { workspace.switching = false; valueSheet.sync(); });
    },
  });
  initializePhasorPractice();
  setupEvents();
  input.setTool("select");
  analysis.synchronizeIntent();
  renderAll();
  setStatus("해석 준비", "ready");
  window.__CIRCUIT_LAB__ = {
    getState: () => structuredClone({ projectId: state.projectId, selected: state.selected, selection: [...selectedKeys(state)], tool: state.tool, pendingPin: state.pendingPin, historyDepth: state.history.length, circuit: state.circuit, settings: state.settings, acBasis: state.acBasis, probes: state.probes, stale: state.stale, result: state.result, phasorResult: state.phasorResult, port: state.port, learningId: state.learningId, generation: state.generation, lastRunMs: state.lastRunMs, runState: state.runState, pointerOwnerId: state.pointerOwnerId, drag: state.drag, canvasView: state.canvasView, intent: state.intent, autoUpdate: state.autoUpdate, scope: scopeView.inspect(), drafts: inputDrafts.entries() }),
    loadExample: projectIO.loadExample,
    runAnalysis: analysis.runAnalysis,
    runPortAnalysis: analysis.runPortAnalysis,
    flushAutosave: projectIO.flushAutosave,
    getAutosaveStatus: projectIO.autosaveStatus,
    getHoverReadout: hover.inspect,
    getSweep: () => { const v = analysis.sweepView(); return { running: state.sweep.running, progress: state.sweep.progress, message: state.sweep.message, overlay: v ? { probe: v.overlay.probe.label, labels: v.overlay.plan.values.map((x) => x.label), series: v.merged.series.map((x) => ({ key: x.key, label: x.label, color: x.color, sweepText: x.sweepText, n: x.values.length })) } : null }; },
    getMeasure: () => measureView.inspect(),
    getCanvasStats: () => ({ ...renderer.stats }),
    forceCanvasRender: () => renderer.renderCanvas(),
    getFlow: () => flow.inspect(),
    setFlow: (value) => flow.setEnabled(value),
    getLayout: () => panels.inspect(),
    getValueSheet: () => valueSheet.inspect(),
    getCanvasActions: () => canvasActions.inspect(),
    getWorkspace: () => workspaceTabs.active,
    // Lazy controllers report null until loaded; await ensureWorkspace(name) first.
    getEMState: () => emLazy.controller?.inspect() ?? null,
    getCircuitCourseState: () => circuitCourseLazy.controller?.inspect() ?? null,
    getSignalsCourseState: () => signalsLazy.controller?.inspect() ?? null,
    ensureWorkspace: (name) => (Object.hasOwn(lazyWorkspaces, name) ? lazyWorkspaces[name].ensure() : Promise.resolve(null)),
    activateWorkspace: (name) => workspaceTabs.activate(name, false),
  };
  if (Object.hasOwn(lazyWorkspaces, requestedWorkspace)) workspaceTabs.activate(requestedWorkspace, false);
  scheduleWorkspacePrefetch([emLazy, circuitCourseLazy, signalsLazy]);
  const query = new URLSearchParams(location.search);
  const exampleId = query.get("example");
  const exampleRequested = Boolean(exampleId && examples.some((example) => example.id === exampleId));
  // Every launch parameter is registered for cleanup (first edit or any explicit project replacement), whichever source won.
  projectIO.registerLaunch({ example: query.has("example"), run: query.has("run"), hash: hasShareHash(location.hash) });
  if (hasShareHash(location.hash)) {
    // A share link wins over ?example and over the restore offer; a link that cannot be opened falls back to the restore offer.
    projectIO.openShareHash(location.hash).then((opened) => { if (opened === false) projectIO.offerRestore(); }); // null: a newer link took over
  } else if (exampleRequested) {
    projectIO.loadExample(exampleId, { silent: true });
  } else {
    projectIO.offerRestore();
  }
  if (query.get("run") === "1") setTimeout(analysis.runAnalysis, 0);
}

initialize();
