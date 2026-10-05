import test from "node:test";
import assert from "node:assert/strict";
import { AUTOSAVE_KEY, createAutosave, describeSavedAt, isEmptyProject, projectFingerprint, shouldOfferRestore } from "../../src/persistence.js";
import { cloneExample } from "../../src/examples.js";

function fakeStorage(overrides = {}) {
  const data = new Map();
  return {
    data,
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)); },
    removeItem: (key) => { data.delete(key); },
    ...overrides,
  };
}

function fakeTimers() {
  let nowMs = 1_000_000;
  let nextId = 1;
  const queue = new Map();
  return {
    now: () => nowMs,
    setTimeout: (fn, ms) => { const id = nextId++; queue.set(id, { fn, at: nowMs + ms }); return id; },
    clearTimeout: (id) => { queue.delete(id); },
    advance(ms) {
      nowMs += ms;
      for (const [id, timer] of [...queue]) if (timer.at <= nowMs) { queue.delete(id); timer.fn(); }
    },
    pending: () => queue.size,
  };
}

function projectOf(id = "divider") {
  const example = cloneExample(id);
  return { title: example.name, subtitle: example.description, circuit: example.circuit, settings: example.settings, probes: [] };
}

function make(storage = fakeStorage(), options = {}) {
  const timers = fakeTimers();
  const autosave = createAutosave({ storage, now: timers.now, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout, ...options });
  return { autosave, timers, storage };
}

test("디바운스: 연속 schedule은 마지막 한 번만 저장한다", () => {
  const { autosave, timers, storage } = make();
  const first = projectOf("divider");
  assert.equal(autosave.schedule(first).state, "pending");
  timers.advance(500);
  assert.equal(storage.data.size, 0);
  autosave.schedule(projectOf("rc-charge"));
  timers.advance(799);
  assert.equal(storage.data.size, 0, "마지막 호출 후 800ms 전에는 저장하지 않음");
  timers.advance(1);
  assert.equal(storage.data.size, 1);
  const stored = JSON.parse(storage.data.get(AUTOSAVE_KEY));
  assert.equal(stored.v, 1);
  assert.equal(stored.savedAt, timers.now());
  assert.equal(stored.project.format, "circuit-lab");
  assert.equal(stored.project.title, "RC 충전 (시간응답)");
  assert.equal(timers.pending(), 0);
  assert.equal(autosave.getStatus().state, "saved");
});

test("flush는 대기 중인 저장을 즉시 수행하고 타이머를 취소한다", () => {
  const { autosave, timers, storage } = make();
  autosave.schedule(projectOf());
  const result = autosave.flush();
  assert.equal(result.ok, true);
  assert.equal(result.state, "saved");
  assert.equal(storage.data.size, 1);
  assert.equal(timers.pending(), 0);
  assert.equal(autosave.flush().state, "saved", "대기 없으면 마지막 상태 그대로");
});

test("load: 저장한 프로젝트를 기존 파서로 복원(round trip)", () => {
  const { autosave, timers } = make();
  const original = projectOf("rlc");
  original.probes = [{ key: "V(R1.2)", kind: "voltage", componentId: "R1", pin: 1, label: "V(R1.2)", color: "#80bfff" }];
  autosave.schedule(original);
  timers.advance(800);
  const saved = autosave.load();
  assert.ok(saved);
  assert.equal(saved.savedAt, timers.now());
  assert.deepEqual(saved.project.circuit.components, original.circuit.components);
  assert.deepEqual(saved.project.circuit.wires, original.circuit.wires);
  assert.equal(saved.project.probes.length, 1);
  assert.equal(saved.project.title, original.title);
  assert.equal(saved.project.settings.analysis, "transient");
});

test("load: 비어 있음 / 깨진 JSON / 버전 불일치 / 잘못된 회로는 null + 이유", () => {
  const storage = fakeStorage();
  const { autosave } = make(storage);
  assert.equal(autosave.load(), null);
  assert.equal(autosave.getStatus().state, "empty");
  storage.data.set(AUTOSAVE_KEY, "{not json");
  assert.equal(autosave.load(), null);
  assert.equal(autosave.getStatus().state, "invalid");
  assert.match(autosave.getStatus().reason, /읽을 수 없습니다/);
  storage.data.set(AUTOSAVE_KEY, JSON.stringify({ v: 2, savedAt: 1, project: {} }));
  assert.equal(autosave.load(), null);
  assert.match(autosave.getStatus().reason, /지원하지 않는/);
  storage.data.set(AUTOSAVE_KEY, JSON.stringify({ v: 1, savedAt: 1, project: { format: "circuit-lab", version: 1, circuit: { version: 1, components: "bad", wires: [] } } }));
  const detailed = autosave.loadDetailed();
  assert.equal(detailed.ok, false);
  assert.equal(detailed.empty, false);
  assert.equal(autosave.load(), null);
  assert.equal(autosave.getStatus().ok, false);
  assert.ok(autosave.getStatus().reason.length > 0);
});

