import { GRID_SIZE } from "./circuit-geometry.js";
import { cloneComponentSet, deleteSelectionFromCircuit } from "./circuit-edit.js";
import { serializeCircuit } from "./circuit-engine.js";
import { allItems, clearSelection, selectedItems, setSelectionItems, setSingleSelection } from "./selection-model.js";
import { moveGroup, movableItems, rotateGroup } from "./group-edit.js";
import { buildClipboard, parseClipboardText, pasteClipboard, serializeClipboard } from "./clipboard-model.js";

/**
 * Whole-selection commands (delete, duplicate, rotate, nudge, select all, copy/cut/paste). Every command that changes the circuit goes
 * through session.mutate()/mutateGrouped(), so each is ONE history entry no matter how many items it touches. editor-input wires them
 * to keys, buttons and the inspector's group actions.
 */
export function createSelectionCommands({ state, elements, mutate, mutateGrouped, closeEditGroup, commitActiveDrag, setStatus, renderSelection, isCircuitUiActive }) {
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
      const cloned = cloneComponentSet(state.circuit, ids);
      const selectedId = cloned.idMap.get(original.id);
      if (!selectedId) return;
      mutate(() => {
        state.circuit.components.push(...cloned.components);
        state.circuit.wires.push(...cloned.wires);
        setSingleSelection(state, { kind: "component", id: selectedId });
      });
      setStatus(includeTarget ? "제어 대상·종속원 원자 복제 완료" : "부품 복제 완료 · 외부 제어 ID 유지", "ready");
      return;
    }
    const junctionIds = items.filter((item) => item.kind === "junction").map((item) => item.id);
    const cloned = cloneComponentSet(state.circuit, componentIds, 40, { junctionIds });
    if (!cloned.components.length) return;
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

  /** One part turns in place; several parts/junctions turn together around the primary (last clicked) item. One history entry. */
  function rotateSelection(direction = 1) {
    commitActiveDrag();
    const items = selectedItems(state);
    if (!items.some((item) => item.kind === "component")) return;
    mutate(() => { rotateGroup(state.circuit, items, direction, state.selected); });
  }

  /** Arrow-key move by whole grid steps. A press is one history entry; held-key repeats extend that entry. Moves the whole selection. */
  function nudgeSelection({ dx, dy, steps, repeat }) {
    if (state.pointerOwnerId !== null || state.pendingPin || state.inlineEdit) return false;
    const items = movableItems(selectedItems(state)).filter((item) => item.kind === "junction"
      ? (state.circuit.junctions ?? []).some((junction) => junction.id === item.id)
      : state.circuit.components.some((component) => component.id === item.id));
    if (!items.length) return false;
    if (!repeat) closeEditGroup();
    mutateGrouped("nudge", () => { moveGroup(state.circuit, items, dx * steps * GRID_SIZE, dy * steps * GRID_SIZE); });
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

  // ---- clipboard: an internal clipboard (paste always uses it) mirrored best-effort to the system clipboard as JSON

  let clipboard = null;
  let pasteIndex = 1;

  function writeSystemClipboard(text) {
    try { navigator.clipboard?.writeText(text)?.catch(() => {}); } catch { /* insecure context or no permission */ }
  }

  function copySelection({ cut = false } = {}) {
    commitActiveDrag();
    const clip = buildClipboard(state.circuit, selectedItems(state));
    if (!clip) return false;
    clipboard = clip;
    pasteIndex = 1;
    writeSystemClipboard(serializeClipboard(clip));
    const count = clip.components.length + clip.junctions.length;
    if (cut) { deleteSelection(); setStatus(`${count}개 잘라냄 · Ctrl+V로 붙여넣기`, "ready"); }
    else setStatus(`${count}개 복사 · Ctrl+V로 붙여넣기`, "ready");
    return true;
  }

  function pasteInto(clip, { validate = false } = {}) {
    const pasted = pasteClipboard(state.circuit, clip, pasteIndex);
    if (validate) {
      try {
        serializeCircuit({ ...state.circuit, components: [...state.circuit.components, ...pasted.components], wires: [...state.circuit.wires, ...pasted.wires], junctions: [...(state.circuit.junctions ?? []), ...pasted.junctions] });
      } catch (error) {
        setStatus(`붙여넣기 거부 · ${error.message}`, "error");
        return false;
      }
    }
    pasteIndex += 1;
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
    setStatus(`${pasted.components.length + pasted.junctions.length}개 붙여넣기`, "ready");
    return true;
  }

  /** Ctrl+V: the internal clipboard wins; only when it is empty is the system clipboard consulted (another tab or window). */
  function pasteSelection() {
    commitActiveDrag();
    if (clipboard) { pasteInto(clipboard); return true; }
    (async () => {
      try {
        const clip = parseClipboardText(await navigator.clipboard.readText());
        if (!clip) { setStatus("붙여넣을 회로 항목이 없습니다", "ready"); return; }
        if (!isCircuitUiActive()) return;
        clipboard = clip;
        pasteIndex = 1;
        pasteInto(clip, { validate: true });
      } catch { setStatus("붙여넣을 회로 항목이 없습니다", "ready"); }
    })();
    return true;
  }

  return { deleteSelection, cloneSelection, rotateSelection, nudgeSelection, selectAll, copySelection, pasteSelection };
}
