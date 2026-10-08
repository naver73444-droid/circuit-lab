/**
 * Phone helpers that float on the circuit canvas (phone layout only; the desktop toolbar and properties panel stay as they are):
 *  - Selection bar: a small row of actions right above what is selected (rotate, duplicate, value, wire, delete; a wire gets "V 측정" and
 *    delete). Kept to five buttons so it fits beside other parts on a 360 px screen. It sits ABOVE the selection so the finger that tapped the part never covers it, and steps below when there is no
 *    room above. It appears only for a selection the user made by tapping/clicking it (arm()), not for a part that merely stayed selected
 *    after placing it or after switching tools, so it never pops up over a spot the user is about to tap. Hidden while something is being
 *    dragged, while wiring and outside the select tool.
 *  - Place strip: while a part is being placed (palette → canvas taps), the basic parts and "완료" sit at the top of the canvas, so the next
 *    kind of part is one tap away instead of a trip back to the palette tab.
 * Both elements are built once and only shown/hidden/moved; every action goes through the editor's own commands (one undo step each).
 */
import { PHONE_QUERY } from "./responsive-editor.js";
import { selectedItems } from "./selection-model.js";

const PLACE_TYPES = [["R", "R", "저항"], ["C", "C", "커패시터"], ["L", "L", "인덕터"], ["GND", "⏚", "접지"], ["V", "V±", "전압원"], ["I", "I↑", "전류원"]];
const ACTIONS = [
  ["rotate", "↻", "회전"], ["clone", "⧉", "복제"], ["value", "Ω", "값"], ["wire", "╱", "배선"],
  ["voltage", "V", "V 측정"], ["delete", "⌫", "삭제"],
];
const GAP_PX = 10;
const EDGE_PX = 4;

