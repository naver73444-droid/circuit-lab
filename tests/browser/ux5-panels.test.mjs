// Editor panels for a first-time student: real server + headless Edge (throw-away profile, see harness.mjs), desktop and phone
// emulation (touch input as in mobile-editor.test.mjs). Covers the waveform value line on a phone, the browser back button
// (workspaces, phone overlays, leaving the app only at the very end), the pinned graph cursor surviving a value change, undo/redo in
// the phone tab bar, the tab highlight following the scroll, the ⓘ description on a phone and the low empty waveform panel on a PC.
// Run with `node --test tests/browser/ux5-panels.test.mjs`.
import { describe, test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  L, ctx, ev, until, settle, navigate, state, partPoint, click, clickAt, clickPart, plotPoint, sleep,
  startServer, startBrowser, stopAll, leftoverProcessIds, isAlive, assertNoProblems, resetProblems,
} from "./harness.mjs";

const PHONE = [390, 844];
const SMALL_PHONE = [375, 667];
const NARROW_PHONE = [360, 740];

const touch = (type, touchPoints) => ctx.cdp.send("Input.dispatchTouchEvent", { type, touchPoints });
async function tap(point, holdMs = 40) { await touch("touchStart", [{ x: point.x, y: point.y }]); await sleep(holdMs); await touch("touchEnd", []); await settle(); }
const rectOf = (selector) => ev(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, top: r.top, bottom: r.bottom, left: r.left, right: r.right, w: r.width, h: r.height }; })()`);
async function tapSelector(selector) { const r = await rectOf(selector); assert.ok(r && r.w > 0, `missing ${selector}`); await tap(r); }
const reachable = (selector) => ev(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return false; const r = e.getBoundingClientRect(); const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return Boolean(hit && e.contains(hit)); })()`);
async function phone(path, [width, height]) {
  await ctx.cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await navigate(path, { width, height, mobile: true });
}
async function desktop(path) {
  await ctx.cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false });
  await navigate(path, { width: 1440, height: 900 });
}
/** A fresh history: about:blank first, so a back step past the app's first entry lands there. */
async function fromBlank(open, path, size) {
  await ctx.cdp.send("Page.navigate", { url: "about:blank" });
  await sleep(200);
  await open(path, size);
  await ev(`window.__ux5Mark = 1`);
}
const layout = () => ev(`${L}.getLayout()`);
const scope = async () => (await state()).scope;
const sheet = () => ev(`${L}.getValueSheet()`);
const back = async () => { await ev(`history.back()`); await sleep(150); await settle(); };
const sameDocument = () => ev(`window.__ux5Mark === 1`).catch(() => false);
/** Bottom of the area not covered by the tab bar or the docked value sheet. */
const visibleBottom = () => ev(`(() => { let b = innerHeight; for (const e of [document.querySelector(".view-tabs"), document.getElementById("value-sheet")]) { if (!e || e.hidden) continue; const r = e.getBoundingClientRect(); if (r.height > 0) b = Math.min(b, r.top); } return b; })()`);
const transientDone = () => until(`${L}.getState().runState.status === "success" && ${L}.getState().result?.analysis === "transient"`, "the transient run");

