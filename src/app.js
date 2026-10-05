import { createSignalsCourseController } from './signals-course-controller.js';
import { createCircuitCourseController } from './circuit-course-controller.js';
import { refreshInvalidatedPortPanel } from "./port-ui-state.js";
export { refreshInvalidatedPortPanel } from "./port-ui-state.js";
import {
  CircuitError,
  componentDefaults,
  pinCount,
  parseValue,
} from "./circuit-engine.js";
import { cloneExample, examples } from "./examples.js";
import { acMagnitudeLevel, acPhaseDegrees } from "./measurement-format.js";
import { currentDisplayScale } from "./plot-format.js";
import { deserializeProject, serializeProject } from "./project-format.js";
import { buildResultsCSV } from "./csv-format.js";
import {
  acceptsRunGeneration,
  classifyNumericInput,
  cloneComponentSet,
  deleteJunctionFromCircuit,
  deleteComponentFromCircuit,
  endpointKey,
  endpointsEqual,
  retargetWireProbes,
  splitWireAtJunction,
} from "./circuit-edit.js";
import { createPhasorView } from "./phasor-view.js";
import {
  CURRENT_GEOMETRY_VERSION,
  appendFixedWaypoint,
  circuitGeometryVersion,
  localPin as geometryLocalPin,
  normalizePoints,
  orthogonalLeg,
  pinPosition as geometryPinPosition,
  polylinePath,
  routeWirePoints,
  snapPoint,
} from "./circuit-geometry.js";
import { classifyCircuitConnections, connectionFrequency } from "./circuit-status.js";
import { controlReferenceModel, controlledSourceInputModel, formatPortResult, nextAvailableProbeColor, passiveSliderModel, probeKeysForTarget, removeProbeByKey, sourceInlineDescriptor } from "./ui-model.js";
import { AnalysisCancelledError, AnalysisWorkerClient } from "./analysis-worker-client.js";
import { describeCircuitFailure, resultAvailabilityText, runStateLabel } from "./analysis-diagnostics.js";
import { beginPointerSession, finishPointerSession, ownsPointer } from "./pointer-session.js";
import { ScopeView } from "./scope-view.js";
import { engineering } from "./scope-model.js";
import { advanceCursorPointerSession, isTapGesture } from "./cursor-label-model.js";
import { escapeHtml } from "./safe-dom.js";
import { suggestAnalysis } from "./analysis-policy.js";
import { initializeAppearance } from "./theme.js";
import { traceColor } from "./trace-color.js";
import { InputDrafts } from "./input-drafts.js";
import { passedDragSlop, nearestScreenTarget, CANVAS_VIEW_MIN_WIDTH, CANVAS_VIEW_MAX_WIDTH } from "./interaction-math.js";
import { installCanvasTouch } from "./canvas-touch.js";
import { createPanelController } from "./panel-controller.js";
import { distanceToSegment } from "./touch-targets.js";
import { initializePhasorPractice } from "./phasor-practice.js";
import { currentArrowGeometry, currentDirectionDescriptor, currentDirectionGuide, currentProbeLabel } from "./current-direction.js";
import { createWorkspaceTabs } from "./workspace-tabs.js";
import { createEMController } from "./em-controller.js";

const COLORS = ["#80bfff", "#f5bc79", "#c5a2f2", "#8ed4ad", "#ff969e", "#d7d783", "#83d2db", "#eea7d0"];
const PALETTE = [
  ["R", "R", "저항"], ["C", "C", "커패시터"], ["L", "L", "인덕터"], ["GND", "⏚", "접지"],
  ["V", "V±", "전압원"], ["I", "I↑", "전류원"], ["D", "▷|", "다이오드"], ["OPAMP", "▷", "간략 OP AMP"], ["OPAMP_IDEAL", "▷∞", "이상 OP AMP"],
  ["VCVS", "◇V", "전압 제어 전압원"], ["VCCS", "◇I", "전압 제어 전류원"],
  ["CURRENT_SENSOR", "S→", "0 V 전류 센서"], ["CCCS", "◇β", "전류 제어 전류원"], ["CCVS", "◇R", "전류 제어 전압원"],
];

const elements = Object.fromEntries([
  "engine-status", "stale-badge", "run-button", "cancel-analysis-button", "palette-list", "circuit-canvas", "wire-layer", "component-layer", "overlay-layer", "empty-hint",
  "tool-hint", "circuit-count", "canvas-title", "canvas-subtitle", "selection-label", "inspector-content", "analysis-type", "analysis-settings",
  "analysis-note", "error-box", "example-select", "undo-button", "redo-button", "rotate-button", "delete-button", "new-button", "save-button",
  "load-button", "file-input", "probe-list", "result-summary", "ac-view-toggle", "wave-plot", "plot-empty", "cursor-readout", "reset-view-button", "csv-button",
  "phasor-panel", "phasor-summary", "voltage-plane-unit", "current-plane-unit", "voltage-phasor-plot", "current-phasor-plot",
  "voltage-phasor-values", "current-phasor-values", "phasor-time-plot", "phasor-time-units", "impedance-learning",
  "clone-button", "zoom-out-button", "zoom-in-button", "fit-button", "inline-value-editor", "palette-toggle", "inspector-toggle",
  "auto-update-status", "connection-summary", "probe-context-menu",
  "scope-controls", "analysis-intent", "analysis-recommendation", "auto-update", "advanced-analysis",
  "port-panel", "port-p-button", "port-n-button", "port-load-button", "port-clear-button", "port-run-button", "port-selection", "port-loads", "port-result", "port-status",
].map((id) => [id, document.getElementById(id)]));

const state = {
  circuit: { version: 1, geometryVersion: CURRENT_GEOMETRY_VERSION, components: [], wires: [], junctions: [] },
  settings: { analysis: "dc", start: "0", end: "5m", step: "10u", startFrequency: "10", endFrequency: "100k", pointsPerDecade: "30", phasorFrequency: "159.155" },
  title: "새 회로",
  subtitle: "빈 캔버스에서 시작하세요",
  selected: null,
  tool: "select",
  pendingPin: null,
  pendingWaypoints: [],
  probes: [],
  result: null,
  phasorResult: null,
  stale: false,
  history: [],
  future: [],
  acView: "magnitude",
  view: { min: 0, max: 1 },
  cursorIndex: null,
  drag: null,
  ignoreClickUntil: 0,
  pointer: null,
  canvasView: { x: 0, y: 0, width: 760, height: 500 },
  learningId: null,
  generation: 0,
  autoTimer: null,
  autoRequestedAt: null,
  inlineEdit: null,
  lastRunMs: null,
  runState: { status: "not-run", analysis: null, generation: null, error: null },
  pointerOwnerId: null,
  intent: "auto",
  autoUpdate: true,
  runSerial: 0,
  recommendation: "",
  manualSettingKeys: new Set(),
  port: { mode: null, p: null, n: null, loadIds: [], result: null, stale: false, error: null },
};

const inputDrafts = new InputDrafts();
const analysisWorkerClient = new AnalysisWorkerClient();
const phasorView = createPhasorView(elements, state, parseValue, () => inputDrafts.size > 0);
const scopeView = new ScopeView(elements["wave-plot"], elements["scope-controls"], elements["cursor-readout"]);
let connectionCache = null;
let panels = null;
let canvasTouch = null;
let canvasFrame = null;
function updateCanvasView() {
  const v = state.canvasView;
  elements["circuit-canvas"].setAttribute("viewBox", `${v.x} ${v.y} ${v.width} ${v.height}`);
}
let overlayFrame = null;
function scheduleOverlayRender() {
  if (overlayFrame === null) overlayFrame = requestAnimationFrame(() => { overlayFrame = null; if (circuitWorkspaceActive) renderOverlay(); });
}
function scheduleCanvasRender() {
  if (canvasFrame === null) canvasFrame = requestAnimationFrame(() => { canvasFrame = null; renderCanvas(); });
}
let seriesCache = null;
let cancelPlotSession = () => {};
let activeAnalysisJob = null;
let circuitWorkspaceActive = true;
let workspaceSwitching = false;
let discardingInputDrafts = false;
let circuitRenderDeferred = false;
let workspaceTabs = null;
let emController = null;
let circuitCourse = null;
let signalsCourse = null;
let circuitCourseActive = false;
const isCircuitUiActive = () => circuitWorkspaceActive && !workspaceSwitching && !discardingInputDrafts;

function updateAnalysisControls() {
  const running = Boolean(activeAnalysisJob);
  elements["run-button"].disabled = running;
  elements["cancel-analysis-button"].disabled = !running;
  elements["cancel-analysis-button"].classList.toggle("hidden", !running);
  elements["port-run-button"].disabled = running || !state.port.p || !state.port.n;
}


function invalidateActiveAnalysis(reason = "input-changed", { announce = false } = {}) {
  if (!activeAnalysisJob) return false;
  const job = activeAnalysisJob;
  state.runSerial += 1;
  analysisWorkerClient.cancel(reason);
  activeAnalysisJob = null;
  if (job.kind === "normal" && state.runState.status === "running") {
    state.runState = { ...state.runState, status: state.result ? "stale" : "not-run", error: null };
    if (state.result) state.stale = true;
  }
  refreshInvalidatedPortPanel(job, state.port, renderPortPanel);
  updateAnalysisControls();
  if (announce) setStatus("계산 취소됨 · 즉시 다시 실행할 수 있습니다.", "ready");
  return true;
}

function cancelActiveAnalysisFromUI() {
  invalidateActiveAnalysis("user-cancelled", { announce: true });
  renderAll();
}

function currentConnections() {
  const key = `${state.generation}:${state.settings.analysis}:${state.settings.phasorFrequency}:${state.settings.startFrequency}`;
  if (connectionCache?.circuit === state.circuit && connectionCache.key === key) return connectionCache.value;
  const value = classifyCircuitConnections(state.circuit, state.settings.analysis, { frequency: connectionFrequency(state.settings) });
  connectionCache = { circuit: state.circuit, key, value };
  return value;
}

function synchronizeIntent() {
  const plan = suggestAnalysis(state.circuit, state.settings, state.intent);
  state.settings = plan.settings;
  state.recommendation = plan.reason;
  elements["analysis-intent"].value = state.intent;
  elements["auto-update"].checked = state.autoUpdate;
  elements["analysis-recommendation"].textContent = plan.reason;
  elements["analysis-recommendation"].title = plan.reason;
}

function cancelScheduledRun() {
  clearTimeout(state.autoTimer);
  state.autoTimer = null;
  state.autoRequestedAt = null;
}

function resetProjectSession() {
  cancelScheduledRun();
  invalidateActiveAnalysis("project-reset");
  state.runSerial += 1;
  if (state.drag) finishCanvasPointer(state.drag.pointerId, "cancel");
  cancelPlotSession();
  inputDrafts.clear();
  state.inlineEdit = null;
  elements["inline-value-editor"].classList.add("hidden");
  elements["inline-value-editor"].classList.remove("input-invalid", "input-editing");
  state.selected = null;
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
  updateAnalysisControls();
  closeProbeContextMenu();
  scopeView.resetForProject();
  setStatus("해석 준비", "ready");
}

function recordProbeEdit() {
  state.history.push(snapshot());
  if (state.history.length > 100) state.history.shift();
  state.future = [];
}

function refreshProbeViews() {
  renderCanvas();
  renderProbes();
  renderPlot();
  renderPhasorLearning();
  elements["undo-button"].disabled = state.history.length === 0;
  elements["redo-button"].disabled = state.future.length === 0;
}

function updateDraftNotice(updatePhasor = true) {
  const notice = document.getElementById("draft-notice");
  notice.classList.toggle("hidden", inputDrafts.size === 0);
  document.getElementById("draft-count").textContent = `입력 대기 ${inputDrafts.size}`;
  // Per-keystroke path: only AC results are shown live; other analyses refresh on the next full render.
  if (updatePhasor) {
    if (state.settings.analysis === "ac") renderPhasorLearning();
    else phasorDirty = true;
  }
}

function applyInputDrafts(container, kind, component = null) {
  const selector = kind === "prop" ? "[data-prop]" : "[data-setting]";
  for (const control of container.querySelectorAll(selector)) {
    const key = kind === "prop" ? control.dataset.prop : control.dataset.setting;
    const draft = inputDrafts.get(kind, component?.id ?? null, key);
    if (draft === undefined) continue;
    control.value = draft;
    const classified = key === "ref" || key === "mode" ? { status: "valid" } : classifyNumericInput(draft, {
      positive: kind === "setting" ? key !== "start" : ["R", "C", "L"].includes(component?.type) && key === "value",
    });
    control.classList.toggle("input-invalid", classified.status === "invalid");
    control.classList.toggle("input-editing", classified.status !== "invalid");
    control.setAttribute("aria-invalid", String(classified.status === "invalid"));
  }
}

function confirmDiscardDrafts() {
  return inputDrafts.size === 0 || confirm("확정하지 않은 입력이 있습니다. 입력을 버리고 회로를 전환할까요? 취소하면 편집을 계속할 수 있습니다.");
}

/** Validate all visible AND hidden drafts atomically before run/save. */
function commitPendingInputs() {
  const updates = new Map();
  const add = (kind, id, key, value, control = null) => {
    const component = kind === "prop" ? state.circuit.components.find((item) => item.id === id) : null;
    if (kind === "prop" && !component) return;
    if (component) component.props ??= {};
    updates.set(inputDrafts.key(kind, id, key), { kind, id, key, value, control, component, object: component?.props ?? state.settings });
  };
  for (const item of inputDrafts.entries()) add(item.kind, item.id, item.property, item.value);
  if (state.selected?.kind === "component") for (const control of elements["inspector-content"].querySelectorAll("[data-prop]")) add("prop", state.selected.id, control.dataset.prop, control.value, control);
  for (const control of elements["analysis-settings"].querySelectorAll("[data-setting]")) add("setting", null, control.dataset.setting, control.value, control);
  if (state.inlineEdit) add("prop", state.inlineEdit.componentId, state.inlineEdit.prop, elements["inline-value-editor"].value, elements["inline-value-editor"]);
  for (const update of updates.values()) {
    if (update.key === "ref" || update.key === "mode") continue;
    const classified = update.component
      ? controlledSourceInputModel(update.component.type, update.value) ?? classifyNumericInput(update.value, { positive: ["R", "C", "L"].includes(update.component.type) && update.key === "value" })
      : classifyNumericInput(update.value, { positive: update.key !== "start" });
    if (classified.status === "valid") continue;
    inputDrafts.set(update.kind, update.id, update.key, update.value, update.object[update.key]);
    if (update.kind === "setting") {
      elements["advanced-analysis"].open = true;
      // A draft can belong to a currently hidden analysis. Make it visible before correction.
      const expected = ["start", "end", "step"].includes(update.key) ? "transient" : "ac";
      if (!elements["analysis-settings"].querySelector(`[data-setting="${update.key}"]`)) { state.settings.analysis = expected; state.intent = "manual"; renderAnalysisSettings(); }
      update.control = elements["analysis-settings"].querySelector(`[data-setting="${update.key}"]`);
    } else if (!update.control?.isConnected) {
      state.selected = { kind: "component", id: update.id };
      setInspectorCollapsed(false);
      renderInspector();
      update.control = elements["inspector-content"].querySelector(`[data-prop="${update.key}"]`);
    }
    update.control?.classList.add("input-invalid");
    update.control?.setAttribute("aria-invalid", "true");
    cancelScheduledRun();
    markInputDirty();
    setStatus(`입력 오류 · ${update.id ?? "해석"}.${update.key} · 실행/저장하지 않음`, "error");
    update.control?.focus();
    return false;
  }
  const changed = [...updates.values()].filter((update) => String(update.object[update.key] ?? "") !== update.value);
  for (const update of updates.values()) inputDrafts.delete(update.kind, update.id, update.key);
  if (state.inlineEdit) { state.inlineEdit = null; elements["inline-value-editor"].classList.add("hidden"); }
  if (changed.length) mutate(() => {
    for (const update of changed) {
      update.object[update.key] = update.value;
      if (update.kind === "setting") state.manualSettingKeys.add(update.key);
    }
    if (changed.some((update) => update.kind === "setting")) state.intent = "manual";
  }, { auto: false });
  updateDraftNotice();
  return true;
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
  state.generation += 1;
  markStale();
  renderAll();
  scheduleAutoRun();
}

