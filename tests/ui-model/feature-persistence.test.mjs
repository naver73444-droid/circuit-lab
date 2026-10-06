import test from "node:test";
import assert from "node:assert/strict";
import { AUTOSAVE_MAX_SLOTS, AUTOSAVE_PREFIX, LEGACY_AUTOSAVE_KEY, TAB_ID_KEY, createAutosave, describeSavedAt, isEmptyProject, projectFingerprint, shouldOfferRestore } from "../../src/persistence.js";
import { cloneExample } from "../../src/examples.js";
import { serializeProject } from "../../src/project-format.js";

function fakeStorage(overrides = {}) {
  const data = new Map();
  return {
    data,
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)); },
    removeItem: (key) => { data.delete(key); },
    get length() { return data.size; },
    key: (index) => [...data.keys()][index] ?? null,
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

let idCounter = 0;
function make(storage = fakeStorage(), options = {}) {
  const timers = options.timers ?? fakeTimers();
  const autosave = createAutosave({ storage, session: fakeStorage(), newId: () => `tab-${++idCounter}-xxxx`, now: timers.now, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout, ...options });
  return { autosave, timers, storage, ownKey: autosave.key };
}
const slotKeys = (storage) => [...storage.data.keys()].filter((key) => key.startsWith(AUTOSAVE_PREFIX));

test("디바운스: 연속 schedule은 마지막 한 번만 저장한다", () => {
  const { autosave, timers, storage, ownKey } = make();
  const first = projectOf("divider");
  assert.equal(autosave.schedule(first).state, "pending");
  timers.advance(500);
  assert.equal(storage.data.size, 0);
  autosave.schedule(projectOf("rc-charge"));
  timers.advance(799);
  assert.equal(storage.data.size, 0, "마지막 호출 후 800ms 전에는 저장하지 않음");
  timers.advance(1);
  assert.equal(storage.data.size, 1);
  const stored = JSON.parse(storage.data.get(ownKey));
  assert.equal(stored.v, 2);
  assert.equal(stored.tabId, autosave.tabId);
  assert.equal(ownKey, AUTOSAVE_PREFIX + autosave.tabId);
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
  const slot = AUTOSAVE_PREFIX + "other-tab-1";
  assert.equal(autosave.load(), null);
  assert.equal(autosave.getStatus().state, "empty");
  storage.data.set(slot, "{not json");
  assert.equal(autosave.load(), null);
  assert.equal(autosave.getStatus().state, "invalid");
  assert.match(autosave.getStatus().reason, /지원하지 않는/);
  storage.data.set(slot, JSON.stringify({ v: 3, savedAt: 1, project: {} }));
  assert.equal(autosave.load(), null);
  assert.match(autosave.getStatus().reason, /지원하지 않는/);
  storage.data.set(slot, JSON.stringify({ v: 2, tabId: "other-tab-1", savedAt: 1, project: { format: "circuit-lab", version: 1, circuit: { version: 1, components: "bad", wires: [] } } }));
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
  const { autosave, timers, storage, ownKey } = make();
  autosave.schedule(projectOf());
  timers.advance(800);
  const before = storage.data.get(ownKey);
  assert.doesNotThrow(() => autosave.schedule({ title: "x", circuit: { components: "bad", wires: [] }, settings: {}, probes: [] }));
  assert.doesNotThrow(() => timers.advance(800));
  assert.equal(autosave.getStatus().state, "invalid-skip");
  assert.equal(storage.data.get(ownKey), before);
});

test("clear는 대기 중 저장을 취소하고 저장본을 지운다", () => {
  const { autosave, timers, storage } = make();
  autosave.schedule(projectOf());
  timers.advance(800);
  autosave.schedule(projectOf("rc-charge"));
  assert.equal(autosave.clear().state, "cleared");
  timers.advance(5000);
  assert.equal(slotKeys(storage).length, 0);
  assert.equal(autosave.hasPending(), false);
});

