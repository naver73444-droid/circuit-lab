import test from "node:test";
import assert from "node:assert/strict";
import { createBackNavigation } from "../../src/back-navigation.js";

/** A same-document history: entries of { state, url }; back/forward fire popstate in a later task, like a browser. */
function fakeWindow(url = "http://lab.test/") {
  const listeners = {};
  const entries = [{ state: null, url }];
  let index = 0;
  const win = {
    location: { get href() { return entries[index].url; }, get search() { return new URL(entries[index].url).search; } },
    history: {
      get state() { return entries[index].state; },
      get length() { return entries.length; },
      pushState(state, _title, next) { entries.splice(index + 1); entries.push({ state, url: new URL(next, entries[index].url).href }); index += 1; },
      replaceState(state, _title, next) { entries[index] = { state, url: new URL(next, entries[index].url).href }; },
      back() { setTimeout(() => go(-1), 0); },
      forward() { setTimeout(() => go(1), 0); },
    },
    addEventListener(type, fn) { (listeners[type] ??= []).push(fn); },
  };
  function go(delta) {
    const next = index + delta;
    if (next < 0) { win.left = true; return; }
    if (next >= entries.length) return;
    index = next;
    for (const fn of listeners.popstate ?? []) fn({ state: entries[index].state });
  }
  return { win, entries, at: () => index };
}
const tick = () => new Promise((done) => setTimeout(done, 5));

function setup({ phone = true } = {}) {
  const { win, entries, at } = fakeWindow();
  const docListeners = {};
  const doc = { addEventListener: (type, fn) => { (docListeners[type] ??= []).push(fn); } };
  let active = "circuit";
  const workspaces = {
    active: () => active,
    activate(name) { active = name; for (const fn of docListeners.workspacechange ?? []) fn({ detail: { active: name } }); },
  };
  const sheet = { open: false, isOpen() { return active === "circuit" && this.open; }, close() { this.open = false; nav.overlaysChanged(); } };
  const nav = createBackNavigation({ workspaces, overlays: [sheet], phone: { matches: phone, addEventListener() {} }, win, doc });
  return { win, entries, at, workspaces, sheet, nav, get active() { return active; } };
}

test("each workspace switch is one step back; the first entry is the only way out", async () => {
  const app = setup();
  app.workspaces.activate("em");
  app.workspaces.activate("signals");
  assert.equal(app.entries.length, 3);
  assert.match(app.win.location.href, /\?workspace=signals$/);
  app.win.history.back(); await tick();
  assert.equal(app.active, "em");
  app.win.history.back(); await tick();
  assert.equal(app.active, "circuit");
  assert.doesNotMatch(app.win.location.href, /workspace=/, "the circuit editor has no workspace parameter");
  assert.equal(app.win.left, undefined);
  app.win.history.back(); await tick();
  assert.equal(app.win.left, true, "only the last back leaves");
});

test("phone: an open overlay is one step on top; back closes it and stays in the workspace", async () => {
  const app = setup();
  app.sheet.open = true; app.nav.overlaysChanged();
  assert.equal(app.entries.length, 2);
  app.win.history.back(); await tick();
  assert.equal(app.sheet.open, false, "back closed the sheet");
  assert.equal(app.at(), 0);
  assert.equal(app.active, "circuit");
});

test("phone: an overlay closed by its own button leaves a spent step that the next back press skips", async () => {
  const app = setup();
  app.workspaces.activate("em");
  app.workspaces.activate("circuit");
  app.sheet.open = true; app.nav.overlaysChanged();
  app.sheet.close(); await tick();
  assert.equal(app.at(), 3, "no traversal of our own while the student is still tapping");
  assert.deepEqual([app.nav.inspect().overlayStep, app.nav.inspect().spent], [false, true]);
  app.win.history.back(); await tick(); await tick();
  assert.equal(app.active, "em", "one back press skips the spent step and is a real step");
  assert.equal(app.at(), 1);
});

test("a workspace switch while an overlay is open replaces the overlay step", async () => {
  const app = setup();
  app.sheet.open = true; app.nav.overlaysChanged();
  app.workspaces.activate("em"); await tick();
  assert.equal(app.entries.length, 2, "base + em, no stale overlay step");
  app.win.history.back(); await tick();
  assert.equal(app.active, "circuit");
});

test("desktop: overlays add no steps", async () => {
  const app = setup({ phone: false });
  app.sheet.open = true; app.nav.overlaysChanged();
  assert.equal(app.entries.length, 1);
});

test("phone: a spent step is reused when an overlay opens again, and only the last back press leaves", async () => {
  const app = setup();
  app.sheet.open = true; app.nav.overlaysChanged();
  app.sheet.close();
  app.sheet.open = true; app.nav.overlaysChanged();
  assert.equal(app.entries.length, 2, "one overlay step, reused");
  app.win.history.back(); await tick();
  assert.equal(app.sheet.open, false, "back closed it");
  assert.equal(app.win.left, undefined);
  app.sheet.open = true; app.nav.overlaysChanged();
  app.sheet.close();
  app.win.history.back(); await tick(); await tick();
  assert.equal(app.win.left, true, "a spent step at the start: the back press leaves the app");
});
