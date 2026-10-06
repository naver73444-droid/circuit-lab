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
    // The course is the fourth top-level workspace tab (not a file-menu entry): tab semantics like the other workspaces.
    assert.equal(await ev(`document.getElementById("circuit-course-open")`), null, "no file-menu entry any more");
    assert.equal(await ev(`document.querySelectorAll('[data-workspace-tab]').length`), 4);
    assert.equal(await ev(`document.getElementById("circuit-course-workspace-tab").getAttribute("role")`), "tab");
    await click("#circuit-course-workspace-tab");
    await until(`${L}.getCircuitCourseState()?.active === true && document.querySelectorAll("#circuit-course-host [data-circuit-course-experiment]").length > 0`, "the circuit course");
    assert.equal(await ev(`document.getElementById("workbench").hidden`), true);
    assert.equal(await ev(`${L}.getWorkspace()`), "circuit-course");
    assert.equal(await ev(`document.getElementById("circuit-course-workspace-tab").getAttribute("aria-selected")`), "true");
    assert.equal(await ev(`document.getElementById("circuit-course-workspace").getAttribute("role")`), "tabpanel");
    // The course follows the theme (CSS tokens, no hard-coded dark palette): the light page background shows through.
    const courseBackground = () => ev(`getComputedStyle(document.querySelector(".circuit-course")).backgroundColor`);
    const darkBackground = await courseBackground();
    await ev(`(() => { const s = document.getElementById("appearance"); s.value = "light"; s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
    const lightBackground = await courseBackground();
    assert.notEqual(lightBackground, darkBackground, "switching to the light theme repaints the course");
    assert.equal(lightBackground, "rgb(243, 241, 233)", "light course background is the --bg token");
    await ev(`(() => { const s = document.getElementById("appearance"); s.value = "dark"; s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
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
    await until(`!document.getElementById("workbench").hidden && document.getElementById("circuit-course-workspace").hidden && ${L}.getWorkspace() === "circuit"`, "the editor to return");
    assert.equal(await ev(`document.getElementById("circuit-workspace-tab").getAttribute("aria-selected")`), "true");
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
    await sleep(1100); // the restored project is saved right away (800 ms debounce); wait for that before taking the reference
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
    // The replaced (half-made) edit is the old project's final state: it is flushed, never dropped, and the restored project is saved on top
    // of it, so the replaced work stays available as this tab's prev slot.
    await waitFor(async () => (await autosaveSlots())[tab1]?.project?.circuit?.components?.length === ownBefore.project.circuit.components.length, "the restored circuit to be saved");
    const slotsAfter = await autosaveSlots();
    assert.deepEqual(slotsAfter[tab1].project.circuit.components.map((item) => item.id).sort(), restored.components.map((item) => item.id).sort(), "the own slot holds the restored content");
    assert.equal(slotsAfter[`${tab1}.prev`].project.circuit.components.length, 1, "the half-made edit of the replaced project is kept in prev, not lost");
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
    // The browser raises native copy/cut/paste events for these keys (also in headless Edge over CDP); the app reads and writes
    // event.clipboardData, so no navigator.clipboard permission is involved. A window-level bubble listener (it runs after the app's) records what was copied.
    await ev(`window.addEventListener("copy", (event) => { window.__clip = event.clipboardData.getData("text/plain"); })`);
    const original = await state();
    const originals = Object.fromEntries(original.circuit.components.map((item) => [item.id, item]));
    await selectPart("R1");
    await shiftClickPart("R2");
    await ctrlKey("c", "KeyC", 67);
    const clip = JSON.parse(await until(`window.__clip`, "the system clipboard to receive the copy"));
    assert.deepEqual(clip.components.map((item) => item.id).sort(), ["R1", "R2"]);
    assert.equal(clip.source, (await state()).projectId, "the clipboard carries the id of the project it came from");
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
      assert.equal(new Set(now.circuit.components.map((item) => item.props.ref)).size, now.circuit.components.length, "every reference label is unique");
      for (const [index, copy] of added.entries()) {
        const source = [originals.R1, originals.R2][index];
        assert.equal(copy.type, source.type, `${copy.id} copies ${source.id}`);
        assert.notEqual(copy.props.ref, source.props.ref, "a copy never repeats its original's reference label");
        assert.equal(copy.props.ref, copy.id, "it gets the next free label, like a newly placed part");
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
    assert.match(added[0].id, /^W\d+$/, "wire ids come from the allocator, not the clock");
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

  // ---- review follow-up: clipboard validation/ownership, pending wire cleanup, key ownership, touch group drag, pin-drag edge cases -----------------------------

  const statusText = () => ev(`document.getElementById("engine-status").textContent`);
  const rawMouse = (type, x, y, extra = {}) => ctx.cdp.send("Input.dispatchMouseEvent", { type, x, y, ...extra });
  /** A paste the browser did not raise itself: a synthetic ClipboardEvent whose clipboardData holds `text` (empty = "the clipboard holds no text"). */
  const syntheticPaste = (text) => ev(`(() => { const data = new DataTransfer(); if (${JSON.stringify(text)}) data.setData("text/plain", ${JSON.stringify(text)}); const event = new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }); document.body.dispatchEvent(event); return event.defaultPrevented; })()`).then(settle);
  /** The keydown only (no native clipboard event follows an untrusted key), which exercises the key-path fallback. */
  const syntheticCtrlV = () => ev(`document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "v", code: "KeyV", ctrlKey: true, bubbles: true, cancelable: true }))`).then(() => sleep(150)).then(settle);
  const clipPayload = (parts, extra = {}) => JSON.stringify({ format: "circuit-lab-clipboard", version: 1, components: parts, junctions: [], wires: [], ...extra });
  const resistor = (id, extra = {}) => ({ id, type: "R", x: 300, y: 300, rotation: 0, props: { ref: "R1", value: "2k" }, ...extra });
  const counts = async () => { const now = await state(); return { components: now.circuit.components.length, wires: now.circuit.wires.length, history: now.historyDepth }; };

  test("clipboard: a rejected system-clipboard payload is never remembered; a valid one is pasted (refs relabelled) and then remembered for the next paste", async () => {
    await navigate("/?example=divider");
    await autoUpdateOff();
    const base = await counts();
    const toNothing = JSON.parse(clipPayload([resistor("R1"), resistor("R2", { x: 400 })]));
    toNothing.wires = [{ id: "W9", a: { componentId: "R1", pin: 99 }, b: { componentId: "R2", pin: 0 } }];
    const bad = JSON.stringify(toNothing);
    // Native paste path: rejected, nothing changes, and the empty internal clipboard is NOT replaced by the rejected content.
    await syntheticPaste(bad);
    assert.deepEqual(await counts(), base, "the payload with a wire to pin 99 changed nothing");
    assert.match(await statusText(), /거부/);
    await syntheticPaste("");
    assert.deepEqual(await counts(), base, "a second paste (empty system clipboard) does not bring the rejected payload in through the internal clipboard");
    assert.match(await statusText(), /붙여넣을 회로 항목이 없습니다/);
    // Key fallback path (no native event): the async system clipboard is rejected both times.
    await ev(`Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => {}, readText: async () => ${JSON.stringify(bad)} } })`);
    await syntheticCtrlV();
    await syntheticCtrlV();
    assert.deepEqual(await counts(), base, "the key path rejects it every time instead of pasting the remembered payload the second time");
    assert.match(await statusText(), /거부/);
    // A valid payload pastes; its copy gets the next free label, not the original's "R1".
    await syntheticPaste(clipPayload([resistor("R1")]));
    let now = await state();
    assert.equal(now.circuit.components.length, base.components + 1);
    const pasted = now.circuit.components.at(-1);
    assert.equal(pasted.id, "R3");
    assert.equal(pasted.props.ref, "R3", "the copy of R1 is labelled R3, not R1");
    assert.equal(pasted.props.value, "2k");
    assert.deepEqual(now.selection, ["component:R3"]);
    // ... and a later paste with nothing on the system clipboard pastes the (validated) remembered one, further along the cascade.
    await syntheticPaste("");
    now = await state();
    assert.equal(now.circuit.components.length, base.components + 2);
    assert.deepEqual([now.circuit.components.at(-1).x - pasted.x, now.circuit.components.at(-1).y - pasted.y], [40, 40], "the cascade continues");
    assert.equal(now.circuit.components.at(-1).props.ref, "R4");
  });

  test("clipboard: a controlled source pasted into another project loses its control target (notice + inspector error); the same project keeps a target that still exists", async () => {
    await navigate("/?example=divider");
    await autoUpdateOff();
    const projectId = (await state()).projectId;
    assert.ok(projectId, "the app exposes the project id");
    const dependent = (elementId, source) => clipPayload([{ id: "F1", type: "CCCS", x: 300, y: 300, rotation: 0, props: { ref: "F1", beta: "2" }, control: { kind: "branchCurrent", elementId, direction: 1 } }], source ? { source } : {});
    // Another project: V1 exists here, but it is just a same-named stranger.
    await syntheticPaste(dependent("V1", "somewhere-else-1"));
    let now = await state();
    const crossed = now.circuit.components.at(-1);
    assert.equal(crossed.type, "CCCS");
    assert.equal(crossed.control, undefined, "the reference to a same-named V1 of another project is cleared, not bound");
    assert.ok((await noticeTexts()).some((text) => text.includes("제어 대상을 다시 선택하세요")), "the user is told to pick the target again");
    assert.match(await ev(`document.getElementById("inspector-content").textContent`), /제어 대상 오류/, "the inspector shows the missing-control state");
    // Same project, target present: kept. Same project, target gone: cleared.
    await syntheticPaste(dependent("V1", projectId));
    assert.equal((await state()).circuit.components.at(-1).control.elementId, "V1");
    await syntheticPaste(dependent("S9", projectId));
    assert.equal((await state()).circuit.components.at(-1).control, undefined, "a target that no longer exists is cleared");
    // Without a source (a payload from elsewhere) it is a different project too.
    await syntheticPaste(dependent("V1", ""));
    assert.equal((await state()).circuit.components.at(-1).control, undefined);
    // A new circuit is a new project.
    await click("#new-button");
    assert.notEqual((await state()).projectId, projectId, "새 회로 starts a new project id");
  });

  test("deleting or cutting the start part of a half-drawn wire cancels it (no wire to a deleted pin)", async () => {
    await navigate("/?example=divider");
    await autoUpdateOff();
    await selectPart("R1");
    let tip = await pinTip("R1", 0);
    await clickAt(tip.x, tip.y); await settle();
    assert.deepEqual((await state()).pendingPin, { componentId: "R1", pin: 0 }, "the pin click starts a wire");
    assert.match(await ev(`document.getElementById("tool-hint").textContent`), /배선 중/);
    await press("Delete", "Delete", 46);
    let now = await state();
    assert.equal(now.circuit.components.some((item) => item.id === "R1"), false, "R1 is deleted");
    assert.equal(now.pendingPin, null, "the pending wire is gone with its part");
    assert.doesNotMatch(await ev(`document.getElementById("tool-hint").textContent`), /배선 중/, "the hint text is restored");
    tip = await pinTip("R2", 0);
    await clickAt(tip.x, tip.y); await settle();
    now = await state();
    assert.deepEqual(now.pendingPin, { componentId: "R2", pin: 0 }, "a new wire starts normally");
    assert.ok(now.circuit.wires.every((wire) => [wire.a, wire.b].every((end) => end.junctionId !== undefined || now.circuit.components.some((item) => item.id === end.componentId))), "no wire points at a deleted part");
    // Cut does the same.
    await selectPart("R2");
    await ctrlKey("x", "KeyX", 88);
    now = await state();
    assert.equal(now.circuit.components.some((item) => item.id === "R2"), false);
    assert.equal(now.pendingPin, null, "cutting the start part cancels the pending wire");
  });

  test("copies and duplicates get their own reference labels; a held Ctrl+V does not stack pastes", async () => {
    await navigate("/?example=divider");
    await autoUpdateOff();
    await selectPart("R1");
    await ctrlKey("d", "KeyD", 68);
    let now = await state();
    assert.equal(now.circuit.components.at(-1).props.ref, "R3", "Ctrl+D copy of R1 is R3");
    await selectPart("R2");
    await ctrlKey("c", "KeyC", 67);
    await ctrlKey("v", "KeyV", 86);
    const afterOne = await counts();
    assert.equal(afterOne.components, 6);
    for (let n = 0; n < 3; n += 1) await ctx.cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "v", code: "KeyV", windowsVirtualKeyCode: 86, modifiers: MOD.ctrl, autoRepeat: true });
    await settle();
    assert.deepEqual(await counts(), afterOne, "auto-repeated Ctrl+V keydowns are ignored");
    now = await state();
    const refs = now.circuit.components.map((item) => item.props.ref);
    assert.equal(new Set(refs).size, refs.length, `every label is unique: ${refs.join(",")}`);
  });

  test("key ownership: a focused <select> keeps letter keys; a selected stretch of page text keeps Ctrl+A/Ctrl+C", async () => {
    await navigate("/?example=divider");
    await autoUpdateOff();
    await selectPart("R1");
    const before = await component("R1");
    await ev(`document.getElementById("example-select").focus()`);
    assert.equal(await ev(`document.activeElement.id`), "example-select");
    await press("r", "KeyR", 82);
    assert.equal((await component("R1")).rotation, before.rotation, "R on a focused list is type-ahead, not a rotation");
    await ev(`document.activeElement.blur()`);
    await press("r", "KeyR", 82);
    assert.equal((await component("R1")).rotation, ((before.rotation ?? 0) + 90) % 360, "with the focus released the same key rotates");
    // Page text selection.
    await ev(`window.__copyPrevented = []; window.addEventListener("copy", (event) => window.__copyPrevented.push(event.defaultPrevented))`);
    await ev(`(() => { const range = document.createRange(); range.selectNodeContents(document.getElementById("tool-hint")); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); return String(selection).length; })()`);
    assert.ok(await ev(`String(getSelection()).length > 0`), "a stretch of page text is selected");
    await ctrlKey("a", "KeyA", 65);
    assert.deepEqual((await state()).selection, ["component:R1"], "Ctrl+A with selected text is the browser's select-all, not the circuit's");
    await ev(`getSelection().removeAllRanges(); getSelection().selectAllChildren(document.getElementById("tool-hint"))`);
    await ctrlKey("c", "KeyC", 67);
    assert.deepEqual(await ev(`window.__copyPrevented`), [false], "Ctrl+C with selected text is left to the browser (the copy event is not taken over)");
    await ev(`getSelection().removeAllRanges()`);
    await ctrlKey("a", "KeyA", 65);
    assert.ok((await state()).selection.length > 1, "with no text selected Ctrl+A selects the circuit");
  });

  test("Shift pressed on the press but released before the click keeps the multi-selection", async () => {
    await navigate("/?example=divider");
    await autoUpdateOff();
    await selectPart("R1");
    const point = await partPoint("R2");
    await rawMouse("mouseMoved", point.x, point.y, { modifiers: MOD.shift });
    await rawMouse("mousePressed", point.x, point.y, { button: "left", buttons: 1, clickCount: 1, modifiers: MOD.shift });
    await rawMouse("mouseReleased", point.x, point.y, { button: "left", buttons: 0, clickCount: 1, modifiers: 0 });
    await settle();
    assert.deepEqual((await state()).selection.sort(), ["component:R1", "component:R2"], "Shift at the press adds R2 and the click does not collapse it");
  });

  test("touch: one finger on a selected part of a multi-selection drags the whole group", async () => {
    await navigate("/?example=divider");
    await autoUpdateOff();
    await click("#fit-button");
    await selectPart("R1");
    await shiftClickPart("R2");
    const before = await positionsOf(["R1", "R2", "V1"]);
    const depth = (await state()).historyDepth;
    const from = await partPoint("R2");
    await touchDrag(from, { x: from.x + 70, y: from.y + 40 });
    const after = await positionsOf(["R1", "R2", "V1"]);
    const dx = after.R2.x - before.R2.x, dy = after.R2.y - before.R2.y;
    assert.ok(dx !== 0 || dy !== 0, "the touched part moved");
    assert.deepEqual([after.R1.x - before.R1.x, after.R1.y - before.R1.y], [dx, dy], "the other selected part moved by the same amount");
    assert.deepEqual(after.V1, before.V1, "an unselected part stays");
    assert.equal((await state()).historyDepth, depth + 1, "one history step for the group drag");
  });

  test("pin-drag wire: a pointercancel anywhere ends it, and releasing outside the canvas abandons it", async () => {
    await navigate("/?example=divider");
    await autoUpdateOff();
    await click("#fit-button");
    const base = await counts();
    const from = await pinTip("R1", 0);
    await rawMouse("mouseMoved", from.x, from.y);
    await rawMouse("mousePressed", from.x, from.y, { button: "left", buttons: 1, clickCount: 1 });
    const bg = await bgPoint();
    for (let step = 1; step <= 4; step += 1) await rawMouse("mouseMoved", from.x + ((bg.x - from.x) * step) / 4, from.y + ((bg.y - from.y) * step) / 4, { buttons: 1 });
    await settle();
    let now = await state();
    assert.deepEqual(now.pendingPin, { componentId: "R1", pin: 0 }, "the drag started a wire");
    const owner = now.pointerOwnerId;
    assert.notEqual(owner, null);
    await ev(`window.dispatchEvent(new PointerEvent("pointercancel", { pointerId: ${owner}, pointerType: "mouse", bubbles: true }))`);
    await settle();
    now = await state();
    assert.equal(now.pendingPin, null, "the cancelled pointer cancelled the pending wire");
    assert.equal(now.pointerOwnerId, null, "and released the pointer owner");
    await rawMouse("mouseReleased", bg.x, bg.y, { button: "left", buttons: 0, clickCount: 1 });
    await settle();
    assert.deepEqual(await counts(), base, "no wire was made");
    // Released outside the canvas area (over the top bar): abandoned, even though a pin is geometrically near nothing there.
    const bar = await ev(`(() => { const rect = document.querySelector(".topbar").getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }; })()`);
    await dragBetween(await pinTip("R2", 0), bar);
    now = await state();
    assert.equal(now.pendingPin, null, "releasing outside the canvas cancels the wire (empty canvas would keep it pending)");
    assert.deepEqual(await counts(), base);
  });
  // ---- review round 2: current-flow overlay lifecycle, never-reused ids, one paste per Ctrl+V -------------------------------------------------------------

  const flowState = () => ev(`${L}.getFlow()`);
  const flowMarkup = () => ev(`document.getElementById("flow-layer").innerHTML`);

  test("current flow: the overlay clears the moment an edit makes the result stale, and a render in the middle of a move drag keeps it hidden", async () => {
    await navigate("/?example=divider");
    await autoUpdateOff();
    await runAnalysis("dc");
    await ev(`${L}.setFlow(true)`);
    assert.equal((await flowState()).status, "flow");
    assert.ok((await flowMarkup()).includes("flow-dash"), "dashes are drawn for the fresh result");
    // Typing a new value (a draft, no canvas render follows) already marks the result stale: the animation must stop right away.
    await selectPart("R1");
    await click("#inspector-tab");
    await typeInto(VALUE_INPUT, "3k");
    assert.equal((await state()).stale, true, "the draft made the result stale");
    assert.equal((await flowState()).status, "stale");
    assert.equal(await flowMarkup(), "", "no stale arrows keep animating");
    await runAnalysis("dc");
    assert.equal((await flowState()).status, "flow", "a fresh result draws again");

    // A render that arrives while a part is being carried (here a finished analysis) must not bring the overlay back under the moving wires.
    await click('[data-tool="select"]');
    const grab = await partPoint("R2");
    await dragBetween(grab, { x: grab.x + 60, y: grab.y }, {
      beforeRelease: async () => {
        assert.notEqual((await state()).pointerOwnerId, null, "the drag is in progress");
        assert.equal((await flowState()).suspended, true, "hidden while dragging");
        await ev(`${L}.runAnalysis()`);
        await ev(`${L}.forceCanvasRender()`);
        await settle();
        assert.equal((await ev(`${L}.getState().runState.status`)), "success", "the analysis finished in the middle of the drag");
        assert.equal((await flowState()).suspended, true, "the render of the finished analysis did not un-suspend the overlay");
      },
    });
    assert.equal((await flowState()).suspended, false, "the overlay is allowed again after the drag");
    assert.equal((await flowState()).status, "stale", "and the moved circuit's old result is not drawn");
  });

  test("ids are never reused: a part placed after deleting R1 gets R2, and undo does not bring the number back down", async () => {
    await navigate("/");
    await autoUpdateOff();
    const place = async () => {
      await sleep(300); // a click right after a keyboard edit or a drag release is still inside the click-suppression window
      await click('.palette-item[data-type="R"]');
      const empty = await bgPoint();
      await clickAt(empty.x, empty.y); await settle();
      await click('[data-tool="select"]');
    };
    await place();
    assert.deepEqual((await state()).circuit.components.map((item) => item.id), ["R1"]);
    await selectPart("R1");
    await press("Delete", "Delete", 46);
    assert.equal((await state()).circuit.components.length, 0);
    await place();
    const second = (await state()).circuit.components;
    assert.deepEqual(second.map((item) => item.id), ["R2"], "R1 is not handed out again");
    assert.equal(second[0].props.ref, "R2");
    await press("z", "KeyZ", 90, 2); // undo the second placement
    await place();
    assert.deepEqual((await state()).circuit.components.map((item) => item.id), ["R3"], "an undone R2 stays used");
  });

  test("one Ctrl+V pastes once whichever comes first, the native paste event or the 0 ms key fallback", async () => {
    await navigate("/?example=divider");
    await autoUpdateOff();
    const base = (await counts()).components;
    await selectPart("R1");
    await ev(`document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "c", code: "KeyC", ctrlKey: true, bubbles: true, cancelable: true }))`);
    await sleep(80);
    // Order A: the native event arrives after the fallback timer already pasted from the internal clipboard.
    const text = clipPayload([resistor("R1")]);
    await ev(`document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "v", code: "KeyV", ctrlKey: true, bubbles: true, cancelable: true }))`);
    await sleep(60);
    assert.equal((await counts()).components, base + 1, "the key fallback pasted once");
    await syntheticPaste(text);
    assert.equal((await counts()).components, base + 1, "the late native paste of the same key press does nothing");
    // Order B: the native event is raised right after the key press, before the fallback timer.
    await sleep(600);
    await ev(`(() => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "v", code: "KeyV", ctrlKey: true, bubbles: true, cancelable: true }));
      const data = new DataTransfer(); data.setData("text/plain", ${JSON.stringify(text)});
      document.body.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    })()`);
    await sleep(80); await settle();
    assert.equal((await counts()).components, base + 2, "native first: exactly one more part");
    // A menu paste long after any key press is a paste of its own.
    await sleep(600);
    await syntheticPaste(text);
    assert.equal((await counts()).components, base + 3);
  });


  // ---- review fixes: project replacement, undo, probe labels, history grouping, hashchange -----------------------------------------

  test("loading another example never carries the previous project's typed settings into it (rc-charge end 200m, then rlc)", async () => {
    await navigate("/?example=rc-charge");
    await autoUpdateOff();
    await openSettings();
    await typeInto('#analysis-settings [data-setting="end"]', "200m");
    await press("Enter", "Enter", 13);
    await waitFor(async () => (await state()).settings.end === "200m", "the typed end time to commit");
    await ev(`(() => { const s = document.getElementById("example-select"); s.value = "rlc"; s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
    await until(`${L}.getState().circuit.components.some((item) => item.id === "L1")`, "the RLC example to load");
    const loaded = await state();
    assert.notEqual(loaded.settings.end, "200m", "the typed end time did not travel into the new example");
    assert.equal(loaded.settings.analysis, "transient");
    await runAnalysis("transient");
    assert.equal((await state()).runState.status, "success", "the example runs with its own settings (no TOO_MANY_POINTS)");
    // A new circuit starts from the defaults too.
    await click("#new-button");
    await until(`${L}.getState().circuit.components.length === 0`, "the new circuit");
    assert.equal((await state()).settings.end, "5m");
  });

  test("a failed run keeps its whole diagnostic (code, message, hint, details) in the run state, and the box shows the hint", async () => {
    await navigate("/?example=rc-charge");
    await autoUpdateOff();
    await openSettings();
    await typeInto('#analysis-settings [data-setting="step"]', "1n");
    await press("Enter", "Enter", 13);
    await click("#run-button");
    await until(`${L}.getState().runState.status === "error"`, "the run to fail");
    const failed = await state();
    assert.equal(failed.runState.error.code, "TOO_MANY_POINTS");
    assert.deepEqual(Object.keys(failed.runState.error).sort(), ["code", "details", "hint", "message"]);
    assert.match(failed.runState.error.hint, /시간 간격/);
    const boxText = () => ev(`document.getElementById("error-box").innerText`);
    assert.match(await boxText(), /시간 간격/, "the hint is on screen");
    // Leaving the circuit workspace and coming back re-renders from the stored record, not from the thrown error: nothing may be lost.
    await click("#circuit-course-workspace-tab");
    await click("#circuit-workspace-tab");
    assert.match(await boxText(), /시간 간격/, "the hint is still there after a workspace round trip");
    assert.equal((await state()).runState.error.code, "TOO_MANY_POINTS");
  });

  test("undo/redo keep the finished result (marked stale), the scope cursor and the scope zoom; only the in-flight run is dropped", async () => {
    await navigate("/?example=rc-charge");
    await autoUpdateOff();
    await runAnalysis("transient");
    const point = await plotPoint(0.4);
    await clickAt(point.x, point.y);
    await settle();
    const before = await state();
    assert.notEqual(before.scope.pinnedIndex, null, "a cursor is pinned on the plot");
    await click('#scope-controls [data-scale-step="1"]');
    const scopeBefore = (await state()).scope;
    await selectPart("R1");
    await press("r", "KeyR", 82);
    assert.equal((await state()).stale, true, "the edit made the result stale");
    await click("#undo-button");
    const after = await state();
    assert.notEqual(after.result, null, "undo does not discard the finished result");
    assert.equal(after.stale, true, "…it is marked stale instead");
    assert.equal(after.runState.status, "stale");
    assert.equal(after.scope.pinnedIndex, scopeBefore.pinnedIndex, "the pinned cursor survives an undo");
    assert.deepEqual(after.scope.x, scopeBefore.x, "the scope zoom survives an undo");
    await click("#redo-button");
    assert.notEqual((await state()).result, null, "…and a redo");
    // A run that is still in flight is cancelled by an undo, never adopted afterwards.
    await runAnalysis("transient");
    await installWorkerGate(0);
    await click("#run-button");
    await until(`${L}.getState().runState.status === "running"`, "a run to be in flight");
    await click("#undo-button");
    await ev(`window.__gate.release()`);
    await sleep(300);
    assert.notEqual((await state()).runState.status, "success", "the cancelled run is not adopted");
  });

  test("renaming a part relabels its voltage probes (R2 -> Rload shows V(Rload.1))", async () => {
    await navigate("/?example=divider");
    await autoUpdateOff();
    const chip = () => ev(`[...document.querySelectorAll("#probe-list .probe-chip > span")].map((item) => item.textContent)`);
    assert.ok((await chip()).includes("V(R2.1)"), `the example probes R2: ${await chip()}`);
    await selectPart("R2");
    await click("#inspector-tab");
    await typeInto('#inspector-content [data-prop="ref"]', "Rload");
    await press("Enter", "Enter", 13);
    await waitFor(async () => (await component("R2")).props.ref === "Rload", "the new name to commit");
    await waitFor(async () => (await chip()).includes("V(Rload.1)"), "the probe chip to follow the new name");
    assert.equal((await chip()).includes("V(R2.1)"), false);
    assert.equal((await state()).probes.find((probe) => probe.key === "V:R2:0").label, "V(Rload.1)", "the stored label follows too");
  });

  test("holding an arrow is ONE history step even across the OS key-repeat delay; releasing and pressing again is a new one", async () => {
    await navigate("/?example=divider");
    await autoUpdateOff();
    await selectPart("R1");
    const start = await component("R1");
    const depth0 = (await state()).historyDepth;
    const fire = (type, repeat) => `window.dispatchEvent(new KeyboardEvent(${JSON.stringify(type)}, { key: "ArrowRight", code: "ArrowRight", bubbles: true, cancelable: true, repeat: ${repeat} }))`;
    await ev(`(async () => {
      const wait = (ms) => new Promise((done) => setTimeout(done, ms));
      ${fire("keydown", false)};
      await wait(550); // Windows' default key-repeat delay is longer than the old 400 ms grouping window
      for (let n = 0; n < 5; n += 1) { ${fire("keydown", true)}; await wait(35); }
      ${fire("keyup", false)};
    })()`);
    await settle();
    const held = await state();
    assert.equal((await component("R1")).x, start.x + 6 * GRID, "six repeats moved the part six grid steps");
    assert.equal(held.historyDepth, depth0 + 1, "the whole hold is one undo step");
    await ev(`(${fire("keydown", false)}, ${fire("keyup", false)})`);
    assert.equal((await state()).historyDepth, depth0 + 2, "a fresh press after the release is a new step");
    await click("#undo-button");
    assert.equal((await component("R1")).x, start.x + 6 * GRID);
    await click("#undo-button");
    assert.equal((await component("R1")).x, start.x, "one undo takes back the entire held move");
  });

  test("dragging a part back to where it started records no history and keeps the result fresh", async () => {
    await navigate("/?example=divider");
    await autoUpdateOff();
    await runAnalysis("dc");
    const before = await state();
    const home = await partPoint("R1");
    const send = (type, x, y, extra = {}) => ctx.cdp.send("Input.dispatchMouseEvent", { type, x, y, ...extra });
    await send("mouseMoved", home.x, home.y);
    await send("mousePressed", home.x, home.y, { button: "left", buttons: 1, clickCount: 1 });
    for (let step = 1; step <= 5; step += 1) await send("mouseMoved", home.x + 12 * step, home.y + 8 * step, { buttons: 1 });
    assert.equal((await state()).drag?.moved, true, "the part is really being carried");
    for (let step = 4; step >= 0; step -= 1) await send("mouseMoved", home.x + 12 * step, home.y + 8 * step, { buttons: 1 });
    await send("mouseReleased", home.x, home.y, { button: "left", buttons: 0, clickCount: 1 });
    await settle();
    const after = await state();
    assert.deepEqual(after.circuit, before.circuit, "the part is exactly where it was");
    assert.equal(after.historyDepth, before.historyDepth, "no history entry for a net displacement of zero");
    assert.equal(after.stale, false, "the result is not marked stale");
    assert.equal(after.generation, before.generation, "nothing changed, so the generation did not move");
    // A real move still counts.
    await dragPart("R1", 40, 0);
    assert.equal((await state()).historyDepth, before.historyDepth + 1);
    assert.equal((await state()).stale, true);
  });

  test("Backspace deletes the selection like Delete (one undo step), but not while typing in a field", async () => {
    await navigate("/?example=divider");
    await autoUpdateOff();
    await selectPart("R1");
    const count = (await state()).circuit.components.length;
    const depth0 = (await state()).historyDepth;
    await press("Backspace", "Backspace", 8);
    assert.equal((await state()).circuit.components.length, count - 1, "Backspace removed the selected part");
    assert.equal((await state()).historyDepth, depth0 + 1);
    await click("#undo-button");
    assert.equal((await state()).circuit.components.length, count);
    // In a text field Backspace edits the text and leaves the circuit alone.
    await selectPart("R2");
    await click("#inspector-tab");
    await typeInto(VALUE_INPUT, "1k");
    await press("Backspace", "Backspace", 8);
    assert.equal((await state()).circuit.components.length, count, "Backspace in an input does not delete the part");
    await click("#discard-drafts-button").catch(() => {});
  });

  test("pasting a #p= link into an open tab opens it (one undo step), clears the address bar and keeps the old work in the prev slot", async () => {
    await clearBrowserStorage();
    await navigate("/?example=rc-lowpass");
    await ev(`Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text) => { window.__copied = text; } } })`);
    const label = await center('.component[data-id="R1"] .value-label');
    await wheelAt(label.x, label.y, -100);
    await settle();
    await click("#share-button");
    const url = await until(`window.__copied`, "the share link to be copied");
    const original = await state();

    const second = await openTab();
    try {
      await second.run(async () => {
        await clearBrowserStorage();
        await navigate("/?example=divider");
        await selectPart("R1");
        await press("r", "KeyR", 82);
        const tab = await tabIdOf();
        await waitFor(async () => Boolean((await autosaveSlots())[tab]), "the divider to be autosaved");
        const depth0 = (await state()).historyDepth;
        // What the user does: paste the link into the address bar of this very tab (a hash-only navigation raises hashchange).
        await ev(`location.hash = ${JSON.stringify(url.slice(url.indexOf("#")))}`);
        await until(`${L}.getState().circuit.components.some((item) => item.id === "R1") && ${L}.getState().title !== "분압기 (DC)"`, "the shared circuit to replace the divider");
        const opened = await state();
        assert.deepEqual(opened.circuit, original.circuit, "the pasted link shows the shared circuit");
        assert.equal(opened.historyDepth, depth0 + 1, "opening the link is one undo step");
        await until(`document.getElementById("canvas-notices").textContent.includes("공유 링크에서 불러왔습니다")`, "the notice");
        assert.equal(await ev(`location.hash`), "", "the link is spent: a reload does not bring it back over later work");
        // The old project survives: its slot (own or prev) still holds the divider after the shared circuit gets its first save.
        await selectPart("R1");
        await press("r", "KeyR", 82);
        await waitFor(async () => (await autosaveSlots())[`${tab}.prev`]?.project?.title === "분압기 (DC)", "the divider to be kept in the prev slot");
        const slots = await autosaveSlots();
        assert.equal(slots[tab].project.title !== "분압기 (DC)", true, "the tab's own slot now holds the shared circuit");
        assert.equal(Object.keys(slots).filter((key) => key.startsWith(tab)).length, 2, "exactly one own slot and one prev slot");
        await click("#undo-button");
        await click("#undo-button");
        assert.equal((await state()).circuit.components.some((item) => item.id === "R2"), true, "undo brings the divider back");
      });
    } finally { await second.close(); }
  });

  test("autosave on replacement: the last edit before 'new circuit' is saved, and the next edit does not overwrite it (prev slot)", async () => {
    await clearBrowserStorage();
    await navigate("/?example=divider");
    const tab = await tabIdOf();
    await selectPart("R1");
    await press("r", "KeyR", 82);
    const rotated = (await component("R1")).rotation;
    // Replace the project inside the 0.8 s debounce window: the pending save must be flushed, not dropped.
    await click("#new-button");
    await until(`${L}.getState().circuit.components.length === 0`, "the empty circuit");
    const slots = await autosaveSlots();
    assert.equal(slots[tab]?.project?.circuit?.components?.find((item) => item.id === "R1")?.rotation, rotated, "the final state of the replaced project is in the slot");
    // The first save of the new project moves it to prev.
    await click('.palette-item[data-type="R"]');
    const spot = await bgPoint();
    await clickAt(spot.x, spot.y);
    await settle();
    await waitFor(async () => (await autosaveSlots())[`${tab}.prev`]?.project?.circuit?.components?.find((item) => item.id === "R1")?.rotation === rotated, "the replaced project to be kept as prev");
    const after = await autosaveSlots();
    assert.equal(after[tab].project.circuit.components.length, 1, "the own slot holds the new work");
    // After a reload the banner offers the most recent work that is not already on screen.
    await reloadPage();
    await until(`document.querySelectorAll("#canvas-notices .canvas-notice").length >= 1`, "the restore banner");
  });

  // ---- review fixes: share-link autosave/race, prev-slot safety, undo across a project boundary, late drag frame ----------------------------------------

  const titleNow = () => ev(`document.getElementById("canvas-title").textContent`);
  /** The share URL of an example, copied through a stubbed clipboard. */
  async function shareUrlOf(exampleId) {
    await navigate(`/?example=${exampleId}`);
    await ev(`window.__copied = null; Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text) => { window.__copied = text; } } })`);
    await click("#share-button");
    const url = await until(`window.__copied`, "the share link to be copied");
    return { url, hash: url.slice(url.indexOf("#")), title: await titleNow() };
  }

  test("a #p= link pasted into an open tab is autosaved right away: a reload before any edit does not lose it", async () => {
    await clearBrowserStorage();
    const shared = await shareUrlOf("rc-lowpass");
    await clearBrowserStorage();
    await navigate("/?example=divider");
    const tab = await tabIdOf();
    await selectPart("R1");
    await press("r", "KeyR", 82);
    await waitFor(async () => Boolean((await autosaveSlots())[tab]), "the divider to be autosaved");
    await ev(`location.hash = ${JSON.stringify(shared.hash)}`);
    await until(`document.getElementById("canvas-title").textContent === ${JSON.stringify(shared.title)}`, "the shared circuit to replace the divider");
    assert.equal(await ev(`location.hash`), "", "the link is spent");
    // No edit at all: the opened circuit must still reach the autosave (the address bar no longer carries it).
    await waitFor(async () => (await autosaveSlots())[tab]?.project?.title === shared.title, "the opened share link to be autosaved without any edit");
    await waitFor(async () => (await autosaveSlots())[`${tab}.prev`]?.project?.title === "분압기 (DC)", "the divider to be kept in prev");
  });

  test("two share links opened in quick succession: the newer one wins (the older request is superseded, not the newer cancelled)", async () => {
    await clearBrowserStorage();
    await navigate("/?example=rlc");
    const linkOf = (id) => ev(`(async () => {
      const share = await import("/src/share-url.js");
      const examples = await import("/src/examples.js");
      const e = examples.cloneExample(${JSON.stringify(id)});
      const out = await share.encodeProjectToHash({ title: e.name, subtitle: e.description, circuit: e.circuit, settings: e.settings, probes: [] }, { baseHref: location.href.split("#")[0], compress: true });
      return { hash: out.hash, title: e.name };
    })()`);
    const first = await linkOf("rc-lowpass");
    const second = await linkOf("divider");
    assert.notEqual(first.title, second.title);
    // Decoding is made slow in the page (the first link ~150 ms, the second ~700 ms), so the first request finishes while the second is still decoding.
    await ev(`(() => {
      let count = 0; const seen = new WeakSet(); const original = ReadableStreamDefaultReader.prototype.read;
      window.__origRead = original;
      ReadableStreamDefaultReader.prototype.read = function (...args) {
        if (seen.has(this)) return original.apply(this, args);
        seen.add(this); count += 1;
        const delay = count === 1 ? 150 : count === 2 ? 700 : 0;
        return new Promise((resolve) => setTimeout(resolve, delay)).then(() => original.apply(this, args));
      };
      location.hash = ${JSON.stringify(first.hash)};
      setTimeout(() => { location.hash = ${JSON.stringify(second.hash)}; }, 50);
    })()`);
    try {
      await until(`document.getElementById("canvas-title").textContent === ${JSON.stringify(second.title)}`, "the newer link to be opened");
      await sleep(300);
      assert.equal(await titleNow(), second.title);
      assert.equal((await noticeTexts()).some((text) => text.includes("취소")), false, "the newer link was not cancelled");
    } finally {
      await ev(`if (window.__origRead) ReadableStreamDefaultReader.prototype.read = window.__origRead`);
    }
  });

  test("restore candidate is the tab's .prev while own is corrupt: the next save neither rotates the corrupt own over prev nor loses the offered work", async () => {
    await clearBrowserStorage();
    await navigate("/?example=divider");
    const tab = await tabIdOf();
    await selectPart("R1");
    await press("r", "KeyR", 82);
    await waitFor(async () => Boolean((await autosaveSlots())[tab]), "the divider to be autosaved");
    // own becomes unreadable, the good copy sits in prev.
    await ev(`(() => { const own = ${JSON.stringify(AUTOSAVE_PREFIX)} + sessionStorage.getItem("circuit-lab.tab-id"); localStorage.setItem(own + ".prev", localStorage.getItem(own)); localStorage.setItem(own, "{corrupt"); })()`);
    await navigate("/");
    await until(`document.querySelectorAll("#canvas-notices .canvas-notice").length >= 1`, "the restore banner offering prev");
    await click('.palette-item[data-type="R"]');
    const spot = await bgPoint();
    await clickAt(spot.x, spot.y);
    await settle();
    await waitFor(async () => {
      const own = await ev(`localStorage.getItem(${JSON.stringify(AUTOSAVE_PREFIX + tab)})`);
      try { return JSON.parse(own).project.circuit.components.length === 1; } catch { return false; }
    }, "the new edit to be saved into own");
    const slots = await autosaveSlots(); // throws if prev became the corrupt text
    assert.equal(slots[`${tab}.prev`]?.project?.title, "분압기 (DC)", "the offered prev survives the first save");
    await clickNoticeButton("복원");
    assert.equal((await state()).circuit.components.some((item) => item.id === "R2"), true, "restoring still brings the divider back");
  });

  test("undo across a project boundary keeps the project it leaves: own=B, prev=A -> undo to A -> own=A, prev=B", async () => {
    await clearBrowserStorage();
    await navigate("/?example=divider");
    const tab = await tabIdOf();
    await selectPart("R1");
    await press("r", "KeyR", 82);
    await waitFor(async () => Boolean((await autosaveSlots())[tab]), "the divider to be autosaved");
    await click("#new-button");
    await until(`${L}.getState().circuit.components.length === 0`, "the empty circuit");
    await sleep(300);
    await click('.palette-item[data-type="R"]');
    const spot = await bgPoint();
    await clickAt(spot.x, spot.y);
    await settle();
    await waitFor(async () => (await autosaveSlots())[tab]?.project?.circuit?.components?.length === 1 && (await autosaveSlots())[`${tab}.prev`]?.project?.title === "분압기 (DC)", "own=new circuit, prev=divider");
    await click("#undo-button"); // the placed part
    await click("#undo-button"); // the new circuit -> back to the divider (another project)
    await until(`document.getElementById("canvas-title").textContent === "분압기 (DC)"`, "the divider to be restored");
    await waitFor(async () => (await autosaveSlots())[tab]?.project?.title === "분압기 (DC)", "own to hold the restored divider");
    await sleep(900);
    const slots = await autosaveSlots();
    assert.equal(slots[tab].project.title, "분압기 (DC)");
    assert.equal(slots[`${tab}.prev`]?.project?.circuit?.components?.length, 1, "the one-part project undo left behind is kept in prev (not overwritten with the divider)");
    assert.notEqual(slots[`${tab}.prev`]?.project?.title, "분압기 (DC)");
  });

  test("move drag: a drag frame still queued when the pointer is released does not hide the flow overlay afterwards", async () => {
    await navigate("/?example=divider");
    await autoUpdateOff();
    await runAnalysis("dc");
    await ev(`${L}.setFlow(true)`);
    assert.equal((await flowState()).status, "flow");
    await click('[data-tool="select"]');
    const grab = await partPoint("R2");
    // Out and straight back to the start: the move is a no-op, so the result stays fresh and the overlay has to be visible after the release.
    // Frames requested during the last moves are held back and run only after the release (a drag frame that is still pending when the pointer goes up).
    const send = (type, x, y, extra = {}) => ctx.cdp.send("Input.dispatchMouseEvent", { type, x, y, ...extra });
    await dragBetween(grab, { x: grab.x + 40, y: grab.y }, {
      steps: 3,
      beforeRelease: async () => {
        await ev(`(() => { window.__heldFrames = []; window.__realRaf = window.requestAnimationFrame; window.requestAnimationFrame = (callback) => window.__heldFrames.push(callback); })()`);
        await send("mouseMoved", grab.x + 20, grab.y, { buttons: 1 });
        await send("mouseMoved", grab.x, grab.y, { buttons: 1 });
        assert.ok((await ev(`window.__heldFrames.length`)) >= 1, "a drag frame is queued");
        assert.equal((await flowState()).suspended, true, "hidden while the drag is active");
      },
    });
    // dragBetween released at (grab + 40) without moving there: the item sits at its start position, so nothing changed.
    assert.equal((await state()).pointerOwnerId, null, "the gesture is over");
    await ev(`(() => { window.requestAnimationFrame = window.__realRaf; const held = window.__heldFrames; window.__heldFrames = []; for (const callback of held) callback(performance.now()); })()`);
    await sleep(150);
    assert.equal((await flowState()).status, "flow", "the move was a no-op: the result is still fresh");
    assert.equal((await flowState()).suspended, false, "the late drag frame did not hide the overlay after the release");
  });

  // ---- signals workspace: all six lessons, keyboard, playback, touch, reduced motion, custom input ----------------------
  const SG_LESSONS = [["time", "a", 2.5], ["convolution", "T1", 3], ["series", "N", 3], ["fourier", "T", 2.5], ["roc", "re", -2], ["sampling", "f0", 4]];
  const SG_KEYED = new Set(["time", "convolution", "series", "roc"]); // views with key handling are focusable, the others are not
  const sgSvgExpr = `document.querySelector(".sg-stage > div:not([hidden]) svg")`;
  const sgState = () => ev(`${L}.getSignalsCourseState()`);
  async function openSignals(lesson, view) {
    await navigate("/", view);
    await click("#signals-workspace-tab");
    await until(`${L}.getSignalsCourseState()?.active === true`, "the signals workspace");
    await until(`document.querySelectorAll("[data-signals-lesson]").length > 0`, "lesson buttons");
    if (lesson !== "time") await click(`[data-signals-lesson="${lesson}"]`);
    await until(`${L}.getSignalsCourseState().lessonId === ${JSON.stringify(lesson)}`, `the ${lesson} lesson`);
    await until(`Boolean(${sgSvgExpr}) && ${sgSvgExpr}.querySelectorAll("path,line,circle").length > 10`, "the plot to be drawn");
    await settle();
  }
  async function pauseSignals() {
    if ((await sgState()).playing) await click("[data-signals-play]");
    await until(`${L}.getSignalsCourseState().playing === false`, "playback to be paused");
  }
  const sgSignature = () => ev(`(() => { const svg = ${sgSvgExpr}; return svg.innerHTML.length + ":" + [...svg.querySelectorAll("[d],[x1],[cx],[x]")].map((e) => e.getAttribute("d") ?? e.getAttribute("x1") ?? e.getAttribute("cx") ?? e.getAttribute("x")).join("|"); })()`);
  const sgNodeCount = () => ev(`document.querySelectorAll("#signals-workspace *").length`);
  const setSgParam = (key, value) => ev(`(() => { const input = document.querySelector('[data-signals-param="${key}"]'); input.value = ${JSON.stringify(String(value))}; input.dispatchEvent(new Event("input", { bubbles: true })); return input.value; })()`);

  test("signals: every lesson renders and a slider change redraws it; a11y wiring of controls and plots", async () => {
    for (const [lesson, key, value] of SG_LESSONS) {
      await openSignals(lesson);
      await pauseSignals().catch(() => {}); // lessons without a scrubber have nothing to pause
      const before = await sgSignature();
      await setSgParam(key, value);
      await until(`${L}.getSignalsCourseState().params[${JSON.stringify(key)}] === ${value}`, `${lesson}: the parameter ${key}`);
      await settle();
      assert.notEqual(await sgSignature(), before, `${lesson}: the plot changed with ${key}`);
      const a11y = await ev(`(() => {
        const svg = ${sgSvgExpr};
        const outputs = [...document.querySelectorAll("#signals-workspace .sg-ctl output")];
        const sliders = [...document.querySelectorAll('#signals-workspace input[data-signals-param]')];
        const describedBy = svg.getAttribute("aria-describedby");
        return {
          outputsLiveOff: outputs.length > 0 && outputs.every((o) => o.getAttribute("aria-live") === "off"),
          valueText: sliders.length > 0 && sliders.every((s) => (s.getAttribute("aria-valuetext") || "").length > 0),
          noPressed: !document.querySelector("[data-signals-play]")?.hasAttribute("aria-pressed"),
          tabindex: svg.getAttribute("tabindex"),
          descValid: describedBy ? svg.querySelector("#" + describedBy)?.textContent.length > 5 : null,
          titleLength: svg.querySelector("title").textContent.length,
          touchAction: getComputedStyle(svg).touchAction,
        };
      })()`);
      assert.equal(a11y.outputsLiveOff, true, `${lesson}: <output> is aria-live off`);
      assert.equal(a11y.valueText, true, `${lesson}: sliders carry aria-valuetext`);
      assert.equal(a11y.noPressed, true, `${lesson}: the play button swaps its label instead of aria-pressed`);
      assert.ok(a11y.titleLength > 0 && a11y.titleLength <= 40, `${lesson}: short svg title (${a11y.titleLength})`);
      assert.equal(a11y.touchAction, "pan-y", `${lesson}: the page keeps vertical touch scrolling`);
      if (SG_KEYED.has(lesson)) {
        assert.equal(a11y.tabindex, "0", `${lesson}: a view with key handling is focusable`);
        assert.equal(a11y.descValid, true, `${lesson}: key hints are exposed through aria-describedby`);
      } else {
        assert.equal(a11y.tabindex, null, `${lesson}: a view without key handling is not a tab stop`);
        assert.equal(a11y.descValid, null);
      }
    }
  });

  test("signals: the keyboard moves the cursor (arrows, Home/End) and Space toggles playback", async () => {
    await openSignals("convolution");
    await pauseSignals();
    await ev(`${sgSvgExpr}.focus()`);
    const start = (await sgState()).cursor;
    await press("ArrowRight", "ArrowRight", 39);
    const moved = (await sgState()).cursor;
    assert.ok(moved > start, `ArrowRight moves the cursor right (${start} -> ${moved})`);
    await press("ArrowLeft", "ArrowLeft", 37);
    near((await sgState()).cursor, start, 0, "ArrowLeft goes back", 1e-9);
    await press("ArrowRight", "ArrowRight", 39, MOD.shift);
    assert.ok((await sgState()).cursor - start > (moved - start) * 5, "Shift moves ten steps");
    await press("End", "End", 35);
    const end = (await sgState()).cursor;
    await press("Home", "Home", 36);
    assert.ok((await sgState()).cursor < end);
    await press(" ", "Space", 32);
    await until(`${L}.getSignalsCourseState().playing === true`, "Space to start playback");
    assert.equal(await ev(`document.querySelector("[data-signals-play]").textContent`), "일시정지");
    await press(" ", "Space", 32);
    await until(`${L}.getSignalsCourseState().playing === false`, "Space to pause playback");
    assert.equal(await ev(`document.querySelector("[data-signals-play]").textContent`), "재생");
    // the time lesson has a draggable marker moved by the same keys
    await openSignals("time");
    await ev(`${sgSvgExpr}.focus()`);
    const marker = (await sgState()).cursor;
    await press("ArrowRight", "ArrowRight", 39);
    assert.ok((await sgState()).cursor > marker, "ArrowRight moves the time-lesson marker");
    // the ROC view moves the pole with the arrows
    await openSignals("roc");
    await ev(`${sgSvgExpr}.focus()`);
    const pole = (await sgState()).params.re;
    await press("ArrowRight", "ArrowRight", 39);
    assert.ok((await sgState()).params.re > pole, "ArrowRight moves the pole");
  });

  test("signals: a plot drag takes playback over, parameter sliders do not; reaching the end clears the playing flag", async () => {
    await openSignals("convolution");
    await until(`${L}.getSignalsCourseState().playing === true`, "autoplay to start");
    await setSgParam("T1", 3);
    await settle();
    assert.equal((await sgState()).playing, true, "turning a parameter slider keeps the animation running");
    const box = await ev(`(() => { const r = ${sgSvgExpr}.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
    await dragBetween({ x: box.x + box.w * 0.4, y: box.y + box.h * 0.2 }, { x: box.x + box.w * 0.6, y: box.y + box.h * 0.2 });
    assert.equal((await sgState()).playing, false, "dragging in the plot stops playback");
    const dropped = (await sgState()).cursor;
    await sleep(300);
    assert.equal((await sgState()).cursor, dropped, "and the cursor stays where it was dropped");
    // end of the sweep: scrub almost to the end, press play, and the animation ends by itself with playing === false
    const scrub = await ev(`(() => { const i = document.querySelector("[data-signals-cursor]"); return { max: Number(i.max), min: Number(i.min) }; })()`);
    await ev(`(() => { const i = document.querySelector("[data-signals-cursor]"); i.value = ${scrub.max - (scrub.max - scrub.min) / 200}; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    await click("[data-signals-play]");
    await until(`${L}.getSignalsCourseState().playing === false && document.querySelector("[data-signals-play]").textContent === "재생"`, "the animation to end", 8000);
    near((await sgState()).cursor, scrub.max, 0, "the cursor ended at the end", 1e-6);
    await sleep(200);
    assert.equal((await sgState()).playing, false, "an ended animation does not restart by itself");
  });

  test("signals: leaving the workspace stops playback and every animation frame", async () => {
    await openSignals("convolution");
    await until(`${L}.getSignalsCourseState().playing === true`, "autoplay to start");
    await click("#circuit-workspace-tab");
    await until(`${L}.getSignalsCourseState().active === false`, "signals to be deactivated");
    const after = await sgState();
    assert.equal(after.playing, false, "no playback while hidden");
    await sleep(400);
    assert.equal((await sgState()).cursor, after.cursor, "the cursor no longer advances");
    // frames requested from here on must not come from the signals workspace: count them while it is idle
    await ev(`(() => { window.__sgFrames = 0; const raf = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = (cb) => { window.__sgFrames += 1; return raf(cb); }; })()`);
    await sleep(400);
    const frames = await ev(`window.__sgFrames`);
    assert.ok(frames <= 3, `an idle page keeps no animation loop running (${frames} frames)`);
    // coming back resumes only because playback was still wanted (it never reached the end)
    await click("#signals-workspace-tab");
    await until(`${L}.getSignalsCourseState().active === true && ${L}.getSignalsCourseState().playing === true`, "playback to resume on return");
  });

  test("signals: parameter drags and repaints never create new SVG nodes", async () => {
    for (const [lesson, key] of SG_LESSONS) {
      await openSignals(lesson);
      await pauseSignals().catch(() => {});
      const spec = await ev(`(() => { const i = document.querySelector('[data-signals-param="${key}"]'); return { min: Number(i.min), max: Number(i.max), step: Number(i.step) }; })()`);
      const sweep = () => ev(`(async () => {
        const input = document.querySelector('[data-signals-param="${key}"]');
        const steps = Math.floor((${spec.max} - ${spec.min}) / ${spec.step});
        for (let i = 0; i < 100; i += 1) {
          input.value = String(${spec.min} + ((i * 7) % (steps + 1)) * ${spec.step});
          input.dispatchEvent(new Event("input", { bubbles: true }));
          if (i % 10 === 9) await new Promise((done) => requestAnimationFrame(done));
        }
      })()`);
      await sweep(); // warm-up: pooled tick/stem elements are created lazily up to their maximum
      await settle();
      const before = await sgNodeCount();
      await sweep();
      await settle();
      assert.equal(await sgNodeCount(), before, `${lesson}: node count is stable across 100 slider inputs`);
    }
  });

  test("signals: time lesson writes a = 0 back as a legal value and says why", async () => {
    await openSignals("time");
    assert.equal(await setSgParam("a", 0), "0");
    await until(`${L}.getSignalsCourseState().params.a !== 0`, "a to be normalized");
    await settle();
    const after = await sgState();
    assert.equal(after.params.a, 0.1);
    assert.equal(await ev(`document.querySelector('[data-signals-param="a"]').value`), "0.1", "the slider jumped to the value that is drawn");
    assert.match(await ev(`document.querySelector("[data-signals-read]").textContent`), /a=0은 정의되지 않음/);
    await setSgParam("a", 2);
    await settle();
    assert.doesNotMatch(await ev(`document.querySelector("[data-signals-read]").textContent`), /정의되지 않음/, "the note goes away with a legal a");
  });

  test("signals: touch only claims the gesture on a draggable handle; elsewhere the page can scroll", async () => {
    await openSignals("roc", { width: 390, height: 844, mobile: true });
    await ev(`window.__touchStarts = []; window.addEventListener("touchstart", (event) => window.__touchStarts.push(event.defaultPrevented), { passive: true });`);
    const spots = await ev(`(() => {
      const svg = ${sgSvgExpr};
      svg.scrollIntoView({ block: "center" });
      const cross = [...svg.querySelectorAll("path.ref.thick.c4")].find((p) => p.getAttribute("visibility") === "visible").getBoundingClientRect();
      const frame = svg.querySelector(".sg-frame").getBoundingClientRect();
      return { pole: { x: cross.x + cross.width / 2, y: cross.y + cross.height / 2 }, empty: { x: frame.x + frame.width - 14, y: frame.y + frame.height - 14 } };
    })()`);
    const tap = async (point) => {
      await ctx.cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
      await ctx.cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await settle();
    };
    await tap(spots.pole); // a tap on the plane moves the pole, so the pole goes first
    await tap(spots.empty);
    assert.deepEqual(await ev(`window.__touchStarts`), [true, false], "a pole is grabbed, an empty spot of the plane scrolls the page");
    await navigate("/"); // back to the desktop viewport for the next scenarios
  });

  test("signals: reduced motion switches auto-play off but a press on play still plays", async () => {
    await openSignals("convolution");
    await until(`${L}.getSignalsCourseState().playing === true`, "autoplay to start");
    await ctx.cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    try {
      await until(`${L}.getSignalsCourseState().reducedMotion === true && ${L}.getSignalsCourseState().playing === false`, "the setting to stop playback");
      assert.equal(await ev(`document.querySelector("[data-signals-play]").disabled`), false, "the play button stays usable");
      assert.match(await ev(`document.querySelector("[data-signals-play]").title`), /움직임 줄이기/);
      await click("[data-signals-play]");
      await until(`${L}.getSignalsCourseState().playing === true`, "a pressed play button to play");
      await click("[data-signals-play]");
      await until(`${L}.getSignalsCourseState().playing === false`, "a second press to pause");
      // a new lesson does not start by itself under the setting
      await click('[data-signals-lesson="series"]');
      await until(`${L}.getSignalsCourseState().lessonId === "series"`, "the series lesson");
      await sleep(250);
      assert.equal((await sgState()).playing, false, "no auto-play under reduced motion");
    } finally {
      await ctx.cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "" }] });
    }
  });

  test("signals: invalid first input draws an explicit empty state; a valid one clears the message and the picture returns", async () => {
    await openSignals("convolution");
    await pauseSignals();
    await click("[data-signals-advanced] summary");
    await typeInto('[data-signals-field="x"]', "1,,2");
    await until(`${L}.getSignalsCourseState().family === "custom-dt" && ${L}.getSignalsCourseState().numericStatus === "invalid"`, "the invalid sequence to be reported");
    await settle();
    assert.match(await ev(`document.querySelector("[data-signals-status]").textContent`), /\S/, "an error message is shown");
    assert.equal(await ev(`[...${sgSvgExpr}.querySelectorAll("text")].some((t) => t.textContent === "수열을 입력하세요" && t.getAttribute("visibility") === "visible")`), true, "the empty state replaces the previous picture");
    await typeInto('[data-signals-field="x"]', "1,2,1");
    await until(`${L}.getSignalsCourseState().numericStatus === "valid"`, "the valid sequence");
    await settle();
    assert.equal(await ev(`document.querySelector("[data-signals-status]").textContent`), "", "the message is cleared once a paint succeeds");
    assert.equal(await ev(`[...${sgSvgExpr}.querySelectorAll("text")].some((t) => t.textContent === "수열을 입력하세요" && t.getAttribute("visibility") === "visible")`), false);
  });

  test("signals: the window losing focus pauses playback and regaining it resumes", async () => {
    await openSignals("convolution");
    await until(`${L}.getSignalsCourseState().playing === true`, "autoplay to start");
    await ev(`window.dispatchEvent(new Event("blur"))`);
    await until(`${L}.getSignalsCourseState().playing === false`, "blur to pause");
    const paused = (await sgState()).cursor;
    await sleep(250);
    assert.equal((await sgState()).cursor, paused, "no progress while blurred");
    await ev(`window.dispatchEvent(new Event("focus"))`);
    await until(`${L}.getSignalsCourseState().playing === true`, "focus to resume");
  });

  // ---- redesigned 전자기학 workspace: plane sandbox, test-charge sensor, Gauss surface, inline inspector, palette, 3D tab, course, theme, phone ----------
  const emState = () => ev(`${L}.getEMState()`);
  const emPg = async () => (await emState()).playground;
  const emSource = async (id) => (await emPg()).sources.find((source) => source.id === id);
  /** Open the EM workspace on a fresh page (lazy-loaded through the real tab click) and wait for the plane canvas to be sized and drawn. */
  async function openEM(options) {
    await navigate("/", options);
    await click("#em-workspace-tab");
    await ev(`${L}.ensureWorkspace("em").then((controller) => typeof controller.inspect)`);
    await until(`${L}.getEMState()?.active === true && document.getElementById("em-plane").clientWidth > 100 && ${L}.getEMState().diagnostics.frames > 0`, "the EM plane to be drawn");
    await settle();
  }
  /** Screen point (and px per metre) of a world position (a, b) of the plane canvas, using the view the app reports. */
  const emScreen = (a, b) => ev(`(() => {
    const s = ${L}.getEMState(), c = document.getElementById("em-plane"); c.scrollIntoView({ block: "nearest", inline: "nearest" });
    const r = c.getBoundingClientRect(), w = c.clientWidth, h = c.clientHeight, scale = Math.min(w, h) / (2 * s.view.span);
    return { x: r.left + w / 2 + (${a} - s.view.offset[0]) * scale, y: r.top + h / 2 - (${b} - s.view.offset[1]) * scale, scale };
  })()`);
  /** FNV hash of every pixel of the canvases (the plane view has a cached base layer and a live overlay: pass both ids). */
  const canvasHash = (...ids) => ev(`(() => {
    let h = 2166136261 >>> 0;
    for (const id of ${JSON.stringify(ids)}) {
      const c = document.getElementById(id), data = c.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data;
      for (let i = 0; i < data.length; i += 1) { h ^= data[i]; h = Math.imul(h, 16777619) >>> 0; }
    }
    return h;
  })()`);
  const planeHash = () => canvasHash("em-plane-base", "em-plane");
  /** Number of distinct colours on a canvas (a blank canvas has one), counted up to 51: proves something was really drawn. */
  const colorCount = (id) => ev(`(() => { const c = document.getElementById(${JSON.stringify(id)}), d = c.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data; const seen = new Set(); for (let i = 0; i < d.length; i += 4) { seen.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]); if (seen.size > 50) break; } return seen.size; })()`);
  const sensorRows = () => ev(`Object.fromEntries([...document.querySelectorAll("#em-sensor-rows dt")].map((dt) => [dt.textContent.trim(), dt.nextElementSibling.textContent.trim()]))`);
  const K_COULOMB = 8.9875517923e9, EPS0_SI = 8.8541878128e-12;
  /** Coulomb field magnitude and potential of the point charges in `sources` at world point `p` (independent of the app's evaluator). */
  function coulomb(sources, p) {
    let ex = 0, ey = 0, ez = 0, potential = 0;
    for (const source of sources) {
      if (source.type !== "point" || source.enabled === false) continue;
      const d = p.map((value, axis) => value - source.position[axis]), r = Math.hypot(...d);
      ex += (K_COULOMB * source.q * d[0]) / r ** 3; ey += (K_COULOMB * source.q * d[1]) / r ** 3; ez += (K_COULOMB * source.q * d[2]) / r ** 3;
      potential += (K_COULOMB * source.q) / r;
    }
    return { magnitude: Math.hypot(ex, ey, ez), potential };
  }
  const gaussLines = () => ev(`[...document.querySelectorAll("#em-gauss-lines p")].map((p) => p.textContent)`);
  /** The flux numbers of the Gauss readout: expected Q/eps0 and the numeric surface integral, plus its tag. */
  async function gaussFlux() {
    const lines = await gaussLines();
    const expected = /Φ = Q\/ε₀ = (\S+) V·m/.exec(lines[1] ?? ""), numeric = /∮E·dA = (\S+) V·m\s+\((.+)\)/.exec(lines[2] ?? "");
    const read = (match) => (match ? Number(match[1].replace("−", "-")) : NaN);
    return { lines, expected: read(expected), numeric: read(numeric), tag: numeric?.[2] ?? "", charge: lines[0] };
  }
  /** Drag the Gauss circle by grabbing it inside the ring (away from the charge handle underneath) and moving its centre to world (a, b). */
  async function dragGaussTo(a, b) {
    const { gauss } = await emState();
    const centre = await emScreen(gauss.center[0], gauss.center[1]), target = await emScreen(a, b);
    const grab = { x: centre.x, y: centre.y + gauss.radius * centre.scale * 0.5 };
    assert.ok(gauss.radius * centre.scale * 0.5 > 26, "the ring is big enough to grab beside the charge handle");
    await dragBetween(grab, { x: grab.x + (target.x - centre.x), y: grab.y + (target.y - centre.y) });
  }

  /** A real Enter key press including its character ("\u000d"): the text field commits its value (change event) like in a user's browser. */
  async function pressEnter() {
    await ctx.cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\u000d" });
    await ctx.cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    await settle();
  }

  test("EM plane: default sources are drawn; dragging q1 moves it, re-renders the canvas and undo restores it", async () => {
    await openEM();
    const initial = await emState();
    assert.equal(initial.tab, "plane");
    assert.equal(initial.scene, "playground");
    assert.deepEqual(initial.playground.sources.map((source) => [source.id, source.q, source.position]), [["q1", 1e-9, [-0.75, 0, 0]], ["q2", -1e-9, [0.75, 0, 0]]], "the default sandbox is a +1 nC / -1 nC pair");
    assert.equal(await ev(`(() => { const p = document.getElementById("em-plane"), b = document.getElementById("em-plane-base"); return !p.hidden && !b.hidden && document.getElementById("em-canvas").hidden && p.clientHeight >= 320; })()`), true, "plane visible, 3D hidden, canvas at least 320px tall");
    assert.ok(await colorCount("em-plane-base") > 10, "the base layer (colour map, field lines) is really drawn");
    assert.match(await ev(`document.getElementById("em-inspector").textContent`), /q1/, "the inline inspector shows the selected source");
    const hashBefore = await planeHash();
    const framesBefore = (await emState()).diagnostics.frames;
    const q1 = await emScreen(-0.75, 0);
    await dragBetween(q1, { x: q1.x + 60, y: q1.y });
    const moved = await emSource("q1");
    near(moved.position[0], -0.75 + 60 / q1.scale, 0.02, "q1 x after a +60 px drag", 0.005);
    assert.equal(moved.position[1], 0);
    assert.equal((await emPg()).past.length, 1, "one drag is one history step");
    assert.ok((await emState()).diagnostics.frames > framesBefore, "the drag re-rendered the workspace");
    const hashMoved = await planeHash();
    assert.notEqual(hashMoved, hashBefore, "the canvas pixels changed");
    await click("#em-pg-undo");
    assert.deepEqual((await emSource("q1")).position, [-0.75, 0, 0], "undo restores q1's position");
    assert.equal(await planeHash(), hashBefore, "the restored scene paints the same pixels as the original");
    await click("#em-pg-redo");
    near((await emSource("q1")).position[0], moved.position[0], 1e-9, "redo moves q1 again");
    assert.equal(await planeHash(), hashMoved);
  });

  test("EM sensor: dragging the test charge near q1 shows E and V in SI units that follow Coulomb's law, and |E| grows towards the charge", async () => {
    await openEM();
    const readAt = async (a, b) => {
      const from = await emScreen(...(await emPg()).probe.slice(0, 2));
      await dragBetween(from, await emScreen(a, b));
      const probe = (await emPg()).probe;
      near(probe[0], a, 0.02, "sensor x", 0.02); near(probe[1], b, 0.02, "sensor y", 0.02);
      const rows = await sensorRows(), compact = await ev(`document.getElementById("em-sensor-text").textContent`);
      assert.match(rows["|E|"], /^\d+(\.\d+)?\s?[fpnµmkMG]?V\/m$/, `|E| has SI units: ${rows["|E|"]}`);
      assert.match(rows.V, /^[−-]?\d+(\.\d+)?\s?[fpnµmkMG]?V$/, `V has SI units: ${rows.V}`);
      assert.match(compact, /E = .*V\/m.*V = .*V$/, `compact text: ${compact}`);
      const expected = coulomb((await emPg()).sources, probe);
      near(parseEng(rows["|E|"]), expected.magnitude, 0.015, `|E| at (${a}, ${b})`);
      near(parseEng(rows.V), expected.potential, 0.015, `V at (${a}, ${b})`, 0.05);
      return parseEng(rows["|E|"]);
    };
    const nearField = await readAt(-0.75, 0.4), farField = await readAt(-0.75, 1.6);
    assert.ok(nearField > farField * 3, `|E| 0.4 m above q1 (${nearField}) is much larger than 1.6 m above it (${farField})`);
    const closer = await readAt(-0.75, 0.25);
    assert.ok(closer > nearField, `|E| keeps growing as the sensor approaches q1 (${closer} > ${nearField})`);
    assert.equal((await emPg()).past.length, 0, "moving the sensor is a view action, not an undo step");
  });

  test("EM Gauss surface: the circle around one +1 nC charge reads Phi = Q/eps0 = 112.9 V·m (converged, within 2%); around nothing it reads 0", async () => {
    await openEM();
    await click("#em-chip-gauss");
    await until(`${L}.getEMState().chips.gauss === true && ${L}.getEMState().gauss && !document.getElementById("em-gauss-readout").hidden`, "the Gauss readout");
    const converged = async (what) => {
      await until(`document.querySelector("#em-gauss-lines")?.textContent.includes("정밀")`, `the precise flux (${what})`);
      return gaussFlux();
    };
    const first = await converged("around q1");
    near(first.expected, 1e-9 / EPS0_SI, 0.005, "Q/eps0 for +1 nC");
    near(first.expected, 112.9, 0.005, "Q/eps0 reads 112.9 V·m");
    assert.match(first.charge, /1 nC.*q1/, `the enclosed charge is q1: ${first.charge}`);
    assert.match(first.tag, /수렴/, "the numeric flux says it converged");
    near(first.numeric, first.expected, 0.02, "numeric surface integral vs Q/eps0");
    assert.equal(await ev(`document.getElementById("em-gauss-lines").dataset.agrees`), "true");
    assert.match(await ev(`document.getElementById("em-gauss-state").textContent`), /일치/);
    // move the circle (grabbing its inside beside the charge handle) onto empty space: nothing is enclosed
    await dragGaussTo(0, -2);
    const g = (await emState()).gauss;
    near(g.center[0], 0, 0.05, "circle centre x", 0.05); near(g.center[1], -2, 0.03, "circle centre y", 0.05);
    const none = await converged("around nothing");
    assert.match(none.charge, /^Q내부 = 0 C\s+\(없음\)$/, `nothing enclosed: ${none.charge}`);
    assert.ok(Math.abs(none.numeric) < 0.02 * 112.9, `Phi through an empty surface is ~0 (${none.numeric})`);
    assert.equal(await ev(`document.getElementById("em-gauss-lines").dataset.agrees`), "true");
    // and back onto q1
    await dragGaussTo(-0.75, 0);
    const again = await converged("back around q1");
    near(again.numeric, 112.9, 0.02, "numeric flux after moving back");
    assert.match(again.tag, /수렴/);
    assert.equal((await emPg()).past.length, 0, "moving the Gauss circle never edits the charges");
  });

  test("EM inspector: a slider gesture updates the charge live and is one history step; a typed number plus Enter applies", async () => {
    await openEM();
    const slider = '[data-em-field="strength-slider"]', field = '[data-em-field="strength"]';
    assert.equal((await emPg()).selectedId, "q1");
    assert.equal(await ev(`document.querySelector(${JSON.stringify(field)}).value`), "1");
    const strengthFromSlider = (t) => { // src/em-source-edit.js: dead notch, then log scale 0.01..1000 nC with 3 significant digits
      const m = Math.abs(t); if (m <= 0.03) return 0;
      return Math.sign(t) * Number((0.01 * 1e5 ** Math.min(1, (m - 0.03) / 0.97)).toPrecision(3));
    };
    // A real range-input drag: press on the thumb, move with the left button held (Blink only drags a slider when button is "left"), release.
    const dragSlider = async (toFraction, beforeRelease) => {
      const spot = await ev(`(() => { const input = document.querySelector(${JSON.stringify(slider)}), r = input.getBoundingClientRect(), f = (Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min)); return { x: r.left + 8 + (r.width - 16) * f, y: r.top + r.height / 2, left: r.left + 8, width: r.width - 16 }; })()`);
      const send = (type, x, extra) => ctx.cdp.send("Input.dispatchMouseEvent", { type, x, y: spot.y, ...extra });
      const toX = spot.left + spot.width * toFraction;
      await send("mouseMoved", spot.x, {});
      await send("mousePressed", spot.x, { button: "left", buttons: 1, clickCount: 1 });
      for (let step = 1; step <= 6; step += 1) await send("mouseMoved", spot.x + ((toX - spot.x) * step) / 6, { button: "left", buttons: 1 });
      await settle();
      if (beforeRelease) await beforeRelease();
      await send("mouseReleased", toX, { button: "left", buttons: 0, clickCount: 1 });
      await settle();
    };
    const gesture = async (to) => {
      const sensorBefore = await ev(`document.getElementById("em-sensor-text").textContent`), pastBefore = (await emPg()).past.length, qBefore = (await emSource("q1")).q;
      await dragSlider(to, async () => {
        const q = (await emSource("q1")).q;
        assert.notEqual(q, qBefore, "the charge already follows the slider before it is released");
        assert.equal(await ev(`document.querySelector(${JSON.stringify(field)}).value`), String(Number((q * 1e9).toPrecision(6))), "the number field follows the slider live");
        assert.notEqual(await ev(`document.getElementById("em-sensor-text").textContent`), sensorBefore, "the sensor readout follows live");
        assert.equal((await emPg()).past.length, pastBefore, "the history step is closed only when the gesture ends");
      });
      assert.equal((await emPg()).past.length, pastBefore + 1, "one slider gesture is exactly one undo step");
      const t = Number(await ev(`document.querySelector(${JSON.stringify(slider)}).value`));
      near((await emSource("q1")).q * 1e9, strengthFromSlider(t), 1e-6, "q matches the slider position (nC)");
      return (await emSource("q1")).q;
    };
    const first = await gesture(0.85);
    assert.ok(first > 1e-9, `q grew to ${first}`);
    const second = await gesture(0.6);
    assert.ok(second < first && second > 0, `q shrank to ${second}`);
    assert.equal((await emPg()).past.length, 2);
    await typeInto(field, "3.5");
    near((await emSource("q1")).q, 3.5e-9, 1e-9, "the typed number is applied as you type");
    await pressEnter();
    near((await emSource("q1")).q, 3.5e-9, 1e-9, "q after Enter");
    assert.equal((await emPg()).past.length, 3, "a typed number is one undo step");
    assert.equal(await ev(`document.querySelector(${JSON.stringify(field)}).hasAttribute("aria-invalid")`), false);
    await typeInto(field, "-2");
    await pressEnter();
    near((await emSource("q1")).q, -2e-9, 1e-9, "a negative number flips the charge");
    assert.equal((await emPg()).past.length, 4);
    await click("#em-pg-undo");
    near((await emSource("q1")).q, 3.5e-9, 1e-9, "undo steps back to the previous typed value");
  });

  test("EM palette: +q and −q add sources, [ and ] cycle the selection, Delete removes the selected one", async () => {
    await openEM();
    assert.equal((await emPg()).sources.length, 2);
    await click('[data-em-pg-add="1"]');
    let pg = await emPg();
    assert.equal(pg.sources.length, 3);
    assert.equal(pg.past.length, 1, "adding a source is one history step");
    const added = pg.sources[2];
    assert.equal(pg.selectedId, added.id, "the new source is selected");
    assert.deepEqual([added.type, added.q], ["point", 1e-9]);
    await click('[data-em-pg-add="-1"]');
    pg = await emPg();
    assert.equal(pg.sources.length, 4);
    assert.equal(pg.past.length, 2);
    assert.equal(pg.sources[3].q, -1e-9);
    assert.equal(new Set(pg.sources.map((source) => JSON.stringify(source.position))).size, 4, "new charges are placed on free spots, not on top of others");
    const ids = pg.sources.map((source) => source.id);
    await ev(`document.getElementById("em-plane").focus()`);
    const selected = async () => (await emPg()).selectedId;
    assert.equal(await selected(), ids[3]);
    await press("]", "BracketRight", 221);
    assert.equal(await selected(), ids[0], "] wraps from the last source to the first");
    await press("]", "BracketRight", 221);
    assert.equal(await selected(), ids[1]);
    await press("[", "BracketLeft", 219);
    assert.equal(await selected(), ids[0]);
    await press("[", "BracketLeft", 219);
    assert.equal(await selected(), ids[3], "[ wraps from the first source to the last");
    assert.match(await ev(`document.getElementById("em-live").textContent`), /선택/, "the selection is announced");
    assert.equal((await emPg()).past.length, 2, "selecting is not a history step");
    await press("Delete", "Delete", 46);
    pg = await emPg();
    assert.deepEqual(pg.sources.map((source) => source.id), ids.slice(0, 3), "Delete removed the selected source");
    assert.equal(pg.selectedId, null);
    assert.equal(pg.past.length, 3);
    await press("Delete", "Delete", 46);
    assert.equal((await emPg()).sources.length, 3, "Delete with nothing selected does nothing");
    await click("#em-pg-undo");
    assert.deepEqual((await emPg()).sources.map((source) => source.id), ids, "undo brings the deleted source back");
  });

  test("EM 3D tab: switching shows the WebGL canvas, back to the plane keeps the sources", async () => {
    await openEM();
    await click('[data-em-pg-add="1"]');
    const sources = (await emPg()).sources;
    assert.equal(sources.length, 3);
    await click('[data-em-tab="3d"]');
    await until(`${L}.getEMState().tab === "3d"`, "the 3D tab");
    await until(`${L}.getEMState().diagnostics.frames > 1 && document.getElementById("em-canvas").clientWidth > 100`, "the 3D canvas to be laid out");
    assert.equal(await ev(`(() => { const c = document.getElementById("em-canvas"); return !c.hidden && c.clientWidth > 100 && c.clientHeight >= 320 && document.getElementById("em-plane").hidden && document.getElementById("em-plane-base").hidden && !document.getElementById("em-3d-bar").hidden; })()`), true, "3D canvas and bar visible, plane hidden");
    assert.equal(await ev(`document.querySelector('[data-em-tab="3d"]').getAttribute("aria-pressed")`), "true");
    assert.match(await ev(`document.getElementById("em-renderer-status").textContent`), /WebGL/, "the renderer reports WebGL");
    assert.equal(await ev(`document.getElementById("em-chip-contours").hidden`), true, "the plane-only contour chip is hidden in 3D");
    assert.deepEqual((await emPg()).sources, sources, "the same sources are shown in 3D");
    const cameraBefore = (await emState()).camera;
    await click('[data-em-view="z"]');
    await until(`Math.abs(${L}.getEMState().camera.pitch - (Math.PI / 2 - 0.001)) < 1e-6`, "the +z view button to set the camera");
    assert.notDeepEqual((await emState()).camera, cameraBefore);
    await click('[data-em-tab="plane"]');
    await until(`${L}.getEMState().tab === "plane"`, "the plane tab");
    assert.equal(await ev(`!document.getElementById("em-plane").hidden && document.getElementById("em-canvas").hidden && document.getElementById("em-plane").clientWidth > 100`), true);
    assert.deepEqual((await emPg()).sources, sources, "going back keeps the sources");
    assert.ok(await colorCount("em-plane-base") > 10, "the plane is drawn again");
    assert.equal((await emState()).active, true, "the workspace is still active");
  });

  const courseText = (selector) => ev(`document.querySelector(${JSON.stringify(selector)}).textContent.trim()`);
  const courseRecord = async () => { const course = (await emState()).course; return { course, record: course.records[course.selectedId] }; };

  test("EM course: default experiment renders, parameter sliders change the answer live, the time experiment plays, 숫자/문자 keeps the picture, subject follows the experiment", async () => {
    await openEM();
    assert.equal((await emState()).course, null, "the course is not loaded before it is opened");
    await click("#em-course-open");
    await until(`${L}.getEMState().course?.active === true && ${L}.getEMState().course.records[${L}.getEMState().course.selectedId]?.result && document.getElementById("em-course-canvas").clientWidth > 100`, "the course experiment to render");
    await settle();
    const { course, record } = await courseRecord();
    assert.equal(await ev(`document.getElementById("em-lab").hidden && !document.getElementById("em-course-root").hidden`), true, "the course replaces the free lab");
    assert.equal(course.selectedId, "coax-current", "the default experiment");
    assert.equal(await ev(`document.getElementById("em-course-select").value`), course.selectedId, "the experiment select shows the current experiment");
    assert.equal(await ev(`document.getElementById("em-course-topic").selectedOptions[0].textContent`), "정자계·암페어", "the subject select matches the experiment");
    assert.equal(record.result.status, "valid");
    assert.ok(await colorCount("em-course-canvas") > 10, "the experiment picture is drawn");
    // a parameter slider changes the answer text and the stored parameter at once
    const sliderKeys = await ev(`[...document.querySelectorAll("[data-em-course-slider]")].map((input) => input.dataset.emCourseSlider)`);
    assert.ok(sliderKeys.length >= 2, `the experiment has parameter sliders (${sliderKeys})`);
    let changed = null;
    for (const key of sliderKeys) {
      const before = await courseText("#em-course-answer"), valueBefore = (await courseRecord()).record.params[key];
      const spot = await ev(`(() => { const input = document.querySelector('[data-em-course-slider="${key}"]'), r = input.getBoundingClientRect(); return { x: r.left + 12 + (r.width - 24) * (Number(input.value) > 500 ? 0.15 : 0.85), y: r.top + r.height / 2 }; })()`);
      await clickAt(spot.x, spot.y);
      await settle();
      const after = await courseText("#em-course-answer"), valueAfter = (await courseRecord()).record.params[key];
      if (valueAfter !== valueBefore && after !== before) { changed = { key, before, after }; break; }
    }
    assert.ok(changed, "at least one parameter slider changes both the parameter and the answer text live");
    // another experiment: the picture changes; the subject list follows
    const pictureBefore = await canvasHash("em-course-canvas");
    await select("#em-course-topic", "자기유도");
    await until(`${L}.getEMState().course.selectedId === "faraday-loop"`, "the faraday experiment");
    assert.equal(await ev(`document.getElementById("em-course-select").value`), "faraday-loop");
    assert.equal(await ev(`document.getElementById("em-course-topic").value`), "자기유도");
    assert.notEqual(await canvasHash("em-course-canvas"), pictureBefore, "another experiment draws another picture");
    // time-dependent experiment: clock, play button, emf(t) graph
    assert.equal(await ev(`(() => { const t = document.getElementById("em-course-time"); return !t.hidden && Boolean(document.getElementById("em-course-play")) && Boolean(document.getElementById("em-course-time-slider")) && !document.getElementById("em-course-trace").hidden && document.getElementById("em-course-trace").clientWidth > 50; })()`), true, "time slider, play button and the emf(t) graph are shown");
    await until(`document.getElementById("em-course-trace").width > 0`, "the trace canvas to be sized");
    assert.ok(await colorCount("em-course-trace") > 3, "the emf(t) graph is drawn");
    const t0 = (await courseRecord()).record.params.time, traceBefore = await canvasHash("em-course-trace"), clockBefore = await courseText("#em-course-time-text");
    await click("#em-course-play");
    await until(`${L}.getEMState().course.playing === true`, "playback to start");
    await until(`${L}.getEMState().course.records["faraday-loop"].params.time !== ${t0}`, "playback to advance t");
    assert.equal(await courseText("#em-course-play"), "정지");
    await sleep(250);
    await click("#em-course-play");
    await until(`${L}.getEMState().course.playing === false`, "playback to stop");
    const t1 = (await courseRecord()).record.params.time;
    assert.notEqual(t1, t0, "pressing play advanced t");
    assert.notEqual(await canvasHash("em-course-trace"), traceBefore, "the emf(t) graph canvas repainted as t advanced (its time cursor moved)");
    assert.notEqual(await courseText("#em-course-time-text"), clockBefore, "the clock text follows");
    await sleep(200);
    assert.equal((await courseRecord()).record.params.time, t1, "t stands still while paused");
    // 숫자/문자 toggle keeps the picture
    const pictureHash = await canvasHash("em-course-canvas");
    await click('[data-em-answer-mode="symbolic"]');
    assert.equal(await ev(`document.getElementById("em-course-answer-numeric").hidden && !document.getElementById("em-course-answer-symbolic").hidden`), true, "the symbolic answer replaces the numeric one");
    assert.equal(await ev(`(() => { const c = document.getElementById("em-course-canvas"); return !c.hidden && c.clientWidth > 100 && c.offsetParent !== null; })()`), true, "the picture canvas stays visible in the symbolic view");
    assert.equal(await canvasHash("em-course-canvas"), pictureHash, "and unchanged");
    await click('[data-em-answer-mode="numeric"]');
    assert.equal(await ev(`!document.getElementById("em-course-answer-numeric").hidden`), true);
    // back to the free lab, and the course remembers the experiment when it is opened again
    await click("#em-course-back");
    await until(`${L}.getEMState().courseActive === false && !document.getElementById("em-lab").hidden && document.getElementById("em-course-root").hidden`, "return to the free lab");
    assert.equal(await ev(`document.getElementById("em-plane").clientWidth > 100`), true);
    await click("#em-course-open");
    await until(`${L}.getEMState().course?.active === true && ${L}.getEMState().courseActive === true`, "the course to open again");
    assert.equal((await emState()).course.selectedId, "faraday-loop");
    assert.equal(await ev(`document.getElementById("em-course-select").value === "faraday-loop" && document.getElementById("em-course-topic").value === "자기유도"`), true, "subject and experiment selects still match");
  });

  test("EM theme: toggling light/dark repaints the plane and the course canvas without console errors", async () => {
    await openEM();
    await select("#appearance", "dark");
    await settle();
    const dark = await planeHash();
    const darkBackground = await ev(`getComputedStyle(document.getElementById("em-workspace")).getPropertyValue("--canvas").trim()`);
    await select("#appearance", "light");
    await until(`document.documentElement.dataset.theme === "light"`, "the light theme");
    await settle();
    const light = await planeHash();
    assert.notEqual(light, dark, "the plane repaints in the other theme");
    assert.ok(await colorCount("em-plane-base") > 10);
    assert.notEqual(await ev(`getComputedStyle(document.getElementById("em-workspace")).getPropertyValue("--canvas").trim()`), darkBackground, "the canvas colour token changed");
    // a corner pixel of the base layer is the page's canvas colour: it follows the theme
    const corner = (id) => ev(`Array.from(document.getElementById(${JSON.stringify(id)}).getContext("2d", { willReadFrequently: true }).getImageData(2, 2, 1, 1).data)`);
    const lightCorner = await corner("em-plane-base");
    await select("#appearance", "dark");
    await settle();
    assert.equal(await planeHash(), dark, "switching back restores the dark picture exactly");
    assert.notDeepEqual(await corner("em-plane-base"), lightCorner, "the plane's background pixel follows the theme");
    // the course canvases follow too
    await click("#em-course-open");
    await until(`${L}.getEMState().course?.active === true && document.getElementById("em-course-canvas").clientWidth > 100`, "the course");
    await settle();
    const courseDark = await canvasHash("em-course-canvas");
    await select("#appearance", "light");
    await settle();
    assert.notEqual(await canvasHash("em-course-canvas"), courseDark, "the course picture repaints in the other theme");
    await select("#appearance", "dark");
    await click("#em-course-back");
    await until(`${L}.getEMState().courseActive === false`, "return to the lab");
    assert.equal((await emState()).active, true);
  });

  test("EM on a phone (390x844): the plane is at least 320px tall, the page does not overflow sideways, palette chips are reachable and the touch sensor moves", async () => {
    await openEM({ width: 390, height: 844, mobile: true });
    assert.equal(await ev(`document.documentElement.scrollWidth <= innerWidth + 1 && document.body.scrollWidth <= innerWidth + 1`), true, "no horizontal page overflow");
    const box = await ev(`(() => { const r = document.getElementById("em-plane").getBoundingClientRect(); return { w: r.width, h: r.height, left: r.left, right: r.right }; })()`);
    assert.ok(box.h >= 320, `plane canvas is ${box.h}px tall`);
    assert.ok(box.left >= -1 && box.right <= 391, `plane canvas fits the screen width (${box.left}..${box.right})`);
    assert.equal(await ev(`(() => { const w = document.getElementById("em-workspace"); return w.scrollWidth <= w.clientWidth + 1; })()`), true, "the EM workspace itself does not overflow");
    for (const selector of ['[data-em-pg-add="1"]', '[data-em-pg-add="-1"]', "#em-pg-add-infinite", "#em-pg-add-finite", '[data-em-chip="lines"]', "#em-chip-contours", "#em-chip-gauss", '[data-em-tab="3d"]', "#em-course-open", "#em-pg-undo"]) {
      const spot = await center(selector); // scrolls it into view and requires that a click would really hit it
      assert.ok(spot.x >= 0 && spot.x <= 390 && spot.w >= 24 && spot.h >= 24, `${selector} sits inside the screen and is big enough to touch (${Math.round(spot.x)}, ${Math.round(spot.w)}x${Math.round(spot.h)})`);
    }
    await click('[data-em-pg-add="1"]');
    assert.equal((await emPg()).sources.length, 3, "the palette works on the phone");
    await click("#em-chip-gauss");
    assert.equal((await emState()).chips.gauss, true);
    assert.equal(await ev(`document.documentElement.scrollWidth <= innerWidth + 1`), true, "still no overflow with the Gauss readout open");
    // a one-finger drag on the plane moves the test charge (the canvas claims the gesture)
    const probe = (await emPg()).probe.slice(0, 2), from = await emScreen(...probe);
    await touchDrag(from, { x: from.x + 40, y: from.y + 30 });
    const moved = (await emPg()).probe;
    assert.ok(Math.hypot(moved[0] - probe[0], moved[1] - probe[1]) > 0.1, `the sensor followed the finger (${probe} -> ${moved})`);
    await navigate("/"); // back to the desktop viewport
  });

  // ---- 전자기학 round-2 review: loop scene performance, grid cache, multi-pointer guard, keyboard / inspector, labels, motion, course fixes ----------
  const planeStats = () => ev(`${L}.getEMState().diagnostics.plane`);
  const openLoopScene = async () => {
    await openEM();
    await ev(`document.querySelector('[data-em-scene="loop"]').click()`);
    await until(`${L}.getEMState().scene === "loop" && ${L}.getEMState().diagnostics.plane.cols > 0`, "the loop scene to be drawn");
    await settle();
    await sleep(300);
  };

  test("EM loop scene: a wheel burst is drawn at draft resolution and settles into one converged render, and no frame blocks the main thread", async () => {
    await openLoopScene();
    assert.equal((await emState()).quality, "final");
    const finalCols = (await planeStats()).cols;
    await ev(`window.__longTasks = []; new PerformanceObserver((list) => { for (const entry of list.getEntries()) window.__longTasks.push(Math.round(entry.duration)); }).observe({ entryTypes: ["longtask"] }); true`);
    const spot = await emScreen(0, 0), span0 = (await emState()).view.span, cols = [];
    for (let i = 0; i < 10; i += 1) { await wheelAt(spot.x, spot.y, -120); cols.push((await planeStats()).cols); }
    assert.equal((await emState()).quality, "draft", "right after the burst the picture is still the draft one");
    assert.ok(Math.min(...cols) < finalCols * 0.7, `the burst was drawn at draft resolution (${cols.join(",")} cells across, final ${finalCols})`);
    await until(`${L}.getEMState().quality === "final" && ${L}.getEMState().diagnostics.plane.cols === ${finalCols}`, "the converged render after the burst");
    assert.ok((await emState()).view.span < span0 * 0.5, "the wheel zoomed in");
    const stats = await planeStats(), tasks = await ev(`window.__longTasks`);
    assert.ok(tasks.every((ms) => ms < 120), `no main-thread task of 120 ms or more while zooming the loop scene (long tasks: ${tasks.join(", ") || "none"}; last render ${Math.round(stats.baseMs)} ms)`);
    assert.ok(stats.stages.sample < 120, `sampling the loop grid takes ${Math.round(stats.stages.sample)} ms (the converged numerical sum took 150-250 ms)`);
    assert.ok(await colorCount("em-plane-base") > 10, "and the converged picture is really drawn");
  });

  test("EM chips and theme repaint the cached grid: toggling 장선 / 등크기선 or switching the theme does not resample the field, a plane switch does", async () => {
    await openLoopScene();
    await select("#appearance", "light");
    await settle();
    const builds = async () => (await planeStats()).gridBuilds, frames = async () => (await emState()).diagnostics.frames;
    const g0 = await builds(), h0 = await planeHash();
    for (const chip of ["lines", "contours"]) {
      const f0 = await frames();
      await ev(`document.querySelector('[data-em-chip="${chip}"]').click()`);
      await until(`${L}.getEMState().diagnostics.frames > ${f0}`, `the ${chip} chip to render`);
      await settle();
      assert.equal(await builds(), g0, `the ${chip} chip did not sample the grid again`);
      assert.equal((await planeStats()).gridCached, true, "the grid came from the cache");
      assert.notEqual(await planeHash(), h0, `the ${chip} layer really changed the picture`);
      await ev(`document.querySelector('[data-em-chip="${chip}"]').click()`);
      await settle();
      assert.equal(await builds(), g0);
    }
    assert.equal(await planeHash(), h0, "toggling both chips twice restores the exact picture");
    await select("#appearance", "dark");
    await settle();
    assert.equal(await builds(), g0, "a theme change repaints from the cached grid");
    assert.notEqual(await planeHash(), h0, "in other colours");
    await select("#appearance", "light");
    await select("#em-pg-plane", "xy");
    await until(`${L}.getEMState().diagnostics.plane.gridBuilds > ${g0}`, "the new plane to be sampled");
    assert.ok(await builds() > g0, "a plane switch is a different grid");
  });

  test("EM multi-pointer: a second finger cannot take over a running drag, and releasing it does not end the first finger's drag", async () => {
    await openEM();
    const touch = (type, touchPoints) => ctx.cdp.send("Input.dispatchTouchEvent", { type, touchPoints });
    const start = (await emPg()).probe.slice(0, 2), a = await emScreen(...start), far = await emScreen(start[0] + 1.5, start[1] + 1.2);
    await touch("touchStart", [{ x: a.x, y: a.y, id: 1 }]);
    await settle();
    await touch("touchStart", [{ x: a.x, y: a.y, id: 1 }, { x: far.x, y: far.y, id: 2 }]);
    await settle();
    const afterSecond = (await emPg()).probe;
    assert.ok(Math.hypot(afterSecond[0] - start[0], afterSecond[1] - start[1]) < 0.05, `the second finger did not move the sensor (${start} -> ${afterSecond})`);
    await touch("touchMove", [{ x: a.x + 30, y: a.y, id: 1 }, { x: far.x, y: far.y, id: 2 }]);
    await settle();
    const moved = (await emPg()).probe;
    assert.ok(moved[0] - start[0] > 0.1 && Math.abs(moved[1] - start[1]) < 0.05, `the first finger still drives the sensor (${start} -> ${moved})`);
    await touch("touchEnd", [{ x: a.x + 30, y: a.y, id: 1 }]); // finger 2 lifts
    await settle();
    await touch("touchMove", [{ x: a.x + 60, y: a.y, id: 1 }]);
    await settle();
    const stillDragging = (await emPg()).probe;
    assert.ok(stillDragging[0] > moved[0] + 0.1, `lifting the second finger did not end the first drag (${moved[0]} -> ${stillDragging[0]})`);
    await touch("touchEnd", []);
    await settle();
    assert.equal((await emState()).quality, "final");
  });

  test("EM labels and keyboard: 다시 하기 / 가우스 구, Tab leaves the canvas with no selection, delete and clone announce and move the focus, the empty inspector is not rewritten", async () => {
    await openEM();
    assert.equal(await ev(`document.getElementById("em-pg-redo").textContent.trim()`), "다시 하기");
    assert.equal(await ev(`document.getElementById("em-chip-gauss").textContent.trim()`), "가우스 구");
    // clone: the clone is announced and the focus follows to its strength field
    await click('[data-em-act="clone"]');
    await until(`document.activeElement?.dataset?.emField === "strength"`, "the focus on the clone's strength field");
    assert.match(await ev(`document.getElementById("em-live").textContent`), /복제했습니다/);
    // delete: the button disappears with the source, so the focus goes to the plane and the deletion is announced
    await click('[data-em-act="delete"]');
    await until(`document.activeElement?.id === "em-plane"`, "the focus on the plane after a delete");
    assert.match(await ev(`document.getElementById("em-live").textContent`), /삭제했습니다/);
    // delete the rest of the selection: nothing selected
    while ((await emPg()).selectedId) { await click('[data-em-act="delete"]'); await settle(); }
    await until(`document.querySelector("#em-inspector .em-note") !== null`, "the empty inspector note");
    await ev(`document.querySelector("#em-inspector .em-note").dataset.mark = "kept"`);
    const frames = (await emState()).diagnostics.frames;
    await ev(`document.getElementById("em-plane").focus()`);
    await press("ArrowRight", "ArrowRight", 39); // moves the sensor: a new frame
    await until(`${L}.getEMState().diagnostics.frames > ${frames}`, "another frame");
    assert.equal(await ev(`document.querySelector("#em-inspector .em-note")?.dataset.mark`), "kept", "the empty inspector note is the same node: it is not rewritten every frame");
    // Tab with nothing selected leaves the canvas instead of selecting a source
    assert.ok((await emPg()).sources.length > 0, "a source is left to tempt Tab");
    await ev(`document.getElementById("em-plane").focus()`);
    await press("Tab", "Tab", 9);
    assert.equal((await emPg()).selectedId, null, "Tab did not start a selection");
    assert.equal(await ev(`document.activeElement !== document.getElementById("em-plane")`), true, "the focus left the canvas");
    // [ ] still select (wrapping)
    await ev(`document.getElementById("em-plane").focus()`);
    await press("]", "BracketRight", 221);
    assert.ok((await emPg()).selectedId, "] selects a source");
  });

  test("EM reduced motion: the wave never starts by itself, 재생 still works, and turning the preference on stops a running wave", async () => {
    await navigate("/");
    await ctx.cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    try {
      await openEM();
      assert.equal((await emState()).reducedMotion, true, "the workspace sees the preference");
      await ev(`document.querySelector('[data-em-scene="wave"]').click()`);
      await until(`${L}.getEMState().scene === "wave"`, "the wave scene");
      await sleep(400);
      assert.equal((await emState()).playing, false, "nothing plays on its own");
      await click("#em-play");
      await until(`${L}.getEMState().playing === true`, "user-started playback");
      const t0 = (await emState()).timeCycles;
      await until(`${L}.getEMState().timeCycles !== ${t0}`, "the wave to advance");
      await ctx.cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
      await until(`${L}.getEMState().reducedMotion === false`, "the page to see the preference go away");
      assert.equal((await emState()).playing, true, "turning motion back on does not stop it");
      await ctx.cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
      await sleep(400); // the media-query change is delivered with a rendering update: do not starve it with polling
      await until(`${L}.getEMState().playing === false`, "reduce-motion to stop the running wave");
    } finally {
      await ctx.cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
    }
  });

  test("EM Gauss with two charges near the surface (a inside, b outside, ~2 mm each): the precise flux converges to 131.0 V·m instead of a 21%-off number", async () => {
    await openEM();
    const project = {
      format: "circuit-lab-em-playground", version: 1,
      world: {
        sources: [
          { id: "o", type: "point", q: 0, position: [0, 0, 0], enabled: true, visible: true },
          { id: "a", type: "point", q: 1.16e-9, position: [0.4586, 0.8516, 0.2471], enabled: true, visible: true },
          { id: "b", type: "point", q: 0.7e-9, position: [0.9328, -0.3418, -0.1292], enabled: true, visible: true },
        ],
        probe: [1.6, 1.1, 0], plane: "xy", selectedId: "o", comparison: null,
      },
      view: { camera: { yaw: -0.7, pitch: 0.45, distance: 7 }, vectorMode: "E" },
      calculus: { mode: "electric", differentialMode: "numeric", alpha: 1, h: 0.005, radius: 1, normal: [0, 0, 1] },
      legend: { mode: "auto" },
    };
    await ev(`(() => { const input = document.getElementById("em-d-file"), data = new DataTransfer(); data.items.add(new File([${JSON.stringify(JSON.stringify(project))}], "two.json", { type: "application/json" })); input.files = data.files; input.dispatchEvent(new Event("change", { bubbles: true })); })()`);
    await until(`${L}.getEMState().playground.sources.length === 3`, "the two-charge example to load");
    await click("#em-chip-gauss");
    await until(`${L}.getEMState().chips.gauss === true && ${L}.getEMState().gauss`, "the Gauss surface");
    await ev(`(() => { const slider = document.getElementById("em-gauss-radius"); slider.value = "1"; slider.dispatchEvent(new Event("input", { bubbles: true })); slider.dispatchEvent(new Event("change", { bubbles: true })); })()`);
    await until(`document.querySelector("#em-gauss-lines")?.textContent.includes("정밀")`, "the precise flux", 30000);
    const flux = await gaussFlux();
    assert.match(flux.charge, /1\.16 nC/, "only a is inside");
    near(flux.expected, 131.0, 0.002, "Q/eps0");
    near(flux.numeric, 131.0, 0.005, "the refined flux");
    assert.equal(flux.tag, "정밀 · 수렴", "converged only because each charge was refined on its own");
    assert.equal(await ev(`document.getElementById("em-gauss-lines").dataset.agrees`), "true");
  });

  test("EM course: a transmission line with an unresolved envelope still draws its instantaneous v(z, t), and a rod at the end of its rail has a disabled scrubber with the reason", async () => {
    await openEM();
    await click("#em-course-open");
    await until(`${L}.getEMState().course?.active === true && document.getElementById("em-course-canvas").clientWidth > 100`, "the course");
    await select("#em-course-topic", "전송선");
    await select("#em-course-select", "transmission-lossless");
    await until(`${L}.getEMState().course.selectedId === "transmission-lossless"`, "the transmission experiment");
    await typeInto('[data-em-course-parameter="frequency"]', "8000"); // MHz: 8 GHz
    await typeInto('[data-em-course-parameter="length"]', "3");
    await until(`${L}.getEMState().course.records["transmission-lossless"].params.length === 3`, "the line parameters");
    await settle();
    const canvas = await ev(`({ ...document.getElementById("em-course-canvas").dataset })`);
    assert.equal(canvas.envelopeUnresolved, "true", "the envelope is over the 513-point cap");
    assert.equal(canvas.instantUnresolved, undefined, "but the instantaneous curve is resolved");
    assert.equal(canvas.profileSeries, "2", "so v(z, t) and i(z, t) are both drawn");
    assert.ok(Number(canvas.profileXMax) - Number(canvas.profileXMin) < 10, "over the line's own length");
    assert.match(await ev(`document.getElementById("em-course-notes").textContent`), /미해상/, "the note about the omitted envelope stays");
    await select("#em-course-topic", "자기유도");
    await select("#em-course-select", "motional-rod");
    await until(`${L}.getEMState().course.selectedId === "motional-rod"`, "the motional rod");
    await typeInto('[data-em-course-parameter="velocity"]', "-3"); // moving back towards x = 0 ...
    await typeInto('[data-em-course-parameter="x0"]', "0"); // ... from a rod that already sits there
    await until(`${L}.getEMState().course.records["motional-rod"].params.x0 === 0 && ${L}.getEMState().course.records["motional-rod"].params.velocity === -3`, "the rod at the end of its rail");
    await settle();
    assert.equal(await ev(`document.getElementById("em-course-time-slider").disabled && document.getElementById("em-course-play").disabled`), true, "the scrubber and play are disabled");
    assert.match(await ev(`document.getElementById("em-course-time-text").textContent`), /레일 끝/, "with the reason shown");
    await typeInto('[data-em-course-parameter="x0"]', "20");
    await until(`!document.getElementById("em-course-time-slider").disabled && !document.getElementById("em-course-play").disabled`, "the scrubber to come back");
    await click("#em-course-back");
    await until(`${L}.getEMState().courseActive === false`, "return to the lab");
  });

  // ---- Y–Δ resistor conversion: editor command and course tool -------------------------------------------------------------------
  const YD_PINS = [["V1", 0], ["R4", 0], ["R5", 1]]; // source +, corner B, corner C: all three corners survive the conversion
  const cornerVoltages = (result) => YD_PINS.map(([id, pinIndex]) => nodeValue(result, 0, id, pinIndex));
  const pickResistors = async (ids) => { await selectPart(ids[0]); for (const id of ids.slice(1)) await shiftClickPart(id); };
  const ydeltaButton = () => ev(`(() => { const b = document.querySelector('#inspector-content [data-multi-action="ydelta"]'); return b ? { text: b.textContent.trim(), disabled: b.disabled, title: b.title } : null; })()`);

  test("Y–Δ editor: 3 selected resistors → Y→Δ keeps the corner voltages, is ONE history step, undo restores exactly; Δ→Y (key Y) goes back", async () => {
    await navigate("/?example=y-network");
    await autoUpdateOff();
    await runAnalysis("dc");
    const original = await state();
    const before = cornerVoltages(original.result);
    await pickResistors(["R1", "R2", "R3"]);
    assert.equal(await ev(`document.getElementById("selection-label").textContent.trim()`), "3개 선택");
    const offered = await ydeltaButton();
    assert.deepEqual([offered.text, offered.disabled], ["Y→Δ 변환", false], "the recognised Y offers the command");

    await click('#inspector-content [data-multi-action="ydelta"]');
    const converted = await state();
    assert.equal(converted.historyDepth, original.historyDepth + 1, "the whole conversion is ONE history entry");
    assert.equal(converted.circuit.components.length, original.circuit.components.length, "three resistors became three resistors");
    assert.ok(!converted.circuit.components.some((item) => ["R1", "R2", "R3"].includes(item.id)), "the old arms are gone");
    assert.ok(!(converted.circuit.junctions ?? []).some((item) => item.id === "J1"), "and so is the Y's centre junction");
    assert.equal(converted.selection.length, 3, "the selection moved to the three new resistors");
    assert.ok(converted.selection.every((key) => key.startsWith("component:") && !["R1", "R2", "R3"].some((id) => key.endsWith(":" + id))));
    assert.equal(converted.stale, true, "the previous result is marked stale (auto update is off here)");
    assert.match((await noticeTexts()).join("|"), /Y→Δ 변환: RAB=3\.667 kΩ, RBC=11 kΩ, RCA=5\.5 kΩ/);
    const values = converted.selection.map((key) => converted.circuit.components.find((item) => key.endsWith(":" + item.id)).props.value);
    near(parseEng(values[0]), 11e3 / 3, 1e-9, "RAB");
    near(parseEng(values[1]), 11e3, 1e-9, "RBC");
    near(parseEng(values[2]), 5.5e3, 1e-9, "RCA");
    assert.equal((await ydeltaButton()).text, "Δ→Y 변환", "the same three parts now form a Δ");
    // The stored value keeps 12 digits, the canvas label is shortened for reading (the inspector field still holds the raw text).
    const firstId = converted.selection[0].slice("component:".length);
    assert.ok(values[0].length > 8, "stored: " + values[0]);
    assert.equal(await ev(`document.querySelector('.component[data-id="${firstId}"] .value-label').textContent`), "3.6667k", "canvas label is at most 5 significant digits");
    // Undo first (running an analysis can add its own history entries): one Ctrl+Z restores everything.
    await ctrlKey("z", "KeyZ", 90);
    const undone = await state();
    assert.deepEqual(undone.circuit, original.circuit, "one Ctrl+Z restores parts, wires and junctions exactly");
    assert.equal(undone.historyDepth, original.historyDepth);
    await ctrlKey("y", "KeyY", 89);
    assert.deepEqual((await state()).circuit, converted.circuit, "redo converts again, identically");
    await runAnalysis("dc");
    const after = cornerVoltages((await state()).result);
    after.forEach((value, index) => near(value, before[index], 1e-6, `corner ${YD_PINS[index].join(".")}`, 1e-9));

    // Δ→Y with the key Y: the new three are still selected. Corner voltages stay.
    await ev(`document.querySelectorAll("#canvas-notices button").forEach((button) => button.click())`);
    await pickResistors(converted.selection.map((key) => key.slice("component:".length))); // undo/redo do not restore the selection
    const midDepth = (await state()).historyDepth;
    await press("y", "KeyY", 89);
    const back = await state();
    assert.equal(back.historyDepth, midDepth + 1, "the key Y is one more history entry");
    assert.ok((back.circuit.junctions ?? []).length >= 1, "a new centre junction exists");
    assert.match((await noticeTexts()).join("|"), /Δ→Y 변환: RA=1 kΩ, RB=2 kΩ, RC=3 kΩ/);
    await runAnalysis("dc");
    cornerVoltages((await state()).result).forEach((value, index) => near(value, before[index], 1e-6, `corner ${YD_PINS[index].join(".")} after Δ→Y`, 1e-9));
  });

  test("Y–Δ editor: a held key Y converts once (auto-repeat keydowns are ignored)", async () => {
    await navigate("/?example=y-network");
    await autoUpdateOff();
    await pickResistors(["R1", "R2", "R3"]);
    const depth = (await state()).historyDepth;
    await press("y", "KeyY", 89);
    assert.equal((await state()).historyDepth, depth + 1, "the first press converts");
    const converted = (await state()).circuit;
    for (let n = 0; n < 4; n += 1) await ctx.cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "y", code: "KeyY", windowsVirtualKeyCode: 89, autoRepeat: true });
    await settle();
    assert.equal((await state()).historyDepth, depth + 1, "held-key repeats add no history entry");
    assert.deepEqual((await state()).circuit, converted, "and do not convert back");
  });

  test("Y–Δ editor: a selection that is not a Y or Δ shows a disabled command with the reason; other selections show none", async () => {
    await navigate("/?example=y-network");
    await autoUpdateOff();
    await pickResistors(["R1", "R2", "R4"]);
    const refused = await ydeltaButton();
    assert.equal(refused.disabled, true, "R1, R2 and R4 are no Y/Δ");
    assert.ok(refused.title.length > 5, "the reason is the tooltip: " + refused.title);
    assert.match(await ev(`document.querySelector("[data-ydelta-reason]").textContent`), /[가-힣]/, "and also visible text for touch screens");
    const depth = (await state()).historyDepth;
    await press("y", "KeyY", 89);
    assert.equal((await state()).historyDepth, depth, "the key Y on a refused selection edits nothing");
    assert.match((await noticeTexts()).join("|"), /Y–Δ 변환 거부/, "and says why");
    await ev(`document.querySelectorAll("#canvas-notices button").forEach((button) => button.click())`);
    await pickResistors(["R1", "R2"]);
    assert.equal(await ydeltaButton(), null, "two resistors: no command");
    await pickResistors(["R1", "R2", "V1"]);
    assert.equal(await ydeltaButton(), null, "a source among them: no command");
    await selectPart("R1");
    assert.equal(await ev(`document.querySelector('[data-multi-action="ydelta"]')`), null, "single selection: no command");
  });

  test("Y–Δ course tool: live sliders and SI fields, RA=RB=RC=1k gives RAB=3 kΩ, bad text keeps the last valid network, direction toggle", async () => {
    await navigate("/");
    await click("#circuit-course-workspace-tab");
    await until(`${L}.getCircuitCourseState()?.active === true`, "the circuit course");
    assert.equal(await ev(`${L}.getCircuitCourseState().tool`), null, "experiments stay the default view");
    await click('[data-circuit-course-tool="y-delta"]');
    assert.equal(await ev(`${L}.getCircuitCourseState().tool`), "y-delta");
    assert.equal(await ev(`document.querySelector(".circuit-course-layout").hidden`), true, "the experiment form is hidden while the tool is open");
    assert.equal(await ev(`document.querySelectorAll(".ydelta-svg").length`), 1, "one figure");
    assert.equal(await ev(`document.querySelectorAll("[data-ydelta-resistor]").length`), 6, "three arms and three sides");
    assert.equal(await ev(`document.querySelector("#circuit-course-host button.circuit-course-apply")?.offsetParent ?? null`), null, "no apply button is visible");
    const valueOf = (name) => ev(`document.querySelector('[data-ydelta-value="${name}"]').textContent`);
    assert.deepEqual([await valueOf("RAB"), await valueOf("RBC"), await valueOf("RCA")], ["3.667 kΩ", "11 kΩ", "5.5 kΩ"], "default Y 1k/2k/3k");

    // Typing applies at once (no button).
    for (const index of [0, 1, 2]) await typeInto(`[data-ydelta-text="${index}"]`, "1k");
    assert.deepEqual([await valueOf("RAB"), await valueOf("RBC"), await valueOf("RCA")], ["3 kΩ", "3 kΩ", "3 kΩ"], "RA=RB=RC=1k -> every side 3 kΩ");
    assert.match(await ev(`document.querySelector("[data-ydelta-read]").textContent`), /Δ의 변은 Y 팔의 3배/);
    assert.equal((await ev(`Number(document.querySelector('[data-ydelta-slider="0"]').value)`)) > 0, true, "the slider follows the text");

    // The slider is logarithmic and live: its right end is 10 MΩ for RA and the Δ side follows at once.
    await ev(`(() => { const slider = document.querySelector('[data-ydelta-slider="0"]'); slider.value = slider.max; slider.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    assert.equal(await ev(`document.querySelector('[data-ydelta-text="0"]').value`), "10meg", "slider end = 10 MΩ");
    near(parseEng(await valueOf("RAB")), 1e7 + 1e3 + (1e7 * 1e3) / 1e3, 1e-3, "RAB for RA=10M, RB=RC=1k");
    await ev(`(() => { const slider = document.querySelector('[data-ydelta-slider="0"]'); slider.value = 0; slider.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    assert.equal(await ev(`document.querySelector('[data-ydelta-text="0"]').value`), "10", "slider start = 10 Ω");

    // Bad text: the last valid network stays on screen and the field says why.
    const lastGood = await valueOf("RAB");
    await typeInto('[data-ydelta-text="1"]', "abc");
    assert.equal(await ev(`document.querySelector('[data-ydelta-text="1"]').getAttribute("aria-invalid")`), "true");
    assert.match(await ev(`document.querySelector('[data-ydelta-error="1"]').textContent`), /[가-힣]/);
    assert.equal(await valueOf("RAB"), lastGood, "outputs keep the last valid values");
    await typeInto('[data-ydelta-text="1"]', "2.2k");
    assert.equal(await ev(`document.querySelector('[data-ydelta-text="1"]').getAttribute("aria-invalid")`), null, "a valid value clears the complaint");

    // A value that parses but overflows in the conversion (RA = 1e308) is refused before it is committed: nothing throws and the tool keeps working.
    const beforeOverflow = await ev(`${L}.getCircuitCourseState().yDelta`);
    await typeInto('[data-ydelta-text="0"]', "1e308");
    assert.equal(await ev(`document.querySelector('[data-ydelta-text="0"]').getAttribute("aria-invalid")`), "true", "the field complains");
    assert.match(await ev(`document.querySelector('[data-ydelta-error="0"]').textContent`), /[가-힣]/);
    const keptState = await ev(`${L}.getCircuitCourseState().yDelta`);
    assert.deepEqual([keptState.inputs, keptState.outputs], [beforeOverflow.inputs, beforeOverflow.outputs], "the last valid network stays");
    assert.equal(keptState.direction, "toDelta");
    await typeInto('[data-ydelta-text="0"]', "1k");
    assert.equal(await ev(`document.querySelector('[data-ydelta-text="0"]').getAttribute("aria-invalid")`), null);

    // Direction: the results become the inputs, the figure's roles swap.
    await click('[data-ydelta-direction="toY"]');
    const toY = await ev(`${L}.getCircuitCourseState().yDelta`);
    assert.equal(toY.direction, "toY");
    assert.deepEqual(Object.keys(toY.inputs), ["RAB", "RBC", "RCA"]);
    assert.equal(await ev(`document.querySelector('[data-ydelta-shape="Δ"]').dataset.role`), "input");
    assert.equal(await ev(`document.querySelector('[data-ydelta-shape="Y"]').dataset.role`), "output");
    near(toY.outputs.RB, 2.2e3, 1e-5, "the round trip returns to the original RB");
    assert.equal(await ev(`document.documentElement.scrollWidth <= innerWidth + 1`), true, "no horizontal overflow");
    // The numeric experiments are untouched: picking one brings its form back.
    await click('[data-circuit-course-experiment="impedance"]');
    assert.equal(await ev(`document.querySelector(".circuit-course-layout").hidden`), false);
    assert.equal(await ev(`${L}.getCircuitCourseState().tool`), null);
    assert.equal(await ev(`document.querySelector('[data-circuit-course-tool="y-delta"]').getAttribute("aria-current")`), "false");
  });

  test("Y–Δ course tool on a phone (390x844): stacked figure, no overflow, touch-sized fields", async () => {
    await navigate("/", { width: 390, height: 844, mobile: true });
    await ev(`${L}.activateWorkspace("circuit-course")`);
    await until(`${L}.getCircuitCourseState()?.active === true`, "the circuit course");
    await click('[data-circuit-course-tool="y-delta"]');
    await until(`document.querySelector(".ydelta-svg")?.dataset.layout === "stacked"`, "the stacked phone figure");
    assert.equal(await ev(`document.documentElement.scrollWidth <= innerWidth + 1 && document.getElementById("circuit-course-workspace").scrollWidth <= innerWidth + 1`), true, "no horizontal overflow");
    const sizes = await ev(`(() => { const box = (selector) => document.querySelector(selector).getBoundingClientRect(); return { svg: box(".ydelta-svg").width, text: box('[data-ydelta-text="0"]').height, button: box('[data-ydelta-direction="toY"]').height }; })()`);
    assert.ok(sizes.svg <= 390 && sizes.svg > 280, "the figure fits the phone: " + JSON.stringify(sizes));
    assert.ok(sizes.text >= 40 && sizes.button >= 40, "touch targets are at least 40px: " + JSON.stringify(sizes));
    const stackedOrder = await ev(`(() => { const top = (selector) => document.querySelector(selector).getBoundingClientRect().top; return top(".ydelta-bar") < top(".ydelta-figure") && top(".ydelta-figure") < top(".ydelta-inputs") && top(".ydelta-inputs") < top("[data-ydelta-read]"); })()`);
    assert.equal(stackedOrder, true, "stacked order: toggle, figure, fields, read-out");
    for (const index of [0, 1, 2]) await typeInto(`[data-ydelta-text="${index}"]`, "1k");
    assert.equal(await ev(`document.querySelector('[data-ydelta-value="RAB"]').textContent`), "3 kΩ");
    assert.equal(await ev(`document.documentElement.scrollWidth <= innerWidth + 1`), true);
  });

  test("Y–Δ course tool: units other than Ω are refused, sliders speak their value, the read line is not a live region, a refused slider step puts the knob back", async () => {
    await navigate("/");
    await click("#circuit-course-workspace-tab");
    await until(`${L}.getCircuitCourseState()?.active === true`, "the circuit course");
    await click('[data-circuit-course-tool="y-delta"]');
    const attr = (selector, name) => ev(`document.querySelector('${selector}').getAttribute("${name}")`);
    assert.equal(await attr('[data-ydelta-slider="0"]', "aria-valuetext"), "1 kΩ", "the slider says its resistance, not 0..1000");
    assert.equal(await attr("[data-ydelta-read]", "aria-live"), null, "no live region that chatters while a slider is dragged");
    assert.equal(await attr("[data-ydelta-read]", "role"), null);
    await ev(`(() => { const slider = document.querySelector('[data-ydelta-slider="1"]'); slider.value = 500; slider.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    assert.match(await attr('[data-ydelta-slider="1"]', "aria-valuetext"), /^[\d.]+ [kM]?Ω$/, "and it follows the knob");

    // A text unit that is not a resistance is refused with the reason; the network keeps its last valid state.
    const lastGood = await ev(`${L}.getCircuitCourseState().yDelta`);
    for (const text of ["5V", "10uF", "1kHz"]) {
      await typeInto('[data-ydelta-text="0"]', text);
      assert.equal(await attr('[data-ydelta-text="0"]', "aria-invalid"), "true", text);
      assert.match(await ev(`document.querySelector('[data-ydelta-error="0"]').textContent`), /단위/, text);
    }
    assert.deepEqual((await ev(`${L}.getCircuitCourseState().yDelta`)).inputs, lastGood.inputs, "nothing changed");
    await typeInto('[data-ydelta-text="0"]', "330Ω");
    assert.equal(await attr('[data-ydelta-text="0"]', "aria-invalid"), null, "Ω is accepted");
    assert.equal((await ev(`${L}.getCircuitCourseState().yDelta`)).inputs.RA, 330);

    // A slider step whose conversion overflows is refused and the knob goes back to the value in use.
    await typeInto('[data-ydelta-text="0"]', "1k");
    await typeInto('[data-ydelta-text="1"]', "1e300");
    await typeInto('[data-ydelta-text="2"]', "1e-5");
    assert.equal(await attr('[data-ydelta-text="2"]', "aria-invalid"), null, "that network is still valid");
    const knob = await ev(`document.querySelector('[data-ydelta-slider="0"]').value`);
    await ev(`(() => { const slider = document.querySelector('[data-ydelta-slider="0"]'); slider.value = slider.max; slider.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    assert.equal(await ev(`document.querySelector('[data-ydelta-slider="0"]').value`), knob, "the knob is back where the state is");
    assert.match(await ev(`document.querySelector('[data-ydelta-error="0"]').textContent`), /[가-힣]/, "and the field says why");
    assert.equal((await ev(`${L}.getCircuitCourseState().yDelta`)).inputs.RA, 1e3);
  });

  for (const width of [900, 1000, 1100]) {
    test(`Y–Δ course tool at ${width}px: the figure's value text is at least 11px on screen`, async () => {
      await navigate("/", { width, height: 900 });
      await click("#circuit-course-workspace-tab");
      await until(`${L}.getCircuitCourseState()?.active === true`, "the circuit course");
      await click('[data-circuit-course-tool="y-delta"]');
      const metrics = await ev(`(() => { const svg = document.querySelector(".ydelta-svg"); const scale = svg.getScreenCTM().a; const size = (selector) => parseFloat(getComputedStyle(document.querySelector(selector)).fontSize) * scale; return { scale, width: svg.getBoundingClientRect().width, layout: svg.dataset.layout, value: size(".ydelta-value"), sub: size(".ydelta-sub"), corner: size(".ydelta-corner"), scroll: document.documentElement.scrollWidth <= innerWidth + 1 }; })()`);
      assert.ok(metrics.value >= 11 && metrics.sub >= 9, JSON.stringify(metrics));
      assert.equal(metrics.scroll, true, "no horizontal overflow");
    });
  }
  // ---- magnetic parts: coupled inductor (K) and ideal transformer (T) ------------------------------------------------------------
  const openMorePalette = () => ev(`document.querySelector(".palette-more").open = true`);
  const placeFromPalette = async (type, from = "bottom-right") => {
    await openMorePalette();
    await click(`.palette-item[data-type="${type}"]`);
    const spot = await bgPoint({ from });
    await clickAt(spot.x, spot.y); await settle();
  };
  /** Type into an inspector field and commit it with Enter (several fields in a row would otherwise race the re-render). */
  const fillField = async (selector, text) => { await typeInto(selector, text); await press("Enter", "Enter", 13); };
  const pickValues = (probes) => probes.map((probe) => probe.label);

  test("magnetic parts: both are in the palette under 더보기, place with 4 pins and dots, edit L1/L2/k|M/dots/n in the inspector, sign convention is written out", async () => {
    await navigate("/");
    await placeFromPalette("COUPLED_L");
    await placeFromPalette("XFMR_IDEAL");
    await click('[data-tool="select"]');
    const parts = (await state()).circuit.components;
    assert.deepEqual(parts.map((item) => [item.id, item.type, item.props.ref]), [["K1", "COUPLED_L", "K1"], ["T1", "XFMR_IDEAL", "T1"]]);
    for (const id of ["K1", "T1"]) {
      assert.equal(await ev(`document.querySelectorAll('.component[data-id="${id}"] .pin').length`), 4, `${id} has four pins`);
      assert.equal(await ev(`document.querySelectorAll('.component[data-id="${id}"] .ideal-mark').length`), 2, `${id} draws two dots`);
    }
    assert.equal(await ev(`document.querySelectorAll('.component[data-id="T1"] .symbol-line').length`), 2, "the transformer has the core lines on top of the two coils");
    assert.equal(await ev(`document.querySelectorAll('.component[data-id="K1"] .symbol-line').length`), 1, "the coupled inductor has no core");

    await selectPart("K1");
    await click("#inspector-tab");
    const inspector = () => ev(`document.getElementById("inspector-content").textContent`);
    assert.match(await inspector(), /1차 인덕턴스 L1/);
    await fillField('#inspector-content [data-prop="L1"]', "5");
    await fillField('#inspector-content [data-prop="L2"]', "6");
    await select('#inspector-content [data-prop="coupling"]', "M");
    await fillField('#inspector-content [data-prop="M"]', "3");
    let props = (await component("K1")).props;
    assert.deepEqual([props.L1, props.L2, props.coupling, props.M], ["5", "6", "M", "3"]);
    assert.match(await inspector(), /유도값 k = M\/√\(L1·L2\) = 0\.54772/, "the other of k and M is shown derived");
    assert.equal(await ev(`document.querySelector('.component[data-id="K1"] .value-label').textContent`), "5 · 6 · M 3");
    const dotY = () => ev(`[...document.querySelectorAll('.component[data-id="K1"] .ideal-mark')].map((dot) => Number(dot.getAttribute("cy")))`);
    assert.deepEqual(await dotY(), [-12, -12]);
    await select('#inspector-content [data-prop="dots"]', "opposite");
    assert.deepEqual(await dotY(), [-12, 12], "opposite dots: the second dot moves to pin 2b");
    await select('#inspector-content [data-prop="coupling"]', "k");
    await fillField('#inspector-content [data-prop="k"]', "0.8");
    assert.match(await inspector(), /유도값 M = k·√\(L1·L2\) = 4\.382/, "k input shows the derived M");
    // k above 1 is a run-time error, not silently clamped
    await fillField('#inspector-content [data-prop="k"]', "1.5");
    assert.equal((await component("K1")).props.k, "1.5");

    await selectPart("T1");
    assert.match(await inspector(), /권수비 n = N2\/N1/);
    assert.match(await inspector(), /V1, V2 점 극성 같으면 \+n; I1, I2 모두 점으로 들어가면 −n/);
    await fillField('#inspector-content [data-prop="n"]', "4");
    assert.equal((await component("T1")).props.n, "4");
    assert.equal(await ev(`document.querySelector('.component[data-id="T1"] .value-label').textContent`), "1 : 4");
    // a non-positive n is refused before it reaches the engine
    await fillField('#inspector-content [data-prop="n"]', "-2");
    assert.equal(await ev(`document.querySelector('#inspector-content [data-prop="n"]').classList.contains("input-invalid")`), true);
    await fillField('#inspector-content [data-prop="n"]', "4");
  });

  test("magnetic parts: the ideal-transformer example in AC gives the textbook I1 and Vo; the I probe pressed on each half of the part picks the winding", async () => {
    await navigate("/?example=ideal-transformer");
    await autoUpdateOff();
    await runAnalysis("ac");
    let snapshot = await state();
    assert.deepEqual(pickValues(snapshot.probes), ["I(T1.1)", "V(R2.1)"]);
    const i1 = snapshot.phasorResult.points[0].componentCurrents.T1;
    near(Math.hypot(i1.re, i1.im), 11.09, 1e-3, "|I1|");
    near((Math.atan2(i1.im, i1.re) * 180) / Math.PI, 33.69, 3e-3, "∠I1");
    const vo = nodeValue(snapshot.phasorResult, 0, "R2", 0);
    near(Math.hypot(vo.re, vo.im), 110.9, 1e-3, "|Vo|");
    // the secondary current (winding 2) is its own result series: I2 = −I1/n
    const i2 = snapshot.phasorResult.points[0].componentCurrents["T1#2"];
    near(Math.hypot(i2.re, i2.im), 5.545, 1e-3, "|I2|");
    // I probe pressed on the right half of the part adds winding 2; pressed on the left half again it is the existing winding 1 probe
    const halfPoint = (localX) => ev(`(() => {
      const rect = (pin) => { const r = document.querySelector('.component[data-id="T1"] .pin[data-pin="' + pin + '"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; };
      const a = rect(0), b = rect(2), c = rect(1);
      const u = (${localX} + 40) / 80, v = 0.5;
      return { x: a.x + (b.x - a.x) * u + (c.x - a.x) * v, y: a.y + (b.y - a.y) * u + (c.y - a.y) * v };
    })()`);
    await click('[data-tool="current-probe"]');
    const right = await halfPoint(22);
    await clickAt(right.x, right.y); await settle();
    snapshot = await state();
    assert.deepEqual(pickValues(snapshot.probes), ["I(T1.1)", "V(R2.1)", "I(T1.2)"], "a right-half press adds the winding 2 current");
    assert.equal(snapshot.probes[2].winding, 2);
    const left = await halfPoint(-22);
    await clickAt(left.x, left.y); await settle();
    assert.equal((await state()).probes.length, 3, "the left half is winding 1, already probed");
    assert.equal(await ev(`document.querySelectorAll('.component[data-id="T1"] .current-direction').length`), 2, "one direction arrow per probed winding");
    // the probe chips and the AC readout see the second winding
    assert.ok((await ev(`document.getElementById("probe-list").textContent`)).includes("I(T1.2)"));
    await runAnalysis("ac");
    snapshot = await state();
    assert.ok(snapshot.result.points.every((point) => Number.isFinite(point.componentCurrents["T1#2"].re)));
  });

  test("magnetic parts: coupled-coil example gives the textbook I1 and I2 in AC; DC and transient run on the same circuit", async () => {
    await navigate("/?example=coupled-coils");
    await autoUpdateOff();
    await runAnalysis("ac");
    let snapshot = await state();
    assert.deepEqual(pickValues(snapshot.probes), ["I(K1.1)", "I(K1.2)", "I(R1, pin 1→2)"]);
    const currents = snapshot.phasorResult.points[0].componentCurrents;
    const polar = (z) => [Math.hypot(z.re, z.im), (Math.atan2(z.im, z.re) * 180) / Math.PI];
    near(polar(currents.K1)[0], 13.01, 1e-3, "|I1|");
    near(polar(currents.K1)[1], -49.39, 2e-3, "∠I1");
    near(polar(currents.R1)[0], 2.91, 1e-3, "|I2|");
    near(polar(currents.R1)[1], 14.04, 5e-3, "∠I2");
    await runAnalysis("dc");
    snapshot = await state();
    assert.ok(Math.abs(snapshot.result.points[0].componentCurrents.K1) < 1e-9, "the 12 V AC source has no DC part, so the coil shorts carry 0 A");
    await runAnalysis("transient");
    const transient = (await state()).result;
    assert.ok(transient.points.length > 100 && transient.points.every((point) => Number.isFinite(point.componentCurrents["K1#2"])), "winding 2 current is a finite series");
  });

  // Builds source -> R1 -> magnetic part -> R2 with real palette clicks and pin drags: V1 at the left, R1, the part in the middle, R2 at the right, one GND below.
  async function buildMagneticCircuit(type, secondary) {
    await navigate("/");
    await autoUpdateOff();
    const canvas = await ev(`(() => { const r = document.getElementById("circuit-canvas").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    const put = async (partType, dx, dy) => {
      if (["COUPLED_L", "XFMR_IDEAL"].includes(partType)) await openMorePalette();
      await sleep(300); // a click right after a drag release is still inside the click-suppression window
      await click(`.palette-item[data-type="${partType}"]`);
      await clickAt(canvas.x + dx, canvas.y + dy); await settle();
      await click('[data-tool="select"]');
    };
    await put("V", -330, 0);
    await put("R", -170, -90);
    await put(type, 0, 0);
    await put("R", 200, 0);
    await put("GND", 0, 120);
    const ids = (await state()).circuit.components.map((item) => item.id);
    assert.deepEqual(ids, ["V1", "R1", `${type === "XFMR_IDEAL" ? "T" : "K"}1`, "R2", "G1"]);
    const part = ids[2];
    const wires = [["V1", 0, "R1", 0], ["R1", 1, part, 0], [part, 1, "G1", 0], ["V1", 1, "G1", 0], ["R2", 1, "G1", 0], ...secondary(part)];
    for (const [a, pinA, b, pinB] of wires) await dragBetween(await pinTip(a, pinA), await pinTip(b, pinB));
    assert.equal((await state()).circuit.wires.length, wires.length, "every drag made one wire");
    return part;
  }
  const acPhasors = async () => { await runAnalysis("ac"); return (await state()).phasorResult; };
  const polarOf = (z) => [Math.hypot(z.re, z.im), (Math.atan2(z.im, z.re) * 180) / Math.PI];

  test("magnetic parts: an ideal transformer built from the palette with pin drags solves in AC (Vo = −n·V1 with the dots as drawn) and the dot setting flips the sign", async () => {
    // pins: 1a=0, 1b=1, 2a=2, 2b=3. 2a is grounded and the load hangs on 2b, like textbook example 13.8.
    await buildMagneticCircuit("XFMR_IDEAL", (part) => [[part, 2, "G1", 0], [part, 3, "R2", 0]]);
    await selectPart("T1");
    await click("#inspector-tab");
    assert.match(await ev(`document.getElementById("inspector-content").textContent`), /점 극성 같으면 \+n/);
    let result = await acPhasors();
    // R1 = R2 = 1 kΩ (defaults), n = 2: I1 = 1 / (1k + 1k/4) = 0.8 mA, V1 = 0.2 V, Vo = V(2b) = −n·V1 = −0.4 V
    near(polarOf(result.points[0].componentCurrents.T1)[0], 0.8e-3, 1e-6, "|I1|");
    let vo = nodeValue(result, 0, "R2", 0);
    near(vo.re, -0.4, 1e-6, "Re Vo (dots same, 2a grounded)");
    assert.ok(Math.abs(vo.im) < 1e-9);
    await select('#inspector-content [data-prop="dots"]', "opposite");
    result = await acPhasors();
    vo = nodeValue(result, 0, "R2", 0);
    near(vo.re, 0.4, 1e-6, "Re Vo (dots opposite)");
    near(polarOf(result.points[0].componentCurrents.T1)[0], 0.8e-3, 1e-6, "|I1| does not depend on the dot placement");
    // add the winding 2 probe by pressing the part's right half and read it back through the same result
    await click('[data-tool="current-probe"]');
    const spot = await ev(`(() => { const rect = (pin) => { const r = document.querySelector('.component[data-id="T1"] .pin[data-pin="' + pin + '"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }; const a = rect(0), b = rect(2), c = rect(1); return { x: a.x + (b.x - a.x) * 0.775 + (c.x - a.x) * 0.5, y: a.y + (b.y - a.y) * 0.775 + (c.y - a.y) * 0.5 }; })()`);
    await clickAt(spot.x, spot.y); await settle();
    assert.deepEqual((await state()).probes.map((probe) => probe.label), ["I(T1.2)"]);
    result = await acPhasors();
    near(polarOf(result.points[0].componentCurrents["T1#2"])[0], 0.4e-3, 1e-6, "|I2| = |I1|/n");
  });

  test("magnetic parts: a coupled inductor built from the palette solves in AC and matches the two-mesh closed form (k input, then M input)", async () => {
    // 1a=0, 1b=1, 2a=2, 2b=3: R2 across the secondary winding, 2b grounded.
    await buildMagneticCircuit("COUPLED_L", (part) => [[part, 2, "R2", 0], [part, 3, "G1", 0]]);
    // R2's other end is already tied to G1 by the common wire list; the load is R2 between 2a and ground (2b is grounded too).
    const expected = (m) => {
      const omega = 2 * Math.PI * 159.155, jw = (x) => ({ re: 0, im: omega * x });
      const mul = (a, b) => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re });
      const div = (a, b) => { const d = b.re * b.re + b.im * b.im; return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d }; };
      const add = (a, b) => ({ re: a.re + b.re, im: a.im + b.im });
      // winding 2 shorted through R2 to ground at 2a with 2b grounded: v2 = −R2·i2 (R2 = 1k from 2a to ground)
      const z1 = add({ re: 1000, im: 0 }, jw(0.01)), z2 = add({ re: 1000, im: 0 }, jw(0.01)), zm = jw(m);
      const i1 = div({ re: 1, im: 0 }, add(z1, div(mul(zm, zm), { re: -z2.re, im: -z2.im })));
      return i1;
    };
    await selectPart("K1");
    await click("#inspector-tab");
    let result = await acPhasors();
    const defaults = polarOf(result.points[0].componentCurrents.K1);
    const closed = polarOf(expected(0.005));
    near(defaults[0], closed[0], 1e-6, "|I1| for k = 0.5 (M = 5 mH)");
    await select('#inspector-content [data-prop="coupling"]', "M");
    await fillField('#inspector-content [data-prop="M"]', "9m");
    result = await acPhasors();
    near(polarOf(result.points[0].componentCurrents.K1)[0], polarOf(expected(0.009))[0], 1e-6, "|I1| for M = 9 mH");
    // M above sqrt(L1 L2) = 10 mH is rejected by the analysis with the reason, never clamped
    await fillField('#inspector-content [data-prop="M"]', "11m");
    await click("#run-button");
    await until(`${L}.getState().runState.status === "error"`, "the over-coupled run to fail");
    assert.equal((await state()).runState.error.code, "INVALID_VALUE");
  });

});
