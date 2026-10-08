import { parseValue, pinCount } from "./circuit-engine.js";
import { acceptsRunGeneration, endpointExists } from "./circuit-edit.js";
import { acMagnitudeLevel, acPhaseDegrees, currentDisplayScale } from "./plot-format.js";
import { AnalysisCancelledError, AnalysisWorkerClient } from "./analysis-worker-client.js";
import { describeCircuitFailure, diagnosticHighlightIds, failureRecord, resultAvailabilityText } from "./analysis-diagnostics.js";
import { suggestGroundFix, suggestProbes } from "./editor-guide-model.js";
import { actualCurrentDirection, currentDirectionGuide, currentReferenceSign, pointCurrentScale, probeCurrentKey, signedCurrent } from "./current-direction.js";
import { circuitGeometryVersion } from "./circuit-geometry.js";
import { escapeHtml } from "./safe-dom.js";
import { isTypingTarget } from "./editor-shortcuts.js";
import { traceColor } from "./trace-color.js";
import { formatPortResult, probeKeysForTarget } from "./ui-model.js";
import { createSweepRunner } from "./sweep-runner.js";
import { sweepLegendMarkup, syncSweepStatus } from "./sweep-panel.js";
import { setSingleSelection } from "./selection-model.js";
import { presentProbe as presentProbeIn, synchronizeIntent as synchronizeIntentIn } from "./run-state.js";

export { createRunState } from "./run-state.js";

/** Automatic re-run waits (ms): a quick one for a small circuit with a short computation, the long one otherwise or during a burst of edits. */
export const AUTO_RUN_DELAY_MS = Object.freeze({ small: 100, large: 250 });
/** Edits closer together than this are one burst (slider, held ◀ ▶ repeating every 110 ms, hammered taps). */
export const AUTO_RUN_BURST_MS = 300;
const SMALL_CIRCUIT_PARTS = 20;
const SMALL_RUN_POINTS = 5000;

/** How many points the analysis will compute (DC 1; transient (end − start)/step; AC decades × points per decade), Infinity if unreadable. */
export function estimatedRunPoints(settings = {}) {
  try {
    if (settings.analysis === "transient") return Math.max(1, (parseValue(settings.end) - parseValue(settings.start ?? 0)) / parseValue(settings.step));
    if (settings.analysis === "ac") return Math.max(1, Math.log10(parseValue(settings.endFrequency) / parseValue(settings.startFrequency)) * parseValue(settings.pointsPerDecade));
    return 1;
  } catch {
    return Infinity;
  }
}

/**
 * The auto-run wait for this circuit and these settings. The quick wait is for an edit to a circuit that already has a result: the first
 * run of a freshly opened project (the page is still settling: lazy modules, the "해석 중지" button appearing) and an edit made while a
 * text field has the focus (a result re-renders the panels under the typing) keep the longer one.
 */
export function autoRunDelayMs(circuit, settings, { burst = false, hasResult = true, typing = false } = {}) {
  if (burst || !hasResult || typing) return AUTO_RUN_DELAY_MS.large;
  const parts = circuit?.components?.length ?? Infinity;
  const points = estimatedRunPoints(settings);
  return parts <= SMALL_CIRCUIT_PARTS && Number.isFinite(points) && points <= SMALL_RUN_POINTS ? AUTO_RUN_DELAY_MS.small : AUTO_RUN_DELAY_MS.large;
}

/** Isolated port result invalidation; no DOM, worker or solver dependency. */
export function refreshInvalidatedPortPanel(job, portState, renderPanel) {
  if (job?.kind !== "port") return false;
  portState.error = null;
  if (portState.result) portState.stale = true;
  renderPanel();
  return true;
}

/**
 * Analysis lifecycle: scheduling, worker runs, serial/generation checks that drop outdated results, stale state,
 * diagnostics, and the panels that present results (probe list, scope, phasor, port).
 */