test("사용자 지정 key/serialize/debounceMs", () => {
  const { autosave, timers, storage } = make(fakeStorage(), { prefix: "custom.", tabId: "custom-tab", debounceMs: 100, serialize: () => JSON.stringify({ any: 1 }), parse: (text) => JSON.parse(text) });
  autosave.schedule({});
  timers.advance(100);
  assert.deepEqual(JSON.parse(storage.data.get("custom.custom-tab")).project, { any: 1 });
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

// ---- 리뷰 회귀 테스트 ----
test("리뷰2: 복원할 수 없는 설정({end:'abc'})은 이전 저장본을 덮어쓰지 않고 invalid-skip", () => {
  const { autosave, timers, storage, ownKey } = make();
  autosave.schedule(projectOf());
  timers.advance(800);
  assert.equal(autosave.getStatus().state, "saved");
  const before = storage.data.get(ownKey);
  const typing = projectOf();
  typing.settings = { analysis: "transient", start: "0", end: "abc", step: "1m" };
  autosave.schedule(typing);
  assert.doesNotThrow(() => timers.advance(800));
  assert.equal(autosave.getStatus().state, "invalid-skip");
  assert.equal(autosave.getStatus().ok, false);
  assert.match(autosave.getStatus().reason, /건너뛰/);
  assert.equal(storage.data.get(ownKey), before, "이전 저장본 유지");
  assert.equal(autosave.load() !== null, true, "저장본은 여전히 복원 가능");
  // 값이 올바르게 고쳐지면 다시 저장된다
  typing.settings = { analysis: "transient", start: "0", end: "10m", step: "1m" };
  autosave.schedule(typing);
  timers.advance(800);
  assert.equal(autosave.getStatus().state, "saved");
  assert.notEqual(storage.data.get(ownKey), before);
});

test("리뷰3: 용량 초과 후에도 대기 중인 프로젝트를 버리지 않고 flush()로 재시도", () => {
  let full = true;
  const storage = fakeStorage({
    setItem(key, value) {
      if (full) { const error = new Error("full"); error.name = "QuotaExceededError"; throw error; }
      storage.data.set(key, String(value));
    },
  });
  const { autosave, timers, ownKey } = make(storage);
  autosave.schedule(projectOf());
  timers.advance(800);
  assert.equal(autosave.getStatus().state, "quota");
  assert.equal(autosave.hasPending(), true, "실패했으므로 대기 유지");
  assert.equal(autosave.flush().state, "quota");
  assert.equal(autosave.hasPending(), true);
  full = false;
  assert.equal(autosave.flush().state, "saved");
  assert.equal(autosave.hasPending(), false);
  assert.ok(storage.data.get(ownKey));
  assert.equal(autosave.load() !== null, true);
});

// ---- 탭별 슬롯 / 스냅샷 / 취소 / 이전(v1) / 정리 ----
const serializedOf = (project) => JSON.parse(serializeProject(project));

test("schedule은 호출 순간의 사본을 저장한다: 이후 살아 있는 프로젝트가 바뀌어도(드래그 중 좌표) 새지 않는다", () => {
  const { autosave, timers, storage, ownKey } = make();
  const live = projectOf("divider");
  const originalX = live.circuit.components[0].x;
  autosave.schedule(live);
  live.circuit.components[0].x = originalX + 777; // 확정되지 않은 드래그 좌표
  live.title = "바뀐 제목";
  timers.advance(800);
  const stored = JSON.parse(storage.data.get(ownKey));
  assert.equal(stored.project.circuit.components[0].x, originalX);
  assert.notEqual(stored.project.title, "바뀐 제목");
  // 다음 확정 편집이 schedule되면 그때의 값이 저장된다
  autosave.schedule(live);
  autosave.flush();
  assert.equal(JSON.parse(storage.data.get(ownKey)).project.circuit.components[0].x, originalX + 777);
});

test("cancel: 프로젝트를 통째로 바꾸기 전 대기 중인 저장을 버리고, 다음 schedule이 새 상태를 저장한다", () => {
  const { autosave, timers, storage, ownKey } = make();
  autosave.schedule(projectOf("divider"));
  autosave.cancel();
  assert.equal(autosave.hasPending(), false);
  assert.equal(timers.pending(), 0);
  timers.advance(5000);
  assert.equal(storage.data.has(ownKey), false, "취소된 저장은 일어나지 않는다");
  assert.equal(autosave.flush().state, "empty", "대기 없음");
  autosave.schedule(projectOf("rc-charge"));
  timers.advance(800);
  assert.equal(JSON.parse(storage.data.get(ownKey)).project.title, "RC 충전 (시간응답)");
  // 이미 저장된 슬롯은 cancel이 건드리지 않는다
  autosave.cancel();
  assert.equal(storage.data.has(ownKey), true);
});

test("탭 id는 sessionStorage에 저장돼 같은 탭에서는 유지되고 새 탭은 새 id를 받는다", () => {
  const storage = fakeStorage();
  const sessionA = fakeStorage();
  const first = make(storage, { session: sessionA });
  const reloaded = make(storage, { session: sessionA });
  const other = make(storage, { session: fakeStorage() });
  assert.equal(sessionA.getItem(TAB_ID_KEY), first.autosave.tabId);
  assert.equal(reloaded.autosave.tabId, first.autosave.tabId);
  assert.notEqual(other.autosave.tabId, first.autosave.tabId);
  assert.equal(first.autosave.key, `${AUTOSAVE_PREFIX}${first.autosave.tabId}`);
  // sessionStorage가 막혀도 동작한다(그 로드 동안만 쓰는 id)
  const blocked = make(storage, { session: { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); } } });
  assert.ok(blocked.autosave.tabId);
});

