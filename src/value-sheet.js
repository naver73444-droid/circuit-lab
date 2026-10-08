/**
 * Value adjuster for the selected R / C / L / source.
 *  - Phone: a bottom sheet docked above the panel tab bar. It opens only on an explicit choice (a tap on the part or its value, "값" on the selection
 *    bar), never because a part merely became selected (placing a part, a long-press pick-up, a diagnostic link): popping up on its own
 *    would cover the lower canvas right after the student placed a part. ✕ hides it until the part is chosen again.
 *    The text field asks for the number pad (inputmode="decimal"); prefixes come from the chips, so no letter keyboard is needed.
 *  - Desktop: the same controls as a compact card at the top of the properties panel (the inspector field below stays the text input).
 * Every gesture is ONE undo step (createValueGesture): a slider drag, a held ◀/▶ (auto-repeat), a chip tap, a typed value.
 * The element is moved, never recreated, so its listeners survive layout switches; renderAll()/renderSelection() call sync().
 */
import { classifyNumericInput } from "./circuit-edit.js";
import { selectedItems } from "./selection-model.js";
import { PREFIX_CHIPS, createValueGesture, prefixOf, primaryValueField, slideText, stepValue, withPrefix } from "./value-adjust.js";
import { PHONE_QUERY } from "./responsive-editor.js";

const REPEAT_DELAY_MS = 420;
const REPEAT_EVERY_MS = 110;

const chipMarkup = ([prefix, label]) => `<button type="button" data-prefix="${prefix}" aria-pressed="false" aria-label="접두사 ${prefix ? label : "없음"}">${label}</button>`;
const MARKUP = `
<div class="value-sheet-head">
  <strong class="value-sheet-name" id="value-sheet-name"></strong>
  <input id="value-sheet-input" class="value-sheet-input" inputmode="decimal" enterkeyhint="done" autocomplete="off" spellcheck="false" aria-label="값"/>
  <span class="value-sheet-unit" id="value-sheet-unit"></span>
  <button type="button" class="value-sheet-series" data-sheet-action="series" title="◀ ▶ 표준값 계열">E12</button>
  <button type="button" data-sheet-action="inspect" title="모든 속성 보기">속성</button>
  <button type="button" class="value-sheet-close" data-sheet-action="close" aria-label="값 조절 닫기">✕</button>
</div>
<div class="value-sheet-step">
  <button type="button" class="value-sheet-stepper" data-step="-1" aria-label="한 단계 작게 (길게 누르면 반복)">◀</button>
  <div class="value-sheet-slide">
    <input type="range" id="value-sheet-slider" min="-1" max="1" step="0.005" value="0" aria-label="값 미세 조절 · 현재 값의 0.1배에서 10배"/>
    <div class="value-sheet-scale" aria-hidden="true"><span>×0.1</span><span>×1</span><span>×10</span></div>
  </div>
  <button type="button" class="value-sheet-stepper" data-step="1" aria-label="한 단계 크게 (길게 누르면 반복)">▶</button>
</div>
<div class="value-sheet-prefixes" role="group" aria-label="단위 접두사">${PREFIX_CHIPS.map(chipMarkup).join("")}</div>`;

