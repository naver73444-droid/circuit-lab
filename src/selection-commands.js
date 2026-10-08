import { GRID_SIZE } from "./circuit-geometry.js";
import { cloneComponentSet, deleteSelectionFromCircuit } from "./circuit-edit.js";
import { allItems, clearSelection, selectedItems, setSelectionItems, setSingleSelection } from "./selection-model.js";
import { moveGroup, movableItems, rotateGroup } from "./group-edit.js";
import { allocatorFor } from "./id-allocator.js";
import { rerouteWires, wiresFollowingMove } from "./wire-router.js";
import { NUDGE_IDLE_MS } from "./editor-shortcuts.js";
import { convertYDeltaInCircuit, retargetPortEndpoint, selectedResistorIds } from "./y-delta-circuit.js";
import { CLIPBOARD_FORMAT, additionLimitReason, buildClipboard, clipboardLimitReason, controlsNeedingTarget, parseClipboardText, pasteClipboard, pasteRejection, serializeClipboard } from "./clipboard-model.js";

/**
 * Whole-selection commands (delete, duplicate, rotate, nudge, select all, copy/cut/paste). Every command that changes the circuit goes
 * through session.mutate()/mutateGrouped(), so each is ONE history entry no matter how many items it touches. editor-input wires them
 * to keys, buttons and the inspector's group actions.
 */
