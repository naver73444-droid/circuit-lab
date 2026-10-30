// iPad (Air 4: 820 × 1180 CSS px) with touch, in a real (headless) browser: landscape shows the circuit at full height and one panel at
// a time in the right column; portrait keeps the phone layout; every control a finger can reach is 44 px tall and every field has 16 px
// text (Safari zooms into smaller ones); a mouse at the same width keeps the desktop grid. Run with `node --test tests/browser/ipad.test.mjs`.
import { describe, test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { L, ctx, ev, until, settle, navigate, click, problems, startServer, startBrowser, stopAll, assertNoProblems, resetProblems } from "./harness.mjs";

const LANDSCAPE = { width: 1180, height: 740, mobile: true }, PORTRAIT = { width: 820, height: 1100, mobile: true };
const touch = (enabled) => ctx.cdp.send("Emulation.setTouchEmulationEnabled", { enabled, maxTouchPoints: enabled ? 5 : 1 });
const box = (selector) => ev(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e || e.hidden || !e.offsetParent && getComputedStyle(e).position !== "fixed") return null;
  const r = e.getBoundingClientRect(); return { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }; })()`);
/** Visible controls under 44 px tall, and fields with text under 16 px, inside `scope`. */
const fingerProblems = (scope) => ev(`(() => {
  const out = [];
  for (const e of document.querySelectorAll(${JSON.stringify(scope)} + " :is(button, select, summary, input:not([type=checkbox]):not([type=radio]):not([type=color]), textarea)")) {
    const r = e.getBoundingClientRect();
    if (!r.width || !r.height || e.closest("[hidden]") || getComputedStyle(e).visibility === "hidden") continue;
    if (r.height < 44) out.push((e.id || e.textContent.trim().slice(0, 12) || e.tagName) + " " + Math.round(r.height) + "px tall");
    if (e.matches("input:not([type=range]), select, textarea") && parseFloat(getComputedStyle(e).fontSize) < 16) out.push((e.id || e.tagName) + " text " + getComputedStyle(e).fontSize);
  }
  return out;
})()`);
const overflow = () => ev(`document.documentElement.scrollWidth > innerWidth + 1`);
function dropLinuxManifestIcon() {
  if (process.platform !== "linux") return;
  for (let i = problems.length - 1; i >= 0; i -= 1) if (/Error while trying to use the following icon from the Manifest/.test(problems[i])) problems.splice(i, 1);
}

describe("iPad layout", { timeout: 300000 }, () => {
  before(async () => { await startServer(); await startBrowser(); });
  beforeEach(() => resetProblems());
  afterEach(async () => { dropLinuxManifestIcon(); await assertNoProblems("console/network"); await touch(false); });
  after(async () => { await stopAll(); });

  test("landscape: the circuit fills the left at full height, the right column shows one panel chosen by 부품·속성·결과·파형", async () => {
    await touch(true);
    await navigate("/?example=rlc", LANDSCAPE);
    assert.equal(await ev(`matchMedia("(pointer: coarse)").matches`), true, "touch emulation gives a coarse pointer");
    const canvas = await box("#canvas-wrap");
    assert.ok(canvas.width >= 760 && canvas.height >= 450, `the circuit is large (${canvas.width}×${canvas.height})`);
    assert.deepEqual(await ev(`[...document.querySelectorAll(".view-tabs [data-view]")].map((b) => b.textContent.trim())`), ["부품", "속성", "결과", "파형"]);
    const tabs = await box(".view-tabs");
    assert.ok(tabs.left > canvas.left + canvas.width && tabs.top < 130, "the tab row heads the right column");
    const open = () => ev(`["palette-panel", "side-panel", "wave-panel"].filter((id) => !document.getElementById(id).hidden)`);
    assert.deepEqual(await open(), ["palette-panel"], "one panel at a time, the part list first");
    await click('.view-tabs [data-view="wave"]');
    assert.deepEqual(await open(), ["wave-panel"]);
    const plot = await box("#wave-panel .plot-wrap");
    assert.ok(plot.height >= 200, `the plot keeps its height in the column (${plot.height} px)`);
    await click('.view-tabs [data-view="inspector"]');
    assert.deepEqual(await open(), ["side-panel"]);
    assert.equal(await ev(`getComputedStyle(document.querySelector(".side-tabs")).display`), "none", "no second 속성/결과 tab row");
    await click('.view-tabs [data-view="palette"]');

    // One row of editing tools: the zoom controls sit in the canvas corner, the file actions in a popover.
    assert.equal(await ev(`document.getElementById("zoom-group").parentElement.id`), "canvas-corner");
    assert.equal(await ev(`new Set([...document.querySelectorAll(".canvas-bar > *")].filter((e) => e.offsetParent).map((e) => Math.round(e.getBoundingClientRect().top))).size`), 1, "tools on one row");
    assert.equal(await ev(`document.getElementById("file-menu").open`), false, "the file menu starts closed");
    await click("#file-menu > summary");
    assert.equal(await ev(`document.getElementById("file-menu").open`), true);
    await click("#canvas-wrap");
    assert.equal(await ev(`document.getElementById("file-menu").open`), false, "a tap outside closes it");

    assert.deepEqual(await fingerProblems("#workbench"), []);
    assert.deepEqual(await fingerProblems(".topbar"), []);
    assert.equal(await overflow(), false);
  });

  test("landscape: every workspace keeps finger-sized controls and 16 px fields; the course page starts at its study controls", async () => {
    await touch(true);
    await navigate("/", LANDSCAPE);
    for (const [tab, scope] of [["#em-workspace-tab", "#em-workspace"], ["#signals-workspace-tab", "#signals-workspace"], ["#circuit-course-workspace-tab", "#circuit-course-workspace"]]) {
      await click(tab);
      await until(`!document.querySelector(${JSON.stringify(scope)}).hidden && document.querySelector(${JSON.stringify(scope)}).querySelectorAll("button").length > 3`, scope);
      await settle();
      assert.deepEqual(await fingerProblems(scope), [], scope);
      assert.equal(await overflow(), false, scope + ": no horizontal overflow");
    }
    assert.equal(await box("#circuit-course-back"), null, "the workspace tab leads back to the editor; no second back button");
    const chapters = await box("#circuit-course-host .circuit-course-chapters");
    assert.ok(chapters.top < 220, `the chapter row is near the top (${chapters.top} px)`);
  });

  test("portrait keeps the phone layout (canvas, then one panel, tab bar at the bottom); a mouse at landscape width keeps the desktop grid", async () => {
    await touch(true);
    await navigate("/?example=rlc", PORTRAIT);
    const bar = await box(".view-tabs");
    assert.ok(bar.top > 1000, "the tab bar is at the bottom");
    assert.equal(await ev(`document.querySelector('.view-tabs [data-view="palette"]').textContent.trim()`), "회로");
    assert.deepEqual(await fingerProblems("#workbench"), []);
    assert.equal(await overflow(), false);

    await touch(false);
    await navigate("/?example=rlc", { width: 1180, height: 740 });
    assert.equal(await ev(`matchMedia("(pointer: coarse)").matches`), false);
    assert.deepEqual(await ev(`["palette-panel", "side-panel", "wave-panel"].filter((id) => !document.getElementById(id).hidden)`), ["palette-panel", "side-panel", "wave-panel"], "desktop: all panels");
    assert.equal(await ev(`getComputedStyle(document.querySelector(".view-tabs")).display`), "none");
    assert.equal(await ev(`document.getElementById("zoom-group").parentElement.id === "canvas-corner"`), false, "zoom controls back in the toolbar");
    assert.equal(await ev(`document.getElementById("file-menu").open`), true, "file actions inline");
  });
});