function mutate(change, { history = true, auto = true } = {}) {
  if (history) {
    state.history.push(snapshot());
    if (state.history.length > 100) state.history.shift();
    state.future = [];
  }
  change();
  inputDrafts.retainComponents(new Set(state.circuit.components.map((item) => item.id)));
  synchronizeIntent();
  state.generation += 1;
  markStale();
  renderAll();
  if (auto) scheduleAutoRun();
}

function markStale() {
  invalidateActiveAnalysis("input-changed");
  markPortStale();
  if (state.result) state.stale = true;
  if (["success", "error", "running"].includes(state.runState.status)) {
    state.runState = { ...state.runState, status: "stale", error: null };
    elements["error-box"].classList.add("hidden");
  }
  elements["stale-badge"].classList.toggle("hidden", !(state.stale || state.runState.status === "stale"));
  if (state.stale || state.runState.status === "stale") setStatus("오래된 결과", "ready");
}

function markPortStale() {
  if (!(state.port.result || state.port.error) || state.port.stale) return;
  state.port.stale = true;
  renderPortPanel();
}

function markInputDirty() {
  cancelScheduledRun();
  invalidateActiveAnalysis("input-draft-changed");
  state.generation += 1;
  if (state.result || ["success", "error", "running"].includes(state.runState.status)) markStale();
  else markPortStale();
  elements["csv-button"].disabled = true;
  elements["auto-update-status"].textContent = "입력 완료 대기";
  updateDraftNotice();
}

function setStatus(text, kind = "ready") {
  elements["engine-status"].textContent = text;
  elements["engine-status"].className = `status-dot ${kind}`;
}

function setTool(tool) {
  state.port.mode = null;
  state.tool = tool;
  state.pendingPin = null;
  state.pendingWaypoints = [];
  state.pointer = null;
  document.querySelectorAll("[data-tool]").forEach((button) => button.classList.toggle("active", button.dataset.tool === tool));
  document.querySelectorAll(".palette-item").forEach((button) => button.classList.toggle("active", tool === `place:${button.dataset.type}`));
  const hints = {
    select: "터치: 탭 선택 · 선택한 부품 끌기 이동 · 나머지 끌기 화면 이동 · 배선은 배선 도구",
    pan: "화면 이동 — 부품 위에서도 회로를 바꾸지 않고 화면만 이동합니다.",
    wire: "배선 도구 — 핀/접속점에서 시작하고 빈 격자점으로 꺾임을 고정한 뒤 핀/배선/접속점에서 끝냅니다.",
    "voltage-probe": "전압 프로브 — 선 또는 핀을 클릭하면 접지 기준 전압이 추가됩니다.",
    "current-probe": "전류 프로브 — 부품을 클릭하면 화살표와 범례의 양의 기준 방향 전류가 추가됩니다.",
  };
  elements["tool-hint"].textContent = tool.startsWith("place:") ? "연속 배치 — 같은 부품을 계속 놓습니다. Esc로 종료" : hints[tool];
  renderCanvas();
}

function renderPalette() {
  elements["palette-list"].innerHTML = PALETTE.map(([type, symbol, label]) => `<button class="palette-item" data-type="${type}" type="button"><b>${symbol}</b><span>${label}</span></button>`).join("");
  elements["palette-list"].querySelectorAll("button").forEach((button) => button.addEventListener("click", () => { setTool(`place:${button.dataset.type}`); panels?.closeMobile(); }));
}

function localPin(type, pin) {
  return geometryLocalPin(type, pin, circuitGeometryVersion(state.circuit));
}

function pinPosition(component, pin) {
  return geometryPinPosition(component, pin, circuitGeometryVersion(state.circuit));
}

function componentMarkup(component, connection) {
  const ref = escapeHtml(component.props?.ref ?? component.id);
  const sourceDescriptor = ["V", "I", "VCVS", "VCCS", "CCCS", "CCVS"].includes(component.type) ? sourceInlineDescriptor(component, state.settings.analysis) : null;
  const rawValue = sourceDescriptor?.value ?? component.props?.value ?? component.props?.gain ?? "";
  const value = escapeHtml(sourceDescriptor ? `${sourceDescriptor.label} ${rawValue} ${sourceDescriptor.unit}` : rawValue);
  const editProp = sourceDescriptor?.prop ?? (component.props?.value !== undefined ? "value" : component.props?.gain !== undefined ? "gain" : "");
  const geometryVersion = circuitGeometryVersion(state.circuit);
  const mode = component.props?.mode ?? "DC";
  let symbol = "";
  if (component.type === "R") symbol = `<path class="lead" d="M-40 0H-27M27 0H40"/><path class="body" d="M-27 0l6-11 9 22 9-22 9 22 9-22 6 11"/>`;
  if (component.type === "C") symbol = `<path class="lead" d="M-40 0H-8M8 0H40"/><path class="body" d="M-8-18V18M8-18V18"/>`;
  if (component.type === "L") symbol = `<path class="lead" d="M-40 0H-28M28 0H40"/><path class="body" d="M-28 0c0-14 14-14 14 0 0-14 14-14 14 0 0-14 14-14 14 0 0-14 14-14 14 0"/>`;
  const waveformSymbol = mode === "SIN"
    ? `<path class="symbol-line" d="M-13 0C-9-12-4-12 0 0S9 12 13 0"/>`
    : mode === "PULSE"
      ? `<path class="symbol-line" d="M-13 7H-5V-7H6V7H13"/>`
      : null;
  if (component.type === "V") symbol = `<path class="lead" d="M-40 0H-19M19 0H40"/><circle class="body" cx="0" cy="0" r="19"/>${waveformSymbol ?? `<path class="symbol-line" d="M-12 0h8M-8-4v8M5 0h8"/>`}`;
  if (component.type === "I") symbol = `<path class="lead" d="M-40 0H-19M19 0H40"/><circle class="body" cx="0" cy="0" r="19"/>${waveformSymbol ?? `<path class="symbol-line" d="M-10 0H10M4-6l6 6-6 6"/>`}`;
  if (component.type === "D") symbol = `<path class="lead" d="M-40 0H-18M18 0H40"/><path class="body" d="M-18-16V16L12 0Z"/><path class="symbol-line" d="M14-17V17"/>`;
  if (component.type === "GND") symbol = geometryVersion === 1
    ? `<path class="lead" d="M0-28V-8"/><path class="body" d="M-20-8H20M-13-1H13M-6 6H6"/>`
    : `<path class="lead" d="M0-40V-12"/><path class="body" d="M-20-12H20M-13-5H13M-6 2H6"/>`;
  if (component.type === "OPAMP" || component.type === "OPAMP_IDEAL") symbol = geometryVersion === 1
    ? `<path class="lead" d="M-45-18H-29M-45 18H-29M29 0H45"/><path class="body" d="M-29-35V35L29 0Z"/><path class="symbol-line" d="M-23-18h10M-18-23v10M-23 18h10"/>${component.type === "OPAMP_IDEAL" ? `<text class="ideal-mark" x="2" y="6">∞</text>` : ""}`
    : `<path class="lead" d="M-40-20H-26M-40 20H-26M26 0H40"/><path class="body" d="M-26-36V36L26 0Z"/><path class="symbol-line" d="M-22-20h10M-17-25v10M-22 20h10"/>${component.type === "OPAMP_IDEAL" ? `<text class="ideal-mark" x="2" y="6">∞</text>` : ""}`;
  if (component.type === "VCVS" || component.type === "VCCS") symbol = `<path class="lead" d="M-40 0H-24M24 0H40M0-40V-24M0 24V40"/><path class="body" d="M-24 0L0-24 24 0 0 24Z"/>${component.type === "VCVS" ? `<path class="symbol-line" d="M-14 0h8M-10-4v8M6 0h8"/>` : `<path class="symbol-line" d="M-11 0H11M5-6l6 6-6 6"/>`}<text class="controlled-pin-label" x="-35" y="-7">p</text><text class="controlled-pin-label" x="28" y="-7">n</text><text class="controlled-pin-label" x="6" y="-28">cp</text><text class="controlled-pin-label" x="6" y="35">cn</text>`;
  if (component.type === "CURRENT_SENSOR") symbol = `<path class="lead" d="M-40 0H-19M19 0H40"/><circle class="body" cx="0" cy="0" r="19"/><path class="symbol-line" d="M-11 0H11M5-6l6 6-6 6"/><text class="controlled-pin-label" x="-35" y="-7">p</text><text class="controlled-pin-label" x="28" y="-7">n</text>`;
  if (component.type === "CCCS" || component.type === "CCVS") symbol = `<path class="lead" d="M-40 0H-24M24 0H40"/><path class="body" d="M-24 0L0-24 24 0 0 24Z"/>${component.type === "CCCS" ? `<path class="symbol-line" d="M-11 0H11M5-6l6 6-6 6"/>` : `<path class="symbol-line" d="M-14 0h8M-10-4v8M6 0h8"/>`}<text class="controlled-pin-label" x="-35" y="-7">p</text><text class="controlled-pin-label" x="28" y="-7">n</text>`;
  const pins = Array.from({ length: pinCount(component.type) }, (_, pin) => {
    const pos = localPin(component.type, pin);
    const pending = state.pendingPin?.componentId === component.id && state.pendingPin?.pin === pin ? " pending" : "";
    const target = state.pendingPin && !pending ? " target" : "";
    const probe = state.probes.find((item) => item.kind === "voltage" && item.componentId === component.id && item.pin === pin);
    const portP = state.port.p?.componentId === component.id && state.port.p?.pin === pin ? " port-p" : "";
    const portN = state.port.n?.componentId === component.id && state.port.n?.pin === pin ? " port-n" : "";
    const probed = probe ? " probed" : "";
    const color = probe ? ` style="--probe-color:${traceColor(probe.color)}"` : "";
    return `<circle class="pin-hit" data-pin="${pin}" cx="${pos.x}" cy="${pos.y}" r="4"/><circle class="pin${pending}${target}${probed}${portP}${portN}" data-pin="${pin}" cx="${pos.x}" cy="${pos.y}" r="4"${color}/><text class="pin-number" x="${pos.x + 6}" y="${pos.y - 6}">${pin + 1}</text>`;
  }).join("");
  const selected = state.selected?.kind === "component" && state.selected.id === component.id ? " selected" : "";
  const probe = state.probes.find((item) => item.kind === "current" && item.componentId === component.id);
  const probed = probe ? " probed" : "";
  const color = probe ? ` style="--probe-color:${traceColor(probe.color)}"` : "";
  const direction = probe ? currentDirectionDescriptor(component, geometryVersion) : null;
  const arrow = currentArrowGeometry(direction);
  const directionMarkup = arrow
    ? `<g class="current-direction" aria-hidden="true"><title>${escapeHtml(direction.label)} · 양수 기준</title><line x1="${arrow.start.x}" y1="${arrow.start.y}" x2="${arrow.end.x}" y2="${arrow.end.y}"/><path d="M${arrow.head.map(point => `${point.x} ${point.y}`).join("L")}Z"/></g>`
    : "";
  const connectionStatus = connection?.status ?? "solver-check";
  const badgeRotation = -Number(component.rotation ?? 0);
  const connectionMarkup = connectionStatus !== "referenced" ? `<rect class="connection-halo status-${connectionStatus}" x="-47" y="-47" width="94" height="94" rx="3"/><g class="connection-badge status-${connectionStatus}" data-show-connection="${escapeHtml(component.id)}" role="button" tabindex="0" aria-label="${ref} 연결 상태 보기" transform="translate(-35 -34) rotate(${badgeRotation})"><title>${escapeHtml(connection?.label ?? "연결 상태 보기")} · 클릭하여 설명</title><circle r="11"/><text y="4">${escapeHtml(connection?.badge ?? "?")}</text></g>` : "";
  const deleteMarkup = selected ? `<g class="component-delete" data-delete-component="${escapeHtml(component.id)}" role="button" tabindex="0" aria-label="${ref} 삭제" transform="translate(35 -34) rotate(${badgeRotation})"><title>부품 삭제 · Ctrl+Z로 복원</title><rect x="-15" y="-15" width="30" height="30" rx="3"/><text y="4">×</text></g>` : "";
  const upright = -Number(component.rotation ?? 0);
  const vertical = Math.abs(Math.sin(Number(component.rotation ?? 0) * Math.PI / 180)) > .7;
  const labelX = vertical ? 30 : 0;
  const labelY = vertical ? -7 : -29;
  const valueY = vertical ? 12 : 35;
  const anchor = vertical ? "start" : "middle";
  const modeMarkup = ["V", "I"].includes(component.type) && !sourceDescriptor ? `<text class="source-mode-label" x="${labelX}" y="${valueY + 16}" style="text-anchor:${anchor}">${escapeHtml(mode)}</text>` : "";
  const labels = `<g class="upright-labels" transform="rotate(${upright})"><text class="label" x="${labelX}" y="${labelY}" style="text-anchor:${anchor}">${ref}</text>${value ? `<text class="value-label" data-edit-prop="${editProp}" x="${labelX}" y="${valueY}" style="text-anchor:${anchor}">${value}</text>` : ""}${modeMarkup}</g>`;
  return `<g class="component${selected}${probed}" data-id="${escapeHtml(component.id)}" data-connection-status="${connectionStatus}" aria-label="${ref}: ${escapeHtml(connection?.label ?? "상태 확인 필요")}" transform="translate(${component.x} ${component.y}) rotate(${component.rotation ?? 0})"${color}>${connectionMarkup}<path class="component-hit" d="M-30 0H30"/>${symbol}${pins}${directionMarkup}${labels}${deleteMarkup}</g>`;
}

function endpointPosition(endpoint, componentById = new Map(state.circuit.components.map((component) => [component.id, component]))) {
  if (endpoint?.junctionId !== undefined) {
    const junction = (state.circuit.junctions ?? []).find((item) => item.id === endpoint.junctionId);
    return junction ? { x: junction.x, y: junction.y } : null;
  }
  const component = componentById.get(endpoint?.componentId);
  return component ? pinPosition(component, endpoint.pin) : null;
}

function wireRoute(wire, a, b) {
  return routeWirePoints(wire, a, b, circuitGeometryVersion(state.circuit));
}

function renderOverlay(componentById = new Map(state.circuit.components.map((component) => [component.id, component]))) {
  if (overlayFrame !== null) { cancelAnimationFrame(overlayFrame); overlayFrame = null; }
  const endpointCounts = new Map();
  const endpointByKey = new Map();
  for (const wire of state.circuit.wires) {
    for (const end of [wire.a, wire.b]) {
      const key = endpointKey(end);
      endpointCounts.set(key, (endpointCounts.get(key) ?? 0) + 1);
      endpointByKey.set(key, end);
    }
  }
  const junctions = [];
  for (const [key, count] of endpointCounts) {
    if (count < 2 || !key.startsWith("P:")) continue;
    const { componentId, pin } = endpointByKey.get(key);
    const component = componentById.get(componentId);
    if (!component) continue;
    const position = pinPosition(component, Number(pin));
    junctions.push(`<circle class="junction" cx="${position.x}" cy="${position.y}" r="5"/>`);
  }
  for (const junction of state.circuit.junctions ?? []) {
    const selected = state.selected?.kind === "junction" && state.selected.id === junction.id ? " selected" : "";
    const pending = state.pendingPin && state.pendingPin.junctionId !== junction.id ? " target" : "";
    const portP = state.port.p?.junctionId === junction.id ? " port-p" : "";
    const portN = state.port.n?.junctionId === junction.id ? " port-n" : "";
    junctions.push(`<g data-junction-id="${escapeHtml(junction.id)}"><circle class="junction-hit" cx="${junction.x}" cy="${junction.y}" r="5"/><circle class="junction${selected}${pending}${portP}${portN}" cx="${junction.x}" cy="${junction.y}" r="6"/></g>`);
  }
  if (state.pendingPin && state.pointer) {
    const start = endpointPosition(state.pendingPin, componentById);
    if (start) {
      const fixed = normalizePoints([start, ...state.pendingWaypoints]);
      if (fixed.length > 1) junctions.push(`<path class="wire-preview-fixed" d="${polylinePath(fixed)}"/>`);
      const current = state.pendingWaypoints.at(-1) ?? start;
      const target = snapPoint(state.pointer);
      junctions.push(`<path class="wire-preview" d="${polylinePath([current, ...orthogonalLeg(current, target)])}"/>`);
    }
  }
  elements["overlay-layer"].innerHTML = junctions.join("");
  bindOverlayItems();
}