test("두 탭이 서로 다른 회로를 편집해도 서로의 슬롯을 덮어쓰지 않고, 각 탭은 새로고침 후 자기 작업을 제안받는다", () => {
  const storage = fakeStorage();
  const timers = fakeTimers();
  const sessionA = fakeStorage();
  const sessionB = fakeStorage();
  const tabA = make(storage, { timers, session: sessionA });
  const tabB = make(storage, { timers, session: sessionB });
  tabA.autosave.schedule(projectOf("divider"));
  timers.advance(100);
  tabB.autosave.schedule(projectOf("rc-charge"));
  timers.advance(800); // 둘 다 저장됨 (A가 먼저, B가 나중)
  tabA.autosave.schedule(projectOf("rlc"));
  timers.advance(800); // A가 다시 저장 — B의 슬롯은 그대로
  assert.equal(slotKeys(storage).length, 2);
  assert.equal(JSON.parse(storage.data.get(tabB.ownKey)).project.title, "RC 충전 (시간응답)");
  assert.equal(JSON.parse(storage.data.get(tabA.ownKey)).project.title, projectOf("rlc").title);

  // 탭 A 새로고침: 같은 sessionStorage → 같은 id, 빈 편집기 → 가장 최근 슬롯(자기 것, rlc)이 후보
  const reloadedA = make(storage, { timers, session: sessionA });
  assert.equal(reloadedA.autosave.tabId, tabA.autosave.tabId);
  const empty = { circuit: { components: [], wires: [] } };
  const offeredA = reloadedA.autosave.loadDetailed({}, { current: empty });
  assert.equal(offeredA.ok, true);
  assert.equal(offeredA.own, true);
  assert.equal(offeredA.project.title, projectOf("rlc").title);
  // 탭 B 새로고침: B가 A보다 오래전에 저장했으므로 가장 최근 슬롯은 A의 작업이다(어느 쪽도 사라지지 않는다)
  const reloadedB = make(storage, { timers, session: sessionB });
  const offeredB = reloadedB.autosave.loadDetailed({}, { current: empty });
  assert.equal(offeredB.ok, true);
  assert.equal(offeredB.project.title, projectOf("rlc").title);
  // 새로 연 탭이 편집을 시작해도 두 슬롯은 유지된다
  const tabC = make(storage, { timers, session: fakeStorage() });
  tabC.autosave.schedule(projectOf("opamp"));
  timers.advance(800);
  assert.equal(slotKeys(storage).length, 3);
  assert.ok(storage.data.get(tabA.ownKey) && storage.data.get(tabB.ownKey));
});