export function createAnalysisRunner(deps) {
  const { state, elements, workspace, inputDrafts, scopeView, phasorView, currentConnections, bumpGeneration, removeProbe, renderCanvas, renderAll, setStatus, setTool, showCanvas,
    phasorPanelVisible, commitPendingInputs, updateDraftNotice, openProbeContextMenu, measureView, onStaleChange, addProbes, addGround, onResultReady } = deps;
  /** Anything drawn from the result (the current-flow overlay) must go the moment the result turns stale, not on the next canvas render. */
  const staleChanged = () => { try { onStaleChange?.(); } catch { /* a failing observer must not break the run lifecycle */ } };
  const analysisWorkerClient = new AnalysisWorkerClient();
  let activeAnalysisJob = null;
  let seriesCache = null;
  const CURSOR_HINT = "그래프를 눌러 값을 읽습니다.";
  const resultIds = new WeakMap();
  let resultIdCounter = 0;
  const resultId = (result) => { if (!result) return 0; if (!resultIds.has(result)) resultIds.set(result, (resultIdCounter += 1)); return resultIds.get(result); };

  // Parameter sweep: shares this runner's single job slot, worker client and cancel button.
  const sweepRunner = createSweepRunner({
    state, client: analysisWorkerClient, setStatus, commitPendingInputs, presentProbe: (probe) => presentProbe(probe),
    synchronizeIntent: () => synchronizeIntent(), cancelScheduledRun: () => cancelScheduledRun(),
    activeKey: () => scopeView.activeTraceKey,
    beginJob: () => {
      invalidateActiveAnalysis("replaced-by-sweep");
      const job = { kind: "sweep", serial: ++state.runSerial, requestId: null, generation: state.generation };
      activeAnalysisJob = job;
      updateAnalysisControls();
      return job;
    },
    endJob: (job) => { if (activeAnalysisJob === job) { activeAnalysisJob = null; updateAnalysisControls(); } },
    isCurrent: (job) => activeAnalysisJob === job && job.serial === state.runSerial && job.generation === state.generation,
    onState: () => syncSweepStatus(state.sweep),
    onOverlay: () => { renderProbes(); renderPlot(); },
  });

  // ---- run control: worker job, cancellation, stale state, auto-update scheduling

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
      staleChanged();
    }
    refreshInvalidatedPortPanel(job, state.port, renderPortPanel);
    updateAnalysisControls();
    if (announce) setStatus("해석 중지됨 · 즉시 다시 실행할 수 있습니다.", "ready");
    return true;
  }

  function cancelActiveAnalysisFromUI() {
    invalidateActiveAnalysis("user-cancelled", { announce: true });
    renderAll();
  }

  const synchronizeIntent = () => synchronizeIntentIn(state, elements);

  function cancelScheduledRun() {
    clearTimeout(state.autoTimer);
    state.autoTimer = null;
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
    staleChanged();
  }

  function markPortStale() {
    if (!(state.port.result || state.port.error) || state.port.stale) return;
    state.port.stale = true;
    renderPortPanel();
  }

  function markInputDirty() {
    cancelScheduledRun();
    invalidateActiveAnalysis("input-draft-changed");
    bumpGeneration();
    if (state.result || ["success", "error", "running"].includes(state.runState.status)) markStale();
    else markPortStale();
    elements["csv-button"].disabled = true;
    setAutoHint("입력 완료 대기");
    updateDraftNotice();
    staleChanged();
  }

  // One status chip is shown. Auto-refresh detail goes to the checkbox tooltip; a waiting reason replaces the chip text.
  function setAutoHint(text, { show = false } = {}) {
    elements["auto-update"].parentElement.title = text;
    if (show) setStatus(text, "ready");
  }

  let lastAutoSchedule = { at: -Infinity, generation: null, burst: false };

  /** Debounced automatic run. requestedAt: when the edit happened (a request queued before this module loaded keeps its own time). */
  function scheduleAutoRun({ requestedAt = performance.now() } = {}) {
    cancelScheduledRun();
    showGroundAdvice(null);
    if (!state.autoUpdate) { setAutoHint("수동 실행"); return; }
    if (!state.circuit.components.length) { setAutoHint("회로 작성 중"); return; }
    if (inputDrafts.size || state.inlineEdit || document.querySelector(".input-invalid, .input-editing")) {
      setAutoHint("입력 완료 후 자동 갱신", { show: true }); return;
    }
    try {
      const status = currentConnections();
      if ((status.counts.unwired ?? 0) || (status.counts["no-ground"] ?? 0)) {
        // Everything is wired but there is no GND at all: say so and offer the one-tap fix instead of waiting silently.
        if (!(status.counts.unwired ?? 0)) showGroundAdvice(suggestGroundFix(state.circuit));
        setAutoHint("연결 완료 후 자동 갱신", { show: true }); return;
      }
    } catch { return; }
    const generation = state.generation;
    setAutoHint("자동 갱신 대기");
    // A single edit of a small circuit re-runs almost at once; a burst of edits (slider, held or hammered ◀ ▶) keeps the longer wait, so
    // only its last value is computed, and so does a large circuit or a long sweep.
    // Only a NEW edit (another generation) counts towards a burst; the same edit scheduled again (blur, gesture end) keeps its wait.
    const now = performance.now();
    const sameEdit = lastAutoSchedule.generation === generation;
    const burst = sameEdit ? lastAutoSchedule.burst : now - lastAutoSchedule.at < AUTO_RUN_BURST_MS;
    lastAutoSchedule = { at: sameEdit ? lastAutoSchedule.at : now, generation, burst };
    const typing = isTypingTarget(document.activeElement);
    const wait = Math.max(0, autoRunDelayMs(state.circuit, state.settings, { burst, hasResult: Boolean(state.result), typing }) - (now - requestedAt));
    state.autoTimer = setTimeout(() => runAnalysis({ automatic: true, generation, requestedAt }), wait);
  }

  const groundFixButton = (fix) => (fix
    ? `<div class="diagnostic-fixes"><button type="button" class="primary" data-fix-ground="${escapeHtml(fix.sourceId)}">${escapeHtml(fix.label)}</button></div>`
    : "");

  /** The error box while the auto-run waits on a circuit without any GND (not a failed run: the run state is untouched). null hides it. */
  function showGroundAdvice(fix) {
    const box = elements["error-box"];
    if (!fix) {
      if (box.dataset.advice) { delete box.dataset.advice; box.classList.add("hidden"); }
      return;
    }
    if (!workspace.circuitActive) return;
    const markup = `<div class="diagnostic-heading"><span>자동 해석 대기</span><code>NO_GROUND</code></div><strong>접지(GND)가 없어 해석할 수 없습니다.</strong>`
      + `<p>전압은 GND(0 V)를 기준으로 계산합니다. 전원의 − 단자에 GND를 하나 연결하세요.</p>${groundFixButton(fix)}`;
    const key = `ground:${fix.sourceId}:${fix.label}`;
    if (box.dataset.advice !== key) { box.innerHTML = markup; box.dataset.advice = key; } // unchanged advice is not re-announced (role=alert)
    box.classList.remove("hidden");
  }

  function renderFailureDiagnostic(error) {
    if (!workspace.circuitActive) { workspace.renderDeferred = true; return; }
    delete elements["error-box"].dataset.advice;
    const diagnostic = describeCircuitFailure(state.circuit, state.settings, error);
    const marked = diagnosticHighlightIds(state.circuit, error).size > 0;
    const fix = diagnostic.code === "NO_GROUND" ? groundFixButton(suggestGroundFix(state.circuit)) : "";
    const markNote = marked ? `<p class="diagnostic-mark-note">문제 부품은 캔버스에 빨간 점선으로 표시했습니다.</p>` : "";
    const constraints = diagnostic.constraints.length
      ? `<div class="diagnostic-constraints">${diagnostic.constraints.map((constraint) => `<button type="button" data-diagnostic-component="${escapeHtml(constraint.componentId)}"><b>${escapeHtml(constraint.ref)}</b><span>${escapeHtml(constraint.text)}</span></button>`).join("")}</div>`
      : diagnostic.relatedComponentIds.length
        ? `<div class="diagnostic-constraints">${diagnostic.relatedComponentIds.map((componentId) => { const component = state.circuit.components.find((item) => item.id === componentId); return `<button type="button" data-diagnostic-component="${escapeHtml(componentId)}"><b>${escapeHtml(component?.props?.ref ?? componentId)}</b><span>ID ${escapeHtml(componentId)} 선택</span></button>`; }).join("")}</div>`
        : "";
    const heading = `<div class="diagnostic-heading"><span>${escapeHtml(diagnostic.analysis)}</span>`
      + `<span class="certainty-${diagnostic.certainty}">${escapeHtml(diagnostic.certaintyLabel)}</span><code>${escapeHtml(diagnostic.code)}</code></div>`;
    elements["error-box"].innerHTML = `${heading}<strong>${escapeHtml(diagnostic.message)}</strong>${constraints}<p>${escapeHtml(diagnostic.hint)}</p>${markNote}${fix}`;
    elements["error-box"].classList.remove("hidden");
    elements["error-box"].querySelectorAll("[data-diagnostic-component]").forEach((button) => button.addEventListener("click", () => {
      setSingleSelection(state, { kind: "component", id: button.dataset.diagnosticComponent });
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
    setStatus(automatic ? "자동 해석 중…" : "해석 중…", "running");
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
      sweepRunner.clear({ quiet: true });
      state.runState = { status: "success", analysis: state.settings.analysis, generation: state.generation, error: null };
      const points = state.result.points.length;
      elements["result-summary"].textContent = `${state.settings.analysis === "dc" ? "DC 동작점" : state.settings.analysis === "transient" ? "시간응답" : "AC 주파수"} · ${points.toLocaleString()}개 점 · 현재 회로 결과`;
      state.lastRunMs = performance.now() - startedAt;
      setStatus(`${automatic ? "최신 결과 · 자동" : "해석 완료"} · ${state.lastRunMs.toFixed(0)} ms`, "ready");
      setAutoHint(`완료 · ${state.lastRunMs.toFixed(1)} ms${state.autoUpdate ? " · 자동 갱신" : ""}`);
      renderAll();
      try { onResultReady?.(state.result.analysis); } catch { /* a failing observer must not break the run lifecycle */ }
    } catch (error) {
      if (error instanceof AnalysisCancelledError) return;
      if (serial !== state.runSerial || !acceptsRunGeneration(generation, state.generation)) return;
      state.result = null;
      state.phasorResult = null;
      state.stale = false;
      state.lastRunMs = null;
      state.runState = { status: "error", analysis: state.settings.analysis, generation: state.generation, error: failureRecord(error) };
      renderFailureDiagnostic(state.runState.error);
      elements["result-summary"].textContent = resultAvailabilityText(state.runState, state.settings.analysis, state.probes.length);
      setStatus("해석 실패", "error");
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

  // ---- result presentation: probe list, plot series, phasor panel, port panel

  function displayNumber(value, unit) {
    if (!Number.isFinite(value)) return `— ${unit}`;
    return `${Number(value.toPrecision(6))} ${unit}`;
  }

  /**
   * DC chip value. A current is a magnitude with the direction it really flows ("5 mA (2→1)", no direction near 0), whatever the
   * probe's reference: the scope and CSV keep the signed value in the reference shown in the probe label.
   */
  function dcReading(probe, series, unit) {
    if (probe.kind !== "current") return displayNumber(series.values[0], unit);
    const component = state.circuit.components.find((item) => item.id === probe.componentId);
    const point = state.result.points[0];
    const actual = component ? actualCurrentDirection(component, point.componentCurrents[probeCurrentKey(probe)], {
      geometryVersion: circuitGeometryVersion(state.circuit), winding: probe.winding ?? 1, scale: pointCurrentScale(point.componentCurrents),
    }) : null;
    if (!actual) return displayNumber(series.values[0], unit);
    return actual.zero ? `0 ${unit}` : `${displayNumber(Math.abs(series.values[0]), unit)} (${actual.label})`;
  }

  function renderProbes() {
    const sweepView = sweepRunner.view(state.acView);
    if (sweepView) {
      elements["probe-list"].innerHTML = sweepLegendMarkup(sweepView);
      return;
    }
    if (!state.probes.length) {
      elements["probe-list"].innerHTML = `<span class="probe-empty">추가된 프로브 없음</span>`;
      return;
    }
    const visibleProbes = state.probes.map(presentProbe).filter(Boolean);
    const seriesByKey = new Map(seriesForProbes(visibleProbes).map((item) => [item.probe.key, item]));
    const chips = visibleProbes.map((probe) => {
      const series = seriesByKey.get(probe.key);
      const unit = series?.unit ?? (probe.kind === "voltage" ? "V" : "A");
      const reading = state.result?.analysis === "dc" && series ? dcReading(probe, series, unit) : unit;
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

  function renderPhasorLearning() {
    phasorView.renderNotice();
    if (!phasorPanelVisible()) return;
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
    // Scope, measurements and CSV show the current in the probe's reference direction (flipped parts: ×(−1)); the solver numbers stay.
    const component = state.circuit.components.find((item) => item.id === probe.componentId);
    const sign = currentReferenceSign(component, probe.winding ?? 1);
    const raw = state.result.points.map((point) => signedCurrent(point.componentCurrents[probeCurrentKey(probe)], sign));
    if (raw.some((value) => value === undefined)) return null;
    return { probe, raw, baseUnit: "A" };
  }

  const presentProbe = (probe) => presentProbeIn(state, probe);

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
    if (!workspace.circuitActive) { workspace.renderDeferred = true; return; }
    const series = seriesForProbes();
    const hasData = Boolean(state.result && series.length);
    const sweepView = sweepRunner.view(state.acView);
    elements["plot-empty"].classList.toggle("hidden", hasData || Boolean(sweepView));
    elements["csv-button"].disabled = !hasData || state.stale || state.runState.status !== "success";
    const staleNow = state.stale || state.runState.status === "stale";
    if (sweepView) {
      const { merged, resultLike, overlay } = sweepView;
      const isAc = resultLike.analysis === "ac";
      scopeView.setData(resultLike, merged.series.map((item) => ({ key: item.key, label: item.label, color: item.color, quantity: item.quantity, values: isAc ? item.values : item.raw })), false);
      measureView.update({
        analysis: resultLike.analysis, key: `sweep:${overlay.id}`, maxRows: merged.series.length,
        traces: merged.series.map((item) => ({ key: item.key, label: item.label, color: item.color, baseUnit: item.baseUnit, raw: item.raw, xValues: item.xValues })),
      });
      return;
    }
    const viewSeries = series.map((item) => ({
      key: item.probe.key, label: item.probe.label, color: item.probe.color,
      quantity: state.result?.analysis === "ac" ? item.unit : item.probe.kind === "voltage" ? "V" : "A",
      values: state.result?.analysis === "ac" ? item.values : item.raw,
    }));
    scopeView.setData(state.result, viewSeries, staleNow);
    if (hasData) {
      // Measurements use the raw samples and are recomputed only for a new result or a different set of traces.
      measureView.update({
        analysis: state.result.analysis, isStale: staleNow,
        key: `${resultId(state.result)}|${series.map((item) => `${item.probe.key}~${item.probe.label}`).join(",")}`,
        traces: series.map((item) => ({ key: item.probe.key, label: item.probe.label, color: item.probe.color, baseUnit: item.probe.kind === "voltage" ? "V" : "A", raw: item.raw, xValues: state.result.xValues })),
      });
    } else measureView.clear();
    if (!hasData) {
      const availability = resultAvailabilityText(state.runState, state.settings.analysis, state.probes.length);
      renderPlotEmpty(availability
        ?? (state.result ? "결과가 나왔습니다 · 파형으로 볼 곳(프로브)을 고르세요." : "회로에 V 또는 I 프로브를 놓으세요."));
      elements["cursor-readout"].textContent = CURSOR_HINT;
    }
  }

  // ---- empty waveform panel: recommended probes in one step, or one node at a time

  let probeSuggestion = null;
  let plotEmptyMarkup = "";
  /** The empty plot's message and, when the circuit has no probe at all, the recommended probes (one undo step) and the node chips. */
  function renderPlotEmpty(text) {
    const box = elements["plot-empty"];
    probeSuggestion = !state.probes.length && state.circuit.components.length ? suggestProbes(state.circuit) : null;
    const offer = probeSuggestion?.probes ?? [];
    const chips = probeSuggestion?.nodes ?? [];
    const chipMarkup = chips.length
      ? `<div class="node-chips" role="group" aria-label="노드 전압 프로브 하나 추가"><span>또는 노드 하나만</span>${chips.map((chip) => `<button type="button" data-suggest-node="${escapeHtml(chip.key)}">${escapeHtml(chip.label)}</button>`).join("")}</div>`
      : "";
    const offerMarkup = offer.length
      ? `<div class="probe-suggest"><button type="button" class="primary" data-suggest-probes title="${escapeHtml(offer.map((probe) => probe.label).join(" · "))}">추천 프로브 자동 추가</button>`
        + `<small>${escapeHtml(offer.map((probe) => probe.label).join(" · "))} · 되돌리기 한 번으로 취소</small>${chipMarkup}</div>`
      : "";
    const markup = `<span>${escapeHtml(text)}</span>${offerMarkup}`;
    if (markup !== plotEmptyMarkup) { box.innerHTML = markup; plotEmptyMarkup = markup; }
    box.classList.toggle("has-offer", offer.length > 0);
  }

  function addSuggestedProbes(event) {
    const all = event.target.closest?.("[data-suggest-probes]");
    const node = event.target.closest?.("[data-suggest-node]");
    if (!probeSuggestion || (!all && !node)) return;
    const specs = all ? probeSuggestion.probes : probeSuggestion.nodes.filter((chip) => chip.key === node.dataset.suggestNode);
    addProbes?.(specs);
  }

  function fixMissingGround(event) {
    if (!event.target.closest?.("[data-fix-ground]")) return;
    const fix = suggestGroundFix(state.circuit);
    if (!fix || !commitPendingInputs()) return;
    showGroundAdvice(null);
    const id = addGround?.(fix);
    if (id) setStatus("GND 추가됨 · 되돌리기로 취소", "ready");
  }

  // ---- DC port analysis

  function portEndpointLabel(endpoint) {
    if (!endpoint) return "미선택";
    if (endpoint.junctionId !== undefined) return `접속점 ${endpoint.junctionId}`;
    const component = state.circuit.components.find((item) => item.id === endpoint.componentId);
    return `${component?.props?.ref ?? endpoint.componentId}.${Number(endpoint.pin) + 1}`;
  }

  function beginPortPick(which) {
    setTool("select");
    state.port.mode = which === "p" ? "pick-p" : "pick-n";
    elements["tool-hint"].textContent = `DC 포트 ${which}로 사용할 핀 또는 접속점을 클릭하세요.`;
    renderPortPanel();
    renderCanvas();
    showCanvas();
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
    if (!workspace.circuitActive) { workspace.renderDeferred = true; return; }
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
    elements["port-status"].textContent = activeAnalysisJob?.kind === "port" ? "DC 포트 해석 중…" : state.port.stale ? "회로가 변경되어 이전 포트 결과가 오래되었습니다." : state.port.error ? "포트 분석 오류" : state.port.result ? "현재 회로 스냅샷 결과" : "DC 선형 회로 전용";
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
    elements["port-result"].innerHTML = `<div><small>Vth</small><strong>${escapeHtml(formatted.vth.text)}</strong></div><div><small>Rth</small><strong>${escapeHtml(formatted.rth.text)}</strong></div><div><small>In</small><strong>${escapeHtml(formatted.in.text)}</strong></div>${details}<p>${escapeHtml(formatted.equation)} · 노턴 내부원 n→p, 단락전류 p→n</p>`;
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
    setStatus("DC 포트 해석 중…", "running");
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

  function assignPortEndpoint(target) {
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
  }

  function clearPort() {
    invalidateActiveAnalysis("port-selection-cleared");
    state.port = { mode: null, p: null, n: null, loadIds: [], result: null, stale: false, error: null };
    renderPortPanel();
    renderCanvas();
  }

  /**
   * After an undo/redo inside one project: keep the port selection and the sweep form, minus whatever points at parts or pins the replayed
   * circuit no longer has. A port result that depended on a dropped endpoint goes; one that is merely older is marked stale by markStale().
   */
  function reconcileWithCircuit() {
    const exists = (endpoint) => Boolean(endpoint) && endpointExists(state.circuit, endpoint);
    const port = state.port;
    const loadIds = port.loadIds.filter((id) => state.circuit.components.some((item) => item.id === id));
    const dropped = (port.p && !exists(port.p)) || (port.n && !exists(port.n)) || loadIds.length !== port.loadIds.length;
    if (dropped) {
      state.port = { mode: null, p: exists(port.p) ? port.p : null, n: exists(port.n) ? port.n : null, loadIds, result: null, stale: false, error: null };
    }
    const form = state.sweep.form;
    if (form.componentId && !state.circuit.components.some((item) => item.id === form.componentId)) form.componentId = null;
  }

  function clearSweep() {
    if (sweepRunner.clear()) { renderProbes(); renderPlot(); }
  }

  /** New project / restored snapshot: nothing of an old sweep may survive. */
  function resetSweep() {
    sweepRunner.clear({ quiet: true });
    Object.assign(state.sweep, { running: false, progress: "", message: "", messageKind: "" });
    state.sweep.form.componentId = null;
  }

  /**
   * Register the cancel, port, AC-view, scope-reset and result-panel listeners. The analysis selector, the auto-update box and the run
   * button are wired by results-loader.js on the first screen, before this module is loaded.
   */
  function attach() {
    elements["cancel-analysis-button"].addEventListener("click", cancelActiveAnalysisFromUI);
    elements["port-p-button"].addEventListener("click", () => beginPortPick("p"));
    elements["port-n-button"].addEventListener("click", () => beginPortPick("n"));
    elements["port-load-button"].addEventListener("click", toggleSelectedPortLoad);
    elements["port-clear-button"].addEventListener("click", clearPort);
    elements["port-run-button"].addEventListener("click", runPortAnalysis);
    elements["reset-view-button"].addEventListener("click", () => scopeView.fit());
    elements["probe-list"].addEventListener("click", (event) => { if (event.target.closest("[data-sweep-clear-legend]")) clearSweep(); });
    elements["plot-empty"].addEventListener("click", addSuggestedProbes);
    elements["error-box"].addEventListener("click", fixMissingGround);
    elements["ac-view-toggle"].querySelectorAll("button").forEach((button) => button.addEventListener("click", () => {
      state.acView = button.dataset.acView;
      elements["ac-view-toggle"].querySelectorAll("button").forEach((item) => item.classList.toggle("active", item === button));
      renderProbes();
      renderPlot();
    }));
  }

  return {
    updateAnalysisControls, invalidateActiveAnalysis, cancelScheduledRun, synchronizeIntent, markStale, markInputDirty, setAutoHint, scheduleAutoRun, runAnalysis, runPortAnalysis,
    renderProbes, renderPlot, renderPhasorLearning, renderPortPanel, renderFailureDiagnostic, seriesForProbes, presentProbe, assignPortEndpoint, reconcileWithCircuit, attach,
    runSweep: (componentId) => sweepRunner.run(componentId), clearSweep, resetSweep, sweepView: () => sweepRunner.view(state.acView),
  };
}
