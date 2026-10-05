import { escapeHtml } from "./safe-dom.js";
import { sweepDefaults, sweepTarget } from "./sweep-model.js";
import { traceColor } from "./trace-color.js";

/** Inspector "스윕" disclosure: markup, listeners and in-place status updates. State lives in state.sweep (survives inspector re-renders). */

export function sweepMarkup(component, state) {
  const target = sweepTarget(component);
  if (!target) return "";
  const sweep = state.sweep;
  const form = sweep.form;
  if (form.componentId !== component.id) {
    // Another part: its own from/to defaults (shown as placeholders); count, scale and open state carry over.
    form.componentId = component.id;
    form.from = "";
    form.to = "";
  }
  const defaults = sweepDefaults(target.base);
  const probes = state.probes;
  const probeSelect = probes.length > 1
    ? `<label class="sweep-wide">프로브<select id="sweep-probe" data-sweep="probeKey"><option value="">현재 선택</option>${probes.map((probe) => `<option value="${escapeHtml(probe.key)}"${probe.key === form.probeKey ? " selected" : ""}>${escapeHtml(probe.label)}</option>`).join("")}</select></label>`
    : "";
  const hasOverlay = Boolean(sweep.overlay);
  return `<details class="sweep-box" id="sweep-box"${form.open ? " open" : ""}><summary>스윕 · ${escapeHtml(target.ref)} ${escapeHtml(target.key === "gain" ? "이득" : "값")}</summary>
<div class="sweep-form">
<label>시작<input id="sweep-from" data-sweep="from" value="${escapeHtml(form.from)}" placeholder="${escapeHtml(defaults?.from ?? "")}" autocomplete="off" inputmode="decimal"/></label>
<label>끝<input id="sweep-to" data-sweep="to" value="${escapeHtml(form.to)}" placeholder="${escapeHtml(defaults?.to ?? "")}" autocomplete="off" inputmode="decimal"/></label>
<label>점 수<input id="sweep-count" data-sweep="count" type="number" min="2" max="10" step="1" value="${escapeHtml(form.count)}"/></label>
<div class="segmented sweep-scale" role="group" aria-label="간격">
<button type="button" data-sweep-scale="log" aria-pressed="${form.scale === "log"}">로그</button>
<button type="button" data-sweep-scale="lin" aria-pressed="${form.scale === "lin"}">선형</button>
</div>
${probeSelect}
<div class="sweep-actions">
<button type="button" class="primary" id="sweep-run" data-sweep-run${sweep.running ? " disabled" : ""}>스윕 실행</button>
<button type="button" id="sweep-clear" data-sweep-clear${hasOverlay ? "" : " hidden"}>스윕 지우기</button>
<span class="sweep-progress" id="sweep-progress" role="status" aria-live="polite"></span>
</div>
<p class="field-help">시작·끝을 비우면 현재 값의 1/10 ~ 10배입니다. 선택한 프로브의 곡선을 값마다 다른 색으로 겹쳐 그립니다. 편집하거나 다시 실행하면 지워집니다.</p>
</div></details>`;
}

/** Update the status line, run/clear buttons in place (no inspector re-render, so typing focus is kept). */
export function syncSweepStatus(sweep, root = document) {
  const progress = root.getElementById ? root.getElementById("sweep-progress") : null;
  if (progress) {
    progress.textContent = sweep.running ? sweep.progress : sweep.message;
    progress.className = `sweep-progress${!sweep.running && sweep.messageKind ? ` ${sweep.messageKind}` : ""}`;
  }
  const run = root.getElementById?.("sweep-run");
  if (run) run.disabled = Boolean(sweep.running);
  const clear = root.getElementById?.("sweep-clear");
  if (clear) clear.hidden = !sweep.overlay;
}

export function bindSweep(container, { component, state, run, clear }) {
  const box = container.querySelector("#sweep-box");
  if (!box) return;
  const form = state.sweep.form;
  box.addEventListener("toggle", () => { form.open = box.open; });
  box.querySelectorAll("[data-sweep]").forEach((control) => {
    const key = control.dataset.sweep;
    control.addEventListener("input", () => { form[key] = control.value; });
    control.addEventListener("change", () => { form[key] = control.value; });
    // Enter runs the sweep; it must not reach the editor's shortcuts.
    control.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); form[key] = control.value; run(component.id); } });
  });
  box.querySelectorAll("[data-sweep-scale]").forEach((button) => button.addEventListener("click", () => {
    form.scale = button.dataset.sweepScale;
    box.querySelectorAll("[data-sweep-scale]").forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
  }));
  box.querySelector("[data-sweep-run]").addEventListener("click", () => run(component.id));
  box.querySelector("[data-sweep-clear]").addEventListener("click", () => clear());
  syncSweepStatus(state.sweep, container.ownerDocument ?? document);
}

/** Legend for the wave panel header while an overlay is shown: one colored chip per swept value + clear button. */
export function sweepLegendMarkup(overlayView) {
  const { overlay, merged } = overlayView;
  const chips = merged.series.map((item) => {
    const label = overlay.plan.values[item.sweepIndex]?.label ?? item.sweepText;
    return `<span class="probe-chip sweep-chip" data-sweep-key="${escapeHtml(item.key)}" style="--chip-color:${traceColor(item.color)}"><span>${escapeHtml(label)}</span></span>`;
  }).join("");
  return `<span class="sweep-legend-title" title="${escapeHtml(overlay.probe.label)}의 스윕 결과">스윕 · ${escapeHtml(overlay.probe.label)}</span>${chips}<button type="button" class="sweep-clear-chip" data-sweep-clear-legend>스윕 지우기</button>`;
}
