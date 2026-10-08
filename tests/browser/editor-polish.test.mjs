// Editor handling, round 2 (phone and PC): the phone selection bar and part strip, one-line workspace tabs, the value sheet docked above
// the tab bar, touch pin capture with a snap ring, the part carried above the fingertip, and on the PC the unchanged toolbar, proportional
// wheel zoom, "?" for the help card and the snap ring while wiring with the mouse.
// Same harness as smoke.test.mjs: real server + headless Edge with a throw-away profile; only our own processes are stopped.
// Phones run in mobile emulation with touch input like mobile-editor.test.mjs. Set EDITOR_POLISH_SHOTS=<dir> to save a few screenshots.
import { describe, test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  L, MOD, ctx, ev, until, settle, navigate, state, component, partPoint, pinTip, bgPoint, click, clickPart, press, moveTo, wheelAt, dragBetween, sleep,
  startServer, startBrowser, stopAll, leftoverProcessIds, isAlive, assertNoProblems, resetProblems,
} from "./harness.mjs";

const PHONE = [390, 844];
const SMALL_PHONE = [360, 740];
const SHOTS = process.env.EDITOR_POLISH_SHOTS || "";

const touch = (type, touchPoints) => ctx.cdp.send("Input.dispatchTouchEvent", { type, touchPoints });
let taps = 0;
async function tap(point, holdMs = 40) { taps += 1; await touch("touchStart", [{ x: point.x, y: point.y }]); await sleep(holdMs); await touch("touchEnd", []); await settle(); }
const rectOf = (selector) => ev(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, top: r.top, bottom: r.bottom, left: r.left, right: r.right, w: r.width, h: r.height }; })()`);
async function tapSelector(selector) { const r = await rectOf(selector); assert.ok(r && r.w > 0, `missing ${selector}`); await tap(r); }
/** The element really on top at the centre of `selector` is that element (or inside it). */
const reachable = (selector) => ev(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return false; const r = e.getBoundingClientRect(); const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return Boolean(hit && e.contains(hit)); })()`);
async function phone(path, [width, height]) {
  await ctx.cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await navigate(path, { width, height, mobile: true });
}
async function desktop(path) {
  await ctx.cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false });
  await navigate(path);
}
async function shot(name) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  const { data } = await ctx.cdp.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(data, "base64"));
}
const actions = () => ev(`${L}.getCanvasActions()`);
const sheet = () => ev(`${L}.getValueSheet()`);
const historyDepth = async () => (await state()).historyDepth;
const scale = () => ev(`document.getElementById("circuit-canvas").getScreenCTM().a`);
/** Screen point of a world point. */
const screenOf = (x, y) => ev(`(() => { const p = new DOMPoint(${x}, ${y}).matrixTransform(document.getElementById("circuit-canvas").getScreenCTM()); return { x: p.x, y: p.y }; })()`);
/** Centre of the drawn snap ring (screen), or null. */
const snapRing = () => ev(`(() => { const ring = document.querySelector("#overlay-layer .snap-ring"); if (!ring) return null; const r = ring.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, d: r.width }; })()`);
const near = (a, b, tolerance = 2) => Math.hypot(a.x - b.x, a.y - b.y) <= tolerance;
const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

