import { cloneExample } from "./examples.js";
import { buildResultsCSV } from "./csv-format.js";
import { deserializeProject, serializeProject } from "./project-format.js";
import { CURRENT_GEOMETRY_VERSION, circuitGeometryVersion } from "./circuit-geometry.js";
import { currentProbeLabel } from "./current-direction.js";
import { escapeHtml } from "./safe-dom.js";
import { PROBE_COLORS } from "./editor-session.js";
import { createAutosave, describeSavedAt, isEmptyProject } from "./persistence.js";
import { buildShareUrl, decodeProjectFromHash, encodeProjectToHash } from "./share-url.js";
import { createCanvasNotices } from "./canvas-notices.js";
import { clearSelection } from "./selection-model.js";

/**
 * Whole-project operations: example loading, new circuit, JSON save/open, CSV export, autosave + restore offer and share links.
 * Every way of opening a project (file, restore, share link) goes through openProject(), the one atomic open path.
 */
export function createProjectIO(deps) {
  const { state, elements, mutate, confirmDiscardDrafts, commitPendingInputs, resetProjectSession, setTool, fitCanvas, setStatus, seriesForProbes } = deps;
  const notices = createCanvasNotices(elements["canvas-notices"]);
  let lastAutosaveFailure = null;
  // Each tab saves only into its own slot (see persistence.js). Timer-driven results (quota, unavailable) arrive through onResult.
  const autosave = createAutosave({ debounceMs: 800, onResult: (outcome) => reportAutosave(outcome) });
  // Launch sources (?example=..., ?run=1, #p=...) are dropped from the address bar after the first user edit or any explicit
  // project replacement (new, open, restore, example), so a reload does not silently bring the original link content back.
  const launch = { example: false, run: false, hash: false };

  const currentProject = () => ({ title: state.title, subtitle: state.subtitle, circuit: state.circuit, settings: state.settings, probes: state.probes });

  /** Startup records which launch parameters it consumed (example id, run flag, share hash) so they can be cleaned later. */
  function registerLaunch({ example = false, run = false, hash = false } = {}) {
    launch.example ||= Boolean(example);
    launch.run ||= Boolean(run);
    launch.hash ||= Boolean(hash);
  }

  function dropLaunchSources() {
    if (!launch.example && !launch.run && !launch.hash) return;
    try {
      const url = new URL(location.href);
      if (launch.example) url.searchParams.delete("example");
      if (launch.run) url.searchParams.delete("run");
      if (launch.hash) url.hash = "";
      history.replaceState(history.state, "", url.pathname + url.search + url.hash);
    } catch { /* address bar cleanup is cosmetic */ }
    launch.example = false;
    launch.run = false;
    launch.hash = false;
  }

  /** Called once the user has agreed to replace the project: no earlier save may land on top of the new one, and the launch link is spent. */
  function beginReplacement({ startup = false } = {}) {
    autosave.cancel();
    if (!startup) dropLaunchSources();
  }

  function reportAutosave(outcome) {
    if (outcome.ok || outcome.state === "invalid-skip") { lastAutosaveFailure = null; return; }
    if (lastAutosaveFailure === outcome.state) return;
    lastAutosaveFailure = outcome.state;
    setStatus(outcome.reason ?? "자동 저장 실패", "error");
  }

  /**
   * Called after every committed edit (see editor-session): schedule a debounced autosave. Storage failures only touch the
   * status chip. An empty canvas is never written, so undoing back to nothing (or deleting everything) cannot destroy the
   * last non-empty autosave, which may be the only copy of earlier work.
   */
  function noteCommitted() {
    dropLaunchSources();
    // An uncommitted drag has already moved the live coordinates; its own commit (commitMove) schedules the save.
    if (state.drag?.moved && state.drag.kind !== "pan") return;
    if (isEmptyProject(currentProject())) { autosave.cancel(); return; }
    autosave.schedule(currentProject()); // takes its own snapshot; failures come back through onResult
  }

  function flushAutosave() {
    autosave.flush();
  }

  function loadExample(id, { silent = false } = {}) {
    if (!id) return;
    if (!confirmDiscardDrafts()) { elements["example-select"].value = ""; return; }
    beginReplacement({ startup: silent });
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
          ? { ...probe, key: `V:${probe.componentId}:${probe.pin}`, label: `V(${component.props.ref}.${probe.pin + 1})`, color: PROBE_COLORS[index] }
          : { ...probe, key: `I:${probe.componentId}`, label: currentProbeLabel(component, circuitGeometryVersion(state.circuit)), color: PROBE_COLORS[index] };
      });
      clearSelection(state);
      state.learningId = ["rc-lowpass", "rl", "rlc", "parallel-sine"].includes(id) ? id : null;
      state.result = null;
      state.phasorResult = null;
      state.stale = false;
      state.runState = { status: "not-run", analysis: null, generation: null, error: null };
      state.cursorIndex = null;
      elements["result-summary"].textContent = state.learningId ? "학습 예제 준비 · 자동 계산을 기다립니다." : "예제를 불러왔습니다. 해석 실행으로 계산하세요.";
    }, { autosave: !silent }); // a startup ?example= load must not replace an earlier autosave
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

  /**
   * The one atomic open path (JSON file, autosave restore, share link): replaces the whole project, clears results and
   * gestures through resetProjectSession(), records one undo step. Returns false when the user cancels the draft prompt.
   */
  function openProject(project, { fallbackTitle, fallbackSubtitle, resultText, autosave: save = true, startup = false }) {
    if (!confirmDiscardDrafts()) return false;
    beginReplacement({ startup });
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
        state.title = project.title ?? fallbackTitle;
        state.subtitle = project.subtitle ?? fallbackSubtitle;
      } else {
        state.probes = [];
        state.title = fallbackTitle;
        state.subtitle = fallbackSubtitle;
      }
      state.result = null;
      state.phasorResult = null;
      state.stale = false;
      state.runState = { status: "not-run", analysis: null, generation: null, error: null };
      state.cursorIndex = null;
      state.learningId = null;
      elements["result-summary"].textContent = resultText;
    }, { autosave: save });
    setTool("select");
    fitCanvas();
    return true;
  }

  async function loadProject(file) {
    const importGeneration = state.generation;
    try {
      const project = deserializeProject(await file.text(), state.settings);
      if (state.generation !== importGeneration) throw new Error("읽는 동안 회로가 변경되어 불러오기를 취소했습니다. 파일을 다시 선택하세요.");
      if (!openProject(project, { fallbackTitle: file.name.replace(/\.json$/i, ""), fallbackSubtitle: "JSON에서 불러온 회로", resultText: "JSON에서 회로를 불러왔습니다. 해석 실행으로 계산하세요." })) return;
      setStatus("JSON 불러오기 완료", "ready");
    } catch (error) {
      elements["error-box"].innerHTML = `<strong>JSON 불러오기 실패</strong>${escapeHtml(error.message)}`;
      elements["error-box"].classList.remove("hidden");
      setStatus("불러오기 실패", "error");
    }
  }

  // ---- autosave restore offer

  /** At startup: if a valid autosave differs from the loaded circuit, offer (never apply) it in a dismissible banner. */
  function offerRestore() {
    // The newest slot whose content differs from what is loaded: this tab's own slot after a reload, or another tab's/older work.
    const saved = autosave.loadDetailed(state.settings, { current: currentProject() });
    if (!saved.ok) return false;
    notices.show({
      kind: "restore",
      text: `이전 작업이 있습니다 (${describeSavedAt(saved.savedAt)})`,
      actions: [
        {
          label: "복원",
          primary: true,
          onClick: () => {
            // Restoring replaces the circuit on screen only on this click; the old content stays one undo away.
            const opened = openProject(saved.project, { fallbackTitle: "복원한 회로", fallbackSubtitle: "자동 저장에서 복원한 회로", resultText: "이전 작업을 복원했습니다. 해석 실행으로 계산하세요.", autosave: false });
            if (!opened) return false;
            setStatus("이전 작업 복원 완료", "ready");
            return true;
          },
        },
        { label: "무시" },
      ],
    });
    return true;
  }

  // ---- share links

  const shareBase = () => location.href.split(/[?#]/)[0];

  async function copyShareLink() {
    if (!commitPendingInputs()) return;
    const encoded = await encodeProjectToHash(currentProject(), { baseHref: shareBase() });
    if (!encoded.ok) {
      notices.show({ kind: "error", text: encoded.reason, autoHideMs: 9000 });
      setStatus("링크 만들기 실패", "error");
      return;
    }
    const url = buildShareUrl(shareBase(), encoded.hash);
    let copied = false;
    try {
      if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(url); copied = true; }
    } catch { /* permission or focus problem: fall back to a selectable field */ }
    if (copied) {
      notices.show({ text: "링크를 복사했습니다", autoHideMs: 4000 });
      setStatus("공유 링크 복사 완료", "ready");
      return;
    }
    const shown = notices.show({ text: "자동 복사에 실패했습니다. 링크를 선택해 복사하세요 (Ctrl+C)", input: url, autoHideMs: 30000 });
    shown.input?.focus();
    shown.input?.select();
    let execCopied = false;
    try { execCopied = document.execCommand?.("copy") === true; } catch { /* not allowed */ }
    if (execCopied) shown.element.querySelector(".canvas-notice-text").textContent = "링크를 복사했습니다";
  }

  /** Startup with #p=...: decode, open atomically, or explain why not and keep the default editor. */
  async function openShareHash(hash) {
    const generation = state.generation;
    const decoded = await decodeProjectFromHash(hash, { fallbackSettings: state.settings });
    if (!decoded.ok) {
      notices.show({ kind: "error", text: `공유 링크를 열 수 없습니다 · ${decoded.reason}`, autoHideMs: 12000 });
      setStatus("공유 링크 불러오기 실패", "error");
      return false;
    }
    if (state.generation !== generation) {
      notices.show({ kind: "error", text: "불러오는 동안 회로가 변경되어 공유 링크 열기를 취소했습니다.", autoHideMs: 9000 });
      return false;
    }
    const opened = openProject(decoded.project, { fallbackTitle: "공유된 회로", fallbackSubtitle: "공유 링크에서 불러온 회로", resultText: "공유 링크에서 회로를 불러왔습니다. 해석 실행으로 계산하세요.", autosave: false, startup: true });
    if (!opened) return false;
    notices.show({ text: "공유 링크에서 불러왔습니다", autoHideMs: 6000 });
    setStatus("공유 링크에서 불러오기 완료", "ready");
    return true;
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

  function newCircuit() {
      if (!confirmDiscardDrafts()) return;
      beginReplacement();
      mutate(() => {
      resetProjectSession();
      state.intent = "auto";
      state.manualSettingKeys.clear();
      state.circuit = { version: 1, geometryVersion: CURRENT_GEOMETRY_VERSION, components: [], wires: [], junctions: [] };
      state.title = "새 회로";
      state.subtitle = "빈 캔버스에서 시작하세요";
      clearSelection(state);
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
      }, { autosave: false }); // a new circuit keeps the previous autosave until the next real edit
  }

  /** Register the toolbar listeners for new, example, save, open, CSV and share link. */
  function attach() {
    elements["new-button"].addEventListener("click", newCircuit);
    elements["example-select"].addEventListener("change", () => loadExample(elements["example-select"].value));
    elements["save-button"].addEventListener("click", saveProject);
    elements["load-button"].addEventListener("click", () => elements["file-input"].click());
    elements["file-input"].addEventListener("change", () => { if (elements["file-input"].files[0]) loadProject(elements["file-input"].files[0]); elements["file-input"].value = ""; });
    elements["csv-button"].addEventListener("click", exportCSV);
    elements["share-button"].addEventListener("click", copyShareLink);
    // A pending autosave must not be lost when the tab closes or is backgrounded within the debounce window.
    window.addEventListener("pagehide", flushAutosave);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushAutosave(); });
  }

  return { loadExample, saveProject, loadProject, openProject, exportCSV, newCircuit, offerRestore, copyShareLink, openShareHash, registerLaunch, noteCommitted, flushAutosave, autosaveStatus: () => autosave.getStatus(), attach };
}
