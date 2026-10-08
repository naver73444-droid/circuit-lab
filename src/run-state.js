// Run/result state and the two small analysis helpers the first screen needs before the analysis runner is loaded
// (results-loader.js). The runner (analysis-runner.js) uses the same functions, so there is one implementation of each.
import { suggestAnalysis } from "./analysis-policy.js";
import { currentProbeLabel } from "./current-direction.js";
import { circuitGeometryVersion } from "./circuit-geometry.js";

/** Sweep slice of the shared state: the inspector form, the running flag and the finished overlay. */
export function createSweepState() {
  return {
    form: { open: false, componentId: null, from: "", to: "", count: "5", scale: "log", probeKey: "" },
    running: false,
    progress: "",
    message: "",
    messageKind: "",
    overlay: null,
  };
}

/** Run/result slice of the shared state: results, run status, auto-update and the DC port analysis. */
export function createRunState() {
  return {
    result: null,
    phasorResult: null,
    stale: false,
    acView: "magnitude",
    // Display basis of AC amplitudes ("peak" | "rms", see ac-basis.js). Not part of the project file: solving and stored values stay peak.
    acBasis: "peak",
    autoTimer: null,
    lastRunMs: null,
    runState: { status: "not-run", analysis: null, generation: null, error: null },
    autoUpdate: true,
    runSerial: 0,
    port: { mode: null, p: null, n: null, loadIds: [], result: null, stale: false, error: null },
    sweep: createSweepState(),
  };
}

/** The analysis plan follows the circuit and the chosen intent; the selector, the auto-update box and the reason line follow the plan. */
export function synchronizeIntent(state, elements) {
  const plan = suggestAnalysis(state.circuit, state.settings, state.intent);
  state.settings = plan.settings;
  // Manual (edited parameters) keeps the chosen analysis type visible in the single selector.
  if (elements["analysis-intent"]) elements["analysis-intent"].value = state.intent === "manual" ? state.settings.analysis : state.intent;
  if (elements["auto-update"]) elements["auto-update"].checked = state.autoUpdate;
  if (elements["analysis-recommendation"]) elements["analysis-recommendation"].textContent = plan.reason;
}

/** Labels follow the parts: renaming R2 to Rload relabels its probes (the label stored with the probe is only a cache). */
export function presentProbe(state, probe) {
  if (!probe) return probe;
  if (probe.kind === "current") {
    const component = state.circuit.components.find((item) => item.id === probe.componentId);
    if (component) probe.label = currentProbeLabel(component, circuitGeometryVersion(state.circuit), probe.winding);
  } else if (probe.kind === "voltage") {
    if (probe.junctionId !== undefined) probe.label = `V(${probe.junctionId})`;
    else {
      const component = state.circuit.components.find((item) => item.id === probe.componentId);
      if (component) probe.label = `V(${component.props?.ref ?? component.id}.${probe.pin + 1})`;
    }
  }
  return probe;
}