function renderCanvas() {
  if (!circuitWorkspaceActive) { circuitRenderDeferred = true; return; }
  if (canvasFrame !== null) { cancelAnimationFrame(canvasFrame); canvasFrame = null; }
  const componentById = new Map(state.circuit.components.map((component) => [component.id, component]));
  let connection, connectionError = false;
  try { connection = currentConnections(); }
  catch { connectionError = true; connection = { byComponent: {}, counts: {} }; }
  elements["wire-layer"].innerHTML = state.circuit.wires.map((wire) => {
    const a = endpointPosition(wire.a, componentById);
    const b = endpointPosition(wire.b, componentById);
    if (!a || !b) return "";
    const points = wireRoute(wire, a, b);
    const path = polylinePath(points);
    const selected = state.selected?.kind === "wire" && state.selected.id === wire.id ? " selected" : "";
    const probe = state.probes.find((item) => item.kind === "voltage" && item.wireId === wire.id);
    const probed = probe ? " probed" : "";
    const color = probe ? ` style="--probe-color:${traceColor(probe.color)}"` : "";
    return `<g data-wire-id="${escapeHtml(wire.id)}"><path class="wire${selected}${probed}" d="${path}"${color}/><path class="wire-hit" d="${path}"/></g>`;
  }).join("");
  elements["component-layer"].innerHTML = state.circuit.components.map((component) => componentMarkup(component, connection.byComponent[component.id])).join("");
  renderOverlay(componentById);
  elements["circuit-canvas"].setAttribute("viewBox", `${state.canvasView.x} ${state.canvasView.y} ${state.canvasView.width} ${state.canvasView.height}`);
  elements["empty-hint"].classList.toggle("hidden", state.circuit.components.length > 0);
  elements["circuit-count"].textContent = `부품 ${state.circuit.components.length} · 배선 ${state.circuit.wires.length} · 접속점 ${(state.circuit.junctions ?? []).length}`;
  const warningCount = (connection.counts.unwired ?? 0) + (connection.counts["no-ground"] ?? 0) + (connection.counts["analysis-floating"] ?? 0) + (connection.counts["solver-check"] ?? 0);
  const solverLabel = runStateLabel(state.runState, state.settings.analysis, state.generation);
  elements["connection-summary"].textContent = state.circuit.components.length === 0
    ? `접속 상태 없음 · ${solverLabel}`
    : connectionError ? `연결 검사 실패 · 제어 참조와 회로 입력을 확인하세요`
    : warningCount
      ? `접속 주의 ${warningCount} · ${solverLabel}`
      : `✓ GND 기준 경로 · ${solverLabel}`;
  elements["connection-summary"].classList.toggle("has-warning", warningCount > 0 || connectionError);
  elements["connection-summary"].classList.toggle("has-error", state.runState.status === "error");
  elements["connection-summary"].classList.toggle("has-stale", state.runState.status === "stale");
  elements["canvas-title"].textContent = state.title;
  elements["canvas-subtitle"].textContent = state.subtitle;
  bindCanvasItems();
}

function svgPoint(event) {
  const matrix = elements["circuit-canvas"].getScreenCTM();
  if (!matrix || !Number.isFinite(matrix.a * matrix.d - matrix.b * matrix.c) || Math.abs(matrix.a * matrix.d - matrix.b * matrix.c) < 1e-12) return null;
  const transformed = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
  return Number.isFinite(transformed.x) && Number.isFinite(transformed.y) ? { x: transformed.x, y: transformed.y } : null;
}

function nextId(type) {
  const prefix = type === "GND" ? "G" : ["OPAMP", "OPAMP_IDEAL"].includes(type) ? "U" : ({ VCVS: "E", VCCS: "G", CURRENT_SENSOR: "S", CCCS: "F", CCVS: "H" }[type] ?? type);
  let index = 1;
  const used = new Set(state.circuit.components.map((component) => component.id));
  while (used.has(`${prefix}${index}`)) index += 1;
  return `${prefix}${index}`;
}

function placeComponent(event) {
  if (!state.tool.startsWith("place:") || !event.target.classList.contains("canvas-bg")) return;
  const type = state.tool.split(":")[1];
  const point = svgPoint(event);
  if (!point) return;
  const id = nextId(type);
  const index = Number(id.match(/\d+/)?.[0] ?? 1);
  mutate(() => {
    state.circuit.components.push({ id, type, ...snapPoint(point), rotation: 0, props: componentDefaults(type, index) });
    state.selected = { kind: "component", id };
    state.title = state.title === "새 회로" ? "사용자 회로" : state.title;
    state.subtitle = "편집한 연결과 값으로 계산됩니다";
  });
}

function handleEndpointClick(target) {
  if (state.port.mode === "pick-p" || state.port.mode === "pick-n") {
    invalidateActiveAnalysis("port-selection-changed");
    const key = state.port.mode === "pick-p" ? "p" : "n";
    state.port[key] = structuredClone(target);
    state.port.mode = null;
    state.port.result = null;
    state.port.error = null;
    state.port.stale = false;
    elements["tool-hint"].textContent = `DC 포트 ${key} 선택 완료 · 다른 끝점과 외부 부하를 지정하세요.`;
    renderCanvas();
    renderPortPanel();
    return;
  }
  if (state.tool === "wire" || state.tool === "select") {
    if (!state.pendingPin) {
      state.pendingPin = target;
      state.pendingWaypoints = [];
      state.pointer = endpointPosition(target);
      renderCanvas();
      return;
    }
    if (endpointsEqual(state.pendingPin, target)) {
      state.pendingPin = null;
      state.pendingWaypoints = [];
      state.pointer = null;
      renderCanvas();
      return;
    }
    const duplicate = state.circuit.wires.some((wire) => {
      return (endpointsEqual(wire.a, state.pendingPin) && endpointsEqual(wire.b, target))
        || (endpointsEqual(wire.b, state.pendingPin) && endpointsEqual(wire.a, target));
    });
    const start = structuredClone(state.pendingPin);
    const waypoints = structuredClone(state.pendingWaypoints);
    state.pendingPin = null;
    state.pendingWaypoints = [];
    state.pointer = null;
    if (!duplicate) mutate(() => state.circuit.wires.push({ id: `W${Date.now().toString(36)}${state.circuit.wires.length}`, a: start, b: target, waypoints }));
    else renderCanvas();
    return;
  }
}

function addPendingWaypoint(point) {
  if (!state.pendingPin) return;
  const start = endpointPosition(state.pendingPin);
  if (!start) return;
  const target = snapPoint(point);
  state.pendingWaypoints = appendFixedWaypoint(start, state.pendingWaypoints, target);
  state.pointer = target;
  elements["tool-hint"].textContent = `고정 꺾임 ${state.pendingWaypoints.length}개 · 빈 격자점을 더 누르거나 핀/배선/접속점에서 완료 · Esc 취소`;
  renderOverlay();
}

function handlePinClick(componentId, pin, wireId = null) {
  const target = { componentId, pin };
  if (state.tool === "wire" || state.tool === "select") return handleEndpointClick(target);
  if (state.tool === "voltage-probe") addVoltageProbe(componentId, pin, wireId);
}

function bindCanvasItems() {
  elements["component-layer"].querySelectorAll("[data-show-connection], [data-delete-component]").forEach((button) => {
    const activate = (event) => {
      event.preventDefault();
      event.stopPropagation();
      const id = button.dataset.deleteComponent ?? button.dataset.showConnection;
      state.selected = { kind: "component", id };
      if (button.dataset.deleteComponent) deleteSelection();
      else { setInspectorCollapsed(false); renderAll(); }
    };
    button.addEventListener("pointerdown", (event) => event.stopPropagation());
    button.addEventListener("click", activate);
    button.addEventListener("keydown", (event) => { if (["Enter", " "].includes(event.key)) activate(event); });
  });
  elements["component-layer"].querySelectorAll(".pin, .pin-hit").forEach((pin) => {
    pin.addEventListener("click", (event) => {
      event.stopPropagation();
      const group = pin.closest(".component");
      handlePinClick(group.dataset.id, Number(pin.dataset.pin));
    });
    pin.addEventListener("contextmenu", (event) => {
      const group = pin.closest(".component");
      const keys = probeKeysForTarget(state.probes, { kind: "pin", componentId: group.dataset.id, pin: Number(pin.dataset.pin) });
      if (keys.length) openProbeContextMenu(keys, event);
    });
  });
  elements["component-layer"].querySelectorAll(".component").forEach((group) => {
    group.addEventListener("click", (event) => {
      if (event.target.classList.contains("pin") || event.target.classList.contains("pin-hit") || performance.now() < state.ignoreClickUntil) return;
      const id = group.dataset.id;
      if (state.tool === "current-probe") addCurrentProbe(id);
      else if (state.tool === "select") {
        state.selected = { kind: "component", id };
        // Preserve the clicked text node so a native second click can produce dblclick.
        if (event.target.classList.contains("value-label")) renderInspector();
        else renderAll();
      }
    });
    group.querySelector(".value-label")?.addEventListener("dblclick", (event) => {
      event.stopPropagation();
      openInlineEditor(group.dataset.id, event.target.dataset.editProp, event);
    });
    group.addEventListener("pointerdown", (event) => {
      if (state.tool !== "select" || event.target.classList.contains("pin") || event.target.classList.contains("pin-hit") || event.target.classList.contains("value-label") || event.button !== 0) return;
      event.preventDefault();
      const component = state.circuit.components.find((item) => item.id === group.dataset.id);
      const point = svgPoint(event);
      if (!point) return;
      if (!beginCanvasPointer(event, { kind: "component", id: component.id, start: point, origin: { x: component.x, y: component.y }, before: snapshot(), moved: false })) return;
      state.selected = { kind: "component", id: component.id };
      renderInspector();
    });
    group.addEventListener("contextmenu", (event) => {
      if (event.target.classList.contains("pin") || event.target.classList.contains("pin-hit")) return;
      const keys = probeKeysForTarget(state.probes, { kind: "component", componentId: group.dataset.id });
      if (keys.length) openProbeContextMenu(keys, event);
    });
  });
  elements["wire-layer"].querySelectorAll("[data-wire-id]").forEach((group) => group.addEventListener("click", (event) => {
    event.stopPropagation();
    const wire = state.circuit.wires.find((item) => item.id === group.dataset.wireId);
    if (!wire) return;
    if ((state.tool === "wire" || state.tool === "select") && state.pendingPin) createJunctionAndConnect(wire.id, svgPoint(event));
    else if (state.tool === "voltage-probe") addVoltageProbeEndpoint(wire.a.componentId !== undefined ? wire.a : wire.b, wire.id);
    else if (state.tool === "select") {
      state.selected = { kind: "wire", id: wire.id };
      elements["wire-layer"].querySelectorAll(".wire").forEach((line) => line.classList.toggle("selected", line.closest("[data-wire-id]")?.dataset.wireId === wire.id));
      renderInspector();
      elements["delete-button"].disabled = false;
    }
  }));
  elements["wire-layer"].querySelectorAll("[data-wire-id]").forEach((group) => group.addEventListener("dblclick", (event) => {
    if (state.tool !== "select" || state.pendingPin) return;
    event.stopPropagation();
    createJunctionOnWire(group.dataset.wireId, svgPoint(event));
  }));
  elements["wire-layer"].querySelectorAll("[data-wire-id]").forEach((group) => group.addEventListener("contextmenu", (event) => {
    const keys = probeKeysForTarget(state.probes, { kind: "wire", wireId: group.dataset.wireId });
    if (keys.length) openProbeContextMenu(keys, event);
  }));
}

