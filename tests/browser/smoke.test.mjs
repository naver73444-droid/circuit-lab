// End-to-end smoke: real server + headless Edge driven over the Chrome DevTools Protocol.
// Node only (global fetch/WebSocket, Node >= 22), no npm packages. Run with `npm run test:browser`.
//
// It starts `node server.mjs 0`, launches Edge with a throw-away profile, and walks the main user paths with real
// mouse/keyboard input. Any console error, uncaught exception or failed request fails the scenario that caused it
// (the problem buffer is cleared before and asserted after every test). If Edge cannot be found the test FAILS
// (set EDGE_PATH to override); it is never skipped. Set CIRCUIT_LAB_ROOT to run against another checkout.
import { describe, test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  L, ctx, ev, until, waitFor, settle, navigate, state, component, pin, partSel, click, clickAt, clickPart, partPoint, dblclick, dragPart, press, typeInto, select, center,
  MOD, moveTo, wheelAt, plotPoint, bgPoint, pinTip, sleep, openTab, dragBetween, touchDrag,
  runAnalysis, nodeValue, request, startServer, startBrowser, stopAll, leftoverProcessIds, isAlive, assertNoProblems, resetProblems,
} from "./harness.mjs";

const VALUE_INPUT = '#inspector-content [data-prop="value"]';
const STEP_INPUT = '#analysis-settings [data-setting="step"]';
const discardVisible = `(() => { const b = document.getElementById("discard-drafts-button"); const notice = document.getElementById("draft-notice"); return !notice.classList.contains("hidden") && b.offsetParent !== null; })()`;
const draftsOf = async () => (await state()).drafts.map(({ kind, id, property, value }) => ({ kind, id, property, value }));
const valueOf = async (id) => (await component(id)).props.value;
const inlineEditorHidden = () => ev(`document.getElementById("inline-value-editor").classList.contains("hidden")`);

async function selectPart(id) {
  await clickPart(id);
  assert.equal((await state()).selected?.id, id, `${id} should be selected`);
}
/** Keep background re-runs from re-rendering the canvas in the middle of a long scripted gesture loop. */
async function autoUpdateOff() {
  if ((await state()).autoUpdate) await click("#auto-update");
  assert.equal((await state()).autoUpdate, false);
}
async function openSettings() {
  if (!(await ev(`document.getElementById("advanced-analysis").open`))) await click("#advanced-analysis summary");
}

// ---- helpers for the feature scenarios (shortcuts, wheel, hover, measurements, cursors, sweep, drag, clicks) ----------------------
const GRID = 20; // src/circuit-geometry.js GRID_SIZE: one arrow-key step
const SI_PREFIX = { f: 1e-15, p: 1e-12, n: 1e-9, "µ": 1e-6, u: 1e-6, m: 1e-3, "": 1, k: 1e3, M: 1e6, G: 1e9 };
/** "1.414 V", "−1.036 fV", "159.7 Hz", "1 kHz", "2 ms", "1k" -> number (a sign written as U+2212 is accepted). */
function parseEng(text) {
  const match = /^\s*([-+]?\d+(?:\.\d+)?(?:e[-+]?\d+)?)\s*([fpnµumkMG]?)[A-Za-zΩ°/]*\s*$/.exec(String(text).replace(/−/g, "-"));
  assert.ok(match, `cannot read a number from "${text}"`);
  return Number(match[1]) * SI_PREFIX[match[2]];
}
function near(actual, expected, relative, what, absolute = 0) {
  assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= Math.max(absolute, Math.abs(expected) * relative), `${what}: ${actual} is not within ${relative * 100}% of ${expected}`);
}
const measureRows = () => ev(`[...document.querySelectorAll("#measure-body .measure-row")].map((row) => ({ trace: row.querySelector(".measure-trace").textContent.trim(), cells: Object.fromEntries([...row.querySelectorAll(".measure-cell")].map((cell) => [cell.querySelector("small").textContent, cell.lastChild.textContent.trim()])) }))`);
const deltaItems = async () => Object.fromEntries((await ev(`[...document.querySelectorAll("#cursor-readout .delta-item")].map((item) => item.textContent.trim())`)).map((text) => [text.split(/\s/)[0], text.replace(/^\S+\s*/, "")]));
/** Hold every worker request after the first `allow` ones until __gate.release() runs, so a sweep can be caught between two points. */
const installWorkerGate = (allow = 0) => ev(`(() => {
  const original = Worker.prototype.postMessage; window.__gate = { passed: 0, allow: ${allow}, queued: [] };
  Worker.prototype.postMessage = function (...args) { if (window.__gate.passed >= window.__gate.allow) { window.__gate.queued.push(() => original.apply(this, args)); return; } window.__gate.passed += 1; return original.apply(this, args); };
  window.__gate.release = () => { window.__gate.allow = Infinity; window.__gate.queued.splice(0).forEach((send) => send()); };
})()`);
async function openSweepForm(from, to, count) {
  await selectPart("R1");
  await click("#inspector-tab");
  if (!(await ev(`document.getElementById("sweep-box").open`))) await click("#sweep-box summary");
  await typeInto("#sweep-from", from);
  await typeInto("#sweep-to", to);
  await typeInto("#sweep-count", count);
}
const sweepOf = () => ev(`${L}.getSweep()`);

const AUTOSAVE_PREFIX = "circuit-lab.autosave.v2.";
/** Every autosave slot in localStorage, keyed by tab id. */
const autosaveSlots = () => ev(`Object.fromEntries(Object.keys(localStorage).filter((key) => key.startsWith(${JSON.stringify(AUTOSAVE_PREFIX)})).map((key) => [key.slice(${AUTOSAVE_PREFIX.length}), JSON.parse(localStorage.getItem(key))]))`);
const tabIdOf = () => ev(`sessionStorage.getItem("circuit-lab.tab-id")`);
const noticeTexts = () => ev(`[...document.querySelectorAll("#canvas-notices .canvas-notice")].map((notice) => notice.querySelector(".canvas-notice-text").textContent)`);
/** Same URL, same tab (sessionStorage and therefore the tab id survive, like a user pressing reload). */
const reloadPage = async () => navigate(await ev(`location.pathname + location.search + location.hash`));
/** Start from an empty browser profile state: no autosave slots, no tab id. */
async function clearBrowserStorage() { await navigate("/"); await ev(`localStorage.clear(); sessionStorage.clear()`); }
async function clickNoticeButton(label) {
  assert.equal(await ev(`(() => { const button = [...document.querySelectorAll("#canvas-notices button")].find((item) => item.textContent.trim() === ${JSON.stringify(label)}); if (!button) return false; button.dataset.smoke = "notice-action"; return true; })()`), true, `a "${label}" button is in the notice`);
  await click('[data-smoke="notice-action"]');
}

