import { CircuitError, pinCount } from "./circuit-engine.js";
import { acceptsRunGeneration } from "./circuit-edit.js";
import { acMagnitudeLevel, acPhaseDegrees } from "./measurement-format.js";
import { currentDisplayScale } from "./plot-format.js";
import { suggestAnalysis } from "./analysis-policy.js";
import { AnalysisCancelledError, AnalysisWorkerClient } from "./analysis-worker-client.js";
import { describeCircuitFailure, resultAvailabilityText } from "./analysis-diagnostics.js";
import { currentDirectionGuide, currentProbeLabel } from "./current-direction.js";
import { circuitGeometryVersion } from "./circuit-geometry.js";
import { refreshInvalidatedPortPanel } from "./port-ui-state.js";
import { escapeHtml } from "./safe-dom.js";
import { traceColor } from "./trace-color.js";
import { formatPortResult, probeKeysForTarget } from "./ui-model.js";
import { createSweepRunner, createSweepState } from "./sweep-runner.js";
import { sweepLegendMarkup, syncSweepStatus } from "./sweep-panel.js";

/** Run/result slice of the shared state: results, run status, auto-update and the DC port analysis. */
export function createRunState() {
  return {
    result: null,
    phasorResult: null,
    stale: false,
    acView: "magnitude",
    view: { min: 0, max: 1 },
    cursorIndex: null,
    autoTimer: null,
    autoRequestedAt: null,
    lastRunMs: null,
    runState: { status: "not-run", analysis: null, generation: null, error: null },
    autoUpdate: true,
    runSerial: 0,
    recommendation: "",
    port: { mode: null, p: null, n: null, loadIds: [], result: null, stale: false, error: null },
    sweep: createSweepState(),
  };
}

/**
 * Analysis lifecycle: scheduling, worker runs, serial/generation checks that drop outdated results, stale state,
 * diagnostics, and the panels that present results (probe list, scope, phasor, port).
 */