describe("editor panels", { timeout: 300000 }, () => {
  let startedPids = [];
  before(async () => { await startServer(); await startBrowser(); });
  beforeEach(() => resetProblems());
  afterEach(async () => { await assertNoProblems("console/network"); });
  after(async () => {
    startedPids = [ctx.edge?.pid, ctx.server?.pid].filter(Boolean);
    const stopped = await stopAll();
    for (const pid of new Set([...startedPids, ...stopped])) assert.equal(isAlive(pid), false, `process ${pid} should have been stopped`);
    assert.deepEqual(leftoverProcessIds(), [], "no process may still carry the throw-away Edge profile");
  });

  for (const size of [PHONE, SMALL_PHONE]) {
    test(`${size[0]}x${size[1]}: 파형 brings the plot and its value line above the tab bar; a tap on the plot keeps the value line on screen`, async () => {
      await phone("/?example=rc-charge", size);
      await transientDone();
      await tapSelector('.view-tabs [data-view="wave"]');
      await until(`document.querySelectorAll("#wave-plot path.plot-line").length > 0`, "a waveform");
      const limit = await visibleBottom();
      const plot = await rectOf("#wave-panel .plot-wrap"), readout = await rectOf("#cursor-readout");
      assert.ok(plot.top >= 0 && readout.bottom <= limit + 1, `plot (${plot.top}…${plot.bottom}) and value line (…${readout.bottom}) fit above ${limit}`);
      assert.ok(readout.top >= plot.bottom - 1, "the value line sits right under the plot");
      const point = await plotPoint(0.3);
      await tap(point);
      assert.notEqual((await scope()).pinnedIndex, null, "the tap pinned the cursor");
      const after = await rectOf("#cursor-readout");
      assert.ok(after.bottom <= (await visibleBottom()) + 1 && after.top >= 0, `the value line is on screen after the tap (${JSON.stringify(after)})`);
      assert.match(await ev(`document.getElementById("cursor-readout").textContent`), /V\(|I\(/, "it shows the values");
      assert.ok(await reachable("#cursor-readout"), "nothing covers it");
    });
  }

  test("phone: undo and redo sit in the tab bar (44 px, disabled with nothing to undo) and work from the 파형 panel", async () => {
    await phone("/?example=divider", PHONE);
    const undo = await rectOf("#undo-button"), redo = await rectOf("#redo-button");
    assert.equal(await ev(`document.querySelector(".view-tabs").contains(document.getElementById("undo-button")) && document.querySelector(".view-tabs").contains(document.getElementById("redo-button"))`), true);
    assert.ok(undo.w >= 44 && undo.h >= 44 && redo.w >= 44 && redo.h >= 44, `44 px targets (${undo.w}x${undo.h}, ${redo.w}x${redo.h})`);
    const tabs = await ev(`[...document.querySelectorAll(".view-tabs [data-view]")].map((b) => { const r = b.getBoundingClientRect(); return { text: b.textContent.trim(), w: r.width, h: r.height }; })`);
    assert.deepEqual(tabs.map((t) => t.text), ["회로", "속성", "결과", "파형"]);
    assert.ok(tabs.every((t) => t.w >= 44 && t.h >= 44), `tabs keep 44 px (${JSON.stringify(tabs)})`);
    const depth = (await state()).historyDepth;
    assert.equal(await ev(`document.getElementById("undo-button").disabled`), depth === 0, "enabled only with something to undo");
    await tap(await partPoint("R1"));
    assert.equal((await sheet()).visible, true);
    await tapSelector('#value-sheet [data-step="1"]');
    assert.equal((await state()).historyDepth, depth + 1);
    await tapSelector('.view-tabs [data-view="wave"]');
    assert.ok(await reachable("#undo-button"), "undo is on screen on the 파형 panel");
    assert.equal(await ev(`document.getElementById("undo-button").disabled`), false);
    await tapSelector("#undo-button");
    assert.equal((await state()).historyDepth, depth, "one tap undid the step");
    assert.equal(await ev(`document.getElementById("redo-button").disabled`), false, "and redo is offered");
    for (let n = (await state()).historyDepth; n > 0; n -= 1) await tapSelector("#undo-button");
    assert.equal(await ev(`document.getElementById("undo-button").disabled`), true, "nothing left to undo: disabled");
    assert.ok(await reachable("#undo-button"), "and still on screen (dimmed), the tab bar keeps its layout");
  });

  test("360x740: the tab highlight follows the scroll; 회로 goes back to the canvas, a second tap on to the part list", async () => {
    await phone("/?example=rc-charge", NARROW_PHONE);
    const selected = () => ev(`[...document.querySelectorAll(".view-tabs [data-view]")].filter((b) => b.getAttribute("aria-selected") === "true").map((b) => b.dataset.view)`);
    assert.deepEqual(await selected(), ["palette"]);
    await tapSelector('.view-tabs [data-view="wave"]');
    assert.deepEqual(await selected(), ["wave"], "the 파형 tab once its panel is on screen");
    await ev(`document.getElementById("workbench").scrollTop = 0`); await sleep(100); await settle();
    assert.deepEqual(await selected(), ["palette"], "scrolled back up to the circuit: 회로");
    assert.equal((await layout()).view, "wave", "the panel under the canvas did not change");
    await ev(`(() => { const w = document.getElementById("workbench"); w.scrollTop = w.scrollHeight; })()`); await sleep(100); await settle();
    assert.deepEqual(await selected(), ["wave"], "scrolled down to the waveform: 파형");
    await tapSelector('.view-tabs [data-view="palette"]');
    assert.equal(await ev(`document.getElementById("workbench").scrollTop`), 0, "회로 brings the canvas back");
    assert.equal((await layout()).view, "palette");
    assert.deepEqual(await selected(), ["palette"]);
    await tapSelector('.view-tabs [data-view="palette"]');
    assert.ok(await ev(`document.getElementById("workbench").scrollTop > 0`), "a second tap scrolls on to the part list");
    assert.ok(await reachable('.palette-item[data-type="R"]'), "the part list is on screen");
  });

  test("360x740: ⓘ unfolds the example's description; the theme names and the status line are not cut off", async () => {
    await phone("/?example=rc-charge", NARROW_PHONE);
    assert.equal(await ev(`getComputedStyle(document.getElementById("canvas-subtitle")).display`), "none", "folded at first");
    const info = await rectOf("#caption-info-button");
    assert.ok(info.w >= 44 && info.h >= 44, `44 px ⓘ (${info.w}x${info.h})`);
    await tapSelector("#caption-info-button");
    const text = await ev(`document.getElementById("canvas-subtitle").textContent`);
    assert.match(text, /3\.1606 V/, "the textbook answer");
    const span = await rectOf("#canvas-subtitle");
    assert.ok(span.h > 0 && span.left >= 0 && span.right <= 361, `shown inside the screen (${JSON.stringify(span)})`);
    assert.equal(await ev(`(() => { const e = document.getElementById("canvas-subtitle"); return e.scrollWidth <= e.clientWidth + 1; })()`), true, "wrapped, not cut");
    assert.equal(await ev(`document.getElementById("caption-info-button").getAttribute("aria-expanded")`), "true");
    await tapSelector("#caption-info-button");
    assert.equal(await ev(`getComputedStyle(document.getElementById("canvas-subtitle")).display`), "none", "folds again");
    // Theme select: the longest name fits the box (text width + arrow/padding room).
    const theme = await ev(`(() => { const s = document.getElementById("appearance"), cs = getComputedStyle(s), c = document.createElement("canvas").getContext("2d"); c.font = cs.fontSize + " " + cs.fontFamily; const widest = Math.max(...[...s.options].map((o) => c.measureText(o.text).width)); return { widest, box: s.clientWidth, padding: parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) }; })()`);
    assert.ok(theme.widest + theme.padding + 18 <= theme.box + 0.5, `"라이트"/"시스템" fit the theme select (${JSON.stringify(theme)})`);
    // A real status after a run (e.g. "최신 결과 · 자동 · 29 ms") wraps inside its box without being cut, and never changes the row height.
    await until(`/최신 결과|해석 완료/.test(document.getElementById("engine-status").textContent)`, "a status after the run");
    assert.equal(await ev(`(() => { const e = document.getElementById("engine-status"); return e.scrollHeight <= e.clientHeight + 1; })()`), true, `the whole status is readable: ${await ev(`document.getElementById("engine-status").textContent`)}`);
    for (const id of ["engine-status", "tool-hint"]) {
      assert.equal(await ev(`(() => { const e = document.getElementById(${JSON.stringify(id)}); return e.scrollWidth <= e.clientWidth + 1 && getComputedStyle(e).textOverflow !== "ellipsis"; })()`), true, `#${id} wraps instead of being cut`);
    }
    assert.equal(await ev(`document.documentElement.scrollWidth <= innerWidth + 1`), true, "no sideways overflow");
  });

  test("back button: workspaces step back one by one and only the last step leaves the app (desktop)", async () => {
    await fromBlank(desktop, "/?example=divider");
    await click("#em-workspace-tab");
    await until(`${L}.getWorkspace() === "em"`, "the EM workspace");
    assert.match(await ev(`location.search`), /workspace=em/);
    await click("#signals-workspace-tab");
    await until(`${L}.getWorkspace() === "signals"`, "the signals workspace");
    await back();
    await until(`${L}.getWorkspace() === "em" && !document.getElementById("em-workspace").hidden`, "back to EM");
    await back();
    await until(`${L}.getWorkspace() === "circuit" && !document.getElementById("workbench").hidden`, "back to the circuit editor");
    assert.equal(await sameDocument(), true, "still the same page");
    assert.doesNotMatch(await ev(`location.search`), /workspace=/);
    await ev(`history.forward()`); await sleep(150);
    await until(`${L}.getWorkspace() === "em"`, "forward to EM again");
    await back();
    await until(`${L}.getWorkspace() === "circuit"`, "and back");
    await ev(`history.back()`).catch(() => {});
    await until(`location.href === "about:blank"`, "the last back leaves the app");
  });

  test("back button on a phone: closes the value sheet, the file menu and the help card first; a ✕-closed sheet leaves no extra step", async () => {
    await fromBlank(phone, "/?example=divider", PHONE);
    await tap(await partPoint("R1"));
    assert.equal((await sheet()).visible, true);
    await back();
    assert.equal((await sheet()).visible, false, "back closed the value sheet");
    assert.equal(await sameDocument(), true, "without leaving the app");
    assert.equal(await ev(`${L}.getWorkspace()`), "circuit");
    await tapSelector("#file-menu > summary");
    assert.equal(await ev(`document.getElementById("file-menu").open`), true);
    await back();
    assert.equal(await ev(`document.getElementById("file-menu").open`), false, "back closed the file menu");
    await tapSelector("#interaction-help > summary");
    assert.equal(await ev(`document.getElementById("interaction-help").open`), true);
    await back();
    assert.equal(await ev(`document.getElementById("interaction-help").open`), false, "back closed the help card");
    assert.equal(await sameDocument(), true);
    // Overlay on top of a workspace step: back closes it, the next back returns to the circuit.
    await tapSelector("#em-workspace-tab");
    await until(`${L}.getWorkspace() === "em"`, "EM");
    await tapSelector("#circuit-workspace-tab");
    await until(`${L}.getWorkspace() === "circuit"`, "the editor");
    await tap(await partPoint("R1"));
    assert.equal((await sheet()).visible, true);
    await tapSelector('#value-sheet [data-sheet-action="close"]');
    await sleep(150); await settle();
    assert.equal((await sheet()).visible, false);
    await back();
    await until(`${L}.getWorkspace() === "em"`, "a ✕-closed sheet left no step: back goes to EM");
    await back();
    await until(`${L}.getWorkspace() === "circuit"`, "then to the editor");
    assert.equal(await sameDocument(), true);
    await ev(`history.back()`).catch(() => {});
    await until(`location.href === "about:blank"`, "only the last back leaves the app");
  });

  test("a value change keeps the pinned graph cursor at its time (desktop)", async () => {
    await desktop("/?example=rc-charge");
    await transientDone();
    const point = await plotPoint(0.4);
    await clickAt(point.x, point.y); await settle();
    const pinned = await scope();
    assert.notEqual(pinned.pinnedIndex, null, "the click pinned the cursor");
    const x = (await state()).result.xValues[pinned.pinnedIndex];
    const generation = (await state()).generation;
    await clickPart("C1");
    await click('#value-sheet [data-step="1"]');
    await until(`${L}.getState().generation !== ${generation} && ${L}.getState().runState.status === "success" && !${L}.getState().stale`, "the re-run after the value change");
    await sleep(200);
    const now = await scope(), result = (await state()).result;
    assert.notEqual(now.pinnedIndex, null, "still pinned");
    assert.ok(Math.abs(result.xValues[now.pinnedIndex] - x) <= (result.xValues[1] - result.xValues[0]) + 1e-12, `at the same time (${x} → ${result.xValues[now.pinnedIndex]})`);
    assert.match(await ev(`document.getElementById("cursor-readout").textContent`), /고정 측정/);
  });

  test("a value change keeps the pinned graph cursor at its time (phone)", async () => {
    await phone("/?example=rc-charge", PHONE);
    await transientDone();
    await tapSelector('.view-tabs [data-view="wave"]');
    await tap(await plotPoint(0.4));
    const pinned = await scope();
    assert.notEqual(pinned.pinnedIndex, null, "the tap pinned the cursor");
    const x = (await state()).result.xValues[pinned.pinnedIndex];
    await tapSelector('.view-tabs [data-view="palette"]');
    await tap(await partPoint("C1"));
    assert.equal((await sheet()).visible, true);
    const generation = (await state()).generation;
    await tapSelector('#value-sheet [data-step="1"]');
    await until(`${L}.getState().generation !== ${generation} && ${L}.getState().runState.status === "success" && !${L}.getState().stale`, "the re-run after the value change");
    await sleep(200);
    const now = await scope(), result = (await state()).result;
    assert.notEqual(now.pinnedIndex, null, "still pinned");
    assert.ok(Math.abs(result.xValues[now.pinnedIndex] - x) <= (result.xValues[1] - result.xValues[0]) + 1e-12, `at the same time (${x} → ${result.xValues[now.pinnedIndex]})`);
  });

  test("PC: before a result the waveform panel is one hint line high, with a result it takes its full height", async () => {
    await desktop("/");
    await ev(`localStorage.clear()`);
    await desktop("/");
    const empty = await rectOf("#wave-panel");
    assert.ok(empty.h <= 140, `empty waveform panel is low (${empty.h} px)`);
    assert.equal(await ev(`getComputedStyle(document.getElementById("plot-empty")).display !== "none"`), true, "the hint is shown");
    const canvasEmpty = await rectOf("#canvas-wrap");
    await desktop("/?example=rc-charge");
    await transientDone();
    await until(`document.getElementById("plot-empty").classList.contains("hidden")`, "the plot to replace the hint");
    await settle();
    const full = await rectOf("#wave-panel");
    assert.ok(full.h >= 300, `with a result the panel is full height (${full.h} px)`);
    assert.ok((await rectOf("#canvas-wrap")).h < canvasEmpty.h, "the circuit had the room before");
  });
});
