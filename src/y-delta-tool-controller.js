/**
 * "Y–Δ 변환" course tool controller. Sliders and text fields apply on every input (no apply button); a text value that cannot be used keeps the
 * last valid network on screen and says why next to the field. Pure rules live in y-delta-tool-model.js (resistors) and y-delta-complex-model.js
 * (complex impedances, textbook 9.7), DOM in y-delta-tool-view.js. The two modes keep their own state; switching only changes which one is shown.
 */
import { DIRECTIONS, SLIDER_STEPS, attempt, createYDeltaToolState, evaluateTool, resistanceToSlider, sliderToResistance, toggleDirection, withText, withValue } from "./y-delta-tool-model.js";
import { COMPLEX_EXAMPLES, attemptComplex, createComplexState, evaluateComplexTool, impedanceDraft, parseImpedanceInput, toggleComplexDirection, withComplexText } from "./y-delta-complex-model.js";
import { createYDeltaToolView } from "./y-delta-tool-view.js";
import { resistanceCircuitText, resistanceText } from "./y-delta-model.js";

export function createYDeltaTool(host) {
  const view = createYDeltaToolView(host);
  let state = createYDeltaToolState();
  let complexState = createComplexState();
  let mode = "resistor";
  let destroyed = false;
  const invalid = new Map(); // field index → reason

  const isComplex = () => mode === "complex";
  const direction = () => (isComplex() ? complexState : state).direction;
  const keyOf = (index) => DIRECTIONS[direction()].inputs[index];
  const fieldIndex = (target) => Number(target.dataset.ydeltaSlider ?? target.dataset.ydeltaText ?? target.dataset.ydeltaExample);
  /** The text of the value in use (what a field shows after a refused edit or when it is left). */
  const inUseText = (index) => (isComplex() ? impedanceDraft(complexState.values[keyOf(index)]) : resistanceCircuitText(state.values[keyOf(index)]));

  function showAll() {
    view.setMode(mode);
    view.setDirection(direction());
    DIRECTIONS[direction()].inputs.forEach((key, index) => {
      if (!isComplex()) view.showSlider(index, resistanceToSlider(state.values[key]), resistanceText(state.values[key]));
      view.showText(index, inUseText(index));
      view.showError(index, invalid.get(index) ?? "");
    });
    if (isComplex()) view.showComplexEvaluation(evaluateComplexTool(complexState)); else view.showEvaluation(evaluateTool(state));
  }

  /** The last valid network stays; the draft text stays editable and the field says why it was not used. */
  function reject(index, reason) {
    invalid.set(index, `${reason} 마지막 유효 값(${inUseText(index)})을 쓰고 있습니다.`);
    view.showError(index, invalid.get(index));
  }

  /** The knob goes back to the value in use (a refused slider step must not leave it somewhere else). */
  function restoreKnob(index) {
    const value = state.values[keyOf(index)];
    view.showSlider(index, resistanceToSlider(value), resistanceText(value));
  }

  function onInput(event) {
    const target = event.target;
    if (isComplex()) {
      if (!target.matches?.("[data-ydelta-text]")) return;
      const index = fieldIndex(target);
      const result = withComplexText(complexState, keyOf(index), target.value);
      const tried = result.ok ? attemptComplex(result.state) : result;
      if (tried.ok) {
        complexState = result.state;
        invalid.delete(index);
        view.showError(index, "");
        view.showComplexEvaluation(tried.evaluation);
      } else reject(index, tried.reason);
      return;
    }
    if (target.matches?.("[data-ydelta-slider]")) {
      const index = fieldIndex(target);
      let candidate;
      try { candidate = withValue(state, keyOf(index), sliderToResistance(Number(target.value))); } catch { restoreKnob(index); return; }
      const tried = attempt(candidate);
      if (!tried.ok) { restoreKnob(index); reject(index, tried.reason); return; }
      state = candidate;
      invalid.delete(index);
      view.showSliderValueText(index, resistanceText(state.values[keyOf(index)]));
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
        view.showSlider(index, resistanceToSlider(state.values[keyOf(index)]), resistanceText(state.values[keyOf(index)]));
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
    view.showText(index, inUseText(index));
    view.showError(index, "");
  }

  /** A complex example: its three texts are parsed like typed ones and the whole state is replaced (or refused, the old network stays). */
  function applyExample(index) {
    const example = COMPLEX_EXAMPLES[index];
    if (!example) return;
    let candidate;
    try {
      const values = {};
      DIRECTIONS[example.direction].inputs.forEach((key, at) => { values[key] = parseImpedanceInput(example.texts[at], "Z_" + key.slice(1)); });
      candidate = { direction: example.direction, values };
    } catch (error) { view.showNotice(`예제를 쓰지 못했습니다. ${error.message}`); return; }
    const tried = attemptComplex(candidate);
    if (!tried.ok) { view.showNotice(`예제를 쓰지 못했습니다. ${tried.reason}`); return; }
    complexState = candidate;
    invalid.clear();
    showAll();
  }

  function onClick(event) {
    const modeButton = event.target.closest?.("[data-ydelta-mode]");
    if (modeButton && host.contains(modeButton)) {
      const next = modeButton.dataset.ydeltaMode;
      if (next === mode || !["resistor", "complex"].includes(next)) return;
      mode = next;
      invalid.clear();
      showAll();
      return;
    }
    const exampleButton = event.target.closest?.("[data-ydelta-example]");
    if (exampleButton && host.contains(exampleButton)) { applyExample(fieldIndex(exampleButton)); return; }
    const button = event.target.closest?.("[data-ydelta-direction]");
    if (!button || !host.contains(button)) return;
    const next = button.dataset.ydeltaDirection;
    if (next === direction()) return;
    // The same network the other way round: the results become the inputs.
    let toggled, tried;
    try {
      toggled = isComplex() ? toggleComplexDirection(complexState) : toggleDirection(state);
      tried = isComplex() ? attemptComplex(toggled) : attempt(toggled);
    } catch { tried = { ok: false, reason: "반대 방향의 값을 계산할 수 없습니다." }; }
    if (!tried.ok) { view.showNotice(`방향을 바꾸지 못했습니다. ${tried.reason} 지금 값을 그대로 쓰고 있습니다.`); return; }
    if (isComplex()) complexState = toggled; else state = toggled;
    invalid.clear();
    showAll();
  }

  // Phones: the two networks stack so the figure text stays readable.
  const narrow = typeof window !== "undefined" ? window.matchMedia?.("(max-width: 760px)") : null;
  const onNarrow = () => view.setStacked(Boolean(narrow?.matches));
  narrow?.addEventListener?.("change", onNarrow);
  onNarrow();

  view.setExamples(COMPLEX_EXAMPLES);
  host.addEventListener("input", onInput);
  host.addEventListener("change", onChange);
  host.addEventListener("click", onClick);
  showAll();

  return {
    inspect() {
      if (destroyed) return { destroyed: true };
      if (isComplex()) {
        const evaluation = evaluateComplexTool(complexState), keys = [...DIRECTIONS[complexState.direction].inputs, ...DIRECTIONS[complexState.direction].outputs];
        return { destroyed, mode, direction: complexState.direction, inputs: { ...evaluation.inputs }, outputs: { ...evaluation.outputs }, texts: Object.fromEntries(keys.map((key) => [key, evaluation.texts[key].rect])),
          pairs: evaluation.pairs.map((p) => ({ pair: p.pair, pass: p.pass, difference: p.difference })), balanced: evaluation.balanced, read: evaluation.read, invalid: [...invalid.keys()], sliderSteps: SLIDER_STEPS };
      }
      const evaluation = evaluateTool(state);
      return { destroyed, mode, direction: state.direction, inputs: { ...evaluation.inputs }, outputs: { ...evaluation.outputs }, texts: { ...evaluation.texts }, read: evaluation.read, invalid: [...invalid.keys()], sliderSteps: SLIDER_STEPS };
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