test("저장소 오류는 throw하지 않고 상태로 반환: 용량 초과, 접근 불가, 저장소 없음", () => {
  const quota = fakeStorage({ setItem() { const error = new Error("full"); error.name = "QuotaExceededError"; throw error; } });
  const a = make(quota);
  a.autosave.schedule(projectOf());
  a.timers.advance(800);
  assert.equal(a.autosave.getStatus().state, "quota");
  assert.match(a.autosave.getStatus().reason, /저장 공간/);

  const denied = fakeStorage({ setItem() { throw new Error("SecurityError"); }, getItem() { throw new Error("SecurityError"); }, removeItem() { throw new Error("SecurityError"); } });
  const b = make(denied);
  assert.doesNotThrow(() => b.autosave.schedule(projectOf()));
  assert.doesNotThrow(() => b.timers.advance(800));
  assert.equal(b.autosave.getStatus().state, "error");
  assert.equal(b.autosave.load(), null);
  assert.equal(b.autosave.clear().ok, false);

  const none = make(null);
  assert.equal(none.autosave.flush().state, "empty");
  none.autosave.schedule(projectOf());
  assert.equal(none.autosave.flush().state, "unavailable");
  assert.equal(none.autosave.load(), null);
  assert.equal(none.autosave.clear().state, "unavailable");
});

test("직렬화가 던져도(편집 중 잠시 무효한 회로) 이전 저장본은 유지", () => {
  const { autosave, timers, storage } = make();
  autosave.schedule(projectOf());
  timers.advance(800);
  const before = storage.data.get(AUTOSAVE_KEY);
  autosave.schedule({ title: "x", circuit: { components: "bad", wires: [] }, settings: {}, probes: [] });
  assert.doesNotThrow(() => timers.advance(800));
  assert.equal(autosave.getStatus().state, "error");
  assert.equal(storage.data.get(AUTOSAVE_KEY), before);
});

test("clear는 대기 중 저장을 취소하고 저장본을 지운다", () => {
  const { autosave, timers, storage } = make();
  autosave.schedule(projectOf());
  timers.advance(800);
  autosave.schedule(projectOf("rc-charge"));
  assert.equal(autosave.clear().state, "cleared");
  timers.advance(5000);
  assert.equal(storage.data.size, 0);
  assert.equal(autosave.hasPending(), false);
});

test("사용자 지정 key/serialize/debounceMs", () => {
  const { autosave, timers, storage } = make(fakeStorage(), { key: "custom", debounceMs: 100, serialize: () => JSON.stringify({ any: 1 }) });
  autosave.schedule({});
  timers.advance(100);
  assert.deepEqual(JSON.parse(storage.data.get("custom")).project, { any: 1 });
});

test("isEmptyProject / shouldOfferRestore", () => {
  const empty = { circuit: { version: 1, components: [], wires: [] } };
  const divider = projectOf("divider");
  assert.equal(isEmptyProject(empty), true);
  assert.equal(isEmptyProject(divider), false);
  assert.equal(isEmptyProject(null), true);
  const saved = { project: divider, savedAt: 1 };
  assert.equal(shouldOfferRestore(null, true), false);
  assert.equal(shouldOfferRestore({ project: empty, savedAt: 1 }, true), false);
  assert.equal(shouldOfferRestore(saved, true), true);
  assert.equal(shouldOfferRestore(saved, false), false);
  assert.equal(shouldOfferRestore(saved, empty), true);
  assert.equal(shouldOfferRestore(saved, projectOf("divider")), false, "내용이 같으면 제안하지 않음");
  assert.equal(shouldOfferRestore(saved, projectOf("rc-charge")), true);
  assert.equal(projectFingerprint(projectOf("divider")), projectFingerprint(projectOf("divider")));
});

test("저장본과 불러온 프로젝트의 지문이 같아 복원 직후 다시 제안되지 않는다", () => {
  const { autosave, timers } = make();
  const project = projectOf("opamp");
  autosave.schedule(project);
  timers.advance(800);
  const saved = autosave.load();
  assert.equal(shouldOfferRestore(saved, project), false);
});

test("describeSavedAt 한국어 경과 시간", () => {
  assert.equal(describeSavedAt(1000, 1000 + 5000), "방금 전");
  assert.equal(describeSavedAt(0, 3 * 60_000), "3분 전");
  assert.equal(describeSavedAt(0, 2 * 3600_000), "2시간 전");
  assert.equal(describeSavedAt(0, 3 * 86400_000), "3일 전");
  assert.equal(describeSavedAt(NaN), "저장 시각 알 수 없음");
});
