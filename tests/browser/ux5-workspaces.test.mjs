// First-time-student round (ux5) of the three study workspaces: tab memory across reload / back / remount, phone keyboards,
// results brought into view on a phone, the convolution tap, the Ampere loop handles, and the magnetic-circuit graph.
// Real server + headless Edge with a throw-away profile (harness.mjs). Run with `node --test tests/browser/ux5-workspaces.test.mjs`.
import { describe, test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  L, ctx, ev, until, settle, navigate, sleep, select, typeInto,
  startServer, startBrowser, stopAll, leftoverProcessIds, isAlive, assertNoProblems, resetProblems,
} from "./harness.mjs";

const SESSION = "circuit-lab.session.";
const touch = (type, touchPoints) => ctx.cdp.send("Input.dispatchTouchEvent", { type, touchPoints });
async function fingerDrag(from, to, { steps = 8 } = {}) {
  await touch("touchStart", [{ x: from.x, y: from.y }]);
  for (let i = 1; i <= steps; i += 1) { await touch("touchMove", [{ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps }]); await sleep(16); }
  await touch("touchEnd", []);
  await settle();
}
async function tap(at) { await touch("touchStart", [{ x: at.x, y: at.y }]); await sleep(40); await touch("touchEnd", []); await settle(); }
async function phone(path, [width, height] = [390, 844]) {
  await ctx.cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await navigate(path, { width, height, mobile: true });
}
async function desktop(path) {
  await ctx.cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false });
  await navigate(path);
}
/** Reload the tab the way the browser's reload button does (sessionStorage stays, navigation type "reload"). */
async function reload() {
  let off = () => {};
  const loaded = new Promise((done) => { off = ctx.cdp.on((message) => { if (message.method === "Page.loadEventFired") done(); }); });
  try { await ctx.cdp.send("Page.reload", {}); await loaded; } finally { off(); }
  await until(`Boolean(${L}) && document.readyState === "complete"`, "the reloaded app");
  await settle();
}
const flushSessions = () => ev(`new Promise((done) => setTimeout(done, 400))`); // the tab memory saves 250 ms after the last change
const stored = (name) => ev(`JSON.parse(sessionStorage.getItem(${JSON.stringify(SESSION + name)}) ?? "null")`);
const sg = () => ev(`${L}.getSignalsCourseState()`);
const em = () => ev(`${L}.getEMState()`);
const cc = () => ev(`${L}.getCircuitCourseState()`);
const CC_HOST = "#circuit-course-host";
const ccPanel = (id) => `${CC_HOST} [data-circuit-course-tool-panel=${id}]`;
async function ccGo(kind, id) {
  await ev(`(() => { const b = document.querySelector('${CC_HOST} [data-circuit-course-${kind}="${id}"]'); document.querySelector('${CC_HOST} [data-circuit-course-chapter="' + b.closest("[data-circuit-course-items]").dataset.circuitCourseItems + '"]').click(); b.click(); return true; })()`);
  await settle();
}
const change = (selector, value) => ev(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event("input", { bubbles: true })); e.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
const inView = (selector) => ev(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { top: r.top, bottom: r.bottom, inner: innerHeight, visible: r.top >= -1 && r.top < innerHeight - 40 }; })()`);
async function emCourse(id) {
  await ev(`document.getElementById("em-course-open").click()`);
  await until(`${L}.getEMState().course?.active === true && document.getElementById("em-course-canvas").clientWidth > 100`, "the EM course");
  await ev(`(() => { const t = document.getElementById("em-course-topic"); for (const o of t.options) { t.value = o.value; t.dispatchEvent(new Event("change", { bubbles: true })); if ([...document.querySelectorAll("#em-course-select option")].some((x) => x.value === ${JSON.stringify(id)})) break; } const s = document.getElementById("em-course-select"); if (s.value !== ${JSON.stringify(id)}) { s.value = ${JSON.stringify(id)}; s.dispatchEvent(new Event("change", { bubbles: true })); } return true; })()`);
  await until(`${L}.getEMState().course.selectedId === ${JSON.stringify(id)}`, `the ${id} experiment`);
  await settle();
}

describe("ux5 study workspaces", { timeout: 600000 }, () => {
  before(async () => { await startServer(); await startBrowser(); });
  beforeEach(() => resetProblems());
  afterEach(async () => { await assertNoProblems("console/network"); });
  after(async () => {
    const startedPids = [ctx.edge?.pid, ctx.server?.pid].filter(Boolean);
    const stopped = await stopAll();
    for (const pid of new Set([...startedPids, ...stopped])) assert.equal(isAlive(pid), false, `process ${pid} should have been stopped`);
    assert.deepEqual(leftoverProcessIds(), [], "no process may still carry the throw-away Edge profile");
  });

  test("신호: lesson, example, slider and cursor survive a reload, a history step and a remount; a fresh visit starts over", async () => {
    await desktop("/?workspace=signals");
    await until(`${L}.getSignalsCourseState()?.active === true`, "the signals workspace");
    await ev(`document.querySelector('[data-signals-lesson="convolution"]').click()`);
    await until(`${L}.getSignalsCourseState().lessonId === "convolution"`, "the convolution lesson");
    await ev(`(() => { const b = document.querySelector("[data-signals-play]"); if (${L}.getSignalsCourseState().playing) b.click(); return true; })()`);
    const families = await ev(`[...document.querySelectorAll("[data-signals-family] option")].map((o) => o.value)`);
    const family = families[2];
    await change("[data-signals-family]", family);
    await until(`${L}.getSignalsCourseState().family === ${JSON.stringify(family)}`, "the chosen example");
    const slider = await ev(`(() => { const s = [...document.querySelectorAll("[data-signals-param]")].find((e) => e.type === "range"); return { key: s.dataset.signalsParam, min: Number(s.min), max: Number(s.max), step: Number(s.step) }; })()`);
    const value = slider.min + Math.round(((slider.max - slider.min) * 0.7) / slider.step) * slider.step;
    await change(`[data-signals-param="${slider.key}"]`, String(value));
    await change("[data-signals-cursor]", String(await ev(`Number(document.querySelector("[data-signals-cursor]").min) * 0.3 + Number(document.querySelector("[data-signals-cursor]").max) * 0.7`)));
    await settle();
    const before = await sg();
    assert.equal(before.playing, false);
    await flushSessions();
    assert.equal((await stored("signals")).lessonId, "convolution", "the tab memory is written");

    await reload();
    await until(`${L}.getSignalsCourseState()?.active === true`, "the signals workspace after the reload");
    let after = await sg();
    assert.equal(after.lessonId, "convolution", "reload: same lesson");
    assert.equal(after.family, family, "reload: same example");
    assert.equal(after.params[slider.key], before.params[slider.key], "reload: same slider value");
    assert.ok(Math.abs(after.cursor - before.cursor) < 1e-9, `reload: same observation time (${before.cursor} -> ${after.cursor})`);
    assert.equal(await ev(`document.querySelector('[data-signals-lesson="convolution"]').getAttribute("aria-current")`), "step", "the lesson tab shows it");

    // Back / forward: leave for another page of the app, come back with history.back().
    await navigate("/?workspace=circuit");
    await ev(`history.back()`);
    await until(`location.search === "?workspace=signals" && Boolean(${L}) && ${L}.getSignalsCourseState()?.active === true`, "back to the signals page");
    after = await sg();
    assert.deepEqual([after.lessonId, after.family, after.params[slider.key]], ["convolution", family, before.params[slider.key]], "back: the same state");

    // A remount (the workspace built again in this page) reads the memory back too.
    await flushSessions();
    const remounted = await ev(`import("/src/signals-course-controller.js").then((m) => { const host = document.createElement("section"); document.body.append(host); const c = m.createSignalsCourseController(host); const s = c.inspect(); c.destroy(); host.remove(); return s; })`);
    assert.deepEqual([remounted.lessonId, remounted.family, remounted.params[slider.key]], ["convolution", family, before.params[slider.key]], "remount: the same state");

    // A fresh visit (typed address / link) starts from the defaults and drops the old memory.
    await navigate("/?workspace=signals");
    await until(`${L}.getSignalsCourseState()?.active === true`, "a fresh signals page");
    assert.equal((await sg()).lessonId, "time", "a fresh visit opens the first lesson");
    assert.equal(await stored("signals"), null, "the old tab memory is gone");
  });

  test("전자기: magnetic sources, sensor, Ampere loop, zoom and the open course experiment with its inputs survive a reload", async () => {
    await desktop("/?workspace=em");
    await until(`${L}.getEMState()?.active && document.getElementById("em-plane").clientWidth > 100`, "the EM plane");
    await ev(`document.querySelector('[data-em-field-mode="magnetic"]').click()`);
    await until(`${L}.getEMState().field === "magnetic"`, "the magnetic mode");
    await ev(`document.querySelector('[data-em-current-preset="wire-ampere"]').click()`);
    await until(`${L}.getEMState().ampere !== null`, "the Ampere preset");
    await change("#em-ampere-size", "1.3");
    await ev(`document.getElementById("em-ampere-size").dispatchEvent(new Event("change", { bubbles: true }))`);
    await settle();
    const before = await em();
    await emCourse("mcircuit-gap-core");
    const strip = "#em-course-parameters";
    const target = await ev(`(() => { const e = document.querySelector('${strip} [data-em-course-parameter="targetB"]'); return Boolean(e); })()`);
    assert.ok(target, "the 목표 B field");
    await typeInto(`${strip} [data-em-course-parameter="targetB"]`, "1.05");
    await settle();
    const course = (await em()).course;
    assert.ok(Math.abs(course.records["mcircuit-gap-core"].params.targetB - 1.05) < 1e-12, "목표 B typed");
    await flushSessions();
    await reload();
    await until(`${L}.getEMState()?.course?.active === true`, "the EM course after the reload");
    const after = await em();
    assert.equal(after.field, "magnetic", "the magnetic field is showing");
    assert.deepEqual(after.current.sources, before.current.sources, "the current sources are back");
    assert.deepEqual(after.ampere, before.ampere, "the Ampere loop is back (size 1.3)");
    assert.deepEqual(after.playground.probe, before.playground.probe, "the sensor is where it was");
    assert.deepEqual(after.view, before.view, "the zoom is kept");
    assert.equal(after.courseActive, true, "the course is still open");
    assert.equal(after.course.selectedId, "mcircuit-gap-core", "on the same experiment");
    assert.ok(Math.abs(after.course.records["mcircuit-gap-core"].params.targetB - 1.05) < 1e-12, "with the typed 목표 B");
    await ev(`document.getElementById("em-course-back").click()`);
    await until(`${L}.getEMState().courseActive === false`, "back to the plane");
  });

  test("회로 과정: experiment inputs, basis, the free problem and a course tool survive a reload", async () => {
    await desktop("/?workspace=circuit-course");
    await until(`${L}.getCircuitCourseState()?.active === true`, "the circuit course");
    await ccGo("experiment", "three-phase");
    await ev(`document.querySelector('${CC_HOST} [data-circuit-course-basis="peak"]').click()`);
    await settle();
    await select(`${CC_HOST} [data-circuit-course-key="presentation"]`, "numeric");
    await typeInto(`${CC_HOST} [data-circuit-course-key="r"]`, "12.5");
    await settle();
    await ccGo("tool", "three-phase-ext");
    await select(`${ccPanel("three-phase-ext")} [data-cc-key="sequence"]`, "acb");
    await typeInto(`${ccPanel("three-phase-ext")} [data-cc-key="zaX"]`, "-6");
    await settle();
    // The free problem, solved with the numeric method.
    await ccGo("experiment", "problem");
    await ev(`document.querySelector('${CC_HOST} [data-circuit-course-mode="numeric"]')?.click()`);
    await settle();
    for (const [key, text] of Object.entries({ voltage: "10 V", frequencyHz: "60", r: "5", l: "10", c: "100" })) {
      if (await ev(`Boolean(document.querySelector('${CC_HOST} [data-circuit-course-key="${key}"]')?.getClientRects().length)`)) await typeInto(`${CC_HOST} [data-circuit-course-key="${key}"]`, text);
    }
    await ev(`document.querySelector('${CC_HOST} [data-circuit-course-apply]').click()`);
    await settle();
    const problem = await cc();
    assert.equal(problem.status, "valid", "the problem is solved");
    await ccGo("tool", "three-phase-ext");
    const before = await cc();
    assert.equal(before.courseTools["three-phase-ext"].values.sequence, "acb");
    await flushSessions();
    // A remount in this page reads the memory back.
    const remounted = await ev(`import("/src/circuit-course-controller.js").then((m) => { const host = document.createElement("section"); document.body.append(host); const c = m.createCircuitCourseController(host); const s = c.inspect(); c.destroy(); host.remove(); return { basis: s.basis, sequence: s.courseTools["three-phase-ext"].values.sequence }; })`);
    assert.deepEqual(remounted, { basis: "peak", sequence: "acb" }, "remount: the same course state");
    await reload();
    await until(`${L}.getCircuitCourseState()?.active === true`, "the circuit course after the reload");
    const after = await cc();
    assert.equal(after.tool, "three-phase-ext", "the same item (chapter memory)");
    assert.equal(after.basis, "peak", "the amplitude basis is kept");
    assert.equal(after.courseTools["three-phase-ext"].values.sequence, "acb", "the tool's sequence is kept");
    assert.equal(after.courseTools["three-phase-ext"].values.zaX, -6, "the tool's typed reactance is kept");
    assert.equal(await ev(`document.querySelector('${ccPanel("three-phase-ext")} [data-cc-key="zaX"]').value`), "-6", "and shown in its field");
    await ccGo("experiment", "three-phase");
    const experiment = await cc();
    assert.equal(experiment.drafts.r, "12.5", "the experiment's typed R is kept");
    assert.equal(experiment.status, "valid", "and computed");
    await ccGo("experiment", "problem");
    const solvedAgain = await cc();
    assert.deepEqual([solvedAgain.drafts.solutionMode, solvedAgain.drafts.voltage, solvedAgain.status], ["numeric", "10 V", "valid"], "the solved problem comes back solved");
    assert.equal(await ev(`Boolean(document.querySelector('${CC_HOST} [data-circuit-course-answers]'))`), true, "with its answers");
    await ev(`document.querySelector('${CC_HOST} [data-circuit-course-basis="rms"]').click()`);
    await ev(`(() => { try { localStorage.removeItem("circuit-lab.circuit-course.nav"); } catch {} return true; })()`);
  });

  test("phone keyboards: signed, unit and angle fields get the text keyboard, plain positive numbers keep the decimal pad", async () => {
    await desktop("/?workspace=circuit-course");
    await until(`${L}.getCircuitCourseState()?.active === true`, "the circuit course");
    const modes = (scope) => ev(`Object.fromEntries([...document.querySelectorAll(${JSON.stringify(scope)})].map((e) => [e.dataset.circuitCourseKey ?? e.dataset.ccKey ?? e.dataset.emField ?? e.dataset.emModel ?? e.id, e.getAttribute("inputmode")]))`);
    await ccGo("experiment", "three-phase");
    let m = await modes(`${CC_HOST} .circuit-course-form input[type=text]`);
    assert.equal(m.x, "text", "상 임피던스 X (용량성 −)");
    assert.equal(m.phaseDeg, "text", "기준 위상각 (°, signed)");
    assert.equal(m.r, "decimal", "R ≥ 0");
    assert.equal(m.frequencyHz, "decimal", "f > 0");
    await ccGo("experiment", "problem");
    m = await modes(`${CC_HOST} .circuit-course-form input[type=text]`);
    for (const key of ["voltage", "sourceAngle", "r", "x"].filter((k) => k in m)) assert.equal(m[key], "text", `내 문제 ${key}: units (kΩ, mV, deg/rad) and signs`);
    await ccGo("tool", "three-phase-ext");
    m = await modes(`${ccPanel("three-phase-ext")} input[data-cc-key]`);
    assert.equal(m.zaX, "text", "load reactance (signed)");
    assert.equal(m.referenceDeg, "text", "reference angle");
    assert.equal(m.voltage, "decimal", "source voltage magnitude");
    assert.equal(await ev(`document.querySelector('${ccPanel("three-phase-ext")} [data-cc-key="zaX"]').getAttribute("autocapitalize")`), "off");
    await ev(`(() => { try { localStorage.removeItem("circuit-lab.circuit-course.nav"); } catch {} return true; })()`);

    await desktop("/?workspace=em");
    await until(`${L}.getEMState()?.active && document.getElementById("em-plane").clientWidth > 100`, "the EM plane");
    await ev(`document.querySelector('[data-em-field-mode="electric"]').click()`);
    await settle();
    m = await modes("#em-inspector input[data-em-field]:not([type=range])");
    assert.equal(m.strength, "text", "q (signed)");
    assert.equal(m.pa, "text", "x coordinate (signed)");
    await ev(`document.querySelector('[data-em-field-mode="magnetic"]').click()`);
    await ev(`document.querySelector('[data-em-current-preset="wire-loop"]').click()`);
    await settle();
    await ev(`(() => { const loop = ${L}.getEMState().current.sources.find((s) => s.type === "loop"); return loop?.id; })()`);
    m = await ev(`(() => { const out = {}; for (const e of document.querySelectorAll("#em-current-inspector input[data-em-field]:not([type=range])")) out[e.dataset.emField] = e.getAttribute("inputmode"); return out; })()`);
    assert.equal(m.strength, "text", "I (signed)");
    await ev(`document.querySelector('[data-em-scene="charge"]')?.click()`);
    await settle();
    m = await modes("#em-model-fields input");
    if (Object.keys(m).length) { assert.equal(m.q, "text", "scene q"); assert.equal(m.x, "text", "scene x"); }
    await ev(`document.querySelector('[data-em-scene="loop"]')?.click()`);
    await settle();
    m = await modes("#em-model-fields input");
    if (Object.keys(m).length) { assert.equal(m.radius, "decimal", "scene loop radius"); assert.equal(m.current, "text", "scene current"); }
    await ev(`document.querySelector('[data-em-scene="playground"]')?.click()`);
    await ev(`document.querySelector('[data-em-field-mode="electric"]').click()`);
    assert.equal(await ev(`document.getElementById("em-c-alpha").getAttribute("inputmode")`), "text", "α (signed)");
    assert.equal(await ev(`document.getElementById("em-c-radius").getAttribute("inputmode")`), "decimal", "R > 0");
  });

  test("390x844 회로 과정: examples above the inputs; a new phase sequence or the two-wattmeter choice brings its result on screen; 문제 풀기 shows the numeric answer", async () => {
    await ev(`(() => { try { localStorage.removeItem("circuit-lab.circuit-course.nav"); } catch {} return true; })()`);
    await phone("/?workspace=circuit-course");
    await until(`${L}.getCircuitCourseState()?.active === true`, "the circuit course");
    await ccGo("experiment", "three-phase");
    await ev(`document.getElementById("circuit-course-workspace").scrollTop = 0`);
    await settle();
    const first = await ev(`(() => { const top = (s) => document.querySelector(s).getBoundingClientRect().top; return { examples: top("${CC_HOST} .circuit-course-layout [data-circuit-course-examples-fold]"), form: top("${CC_HOST} [data-circuit-course-form]"), answers: top("${CC_HOST} [data-circuit-course-results]"), inner: innerHeight }; })()`);
    assert.ok(first.examples < first.form, `the example list comes before the inputs (${JSON.stringify(first)})`);
    assert.ok(first.examples < first.inner, `and is on the first screen (${JSON.stringify(first)})`);
    assert.ok(first.form < first.answers, `the inputs come before the answer (${JSON.stringify(first)})`);
    const summary = await ev(`(() => { const s = getComputedStyle(document.querySelector("${CC_HOST} .circuit-course-examples > summary")); return { size: parseFloat(s.fontSize), weight: Number(s.fontWeight) }; })()`);
    assert.ok(summary.size >= 16 && summary.weight >= 600, `the "예제 N개" line is 16 px bold (${JSON.stringify(summary)})`);

    // The tool: 상순서 sits far above the phasor results; choosing acb brings the result up.
    await ccGo("tool", "three-phase-ext");
    await ev(`document.querySelector('${ccPanel("three-phase-ext")} [data-cc-key="sequence"]').scrollIntoView({ block: "center" })`);
    await settle();
    const results = `${ccPanel("three-phase-ext")} [data-cc-results]`;
    assert.equal((await inView(results)).visible, false, "before: the result is off screen");
    const read = await ev(`document.querySelector('${results} [data-cc-read]').textContent`);
    await change(`${ccPanel("three-phase-ext")} [data-cc-key="sequence"]`, "acb");
    await until(`(() => { const r = document.querySelector('${results}').getBoundingClientRect(); return r.top >= -1 && r.top < innerHeight - 40; })()`, "the changed result on screen", 4000);
    assert.notEqual(await ev(`document.querySelector('${results} [data-cc-read]').textContent`), read, "the result did change");
    await change(`${ccPanel("three-phase-ext")} [data-cc-key="sequence"]`, "abc");
    await sleep(600);
    // 2전력계법: W1 and W2 appear on screen after the choice.
    await ev(`document.querySelector('${ccPanel("three-phase-ext")} [data-cc-key="wattmeter"]').scrollIntoView({ block: "center" })`);
    await settle();
    await change(`${ccPanel("three-phase-ext")} [data-cc-key="wattmeter"]`, "two");
    await until(`(() => { const m = [...document.querySelectorAll('${results} .circuit-course-metric')].find((e) => e.textContent.includes("W1")); if (!m) return false; const r = m.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; })()`, "W1 on screen", 4000);
    // Typing does not scroll.
    const scroller = `document.getElementById("circuit-course-workspace")`;
    await ev(`document.querySelector('${ccPanel("three-phase-ext")} [data-cc-key="voltage"]').scrollIntoView({ block: "center" })`);
    await settle();
    const still = await ev(`${scroller}.scrollTop`);
    await typeInto(`${ccPanel("three-phase-ext")} [data-cc-key="voltage"]`, "120");
    await sleep(400);
    assert.equal(await ev(`${scroller}.scrollTop`), still, "typing a number never scrolls");
    await change(`${ccPanel("three-phase-ext")} [data-cc-key="wattmeter"]`, "none");
    await typeInto(`${ccPanel("three-phase-ext")} [data-cc-key="voltage"]`, "110");

    // 내 문제: the type select is on the first screen; 문제 풀기 in the numeric method shows the answers.
    await ccGo("experiment", "problem");
    await ev(`${scroller}.scrollTop = 0`);
    await settle();
    const kind = await inView(`${CC_HOST} [data-circuit-course-key="problemKind"]`);
    assert.ok(kind.bottom <= kind.inner, `the problem type is on the first screen (${JSON.stringify(kind)})`);
    await ev(`(() => { const b = document.querySelector('${CC_HOST} [data-circuit-course-mode="numeric"]'); b?.click(); return true; })()`);
    await settle();
    // Fill the numbers a student would copy from the problem (the numeric method starts with empty fields).
    const given = { voltage: "10", frequencyHz: "60", r: "5", l: "10", c: "100" };
    const empty = await ev(`[...document.querySelectorAll('${CC_HOST} .circuit-course-form input[type=text]')].filter((e) => e.getClientRects().length && !e.value.trim()).map((e) => e.dataset.circuitCourseKey)`);
    for (const key of empty) if (given[key]) await typeInto(`${CC_HOST} [data-circuit-course-key="${key}"]`, given[key]);
    await ev(`document.querySelector('${CC_HOST} [data-circuit-course-apply]').scrollIntoView({ block: "center" })`);
    await ev(`document.querySelector('${CC_HOST} [data-circuit-course-apply]').click()`);
    const solved = await cc();
    assert.equal(solved.drafts.solutionMode, "numeric");
    assert.equal(solved.status, "valid", `the numeric problem is solved (${solved.result?.reason ?? ""})`);
    await until(`(() => { const r = document.querySelector('${CC_HOST} [data-circuit-course-answers]').getBoundingClientRect(); return r.top >= -1 && r.top < innerHeight * 0.6; })()`, "the numeric answer card on screen", 4000);
    await ev(`(() => { try { localStorage.removeItem("circuit-lab.circuit-course.nav"); } catch {} return true; })()`);
  });

  test("390x844 신호 컨볼루션: a tap or a sideways drag on the plot moves t; a vertical swipe scrolls and leaves t", async () => {
    await phone("/?workspace=signals");
    await until(`${L}.getSignalsCourseState()?.active === true`, "the signals workspace");
    await ev(`document.querySelector('[data-signals-lesson="convolution"]').click()`);
    await until(`${L}.getSignalsCourseState().lessonId === "convolution"`, "the convolution lesson");
    await ev(`(() => { const b = document.querySelector("[data-signals-play]"); if (${L}.getSignalsCourseState().playing) b.click(); return true; })()`);
    await ev(`document.getElementById("signals-workspace").scrollTop = 0`);
    await settle();
    const svg = `[...document.querySelectorAll("#signals-workspace .sg-svg")].find((e) => e.getBoundingClientRect().width > 0)`;
    const plot = await ev(`(() => { const r = ${svg}.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
    const start = (await sg()).cursor;
    // A tap at the right part of the first pane (away from the cursor line) moves t there.
    await tap({ x: plot.x + plot.w * 0.85, y: plot.y + plot.h * 0.2 });
    const tapped = (await sg()).cursor;
    assert.ok(tapped > start + 0.1, `the tap moved t to the right (${start} -> ${tapped})`);
    // A sideways drag moves it back to the left.
    await fingerDrag({ x: plot.x + plot.w * 0.8, y: plot.y + plot.h * 0.3 }, { x: plot.x + plot.w * 0.3, y: plot.y + plot.h * 0.32 });
    const dragged = (await sg()).cursor;
    assert.ok(dragged < tapped - 0.1, `the sideways drag moved t left (${tapped} -> ${dragged})`);
    // A vertical swipe scrolls the page and keeps t.
    const top = await ev(`document.getElementById("signals-workspace").scrollTop`);
    await fingerDrag({ x: plot.x + plot.w * 0.6, y: plot.y + plot.h * 0.7 }, { x: plot.x + plot.w * 0.6, y: plot.y + plot.h * 0.7 - 220 }, { steps: 10 });
    await sleep(250);
    assert.equal((await sg()).cursor, dragged, "the vertical swipe left t alone");
    assert.ok((await ev(`document.getElementById("signals-workspace").scrollTop`)) > top + 20, "and scrolled the page");
  });

  test("전자기 암페어 루프: the ✥ handle moves the loop and the ● handle sizes it even with the wire at its centre; the ∮H·dl label stays off the scale bar", async () => {
    await desktop("/?workspace=em");
    await until(`${L}.getEMState()?.active && document.getElementById("em-plane").clientWidth > 100`, "the EM plane");
    await ev(`document.querySelector('[data-em-field-mode="magnetic"]').click()`);
    await until(`${L}.getEMState().field === "magnetic"`, "the magnetic mode");
    await ev(`document.querySelector('[data-em-current-preset="wire-ampere"]').click()`);
    await until(`${L}.getEMState().ampere !== null && ${L}.getEMState().diagnostics.plane.ampere !== null`, "the loop drawn");
    const box = await ev(`(() => { const r = document.getElementById("em-plane").getBoundingClientRect(); return { x: r.x, y: r.y }; })()`);
    const mouse = (type, p, extra = {}) => ctx.cdp.send("Input.dispatchMouseEvent", { type, x: p.x, y: p.y, button: "left", buttons: 1, clickCount: 1, ...extra });
    async function mouseDrag(from, to) {
      await mouse("mouseMoved", from, { buttons: 0, button: "none" });
      await mouse("mousePressed", from);
      for (let i = 1; i <= 6; i += 1) { await mouse("mouseMoved", { x: from.x + ((to.x - from.x) * i) / 6, y: from.y + ((to.y - from.y) * i) / 6 }); await sleep(16); }
      await mouse("mouseReleased", to);
      await settle();
    }
    const state0 = await em(), wire = state0.current.sources[0];
    const handles = state0.diagnostics.plane.ampere;
    // The wire sits at the loop's centre: the move handle is on the path, not on the wire.
    const move = { x: box.x + handles.move[0], y: box.y + handles.move[1] };
    await mouseDrag(move, { x: move.x + 60, y: move.y + 30 });
    const state1 = await em();
    assert.notDeepEqual(state1.ampere.center, state0.ampere.center, "the loop moved");
    assert.deepEqual(state1.current.sources[0].position, wire.position, "the wire stayed where it was");
    assert.ok(Math.abs(state1.ampere.radius - state0.ampere.radius) < 1e-9, "moving keeps the size");
    const size = { x: box.x + state1.diagnostics.plane.ampere.size[0], y: box.y + state1.diagnostics.plane.ampere.size[1] };
    await mouseDrag(size, { x: size.x + 40, y: size.y - 40 });
    const state2 = await em();
    assert.ok(state2.ampere.radius > state1.ampere.radius + 0.1, `the ● handle made it bigger (${state1.ampere.radius} -> ${state2.ampere.radius})`);
    assert.deepEqual(state2.ampere.center, state1.ampere.center, "sizing keeps the centre");
    // A big loop moved to the lower left: its label (normally under the loop, here pushed to the bottom edge) would sit on the
    // "1 m" scale bar, so it goes elsewhere.
    await change("#em-ampere-size", "1.6");
    await ev(`document.getElementById("em-ampere-size").dispatchEvent(new Event("change", { bubbles: true }))`);
    await settle();
    const plane = await ev(`[document.getElementById("em-plane").clientWidth, document.getElementById("em-plane").clientHeight]`);
    const h = (await em()).diagnostics.plane.ampere, d = (h.size[0] - h.move[0]) / 2, centre = [h.move[0] + d, h.move[1] + d];
    const grabbed = { x: box.x + h.move[0], y: box.y + h.move[1] };
    await mouseDrag(grabbed, { x: grabbed.x + (70 - centre[0]), y: grabbed.y + (plane[1] - 90 - centre[1]) });
    const drawn = (await em()).diagnostics.plane;
    const a = drawn.ampere.label, b = drawn.scaleBar;
    assert.ok(a && b, `label and scale bar boxes (${JSON.stringify(drawn.ampere)})`);
    const naive = { x: 70 - a.width / 2, y: plane[1] - 12 - 8, width: a.width, height: 16 }; // under the loop, clamped to the bottom edge
    const overlaps = (p, q) => p.x < q.x + q.width && q.x < p.x + p.width && p.y < q.y + q.height && q.y < p.y + p.height;
    assert.equal(overlaps({ ...naive, x: Math.max(4, naive.x) }, b), true, "this placement really would hit the scale bar");
    assert.equal(overlaps(a, b), false, `the ∮H·dl label does not cover the scale bar (${JSON.stringify({ label: a, bar: b })})`);
  });

  test("전자기 자기회로: dragging the graph sets 목표 B and the answer NI follows; the answer point is marked; with N·I given the graph's B is a free observation; axis numbers use k/M", async () => {
    await desktop("/?workspace=em");
    await until(`${L}.getEMState()?.active && document.getElementById("em-plane").clientWidth > 100`, "the EM plane");
    await emCourse("mcircuit-gap-core");
    const rec = async () => (await em()).course.records["mcircuit-gap-core"];
    const scalar = (r, key) => r.result.scalars.find((s) => s.key === key).value;
    const canvas = await ev(`(() => { const c = document.getElementById("em-course-canvas"); c.scrollIntoView({ block: "center" }); const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
    await settle();
    const before = await rec();
    assert.equal(before.params.mode, 0, "목표 B → NI");
    const mouse = (type, p) => ctx.cdp.send("Input.dispatchMouseEvent", { type, x: p.x, y: p.y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1 });
    const at = { x: canvas.x + canvas.w * 0.4, y: canvas.y + canvas.h * 0.4 };
    await mouse("mousePressed", at); await mouse("mouseReleased", at); await settle();
    const after = await rec();
    assert.notEqual(after.params.targetB, before.params.targetB, `the graph moved 목표 B (${before.params.targetB} -> ${after.params.targetB})`);
    assert.ok(Math.abs(after.point[2] - after.params.targetB) < 1e-12, "the graph's B is 목표 B");
    assert.ok(Math.abs(scalar(after, "B") - after.params.targetB) < 1e-9, "the answer is for that B");
    assert.notEqual(scalar(after, "NI"), scalar(before, "NI"), "and NI changed with it");
    const slider = await ev(`Number(document.querySelector('#em-course-parameters [data-em-course-parameter="targetB"]').value)`);
    assert.ok(Math.abs(slider - after.params.targetB) < 1e-3, `the 목표 B field follows (${slider})`);
    const point = JSON.parse(await ev(`document.getElementById("em-course-canvas").dataset.answerPoint ?? "null"`));
    assert.ok(point && Math.abs(point.coordinate - after.params.targetB) < 1e-9 && Math.abs(point.value - scalar(after, "NI")) < 1e-6, `the answer (B, NI) is marked on the graph (${JSON.stringify(point)})`);
    // N·I given: the graph is a free observation, the answer stays.
    await ev(`(() => { const s = document.querySelector('#em-course-symbolic-controls [data-em-symbolic-control="mode"]') ?? document.querySelector('#em-course-parameters [data-em-course-parameter="mode"]'); s.value = "1"; s.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
    await until(`${L}.getEMState().course.records["mcircuit-gap-core"].params.mode === 1`, "the N·I direction");
    const given = await rec();
    const at2 = { x: canvas.x + canvas.w * 0.75, y: canvas.y + canvas.h * 0.4 };
    await mouse("mousePressed", at2); await mouse("mouseReleased", at2); await settle();
    const observed = await rec();
    assert.equal(observed.params.targetB, given.params.targetB, "목표 B is not touched");
    assert.notEqual(observed.point[2], given.point[2], "the observation B moved");
    assert.equal(scalar(observed, "B"), scalar(given, "B"), "the answer B stays");
    assert.deepEqual(await ev(`import("/src/em-course-view.js").then((m) => [m.engText(2300), m.engText(-0.0045), m.engText(1.5e6), m.engText(0)])`), ["2.3k", "−4.5m", "1.5M", "0"]);
    await ev(`document.getElementById("em-course-reset").click()`);
    await ev(`document.getElementById("em-course-back").click()`);
  });

  test("390x844 small fixes: the rotating-phasor title is whole on a phone; three-phase numbers use four significant digits with thousands separators", async () => {
    await phone("/?workspace=signals");
    await until(`${L}.getSignalsCourseState()?.active === true`, "the signals workspace");
    await ev(`document.querySelector('[data-signals-lesson="series"]').click()`);
    await until(`${L}.getSignalsCourseState().lessonId === "series"`, "the series lesson");
    await settle();
    const title = await ev(`(() => { const t = [...document.querySelectorAll("#signals-workspace .sg-title")].find((e) => e.textContent.startsWith("회전 벡터")); const r = t.getBoundingClientRect(); return { text: t.textContent, left: r.left, right: r.right, inner: innerWidth }; })()`);
    assert.equal(title.text, "회전 벡터 (90° 돌려 그림: 위쪽이 실수축)", "the title is not cut");
    assert.ok(title.left >= 0 && title.right <= title.inner, `and fits the screen (${JSON.stringify(title)})`);
    await phone("/?workspace=circuit-course");
    await until(`${L}.getCircuitCourseState()?.active === true`, "the circuit course");
    await ccGo("tool", "three-phase-ext");
    const texts = await ev(`[...document.querySelectorAll('${ccPanel("three-phase-ext")} [data-cc-results] .circuit-course-metric strong, ${ccPanel("three-phase-ext")} [data-cc-results] td, ${ccPanel("three-phase-ext")} [data-cc-read]')].map((e) => e.textContent)`);
    const numbers = texts.join(" ").match(/\d[\d,]*(?:\.\d+)?/g) ?? [];
    assert.ok(numbers.length > 10, `numbers found (${numbers.length})`);
    for (const n of numbers) {
      const significant = n.replace(/[^\d]/g, "").replace(/^0+/, "").replace(/0+$/, "");
      assert.ok(significant.length <= 4, `at most four significant digits: ${n}`);
      if (Number(n.replace(/,/g, "")) >= 1000) assert.match(n, /,/, `thousands separator: ${n}`);
    }
    await ev(`(() => { try { localStorage.removeItem("circuit-lab.circuit-course.nav"); } catch {} return true; })()`);
  });

  test("전자기: saving an EM file shows a short confirmation", async () => {
    await desktop("/?workspace=em");
    await until(`${L}.getEMState()?.active && document.getElementById("em-plane").clientWidth > 100`, "the EM plane");
    // The download itself is an <a download> click; the confirmation is what this checks.
    await ev(`(() => { HTMLAnchorElement.prototype.click = function () {}; document.getElementById("em-d-save").click(); return true; })()`);
    const toast = await ev(`(() => { const t = document.querySelector("#em-workspace [data-em-toast]"); return t ? { hidden: t.hidden, text: t.textContent, role: t.getAttribute("role") } : null; })()`);
    assert.ok(toast && !toast.hidden && /저장했습니다/.test(toast.text) && toast.role === "status", `a toast says the file was saved (${JSON.stringify(toast)})`);
    await until(`document.querySelector("#em-workspace [data-em-toast]").hidden === true`, "the toast going away", 5000);
  });
});