describe("editor handling round 2", { timeout: 300000 }, () => {
  before(async () => { await startServer(); await startBrowser(); });
  beforeEach(() => { resetProblems(); taps = 0; });
  afterEach(async () => { await assertNoProblems("console/network"); });
  after(async () => {
    const started = [ctx.edge?.pid, ctx.server?.pid].filter(Boolean);
    const stopped = await stopAll();
    for (const pid of new Set([...started, ...stopped])) assert.equal(isAlive(pid), false, `process ${pid} should have been stopped`);
    assert.deepEqual(leftoverProcessIds(), [], "no process may still carry the throw-away Edge profile");
  });

  for (const size of [PHONE, SMALL_PHONE]) {
    test(`${size[0]}x${size[1]}: the workspace tabs and the tool row stay on one line (short names), the full names stay the accessible names`, async () => {
      await phone("/?example=divider", size);
      const tabs = await ev(`[...document.querySelectorAll("[data-workspace-tab]")].map((b) => { const r = b.getBoundingClientRect(); return { id: b.id, h: Math.round(r.height), fits: b.scrollWidth <= b.clientWidth + 1, shown: getComputedStyle(b, "::after").content, name: b.getAttribute("aria-label") ?? b.textContent.trim(), reachable: (() => { const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return Boolean(hit && b.contains(hit)); })() }; })`);
      assert.equal(tabs.length, 4);
      for (const tab of tabs) {
        assert.ok(tab.h >= 44 && tab.h <= 46, `${tab.id} is one 44 px row (${tab.h})`);
        assert.ok(tab.fits && tab.reachable, `${tab.id} text fits and the tab is tappable (${JSON.stringify(tab)})`);
      }
      const signals = tabs.find((tab) => tab.id === "signals-workspace-tab");
      assert.equal(signals.shown, '"신호"', "the phone shows the short name");
      assert.equal(signals.name, "신호 및 시스템", "the accessible name stays the full one");
      assert.equal(await ev(`document.querySelector(".topbar").scrollWidth <= document.querySelector(".topbar").clientWidth + 1`), true, "the header does not overflow");
      const tools = await ev(`[...document.querySelectorAll(".canvas-bar .tool")].map((b) => ({ tool: b.dataset.tool, fits: b.scrollWidth <= b.clientWidth + 1, h: Math.round(b.getBoundingClientRect().height) }))`);
      assert.deepEqual(tools.filter((t) => !t.fits || t.h < 44), [], `no clipped tool label (${JSON.stringify(tools)})`);
      assert.equal(await ev(`document.documentElement.scrollWidth <= innerWidth + 1`), true, "no sideways overflow");
      await shot(`${size[0]}x${size[1]}-header`);
    });
  }

  test("390x844 selection bar: a tapped part gets ↻ ⧉ 값 배선 ⌫ above it — rotate and delete are one undo step each, 값 reopens the sheet", async () => {
    await phone("/?example=divider", PHONE);
    const r1 = await partPoint("R1");
    await tap(r1);
    let info = await actions();
    assert.equal(info.bar, true, `the bar shows for the tapped part (${JSON.stringify(info)})`);
    assert.deepEqual(info.actions, ["rotate", "clone", "value", "wire", "delete"]);
    const bar = await rectOf("#selection-bar");
    const part = await ev(`(() => { const r = document.querySelector('.component[data-id="R1"] .component-hit').getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; })()`);
    assert.ok(!overlaps(bar, { left: r1.x - 20, right: r1.x + 20, top: r1.y - 20, bottom: r1.y + 20 }), "the bar is not under the finger that tapped the part");
    assert.ok(bar.bottom <= part.top || bar.top >= part.bottom, `the bar sits above or below the part (${JSON.stringify({ bar, part })})`);
    assert.ok(await reachable('#selection-bar [data-sel-action="rotate"]'), "the bar buttons are tappable");
    assert.ok(bar.h >= 44, "44 px touch targets");
    assert.equal((await sheet()).visible, true, "the tap also opened the value sheet");
    await shot("390x844-selection-bar");

    // ↻: one undo step, the bar stays with the part.
    let depth = await historyDepth();
    const rotation = (await component("R1")).rotation ?? 0;
    await tapSelector('#selection-bar [data-sel-action="rotate"]');
    assert.equal((((await component("R1")).rotation ?? 0) - rotation + 360) % 360, 90, "R1 turned by 90°");
    assert.equal(await historyDepth(), depth + 1, "rotate = one undo step");
    assert.equal((await actions()).bar, true, "the bar stays for the rotated part");

    // 값 brings back a closed sheet.
    await tapSelector('.value-sheet [data-sheet-action="close"]');
    assert.equal((await sheet()).visible, false);
    await tapSelector('#selection-bar [data-sel-action="value"]');
    info = await sheet();
    assert.equal(info.visible && info.id === "R1" && info.prop === "value", true, `값 opens the sheet for R1 (${JSON.stringify(info)})`);

    // ⌫: one undo step, the bar goes away with the part.
    depth = await historyDepth();
    await tapSelector('#selection-bar [data-sel-action="delete"]');
    assert.equal(await component("R1"), undefined, "R1 deleted");
    assert.equal(await historyDepth(), depth + 1, "delete = one undo step");
    assert.equal((await actions()).bar, false, "no bar without a selection");
    assert.equal((await sheet()).visible, false, "no sheet without a selection");

    // A wire: V 측정 adds a voltage probe on it in one tap.
    const wirePoint = await ev(`(() => { const path = document.querySelector('#wire-layer [data-wire-id] .wire'); const length = path.getTotalLength(); const p = path.getPointAtLength(length / 2).matrixTransform(path.getScreenCTM()); return { x: p.x, y: p.y, id: path.closest("[data-wire-id]").dataset.wireId }; })()`);
    await tap(wirePoint);
    assert.deepEqual((await state()).selection, [`wire:${wirePoint.id}`], "the wire is selected");
    assert.deepEqual((await actions()).actions, ["voltage", "delete"]);
    const probes = (await state()).probes.length;
    await tapSelector('#selection-bar [data-sel-action="voltage"]');
    const after = (await state()).probes;
    assert.equal(after.length, probes + 1, "V 측정 added a probe");
    assert.equal(after.at(-1).kind, "voltage");
  });

  test("360x740 placing parts: palette → canvas, then the part strip switches the kind and 완료 ends — R and GND in 6 taps; nothing covers the tab bar", async () => {
    await phone("/", SMALL_PHONE);
    await ev(`localStorage.clear()`);
    await phone("/", SMALL_PHONE);
    assert.equal((await state()).circuit.components.length, 0);
    taps = 0;
    await tapSelector('.view-tabs [data-view="palette"]');
    await tapSelector('.palette-item[data-type="R"]');
    assert.equal((await state()).tool, "place:R");
    await tap(await screenOf(300, 200));
    let info = await actions();
    assert.equal(info.strip && info.placing === "R", true, `the strip shows while placing (${JSON.stringify(info)})`);
    assert.equal(info.bar, false, "no selection bar for a part that was only placed");
    assert.equal((await sheet()).visible, false, "placing does not pop up the value sheet");
    assert.ok(await reachable('.view-tabs [data-view="palette"]'), "the tab bar stays reachable after placing");
    await shot("360x740-place-strip");
    await tapSelector('#place-strip [data-place="GND"]');
    assert.equal((await state()).tool, "place:GND");
    await tap(await screenOf(460, 300));
    await tapSelector('#place-strip [data-place-action="done"]');
    const now = await state();
    assert.deepEqual(now.circuit.components.map((part) => part.type), ["R", "GND"]);
    assert.equal(now.tool, "select", "완료 returns to the select tool");
    assert.equal((await actions()).strip, false, "the strip is gone");
    assert.equal(taps, 6, "R and GND placed in 6 taps (tab, R, canvas, ⏚, canvas, 완료)");
    // Switching tools does not make the bar pop up for the part that was placed last.
    assert.equal((await actions()).bar, false);
  });

  test("390x844 touch wiring: the pins are shown as targets, a pin 26 px from the fingertip still takes the wire (the mouse radius is 22 px) and a ring marks it mid-drag", async () => {
    await phone("/?example=divider", PHONE);
    await tapSelector("#fit-button");
    const pinFill = () => ev(`getComputedStyle(document.querySelector('.component[data-id="R1"] .pin')).fill`);
    const idle = await pinFill();
    await tapSelector('[data-tool="wire"]');
    assert.notEqual(await pinFill(), idle, "with the wire tool on a touch screen every pin is drawn as a target");
    const from = await pinTip("R1", 0), goal = await pinTip("R2", 1);
    // A spot 26 px from R2's pin 2 that is clearly farther from every other pin.
    const end = await ev(`(() => {
      const goal = ${JSON.stringify(goal)}; const pins = [...document.querySelectorAll(".component .pin")].map((e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
      for (let k = 0; k < 16; k += 1) { const a = (k * Math.PI) / 8; const p = { x: goal.x + 26 * Math.cos(a), y: goal.y + 26 * Math.sin(a) };
        if (pins.every((q) => Math.hypot(q.x - goal.x, q.y - goal.y) < 1 || Math.hypot(q.x - p.x, q.y - p.y) > 40)) return p; }
      return null; })()`);
    assert.ok(end, "a test spot 26 px from the pin");
    const wires = (await state()).circuit.wires.length;
    await touch("touchStart", [{ x: from.x, y: from.y }]);
    for (let i = 1; i <= 8; i += 1) { await touch("touchMove", [{ x: from.x + ((end.x - from.x) * i) / 8, y: from.y + ((end.y - from.y) * i) / 8 }]); await sleep(16); }
    await settle();
    const ring = await snapRing();
    assert.ok(ring && near(ring, goal, 2), `the ring sits on R2 pin 2 while the finger is 26 px away (${JSON.stringify({ ring, goal })})`);
    assert.ok(ring.d >= 30, `the ring is bigger than a fingertip contact (${ring.d} px)`);
    await shot("390x844-touch-snap-ring");
    await touch("touchEnd", []);
    await settle();
    const now = await state();
    assert.equal(now.circuit.wires.length, wires + 1, "the wire was made");
    assert.deepEqual([now.circuit.wires.at(-1).a, now.circuit.wires.at(-1).b], [{ componentId: "R1", pin: 0 }, { componentId: "R2", pin: 1 }]);
    assert.equal(await snapRing(), null, "the ring goes away with the preview");
  });

  test("390x844 touch drag: a part picked up by a long press rides a little above the fingertip and is dropped where it was seen", async () => {
    await phone("/?example=divider", PHONE);
    const origin = await component("R2");
    const s = await scale();
    const from = await partPoint("R2");
    await touch("touchStart", [{ x: from.x, y: from.y }]);
    await sleep(520);
    for (let i = 1; i <= 8; i += 1) { await touch("touchMove", [{ x: from.x + (80 * i) / 8, y: from.y }]); await sleep(16); }
    await settle();
    const carried = await component("R2");
    const fingertip = { x: origin.x + 80 / s, y: origin.y };
    assert.ok(Math.abs(carried.x - fingertip.x) <= 10.01, `x follows the finger (${carried.x} vs ${fingertip.x})`);
    assert.ok(origin.y - carried.y >= 36 / s - 10.01 && origin.y - carried.y <= 36 / s + 10.01, `the part is carried about 36 px above the fingertip (Δy ${origin.y - carried.y} units, scale ${s})`);
    const depth = await historyDepth();
    await touch("touchEnd", []);
    await settle();
    const dropped = await component("R2");
    assert.deepEqual([dropped.x, dropped.y], [carried.x, carried.y], "dropped exactly where it was drawn");
    assert.equal(await historyDepth(), depth + 1, "one undo step");
    assert.equal((await actions()).bar, true, "after the drop the part's actions are right there");
  });

  test("390x844 value sheet docks above the tab bar (결과 · 파형 stay one tap away); undo and redo sit in the lower canvas corner", async () => {
    await phone("/?example=divider", PHONE);
    const undo = await rectOf("#undo-button");
    const wrap = await rectOf("#canvas-wrap");
    assert.ok(undo.y > (await ev("innerHeight")) / 2 && undo.bottom <= wrap.bottom, `undo is in the thumb zone (lower half, on the canvas): ${JSON.stringify(undo)}`);
    assert.equal(await ev(`document.getElementById("redo-button").closest("#canvas-corner") !== null`), true, "redo sits next to it");
    await tap(await partPoint("R1"));
    assert.equal((await sheet()).visible, true);
    const sheetBox = await rectOf("#value-sheet"), tabs = await rectOf(".view-tabs");
    assert.ok(sheetBox.bottom <= tabs.top + 1, `the sheet ends where the tab bar starts (${sheetBox.bottom} ≤ ${tabs.top})`);
    for (const view of ["results", "wave"]) assert.ok(await reachable(`.view-tabs [data-view="${view}"]`), `${view} tab is tappable with the sheet up`);
    assert.ok(await reachable("#undo-button"), "undo stays reachable with the sheet up");
    assert.ok(await reachable('#selection-bar [data-sel-action="rotate"]'), "so does the selection bar");
    await shot("390x844-sheet-above-tabs");
    await tapSelector('.view-tabs [data-view="wave"]');
    assert.equal((await ev(`${L}.getLayout()`)).view, "wave", "one tap reaches the waveform panel");
  });

  test("desktop 1440x900: the toolbar is unchanged — full labels, clone/rotate in the toolbar, no selection bar or part strip", async () => {
    await desktop("/?example=divider");
    const labels = await ev(`[...document.querySelectorAll("[data-workspace-tab], .canvas-bar .tool")].map((b) => ({ text: b.textContent.trim(), size: parseFloat(getComputedStyle(b).fontSize), after: getComputedStyle(b, "::after").content }))`);
    for (const label of labels) assert.ok(label.size >= 12 && (label.after === "none" || label.after === "normal"), `full label on the desktop: ${JSON.stringify(label)}`);
    assert.ok(labels.some((label) => label.text === "신호 및 시스템") && labels.some((label) => label.text === "V 프로브"));
    await clickPart("R1");
    assert.equal((await state()).selected?.id, "R1");
    for (const id of ["clone-button", "rotate-button", "undo-button"]) assert.ok(await reachable(`#${id}`), `#${id} is in the toolbar`);
    assert.equal((await actions()).bar, false, "no selection bar on the desktop");
    assert.equal((await sheet()).visible, true, "the value card is shown for the clicked part");
    await click('.palette-item[data-type="C"]');
    assert.equal((await state()).tool, "place:C");
    assert.equal((await actions()).strip, false, "no part strip on the desktop (the palette is on screen)");
    await press("Escape", "Escape", 27);
  });

  test("desktop wheel and help: one mouse notch zooms about ×1.17 as before, a small trackpad delta only a little; ? opens and closes the help card", async () => {
    await desktop("/?example=divider");
    const spot = await bgPoint();
    let width = (await state()).canvasView.width;
    await wheelAt(spot.x, spot.y, 100); await settle();
    let ratio = (await state()).canvasView.width / width;
    assert.ok(ratio > 1.12 && ratio < 1.22, `a notch zooms out about ×1.17 (×${ratio.toFixed(3)})`);
    width = (await state()).canvasView.width;
    await wheelAt(spot.x, spot.y, -100); await settle();
    ratio = (await state()).canvasView.width / width;
    assert.ok(ratio > 0.82 && ratio < 0.9, `a notch back zooms in (×${ratio.toFixed(3)})`);
    width = (await state()).canvasView.width;
    await wheelAt(spot.x, spot.y, 4); await settle();
    ratio = (await state()).canvasView.width / width;
    assert.ok(ratio > 1 && ratio < 1.02, `a 4 px trackpad delta zooms a little, not a whole step (×${ratio.toFixed(4)})`);
    assert.equal(await ev(`document.getElementById("interaction-help").open`), false);
    await press("?", "Slash", 191, MOD.shift);
    assert.equal(await ev(`document.getElementById("interaction-help").open`), true, "? opens the help card");
    assert.match(await ev(`document.querySelector(".interaction-help-card").textContent`), /\?\s*이 도움말/);
    await press("?", "Slash", 191, MOD.shift);
    assert.equal(await ev(`document.getElementById("interaction-help").open`), false, "? closes it again");
  });

  test("desktop mouse wiring: a dragged wire end snaps onto the pin it will join (ring), a click-click wire rings the pin under the pointer", async () => {
    await desktop("/?example=divider");
    await click("#fit-button");
    const from = await pinTip("R1", 0), goal = await pinTip("R2", 1);
    const wires = (await state()).circuit.wires.length;
    let mid = null;
    await dragBetween(from, { x: goal.x + 9, y: goal.y + 6 }, { beforeRelease: async () => { mid = await snapRing(); } });
    assert.ok(mid && near(mid, goal, 2), `while dragging, the ring sits on the pin the release will use (${JSON.stringify({ mid, goal })})`);
    const now = await state();
    assert.equal(now.circuit.wires.length, wires + 1);
    assert.deepEqual(now.circuit.wires.at(-1).b, { componentId: "R2", pin: 1 }, "and the wire ends there");
    // Click-click: the ring follows exactly what a click would hit.
    await click('[data-tool="wire"]');
    const start = await pinTip("V1", 0);
    await ctx.cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: start.x, y: start.y });
    await ctx.cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: start.x, y: start.y, button: "left", buttons: 1, clickCount: 1 });
    await ctx.cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: start.x, y: start.y, button: "left", buttons: 0, clickCount: 1 });
    await settle();
    assert.deepEqual((await state()).pendingPin, { componentId: "V1", pin: 0 });
    const over = await pinTip("R2", 0);
    await moveTo(over.x, over.y);
    await until(`Boolean(document.querySelector("#overlay-layer .snap-ring"))`, "the ring on the hovered pin", 3000);
    assert.ok(near(await snapRing(), over, 2), "the ring is on the hovered pin");
    const empty = await bgPoint();
    await moveTo(empty.x, empty.y);
    assert.equal(await snapRing(), null, "no ring over empty canvas");
    await press("Escape", "Escape", 27);
    assert.equal((await state()).pendingPin, null);
  });
});