test("복원 후보: 이 탭의 슬롯이 불러온 내용과 같으면 건너뛰고, 다른 슬롯이 없으면 제안하지 않는다", () => {
  const storage = fakeStorage();
  const timers = fakeTimers();
  const mine = make(storage, { timers });
  const other = make(storage, { timers });
  other.autosave.schedule(projectOf("rc-charge"));
  timers.advance(800);
  mine.autosave.schedule(projectOf("divider"));
  timers.advance(800); // mine이 가장 최근
  const loaded = projectOf("divider");
  const candidate = mine.autosave.loadDetailed({}, { current: loaded });
  assert.equal(candidate.ok, true);
  assert.equal(candidate.own, false, "자기 슬롯은 불러온 내용과 같아 건너뛴다");
  assert.equal(candidate.project.title, "RC 충전 (시간응답)");
  const alone = make(fakeStorage(), { timers });
  alone.autosave.schedule(projectOf("divider"));
  timers.advance(800);
  const none = alone.autosave.loadDetailed({}, { current: loaded });
  assert.equal(none.ok, false);
  assert.equal(none.empty, true);
});

test("v1 단일 키는 처음 실행할 때 새 id의 슬롯으로 옮기고 지운다(내용·savedAt 유지)", () => {
  const storage = fakeStorage();
  const original = projectOf("rlc");
  storage.data.set(LEGACY_AUTOSAVE_KEY, JSON.stringify({ v: 1, savedAt: 1234, project: serializedOf(original) }));
  const { autosave } = make(storage);
  assert.equal(storage.data.has(LEGACY_AUTOSAVE_KEY), false);
  const keys = slotKeys(storage);
  assert.equal(keys.length, 1);
  assert.notEqual(keys[0], autosave.key, "이 탭의 슬롯과 다른 새 id");
  const migrated = JSON.parse(storage.data.get(keys[0]));
  assert.equal(migrated.v, 2);
  assert.equal(migrated.savedAt, 1234);
  assert.equal(keys[0], AUTOSAVE_PREFIX + migrated.tabId);
  const offered = autosave.loadDetailed({}, { current: { circuit: { components: [], wires: [] } } });
  assert.equal(offered.ok, true);
  assert.equal(offered.project.title, original.title);
  // 다시 만들어도 중복 이전이 없다
  make(storage);
  assert.equal(slotKeys(storage).length, 1);
});

test("v1 이전: 읽을 수 없는 v1 값은 지우고, 쓰기에 실패하면 v1을 남겨 다음 시작에 다시 시도한다", () => {
  const broken = fakeStorage();
  broken.data.set(LEGACY_AUTOSAVE_KEY, "{not json");
  make(broken);
  assert.equal(broken.data.has(LEGACY_AUTOSAVE_KEY), false);
  assert.equal(slotKeys(broken).length, 0);

  const full = fakeStorage({ setItem() { const error = new Error("full"); error.name = "QuotaExceededError"; throw error; } });
  const entry = JSON.stringify({ v: 1, savedAt: 5, project: serializedOf(projectOf()) });
  full.data.set(LEGACY_AUTOSAVE_KEY, entry);
  assert.doesNotThrow(() => make(full));
  assert.equal(full.data.get(LEGACY_AUTOSAVE_KEY), entry, "복사에 실패하면 원본을 지우지 않는다");
});

