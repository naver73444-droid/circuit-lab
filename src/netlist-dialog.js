// "넷리스트 붙여넣기" dialog of the circuit editor: paste a netlist (written by Claude from a photo of a lab schematic), see what was read
// line by line, then open it as a laid-out circuit. The parsing and layout are netlist-import.js (pure); this file is the DOM.
import { parseNetlist, layoutNetlist, describePart, CLAUDE_PROMPT } from "./netlist-import.js";
import { escapeHtml as esc } from "./safe-dom.js";

/** onOpen(layout) opens the circuit and returns false when the user cancelled (unsaved drafts); then the dialog stays open. */
export function attachNetlistDialog(doc, { onOpen }) {
  const dialog = doc.getElementById("netlist-dialog"), text = doc.getElementById("netlist-text"), preview = doc.getElementById("netlist-preview");
  const load = doc.getElementById("netlist-load"), copy = doc.getElementById("netlist-copy-prompt"), opener = doc.getElementById("netlist-button");
  if (!dialog || !text || !preview || !load || !opener) return null;
  let parsed = null;
  function refresh() {
    // A reading that throws shows as an error and leaves nothing to open: never the circuit read before the last edit.
    parsed = null;
    load.disabled = true;
    let reading;
    try { reading = text.value.trim() ? parseNetlist(text.value) : null; }
    catch (error) { reading = { title: "", parts: [], errors: ["읽지 못했습니다: " + error.message], warnings: [] }; }
    if (!reading) { preview.innerHTML = '<p class="netlist-hint">붙여 넣으면 읽은 부품이 여기에 줄마다 보입니다.</p>'; return; }
    const line = (p) => { try { return describePart(p); } catch (error) { return p.ref + " — " + error.message; } };
    const parts = reading.parts.map((p) => "<li>" + esc(line(p)) + "</li>").join("");
    const problems = [...reading.errors.map((m) => ["error", m]), ...reading.warnings.map((m) => ["warning", m])].map(([kind, m]) => '<li class="netlist-' + kind + '">' + esc(m) + "</li>").join("");
    preview.innerHTML = (reading.title ? "<strong>" + esc(reading.title) + "</strong>" : "") + (parts ? '<ul class="netlist-parts">' + parts + "</ul>" : "")
      + (problems ? '<ul class="netlist-problems">' + problems + "</ul>" : "");
    if (!reading.errors.length && reading.parts.length) { parsed = reading; load.disabled = false; }
  }
  opener.addEventListener("click", () => {
    doc.getElementById("file-menu")?.removeAttribute("open");
    refresh();
    dialog.showModal?.();
    if (!dialog.open) dialog.setAttribute("open", "");
    text.focus({ preventScroll: true });
  });
  text.addEventListener("input", refresh);
  load.addEventListener("click", () => {
    if (!parsed || parsed.errors.length) return;
    // Anything that stops the open (layout, the project file checks) is said under the preview; the dialog stays open to fix it.
    let opened;
    try { opened = onOpen(layoutNetlist(parsed)); } catch (error) { preview.insertAdjacentHTML("beforeend", '<p class="netlist-error">불러오지 못했습니다: ' + esc(error.message) + "</p>"); return; }
    if (opened === false) return;
    dialog.close?.();
    dialog.removeAttribute("open");
  });
  copy?.addEventListener("click", async () => {
    const done = (message) => { copy.textContent = message; setTimeout(() => { copy.textContent = "Claude 안내문 복사"; }, 2000); };
    try { await navigator.clipboard.writeText(CLAUDE_PROMPT); done("복사했습니다"); } catch { done("복사하지 못했습니다"); }
  });
  refresh();
  return { refresh, inspect: () => ({ open: dialog.open, parsed }) };
}
