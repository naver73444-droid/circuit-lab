import test from "node:test";
import assert from "node:assert/strict";
import { createSweepRunner, createSweepState } from "../../src/sweep-runner.js";
import { sweepDefaults, sweepTarget } from "../../src/sweep-model.js";
import { AnalysisCancelledError } from "../../src/analysis-worker-client.js";
import { simulate } from "../../src/circuit-engine.js";
import { cloneExample } from "../../src/examples.js";
import { measureTraces } from "../../src/wave-measure-model.js";

globalThis.requestAnimationFrame ??= (callback) => setTimeout(callback, 0);
const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

/** The pieces analysis-runner provides: one job slot, a one-request-at-a-time worker client, edit invalidation. */
function harness({ example = "rc-lowpass", onStart = null, runnerOptions = {} } = {}) {
  const loaded = cloneExample(example);
  const state = {
    circuit: loaded.circuit, settings: loaded.settings, generation: 1, runSerial: 0, acView: "magnitude",
    probes: [{ key: "V:C1:0", kind: "voltage", componentId: "C1", pin: 0, label: "V(C1.1)", color: "#80bfff" }],
    sweep: createSweepState(),
  };
  let active = null; // {reject}
  const cancels = [];
  const started = [];
  const client = {
    start(kind, payload) {
      client.cancel("replaced");
      const index = started.length;
      started.push(payload);
      let rejectPromise;
      const promise = new Promise((resolve, reject) => {
        rejectPromise = reject;
        setTimeout(async () => {
          if (active?.reject !== rejectPromise) return;
          try { await onStart?.(index); resolve({ result: simulate(payload.circuit, payload.settings), phasorResult: null }); } catch (error) { reject(error); }
          active = null;
        }, 5);
      });
      active = { reject: rejectPromise };
      return { requestId: index + 1, promise };
    },
    cancel(reason) { if (!active) return false; cancels.push(reason); const { reject } = active; active = null; reject(new AnalysisCancelledError(reason)); return true; },
  };
  let job = null;
  const statuses = [];
  const events = { state: 0, overlay: 0 };
  const invalidate = () => { if (!job) return; state.runSerial += 1; client.cancel("input-changed"); job = null; };
  const runner = createSweepRunner({
    state, client, setStatus: (text) => statuses.push(text),
    commitPendingInputs: () => true, synchronizeIntent: () => {}, cancelScheduledRun: () => {}, presentProbe: (probe) => probe, activeKey: () => null,
    beginJob: () => { invalidate(); job = { kind: "sweep", serial: ++state.runSerial, requestId: null, generation: state.generation }; return job; },
    endJob: (finished) => { if (job === finished) job = null; },
    isCurrent: (candidate) => job === candidate && candidate.serial === state.runSerial && candidate.generation === state.generation,
    onState: () => { events.state += 1; }, onOverlay: () => { events.overlay += 1; },
    ...runnerOptions,
  });
  return { state, runner, client, started, statuses, events, cancels, invalidate, edit: () => { state.generation += 1; invalidate(); } };
}
const configure = (state, form) => Object.assign(state.sweep.form, { componentId: "R1", ...form });

test("스윕 대상: R·C·L 값과 간략 OP AMP 이득만, 기본 시작·끝은 현재 값의 1/10~10배", () => {
  const rc = cloneExample("rc-lowpass").circuit;
  assert.deepEqual(sweepTarget(rc.components.find((c) => c.id === "R1")), { componentId: "R1", ref: "R1", type: "R", key: "value", unit: "Ω", base: "1k" });
  assert.equal(sweepTarget(rc.components.find((c) => c.id === "C1")).key, "value");
  assert.equal(sweepTarget(rc.components.find((c) => c.id === "V1")), null);
  assert.equal(sweepTarget(rc.components.find((c) => c.id === "G1")), null);
  assert.equal(sweepTarget(null), null);
  const opamp = cloneExample("opamp").circuit.components.find((c) => c.type === "OPAMP");
  assert.equal(sweepTarget(opamp).key, "gain");
  assert.deepEqual(sweepDefaults("1k"), { from: "100", to: "10k" });
  assert.deepEqual(sweepDefaults("4.7u"), { from: "470n", to: "47u" });
  assert.equal(sweepDefaults("abc"), null);
  assert.equal(sweepDefaults("0"), null);
});

