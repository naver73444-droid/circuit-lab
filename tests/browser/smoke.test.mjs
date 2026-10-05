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
});
