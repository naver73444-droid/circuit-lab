import { hoverReadout } from "./node-readout-model.js";

/**
 * Floating tooltip with analysis readouts over the circuit canvas: node voltage for pins, wires and junctions,
 * current/voltage/power for components. It only moves one position:fixed element (pointer-events:none); the canvas is never
 * re-rendered, and pointermove work is coalesced into one requestAnimationFrame.
 */
export function createHoverReadout({ state, elements, workspace, scopeView }) {
  const tip = elements["hover-tip"];
  const canvas = elements["circuit-canvas"];
  let frame = null;
  let pending = null;
  let visible = false;
  let lastKey = null;
  let lastResult = null;
  let size = { width: 0, height: 0 };
  let anchor = { x: 0, y: 0, touch: false };
  let touchTarget = null;
  let touchTimer = null;

  /** Map a pointer-event target element to a readout target (pins win over the component body). */
  function targetFromElement(element) {
    if (!element?.closest) return null;
    const pinElement = element.closest(".pin, .pin-hit");
    if (pinElement) {
      const owner = pinElement.closest(".component");
      return owner ? { kind: "pin", componentId: owner.dataset.id, pin: Number(pinElement.dataset.pin) } : null;
    }
    const junction = element.closest("[data-junction-id]");
    if (junction) return { kind: "junction", junctionId: junction.dataset.junctionId };
    const wire = element.closest("[data-wire-id]");
    if (wire) return { kind: "wire", wireId: wire.dataset.wireId };
    const component = element.closest(".component");
    if (component) return { kind: "component", componentId: component.dataset.id };
    return null;
  }

  /** Touch-module targets ({kind, id, pin}) to readout targets. */
  function targetFromTouch(target) {
    if (!target) return null;
    if (target.kind === "component") return { kind: "component", componentId: target.id };
    if (target.kind === "pin") return { kind: "pin", componentId: target.id, pin: target.pin };
    if (target.kind === "junction") return { kind: "junction", junctionId: target.id };
    if (target.kind === "wire") return { kind: "wire", wireId: target.id };
    return null;
  }

  const isStale = () => state.stale || state.runState.status === "stale";

  /** Which sample the readout shows: the scope cursor when one is set, else the last sample (DC always 0). */
  function sampleChoice(result) {
    if (result.analysis === "dc" || result.points.length <= 1) return { index: 0, source: "dc" };
    const cursor = scopeView.cursorIndex;
    if (Number.isInteger(cursor) && cursor >= 0 && cursor < result.points.length) {
      return { index: cursor, source: scopeView.pinnedIndex === cursor ? "pinned" : "cursor" };
    }
    return { index: result.points.length - 1, source: "last" };
  }

  function content(target) {
    const result = state.result;
    if (!result) return null;
    if (isStale()) return { title: "결과가 오래됨", lines: ["회로가 바뀌었습니다. 다시 해석하면 값이 갱신됩니다."], footer: "" };
    const choice = sampleChoice(result);
    const readout = hoverReadout({ circuit: state.circuit, result, target, index: choice.index, acBasis: state.acBasis });
    if (!readout.ok) return null;
    const body = readout.lines.slice(0, -1);
    const suffix = choice.source === "last" ? " · 마지막 표본" : choice.source === "pinned" ? " · 커서 고정" : choice.source === "cursor" ? " · 그래프 커서" : "";
    return { title: readout.title, lines: body, footer: `${readout.sample.xText}${suffix}` };
  }

  function paint(model) {
    tip.replaceChildren();
    const title = document.createElement("strong");
    title.textContent = model.title;
    tip.append(title);
    for (const line of model.lines) {
      const row = document.createElement("span");
      row.textContent = line;
      tip.append(row);
    }
    if (model.footer) {
      const footer = document.createElement("small");
      footer.textContent = model.footer;
      tip.append(footer);
    }
    tip.classList.toggle("stale", model.title === "결과가 오래됨");
  }

  function place() {
    const margin = 6;
    let x;
    let y;
    if (anchor.touch) {
      x = anchor.x - size.width / 2;
      y = anchor.y - size.height - 30;
    } else {
      x = anchor.x + 14;
      y = anchor.y + 18;
      if (x + size.width > innerWidth - margin) x = anchor.x - size.width - 14;
      if (y + size.height > innerHeight - margin) y = anchor.y - size.height - 14;
    }
    x = Math.max(margin, Math.min(innerWidth - size.width - margin, x));
    y = Math.max(margin, Math.min(innerHeight - size.height - margin, y));
    tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  function hide() {
    if (frame !== null) { cancelAnimationFrame(frame); frame = null; }
    pending = null;
    if (touchTimer !== null) { clearTimeout(touchTimer); touchTimer = null; }
    touchTarget = null;
    lastKey = null;
    if (!visible) return;
    visible = false;
    tip.classList.add("hidden");
  }

  function canShow() {
    return workspace.circuitActive && !workspace.switching && Boolean(state.result)
      && state.pointerOwnerId === null && !state.drag && !state.pendingPin && !state.port.mode && !state.tool.startsWith("place:");
  }

  function show(target) {
    if (!target) return hide();
    const key = `${target.kind}|${target.componentId ?? target.junctionId ?? target.wireId}|${target.pin ?? ""}|${state.generation}|${state.result === lastResult}|${isStale()}|${scopeView.cursorIndex}|${state.result?.points?.length}`;
    if (!visible || key !== lastKey || lastResult !== state.result) {
      const model = content(target);
      if (!model) return hide();
      lastKey = key;
      lastResult = state.result;
      paint(model);
      if (!visible) { tip.classList.remove("hidden"); visible = true; }
      size = { width: tip.offsetWidth, height: tip.offsetHeight };
    }
    place();
  }

  function flush() {
    frame = null;
    const request = pending;
    pending = null;
    if (!request) return;
    if (!canShow()) return hide();
    anchor = { x: request.x, y: request.y, touch: false };
    show(targetFromElement(request.element));
  }

  function schedule(request) {
    pending = request;
    if (frame === null) frame = requestAnimationFrame(flush);
  }

  /** Re-evaluate after the circuit or result changed under a stationary pointer (called from renderAll). */
  function refresh() {
    if (!visible) return;
    if (touchTarget) {
      if (!canShow()) return hide();
      show(touchTarget);
      return;
    }
    if (anchor.x === 0 && anchor.y === 0) return;
    schedule({ element: document.elementFromPoint(anchor.x, anchor.y), x: anchor.x, y: anchor.y });
  }

  /** A touch tap on a circuit item pops the readout above the finger for a few seconds. */
  function showTouch(target, clientX, clientY) {
    const mapped = targetFromTouch(target);
    if (!mapped || !state.result || !workspace.circuitActive) return hide();
    if (touchTimer !== null) clearTimeout(touchTimer);
    anchor = { x: clientX, y: clientY, touch: true };
    touchTarget = mapped;
    lastKey = null;
    show(mapped);
    if (visible) touchTimer = setTimeout(hide, 3500);
  }

  function attach() {
    canvas.addEventListener("pointermove", (event) => {
      if (event.pointerType === "touch") return;
      if (!state.result && !visible) return;
      schedule({ element: event.target, x: event.clientX, y: event.clientY });
    });
    canvas.addEventListener("pointerleave", () => { if (!touchTarget) hide(); });
    window.addEventListener("pointerdown", () => hide(), true);
    canvas.addEventListener("wheel", hide, { passive: true });
    window.addEventListener("blur", hide);
    document.addEventListener("keydown", (event) => { if (visible && event.key !== "Shift" && event.key !== "Control") hide(); });
  }

  return { attach, hide, refresh, showTouch, inspect: () => ({ visible, text: visible ? tip.textContent : "", stale: tip.classList.contains("stale") }) };
}