function bindOverlayItems() {
  elements["overlay-layer"].querySelectorAll("[data-junction-id]").forEach((group) => {
    group.addEventListener("click", (event) => {
      event.stopPropagation();
      if (performance.now() < state.ignoreClickUntil) return;
      const junctionId = group.dataset.junctionId;
      if (state.tool === "voltage-probe") addVoltageProbeEndpoint({ junctionId });
      else handleEndpointClick({ junctionId });
    });
    group.addEventListener("pointerdown", (event) => {
      if (state.tool !== "select" || state.port.mode || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const junction = (state.circuit.junctions ?? []).find((item) => item.id === group.dataset.junctionId);
      const point = svgPoint(event);
      if (!point) return;
      if (!beginCanvasPointer(event, { kind: "junction", id: junction.id, start: point, origin: { x: junction.x, y: junction.y }, before: snapshot(), moved: false })) return;
      state.selected = { kind: "junction", id: junction.id };
      renderInspector();
    });
    group.addEventListener("contextmenu", (event) => {
      const keys = probeKeysForTarget(state.probes, { kind: "junction", junctionId: group.dataset.junctionId });
      if (keys.length) openProbeContextMenu(keys, event);
    });
  });
}

function routeForWireId(wireId) {
  const wire = state.circuit.wires.find((item) => item.id === wireId);
  if (!wire) return [];
  const a = endpointPosition(wire.a);
  const b = endpointPosition(wire.b);
  return a && b ? wireRoute(wire, a, b) : [];
}

function createJunctionOnWire(wireId, point) {
  mutate(() => {
    const split = splitWireAtJunction(state.circuit, wireId, point, routeForWireId(wireId));
    state.circuit = split.circuit;
    state.probes = retargetWireProbes(state.probes, wireId, split.replacementWireId, split);
    state.selected = split.endpoint.junctionId ? { kind: "junction", id: split.endpoint.junctionId } : { kind: "component", id: split.endpoint.componentId };
  });
}

function createJunctionAndConnect(wireId, point) {
  const start = structuredClone(state.pendingPin);
  const waypoints = structuredClone(state.pendingWaypoints);
  const routePoints = routeForWireId(wireId);
  state.pendingPin = null;
  state.pendingWaypoints = [];
  state.pointer = null;
  mutate(() => {
    const split = splitWireAtJunction(state.circuit, wireId, point, routePoints);
    state.circuit = split.circuit;
    state.probes = retargetWireProbes(state.probes, wireId, split.replacementWireId, split);
    const duplicate = state.circuit.wires.some((wire) => (endpointsEqual(wire.a, start) && endpointsEqual(wire.b, split.endpoint)) || (endpointsEqual(wire.b, start) && endpointsEqual(wire.a, split.endpoint)));
    if (!endpointsEqual(start, split.endpoint) && !duplicate) state.circuit.wires.push({ id: `W${Date.now().toString(36)}${state.circuit.wires.length}`, a: start, b: split.endpoint, waypoints });
    state.selected = split.endpoint.junctionId ? { kind: "junction", id: split.endpoint.junctionId } : { kind: "component", id: split.endpoint.componentId };
  });
}

function openInlineEditor(componentId, prop, event) {
  if (!isCircuitUiActive()) return;
  if (!prop) return;
  const component = state.circuit.components.find((item) => item.id === componentId);
  if (!component) return;
  const wrap = document.getElementById("canvas-wrap").getBoundingClientRect();
  const editor = elements["inline-value-editor"];
  state.inlineEdit = { componentId, prop, original: component.props[prop] };
  editor.value = inputDrafts.get("prop", component.id, prop) ?? component.props[prop] ?? "";
  editor.style.left = `${Math.max(4, Math.min(wrap.width - 98, event.clientX - wrap.left - 46))}px`;
  editor.style.top = `${Math.max(4, Math.min(wrap.height - 48, event.clientY - wrap.top - 22))}px`;
  editor.classList.remove("hidden", "input-invalid", "input-editing");
  editor.focus();
  editor.select();
  setStatus("값 편집 중", "running");
}

function closeInlineEditor({ commit = false } = {}) {
  if (!isCircuitUiActive()) return true;
  const edit = state.inlineEdit;
  if (!edit) return true;
  const editor = elements["inline-value-editor"];
  if (commit) {
    const component = state.circuit.components.find((item) => item.id === edit.componentId);
    if (!component) { state.inlineEdit = null; editor.classList.add("hidden"); return false; }
    const classified = controlledSourceInputModel(component.type, editor.value) ?? classifyNumericInput(editor.value, { positive: ["R", "C", "L"].includes(component.type) && edit.prop === "value" });
    if (classified.status !== "valid") {
      editor.classList.add(classified.status === "editing" ? "input-editing" : "input-invalid");
      setStatus(classified.status === "editing" ? "입력 중" : "잘못된 값", classified.status === "editing" ? "running" : "error");
      return false;
    }
    const value = editor.value;
    inputDrafts.delete("prop", component.id, edit.prop);
    state.inlineEdit = null;
    editor.classList.add("hidden");
    editor.classList.remove("input-invalid", "input-editing");
    mutate(() => { component.props[edit.prop] = value; });
  } else {
    inputDrafts.delete("prop", edit.componentId, edit.prop);
    setStatus("입력 취소", "ready");
    renderInspector();
  }
  state.inlineEdit = null;
  editor.classList.add("hidden");
  editor.classList.remove("input-invalid", "input-editing");
  updateDraftNotice();
  scheduleAutoRun();
  return true;
}

function addVoltageProbe(componentId, pin, wireId = null) {
  const key = `V:${componentId}:${pin}`;
  if (state.probes.some((probe) => probe.key === key)) return;
  const component = state.circuit.components.find((item) => item.id === componentId);
  recordProbeEdit();
  state.probes.push({ key, kind: "voltage", componentId, pin, wireId, label: `V(${component?.props?.ref ?? componentId}.${pin + 1})`, color: nextAvailableProbeColor(COLORS, state.probes) });
  refreshProbeViews();
}

function addVoltageProbeEndpoint(endpoint, wireId = null) {
  if (endpoint.componentId !== undefined) return addVoltageProbe(endpoint.componentId, endpoint.pin, wireId);
  const junction = (state.circuit.junctions ?? []).find((item) => item.id === endpoint.junctionId);
  if (!junction) return;
  const key = `V:J:${junction.id}`;
  if (state.probes.some((probe) => probe.key === key)) return;
  recordProbeEdit();
  state.probes.push({ key, kind: "voltage", junctionId: junction.id, wireId, label: `V(${junction.id})`, color: nextAvailableProbeColor(COLORS, state.probes) });
  refreshProbeViews();
}

function addCurrentProbe(componentId) {
  const key = `I:${componentId}`;
  if (state.probes.some((probe) => probe.key === key)) return;
  const component = state.circuit.components.find((item) => item.id === componentId);
  if (!component || component.type === "GND") return;
  recordProbeEdit();
  state.probes.push({ key, kind: "current", componentId, label: currentProbeLabel(component, circuitGeometryVersion(state.circuit)), color: nextAvailableProbeColor(COLORS, state.probes) });
  refreshProbeViews();
}

function removeProbe(key) {
  recordProbeEdit();
  state.probes = removeProbeByKey(state.probes, key);
  closeProbeContextMenu();
  refreshProbeViews();
}

function closeProbeContextMenu() {
  if (!elements["probe-context-menu"]) return;
  elements["probe-context-menu"].classList.add("hidden");
  elements["probe-context-menu"].innerHTML = "";
}

function openProbeContextMenu(keys, event) {
  if (!keys.length) return false;
  event.preventDefault();
  event.stopPropagation();
  if (keys.length === 1) {
    removeProbe(keys[0]);
    setStatus("해당 프로브 제거 완료", "ready");
    return true;
  }
  const menu = elements["probe-context-menu"];
  const wrap = document.getElementById("canvas-wrap").getBoundingClientRect();
  const candidates = keys.map((key) => presentProbe(state.probes.find((probe) => probe.key === key))).filter(Boolean);
  menu.innerHTML = `<strong>제거할 프로브</strong>${candidates.map((probe) => `<button type="button" data-context-remove="${escapeHtml(probe.key)}"><i style="--chip-color:${traceColor(probe.color)}"></i>${escapeHtml(probe.label)}</button>`).join("")}`;
  menu.style.left = `${Math.max(4, Math.min(wrap.width - 210, event.clientX - wrap.left))}px`;
  menu.style.top = `${Math.max(4, Math.min(wrap.height - 120, event.clientY - wrap.top))}px`;
  menu.classList.remove("hidden");
  menu.querySelectorAll("[data-context-remove]").forEach((button) => button.addEventListener("click", () => removeProbe(button.dataset.contextRemove)));
  return true;
}

function sliderRangeFor(type, value) {
  return passiveSliderModel(type, value);
}

function field(label, key, value, help = "", options = null, slider = null, active = false) {
  const control = options
    ? `<select data-prop="${key}" aria-label="${escapeHtml(label)}">${options.map(([optionValue, optionLabel]) => `<option value="${optionValue}"${value === optionValue ? " selected" : ""}>${optionLabel}</option>`).join("")}</select>`
    : `<input data-prop="${key}" aria-label="${escapeHtml(label)}" value="${escapeHtml(value)}" autocomplete="off" />`;
  const combined = slider
    ? `<div class="field-slider"><input type="range" data-prop-slider="${key}" min="${slider.min}" max="${slider.max}" step="0.05" value="${slider.value}" aria-label="${label} 빠른 조절"/>${control}</div>`
    : control;
  const outside = slider?.outside ? `<span class="field-help range-note">현재 값은 빠른 조절 범위 밖입니다. 입력값은 그대로 보존됩니다.</span>` : "";
  return `<div class="field${active ? " active-field" : ""}"><label>${label}</label>${combined}${help ? `<span class="field-help">${help}</span>` : ""}${outside}</div>`;
}

function selectedConnectionStatus(componentId) {
  try {
    return currentConnections().byComponent[componentId];
  } catch {
    return null;
  }
}

// Inspector re-renders rebuild innerHTML, which would drop keyboard focus (Tab lands on BODY).
// Remember the focused control (and any in-flight Tab direction) and re-focus its successor.
let inspectorTabIntent = 0;
let inspectorLastFocused = null;
const INSPECTOR_FOCUSABLE = "input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])";
function captureInspectorFocus() {
  const root = elements["inspector-content"];
  // During a Tab-triggered change event the browser has already cleared activeElement.
  let active = document.activeElement;
  if ((!active || !root.contains(active)) && inspectorTabIntent !== 0 && inspectorLastFocused?.isConnected) active = inspectorLastFocused;
  if (!active || active === root || !root.contains(active)) return null;
  const index = [...root.querySelectorAll(INSPECTOR_FOCUSABLE)].indexOf(active);
  if (index < 0) return null;
  const caret = typeof active.selectionStart === "number" ? { start: active.selectionStart, end: active.selectionEnd } : null;
  return { index, caret, direction: inspectorTabIntent };
}
function restoreInspectorFocus(saved) {
  if (!saved) return;
  const root = elements["inspector-content"];
  if (document.activeElement && document.activeElement !== document.body && root.contains(document.activeElement)) return;
  const items = [...root.querySelectorAll(INSPECTOR_FOCUSABLE)];
  const target = items[saved.index + saved.direction];
  if (!target) return;
  target.focus({ preventScroll: false });
  if (!saved.direction && saved.caret && typeof target.setSelectionRange === "function") {
    try { target.setSelectionRange(saved.caret.start, saved.caret.end); } catch { /* non-text input */ }
  }
}

function renderInspector() {
  if (!circuitWorkspaceActive) { circuitRenderDeferred = true; return; }
  const selected = state.selected;
  if (!selected) {
    elements["selection-label"].textContent = "선택 없음";
    elements["inspector-content"].innerHTML = `<div class="inspector-empty"><span>⌁</span><p>부품을 선택하면 이름, 값, 파형과 초기조건을 수정할 수 있습니다.</p></div>`;
    return;
  }
  if (selected.kind === "wire") {
    const wire = state.circuit.wires.find((item) => item.id === selected.id);
    elements["selection-label"].textContent = "배선";
    elements["inspector-content"].innerHTML = wire ? `<div class="field"><label>배선 ID</label><input value="${escapeHtml(wire.id)}" disabled /></div><p class="field-help">교차한 선은 연결되지 않습니다. 같은 핀에서 여러 배선을 시작하면 접속점 ●이 표시됩니다.</p>` : "";
    return;
  }
  if (selected.kind === "junction") {
    const junction = (state.circuit.junctions ?? []).find((item) => item.id === selected.id);
    elements["selection-label"].textContent = "접속점";
    elements["inspector-content"].innerHTML = junction ? `<div class="field"><label>접속점</label><input value="${escapeHtml(junction.id)}" disabled /></div><p class="field-help">이동하면 연결은 유지됩니다. 삭제하면 연결된 선만 끊고 자동 병합하지 않습니다.</p>` : "";
    return;
  }
  const component = state.circuit.components.find((item) => item.id === selected.id);
  if (!component) { state.selected = null; renderInspector(); return; }
  const p = component.props ??= {};
  const connection = selectedConnectionStatus(component.id);
  elements["selection-label"].textContent = component.type;
  let html = field("참조 이름", "ref", p.ref ?? component.id);
  if (connection) html += `<div class="connection-detail status-${connection.status}"><strong>${connection.badge} ${connection.label}</strong><span>${connection.short}</span><small>사전 reference 경로 안내이며 최종 수렴·전원 모순 판정은 해석 실행 결과를 따릅니다.</small></div>`;
  if (["R", "C", "L"].includes(component.type)) {
    const labels = { R: "저항 (Ω)", C: "커패시턴스 (F)", L: "인덕턴스 (H)" };
    html += field(labels[component.type], "value", p.value, "로그 슬라이더와 정확한 공학 단위 입력을 함께 사용할 수 있습니다.", null, sliderRangeFor(component.type, p.value));
  }
  if (["C", "L"].includes(component.type)) {
    const icHelp = component.type === "C"
      ? "시간응답 첫 표본에서 V(1)−V(2)=IC로 강제합니다. 소스의 시작 전압과 방향까지 일치해야 합니다."
      : "시간응답 첫 표본의 1→2 전류입니다. SIN 정상상태 성분을 원하면 위상에 맞는 IC를 직접 지정해야 합니다.";
    html += field(component.type === "C" ? "초기 전압 IC (V)" : "초기 전류 IC (A)", "ic", p.ic ?? "0", icHelp);
  }
  if (["V", "I"].includes(component.type)) {
    const unit = component.type === "I" ? "A" : "V";
    const timeActive = state.settings.analysis !== "ac";
    const acActive = state.settings.analysis === "ac";
    const dcHelp = state.settings.analysis === "dc"
      ? "현재 DC 동작점에 사용됩니다."
      : state.settings.analysis === "transient" && p.mode === "DC"
        ? "현재 시간응답에 일정 레벨로 사용됩니다."
        : state.settings.analysis === "ac"
          ? "AC 해석에서는 비선형 소자의 DC bias 동작점을 정하며 AC 자극 크기와는 별도입니다."
          : "현재 시간 파형에는 쓰이지 않지만 DC 동작점용 값으로 보존됩니다.";
    html += `<fieldset class="source-group${timeActive ? " active-group" : ""}"><legend>DC · 시간영역</legend>`;
    html += field("소스 파형", "mode", p.mode ?? "DC", "DC 동작점은 아래 DC bias를 사용하며 SIN의 t=0 값을 대신 쓰지 않습니다.", [["DC", "DC"], ["SIN", "SIN"], ["PULSE", "PULSE"]], null, state.settings.analysis === "transient");
    html += field(`DC bias / level (${unit})`, "dc", p.dc ?? "0", dcHelp, null, null, state.settings.analysis === "dc" || (state.settings.analysis === "transient" && p.mode === "DC"));
    if (p.mode === "SIN") {
      html += field(`오프셋 (${unit})`, "offset", p.offset ?? "0") + field(`peak 진폭 (${unit}pk)`, "amplitude", p.amplitude ?? "0", "시간영역 SIN에만 사용됩니다.", null, null, state.settings.analysis === "transient") + field("SIN 주파수 (Hz)", "frequency", p.frequency ?? "60", "AC sweep/페이저 주파수와 독립입니다.") + field("SIN 위상(°)", "phase", p.phase ?? "0", "엔진은 sin 정의를 사용하며 AC phasor는 cos 기준입니다.");
    }
    if (p.mode === "PULSE") {
      html += field(`low (${unit})`, "pulseV1", p.pulseV1 ?? "0") + field(`high (${unit})`, "pulseV2", p.pulseV2 ?? "0", "canvas inline 값은 high만 빠르게 편집하며 전체 파형은 low/timing도 함께 결정합니다.", null, null, state.settings.analysis === "transient") + field("지연 (s)", "pulseDelay", p.pulseDelay ?? "0") + field("상승시간 (s)", "pulseRise", p.pulseRise ?? "0") + field("하강시간 (s)", "pulseFall", p.pulseFall ?? "0") + field("펄스 폭 (s)", "pulseWidth", p.pulseWidth ?? "1") + field("주기 (s)", "pulsePeriod", p.pulsePeriod ?? "2");
    }
    html += `</fieldset><fieldset class="source-group${acActive ? " active-group" : ""}"><legend>AC 소신호 · 단일주파수</legend>`;
    html += `<p class="source-help">DC bias 주위의 별도 peak/cos 자극입니다. 크기 0이면 이 소스의 AC 자극이 없습니다. RMS=peak/√2이며 SIN 주파수가 AC 설정을 바꾸지 않습니다.</p>`;
    html += field(`AC peak 크기 (${unit}pk)`, "acMagnitude", p.acMagnitude ?? "0", "AC sweep와 지정 페이저에서만 사용됩니다.", null, null, acActive) + field("AC cos 위상(°)", "acPhase", p.acPhase ?? "0", "시간영역 SIN과 비교할 때 cos 위상 = sin 위상 − 90°입니다.", null, null, acActive);
    html += `</fieldset>`;
  }
  if (component.type === "D") html += field("포화전류 Is", "is", p.is ?? "1e-12") + field("방출계수 n", "n", p.n ?? "1");
  if (component.type === "OPAMP") html += field("개방루프 이득 A", "gain", p.gain ?? "100k", "현재는 유한 이득 간략 모델입니다. 이상형/실제형 선택, 전원·포화·slew rate·대역폭은 미구현입니다.");
  if (component.type === "OPAMP_IDEAL") html += `<div class="connection-detail status-referenced"><strong>이상 OP AMP</strong><span>pin 1: 비반전(+), pin 2: 반전(−), pin 3: 출력</span><small>입력전류 0, 출력저항 0, 유효한 선형 해에서 V+=V−인 MNA 제약입니다. rail·포화·대역폭·slew 제한이 없고 안정성을 판정하지 않습니다. 출력 전류의 양수는 출력→내부 기준 GND입니다.</small></div>`;
  if (component.type === "VCVS") html += field("전압 이득 g (V/V)", "g", p.g ?? "1", "pin 1/2=p/n 출력, pin 3/4=cp/cn 제어. V(p)-V(n)=g·(V(cp)-V(cn)); g는 무차원이며 0과 음수도 허용됩니다.");
  if (component.type === "VCCS") html += field("상호컨덕턴스 gm (S)", "gm", p.gm ?? "1mS", "pin 1→2 출력 전류가 gm·(V(cp)-V(cn))입니다. S/mS/µS 또는 단위 생략 SI를 사용하며 소문자 s는 허용하지 않습니다.");
  if (component.type === "CURRENT_SENSOR") html += `<div class="connection-detail status-referenced"><strong>0 V 전류 센서</strong><span>양의 센서 전류는 p(pin 1)→n(pin 2)입니다.</span><small>측정할 가지에 직렬로 배치하세요. 병렬 단락이나 자동 삽입은 하지 않습니다.</small></div>`;
  if (component.type === "CCCS") html += field("전류 이득 beta (A/A)", "beta", p.beta ?? "1", "출력 p→n 전류 = beta·direction·I(control). 무차원이며 0과 음수도 허용됩니다.");
  if (component.type === "CCVS") html += field("전달저항 rm (Ω)", "rm", p.rm ?? "1k", "V(p)-V(n) = rm·direction·I(control). Ω/ohm 또는 단위 생략을 허용합니다.");
  if (component.type === "CCCS" || component.type === "CCVS") {
    const control = controlReferenceModel(state.circuit, component);
    const options = [["", "제어 대상 선택"], ...control.targets.map((target) => [target.id, `${target.label} · ${target.type === "V" ? "독립 V" : "센서"}`])];
    html += `<div class="field"><label>제어 branch 영구 ID</label><select data-control-target>${options.map(([id, label]) => `<option value="${escapeHtml(id)}"${component.control?.elementId === id ? " selected" : ""}>${escapeHtml(label)}</option>`).join("")}</select><span class="field-help">표시 이름이나 배열 순서가 아니라 component ID를 저장합니다.</span></div>`;
    html += `<div class="field"><label>제어 방향</label><select data-control-direction><option value="1"${component.control?.direction === 1 ? " selected" : ""}>+1 · 대상 p→n 그대로</option><option value="-1"${component.control?.direction === -1 ? " selected" : ""}>−1 · 반전</option></select><span class="field-help">일반 복제는 외부 대상 ID를 유지합니다. Shift+복제는 대상과 내부 배선을 함께 새 ID로 복제합니다.</span></div>`;
    if (control.status !== "valid") html += `<div class="connection-detail status-analysis-floating"><strong>제어 참조 오류</strong><span>${escapeHtml(control.reason)}</span><small>실행·정상 JSON 저장은 차단됩니다.</small></div>`;
  }
  if (component.type === "GND") html += `<p class="field-help">이 핀이 모든 전압 해석의 0 V 기준입니다.</p>`;
  const savedFocus = captureInspectorFocus();
  elements["inspector-content"].innerHTML = html;
  applyInputDrafts(elements["inspector-content"], "prop", component);
  elements["inspector-content"].querySelectorAll("[data-prop-slider]").forEach((slider) => {
    slider.addEventListener("input", () => {
      const input = elements["inspector-content"].querySelector(`[data-prop="${slider.dataset.propSlider}"]`);
      input.value = engineering(10 ** Number(slider.value)).replace(" ", "");
      input.classList.add("input-editing");
      inputDrafts.set("prop", component.id, slider.dataset.propSlider, input.value, component.props[slider.dataset.propSlider]);
      setStatus("입력 중", "running");
      markInputDirty();
    });
    slider.addEventListener("change", () => {
      const input = elements["inspector-content"].querySelector(`[data-prop="${slider.dataset.propSlider}"]`);
      input.dispatchEvent(new Event("change"));
    });
  });
  elements["inspector-content"].querySelectorAll("[data-prop]").forEach((control) => {
    const commitControl = () => {
      if (!isCircuitUiActive()) return;
      const current = state.circuit.components.find((item) => item.id === selected.id);
      if (!current) return;
      inputDrafts.set("prop", current.id, control.dataset.prop, control.value, current.props[control.dataset.prop]);
      if (current.props[control.dataset.prop] === control.value) { inputDrafts.delete("prop", current.id, control.dataset.prop); updateDraftNotice(); scheduleAutoRun(); return; }
      if (control.dataset.prop !== "ref") {
        const classified = controlledSourceInputModel(current.type, control.value) ?? classifyNumericInput(control.value, { positive: ["R", "C", "L"].includes(current.type) && control.dataset.prop === "value" });
        if (classified.status !== "valid" && control.tagName !== "SELECT") {
          control.classList.add(classified.status === "editing" ? "input-editing" : "input-invalid");
          setStatus(classified.status === "editing" ? "입력 중" : "잘못된 값", classified.status === "editing" ? "running" : "error");
          elements["csv-button"].disabled = true;
          return;
        }
      }
      inputDrafts.delete("prop", current.id, control.dataset.prop);
      mutate(() => { current.props[control.dataset.prop] = control.value; });
      if (control.dataset.prop === "mode") renderInspector();
    };
    if (control.tagName === "INPUT") control.addEventListener("input", () => {
      inputDrafts.set("prop", component.id, control.dataset.prop, control.value, component.props[control.dataset.prop]);
      const classified = control.dataset.prop === "ref" ? { status: "valid" } : controlledSourceInputModel(component.type, control.value) ?? classifyNumericInput(control.value, { positive: ["R", "C", "L"].includes(component.type) && control.dataset.prop === "value" });
      control.classList.toggle("input-editing", classified.status === "editing");
      control.classList.toggle("input-invalid", classified.status === "invalid");
      setStatus(classified.status === "valid" ? "입력 대기" : classified.status === "editing" ? "입력 중" : "잘못된 값", classified.status === "invalid" ? "error" : "running");
      markInputDirty();
    });
    control.addEventListener("change", commitControl);
    control.addEventListener("blur", commitControl);
    control.addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); control.blur(); }
    });
  });
  const controlTarget = elements["inspector-content"].querySelector("[data-control-target]");
  const controlDirection = elements["inspector-content"].querySelector("[data-control-direction]");
  const commitControlReference = () => {
    if (!isCircuitUiActive()) return;
    const current = state.circuit.components.find((item) => item.id === selected.id);
    if (!current || !["CCCS", "CCVS"].includes(current.type)) return;
    mutate(() => {
      current.control = { kind: "branchCurrent", elementId: controlTarget.value, direction: Number(controlDirection.value) };
    });
  };
  controlTarget?.addEventListener("change", commitControlReference);
  controlDirection?.addEventListener("change", commitControlReference);
  restoreInspectorFocus(savedFocus);
}

