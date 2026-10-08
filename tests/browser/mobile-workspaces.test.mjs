// Phone checks of the three study workspaces (전자기학, 신호 및 시스템, 회로 과정): real server + headless Edge (throw-away
// profile, see harness.mjs) in mobile emulation with touch input (Emulation.setTouchEmulationEnabled + Input.dispatchTouchEvent).
// Run with `node --test tests/browser/mobile-workspaces.test.mjs`. Set MOBILE_UX_SHOTS=<dir> to also save phone screenshots there.
import { describe, test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  L, ctx, ev, until, settle, navigate, sleep,
  startServer, startBrowser, stopAll, leftoverProcessIds, isAlive, assertNoProblems, resetProblems,
} from "./harness.mjs";

const PHONES = [[390, 844], [360, 740], [375, 667]];
const SHOTS = process.env.MOBILE_UX_SHOTS || "";
const SCROLLERS = { em: "em-workspace", signals: "signals-workspace", "circuit-course": "circuit-course-workspace" };

const touch = (type, touchPoints) => ctx.cdp.send("Input.dispatchTouchEvent", { type, touchPoints });
/** One finger from `from` to `to`; `during` runs while the finger is still down at `to`. */
async function fingerDrag(from, to, { steps = 8, during = null } = {}) {
  await touch("touchStart", [{ x: from.x, y: from.y }]);
  for (let i = 1; i <= steps; i += 1) { await touch("touchMove", [{ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps }]); await sleep(16); }
  await settle();
  const seen = during ? await during() : null;
  await touch("touchEnd", []);
  await settle();
  return seen;
}
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
const scrollTop = (workspace) => ev(`document.getElementById(${JSON.stringify(SCROLLERS[workspace])}).scrollTop`);
const toTop = (workspace) => ev(`document.getElementById(${JSON.stringify(SCROLLERS[workspace])}).scrollTop = 0`);

/**
 * Every visible control of a workspace: touch size (the smaller side, or the label row of a checkbox) and the font size of text
 * fields and selects (iOS zooms into anything under 16 px). Inline text links inside sentences are not counted.
 */
const audit = (workspace) => ev(`(() => {
  const root = document.getElementById(${JSON.stringify(SCROLLERS[workspace])});
  const shown = (e) => { if (!e.getClientRects().length) return false; const s = getComputedStyle(e), r = e.getBoundingClientRect(); return s.visibility !== "hidden" && r.width > 0 && r.height > 0; };
  const name = (e) => e.tagName.toLowerCase() + (e.id ? "#" + e.id : "") + ([...e.attributes].filter((a) => a.name.startsWith("data-")).slice(0, 1).map((a) => "[" + a.name + (a.value ? "=" + a.value : "") + "]").join("")) + ' "' + (e.textContent || e.getAttribute("aria-label") || "").trim().slice(0, 16) + '"';
  const small = [], font = [];
  for (const e of [...root.querySelectorAll("button, select, input:not([type=hidden]):not([type=file]), textarea, summary")].filter(shown)) {
    const box = (e.type === "checkbox" || e.type === "radio") && e.closest("label") ? e.closest("label") : e, r = box.getBoundingClientRect();
    if (Math.min(r.width, r.height) < 43.5) small.push(name(e) + " " + Math.round(r.width) + "x" + Math.round(r.height));
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.tagName) && !["range", "checkbox", "radio"].includes(e.type) && parseFloat(getComputedStyle(e).fontSize) < 16) font.push(name(e) + " " + getComputedStyle(e).fontSize);
  }
  return { small, font, sideways: document.documentElement.scrollWidth - innerWidth > 1 || root.scrollWidth - root.clientWidth > 1 };
})()`);
async function assertTouchFriendly(workspace, what) {
  const result = await audit(workspace);
  assert.deepEqual(result.small, [], `${what}: every control is at least 44 px`);
  assert.deepEqual(result.font, [], `${what}: text fields and selects use at least 16 px`);
  assert.equal(result.sideways, false, `${what}: nothing scrolls sideways`);
}