test("슬롯은 최대 5개: 쓸 때 savedAt이 가장 오래된 것부터 지우고, 이 탭의 슬롯은 지우지 않는다", () => {
  const storage = fakeStorage();
  storage.data.set("unrelated", "keep");
  const timers = fakeTimers();
  const tabs = [];
  for (let index = 0; index < 7; index += 1) {
    const tab = make(storage, { timers, session: fakeStorage() });
    tabs.push(tab);
    tab.autosave.schedule(projectOf(index % 2 ? "divider" : "rc-charge"));
    timers.advance(1000);
    assert.ok(slotKeys(storage).length <= AUTOSAVE_MAX_SLOTS);
    assert.ok(storage.data.has(tab.ownKey), "방금 쓴 슬롯은 남는다");
  }
  assert.equal(slotKeys(storage).length, AUTOSAVE_MAX_SLOTS);
  assert.deepEqual(new Set(slotKeys(storage)), new Set(tabs.slice(2).map((tab) => tab.ownKey)), "가장 오래된 두 슬롯(탭 0, 1)이 정리됨");
  // 읽을 수 없는 슬롯은 가장 먼저 정리된다
  storage.data.set(`${AUTOSAVE_PREFIX}garbage-slot`, "{broken");
  tabs[6].autosave.schedule(projectOf("rlc"));
  timers.advance(1000);
  assert.equal(storage.data.has(`${AUTOSAVE_PREFIX}garbage-slot`), false);
  assert.ok(tabs.slice(2).every((tab) => storage.data.has(tab.ownKey)));
  assert.equal(storage.data.get("unrelated"), "keep", "다른 키는 건드리지 않는다");
});

test("onResult: 타이머로 실행된 저장 결과(성공·용량 초과)를 알린다", () => {
  let full = true;
  const storage = fakeStorage();
  storage.setItem = (key, value) => {
    if (full) { const error = new Error("full"); error.name = "QuotaExceededError"; throw error; }
    storage.data.set(key, String(value));
  };
  const results = [];
  const { autosave, timers } = make(storage, { onResult: (result) => results.push(result.state) });
  assert.equal(autosave.schedule(projectOf()).state, "pending");
  assert.deepEqual(results, [], "pending은 알리지 않는다");
  timers.advance(800);
  assert.deepEqual(results, ["quota"], "타이머로 실행된 쓰기 실패가 호출자에게 전달된다");
  full = false;
  autosave.flush();
  assert.deepEqual(results, ["quota", "saved"]);
  // 콜백이 던져도 저장은 영향받지 않는다
  const noisy = make(fakeStorage(), { onResult: () => { throw new Error("observer"); } });
  noisy.autosave.schedule(projectOf());
  assert.doesNotThrow(() => noisy.timers.advance(800));
  assert.equal(noisy.autosave.getStatus().state, "saved");
});

// ---- 교체 시 마감 저장 + prev 슬롯 ----
const projectWithTitle = (id, title) => ({ ...projectOf(id), title });
const titleIn = (storage, key) => JSON.parse(storage.data.get(key)).project.title;

test("retire: 바꾸기 직전 대기 중 저장을 먼저 마무리하고, 새 프로젝트의 첫 저장 때 그 슬롯이 prev로 옮겨진다", () => {
  const { autosave, timers, storage, ownKey } = make();
  const prevKey = autosave.prevKey;
  assert.equal(prevKey, `${ownKey}.prev`);
  autosave.schedule(projectWithTitle("divider", "옛 프로젝트 v1"));
  timers.advance(800);
  autosave.schedule(projectWithTitle("divider", "옛 프로젝트 마지막 편집")); // 0.8초 안에 교체가 일어난다
  assert.equal(autosave.hasPending(), true);
  autosave.retire();
  assert.equal(autosave.hasPending(), false, "대기 항목은 새 프로젝트 위로 쓰이지 않는다");
  assert.equal(titleIn(storage, ownKey), "옛 프로젝트 마지막 편집", "마지막 편집까지 슬롯에 남는다");
  assert.equal(storage.data.has(prevKey), false, "새 프로젝트가 저장되기 전에는 슬롯을 옮기지 않는다");
  timers.advance(5000);
  assert.equal(titleIn(storage, ownKey), "옛 프로젝트 마지막 편집", "새 프로젝트가 저장되지 않으면 그대로");

  autosave.schedule(projectWithTitle("rc-charge", "새 프로젝트"));
  timers.advance(800);
  assert.equal(titleIn(storage, ownKey), "새 프로젝트");
  assert.equal(titleIn(storage, prevKey), "옛 프로젝트 마지막 편집", "이전 프로젝트는 prev에 남는다");
  autosave.schedule(projectWithTitle("rc-charge", "새 프로젝트 편집"));
  timers.advance(800);
  assert.equal(titleIn(storage, prevKey), "옛 프로젝트 마지막 편집", "같은 프로젝트의 다음 편집은 prev를 건드리지 않는다");
});

