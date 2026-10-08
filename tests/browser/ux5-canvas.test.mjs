// Canvas UX pass for first-time students (phone and PC): page scroll vs. canvas pan, select-tool wiring by touch, the ⇄ current-reference
// button next to its value, a minimum on-screen label size, upright new sources, a quicker auto re-run for small circuits, select-all on
// focus, the tap bubble keeping clear of the selection bar, and the ± key of the phone value sheet.
// Real server + headless Edge with a throw-away profile (harness.mjs); phones via device emulation and Input.dispatchTouchEvent.
// Run: node --test tests/browser/ux5-canvas.test.mjs
import { describe, test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  L, ctx, ev, until, settle, navigate, state, component, partPoint, click, clickAt, clickPart, sleep, pinTip, bgPoint, runAnalysis,
  startServer, startBrowser, stopAll, leftoverProcessIds, isAlive, assertNoProblems, resetProblems,
} from "./harness.mjs";

const PHONE = [390, 844];
const touch = (type, touchPoints) => ctx.cdp.send("Input.dispatchTouchEvent", { type, touchPoints });
async function tap(point, holdMs = 40) { await touch("touchStart", [{ x: point.x, y: point.y }]); await sleep(holdMs); await touch("touchEnd", []); await settle(); }
/** One-finger drag; `pauseMs` between the moves (0 = as fast as the protocol goes: a flick). */
async function touchDrag(from, to, { steps = 8, pauseMs = 16 } = {}) {
  await touch("touchStart", [{ x: from.x, y: from.y }]);
  for (let i = 1; i <= steps; i += 1) {
    await touch("touchMove", [{ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps }]);
    if (pauseMs) await sleep(pauseMs);
  }
  await touch("touchEnd", []);
  await settle();
}
const rectOf = (selector) => ev(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, top: r.top, bottom: r.bottom, left: r.left, right: r.right, w: r.width, h: r.height }; })()`);
async function tapSelector(selector) { const r = await rectOf(selector); assert.ok(r && r.w > 0, `missing ${selector}`); await tap(r); }
async function phone(path) {
  await ctx.cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await navigate(path, { width: PHONE[0], height: PHONE[1], mobile: true });
}
async function desktop(path) {
  await ctx.cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false });
  await navigate(path);
}
/** An empty canvas spot (no part, wire or junction under it) with room for a vertical swipe of `room` px below and above it. */
const emptySpot = (room = 0) => ev(`(() => {
  const canvas = document.getElementById("circuit-canvas"), r = canvas.getBoundingClientRect();
  const top = Math.max(r.top, 0) + 20 + ${room}, bottom = Math.min(r.bottom, innerHeight - 70) - 20 - ${room};
  for (let y = top; y < bottom; y += 10) for (let x = r.left + 20; x < r.right - 20; x += 10) {
    const hit = document.elementFromPoint(x, y);
    if (hit && canvas.contains(hit) && hit.classList.contains("canvas-bg")) return { x, y };
  }
  return null;
})()`);
const workbenchTop = () => ev(`document.getElementById("workbench").scrollTop`);
const view = async () => (await state()).canvasView;
const overlap = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

describe("canvas UX for first-time students", { timeout: 300000 }, () => {
  before(async () => { await startServer(); await startBrowser(); });
  beforeEach(() => resetProblems());
  afterEach(async () => { await assertNoProblems("console/network"); });
  after(async () => {
    const started = [ctx.edge?.pid, ctx.server?.pid].filter(Boolean);
    const stopped = await stopAll();
    for (const pid of new Set([...started, ...stopped])) assert.equal(isAlive(pid), false, `process ${pid} should have been stopped`);
    assert.deepEqual(leftoverProcessIds(), [], "no process may still carry the throw-away Edge profile");
  });

  test("phone: a finger landing on the canvas while the page still scrolls keeps scrolling (the circuit stays put); a quick vertical flick scrolls the page; a slow drag still pans", async () => {
    await phone("/?example=divider");
    assert.ok(await ev(`(() => { const w = document.getElementById("workbench"); return w.scrollHeight > w.clientHeight + 100; })()`), "the phone page can scroll");
    // 1. Scrolling momentum: the page has just scrolled (a fling that started outside the canvas) when the finger lands.
    await ev(`(async () => { const w = document.getElementById("workbench"); w.scrollTop = 140; await new Promise((done) => requestAnimationFrame(() => done())); })()`);
    let spot = await emptySpot(0);
    assert.ok(spot, "an empty canvas spot");
    let before = await view();
    const scrolled = await workbenchTop();
    await touchDrag(spot, { x: spot.x, y: spot.y + 90 }, { steps: 8, pauseMs: 16 });
    assert.deepEqual(await view(), before, "the circuit is not dragged along by the scrolling thumb (view transform unchanged)");
    assert.ok(await workbenchTop() < scrolled - 40, `the page scrolled instead (${scrolled} → ${await workbenchTop()})`);
    await sleep(900); // let the glide end and the "recently scrolled" window pass
    // 2. A quick, long vertical flick on the canvas scrolls the page.
    await ev(`document.getElementById("workbench").scrollTop = 0`);
    await sleep(600);
    spot = await emptySpot(0);
    before = await view();
    await touchDrag(spot, { x: spot.x + 4, y: spot.y - 200 }, { steps: 6, pauseMs: 0 });
    assert.deepEqual(await view(), before, "a flick does not move the circuit");
    assert.ok(await workbenchTop() > 60, `a flick scrolls the page (${await workbenchTop()})`);
    await sleep(1200);
    // 3. A slow, deliberate one-finger drag still pans the circuit (and leaves the page where it is).
    spot = await emptySpot(60);
    assert.ok(spot, "an empty canvas spot with room to drag");
    before = await view();
    const top = await workbenchTop();
    await touchDrag(spot, { x: spot.x, y: spot.y + 60 }, { steps: 10, pauseMs: 45 });
    const after = await view();
    assert.ok(Math.abs(after.y - before.y) > 20, `a slow drag pans the circuit (${before.y} → ${after.y})`);
    assert.equal(await workbenchTop(), top, "and does not scroll the page");
  });

  test("phone select tool: a drag from a pin draws a wire, two pins tapped one after the other are wired, a tap on the body still selects", async () => {
    await phone("/?example=divider");
    assert.equal((await state()).tool, "select");
    // no automatic runs: a result (or an error box) arriving mid-test would shift the layout under the next tap
    if ((await state()).autoUpdate) await ev(`document.getElementById("auto-update").click()`);
    await settle();
    const wires = (await state()).circuit.wires.length;
    const joins = (wire, a, b) => [wire.a, wire.b].some((end) => end.componentId === a[0] && end.pin === a[1]) && [wire.a, wire.b].some((end) => end.componentId === b[0] && end.pin === b[1]);
    // drag R1.1 → R2.2
    const from = await pinTip("R1", 0), to = await pinTip("R2", 1);
    await touchDrag(from, to, { steps: 8, pauseMs: 16 });
    let now = await state();
    assert.equal(now.circuit.wires.length, wires + 1, "the pin drag made one wire");
    assert.ok(now.circuit.wires.some((wire) => joins(wire, ["R1", 0], ["R2", 1])), "between the two pins");
    assert.equal(now.pendingPin, null);
    // tap R2.1, then tap V1.2
    await tap(await pinTip("R2", 0));
    assert.deepEqual((await state()).pendingPin, { componentId: "R2", pin: 0 }, "a tap on a pin starts a wire");
    await tap(await pinTip("V1", 1));
    now = await state();
    assert.equal(now.circuit.wires.length, wires + 2, "the second pin tap finished the wire");
    assert.ok(now.circuit.wires.some((wire) => joins(wire, ["R2", 0], ["V1", 1])));
    assert.equal(now.pendingPin, null);
    // the middle of a part still selects it (and opens its value sheet), no wire
    await tap(await partPoint("R1"));
    now = await state();
    assert.equal(now.selected?.id, "R1");
    assert.equal(now.pendingPin, null);
    assert.equal(now.circuit.wires.length, wires + 2);
  });

  test("coupled coils: the ⇄ flip buttons are 44 px, at the top of the properties next to each winding's current, and flipping turns the shown phasor by 180°", async () => {
    await desktop("/?example=coupled-coils");
    if ((await state()).autoUpdate) await click("#auto-update");
    await runAnalysis("ac");
    await clickPart("K1");
    await click("#inspector-tab");
    const layout = await ev(`(() => {
      const box = (e) => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, w: r.width, h: r.height }; };
      const rows = [1, 2].map((winding) => { const button = document.querySelector('#inspector-content [data-flip-current="' + winding + '"]'); const value = document.querySelector('#inspector-content [data-current-value="' + winding + '"]');
        return { button: box(button), text: button.textContent, value: value && box(value), valueText: value?.textContent ?? "", sameRow: button.parentElement === value?.closest(".current-reference-row") }; });
      return { rows, l1: box(document.querySelector('#inspector-content [data-prop="L1"]')) };
    })()`);
    for (const row of layout.rows) {
      assert.ok(row.button.h >= 44 && row.button.w >= 44, `the flip button is a full touch target (${JSON.stringify(row.button)})`);
      assert.match(row.text, /⇄/);
      assert.ok(row.sameRow, "the button sits on the row of the current it flips");
      assert.match(row.valueText, /A \((rms|peak)\) ∠ [-−\d.]+°/, row.valueText);
      assert.ok(Math.abs((row.value.top + row.value.bottom) / 2 - (row.button.top + row.button.bottom) / 2) < 30, "value and button side by side");
      assert.ok(row.button.bottom <= layout.l1.top, "above the long list of coil fields");
    }
    const angle = (text) => Number(text.match(/∠ ([-−\d.]+)°/)[1].replace("−", "-"));
    const before = angle(layout.rows[1].valueText);
    await click('#inspector-content [data-flip-current="2"]');
    const flipped = angle(await ev(`document.querySelector('#inspector-content [data-current-value="2"]').textContent`));
    const turn = Math.abs((((flipped - before) % 360) + 360) % 360 - 180);
    assert.ok(turn < 0.05, `the shown phasor turned by 180° (${before}° → ${flipped}°)`);
  });

  test("labels never shrink below 11 px on screen: phone and PC, also zoomed far out (long source wording is dropped then)", async () => {
    const sizes = () => ev(`(() => {
      const svg = document.getElementById("circuit-canvas");
      const px = [...svg.querySelectorAll(".component .label, .component .value-label")].map((e) => parseFloat(getComputedStyle(e).fontSize) * e.getScreenCTM().a);
      return { min: Math.min(...px), count: px.length, compact: svg.dataset.textCompact, extra: [...svg.querySelectorAll(".value-extra")].filter((e) => e.getClientRects().length && e.getBoundingClientRect().width > 0).length };
    })()`);
    for (const open of [() => phone("/?example=rc-charge"), () => desktop("/?example=rc-charge")]) {
      await open();
      let measured = await sizes();
      assert.ok(measured.count >= 6 && measured.min >= 10.9, `readable at the first view (${JSON.stringify(measured)})`);
      for (let i = 0; i < 4; i += 1) await ev(`document.getElementById("zoom-out-button").click()`);
      await settle();
      measured = await sizes();
      assert.ok(measured.min >= 10.9, `still readable zoomed out (${JSON.stringify(measured)})`);
      assert.equal(measured.compact, "1", "zoomed far out the labels go compact");
      assert.equal(measured.extra, 0, "the source wording is hidden then");
    }
    // the stored text is unchanged (the hidden wording is still part of the label)
    assert.match(await ev(`document.querySelector('.component[data-id="V1"] .value-label').textContent`), /^PULSE high 5 V$/);
  });

  test("new sources stand upright with + (or the arrow) on top; examples keep their stored rotation", async () => {
    await desktop("/");
    const place = async (type, from) => {
      await click(`.palette-item[data-type="${type}"]`);
      const spot = await bgPoint({ from });
      await clickAt(spot.x, spot.y); await settle();
      await click('[data-tool="select"]');
    };
    await place("V", "top-left");
    await place("I", "bottom-right");
    const parts = (await state()).circuit.components;
    assert.deepEqual(parts.map((part) => [part.type, part.rotation]), [["V", 90], ["I", 270]]);
    const pinY = (id, pin) => ev(`(() => { const r = document.querySelector('.component[data-id="${id}"] .pin[data-pin="${pin}"]').getBoundingClientRect(); return r.y + r.height / 2; })()`);
    assert.ok(await pinY("V1", 0) < (await pinY("V1", 1)) - 40, "the + pin of the voltage source is on top");
    assert.ok(await pinY("I1", 1) < (await pinY("I1", 0)) - 40, "the current source's arrow (pin 1 → pin 2) points up");
    await desktop("/?example=divider");
    assert.equal((await component("V1")).rotation, 90, "the example is as stored");
  });

  test("auto re-run: a single edit of a small circuit starts within ~0.1 s; a burst of steps waits and computes only the last value", async () => {
    await desktop("/?example=divider");
    await until(`${L}.getState().result?.analysis === "dc" && ${L}.getState().runState.status === "success"`, "the first automatic result");
    await clickPart("R1");
    await until(`!document.getElementById("value-sheet").hidden`, "the value card");
    await sleep(400); // the example's own first run is not part of the edit below
    const timing = await ev(`(async () => {
      const lab = ${L}, step = document.querySelector('.value-sheet [data-step="1"]');
      const started = (generation) => { const s = lab.getState(); return s.runState.status === "running" || (s.runState.status === "success" && s.runState.generation >= generation); };
      const waitRun = async (from, generation) => { while (performance.now() - from < 3000) { if (started(generation)) return performance.now() - from; await new Promise((done) => setTimeout(done, 4)); } return -1; };
      // one step
      let t0 = performance.now(); step.click(); const single = await waitRun(t0, lab.getState().generation);
      await new Promise((done) => setTimeout(done, 700));
      // a burst of four steps 60 ms apart: nothing runs in between, the run follows the last step
      let ranDuring = false; const burstStart = performance.now();
      for (let i = 0; i < 4; i += 1) { step.click(); const until = performance.now() + 60; while (performance.now() < until) { if (lab.getState().runState.status === "running") ranDuring = true; await new Promise((done) => setTimeout(done, 4)); } }
      const last = performance.now() - 60; const generation = lab.getState().generation;
      const afterBurst = await waitRun(last, generation);
      return { single, ranDuring, afterBurst, burstMs: last - burstStart, value: lab.getState().circuit.components.find((c) => c.id === "R1").props.value };
    })()`);
    assert.ok(timing.single > 0 && timing.single < 200, `a single edit re-runs quickly (${timing.single.toFixed(0)} ms; was ≥ 250 ms)`);
    assert.equal(timing.ranDuring, false, "no run starts in the middle of the burst");
    assert.ok(timing.afterBurst >= 150, `the burst waits the long delay after its last step (${timing.afterBurst.toFixed(0)} ms)`);
    await until(`${L}.getState().runState.status === "success"`, "the burst's run");
    assert.equal((await state()).runState.generation, (await state()).generation, "the result is the last value's");
  });

  test("focus selects the old value: inspector field by click, phone value sheet by tap; a second click places the caret", async () => {
    await desktop("/?example=divider");
    await clickPart("R1");
    await click("#inspector-tab");
    const field = '#inspector-content [data-prop="value"]';
    const selection = (selector) => ev(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); return { focused: document.activeElement === e, start: e.selectionStart, end: e.selectionEnd, length: e.value.length }; })()`);
    const box = await rectOf(field);
    await clickAt(box.x, box.y); await settle();
    let sel = await selection(field);
    assert.ok(sel.focused && sel.start === 0 && sel.end === sel.length && sel.length > 0, `the click that focuses selects all (${JSON.stringify(sel)})`);
    await clickAt(box.left + 6, box.y); await settle();
    sel = await selection(field);
    assert.ok(sel.focused && sel.start === sel.end, `a click into the focused field places the caret (${JSON.stringify(sel)})`);
    await ev(`document.activeElement.blur()`); await settle();
    await phone("/?example=divider");
    await tap(await partPoint("R1"));
    await until(`${L}.getValueSheet().visible`, "the value sheet");
    await tapSelector("#value-sheet-input");
    await sleep(50);
    sel = await selection("#value-sheet-input");
    assert.ok(sel.focused && sel.start === 0 && sel.end === sel.length && sel.length > 0, `the tap selects the value (${JSON.stringify(sel)})`);
    await ev(`document.activeElement.blur()`); await settle();
  });

  test("phone: the tap bubble never covers the selection bar", async () => {
    await phone("/?example=divider");
    await until(`${L}.getState().result?.analysis === "dc"`, "the first automatic result");
    for (const id of ["R1", "R2", "V1"]) {
      await tap(await partPoint(id));
      await settle();
      const bar = await ev(`${L}.getCanvasActions()`);
      assert.equal(bar.bar, true, `the selection bar is up for ${id}`);
      const rects = await ev(`(() => { const box = (e) => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; }; const tip = document.getElementById("hover-tip"); return { bar: box(document.getElementById("selection-bar")), tip: tip.classList.contains("hidden") ? null : box(tip) }; })()`);
      if (rects.tip) assert.equal(overlap(rects.tip, rects.bar), false, `${id}: bubble ${JSON.stringify(rects.tip)} vs bar ${JSON.stringify(rects.bar)}`);
      await tapSelector('.value-sheet [data-sheet-action="close"]');
    }
    // at least one of the bubbles was shown (it moved below the finger instead of disappearing)
    await tap(await partPoint("R2"));
    await settle();
    assert.equal((await ev(`${L}.getHoverReadout()`)).visible, true, "the bubble is shown, clear of the bar");
  });

  test("phone value sheet: a signed value (source) gets a 44 px ± key that flips the sign; R keeps the number pad without it", async () => {
    await phone("/?example=divider");
    await tap(await partPoint("R1"));
    assert.equal(await ev(`document.querySelector('.value-sheet [data-sheet-action="sign"]').hidden`), true, "no ± for a resistance");
    assert.equal(await ev(`document.getElementById("value-sheet-input").inputMode`), "decimal");
    await tap(await partPoint("V1"));
    const info = await ev(`${L}.getValueSheet()`);
    assert.equal(info.id === "V1" && info.prop === "dc", true, JSON.stringify(info));
    const sign = await rectOf('.value-sheet [data-sheet-action="sign"]');
    assert.ok(sign && sign.w >= 44 && sign.h >= 44, `the ± key is a full touch target (${JSON.stringify(sign)})`);
    const depth = (await state()).historyDepth;
    await tap(sign);
    assert.equal((await component("V1")).props.dc, "-10");
    assert.equal((await state()).historyDepth, depth + 1, "one undo step");
    await tap(sign);
    assert.equal((await component("V1")).props.dc, "10");
    // while typing, ± flips the typed number and keeps the field focused
    await tapSelector("#value-sheet-input");
    await ctx.cdp.send("Input.insertText", { text: "3.3" });
    await tap(await rectOf('.value-sheet [data-sheet-action="sign"]'));
    assert.equal(await ev(`document.getElementById("value-sheet-input").value`), "-3.3");
    assert.equal(await ev(`document.activeElement?.id`), "value-sheet-input", "the keyboard stays");
    assert.equal((await component("V1")).props.dc, "-3.3");
    await ev(`document.activeElement.blur()`); await settle();
  });
});
