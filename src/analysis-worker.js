import { simulate, simulateACAtFrequency } from "./circuit-engine.js";
import { analyzeDCPort } from "./port-analysis.js";

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
    if (kind === "normal") {
      const result = simulate(payload.circuit, payload.settings);
      const phasorResult = payload.settings.analysis === "ac"
        ? simulateACAtFrequency(payload.circuit, payload.settings.phasorFrequency ?? "159.155")
        : null;
      return { requestId, kind, ok: true, value: { result, phasorResult } };
    }
    if (kind === "port") {
      return { requestId, kind, ok: true, value: analyzeDCPort(payload.circuit, payload.request) };
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
