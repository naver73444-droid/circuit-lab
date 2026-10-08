import { componentDefaults, pinCount } from "./circuit-engine.js";
import { componentIdPrefix, endpointExists, endpointsEqual, retargetWireProbes, splitWireAtJunction, wireJoins } from "./circuit-edit.js";
import { allocatorFor } from "./id-allocator.js";
import { pointsEqual, snapPoint } from "./circuit-geometry.js";
import { captureWireShapes, newWireShape, rerouteWires, restoreWireShapes, wiresFollowingMove } from "./wire-router.js";
import { commitsActiveDrag, createClipboardShortcutGate, isTypingTarget, shortcutFor } from "./editor-shortcuts.js";
import { clearSelection, isSelected, marqueeHits, normalizeRect, selectedItems, selectedKeys, setSelectionItems, setSingleSelection, toggleSelection } from "./selection-model.js";
import { applyGroupOffset, captureGroupOrigins, groupFootprint, restoreGroupOrigins } from "./group-edit.js";
import { createSelectionCommands } from "./selection-commands.js";
import { createCanvasNotices } from "./canvas-notices.js";
import { stepSeriesText } from "./value-series.js";
import { probeKeysForTarget } from "./ui-model.js";
import { isMagneticPart, magneticWindingAt } from "./current-direction.js";
import { advanceCursorPointerSession, isTapGesture } from "./cursor-label-model.js";
import { escapeHtml } from "./safe-dom.js";
import { traceColor } from "./trace-color.js";
import { beginPointerSession, finishPointerSession, ownsPointer, passedDragSlop, nearestScreenTarget, distanceToSegment, CANVAS_VIEW_MIN_WIDTH, CANVAS_VIEW_MAX_WIDTH } from "./interaction-math.js";
import { installCanvasTouch } from "./canvas-touch.js";

// [type, symbol, label, basic]: non-basic parts (dependent sources, sensors) sit under "더보기".
const PALETTE = [
  ["R", "R", "저항", true], ["C", "C", "커패시터", true], ["L", "L", "인덕터", true], ["GND", "⏚", "접지", true],
  ["V", "V±", "전압원", true], ["I", "I↑", "전류원", true], ["D", "▷|", "다이오드", true], ["OPAMP", "▷", "간략 OP AMP", true], ["OPAMP_IDEAL", "▷∞", "이상 OP AMP", true],
  ["VCVS", "◇V", "전압 제어 전압원", false], ["VCCS", "◇I", "전압 제어 전류원", false],
  ["CURRENT_SENSOR", "S→", "0 V 전류 센서", false], ["CCCS", "◇β", "전류 제어 전류원", false], ["CCVS", "◇R", "전류 제어 전압원", false],
  ["COUPLED_L", "K", "결합 인덕터", false], ["XFMR_IDEAL", "1:n", "이상 변압기", false],
];

/**
 * A freshly placed source stands upright with its "+" end on top, like the textbook drawings: a voltage source turned 90° puts pin 1 (+)
 * up, a current source turned 270° points its arrow (pin 1 → pin 2) up. Lying flat with + on the left made students wire it backwards.
 * Only new parts: saved circuits and examples keep their stored rotation.
 */
export const NEW_PART_ROTATION = Object.freeze({ V: 90, I: 270 });

/** A current probe on a coupled inductor / ideal transformer measures the winding on the pressed side (left half: 1, right half: 2). */
function currentProbeWinding(component, point) {
  return component && point && isMagneticPart(component) ? magneticWindingAt(component, point) : 1;
}

/** Tool, wiring and pointer slice of the shared state. */
export function createInputState() {
  return {
    tool: "select",
    pendingPin: null,
    pendingWaypoints: [],
    pointer: null,
    wireSnap: null, // world point of the pin/junction the half-drawn wire would join right now (ringed on the canvas)
    drag: null,
    ignoreClickUntil: 0,
    pointerOwnerId: null,
    canvasView: { x: 0, y: 0, width: 760, height: 500 },
  };
}

