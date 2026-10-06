import test from "node:test";
import assert from "node:assert/strict";
import { CircuitError, simulateDC } from "../../src/circuit-engine.js";
import { describeCircuitFailure, failureRecord, resultAvailabilityText } from "../../src/analysis-diagnostics.js";
import { formatPortResult } from "../../src/ui-model.js";
import { AnalysisCancelledError, AnalysisWorkerClient, AnalysisWorkerError } from "../../src/analysis-worker-client.js";
import { refreshInvalidatedPortPanel } from "../../src/analysis-runner.js";

function parallelIdealCircuit({ source = {}, capacitor = null, inductor = null, duplicateSource = null, reverseSource = false } = {}) {
  const components = [
    { id: "source-x", type: "V", props: { ref: "VSUP", mode: "DC", dc: "5", ...source } },
    { id: "load-x", type: "R", props: { ref: "RLOAD", value: "1k" } },
    ...(inductor ? [{ id: "coil-x", type: "L", props: { ref: "LFAST", value: "10m", ic: "0", ...inductor } }] : []),
    ...(capacitor ? [{ id: "store-x", type: "C", props: { ref: "CSTORE", value: "1u", ic: "0", ...capacitor } }] : []),
    ...(duplicateSource ? [{ id: "source-y", type: "V", props: { ref: "VAUX", mode: "DC", dc: "5", ...duplicateSource } }] : []),
    { id: "ground-x", type: "GND", props: { ref: "GND" } },
  ];
  const wires = [];
  const addBranch = (id, index, reverse = false) => {
    wires.push({ id: `top-${index}`, a: { componentId: id, pin: reverse ? 1 : 0 }, b: { componentId: "load-x", pin: 0 } });
    wires.push({ id: `bottom-${index}`, a: { componentId: id, pin: reverse ? 0 : 1 }, b: { componentId: "ground-x", pin: 0 } });
  };
  addBranch("source-x", 0, reverseSource);
  wires.push({ id: "load-return", a: { componentId: "load-x", pin: 1 }, b: { componentId: "ground-x", pin: 0 } });
  if (inductor) addBranch("coil-x", 1);
  if (capacitor) addBranch("store-x", 2);
  if (duplicateSource) addBranch("source-y", 3);
  return { version: 1, components, wires };
}

test("run 상태와 오류 빈결과 안내는 연결 사실과 probe 보존을 분리한다", () => {
  assert.equal(resultAvailabilityText({ status: "error" }, "transient", 2), "시간응답 실패 · 프로브 2개 보존 · 유효 결과 없음");
  assert.equal(resultAvailabilityText({ status: "error" }, "transient", 0), "시간응답 실패 · 프로브 없음 · 유효 결과 없음");

  const circuit = parallelIdealCircuit({ inductor: {} });
  let failure;
  try { simulateDC(circuit); } catch (error) { failure = error; }
  const described = describeCircuitFailure(circuit, { analysis: "dc" }, failure);
  assert.equal(described.certaintyLabel, "확인된 원인");
  assert.deepEqual(described.relatedComponentIds, ["source-x", "coil-x"]);
  assert.match(described.constraints[0].text, /VSUP \[source-x\].*5 V/);
});

test("shows ideal voltage/current reasons and trial failures in final panel data", () => {
  const voltage = formatPortResult({
    classification: "ideal-voltage",
    equivalent: {
      vth: { kind: "finite", value: 5 },
      rth: { kind: "zero", value: 0 },
      in: { kind: "undefined", value: null, reason: "단락 전류가 유일하지 않습니다." },
    },
    trials: { short: { status: "error", error: { code: "IDEAL_CONSTRAINT_CONFLICT", message: "5 V 전압원과 0 V 단락이 모순입니다." } } },
  });
  assert.deepEqual([voltage.vth.text, voltage.rth.text, voltage.in.text], ["5 V", "0 Ω", "미정"]);
  assert.match(voltage.details.join("\n"), /이상 전압원형/);
  assert.match(voltage.details.join("\n"), /단락전류 미정/);
  assert.match(voltage.details.join("\n"), /단락 시험 불가 \(IDEAL_CONSTRAINT_CONFLICT\)/);

  const current = formatPortResult({
    classification: "ideal-current",
    equivalent: {
      vth: { kind: "undefined", value: null, reason: "이상 전류원형 포트의 개방 전압은 정해지지 않습니다." },
      rth: { kind: "infinite", value: null },
      in: { kind: "finite", value: .002 },
    },
    trials: { open: { status: "error", error: { code: "SINGULAR", message: "개방 포트 전압이 정해지지 않습니다." } } },
  });
  assert.deepEqual([current.vth.text, current.rth.text, current.in.text], ["미정", "∞ Ω", "0.002 A"]);
  assert.match(current.details.join("\n"), /이상 전류원형/);
  assert.match(current.details.join("\n"), /개방전압 미정/);
  assert.match(current.details.join("\n"), /개방 시험 불가 \(SINGULAR\)/);

});

