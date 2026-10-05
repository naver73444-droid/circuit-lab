import { componentDefaults, pinCount } from "./circuit-engine.js";
import {
  cloneComponentSet,
  deleteJunctionFromCircuit,
  deleteComponentFromCircuit,
  endpointsEqual,
  retargetWireProbes,
  splitWireAtJunction,
} from "./circuit-edit.js";
import { GRID_SIZE, appendFixedWaypoint, snapPoint } from "./circuit-geometry.js";
import { shortcutFor } from "./editor-shortcuts.js";
import { stepSeriesText } from "./value-series.js";
import { probeKeysForTarget } from "./ui-model.js";
import { beginPointerSession, finishPointerSession, ownsPointer } from "./pointer-session.js";
import { advanceCursorPointerSession, isTapGesture } from "./cursor-label-model.js";
import { escapeHtml } from "./safe-dom.js";
import { traceColor } from "./trace-color.js";
import { passedDragSlop, nearestScreenTarget, CANVAS_VIEW_MIN_WIDTH, CANVAS_VIEW_MAX_WIDTH } from "./interaction-math.js";
import { installCanvasTouch } from "./canvas-touch.js";
import { distanceToSegment } from "./touch-targets.js";

// [type, symbol, label, basic]: non-basic parts (dependent sources, sensors) sit under "더보기".
const PALETTE = [
  ["R", "R", "저항", true], ["C", "C", "커패시터", true], ["L", "L", "인덕터", true], ["GND", "⏚", "접지", true],
  ["V", "V±", "전압원", true], ["I", "I↑", "전류원", true], ["D", "▷|", "다이오드", true], ["OPAMP", "▷", "간략 OP AMP", true], ["OPAMP_IDEAL", "▷∞", "이상 OP AMP", true],
  ["VCVS", "◇V", "전압 제어 전압원", false], ["VCCS", "◇I", "전압 제어 전류원", false],
  ["CURRENT_SENSOR", "S→", "0 V 전류 센서", false], ["CCCS", "◇β", "전류 제어 전류원", false], ["CCVS", "◇R", "전류 제어 전압원", false],
];

/** Tool, wiring and pointer slice of the shared state. */
export function createInputState() {
  return {
    tool: "select",
    pendingPin: null,
    pendingWaypoints: [],
    pointer: null,
    drag: null,
    ignoreClickUntil: 0,
    pointerOwnerId: null,
    canvasView: { x: 0, y: 0, width: 760, height: 500 },
  };
}

