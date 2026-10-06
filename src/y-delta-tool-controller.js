/**
 * "Y–Δ 변환" course tool controller. Sliders and text fields apply on every input (no apply button); a text value that cannot be used keeps the
 * last valid network on screen and says why next to the field. Pure rules live in y-delta-tool-model.js, DOM in y-delta-tool-view.js.
 */
import { DIRECTIONS, SLIDER_STEPS, attempt, createYDeltaToolState, evaluateTool, resistanceToSlider, sliderToResistance, toggleDirection, withText, withValue } from "./y-delta-tool-model.js";
import { createYDeltaToolView } from "./y-delta-tool-view.js";
import { resistanceCircuitText } from "./y-delta-model.js";

export function createYDeltaTool(host) {
  const view = createYDeltaToolView(host);
  let state = createYDeltaToolState();
  let destroyed = false;
  const invalid = new Map(); // field index → reason

  const keyOf = (index) => DIRECTIONS[state.direction].inputs[index];
  const fieldIndex = (target) => Number(target.dataset.ydeltaSlider ?? target.dataset.ydeltaText);

  function showAll() {
    view.setDirection(state.direction);
    const keys = DIRECTIONS[state.direction].inputs;
    keys.forEach((key, index) => {
      view.showSlider(index, resistanceToSlider(state.values[key]));
      view.showText(index, resistanceCircuitText(state.values[key]));
      view.showError(index, invalid.get(index) ?? "");
    });
    view.showEvaluation(evaluateTool(state));
  }

  /** The last valid network stays; the draft text stays editable and the field says why it was not used. */
  function reject(index, reason) {
    invalid.set(index, `${reason} 마지막 유효 값(${resistanceCircuitText(state.values[keyOf(index)])})을 쓰고 있습니다.`);
    view.showError(index, invalid.get(index));
  }

  function onInput(event) {
    const target = event.target;
    if (target.matches?.("[data-ydelta-slider]")) {
      const index = fieldIndex(target);
      let candidate;
      try { candidate = withValue(state, keyOf(index), sliderToResistance(Number(target.value))); } catch { return; }
      const tried = attempt(candidate);
      if (!tried.ok) { reject(index, tried.reason); return; }
      state = candidate;
      invalid.delete(index);
      view.showText(index, resistanceCircuitText(state.values[keyOf(index)]));
      view.showError(index, "");
      view.showEvaluation(tried.evaluation);
    } else if (target.matches?.("[data-ydelta-text]")) {
      const index = fieldIndex(target);
      const result = withText(state, keyOf(index), target.value);
      const tried = result.ok ? attempt(result.state) : result;
      if (tried.ok) {
        state = result.state;
        invalid.delete(index);
        view.showSlider(index, resistanceToSlider(state.values[keyOf(index)]));
        view.showError(index, "");
        view.showEvaluation(tried.evaluation);
      } else reject(index, tried.reason);
    }
  }

  function onChange(event) {
    const target = event.target;
    if (!target.matches?.("[data-ydelta-text]")) return;
    // Leaving the field: show the value that is actually in use.
    const index = fieldIndex(target);
    invalid.delete(index);
    view.showText(index, resistanceCircuitText(state.values[keyOf(index)]));
    view.showError(index, "");
  }

  function onClick(event) {
    const button = event.target.closest?.("[data-ydelta-direction]");
    if (!button || !host.contains(button)) return;
    const direction = button.dataset.ydeltaDirection;
    if (direction === state.direction) return;
    // The same network the other way round: the results become the inputs.
    let toggled;
    try { toggled = toggleDirection(state); } catch { toggled = null; }
    const tried = toggled ? attempt(toggled) : { ok: false, reason: "반대 방향의 값을 계산할 수 없습니다." };
    if (!tried.ok) { reject(0, tried.reason); return; }
    state = toggled;
    invalid.clear();
    showAll();
  }

  // Phones: the two networks stack so the figure text stays readable.
  const narrow = typeof window !== "undefined" ? window.matchMedia?.("(max-width: 760px)") : null;
  const onNarrow = () => view.setStacked(Boolean(narrow?.matches));
  narrow?.addEventListener?.("change", onNarrow);
  onNarrow();

  host.addEventListener("input", onInput);
  host.addEventListener("change", onChange);
  host.addEventListener("click", onClick);
  showAll();

  return {
    inspect() {
      if (destroyed) return { destroyed: true };
      const evaluation = evaluateTool(state);
      return { destroyed, direction: state.direction, inputs: { ...evaluation.inputs }, outputs: { ...evaluation.outputs }, texts: { ...evaluation.texts }, read: evaluation.read, invalid: [...invalid.keys()], sliderSteps: SLIDER_STEPS };
    },
    destroy() {
      if (destroyed) return;
      narrow?.removeEventListener?.("change", onNarrow);
      host.removeEventListener("input", onInput);
      host.removeEventListener("change", onChange);
      host.removeEventListener("click", onClick);
      view.clear();
      destroyed = true;
    },
  };
}