const shownGraphs = `[...document.querySelectorAll("#circuit-course-workspace .circuit-course-graphs svg")].filter((e) => e.getBoundingClientRect().height > 0)`;
const visibleSvg = `[...document.querySelectorAll("#signals-workspace .sg-svg")].find((e) => e.getBoundingClientRect().width > 0)`;
const sg = () => ev(`${L}.getSignalsCourseState()`);
async function openSignalsLesson(lesson) {
  const tab = lesson === "reference" ? "[data-signals-reference-tab]" : `[data-signals-lesson="${lesson}"]`;
  await ev(`document.querySelector(${JSON.stringify(tab)}).click()`);
  if (lesson !== "reference") await until(`${L}.getSignalsCourseState().lessonId === ${JSON.stringify(lesson)}`, `the ${lesson} lesson`);
  await settle();
  await toTop("signals");
  await settle();
}
const pausePlayback = () => ev(`(() => { const b = document.querySelector("[data-signals-play]"); if (b && ${L}.getSignalsCourseState().playing) b.click(); return true; })()`);

const em = () => ev(`${L}.getEMState()`);
/** Screen point of a world (a, b) position on the plane canvas (same mapping as em-plane-geometry.createPlaneView). */
async function emScreen(a, b) {
  const { view } = await em();
  const box = await ev(`(() => { const c = document.getElementById("em-plane"), r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: c.clientWidth, h: c.clientHeight }; })()`);
  const scale = Math.min(box.w, box.h) / (2 * view.span);
  return { x: box.x + box.w / 2 + (a - view.offset[0]) * scale, y: box.y + box.h / 2 - (b - view.offset[1]) * scale };
}

const cc = () => ev(`${L}.getCircuitCourseState()`);

