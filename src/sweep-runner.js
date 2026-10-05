import { buildSweepCircuits, mergeSweepResults, planSweep, sweepTarget } from "./sweep-model.js";
import { AnalysisCancelledError } from "./analysis-worker-client.js";

/** Whole-sweep wall-clock guard on top of the engine's own per-run budget. */
export const SWEEP_TIME_LIMIT_MS = 60000;

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

/**
 * Parameter sweep controller. It runs N analyses one after another through the shared worker client under ONE cancellable job
 * (the job slot, cancel button and stale/edit invalidation belong to the analysis runner and are injected), and only publishes the
 * overlay when every run has finished — a cancelled or invalidated sweep leaves nothing behind.
 */
export function createSweepRunner(deps) {
  const { state, client, setStatus, beginJob, endJob, isCurrent, commitPendingInputs, synchronizeIntent, cancelScheduledRun, presentProbe, activeKey, onState, onOverlay } = deps;
  const sweep = state.sweep;
  let overlaySerial = 0;

  function say(text, kind = "") {
    sweep.message = text;
    sweep.messageKind = kind;
    onState();
  }

  /** The probe whose traces are overlaid: the form's choice, else the active scope trace, else the first probe. */
  function pickProbe() {
    const probes = state.probes.map(presentProbe).filter(Boolean);
    return probes.find((probe) => probe.key === sweep.form.probeKey)
      ?? probes.find((probe) => probe.key === activeKey())
      ?? probes[0]
      ?? null;
  }

  const frame = () => new Promise((resolve) => { requestAnimationFrame(resolve); setTimeout(resolve, 50); });

  async function run(componentId) {
    if (sweep.running) return false;
    if (!commitPendingInputs()) return false;
    synchronizeIntent();
    cancelScheduledRun();
    const component = state.circuit.components.find((item) => item.id === componentId);
    const target = sweepTarget(component);
    if (!target) { say("이 부품은 스윕할 수 없습니다.", "error"); return false; }
    const probe = pickProbe();
    if (!probe) { say("결과를 보여 줄 V 또는 I 프로브를 먼저 놓으세요.", "error"); return false; }
    const form = sweep.form;
    const count = Number(form.count);
    if (!Number.isInteger(count) || count < 2 || count > 10) { say("점 수는 2~10 사이의 정수로 입력하세요.", "error"); return false; }
    const plan = planSweep(target.base, { from: form.from.trim(), to: form.to.trim(), count, scale: form.scale }, { type: target.type, ref: target.ref, unit: target.unit });
    if (!plan.ok) { say(plan.reason, "error"); return false; }
    const built = buildSweepCircuits(state.circuit, target.componentId, target.key, plan);
    if (!built.ok) { say(built.reason, "error"); return false; }

    const settings = structuredClone(state.settings);
    const total = built.entries.length;
    sweep.overlay = null;
    sweep.running = true;
    sweep.message = "";
    sweep.messageKind = "";
    const job = beginJob();
    onOverlay();
    const startedAt = performance.now();
    const results = [];
    let aborted = null;
    try {
      for (let index = 0; index < total; index += 1) {
        sweep.progress = `스윕 ${index + 1}/${total}`;
        setStatus(sweep.progress, "running");
        onState();
        await frame();
        if (!isCurrent(job)) { aborted = "cancelled"; break; }
        if (performance.now() - startedAt > SWEEP_TIME_LIMIT_MS) { aborted = "time"; break; }
        const request = client.start("normal", { circuit: built.entries[index].circuit, settings });
        job.requestId = request.requestId;
        try {
          const value = await request.promise;
          if (!isCurrent(job)) { aborted = "cancelled"; break; }
          results.push(value.result);
        } catch (error) {
          if (error instanceof AnalysisCancelledError || !isCurrent(job)) { aborted = "cancelled"; break; }
          results.push({ ok: false, reason: error?.message ?? String(error) });
        }
      }
      if (aborted === "time") {
        say(`스윕이 ${SWEEP_TIME_LIMIT_MS / 1000}초 안전 한도를 넘어 중단했습니다. 점 수나 해석 범위를 줄이세요.`, "error");
        setStatus("스윕 중단", "error");
      } else if (!aborted) {
        const overlay = { id: (overlaySerial += 1), generation: job.generation, probe, plan, results, componentRef: target.ref, views: new Map(), resultLike: null };
        const view = viewFor(overlay, state.acView);
        if (!view) {
          const merged = mergeSweepResults({ plan, results, probe, acView: state.acView });
          say(`스윕 결과를 만들 수 없습니다: ${merged.reason}`, "error");
          setStatus("스윕 실패", "error");
        } else {
          sweep.overlay = overlay;
          const skipped = view.merged.skipped;
          say(skipped.length ? `${skipped.length}개 점은 계산하지 못해 제외했습니다 (${skipped[0].reason})` : "", skipped.length ? "warn" : "");
          setStatus(`스윕 완료 · ${view.merged.series.length}개`, "ready");
        }
      }
    } finally {
      sweep.running = false;
      sweep.progress = "";
      endJob(job);
      onState();
      onOverlay();
    }
    return !aborted && Boolean(sweep.overlay);
  }

  function viewFor(overlay, acView) {
    if (overlay.views.has(acView)) return overlay.views.get(acView);
    const merged = mergeSweepResults({ plan: overlay.plan, results: overlay.results, probe: overlay.probe, acView });
    let view = null;
    if (merged.ok) {
      // One result-like object per overlay, so toggling magnitude/phase keeps the scope cursors.
      overlay.resultLike ??= { analysis: merged.analysis, xValues: merged.xValues, points: merged.xValues.map(() => ({})), sweep: true };
      view = { merged, resultLike: overlay.resultLike };
    }
    overlay.views.set(acView, view);
    return view;
  }

  /** The current overlay, or null — and an overlay made for an older circuit is dropped here. */
  function current() {
    const overlay = sweep.overlay;
    if (!overlay) return null;
    // An edit (new generation) or removing the swept probe makes the overlay meaningless.
    if (overlay.generation !== state.generation || !state.probes.some((probe) => probe.key === overlay.probe.key)) { sweep.overlay = null; return null; }
    return overlay;
  }

  /** {overlay, merged, resultLike} for the current AC view, or null. */
  function view(acView = state.acView) {
    const overlay = current();
    if (!overlay) return null;
    const found = viewFor(overlay, acView);
    return found ? { overlay, ...found } : null;
  }

  function clear({ quiet = false } = {}) {
    const had = Boolean(sweep.overlay);
    sweep.overlay = null;
    sweep.message = "";
    sweep.messageKind = "";
    if (!quiet) onState();
    return had;
  }

  return { run, clear, view, current };
}