export function createAnalysisRunner(deps) {
  const { state, elements, workspace, inputDrafts, scopeView, phasorView, mutate, currentConnections, bumpGeneration, removeProbe, renderCanvas, renderAll, setStatus, setTool, showCanvas,
    phasorPanelVisible, commitPendingInputs, updateDraftNotice, openProbeContextMenu, measureView } = deps;
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

  function synchronizeIntent() {
    const plan = suggestAnalysis(state.circuit, state.settings, state.intent);
    state.settings = plan.settings;
    state.recommendation = plan.reason;
    // Manual (edited parameters) keeps the chosen analysis type visible in the single selector.
    elements["analysis-intent"].value = state.intent === "manual" ? state.settings.analysis : state.intent;
    elements["auto-update"].checked = state.autoUpdate;
    elements["analysis-recommendation"].textContent = plan.reason;
  }

  function cancelScheduledRun() {
    clearTimeout(state.autoTimer);
    state.autoTimer = null;
    state.autoRequestedAt = null;
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
    bumpGeneration();
    if (state.result || ["success", "error", "running"].includes(state.runState.status)) markStale();
    else markPortStale();
    elements["csv-button"].disabled = true;
    setAutoHint("입력 완료 대기");
    updateDraftNotice();
  }

  // One status chip is shown. Auto-refresh detail goes to the checkbox tooltip; a waiting reason replaces the chip text.
  function setAutoHint(text, { show = false } = {}) {
    elements["auto-update"].parentElement.title = text;
    if (show) setStatus(text, "ready");
  }

  function scheduleAutoRun() {
    cancelScheduledRun();
    if (!state.autoUpdate) { setAutoHint("수동 실행"); return; }
    if (!state.circuit.components.length) { setAutoHint("회로 작성 중"); return; }
    if (inputDrafts.size || state.inlineEdit || document.querySelector(".input-invalid, .input-editing")) {
      setAutoHint("입력 완료 후 자동 갱신", { show: true }); return;
    }
    try {
      const status = currentConnections();
      if ((status.counts.unwired ?? 0) || (status.counts["no-ground"] ?? 0)) {
        setAutoHint("연결 완료 후 자동 갱신", { show: true }); return;
      }
    } catch { return; }
    const generation = state.generation;
    state.autoRequestedAt = performance.now();
    const requestedAt = state.autoRequestedAt;
    setAutoHint("자동 갱신 대기");
    state.autoTimer = setTimeout(() => runAnalysis({ automatic: true, generation, requestedAt }), 250);
  }

  function renderFailureDiagnostic(error) {
    if (!workspace.circuitActive) { workspace.renderDeferred = true; return; }
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
      state.view = { min: 0, max: 1 };
      state.cursorIndex = state.result.xValues.length > 1 ? state.result.xValues.length - 1 : 0;
      state.runState = { status: "success", analysis: state.settings.analysis, generation: state.generation, error: null };
      const points = state.result.points.length;
      elements["result-summary"].textContent = `${state.settings.analysis === "dc" ? "DC 동작점" : state.settings.analysis === "transient" ? "시간응답" : "AC 주파수"} · ${points.toLocaleString()}개 점 · 현재 회로 결과`;
      state.lastRunMs = performance.now() - startedAt;
      setStatus(`${automatic ? "최신 결과 · 자동" : "해석 완료"} · ${state.lastRunMs.toFixed(0)} ms`, "ready");
      setAutoHint(`완료 · ${state.lastRunMs.toFixed(1)} ms${state.autoUpdate ? " · 자동 갱신" : ""}`);
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
      elements["plot-empty"].querySelector("span").textContent = availability
        ?? (state.result ? "표시할 프로브를 회로에 놓으세요." : "회로에 V 또는 I 프로브를 놓으세요.");
      elements["cursor-readout"].textContent = CURSOR_HINT;
    }
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

  function clearSweep() {
    if (sweepRunner.clear()) { renderProbes(); renderPlot(); }
  }

  /** New project / restored snapshot: nothing of an old sweep may survive. */
  function resetSweep() {
    sweepRunner.clear({ quiet: true });
    Object.assign(state.sweep, { running: false, progress: "", message: "", messageKind: "" });
    state.sweep.form.componentId = null;
  }

  /** Register the run, port, AC-view and scope-reset listeners. */
  function attach() {
    elements["analysis-intent"].addEventListener("change", () => {
      const requestedIntent = elements["analysis-intent"].value;
      if (!commitPendingInputs()) { elements["analysis-intent"].value = state.intent; return; }
      mutate(() => { state.intent = requestedIntent; });
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
    elements["port-clear-button"].addEventListener("click", clearPort);
    elements["port-run-button"].addEventListener("click", runPortAnalysis);
    elements["reset-view-button"].addEventListener("click", () => scopeView.fit());
    elements["probe-list"].addEventListener("click", (event) => { if (event.target.closest("[data-sweep-clear-legend]")) clearSweep(); });
    elements["ac-view-toggle"].querySelectorAll("button").forEach((button) => button.addEventListener("click", () => {
      state.acView = button.dataset.acView;
      elements["ac-view-toggle"].querySelectorAll("button").forEach((item) => item.classList.toggle("active", item === button));
      renderProbes();
      renderPlot();
    }));
  }

  return {
    updateAnalysisControls, invalidateActiveAnalysis, cancelScheduledRun, synchronizeIntent, markStale, markInputDirty, setAutoHint, scheduleAutoRun, runAnalysis, runPortAnalysis,
    renderProbes, renderPlot, renderPhasorLearning, renderPortPanel, renderFailureDiagnostic, seriesForProbes, presentProbe, assignPortEndpoint, attach,
    runSweep: (componentId) => sweepRunner.run(componentId), clearSweep, resetSweep, sweepView: () => sweepRunner.view(state.acView),
  };
}