test("R1을 500Ω~2kΩ 로그 3점으로 스윕: 한 작업 안에서 순차 실행, 원본 회로 불변, 겹친 3개 곡선, −3 dB ∝ 1/R", async () => {
  const h = harness();
  configure(h.state, { from: "500", to: "2k", count: "3", scale: "log" });
  const before = JSON.stringify(h.state.circuit);
  const ok = await h.runner.run("R1");
  assert.equal(ok, true);
  assert.equal(h.started.length, 3);
  assert.deepEqual(h.started.map((payload) => payload.circuit.components.find((c) => c.id === "R1").props.value), ["500", "1k", "2k"]);
  assert.equal(JSON.stringify(h.state.circuit), before, "스윕은 편집한 회로를 바꾸지 않는다");
  assert.deepEqual(h.statuses.filter((text) => /^스윕 \d/.test(text)), ["스윕 1/3", "스윕 2/3", "스윕 3/3"]);
  const view = h.runner.view("magnitude");
  assert.equal(view.merged.series.length, 3);
  assert.deepEqual(view.overlay.plan.values.map((entry) => entry.label), ["R1 = 500 Ω", "R1 = 1 kΩ", "R1 = 2 kΩ"]);
  assert.equal(new Set(view.merged.series.map((item) => item.color)).size, 3);
  const measured = measureTraces({ analysis: "ac", traces: view.merged.series.map((item) => ({ key: item.key, label: item.label, color: item.color, baseUnit: item.baseUnit, raw: item.raw, xValues: item.xValues })), maxRows: 10 });
  const fc = measured.rows.map((row) => row.cells.find((cell) => cell.id === "cutoff").value);
  assert.ok(Math.abs(fc[0] / fc[1] - 2) < 0.04 && Math.abs(fc[1] / fc[2] - 2) < 0.04, JSON.stringify(fc));
  assert.ok(Math.abs(fc[1] - 159.155) / 159.155 < 0.01);
  // 위상 보기로 바꿔도 같은 결과 객체(스코프 커서 유지)
  assert.equal(h.runner.view("phase").resultLike, view.resultLike);
  assert.equal(h.runner.view("phase").merged.series[0].quantity, "°");
  assert.equal(h.state.sweep.running, false);
});

test("중간에 취소하면 부분 결과가 남지 않는다 (작업 무효화 = 계산 취소 버튼)", async () => {
  const h = harness({});
  configure(h.state, { from: "100", to: "10k", count: "6" });
  const done = h.runner.run("R1");
  await tick(30);
  assert.equal(h.state.sweep.running, true);
  assert.match(h.state.sweep.progress, /^스윕 \d\/6$/);
  assert.ok(h.started.length >= 1 && h.started.length < 6);
  h.invalidate(); // analysis-runner.invalidateActiveAnalysis
  assert.equal(await done, false);
  assert.equal(h.state.sweep.overlay, null);
  assert.equal(h.runner.view(), null);
  assert.equal(h.state.sweep.running, false);
  assert.ok(h.started.length < 6, "취소 뒤에는 더 시작하지 않는다");
});

test("편집(generation 변경)은 실행 중인 스윕을 버리고, 끝난 오버레이도 무효로 만든다", async () => {
  const h = harness();
  configure(h.state, { from: "100", to: "10k", count: "4" });
  const running = h.runner.run("R1");
  await tick(12);
  h.edit();
  assert.equal(await running, false);
  assert.equal(h.runner.current(), null);
  // 끝난 오버레이: 편집하면 사라진다
  configure(h.state, { from: "500", to: "2k", count: "3" });
  assert.equal(await h.runner.run("R1"), true);
  assert.ok(h.runner.current());
  h.state.generation += 1;
  assert.equal(h.runner.current(), null);
  assert.equal(h.state.sweep.overlay, null);
  // 프로브를 지워도 사라진다
  assert.equal(await h.runner.run("R1"), true);
  h.state.probes = [];
  assert.equal(h.runner.view(), null);
});