/** Tools, placement, wiring, probe placement and every canvas/plot pointer, wheel, touch and keyboard gesture. */
export function createEditorInput(deps) {
  const { state, elements, workspace, scopeView, mutate, mutateGrouped, closeEditGroup, snapshot, commitMove, undo, redo, runAnalysis, saveProject, hover, addVoltageProbe, addVoltageProbeEndpoint, addCurrentProbe, removeProbe,
    renderCanvas, renderOverlay, scheduleOverlayRender, updateCanvasView, endpointPosition, pinPosition, routeForWireId,
    renderAll, renderSelection, applySelection, setMarquee, scheduleDragUpdate, cancelDragUpdate, renderInspector, openInlineEditor, closeInlineEditor, assignPortEndpoint, presentProbe, reconcileAnalysis, setStatus, showInspector, showCanvas, isCircuitUiActive } = deps;
  const openValueSheet = deps.openValueSheet ?? (() => false);
  // The user explicitly chose the current selection (phone selection bar, canvas-actions.js).
  const armSelectionBar = () => deps.armSelectionBar?.();
  let canvasTouch = null;
  const notices = createCanvasNotices(elements["canvas-notices"]);

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
    else if (isTapGesture(drag.maxDistance)) {
      const point = drag.lastPoint ?? drag.point;
      // Shift+click, or a tap while "B 커서" is armed, places the reference cursor B; a plain tap pins cursor A.
      if (drag.shift || scopeView.bArmed) scopeView.placeB(point);
      else scopeView.pinCursorAt(point);
    }
    return true;
  };
  const cancelPlotSession = () => { if (plotDrag) finishPlotPointer(plotDrag.pointerId, "cancel"); };

  // ---- pointer helpers

  function capturePointer(element, pointerId) {
    try { element.setPointerCapture?.(pointerId); } catch { /* synthetic/ended pointers may not be capturable */ }
  }

  /**
   * Chromium occasionally drops a mouse/pen capture right after granting it (a "gotpointercapture" followed ~1 frame later by
   * "lostpointercapture") while the button is still held. Cancelling the drag for that would undo a gesture the user is still making,
   * so ask for the capture again (a bounded number of times); a real loss still ends the gesture.
   */
  function recaptureWhilePressed(element, event, session) {
    if (!session || !ownsPointer(session, event.pointerId) || event.pointerType === "touch" || !(event.buttons & 1)) return false;
    session.recaptures = (session.recaptures ?? 0) + 1;
    if (session.recaptures > 5) return false;
    try { element.setPointerCapture(event.pointerId); return true; } catch { return false; }
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
    state.wireSnap = null;
    state.pendingPin = null;
    state.pendingWaypoints = [];
    state.pointer = null;
    document.querySelectorAll("[data-tool]").forEach((button) => button.classList.toggle("active", button.dataset.tool === tool));
    document.querySelectorAll(".palette-item").forEach((button) => button.classList.toggle("active", tool === `place:${button.dataset.type}`));
    restoreToolHint();
    renderCanvas();
  }

  const TOOL_HINTS = {
    select: "클릭 선택 · Shift+클릭 다중 선택 · 끌어서 이동 · 빈 곳 끌기 화면 이동 · Shift+빈 곳 끌기 상자 선택",
    pan: "화면 이동 — 부품은 움직이지 않습니다.",
    wire: "배선 — 핀에서 다른 핀·배선까지 끌거나, 핀을 누르고 빈 격자점으로 꺾은 뒤 다른 핀·배선에서 끝냅니다.",
    "voltage-probe": "V 프로브 — 핀이나 배선을 누르면 접지 기준 전압이 추가됩니다.",
    "current-probe": "I 프로브 — 부품을 누르면 기준 방향 전류가 추가됩니다.",
  };
  // Touch screens get finger wording for the select tool (tap / long press / two fingers instead of click / Shift).
  const TOUCH_SELECT_HINT = "탭: 선택·값 조절 · 핀에서 끌기·핀 두 번 탭: 배선 · 길게 눌러 끌기: 이동 · 빈 곳 끌기: 화면 이동 · 두 손가락: 확대";
  const coarsePointer = () => typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  function restoreToolHint() {
    const hint = state.tool === "select" && coarsePointer() ? TOUCH_SELECT_HINT : TOOL_HINTS[state.tool];
    elements["tool-hint"].textContent = state.tool.startsWith("place:") ? "캔버스를 눌러 배치 · 계속 놓을 수 있습니다 · Esc로 종료" : hint;
  }

  /** Drop a half-drawn wire but stay in the current tool. */
  function cancelPendingWire() {
    state.wireSnap = null;
    state.pendingPin = null;
    state.pendingWaypoints = [];
    state.pointer = null;
    restoreToolHint();
    renderCanvas();
  }

  function renderPalette() {
    const item = ([type, symbol, label]) => `<button class="palette-item" data-type="${type}" type="button"><b>${symbol}</b><span>${label}</span></button>`;
    elements["palette-list"].innerHTML = PALETTE.filter((entry) => entry[3]).map(item).join("");
    document.getElementById("palette-more-list").innerHTML = PALETTE.filter((entry) => !entry[3]).map(item).join("");
    document.getElementById("palette-panel").querySelectorAll("button.palette-item").forEach((button) => button.addEventListener("click", () => { setTool(`place:${button.dataset.type}`); showCanvas(); }));
  }

  // ---- placement and wiring

  /** A new part id that was never used in this project (not even by a part deleted since), so stale references cannot bind to it. */
  function nextId(type) {
    return allocatorFor(state).next(componentIdPrefix(type), state.circuit.components);
  }

  function placeComponent(event) {
    if (!state.tool.startsWith("place:") || !event.target.classList.contains("canvas-bg")) return;
    const type = state.tool.split(":")[1];
    const point = svgPoint(event);
    if (!point) return;
    const id = nextId(type);
    const index = Number(id.match(/\d+/)?.[0] ?? 1);
    mutate(() => {
      state.circuit.components.push({ id, type, ...snapPoint(point), rotation: NEW_PART_ROTATION[type] ?? 0, props: componentDefaults(type, index) });
      setSingleSelection(state, { kind: "component", id });
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
        state.wireSnap = null;
        state.pendingPin = target;
        state.pendingWaypoints = [];
        state.pointer = endpointPosition(target);
        elements["tool-hint"].textContent = "배선 중 — 끝낼 핀이나 배선을 누르세요 · 빈 격자점은 꺾임 · Esc 취소";
        renderCanvas();
        return;
      }
      if (endpointsEqual(state.pendingPin, target)) { cancelPendingWire(); return; }
      if (!endpointExists(state.circuit, state.pendingPin) || !endpointExists(state.circuit, target)) { cancelPendingWire(); return; }
      const duplicate = state.circuit.wires.some((wire) => wireJoins(wire, state.pendingPin, target));
      const start = structuredClone(state.pendingPin);
      const anchors = structuredClone(state.pendingWaypoints);
      state.pendingPin = null;
      state.pendingWaypoints = [];
      state.pointer = null;
      restoreToolHint();
      if (!duplicate) mutate(() => state.circuit.wires.push({ id: allocatorFor(state).next("W", state.circuit.wires), a: start, b: target, ...newWireShape(state.circuit, start, target, anchors) }));
      else renderCanvas();
      return;
    }
  }

  /** A clicked empty grid point while wiring: the wire will pass through it (the automatic route fills in the corners). */
  function addPendingWaypoint(point) {
    if (!state.pendingPin) return;
    const start = endpointPosition(state.pendingPin);
    if (!start) return;
    const target = snapPoint(point);
    if (!pointsEqual(target, state.pendingWaypoints.at(-1) ?? start)) state.pendingWaypoints = [...state.pendingWaypoints, target];
    state.pointer = target;
    elements["tool-hint"].textContent = `경유점 ${state.pendingWaypoints.length}개 · 빈 격자점을 더 누르거나 핀/배선/접속점에서 완료 · Esc 취소`;
    renderOverlay();
  }

  function handlePinClick(componentId, pin, wireId = null) {
    const target = { componentId, pin };
    if (state.tool === "wire" || state.tool === "select") return handleEndpointClick(target);
    if (state.tool === "voltage-probe") addVoltageProbe(componentId, pin, wireId);
  }

  // ---- delegated item events: bound once on the layer roots, so re-rendering the layers never re-binds listeners

  const closestIn = (event, selector) => event.target?.closest?.(selector) ?? null;
  const PIN_SELECTOR = ".pin, .pin-hit";

  function bindCanvasItems() {
    const components = elements["component-layer"];
    const activateBadge = (event, button) => {
      event.preventDefault();
      event.stopPropagation();
      const id = button.dataset.deleteComponent ?? button.dataset.showConnection;
      setSingleSelection(state, { kind: "component", id });
      if (button.dataset.deleteComponent) deleteSelection();
      else { showInspector(); renderAll(); }
    };
    components.addEventListener("pointerdown", (event) => {
      if (closestIn(event, "[data-show-connection], [data-delete-component]")) { event.stopPropagation(); return; }
      const group = closestIn(event, ".component");
      if (!group || state.tool !== "select" || closestIn(event, `${PIN_SELECTOR}, .value-label`) || event.button !== 0) return;
      event.preventDefault();
      releaseStaleFocus();
      const component = state.circuit.components.find((item) => item.id === group.dataset.id);
      if (!component) return;
      beginItemDrag(event, { kind: "component", id: component.id }, component);
    });
    // Drag from a pin: pointerdown on a pin of a part starts a wire once the pointer has moved past the drag slop (mouse and pen; touch
    // does it only with the wire tool, see setupCanvasTouch). A plain click on the pin still starts the click-click wire.
    components.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || event.pointerType === "touch" || !["select", "wire"].includes(state.tool) || state.pendingPin || state.port.mode) return;
      const group = closestIn(event, ".component");
      const pin = closestIn(event, PIN_SELECTOR);
      if (!group || !pin) return;
      suppressPinClickUntil = 0; // a fresh press: only the click of a drag-wire release is ever swallowed
      beginCanvasPointer(event, { kind: "wire", target: { componentId: group.dataset.id, pin: Number(pin.dataset.pin) }, started: false, moved: false }, { capture: false });
    });
    components.addEventListener("click", (event) => {
      const button = closestIn(event, "[data-show-connection], [data-delete-component]");
      if (button) { activateBadge(event, button); return; }
      const group = closestIn(event, ".component");
      if (!group) return;
      const pin = closestIn(event, PIN_SELECTOR);
      if (pin) {
        event.stopPropagation();
        if (performance.now() < suppressPinClickUntil) return;
        handlePinClick(group.dataset.id, Number(pin.dataset.pin));
        return;
      }
      if (performance.now() < state.ignoreClickUntil) return;
      const id = group.dataset.id;
      if (state.tool === "current-probe") addCurrentProbe(id, currentProbeWinding(state.circuit.components.find((item) => item.id === id), svgPoint(event)));
      else if (state.tool === "select") {
        if (event.shiftKey) return; // Shift+press already toggled this part on pointerdown
        setSingleSelection(state, { kind: "component", id });
        // Selection only toggles classes, so the clicked text node survives and a native second click can still raise dblclick.
        renderSelection();
      }
    });
    components.addEventListener("keydown", (event) => {
      const button = closestIn(event, "[data-show-connection], [data-delete-component]");
      if (button && ["Enter", " "].includes(event.key)) activateBadge(event, button);
    });
    components.addEventListener("dblclick", (event) => {
      const label = closestIn(event, ".value-label");
      const group = closestIn(event, ".component");
      if (!label || !group) return;
      event.stopPropagation();
      openInlineEditor(group.dataset.id, label.dataset.editProp, event);
    });
    components.addEventListener("contextmenu", (event) => {
      const group = closestIn(event, ".component");
      if (!group) return;
      const pin = closestIn(event, PIN_SELECTOR);
      const keys = probeKeysForTarget(state.probes, pin ? { kind: "pin", componentId: group.dataset.id, pin: Number(pin.dataset.pin) } : { kind: "component", componentId: group.dataset.id });
      if (keys.length) openProbeContextMenu(keys, event);
    });

    const wires = elements["wire-layer"];
    wires.addEventListener("click", (event) => {
      const group = closestIn(event, "[data-wire-id]");
      if (!group) return;
      event.stopPropagation();
      const wire = state.circuit.wires.find((item) => item.id === group.dataset.wireId);
      if (!wire) return;
      if ((state.tool === "wire" || state.tool === "select") && state.pendingPin) createJunctionAndConnect(wire.id, svgPoint(event));
      else if (state.tool === "voltage-probe") addVoltageProbeEndpoint(wire.a.componentId !== undefined ? wire.a : wire.b, wire.id);
      else if (state.tool === "select") {
        if (event.shiftKey) toggleSelection(state, { kind: "wire", id: wire.id });
        else setSingleSelection(state, { kind: "wire", id: wire.id });
        renderSelection();
        armSelectionBar();
      }
    });
    wires.addEventListener("dblclick", (event) => {
      const group = closestIn(event, "[data-wire-id]");
      if (!group || state.tool !== "select" || state.pendingPin) return;
      event.stopPropagation();
      createJunctionOnWire(group.dataset.wireId, svgPoint(event));
    });
    wires.addEventListener("contextmenu", (event) => {
      const group = closestIn(event, "[data-wire-id]");
      if (!group) return;
      const keys = probeKeysForTarget(state.probes, { kind: "wire", wireId: group.dataset.wireId });
      if (keys.length) openProbeContextMenu(keys, event);
    });

    const overlay = elements["overlay-layer"];
    overlay.addEventListener("click", (event) => {
      const group = closestIn(event, "[data-junction-id]");
      if (!group) return;
      event.stopPropagation();
      if (performance.now() < state.ignoreClickUntil || (event.shiftKey && state.tool === "select" && !state.pendingPin)) return;
      const junctionId = group.dataset.junctionId;
      if (state.tool === "voltage-probe") addVoltageProbeEndpoint({ junctionId });
      else handleEndpointClick({ junctionId });
    });
    overlay.addEventListener("pointerdown", (event) => {
      const group = closestIn(event, "[data-junction-id]");
      if (!group || state.tool !== "select" || state.port.mode || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      releaseStaleFocus();
      const junction = (state.circuit.junctions ?? []).find((item) => item.id === group.dataset.junctionId);
      if (!junction) return;
      beginItemDrag(event, { kind: "junction", id: junction.id }, junction);
    });
    overlay.addEventListener("contextmenu", (event) => {
      const group = closestIn(event, "[data-junction-id]");
      if (!group) return;
      const keys = probeKeysForTarget(state.probes, { kind: "junction", junctionId: group.dataset.junctionId });
      if (keys.length) openProbeContextMenu(keys, event);
    });
  }

  // ---- junction commands

  function createJunctionOnWire(wireId, point) {
    mutate(() => {
      const split = splitWireAtJunction(state.circuit, wireId, point, routeForWireId(wireId), allocatorFor(state));
      state.circuit = split.circuit;
      state.probes = retargetWireProbes(state.probes, wireId, split.replacementWireId, split);
      setSingleSelection(state, split.endpoint.junctionId ? { kind: "junction", id: split.endpoint.junctionId } : { kind: "component", id: split.endpoint.componentId });
    });
  }

  function createJunctionAndConnect(wireId, point) {
    const start = structuredClone(state.pendingPin);
    const anchors = structuredClone(state.pendingWaypoints);
    const routePoints = routeForWireId(wireId);
    if (!endpointExists(state.circuit, start)) { cancelPendingWire(); return; }
    state.pendingPin = null;
    state.pendingWaypoints = [];
    state.pointer = null;
    restoreToolHint();
    mutate(() => {
      const split = splitWireAtJunction(state.circuit, wireId, point, routePoints, allocatorFor(state));
      state.circuit = split.circuit;
      state.probes = retargetWireProbes(state.probes, wireId, split.replacementWireId, split);
      const duplicate = state.circuit.wires.some((wire) => wireJoins(wire, start, split.endpoint));
      if (!endpointsEqual(start, split.endpoint) && !duplicate) {
        const id = allocatorFor(state).next("W", state.circuit.wires);
        state.circuit.wires.push({ id, a: start, b: split.endpoint, ...newWireShape(state.circuit, start, split.endpoint, anchors) });
      }
      setSingleSelection(state, split.endpoint.junctionId ? { kind: "junction", id: split.endpoint.junctionId } : { kind: "component", id: split.endpoint.componentId });
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

  /**
   * Keyboard and toolbar edits must see the finished drag: commit it (its history entry comes first) before they record their own.
   * Otherwise R / Ctrl+D / Delete / undo during a drag would push their snapshots between the drag's start and its commit.
   */
  function commitActiveDrag() {
    if (state.drag) finishCanvasPointer(state.drag.pointerId, "commit");
  }
  const undoEdit = () => { commitActiveDrag(); undo(); };
  const redoEdit = () => { commitActiveDrag(); redo(); };

  const { deleteSelection, cloneSelection, rotateSelection, convertYDelta, nudgeSelection, selectAll, copySelection, pasteSelection, tidyWires } = createSelectionCommands({
    state, elements, mutate, mutateGrouped, closeEditGroup, commitActiveDrag, setStatus, renderSelection, isCircuitUiActive, reconcileAnalysis,
    notify: (text, kind = "info") => notices.show({ text, kind, autoHideMs: kind === "error" ? 9000 : 8000 }),
  });

  /**
   * Arrow keys move the selection only while focus is on the page itself, the canvas or an editor tool button (tools, edit actions,
   * zoom, palette). Scope controls, the B-cursor button, menus, notices, the inspector and tabs keep their own arrow-key behaviour.
   */
  const ARROW_KEYS = { ArrowLeft: 1, ArrowRight: 1, ArrowUp: 1, ArrowDown: 1 };
  const ARROW_OWNERS = "#probe-context-menu, #canvas-notices, #scope-controls, #cursor-b-button, #inspector-content, #side-panel, #wave-panel, .file-menu, [role=tablist], [role=tab], [role=menu], [role=menuitem]";
  function arrowKeysBelongToCanvas() {
    const active = document.activeElement;
    if (!active || active === document.body || active === document.documentElement) return true;
    if (active.closest?.(ARROW_OWNERS)) return false;
    if (active.id === "canvas-wrap" || active.closest?.("#circuit-canvas")) return true;
    // A checkbox ignores arrow keys itself, so a focused one (e.g. the auto-update toggle) must not swallow the nudge.
    if (active.tagName === "INPUT" && String(active.type).toLowerCase() === "checkbox") return true;
    return active.tagName === "BUTTON" && Boolean(active.closest(".canvas-bar .tool-group, #palette-panel"));
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

  /**
   * Zoom factor of one wheel event, proportional to how far the wheel/trackpad moved: a mouse notch (deltaY ±100) is about ×1.17 / ×0.85 as
   * before, while a trackpad's stream of small deltas now zooms smoothly instead of one full step per event. Ctrl+wheel (trackpad pinch)
   * is more responsive; every event stays within ×0.74 … ×1.35.
   */
  function wheelZoomFactor(event) {
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1);
    const exponent = Math.max(-0.3, Math.min(0.3, delta * (event.ctrlKey ? 0.01 : 0.0016)));
    return Math.exp(exponent);
  }

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
      const minY = Math.min(...points.map((point) => point.y)) - 64;
      const maxY = Math.max(...points.map((point) => point.y)) + 64;
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

  function beginCanvasPointer(event, payload, { capture = true } = {}) {
    if (state.pointerOwnerId !== null) return false;
    const session = beginPointerSession(state.drag, event.pointerId, { ...payload, startClient: payload.startClient ?? { x: event.clientX, y: event.clientY }, pointerType: event.pointerType });
    if (!session || session === state.drag) return false;
    state.drag = session;
    state.pointerOwnerId = event.pointerId;
    if (capture) capturePointer(elements["circuit-canvas"], event.pointerId);
    return true;
  }

  /**
   * Focus left on a checkbox, button or slider must not swallow the editor shortcuts: a canvas press that keeps the focus
   * (preventDefault) drops it, unless the focused element takes typed text (an inspector value being edited keeps its draft).
   */
  function releaseStaleFocus() {
    // A press on the canvas ends any page text selection (a stale one would make Ctrl+C / Ctrl+A belong to the browser instead of the circuit).
    try { const selection = window.getSelection?.(); if (selection && !selection.isCollapsed && !isTypingTarget(document.activeElement, "a")) selection.removeAllRanges(); } catch { /* no selection API */ }
    const active = document.activeElement;
    if (!active || active === document.body || active === document.documentElement || isTypingTarget(active, "a")) return;
    active.blur?.();
  }

  /**
   * Press on a part or junction in the select tool. Shift toggles it in the selection (no drag). Otherwise a drag starts; when the
   * item belongs to a multi-selection the WHOLE selection moves (one history entry), and a press without movement narrows the
   * selection to that item on release.
   */
  function beginItemDrag(event, item, entity) {
    if (event.shiftKey) {
      toggleSelection(state, item);
      // The click that follows this press must not collapse the selection to one item, even if Shift is released before it fires.
      state.ignoreClickUntil = performance.now() + 400;
      renderSelection();
      return;
    }
    const point = svgPoint(event);
    if (!point) return;
    const multi = isSelected(state, item.kind, item.id) && selectedKeys(state).size > 1;
    const group = multi ? captureGroupOrigins(state.circuit, selectedItems(state)) : null;
    if (!beginCanvasPointer(event, { kind: item.kind, id: item.id, start: point, origin: { x: entity.x, y: entity.y }, before: snapshot(), moved: false, group, wasMulti: multi })) return;
    if (multi) state.selected = { kind: item.kind, id: item.id };
    else setSingleSelection(state, item);
    renderSelection();
  }

  let suppressPinClickUntil = 0;

  /** The drag has passed the slop: the pressed pin becomes the pending wire start and the preview follows the pointer. */
  function startWireFromDrag(drag) {
    drag.started = true;
    state.pendingPin = structuredClone(drag.target);
    state.pendingWaypoints = [];
    state.pointer = endpointPosition(drag.target);
    elements["tool-hint"].textContent = "배선 중 — 끝낼 핀이나 배선에 놓으세요 · 빈 곳에 놓으면 계속 배선 · Esc 취소";
    // No pointer capture: renderCanvas() below replaces the pressed pin, and window-level pointermove/pointerup keep delivering to the gesture.
    renderCanvas();
  }

  /**
   * Pointer released after a wire drag. A pin, junction or wire under the pointer ends the wire there. Anywhere else — empty canvas or
   * the pin it started from — the wire stays pending, so the click-click flow (bend points, then a pin) simply continues.
   */
  function completeWireDrag(drag) {
    const client = drag.lastClient;
    if (!state.pendingPin) return;
    // Released outside the canvas area (toolbar, inspector, another window's edge): the gesture is abandoned, not completed on whatever pin is geometrically near.
    if (!client || !document.elementFromPoint(client.x, client.y)?.closest?.("#canvas-wrap")) { cancelPendingWire(); return; }
    const target = pickTouchTarget(client, { touch: drag.pointerType === "touch" });
    if (!target) return;
    if (target.kind === "wire") {
      const point = svgPoint({ clientX: client.x, clientY: client.y });
      if (point) createJunctionAndConnect(target.id, point);
      return;
    }
    const endpoint = target.kind === "pin" ? { componentId: target.id, pin: target.pin } : target.kind === "junction" ? { junctionId: target.id } : null;
    if (!endpoint || endpointsEqual(endpoint, state.pendingPin)) return;
    handleEndpointClick(endpoint);
  }

  function finishCanvasPointer(pointerId, reason = "commit") {
    const completed = finishPointerSession(state.drag, pointerId, reason);
    if (!completed.finished) return false;
    const drag = completed.finished;
    state.drag = null;
    cancelDragUpdate?.(); // a queued drag frame must not fire after the gesture (it would hide the flow overlay again)
    state.pointerOwnerId = null;
    elements["circuit-canvas"].classList.remove("dragging");
    releasePointer(elements["circuit-canvas"], pointerId);
    if (drag.kind === "wire") {
      if (!drag.started) return true; // a plain click on a pin: the click event starts the click-click wire
      suppressPinClickUntil = performance.now() + 250;
      state.ignoreClickUntil = performance.now() + 180;
      if (reason === "commit") completeWireDrag(drag);
      else cancelPendingWire();
      return true;
    }
    if (drag.kind === "marquee") {
      setMarquee(null);
      state.ignoreClickUntil = performance.now() + 180;
      if (reason !== "commit") setSelectionItems(state, drag.base, drag.basePrimary);
      renderSelection();
      return true;
    }
    if (reason !== "commit") {
      if (drag.kind === "pan") state.canvasView = { ...drag.originView };
      else if (drag.group) restoreGroupOrigins(state.circuit, drag.group);
      else {
        const item = drag.kind === "junction"
          ? (state.circuit.junctions ?? []).find((junction) => junction.id === drag.id)
          : state.circuit.components.find((component) => component.id === drag.id);
        if (item) { item.x = drag.origin.x; item.y = drag.origin.y; }
      }
      if (drag.wireShapes) restoreWireShapes(state.circuit, drag.wireShapes);
      renderAll();
      return true;
    }
    if (!drag.moved && drag.kind === "pan" && drag.deselectOnTap) {
      // The pointer is captured by the svg, so the browser's click no longer targets the background: a tap that started on empty canvas
      // (no drag past the slop) is decided here instead, and clears the selection.
      state.ignoreClickUntil = performance.now() + 180;
      if (state.selected) { clearSelection(state); renderSelection(); }
    }
    if (!drag.moved && drag.kind !== "pan") {
      // Pointer capture retargets the subsequent click to the SVG root. Commit the
      // selection visuals here so a normal tap exposes its real delete button.
      state.ignoreClickUntil = performance.now() + 180;
      // A press without movement on a member of a multi-selection narrows the selection to it.
      if (drag.wasMulti) setSingleSelection(state, { kind: drag.kind, id: drag.id });
      renderSelection();
      // A mouse/pen click on a part asks for its value controls (on a phone-width window the sheet opens only on such an explicit choice).
      if (drag.kind === "component" && drag.pointerType !== "touch" && !drag.wasMulti) openValueSheet(drag.id);
      armSelectionBar();
    }
    if (drag.moved) {
      state.ignoreClickUntil = performance.now() + 180;
      if (drag.kind === "pan") {
        if (drag.mode === "scroll") startMomentum(drag);
        else if (!drag.mode && drag.lastClient) {
          // A short vertical swipe that ended before it was judged: it was a pan after all.
          state.canvasView.x = drag.originView.x - (drag.lastClient.x - drag.startClient.x) / drag.screenScale;
          state.canvasView.y = drag.originView.y - (drag.lastClient.y - drag.startClient.y) / drag.screenScale;
          updateCanvasView();
        }
        return true;
      }
      // Dropped back exactly where it started: no history entry, no stale result.
      if (snapshot() === drag.before) renderAll();
      else commitMove(drag.before);
      armSelectionBar(); // after carrying a part, its actions are right there
    }
    return true;
  }

  function updateCanvasPointer(event) {
    if (!ownsPointer(state.drag, event.pointerId)) return;
    const drag = state.drag;
    if (!drag.moved && !passedDragSlop(drag.startClient, { x: event.clientX, y: event.clientY }, drag.pointerType)) return;
    drag.moved = true;
    if (drag.kind === "wire") {
      drag.lastClient = { x: event.clientX, y: event.clientY };
      if (!drag.started) startWireFromDrag(drag);
      const wirePoint = svgPoint(event);
      if (wirePoint) { aimWire(wirePoint, wireSnapFromPick(drag.lastClient, drag.pointerType === "touch")); scheduleOverlayRender(); }
      return;
    }
    if (drag.kind === "marquee") {
      const boxPoint = svgPoint(event);
      if (!boxPoint) return;
      const rect = normalizeRect(drag.start, boxPoint);
      const hits = marqueeHits(state.circuit, rect);
      setSelectionItems(state, [...drag.base, ...hits], drag.basePrimary ?? hits[0] ?? null);
      setMarquee(rect);
      applySelection();
      return;
    }
    if (drag.kind === "pan") { panOrScroll(drag, event); return; }
    elements["circuit-canvas"].classList.add("dragging");
    const point = svgPoint(event);
    if (!point) return;
    const item = drag.kind === "junction" ? (state.circuit.junctions ?? []).find(j => j.id === drag.id) : state.circuit.components.find(c => c.id === drag.id);
    if (!item) return;
    // A finger hides what it carries: a touch drag draws (and drops) the part a little above the fingertip.
    const lift = drag.lift ?? { x: 0, y: 0 };
    const target = snapPoint({ x: drag.origin.x + point.x - drag.start.x + lift.x, y: drag.origin.y + point.y - drag.start.y + lift.y });
    if (drag.group) {
      // The whole selection moves by the primary item's snapped offset (so the group stays rigid) and every item lands on the grid itself.
      applyGroupOffset(state.circuit, drag.group, target.x - drag.origin.x, target.y - drag.origin.y, { snap: true });
      followMove(drag, target);
      scheduleDragUpdate("group", groupFootprint(drag.group));
      return;
    }
    Object.assign(item, target);
    followMove(drag, target);
    scheduleDragUpdate(drag.kind, drag.id);
  }

  /**
   * Wires with one end on what is being carried follow it on an automatic route (through the points the user clicked, see wire-router).
   * Routed only when the snapped position changes; back at the start the wires are exactly as before (so the drop is no edit).
   */
  function followMove(drag, target) {
    if (drag.lastTarget && pointsEqual(drag.lastTarget, target)) return;
    drag.lastTarget = target;
    if (!drag.followers) {
      const items = drag.group
        ? [...drag.group.components.map((origin) => ({ kind: "component", id: origin.id })), ...drag.group.junctions.map((origin) => ({ kind: "junction", id: origin.id }))]
        : [{ kind: drag.kind, id: drag.id }];
      drag.followers = wiresFollowingMove(state.circuit, items);
      drag.wireShapes = captureWireShapes(state.circuit, drag.followers);
    }
    if (!drag.followers.length) return;
    if (pointsEqual(target, drag.origin)) restoreWireShapes(state.circuit, drag.wireShapes);
    else rerouteWires(state.circuit, drag.followers);
  }

  // ---- wire aim (snap feedback) and touch lift

  /** How far above the fingertip a touch-dragged part is carried, in screen px (the finger covers roughly a 40 px disc). */
  const TOUCH_LIFT_PX = 36;
  function touchLift() {
    const scale = elements["circuit-canvas"].getScreenCTM()?.a;
    return scale > 0 ? { x: 0, y: -TOUCH_LIFT_PX / scale } : { x: 0, y: 0 };
  }

  /** The pin / junction a wire end would join (not the start of the wire itself), as a world point; null elsewhere. */
  function snapEndpoint(endpoint) {
    if (!endpoint || !state.pendingPin || endpointsEqual(endpoint, state.pendingPin) || !endpointExists(state.circuit, endpoint)) return null;
    const at = endpointPosition(endpoint);
    return at ? { ...at, endpoint } : null;
  }
  /** Drag-wire: the same pick the release will use (screen radius, larger for touch). */
  function wireSnapFromPick(client, touch) {
    if (!client) return null;
    const target = pickTouchTarget(client, { touch });
    return target?.kind === "pin" ? snapEndpoint({ componentId: target.id, pin: target.pin }) : target?.kind === "junction" ? snapEndpoint({ junctionId: target.id }) : null;
  }
  /** Click-click wire with a mouse: exactly what a click here would hit (the pin or junction under the pointer). */
  function wireSnapUnderPointer(event) {
    const pin = event.target?.closest?.(PIN_SELECTOR);
    const group = pin?.closest?.(".component");
    if (pin && group) return snapEndpoint({ componentId: group.dataset.id, pin: Number(pin.dataset.pin) });
    const junction = event.target?.closest?.("[data-junction-id]");
    return junction ? snapEndpoint({ junctionId: junction.dataset.junctionId }) : null;
  }
  /** Move the live end of the wire preview: onto the snapped pin/junction (ringed), else onto the nearest grid point. */
  function aimWire(point, snap) {
    state.wireSnap = snap ? { x: snap.x, y: snap.y } : null;
    state.pointer = snap ? { x: snap.x, y: snap.y } : snapPoint(point);
  }

  // ---- touch hit testing and routing

  // Pin / junction capture radius in screen px: a fingertip is far less precise than a mouse pointer.
  const PIN_PICK_PX = { mouse: 22, touch: 32 };
  const JUNCTION_PICK_PX = { mouse: 20, touch: 28 };
  // Select tool, touch: a pin wins over its part within 40 % of the pin-to-centre distance on screen (at least 10 px, at most 18 px).
  const PIN_SELECT_TOUCH_PX = { min: 10, max: 18 };

  function pickTouchTarget(point, { touch = true } = {}) {
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
    if (!endpointMode && state.tool === "select" && label) return {kind:"value",id:label.closest("[data-id]")?.dataset.id};
    if (!endpointMode && state.tool === "select" && badge) return { kind: "properties", id: badge.dataset.showConnection };
    if (!endpointMode && state.tool === "select" && touch) {
      // A finger on a pin dot (the select tool's pin disc, see canvas-renderer syncHitSizes) means wiring: a drag from it draws a wire,
      // a tap starts the tap-tap wire. The disc stays well inside the part, so its middle still selects the part.
      const radius = Math.max(PIN_SELECT_TOUCH_PX.min, Math.min(PIN_SELECT_TOUCH_PX.max, 40 * Math.abs(matrix.a) * 0.4));
      let pinHit = null, pinDistance = radius;
      for (const c of state.circuit.components) for (let pin = 0; pin < pinCount(c.type); pin++) {
        const world = pinPosition(c, pin); if (!world) continue;
        const p = screen(world), d = Math.hypot(point.x - p.x, point.y - p.y);
        if (d < pinDistance) { pinDistance = d; pinHit = { kind: "pin", id: c.id, pin }; }
      }
      if (pinHit) return pinHit;
    }
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
    if (endpointMode) for (const c of state.circuit.components) for (let pin=0; pin<pinCount(c.type); pin++) add(pinPosition(c,pin), {kind:"pin",id:c.id,pin},touch ? PIN_PICK_PX.touch : PIN_PICK_PX.mouse);
    if (state.tool !== "current-probe") for (const j of state.circuit.junctions ?? []) add(j,{kind:"junction",id:j.id},touch ? JUNCTION_PICK_PX.touch : JUNCTION_PICK_PX.mouse);
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
      pick: (point) => pickTouchTarget(point, { touch: true }),
      world: p => svgPoint({clientX:p.x,clientY:p.y}),
      view: () => ({...state.canvasView}),
      setView: view => { state.canvasView = view; updateCanvasView(); },
      begin: (event, target) => {
        // A finger landing while the page still scrolls (a fling that began outside the canvas) or right after it keeps scrolling the
        // page: the circuit must not be dragged along by a thumb that only wanted to stop or continue the scroll.
        const pageWasMoving = momentum !== null || performance.now() - lastPageScrollAt < PAGE_SCROLL_RECENT_MS;
        stopMomentum();
        const scroller = state.tool === "select" && !state.pendingPin && !state.port.mode ? pageScroller() : null;
        const screenScale = svg.getScreenCTM()?.a;
        if (scroller && pageWasMoving && screenScale > 0) {
          beginCanvasPointer(event, { kind: "pan", mode: "scroll", scroller, screenScale, originView: { ...state.canvasView }, moved: false, samples: [] });
          return;
        }
        // Wire or select tool: one finger dragging from a pin draws a wire (a tap on the pin still starts the tap-tap wire).
        if (["wire", "select"].includes(state.tool) && target?.kind === "pin" && !state.pendingPin && !state.port.mode) {
          beginCanvasPointer(event, { kind: "wire", target: { componentId: target.id, pin: target.pin }, started: false, moved: false }, { capture: false });
          return;
        }
        if (!["select","pan"].includes(state.tool) || state.pendingPin || state.port.mode || !target) return;
        const point = svgPoint(event); if (!point) return;
        if (["component","junction"].includes(target.kind) && isSelected(state, target.kind, target.id) && state.tool === "select") {
          const item = target.kind === "component" ? state.circuit.components.find(c=>c.id===target.id) : (state.circuit.junctions??[]).find(j=>j.id===target.id);
          if (!item) return;
          // A selected part of a multi-selection drags the whole group, like the mouse path.
          const multi = selectedKeys(state).size > 1;
          const group = multi ? captureGroupOrigins(state.circuit, selectedItems(state)) : null;
          const payload = { kind: target.kind, id: item.id, start: point, origin: { x: item.x, y: item.y }, before: snapshot(), moved: false, group, wasMulti: multi, lift: touchLift() };
          if (beginCanvasPointer(event, payload) && multi) state.selected = { kind: target.kind, id: target.id };
        } else if (["background","component","junction","wire"].includes(target.kind)) {
          // First swipe navigates. Only an already selected object can be dragged. In the select tool a quick, long vertical flick on a
          // scrollable page scrolls the page instead (decided in panOrScroll); the pan tool always pans.
          if (screenScale > 0) beginCanvasPointer(event, { kind: "pan", screenScale, originView: { ...state.canvasView }, moved: false, mode: scroller ? null : "pan", scroller, startedAt: performance.now(), samples: [] });
        }
      },
      // Long press on a part (or junction) that is not selected yet: select it and pick it up, so it follows the same finger.
      longPress: (event, target) => {
        if (state.tool !== "select" || state.pendingPin || state.port.mode || !["component","junction"].includes(target?.kind)) return;
        if (isSelected(state, target.kind, target.id)) return; // a selected part is already draggable
        const item = target.kind === "component" ? state.circuit.components.find(c=>c.id===target.id) : (state.circuit.junctions??[]).find(j=>j.id===target.id);
        const point = svgPoint(event);
        if (!item || !point) return;
        if (state.drag) { if (state.drag.kind !== "pan" || state.drag.moved) return; finishCanvasPointer(state.drag.pointerId, "cancel"); }
        setSingleSelection(state, { kind: target.kind, id: target.id });
        beginCanvasPointer(event,{kind:target.kind,id:item.id,start:point,origin:{x:item.x,y:item.y},before:snapshot(),moved:false,group:null,wasMulti:false,lift:touchLift()});
        // Haptic tick; browsers refuse (and log) vibrate() before the first tap on the page, so ask only once the page was activated.
        try { if (navigator.userActivation?.hasBeenActive !== false) navigator.vibrate?.(12); } catch { /* no haptics */ }
        renderSelection();
      },
      move: updateCanvasPointer,
      finish: finishCanvasPointer,
      tap: (event, target) => {
        if (!target || state.tool === "pan") return;
        touchTap(event, target);
        // The readout bubble is placed after the selection bar (both wait for the next frame; the bar's frame was asked for first), so it
        // can keep clear of the bar. No bubble while a wire is being drawn: the finger is busy wiring.
        const { clientX, clientY } = event;
        if (!state.pendingPin) requestAnimationFrame(() => hover.showTouch(target, clientX, clientY));
      },
    });
    function touchTap(event, target) {
      const point = svgPoint(event); if(!point)return;
      if(target.kind === "delete") { if(state.selected?.kind === "component" && state.selected.id === target.id) deleteSelection(); return; }
      if(target.kind === "properties") { setSingleSelection(state,{kind:"component",id:target.id}); renderSelection(); armSelectionBar(); showInspector(); return; }
      // A value label: the phone value sheet when the part has one, the properties panel otherwise.
      if(target.kind === "value") { setSingleSelection(state,{kind:"component",id:target.id}); renderSelection(); armSelectionBar(); if(!openValueSheet(target.id)) showInspector(); return; }
      if(target.kind === "pin") { handlePinClick(target.id,target.pin); return; }
      if(target.kind === "junction") {
        if(state.tool === "voltage-probe") addVoltageProbeEndpoint({junctionId:target.id});
        else if(state.port.mode || state.tool === "wire" || state.pendingPin) handleEndpointClick({junctionId:target.id});
        else { setSingleSelection(state,{kind:"junction",id:target.id});renderSelection();armSelectionBar(); }
        return;
      }
      if(target.kind === "component") {
        if(state.tool === "current-probe")addCurrentProbe(target.id, currentProbeWinding(state.circuit.components.find(c=>c.id===target.id), point));
        else {setSingleSelection(state,{kind:"component",id:target.id});openValueSheet(target.id);renderSelection();armSelectionBar();}
        return;
      }
      if(target.kind === "wire") {
        const wire=state.circuit.wires.find(w=>w.id===target.id); if(!wire)return;
        if(state.pendingPin)createJunctionAndConnect(wire.id,point);
        else if(state.tool === "voltage-probe")addVoltageProbeEndpoint(wire.a.componentId !== undefined ? wire.a : wire.b,wire.id);
        else if(state.tool === "select"){setSingleSelection(state,{kind:"wire",id:wire.id});renderSelection();armSelectionBar();}
        return;
      }
      if(state.pendingPin)addPendingWaypoint(point);
      else if(state.tool.startsWith("place:"))placeComponent({clientX:event.clientX,clientY:event.clientY,target:svg.querySelector(".canvas-bg")});
      else if(state.tool === "select"){clearSelection(state);renderSelection();}
    }
  }

  // ---- phone: page scroll versus canvas pan (one finger, select tool)

  /** A finger that lands within this long after the page scrolled continues the scroll (a fling stopped or carried on by the next swipe). */
  const PAGE_SCROLL_RECENT_MS = 400;
  /** A one-finger vertical swipe is judged once it has travelled this far: quick enough, it scrolls the page; otherwise it pans. */
  const SCROLL_DECIDE_PX = 40;
  const SCROLL_FLICK_PX_PER_MS = 1;
  let lastPageScrollAt = -Infinity;
  let momentum = null;

  /** The element that scrolls the page around the canvas (the phone workbench), or null when nothing around it can scroll. */
  function pageScroller() {
    for (let node = elements["circuit-canvas"].parentElement; node && node !== document.body && node !== document.documentElement; node = node.parentElement) {
      const overflow = getComputedStyle(node).overflowY;
      if ((overflow === "auto" || overflow === "scroll") && node.scrollHeight > node.clientHeight + 1) return node;
    }
    const root = document.scrollingElement;
    return root && root.scrollHeight > root.clientHeight + 1 ? root : null;
  }
  const canScroll = (scroller, fingerDy) => fingerDy > 0 ? scroller.scrollTop > 0.5 : scroller.scrollTop < scroller.scrollHeight - scroller.clientHeight - 0.5;

  function notePageScroll(event) {
    const target = event.target;
    if (target === document || target === document.documentElement || target === document.scrollingElement || (target?.contains?.(elements["circuit-canvas"]) ?? false)) lastPageScrollAt = performance.now();
  }

  function stopMomentum() {
    if (!momentum) return;
    cancelAnimationFrame(momentum.frame);
    momentum = null;
  }

  /** After a scroll swipe the page glides on and slows down, like a native fling. */
  function startMomentum(drag) {
    const samples = drag.samples ?? [];
    const first = samples[0], last = samples.at(-1);
    if (!first || !last || last.t - first.t < 8) return;
    let velocity = (last.y - first.y) / (last.t - first.t); // finger px per ms; the page moves the other way
    if (Math.abs(velocity) < 0.15) return;
    const scroller = drag.scroller;
    let previous = performance.now();
    const step = (now) => {
      const dt = Math.min(48, Math.max(1, now - previous));
      previous = now;
      const before = scroller.scrollTop;
      scroller.scrollTop = before - velocity * dt;
      velocity *= Math.pow(0.95, dt / 16);
      if (Math.abs(velocity) < 0.02 || Math.abs(scroller.scrollTop - before) < 0.01) { momentum = null; return; }
      momentum.frame = requestAnimationFrame(step);
    };
    momentum = { frame: requestAnimationFrame(step) };
  }

  /**
   * One-finger move of a "pan" session: pans the circuit, or scrolls the page (mode "scroll"). Undecided sessions (select tool on a
   * scrollable page) pan at once when the swipe goes sideways, and hold a vertical swipe until it has travelled SCROLL_DECIDE_PX: fast
   * enough (a flick) it scrolls the page if the page can go that way, slower it pans the circuit — the full distance, no lost travel.
   */
  function panOrScroll(drag, event) {
    const dx = event.clientX - drag.startClient.x, dy = event.clientY - drag.startClient.y;
    const now = performance.now();
    drag.lastClient = { x: event.clientX, y: event.clientY };
    if (drag.samples) { drag.samples.push({ t: now, y: event.clientY }); while (drag.samples.length > 2 && now - drag.samples[0].t > 90) drag.samples.shift(); }
    if (!drag.mode) {
      if (!drag.scroller || Math.abs(dx) >= Math.abs(dy)) drag.mode = "pan";
      else {
        const travel = Math.hypot(dx, dy);
        if (travel < SCROLL_DECIDE_PX) return;
        const flick = Math.abs(dy) >= 2 * Math.abs(dx) && travel / Math.max(1, now - drag.startedAt) >= SCROLL_FLICK_PX_PER_MS;
        drag.mode = flick && canScroll(drag.scroller, dy) ? "scroll" : "pan";
        if (drag.mode === "scroll") drag.originScroll = drag.scroller.scrollTop;
      }
    }
    if (drag.mode === "scroll") {
      drag.originScroll ??= drag.scroller.scrollTop;
      drag.scroller.scrollTop = drag.originScroll - dy;
      return;
    }
    elements["circuit-canvas"].classList.add("dragging");
    state.canvasView.x = drag.originView.x - dx / drag.screenScale;
    state.canvasView.y = drag.originView.y - dy / drag.screenScale;
    updateCanvasView();
  }

  // ---- interaction cancel (workspace switch, project reset, panel change)

  /** Abort any pointer gesture on the canvas or the plot. */
  function cancelPointerSessions() {
    if (state.drag) finishCanvasPointer(state.drag.pointerId, "cancel");
    cancelPlotSession();
  }

  function cancelInteractions() {
    stopMomentum();
    canvasTouch?.cancel();
    cancelPointerSessions();
  }

  // ---- clipboard keys: the native copy/cut/paste events are preferred, the key press itself is only the fallback

  const CLIPBOARD_ACTIONS = new Set(["copy", "cut", "paste"]);
  // One token per Ctrl+C/X/V press is shared by the native event and the 0 ms key fallback: whichever pastes/copies first claims it, the other no-ops.
  const clipboardGate = createClipboardShortcutGate();
  function armClipboardFallback(action) {
    clipboardGate.arm(action, (armed, token) => {
      if (!isCircuitUiActive()) return;
      if (armed === "copy") copySelection({ token });
      else if (armed === "cut") copySelection({ cut: true, token });
      else pasteSelection({ token });
    });
  }

  /** Does the page have a selected stretch of text (inspector text, notices, labels)? Then Ctrl+C / Ctrl+A belong to the browser. */
  function hasTextSelection() {
    try { const selection = window.getSelection?.(); return Boolean(selection && !selection.isCollapsed && String(selection).length > 0); } catch { return false; }
  }

  function nativeClipboardEvent(event, kind) {
    if (!isCircuitUiActive() || event.defaultPrevented) return;
    const token = clipboardGate.native(kind); // also cancels the key fallback of this press
    // Text fields, a selected stretch of text, or another workspace's focus: the browser's own copy/paste is what the user means.
    if (isTypingTarget(document.activeElement, "c", { modifier: true }) || (kind !== "paste" && hasTextSelection())) return;
    const clipboardData = event.clipboardData;
    if (!clipboardData) return;
    const handled = kind === "paste" ? pasteSelection({ clipboardData, token }) : copySelection({ cut: kind === "cut", clipboardData, token });
    if (handled) event.preventDefault();
  }

  /** Register every canvas, plot, toolbar and keyboard listener owned by this module. */
  function attach() {
    bindCanvasItems();
    document.addEventListener("click", (event) => {
      if (!event.target.closest("#probe-context-menu")) closeProbeContextMenu();
    });
    document.querySelectorAll("[data-tool]").forEach((button) => button.addEventListener("click", () => setTool(button.dataset.tool)));
    elements["circuit-canvas"].addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || !["select", "pan"].includes(state.tool) || (state.tool !== "pan" && !event.target.classList.contains("canvas-bg")) || state.pendingPin) return;
      releaseStaleFocus();
      if (state.tool === "select" && event.shiftKey && event.pointerType !== "touch") {
        // Shift + drag on empty canvas: box selection (adds to the current selection). A plain drag still pans.
        const start = svgPoint(event);
        if (start) beginCanvasPointer(event, { kind: "marquee", start, base: selectedItems(state), basePrimary: state.selected ? { ...state.selected } : null, moved: false });
        return;
      }
      beginCanvasPointer(event, { kind: "pan", startClient: { x: event.clientX, y: event.clientY }, screenScale: elements["circuit-canvas"].getScreenCTM().a, originView: { ...state.canvasView }, moved: false, deselectOnTap: state.tool === "select" });
    });
    elements["circuit-canvas"].addEventListener("click", (event) => {
      if (performance.now() < state.ignoreClickUntil) return;
      if (event.target.classList.contains("canvas-bg")) {
        if (state.pendingPin) {
          addPendingWaypoint(svgPoint(event));
          return;
        }
        placeComponent(event);
        if (state.tool === "select" && performance.now() >= state.ignoreClickUntil && !event.shiftKey) { clearSelection(state); renderSelection(); }
      }
    });
    window.addEventListener("pointermove", (event) => {
      if (!workspace.circuitActive) return;
      if (state.pendingPin && event.isPrimary !== false && event.target.closest?.("#circuit-canvas")) {
        const point = svgPoint(event);
        if (point) { aimWire(point, wireSnapUnderPointer(event)); scheduleOverlayRender(); }
      }
      updateCanvasPointer(event);
    });
    window.addEventListener("pointerup", (event) => { if (workspace.circuitActive) finishCanvasPointer(event.pointerId, "commit"); });
    // A pin-drag wire has no pointer capture, so a cancelled pointer (system gesture, pen leaving range) arrives wherever it is: end the gesture from the window.
    window.addEventListener("pointercancel", (event) => finishCanvasPointer(event.pointerId, "cancel"));
    elements["circuit-canvas"].addEventListener("pointercancel", (event) => finishCanvasPointer(event.pointerId, "cancel"));
    elements["circuit-canvas"].addEventListener("lostpointercapture", (event) => {
      if (!recaptureWhilePressed(elements["circuit-canvas"], event, state.drag)) finishCanvasPointer(event.pointerId, "lost-capture");
    });
    elements["circuit-canvas"].addEventListener("wheel", (event) => {
      event.preventDefault();
      if (wheelAdjustValue(event)) return;
      const point = svgPoint(event);
      if (point) zoomCanvas(wheelZoomFactor(event), point);
    }, { passive: false });
    elements["undo-button"].addEventListener("click", undoEdit);
    elements["redo-button"].addEventListener("click", redoEdit);
    elements["clone-button"].addEventListener("click", (event) => cloneSelection(event));
    elements["zoom-out-button"].addEventListener("click", () => zoomCanvas(1.2));
    elements["zoom-in-button"].addEventListener("click", () => zoomCanvas(.82));
    elements["fit-button"].addEventListener("click", fitCanvas);
    elements["rotate-button"].addEventListener("click", () => rotateSelection(1));
    elements["tidy-wires-button"]?.addEventListener("click", tidyWires);
    elements["delete-button"].addEventListener("click", deleteSelection);
    elements["inspector-content"].addEventListener("click", (event) => {
      const button = event.target.closest?.("[data-multi-action]");
      if (!button || button.disabled) return;
      if (button.dataset.multiAction === "delete") deleteSelection();
      else if (button.dataset.multiAction === "clone") cloneSelection();
      else if (button.dataset.multiAction === "rotate") rotateSelection(1);
      else if (button.dataset.multiAction === "ydelta") convertYDelta();
    });
    elements["wave-plot"].addEventListener("wheel", (event) => {
      if (!scopeView.result) return;
      event.preventDefault();
      scopeView.wheel(event);
    }, { passive: false });
    elements["wave-plot"].addEventListener("pointerdown", (event) => {
      if (!scopeView.result || scopeView.result.analysis === "dc" || event.button !== 0 || state.pointerOwnerId !== null) return;
      const point = scopeView.point(event);
      // Pointer coordinates are integer CSS pixels while the SVG plot edge may be
      // fractional. Accept at most one SVG unit so the first/last sample remains
      // reachable, then ScopeView clamps the cursor target to the data interval.
      if (!scopeView.inside(point, 1)) return;
      event.preventDefault();
      const clientPoint = { x: event.clientX, y: event.clientY };
      const session = beginPointerSession(plotDrag, event.pointerId, { point, lastPoint: point, clientPoint, lastClientPoint: clientPoint, maxDistance: 0, panned: false, shift: event.shiftKey, view: scopeView.inspect() });
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
    elements["wave-plot"].addEventListener("lostpointercapture", (event) => {
      if (!recaptureWhilePressed(elements["wave-plot"], event, plotDrag)) finishPlotPointer(event.pointerId, "lost-capture");
    });
    elements["wave-plot"].addEventListener("keydown", (event) => {
      if (scopeView.keyCursor(event.key, event.shiftKey)) event.preventDefault();
    });
    window.addEventListener("blur", () => {
      if (state.drag) finishCanvasPointer(state.drag.pointerId, "blur");
      if (plotDrag) finishPlotPointer(plotDrag.pointerId, "blur");
    });
    window.addEventListener("keydown", (event) => {
      if (!isCircuitUiActive()) return;
      // The scope plot handles its own keys (cursor A/B, Esc releases a cursor): once it consumed the key, the editor must not act on it too.
      if (event.defaultPrevented && event.target.closest?.("#wave-plot")) return;
      const typing = isTypingTarget(document.activeElement, event.key, { modifier: event.ctrlKey || event.metaKey || event.altKey });
      if (event.key === "Escape") {
        if (!elements["probe-context-menu"].classList.contains("hidden")) closeProbeContextMenu();
        else if (state.inlineEdit) closeInlineEditor();
        else if (!typing) {
          // One Esc backs out one level: a wire or box being dragged, a half-drawn wire, then the tool, then the selection.
          if (state.drag && ["wire", "marquee"].includes(state.drag.kind)) finishCanvasPointer(state.drag.pointerId, "cancel");
          else if (state.pendingPin) cancelPendingWire();
          else if (state.tool !== "select" || state.port.mode) setTool("select");
          else if (state.selected && state.pointerOwnerId === null) { clearSelection(state); renderSelection(); }
        }
      }
      const shortcut = shortcutFor(event, { typing, textSelection: hasTextSelection() });
      if (!shortcut) return;
      if (shortcut.ignore) { event.preventDefault(); return; } // a held Ctrl+V / Ctrl+D / Ctrl+X must not pile up copies
      if (shortcut.action === "nudge" && (!arrowKeysBelongToCanvas() || event.target.closest?.("#wave-plot"))) return;
      if (commitsActiveDrag(shortcut.action)) commitActiveDrag();
      if (CLIPBOARD_ACTIONS.has(shortcut.action)) {
        // Leave the key to the browser: its native copy/cut/paste event (below) carries the system clipboard without a permission prompt.
        // If no such event follows (some embedders/automation never raise one), run the key path ourselves.
        armClipboardFallback(shortcut.action);
        return;
      }
      const handled = {
        save: () => { saveProject(); return true; },
        run: () => { runAnalysis(); return true; },
        delete: () => { deleteSelection(); return false; },
        rotate: () => { rotateSelection(shortcut.direction); return false; },
        yDelta: () => { convertYDelta(); return false; },
        clone: () => { cloneSelection(); return true; },
        selectAll: () => selectAll(),
        undo: () => { undoEdit(); return true; },
        redo: () => { redoEdit(); return true; },
        tool: () => { setTool(shortcut.tool); return false; },
        nudge: () => nudgeSelection(shortcut),
        help: () => { const help = document.getElementById("interaction-help"); if (help) help.open = !help.open; return true; },
      }[shortcut.action]();
      if (handled && (shortcut.preventDefault || shortcut.action === "nudge")) event.preventDefault();
    });
    // Releasing an arrow ends the nudge group, so a held key is ONE undo step however long the OS key-repeat delay is.
    window.addEventListener("keyup", (event) => { if (event.key in ARROW_KEYS) closeEditGroup("nudge"); });
    setupCanvasTouch();
    // Scroll events do not bubble; a capturing listener on the document still sees the workbench's (and the document's) scrolls.
    document.addEventListener("scroll", notePageScroll, { capture: true, passive: true });
    for (const kind of ["copy", "cut", "paste"]) document.addEventListener(kind, (event) => nativeClipboardEvent(event, kind));
  }

  /** Actions of the phone selection bar (canvas-actions.js); each is one undo step like its toolbar/keyboard twin. */
  const barCommands = {
    rotate: () => rotateSelection(1),
    clone: () => cloneSelection(),
    remove: () => deleteSelection(),
    setTool,
    /** "배선": the wire tool; from a junction the wire starts right there. */
    startWire: (target) => {
      setTool("wire");
      const item = target?.items?.[0];
      if (target?.kind === "junction" && item) handleEndpointClick({ junctionId: item.id });
      else elements["tool-hint"].textContent = "배선 — 시작할 핀을 누르거나 핀에서 끌어 다른 핀에 놓으세요 · 완료하면 [선택]";
    },
    voltageProbe: (item) => {
      if (item?.kind === "junction") addVoltageProbeEndpoint({ junctionId: item.id });
      else if (item?.kind === "wire") {
        const wire = state.circuit.wires.find((entry) => entry.id === item.id);
        if (wire) addVoltageProbeEndpoint(wire.a.componentId !== undefined ? wire.a : wire.b, wire.id);
      }
      setStatus("V 프로브 추가 · 파형 탭에서 확인", "ready");
    },
  };

  return { setTool, restoreToolHint, renderPalette, openProbeContextMenu, closeProbeContextMenu, fitCanvas, cancelPointerSessions, cancelInteractions, attach, barCommands };
}
