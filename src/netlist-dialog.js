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
    parsed = text.value.trim() ? parseNetlist(text.value) : null;
    if (!parsed) { preview.innerHTML = '<p class="netlist-hint">붙여 넣으면 읽은 부품이 여기에 줄마다 보입니다.</p>'; load.disabled = true; return; }
    const parts = parsed.parts.map((p) => "<li>" + esc(describePart(p)) + "</li>").join("");
    const problems = [...parsed.errors.map((m) => ["error", m]), ...parsed.warnings.map((m) => ["warning", m])].map(([kind, m]) => '<li class="netlist-' + kind + '">' + esc(m) + "</li>").join("");
    preview.innerHTML = (parsed.title ? "<strong>" + esc(parsed.title) + "</strong>" : "") + (parts ? '<ul class="netlist-parts">' + parts + "</ul>" : "")
      + (problems ? '<ul class="netlist-problems">' + problems + "</ul>" : "");
    load.disabled = parsed.errors.length > 0 || !parsed.parts.length;
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
    let layout;
    try { layout = layoutNetlist(parsed); } catch (error) { preview.insertAdjacentHTML("beforeend", '<p class="netlist-error">' + esc(error.message) + "</p>"); return; }
    if (onOpen(layout) === false) return;
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
