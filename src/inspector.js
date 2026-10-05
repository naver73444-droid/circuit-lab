import { parseValue } from "./circuit-engine.js";
import { classifyNumericInput } from "./circuit-edit.js";
import { engineering } from "./scope-model.js";
import { escapeHtml } from "./safe-dom.js";
import { controlReferenceModel, controlledSourceInputModel, passiveSliderModel } from "./ui-model.js";
import { bindSweep, sweepMarkup } from "./sweep-panel.js";

/** Property inspector, analysis settings, inline value editor and the draft/validation/commit flow behind them. */
export function createInspector(deps) {
  const { state, elements, workspace, inputDrafts, phasorView, mutate, currentConnections, synchronizeIntent, cancelScheduledRun, markInputDirty, scheduleAutoRun, renderPhasorLearning,
    setStatus, renderAll, showInspector, isCircuitUiActive, runSweep, clearSweep } = deps;

  // Inspector re-renders rebuild innerHTML, which would drop keyboard focus (Tab lands on BODY).
  // Remember the focused control (and any in-flight Tab direction) by a stable key, then re-focus it or its successor.
  let inspectorTabIntent = 0;
  let inspectorLastFocused = null;
  const INSPECTOR_FOCUSABLE = "input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])";

  function updateDraftNotice(updatePhasor = true) {
    const notice = document.getElementById("draft-notice");
    notice.classList.toggle("hidden", inputDrafts.size === 0);
    document.getElementById("draft-count").textContent = `입력 대기 ${inputDrafts.size}`;
    // Per-keystroke path: only AC results are redrawn live; the one-line validity notice is always current.
    if (updatePhasor) {
      if (state.settings.analysis === "ac") renderPhasorLearning();
      else phasorView.renderNotice();
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
        if (!elements["analysis-settings"].querySelector(`[data-setting="${update.key}"]`)) { state.settings.analysis = expected; state.intent = "manual"; synchronizeIntent(); renderAnalysisSettings(); }
        update.control = elements["analysis-settings"].querySelector(`[data-setting="${update.key}"]`);
      } else if (!update.control?.isConnected) {
        state.selected = { kind: "component", id: update.id };
        showInspector();
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

  /** Stable identity of an inspector control: survives re-renders that add or remove other fields. */
  function inspectorKey(control) {
    const { prop, propSlider, controlTarget, controlDirection } = control.dataset;
    if (prop !== undefined) return `prop:${prop}`;
    if (propSlider !== undefined) return `slider:${propSlider}`;
    if (controlTarget !== undefined) return "control-target";
    if (controlDirection !== undefined) return "control-direction";
    return control.id ? `id:${control.id}` : null;
  }

  function captureInspectorFocus() {
    const root = elements["inspector-content"];
    // During a Tab-triggered change event the browser has already cleared activeElement.
    let active = document.activeElement;
    if ((!active || !root.contains(active)) && inspectorTabIntent !== 0 && inspectorLastFocused?.isConnected) active = inspectorLastFocused;
    if (!active || active === root || !root.contains(active)) return null;
    const key = inspectorKey(active);
    if (key === null) return null;
    const caret = typeof active.selectionStart === "number" ? { start: active.selectionStart, end: active.selectionEnd } : null;
    return { key, caret, direction: inspectorTabIntent };
  }

  function restoreInspectorFocus(saved) {
    if (!saved) return;
    const root = elements["inspector-content"];
    if (document.activeElement && document.activeElement !== document.body && root.contains(document.activeElement)) return;
    const items = [...root.querySelectorAll(INSPECTOR_FOCUSABLE)];
    const at = items.findIndex((item) => inspectorKey(item) === saved.key);
    if (at < 0) return;
    const target = items[at + saved.direction];
    if (!target) return;
    target.focus({ preventScroll: false });
    if (!saved.direction && saved.caret && typeof target.setSelectionRange === "function") {
      try { target.setSelectionRange(saved.caret.start, saved.caret.end); } catch { /* non-text input */ }
    }
  }

  function renderInspector() {
    if (!workspace.circuitActive) { workspace.renderDeferred = true; return; }
    const selected = state.selected;
    if (!selected) {
      elements["selection-label"].textContent = "선택 없음";
      elements["inspector-content"].innerHTML = `<div class="inspector-empty"><p>부품을 선택하면 이름, 값, 파형과 초기조건을 수정할 수 있습니다.</p></div>`;
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
    if (component.type === "OPAMP") html += field("개방루프 이득 A", "gain", p.gain ?? "100k") + `<p class="model-note">유한 개방루프 이득 모델입니다. 전원·포화·대역폭이 없고 안정성을 판정하지 않습니다.</p>`;
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
    html += sweepMarkup(component, state);
    const savedFocus = captureInspectorFocus();
    elements["inspector-content"].innerHTML = html;
    applyInputDrafts(elements["inspector-content"], "prop", component);
    bindSweep(elements["inspector-content"], { component, state, run: runSweep, clear: clearSweep });
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
    if (!workspace.circuitActive) { workspace.renderDeferred = true; return; }
    // Only the fields of the chosen analysis are shown; DC has none.
    if (state.settings.analysis === "dc") {
      elements["analysis-settings"].innerHTML = "";
      elements["analysis-note"].textContent = "DC는 추가 설정이 없습니다. SIN/PULSE/AC 값은 보존됩니다.";
    } else if (state.settings.analysis === "transient") {
      elements["analysis-settings"].innerHTML = settingField("시작", "start", state.settings.start) + settingField("끝", "end", state.settings.end) + settingField("간격", "step", state.settings.step);
      elements["analysis-note"].textContent = "";
    } else {
      elements["analysis-settings"].innerHTML = settingField("시작 Hz", "startFrequency", state.settings.startFrequency) + settingField("끝 Hz", "endFrequency", state.settings.endFrequency) + settingField("점/dec", "pointsPerDecade", state.settings.pointsPerDecade) + settingField("페이저 Hz", "phasorFrequency", state.settings.phasorFrequency ?? "159.155");
      elements["analysis-note"].textContent = "";
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

  /** Register the draft-discard, Tab-focus and inline-editor listeners. */
  function attach() {
    // Keep focus on the draft until click discards it; native blur would commit first.
    document.getElementById("discard-drafts-button").addEventListener("pointerdown", (event) => {
      if (event.button === 0) event.preventDefault();
    });
    document.getElementById("discard-drafts-button").addEventListener("click", () => {
      workspace.discardingDrafts = true;
      try {
        inputDrafts.clear();
        state.inlineEdit = null;
        elements["inline-value-editor"].classList.add("hidden");
        renderAll();
      } finally {
        workspace.discardingDrafts = false;
      }
      scheduleAutoRun();
      setStatus("미확정 입력 취소", "ready");
    });
    elements["inspector-content"].addEventListener("focusin", (event) => { inspectorLastFocused = event.target; });
    elements["inspector-content"].addEventListener("keydown", (event) => {
      if (event.key !== "Tab" || event.ctrlKey || event.altKey || event.metaKey) return;
      inspectorTabIntent = event.shiftKey ? -1 : 1;
      setTimeout(() => { inspectorTabIntent = 0; }, 0);
    }, true);
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
  }

  return { renderInspector, renderAnalysisSettings, updateDraftNotice, confirmDiscardDrafts, commitPendingInputs, openInlineEditor, closeInlineEditor, attach };
}
