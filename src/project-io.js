import { cloneExample } from "./examples.js";
import { buildResultsCSV } from "./csv-format.js";
import { deserializeProject, serializeProject } from "./project-format.js";
import { CURRENT_GEOMETRY_VERSION, circuitGeometryVersion } from "./circuit-geometry.js";
import { currentProbeLabel } from "./current-direction.js";
import { escapeHtml } from "./safe-dom.js";
import { PROBE_COLORS } from "./editor-session.js";

/** Whole-project operations: example loading, new circuit, JSON save/open and CSV export. */
export function createProjectIO(deps) {
  const { state, elements, mutate, confirmDiscardDrafts, commitPendingInputs, resetProjectSession, setTool, fitCanvas, setStatus, seriesForProbes } = deps;

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
          ? { ...probe, key: `V:${probe.componentId}:${probe.pin}`, label: `V(${component.props.ref}.${probe.pin + 1})`, color: PROBE_COLORS[index] }
          : { ...probe, key: `I:${probe.componentId}`, label: currentProbeLabel(component, circuitGeometryVersion(state.circuit)), color: PROBE_COLORS[index] };
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

  function newCircuit() {
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
  }

  /** Register the toolbar listeners for new, example, save, open and CSV. */
  function attach() {
    elements["new-button"].addEventListener("click", newCircuit);
    elements["example-select"].addEventListener("change", () => loadExample(elements["example-select"].value));
    elements["save-button"].addEventListener("click", saveProject);
    elements["load-button"].addEventListener("click", () => elements["file-input"].click());
    elements["file-input"].addEventListener("change", () => { if (elements["file-input"].files[0]) loadProject(elements["file-input"].files[0]); elements["file-input"].value = ""; });
    elements["csv-button"].addEventListener("click", exportCSV);
  }

  return { loadExample, saveProject, loadProject, exportCSV, newCircuit, attach };
}
