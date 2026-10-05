import { parseValue } from "./circuit-engine.js";
import { examples } from "./examples.js";
import { createPhasorView } from "./phasor-view.js";
import { ScopeView } from "./scope-view.js";
import { initializeAppearance } from "./theme.js";
import { InputDrafts } from "./input-drafts.js";
import { createPanelController } from "./panel-controller.js";
import { initializePhasorPractice } from "./phasor-practice.js";
import { createLazyController, createWorkspaceTabs } from "./workspace-tabs.js";
import { initResponsiveEditor } from "./responsive-editor.js";
import { createEditorSession, createEditorState } from "./editor-session.js";
import { createCanvasRenderer } from "./canvas-renderer.js";
import { createAnalysisRunner, createRunState } from "./analysis-runner.js";
import { createInspector } from "./inspector.js";
import { createEditorInput, createInputState } from "./editor-input.js";
import { createProjectIO } from "./project-io.js";
import { createHoverReadout } from "./hover-readout.js";
import { hasShareHash } from "./share-url.js";
import { createFlowLayer } from "./flow-layer.js";
import { createMeasureView } from "./measure-view.js";
import { selectedItems, selectedKeys } from "./selection-model.js";

const elements = Object.fromEntries([
  "engine-status", "stale-badge", "run-button", "cancel-analysis-button", "palette-list", "circuit-canvas", "wire-layer", "component-layer", "overlay-layer", "flow-layer", "flow-toggle", "flow-hint", "empty-hint",
  "tool-hint", "circuit-count", "canvas-title", "canvas-subtitle", "selection-label", "inspector-content", "analysis-settings",
  "analysis-note", "error-box", "example-select", "undo-button", "redo-button", "rotate-button", "delete-button", "new-button", "save-button",
  "load-button", "file-input", "probe-list", "result-summary", "ac-view-toggle", "wave-plot", "plot-empty", "cursor-readout", "reset-view-button", "csv-button",
  "phasor-panel", "phasor-summary", "voltage-plane-unit", "current-plane-unit", "voltage-phasor-plot", "current-phasor-plot",
  "voltage-phasor-values", "current-phasor-values", "phasor-time-plot", "phasor-time-units", "impedance-learning",
  "clone-button", "zoom-out-button", "zoom-in-button", "fit-button", "inline-value-editor",
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
// Heavy workspace controllers (EM, circuit course, signals) load on first use.
let emLazy = null;
let circuitCourseLazy = null;
let signalsLazy = null;
let workspaceSeq = 0;
let circuitCourseActive = false;

function setStatus(text, kind = "ready") {
  elements["engine-status"].textContent = text;
  elements["engine-status"].className = `status-dot ${kind}`;
}
const showInspector = () => panels?.show("inspector");
const showCanvas = () => panels?.showCanvas();
const phasorPanelVisible = () => !panels || panels.isOpen("phasor");

// Modules are created in dependency order; calls that point back to a later module are wrapped in arrows.
const session = createEditorSession({
  state, inputDrafts, renderAll, resetProjectSession, refreshProbeViews,
  synchronizeIntent: () => analysis.synchronizeIntent(),
  markStale: () => analysis.markStale(),
  scheduleAutoRun: () => analysis.scheduleAutoRun(),
  closeProbeContextMenu: () => input.closeProbeContextMenu(),
  confirmDiscardDrafts: () => inspector.confirmDiscardDrafts(),
  onCommitted: () => projectIO.noteCommitted(),
});
const renderer = createCanvasRenderer({
  state, elements, workspace, currentConnections: session.currentConnections,
  afterCanvasRender: () => flow.refresh(),
  onDragFrame: () => flow.suspend(),
});
const flow = createFlowLayer({ state, elements, scopeView, wireRoutes: renderer.wireRoutes });
const analysis = createAnalysisRunner({
  state, elements, workspace, inputDrafts, scopeView, phasorView, renderAll, setStatus, showCanvas, phasorPanelVisible,
  mutate: session.mutate, currentConnections: session.currentConnections, bumpGeneration: session.bumpGeneration, removeProbe: session.removeProbe,
  renderCanvas: renderer.renderCanvas,
  setTool: (tool) => input.setTool(tool),
  commitPendingInputs: () => inspector.commitPendingInputs(),
  updateDraftNotice: (...args) => inspector.updateDraftNotice(...args),
  openProbeContextMenu: (...args) => input.openProbeContextMenu(...args),
  measureView,
});
const inspector = createInspector({
  state, elements, workspace, inputDrafts, phasorView, renderAll, setStatus, showInspector, isCircuitUiActive,
  mutate: session.mutate, currentConnections: session.currentConnections,
  synchronizeIntent: analysis.synchronizeIntent, cancelScheduledRun: analysis.cancelScheduledRun, markInputDirty: analysis.markInputDirty,
  scheduleAutoRun: analysis.scheduleAutoRun, renderPhasorLearning: analysis.renderPhasorLearning,
  runSweep: analysis.runSweep, clearSweep: analysis.clearSweep,
});
const hover = createHoverReadout({ state, elements, workspace, scopeView });
const input = createEditorInput({
  state, elements, workspace, scopeView, renderAll, renderSelection, setStatus, showInspector, showCanvas, isCircuitUiActive, hover,
  applySelection: renderer.applySelection, setMarquee: renderer.setMarquee,
  runAnalysis: () => analysis.runAnalysis(), saveProject: () => projectIO.saveProject(),
  mutate: session.mutate, mutateGrouped: session.mutateGrouped, closeEditGroup: session.closeEditGroup, snapshot: session.snapshot, commitMove: session.commitMove, undo: session.undo, redo: session.redo,
  addVoltageProbe: session.addVoltageProbe, addVoltageProbeEndpoint: session.addVoltageProbeEndpoint, addCurrentProbe: session.addCurrentProbe, removeProbe: session.removeProbe,
  renderCanvas: renderer.renderCanvas, renderOverlay: renderer.renderOverlay, scheduleDragUpdate: renderer.scheduleDragUpdate, scheduleOverlayRender: renderer.scheduleOverlayRender,
  updateCanvasView: renderer.updateCanvasView, endpointPosition: renderer.endpointPosition, pinPosition: renderer.pinPosition, routeForWireId: renderer.routeForWireId,
  renderInspector: inspector.renderInspector, openInlineEditor: inspector.openInlineEditor, closeInlineEditor: inspector.closeInlineEditor,
  assignPortEndpoint: analysis.assignPortEndpoint, presentProbe: analysis.presentProbe,
});
const projectIO = createProjectIO({
  state, elements, resetProjectSession, setStatus,
  mutate: session.mutate, confirmDiscardDrafts: inspector.confirmDiscardDrafts, commitPendingInputs: inspector.commitPendingInputs,
  setTool: input.setTool, fitCanvas: input.fitCanvas, seriesForProbes: analysis.seriesForProbes,
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
  state.result = null;
  state.phasorResult = null;
  state.stale = false;
  state.cursorIndex = null;
  state.runState = { status: "not-run", analysis: null, generation: null, error: null };
  state.port = { mode: null, p: null, n: null, loadIds: [], result: null, stale: false, error: null };
  elements["error-box"].classList.add("hidden");
  analysis.updateAnalysisControls();
  input.closeProbeContextMenu();
  scopeView.resetForProject();
  setStatus("해석 준비", "ready");
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
  elements["stale-badge"].classList.toggle("hidden", !(state.stale || state.runState.status === "stale"));
  analysis.updateAnalysisControls();
}

function updateCircuitCourseTop(){
  document.getElementById('circuit-course-shell').style.setProperty('--circuit-course-top',document.querySelector('.topbar').getBoundingClientRect().bottom+'px');
}
function activateCircuitCourse(){
  const seq=++workspaceSeq;
  circuitCourseLazy.whenReady(course=>{if(seq===workspaceSeq&&circuitCourseActive&&workspaceTabs.active==='circuit')course.activate();});
}
function activateLazyWorkspace(lazy,name){
  const seq=++workspaceSeq;
  lazy.whenReady(controller=>{if(seq===workspaceSeq&&workspaceTabs.active===name)controller.activate();});
}
function showCircuitCourse(value){
  workspace.switching=true;
  input.cancelInteractions();panels.cancelInteractions();
  circuitCourseActive=value;workspace.circuitActive=!value;document.body.dataset.circuitExperience=value?'course':'editor';
  const workbench=document.getElementById('workbench'),shell=document.getElementById('circuit-course-shell');
  workbench.hidden=value;workbench.inert=value;shell.hidden=!value;shell.inert=!value;
  workspaceSeq++;
  if(value){updateCircuitCourseTop();activateCircuitCourse();}
  else{circuitCourseLazy.controller?.deactivate();panels.synchronize();if(workspace.renderDeferred)renderAll();else{renderer.updateCanvasView();scopeView.render();analysis.renderPhasorLearning();}}
  queueMicrotask(()=>{workspace.switching=false;});
}

function setupEvents() {
  document.getElementById('circuit-course-open').addEventListener('pointerdown',event=>{event.preventDefault();});
  document.getElementById('circuit-course-open').addEventListener('click',()=>showCircuitCourse(true));
  for(const type of ['pointerenter','focus'])document.getElementById('circuit-course-open').addEventListener(type,()=>circuitCourseLazy.prefetch());
  document.getElementById('circuit-course-back').addEventListener('click',()=>showCircuitCourse(false));
  window.addEventListener('resize',()=>{if(circuitCourseActive&&workspaceTabs.active==='circuit')updateCircuitCourseTop();});
  initResponsiveEditor(document, window);
  // The help card is a popover: Escape or an outside click closes it.
  const help = document.getElementById("interaction-help");
  document.addEventListener("click", (event) => { if (help.open && !help.contains(event.target)) help.open = false; });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && help.open) { help.open = false; help.querySelector("summary").focus(); } });
  inspector.attach();
  input.attach();
  hover.attach();
  analysis.attach();
  projectIO.attach();
}