function settingField(label, key, value) {
  const slider = state.learningId && key === "phasorFrequency"
    ? `<input type="range" data-setting-slider="${key}" min="0" max="5" step="0.02" value="${Math.log10(Math.max(1, parseValue(value)))}" aria-label="페이저 주파수 빠른 조절"/>`
    : "";
  return `<label>${label}${slider}<input data-setting="${key}" value="${escapeHtml(value)}" autocomplete="off" /></label>`;
}

function renderAnalysisSettings() {
  if (!circuitWorkspaceActive) { circuitRenderDeferred = true; return; }
  elements["analysis-type"].value = state.settings.analysis;
  if (state.settings.analysis === "dc") {
    elements["analysis-settings"].innerHTML = "";
    elements["analysis-note"].textContent = "현재 DC 동작점 · source DC bias 사용 · C 개방/L 단락. SIN/PULSE/AC 값은 보존됩니다.";
  } else if (state.settings.analysis === "transient") {
    elements["analysis-settings"].innerHTML = settingField("시작", "start", state.settings.start) + settingField("끝", "end", state.settings.end) + settingField("간격", "step", state.settings.step);
    elements["analysis-note"].textContent = "현재 시간영역 · DC/SIN/PULSE 사용 · SIN 주파수는 AC 설정과 독립 · C 전압/L 전류 IC 지원";
  } else {
    elements["analysis-settings"].innerHTML = settingField("시작 Hz", "startFrequency", state.settings.startFrequency) + settingField("끝 Hz", "endFrequency", state.settings.endFrequency) + settingField("점/dec", "pointsPerDecade", state.settings.pointsPerDecade) + settingField("페이저 Hz", "phasorFrequency", state.settings.phasorFrequency ?? "159.155");
    elements["analysis-note"].textContent = "현재 AC 소신호 · source AC peak/cos 사용 · SIN 주파수와 독립 · RMS=peak/√2";
  }
  if (state.learningId === "parallel-sine") {
    const learningNotes = {
      dc: "비교 학습 · DC에서는 V의 DC bias와 L의 0 V 단락이 동시에 성립해야 합니다. 이상 L에 비영 DC 전압을 걸면 정상상태 해가 없습니다.",
      transient: "비교 학습 · 2 Vpk/1 kHz SIN, C IC=0 V, L IC=0 A. L 전류는 0…63.662 mA이며 +31.831 mA offset이 남습니다. dt를 줄여도 물리적 offset은 사라지지 않습니다.",
      ac: "비교 학습 · AC 2 Vpk∠−90°(cos)와 1 kHz. L 정상상태 전류는 31.831 mApk∠±180°. transient와 비교하려면 L IC=−31.831 mA가 필요합니다.",
    };
    elements["analysis-note"].textContent = learningNotes[state.settings.analysis];
  }
  applyInputDrafts(elements["analysis-settings"], "setting");
  elements["analysis-settings"].querySelectorAll("[data-setting]").forEach((input) => {
    const commitSetting = () => {
      if (!isCircuitUiActive()) return;
      inputDrafts.set("setting", null, input.dataset.setting, input.value, state.settings[input.dataset.setting]);
      if (state.settings[input.dataset.setting] === input.value) { updateDraftNotice(); scheduleAutoRun(); return; }
      const classified = classifyNumericInput(input.value, { positive: input.dataset.setting !== "start" });
      if (classified.status !== "valid") {
        input.classList.add(classified.status === "editing" ? "input-editing" : "input-invalid");
        setStatus(classified.status === "editing" ? "입력 중" : "잘못된 값", classified.status === "invalid" ? "error" : "running");
        elements["csv-button"].disabled = true;
        return;
      }
      inputDrafts.delete("setting", null, input.dataset.setting);
      mutate(() => {
        state.settings[input.dataset.setting] = input.value;
        state.manualSettingKeys.add(input.dataset.setting);
        state.intent = "manual";
      });
    };
    input.addEventListener("input", () => {
      inputDrafts.set("setting", null, input.dataset.setting, input.value, state.settings[input.dataset.setting]);
      const classified = classifyNumericInput(input.value, { positive: input.dataset.setting !== "start" });
      input.classList.toggle("input-editing", classified.status === "editing");
      input.classList.toggle("input-invalid", classified.status === "invalid");
      setStatus(classified.status === "valid" ? "입력 대기" : classified.status === "editing" ? "입력 중" : "잘못된 값", classified.status === "invalid" ? "error" : "running");
      markInputDirty();
    });
    input.addEventListener("change", commitSetting);
    input.addEventListener("blur", commitSetting);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); input.blur(); }
    });
  });
  elements["analysis-settings"].querySelectorAll("[data-setting-slider]").forEach((slider) => {
    slider.addEventListener("input", () => {
      const input = elements["analysis-settings"].querySelector(`[data-setting="${slider.dataset.settingSlider}"]`);
      input.value = Number((10 ** Number(slider.value)).toPrecision(6)).toString();
      input.classList.add("input-editing");
      inputDrafts.set("setting", null, slider.dataset.settingSlider, input.value, state.settings[slider.dataset.settingSlider]);
      setStatus("입력 중", "running");
      markInputDirty();
    });
    slider.addEventListener("change", () => {
      const input = elements["analysis-settings"].querySelector(`[data-setting="${slider.dataset.settingSlider}"]`);
      input.dispatchEvent(new Event("change"));
    });
  });
  elements["ac-view-toggle"].classList.toggle("hidden", state.settings.analysis !== "ac");
}


function renderProbes() {
  if (!state.probes.length) {
    elements["probe-list"].innerHTML = `<span class="probe-empty">추가된 프로브 없음</span>`;
    return;
  }
  const visibleProbes = state.probes.map(presentProbe).filter(Boolean);
  const seriesByKey = new Map(seriesForProbes(visibleProbes).map((item) => [item.probe.key, item]));
  const chips = visibleProbes.map((probe) => {
    const series = seriesByKey.get(probe.key);
    const unit = series?.unit ?? (probe.kind === "voltage" ? "V" : "A");
    const reading = state.result?.analysis === "dc" && series ? displayNumber(series.values[0], unit) : unit;
    return `<span class="probe-chip" data-probe-key="${escapeHtml(probe.key)}" title="우클릭하면 이 프로브만 제거" style="--chip-color:${traceColor(probe.color)}"><i></i><span>${escapeHtml(probe.label)}</span><small>${reading}</small><button data-remove-probe="${escapeHtml(probe.key)}" type="button" aria-label="프로브 제거">×</button></span>`;
  }).join("");
  const guide = visibleProbes.some((probe) => probe.kind === "current")
    ? `<span class="current-direction-note">${escapeHtml(currentDirectionGuide(state.result?.analysis ?? state.settings.analysis))}</span>`
    : "";
  elements["probe-list"].innerHTML = `${chips}${guide}`;
  elements["probe-list"].querySelectorAll("[data-remove-probe]").forEach((button) => button.addEventListener("click", () => removeProbe(button.dataset.removeProbe)));
  elements["probe-list"].querySelectorAll("[data-probe-key]").forEach((chip) => chip.addEventListener("contextmenu", (event) => {
    openProbeContextMenu(probeKeysForTarget(state.probes, { kind: "chip", key: chip.dataset.probeKey }), event);
  }));
}


function displayNumber(value, unit) {
  if (!Number.isFinite(value)) return `— ${unit}`;
  return `${Number(value.toPrecision(6))} ${unit}`;
}

// The phasor view is expensive and only meaningful while its panel is open; a hidden panel is
// marked dirty and flushed by panels' onChange / the next full render once it becomes visible.
let phasorDirty = false;
function phasorPanelVisible() { return !panels || panels.isOpen("phasor"); }
function renderPhasorLearning() {
  if (!phasorPanelVisible()) { phasorDirty = true; return; }
  phasorDirty = false;
  phasorView.render();
}

function rawSeriesForProbe(probe) {
  if (!state.result) return null;
  if (probe.kind === "voltage") {
    const node = probe.junctionId !== undefined
      ? state.result.topology.nodeIdByJunction?.[probe.junctionId]
      : state.result.topology.nodeIdByPin[`${probe.componentId}:${probe.pin}`];
    if (node === undefined) return null;
    const raw = state.result.points.map((point) => point.nodeVoltages[node]);
    return { probe, raw, baseUnit: "V" };
  }
  const raw = state.result.points.map((point) => point.componentCurrents[probe.componentId]);
  if (raw.some((value) => value === undefined)) return null;
  return { probe, raw, baseUnit: "A" };
}

function presentProbe(probe) {
  if (!probe || probe.kind !== "current") return probe;
  const component = state.circuit.components.find((item) => item.id === probe.componentId);
  if (component) probe.label = currentProbeLabel(component, circuitGeometryVersion(state.circuit));
  return probe;
}

function seriesForProbes(probes = state.probes) {
  const presented = probes.map(presentProbe).filter(Boolean);
  const signature = `${state.acView}:${JSON.stringify(presented)}`;
  if (seriesCache?.result === state.result && seriesCache.signature === signature) return seriesCache.series;
  const rawSeries = presented.map(rawSeriesForProbe).filter(Boolean);
  const currentScale = currentDisplayScale(rawSeries.filter((item) => item.baseUnit === "A").map((item) => item.raw));
  const series = rawSeries.map((item) => makeSeries(item.probe, item.raw, item.baseUnit, currentScale));
  seriesCache = { result: state.result, signature, series };
  return series;
}


function makeSeries(probe, raw, unit, currentScale) {
  if (state.result.analysis === "ac") {
    const magnitude = raw.map((value) => acMagnitudeLevel(value, unit));
    const phase = raw.map(acPhaseDegrees);
    return {
      probe,
      raw,
      values: state.acView === "magnitude" ? magnitude.map((item) => item.value) : phase,
      unit: state.acView === "magnitude" ? magnitude[0].unit : "°",
      scale: 1,
    };
  }
  const scale = unit === "A" ? currentScale.scale : 1;
  const displayUnit = unit === "A" ? currentScale.unit : unit;
  return { probe, raw, values: raw.map((value) => value * scale), unit: displayUnit, scale };
}

function renderPlot() {
  if (!circuitWorkspaceActive) { circuitRenderDeferred = true; return; }
  const series = seriesForProbes();
  const hasData = Boolean(state.result && series.length);
  elements["plot-empty"].classList.toggle("hidden", hasData);
  elements["csv-button"].disabled = !hasData || state.stale || state.runState.status !== "success";
  const viewSeries = series.map((item) => ({
    key: item.probe.key, label: item.probe.label, color: item.probe.color,
    quantity: state.result?.analysis === "ac" ? item.unit : item.probe.kind === "voltage" ? "V" : "A",
    values: state.result?.analysis === "ac" ? item.values : item.raw,
  }));
  scopeView.setData(state.result, viewSeries, state.stale || state.runState.status === "stale");
  if (!hasData) {
    const availability = resultAvailabilityText(state.runState, state.settings.analysis, state.probes.length);
    elements["plot-empty"].querySelector("span").textContent = availability
      ?? (state.result ? "표시할 프로브를 회로에 놓으세요." : "회로에 V 또는 I 프로브를 놓으세요.");
    elements["cursor-readout"].textContent = availability ?? "프로브를 추가하면 눈금이 자동으로 맞춰집니다.";
  }
}

function portEndpointLabel(endpoint) {
  if (!endpoint) return "미선택";
  if (endpoint.junctionId !== undefined) return `접속점 ${endpoint.junctionId}`;
  const component = state.circuit.components.find((item) => item.id === endpoint.componentId);
  return `${component?.props?.ref ?? endpoint.componentId}.${Number(endpoint.pin) + 1}`;
}

function beginPortPick(which) {
  setTool("select");
  state.port.mode = which === "p" ? "pick-p" : "pick-n";
  elements["tool-hint"].textContent = `DC 포트 ${which}로 사용할 핀 또는 명시적 접속점을 클릭하세요.`;
  renderPortPanel();
  renderCanvas();
}

function toggleSelectedPortLoad() {
  if (state.selected?.kind !== "component") return;
  const id = state.selected.id;
  const component = state.circuit.components.find((item) => item.id === id);
  if (!component || pinCount(component.type) !== 2 || component.type === "GND") return;
  invalidateActiveAnalysis("port-load-changed");
  const index = state.port.loadIds.indexOf(id);
  if (index >= 0) state.port.loadIds.splice(index, 1);
  else state.port.loadIds.push(id);
  state.port.result = null;
  state.port.error = null;
  state.port.stale = false;
  renderPortPanel();
}