test("입력 오류는 실행 없이 메시지로, 프로브 없음·점 수 범위·0 이하 저항도 막는다", async () => {
  const h = harness();
  configure(h.state, { from: "abc", to: "2k", count: "3" });
  assert.equal(await h.runner.run("R1"), false);
  assert.match(h.state.sweep.message, /시작 값/);
  assert.equal(h.state.sweep.messageKind, "error");
  assert.equal(h.started.length, 0);
  configure(h.state, { from: "100", to: "2k", count: "1" });
  assert.equal(await h.runner.run("R1"), false);
  assert.match(h.state.sweep.message, /2~10/);
  configure(h.state, { from: "100", to: "2k", count: "11" });
  assert.equal(await h.runner.run("R1"), false);
  configure(h.state, { from: "0", to: "2k", count: "3", scale: "lin" });
  assert.equal(await h.runner.run("R1"), false);
  assert.match(h.state.sweep.message, /0보다/);
  configure(h.state, { from: "100", to: "2k", count: "3", scale: "log" });
  h.state.probes = [];
  assert.equal(await h.runner.run("R1"), false);
  assert.match(h.state.sweep.message, /프로브/);
  assert.equal(await h.runner.run("V1"), false);
  assert.equal(h.started.length, 0);
  assert.equal(h.state.sweep.running, false);
});

test("일부 점이 실패하면 나머지만 겹치고 사유를 알린다, 전부 실패하면 오버레이 없음", async () => {
  const h = harness({ onStart: (index) => { if (index === 1) throw new Error("수렴하지 않음"); } });
  configure(h.state, { from: "500", to: "2k", count: "3" });
  assert.equal(await h.runner.run("R1"), true);
  const view = h.runner.view();
  assert.equal(view.merged.series.length, 2);
  assert.equal(h.state.sweep.messageKind, "warn");
  assert.match(h.state.sweep.message, /1개 점/);
  const all = harness({ onStart: () => { throw new Error("특이 행렬"); } });
  configure(all.state, { from: "500", to: "2k", count: "3" });
  assert.equal(await all.runner.run("R1"), false);
  assert.equal(all.state.sweep.overlay, null);
  assert.match(all.state.sweep.message, /스윕 결과를 만들 수 없습니다/);
});

test("실행 중 두 번째 실행은 무시되고, 새 스윕은 이전 오버레이를 먼저 지운다", async () => {
  const h = harness();
  configure(h.state, { from: "500", to: "2k", count: "3" });
  const first = h.runner.run("R1");
  assert.equal(await h.runner.run("R1"), false, "이미 실행 중");
  assert.equal(await first, true);
  const id = h.runner.current().id;
  configure(h.state, { from: "1k", to: "3k", count: "3", scale: "lin" });
  assert.equal(await h.runner.run("R1"), true);
  assert.notEqual(h.runner.current().id, id);
  assert.deepEqual(h.runner.view().overlay.plan.values.map((entry) => entry.text), ["1k", "2k", "3k"]);
  assert.equal(h.runner.clear(), true);
  assert.equal(h.runner.clear(), false);
});