export function createValueSheet(deps) {
  const { state, inputDrafts, mutateGrouped, closeEditGroup, isCircuitUiActive, setStatus, showInspector, updateCanvasView, win = window, doc = document } = deps;
  const phone = win.matchMedia(PHONE_QUERY);
  const sheet = doc.createElement("section");
  sheet.id = "value-sheet";
  sheet.className = "value-sheet";
  sheet.hidden = true;
  sheet.setAttribute("aria-label", "값 조절");
  sheet.innerHTML = MARKUP;
  const $ = (selector) => sheet.querySelector(selector);
  const input = $("#value-sheet-input"), slider = $("#value-sheet-slider"), seriesButton = $('[data-sheet-action="series"]');
  const gesture = createValueGesture({ mutateGrouped, closeEditGroup });
  let series = "E12";
  let requested = null;   // phone: the part whose sheet was explicitly asked for (openFor); cleared by ✕ or another selection
  let current = null;     // { id, field }
  let slideBase = null;   // value text when the slider drag began
  let repeat = null;      // auto-repeat timer of a held ◀/▶
  let shownFor = null;

  function target() {
    if (!isCircuitUiActive()) return null;
    const items = selectedItems(state);
    if (items.length !== 1 || items[0].kind !== "component") return null;
    const component = state.circuit.components.find((item) => item.id === items[0].id);
    const field = primaryValueField(component, state.settings.analysis);
    return field ? { component, field } : null;
  }
  const valueText = (component, field) => String(component.props?.[field.prop] ?? "0");

  function place() {
    if (phone.matches) {
      const workbench = doc.getElementById("workbench");
      if (workbench && sheet.parentNode !== workbench) workbench.append(sheet);
    } else {
      const panel = doc.getElementById("inspector-panel"), content = doc.getElementById("inspector-content");
      if (panel && content && sheet.nextElementSibling !== content) panel.insertBefore(sheet, content);
    }
  }

  function reveal(id) {
    // Phone: if the chosen part sits under the sheet, slide the circuit up just enough (never past the canvas top).
    const canvas = doc.getElementById("circuit-canvas");
    const part = canvas?.querySelector(`.component[data-id="${CSS.escape(id)}"]`);
    const scale = canvas?.getScreenCTM()?.a;
    if (!part || !(scale > 0)) return;
    const box = part.getBoundingClientRect(), view = canvas.getBoundingClientRect(), top = sheet.getBoundingClientRect().top;
    const limit = Math.min(top, view.bottom) - 16;
    const shift = Math.min(box.bottom - limit, box.top - view.top - 16);
    if (box.bottom <= limit || shift <= 0) return;
    state.canvasView = { ...state.canvasView, y: state.canvasView.y + shift / scale };
    updateCanvasView();
  }

  function sync() {
    place();
    const found = target();
    if (!found || requested !== found.component.id) requested = null; // a request lasts while that part stays the selection
    const show = Boolean(found) && (!phone.matches || requested === found.component.id);
    sheet.hidden = !show;
    sheet.classList.toggle("is-phone", phone.matches);
    doc.documentElement.classList.toggle("value-sheet-open", show && phone.matches);
    if (!show) {
      if (gesture.open) endGesture();
      current = null; shownFor = null;
      return;
    }
    const { component, field } = found;
    current = { id: component.id, field };
    const text = valueText(component, field);
    $("#value-sheet-name").textContent = component.props?.ref ?? component.id;
    $("#value-sheet-unit").textContent = field.unit;
    input.setAttribute("aria-label", `${component.props?.ref ?? component.id} ${field.label} (${field.unit})`);
    if (doc.activeElement !== input || gesture.open) { input.value = text; input.classList.remove("sheet-invalid"); input.removeAttribute("aria-invalid"); }
    const parsed = classifyNumericInput(text, { positive: field.kind === "positive" });
    if (slideBase === null) slider.value = "0";
    slider.disabled = !(parsed.status === "valid" && parsed.value !== 0);
    seriesButton.hidden = field.kind !== "positive";
    seriesButton.textContent = series;
    const prefix = prefixOf(text);
    for (const chip of sheet.querySelectorAll("[data-prefix]")) chip.setAttribute("aria-pressed", String(chip.dataset.prefix === prefix));
    if (phone.matches && shownFor !== component.id) { shownFor = component.id; win.requestAnimationFrame(() => { measure(); reveal(component.id); }); }
  }

  /** Apply a value text to the current part inside the open gesture. Returns false (and says why) for an invalid value. */
  function apply(text) {
    if (!current) return false;
    const component = state.circuit.components.find((item) => item.id === current.id);
    if (!component) return false;
    const checked = classifyNumericInput(text, { positive: current.field.kind === "positive" });
    if (checked.status !== "valid") { setStatus(current.field.kind === "positive" ? "0보다 큰 값을 입력하세요" : "잘못된 값", "error"); return false; }
    if (String(component.props?.[current.field.prop] ?? "") === text) return true;
    const { prop } = current.field;
    inputDrafts.delete("prop", component.id, prop);
    if (!gesture.open) gesture.begin(component.id);
    gesture.apply(() => { (component.props ??= {})[prop] = text; });
    return true;
  }
  function endGesture() { gesture.end(); }
  /** One-shot edit (chip, typed value, keyboard step): its own undo step. */
  function applyOnce(text) {
    if (!current) return false;
    endGesture();
    gesture.begin(current.id);
    const ok = apply(text);
    endGesture();
    return ok;
  }

  function step(direction) {
    if (!current) return false;
    const component = state.circuit.components.find((item) => item.id === current.id);
    if (!component) return false;
    const next = stepValue(valueText(component, current.field), direction, { kind: current.field.kind, series });
    return next ? apply(next.text) : false;
  }
  function stopRepeat() { if (repeat !== null) win.clearTimeout(repeat); repeat = null; }

  function commitTyped() {
    if (!current) return;
    const component = state.circuit.components.find((item) => item.id === current.id);
    const text = input.value.trim();
    if (!component || text === valueText(component, current.field)) return;
    if (!applyOnce(text)) { input.value = valueText(component, current.field); input.classList.remove("sheet-invalid"); input.removeAttribute("aria-invalid"); }
  }

  // ---- events
  input.addEventListener("input", () => {
    const checked = classifyNumericInput(input.value, { positive: current?.field.kind === "positive" });
    input.classList.toggle("sheet-invalid", checked.status === "invalid");
    input.setAttribute("aria-invalid", String(checked.status === "invalid"));
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); commitTyped(); input.blur(); }
    if (event.key === "Escape") {
      event.preventDefault();
      const component = current && state.circuit.components.find((item) => item.id === current.id);
      if (component) input.value = valueText(component, current.field);
      input.blur();
    }
    event.stopPropagation(); // typing here never drives editor shortcuts (R, Delete, W ...)
  });
  input.addEventListener("change", commitTyped);
  input.addEventListener("blur", () => { commitTyped(); sync(); });

  for (const button of sheet.querySelectorAll("[data-step]")) {
    const direction = Number(button.dataset.step);
    const release = () => { if (repeat === null && !gesture.open) return; stopRepeat(); endGesture(); };
    button.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || !current) return;
      event.preventDefault(); // keep the number pad (if open) and avoid a focus jump
      if (doc.activeElement === input) commitTyped();
      try { button.setPointerCapture(event.pointerId); } catch { /* synthetic pointer */ }
      endGesture();
      gesture.begin(current.id);
      if (!step(direction)) { endGesture(); return; }
      const again = () => { repeat = win.setTimeout(() => { if (step(direction)) again(); else release(); }, REPEAT_EVERY_MS); };
      repeat = win.setTimeout(() => { if (step(direction)) again(); else release(); }, REPEAT_DELAY_MS);
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) button.addEventListener(type, release);
    // Keyboard (Enter / Space): one step, one undo entry.
    button.addEventListener("click", (event) => { if (event.detail !== 0 || !current) return; endGesture(); gesture.begin(current.id); step(direction); endGesture(); });
  }

  slider.addEventListener("input", () => {
    if (!current) return;
    const component = state.circuit.components.find((item) => item.id === current.id);
    if (!component) return;
    if (slideBase === null) { slideBase = valueText(component, current.field); endGesture(); gesture.begin(component.id); }
    const text = slideText(slideBase, Number(slider.value));
    if (text !== null) apply(text);
  });
  slider.addEventListener("change", () => { slideBase = null; endGesture(); slider.value = "0"; sync(); });

  for (const chip of sheet.querySelectorAll("[data-prefix]")) {
    chip.addEventListener("pointerdown", (event) => { if (doc.activeElement === input) event.preventDefault(); }); // keep typing
    chip.addEventListener("click", () => {
      if (!current) return;
      const component = state.circuit.components.find((item) => item.id === current.id);
      if (!component) return;
      const typing = doc.activeElement === input;
      const text = withPrefix(typing ? input.value : valueText(component, current.field), chip.dataset.prefix);
      if (typing) input.value = text;
      applyOnce(text);
    });
  }

  sheet.addEventListener("click", (event) => {
    const action = event.target.closest?.("[data-sheet-action]")?.dataset.sheetAction;
    if (!action) return;
    if (action === "series") { series = series === "E12" ? "E24" : "E12"; seriesButton.textContent = series; return; }
    if (action === "close" || action === "inspect") { requested = null; sync(); }
    if (action === "inspect") showInspector();
  });
  // Shortcuts (R rotate, Delete ...) must not fire while a sheet control has focus.
  sheet.addEventListener("keydown", (event) => { if (event.target !== input && ["Delete", "Backspace"].includes(event.key)) event.stopPropagation(); });
  phone.addEventListener?.("change", () => { shownFor = null; sync(); });
  // The phone layout keeps the sheet's height free at the end of the scroller (--value-sheet-h).
  const measure = () => { if (!sheet.hidden && phone.matches) doc.documentElement.style.setProperty("--value-sheet-h", `${Math.ceil(sheet.getBoundingClientRect().height)}px`); };
  if (typeof win.ResizeObserver === "function") new win.ResizeObserver(measure).observe(sheet);

  return {
    sync,
    /** Show the sheet for this part (an explicit tap on the part or its value), also after the user closed it before. */
    openFor(id) { requested = id; shownFor = null; sync(); return !sheet.hidden; },
    canAdjust: (component) => Boolean(primaryValueField(component, state.settings.analysis)),
    inspect: () => ({ visible: !sheet.hidden, phone: phone.matches, id: current?.id ?? null, prop: current?.field.prop ?? null, series, value: input.value, sliding: slideBase !== null }),
  };
}