function renderPortPanel() {
  if (!circuitWorkspaceActive) { circuitRenderDeferred = true; return; }
  if (!elements["port-panel"]) return;
  elements["port-p-button"].classList.toggle("active", state.port.mode === "pick-p");
  elements["port-n-button"].classList.toggle("active", state.port.mode === "pick-n");
  elements["port-selection"].textContent = `p: ${portEndpointLabel(state.port.p)} · n: ${portEndpointLabel(state.port.n)}`;
  const selected = state.selected?.kind === "component" ? state.circuit.components.find((item) => item.id === state.selected.id) : null;
  const canLoad = selected && pinCount(selected.type) === 2 && selected.type !== "GND";
  elements["port-load-button"].disabled = !canLoad;
  elements["port-load-button"].textContent = canLoad && state.port.loadIds.includes(selected.id) ? "선택 부하 제외 해제" : "선택 부하 제외";
  elements["port-loads"].textContent = state.port.loadIds.length
    ? `제외 부하: ${state.port.loadIds.map((id) => state.circuit.components.find((item) => item.id === id)?.props?.ref ?? id).join(", ")}`
    : "제외 부하 없음";
  elements["port-run-button"].disabled = Boolean(activeAnalysisJob) || !state.port.p || !state.port.n;
  elements["port-status"].textContent = activeAnalysisJob?.kind === "port" ? "DC 포트 계산 중…" : state.port.stale ? "회로가 변경되어 이전 포트 결과가 오래되었습니다." : state.port.error ? "포트 분석 오류" : state.port.result ? "현재 회로 snapshot 결과" : "DC 선형 회로 전용";
  elements["port-status"].className = state.port.stale ? "port-status stale" : state.port.error ? "port-status error" : "port-status";
  if (state.port.error) {
    elements["port-result"].innerHTML = `<strong>${escapeHtml(state.port.error.code ?? "PORT_ERROR")}</strong><span>${escapeHtml(state.port.error.message)}</span><small>${escapeHtml(state.port.error.hint ?? "")}</small>`;
    return;
  }
  const formatted = formatPortResult(state.port.result);
  if (!formatted) {
    elements["port-result"].innerHTML = `<span>p/n과 필요하면 외부 부하를 선택한 뒤 DC 등가 실행을 누르세요.</span>`;
    return;
  }
  const details = formatted.details.length ? `<ul class="port-details">${formatted.details.map((detail) => `<li>${escapeHtml(detail)}</li>`).join("")}</ul>` : "";
  elements["port-result"].innerHTML = `<div><small>Vth</small><strong>${escapeHtml(formatted.vth.text)}</strong></div><div><small>Rth</small><strong>${escapeHtml(formatted.rth.text)}</strong></div><div><small>In</small><strong>${escapeHtml(formatted.in.text)}</strong></div>${details}<p>${escapeHtml(formatted.equation)} · Norton 내부원 n→p, 단락전류 p→n</p>`;
}

function portSelectionSnapshot() {
  return JSON.stringify({ p: state.port.p, n: state.port.n, externalLoadIds: state.port.loadIds });
}

async function runPortAnalysis() {
  if (!commitPendingInputs() || !state.port.p || !state.port.n) return;
  invalidateActiveAnalysis("replaced-by-port-run");
  const generation = state.generation;
  const serial = ++state.runSerial;
  const circuit = structuredClone(state.circuit);
  const request = structuredClone({ p: state.port.p, n: state.port.n, externalLoadIds: state.port.loadIds });
  const selectionSnapshot = portSelectionSnapshot();
  state.port.error = null;
  state.port.stale = false;
  const workerRequest = analysisWorkerClient.start("port", { circuit, request });
  activeAnalysisJob = { kind: "port", serial, requestId: workerRequest.requestId, generation, selectionSnapshot };
  updateAnalysisControls();
  renderPortPanel();
  setStatus("DC 포트 계산 중…", "running");
  try {
    const result = await workerRequest.promise;
    if (serial !== state.runSerial || generation !== state.generation || selectionSnapshot !== portSelectionSnapshot()) return;
    state.port.result = result;
    setStatus("DC 포트 등가 완료", "ready");
  } catch (error) {
    if (error instanceof AnalysisCancelledError || serial !== state.runSerial || generation !== state.generation || selectionSnapshot !== portSelectionSnapshot()) return;
    state.port.result = null;
    state.port.error = { name: error?.name, code: error?.code ?? "PORT_ERROR", message: error?.message ?? String(error), hint: error?.hint ?? "", details: error?.details ?? null };
    setStatus("DC 포트 등가 실패", "error");
  } finally {
    if (serial === state.runSerial && activeAnalysisJob?.requestId === workerRequest.requestId) {
      activeAnalysisJob = null;
      updateAnalysisControls();
      renderPortPanel();
    }
  }
  renderPortPanel();
}


function renderAll() {
  if (!circuitWorkspaceActive) { circuitRenderDeferred = true; return; }
  circuitRenderDeferred = false;
  updateDraftNotice(false);
  renderCanvas();
  renderInspector();
  renderAnalysisSettings();
  renderProbes();
  renderPlot();
  renderPhasorLearning();
  renderPortPanel();
  if (state.runState.status === "error" && state.runState.error) renderFailureDiagnostic(state.runState.error);
  elements["undo-button"].disabled = state.history.length === 0;
  elements["redo-button"].disabled = state.future.length === 0;
  elements["rotate-button"].disabled = state.selected?.kind !== "component";
  elements["clone-button"].disabled = state.selected?.kind !== "component";
  elements["delete-button"].disabled = !state.selected;
  elements["stale-badge"].classList.toggle("hidden", !(state.stale || state.runState.status === "stale"));
  document.querySelectorAll("[data-learning-example]").forEach((button) => button.classList.toggle("active", button.dataset.learningExample === state.learningId));
  updateAnalysisControls();
}

function scheduleAutoRun() {
  cancelScheduledRun();
  if (!state.autoUpdate) { elements["auto-update-status"].textContent = "수동 실행"; return; }
  if (!state.circuit.components.length) { elements["auto-update-status"].textContent = "회로 작성 중"; return; }
  if (inputDrafts.size || state.inlineEdit || document.querySelector(".input-invalid, .input-editing")) {
    elements["auto-update-status"].textContent = "입력 완료 후 자동 갱신"; return;
  }
  try {
    const status = currentConnections();
    if ((status.counts.unwired ?? 0) || (status.counts["no-ground"] ?? 0)) {
      elements["auto-update-status"].textContent = "연결 완료 후 자동 갱신"; return;
    }
  } catch { return; }
  const generation = state.generation;
  state.autoRequestedAt = performance.now();
  const requestedAt = state.autoRequestedAt;
  elements["auto-update-status"].textContent = "자동 갱신 대기";
  state.autoTimer = setTimeout(() => runAnalysis({ automatic: true, generation, requestedAt }), 250);
}


function renderFailureDiagnostic(error) {
  if (!circuitWorkspaceActive) { circuitRenderDeferred = true; return; }
  const diagnostic = describeCircuitFailure(state.circuit, state.settings, error);
  const constraints = diagnostic.constraints.length
    ? `<div class="diagnostic-constraints">${diagnostic.constraints.map((constraint) => `<button type="button" data-diagnostic-component="${escapeHtml(constraint.componentId)}"><b>${escapeHtml(constraint.ref)}</b><span>${escapeHtml(constraint.text)}</span></button>`).join("")}</div>`
    : diagnostic.relatedComponentIds.length
      ? `<div class="diagnostic-constraints">${diagnostic.relatedComponentIds.map((componentId) => { const component = state.circuit.components.find((item) => item.id === componentId); return `<button type="button" data-diagnostic-component="${escapeHtml(componentId)}"><b>${escapeHtml(component?.props?.ref ?? componentId)}</b><span>ID ${escapeHtml(componentId)} 선택</span></button>`; }).join("")}</div>`
      : "";
  elements["error-box"].innerHTML = `<div class="diagnostic-heading"><span>${escapeHtml(diagnostic.analysis)}</span><span class="certainty-${diagnostic.certainty}">${escapeHtml(diagnostic.certaintyLabel)}</span><code>${escapeHtml(diagnostic.code)}</code></div><strong>${escapeHtml(diagnostic.message)}</strong>${constraints}<p>${escapeHtml(diagnostic.hint)}</p>`;
  elements["error-box"].classList.remove("hidden");
  elements["error-box"].querySelectorAll("[data-diagnostic-component]").forEach((button) => button.addEventListener("click", () => {
    state.selected = { kind: "component", id: button.dataset.diagnosticComponent };
    renderAll();
    setStatus(`${button.querySelector("b")?.textContent ?? button.dataset.diagnosticComponent} 진단 대상 선택`, "error");
  }));
}

async function runAnalysis({ automatic = false, generation = null, requestedAt = performance.now() } = {}) {
  if (automatic && (generation !== state.generation || !state.autoUpdate)) return;
  cancelScheduledRun();
  if (!commitPendingInputs()) return;
  synchronizeIntent();
  invalidateActiveAnalysis("replaced-by-normal-run");
  generation = state.generation;
  const serial = ++state.runSerial;
  const circuit = structuredClone(state.circuit);
  const settings = structuredClone(state.settings);
  const startedAt = requestedAt;
  state.runState = { status: "running", analysis: state.settings.analysis, generation, error: null };
  setStatus(automatic ? "자동 계산 중…" : "계산 중…", "running");
  if (automatic) elements["auto-update-status"].textContent = "자동 계산 중";
  elements["error-box"].classList.add("hidden");
  await new Promise((resolve) => { requestAnimationFrame(resolve); setTimeout(resolve, 50); });
  if (serial !== state.runSerial || !acceptsRunGeneration(generation, state.generation)) return;
  const workerRequest = analysisWorkerClient.start("normal", { circuit, settings });
  activeAnalysisJob = { kind: "normal", serial, requestId: workerRequest.requestId, generation };
  updateAnalysisControls();
  try {
    const { result, phasorResult } = await workerRequest.promise;
    if (serial !== state.runSerial || !acceptsRunGeneration(generation, state.generation)) return;
    state.result = result;
    state.phasorResult = phasorResult;
    state.stale = false;
    state.view = { min: 0, max: 1 };
    state.cursorIndex = state.result.xValues.length > 1 ? state.result.xValues.length - 1 : 0;
    state.runState = { status: "success", analysis: state.settings.analysis, generation: state.generation, error: null };
    const points = state.result.points.length;
    elements["result-summary"].textContent = `${state.settings.analysis === "dc" ? "DC 동작점" : state.settings.analysis === "transient" ? "시간응답" : "AC 주파수"} · ${points.toLocaleString()}개 점 · 현재 회로 결과`;
    state.lastRunMs = performance.now() - startedAt;
    setStatus(automatic ? "최신 결과 · 자동" : "해석 완료", "ready");
    elements["auto-update-status"].textContent = `완료 · ${state.lastRunMs.toFixed(1)} ms${state.autoUpdate ? " · 자동 갱신" : ""}`;
    renderAll();
  } catch (error) {
    if (error instanceof AnalysisCancelledError) return;
    if (serial !== state.runSerial || !acceptsRunGeneration(generation, state.generation)) return;
    const known = error instanceof CircuitError || Boolean(error?.code);
    state.result = null;
    state.phasorResult = null;
    state.stale = false;
    state.cursorIndex = null;
    state.lastRunMs = null;
    state.runState = { status: "error", analysis: state.settings.analysis, generation: state.generation, error: known ? { code: error.code, message: error.message } : { code: "UNKNOWN", message: String(error) } };
    renderFailureDiagnostic(error);
    if (!automatic) panels?.set("analysis", false);
    elements["result-summary"].textContent = resultAvailabilityText(state.runState, state.settings.analysis, state.probes.length);
    setStatus("해석 실패", "error");
    if (state.learningId) elements["auto-update-status"].textContent = "학습 결과 없음 · 입력을 확인하세요";
    renderAll();
  } finally {
    if (serial === state.runSerial && activeAnalysisJob?.requestId === workerRequest.requestId) {
      activeAnalysisJob = null;
      updateAnalysisControls();
      if (state.runState.status === "running" && generation !== state.generation) state.runState.status = "stale";
      elements["stale-badge"].classList.toggle("hidden", !(state.stale || state.runState.status === "stale"));
    }
  }
}

function deleteSelection() {
  if (!state.selected) return;
  const selected = state.selected;
  if (state.inlineEdit?.componentId === selected.id) { state.inlineEdit = null; elements["inline-value-editor"].classList.add("hidden"); }
  mutate(() => {
    if (selected.kind === "component") {
      const deleted = deleteComponentFromCircuit(state.circuit, selected.id, state.probes);
      state.circuit = deleted.circuit;
      state.probes = deleted.probes;
    } else if (selected.kind === "junction") {
      const deleted = deleteJunctionFromCircuit(state.circuit, selected.id, state.probes);
      state.circuit = deleted.circuit;
      state.probes = deleted.probes;
    } else {
      state.circuit.wires = state.circuit.wires.filter((wire) => wire.id !== selected.id);
      state.probes = state.probes.filter((probe) => probe.wireId !== selected.id);
    }
    state.selected = null;
  });
}

function undo() {
  if (!state.history.length || !confirmDiscardDrafts()) return;
  state.future.push(snapshot());
  if (state.future.length > 100) state.future.shift();
  restore(state.history.pop());
}

function redo() {
  if (!state.future.length || !confirmDiscardDrafts()) return;
  state.history.push(snapshot());
  if (state.history.length > 100) state.history.shift();
  restore(state.future.pop());
}

function cloneSelection(event = null) {
  if (state.selected?.kind !== "component") return;
  const original = state.circuit.components.find((component) => component.id === state.selected.id);
  if (!original) return;
  const includeTarget = Boolean(event?.shiftKey && ["CCCS", "CCVS"].includes(original.type) && original.control?.elementId);
  const ids = includeTarget ? [original.control.elementId, original.id] : [original.id];
  const cloned = cloneComponentSet(state.circuit, ids);
  const selectedId = cloned.idMap.get(original.id);
  if (!selectedId) return;
  mutate(() => {
    state.circuit.components.push(...cloned.components);
    state.circuit.wires.push(...cloned.wires);
    state.selected = { kind: "component", id: selectedId };
  });
  setStatus(includeTarget ? "제어 대상·종속원 원자 복제 완료" : "부품 복제 완료 · 외부 제어 ID 유지", "ready");
}

function zoomCanvas(factor, anchor = { x: state.canvasView.x + state.canvasView.width / 2, y: state.canvasView.y + state.canvasView.height / 2 }) {
  const old = state.canvasView;
  const width = Math.max(CANVAS_VIEW_MIN_WIDTH, Math.min(CANVAS_VIEW_MAX_WIDTH, old.width * factor));
  const height = width * (old.height / old.width);
  const xRatio = (anchor.x - old.x) / old.width;
  const yRatio = (anchor.y - old.y) / old.height;
  state.canvasView = { x: anchor.x - width * xRatio, y: anchor.y - height * yRatio, width, height };
  updateCanvasView();
}

function fitCanvas() {
  const points = [
    ...state.circuit.components.map((component) => ({ x: component.x, y: component.y })),
    ...(state.circuit.junctions ?? []).map((junction) => ({ x: junction.x, y: junction.y })),
    ...state.circuit.wires.flatMap((wire) => wire.waypoints ?? []),
  ];
  if (!points.length) state.canvasView = { x: 0, y: 0, width: 760, height: 500 };
  else {
    const minX = Math.min(...points.map((point) => point.x)) - 90;
    const maxX = Math.max(...points.map((point) => point.x)) + 90;
    const minY = Math.min(...points.map((point) => point.y)) - 80;
    const maxY = Math.max(...points.map((point) => point.y)) + 80;
    const width = Math.max(260, maxX - minX);
    const height = Math.max(171, maxY - minY);
    const canvas = elements["circuit-canvas"];
    const aspect = canvas.clientWidth > 0 && canvas.clientHeight > 0 ? canvas.clientWidth / canvas.clientHeight : 760 / 500;
    if (width / height > aspect) state.canvasView = { x: minX, y: (minY + maxY) / 2 - width / aspect / 2, width, height: width / aspect };
    else state.canvasView = { x: (minX + maxX) / 2 - height * aspect / 2, y: minY, width: height * aspect, height };
  }
  renderCanvas();
}

function setInspectorCollapsed(collapsed) {
  panels?.set("inspector", collapsed);
}

