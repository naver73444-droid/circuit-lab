// Result side of the circuit editor, loaded after the first screen (results-loader.js, imported dynamically by app.js):
// the analysis runner (worker runs, sweep, DC port, diagnostics) and the views that present its results
// (waveform scope, measurements, phasor panel and its complex-number practice), plus the hover readout model.
// Nothing here is needed to draw the editor or to place a part.
import { parseValue } from "./circuit-engine.js";
import { createPhasorView } from "./phasor-view.js";
import { ScopeView } from "./scope-view.js";
import { createMeasureView } from "./measure-view.js";
import { initializePhasorPractice } from "./phasor-practice.js";
import { createAnalysisRunner } from "./analysis-runner.js";

export { hoverReadout } from "./node-readout-model.js";

/**
 * Build the result views and the runner. `deps` are the runner's dependencies (see createAnalysisRunner) minus the views;
 * `hasPendingInputs` tells the phasor panel that a typed value is not committed yet.
 */
export function createResultViews({ hasPendingInputs, ...deps }) {
  const { elements, state } = deps;
  const phasorView = createPhasorView(elements, state, parseValue, hasPendingInputs);
  const scopeView = new ScopeView(elements["wave-plot"], elements["scope-controls"], elements["cursor-readout"]);
  const measureView = createMeasureView({ panel: elements["measure-panel"], summary: elements["measure-summary"], body: elements["measure-body"], bButton: elements["cursor-b-button"], scopeView });
  const analysis = createAnalysisRunner({ ...deps, scopeView, phasorView, measureView });
  initializePhasorPractice();
  return { analysis, scopeView, phasorView, measureView };
}
