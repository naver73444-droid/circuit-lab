import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AnalysisCancelledError, AnalysisWorkerClient, AnalysisWorkerError } from "../src/analysis-worker-client.js";

const app = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");

class ControlledWorker {
  constructor({ postError = null } = {}) {
    this.postError = postError;
    this.terminated = 0;
    this.messages = [];
    this.onmessage = null;
    this.onerror = null;
    this.onmessageerror = null;
  }
  postMessage(message) {
    if (this.postError) throw this.postError;
    this.messages.push(structuredClone(message));
  }
  terminate() { this.terminated += 1; }
}

test("CIRCUIT-018 client terminates A, ignores late A, and lets B settle once", async () => {
  const workers = [];
  const client = new AnalysisWorkerClient({ workerFactory: () => { const worker = new ControlledWorker(); workers.push(worker); return worker; } });
  const a = client.start("normal", { circuit: {}, settings: {} });
  const lateSuccess = workers[0].onmessage;
  const lateError = workers[0].onerror;
  const aCancelled = assert.rejects(a.promise, AnalysisCancelledError);
  const b = client.start("port", { circuit: {}, request: {} });
  await aCancelled;
  assert.equal(workers[0].terminated, 1);
  lateSuccess({ data: { requestId: a.requestId, kind: "normal", ok: true, value: "late" } });
  lateError({ message: "late error", preventDefault() {} });
  assert.equal(client.isActive(b.requestId, "port"), true);
  workers[1].onmessage({ data: { requestId: b.requestId, kind: "port", ok: true, value: { result: "B" } } });
  assert.deepEqual(await b.promise, { result: "B" });
  assert.equal(workers[1].terminated, 1);
  assert.equal(client.hasActive, false);
});

test("CIRCUIT-018 explicit cancel settles the promise and a fresh run succeeds", async () => {
  const workers = [];
  const client = new AnalysisWorkerClient({ workerFactory: () => { const worker = new ControlledWorker(); workers.push(worker); return worker; } });
  const first = client.start("normal", {});
  const cancelled = assert.rejects(first.promise, (error) => error instanceof AnalysisCancelledError && error.reason === "user-cancelled");
  assert.equal(client.cancel("user-cancelled"), true);
  await cancelled;
  const second = client.start("normal", {});
  workers[1].onmessage({ data: { requestId: second.requestId, kind: "normal", ok: true, value: 42 } });
  assert.equal(await second.promise, 42);
});

test("CIRCUIT-018 Worker creation, clone, module, and analysis errors are explicit", async () => {
  const createFailure = new AnalysisWorkerClient({ workerFactory: () => { throw new Error("blocked"); } });
  await assert.rejects(createFailure.start("normal", {}).promise, (error) => error instanceof AnalysisWorkerError && /만들 수/.test(error.message));

  const cloneWorker = new ControlledWorker({ postError: new DOMException("cannot clone", "DataCloneError") });
  const cloneFailure = new AnalysisWorkerClient({ workerFactory: () => cloneWorker });
  await assert.rejects(cloneFailure.start("normal", {}).promise, (error) => error instanceof AnalysisWorkerError && /복제/.test(error.message));

  const moduleWorker = new ControlledWorker();
  const moduleFailure = new AnalysisWorkerClient({ workerFactory: () => moduleWorker });
  const moduleRun = moduleFailure.start("normal", {});
  moduleWorker.onerror({ message: "module load failed", preventDefault() {} });
  await assert.rejects(moduleRun.promise, (error) => error instanceof AnalysisWorkerError && /module load failed/.test(error.message));

  const analysisWorker = new ControlledWorker();
  const analysisFailure = new AnalysisWorkerClient({ workerFactory: () => analysisWorker });
  const analysisRun = analysisFailure.start("normal", {});
  analysisWorker.onmessage({ data: { requestId: analysisRun.requestId, kind: "normal", ok: false, error: { name: "CircuitError", code: "NO_GROUND", message: "ground required", hint: "add ground", details: { ids: ["R1"] } } } });
  await assert.rejects(analysisRun.promise, (error) => error.name === "CircuitError" && error.code === "NO_GROUND" && error.hint === "add ground" && error.details.ids[0] === "R1");
});

test("CIRCUIT-018 app routes edits and port changes through common cancellation and guards stale results/finally", () => {
  const invalidateBody = app.match(/function invalidateActiveAnalysis\([\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(invalidateBody, /state\.runSerial \+= 1/);
  assert.match(invalidateBody, /analysisWorkerClient\.cancel\(reason\)/);
  assert.match(invalidateBody, /updateAnalysisControls\(\)/);
  for (const functionName of ["resetProjectSession", "markStale", "markInputDirty", "toggleSelectedPortLoad"]) {
    const body = app.match(new RegExp(`function ${functionName}\\([^)]*\\) \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? "";
    assert.match(body, /invalidateActiveAnalysis\(/, `${functionName} must invalidate the active Worker`);
  }
  const endpointBody = app.match(/function handleEndpointClick\([\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(endpointBody, /port-selection-changed/);
  const normalBody = app.match(/async function runAnalysis\([\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(normalBody, /serial !== state\.runSerial/);
  assert.match(normalBody, /acceptsRunGeneration\(generation, state\.generation\)/);
  assert.match(normalBody, /activeAnalysisJob\?\.requestId === workerRequest\.requestId/);
  const portBody = app.match(/async function runPortAnalysis\([\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(portBody, /generation !== state\.generation/);
  assert.match(portBody, /selectionSnapshot !== portSelectionSnapshot\(\)/);
  assert.match(portBody, /activeAnalysisJob\?\.requestId === workerRequest\.requestId/);
  assert.match(app, /cancel-analysis-button/);
  assert.doesNotMatch(app, /analyzeDCPort\(state\.circuit/);
});
