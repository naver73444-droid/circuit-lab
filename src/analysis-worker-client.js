import { CircuitError } from "./circuit-engine.js";

export class AnalysisCancelledError extends Error {
  constructor(reason = "cancelled") {
    super(reason);
    this.name = "AnalysisCancelledError";
    this.reason = reason;
  }
}

export class AnalysisWorkerError extends Error {
  constructor(message, cause = null) {
    super(message, cause ? { cause } : undefined);
    this.name = "AnalysisWorkerError";
    this.code = "WORKER_FAILURE";
    this.hint = "브라우저의 module Worker 지원과 로컬 서버의 JavaScript 응답을 확인하세요.";
  }
}

export function restoreAnalysisError(serialized) {
  if (serialized?.name === "CircuitError") {
    return new CircuitError(serialized.code, serialized.message, serialized.hint, serialized.details);
  }
  const error = new Error(serialized?.message ?? "Worker 해석에 실패했습니다.");
  error.name = serialized?.name ?? "Error";
  error.code = serialized?.code ?? "WORKER_ANALYSIS_ERROR";
  error.hint = serialized?.hint ?? "";
  error.details = serialized?.details ?? null;
  return error;
}

export class AnalysisWorkerClient {
  constructor({ workerFactory = () => new Worker(new URL("./analysis-worker.js", import.meta.url), { type: "module" }) } = {}) {
    this.workerFactory = workerFactory;
    this.sequence = 0;
    this.active = null;
  }

  get hasActive() { return Boolean(this.active); }

  isActive(requestId, kind = null) {
    return Boolean(this.active && this.active.requestId === requestId && (kind === null || this.active.kind === kind));
  }

  start(kind, payload) {
    this.cancel("replaced");
    const requestId = ++this.sequence;
    let resolvePromise;
    let rejectPromise;
    const promise = new Promise((resolve, reject) => { resolvePromise = resolve; rejectPromise = reject; });
    let worker;
    try {
      worker = this.workerFactory();
    } catch (error) {
      rejectPromise(new AnalysisWorkerError("해석 Worker를 만들 수 없습니다.", error));
      return { requestId, promise };
    }
    const active = { requestId, kind, worker, resolvePromise, rejectPromise, settled: false };
    this.active = active;
    worker.onmessage = (event) => {
      const message = event.data ?? {};
      if (!this.isActive(requestId, kind) || message.requestId !== requestId || message.kind !== kind) return;
      if (message.ok) this.settleActive(active, "resolve", message.value);
      else this.settleActive(active, "reject", restoreAnalysisError(message.error));
    };
    worker.onerror = (event) => {
      event.preventDefault?.();
      if (this.isActive(requestId, kind)) this.settleActive(active, "reject", new AnalysisWorkerError(event.message || "해석 Worker 모듈을 불러오거나 실행하지 못했습니다."));
    };
    worker.onmessageerror = () => {
      if (this.isActive(requestId, kind)) this.settleActive(active, "reject", new AnalysisWorkerError("해석 Worker 응답을 복제할 수 없습니다."));
    };
    try {
      worker.postMessage({ requestId, kind, payload });
    } catch (error) {
      this.settleActive(active, "reject", new AnalysisWorkerError("해석 입력을 Worker로 복제할 수 없습니다.", error));
    }
    return { requestId, promise };
  }

  cancel(reason = "cancelled") {
    if (!this.active) return false;
    this.settleActive(this.active, "reject", new AnalysisCancelledError(reason));
    return true;
  }

  settleActive(active, mode, value) {
    if (!active || active.settled) return false;
    active.settled = true;
    active.worker.onmessage = null;
    active.worker.onerror = null;
    active.worker.onmessageerror = null;
    active.worker.terminate();
    if (this.active === active) this.active = null;
    if (mode === "resolve") active.resolvePromise(value);
    else active.rejectPromise(value);
    return true;
  }
}