describe("browser smoke", { timeout: 600000 }, () => {
  let startedPids = [];
  before(async () => { await startServer(); await startBrowser(); });
  beforeEach(() => resetProblems());
  // Asserted per test, so a failure is attributed to the scenario that produced it and the last scenario is checked too.
  afterEach(async () => { await assertNoProblems("console/network"); });
  after(async () => {
    startedPids = [ctx.edge?.pid, ctx.server?.pid].filter(Boolean);
    const stopped = await stopAll();
    for (const pid of new Set([...startedPids, ...stopped])) assert.equal(isAlive(pid), false, `process ${pid} should have been stopped`);
    assert.deepEqual(leftoverProcessIds(), [], "no process may still carry the throw-away Edge profile");
  });

  test("server serves only the app, with security headers", async () => {
    const { port } = ctx;
    const index = await request(port);
    assert.equal(index.status, 200);
    assert.equal(index.headers["x-content-type-options"], "nosniff");
    assert.match(index.headers["content-security-policy"], /frame-ancestors 'none'/);
    assert.equal((await request(port, { path: "/src/app.js" })).status, 200);
    assert.equal((await request(port, { method: "HEAD" })).body.length, 0);
    assert.equal((await request(port, { method: "POST" })).status, 405);
    for (const path of ["/package.json", "/README.md", "/tests/fixtures/mixed-probe-units.json", "/%2e%2e/server.mjs", "/%zz"]) assert.equal((await request(port, { path })).status, 404, path);
    assert.equal((await request(port, { headers: { Host: "unrelated.example" } })).status, 403, "non-loopback Host is refused");
  });

  test("default editor loads without console errors", async () => {
    await navigate("/");
    const loaded = await state();
    assert.ok(Array.isArray(loaded.circuit.components));
    assert.equal(await ev(`document.documentElement.scrollWidth <= innerWidth + 1`), true, "no horizontal page overflow");
    assert.equal(await ev(`[${L}.getEMState(), ${L}.getCircuitCourseState(), ${L}.getSignalsCourseState()].every((value) => value === null)`), true, "heavy workspaces are not loaded yet");
  });

  test("transient: RLC example runs and draws a probe trace that matches the closed form", async () => {
    await navigate("/?example=rlc");
    assert.equal((await state()).circuit.components.length, 5);
    await runAnalysis("transient");
    const { result, probes } = await state();
    assert.ok(probes.length >= 1, "the example ships a probe");
    // Series RLC step: v_C(t) = 1 - e^{-at}(cos wd t + (a/wd) sin wd t), a = R/2L, wd = sqrt(1/LC - a^2).
    const a = 100 / (2 * 0.01), wd = Math.sqrt(1 / (0.01 * 1e-6) - a * a);
    const index = result.xValues.reduce((best, value, i) => (Math.abs(value - 1e-4) < Math.abs(result.xValues[best] - 1e-4) ? i : best), 0);
    const t = result.xValues[index];
    const expected = 1 - Math.exp(-a * t) * (Math.cos(wd * t) + (a / wd) * Math.sin(wd * t));
    assert.ok(Math.abs(nodeValue(result, index, "C1", 0) - expected) < 0.01, `v_C(${t}) = ${nodeValue(result, index, "C1", 0)} vs ${expected}`);
    await until(`document.querySelectorAll("#wave-plot path.plot-line").length > 0`, "a waveform path");
    assert.equal(await ev(`!document.getElementById("csv-button").disabled`), true, "CSV export is enabled after a result");
  });

  test("ac: sweep succeeds and the result pane shows phasor vectors", async () => {
    await navigate("/?example=rc-lowpass");
    await runAnalysis("ac");
    const { result, settings } = await state();
    assert.equal(result.analysis, "ac");
    assert.ok(result.points.length > 10);
    await click("#results-tab");
    await until(`!document.getElementById("phasor-panel").hidden`, "the phasor panel");
    await until(`document.getElementById("phasor-validity").dataset.status === "ready"`, "phasor validity ready");
    await until(`document.querySelectorAll("#voltage-phasor-plot .phasor-arrow").length > 0`, "phasor arrows");
    // |V(C1)| = 1 / sqrt(1 + (2 pi f R C)^2) for the 1 V, 1 kOhm, 1 uF example, at the single phasor frequency.
    const { phasorResult } = await state();
    assert.equal(phasorResult.points.length, 1);
    const frequency = phasorResult.frequency;
    const output = nodeValue(phasorResult, 0, "C1", 0);
    const expected = 1 / Math.sqrt(1 + (2 * Math.PI * frequency * 1e3 * 1e-6) ** 2);
    assert.ok(Math.abs(Math.hypot(output.re, output.im) - expected) < 1e-9, `|V(C1)| at ${frequency} Hz`);
    assert.ok(Math.abs(Math.atan2(output.im, output.re) + Math.atan(2 * Math.PI * frequency * 1e-3)) < 1e-9, "phase lag");
    assert.ok(settings.analysis === "ac");
  });

  test("ac: a zero-amplitude source reads as 'phase undefined' (미정), not as 0 degrees", async () => {
    await navigate("/?example=rc-lowpass");
    await selectPart("V1");
    await click("#inspector-tab");
    await typeInto('#inspector-content [data-prop="acMagnitude"]', "0");
    await press("Enter", "Enter", 13);
    await waitFor(async () => (await component("V1")).props.acMagnitude === "0", "the 0 V amplitude to commit");
    await runAnalysis("ac");
    await click("#results-tab");
    await until(`document.getElementById("phasor-validity").dataset.status === "ready"`, "phasor validity ready");
    const text = await ev(`document.getElementById("voltage-phasor-values").innerText`);
    assert.match(text, /미정/, `zero-magnitude phasors must say the phase is undefined, got: ${text}`);
    assert.doesNotMatch(text, /∠\s*0\s*°/, "a zero phasor must not claim a 0 degree phase");
  });

  test("port: divider Thevenin equivalent is 5 V behind 500 ohm", async () => {
    await navigate("/?example=divider");
    await click("#results-tab");
    await click('[data-result-view="port"]');
    await until(`!document.getElementById("port-panel").hidden`, "the port panel");
    await click("#port-p-button");
    await click(pin("R2", 0));
    await click("#port-n-button");
    await click(pin("G1", 0));
    await until(`!document.getElementById("port-run-button").disabled`, "port run to be enabled");
    await click("#port-run-button");
    await until(`document.getElementById("port-result").innerText.includes("Vth")`, "the port result text");
    const { port } = await state();
    const equivalent = port.result.equivalent;
    assert.ok(Math.abs(equivalent.vth.value - 5) < 1e-9, `Vth ${equivalent.vth.value}`);
    assert.ok(Math.abs(equivalent.rth.value - 500) < 1e-6, `Rth ${equivalent.rth.value}`);
  });

  test("editing: delete, undo, redo and keyboard shortcuts", async () => {
    await navigate("/?example=divider");
    await click("[data-tool=\"select\"]");
    await selectPart("R1");
    await click("#delete-button");
    assert.equal((await state()).circuit.components.some((c) => c.id === "R1"), false);
    await click("#undo-button");
    assert.equal((await state()).circuit.components.some((c) => c.id === "R1"), true, "undo restores the part");
    await click("#redo-button");
    assert.equal((await state()).circuit.components.some((c) => c.id === "R1"), false, "redo deletes it again");
    await press("z", "KeyZ", 90, 2);
    assert.equal((await state()).circuit.components.some((c) => c.id === "R1"), true, "Ctrl+Z undoes");
    await press("y", "KeyY", 89, 2);
    assert.equal((await state()).circuit.components.some((c) => c.id === "R1"), false, "Ctrl+Y redoes");
    await press("z", "KeyZ", 90, 2);
    await selectPart("R2");
    const before = (await component("R2")).rotation;
    await press("r", "KeyR", 82);
    assert.notEqual((await component("R2")).rotation, before, "R rotates the selection");

    // The Delete key removes the selection, and one undo brings it back.
    const count = (await state()).circuit.components.length;
    await selectPart("R2");
    await press("Delete", "Delete", 46);
    assert.equal((await state()).circuit.components.some((c) => c.id === "R2"), false, "Delete removes the selected part");
    assert.equal((await state()).circuit.components.length, count - 1);
    await press("z", "KeyZ", 90, 2);
    assert.equal((await state()).circuit.components.length, count, "undo restores the deleted part");

    // Ctrl+D duplicates the selection (a new id, same type and value) as one undoable step.
    await selectPart("R2");
    const depth = (await state()).historyDepth;
    await press("d", "KeyD", 68, 2);
    const duplicated = await state();
    assert.equal(duplicated.circuit.components.length, count + 1, "Ctrl+D adds one part");
    assert.equal(duplicated.historyDepth, depth + 1, "the duplicate is one undo step");
    const copy = duplicated.circuit.components.find((c) => !["V1", "R1", "R2", "G1"].includes(c.id));
    assert.equal(copy.type, "R");
    assert.equal(copy.props.value, "1k");
    await press("z", "KeyZ", 90, 2);
    assert.equal((await state()).circuit.components.length, count, "undo removes the duplicate");
  });

  test("history cap (edits): exactly 100 undo steps, and undo/redo walk the whole window", async () => {
    await navigate("/?example=divider");
    await selectPart("R2");
    const r0 = (await component("R2")).rotation ?? 0;
    // 110 rotations dispatched as key events inside the page (the real key press is covered above).
    await ev(`(() => { for (let n = 0; n < 110; n += 1) window.dispatchEvent(new KeyboardEvent("keydown", { key: "r", code: "KeyR", bubbles: true })); })()`);
    const after110 = await state();
    assert.equal(after110.historyDepth, 100, "history keeps exactly the last 100 steps");
    assert.equal((await component("R2")).rotation, (r0 + 110 * 90) % 360);
    // Drain the undo stack: exactly 100 steps are available, the oldest 10 were dropped.
    await ev(`(() => { const b = document.getElementById("undo-button"); for (let n = 0; n < 100; n += 1) b.click(); })()`);
    let drained = await state();
    assert.equal(drained.historyDepth, 0, "100 undos empty the stack");
    assert.equal((await component("R2")).rotation, (r0 + 10 * 90) % 360, "the 10 oldest steps are gone, so undo stops 10 rotations in");
    await ev(`document.getElementById("undo-button").click()`);
    assert.equal((await state()).historyDepth, 0, "undo past the cap is a no-op");
    // Redo restores all 100 (the future stack is capped at the same size), and the history is exactly 100 again.
    await ev(`(() => { const b = document.getElementById("redo-button"); for (let n = 0; n < 100; n += 1) b.click(); })()`);
    const redone = await state();
    assert.equal(redone.historyDepth, 100, "100 redos refill the history to exactly 100");
    assert.deepEqual(redone.circuit, after110.circuit, "redo returns to the exact pre-undo circuit");
    await ev(`document.getElementById("redo-button").click()`);
    assert.equal((await state()).historyDepth, 100, "redo past the end is a no-op");
    // Undo/redo cycles at the cap never grow the stack.
    await ev(`(() => { const u = document.getElementById("undo-button"), r = document.getElementById("redo-button"); for (let n = 0; n < 30; n += 1) { u.click(); r.click(); } })()`);
    assert.equal((await state()).historyDepth, 100, "undo/redo cycles keep the depth at 100");
    // A fresh edit after undoing drops the redo branch.
    await ev(`document.getElementById("undo-button").click()`);
    await press("r", "KeyR", 82);
    await ev(`document.getElementById("redo-button").click()`);
    assert.equal((await state()).historyDepth, 100, "editing after undo clears the redo branch and stays capped");
  });

  test("history cap (probes): adding and removing probes pushes undo steps, capped at exactly 100", async () => {
    await navigate("/?example=divider");
    await autoUpdateOff();
    const baseline = (await state()).probes.length;
    const baseDepth = (await state()).historyDepth;
    await click('[data-tool="voltage-probe"]');
    await click("#results-tab");
    let expected = 0;
    for (let cycle = 0; cycle < 52; cycle += 1) {
      await click(pin("R1", 0));
      expected += 1;
      assert.equal((await state()).probes.length, baseline + 1, `cycle ${cycle}: the probe was added`);
      await click(`#probe-list [data-remove-probe="V:R1:0"]`);
      expected += 1;
      assert.equal((await state()).probes.length, baseline, `cycle ${cycle}: the probe was removed`);
      assert.equal((await state()).historyDepth, Math.min(100, baseDepth + expected), `cycle ${cycle}: probe edit steps are recorded`);
    }
    assert.equal(expected, 104);
    assert.equal((await state()).historyDepth, 100, "104 probe edits leave exactly 100 steps");
  });

  test("history cap (drag): 105 real component drags leave exactly 100 steps, and undo reverts a drag", async () => {
    await navigate("/?example=divider");
    await autoUpdateOff();
    await click('[data-tool="select"]');
    const start = await component("R2");
    const baseDepth = (await state()).historyDepth;
    let lostGestures = 0;
    for (let n = 0; n < 105; n += 1) {
      const dx = n % 2 === 0 ? 40 : -40;
      const wantedX = (await component("R2")).x + dx;
      // Occasionally the browser drops the pointer capture right after a synthetic press (seen about once per 100 drags,
      // never with a human-speed gesture); a dropped gesture commits nothing, so it is repeated and counted.
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await dragPart("R2", dx, 0);
        if ((await component("R2")).x === wantedX) break;
        lostGestures += 1;
      }
      const depth = (await state()).historyDepth;
      assert.equal(depth, Math.min(100, baseDepth + n + 1), `drag ${n}: one undo step per committed drag`);
    }
    assert.ok(lostGestures <= 5, `too many dropped drag gestures: ${lostGestures}`);
    const moved = await component("R2");
    assert.equal(moved.x, start.x + 40, "105 alternating drags end 40 px right of the start");
    assert.equal((await state()).historyDepth, 100);
    await click("#undo-button");
    const undone = await component("R2");
    assert.equal(undone.x, start.x, "undo reverts exactly the last drag");
    assert.equal((await state()).historyDepth, 99);
  });

  test("drafts: discard drops a VALID inspector draft without committing it", async () => {
    await navigate("/?example=divider");
    await selectPart("R2");
    await click("#inspector-tab");
    const depth = (await state()).historyDepth;
    await typeInto(VALUE_INPUT, "2k");
    assert.deepEqual(await draftsOf(), [{ kind: "prop", id: "R2", property: "value", value: "2k" }], "typing registers one draft");
    assert.equal(await valueOf("R2"), "1k", "typing alone does not commit");
    await until(discardVisible, "the discard button");
    // Real mouse click: its pointerdown must keep focus in the field, otherwise the blur would commit "2k" first.
    await click("#discard-drafts-button");
    await waitFor(async () => (await draftsOf()).length === 0, "the draft to be dropped");
    const after = await state();
    assert.equal(after.circuit.components.find((c) => c.id === "R2").props.value, "1k", "discard must not commit the valid draft");
    assert.equal(after.historyDepth, depth, "discard must not add an undo entry");
    assert.equal(await ev(`document.querySelector(${JSON.stringify(VALUE_INPUT)}).value`), "1k", "the field shows the committed value again");
    assert.equal(await ev(`document.getElementById("draft-notice").classList.contains("hidden")`), true, "the draft notice goes away");
    await settle(); await settle();
    const later = await state();
    assert.equal(later.historyDepth, depth, "nothing commits later either");
    assert.equal(later.circuit.components.find((c) => c.id === "R2").props.value, "1k");
  });

  test("drafts: Tab commits a valid draft and focus stays in the inspector", async () => {
    await navigate("/?example=divider");
    await selectPart("R2");
    await click("#inspector-tab");
    const depth = (await state()).historyDepth;
    await typeInto('#inspector-content [data-prop="ref"]', "Rb");
    await press("Tab", "Tab", 9);
    await waitFor(async () => (await component("R2")).props.ref === "Rb", "Tab to commit the edited reference");
    assert.equal((await state()).historyDepth, depth + 1, "the commit is one undo step");
    assert.equal(await ev(`Boolean(document.activeElement?.closest("#inspector-content"))`), true, "focus stays inside the inspector after the re-render");
    assert.deepEqual(await draftsOf(), []);
  });

  test("drafts: inline value editor (double-click on the label) - Enter commits, Escape and discard do not", async () => {
    await navigate("/?example=divider");
    await click('[data-tool="select"]');
    const label = '.component[data-id="R2"] .value-label';
    const depth = (await state()).historyDepth;

    await dblclick(label);
    await until(`!document.getElementById("inline-value-editor").classList.contains("hidden")`, "the inline editor");
    await ev(`document.getElementById("inline-value-editor").focus()`);
    await ctx.cdp.send("Input.insertText", { text: "3k" });
    await settle();
    assert.deepEqual(await draftsOf(), [{ kind: "prop", id: "R2", property: "value", value: "3k" }]);
    await press("Escape", "Escape", 27);
    assert.equal(await inlineEditorHidden(), true, "Escape closes the inline editor");
    assert.equal(await valueOf("R2"), "1k", "Escape does not commit");
    assert.deepEqual(await draftsOf(), []);
    assert.equal((await state()).historyDepth, depth, "Escape adds no undo entry");

    // Discard button while the inline editor holds a VALID draft.
    await dblclick(label);
    await until(`!document.getElementById("inline-value-editor").classList.contains("hidden")`, "the inline editor again");
    await ev(`document.getElementById("inline-value-editor").focus()`);
    await ctx.cdp.send("Input.insertText", { text: "2k" });
    await settle();
    assert.deepEqual(await draftsOf(), [{ kind: "prop", id: "R2", property: "value", value: "2k" }]);
    await until(discardVisible, "the discard button");
    await click("#discard-drafts-button");
    await waitFor(async () => (await draftsOf()).length === 0, "the draft to be dropped");
    assert.equal(await inlineEditorHidden(), true, "discard closes the inline editor");
    assert.equal(await valueOf("R2"), "1k", "discard must not commit the inline draft");
    assert.equal((await state()).historyDepth, depth, "discard adds no undo entry");
    // state.inlineEdit is not exposed, so prove it is null by behaviour: a run would otherwise pick the hidden editor's "2k" up.
    await click("#run-button");
    await until(`${L}.getState().runState.status === "success"`, "the run to finish");
    assert.equal(await valueOf("R2"), "1k", "a stale inline edit must not be committed by the next run");
    assert.equal((await state()).historyDepth, depth, "the run adds no undo entry");

    // Enter commits as one undo step.
    await dblclick(label);
    await until(`!document.getElementById("inline-value-editor").classList.contains("hidden")`, "the inline editor a third time");
    await ev(`document.getElementById("inline-value-editor").focus()`);
    await ctx.cdp.send("Input.insertText", { text: "3k" });
    await press("Enter", "Enter", 13);
    await waitFor(async () => (await valueOf("R2")) === "3k", "Enter to commit");
    assert.equal((await state()).historyDepth, depth + 1);
    assert.equal(await inlineEditorHidden(), true);
  });

  test("drafts: a settings draft is discarded together with an invalid inspector draft; nothing else changes", async () => {
    await navigate("/?example=rlc");
    await openSettings();
    const before = await state();
    const stepBefore = before.settings.step;
    // An invalid ("1e") inspector draft survives losing focus; a valid settings draft is typed after it.
    await selectPart("R1");
    await click("#inspector-tab");
    await typeInto(VALUE_INPUT, "1e");
    await typeInto(STEP_INPUT, "2u");
    assert.equal((await draftsOf()).length, 2, "an invalid inspector draft and a settings draft are both pending");
    assert.equal((await state()).settings.step, stepBefore, "the settings draft is not committed while typing");
    await until(discardVisible, "the discard button");
    await click("#discard-drafts-button");
    await waitFor(async () => (await draftsOf()).length === 0, "all drafts to be dropped");
    const after = await state();
    assert.equal(after.settings.step, stepBefore, "discard must not commit the valid settings draft");
    assert.deepEqual(after.settings, before.settings, "no other setting changed");
    assert.deepEqual(after.circuit, before.circuit, "no component changed");
    assert.equal(after.historyDepth, before.historyDepth, "discard adds no undo entry");
    assert.equal(await ev(`document.querySelector(${JSON.stringify(STEP_INPUT)}).value`), stepBefore, "the step field shows the committed value");
    assert.equal(await ev(`document.querySelector(${JSON.stringify(VALUE_INPUT)}).value`), "100", "the value field shows the committed value");

    // Discarding only a settings draft leaves the circuit alone too, and committing the same draft by blur is a real undo step.
    await typeInto(STEP_INPUT, "2u");
    assert.deepEqual(await draftsOf(), [{ kind: "setting", id: null, property: "step", value: "2u" }]);
    await click("#discard-drafts-button");
    await waitFor(async () => (await draftsOf()).length === 0, "the settings draft to be dropped");
    assert.equal((await state()).settings.step, stepBefore);
    assert.equal((await state()).historyDepth, before.historyDepth);

    await typeInto(STEP_INPUT, "2u");
    await press("Tab", "Tab", 9);
    await waitFor(async () => (await state()).settings.step === "2u", "blur to commit a valid settings draft");
    assert.equal((await state()).historyDepth, before.historyDepth + 1, "the committed setting is one undo step");
    assert.deepEqual(await draftsOf(), []);
  });

  test("drafts: pointercancel keeps a pending draft (canvas drag cancelled, touch on the discard button cancelled)", async () => {
    await navigate("/?example=divider");
    await click('[data-tool="select"]');
    await selectPart("R2");
    await click("#inspector-tab");
    const depth = (await state()).historyDepth;
    const startR1 = await component("R1");
    // "1e" is not a number yet, so it stays a draft when a canvas press takes the focus away (a valid draft would be committed there).
    await typeInto(VALUE_INPUT, "1e");
    assert.deepEqual(await draftsOf(), [{ kind: "prop", id: "R2", property: "value", value: "1e" }]);

    // (1) A canvas drag that the browser cancels: the part snaps back, nothing is committed, the draft survives.
    const grab = await partPoint("R1");
    await ctx.cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: grab.x, y: grab.y });
    await ctx.cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: grab.x, y: grab.y, button: "left", buttons: 1, clickCount: 1 });
    await ctx.cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: grab.x + 30, y: grab.y + 20, buttons: 1 });
    await ctx.cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: grab.x + 50, y: grab.y + 40, buttons: 1 });
    await settle();
    const dragging = await state();
    assert.notEqual(dragging.pointerOwnerId, null, "a canvas drag is in progress");
    // pointercancel for the owning pointer, dispatched like the browser does when it takes over the gesture.
    await ev(`document.getElementById("circuit-canvas").dispatchEvent(new PointerEvent("pointercancel", { pointerId: ${JSON.stringify(dragging.pointerOwnerId)}, bubbles: true }))`);
    await settle();
    await ctx.cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: grab.x + 50, y: grab.y + 40, button: "left", buttons: 0, clickCount: 1 });
    await settle();
    const cancelled = await state();
    assert.equal(cancelled.pointerOwnerId, null, "the cancelled gesture released the pointer");
    assert.equal(cancelled.drag, null);
    assert.deepEqual({ x: cancelled.circuit.components.find((c) => c.id === "R1").x, y: cancelled.circuit.components.find((c) => c.id === "R1").y }, { x: startR1.x, y: startR1.y }, "the part is back where it started");
    assert.equal(cancelled.historyDepth, depth, "a cancelled drag adds no undo step");
    assert.equal(cancelled.circuit.components.find((c) => c.id === "R2").props.value, "1k", "the draft was not committed by the cancelled drag");
    assert.deepEqual(await draftsOf(), [{ kind: "prop", id: "R2", property: "value", value: "1e" }], "the draft survives a cancelled pointer gesture");
    await selectPart("R2"); // the press selected R1; back on R2 the field must show the pending text again
    assert.equal(await ev(`document.querySelector(${JSON.stringify(VALUE_INPUT)}).value`), "1e", "the field still shows the typed text");
    assert.deepEqual(await draftsOf(), [{ kind: "prop", id: "R2", property: "value", value: "1e" }]);

    await typeInto(VALUE_INPUT, "2k");
    assert.deepEqual(await draftsOf(), [{ kind: "prop", id: "R2", property: "value", value: "2k" }]);
    // (2) A touch that lands on the discard button and is cancelled (the page scrolls) is not a click: the draft stays.
    await until(discardVisible, "the discard button");
    const button = await center("#discard-drafts-button");
    await ev(`window.__ptr = []; for (const type of ["pointerdown", "pointercancel", "pointerup", "click"]) document.getElementById("discard-drafts-button").addEventListener(type, (e) => window.__ptr.push(type + ":" + e.pointerType));`);
    await ctx.cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: button.x, y: button.y }] });
    await ctx.cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
    await settle();
    const seen = await ev("window.__ptr");
    assert.ok(seen.includes("pointerdown:touch") && seen.includes("pointercancel:touch") && !seen.some((entry) => entry.startsWith("click")), `the touch really produced pointerdown + pointercancel and no click, got ${seen}`);
    assert.deepEqual(await draftsOf(), [{ kind: "prop", id: "R2", property: "value", value: "2k" }], "a cancelled touch on the discard button keeps the draft");
    assert.equal((await state()).circuit.components.find((c) => c.id === "R2").props.value, "1k");
    assert.equal((await state()).historyDepth, depth);
  });

  test("save and reopen round-trip through the file input keeps circuit, settings and probes identical", async () => {
    await navigate("/?example=rlc");
    // Make the project differ from the example in all three parts: a circuit edit, a setting and an extra probe.
    await selectPart("R1");
    await press("r", "KeyR", 82);
    await openSettings();
    await typeInto(STEP_INPUT, "2u");
    await press("Tab", "Tab", 9);
    await waitFor(async () => (await state()).settings.step === "2u", "the step setting to commit");
    await click('[data-tool="current-probe"]');
    await clickPart("L1");
    await click('[data-tool="select"]');
    const before = await state();
    assert.ok(before.probes.some((probe) => probe.kind === "current" && probe.componentId === "L1"), "the added current probe exists");
    await ev(`window.__blobs = []; URL.createObjectURL = (blob) => { window.__blobs.push(blob); return "blob:smoke"; }; window.__downloads = []; HTMLAnchorElement.prototype.click = function () { window.__downloads.push(this.download); };`);
    await click("#save-button");
    await until(`window.__blobs.length === 1 && window.__downloads.length === 1`, "a download");
    assert.match(await ev(`window.__downloads[0]`), /\.json$/);
    const saved = join(ctx.profile, "saved.json");
    writeFileSync(saved, await ev(`window.__blobs[0].text()`));
    await click("#new-button");
    assert.equal((await state()).circuit.components.length, 0);
    const { root } = await ctx.cdp.send("DOM.getDocument");
    const { nodeId } = await ctx.cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector: "#file-input" });
    await ctx.cdp.send("DOM.setFileInputFiles", { files: [saved], nodeId });
    await until(`${L}.getState().circuit.components.length === 5`, "the project to be restored");
    const reopened = await state();
    assert.deepEqual(reopened.circuit, before.circuit, "circuit survives save/reopen unchanged");
    assert.deepEqual(reopened.settings, before.settings, "settings survive save/reopen unchanged");
    assert.deepEqual(reopened.probes, before.probes, "probes survive save/reopen unchanged");
  });

  test("stale result race: a run that finishes after an edit is never adopted as the current result", async () => {
    // The worker is wrapped so its first reply is held back; the test decides when that "late" reply is delivered.
    const holdFirstWorkerReply = `(() => {
      const Original = window.Worker; window.__held = []; let first = true; let handler = null;
      window.Worker = class extends Original {
        constructor(...args) {
          super(...args);
          if (!first) return;
          first = false;
          Object.defineProperty(this, "onmessage", { get: () => handler, set: (fn) => { handler = fn; } });
          this.addEventListener("message", (event) => window.__held.push(event));
        }
      };
      window.__releaseHeld = () => { const events = window.__held.splice(0); window.__lastHeld = events[0]?.data ?? null; for (const event of events) handler?.(event); return events.length; };
    })()`;
    const heldResult = () => ev(`window.__lastHeld?.value?.result ?? null`);

    // Part 1: auto-update off. The edit leaves the app with no result; the late reply must not become one.
    await navigate("/?example=rlc");
    await click("#auto-update");
    assert.equal((await state()).autoUpdate, false);
    await ev(holdFirstWorkerReply);
    await select("#analysis-intent", "transient");
    await click("#run-button");
    await until(`window.__held.length === 1`, "the worker to answer (held back)");
    assert.equal((await state()).runState.status, "running", "the app is still waiting for the held reply");
    await selectPart("R1");
    await click("#inspector-tab");
    await typeInto(VALUE_INPUT, "400");
    await press("Enter", "Enter", 13);
    await waitFor(async () => (await component("R1")).props.value === "400", "the edit to commit");
    let current = await state();
    assert.notEqual(current.runState.status, "success");
    assert.equal(current.result, null);
    assert.equal(await ev(`window.__releaseHeld()`), 1, "the late reply is delivered now");
    await settle(); await settle();
    current = await state();
    assert.equal(current.result, null, "the late result was not adopted");
    assert.notEqual(current.runState.status, "success", "the late run is not reported as a success");
    assert.notEqual(current.runState.status, "running");
    assert.equal(await ev(`document.getElementById("run-button").disabled`), false, "the Run button is usable again");

    // Part 2: a fresh run for the edited circuit succeeds and differs from the (never adopted) late result.
    const late = await heldResult();
    assert.ok(late, "the held reply carried a result");
    await click("#run-button");
    await until(`${L}.getState().runState.status === "success"`, "the new run to succeed");
    const fresh = await state();
    assert.equal(fresh.runState.generation, fresh.generation, "the success belongs to the current generation");
    const probeIndex = fresh.result.xValues.length - 1;
    assert.notEqual(nodeValue(fresh.result, Math.min(probeIndex, 100), "C1", 0), nodeValue(late, Math.min(probeIndex, 100), "C1", 0), "the new result is for R=400, not for the late R=100 run");

    // Part 3: auto-update on. The edit starts a newer run; the older run's late reply must not overwrite it.
    await navigate("/?example=rlc");
    await click("#auto-update"); // off while the hook is installed, so the load itself cannot take the held slot
    await ev(holdFirstWorkerReply);
    await select("#analysis-intent", "transient");
    await click("#run-button");
    await until(`window.__held.length === 1`, "the worker to answer (held back)");
    await click("#auto-update"); // back on
    assert.equal((await state()).autoUpdate, true);
    await selectPart("R1");
    await click("#inspector-tab");
    await typeInto(VALUE_INPUT, "400");
    await press("Enter", "Enter", 13);
    await until(`${L}.getState().runState.status === "success" && ${L}.getState().circuit.components.find((c) => c.id === "R1").props.value === "400"`, "the automatic re-run to succeed");
    const newer = await state();
    const newerSnapshot = JSON.stringify(newer.result);
    assert.equal(await ev(`window.__releaseHeld()`), 1);
    await settle(); await settle();
    const afterLate = await state();
    assert.equal(JSON.stringify(afterLate.result), newerSnapshot, "the late reply did not replace the newer result");
    assert.equal(afterLate.runState.status, "success");
    assert.equal(afterLate.runState.generation, afterLate.generation);

    // Part 4: an edit that does not go through a text draft (a key press rotates the part) takes the other stale path.
    await navigate("/?example=rlc");
    await click("#auto-update");
    await ev(holdFirstWorkerReply);
    await select("#analysis-intent", "transient");
    await click("#run-button");
    await until(`window.__held.length === 1`, "the worker to answer (held back)");
    await selectPart("R1");
    await press("r", "KeyR", 82);
    assert.equal((await component("R1")).rotation, 90, "the rotation was applied while the run was pending");
    assert.equal(await ev(`window.__releaseHeld()`), 1);
    await settle(); await settle();
    const rotated = await state();
    assert.equal(rotated.result, null, "a reply that arrives after a rotation is not adopted");
    assert.notEqual(rotated.runState.status, "success");
    assert.equal(await ev(`document.getElementById("run-button").disabled`), false);
  });

  test("help card opens and closes with Escape; theme toggles", async () => {
    await navigate("/");
    await click("#interaction-help summary");
    assert.equal(await ev(`document.getElementById("interaction-help").open`), true);
    assert.ok(await ev(`document.querySelectorAll(".interaction-help-card li").length`) <= 8, "help stays short");
    await press("Escape", "Escape", 27);
    assert.equal(await ev(`document.getElementById("interaction-help").open`), false);
    await select("#appearance", "light");
    assert.equal(await ev(`document.documentElement.dataset.theme`), "light");
    await select("#appearance", "dark");
  });

  test("EM workspace loads lazily and draws", async () => {
    await navigate("/");
    await click("#em-workspace-tab");
    await until(`${L}.getEMState()?.active === true`, "the EM workspace to activate");
    assert.equal(await ev(`${L}.getWorkspace()`), "em");
    assert.equal(await ev(`!document.getElementById("em-workspace").hidden && document.getElementById("workbench").inert`), true);
    assert.equal(await ev(`document.getElementById("em-canvas").width > 0 && !document.querySelector("#em-workspace .workspace-loading")`), true);
    assert.equal(await ev(`${L}.ensureWorkspace("em").then((controller) => typeof controller.inspect)`), "function");
    // New line sources must expose separated handles in whichever plane is being edited.
    const axesOf = { xy: [0, 1], xz: [0, 2], yz: [1, 2] };
    for (const plane of ["xy", "xz", "yz"]) {
      await select("#em-pg-plane", plane);
      for (const kind of ["finite", "infinite"]) {
        await click(`#em-pg-add-${kind}`);
        const playground = await ev(`${L}.getEMState().playground`);
        const source = playground.sources.find((item) => item.id === playground.selectedId);
        assert.equal(source.type, `${kind}-line`);
        const spread = kind === "finite" ? axesOf[plane].some((axis) => source.start[axis] !== source.end[axis]) : axesOf[plane].some((axis) => source.direction[axis] !== 0);
        assert.ok(spread, `${kind} line added in ${plane} has distinct handles`);
      }
    }
    // The EM course is a second lazy layer: it opens on demand and returns to the playground.
    assert.equal(await ev(`${L}.getEMState().course === null`), true, "EM course is not loaded before it is opened");
    await click("#em-course-open");
    await until(`${L}.getEMState().course?.active === true && Boolean(document.querySelector("#em-course-select"))`, "the EM course");
    await click("#em-course-back");
    await until(`${L}.getEMState().courseActive === false`, "return to the playground");
  });

  test("signals workspace renders the convolution lesson", async () => {
    await navigate("/");
    await click("#signals-workspace-tab");
    await until(`${L}.getSignalsCourseState()?.active === true`, "the signals workspace");
    await until(`document.querySelectorAll("[data-signals-lesson]").length > 0`, "lesson buttons");
    await click('[data-signals-lesson="convolution"]');
    await until(`${L}.getSignalsCourseState().lessonId === "convolution"`, "the convolution lesson");
    const lesson = await ev(`${L}.getSignalsCourseState()`);
    assert.equal(lesson.symbolic.status, "supported");
  });

  test("leaving a workspace deactivates it, and returning reactivates it", async () => {
    await navigate("/");
    // Load EM for real (this page never opened it before), so a null controller cannot make the checks pass vacuously.
    await click("#em-workspace-tab");
    assert.equal(await ev(`${L}.ensureWorkspace("em").then((controller) => typeof controller.inspect)`), "function");
    await until(`${L}.getEMState()?.active === true`, "EM to be active");
    assert.equal(await ev(`${L}.getWorkspace()`), "em");
    assert.equal(await ev(`${L}.getSignalsCourseState()?.active ?? false`), false, "signals is not active while EM is");

    await click("#signals-workspace-tab");
    await until(`${L}.getSignalsCourseState()?.active === true`, "signals to be active");
    assert.equal(await ev(`${L}.getWorkspace()`), "signals");
    const emAfterLeaving = await ev(`${L}.getEMState()`);
    assert.ok(emAfterLeaving, "EM stays loaded after it is left (so this check is not vacuous)");
    assert.equal(emAfterLeaving.active, false, "leaving EM deactivates it");
    assert.equal(await ev(`document.getElementById("em-workspace").hidden || document.getElementById("em-workspace").inert`), true, "the EM pane is hidden");

    await click("#em-workspace-tab");
    await until(`${L}.getEMState()?.active === true`, "EM to be active again");
    assert.equal((await ev(`${L}.getSignalsCourseState()`)).active, false, "leaving signals deactivates it");
    assert.equal(await ev(`${L}.getWorkspace()`), "em");
  });

  test("circuit course opens and lists its experiments", async () => {
    await navigate("/");
    await click("#circuit-course-open");
    await until(`${L}.getCircuitCourseState()?.active === true && document.querySelectorAll("#circuit-course-host [data-circuit-course-experiment]").length > 0`, "the circuit course");
    assert.equal(await ev(`document.getElementById("workbench").hidden`), true);
    // Problem worksheet: 100 V across 3 ohm + j(2 pi 50 12.7324 mH = 4 ohm) is 100 / 5 = 20 A.
    await click('[data-circuit-course-experiment="problem"]');
    const field = (key) => `#circuit-course-host [data-circuit-course-key="${key}"]`;
    const set = (key, value) => ev(`(() => { const e = document.querySelector(${JSON.stringify(field(key))}); e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    await set("elements", "RL");
    await set("singleGoal", "current");
    await set("solutionMode", "numeric");
    await click("#circuit-course-host [data-circuit-course-apply]");
    assert.equal(await ev(`${L}.getCircuitCourseState().result.status`), "invalid", "blank numeric conditions are rejected");
    await typeInto(field("voltage"), "100 V");
    await typeInto(field("frequencyHz"), "50 Hz");
    await typeInto(field("r"), "3 Ω");
    await typeInto(field("l"), "12.732395447351627 mH");
    await click("#circuit-course-host [data-circuit-course-apply]");
    const answer = await ev(`${L}.getCircuitCourseState().result.solution.answers[0].value`);
    assert.ok(Math.abs(answer - 20) < 1e-9, `numeric current ${answer}`);
    await click("#circuit-course-back");
    await until(`!document.getElementById("workbench").hidden && document.getElementById("circuit-course-shell").hidden`, "the editor to return");
  });

  test("phone layout (390x844): one panel at a time, transient and AC still run", async () => {
    await navigate("/?example=rc-charge", { width: 390, height: 844, mobile: true });
    assert.equal(await ev(`document.documentElement.scrollWidth <= innerWidth + 1`), true, "no horizontal page overflow");
    const visible = await ev(`["palette-panel", "inspector-panel", "results-panel", "wave-panel"].filter((id) => { const e = document.getElementById(id); return e && !e.hidden && !e.inert && e.getClientRects().length > 0; })`);
    assert.equal(visible.length, 1, `exactly one panel is shown on a phone, got ${visible}`);
    await runAnalysis("transient");
    await click('.view-tabs [data-view="wave"]');
    await until(`document.querySelectorAll("#wave-plot path.plot-line").length > 0`, "a waveform on the phone");
    await runAnalysis("ac");
    await click('.view-tabs [data-view="results"]');
    await until(`!document.getElementById("phasor-panel").hidden`, "the phasor pane on the phone");
    assert.equal(await ev(`document.documentElement.scrollWidth <= innerWidth + 1`), true, "still no overflow after results");
  });

  test("shortcuts: Shift+R, W/V, arrow nudges (+1 history each, Shift = 5), input focus, Ctrl+Enter, Ctrl+S download", async () => {
    await navigate("/?example=divider");
    await autoUpdateOff();
    const downloads = [];
    const stopListening = ctx.cdp.on((message) => { if (message.method === "Page.downloadWillBegin") downloads.push(message.params.suggestedFilename); });
    await ctx.cdp.send("Page.setDownloadBehavior", { behavior: "deny" });
    try {
      await selectPart("R1");
      const start = await component("R1");
      let depth = (await state()).historyDepth;
      const stepOf = async () => { const now = (await state()).historyDepth; const grew = now - depth; depth = now; return grew; };

      // Shift+R turns counter-clockwise, R clockwise; each is one undo step.
      await press("R", "KeyR", 82, MOD.shift);
      assert.equal((await component("R1")).rotation, (start.rotation + 270) % 360, "Shift+R rotates counter-clockwise");
      assert.equal(await stepOf(), 1);
      await press("r", "KeyR", 82);
      assert.equal((await component("R1")).rotation, start.rotation, "R rotates clockwise, back to the start");
      assert.equal(await stepOf(), 1);

      // Arrow keys: one grid step (Shift = 5 steps), exactly one history entry per press.
      await press("ArrowRight", "ArrowRight", 39);
      assert.deepEqual([(await component("R1")).x, (await component("R1")).y], [start.x + GRID, start.y]);
      assert.equal(await stepOf(), 1, "ArrowRight is one history entry");
      await press("ArrowRight", "ArrowRight", 39);
      assert.equal((await component("R1")).x, start.x + 2 * GRID);
      assert.equal(await stepOf(), 1, "a second press is its own entry");
      await press("ArrowDown", "ArrowDown", 40, MOD.shift);
      assert.deepEqual([(await component("R1")).x, (await component("R1")).y], [start.x + 2 * GRID, start.y + 5 * GRID], "Shift+ArrowDown moves 5 steps");
      assert.equal(await stepOf(), 1, "a Shift nudge is one history entry");
      await press("ArrowUp", "ArrowUp", 38);
      await press("ArrowLeft", "ArrowLeft", 37);
      await press("ArrowLeft", "ArrowLeft", 37);
      assert.deepEqual([(await component("R1")).x, (await component("R1")).y], [start.x, start.y + 4 * GRID]);
      assert.equal(await stepOf(), 3, "three presses are three entries");

      // While a text field has the focus the arrows belong to the field (and so do W/R).
      await click("#inspector-tab");
      await click(VALUE_INPUT);
      assert.equal(await ev(`document.activeElement.matches(${JSON.stringify(VALUE_INPUT)})`), true, "the value field has the focus");
      const placed = await component("R1");
      for (const [key, code, vk, modifiers] of [["ArrowRight", "ArrowRight", 39, 0], ["ArrowDown", "ArrowDown", 40, MOD.shift], ["w", "KeyW", 87, 0], ["R", "KeyR", 82, MOD.shift]]) await press(key, code, vk, modifiers);
      assert.deepEqual(await component("R1"), placed, "keys typed into a field must not move or rotate the part");
      assert.equal((await state()).tool, "select", "W typed into a field does not switch the tool");
      assert.equal(await stepOf(), 0, "no history entry from keys typed into a field");
      // Ctrl+S is the one shortcut that still works in a field: it saves the project instead of the browser's page-save dialog.
      await press("s", "KeyS", 83, MOD.ctrl);
      await waitFor(() => downloads.length === 1, "Ctrl+S in a field to download the project");
      await ev(`document.activeElement.blur()`);

      // Tool keys.
      await press("w", "KeyW", 87);
      assert.equal((await state()).tool, "wire", "W selects the wire tool");
      assert.equal(await ev(`document.querySelector('[data-tool="wire"]').classList.contains("active")`), true);
      await press("v", "KeyV", 86);
      assert.equal((await state()).tool, "select", "V selects the select tool");
      assert.equal(await stepOf(), 0, "tool keys do not touch the history");

      // Ctrl+Enter runs the analysis.
      assert.notEqual((await state()).runState.status, "success", "no result yet");
      await press("Enter", "Enter", 13, MOD.ctrl);
      await until(`${L}.getState().runState.status === "success"`, "Ctrl+Enter to run the analysis");
      assert.equal((await state()).result.analysis, "dc");
      assert.equal(await stepOf(), 0, "running does not add history");

      // Ctrl+S outside a field: a real download of the project JSON.
      await press("s", "KeyS", 83, MOD.ctrl);
      await waitFor(() => downloads.length === 2, "Ctrl+S to download the project");
      assert.match(downloads[1], /\.json$/);
      assert.equal(await stepOf(), 0, "saving does not add history");
    } finally {
      stopListening();
      await ctx.cdp.send("Page.setDownloadBehavior", { behavior: "default" });
    }
  });

  test("wheel over a value label: E12 steps coalesce within 400 ms into one history entry; elsewhere the wheel zooms", async () => {
    await navigate("/?example=rc-lowpass");
    await autoUpdateOff();
    const label = await center('.component[data-id="R1"] .value-label');
    const depth0 = (await state()).historyDepth;
    const view0 = (await state()).canvasView;
    assert.equal(await valueOf("R1"), "1k");

    await wheelAt(label.x, label.y, -100);
    await sleep(80);
    await wheelAt(label.x, label.y, -100);
    await settle();
    assert.equal(await valueOf("R1"), "1.5k", "two notches step 1k -> 1.2k -> 1.5k");
    assert.equal((await state()).historyDepth, depth0 + 1, "ticks within 400 ms are one history entry");
    assert.deepEqual((await state()).canvasView, view0, "the wheel over a value label does not zoom the canvas");

    await sleep(600); // idle: the coalescing window is over
    await wheelAt(label.x, label.y, -100);
    await settle();
    assert.equal(await valueOf("R1"), "1.8k");
    assert.equal((await state()).historyDepth, depth0 + 2, "a tick after the idle gap is a new entry");
    await click("#undo-button");
    assert.equal(await valueOf("R1"), "1.5k", "one undo takes back only the last (separate) entry");
    await click("#undo-button");
    assert.equal(await valueOf("R1"), "1k", "one more undo takes back both coalesced ticks");
    assert.equal((await state()).historyDepth, depth0);

    // Anywhere else the wheel zooms the circuit view and changes no value.
    const empty = await bgPoint();
    await wheelAt(empty.x, empty.y, 100);
    await settle();
    const zoomed = (await state()).canvasView;
    assert.ok(zoomed.width > view0.width * 1.1, `wheel down zooms out (${view0.width} -> ${zoomed.width})`);
    await wheelAt(empty.x, empty.y, -100);
    await settle();
    assert.ok((await state()).canvasView.width < zoomed.width, "wheel up zooms in");
    assert.equal(await valueOf("R1"), "1k", "zooming changes no value");
    assert.equal((await state()).historyDepth, depth0, "zooming is not an edit");
  });

  test("hover readout: node pin shows 5 V, R2 shows 5 mA / 25 mW, an edit makes it say the result is outdated, and hovering never mutates the canvas", async () => {
    await navigate("/?example=divider");
    await runAnalysis("dc");
    await autoUpdateOff();
    await ev(`window.__mutations = { components: 0, wires: 0 }; for (const [key, id] of [["components", "component-layer"], ["wires", "wire-layer"]]) new MutationObserver((records) => { window.__mutations[key] += records.length; }).observe(document.getElementById(id), { subtree: true, childList: true, attributes: true, characterData: true }); 0`);
    const hover = () => ev(`${L}.getHoverReadout()`);

    const middle = await pinTip("R1", 1);
    await moveTo(middle.x, middle.y);
    await until(`${L}.getHoverReadout().visible`, "the node readout");
    let readout = await hover();
    assert.match(readout.text, /(^|\D)5 V/, `the middle node reads 5 V: ${readout.text}`);
    assert.equal(readout.stale, false);

    const r2 = await partPoint("R2");
    await moveTo(r2.x, r2.y);
    await waitFor(async () => (await hover()).text.includes("R2"), "the R2 readout");
    readout = await hover();
    assert.match(readout.text, /5 mA/, `R2 current: ${readout.text}`);
    assert.match(readout.text, /25 mW/, `R2 power: ${readout.text}`);
    for (let n = 0; n < 6; n += 1) await moveTo(middle.x + (n % 2) * 3, middle.y + n);
    await moveTo(r2.x, r2.y);
    assert.deepEqual(await ev(`window.__mutations`), { components: 0, wires: 0 }, "hovering mutates neither the component layer nor the wire layer");

    // An edit with auto-update off leaves the old result on screen: the readout must say so instead of showing old numbers.
    const label = await center('.component[data-id="R1"] .value-label');
    await wheelAt(label.x, label.y, -100);
    await settle();
    assert.equal(await valueOf("R1"), "1.2k");
    assert.equal((await state()).stale, true);
    await moveTo(r2.x + 200, r2.y + 120);
    await moveTo(r2.x, r2.y);
    await until(`${L}.getHoverReadout().visible`, "the stale readout");
    readout = await hover();
    assert.equal(readout.stale, true);
    assert.match(readout.text, /결과가 오래됨/);
    assert.doesNotMatch(readout.text, /mA|mW/, "no old numbers are shown");
  });

  test("measurements: SIN transient gives RMS = A/sqrt(2), f and Vpp = 2A; AC gives the RC -3 dB frequency; moving over the plot does not recompute", async () => {
    await navigate("/?example=parallel-sine");
    const source = (await component("V1")).props;
    const amplitude = parseEng(source.amplitude), frequency = parseEng(source.frequency);
    await runAnalysis("transient");
    await until(`${L}.getMeasure().visible`, "the measurement summary");
    const rows = await measureRows();
    const row = rows.find((item) => item.trace === "V(V1.1)");
    assert.ok(row, `a V(V1.1) measurement row exists: ${JSON.stringify(rows)}`);
    near(parseEng(row.cells.RMS), amplitude / Math.SQRT2, 0.01, "RMS");
    near(parseEng(row.cells["주파수"]), frequency, 0.01, "frequency");
    near(parseEng(row.cells.Vpp), 2 * amplitude, 0.01, "Vpp");
    near(parseEng(row.cells["평균"]), 0, 1, "mean (about 0)", 0.01 * amplitude);
    assert.match(await ev(`document.getElementById("measure-summary").textContent`), /RMS/);

    // Mouse moves across the plot only move the cursor: nothing is measured again.
    const before = await ev(`${L}.getMeasure()`);
    for (let n = 0; n < 12; n += 1) { const point = await plotPoint(0.05 + n * 0.08); await moveTo(point.x, point.y); }
    assert.notEqual((await state()).scope.hoverIndex, null, "the plot cursor really followed the mouse");
    const after = await ev(`${L}.getMeasure()`);
    assert.equal(after.computeCount, before.computeCount, "mouse moves over the plot must not recompute the measurements");
    assert.equal(after.signature, before.signature);

    await navigate("/?example=rc-lowpass");
    const { R1, C1 } = Object.fromEntries((await state()).circuit.components.map((item) => [item.id, item.props]));
    await runAnalysis("ac");
    const acRows = await measureRows();
    const acRow = acRows.find((item) => item.trace === "V(C1.1)");
    assert.ok(acRow, `an AC measurement row exists: ${JSON.stringify(acRows)}`);
    near(parseEng(acRow.cells["−3 dB 차단"]), 1 / (2 * Math.PI * parseEng(R1.value) * parseEng(C1.value)), 0.01, "-3 dB frequency");
  });

  test("A/B cursors: click pins A, Shift+click places B, deltas are raw-sample differences, Shift+arrow moves only B, Esc clears A then B", async () => {
    await navigate("/?example=parallel-sine");
    await selectPart("R1");
    await runAnalysis("transient");
    const { result } = await state();
    const v = (index) => nodeValue(result, index, "V1", 0);
    const x = result.xValues;
    const r1 = await component("R1");
    const depth = (await state()).historyDepth;

    const a = await plotPoint(0.1);
    await clickAt(a.x, a.y); await settle();
    let scope = (await state()).scope;
    assert.notEqual(scope.pinnedIndex, null, "a click pins cursor A");
    assert.equal(scope.cursorB, null);
    const b = await plotPoint(0.35);
    await clickAt(b.x, b.y, { modifiers: MOD.shift }); await settle();
    const placed = (await state()).scope;
    assert.notEqual(placed.cursorB, null, "Shift+click places cursor B");
    assert.equal(placed.pinnedIndex, scope.pinnedIndex, "Shift+click leaves A where it was");
    assert.ok(placed.cursorB > placed.pinnedIndex);
    const ia = placed.pinnedIndex, ib = placed.cursorB;

    await until(`document.querySelectorAll("#cursor-readout .delta-item").length >= 2`, "the A/B delta line");
    assert.match(await ev(`document.querySelector("#cursor-readout .cursor-delta").textContent`), /V\(V1\.1\)/, "the delta names the trace it describes");
    let items = await deltaItems();
    near(parseEng(items["ΔT"]), x[ib] - x[ia], 0.002, "dT is B - A of the raw time samples");
    near(parseEng(items["ΔV"]), v(ib) - v(ia), 0.002, "dV is B - A of the raw samples");
    assert.ok(Math.abs(v(ib) - v(ia)) > 1, "the chosen samples really differ (the check is not vacuous)");

    // Shift+Arrow moves B only: A and the selected part stay where they are, and nothing is added to the history.
    assert.equal(await ev(`document.activeElement.id`), "wave-plot", "the plot has the keyboard focus after the click");
    await press("ArrowRight", "ArrowRight", 39, MOD.shift);
    scope = (await state()).scope;
    assert.equal(scope.cursorB, ib + 1, "Shift+Right moves B one sample");
    assert.equal(scope.pinnedIndex, ia, "A did not move");
    assert.deepEqual(await component("R1"), r1, "the selected component did not move");
    assert.equal((await state()).historyDepth, depth, "no history entry");
    items = await deltaItems();
    near(parseEng(items["ΔT"]), x[ib + 1] - x[ia], 0.002, "dT follows the moved B");
    near(parseEng(items["ΔV"]), v(ib + 1) - v(ia), 0.002, "dV follows the moved B", 1e-3);
    await press("ArrowRight", "ArrowRight", 39);
    scope = (await state()).scope;
    assert.equal(scope.pinnedIndex, ia + 1, "a plain Right moves A");
    assert.equal(scope.cursorB, ib + 1, "B did not move");
    assert.deepEqual(await component("R1"), r1, "the selected component still did not move");

    // Esc releases A first, then B.
    await press("Escape", "Escape", 27);
    scope = (await state()).scope;
    assert.equal(scope.pinnedIndex, null, "the first Esc clears A");
    assert.equal(scope.cursorB, ib + 1, "B survives the first Esc");
    await press("Escape", "Escape", 27);
    scope = (await state()).scope;
    assert.equal(scope.cursorB, null, "the second Esc clears B");
    assert.equal(await ev(`document.querySelectorAll("#cursor-readout .cursor-delta").length`), 0, "the delta line is gone");
  });

  test("sweep: R1 500 -> 2k, 3 log points overlay 3 series whose -3 dB scales 1/R; cancel, an edit and a normal run each drop the overlay", async () => {
    await navigate("/?example=rc-lowpass");
    await openSweepForm("500", "2k", "3");
    await click("#sweep-run");
    await until(`${L}.getSweep().overlay`, "the sweep overlay");
    const sweep = await sweepOf();
    assert.equal(sweep.running, false);
    assert.equal(sweep.overlay.series.length, 3, "one series per sweep point");
    assert.equal(new Set(sweep.overlay.series.map((item) => item.label)).size, 3, "distinct labels");
    assert.equal(new Set(sweep.overlay.series.map((item) => item.color)).size, 3, "distinct colours");
    assert.deepEqual(sweep.overlay.series.map((item) => item.sweepText), ["500", "1k", "2k"]);
    // -3 dB frequency per trace: halving the resistance doubles it.
    await until(`document.querySelectorAll("#measure-body .measure-row").length === 3`, "a measurement row per sweep trace");
    const cutoffs = (await measureRows()).map((item) => parseEng(item.cells["−3 dB 차단"]));
    near(cutoffs[0] / cutoffs[1], 2, 0.03, "fc(500) / fc(1k)");
    near(cutoffs[1] / cutoffs[2], 2, 0.03, "fc(1k) / fc(2k)");
    near(cutoffs[1], 1 / (2 * Math.PI * 1e3 * 1e-6), 0.01, "fc at the unswept 1k value");
    // A plain run replaces the overlay with the normal result.
    await click("#run-button");
    await until(`${L}.getState().runState.status === "success"`, "the normal run");
    assert.equal((await sweepOf()).overlay, null, "a normal run clears the overlay");

    // Cancelling between two points leaves nothing behind. The 2nd point is held back until the user cancels.
    await navigate("/?example=rc-lowpass");
    await openSweepForm("500", "2k", "3");
    await installWorkerGate(1); // after the form: an automatic re-run must not use up the free slot
    await click("#sweep-run");
    await until(`${L}.getSweep().running && ${L}.getSweep().progress.startsWith("스윕 2/")`, "the sweep to wait on its 2nd point");
    await click("#cancel-analysis-button");
    await ev(`window.__gate.release()`);
    await sleep(300);
    let after = await sweepOf();
    assert.equal(after.running, false, "the sweep stopped");
    assert.equal(after.overlay, null, "a cancelled sweep publishes no overlay");
    assert.equal(await ev(`document.querySelectorAll("#probe-list .sweep-chip").length`), 0, "no sweep legend is left");

    // Editing the circuit while the sweep runs invalidates it.
    await navigate("/?example=rc-lowpass");
    await openSweepForm("500", "2k", "3");
    await installWorkerGate(1);
    await click("#sweep-run");
    await until(`${L}.getSweep().running && ${L}.getSweep().progress.startsWith("스윕 2/")`, "the sweep to wait on its 2nd point");
    await typeInto(VALUE_INPUT, "2k");
    await press("Enter", "Enter", 13);
    await waitFor(async () => (await valueOf("R1")) === "2k", "the edit to commit");
    await ev(`window.__gate.release()`);
    await sleep(400);
    after = await sweepOf();
    assert.equal(after.running, false, "the sweep stopped after the edit");
    assert.equal(after.overlay, null, "an edit during the sweep drops its result");
    assert.equal(await valueOf("R1"), "2k");
  });

  test("drag render: 50 consecutive drags are never cancelled, never fall back to a full render, and the SVG equals a forced full render", async () => {
    await navigate("/?example=divider");
    await autoUpdateOff();
    await click('[data-tool="select"]');
    await ev(`window.__cancelled = []; document.getElementById("circuit-canvas").addEventListener("pointercancel", () => window.__cancelled.push("pointercancel"), true); 0`);
    const stats0 = await ev(`${L}.getCanvasStats()`);
    assert.equal(typeof stats0.dragFallback, "number", "the debug hook exposes dragFallback");
    const depth0 = (await state()).historyDepth;
    const layers = `["wire-layer", "component-layer", "overlay-layer"].map((id) => document.getElementById(id).innerHTML)`;
    const start = await component("R2");
    for (let n = 0; n < 50; n += 1) {
      const dx = n % 2 === 0 ? 40 : -40, dy = n % 2 === 0 ? 20 : -20; // alternate so the part stays on screen
      const before = await component("R2");
      await dragPart("R2", dx, dy);
      const moved = await component("R2");
      assert.deepEqual([moved.x, moved.y], [before.x + dx, before.y + dy], `drag ${n} was committed in full (not cancelled)`);
      if (n % 10 === 9 || n < 2) {
        const [cheap, full] = await ev(`(() => { const cheap = ${layers}; ${L}.forceCanvasRender(); return [cheap, ${layers}]; })()`);
        for (const [i, name] of ["wire-layer", "component-layer", "overlay-layer"].entries()) assert.equal(cheap[i], full[i], `drag ${n}: ${name} after the cheap drag update equals a full render`);
      }
    }
    const end = await component("R2");
    assert.deepEqual([end.x, end.y], [start.x, start.y], "50 alternating drags return to the start");
    const stats = await ev(`${L}.getCanvasStats()`);
    assert.equal(stats.dragFallback, stats0.dragFallback, "no drag frame fell back to a full render");
    assert.ok(stats.drag - stats0.drag >= 50, `the cheap drag path really ran (${stats.drag - stats0.drag} frames)`);
    assert.deepEqual(await ev(`window.__cancelled`), [], "no drag was cancelled by the browser");
    assert.equal((await state()).historyDepth, depth0 + 50, "one history entry per drag");
  });

  test("canvas clicks: background deselects; a part's centre selects and a pin tip starts a wire at min, default and max zoom; a junction centre selects it", async () => {
    await navigate("/?example=rc-charge");
    await autoUpdateOff();
    await click('[data-tool="select"]');
    const exercise = async (zoom) => {
      await clickPart("R1");
      assert.deepEqual((await state()).selected, { kind: "component", id: "R1" }, `${zoom}: the middle of R1 selects it`);
      const empty = await bgPoint();
      await clickAt(empty.x, empty.y); await settle();
      assert.equal((await state()).selected, null, `${zoom}: a click on the background deselects`);
      await clickPart("R1");
      assert.equal((await state()).selected?.id, "R1", `${zoom}: R1 is selectable again`);
      const tip = await pinTip("R1", 0);
      await clickAt(tip.x, tip.y); await settle();
      assert.deepEqual((await state()).pendingPin, { componentId: "R1", pin: 0 }, `${zoom}: a click on the pin tip starts a wire`);
      await press("Escape", "Escape", 27);
      assert.equal((await state()).pendingPin, null, `${zoom}: Esc cancels the wire`);
    };
    const zoomAround = async (deltaY, limit) => {
      const anchor = await partPoint("R1");
      for (let n = 0; n < 30; n += 1) {
        const width = (await state()).canvasView.width;
        await wheelAt(anchor.x, anchor.y, deltaY);
        await settle();
        if ((await state()).canvasView.width === width) break;
      }
      assert.equal((await state()).canvasView.width, limit, "the zoom reached its limit");
    };

    await exercise("default zoom");
    await zoomAround(-100, 220);
    await exercise("min zoom (220)");
    await zoomAround(100, 3040);
    await exercise("max zoom (3040)");
    await click("#fit-button");

    // A junction made by double-clicking a wire: clicking its centre selects it (and does not start a wire).
    const onWire = await ev(`(() => {
      const hit = document.querySelector('[data-wire-id="W2"] .wire-hit'); const middle = hit.getPointAtLength(hit.getTotalLength() / 2);
      const p = new DOMPoint(middle.x, middle.y).matrixTransform(hit.getScreenCTM());
      return { x: p.x, y: p.y, own: Boolean(document.elementFromPoint(p.x, p.y)?.closest('[data-wire-id="W2"]')) };
    })()`);
    assert.ok(onWire.own, "the middle of wire W2 is clickable");
    await clickAt(onWire.x, onWire.y, { clickCount: 1 });
    await clickAt(onWire.x, onWire.y, { clickCount: 2 });
    await settle();
    const junction = (await state()).circuit.junctions?.[0];
    assert.ok(junction, "a double-click on a wire adds a junction");
    const empty = await bgPoint();
    await clickAt(empty.x, empty.y); await settle();
    assert.equal((await state()).selected, null);
    const dot = await ev(`(() => {
      const e = document.querySelector('[data-junction-id="${junction.id}"] circle.junction'); const r = e.getBoundingClientRect(); const x = r.x + r.width / 2, y = r.y + r.height / 2;
      return { x, y, own: Boolean(document.elementFromPoint(x, y)?.closest('[data-junction-id="${junction.id}"]')) };
    })()`);
    assert.ok(dot.own, "the junction centre belongs to the junction");
    await clickAt(dot.x, dot.y); await settle();
    assert.deepEqual((await state()).selected, { kind: "junction", id: junction.id }, "a click on the junction centre selects it");
    assert.equal((await state()).pendingPin, null);
  });

  test("파형 크게: the toggle makes the plot taller and the second press restores it", async () => {
    await navigate("/?example=rc-charge");
    await runAnalysis("transient");
    const plotHeight = () => ev(`document.getElementById("wave-plot").getBoundingClientRect().height`);
    const label = () => ev(`document.getElementById("wave-size-button").textContent.trim()`);
    const normal = await plotHeight();
    assert.equal(await label(), "파형 크게");
    await click("#wave-size-button");
    await waitFor(async () => (await plotHeight()) > normal + 20, "the plot to grow");
    assert.equal(await label(), "파형 작게");
    assert.equal(await ev(`document.getElementById("wave-size-button").getAttribute("aria-pressed")`), "true");
    assert.ok((await state()).scope.geometry.height > normal, "the plot redrew at the larger size");
    await click("#wave-size-button");
    await waitFor(async () => Math.abs((await plotHeight()) - normal) < 2, "the plot to return to its normal height");
    assert.equal(await label(), "파형 크게");
    assert.equal(await ev(`document.getElementById("wave-size-button").getAttribute("aria-pressed")`), "false");
  });

  test("autosave: an edit is restored after a reload (복원 -> one history step), 무시 only hides the banner", async () => {
    await clearBrowserStorage();
    await navigate("/?example=divider");
    assert.match(await ev(`location.search`), /example=divider/, "the launch link is still in the address bar before any edit");
    await selectPart("R1");
    await press("r", "KeyR", 82);
    const edited = await state();
    const rotated = (await component("R1")).rotation;
    assert.equal(await ev(`location.search`), "", "the first edit drops ?example= from the address bar");
    const tabId = await tabIdOf();
    await waitFor(async () => (await autosaveSlots())[tabId]?.project?.circuit?.components?.find((item) => item.id === "R1")?.rotation === rotated, "the edit to be autosaved (debounced)");

    await reloadPage();
    assert.equal((await state()).circuit.components.length, 0, "the reloaded tab opens the default editor, not the old circuit");
    await until(`document.querySelectorAll("#canvas-notices .canvas-notice").length === 1`, "the restore banner");
    assert.match((await noticeTexts())[0], /이전 작업이 있습니다/);
    await clickNoticeButton("복원");
    const restored = await state();
    assert.deepEqual(restored.circuit, edited.circuit, "restoring brings the autosaved circuit back exactly");
    assert.equal(restored.historyDepth, 1, "the restore is one undo step");
    assert.deepEqual(await noticeTexts(), [], "the banner closes after 복원");
    assert.equal(await ev(`location.search`), "");

    // 무시: the banner goes away, the editor stays as it is (empty), and nothing is written over the autosave.
    const before = (await autosaveSlots())[tabId];
    await reloadPage();
    await until(`document.querySelectorAll("#canvas-notices .canvas-notice").length === 1`, "the restore banner again");
    await clickNoticeButton("무시");
    assert.deepEqual(await noticeTexts(), [], "무시 hides the banner");
    assert.equal((await state()).circuit.components.length, 0, "무시 does not restore");
    assert.equal((await state()).historyDepth, 0);
    await sleep(1000);
    assert.deepEqual((await autosaveSlots())[tabId], before, "dismissing leaves the saved slot untouched");
  });

  test("autosave: two tabs never overwrite each other's slot, and a restore that races a pending save keeps the restored content", async () => {
    await clearBrowserStorage();
    await navigate("/?example=divider");
    await selectPart("R1");
    await press("r", "KeyR", 82);
    const tab1 = await tabIdOf();
    const slotHas = async (id, componentId) => Boolean((await autosaveSlots())[id]?.project?.circuit?.components?.some((item) => item.id === componentId));
    await waitFor(() => slotHas(tab1, "R2"), "tab 1 to autosave the divider");

    const second = await openTab();
    let tab2;
    try {
      await second.run(async () => {
        await navigate("/?example=rc-lowpass");
        await selectPart("C1");
        await press("r", "KeyR", 82);
        tab2 = await tabIdOf();
        await waitFor(() => slotHas(tab2, "C1"), "tab 2 to autosave the low-pass");
      });
    } finally { await second.close(); }
    assert.notEqual(tab1, tab2, "each tab has its own id");
    let slots = await autosaveSlots();
    assert.deepEqual(Object.keys(slots).sort(), [tab1, tab2].sort(), "exactly one slot per tab (circuit-lab.autosave.v2.<tabId>)");
    assert.equal(slots[tab1].project.title, "분압기 (DC)", "tab 1's slot still holds its own circuit");
    assert.equal(slots[tab2].project.title, "RC 저역통과 (AC)");
    assert.equal(slots[tab1].project.circuit.components.some((item) => item.id === "C1"), false, "tab 2's circuit did not leak into tab 1's slot");

    // Tab 1 keeps editing: only its own slot changes.
    const untouched = slots[tab2];
    await press("r", "KeyR", 82);
    const rotatedAgain = (await component("R1")).rotation;
    await waitFor(async () => (await autosaveSlots())[tab1]?.project?.circuit?.components?.find((item) => item.id === "R1")?.rotation === rotatedAgain, "tab 1's second edit to be autosaved");
    slots = await autosaveSlots();
    assert.deepEqual(slots[tab2], untouched, "tab 1's save did not touch tab 2's slot");

    // Reload tab 1 (empty default editor + banner), start an edit, and restore before its save fires: the restore wins.
    const ownBefore = slots[tab1];
    await reloadPage();
    await until(`document.querySelectorAll("#canvas-notices .canvas-notice").length >= 1`, "the restore banner");
    await click('.palette-item[data-type="R"]');
    const empty = await bgPoint();
    await clickAt(empty.x, empty.y); await settle();
    assert.equal((await state()).circuit.components.length, 1, "the pending edit placed one part");
    await clickNoticeButton("복원");
    const restored = (await state()).circuit;
    assert.deepEqual(restored.components.map((item) => item.id).sort(), ownBefore.project.circuit.components.map((item) => item.id).sort(), "the restored circuit replaced the half-made edit");
    await sleep(1400); // longer than the 800 ms debounce
    assert.deepEqual((await state()).circuit, restored, "the restored content is still there after the old save would have fired");
    assert.deepEqual((await autosaveSlots())[tab1], ownBefore, "the pending save of the replaced edit was dropped, not written");
  });

  test("share link: the copied URL opens in a new page with the same circuit and a notice; an oversize #p= link is refused", async () => {
    await clearBrowserStorage();
    await navigate("/?example=rc-lowpass");
    await ev(`Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text) => { window.__copied = text; } } })`);
    const label = await center('.component[data-id="R1"] .value-label');
    await wheelAt(label.x, label.y, -100);
    await settle();
    assert.equal(await valueOf("R1"), "1.2k");
    await click("#share-button");
    const url = await until(`window.__copied`, "the share link to be copied");
    assert.ok(url.startsWith(`${ctx.base}/#p=`), `a hash link on this origin: ${url.slice(0, 80)}`);
    assert.ok(url.length < 8000);
    await until(`document.getElementById("canvas-notices").textContent.includes("링크를 복사했습니다")`, "the copy notice");
    const original = await state();

    const second = await openTab();
    try {
      await second.run(async () => {
        await navigate(url.slice(ctx.base.length));
        await until(`${L}.getState().circuit.components.length > 0`, "the shared circuit to load");
        const shared = await state();
        assert.deepEqual(shared.circuit, original.circuit, "the shared page shows the same circuit");
        assert.equal(shared.circuit.components.find((item) => item.id === "R1").props.value, "1.2k", "including the edit that was made after loading the example");
        assert.deepEqual(shared.probes, original.probes);
        await until(`document.getElementById("canvas-notices").textContent.includes("공유 링크에서 불러왔습니다")`, "the 'loaded from a share link' notice");
        assert.equal(shared.historyDepth, 1, "opening a link is one undo step");
      });
    } finally { await second.close(); }

    // A link that is far too large is explained and the default editor stays.
    await navigate(`/?oversize=1#p=j.${"A".repeat(70000)}`); // a different query, so this is a real page load and not a hash-only jump
    await until(`document.getElementById("canvas-notices").textContent.includes("너무 커서")`, "the 'too large' notice");
    assert.equal((await state()).circuit.components.length, 0, "the default editor is kept");
    assert.equal((await state()).historyDepth, 0);
  });

  test("drag + keyboard: R during an active drag commits the move first; undo then reverts the rotation and then the move", async () => {
    await navigate("/?example=divider");
    await autoUpdateOff();
    const start = await component("R2");
    const depth0 = (await state()).historyDepth;
    const grab = await partPoint("R2");
    const mouse = (type, x, y, extra = {}) => ctx.cdp.send("Input.dispatchMouseEvent", { type, x, y, ...extra });
    await mouse("mouseMoved", grab.x, grab.y);
    await mouse("mousePressed", grab.x, grab.y, { button: "left", buttons: 1, clickCount: 1 });
    for (let step = 1; step <= 4; step += 1) await mouse("mouseMoved", grab.x + 15 * step, grab.y, { buttons: 1 });
    await settle();
    let now = await state();
    assert.notEqual(now.pointerOwnerId, null, "the drag is in progress");
    assert.equal(now.selected?.id, "R2");
    await press("r", "KeyR", 82);
    now = await state();
    assert.equal(now.pointerOwnerId, null, "the key committed the drag");
    const moved = await component("R2");
    assert.equal(moved.x, start.x + 60, "the part sits where the drag left it");
    assert.equal(moved.rotation, (start.rotation + 90) % 360, "and it was rotated");
    assert.equal(now.historyDepth, depth0 + 2, "move and rotate are two entries");
    await mouse("mouseReleased", grab.x + 60, grab.y, { button: "left", buttons: 0, clickCount: 1 });
    await settle();
    assert.equal((await state()).historyDepth, depth0 + 2, "releasing the button afterwards adds nothing");
    assert.deepEqual(await component("R2"), moved);

    await click("#undo-button");
    let undone = await component("R2");
    assert.deepEqual([undone.x, undone.y, undone.rotation], [moved.x, moved.y, start.rotation], "first undo reverts only the rotation (the move stays)");
    await click("#undo-button");
    undone = await component("R2");
    assert.deepEqual([undone.x, undone.y, undone.rotation], [start.x, start.y, start.rotation], "second undo reverts the move");
    assert.equal((await state()).historyDepth, depth0);
  });

  test("arrow keys do not move the selected part while a scope button or the B cursor button has focus", async () => {
    await navigate("/?example=rc-charge");
    await selectPart("R1");
    await runAnalysis("transient");
    await until(`!document.getElementById("cursor-b-button").classList.contains("hidden")`, "the B cursor button right after the run");
    const placed = await component("R1");
    const depth = (await state()).historyDepth;
    for (const selector of ["#cursor-b-button", '#scope-controls [data-scale-step="1"]']) {
      await ev(`document.querySelector(${JSON.stringify(selector)}).focus()`);
      assert.equal(await ev(`document.activeElement.matches(${JSON.stringify(selector)})`), true, `${selector} has the focus`);
      await press("ArrowRight", "ArrowRight", 39);
      await press("ArrowDown", "ArrowDown", 40, MOD.shift);
      await press("ArrowLeft", "ArrowLeft", 37);
      assert.deepEqual(await component("R1"), placed, `arrows with ${selector} focused must not move the part`);
      assert.equal((await state()).historyDepth, depth, `${selector}: no history entry`);
    }
    // Control: with the focus back on the page the very same key moves the part.
    await ev(`document.activeElement.blur()`);
    await press("ArrowRight", "ArrowRight", 39);
    assert.equal((await component("R1")).x, placed.x + GRID, "the same key moves the part once nothing owns the arrows");
    assert.equal((await state()).historyDepth, depth + 1);
  });

  // ---- multi-selection, group edit, clipboard, wire drawing, cursors, touch ------------------------------------------------------
  const ctrlKey = (key, code, vk) => press(key, code, vk, MOD.ctrl);
  const shiftClickPart = async (id) => { const p = await partPoint(id); await clickAt(p.x, p.y, { modifiers: MOD.shift }); await settle(); };
  const componentIdsOf = async () => (await state()).circuit.components.map((item) => item.id);
  const positionsOf = async (ids) => Object.fromEntries((await state()).circuit.components.filter((item) => ids.includes(item.id)).map((item) => [item.id, { x: item.x, y: item.y, rotation: item.rotation ?? 0 }]));
  const layerHtml = `["wire-layer", "component-layer", "overlay-layer"].map((id) => document.getElementById(id).innerHTML)`;
  const DIVIDER_IDS = ["V1", "R1", "R2", "G1"];

  test("multi-select: Shift+click 3 parts shows '3개 선택' without a delete badge; Delete is one history step and one Ctrl+Z restores everything", async () => {
    await navigate("/?example=divider");
    await autoUpdateOff();
    const original = await state();
    await selectPart("R1");
    assert.equal(await ev(`document.querySelectorAll(".component-delete").length`), 1, "a single selected part shows its delete badge");
    await shiftClickPart("R2");
    await shiftClickPart("V1");
    const picked = await state();
    assert.deepEqual([...picked.selection].sort(), ["component:R1", "component:R2", "component:V1"], "three parts are selected");
    assert.equal(await ev(`document.getElementById("selection-label").textContent.trim()`), "3개 선택");
    assert.equal(await ev(`document.querySelectorAll(".component-delete").length`), 0, "no delete badge with several parts selected");
    assert.match(await ev(`document.getElementById("inspector-content").innerText`), /부품 3/, "the inspector summarises the selection");
    assert.equal(picked.historyDepth, original.historyDepth, "selecting is not an edit");

    await press("Delete", "Delete", 46);
    const deleted = await state();
    assert.deepEqual(deleted.circuit.components.map((item) => item.id), ["G1"], "Delete removed all three parts");
    assert.equal(deleted.circuit.wires.length, 0, "and every wire attached to them");
    assert.equal(deleted.historyDepth, original.historyDepth + 1, "the whole delete is ONE history entry");
    assert.deepEqual(deleted.selection, []);
    await ctrlKey("z", "KeyZ", 90);
    const restored = await state();
    assert.deepEqual(restored.circuit, original.circuit, "one Ctrl+Z restores parts and wires exactly");
    assert.equal(restored.historyDepth, original.historyDepth);
  });

  test("marquee: Shift+drag on the background selects the parts under the box (box visible only while dragging); a selected part drags the whole group rigidly in one history step", async () => {
    await navigate("/?example=divider");
    await autoUpdateOff();
    await click("#fit-button");
    const original = await state();
    const marquee = () => ev(`(() => { const node = document.getElementById("marquee-rect"); return { hidden: node.classList.contains("hidden"), width: Number(node.getAttribute("width")), height: Number(node.getAttribute("height")) }; })()`);
    assert.equal((await marquee()).hidden, true, "no box before the gesture");
    const from = await bgPoint({ from: "top-left" }), to = await bgPoint({ from: "bottom-right" });
    let during;
    await dragBetween(from, to, { modifiers: MOD.shift, beforeRelease: async () => { during = await marquee(); } });
    assert.equal(during.hidden, false, "the box is visible during the drag");
    assert.ok(during.width > 50 && during.height > 50, `the box has an area: ${JSON.stringify(during)}`);
    assert.equal((await marquee()).hidden, true, "the box is hidden after the release");
    const boxed = await state();
    assert.deepEqual(boxed.selection.filter((key) => key.startsWith("component:")).sort(), DIVIDER_IDS.map((id) => `component:${id}`).sort(), "the box selects all 4 parts");
    assert.equal(boxed.selection.length, 4 + boxed.circuit.wires.length, "and the wires lying fully inside it");
    assert.equal(boxed.historyDepth, original.historyDepth, "box selection is not an edit");
    assert.equal(await ev(`document.getElementById("selection-label").textContent.trim()`), `${boxed.selection.length}개 선택`);

    // Dragging one selected part moves everything by the same delta; the cheap drag frames match a full render.
    const stats0 = await ev(`${L}.getCanvasStats()`);
    const startAt = await positionsOf(DIVIDER_IDS);
    await dragPart("R2", 60, 40);
    const movedAt = await positionsOf(DIVIDER_IDS);
    const deltas = DIVIDER_IDS.map((id) => [movedAt[id].x - startAt[id].x, movedAt[id].y - startAt[id].y]);
    assert.ok(deltas[0][0] !== 0 || deltas[0][1] !== 0, `the group really moved: ${JSON.stringify(deltas)}`);
    for (const delta of deltas) assert.deepEqual(delta, deltas[0], "every selected part moved by the same delta");
    for (const id of DIVIDER_IDS) assert.equal(movedAt[id].rotation, startAt[id].rotation, `${id} was not rotated`);
    const afterDrag = await state();
    assert.equal(afterDrag.historyDepth, original.historyDepth + 1, "the group drag is one history entry");
    assert.equal(afterDrag.selection.length, boxed.selection.length, "the selection survives the drag");
    const stats = await ev(`${L}.getCanvasStats()`);
    assert.equal(stats.dragFallback, stats0.dragFallback, "no group-drag frame fell back to a full render");
    assert.ok(stats.drag > stats0.drag, "the cheap drag path ran for the group");
    const [cheap, full] = await ev(`(() => { const cheap = ${layerHtml}; ${L}.forceCanvasRender(); return [cheap, ${layerHtml}]; })()`);
    for (const [i, name] of ["wire-layer", "component-layer", "overlay-layer"].entries()) assert.equal(cheap[i], full[i], `${name} after the group drag equals a full render`);

    await click("#undo-button");
    assert.deepEqual(await positionsOf(DIVIDER_IDS), startAt, "one undo puts the whole group back");
    assert.equal((await state()).historyDepth, original.historyDepth);
  });

  test("select all: Ctrl+A selects parts+wires+junctions; R, an arrow and Ctrl+D are one history step each; a plain click narrows to one item", async () => {
    await navigate("/?example=divider");
    await autoUpdateOff();
    const original = await state();
    const total = original.circuit.components.length + original.circuit.wires.length + (original.circuit.junctions ?? []).length;
    await ctrlKey("a", "KeyA", 65);
    let now = await state();
    assert.equal(now.selection.length, total, "Ctrl+A selects every part, wire and junction");
    assert.equal(now.historyDepth, original.historyDepth, "select all is not an edit");

    await clickPart("V1");
    now = await state();
    assert.deepEqual(now.selection, ["component:V1"], "a plain click on a member narrows the selection to that one item");
    assert.deepEqual(now.selected, { kind: "component", id: "V1" });
    await ctrlKey("a", "KeyA", 65);
    assert.equal((await state()).selection.length, total);

    const base = (await state()).historyDepth;
    const before = await positionsOf(DIVIDER_IDS);
    await press("r", "KeyR", 82);
    now = await state();
    assert.equal(now.historyDepth, base + 1, "R on the whole selection is one history step");
    const rotated = await positionsOf(DIVIDER_IDS);
    for (const id of DIVIDER_IDS) assert.equal(rotated[id].rotation, (before[id].rotation + 90) % 360, `${id} turned 90 degrees`);
    await press("ArrowRight", "ArrowRight", 39);
    now = await state();
    assert.equal(now.historyDepth, base + 2, "an arrow press is one history step for the whole selection");
    const nudged = await positionsOf(DIVIDER_IDS);
    for (const id of DIVIDER_IDS) assert.deepEqual([nudged[id].x, nudged[id].y], [rotated[id].x + GRID, rotated[id].y], `${id} moved one grid step`);
    await ctrlKey("d", "KeyD", 68);
    now = await state();
    assert.equal(now.historyDepth, base + 3, "Ctrl+D is one history step");
    assert.equal(now.circuit.components.length, 8, "four parts were duplicated");
    assert.equal(now.circuit.wires.length, 8, "with the four wires between them");
    assert.equal(now.selection.length, 8, "the copy is what is selected now");
    assert.equal(new Set(await componentIdsOf()).size, 8, "ids are unique");
    for (let n = 0; n < 3; n += 1) await ctrlKey("z", "KeyZ", 90);
    now = await state();
    assert.deepEqual(now.circuit, original.circuit, "three undos bring the original circuit back");
    assert.equal(now.historyDepth, original.historyDepth);
  });

  test("clipboard: Ctrl+C then Ctrl+V twice pastes unique copies at +40/+80 with only their internal wires; Ctrl+X then Ctrl+V restores the count", async () => {
    await navigate("/?example=divider");
    await autoUpdateOff();
    await ev(`Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text) => { window.__clip = text; }, readText: async () => window.__clip ?? "" } })`);
    const original = await state();
    const originals = Object.fromEntries(original.circuit.components.map((item) => [item.id, item]));
    await selectPart("R1");
    await shiftClickPart("R2");
    await ctrlKey("c", "KeyC", 67);
    const clip = JSON.parse(await until(`window.__clip`, "the system clipboard to receive the copy"));
    assert.deepEqual(clip.components.map((item) => item.id).sort(), ["R1", "R2"]);
    assert.deepEqual(clip.wires.map((item) => item.id), ["W2"], "only the wire between the two copied parts is copied");
    assert.equal((await state()).historyDepth, original.historyDepth, "copy is not an edit");

    const known = new Set(Object.keys(originals));
    for (const offset of [40, 80]) {
      const depth = (await state()).historyDepth;
      await ctrlKey("v", "KeyV", 86);
      const now = await state();
      assert.equal(now.historyDepth, depth + 1, `paste (+${offset}) is one history step`);
      const added = now.circuit.components.filter((item) => !known.has(item.id));
      assert.equal(added.length, 2, `paste (+${offset}) added two parts`);
      assert.equal(new Set(now.circuit.components.map((item) => item.id)).size, now.circuit.components.length, "every id is unique");
      for (const copy of added) {
        const source = Object.values(originals).find((item) => item.type === copy.type && item.props.ref === copy.props.ref);
        assert.ok(source, `${copy.id} copies a clipboard part`);
        assert.deepEqual([copy.x - source.x, copy.y - source.y], [offset, offset], `${copy.id} sits ${offset} away from its source`);
        known.add(copy.id);
      }
      assert.deepEqual(now.selection.filter((key) => key.startsWith("component:")).sort(), added.map((item) => `component:${item.id}`).sort(), "the pasted parts are selected");
      const addedIds = new Set(added.map((item) => item.id));
      const touching = now.circuit.wires.filter((wire) => [wire.a, wire.b].some((end) => addedIds.has(end.componentId)));
      assert.equal(touching.length, 1, "exactly the internal wire came along");
      assert.ok(addedIds.has(touching[0].a.componentId) && addedIds.has(touching[0].b.componentId), "and it connects the two copies, not the originals");
    }
    const pasted = await state();
    assert.equal(pasted.circuit.components.length, 8);
    assert.equal(pasted.circuit.wires.length, 6);

    // Cut the last pasted pair, then paste it back: the count is restored.
    await ctrlKey("x", "KeyX", 88);
    const cut = await state();
    assert.equal(cut.circuit.components.length, 6, "Ctrl+X removed the selected pair");
    assert.equal(cut.circuit.wires.length, 5);
    assert.equal(cut.historyDepth, pasted.historyDepth + 1, "the cut is one history step");
    await ctrlKey("v", "KeyV", 86);
    const back = await state();
    assert.equal(back.circuit.components.length, pasted.circuit.components.length, "Ctrl+V after Ctrl+X restores the part count");
    assert.equal(back.circuit.wires.length, pasted.circuit.wires.length, "and the wire count");
    assert.equal(back.historyDepth, cut.historyDepth + 1);
    assert.equal(back.selection.length, 3, "two parts and their wire are selected");
  });

  test("wiring by drag: pin to pin, click-click, release on empty space keeps the wire pending (Esc cancels), release on a wire makes a junction", async () => {
    await navigate("/?example=divider");
    await autoUpdateOff();
    await click("#fit-button");
    const start = await state();
    const wireIds = new Set(start.circuit.wires.map((wire) => wire.id));
    const newWires = async () => (await state()).circuit.wires.filter((wire) => !wireIds.has(wire.id));
    const pinEnd = (componentId, index) => ({ componentId, pin: index });

    // (1) Release on a wire: the wire is split by a junction and the new wire ends there.
    const onWire = await ev(`(() => {
      const hit = document.querySelector('[data-wire-id="W2"] .wire-hit'); const middle = hit.getPointAtLength(hit.getTotalLength() / 2);
      const p = new DOMPoint(middle.x, middle.y).matrixTransform(hit.getScreenCTM());
      return { x: p.x, y: p.y, own: Boolean(document.elementFromPoint(p.x, p.y)?.closest('[data-wire-id="W2"]')) };
    })()`);
    assert.ok(onWire.own, "the middle of W2 is on the wire");
    await dragBetween(await pinTip("G1", 0), onWire);
    let now = await state();
    assert.equal(now.pendingPin, null, "the wire was finished");
    assert.equal((now.circuit.junctions ?? []).length, 1, "a junction was created on the wire");
    const junction = now.circuit.junctions[0];
    assert.equal(now.circuit.wires.length, start.circuit.wires.length + 2, "W2 was split in two and one new wire was added");
    assert.ok(now.circuit.wires.some((wire) => wire.a.componentId === "G1" && wire.b.junctionId === junction.id), "the new wire runs from G1 to the junction");
    assert.equal(now.historyDepth, start.historyDepth + 1, "drawing it is one history entry");
    assert.deepEqual(now.selected, { kind: "junction", id: junction.id });
    wireIds.clear(); for (const wire of now.circuit.wires) wireIds.add(wire.id);

    // (2) Drag from a pin to another pin.
    const depth2 = now.historyDepth;
    await dragBetween(await pinTip("R1", 0), await pinTip("R2", 1));
    now = await state();
    assert.equal(now.pendingPin, null, "nothing is left pending after the drag");
    let added = await newWires();
    assert.equal(added.length, 1, "one wire was created");
    assert.deepEqual([added[0].a, added[0].b], [pinEnd("R1", 0), pinEnd("R2", 1)], "its endpoints are the two pins");
    assert.equal(now.historyDepth, depth2 + 1);
    wireIds.add(added[0].id);

    // (3) Click, then click: still works.
    const tip = await pinTip("V1", 1);
    await clickAt(tip.x, tip.y); await settle();
    assert.deepEqual((await state()).pendingPin, pinEnd("V1", 1), "the first click starts the wire");
    const end = await pinTip("R1", 1);
    await clickAt(end.x, end.y); await settle();
    now = await state();
    assert.equal(now.pendingPin, null);
    added = await newWires();
    assert.equal(added.length, 1, "the second click finished one more wire");
    assert.deepEqual([added[0].a, added[0].b], [pinEnd("V1", 1), pinEnd("R1", 1)]);
    wireIds.add(added[0].id);

    // (4) Release on empty space: the wire stays pending; Esc drops it.
    const depth4 = (await state()).historyDepth;
    await dragBetween(await pinTip("R2", 0), await bgPoint());
    now = await state();
    assert.deepEqual(now.pendingPin, pinEnd("R2", 0), "releasing on empty canvas keeps the wire pending");
    assert.equal((await newWires()).length, 0, "no wire was made");
    assert.equal(now.historyDepth, depth4);
    await press("Escape", "Escape", 27);
    assert.equal((await state()).pendingPin, null, "Esc cancels the pending wire");
    assert.equal((await state()).historyDepth, depth4);
  });

  test("focus regression: after clicking the auto-update checkbox, clicking a part and pressing R rotates it (and an arrow moves it with the checkbox focused)", async () => {
    await navigate("/?example=divider");
    const wasOn = (await state()).autoUpdate;
    await click("#auto-update");
    assert.equal((await state()).autoUpdate, !wasOn, "the checkbox toggled");
    assert.equal(await ev(`document.activeElement.id`), "auto-update", "the checkbox owns the focus after the click");
    await selectPart("R1");
    const before = await component("R1");
    await press("r", "KeyR", 82);
    assert.equal((await component("R1")).rotation, ((before.rotation ?? 0) + 90) % 360, "R rotates the clicked part");
    await click("#auto-update");
    assert.equal(await ev(`document.activeElement.id`), "auto-update");
    const placed = await component("R1");
    await press("ArrowRight", "ArrowRight", 39);
    assert.equal((await component("R1")).x, placed.x + GRID, "an arrow nudges the part even while the checkbox has the focus");
  });

  test("scope + selection: the B cursor button shows right after a run; Esc on the plot clears cursor A only, the next Esc clears the selection", async () => {
    await navigate("/?example=rc-charge");
    await selectPart("R1");
    await runAnalysis("transient");
    await until(`!document.getElementById("cursor-b-button").classList.contains("hidden")`, "the B cursor button right after the run");
    assert.equal(await ev(`document.getElementById("cursor-b-button").textContent.trim()`), "B 커서");
    const spot = await plotPoint(0.3);
    await clickAt(spot.x, spot.y); await settle();
    assert.notEqual((await state()).scope.pinnedIndex, null, "a click on the plot pins cursor A");
    assert.equal(await ev(`document.activeElement.id`), "wave-plot");
    await press("Escape", "Escape", 27);
    let now = await state();
    assert.equal(now.scope.pinnedIndex, null, "the first Esc releases cursor A");
    assert.deepEqual(now.selected, { kind: "component", id: "R1" }, "the part stays selected");
    assert.deepEqual(now.selection, ["component:R1"]);
    await press("Escape", "Escape", 27);
    now = await state();
    assert.equal(now.selected, null, "the second Esc clears the selection");
    assert.deepEqual(now.selection, []);
  });

  test("Ctrl+Enter inside an inspector value field commits the draft and runs the analysis", async () => {
    await navigate("/?example=divider");
    await autoUpdateOff();
    await selectPart("R2");
    await click("#inspector-tab");
    const depth = (await state()).historyDepth;
    await typeInto(VALUE_INPUT, "2k");
    assert.deepEqual(await draftsOf(), [{ kind: "prop", id: "R2", property: "value", value: "2k" }], "the typed value is only a draft");
    assert.equal(await valueOf("R2"), "1k");
    assert.notEqual((await state()).runState.status, "success", "no result yet");
    await press("Enter", "Enter", 13, MOD.ctrl);
    await until(`${L}.getState().runState.status === "success"`, "Ctrl+Enter to run the analysis");
    const now = await state();
    assert.equal(await valueOf("R2"), "2k", "the draft was committed first");
    assert.deepEqual(now.drafts, []);
    assert.equal(now.historyDepth, depth + 1, "the commit is one history step");
    near(nodeValue(now.result, 0, "R2", 0), 10 * 2 / 3, 1e-6, "the run used the committed 2k (divider output 6.667 V)");
  });

  test("touch: with the wire tool a one-finger drag from pin to pin draws a wire; with the select tool a one-finger drag on the background pans (no box)", async () => {
    await navigate("/?example=divider");
    await autoUpdateOff();
    await click("#fit-button");
    await click('[data-tool="wire"]');
    const start = await state();
    const depth = start.historyDepth;
    await touchDrag(await pinTip("R1", 0), await pinTip("R2", 1));
    let now = await state();
    assert.equal(now.circuit.wires.length, start.circuit.wires.length + 1, "the touch drag created one wire");
    const wire = now.circuit.wires.at(-1);
    assert.deepEqual([wire.a, wire.b], [{ componentId: "R1", pin: 0 }, { componentId: "R2", pin: 1 }], "between the two pins");
    assert.equal(now.pendingPin, null);
    assert.equal(now.historyDepth, depth + 1);

    await click('[data-tool="select"]');
    await selectPart("V1");
    const view = (await state()).canvasView;
    const from = await bgPoint();
    await touchDrag(from, { x: from.x - 60, y: from.y - 40 });
    now = await state();
    const scale = await ev(`document.getElementById("circuit-canvas").getScreenCTM().a`);
    near(now.canvasView.x - view.x, 60 / scale, 0.1, "the view panned with the finger (x)");
    near(now.canvasView.y - view.y, 40 / scale, 0.1, "the view panned with the finger (y)");
    assert.equal(now.canvasView.width, view.width, "panning does not zoom");
    assert.equal(await ev(`document.getElementById("marquee-rect").classList.contains("hidden")`), true, "no selection box appeared");
    assert.deepEqual(now.selection, ["component:V1"], "the selection is untouched by the pan");
    assert.equal(now.historyDepth, depth + 1, "panning is not an edit");
  });

  test("new circuit after ?example=: a reload opens an empty editor and the example does not come back", async () => {
    await clearBrowserStorage();
    await navigate("/?example=divider");
    assert.match(await ev(`location.search`), /example=divider/);
    await click("#new-button");
    assert.equal((await state()).circuit.components.length, 0);
    assert.equal(await ev(`location.search`), "", "새 회로 removes ?example= from the address bar");
    await reloadPage();
    assert.equal((await state()).circuit.components.length, 0, "the reloaded editor is empty");
    assert.ok(!(await ev(`location.href`)).includes("example"), "no example parameter after the reload");
    assert.equal(await ev(`document.getElementById("empty-hint").classList.contains("hidden")`), false, "the empty-canvas hint is shown");
    assert.deepEqual(await noticeTexts(), [], "nothing is offered for restore (the example was never autosaved)");
  });
});
