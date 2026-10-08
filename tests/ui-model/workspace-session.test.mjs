// Tab memory of the study workspaces (src/workspace-session.js) with a fake window: when it restores, when it starts fresh,
// debounced saves, flush on page hide, and blocked storage.
import test from "node:test";
import assert from "node:assert/strict";
import { createWorkspaceSession, SESSION_PREFIX, storedNumber, storedObject } from "../../src/workspace-session.js";

function fakeWindow({ type = "navigate", referrer = "", items = {}, blocked = false } = {}) {
  const store = new Map(Object.entries(items)), timers = new Map(), listeners = new Map();
  let next = 1;
  const sessionStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)); },
    removeItem: (key) => { store.delete(key); },
  };
  const win = {
    performance: { getEntriesByType: () => [{ type }] },
    location: { origin: "https://example.test", pathname: "/app/" },
    document: { referrer, hidden: false, addEventListener() {}, removeEventListener() {} },
    setTimeout: (fn) => { const id = next++; timers.set(id, fn); return id; },
    clearTimeout: (id) => timers.delete(id),
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type) => listeners.delete(type),
    runTimers: () => { for (const [id, fn] of [...timers]) { timers.delete(id); fn(); } },
    fire: (type) => listeners.get(type)?.(),
    store,
  };
  Object.defineProperty(win, "sessionStorage", { get() { if (blocked) throw new Error("blocked"); return sessionStorage; } });
  return win;
}

test("a reload and a history step restore; a fresh visit drops the old memory", () => {
  const saved = JSON.stringify({ version: 1, lesson: "fourier" });
  for (const type of ["reload", "back_forward"]) {
    const win = fakeWindow({ type, items: { [SESSION_PREFIX + `t-${type}`]: saved } });
    assert.deepEqual(createWorkspaceSession(`t-${type}`, () => ({}), { win }).initial, { version: 1, lesson: "fourier" }, type);
  }
  const fresh = fakeWindow({ items: { [SESSION_PREFIX + "t-fresh"]: saved } });
  assert.equal(createWorkspaceSession("t-fresh", () => ({}), { win: fresh }).initial, null);
  assert.equal(fresh.store.has(SESSION_PREFIX + "t-fresh"), false, "the stale memory is removed");
});

test("a link inside the app and a second build in the same page restore; another site's link does not", () => {
  const saved = JSON.stringify({ version: 1 });
  const inside = fakeWindow({ referrer: "https://example.test/app/?workspace=em", items: { [SESSION_PREFIX + "t-link"]: saved } });
  assert.deepEqual(createWorkspaceSession("t-link", () => ({}), { win: inside }).initial, { version: 1 });
  const outside = fakeWindow({ referrer: "https://elsewhere.test/app/", items: { [SESSION_PREFIX + "t-out"]: saved } });
  assert.equal(createWorkspaceSession("t-out", () => ({}), { win: outside }).initial, null);
  const page = fakeWindow();
  const first = createWorkspaceSession("t-remount", () => ({ version: 1, n: 3 }), { win: page });
  assert.equal(first.initial, null);
  first.dispose(); // writes now
  assert.deepEqual(createWorkspaceSession("t-remount", () => ({}), { win: page }).initial, { version: 1, n: 3 });
});

test("saves are coalesced, written on page hide, and unreadable data or blocked storage never throw", () => {
  let count = 0;
  const win = fakeWindow();
  const session = createWorkspaceSession("t-save", () => ({ count: ++count }), { win });
  session.save(); session.save(); session.save();
  assert.equal(win.store.has(SESSION_PREFIX + "t-save"), false, "nothing written yet");
  win.runTimers();
  assert.equal(JSON.parse(win.store.get(SESSION_PREFIX + "t-save")).count, 1, "one snapshot for three saves");
  session.save();
  win.fire("pagehide");
  assert.equal(JSON.parse(win.store.get(SESSION_PREFIX + "t-save")).count, 2, "page hide writes the pending save");
  const broken = fakeWindow({ type: "reload", items: { [SESSION_PREFIX + "t-broken"]: "{not json" } });
  assert.equal(createWorkspaceSession("t-broken", () => ({}), { win: broken }).initial, null);
  const array = fakeWindow({ type: "reload", items: { [SESSION_PREFIX + "t-array"]: "[1,2]" } });
  assert.equal(createWorkspaceSession("t-array", () => ({}), { win: array }).initial, null);
  const blocked = fakeWindow({ type: "reload", blocked: true });
  const quiet = createWorkspaceSession("t-blocked", () => ({ a: 1 }), { win: blocked });
  assert.equal(quiet.initial, null);
  assert.doesNotThrow(() => { quiet.save(); blocked.runTimers(); quiet.flush(); });
  const failing = createWorkspaceSession("t-throw", () => { throw new Error("no"); }, { win });
  assert.doesNotThrow(() => failing.flush());
});

test("stored value helpers", () => {
  assert.equal(storedNumber(2.5, 0), 2.5);
  assert.equal(storedNumber("2.5", 7), 7);
  assert.equal(storedNumber(Infinity, 7), 7);
  assert.deepEqual(storedObject({ a: 1 }), { a: 1 });
  assert.equal(storedObject([1]), null);
  assert.equal(storedObject(null), null);
});