export function createSelectionCommands({ state, elements, mutate, mutateGrouped, closeEditGroup, commitActiveDrag, setStatus, renderSelection, isCircuitUiActive, notify = () => {}, reconcileAnalysis = () => {} }) {
  /** Delete every selected part, wire and junction as ONE history entry. */
  function deleteSelection() {
    commitActiveDrag();
    const items = selectedItems(state);
    if (!items.length) return;
    const componentIds = new Set(items.filter((item) => item.kind === "component").map((item) => item.id));
    if (state.inlineEdit && componentIds.has(state.inlineEdit.componentId)) { state.inlineEdit = null; elements["inline-value-editor"].classList.add("hidden"); }
    mutate(() => {
      const deleted = deleteSelectionFromCircuit(state.circuit, items, state.probes);
      state.circuit = deleted.circuit;
      state.probes = deleted.probes;
      clearSelection(state);
    });
  }

  /** Duplicate the selection (parts, junctions and the wires between them) one grid-pair away, as ONE history entry. */
  /** Duplicate obeys the same size limits as paste: when the copy would not fit, say so instead of building an invalid circuit. */
  function cloneRejected(cloned) {
    const reason = additionLimitReason(state.circuit, cloned);
    if (!reason) return false;
    setStatus(`복제 거부 · ${reason}`, "error");
    notify(`복제 거부 · ${reason}`, "error");
    return true;
  }

  function cloneSelection(event = null) {
    commitActiveDrag();
    const items = selectedItems(state);
    const componentIds = items.filter((item) => item.kind === "component").map((item) => item.id);
    if (!componentIds.length) return;
    if (items.length === 1) {
      const original = state.circuit.components.find((component) => component.id === componentIds[0]);
      if (!original) return;
      const includeTarget = Boolean(event?.shiftKey && ["CCCS", "CCVS"].includes(original.type) && original.control?.elementId);
      const ids = includeTarget ? [original.control.elementId, original.id] : [original.id];
      const cloned = cloneComponentSet(state.circuit, ids, 40, { allocator: allocatorFor(state) });
      const selectedId = cloned.idMap.get(original.id);
      if (!selectedId) return;
      if (cloneRejected(cloned)) return;
      mutate(() => {
        state.circuit.components.push(...cloned.components);
        state.circuit.wires.push(...cloned.wires);
        setSingleSelection(state, { kind: "component", id: selectedId });
      });
      setStatus(includeTarget ? "제어 대상·종속원 원자 복제 완료" : "부품 복제 완료 · 외부 제어 ID 유지", "ready");
      return;
    }
    const junctionIds = items.filter((item) => item.kind === "junction").map((item) => item.id);
    const cloned = cloneComponentSet(state.circuit, componentIds, 40, { junctionIds, allocator: allocatorFor(state) });
    if (!cloned.components.length) return;
    if (cloneRejected(cloned)) return;
    mutate(() => {
      state.circuit.components.push(...cloned.components);
      state.circuit.junctions = [...(state.circuit.junctions ?? []), ...cloned.junctions];
      state.circuit.wires.push(...cloned.wires);
      setSelectionItems(state, [
        ...cloned.components.map((component) => ({ kind: "component", id: component.id })),
        ...cloned.wires.map((wire) => ({ kind: "wire", id: wire.id })),
        ...cloned.junctions.map((junction) => ({ kind: "junction", id: junction.id })),
      ]);
    });
    setStatus(`${cloned.components.length}개 부품 복제 완료`, "ready");
  }

  /** Port ends on removed pins follow their anchor (none → cleared); a port that moved no longer has a valid result. */
  function retargetPort(report) {
    const port = state.port;
    if (!port) return;
    let moved = false;
    for (const key of ["p", "n"]) {
      const next = retargetPortEndpoint(port[key], report);
      if (next === port[key]) continue;
      port[key] = next;
      moved = true;
    }
    if (moved) Object.assign(port, { mode: null, result: null, error: null, stale: false });
  }

  /**
   * Y→Δ / Δ→Y for exactly three selected resistors, as ONE history entry. Anything else selected is ignored (no-op); a recognised but
   * unsupported topology says why. The three new resistors become the selection; the result turns stale like any circuit edit.
   * DC-port ends that sat on a removed resistor pin move to the net's anchor (where a probe would go), and the port loads / sweep part that
   * were removed are dropped (analysis reconcile), so no analysis setting is left pointing at a part that no longer exists.
   */
  function convertYDelta() {
    commitActiveDrag();
    const ids = selectedResistorIds(state.circuit, selectedItems(state));
    if (!ids) return false;
    let outcome;
    let reason = "";
    try {
      outcome = convertYDeltaInCircuit(state.circuit, ids, { allocator: allocatorFor(state), probes: state.probes });
      if (outcome.ok === false) reason = outcome.reason;
    } catch (error) {
      reason = error instanceof RangeError ? error.message : "변환하지 못했습니다.";
    }
    if (reason) {
      setStatus(`Y–Δ 변환 거부 · ${reason}`, "error");
      notify(`Y–Δ 변환 거부 · ${reason}`, "error");
      return false;
    }
    if (state.inlineEdit && ids.includes(state.inlineEdit.componentId)) { state.inlineEdit = null; elements["inline-value-editor"].classList.add("hidden"); }
    mutate(() => {
      state.circuit = outcome.circuit;
      state.probes = outcome.probes;
      retargetPort(outcome.report);
      reconcileAnalysis();
      setSelectionItems(state, outcome.report.selection);
    });
    setStatus(outcome.report.message, "ready");
    notify(outcome.report.message, "info");
    return true;
  }

  /** One part turns in place; several parts/junctions turn together around the primary (last clicked) item. One history entry. */
  function rotateSelection(direction = 1) {
    commitActiveDrag();
    const items = selectedItems(state);
    if (!items.some((item) => item.kind === "component")) return;
    mutate(() => {
      rotateGroup(state.circuit, items, direction, state.selected);
      rerouteWires(state.circuit, wiresFollowingMove(state.circuit, items)); // wires to the turned pins leave them the new way
    });
  }

  /** Arrow-key move by whole grid steps. A press is one history entry; held-key repeats extend that entry. Moves the whole selection. */
  function nudgeSelection({ dx, dy, steps, repeat }) {
    if (state.pointerOwnerId !== null || state.pendingPin || state.inlineEdit) return false;
    const items = movableItems(selectedItems(state)).filter((item) => item.kind === "junction"
      ? (state.circuit.junctions ?? []).some((junction) => junction.id === item.id)
      : state.circuit.components.some((component) => component.id === item.id));
    if (!items.length) return false;
    if (!repeat) closeEditGroup();
    mutateGrouped("nudge", () => {
      moveGroup(state.circuit, items, dx * steps * GRID_SIZE, dy * steps * GRID_SIZE);
      rerouteWires(state.circuit, wiresFollowingMove(state.circuit, items));
    }, { idleMs: NUDGE_IDLE_MS });
    return true;
  }

  function selectAll() {
    if (state.pendingPin || state.inlineEdit) return false;
    commitActiveDrag();
    const items = allItems(state.circuit);
    if (!items.length) return false;
    setSelectionItems(state, items, state.selected ?? items[0]);
    renderSelection();
    return true;
  }

  // ---- clipboard: an internal clipboard mirrored to the system clipboard as JSON. A paste prefers what the browser's own paste event carries
  // (the latest system clipboard, no permission prompt); the internal clipboard is only the fallback when that holds no Circuit Lab payload.

  let clipboard = null; // the last fragment that was copied here or pasted successfully (never a rejected one)
  let clipboardText = ""; // its JSON, to recognise "the same clipboard again" (cascading offsets) versus a new one
  let pasteIndex = 1;
  let pasteSerial = 0; // id of the latest paste request; an async system-clipboard read that is no longer the latest is dropped

  function writeSystemClipboard(text) {
    try { navigator.clipboard?.writeText(text)?.catch(() => {}); } catch { /* insecure context or no permission */ }
  }

  /**
   * Copy (or cut) the selection. With `clipboardData` (the native copy/cut event) the JSON goes into that event's data; otherwise it is
   * written with navigator.clipboard. Returns true when the key press was handled (even if a size limit stopped the copy).
   * `token` (one per Ctrl+C/X press, see createClipboardShortcutGate) lets the native event and the key fallback share ONE run: whichever
   * gets here first claims it, the other does nothing.
   */
  function copySelection({ cut = false, clipboardData = null, token = null } = {}) {
    commitActiveDrag();
    const clip = buildClipboard(state.circuit, selectedItems(state), state.projectId);
    if (!clip) return false;
    if (token && !token.claim()) return true;
    const limit = clipboardLimitReason(clip);
    if (limit) { setStatus(limit, "error"); notify(limit, "error"); return true; }
    const text = serializeClipboard(clip);
    clipboard = clip;
    clipboardText = text;
    pasteIndex = 1;
    let written = false;
    if (clipboardData) { try { clipboardData.setData("text/plain", text); written = true; } catch { /* fall back below */ } }
    if (!written) writeSystemClipboard(text);
    const count = clip.components.length + clip.junctions.length;
    if (cut) { deleteSelection(); setStatus(`${count}개 잘라냄 · Ctrl+V로 붙여넣기`, "ready"); }
    else setStatus(`${count}개 복사 · Ctrl+V로 붙여넣기`, "ready");
    return true;
  }

  /**
   * Paste one fragment. Only the pasted part is validated (plus the size limits of the whole circuit), so unrelated errors elsewhere never block it.
   * The fragment becomes the internal clipboard only after it was pasted: a rejected one is never remembered. Returns whether it was pasted.
   */
  function pasteFragment(clip, text) {
    const index = text === clipboardText ? pasteIndex : 1;
    const pasted = pasteClipboard(state.circuit, clip, index, { sameProject: Boolean(clip.source) && clip.source === state.projectId, allocator: allocatorFor(state) });
    const reason = pasteRejection(state.circuit, pasted);
    if (reason) {
      setStatus(`붙여넣기 거부 · ${reason}`, "error");
      notify(`붙여넣기 거부 · ${reason}`, "error");
      return false;
    }
    clipboard = clip;
    clipboardText = text;
    pasteIndex = index + 1;
    mutate(() => {
      state.circuit.components.push(...pasted.components);
      state.circuit.junctions = [...(state.circuit.junctions ?? []), ...pasted.junctions];
      state.circuit.wires.push(...pasted.wires);
      setSelectionItems(state, [
        ...pasted.components.map((component) => ({ kind: "component", id: component.id })),
        ...pasted.wires.map((wire) => ({ kind: "wire", id: wire.id })),
        ...pasted.junctions.map((junction) => ({ kind: "junction", id: junction.id })),
      ]);
    });
    const needing = controlsNeedingTarget(pasted);
    setStatus(`${pasted.components.length + pasted.junctions.length}개 붙여넣기${needing ? " · 제어 대상을 다시 선택하세요" : ""}`, "ready");
    if (needing) notify(`제어 대상을 다시 선택하세요 · 붙여넣은 종속원 ${needing}개의 제어 대상이 다른 회로이거나 없어 지웠습니다`, "info");
    return true;
  }

  /** Text from the system clipboard: a validated clip, or null after telling the user why nothing was pasted. */
  function clipFromText(text) {
    const clip = parseClipboardText(text);
    if (clip) return clip;
    if (typeof text === "string" && text.includes(CLIPBOARD_FORMAT)) setStatus("붙여넣기 거부 · 클립보드 내용이 올바른 Circuit Lab 형식이 아닙니다", "error");
    return null;
  }

  /**
   * Ctrl+V. With `clipboardData` (the native paste event): a Circuit Lab payload in it wins, else the internal clipboard. Without it (key
   * fallback): the internal clipboard, and only when that is empty the async system clipboard. Returns true (the key press was handled).
   *
   * One Ctrl+V can reach this twice (the native paste event and the key fallback timer). `token` is the per-press token: the path that actually
   * pastes claims it, the other one finds it claimed and does nothing, in either order — also when the async read is still pending.
   * An async read that finishes after the project changed (new, opened, example, link) or after a newer paste request is dropped.
   */
  function pasteSelection({ clipboardData = null, token = null } = {}) {
    commitActiveDrag();
    const request = ++pasteSerial;
    const claimed = () => !token || token.claim();
    if (clipboardData) {
      let text = "";
      try { text = clipboardData.getData("text/plain"); } catch { /* unreadable */ }
      const clip = clipFromText(text);
      if (clip) { if (claimed()) pasteFragment(clip, text); return true; }
      if (text.includes(CLIPBOARD_FORMAT)) return true; // rejected above, with its own message
    }
    if (clipboard) { if (claimed()) pasteFragment(clipboard, clipboardText); return true; }
    if (clipboardData) { setStatus("붙여넣을 회로 항목이 없습니다", "ready"); return true; }
    if (token?.done) return true; // the native paste already took care of this key press
    const projectId = state.projectId;
    (async () => {
      try {
        const text = await navigator.clipboard.readText();
        // The request is stale when another project is showing now, a newer paste superseded it, or the native event of the same press pasted meanwhile.
        if (state.projectId !== projectId || request !== pasteSerial || token?.done) return;
        const clip = clipFromText(text);
        if (!clip) { if (!text.includes(CLIPBOARD_FORMAT)) setStatus("붙여넣을 회로 항목이 없습니다", "ready"); return; }
        if (!isCircuitUiActive()) return;
        if (claimed()) pasteFragment(clip, text);
      } catch { if (state.projectId === projectId && request === pasteSerial) setStatus("붙여넣을 회로 항목이 없습니다", "ready"); }
    })();
    return true;
  }

  /**
   * "배선 정리": the selected wires (none selected: every wire) are drawn again on a fresh automatic route; clicked bend points are dropped.
   * Only the drawing changes, never what is connected. One history entry, none when nothing would change.
   */
  function tidyWires() {
    commitActiveDrag();
    const selected = selectedItems(state).filter((item) => item.kind === "wire").map((item) => item.id);
    const ids = selected.length ? selected : state.circuit.wires.map((wire) => wire.id);
    const trial = structuredClone(state.circuit);
    const original = new Map(state.circuit.wires.map((wire) => [wire.id, JSON.stringify(wire)]));
    const changed = rerouteWires(trial, ids, { fresh: true }).filter((id) => JSON.stringify(trial.wires.find((wire) => wire.id === id)) !== original.get(id));
    if (!changed.length) {
      setStatus(ids.length ? "배선이 이미 정리되어 있습니다" : "정리할 배선이 없습니다", "ready");
      return 0;
    }
    mutate(() => { rerouteWires(state.circuit, ids, { fresh: true }); });
    const message = `배선 ${changed.length}개를 자동 경로로 정리했습니다 · 되돌리기 Ctrl+Z`;
    setStatus(message, "ready");
    return changed.length;
  }

  return { deleteSelection, cloneSelection, rotateSelection, convertYDelta, nudgeSelection, selectAll, copySelection, pasteSelection, tidyWires };
}