test("prev는 탭마다 정확히 하나: 두 번째 교체는 prev를 갈아 끼우고, 5개 한도에는 둘 다 센다", () => {
  const storage = fakeStorage();
  const timers = fakeTimers();
  const { autosave } = make(storage, { timers });
  const prevKey = autosave.prevKey;
  autosave.schedule(projectWithTitle("divider", "A"));
  timers.advance(800);
  autosave.retire();
  autosave.schedule(projectWithTitle("rc-charge", "B"));
  timers.advance(800);
  autosave.retire();
  autosave.schedule(projectWithTitle("rlc", "C"));
  timers.advance(800);
  assert.equal(titleIn(storage, autosave.key), "C");
  assert.equal(titleIn(storage, prevKey), "B", "A는 밀려났고 prev는 하나뿐");
  assert.equal(slotKeys(storage).filter((key) => key.endsWith(".prev")).length, 1);

  // 다른 탭 슬롯 5개를 채우면 오래된 다른 탭부터 지워지고 이 탭의 own/prev는 남는다.
  for (let index = 0; index < 5; index += 1) {
    storage.data.set(`${AUTOSAVE_PREFIX}other-tab-${index}`, JSON.stringify({ v: 2, tabId: `other-tab-${index}`, savedAt: 1 + index, project: serializedOf(projectWithTitle("divider", `다른 탭 ${index}`)) }));
  }
  autosave.schedule(projectWithTitle("rlc", "C2"));
  timers.advance(800);
  const keys = slotKeys(storage);
  assert.equal(keys.length, AUTOSAVE_MAX_SLOTS, "own + prev가 5개 한도에 포함된다");
  assert.ok(keys.includes(autosave.key) && keys.includes(prevKey));
  assert.equal(keys.includes(`${AUTOSAVE_PREFIX}other-tab-0`), false, "가장 오래된 다른 탭이 먼저 지워진다");
});

test("복원 제안은 own·prev·다른 탭 중 가장 최근이면서 불러온 내용과 다른 것을 고른다", () => {
  const storage = fakeStorage();
  const timers = fakeTimers();
  const { autosave } = make(storage, { timers });
  autosave.schedule(projectWithTitle("divider", "옛 작업"));
  timers.advance(800);
  autosave.retire();
  timers.advance(1000);
  autosave.schedule(projectWithTitle("rc-charge", "새 작업"));
  timers.advance(800);
  const own = autosave.loadDetailed({}, { current: projectOf("opamp") });
  assert.equal(own.ok, true);
  assert.equal(own.project.title, "새 작업");
  assert.equal(own.own, true);
  // 화면에 새 작업이 이미 있으면 prev(옛 작업)가 제안된다.
  const current = { ...projectWithTitle("rc-charge", "새 작업"), circuit: own.project.circuit, probes: own.project.probes, subtitle: own.project.subtitle };
  const older = autosave.loadDetailed({}, { current });
  assert.equal(older.ok, true);
  assert.equal(older.project.title, "옛 작업");
  assert.equal(older.prev, true);
  assert.equal(autosave.listSlots().filter((slot) => slot.prev).length, 1);
  // clear는 prev도 지운다.
  autosave.clear();
  assert.equal(slotKeys(storage).length, 0);
});

// ---- 리뷰 수정: prev 회전 실패, 읽을 수 없는 own, 복원 후보 prev 보호 ----

function quotaError() {
  const error = new Error("quota");
  error.name = "QuotaExceededError";
  return error;
}