function loadExample(id) {
  if (!id) return;
  if (!confirmDiscardDrafts()) { elements["example-select"].value = ""; return; }
  const example = cloneExample(id);
  const manualSettings = Object.fromEntries([...state.manualSettingKeys]
    .filter((key) => key !== "analysis" && state.settings[key] !== undefined)
    .map((key) => [key, state.settings[key]]));
  const defaults = {
    divider: [{ kind: "voltage", componentId: "R2", pin: 0 }, { kind: "current", componentId: "R1" }],
    "rc-charge": [{ kind: "voltage", componentId: "C1", pin: 0 }, { kind: "current", componentId: "R1" }],
    "rc-lowpass": [{ kind: "voltage", componentId: "C1", pin: 0 }, { kind: "current", componentId: "C1" }],
    rl: [{ kind: "current", componentId: "L1" }], rlc: [{ kind: "voltage", componentId: "C1", pin: 0 }],
    "parallel-sine": [{ kind: "voltage", componentId: "V1", pin: 0 }, { kind: "current", componentId: "L1" }],
    diode: [{ kind: "voltage", componentId: "R1", pin: 0 }], opamp: [{ kind: "voltage", componentId: "U1", pin: 2 }],
  };
  mutate(() => {
    resetProjectSession();
    state.intent = "manual";
    state.circuit = { ...example.circuit, junctions: example.circuit.junctions ?? [] };
    state.settings = { ...state.settings, ...example.settings, ...manualSettings };
    state.title = example.name;
    state.subtitle = example.description;
    state.probes = (defaults[id] ?? []).map((probe, index) => {
      const component = state.circuit.components.find((item) => item.id === probe.componentId);
      return probe.kind === "voltage"
        ? { ...probe, key: `V:${probe.componentId}:${probe.pin}`, label: `V(${component.props.ref}.${probe.pin + 1})`, color: COLORS[index] }
        : { ...probe, key: `I:${probe.componentId}`, label: currentProbeLabel(component, circuitGeometryVersion(state.circuit)), color: COLORS[index] };
    });
    state.selected = null;
    state.learningId = ["rc-lowpass", "rl", "rlc", "parallel-sine"].includes(id) ? id : null;
    state.result = null;
    state.phasorResult = null;
    state.stale = false;
    state.runState = { status: "not-run", analysis: null, generation: null, error: null };
    state.cursorIndex = null;
    elements["result-summary"].textContent = state.learningId ? "학습 예제 준비 · 자동 계산을 기다립니다." : "예제를 불러왔습니다. 해석 실행으로 계산하세요.";
  });
  elements["example-select"].value = "";
  setStatus(state.learningId ? "학습 자동 갱신 대기" : "예제 준비", "ready");
  setTool("select");
  fitCanvas();
}