/** Tools, placement, wiring, probe placement and every canvas/plot pointer, wheel, touch and keyboard gesture. */
export function createEditorInput(deps) {
  const { state, elements, workspace, scopeView, mutate, mutateGrouped, closeEditGroup, snapshot, commitMove, undo, redo, runAnalysis, saveProject, hover, addVoltageProbe, addVoltageProbeEndpoint, addCurrentProbe, removeProbe,
    renderCanvas, renderOverlay, scheduleCanvasRender, scheduleOverlayRender, updateCanvasView, endpointPosition, pinPosition, routeForWireId,
    renderAll, renderInspector, openInlineEditor, closeInlineEditor, assignPortEndpoint, presentProbe, setStatus, showInspector, showCanvas, isCircuitUiActive } = deps;
  let canvasTouch = null;

  // ---- plot pointer session (the scope plot shares pointerOwnerId with the canvas)

  let plotDrag = null;
  const finishPlotPointer = (pointerId, reason = "commit", event = null) => {
    if (plotDrag && event && ownsPointer(plotDrag, pointerId)) {
      const point = scopeView.point(event);
      plotDrag = advanceCursorPointerSession(plotDrag, { x: event.clientX, y: event.clientY }, point);
      if (!isTapGesture(plotDrag.maxDistance) && point) {
        plotDrag.panned = true;
        scopeView.panFrom(plotDrag.view, point.x - plotDrag.point.x);
      }
    }
    const completed = finishPointerSession(plotDrag, pointerId, reason);
    if (!completed.finished) return false;
    const drag = completed.finished;
    plotDrag = null;
    state.pointerOwnerId = null;
    releasePointer(elements["wave-plot"], pointerId);
    if (reason !== "commit") scopeView.restore(drag.view);
    else if (isTapGesture(drag.maxDistance)) scopeView.pinCursorAt(drag.lastPoint ?? drag.point);
    return true;
  };
  const cancelPlotSession = () => { if (plotDrag) finishPlotPointer(plotDrag.pointerId, "cancel"); };

  // ---- pointer helpers

  function capturePointer(element, pointerId) {
    try { element.setPointerCapture?.(pointerId); } catch { /* synthetic/ended pointers may not be capturable */ }
  }

  function releasePointer(element, pointerId) {
    try { if (element.hasPointerCapture?.(pointerId)) element.releasePointerCapture(pointerId); } catch { /* already released */ }
  }

  function svgPoint(event) {
    const matrix = elements["circuit-canvas"].getScreenCTM();
    if (!matrix || !Number.isFinite(matrix.a * matrix.d - matrix.b * matrix.c) || Math.abs(matrix.a * matrix.d - matrix.b * matrix.c) < 1e-12) return null;
    const transformed = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return Number.isFinite(transformed.x) && Number.isFinite(transformed.y) ? { x: transformed.x, y: transformed.y } : null;
  }

  // ---- tools and palette

  function setTool(tool) {
    state.port.mode = null;
    state.tool = tool;
    state.pendingPin = null;
    state.pendingWaypoints = [];
    state.pointer = null;
    document.querySelectorAll("[data-tool]").forEach((button) => button.classList.toggle("active", button.dataset.tool === tool));
    document.querySelectorAll(".palette-item").forEach((button) => button.classList.toggle("active", tool === `place:${button.dataset.type}`));
    const hints = {
      select: "클릭 선택 · 끌어서 이동 · 빈 곳 끌기로 화면 이동",
      pan: "화면 이동 — 부품은 움직이지 않습니다.",
      wire: "배선 — 핀을 누르고, 빈 격자점으로 꺾은 뒤 다른 핀·배선에서 끝냅니다.",
      "voltage-probe": "V 프로브 — 핀이나 배선을 누르면 접지 기준 전압이 추가됩니다.",
      "current-probe": "I 프로브 — 부품을 누르면 기준 방향 전류가 추가됩니다.",
    };
    elements["tool-hint"].textContent = tool.startsWith("place:") ? "캔버스를 눌러 배치 · 계속 놓을 수 있습니다 · Esc로 종료" : hints[tool];
    renderCanvas();
  }

  function renderPalette() {
    const item = ([type, symbol, label]) => `<button class="palette-item" data-type="${type}" type="button"><b>${symbol}</b><span>${label}</span></button>`;
    elements["palette-list"].innerHTML = PALETTE.filter((entry) => entry[3]).map(item).join("");
    document.getElementById("palette-more-list").innerHTML = PALETTE.filter((entry) => !entry[3]).map(item).join("");
    document.getElementById("palette-panel").querySelectorAll("button.palette-item").forEach((button) => button.addEventListener("click", () => { setTool(`place:${button.dataset.type}`); showCanvas(); }));
  }

  // ---- placement and wiring

  function nextId(type) {
    const prefix = type === "GND" ? "G" : ["OPAMP", "OPAMP_IDEAL"].includes(type) ? "U" : ({ VCVS: "E", VCCS: "G", CURRENT_SENSOR: "S", CCCS: "F", CCVS: "H" }[type] ?? type);
    let index = 1;
    const used = new Set(state.circuit.components.map((component) => component.id));
    while (used.has(`${prefix}${index}`)) index += 1;
    return `${prefix}${index}`;
  }

  function placeComponent(event) {
    if (!state.tool.startsWith("place:") || !event.target.classList.contains("canvas-bg")) return;
    const type = state.tool.split(":")[1];
    const point = svgPoint(event);
    if (!point) return;
    const id = nextId(type);
    const index = Number(id.match(/\d+/)?.[0] ?? 1);
    mutate(() => {
      state.circuit.components.push({ id, type, ...snapPoint(point), rotation: 0, props: componentDefaults(type, index) });
      state.selected = { kind: "component", id };
      state.title = state.title === "새 회로" ? "사용자 회로" : state.title;
      state.subtitle = "편집한 연결과 값으로 계산됩니다";
    });
  }

  function handleEndpointClick(target) {
    if (state.port.mode === "pick-p" || state.port.mode === "pick-n") {
      assignPortEndpoint(target);
      return;
    }
    if (state.tool === "wire" || state.tool === "select") {
      if (!state.pendingPin) {
        state.pendingPin = target;
        state.pendingWaypoints = [];
        state.pointer = endpointPosition(target);
        renderCanvas();
        return;
      }
      if (endpointsEqual(state.pendingPin, target)) {
        state.pendingPin = null;
        state.pendingWaypoints = [];
        state.pointer = null;
        renderCanvas();
        return;
      }
      const duplicate = state.circuit.wires.some((wire) => {
        return (endpointsEqual(wire.a, state.pendingPin) && endpointsEqual(wire.b, target))
          || (endpointsEqual(wire.b, state.pendingPin) && endpointsEqual(wire.a, target));
      });
      const start = structuredClone(state.pendingPin);
      const waypoints = structuredClone(state.pendingWaypoints);
      state.pendingPin = null;
      state.pendingWaypoints = [];
      state.pointer = null;
      if (!duplicate) mutate(() => state.circuit.wires.push({ id: `W${Date.now().toString(36)}${state.circuit.wires.length}`, a: start, b: target, waypoints }));
      else renderCanvas();
      return;
    }
  }

  function addPendingWaypoint(point) {
    if (!state.pendingPin) return;
    const start = endpointPosition(state.pendingPin);
    if (!start) return;
    const target = snapPoint(point);
    state.pendingWaypoints = appendFixedWaypoint(start, state.pendingWaypoints, target);
    state.pointer = target;
    elements["tool-hint"].textContent = `고정 꺾임 ${state.pendingWaypoints.length}개 · 빈 격자점을 더 누르거나 핀/배선/접속점에서 완료 · Esc 취소`;
    renderOverlay();
  }

  function handlePinClick(componentId, pin, wireId = null) {
    const target = { componentId, pin };
    if (state.tool === "wire" || state.tool === "select") return handleEndpointClick(target);
    if (state.tool === "voltage-probe") addVoltageProbe(componentId, pin, wireId);
  }

  // ---- per-item event binding for the freshly rendered canvas

  function bindCanvasItems() {
    elements["component-layer"].querySelectorAll("[data-show-connection], [data-delete-component]").forEach((button) => {
      const activate = (event) => {
        event.preventDefault();
        event.stopPropagation();
        const id = button.dataset.deleteComponent ?? button.dataset.showConnection;
        state.selected = { kind: "component", id };
        if (button.dataset.deleteComponent) deleteSelection();
        else { showInspector(); renderAll(); }
      };
      button.addEventListener("pointerdown", (event) => event.stopPropagation());
      button.addEventListener("click", activate);
      button.addEventListener("keydown", (event) => { if (["Enter", " "].includes(event.key)) activate(event); });
    });
    elements["component-layer"].querySelectorAll(".pin, .pin-hit").forEach((pin) => {
      pin.addEventListener("click", (event) => {
        event.stopPropagation();
        const group = pin.closest(".component");
        handlePinClick(group.dataset.id, Number(pin.dataset.pin));
      });
      pin.addEventListener("contextmenu", (event) => {
        const group = pin.closest(".component");
        const keys = probeKeysForTarget(state.probes, { kind: "pin", componentId: group.dataset.id, pin: Number(pin.dataset.pin) });
        if (keys.length) openProbeContextMenu(keys, event);
      });
    });
    elements["component-layer"].querySelectorAll(".component").forEach((group) => {
      group.addEventListener("click", (event) => {
        if (event.target.classList.contains("pin") || event.target.classList.contains("pin-hit") || performance.now() < state.ignoreClickUntil) return;
        const id = group.dataset.id;
        if (state.tool === "current-probe") addCurrentProbe(id);
        else if (state.tool === "select") {
          state.selected = { kind: "component", id };
          // Preserve the clicked text node so a native second click can produce dblclick.
          if (event.target.classList.contains("value-label")) renderInspector();
          else renderAll();
        }
      });
      group.querySelector(".value-label")?.addEventListener("dblclick", (event) => {
        event.stopPropagation();
        openInlineEditor(group.dataset.id, event.target.dataset.editProp, event);
      });
      group.addEventListener("pointerdown", (event) => {
        if (state.tool !== "select" || event.target.classList.contains("pin") || event.target.classList.contains("pin-hit") || event.target.classList.contains("value-label") || event.button !== 0) return;
        event.preventDefault();
        const component = state.circuit.components.find((item) => item.id === group.dataset.id);
        const point = svgPoint(event);
        if (!point) return;
        if (!beginCanvasPointer(event, { kind: "component", id: component.id, start: point, origin: { x: component.x, y: component.y }, before: snapshot(), moved: false })) return;
        state.selected = { kind: "component", id: component.id };
        renderInspector();
      });
      group.addEventListener("contextmenu", (event) => {
        if (event.target.classList.contains("pin") || event.target.classList.contains("pin-hit")) return;
        const keys = probeKeysForTarget(state.probes, { kind: "component", componentId: group.dataset.id });
        if (keys.length) openProbeContextMenu(keys, event);
      });
    });
    elements["wire-layer"].querySelectorAll("[data-wire-id]").forEach((group) => group.addEventListener("click", (event) => {
      event.stopPropagation();
      const wire = state.circuit.wires.find((item) => item.id === group.dataset.wireId);
      if (!wire) return;
      if ((state.tool === "wire" || state.tool === "select") && state.pendingPin) createJunctionAndConnect(wire.id, svgPoint(event));
      else if (state.tool === "voltage-probe") addVoltageProbeEndpoint(wire.a.componentId !== undefined ? wire.a : wire.b, wire.id);
      else if (state.tool === "select") {
        state.selected = { kind: "wire", id: wire.id };
        elements["wire-layer"].querySelectorAll(".wire").forEach((line) => line.classList.toggle("selected", line.closest("[data-wire-id]")?.dataset.wireId === wire.id));
        renderInspector();
        elements["delete-button"].disabled = false;
      }
    }));
    elements["wire-layer"].querySelectorAll("[data-wire-id]").forEach((group) => group.addEventListener("dblclick", (event) => {
      if (state.tool !== "select" || state.pendingPin) return;
      event.stopPropagation();
      createJunctionOnWire(group.dataset.wireId, svgPoint(event));
    }));
    elements["wire-layer"].querySelectorAll("[data-wire-id]").forEach((group) => group.addEventListener("contextmenu", (event) => {
      const keys = probeKeysForTarget(state.probes, { kind: "wire", wireId: group.dataset.wireId });
      if (keys.length) openProbeContextMenu(keys, event);
    }));
  }

  function bindOverlayItems() {
    elements["overlay-layer"].querySelectorAll("[data-junction-id]").forEach((group) => {
      group.addEventListener("click", (event) => {
        event.stopPropagation();
        if (performance.now() < state.ignoreClickUntil) return;
        const junctionId = group.dataset.junctionId;
        if (state.tool === "voltage-probe") addVoltageProbeEndpoint({ junctionId });
        else handleEndpointClick({ junctionId });
      });
      group.addEventListener("pointerdown", (event) => {
        if (state.tool !== "select" || state.port.mode || event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        const junction = (state.circuit.junctions ?? []).find((item) => item.id === group.dataset.junctionId);
        const point = svgPoint(event);
        if (!point) return;
        if (!beginCanvasPointer(event, { kind: "junction", id: junction.id, start: point, origin: { x: junction.x, y: junction.y }, before: snapshot(), moved: false })) return;
        state.selected = { kind: "junction", id: junction.id };
        renderInspector();
      });
      group.addEventListener("contextmenu", (event) => {
        const keys = probeKeysForTarget(state.probes, { kind: "junction", junctionId: group.dataset.junctionId });
        if (keys.length) openProbeContextMenu(keys, event);
      });
    });
  }

  // ---- junction commands

  function createJunctionOnWire(wireId, point) {
    mutate(() => {
      const split = splitWireAtJunction(state.circuit, wireId, point, routeForWireId(wireId));
      state.circuit = split.circuit;
      state.probes = retargetWireProbes(state.probes, wireId, split.replacementWireId, split);
      state.selected = split.endpoint.junctionId ? { kind: "junction", id: split.endpoint.junctionId } : { kind: "component", id: split.endpoint.componentId };
    });
  }

  function createJunctionAndConnect(wireId, point) {
    const start = structuredClone(state.pendingPin);
    const waypoints = structuredClone(state.pendingWaypoints);
    const routePoints = routeForWireId(wireId);
    state.pendingPin = null;
    state.pendingWaypoints = [];
    state.pointer = null;
    mutate(() => {
      const split = splitWireAtJunction(state.circuit, wireId, point, routePoints);
      state.circuit = split.circuit;
      state.probes = retargetWireProbes(state.probes, wireId, split.replacementWireId, split);
      const duplicate = state.circuit.wires.some((wire) => (endpointsEqual(wire.a, start) && endpointsEqual(wire.b, split.endpoint)) || (endpointsEqual(wire.b, start) && endpointsEqual(wire.a, split.endpoint)));
      if (!endpointsEqual(start, split.endpoint) && !duplicate) state.circuit.wires.push({ id: `W${Date.now().toString(36)}${state.circuit.wires.length}`, a: start, b: split.endpoint, waypoints });
      state.selected = split.endpoint.junctionId ? { kind: "junction", id: split.endpoint.junctionId } : { kind: "component", id: split.endpoint.componentId };
    });
  }

  // ---- probe context menu

  function closeProbeContextMenu() {
    if (!elements["probe-context-menu"]) return;
    elements["probe-context-menu"].classList.add("hidden");
    elements["probe-context-menu"].innerHTML = "";
  }

  function openProbeContextMenu(keys, event) {
    if (!keys.length) return false;
    event.preventDefault();
    event.stopPropagation();
    if (keys.length === 1) {
      removeProbe(keys[0]);
      setStatus("해당 프로브 제거 완료", "ready");
      return true;
    }
    const menu = elements["probe-context-menu"];
    const wrap = document.getElementById("canvas-wrap").getBoundingClientRect();
    const candidates = keys.map((key) => presentProbe(state.probes.find((probe) => probe.key === key))).filter(Boolean);
    menu.innerHTML = `<strong>제거할 프로브</strong>${candidates.map((probe) => `<button type="button" data-context-remove="${escapeHtml(probe.key)}"><i style="--chip-color:${traceColor(probe.color)}"></i>${escapeHtml(probe.label)}</button>`).join("")}`;
    menu.style.left = `${Math.max(4, Math.min(wrap.width - 210, event.clientX - wrap.left))}px`;
    menu.style.top = `${Math.max(4, Math.min(wrap.height - 120, event.clientY - wrap.top))}px`;
    menu.classList.remove("hidden");
    menu.querySelectorAll("[data-context-remove]").forEach((button) => button.addEventListener("click", () => removeProbe(button.dataset.contextRemove)));
    return true;
  }

  // ---- selection commands

  function deleteSelection() {
    if (!state.selected) return;
    const selected = state.selected;
    if (state.inlineEdit?.componentId === selected.id) { state.inlineEdit = null; elements["inline-value-editor"].classList.add("hidden"); }
    mutate(() => {
      if (selected.kind === "component") {
        const deleted = deleteComponentFromCircuit(state.circuit, selected.id, state.probes);
        state.circuit = deleted.circuit;
        state.probes = deleted.probes;
      } else if (selected.kind === "junction") {
        const deleted = deleteJunctionFromCircuit(state.circuit, selected.id, state.probes);
        state.circuit = deleted.circuit;
        state.probes = deleted.probes;
      } else {
        state.circuit.wires = state.circuit.wires.filter((wire) => wire.id !== selected.id);
        state.probes = state.probes.filter((probe) => probe.wireId !== selected.id);
      }
      state.selected = null;
    });
  }

  function cloneSelection(event = null) {
    if (state.selected?.kind !== "component") return;
    const original = state.circuit.components.find((component) => component.id === state.selected.id);
    if (!original) return;
    const includeTarget = Boolean(event?.shiftKey && ["CCCS", "CCVS"].includes(original.type) && original.control?.elementId);
    const ids = includeTarget ? [original.control.elementId, original.id] : [original.id];
    const cloned = cloneComponentSet(state.circuit, ids);
    const selectedId = cloned.idMap.get(original.id);
    if (!selectedId) return;
    mutate(() => {
      state.circuit.components.push(...cloned.components);
      state.circuit.wires.push(...cloned.wires);
      state.selected = { kind: "component", id: selectedId };
    });
    setStatus(includeTarget ? "제어 대상·종속원 원자 복제 완료" : "부품 복제 완료 · 외부 제어 ID 유지", "ready");
  }

  function rotateSelection(direction = 1) {
    if (state.selected?.kind !== "component") return;
    mutate(() => {
      const component = state.circuit.components.find((item) => item.id === state.selected.id);
      component.rotation = (((component.rotation ?? 0) + 90 * direction) % 360 + 360) % 360;
    });
  }

  /** Arrow-key move by whole grid steps. A press is one history entry; held-key repeats extend that entry. */
  function nudgeSelection({ dx, dy, steps, repeat }) {
    const selected = state.selected;
    if (!selected || !["component", "junction"].includes(selected.kind) || state.pointerOwnerId !== null || state.pendingPin || state.inlineEdit) return false;
    const exists = selected.kind === "junction"
      ? (state.circuit.junctions ?? []).some((junction) => junction.id === selected.id)
      : state.circuit.components.some((component) => component.id === selected.id);
    if (!exists) return false;
    if (!repeat) closeEditGroup();
    mutateGrouped("nudge", () => {
      const item = selected.kind === "junction"
        ? state.circuit.junctions.find((junction) => junction.id === selected.id)
        : state.circuit.components.find((component) => component.id === selected.id);
      Object.assign(item, snapPoint({ x: item.x + dx * steps * GRID_SIZE, y: item.y + dy * steps * GRID_SIZE }));
    });
    return true;
  }

  /** Arrow keys are canvas keys: leave them to focused tabs, plots, menus and form controls. */
  function arrowKeysBelongToCanvas() {
    const active = document.activeElement;
    if (!active || active === document.body || active === document.documentElement) return true;
    if (active.closest?.("#circuit-canvas, #canvas-wrap")) return true;
    return active.tagName === "BUTTON" && !active.closest("[role=tablist], [role=tab]");
  }

  // Wheel over an R/C/L value label steps the value along the E12 series. Small trackpad deltas accumulate; a mouse notch is one step.
  const WHEEL_STEP_DELTA = 50;
  const wheelStep = { accumulated: 0, time: -Infinity };

  /** Returns true when the wheel event was consumed by value stepping (so the canvas must not zoom). */
  function wheelAdjustValue(event) {
    const label = event.target.closest?.(".value-label");
    if (!label || label.dataset.editProp !== "value") return false;
    const componentId = label.closest(".component")?.dataset.id;
    const component = state.circuit.components.find((item) => item.id === componentId);
    if (!component || !["R", "C", "L"].includes(component.type)) return false;
    if (state.inlineEdit?.componentId === component.id || state.pointerOwnerId !== null) return true;
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1);
    if (!delta) return true;
    const now = performance.now();
    if (now - wheelStep.time > 400 || Math.sign(delta) !== Math.sign(wheelStep.accumulated)) wheelStep.accumulated = 0;
    wheelStep.time = now;
    let direction = 0;
    if (Math.abs(delta) >= WHEEL_STEP_DELTA) { direction = -Math.sign(delta); wheelStep.accumulated = 0; }
    else {
      wheelStep.accumulated += delta;
      if (Math.abs(wheelStep.accumulated) >= WHEEL_STEP_DELTA) { direction = -Math.sign(wheelStep.accumulated); wheelStep.accumulated = 0; }
    }
    if (!direction) return true;
    const next = stepSeriesText(component.props?.value, direction);
    if (!next) return true;
    mutateGrouped(`wheel:${component.id}`, () => {
      state.circuit.components.find((item) => item.id === component.id).props.value = next.text;
    });
    return true;
  }

  // ---- canvas view

  function zoomCanvas(factor, anchor = { x: state.canvasView.x + state.canvasView.width / 2, y: state.canvasView.y + state.canvasView.height / 2 }) {
    const old = state.canvasView;
    const width = Math.max(CANVAS_VIEW_MIN_WIDTH, Math.min(CANVAS_VIEW_MAX_WIDTH, old.width * factor));
    const height = width * (old.height / old.width);
    const xRatio = (anchor.x - old.x) / old.width;
    const yRatio = (anchor.y - old.y) / old.height;
    state.canvasView = { x: anchor.x - width * xRatio, y: anchor.y - height * yRatio, width, height };
    updateCanvasView();
  }

  function fitCanvas() {
    const points = [
      ...state.circuit.components.map((component) => ({ x: component.x, y: component.y })),
      ...(state.circuit.junctions ?? []).map((junction) => ({ x: junction.x, y: junction.y })),
      ...state.circuit.wires.flatMap((wire) => wire.waypoints ?? []),
    ];
    if (!points.length) state.canvasView = { x: 0, y: 0, width: 760, height: 500 };
    else {
      const minX = Math.min(...points.map((point) => point.x)) - 90;
      const maxX = Math.max(...points.map((point) => point.x)) + 90;
      const minY = Math.min(...points.map((point) => point.y)) - 80;
      const maxY = Math.max(...points.map((point) => point.y)) + 80;
      const width = Math.max(260, maxX - minX);
      const height = Math.max(171, maxY - minY);
      const canvas = elements["circuit-canvas"];
      const aspect = canvas.clientWidth > 0 && canvas.clientHeight > 0 ? canvas.clientWidth / canvas.clientHeight : 760 / 500;
      if (width / height > aspect) state.canvasView = { x: minX, y: (minY + maxY) / 2 - width / aspect / 2, width, height: width / aspect };
      else state.canvasView = { x: (minX + maxX) / 2 - height * aspect / 2, y: minY, width: height * aspect, height };
    }
    renderCanvas();
  }

  // ---- canvas pointer gestures (mouse, pen and touch share these)

  function beginCanvasPointer(event, payload) {
    if (state.pointerOwnerId !== null) return false;
    const session = beginPointerSession(state.drag, event.pointerId, { ...payload, startClient: payload.startClient ?? { x: event.clientX, y: event.clientY }, pointerType: event.pointerType });
    if (!session || session === state.drag) return false;
    state.drag = session;
    state.pointerOwnerId = event.pointerId;
    capturePointer(elements["circuit-canvas"], event.pointerId);
    return true;
  }

  function finishCanvasPointer(pointerId, reason = "commit") {
    const completed = finishPointerSession(state.drag, pointerId, reason);
    if (!completed.finished) return false;
    const drag = completed.finished;
    state.drag = null;
    state.pointerOwnerId = null;
    releasePointer(elements["circuit-canvas"], pointerId);
    if (reason !== "commit") {
      if (drag.kind === "pan") state.canvasView = { ...drag.originView };
      else {
        const item = drag.kind === "junction"
          ? (state.circuit.junctions ?? []).find((junction) => junction.id === drag.id)
          : state.circuit.components.find((component) => component.id === drag.id);
        if (item) { item.x = drag.origin.x; item.y = drag.origin.y; }
      }
      renderAll();
      return true;
    }
    if (!drag.moved && drag.kind !== "pan") {
      // Pointer capture retargets the subsequent click to the SVG root. Commit the
      // selection visuals here so a normal tap exposes its real delete button.
      state.ignoreClickUntil = performance.now() + 180;
      renderAll();
    }
    if (drag.moved) {
      state.ignoreClickUntil = performance.now() + 180;
      if (drag.kind !== "pan") commitMove(drag.before);
    }
    return true;
  }

  function updateCanvasPointer(event) {
    if (!ownsPointer(state.drag, event.pointerId)) return;
    const drag = state.drag;
    if (!drag.moved && !passedDragSlop(drag.startClient, { x: event.clientX, y: event.clientY }, drag.pointerType)) return;
    drag.moved = true;
    if (drag.kind === "pan") {
      state.canvasView.x = drag.originView.x - (event.clientX - drag.startClient.x) / drag.screenScale;
      state.canvasView.y = drag.originView.y - (event.clientY - drag.startClient.y) / drag.screenScale;
      updateCanvasView();
      return;
    }
    const point = svgPoint(event);
    if (!point) return;
    const item = drag.kind === "junction" ? (state.circuit.junctions ?? []).find(j => j.id === drag.id) : state.circuit.components.find(c => c.id === drag.id);
    if (!item) return;
    Object.assign(item, snapPoint({ x: drag.origin.x + point.x - drag.start.x, y: drag.origin.y + point.y - drag.start.y }));
    scheduleCanvasRender();
  }

  // ---- touch hit testing and routing

  function pickTouchTarget(point) {
    const svg = elements["circuit-canvas"], matrix = svg.getScreenCTM();
    if (!matrix) return null;
    if (state.tool === "pan" || state.tool.startsWith("place:")) return { kind: "background" };
    const endpointMode = state.pendingPin || state.port.mode || ["wire", "voltage-probe"].includes(state.tool);
    const screen = p => new DOMPoint(p.x, p.y).matrixTransform(matrix);
    // Small connection badges have their own action, not an accidental pin action.
    const hitElement = document.elementFromPoint(point.x, point.y);
    const badge = hitElement?.closest("[data-show-connection]");
    const remove = hitElement?.closest("[data-delete-component]");
    const label = hitElement?.closest("[data-edit-prop]");
    if (!endpointMode && state.tool === "select" && remove) return {kind:"delete",id:remove.dataset.deleteComponent};
    if (!endpointMode && state.tool === "select" && label) return {kind:"properties",id:label.closest("[data-id]")?.dataset.id};
    if (!endpointMode && state.tool === "select" && badge) return { kind: "properties", id: badge.dataset.showConnection };
    if (!endpointMode) {
      let best = null, bestDistance = 23;
      for (const c of state.circuit.components) {
        const angle = (c.rotation ?? 0) * Math.PI / 180;
        const center = screen(c);
        const a = screen({ x:c.x - 30*Math.cos(angle), y:c.y - 30*Math.sin(angle) });
        const b = screen({ x:c.x + 30*Math.cos(angle), y:c.y + 30*Math.sin(angle) });
        const d = distanceToSegment(point, a, b);
        // Nearest center breaks overlap ties predictably, without DOM stacking.
        const score = d + Math.hypot(point.x-center.x,point.y-center.y)*.001;
        if (score < bestDistance) { bestDistance = score; best = { kind:"component", id:c.id }; }
      }
      if (best) return best;
    }
    const targets = [];
    const add = (world, target, radius) => { if (!world) return; const p = screen(world); targets.push({ ...target, x:p.x, y:p.y, radius }); };
    if (endpointMode) for (const c of state.circuit.components) for (let pin=0; pin<pinCount(c.type); pin++) add(pinPosition(c,pin), {kind:"pin",id:c.id,pin},22);
    if (state.tool !== "current-probe") for (const j of state.circuit.junctions ?? []) add(j,{kind:"junction",id:j.id},20);
    const nearest = nearestScreenTarget(point, targets);
    if (nearest) return nearest;
    if (state.tool !== "current-probe") {
      let hit = null, distance = 12;
      for (const wire of state.circuit.wires) {
        const pts = routeForWireId(wire.id).map(screen);
        for (let i=1;i<pts.length;i++) {
          const d = distanceToSegment(point,pts[i-1],pts[i]);
          if(d<distance){distance=d;hit={kind:"wire",id:wire.id};}
        }
      }
      if(hit)return hit;
    }
    return {kind:"background"};
  }

  function setupCanvasTouch() {
    const svg = elements["circuit-canvas"];
    canvasTouch = installCanvasTouch(svg, {
      canStart: () => state.pointerOwnerId === null,
      pick: pickTouchTarget,
      world: p => svgPoint({clientX:p.x,clientY:p.y}),
      view: () => ({...state.canvasView}),
      setView: view => { state.canvasView = view; updateCanvasView(); },
      begin: (event, target) => {
        if (!["select","pan"].includes(state.tool) || state.pendingPin || state.port.mode || !target) return;
        const point = svgPoint(event); if (!point) return;
        if (["component","junction"].includes(target.kind) && state.selected?.kind === target.kind && state.selected?.id === target.id && state.tool === "select") {
          const item = target.kind === "component" ? state.circuit.components.find(c=>c.id===target.id) : (state.circuit.junctions??[]).find(j=>j.id===target.id);
          if (item) beginCanvasPointer(event,{kind:target.kind,id:item.id,start:point,origin:{x:item.x,y:item.y},before:snapshot(),moved:false});
        } else if (["background","component","junction","wire"].includes(target.kind)) {
          // First swipe navigates. Only an already selected object can be dragged.
          const scale = svg.getScreenCTM()?.a;
          if(scale>0)beginCanvasPointer(event,{kind:"pan",screenScale:scale,originView:{...state.canvasView},moved:false});
        }
      },
      move: updateCanvasPointer,
      finish: finishCanvasPointer,
      tap: (event, target) => {
        const point = svgPoint(event); if(!target || !point || state.tool === "pan")return;
        hover.showTouch(target, event.clientX, event.clientY);
        if(target.kind === "delete") { if(state.selected?.kind === "component" && state.selected.id === target.id) deleteSelection(); return; }
        if(target.kind === "properties") { state.selected={kind:"component",id:target.id}; renderAll(); showInspector(); return; }
        if(target.kind === "pin") { handlePinClick(target.id,target.pin); return; }
        if(target.kind === "junction") {
          if(state.tool === "voltage-probe") addVoltageProbeEndpoint({junctionId:target.id});
          else if(state.port.mode || state.tool === "wire" || state.pendingPin) handleEndpointClick({junctionId:target.id});
          else { state.selected={kind:"junction",id:target.id};renderAll(); }
          return;
        }
        if(target.kind === "component") {
          if(state.tool === "current-probe")addCurrentProbe(target.id);
          else {state.selected={kind:"component",id:target.id};renderAll();}
          return;
        }
        if(target.kind === "wire") {
          const wire=state.circuit.wires.find(w=>w.id===target.id); if(!wire)return;
          if(state.pendingPin)createJunctionAndConnect(wire.id,point);
          else if(state.tool === "voltage-probe")addVoltageProbeEndpoint(wire.a.componentId !== undefined ? wire.a : wire.b,wire.id);
          else if(state.tool === "select"){state.selected={kind:"wire",id:wire.id};renderAll();}
          return;
        }
        if(state.pendingPin)addPendingWaypoint(point);
        else if(state.tool.startsWith("place:"))placeComponent({clientX:event.clientX,clientY:event.clientY,target:svg.querySelector(".canvas-bg")});
        else if(state.tool === "select"){state.selected=null;renderAll();}
      },
    });
  }

  // ---- interaction cancel (workspace switch, project reset, panel change)

  /** Abort any pointer gesture on the canvas or the plot. */
  function cancelPointerSessions() {
    if (state.drag) finishCanvasPointer(state.drag.pointerId, "cancel");
    cancelPlotSession();
  }

  function cancelInteractions() {
    canvasTouch?.cancel();
    cancelPointerSessions();
  }

  /** Register every canvas, plot, toolbar and keyboard listener owned by this module. */
  function attach() {
    document.addEventListener("click", (event) => {
      if (!event.target.closest("#probe-context-menu")) closeProbeContextMenu();
    });
    document.querySelectorAll("[data-tool]").forEach((button) => button.addEventListener("click", () => setTool(button.dataset.tool)));
    elements["circuit-canvas"].addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || !["select", "pan"].includes(state.tool) || (state.tool !== "pan" && !event.target.classList.contains("canvas-bg")) || state.pendingPin) return;
      beginCanvasPointer(event, { kind: "pan", startClient: { x: event.clientX, y: event.clientY }, screenScale: elements["circuit-canvas"].getScreenCTM().a, originView: { ...state.canvasView }, moved: false });
    });
    elements["circuit-canvas"].addEventListener("click", (event) => {
      if (performance.now() < state.ignoreClickUntil) return;
      if (event.target.classList.contains("canvas-bg")) {
        if (state.pendingPin) {
          addPendingWaypoint(svgPoint(event));
          return;
        }
        placeComponent(event);
        if (state.tool === "select" && performance.now() >= state.ignoreClickUntil) { state.selected = null; renderAll(); }
      }
    });
    window.addEventListener("pointermove", (event) => {
      if (!workspace.circuitActive) return;
      if (state.pendingPin && event.isPrimary !== false && event.target.closest?.("#circuit-canvas")) {
        const point = svgPoint(event);
        if (point) { state.pointer = snapPoint(point); scheduleOverlayRender(); }
      }
      updateCanvasPointer(event);
    });
    window.addEventListener("pointerup", (event) => { if (workspace.circuitActive) finishCanvasPointer(event.pointerId, "commit"); });
    elements["circuit-canvas"].addEventListener("pointercancel", (event) => finishCanvasPointer(event.pointerId, "cancel"));
    elements["circuit-canvas"].addEventListener("lostpointercapture", (event) => finishCanvasPointer(event.pointerId, "lost-capture"));
    elements["circuit-canvas"].addEventListener("wheel", (event) => {
      event.preventDefault();
      if (wheelAdjustValue(event)) return;
      const point = svgPoint(event);
      if (point) zoomCanvas(event.deltaY > 0 ? 1.18 : .84, point);
    }, { passive: false });
    elements["undo-button"].addEventListener("click", undo);
    elements["redo-button"].addEventListener("click", redo);
    elements["clone-button"].addEventListener("click", (event) => cloneSelection(event));
    elements["zoom-out-button"].addEventListener("click", () => zoomCanvas(1.2));
    elements["zoom-in-button"].addEventListener("click", () => zoomCanvas(.82));
    elements["fit-button"].addEventListener("click", fitCanvas);
    elements["rotate-button"].addEventListener("click", () => rotateSelection(1));
    elements["delete-button"].addEventListener("click", deleteSelection);
    elements["wave-plot"].addEventListener("wheel", (event) => {
      if (!state.result) return;
      event.preventDefault();
      scopeView.wheel(event);
    }, { passive: false });
    elements["wave-plot"].addEventListener("pointerdown", (event) => {
      if (!state.result || state.result.analysis === "dc" || event.button !== 0 || state.pointerOwnerId !== null) return;
      const point = scopeView.point(event);
      // Pointer coordinates are integer CSS pixels while the SVG plot edge may be
      // fractional. Accept at most one SVG unit so the first/last sample remains
      // reachable, then ScopeView clamps the cursor target to the data interval.
      if (!scopeView.inside(point, 1)) return;
      event.preventDefault();
      const clientPoint = { x: event.clientX, y: event.clientY };
      const session = beginPointerSession(plotDrag, event.pointerId, { point, lastPoint: point, clientPoint, lastClientPoint: clientPoint, maxDistance: 0, panned: false, view: scopeView.inspect() });
      if (!session || session === plotDrag) return;
      plotDrag = session;
      state.pointerOwnerId = event.pointerId;
      elements["wave-plot"].focus({ preventScroll: true });
      capturePointer(elements["wave-plot"], event.pointerId);
    });
    window.addEventListener("pointermove", (event) => {
      if (!workspace.circuitActive) return;
      if (plotDrag && !ownsPointer(plotDrag, event.pointerId)) return;
      // Skip the layout-forcing getScreenCTM() unless the pointer is over the plot, a drag is active,
      // or a hover cursor still has to be cleared after leaving the plot.
      if (!plotDrag && scopeView.hoverIndex === null && !elements["wave-plot"].contains(event.target)) return;
      const point = scopeView.point(event);
      if (plotDrag && point) {
        plotDrag = advanceCursorPointerSession(plotDrag, { x: event.clientX, y: event.clientY }, point);
        if (!isTapGesture(plotDrag.maxDistance)) {
          plotDrag.panned = true;
          scopeView.panFrom(plotDrag.view, point.x - plotDrag.point.x);
        }
      }
      else if (state.pointerOwnerId === null) scopeView.moveCursor(point);
    });
    window.addEventListener("pointerup", (event) => { if (workspace.circuitActive) finishPlotPointer(event.pointerId, "commit", event); });
    elements["wave-plot"].addEventListener("pointercancel", (event) => finishPlotPointer(event.pointerId, "cancel"));
    elements["wave-plot"].addEventListener("lostpointercapture", (event) => finishPlotPointer(event.pointerId, "lost-capture"));
    elements["wave-plot"].addEventListener("keydown", (event) => {
      if (scopeView.keyCursor(event.key)) event.preventDefault();
    });
    window.addEventListener("blur", () => {
      if (state.drag) finishCanvasPointer(state.drag.pointerId, "blur");
      if (plotDrag) finishPlotPointer(plotDrag.pointerId, "blur");
    });
    window.addEventListener("keydown", (event) => {
      if (!isCircuitUiActive()) return;
      const typing = ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName);
      if (event.key === "Escape") {
        if (!elements["probe-context-menu"].classList.contains("hidden")) closeProbeContextMenu();
        else if (state.inlineEdit) closeInlineEditor();
        else if (!typing) setTool("select");
      }
      const shortcut = shortcutFor(event, { typing });
      if (!shortcut) return;
      if (shortcut.action === "nudge" && (!arrowKeysBelongToCanvas() || event.target.closest?.("#wave-plot"))) return;
      const handled = {
        save: () => { saveProject(); return true; },
        run: () => { runAnalysis(); return true; },
        delete: () => { deleteSelection(); return false; },
        rotate: () => { rotateSelection(shortcut.direction); return false; },
        clone: () => { cloneSelection(); return true; },
        undo: () => { undo(); return true; },
        redo: () => { redo(); return true; },
        tool: () => { setTool(shortcut.tool); return false; },
        nudge: () => nudgeSelection(shortcut),
      }[shortcut.action]();
      if (handled && (shortcut.preventDefault || shortcut.action === "nudge")) event.preventDefault();
    });
    setupCanvasTouch();
  }

  return { setTool, renderPalette, bindCanvasItems, bindOverlayItems, openProbeContextMenu, closeProbeContextMenu, fitCanvas, cancelPointerSessions, cancelInteractions, attach };
}