test("prev 회전이 실패하면(용량 초과) 새 프로젝트 쓰기를 중단하고 옛 프로젝트를 지키며, 대기 항목은 재시도용으로 남는다", () => {
  let failPrev = false;
  const storage = fakeStorage();
  const realSet = storage.setItem;
  storage.setItem = (key, value) => { if (failPrev && key.endsWith(".prev")) throw quotaError(); realSet(key, value); };
  const results = [];
  const timers = fakeTimers();
  const { autosave, ownKey } = make(storage, { timers, onResult: (outcome) => results.push(outcome) });
  autosave.schedule(projectWithTitle("divider", "옛 프로젝트"));
  timers.advance(800);
  autosave.retire();
  failPrev = true;
  autosave.schedule(projectWithTitle("rc-charge", "새 프로젝트"));
  timers.advance(800);
  assert.equal(results.at(-1).state, "quota", "실패가 보고된다(saved가 아니다)");
  assert.equal(results.at(-1).ok, false);
  assert.equal(titleIn(storage, ownKey), "옛 프로젝트", "옛 프로젝트의 유일한 사본이 그대로다");
  assert.equal(storage.data.has(autosave.prevKey), false);
  assert.equal(autosave.hasPending(), true, "새 프로젝트는 대기 상태로 남는다");
  failPrev = false;
  assert.equal(autosave.flush().state, "saved", "공간이 생기면 재시도로 저장된다");
  assert.equal(titleIn(storage, ownKey), "새 프로젝트");
  assert.equal(titleIn(storage, autosave.prevKey), "옛 프로젝트", "재시도에서도 회전이 일어난다(rotatePending 유지)");
  assert.equal(autosave.hasPending(), false);
});

test("읽을 수 없는 own 슬롯은 prev를 덮어쓰지 않는다", () => {
  const storage = fakeStorage();
  const timers = fakeTimers();
  const { autosave, ownKey } = make(storage, { timers });
  storage.data.set(autosave.prevKey, JSON.stringify({ v: 2, tabId: "x", savedAt: 5, project: serializedOf(projectWithTitle("divider", "좋은 prev")) }));
  storage.data.set(ownKey, "{깨진 json");
  autosave.retire();
  autosave.schedule(projectWithTitle("rc-charge", "새 프로젝트"));
  timers.advance(800);
  assert.equal(autosave.getStatus().state, "saved");
  assert.equal(titleIn(storage, autosave.prevKey), "좋은 prev", "좋은 prev가 깨진 own으로 바뀌지 않는다");
  assert.equal(titleIn(storage, ownKey), "새 프로젝트");
});

test("복원 후보가 prev 자체이면 retire({keepPrev})가 그 슬롯을 보호하고, 보호가 풀리면 다시 회전한다", () => {
  const storage = fakeStorage();
  const timers = fakeTimers();
  const { autosave, ownKey } = make(storage, { timers });
  autosave.schedule(projectWithTitle("divider", "A"));
  timers.advance(800);
  autosave.retire();
  autosave.schedule(projectWithTitle("rc-charge", "B"));
  timers.advance(800); // own=B, prev=A
  // 새 로드: B와 같은 내용이 화면에 있으므로 제안 후보는 prev(A)다.
  const offer = autosave.loadDetailed({}, { current: { ...projectWithTitle("rc-charge", "B"), circuit: JSON.parse(storage.data.get(ownKey)).project.circuit, probes: JSON.parse(storage.data.get(ownKey)).project.probes, subtitle: JSON.parse(storage.data.get(ownKey)).project.subtitle } });
  assert.equal(offer.prev, true);
  autosave.retire({ keepPrev: offer.prev });
  autosave.schedule(projectWithTitle("rc-charge", "B 편집"));
  timers.advance(800);
  assert.equal(titleIn(storage, autosave.prevKey), "A", "제안 중인 prev는 첫 저장에도 그대로");
  assert.equal(titleIn(storage, ownKey), "B 편집");
  autosave.releaseProtection(); // 무시
  autosave.retire();
  autosave.schedule(projectWithTitle("rlc", "C"));
  timers.advance(800);
  assert.equal(titleIn(storage, autosave.prevKey), "B 편집", "보호가 풀린 뒤의 교체는 평소처럼 prev를 갈아 끼운다");
});
