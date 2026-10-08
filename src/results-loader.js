// The circuit editor's first screen does not wait for the result side (result-views.js: analysis runner, scope, measurements,
// phasor panel). This module stands in for it until it is loaded and then forwards to it:
//  - `analysis` has the runner's API. Before the load nothing can have produced a result or started a job, so renders are no-ops
//    (renderAll() runs once the module is in), queries answer "nothing yet", and commands are queued and replayed in order.
//  - `scopeView`, `phasorView`, `measureView` answer like empty views and forward once the real ones exist.
//  - The analysis selector, the auto-update box and the run button are wired here, so they work from the first frame.
// The module is loaded on the first command that needs it (run, port, sweep), as soon as the circuit has parts (an example, a share
// link or a restored project is analysed right away), when the results/waveform panel is opened, or in idle time after the load event.
import { presentProbe, synchronizeIntent } from "./run-state.js";
import { preloadModules } from "./workspace-tabs.js";

const RENDERS = ["updateAnalysisControls", "renderProbes", "renderPlot", "renderPhasorLearning", "renderPortPanel", "renderFailureDiagnostic"];
const COMMANDS = ["markStale", "markInputDirty", "scheduleAutoRun", "cancelScheduledRun", "setAutoHint", "reconcileWithCircuit", "clearSweep", "resetSweep",
  "runAnalysis", "runPortAnalysis", "assignPortEndpoint", "runSweep"];
/** Commands that mean "the student wants a result now": they load the module even on an empty canvas. */
const URGENT = new Set(["runAnalysis", "runPortAnalysis", "assignPortEndpoint", "runSweep"]);
/** Answers while nothing is loaded: no job to invalidate, no result series, no sweep overlay. */
const IDLE_ANSWERS = { invalidateActiveAnalysis: false, seriesForProbes: [], sweepView: null };
/** Result-panel controls whose clicks before the load are replayed on the real listeners afterwards. */
const REPLAYED_CLICKS = ["cancel-analysis-button", "port-p-button", "port-n-button", "port-load-button", "port-clear-button", "port-run-button", "ac-view-toggle", "phasor-circuit-tab", "phasor-practice-tab"];

/** The scope as the editor sees it before the real ScopeView exists: no result, no cursor; subscribers are handed over on bind. */
function lateScopeView() {
  let view = null;
  const waiting = new Map(); // listener -> unsubscribe from the real view (null until bound)
  const call = (name, idle) => (...args) => (view ? view[name](...args) : idle);
  return {
    bind(real) { view = real; for (const listener of waiting.keys()) waiting.set(listener, real.subscribe(listener)); },
    get result() { return view ? view.result : null; },
    get cursorIndex() { return view ? view.cursorIndex : null; },
    get hoverIndex() { return view ? view.hoverIndex : null; },
    get pinnedIndex() { return view ? view.pinnedIndex : null; },
    get bArmed() { return view ? view.bArmed : false; },
    get activeTraceKey() { return view ? view.activeTraceKey : null; },
    point: call("point", null), inside: call("inside", false), keyCursor: call("keyCursor", false), inspect: call("inspect", null),
    wheel: call("wheel"), panFrom: call("panFrom"), restore: call("restore"), placeB: call("placeB"), pinCursorAt: call("pinCursorAt"),
    moveCursor: call("moveCursor"), render: call("render"), resetForProject: call("resetForProject"), fit: call("fit"),
    subscribe(listener) {
      if (view) return view.subscribe(listener);
      waiting.set(listener, null);
      return () => { waiting.get(listener)?.(); waiting.delete(listener); };
    },
  };
}

/**
 * deps: state, elements, renderAll, mutate, commitPendingInputs (wired controls), load(retrySuffix) -> import("./result-views.js" + suffix),
 * modules (module-preload-map.js LAZY_MODULES.results), build(module) -> { analysis, scopeView, phasorView, measureView }, onError(error).
 */
export function createResultsLoader({ state, elements, renderAll, mutate, commitPendingInputs, load, modules = [], build, onError = () => {} }) {
  let views = null, runner = null, readout = null, loading = null, failures = 0;
  const queue = [];
  const scopeView = lateScopeView();
  const phasorView = { renderNotice: () => views?.phasorView.renderNotice() };
  const measureView = {
    clear: () => views?.measureView.clear(),
    inspect: () => (views ? views.measureView.inspect() : { computeCount: 0, rows: 0, signature: null, visible: false }),
  };

  function install(module) {
    if (views) return;
    views = build(module);
    runner = views.analysis;
    readout = module.hoverReadout ?? null;
    scopeView.bind(views.scopeView);
    runner.attach();
    const failed = [];
    for (const run of queue.splice(0)) { try { run(); } catch (error) { failed.push(error); } }
    renderAll();
    for (const error of failed) queueMicrotask(() => { throw error; });
  }

  /** Load (once) and install the result side. Resolves when it is in; a failed load is retried by the next request. */
  function ensure() {
    if (views) return Promise.resolve();
    if (!loading) {
      preloadModules(modules);
      const attempt = Promise.resolve().then(() => load(failures ? `?retry=${failures}` : "")).then(install);
      loading = attempt;
      attempt.catch((error) => { if (loading === attempt) { loading = null; failures += 1; } onError(error); });
    }
    return loading;
  }
  const prefetch = () => { ensure().catch(() => {}); };
  /** Before the load: a run request, or any request once the circuit has parts, starts loading (empty canvas: idle time does). */
  const want = (name) => { if (URGENT.has(name) || state.circuit.components.length > 0) prefetch(); };

  const analysis = {
    synchronizeIntent: () => synchronizeIntent(state, elements),
    presentProbe: (probe) => presentProbe(state, probe),
    attach,
  };
  for (const name of RENDERS) analysis[name] = (...args) => { if (runner) return runner[name](...args); want(name); return undefined; };
  for (const [name, answer] of Object.entries(IDLE_ANSWERS)) analysis[name] = (...args) => (runner ? runner[name](...args) : answer);
  for (const name of COMMANDS) {
    analysis[name] = (...args) => {
      if (runner) return runner[name](...args);
      want(name);
      // An automatic run keeps the time it was asked for, so its debounce overlaps the module load instead of following it.
      const call = name === "scheduleAutoRun" ? [{ requestedAt: performance.now() }] : args;
      return new Promise((resolve) => queue.push(() => resolve(runner[name](...call))));
    };
  }

  function attach() {
    elements["analysis-intent"].addEventListener("change", () => {
      const requestedIntent = elements["analysis-intent"].value;
      if (!commitPendingInputs()) { elements["analysis-intent"].value = state.intent; return; }
      mutate(() => { state.intent = requestedIntent; });
    });
    elements["auto-update"].addEventListener("change", () => {
      state.autoUpdate = elements["auto-update"].checked;
      analysis.scheduleAutoRun();
    });
    elements["run-button"].addEventListener("click", () => { analysis.runAnalysis(); });
    for (const id of REPLAYED_CLICKS) {
      document.getElementById(id)?.addEventListener("click", (event) => {
        if (views) return; // the real listeners have it
        const { target } = event;
        queue.push(() => { if (target.isConnected) target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
        prefetch();
      });
    }
  }

  return {
    analysis, scopeView, phasorView, measureView, ensure, prefetch,
    /** node-readout-model's hoverReadout once loaded (a result exists only after that). */
    readoutModel: () => readout,
    get loaded() { return Boolean(views); },
  };
}