test("result formatter keeps zero, infinity and unknown distinct", () => {
  const formatted = formatPortResult({ classification: "mixed", equivalent: {
    vth: { kind: "undefined", value: null, reason: "open" }, rth: { kind: "infinite", value: null }, in: { kind: "finite", value: 0.002 },
  }, directions: { equation: "V=Vth+Rth·I_into" } });
  assert.equal(formatted.vth.text, "미정");
  assert.equal(formatted.rth.text, "∞ Ω");
  assert.match(formatted.in.text, /0\.002 A/);
  assert.equal(formatPortResult({ equivalent: { vth: { kind: "finite", value: 0 }, rth: { kind: "zero", value: 0 }, in: { kind: "undefined", value: null } } }).rth.text, "0 Ω");
});

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

test("client terminates A, ignores late A, and lets B settle once", async () => {
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

test("explicit cancel settles the promise and a fresh run succeeds", async () => {
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

test("Worker creation, clone, module, and analysis errors are explicit", async () => {
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

function exercise(result) {
  const port = { result, stale: false, error: { code: "OLD", message: "old error" } };
  const dom = { status: "DC 포트 해석 중…", result: result ? "기존 결과" : "결과 없음" };
  const unrelated = { inspector: 0, drafts: 0, focus: 0 };
  let renders = 0;
  const renderPanel = () => {
    renders += 1;
    dom.status = port.stale ? "회로가 변경되어 이전 포트 결과가 오래되었습니다." : port.error ? "포트 분석 오류" : port.result ? "현재 회로 snapshot 결과" : "DC 선형 회로 전용";
    dom.result = port.result ? "기존 결과" : "결과 없음";
  };
  const changed = refreshInvalidatedPortPanel({ kind: "port" }, port, renderPanel);
  return { changed, port, dom, renders, unrelated };
}

test("port draft cancellation immediately renders the preserved result as stale", () => {
  const previous = { equivalent: { vth: { kind: "finite", value: 8 } } };
  const outcome = exercise(previous);
  assert.equal(outcome.changed, true);
  assert.equal(outcome.port.result, previous);
  assert.equal(outcome.port.stale, true);
  assert.equal(outcome.port.error, null);
  assert.equal(outcome.dom.status, "회로가 변경되어 이전 포트 결과가 오래되었습니다.");
  assert.equal(outcome.dom.result, "기존 결과");
  assert.equal(outcome.renders, 1);
  assert.deepEqual(outcome.unrelated, { inspector: 0, drafts: 0, focus: 0 });
});

test("port draft cancellation without a previous result immediately leaves ready state", () => {
  const outcome = exercise(null);
  assert.equal(outcome.changed, true);
  assert.equal(outcome.port.result, null);
  assert.equal(outcome.port.stale, false);
  assert.equal(outcome.port.error, null);
  assert.equal(outcome.dom.status, "DC 선형 회로 전용");
  assert.equal(outcome.dom.result, "결과 없음");
  assert.equal(outcome.renders, 1);
  assert.deepEqual(outcome.unrelated, { inspector: 0, drafts: 0, focus: 0 });
});

test("저장된 실패 기록(failureRecord)으로 다시 그려도 힌트·상세·관련 부품이 처음과 같다", () => {
  const circuit = parallelIdealCircuit({ inductor: {} });
  let failure;
  try { simulateDC(circuit); } catch (error) { failure = error; }
  const first = describeCircuitFailure(circuit, { analysis: "dc" }, failure);
  const stored = structuredClone(failureRecord(failure)); // runState.error는 구조 복제(getState)와 재렌더를 견뎌야 한다
  assert.deepEqual(Object.keys(stored).sort(), ["code", "details", "hint", "message"]);
  const again = describeCircuitFailure(circuit, { analysis: "dc" }, stored);
  assert.deepEqual(again, first);
  assert.ok(first.hint.length > 0 && first.constraints.length > 0 && first.relatedComponentIds.length > 0);
  // 힌트가 있는 단순 오류도 잃지 않는다.
  const tooMany = new CircuitError("TOO_MANY_POINTS", "점이 너무 많습니다.", "시간 간격을 늘리세요.");
  assert.equal(describeCircuitFailure(circuit, { analysis: "transient" }, failureRecord(tooMany)).hint, "시간 간격을 늘리세요.");
  // 알 수 없는 예외는 UNKNOWN으로 남는다.
  assert.equal(failureRecord(new TypeError("x")).code, "UNKNOWN");
});
