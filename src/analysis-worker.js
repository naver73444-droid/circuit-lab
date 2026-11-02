import { simulate, simulateACAtFrequency } from "./circuit-engine.js";
import { analyzeDCPort } from "./port-analysis.js";
import { analysisCircuit } from "./source-model.js";
import { triggeredResult } from "./analysis-policy.js";

export function serializeAnalysisError(error) {
  return {
    name: error?.name ?? "Error",
    code: error?.code ?? "WORKER_ANALYSIS_ERROR",
    message: error?.message ?? String(error),
    hint: error?.hint ?? "",
    details: error?.details ?? null,
  };
}

export function executeAnalysisRequest(message) {
  const { requestId, kind, payload } = message ?? {};
  try {
    if (!Number.isSafeInteger(requestId)) throw new Error("Worker requestId가 올바르지 않습니다.");
    // Sources are function generators: their DC and AC values follow the waveform (source-model.js). acInput names the source taken
    // as the 1 V (1 A) AC input when none is a sine, for the status line.
    const prepared = Array.isArray(payload?.circuit?.components) ? analysisCircuit(payload.circuit) : { circuit: payload?.circuit, acInput: null };
    const circuit = prepared.circuit;
    if (kind === "normal") {
      const full = simulate(circuit, payload.settings);
      // 정상상태: only the part from the trigger on crosses back to the page (the start-up samples are thousands of unused points).
      const result = Number.isFinite(payload.trigger) ? triggeredResult(full, payload.trigger) : full;
      const phasorResult = payload.settings.analysis === "ac"
        ? simulateACAtFrequency(circuit, payload.settings.phasorFrequency ?? "159.155")
        : null;
      return { requestId, kind, ok: true, value: { result, phasorResult, acInput: payload.settings.analysis === "ac" ? prepared.acInput : null } };
    }
    if (kind === "port") {
      return { requestId, kind, ok: true, value: analyzeDCPort(circuit, payload.request) };
    }
    throw new Error(`지원하지 않는 Worker 작업입니다: ${kind}`);
  } catch (error) {
    return { requestId, kind, ok: false, error: serializeAnalysisError(error) };
  }
}

const workerScope = typeof self !== "undefined"
  && typeof self.postMessage === "function"
  && typeof document === "undefined";

if (workerScope) {
  self.addEventListener("message", (event) => {
    self.postMessage(executeAnalysisRequest(event.data));
  });
}