// Warm the lazy workspace modules once the page is idle so the first tab click
// is instant. Skipped on Save-Data connections.
function scheduleWorkspacePrefetch(lazies) {
  if (navigator.connection?.saveData) return;
  const warm = () => { for (const lazy of lazies) lazy.prefetch(); };
  const whenIdle = () => (typeof requestIdleCallback === "function" ? requestIdleCallback(warm, { timeout: 4000 }) : setTimeout(warm, 0));
  const start = () => setTimeout(whenIdle, 1500);
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
  emLazy = createLazyController({ host: document.getElementById("em-workspace"), load: (retry) => import("./em-controller.js" + retry), create: (module, host) => module.createEMController(host) });
  circuitCourseLazy = createLazyController({ host: document.getElementById("circuit-course-host"), load: (retry) => import("./circuit-course-controller.js" + retry), create: (module, host) => module.createCircuitCourseController(host) });
  signalsLazy = createLazyController({ host: document.getElementById("signals-workspace"), load: (retry) => import("./signals-course-controller.js" + retry), create: (module, host) => module.createSignalsCourseController(host) });
  const lazyWorkspaces = { em: emLazy, signals: signalsLazy, circuitCourse: circuitCourseLazy };
  const requestedWorkspace = new URLSearchParams(location.search).get("workspace");
  const startupWorkspace = ["em", "signals"].includes(requestedWorkspace) ? requestedWorkspace : document.querySelector('[data-workspace-tab][aria-selected="true"]')?.dataset.workspaceTab;
  lazyWorkspaces[startupWorkspace]?.prefetch();
  workspaceTabs = createWorkspaceTabs({
    onBeforeChange: (from) => {
      workspace.switching = true;
      if (from === "circuit") {
        circuitCourseLazy.controller?.deactivate();document.getElementById('circuit-course-shell').hidden=true;document.getElementById('circuit-course-shell').inert=true;
        input.cancelInteractions();
        panels.cancelInteractions();
        workspace.circuitActive = false;
        panels.synchronize();
      } else if (from === "em") emLazy.controller?.deactivate();
      else if (from === "signals") signalsLazy.controller?.deactivate();
    },
    onIntent: (name) => lazyWorkspaces[name]?.prefetch(),
    onChange: (name) => {
      if (name === "em") activateLazyWorkspace(emLazy, "em");
      else if (name === "signals") activateLazyWorkspace(signalsLazy, "signals");
      else if(circuitCourseActive){
        workspace.circuitActive=false;const workbench=document.getElementById('workbench'),shell=document.getElementById('circuit-course-shell');
        workbench.hidden=true;workbench.inert=true;shell.hidden=false;shell.inert=false;
        updateCircuitCourseTop();activateCircuitCourse();
      } else {
        workspaceSeq++;
        workspace.circuitActive = true;
        panels.synchronize();
        if (workspace.renderDeferred) renderAll(); else { renderer.updateCanvasView(); scopeView.render(); }
      }
      queueMicrotask(() => { workspace.switching = false; });
    },
  });
  initializePhasorPractice();
  setupEvents();
  input.setTool("select");
  analysis.synchronizeIntent();
  renderAll();
  setStatus("해석 준비", "ready");
  window.__CIRCUIT_LAB__ = {
    getState: () => structuredClone({ selected: state.selected, selection: [...selectedKeys(state)], tool: state.tool, pendingPin: state.pendingPin, historyDepth: state.history.length, circuit: state.circuit, settings: state.settings, probes: state.probes, stale: state.stale, result: state.result, phasorResult: state.phasorResult, port: state.port, learningId: state.learningId, generation: state.generation, lastRunMs: state.lastRunMs, runState: state.runState, pointerOwnerId: state.pointerOwnerId, drag: state.drag, canvasView: state.canvasView, intent: state.intent, autoUpdate: state.autoUpdate, scope: scopeView.inspect(), drafts: inputDrafts.entries() }),
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
    getWorkspace: () => workspaceTabs.active,
    // Lazy controllers report null until loaded; await ensureWorkspace(name) first.
    getEMState: () => emLazy.controller?.inspect() ?? null,
    getCircuitCourseState: () => circuitCourseLazy.controller?.inspect() ?? null,
    getSignalsCourseState: () => signalsLazy.controller?.inspect() ?? null,
    ensureWorkspace: (name) => {
      const key = name === "circuit-course" ? "circuitCourse" : name;
      return lazyWorkspaces[key] ? lazyWorkspaces[key].ensure() : Promise.resolve(null);
    },
    activateWorkspace: (name) => workspaceTabs.activate(name, false),
  };
  if (["em", "signals"].includes(requestedWorkspace)) workspaceTabs.activate(requestedWorkspace, false);
  scheduleWorkspacePrefetch([emLazy, circuitCourseLazy, signalsLazy]);
  const query = new URLSearchParams(location.search);
  const exampleId = query.get("example");
  const exampleRequested = Boolean(exampleId && examples.some((example) => example.id === exampleId));
  // Every launch parameter is registered for cleanup (first edit or any explicit project replacement), whichever source won.
  projectIO.registerLaunch({ example: query.has("example"), run: query.has("run"), hash: hasShareHash(location.hash) });
  if (hasShareHash(location.hash)) {
    // A share link wins over ?example and over the restore offer; a link that cannot be opened falls back to the restore offer.
    projectIO.openShareHash(location.hash).then((opened) => { if (!opened) projectIO.offerRestore(); });
  } else if (exampleRequested) {
    projectIO.loadExample(exampleId, { silent: true });
  } else {
    projectIO.offerRestore();
  }
  if (query.get("run") === "1") setTimeout(analysis.runAnalysis, 0);
}

initialize();