describe("phone study workspaces", { timeout: 600000 }, () => {
  before(async () => { await startServer(); await startBrowser(); });
  beforeEach(() => resetProblems());
  afterEach(async () => { await assertNoProblems("console/network"); });
  after(async () => {
    const startedPids = [ctx.edge?.pid, ctx.server?.pid].filter(Boolean);
    const stopped = await stopAll();
    for (const pid of new Set([...startedPids, ...stopped])) assert.equal(isAlive(pid), false, `process ${pid} should have been stopped`);
    assert.deepEqual(leftoverProcessIds(), [], "no process may still carry the throw-away Edge profile");
  });

  for (const size of PHONES) {
    const tag = `${size[0]}x${size[1]}`;

    test(`${tag} 전자기학: touch-sized controls (plane, magnetic mode, course); a charge follows the finger without scrolling the page; the course picture claims its drag`, async () => {
      await phone("/?workspace=em", size);
      await until(`${L}.getEMState()?.active && document.getElementById("em-plane").clientWidth > 100`, "the EM plane");
      await assertTouchFriendly("em", `${tag} plane`);
      await shot(`${tag}-em-plane`);
      // A finger on q1 drags it; the workspace does not scroll along.
      const q1 = (await em()).playground.sources.find((s) => s.id === "q1");
      const from = await emScreen(q1.position[0], q1.position[1]);
      const before = await scrollTop("em");
      await fingerDrag({ x: from.x + 10, y: from.y + 8 }, { x: from.x - 40, y: from.y - 50 }); // 13 px off the centre still grabs it
      const moved = (await em()).playground.sources.find((s) => s.id === "q1").position;
      assert.ok(Math.hypot(moved[0] - q1.position[0], moved[1] - q1.position[1]) > 0.3, `q1 followed the finger (${q1.position} -> ${moved})`);
      assert.equal(await scrollTop("em"), before, "the page did not scroll during the drag");
      // Magnetic mode adds the current palette, chips and presets.
      await ev(`document.querySelector('[data-em-field-mode="magnetic"]').click()`);
      await until(`${L}.getEMState().field === "magnetic"`, "the magnetic mode");
      await settle();
      await assertTouchFriendly("em", `${tag} magnetic`);
      await ev(`document.querySelector('[data-em-field-mode="electric"]').click()`);
      // The problem-solving course.
      await ev(`document.getElementById("em-course-open").click()`);
      await until(`${L}.getEMState().course?.active === true && document.getElementById("em-course-canvas").clientWidth > 100`, "the EM course");
      await settle();
      await toTop("em");
      await assertTouchFriendly("em", `${tag} course`);
      await shot(`${tag}-em-course`);
      const course = await em();
      const point = course.course.records[course.course.selectedId].point;
      const box = await ev(`(() => { const c = document.getElementById("em-course-canvas"); c.scrollIntoView({ block: "center" }); const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
      await settle();
      const scrolled = await scrollTop("em");
      await fingerDrag({ x: box.x + box.w * 0.3, y: box.y + box.h * 0.5 }, { x: box.x + box.w * 0.7, y: box.y + box.h * 0.3 });
      const after = await em();
      assert.notDeepEqual(after.course.records[after.course.selectedId].point, point, "a finger drag on the course picture moves the observation point");
      assert.equal(await scrollTop("em"), scrolled, "and does not scroll the page");
    });

    test(`${tag} 신호 및 시스템: every lesson tab is touch sized; the plot comes before the controls and starts on the first screen`, async () => {
      await phone("/?workspace=signals", size);
      await until(`${L}.getSignalsCourseState()?.active === true && Boolean(${visibleSvg})`, "the signals workspace");
      for (const lesson of ["time", "ops", "lti", "convolution", "series", "fourier", "freq", "reference"]) {
        await openSignalsLesson(lesson);
        await assertTouchFriendly("signals", `${tag} ${lesson}`);
        const order = await ev(`(() => { const svg = ${visibleSvg}.getBoundingClientRect(), controls = document.querySelector(".sg-controls").getBoundingClientRect(); return { plotTop: svg.top, plotBottom: svg.bottom, controlsTop: controls.top, inner: innerHeight }; })()`);
        assert.ok(order.plotBottom <= order.controlsTop + 1, `${lesson}: the plot is above the sliders (${JSON.stringify(order)})`);
        assert.ok(order.plotTop < order.inner * 0.4, `${lesson}: the plot starts high on the first screen (${JSON.stringify(order)})`);
        const ranges = await ev(`[...document.querySelectorAll("#signals-workspace input[type=range]")].filter((e) => e.getClientRects().length).map((e) => Math.round(e.getBoundingClientRect().height))`);
        assert.ok(ranges.every((h) => h >= 44), `${lesson}: sliders have a 44 px touch band (${ranges})`);
      }
      await openSignalsLesson("convolution");
      await shot(`${tag}-signals-convolution`);
    });

    test(`${tag} 신호 및 시스템: a finger drag on the plot changes the value without scrolling, a bubble above the finger names it; a scroll that starts on the plot leaves the value alone`, async () => {
      await phone("/?workspace=signals", size);
      await until(`${L}.getSignalsCourseState()?.active === true && Boolean(${visibleSvg})`, "the signals workspace");
      await openSignalsLesson("freq");
      const frame = await ev(`(() => { const r = ${visibleSvg}.querySelector(".sg-frame").getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
      const fin = (await sg()).params.fin;
      const from = { x: frame.x + frame.w * 0.3, y: frame.y + frame.h * 0.5 }, to = { x: frame.x + frame.w * 0.65, y: frame.y + frame.h * 0.6 };
      const bubble = await fingerDrag(from, to, {
        during: () => ev(`(() => { const b = document.querySelector("[data-signals-bubble]"), r = b.getBoundingClientRect(); return { hidden: b.hidden, text: b.textContent, bottom: r.bottom, left: r.left, right: r.right }; })()`),
      });
      await shot(`${tag}-signals-drag`);
      assert.notEqual((await sg()).params.fin, fin, "dragging on |H| moved the input frequency");
      assert.equal(await scrollTop("signals"), 0, "the page did not scroll during the drag");
      assert.equal(bubble.hidden, false, "a value bubble shows while the finger drags");
      assert.match(bubble.text, /입력 주파수: .*Hz/, `the bubble names the dragged value (${bubble.text})`);
      assert.ok(bubble.bottom <= to.y - 20 && bubble.left >= 0 && bubble.right <= size[0], `the bubble sits above the finger, inside the screen (${JSON.stringify(bubble)}, finger y ${to.y})`);
      assert.equal(await ev(`document.querySelector("[data-signals-bubble]").hidden`), true, "the bubble goes away with the finger");
      // Convolution: the cursor only follows a finger that starts on it; a scroll from elsewhere on the plot keeps it.
      await openSignalsLesson("convolution");
      await pausePlayback();
      const cursor = (await sg()).cursor;
      const plot = await ev(`(() => { const r = ${visibleSvg}.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
      const start = { x: plot.x + 24, y: Math.min(plot.y + plot.h * 0.6, size[1] - 60) };
      await fingerDrag(start, { x: start.x, y: start.y - 200 }, { steps: 10 });
      await sleep(250);
      assert.equal((await sg()).cursor, cursor, "the scroll did not move the cursor");
      assert.ok((await scrollTop("signals")) > 20, "the page scrolled");
    });

    test(`${tag} 회로 과정: touch-sized controls in every chapter item; numeric results come right after the inputs and the period scrubber stays reachable`, async () => {
      await ev(`(() => { try { localStorage.removeItem("circuit-lab.circuit-course.nav"); } catch { /* no storage */ } return true; })()`).catch(() => {});
      await phone("/?workspace=circuit-course", size);
      await until(`${L}.getCircuitCourseState()?.active === true && Boolean(document.querySelector("[data-circuit-course-chapter]"))`, "the circuit course");
      const chapters = await ev(`[...document.querySelectorAll("[data-circuit-course-chapter]")].map((b) => b.dataset.circuitCourseChapter)`);
      for (const chapter of chapters) {
        await ev(`document.querySelector('[data-circuit-course-chapter="${chapter}"]').click()`);
        await settle();
        const count = await ev(`document.querySelectorAll('[data-circuit-course-items="${chapter}"] button').length`);
        for (let index = 0; index < count; index += 1) {
          await ev(`document.querySelectorAll('[data-circuit-course-items="${chapter}"] button')[${index}].click()`);
          await settle();
          await toTop("circuit-course");
          await assertTouchFriendly("circuit-course", `${tag} ${chapter} #${index}`);
        }
      }
      // Numeric presentation of the first experiment: inputs, then the graphs, then the formula card.
      await ev(`document.querySelector('[data-circuit-course-chapter="ch9-10"]').click()`);
      await ev(`document.querySelector('[data-circuit-course-items="ch9-10"] button').click()`);
      await settle();
      await ev(`(() => { const s = document.querySelector('[data-circuit-course-key="presentation"]'); s.value = "numeric"; s.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
      await until(`${L}.getCircuitCourseState().drafts.presentation === "numeric" && Boolean(document.querySelector("#circuit-course-workspace .circuit-course-graphs svg"))`, "the numeric presentation");
      await settle();
      const layout = await ev(`(() => {
        const top = (selector) => document.querySelector(selector).getBoundingClientRect().top;
        return { form: top("[data-circuit-course-form]"), graph: ${shownGraphs}[0].getBoundingClientRect().top, theory: top("[data-circuit-course-theory]") };
      })()`);
      assert.ok(layout.form < layout.graph && layout.graph < layout.theory, `inputs, graphs, then formulas (${JSON.stringify(layout)})`);
      await ev(`${shownGraphs}.at(-1).scrollIntoView({ block: "center" })`);
      await settle();
      const scrubber = await ev(`(() => { const r = document.querySelector("[data-circuit-course-time]").getBoundingClientRect(); return { top: r.top, bottom: r.bottom, h: r.height, inner: innerHeight }; })()`);
      assert.ok(scrubber.top >= 0 && scrubber.bottom <= scrubber.inner && scrubber.h >= 44, `the period scrubber is on screen next to its graphs (${JSON.stringify(scrubber)})`);
      await shot(`${tag}-circuit-course-numeric`);
      const sample = await ev(`document.querySelector("[data-circuit-course-projection]").textContent`);
      const box = await ev(`(() => { const r = document.querySelector("[data-circuit-course-time]").getBoundingClientRect(); return { x: r.x, y: r.y + r.height / 2, w: r.width }; })()`);
      const scrolled = await scrollTop("circuit-course");
      await fingerDrag({ x: box.x + 14, y: box.y }, { x: box.x + box.w * 0.6, y: box.y });
      assert.notEqual(await ev(`document.querySelector("[data-circuit-course-projection]").textContent`), sample, "the scrubber moves the observation time");
      assert.equal(await scrollTop("circuit-course"), scrolled, "a horizontal slider drag does not scroll the page");
      await ev(`(() => { try { localStorage.removeItem("circuit-lab.circuit-course.nav"); } catch { /* no storage */ } return true; })()`);
    });
  }

  for (const size of PHONES) {
    const tag = `${size[0]}x${size[1]}`;
    test(`${tag} 전자기학: the sensor's readout box stays inside the plane at the top centre and the edges, at rest and under the finger, electric and magnetic`, async () => {
      await phone("/?workspace=em", size);
      await until(`${L}.getEMState()?.active && document.getElementById("em-plane").clientWidth > 100`, "the EM plane");
      for (const field of ["electric", "magnetic"]) {
        await ev(`document.querySelector('[data-em-field-mode="${field}"]').click()`);
        await until(`${L}.getEMState().field === "${field}"`, `the ${field} mode`);
        for (const [where, fx, fy] of [["top centre", 0.5, 0.04], ["top left", 0.03, 0.04], ["top right", 0.97, 0.04], ["right edge", 0.97, 0.5]]) {
          await ev(`document.getElementById("em-plane").scrollIntoView({ block: "start" })`);
          await settle();
          const box = await ev(`(() => { const r = document.getElementById("em-plane").getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
          const at = { x: box.x + box.w * fx, y: box.y + box.h * fy };
          const label = () => ev(`${L}.getEMState().diagnostics.plane.sensorLabel`);
          // A finger on empty space brings the sensor along; while it is down the readout avoids the fingertip.
          const held = await fingerDrag({ x: at.x, y: at.y + 30 }, at, { during: label });
          const rest = await label();
          for (const [state, lab] of [["under the finger", held], ["at rest", rest]]) {
            const what = `${field} ${where} ${state}: ${JSON.stringify(lab)}`;
            assert.ok(lab && Math.abs(lab.sensor[0] - box.w * fx) < 3 && Math.abs(lab.sensor[1] - box.h * fy) < 3, `the sensor is where the finger was (${what})`);
            assert.ok(lab.x >= 0 && lab.y >= 0 && lab.x + lab.width <= lab.view[0] && lab.y + lab.height <= lab.view[1], `the readout box is inside the canvas (${what})`);
            assert.ok(lab.fontSize >= 9, `the readout stays legible (${what})`);
          }
          const [sx, sy] = held.sensor;
          assert.ok(!(sx > held.x - 22 && sx < held.x + held.width + 22 && sy > held.y - 22 && sy < held.y + held.height + 22), `the readout is not under the fingertip (${field} ${where}: ${JSON.stringify(held)})`);
          if (where === "top centre") await shot(`${tag}-em-${field}-sensor-top`);
        }
      }
      await ev(`document.querySelector('[data-em-field-mode="electric"]').click()`);
    });
  }

  test("375x667 전자기학 문제 풀이: the folded description keeps the whole picture on the first screen, 더 보기 unfolds it; a finger on the picture's side strip scrolls the page", async () => {
    await phone("/?workspace=em", PHONES[2]);
    await until(`${L}.getEMState()?.active && document.getElementById("em-plane").clientWidth > 100`, "the EM plane");
    await ev(`document.getElementById("em-course-open").click()`);
    await until(`${L}.getEMState().course?.active === true && document.getElementById("em-course-canvas").clientWidth > 100`, "the EM course");
    const original = (await em()).course.selectedId;
    const choose = async (id) => {
      await ev(`(() => { const t = document.getElementById("em-course-topic"); for (const o of t.options) { t.value = o.value; t.dispatchEvent(new Event("change", { bubbles: true })); if ([...document.querySelectorAll("#em-course-select option")].some((x) => x.value === ${JSON.stringify(id)})) break; } const s = document.getElementById("em-course-select"); if (s.value !== ${JSON.stringify(id)}) { s.value = ${JSON.stringify(id)}; s.dispatchEvent(new Event("change", { bubbles: true })); } return true; })()`);
      await until(`${L}.getEMState().course.selectedId === ${JSON.stringify(id)}`, `the ${id} experiment`);
      await settle();
      await toTop("em");
      await settle();
    };
    const firstScreen = () => ev(`(() => {
      const c = document.getElementById("em-course-canvas").getBoundingClientRect(), d = document.getElementById("em-course-desc"), m = document.getElementById("em-course-desc-more").getBoundingClientRect();
      return { top: c.top, bottom: c.bottom, inner: innerHeight, descHeight: d.getBoundingClientRect().height, more: !document.getElementById("em-course-desc-more").hidden, moreBox: [m.width, m.height], note: getComputedStyle(document.getElementById("em-course-picture-note")).display };
    })()`);
    // The first experiment, and a coax one whose picture also carries a note.
    for (const id of ["force-lorentz", "coax-current"]) {
      await choose(id);
      const fold = await firstScreen();
      assert.ok(fold.top >= 0 && fold.bottom <= fold.inner, `${id}: the whole picture is on the first screen (${JSON.stringify(fold)})`);
      assert.ok(fold.descHeight <= 20, `${id}: the description shows its first line only (${JSON.stringify(fold)})`);
      assert.equal(fold.more, true, `${id}: 더 보기 is offered`);
      assert.ok(Math.min(...fold.moreBox) >= 44, `${id}: 더 보기 is a 44 px target (${fold.moreBox})`);
      if (id === "coax-current") assert.equal(fold.note, "none", "the picture note folds with the description");
      await shot(`375x667-em-course-first-screen-${id}`);
      await ev(`document.getElementById("em-course-desc-more").click()`);
      await settle();
      const open = await firstScreen();
      assert.ok(open.descHeight > fold.descHeight + 10, `${id}: 더 보기 shows the whole description (${fold.descHeight} -> ${open.descHeight})`);
      assert.equal(await ev(`document.getElementById("em-course-desc-more").textContent`), "접기");
      if (id === "coax-current") assert.notEqual(open.note, "none", "and the picture note");
      await ev(`document.getElementById("em-course-desc-more").click()`);
      await settle();
      assert.equal((await firstScreen()).descHeight, fold.descHeight, `${id}: 접기 folds it again`);
    }
    await assertTouchFriendly("em", "375x667 course with the folded description");
    // The side strips of the picture belong to the page: a vertical finger drag there scrolls and leaves the probe alone.
    await choose("force-lorentz");
    const box = await ev(`(() => { const c = document.getElementById("em-course-canvas"); c.scrollIntoView({ block: "center" }); const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
    await settle();
    const before = await em(), point = before.course.records[before.course.selectedId].point, scrolled = await scrollTop("em");
    for (const x of [box.x + 6, box.x + box.w - 6]) {
      const top = await scrollTop("em");
      await fingerDrag({ x, y: box.y + box.h * 0.7 }, { x, y: box.y + box.h * 0.2 }, { steps: 10 });
      await sleep(250);
      assert.ok((await scrollTop("em")) > top + 20, `a drag on the ${x < box.x + 20 ? "left" : "right"} strip scrolls the page`);
    }
    const after = await em();
    assert.deepEqual(after.course.records[after.course.selectedId].point, point, "the probe stayed where it was");
    assert.ok((await scrollTop("em")) > scrolled, "the page moved");
    await choose(original);
  });

  test("390x844 전자기학: a touch grabs the sensor from a fingertip away; two fingers pinch-zoom the plane without moving a charge or the sensor", async () => {
    await phone("/?workspace=em", PHONES[0]);
    await until(`${L}.getEMState()?.active && document.getElementById("em-plane").clientWidth > 100`, "the EM plane");
    // The sensor (test charge) is grabbed 24 px away from its centre: a fingertip, not a mouse pointer.
    const probe = (await em()).playground.probe;
    const at = await emScreen(probe[0], probe[1]);
    await fingerDrag({ x: at.x + 24, y: at.y }, { x: at.x + 24, y: at.y + 30 });
    const moved = (await em()).playground.probe, after = await emScreen(moved[0], moved[1]);
    assert.ok(Math.abs(after.y - (at.y + 30)) < 2, `the sensor followed the finger down (${at.y} -> ${after.y})`);
    assert.ok(Math.abs(after.x - at.x) < 2, `it was grabbed where it was, not pulled under the fingertip (${at.x} -> ${after.x})`);
    const start = await em();
    const centre = await emScreen(0, -1);
    await touch("touchStart", [{ x: centre.x - 30, y: centre.y, id: 0 }, { x: centre.x + 30, y: centre.y, id: 1 }]);
    for (let i = 1; i <= 8; i += 1) { await touch("touchMove", [{ x: centre.x - 30 - i * 10, y: centre.y, id: 0 }, { x: centre.x + 30 + i * 10, y: centre.y, id: 1 }]); await sleep(16); }
    await touch("touchEnd", []);
    await settle();
    const zoomed = await em();
    assert.ok(zoomed.view.span < start.view.span * 0.5, `spreading two fingers zooms in (span ${start.view.span} -> ${zoomed.view.span})`);
    assert.deepEqual(zoomed.playground.probe, start.playground.probe, "the sensor stays where it was");
    assert.deepEqual(zoomed.playground.sources.map((s) => s.position), start.playground.sources.map((s) => s.position), "no charge moved");
    const under = await emScreen(0, -1);
    assert.ok(Math.hypot(under.x - centre.x, under.y - centre.y) < 3, "the point between the fingers stays under them");
    await until(`${L}.getEMState().quality === "final"`, "the final render after the pinch");
  });
});
