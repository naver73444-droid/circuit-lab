// Phone editor checks: real server + headless Edge (throw-away profile, see harness.mjs) in mobile emulation with touch input
// (Emulation.setDeviceMetricsOverride mobile:true + Emulation.setTouchEmulationEnabled, gestures via Input.dispatchTouchEvent).
// Run with `npm run test:mobile`. Set MOBILE_UX_SHOTS=<dir> to also save a few phone screenshots there.
import { describe, test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  L, ctx, ev, until, settle, navigate, state, component, partPoint, click, sleep, nodeValue,
  startServer, startBrowser, stopAll, leftoverProcessIds, isAlive, assertNoProblems, resetProblems,
} from "./harness.mjs";

const PHONES = [[390, 844], [360, 740], [375, 667]];
const SHOTS = process.env.MOBILE_UX_SHOTS || "";

const touch = (type, touchPoints) => ctx.cdp.send("Input.dispatchTouchEvent", { type, touchPoints });
async function tap(point, holdMs = 40) { await touch("touchStart", [{ x: point.x, y: point.y }]); await sleep(holdMs); await touch("touchEnd", []); await settle(); }
async function touchDragPoints(from, to, { steps = 8, holdMs = 0 } = {}) {
  await touch("touchStart", [{ x: from.x, y: from.y }]);
  if (holdMs) await sleep(holdMs);
  for (let i = 1; i <= steps; i += 1) { await touch("touchMove", [{ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps }]); await sleep(16); }
  await settle();
  await touch("touchEnd", []);
  await settle();
}
const rectOf = (selector) => ev(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, top: r.top, bottom: r.bottom, left: r.left, right: r.right, w: r.width, h: r.height }; })()`);
async function tapSelector(selector) { const r = await rectOf(selector); assert.ok(r && r.w > 0, `missing ${selector}`); await tap(r); }
async function phone(path, [width, height]) {
  await ctx.cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await navigate(path, { width, height, mobile: true });
}
async function shot(name) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  const { data } = await ctx.cdp.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(data, "base64"));
}
/** The bottom tab bar is fully on screen, at the bottom, and really receives a tap at its centre. */
const tabBar = () => ev(`(() => {
  const bar = document.querySelector(".view-tabs"), r = bar.getBoundingClientRect(), s = getComputedStyle(bar);
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return { top: Math.round(r.top), bottom: Math.round(r.bottom), inner: innerHeight, shown: s.display !== "none" && s.visibility !== "hidden" && r.height > 40, reachable: Boolean(hit && bar.contains(hit)) };
})()`);
function assertBarVisible(bar, what) {
  assert.ok(bar.shown && bar.reachable, `${what}: the tab bar is shown and tappable (${JSON.stringify(bar)})`);
  assert.ok(bar.bottom <= bar.inner + 1 && bar.bottom >= bar.inner - 1, `${what}: the tab bar sits on the bottom edge (${JSON.stringify(bar)})`);
}
const sheet = () => ev(`${L}.getValueSheet()`);
const historyDepth = async () => (await state()).historyDepth;
const valueOf = async (id) => (await component(id)).props.value;
const middleVolts = async () => { const result = (await state()).result; return result ? nodeValue(result, 0, "R1", 1) : NaN; };

describe("phone editor", { timeout: 300000 }, () => {
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

  for (const size of PHONES) {
    test(`${size[0]}x${size[1]}: the bottom tab bar stays on screen — scrolled, every tab, a shrunk viewport, a stray document scroll; the keyboard never covers the field`, async () => {
      await phone("/?example=rc-charge", size);
      assertBarVisible(await tabBar(), "first screen");
      assert.equal(await ev(`getComputedStyle(document.querySelector(".view-tabs")).position`), "fixed");
      assert.equal(await ev(`document.documentElement.scrollWidth <= innerWidth + 1`), true, "no sideways overflow");
      await shot(`after-${size[0]}x${size[1]}-editor`);
      for (const view of ["inspector", "results", "wave", "palette"]) {
        await tapSelector(`.view-tabs [data-view="${view}"]`);
        assert.equal((await ev(`${L}.getLayout()`)).view, view, `tab ${view} switches the panel`);
        assertBarVisible(await tabBar(), `after the ${view} tab`);
        await ev(`(() => { const w = document.getElementById("workbench"); w.scrollTop = w.scrollHeight; })()`); await settle();
        assertBarVisible(await tabBar(), `${view} scrolled to the end`);
        const end = await ev(`(() => { const w = document.getElementById("workbench"), bar = document.querySelector(".view-tabs").getBoundingClientRect(); const last = [...w.children].filter((e) => !e.classList.contains("view-tabs") && e.getClientRects().length && getComputedStyle(e).position !== "fixed").map((e) => e.getBoundingClientRect().bottom); return { last: Math.max(...last), barTop: bar.top }; })()`);
        assert.ok(end.last <= end.barTop + 1, `${view}: the end of the content (${end.last}) is above the tab bar (${end.barTop})`);
        await ev(`document.getElementById("workbench").scrollTop = 0`);
      }
      // The browser bar / keyboard shrinking the viewport (interactive-widget=resizes-content, Firefox, address bar).
      await ctx.cdp.send("Emulation.setDeviceMetricsOverride", { width: size[0], height: size[1] - 260, deviceScaleFactor: 1, mobile: true });
      await settle(); await sleep(150);
      assertBarVisible(await tabBar(), "viewport shrunk by 260 px");
      await ctx.cdp.send("Emulation.setDeviceMetricsOverride", { width: size[0], height: size[1], deviceScaleFactor: 1, mobile: true });
      await settle(); await sleep(150);
      assertBarVisible(await tabBar(), "viewport restored");
      // iOS leaves the document shifted after the keyboard closes: the guard puts it back.
      const shifted = await ev(`(async () => { document.body.style.marginBottom = "400px"; window.scrollTo(0, 220); const during = scrollY; await new Promise((done) => setTimeout(done, 200)); const after = scrollY; document.body.style.marginBottom = ""; return { during, after }; })()`);
      assert.equal(shifted.after, 0, `a stray document scroll is undone (${JSON.stringify(shifted)})`);
      assertBarVisible(await tabBar(), "after the stray document scroll");
      // Keyboard: a focused inspector field with the viewport cut by a keyboard-sized amount.
      await tapSelector('.view-tabs [data-view="inspector"]');
      const r1 = await partPoint("R1");
      await ev(`document.getElementById("workbench").scrollTop = 0`); await settle();
      await tap(await partPoint("R1"));
      assert.equal((await state()).selected?.id, "R1");
      await tapSelector('.value-sheet [data-sheet-action="close"]'); // the inspector field is the one under test here
      await tapSelector('.view-tabs [data-view="inspector"]');
      await tapSelector('#inspector-content [data-prop="value"]');
      assert.equal(await ev(`document.activeElement?.dataset?.prop`), "value", "the inspector field has the focus");
      await ctx.cdp.send("Emulation.setDeviceMetricsOverride", { width: size[0], height: size[1] - 300, deviceScaleFactor: 1, mobile: true });
      await settle(); await sleep(200);
      const typing = await ev(`(() => { const f = document.activeElement.getBoundingClientRect(), bar = document.querySelector(".view-tabs"), b = bar.getBoundingClientRect(), shown = getComputedStyle(bar).display !== "none"; return { keyboard: document.documentElement.hasAttribute("data-keyboard"), fieldTop: f.top, fieldBottom: f.bottom, inner: innerHeight, barShown: shown, barTop: b.top }; })()`);
      assert.equal(typing.keyboard, true, "the keyboard state is detected");
      assert.ok(!typing.barShown || typing.barTop >= typing.fieldBottom, `the tab bar does not cover the field (${JSON.stringify(typing)})`);
      assert.ok(typing.fieldBottom <= typing.inner && typing.fieldTop >= 0, `the field is on screen (${JSON.stringify(typing)})`);
      await ev(`document.activeElement.blur()`);
      await ctx.cdp.send("Emulation.setDeviceMetricsOverride", { width: size[0], height: size[1], deviceScaleFactor: 1, mobile: true });
      await settle(); await sleep(150);
      assert.equal(await ev(`document.documentElement.hasAttribute("data-keyboard")`), false, "keyboard state cleared");
      assertBarVisible(await tabBar(), "after typing");
      void r1;
    });
  }

  test("390x844 value sheet: tap R1 → sheet; ▶ (E12), slider drag, held ▶, typed value + prefix chip — each one undo step, analysis follows", async () => {
    await phone("/?example=divider", PHONES[0]);
    await until(`${L}.getState().result?.analysis === "dc"`, "the first automatic DC result");
    near(await middleVolts(), 5, "1k : 1k");
    await tap(await partPoint("R1"));
    let info = await sheet();
    assert.equal(info.visible && info.phone && info.id === "R1" && info.prop === "value", true, `the sheet opens for R1 (${JSON.stringify(info)})`);
    await shot("after-390x844-value-sheet");
    // ▶ one E12 step: 1k → 1.2k, one history entry, the analysis re-runs on its own.
    let depth = await historyDepth();
    await tapSelector('.value-sheet [data-step="1"]');
    assert.equal(await valueOf("R1"), "1.2k");
    assert.equal(await historyDepth(), depth + 1, "one step = one undo entry");
    await until(`${L}.getState().runState.status === "success" && Math.abs(${L}.getState().result.points[0].nodeVoltages[${L}.getState().result.topology.nodeIdByPin["R1:1"]] - 10 / 2.2) < 1e-6`, "the analysis to follow the new value");
    // E24 series: ▶ from 1.2k gives 1.3k.
    await tapSelector('.value-sheet [data-sheet-action="series"]');
    assert.equal((await sheet()).series, "E24");
    depth = await historyDepth();
    await tapSelector('.value-sheet [data-step="1"]');
    assert.equal(await valueOf("R1"), "1.3k");
    assert.equal(await historyDepth(), depth + 1);
    // Slider: one drag with many moves = one history entry; the value is base × 10^position (3 significant figures).
    depth = await historyDepth();
    const range = await rectOf("#value-sheet-slider");
    await touchDragPoints({ x: range.x, y: range.y }, { x: range.x + range.w * 0.35, y: range.y }, { steps: 10 });
    const slid = await valueOf("R1");
    const slidOhms = Number.parseFloat(slid) * (slid.endsWith("k") ? 1e3 : 1);
    assert.ok(slidOhms > 1.3e3 * 2 && slidOhms < 1.3e3 * 10, `slid right: ${slid}`);
    assert.equal(await historyDepth(), depth + 1, `a whole slider drag is one undo entry (value ${slid})`);
    assert.equal((await sheet()).sliding, false, "the drag ended");
    // Held ▶: auto-repeat, still one undo entry.
    depth = await historyDepth();
    const before = await valueOf("R1");
    const stepButton = await rectOf('.value-sheet [data-step="1"]');
    await tap(stepButton, 1100);
    const held = await valueOf("R1");
    assert.notEqual(held, before);
    assert.equal(await historyDepth(), depth + 1, `holding ▶ (${before} → ${held}) is one undo entry`);
    // Typed number + prefix chip ("4.7" then k) = 4.7k, one entry; the field asks for the number pad.
    assert.equal(await ev(`document.getElementById("value-sheet-input").inputMode`), "decimal");
    depth = await historyDepth();
    await tapSelector("#value-sheet-input");
    await ev(`document.getElementById("value-sheet-input").select()`);
    await ctx.cdp.send("Input.insertText", { text: "4.7" });
    await tapSelector('.value-sheet [data-prefix="k"]');
    assert.equal(await valueOf("R1"), "4.7k");
    assert.equal(await historyDepth(), depth + 1);
    await ev(`document.activeElement.blur()`); await settle();
    assert.equal(await historyDepth(), depth + 1, "leaving the field adds nothing more");
    // Every control of the sheet is a full touch target, the field text is 16px or more (no iOS zoom).
    const small = await ev(`[...document.querySelectorAll(".value-sheet button, .value-sheet input")].filter((e) => !e.hidden).map((e) => { const r = e.getBoundingClientRect(); return { what: e.dataset.step ?? e.dataset.prefix ?? e.dataset.sheetAction ?? e.id, w: Math.round(r.width), h: Math.round(r.height) }; }).filter((t) => t.h < 44 || (t.what !== "value-sheet-slider" && t.what !== "value-sheet-input" && t.w < 44))`);
    assert.deepEqual(small, [], "sheet targets ≥ 44 px");
    assert.ok(await ev(`parseFloat(getComputedStyle(document.getElementById("value-sheet-input")).fontSize) >= 16`));
    // Undo takes back exactly the last gesture.
    await click("#undo-button");
    assert.equal(await valueOf("R1"), held, "undo restores the value before the typed edit");
    await tap(await partPoint("R1")); // undo clears the selection; choose R1 again
    // ✕ hides the sheet and the tabs are back; tapping the part again brings it back.
    await tapSelector('.value-sheet [data-sheet-action="close"]');
    assert.equal((await sheet()).visible, false);
    assertBarVisible(await tabBar(), "sheet closed");
    await tap(await partPoint("R1"));
    assert.equal((await sheet()).visible, true, "an explicit tap on the part reopens it");
    // A source: the sheet steps the DC value along 1-2-5-like nice numbers.
    await tap(await partPoint("V1"));
    info = await sheet();
    assert.equal(info.id === "V1" && info.prop === "dc", true, JSON.stringify(info));
    await tapSelector('.value-sheet [data-step="1"]');
    assert.equal((await component("V1")).props.dc, "12");
  });

  test("390x844 value sheet folds: dragging the canvas or tapping another part leaves only the value row with ◀ ▶, the handle opens it again, and a part under the sheet slides into view", async () => {
    await phone("/?example=divider", PHONES[0]);
    await until(`${L}.getState().result?.analysis === "dc"`, "the first automatic DC result");
    const shown = (selector) => ev(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); return Boolean(e && e.getClientRects().length && getComputedStyle(e).display !== "none"); })()`);
    // An empty spot of the canvas above the sheet (a swipe there pans).
    const emptySpot = () => ev(`(() => {
      const canvas = document.getElementById("circuit-canvas"), r = canvas.getBoundingClientRect(), sheet = document.getElementById("value-sheet");
      const bottom = Math.min(r.bottom, sheet.hidden ? innerHeight : sheet.getBoundingClientRect().top) - 12;
      for (let y = r.top + 80; y < bottom; y += 12) for (let x = r.left + 16; x < r.right - 16; x += 12) {
        const hit = document.elementFromPoint(x, y);
        if (hit && canvas.contains(hit) && !hit.closest(".component, .wire-hit, [data-wire-id], [data-junction-id]")) return { x, y };
      }
      return null;
    })()`);
    const swipe = async (dy) => { const at = await emptySpot(); assert.ok(at, "an empty canvas spot"); await touchDragPoints(at, { x: at.x, y: at.y + dy }, { steps: 8 }); };
    await tap(await partPoint("R1"));
    let info = await sheet();
    assert.equal(info.visible && !info.collapsed && info.id === "R1", true, `the sheet opens unfolded the first time (${JSON.stringify(info)})`);
    const unfolded = await rectOf("#value-sheet");
    assert.equal(await shown("#value-sheet-slider"), true);
    // Dragging the canvas folds it: value row + ◀ ▶, no slider, no prefix chips, at least 60 px less of the canvas covered.
    await swipe(30);
    info = await sheet();
    assert.equal(info.visible && info.collapsed && info.id === "R1", true, `a canvas drag folds the sheet (${JSON.stringify(info)})`);
    const folded = await rectOf("#value-sheet");
    assert.ok(folded.h <= unfolded.h - 60 && folded.top >= unfolded.top + 60, `folded ${folded.h} px vs ${unfolded.h} px`);
    assert.equal(await shown("#value-sheet-slider"), false, "no slider when folded");
    assert.equal(await shown(".value-sheet-prefixes"), false, "no prefix chips when folded");
    assert.equal(await shown("#value-sheet-input"), true, "the value field stays");
    for (const step of ["-1", "1"]) {
      const r = await rectOf(`.value-sheet [data-step="${step}"]`);
      assert.ok(r && r.w >= 44 && r.h >= 44 && r.top >= folded.top, `◀ ▶ stay as full touch targets (${JSON.stringify(r)})`);
    }
    const depth = await historyDepth();
    await tapSelector('.value-sheet [data-step="1"]');
    assert.equal(await valueOf("R1"), "1.2k", "▶ still steps when folded");
    assert.equal(await historyDepth(), depth + 1);
    // The handle: a tap opens, a drag down folds, a drag up opens.
    await tapSelector(".value-sheet-handle");
    assert.equal((await sheet()).collapsed, false, "a tap on the handle opens the sheet");
    assert.equal(await shown("#value-sheet-slider"), true);
    let handle = await rectOf(".value-sheet-handle");
    await touchDragPoints(handle, { x: handle.x, y: handle.y + 60 }, { steps: 6 });
    assert.equal((await sheet()).collapsed, true, "dragging the handle down folds it");
    handle = await rectOf(".value-sheet-handle");
    await touchDragPoints(handle, { x: handle.x, y: handle.y - 80 }, { steps: 6 });
    assert.equal((await sheet()).collapsed, false, "dragging the handle up opens it");
    // Tapping another part folds it, and it stays folded for the next part (also after ✕).
    await tap(await partPoint("V1"));
    info = await sheet();
    assert.equal(info.visible && info.collapsed && info.id === "V1", true, `another part folds the sheet (${JSON.stringify(info)})`);
    await tapSelector('.value-sheet [data-sheet-action="close"]');
    await tap(await partPoint("R1"));
    info = await sheet();
    assert.equal(info.visible && info.collapsed && info.id === "R1", true, `the folded state is kept (${JSON.stringify(info)})`);
    await shot("after-390x844-value-sheet-folded");
    // A part that ends up under the unfolded sheet slides up into view when the handle opens it.
    const target = folded.top - 24; // R2's bottom just above the folded sheet, well under the unfolded one
    const r2 = await rectOf('.component[data-id="R2"]');
    await swipe(target - r2.bottom);
    await tap(await partPoint("R2"));
    let part = await rectOf('.component[data-id="R2"]');
    let top = (await rectOf("#value-sheet")).top;
    assert.ok((await sheet()).collapsed && part.bottom <= top, `R2 is above the folded sheet (${part.bottom} <= ${top})`);
    assert.ok(part.bottom > unfolded.top, `R2 would be under the unfolded sheet (${part.bottom} > ${unfolded.top})`);
    const viewBefore = (await state()).canvasView;
    await tapSelector(".value-sheet-handle");
    await settle();
    part = await rectOf('.component[data-id="R2"]');
    top = (await rectOf("#value-sheet")).top;
    assert.equal((await sheet()).collapsed, false);
    assert.ok(part.bottom <= top + 1, `opening the sheet slides R2 into view (${part.bottom} <= ${top})`);
    assert.notDeepEqual((await state()).canvasView, viewBefore, "the canvas moved up");
    // Choosing a part that sits under the open sheet: the circuit slides up as well.
    await tapSelector('.value-sheet [data-sheet-action="close"]');
    const again = await rectOf('.component[data-id="R2"]');
    await swipe(unfolded.top + 40 - again.bottom);
    await tap(await partPoint("R2"));
    part = await rectOf('.component[data-id="R2"]');
    top = (await rectOf("#value-sheet")).top;
    assert.equal((await sheet()).collapsed, false, "the sheet was left open");
    assert.ok(part.bottom <= top + 1, `R2 is shown above the sheet (${part.bottom} <= ${top})`);
  });

  test("390x844 touch: a long press picks up a part that was not selected (one undo entry); a quick swipe on it still pans", async () => {
    await phone("/?example=divider", PHONES[0]);
    const r2 = await component("R2");
    const view = (await state()).canvasView;
    const point = await partPoint("R2");
    await touchDragPoints(point, { x: point.x - 60, y: point.y }, { steps: 6 });
    assert.deepEqual([(await component("R2")).x, (await component("R2")).y], [r2.x, r2.y], "a quick swipe does not move the part");
    assert.ok(Math.abs((await state()).canvasView.x - view.x) > 10, "it pans the view");
    const depth = await historyDepth();
    const again = await partPoint("R2");
    await ev(`(() => { const s = ${L}.getState(); return s.selected; })()`);
    await touchDragPoints(again, { x: again.x + 60, y: again.y + 40 }, { steps: 8, holdMs: 520 });
    const moved = await component("R2");
    assert.ok(moved.x !== r2.x || moved.y !== r2.y, `a long press then drag moves R2 (${r2.x},${r2.y} → ${moved.x},${moved.y})`);
    assert.equal(await historyDepth(), depth + 1, "the pick-up move is one undo entry");
    assert.equal((await state()).selected?.id, "R2");
  });

  test("390x844 touch targets: editor controls are at least 44 px and text fields/selects use 16 px text", async () => {
    await phone("/?example=rc-charge", PHONES[0]);
    await tap(await partPoint("R1"));
    await tapSelector('.value-sheet [data-sheet-action="close"]');
    const report = await ev(`(() => {
      const visible = (e) => { if (e.closest("[hidden]")) return false; const s = getComputedStyle(e); if (s.display === "none" || s.visibility === "hidden") return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight; };
      const controls = [...document.querySelectorAll(".topbar button, .topbar select, #workbench .canvas-panel button, #workbench .canvas-panel select, #workbench .canvas-panel summary, .analysis-bar label, .view-tabs button")]
        .filter((e) => visible(e) && !e.closest(".file-actions, .interaction-help-card, .canvas-notices, #error-box, .draft-notice"));
      const small = controls.map((e) => { const r = e.getBoundingClientRect(); return { what: e.id || e.dataset.tool || e.dataset.view || e.textContent.trim().slice(0, 12), w: Math.round(r.width), h: Math.round(r.height) }; }).filter((t) => t.w < 44 || t.h < 44);
      const fonts = [...document.querySelectorAll("#workbench input:not([type=checkbox]):not([type=range]), #workbench select, .topbar select")].filter(visible).map((e) => ({ what: e.id || e.dataset.prop, size: parseFloat(getComputedStyle(e).fontSize) })).filter((t) => t.size < 16);
      return { count: controls.length, small, fonts };
    })()`);
    assert.ok(report.count > 15, `controls found: ${report.count}`);
    assert.deepEqual(report.small, [], "every editor control is ≥ 44 px");
    assert.deepEqual(report.fonts, [], "no text field or select under 16 px");
  });

  test("desktop: the value card sits at the top of the properties panel; ▶ and a prefix chip work with the mouse, the inspector field stays", async () => {
    await ctx.cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false });
    await navigate("/?example=divider");
    const p = await partPoint("R1");
    await ctx.cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button: "left", buttons: 1, clickCount: 1 });
    await ctx.cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x, y: p.y, button: "left", buttons: 0, clickCount: 1 });
    await settle();
    const info = await sheet();
    assert.equal(info.visible && !info.phone && info.id === "R1", true, JSON.stringify(info));
    assert.equal(await ev(`document.getElementById("value-sheet").nextElementSibling?.id`), "inspector-content", "the card sits above the inspector fields");
    assert.equal(await ev(`Boolean(document.querySelector('#inspector-content [data-prop="value"]'))`), true);
    await click('.value-sheet [data-step="-1"]');
    assert.equal(await valueOf("R1"), "820");
    await click('.value-sheet [data-prefix="k"]');
    assert.equal(await valueOf("R1"), "820k");
    assert.equal(await ev(`document.querySelector('#inspector-content [data-prop="value"]').value`), "820k", "the inspector field follows");
  });
});

function near(actual, expected, what, tolerance = 1e-6) {
  assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance, `${what}: ${actual} is not ${expected}`);
}
