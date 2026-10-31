// Fourier-transform lesson, guided mode ("따라가기"): the 보기 select, the step bar, the presets, the frequency axis carried
// between steps, dragging the shifted pulse, tab memory across a reload, the way back to the free examples, and the phone
// layout (plot first, 44 px targets, no sideways scroll).
// Real server + headless browser with a throw-away profile (harness.mjs). Run with `node --test tests/browser/signals-guide.test.mjs`.
import { describe, test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  L, ctx, ev, until, settle, navigate, sleep, problems,
  startServer, startBrowser, stopAll, leftoverProcessIds, isAlive, assertNoProblems, resetProblems,
} from "./harness.mjs";

const sg = () => ev(`${L}.getSignalsCourseState()`);
const change = (selector, value) => ev(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event("input", { bubbles: true })); e.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
const clickEl = async (selector) => { await ev(`document.querySelector(${JSON.stringify(selector)}).click()`); await settle(); };
const text = (selector) => ev(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`);
const shown = (selector) => ev(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); return Boolean(e) && !e.hidden && e.getClientRects().length > 0; })()`);
const box = (selector) => ev(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height, bottom: r.bottom }; })()`);
const mouse = (type, x, y, buttons = 0) => ctx.cdp.send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left", buttons, clickCount: type === "mouseMoved" ? 0 : 1 });
const flushSessions = () => ev(`new Promise((done) => setTimeout(done, 400))`); // the tab memory saves 250 ms after the last change

async function reload() {
  let off = () => {};
  const loaded = new Promise((done) => { off = ctx.cdp.on((message) => { if (message.method === "Page.loadEventFired") done(); }); });
  try { await ctx.cdp.send("Page.reload", {}); await loaded; } finally { off(); }
  await until(`Boolean(${L}) && document.readyState === "complete"`, "the reloaded app");
  await settle();
}
async function openFourier({ mobile = false } = {}) {
  await ctx.cdp.send("Emulation.setTouchEmulationEnabled", { enabled: mobile, maxTouchPoints: mobile ? 5 : 1 });
  await navigate("/?workspace=signals", mobile ? { width: 390, height: 844, mobile: true } : {});
  await until(`${L}.getSignalsCourseState()?.active === true`, "the signals workspace");
  await clickEl('[data-signals-lesson="fourier"]');
  await until(`${L}.getSignalsCourseState().lessonId === "fourier"`, "the Fourier-transform lesson");
}
// Headless Chromium on Linux (this container) logs that it cannot use the SVG manifest icon; Edge on Windows does not.
// Only that exact message is dropped; every other console/network problem stays fatal.
function dropLinuxManifestIcon() {
  if (process.platform !== "linux") return;
  for (let i = problems.length - 1; i >= 0; i -= 1) if (/Error while trying to use the following icon from the Manifest/.test(problems[i])) problems.splice(i, 1);
}

describe("signals: Fourier-transform guided mode", { timeout: 300000 }, () => {
  before(async () => { await startServer(); await startBrowser(); });
  beforeEach(() => resetProblems());
  afterEach(async () => { dropLinuxManifestIcon(); await assertNoProblems("console/network"); });
  after(async () => {
    const startedPids = [ctx.edge?.pid, ctx.server?.pid].filter(Boolean);
    const stopped = await stopAll();
    for (const pid of new Set([...startedPids, ...stopped])) assert.equal(isAlive(pid), false, `process ${pid} should have been stopped`);
    assert.deepEqual(leftoverProcessIds(), [], "no process may still carry the throw-away browser profile");
  });

  test("보기 → 따라가기: steps, presets, the axis carried over, the shift drag, tab memory and the way back", async () => {
    await openFourier();
    let s = await sg();
    assert.equal(s.mode, "free", "the lesson opens in the free mode");
    assert.equal(s.family, "rect");
    assert.equal(await shown("[data-signals-steps]"), false, "no step bar in the free mode");
    assert.equal(await shown("[data-signals-family]"), true, "the 예시 select is there");

    await change("[data-signals-mode]", "guide");
    await settle();
    s = await sg();
    assert.equal(s.mode, "guide");
    assert.equal(s.guideStep, "train", "the first visit starts at step ①");
    assert.equal(await ev(`document.querySelectorAll("[data-signals-step]").length`), 5);
    assert.equal(await ev(`document.querySelector('[data-signals-step="train"]').getAttribute("aria-current")`), "step");
    assert.equal(await shown("[data-signals-family]"), false, "the 예시 select is replaced by the steps");
    assert.match(await text("[data-signals-guide-body]"), /선 스펙트럼/);
    assert.match(await text("#signals-workspace h2"), /따라가기 · ① 펄스열에서 펄스 하나로/);
    assert.match(await text("[data-signals-live]"), /선 간격 f₀ = 4 Hz/, "T₀ = 0.25 s at first");

    // Preset "T₀ = 1 s": the slider jumps there, the read-out follows and the chip shows as pressed.
    const chip = await ev(`[...document.querySelectorAll("[data-signals-chip]")].findIndex((b) => b.textContent === "T₀ = 1 s")`);
    assert.ok(chip >= 0, "the T₀ = 1 s preset");
    await clickEl(`[data-signals-chip="${chip}"]`);
    s = await sg();
    assert.equal(s.params.T0, 1);
    assert.equal(await ev(`document.querySelector('[data-signals-param="T0"]').value`), "1");
    assert.match(await text("[data-signals-live]"), /선 간격 f₀ = 1 Hz, 첫 영점 10 Hz 안쪽에 선 19개/);
    assert.equal(await ev(`document.querySelector('[data-signals-chip="${chip}"]').getAttribute("aria-pressed")`), "true");
    await change('[data-signals-param="T0"]', "1.5");
    await settle();
    assert.equal(await ev(`document.querySelector('[data-signals-chip="${chip}"]').getAttribute("aria-pressed")`), "false", "moving the slider releases the preset");

    // ω axis, then step ③: the axis stays ω, the phase pane is there.
    await change('[data-signals-param="axis"]', "1");
    await settle();
    assert.match(await text("[data-signals-live]"), /ω₀/);
    await clickEl('[data-signals-step="shift"]');
    s = await sg();
    assert.equal(s.guideStep, "shift");
    assert.equal(s.params.axis, 1, "the frequency axis carries over to the next step");
    assert.equal(s.params.t0, 0.5, "step ③ starts at Ex 4.13 (0 < t < τ)");
    assert.match(await ev(`document.querySelector(".sg-stage").textContent`), /θ\(ω\) \[rad\]/, "the phase pane");

    // Drag the pulse to the right in the time pane (the lesson's visible plot; its first pane spans t ∈ [−4, 4]).
    const pane = await ev(`(() => { const svg = [...document.querySelectorAll(".sg-stage svg")].find((s) => s.getClientRects().length > 0); const r = svg.getBoundingClientRect(); const c = svg.querySelector(".sg-pane clipPath rect"); const n = (k) => Number(c.getAttribute(k)); return { left: r.left + n("x"), top: r.top + n("y"), width: n("width"), height: n("height") }; })()`);
    const toX = (t) => pane.left + ((t + 4) / 8) * pane.width;
    const y = pane.top + pane.height / 2;
    await mouse("mouseMoved", toX(0.5), y);
    await mouse("mousePressed", toX(0.5), y, 1);
    for (const t of [0.8, 1.1, 1.5]) { await mouse("mouseMoved", toX(t), y, 1); await sleep(20); }
    await mouse("mouseReleased", toX(1.5), y);
    await settle();
    s = await sg();
    assert.ok(Math.abs(s.params.t0 - 1.5) <= 0.1, `dragging moved t₀ to about 1.5 s (got ${s.params.t0})`);
    assert.match(await text("[data-signals-live]"), /\|X\|는 그대로/);

    // Tab memory: mode, step, axis and the other step's slider survive a reload.
    await flushSessions();
    await reload();
    await until(`${L}.getSignalsCourseState()?.active === true`, "the signals workspace after the reload");
    s = await sg();
    assert.equal(s.lessonId, "fourier");
    assert.equal(s.mode, "guide");
    assert.equal(s.guideStep, "shift");
    assert.equal(s.params.axis, 1);
    await clickEl('[data-signals-step="train"]');
    s = await sg();
    assert.equal(s.params.T0, 1.5, "step ① kept its own T₀");

    // Back to the free examples: the example that was open before (rect) and the 예시 select come back.
    await change("[data-signals-mode]", "free");
    await settle();
    s = await sg();
    assert.equal(s.mode, "free");
    assert.equal(s.family, "rect");
    assert.equal(await shown("[data-signals-steps]"), false);
    assert.equal(await shown("[data-signals-chips]"), false);
    assert.equal(await shown("[data-signals-family]"), true);
    assert.equal(await text("#signals-workspace h2"), "푸리에 변환 · 시간 ↔ 주파수");
    // ... and 따라가기 again resumes at step ①, where it was left.
    await change("[data-signals-mode]", "guide");
    await settle();
    assert.equal((await sg()).guideStep, "train");
  });

  test("phone 390 px: the plot first (high on the screen), the step bar under it, presets after the controls, 44 px targets, no sideways scroll", async () => {
    await openFourier({ mobile: true });
    await change("[data-signals-mode]", "guide");
    await settle();
    await clickEl('[data-signals-step="pulse"]');
    assert.equal((await sg()).guideStep, "pulse");
    const steps = await box("[data-signals-steps]");
    const stage = await box(".sg-stage");
    const controls = await box(".sg-controls");
    const chips = await box("[data-signals-chips]");
    const body = await box("[data-signals-guide-body]");
    assert.ok(stage.top < 844 * 0.4, `the plot starts high on the first screen (${stage.top})`);
    assert.ok(stage.bottom <= steps.top + 1, "the step bar right under the plot");
    assert.ok(steps.bottom <= controls.top + 1, "steps above the controls");
    assert.ok(controls.bottom <= chips.top + 1, "presets right after the controls");
    assert.ok(chips.bottom <= body.top + 1, "explanation after the presets");
    const small = await ev(`[...document.querySelectorAll("[data-signals-step], [data-signals-chip]")].filter((b) => b.getBoundingClientRect().height < 43.5).map((b) => b.textContent)`);
    assert.deepEqual(small, [], "every step and preset button is a 44 px target");
    assert.equal(await ev(`document.documentElement.scrollWidth <= innerWidth`), true, "no sideways scroll");
    const wide = await ev(`[...document.querySelectorAll("[data-signals-step]")].filter((b) => b.scrollWidth > b.clientWidth + 1).map((b) => b.textContent)`);
    assert.deepEqual(wide, [], "step labels fit their buttons");
    // A preset works on the phone too (높이 2 · 폭 0.5: area 1, first zero at 2 Hz).
    const chip = await ev(`[...document.querySelectorAll("[data-signals-chip]")].findIndex((b) => b.textContent === "높이 2 · 폭 0.5")`);
    await clickEl(`[data-signals-chip="${chip}"]`);
    const s = await sg();
    assert.deepEqual([s.params.A, s.params.T], [2, 0.5]);
    assert.match(await text("[data-signals-live]"), /넓이 Aτ = 1 → X\(0\) = 1\. 첫 영점 ±2 Hz/);
    // The shift step can be dragged, so the phone shows the drag hint under the plot.
    await clickEl('[data-signals-step="shift"]');
    assert.equal(await text("[data-signals-hint]"), "● 시간 파형을 끌어 이동");
    assert.equal(await shown("[data-signals-hint]"), true);
    // ③ the t₀ label keeps clear of the time pane's title; ④ the height label sits above the pulse, not on its edge.
    const firstPane = `[...document.querySelectorAll(".sg-stage svg")].find((s) => s.getClientRects().length > 0).querySelector(".sg-pane")`;
    const label = (start) => `[...${firstPane}.querySelectorAll("text.sg-note")].find((t) => t.textContent.startsWith(${JSON.stringify(start)})).getBoundingClientRect()`;
    const shiftGap = await ev(`${label("t₀ =")}.top - ${firstPane}.querySelector(".sg-title").getBoundingClientRect().bottom`);
    assert.ok(shiftGap >= 4, `③ t₀ label vs the pane title: ${shiftGap} px apart`);
    await clickEl('[data-signals-step="impulse"]');
    const impulse = await ev(`(() => { const l = ${label("높이 1/a")}, a = ${firstPane}.querySelector("path.fl.c1").getBoundingClientRect(), t = ${firstPane}.querySelector(".sg-title").getBoundingClientRect(); return { labelTop: l.top, labelBottom: l.bottom, pulseTop: a.top, titleBottom: t.bottom }; })()`);
    assert.ok(impulse.labelBottom <= impulse.pulseTop + 1, `④ the height label is above the pulse (${JSON.stringify(impulse)})`);
    assert.ok(impulse.labelTop >= impulse.titleBottom + 4, `④ and below the pane title (${JSON.stringify(impulse)})`);
    // The step bar stays one 44 px line on every step (one-word labels on a phone; the full name is the title).
    const heights = [];
    for (const id of ["train", "pulse", "shift", "impulse", "exp"]) {
      await clickEl(`[data-signals-step="${id}"]`);
      heights.push(Math.round((await box("[data-signals-steps]")).height));
    }
    assert.ok(heights.every((h) => h === heights[0] && h <= 46), `the step bar keeps one line (${heights})`);
    const tops = await ev(`[...document.querySelectorAll("[data-signals-step]")].map((b) => Math.round(b.getBoundingClientRect().top))`);
    assert.equal(new Set(tops).size, 1, `all five steps on one line (${tops})`);
    assert.equal(await ev(`document.querySelector('[data-signals-step="train"]').innerText.trim()`), "① 급수");
    assert.equal(await ev(`document.querySelector('[data-signals-step="train"]').title`), "① 펄스열에서 펄스 하나로");
    assert.equal(await ev(`document.documentElement.scrollWidth <= innerWidth`), true, "still no sideways scroll");
  });
});