export function createCanvasActions(deps) {
  const { state, wrap, canvas, isCircuitUiActive, commands, win = window, doc = document } = deps;
  const phone = win.matchMedia(PHONE_QUERY);

  const bar = doc.createElement("div");
  bar.id = "selection-bar";
  bar.className = "selection-bar";
  bar.hidden = true;
  bar.setAttribute("role", "toolbar");
  bar.setAttribute("aria-label", "선택 항목 동작");
  const actionButton = ([action, icon, label]) =>
    `<button type="button" data-sel-action="${action}" aria-label="${label}" title="${label}"><b aria-hidden="true">${icon}</b><span aria-hidden="true">${label}</span></button>`;
  bar.innerHTML = ACTIONS.map(actionButton).join("");

  const strip = doc.createElement("div");
  strip.id = "place-strip";
  strip.className = "place-strip";
  strip.hidden = true;
  strip.setAttribute("role", "toolbar");
  strip.setAttribute("aria-label", "놓을 부품 바꾸기");
  strip.innerHTML = PLACE_TYPES.map(([type, symbol, label]) => `<button type="button" data-place="${type}" aria-label="${label} 놓기" title="${label}" aria-pressed="false">${symbol}</button>`).join("")
    + `<button type="button" class="place-done" data-place-action="done" title="놓기 끝내기 (선택 도구)">완료</button>`;
  wrap.append(strip, bar);

  // Taps on the floating rows must never start a canvas gesture underneath.
  for (const element of [bar, strip]) element.addEventListener("pointerdown", (event) => event.stopPropagation());

  let frame = null;
  let shownFor = "";
  let armed = ""; // selection key the user explicitly chose; the bar shows only while the selection is still exactly that

  const selectionKey = () => selectedItems(state).map((item) => `${item.kind}:${item.id}`).sort().join("|");

  /** What the bar acts on: the single selected item (component / wire / junction) or a multi-selection (rotate · duplicate · delete). */
  function subject() {
    const items = selectedItems(state);
    if (!items.length) return null;
    if (items.length > 1) return { kind: "multi", items, hasComponent: items.some((item) => item.kind === "component") };
    const [item] = items;
    if (item.kind === "component") {
      const component = state.circuit.components.find((entry) => entry.id === item.id);
      return component ? { kind: "component", items, component } : null;
    }
    if (item.kind === "wire") return state.circuit.wires.some((wire) => wire.id === item.id) ? { kind: "wire", items } : null;
    return (state.circuit.junctions ?? []).some((junction) => junction.id === item.id) ? { kind: "junction", items } : null;
  }

  function actionsFor(target) {
    if (target.kind === "component") return ["rotate", "clone", "value", "wire", "delete"];
    if (target.kind === "wire") return ["voltage", "delete"];
    if (target.kind === "junction") return ["wire", "voltage", "delete"];
    return target.hasComponent ? ["rotate", "clone", "delete"] : ["delete"];
  }

  /** Screen rectangle (client px) around the selected items, or null when none of them is drawn. */
  function selectionRect(items) {
    let box = null;
    for (const item of items) {
      const node = item.kind === "component"
        ? canvas.querySelector(`.component[data-id="${CSS.escape(item.id)}"]`)
        : item.kind === "wire"
          ? canvas.querySelector(`[data-wire-id="${CSS.escape(item.id)}"] .wire`)
          : canvas.querySelector(`[data-junction-id="${CSS.escape(item.id)}"]`);
      if (!node) continue;
      // A part's symbol and name, without the delete/connection badges that stick out around it.
      const parts = item.kind === "component" ? node.querySelectorAll(".body, .lead, .symbol-line, .component-hit, .label") : [node];
      for (const part of parts) {
        const r = part.getBoundingClientRect();
        if (!(r.width + r.height > 0)) continue;
        box = box ? { left: Math.min(box.left, r.left), top: Math.min(box.top, r.top), right: Math.max(box.right, r.right), bottom: Math.max(box.bottom, r.bottom) } : { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      }
    }
    return box;
  }

  const editingNow = () => state.tool === "select" && !state.pendingPin && !state.port.mode && !state.inlineEdit && !(state.drag && state.drag.moved);

  function update() {
    frame = null;
    const active = phone.matches && isCircuitUiActive();
    // Place strip: phone, a part is armed for placing.
    const placing = active && state.tool.startsWith("place:");
    strip.hidden = !placing;
    if (placing) for (const button of strip.querySelectorAll("[data-place]")) button.setAttribute("aria-pressed", String(state.tool === `place:${button.dataset.place}`));
    // Selection bar.
    const target = active && editingNow() && armed && armed === selectionKey() ? subject() : null;
    if (!target) { bar.hidden = true; shownFor = ""; return; } // (no layout reads on the desktop or mid-drag)
    const box = selectionRect(target.items);
    const host = wrap.getBoundingClientRect();
    const onScreen = box && box.right > host.left && box.left < host.right && box.bottom > host.top && box.top < host.bottom;
    if (!onScreen) { bar.hidden = true; shownFor = ""; return; }
    const allowed = new Set(actionsFor(target));
    const key = `${target.kind}|${[...allowed].join(",")}`;
    if (key !== shownFor) {
      for (const button of bar.querySelectorAll("[data-sel-action]")) button.hidden = !allowed.has(button.dataset.selAction);
      shownFor = key;
    }
    bar.hidden = false;
    const spot = placeBar(box, host, bar.offsetWidth, bar.offsetHeight, new Set(target.items.filter((item) => item.kind === "component").map((item) => item.id)));
    bar.style.transform = `translate(${Math.round(spot.left)}px, ${Math.round(spot.top)}px)`;
    bar.dataset.side = spot.side;
  }

  /**
   * Where the bar goes, in px inside the canvas box: above the selection if it fits, else below it, never over the canvas corner
   * (undo · zoom) or the part strip, nor behind the value sheet / tab bar that cover the lower screen, and preferably not over another
   * part (so the next part the student taps is still there). Falls back to "above, clamped".
   */
  function placeBar(box, host, width, height, selectedIds) {
    const rects = (elements) => elements.filter((element) => element && !element.hidden && element.getClientRects().length)
      .map((element) => element.getBoundingClientRect()).filter((r) => r.width + r.height > 0); // a part's hit line is 0 px thick one way
    const covers = rects([doc.getElementById("canvas-corner"), strip]);
    const parts = rects([...canvas.querySelectorAll(".component")].filter((group) => !selectedIds.has(group.dataset.id)).map((group) => group.querySelector(".component-hit")))
      .map((r) => ({ left: r.left - 12, right: r.right + 12, top: r.top - 12, bottom: r.bottom + 12 }));
    let bottomLimit = host.bottom;
    for (const element of [doc.getElementById("value-sheet"), doc.querySelector(".view-tabs")]) {
      if (!element || element.hidden) continue;
      const style = win.getComputedStyle(element);
      if (style.position !== "fixed" || style.display === "none" || style.visibility === "hidden") continue;
      const top = element.getBoundingClientRect().top;
      if (top > host.top) bottomLimit = Math.min(bottomLimit, top);
    }
    const maxTop = bottomLimit - host.top - height - EDGE_PX;
    const centre = (Math.max(box.left, host.left) + Math.min(box.right, host.right)) / 2 - host.left;
    const clampLeft = (left) => Math.max(EDGE_PX, Math.min(host.width - width - EDGE_PX, left));
    const overlaps = (list, left, top) => list.some((r) => left + host.left < r.right && left + host.left + width > r.left && top + host.top < r.bottom && top + host.top + height > r.top);
    const rows = [["above", box.top - host.top - GAP_PX - height], ["below", box.bottom - host.top + GAP_PX]].filter(([, top]) => top >= EDGE_PX && top <= maxTop);
    const lefts = [...new Set([centre - width / 2, box.left - host.left, box.right - host.left - width,
      ...[...covers, ...parts].flatMap((r) => [r.left - host.left - width - EDGE_PX, r.right - host.left + EDGE_PX])].map(clampLeft))];
    for (const avoidParts of [true, false]) {
      for (const [side, top] of rows) {
        const left = lefts.find((candidate) => !overlaps(covers, candidate, top) && !(avoidParts && overlaps(parts, candidate, top)));
        if (left !== undefined) return { left, top, side };
      }
    }
    return { left: clampLeft(centre - width / 2), top: Math.max(EDGE_PX, Math.min(maxTop, box.top - host.top - GAP_PX - height)), side: "above" };
  }

  /** Re-place the floating rows on the next frame (selection, render, pan/zoom, tool or layout change). */
  function schedule() {
    if (frame === null) frame = win.requestAnimationFrame(update);
  }

  bar.addEventListener("click", (event) => {
    const button = event.target.closest?.("[data-sel-action]");
    if (!button || !isCircuitUiActive()) return;
    const target = subject();
    if (!target) return;
    const action = button.dataset.selAction;
    if (action === "rotate") commands.rotate();
    else if (action === "clone") commands.clone();
    else if (action === "delete") commands.remove();
    else if (action === "value" && target.kind === "component") commands.editValue(target.component.id);
    else if (action === "wire") commands.startWire(target);
    else if (action === "voltage") commands.voltageProbe(target.items[0]);
    armed = selectionKey(); // the bar follows what the action left selected (the duplicate after 복제; nothing after 삭제)
    schedule();
  });
  strip.addEventListener("click", (event) => {
    const button = event.target.closest?.("[data-place], [data-place-action]");
    if (!button || !isCircuitUiActive()) return;
    if (button.dataset.place) commands.setTool(`place:${button.dataset.place}`);
    else commands.setTool("select");
    schedule();
  });
  phone.addEventListener?.("change", schedule);
  win.addEventListener("resize", schedule);

  return {
    schedule,
    /** The user just chose the current selection (tap, click, a finished pick-up drag): show the bar for it. */
    arm() { armed = selectionKey(); schedule(); },
    inspect: () => ({
      bar: !bar.hidden, actions: [...bar.querySelectorAll("[data-sel-action]")].filter((button) => !button.hidden).map((button) => button.dataset.selAction), side: bar.dataset.side ?? null,
      armed: Boolean(armed) && armed === selectionKey(), strip: !strip.hidden, placing: state.tool.startsWith("place:") ? state.tool.slice(6) : null,
    }),
  };
}