test("실제 마감 타이머: 느린 실행 하나가 한도를 넘기면 진행 중인 작업을 취소하고 즉시 중단한다", async () => {
  // 두 번째 점에서 워커가 멈춘 것처럼 오래 걸린다(300ms). 한도는 80ms.
  const h = harness({ onStart: async (index) => { if (index === 1) await tick(300); }, runnerOptions: { limitMs: 80 } });
  configure(h.state, { from: "500", to: "2k", count: "5" });
  const started = performance.now();
  const ok = await h.runner.run("R1");
  const elapsed = performance.now() - started;
  assert.equal(ok, false);
  assert.ok(elapsed < 250, `마감 시점에 끊겨야 한다 (${Math.round(elapsed)}ms)`);
  assert.deepEqual(h.cancels, ["sweep-time-limit"], "진행 중인 워커 작업이 취소됨");
  assert.equal(h.started.length, 2, "더 시작하지 않음");
  assert.equal(h.state.sweep.overlay, null);
  assert.equal(h.state.sweep.messageKind, "error");
  assert.match(h.state.sweep.message, /안전 한도/);
  assert.equal(h.statuses.at(-1), "스윕 중단");
  assert.equal(h.state.sweep.running, false);
  await tick(350); // 멈춘 척한 작업이 뒤늦게 끝나도 아무것도 되살아나지 않는다
  assert.equal(h.state.sweep.overlay, null);
});

test("마감 타이머는 정상 종료 시 해제되고, 사용자가 먼저 취소하면 시간 초과가 아니라 취소로 끝난다", async () => {
  const timers = new Set();
  const runnerOptions = { limitMs: 5000, setTimer: (fn, ms) => { const id = setTimeout(fn, ms); timers.add(id); return id; }, clearTimer: (id) => { timers.delete(id); clearTimeout(id); } };
  const ok = harness({ runnerOptions });
  configure(ok.state, { from: "500", to: "2k", count: "3" });
  assert.equal(await ok.runner.run("R1"), true);
  assert.equal(timers.size, 0, "정상 종료 후 타이머가 남지 않는다");

  const cancelled = harness({ onStart: async () => { await tick(30); }, runnerOptions });
  configure(cancelled.state, { from: "500", to: "2k", count: "5" });
  const running = cancelled.runner.run("R1");
  await tick(20);
  cancelled.edit(); // 사용자 취소/편집
  assert.equal(await running, false);
  assert.equal(timers.size, 0);
  assert.doesNotMatch(cancelled.state.sweep.message, /안전 한도/);
  assert.deepEqual(cancelled.cancels.filter((reason) => reason === "sweep-time-limit"), []);
});

test("각 응답 뒤와 오버레이를 내놓기 직전에도 경과 시간을 확인한다", async () => {
  // 시계는 호출될 때마다 10ms씩 간다. run()의 now() 호출 순서: 시작(1), 점마다 [시작 전 검사, 응답 후 검사], 게시 직전(마지막).
  const clock = (limitMs) => {
    let calls = 0;
    return { limitMs, now: () => (calls += 1) * 10, setTimer: () => 0, clearTimer: () => {} };
  };
  // 3점: 호출 1(시작) + 2×3 + 1(게시 직전) = 8번째 호출 시각 80 → 경과 70. 한도 65면 게시 직전에만 걸린다.
  const gate = harness({ runnerOptions: clock(65) });
  configure(gate.state, { from: "500", to: "2k", count: "3" });
  assert.equal(await gate.runner.run("R1"), false);
  assert.equal(gate.started.length, 3, "모든 점을 계산했어도");
  assert.equal(gate.state.sweep.overlay, null, "한도를 넘겼으면 오버레이를 게시하지 않는다");
  assert.match(gate.state.sweep.message, /안전 한도/);
  // 응답 직후 검사: 한도 25면 첫 점의 응답을 받자마자(호출 3, 경과 20 → 아직 통과) 둘째 점 시작 전 검사(호출 4, 경과 30)에서 걸린다
  const early = harness({ runnerOptions: clock(25) });
  configure(early.state, { from: "500", to: "2k", count: "3" });
  assert.equal(await early.runner.run("R1"), false);
  assert.equal(early.started.length, 1);
  // 한도가 충분하면 정상
  const fine = harness({ runnerOptions: clock(1000) });
  configure(fine.state, { from: "500", to: "2k", count: "3" });
  assert.equal(await fine.runner.run("R1"), true);
});