function saveProject() {
  if (!commitPendingInputs()) return;
  let text;
  try {
    text = serializeProject({ title: state.title, subtitle: state.subtitle, circuit: state.circuit, settings: state.settings, probes: state.probes });
  } catch (error) {
    setStatus(`저장 차단 · ${error.message}`, "error");
    return;
  }
  const blob = new Blob([text], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${state.title.replace(/[^\p{L}\p{N}_-]+/gu, "-") || "circuit"}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  setStatus("JSON 저장 완료", "ready");
}

async function loadProject(file) {
  const importGeneration = state.generation;
  try {
    const project = deserializeProject(await file.text(), state.settings);
    if (state.generation !== importGeneration) throw new Error("읽는 동안 회로가 변경되어 불러오기를 취소했습니다. 파일을 다시 선택하세요.");
    if (!confirmDiscardDrafts()) return;
    mutate(() => {
      resetProjectSession();
      state.intent = "manual";
      state.circuit = { ...project.circuit, junctions: project.circuit.junctions ?? [] };
      state.circuit.components.forEach((component, index) => {
        component.props ??= {};
        component.x ??= 120 + (index % 5) * 120;
        component.y ??= 100 + Math.floor(index / 5) * 100;
      });
      if (project.wrapped) {
        state.settings = project.settings;
        state.manualSettingKeys = new Set(Object.keys(project.settings).filter((key) => key !== "analysis"));
        state.probes = project.probes;
        state.title = project.title ?? file.name.replace(/\.json$/i, "");
        state.subtitle = project.subtitle ?? "JSON에서 불러온 회로";
      } else {
        state.probes = [];
        state.title = file.name.replace(/\.json$/i, "");
        state.subtitle = "JSON에서 불러온 회로";
      }
      state.result = null;
      state.phasorResult = null;
      state.stale = false;
      state.runState = { status: "not-run", analysis: null, generation: null, error: null };
      state.cursorIndex = null;
      state.learningId = null;
      elements["result-summary"].textContent = "JSON에서 회로를 불러왔습니다. 해석 실행으로 계산하세요.";
    });
    setTool("select");
    fitCanvas();
    setStatus("JSON 불러오기 완료", "ready");
  } catch (error) {
    elements["error-box"].innerHTML = `<strong>JSON 불러오기 실패</strong>${escapeHtml(error.message)}`;
    elements["error-box"].classList.remove("hidden");
    setStatus("불러오기 실패", "error");
  }
}

function exportCSV() {
  if (!state.result || state.stale || state.runState.status !== "success") return;
  const series = seriesForProbes();
  const blob = new Blob([buildResultsCSV(state.result, series)], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `circuit-${state.result.analysis}-results.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  setStatus("CSV 저장 완료", "ready");
}

function capturePointer(element, pointerId) {
  try { element.setPointerCapture?.(pointerId); } catch { /* synthetic/ended pointers may not be capturable */ }
}

function releasePointer(element, pointerId) {
  try { if (element.hasPointerCapture?.(pointerId)) element.releasePointerCapture(pointerId); } catch { /* already released */ }
}

function beginCanvasPointer(event, payload) {
  if (state.pointerOwnerId !== null) return false;
  const session = beginPointerSession(state.drag, event.pointerId, { ...payload, startClient: payload.startClient ?? { x: event.clientX, y: event.clientY }, pointerType: event.pointerType });
  if (!session || session === state.drag) return false;
  state.drag = session;
  state.pointerOwnerId = event.pointerId;
  capturePointer(elements["circuit-canvas"], event.pointerId);
  return true;
}

function finishCanvasPointer(pointerId, reason = "commit") {
  const completed = finishPointerSession(state.drag, pointerId, reason);
  if (!completed.finished) return false;
  const drag = completed.finished;
  state.drag = null;
  state.pointerOwnerId = null;
  releasePointer(elements["circuit-canvas"], pointerId);
  if (reason !== "commit") {
    if (drag.kind === "pan") state.canvasView = { ...drag.originView };
    else {
      const item = drag.kind === "junction"
        ? (state.circuit.junctions ?? []).find((junction) => junction.id === drag.id)
        : state.circuit.components.find((component) => component.id === drag.id);
      if (item) { item.x = drag.origin.x; item.y = drag.origin.y; }
    }
    renderAll();
    return true;
  }
  if (!drag.moved && drag.kind !== "pan") {
    // Pointer capture retargets the subsequent click to the SVG root. Commit the
    // selection visuals here so a normal tap exposes its real delete button.
    state.ignoreClickUntil = performance.now() + 180;
    renderAll();
  }
  if (drag.moved) {
    state.ignoreClickUntil = performance.now() + 180;
    if (drag.kind !== "pan") {
      state.history.push(drag.before);
      if (state.history.length > 100) state.history.shift();
      state.future = [];
      state.generation += 1;
      markStale();
      renderAll();
      scheduleAutoRun();
    }
  }
  return true;
}

function updateCanvasPointer(event) {
  if (!ownsPointer(state.drag, event.pointerId)) return;
  const drag = state.drag;
  if (!drag.moved && !passedDragSlop(drag.startClient, { x: event.clientX, y: event.clientY }, drag.pointerType)) return;
  drag.moved = true;
  if (drag.kind === "pan") {
    state.canvasView.x = drag.originView.x - (event.clientX - drag.startClient.x) / drag.screenScale;
    state.canvasView.y = drag.originView.y - (event.clientY - drag.startClient.y) / drag.screenScale;
    updateCanvasView();
    return;
  }
  const point = svgPoint(event);
  if (!point) return;
  const item = drag.kind === "junction" ? (state.circuit.junctions ?? []).find(j => j.id === drag.id) : state.circuit.components.find(c => c.id === drag.id);
  if (!item) return;
  Object.assign(item, snapPoint({ x: drag.origin.x + point.x - drag.start.x, y: drag.origin.y + point.y - drag.start.y }));
  scheduleCanvasRender();
}

function pickTouchTarget(point) {
  const svg = elements["circuit-canvas"], matrix = svg.getScreenCTM();
  if (!matrix) return null;
  if (state.tool === "pan" || state.tool.startsWith("place:")) return { kind: "background" };
  const endpointMode = state.pendingPin || state.port.mode || ["wire", "voltage-probe"].includes(state.tool);
  const screen = p => new DOMPoint(p.x, p.y).matrixTransform(matrix);
  // Small connection badges have their own action, not an accidental pin action.
  const hitElement = document.elementFromPoint(point.x, point.y);
  const badge = hitElement?.closest("[data-show-connection]");
  const remove = hitElement?.closest("[data-delete-component]");
  const label = hitElement?.closest("[data-edit-prop]");
  if (!endpointMode && state.tool === "select" && remove) return {kind:"delete",id:remove.dataset.deleteComponent};
  if (!endpointMode && state.tool === "select" && label) return {kind:"properties",id:label.closest("[data-id]")?.dataset.id};
  if (!endpointMode && state.tool === "select" && badge) return { kind: "properties", id: badge.dataset.showConnection };
  if (!endpointMode) {
    let best = null, bestDistance = 23;
    for (const c of state.circuit.components) {
      const angle = (c.rotation ?? 0) * Math.PI / 180;
      const center = screen(c);
      const a = screen({ x:c.x - 30*Math.cos(angle), y:c.y - 30*Math.sin(angle) });
      const b = screen({ x:c.x + 30*Math.cos(angle), y:c.y + 30*Math.sin(angle) });
      const d = distanceToSegment(point, a, b);
      // Nearest center breaks overlap ties predictably, without DOM stacking.
      const score = d + Math.hypot(point.x-center.x,point.y-center.y)*.001;
      if (score < bestDistance) { bestDistance = score; best = { kind:"component", id:c.id }; }
    }
    if (best) return best;
  }
  const targets = [];
  const add = (world, target, radius) => { if (!world) return; const p = screen(world); targets.push({ ...target, x:p.x, y:p.y, radius }); };
  if (endpointMode) for (const c of state.circuit.components) for (let pin=0; pin<pinCount(c.type); pin++) add(pinPosition(c,pin), {kind:"pin",id:c.id,pin},22);
  if (state.tool !== "current-probe") for (const j of state.circuit.junctions ?? []) add(j,{kind:"junction",id:j.id},20);
  const nearest = nearestScreenTarget(point, targets);
  if (nearest) return nearest;
  if (state.tool !== "current-probe") {
    let hit = null, distance = 12;
    for (const wire of state.circuit.wires) {
      const pts = routeForWireId(wire.id).map(screen);
      for (let i=1;i<pts.length;i++) {
        const d = distanceToSegment(point,pts[i-1],pts[i]);
        if(d<distance){distance=d;hit={kind:"wire",id:wire.id};}
      }
    }
    if(hit)return hit;
  }
  return {kind:"background"};
}

function setupCanvasTouch() {
  const svg = elements["circuit-canvas"];
  canvasTouch = installCanvasTouch(svg, {
    canStart: () => state.pointerOwnerId === null,
    pick: pickTouchTarget,
    world: p => svgPoint({clientX:p.x,clientY:p.y}),
    view: () => ({...state.canvasView}),
    setView: view => { state.canvasView = view; updateCanvasView(); },
    begin: (event, target) => {
      if (!["select","pan"].includes(state.tool) || state.pendingPin || state.port.mode || !target) return;
      const point = svgPoint(event); if (!point) return;
      if (["component","junction"].includes(target.kind) && state.selected?.kind === target.kind && state.selected?.id === target.id && state.tool === "select") {
        const item = target.kind === "component" ? state.circuit.components.find(c=>c.id===target.id) : (state.circuit.junctions??[]).find(j=>j.id===target.id);
        if (item) beginCanvasPointer(event,{kind:target.kind,id:item.id,start:point,origin:{x:item.x,y:item.y},before:snapshot(),moved:false});
      } else if (["background","component","junction","wire"].includes(target.kind)) {
        // First swipe navigates. Only an already selected object can be dragged.
        const scale = svg.getScreenCTM()?.a;
        if(scale>0)beginCanvasPointer(event,{kind:"pan",screenScale:scale,originView:{...state.canvasView},moved:false});
      }
    },
    move: updateCanvasPointer,
    finish: finishCanvasPointer,
    tap: (event, target) => {
      const point = svgPoint(event); if(!target || !point || state.tool === "pan")return;
      if(target.kind === "delete") { if(state.selected?.kind === "component" && state.selected.id === target.id) deleteSelection(); return; }
      if(target.kind === "properties") { state.selected={kind:"component",id:target.id}; renderAll(); setInspectorCollapsed(false); return; }
      if(target.kind === "pin") { handlePinClick(target.id,target.pin); return; }
      if(target.kind === "junction") {
        if(state.tool === "voltage-probe") addVoltageProbeEndpoint({junctionId:target.id});
        else if(state.port.mode || state.tool === "wire" || state.pendingPin) handleEndpointClick({junctionId:target.id});
        else { state.selected={kind:"junction",id:target.id};renderAll(); }
        return;
      }
      if(target.kind === "component") {
        if(state.tool === "current-probe")addCurrentProbe(target.id);
        else {state.selected={kind:"component",id:target.id};renderAll();}
        return;
      }
      if(target.kind === "wire") {
        const wire=state.circuit.wires.find(w=>w.id===target.id); if(!wire)return;
        if(state.pendingPin)createJunctionAndConnect(wire.id,point);
        else if(state.tool === "voltage-probe")addVoltageProbeEndpoint(wire.a.componentId !== undefined ? wire.a : wire.b,wire.id);
        else if(state.tool === "select"){state.selected={kind:"wire",id:wire.id};renderAll();}
        return;
      }
      if(state.pendingPin)addPendingWaypoint(point);
      else if(state.tool.startsWith("place:"))placeComponent({clientX:event.clientX,clientY:event.clientY,target:svg.querySelector(".canvas-bg")});
      else if(state.tool === "select"){state.selected=null;renderAll();}
    },
  });
}

function updateCircuitCourseTop(){
  document.getElementById('circuit-course-shell').style.setProperty('--circuit-course-top',document.querySelector('.workspace-tabs').getBoundingClientRect().bottom+'px');
}
function showCircuitCourse(value){
  workspaceSwitching=true;
  canvasTouch?.cancel();if(state.drag)finishCanvasPointer(state.drag.pointerId,'cancel');cancelPlotSession();panels.cancelInteractions();
  circuitCourseActive=value;circuitWorkspaceActive=!value;document.body.dataset.circuitExperience=value?'course':'editor';
  const workbench=document.getElementById('workbench'),shelf=document.getElementById('panel-shelf'),shell=document.getElementById('circuit-course-shell');
  workbench.hidden=value;workbench.inert=value;shelf.hidden=value;shell.hidden=!value;shell.inert=!value;
  if(value){updateCircuitCourseTop();circuitCourse.activate();}
  else{circuitCourse.deactivate();panels.synchronize();if(circuitRenderDeferred)renderAll();else{updateCanvasView();scopeView.render();renderPhasorLearning();}}
  queueMicrotask(()=>{workspaceSwitching=false;});
}
function setupEvents() {
  document.getElementById('circuit-course-open').addEventListener('pointerdown',event=>{event.preventDefault();});
  document.getElementById('circuit-course-open').addEventListener('click',()=>showCircuitCourse(true));
  document.getElementById('circuit-course-back').addEventListener('click',()=>showCircuitCourse(false));
  window.addEventListener('resize',()=>{if(circuitCourseActive&&workspaceTabs.active==='circuit')updateCircuitCourseTop();});
  const chooseAC = () => {
    if (state.settings.analysis !== "ac") {
      elements["analysis-intent"].value = "ac";
      elements["analysis-intent"].dispatchEvent(new Event("change"));
    }
  };
  document.getElementById("phasor-ac-settings").addEventListener("click", () => {
    chooseAC(); elements["advanced-analysis"].open = true; panels.set("analysis", false);
  });
  document.getElementById("phasor-run").addEventListener("click", () => { chooseAC(); runAnalysis(); });
  // Keep focus on the draft until click discards it; native blur would commit first.
  document.getElementById("discard-drafts-button").addEventListener("pointerdown", (event) => {
    if (event.button === 0) event.preventDefault();
  });
  document.getElementById("discard-drafts-button").addEventListener("click", () => {
    discardingInputDrafts = true;
    try {
      inputDrafts.clear();
      state.inlineEdit = null;
      elements["inline-value-editor"].classList.add("hidden");
      renderAll();
    } finally {
      discardingInputDrafts = false;
    }
    scheduleAutoRun();
    setStatus("미확정 입력 취소", "ready");
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest("#probe-context-menu")) closeProbeContextMenu();
  });
  elements["inspector-content"].addEventListener("focusin", (event) => { inspectorLastFocused = event.target; });
  elements["inspector-content"].addEventListener("keydown", (event) => {
    if (event.key !== "Tab" || event.ctrlKey || event.altKey || event.metaKey) return;
    inspectorTabIntent = event.shiftKey ? -1 : 1;
    setTimeout(() => { inspectorTabIntent = 0; }, 0);
  }, true);
  document.querySelectorAll("[data-tool]").forEach((button) => button.addEventListener("click", () => setTool(button.dataset.tool)));
  elements["circuit-canvas"].addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || !["select", "pan"].includes(state.tool) || (state.tool !== "pan" && !event.target.classList.contains("canvas-bg")) || state.pendingPin) return;
    beginCanvasPointer(event, { kind: "pan", startClient: { x: event.clientX, y: event.clientY }, screenScale: elements["circuit-canvas"].getScreenCTM().a, originView: { ...state.canvasView }, moved: false });
  });
  elements["circuit-canvas"].addEventListener("click", (event) => {
    if (performance.now() < state.ignoreClickUntil) return;
    if (event.target.classList.contains("canvas-bg")) {
      if (state.pendingPin) {
        addPendingWaypoint(svgPoint(event));
        return;
      }
      placeComponent(event);
      if (state.tool === "select" && performance.now() >= state.ignoreClickUntil) { state.selected = null; renderAll(); }
    }
  });
  window.addEventListener("pointermove", (event) => {
    if (!circuitWorkspaceActive) return;
    if (state.pendingPin && event.isPrimary !== false && event.target.closest?.("#circuit-canvas")) {
      const point = svgPoint(event);
      if (point) { state.pointer = snapPoint(point); scheduleOverlayRender(); }
    }
    updateCanvasPointer(event);
  });
  window.addEventListener("pointerup", (event) => { if (circuitWorkspaceActive) finishCanvasPointer(event.pointerId, "commit"); });
  elements["circuit-canvas"].addEventListener("pointercancel", (event) => finishCanvasPointer(event.pointerId, "cancel"));
  elements["circuit-canvas"].addEventListener("lostpointercapture", (event) => finishCanvasPointer(event.pointerId, "lost-capture"));
  elements["circuit-canvas"].addEventListener("wheel", (event) => {
    event.preventDefault();
    const point = svgPoint(event);
    if (point) zoomCanvas(event.deltaY > 0 ? 1.18 : .84, point);
  }, { passive: false });
  elements["analysis-type"].addEventListener("change", () => mutate(() => { state.settings.analysis = elements["analysis-type"].value; state.intent = "manual"; }));
  elements["analysis-intent"].addEventListener("change", () => {
    const requestedIntent = elements["analysis-intent"].value;
    if (!commitPendingInputs()) { elements["analysis-intent"].value = state.intent; return; }
    mutate(() => { state.intent = requestedIntent; });
    if (state.intent === "manual") elements["advanced-analysis"].open = true;
  });
  elements["auto-update"].addEventListener("change", () => {
    state.autoUpdate = elements["auto-update"].checked;
    scheduleAutoRun();
  });
  elements["run-button"].addEventListener("click", runAnalysis);
  elements["cancel-analysis-button"].addEventListener("click", cancelActiveAnalysisFromUI);
  elements["port-p-button"].addEventListener("click", () => beginPortPick("p"));
  elements["port-n-button"].addEventListener("click", () => beginPortPick("n"));
  elements["port-load-button"].addEventListener("click", toggleSelectedPortLoad);
  elements["port-clear-button"].addEventListener("click", () => { invalidateActiveAnalysis("port-selection-cleared"); state.port = { mode: null, p: null, n: null, loadIds: [], result: null, stale: false, error: null }; renderPortPanel(); renderCanvas(); });
  elements["port-run-button"].addEventListener("click", runPortAnalysis);
  elements["undo-button"].addEventListener("click", undo);
  elements["redo-button"].addEventListener("click", redo);
  elements["clone-button"].addEventListener("click", (event) => cloneSelection(event));
  elements["zoom-out-button"].addEventListener("click", () => zoomCanvas(1.2));
  elements["zoom-in-button"].addEventListener("click", () => zoomCanvas(.82));
  elements["fit-button"].addEventListener("click", fitCanvas);
  elements["rotate-button"].addEventListener("click", () => {
    if (state.selected?.kind !== "component") return;
    mutate(() => {
      const component = state.circuit.components.find((item) => item.id === state.selected.id);
      component.rotation = ((component.rotation ?? 0) + 90) % 360;
    });
  });
  elements["delete-button"].addEventListener("click", deleteSelection);
  elements["inline-value-editor"].addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); closeInlineEditor({ commit: true }); }
    if (event.key === "Escape") { event.preventDefault(); closeInlineEditor(); }
  });
  elements["inline-value-editor"].addEventListener("blur", () => closeInlineEditor({ commit: true }));
  elements["inline-value-editor"].addEventListener("input", () => {
    const edit = state.inlineEdit;
    if (edit) inputDrafts.set("prop", edit.componentId, edit.prop, elements["inline-value-editor"].value, state.circuit.components.find((item) => item.id === edit.componentId)?.props?.[edit.prop]);
    markInputDirty();
  });
  elements["new-button"].addEventListener("click", () => {
    if (!confirmDiscardDrafts()) return;
    mutate(() => {
    resetProjectSession();
    state.intent = "auto";
    state.manualSettingKeys.clear();
    state.circuit = { version: 1, geometryVersion: CURRENT_GEOMETRY_VERSION, components: [], wires: [], junctions: [] };
    state.title = "새 회로";
    state.subtitle = "빈 캔버스에서 시작하세요";
    state.selected = null;
    state.learningId = null;
    state.probes = [];
    state.result = null;
    state.phasorResult = null;
    state.stale = false;
    state.runState = { status: "not-run", analysis: null, generation: null, error: null };
    state.cursorIndex = null;
    state.pendingPin = null;
    state.pendingWaypoints = [];
    state.pointer = null;
    elements["result-summary"].textContent = "회로에서 프로브를 선택하고 해석을 실행하세요.";
    });
  });
  elements["example-select"].addEventListener("change", () => loadExample(elements["example-select"].value));
  document.querySelectorAll("[data-learning-example]").forEach((button) => button.addEventListener("click", () => loadExample(button.dataset.learningExample)));
  elements["save-button"].addEventListener("click", saveProject);
  elements["load-button"].addEventListener("click", () => elements["file-input"].click());
  elements["file-input"].addEventListener("change", () => { if (elements["file-input"].files[0]) loadProject(elements["file-input"].files[0]); elements["file-input"].value = ""; });
  elements["csv-button"].addEventListener("click", exportCSV);
  elements["reset-view-button"].addEventListener("click", () => scopeView.fit());
  elements["ac-view-toggle"].querySelectorAll("button").forEach((button) => button.addEventListener("click", () => {
    state.acView = button.dataset.acView;
    elements["ac-view-toggle"].querySelectorAll("button").forEach((item) => item.classList.toggle("active", item === button));
    renderProbes();
    renderPlot();
  }));
  elements["wave-plot"].addEventListener("wheel", (event) => {
    if (!state.result) return;
    event.preventDefault();
    scopeView.wheel(event);
  }, { passive: false });
  let plotDrag = null;
  const finishPlotPointer = (pointerId, reason = "commit", event = null) => {
    if (plotDrag && event && ownsPointer(plotDrag, pointerId)) {
      const point = scopeView.point(event);
      plotDrag = advanceCursorPointerSession(plotDrag, { x: event.clientX, y: event.clientY }, point);
      if (!isTapGesture(plotDrag.maxDistance) && point) {
        plotDrag.panned = true;
        scopeView.panFrom(plotDrag.view, point.x - plotDrag.point.x);
      }
    }
    const completed = finishPointerSession(plotDrag, pointerId, reason);
    if (!completed.finished) return false;
    const drag = completed.finished;
    plotDrag = null;
    state.pointerOwnerId = null;
    releasePointer(elements["wave-plot"], pointerId);
    if (reason !== "commit") scopeView.restore(drag.view);
    else if (isTapGesture(drag.maxDistance)) scopeView.pinCursorAt(drag.lastPoint ?? drag.point);
    return true;
  };
  cancelPlotSession = () => { if (plotDrag) finishPlotPointer(plotDrag.pointerId, "cancel"); };
  elements["wave-plot"].addEventListener("pointerdown", (event) => {
    if (!state.result || state.result.analysis === "dc" || event.button !== 0 || state.pointerOwnerId !== null) return;
    const point = scopeView.point(event);
    // Pointer coordinates are integer CSS pixels while the SVG plot edge may be
    // fractional. Accept at most one SVG unit so the first/last sample remains
    // reachable, then ScopeView clamps the cursor target to the data interval.
    if (!scopeView.inside(point, 1)) return;
    event.preventDefault();
    const clientPoint = { x: event.clientX, y: event.clientY };
    const session = beginPointerSession(plotDrag, event.pointerId, { point, lastPoint: point, clientPoint, lastClientPoint: clientPoint, maxDistance: 0, panned: false, view: scopeView.inspect() });
    if (!session || session === plotDrag) return;
    plotDrag = session;
    state.pointerOwnerId = event.pointerId;
    elements["wave-plot"].focus({ preventScroll: true });
    capturePointer(elements["wave-plot"], event.pointerId);
  });
  window.addEventListener("pointermove", (event) => {
    if (!circuitWorkspaceActive) return;
    if (plotDrag && !ownsPointer(plotDrag, event.pointerId)) return;
    // Skip the layout-forcing getScreenCTM() unless the pointer is over the plot, a drag is active,
    // or a hover cursor still has to be cleared after leaving the plot.
    if (!plotDrag && scopeView.hoverIndex === null && !elements["wave-plot"].contains(event.target)) return;
    const point = scopeView.point(event);
    if (plotDrag && point) {
      plotDrag = advanceCursorPointerSession(plotDrag, { x: event.clientX, y: event.clientY }, point);
      if (!isTapGesture(plotDrag.maxDistance)) {
        plotDrag.panned = true;
        scopeView.panFrom(plotDrag.view, point.x - plotDrag.point.x);
      }
    }
    else if (state.pointerOwnerId === null) scopeView.moveCursor(point);
  });
  window.addEventListener("pointerup", (event) => { if (circuitWorkspaceActive) finishPlotPointer(event.pointerId, "commit", event); });
  elements["wave-plot"].addEventListener("pointercancel", (event) => finishPlotPointer(event.pointerId, "cancel"));
  elements["wave-plot"].addEventListener("lostpointercapture", (event) => finishPlotPointer(event.pointerId, "lost-capture"));
  elements["wave-plot"].addEventListener("keydown", (event) => {
    if (scopeView.keyCursor(event.key)) event.preventDefault();
  });
  window.addEventListener("blur", () => {
    if (state.drag) finishCanvasPointer(state.drag.pointerId, "blur");
    if (plotDrag) finishPlotPointer(plotDrag.pointerId, "blur");
  });
  window.addEventListener("keydown", (event) => {
    if (!isCircuitUiActive()) return;
    const typing = ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName);
    if (event.key === "Escape") {
      if (!elements["probe-context-menu"].classList.contains("hidden")) closeProbeContextMenu();
      else if (state.inlineEdit) closeInlineEditor();
      else if (!typing) setTool("select");
    }
    if (!typing && event.key === "Delete") deleteSelection();
    if (!typing && event.key.toLowerCase() === "r") elements["rotate-button"].click();
    if (!typing && !event.altKey && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d") { event.preventDefault(); cloneSelection(); }
    if (!typing && !event.isComposing && !event.altKey && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); event.shiftKey ? redo() : undo(); }
    if (!typing && !event.altKey && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") { event.preventDefault(); redo(); }
  });
}

function initialize() {
  initializeAppearance(document.getElementById("appearance"), () => {
    renderCanvas(); renderProbes(); renderPhasorLearning(); scopeView.render();
  });
  renderPalette();
  elements["example-select"].innerHTML += examples.map((example) => `<option value="${example.id}">${example.name}</option>`).join("");
  panels = createPanelController({
    beforeChange: () => {
      canvasTouch?.cancel();
      if (state.drag) finishCanvasPointer(state.drag.pointerId, "cancel");
      cancelPlotSession();
    },
    onChange: () => { if (circuitWorkspaceActive) { updateCanvasView(); scopeView.render(); renderPhasorLearning(); } },
    isActive: () => circuitWorkspaceActive,
  });
  emController = createEMController(document.getElementById("em-workspace"));
  circuitCourse = createCircuitCourseController(document.getElementById("circuit-course-host"));
  signalsCourse = createSignalsCourseController(document.getElementById("signals-workspace"));
  workspaceTabs = createWorkspaceTabs({
    onBeforeChange: (from) => {
      workspaceSwitching = true;
      if (from === "circuit") {
        circuitCourse.deactivate();document.getElementById('circuit-course-shell').hidden=true;document.getElementById('circuit-course-shell').inert=true;
        canvasTouch?.cancel();
        if (state.drag) finishCanvasPointer(state.drag.pointerId, "cancel");
        cancelPlotSession();
        panels.cancelInteractions();
        circuitWorkspaceActive = false;
        panels.synchronize();
      } else if (from === "em") emController.deactivate();
      else if (from === "signals") signalsCourse.deactivate();
    },
    onChange: (name) => {
      if (name === "em") emController.activate();
      else if (name === "signals") signalsCourse.activate();
      else if(circuitCourseActive){
        circuitWorkspaceActive=false;const workbench=document.getElementById('workbench'),shell=document.getElementById('circuit-course-shell');
        workbench.hidden=true;workbench.inert=true;document.getElementById('panel-shelf').hidden=true;shell.hidden=false;shell.inert=false;
        updateCircuitCourseTop();circuitCourse.activate();
      } else {
        circuitWorkspaceActive = true;
        panels.synchronize();
        if (circuitRenderDeferred) renderAll(); else { updateCanvasView(); scopeView.render(); }
      }
      queueMicrotask(() => { workspaceSwitching = false; });
    },
  });
  initializePhasorPractice();
  setupEvents();
  setupCanvasTouch();
  setTool("select");
  if (matchMedia("(max-width: 760px)").matches) {
    setInspectorCollapsed(true);
  }
  synchronizeIntent();
  renderAll();
  setStatus("해석 준비", "ready");
  window.__CIRCUIT_LAB__ = {
    getState: () => structuredClone({ selected: state.selected, tool: state.tool, pendingPin: state.pendingPin, historyDepth: state.history.length, circuit: state.circuit, settings: state.settings, probes: state.probes, stale: state.stale, result: state.result, phasorResult: state.phasorResult, port: state.port, learningId: state.learningId, generation: state.generation, lastRunMs: state.lastRunMs, runState: state.runState, pointerOwnerId: state.pointerOwnerId, drag: state.drag, canvasView: state.canvasView, intent: state.intent, autoUpdate: state.autoUpdate, scope: scopeView.inspect(), drafts: inputDrafts.entries() }),
    loadExample,
    runAnalysis,
    runPortAnalysis,
    getLayout: () => panels.inspect(),
    getWorkspace: () => workspaceTabs.active,
    getEMState: () => emController.inspect(),
    getCircuitCourseState: () => circuitCourse.inspect(),
    getSignalsCourseState: () => signalsCourse.inspect(),
    activateWorkspace: (name) => workspaceTabs.activate(name, false),
  };
  const query = new URLSearchParams(location.search);
  const exampleId = query.get("example");
  if (exampleId && examples.some((example) => example.id === exampleId)) {
    loadExample(exampleId);
  }
  if (query.get("run") === "1") setTimeout(runAnalysis, 0);
}

initialize();
