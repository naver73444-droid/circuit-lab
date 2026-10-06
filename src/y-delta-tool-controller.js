/**
 * "Y–Δ 변환" course tool controller. Sliders and text fields apply on every input (no apply button); a text value that cannot be used keeps the
 * last valid network on screen and says why next to the field. Pure rules live in y-delta-tool-model.js, DOM in y-delta-tool-view.js.
 */
import { DIRECTIONS, SLIDER_STEPS, createYDeltaToolState, evaluateTool, resistanceToSlider, sliderToResistance, toggleDirection, withText, withValue } from "./y-delta-tool-model.js";
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

  function onInput(event) {
    const target = event.target;
    if (target.matches?.("[data-ydelta-slider]")) {
      const index = fieldIndex(target);
      state = withValue(state, keyOf(index), sliderToResistance(Number(target.value)));
      invalid.delete(index);
      view.showText(index, resistanceCircuitText(state.values[keyOf(index)]));
      view.showError(index, "");
      view.showEvaluation(evaluateTool(state));
    } else if (target.matches?.("[data-ydelta-text]")) {
      const index = fieldIndex(target);
      const result = withText(state, keyOf(index), target.value);
      if (result.ok) {
        state = result.state;
        invalid.delete(index);
        view.showSlider(index, resistanceToSlider(state.values[keyOf(index)]));
        view.showError(index, "");
        view.showEvaluation(evaluateTool(state));
      } else {
        // The last valid network stays; the draft text stays editable.
        invalid.set(index, `${result.reason} 마지막 유효 값(${resistanceCircuitText(state.values[keyOf(index)])})을 쓰고 있습니다.`);
        view.showError(index, invalid.get(index));
      }
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
    state = toggleDirection(state);
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
