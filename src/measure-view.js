import { escapeHtml } from "./safe-dom.js";
import { traceColor } from "./trace-color.js";
import { measureTraces, summaryLine } from "./wave-measure-model.js";

/**
 * Waveform measurement summary + the "B 커서" toggle. Display only.
 * One summary line is always visible for the chosen trace; opening it lists up to three traces with their values.
 * Values are recomputed only when update() receives a new result/trace set — never on hover or cursor movement.
 */
export function createMeasureView({ panel, summary, body, bButton, scopeView }) {
  let measured = null;
  let signature = null;
  let stale = false;
  let computeCount = 0;

  function rowMarkup(row, active) {
    const cells = row.cells.map((cell) => `<span class="measure-cell${cell.ok ? "" : " na"}" title="${escapeHtml(cell.note)}"><small>${escapeHtml(cell.label)}</small>${escapeHtml(cell.text)}</span>`).join("");
    const failed = row.error ? `<span class="measure-cell na" title="${escapeHtml(row.error)}"><small>측정</small>—</span>` : "";
    return `<div class="measure-row${active ? " active" : ""}"><button type="button" class="measure-trace" data-measure-trace="${escapeHtml(row.key)}" aria-pressed="${active}" title="이 트레이스를 요약과 A/B 차이에 사용"><i style="--trace-color:${traceColor(row.color)}"></i>${escapeHtml(row.label)}</button><div class="measure-cells">${cells}${failed}</div></div>`;
  }

  function render() {
    if (!measured?.ok) {
      panel.classList.add("hidden");
      return;
    }
    panel.classList.remove("hidden");
    panel.classList.toggle("stale", stale);
    const activeKey = scopeView.activeTraceKey ?? measured.rows[0]?.key;
    const active = measured.rows.find((row) => row.key === activeKey) ?? measured.rows[0];
    const line = summaryLine(measured, active?.key);
    summary.innerHTML = `<span class="measure-title">측정</span><span class="measure-line"><i style="--trace-color:${traceColor(active?.color)}"></i>${escapeHtml(line)}</span>`;
    summary.title = stale ? "이전 결과의 측정값입니다" : "열어서 트레이스별 값과 측정 불가 사유 보기";
    const more = measured.hidden ? `<p class="measure-note">트레이스 ${measured.hidden}개는 표시 개수 제한으로 생략했습니다.</p>` : "";
    body.innerHTML = `${measured.rows.map((row) => rowMarkup(row, row.key === active?.key)).join("")}${more}<p class="measure-note">${escapeHtml(measured.basis)} · 주기와 −3 dB 주파수만 인접 표본 사이를 선형보간합니다. 말풍선에서 계산 방식과 측정 불가 사유를 볼 수 있습니다.</p>`;
  }

  /** inputs: {analysis, traces, stale, signature} — same signature means same data, so nothing is recomputed. */
  function update({ analysis, traces, isStale = false, key = null, maxRows } = {}) {
    stale = isStale;
    if (key !== null && key === signature) { render(); return; }
    signature = key;
    computeCount += 1;
    measured = measureTraces({ analysis, traces, maxRows });
    render();
  }

  function clear() {
    measured = null;
    signature = null;
    render();
  }

  function refreshButton() {
    const available = scopeView.hasCursors;
    bButton.classList.toggle("hidden", !available);
    const has = scopeView.cursorB !== null;
    const armed = scopeView.bArmed;
    bButton.setAttribute("aria-pressed", String(armed));
    bButton.textContent = has ? "B 지우기" : armed ? "B 놓는 중…" : "B 커서";
    bButton.title = has ? "B 커서를 지웁니다 (Esc)" : "그래프를 눌러 기준 커서 B를 놓습니다 · Shift+클릭, Shift+←→로도 가능";
  }

  bButton.addEventListener("click", () => {
    if (scopeView.cursorB !== null) scopeView.clearB();
    else scopeView.armB(!scopeView.bArmed);
  });
  body.addEventListener("click", (event) => {
    const button = event.target.closest("[data-measure-trace]");
    if (!button) return;
    const key = button.dataset.measureTrace;
    scopeView.setActiveTrace(key);
    body.querySelector(`[data-measure-trace="${CSS.escape(key)}"]`)?.focus({ preventScroll: true });
  });
  // Active trace / B changes come from the scope; only the cached rows are redrawn.
  scopeView.onChange = () => { refreshButton(); if (measured?.ok) render(); };
  refreshButton();

  return { update, clear, refreshButton, inspect: () => ({ computeCount, rows: measured?.rows?.length ?? 0, signature, visible: !panel.classList.contains("hidden") }) };
}
