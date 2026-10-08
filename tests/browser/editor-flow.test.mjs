// First-time user flow "build a circuit → run → see the result" on the PC and the phone: the empty-canvas guide (shown, gone after the
// first placed part, remembered), the empty waveform panel's recommended probes (one tap, one undo step) and node chips, the new-result
// cue (phone: dot on the 파형 tab without switching; PC: the waveform header lights up) and the one-tap GND fix for a circuit without ground.
// Same harness as smoke.test.mjs: real server + headless Edge with a throw-away profile; only our own processes are stopped.
// Phones run in mobile emulation with touch input like mobile-editor.test.mjs. Set EDITOR_FLOW_SHOTS=<dir> to save screenshots.
import { describe, test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  L, ROOT, ctx, ev, until, settle, navigate, state, click, clickAt, bgPoint, press, select, runAnalysis, sleep, nodeValue,
  startServer, startBrowser, stopAll, leftoverProcessIds, isAlive, assertNoProblems, resetProblems,
} from "./harness.mjs";

const PHONE = [390, 844];
const SHOTS = process.env.EDITOR_FLOW_SHOTS || "";

const touch = (type, touchPoints) => ctx.cdp.send("Input.dispatchTouchEvent", { type, touchPoints });
async function tap(point, holdMs = 40) { await touch("touchStart", [{ x: point.x, y: point.y }]); await sleep(holdMs); await touch("touchEnd", []); await settle(); }
const rectOf = (selector) => ev(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, top: r.top, bottom: r.bottom, left: r.left, right: r.right, w: r.width, h: r.height }; })()`);
/** The element really on top at the centre of `selector` is that element (or inside it). */
const reachable = (selector) => ev(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return false; e.scrollIntoView({ block: "nearest" }); const r = e.getBoundingClientRect(); const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return Boolean(hit && e.contains(hit)); })()`);
async function tapSelector(selector) {
  await ev(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({ block: "nearest" })`);
  const r = await rectOf(selector);
  assert.ok(r && r.w > 0, `missing ${selector}`);
  assert.ok(await reachable(selector), `a tap on ${selector} would land on something else`);
  await tap(r);
}
async function phone(path, [width, height] = PHONE) {
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
const screenOf = (x, y) => ev(`(() => { const p = new DOMPoint(${x}, ${y}).matrixTransform(document.getElementById("circuit-canvas").getScreenCTM()); return { x: p.x, y: p.y }; })()`);
const hint = () => ev(`(() => { const e = document.getElementById("empty-hint"); return { hidden: e.classList.contains("hidden"), guide: e.classList.contains("first-run"), steps: e.querySelectorAll(".first-run-steps li").length, button: Boolean(e.querySelector("[data-first-run-example]")), text: e.innerText }; })()`);
const layout = () => ev(`${L}.getLayout()`);
const plotLines = () => ev(`document.querySelectorAll("#wave-plot path.plot-line").length`);
const plotEmpty = () => ev(`(() => { const e = document.getElementById("plot-empty"); return { hidden: e.classList.contains("hidden"), offer: Boolean(e.querySelector("[data-suggest-probes]")), chips: [...e.querySelectorAll("[data-suggest-node]")].map((b) => b.textContent), text: e.innerText }; })()`);
async function removeAllProbes() {
  for (const probe of (await state()).probes) await click(`#probe-list [data-remove-probe="${probe.key}"]`);
  assert.deepEqual((await state()).probes, []);
}
async function freshStart(open) {
  await open("/");
  await ev(`localStorage.clear(); sessionStorage.clear()`);
  await open("/");
}

/** A divider whose GND was forgotten: V1 + R1 + R2 in a closed loop, every pin wired. Opened through the real file input. */
async function openNoGroundProject() {
  const project = JSON.parse(readFileSync(join(ROOT, "tests/fixtures/project-divider-f0.json"), "utf8"));
  project.title = "GND 없는 분압기";
  project.circuit.components = project.circuit.components.filter((part) => part.type !== "GND");
  project.circuit.wires = [
    ...project.circuit.wires.filter((wire) => wire.a.componentId !== "G1" && wire.b.componentId !== "G1"),
    { id: "W5", a: { componentId: "R2", pin: 1 }, b: { componentId: "V1", pin: 1 } },
  ];
  project.probes = [];
  const file = join(ctx.profile, "no-ground.json");
  writeFileSync(file, JSON.stringify(project));
  const { root } = await ctx.cdp.send("DOM.getDocument");
  const { nodeId } = await ctx.cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector: "#file-input" });
  await ctx.cdp.send("DOM.setFileInputFiles", { files: [file], nodeId });
  await until(`document.getElementById("canvas-title").textContent === "GND 없는 분압기"`, "the project without ground to open");
  await settle();
}

describe("editor flow for a first-time user", { timeout: 300000 }, () => {
  before(async () => { await startServer(); await startBrowser(); });
  beforeEach(() => resetProblems());
  afterEach(async () => { await assertNoProblems("console/network"); });
  after(async () => {
    const started = [ctx.edge?.pid, ctx.server?.pid].filter(Boolean);
    const stopped = await stopAll();
    for (const pid of new Set([...started, ...stopped])) assert.equal(isAlive(pid), false, `process ${pid} should have been stopped`);
    assert.deepEqual(leftoverProcessIds(), [], "no process may still carry the throw-away Edge profile");
  });

  test("PC: an empty canvas shows the 3-step guide; the first placed part hides it and it stays the plain hint after 새 회로 and a reload", async () => {
    await freshStart(desktop);
    let now = await hint();
    assert.equal(now.hidden, false);
    assert.equal(now.guide, true, "the first-run guide is shown");
    assert.equal(now.steps, 3);
    assert.match(now.text, /부품을 눌러 캔버스에 놓기[\s\S]*핀끼리 끌어 배선[\s\S]*자동 해석/);
    assert.ok(await reachable("[data-first-run-example]"), "예제 열기 is clickable");
    await shot("pc-empty-guide");
    await click('.palette-item[data-type="R"]');
    assert.equal((await hint()).button, true);
    assert.equal(await ev(`document.getElementById("empty-hint").dataset.placing`), "1", "the button steps aside while placing");
    const spot = await bgPoint({ from: "top-left" });
    await clickAt(spot.x, spot.y); await settle();
    assert.equal((await state()).circuit.components.length, 1, "a part was placed");
    assert.equal((await hint()).hidden, true, "the guide is gone");
    assert.equal(await ev(`localStorage.getItem("circuit-lab:first-run-done")`), "1", "remembered");
    await press("Escape", "Escape", 27);
    await click("#new-button");
    now = await hint();
    assert.equal(now.hidden, false, "an empty circuit still shows a hint");
    assert.equal(now.guide, false, "…the plain one");
    await desktop("/");
    if ((await state()).circuit.components.length) await click("#new-button");
    assert.equal((await hint()).guide, false, "the guide does not come back after a reload");
  });

  test("PC: 예제 열기 on the guide opens the RC example, which runs and draws its waveform", async () => {
    await freshStart(desktop);
    await click("[data-first-run-example]");
    await until(`${L}.getState().circuit.components.length === 4`, "the example to open");
    assert.equal(await ev(`document.getElementById("canvas-title").textContent`), "RC 충전 (시간응답)");
    await until(`${L}.getState().runState.status === "success"`, "the automatic run");
    await until(`document.querySelectorAll("#wave-plot path.plot-line").length > 0`, "a waveform");
    assert.equal(await ev(`localStorage.getItem("circuit-lab:first-run-done")`), null, "opening an example does not end the guide");
  });

  test("PC: AC without probes → the empty panel offers recommended probes; one click draws them, one undo removes them; a node chip adds one", async () => {
    await desktop("/?example=rc-lowpass");
    await until(`${L}.getState().runState.status === "success" && ${L}.getState().result.analysis === "ac"`, "the AC run");
    await removeAllProbes();
    let empty = await plotEmpty();
    assert.equal(empty.hidden, false);
    assert.equal(empty.offer, true, "the recommend button is offered");
    assert.deepEqual(empty.chips, ["V(C1.1)", "V(R1.1)"], "one chip per node, the output first");
    assert.match(empty.text, /결과가 나왔습니다/);
    await shot("pc-ac-empty-wave-offer");
    const depth = (await state()).historyDepth;
    await click("[data-suggest-probes]");
    const probes = (await state()).probes;
    assert.deepEqual(probes.map((probe) => probe.label), ["V(C1.1)", "I(V1, 기준 1→2)"], "the output voltage and the source current");
    assert.equal((await state()).historyDepth, depth + 1, "one undo step");
    await until(`document.querySelectorAll("#wave-plot path.plot-line").length === 2`, "two traces at once");
    assert.equal((await plotEmpty()).hidden, true);
    await shot("pc-ac-recommended-probes");
    await click("#undo-button");
    assert.deepEqual((await state()).probes, [], "one undo removes both");
    await until(`!document.getElementById("plot-empty").classList.contains("hidden") && document.querySelector("[data-suggest-node]")`, "the offer again");
    await click('[data-suggest-node="V:R1:0"]');
    assert.deepEqual((await state()).probes.map((probe) => probe.label), ["V(R1.1)"], "the chip added exactly that node");
    await until(`${L}.getState().runState.status === "success" && document.querySelectorAll("#wave-plot path.plot-line").length === 1`, "its trace");
  });

  test("PC: a result of another kind (AC ↔ 시간응답) lights up the waveform header briefly; no tab dot on the PC", async () => {
    await desktop("/?example=rc-charge");
    await until(`${L}.getState().runState.status === "success"`, "the first run");
    await ev(`document.querySelector(".wave-header").classList.remove("result-flash")`);
    await runAnalysis("ac");
    assert.equal(await ev(`document.querySelector(".wave-header").classList.contains("result-flash")`), true, "AC result → header highlight");
    assert.deepEqual((await layout()).fresh, []);
    await shot("pc-result-flash");
    await until(`!document.querySelector(".wave-header").classList.contains("result-flash")`, "the highlight to fade", 4000);
    await click("#run-button");
    await until(`${L}.getState().runState.status === "success"`, "the same kind again");
    assert.equal(await ev(`document.querySelector(".wave-header").classList.contains("result-flash")`), false, "the same kind again is not announced");
  });

  test("PC: no GND, auto update on → the box says why and 'GND 추가' fixes it in one undo step; the auto run then succeeds", async () => {
    await desktop("/");
    await openNoGroundProject();
    await until(`!document.getElementById("error-box").classList.contains("hidden") && document.querySelector("#error-box [data-fix-ground]")`, "the ground advice");
    const text = await ev(`document.getElementById("error-box").innerText`);
    assert.match(text, /GND/);
    assert.match(await ev(`document.querySelector("#error-box [data-fix-ground]").textContent`), /GND 추가 \(V1 − 단자\)/);
    await shot("pc-no-ground-advice");
    const depth = (await state()).historyDepth;
    await click("#error-box [data-fix-ground]");
    const now = await state();
    assert.equal(now.historyDepth, depth + 1, "one undo step");
    const ground = now.circuit.components.find((part) => part.type === "GND");
    assert.ok(ground, "a GND was added");
    assert.ok(now.circuit.wires.some((wire) => wire.a.componentId === "V1" && wire.a.pin === 1 && wire.b.componentId === ground.id), "wired to V1 −");
    await until(`${L}.getState().runState.status === "success"`, "the automatic run");
    assert.ok(Math.abs(nodeValue((await state()).result, 0, "R2", 0) - 2.5) < 1e-9, "V(R2.1) = 2.5 V with V1 = 5 V");
    assert.equal(await ev(`document.getElementById("error-box").classList.contains("hidden")`), true, "the advice is gone");
    await shot("pc-no-ground-fixed");
    await click("#undo-button");
    assert.equal((await state()).circuit.components.some((part) => part.type === "GND"), false, "undo takes GND and wire away together");
    await until(`document.querySelector("#error-box [data-fix-ground]")`, "the advice again after undo");
  });

  test("PC: no GND, manual run → NO_GROUND failure marks V1 on the canvas and offers the same fix", async () => {
    await desktop("/");
    await openNoGroundProject();
    await click("#auto-update");
    assert.equal((await state()).autoUpdate, false);
    await click("#run-button");
    await until(`${L}.getState().runState.status === "error"`, "the run to fail");
    assert.equal((await state()).runState.error.code, "NO_GROUND");
    assert.match(await ev(`document.getElementById("error-box").innerText`), /접지\(GND\)가 없습니다[\s\S]*빨간 점선/);
    assert.deepEqual(await ev(`[...document.querySelectorAll('#component-layer .component[data-diagnostic]')].map((g) => g.dataset.id)`), ["V1"], "the source is marked");
    await shot("pc-no-ground-failure");
    await click("#error-box [data-fix-ground]");
    assert.equal(await ev(`document.querySelectorAll('#component-layer .component[data-diagnostic]').length`), 0, "the mark goes with the failure");
    await click("#run-button");
    await until(`${L}.getState().runState.status === "success"`, "the run after the fix");
  });

  test("phone: the empty-canvas guide fits the canvas, 예제 열기 is tappable, and placing a part hides it for good", async () => {
    await freshStart(phone);
    const now = await hint();
    assert.equal(now.guide && !now.hidden, true);
    const box = await ev(`(() => { const w = document.getElementById("canvas-wrap").getBoundingClientRect(); const steps = document.querySelector(".first-run-steps").getBoundingClientRect(); const b = document.querySelector("[data-first-run-example]").getBoundingClientRect(); return { inside: steps.top >= w.top && steps.bottom <= w.bottom && b.bottom <= w.bottom && steps.left >= w.left && steps.right <= w.right, buttonH: b.height }; })()`);
    assert.equal(box.inside, true, "the steps and the button fit inside the canvas");
    assert.ok(box.buttonH >= 44, "44 px touch target");
    assert.ok(await reachable("[data-first-run-example]"));
    await shot("phone-empty-guide");
    await tapSelector('.view-tabs [data-view="palette"]');
    await tapSelector('.palette-item[data-type="R"]');
    await tap(await screenOf(300, 120));
    assert.equal((await state()).circuit.components.length, 1, "the tap placed a part");
    assert.equal((await hint()).hidden, true);
    assert.equal(await ev(`localStorage.getItem("circuit-lab:first-run-done")`), "1");
    await freshStart(phone);
    await tapSelector("[data-first-run-example]");
    await until(`${L}.getState().circuit.components.length === 4`, "the example to open from a tap");
  });

  test("phone: switching to AC puts a dot on the 파형 tab (the panel stays), the empty wave panel's button draws the recommended probes", async () => {
    await phone("/?example=divider");
    await until(`${L}.getState().runState.status === "success" && ${L}.getState().result.analysis === "dc"`, "the DC run");
    assert.deepEqual((await layout()).fresh, [], "a DC result is not announced");
    await tapSelector('.view-tabs [data-view="wave"]');
    await removeAllProbes();
    await tapSelector('.view-tabs [data-view="palette"]');
    const before = (await layout()).view;
    await select("#analysis-intent", "ac");
    await until(`${L}.getState().runState.status === "success" && ${L}.getState().result.analysis === "ac"`, "the AC run");
    const after = await layout();
    assert.deepEqual(after.fresh, ["wave"], "dot on the 파형 tab");
    assert.equal(after.view, before, "the open panel did not change");
    assert.equal(await ev(`getComputedStyle(document.querySelector('.view-tabs [data-view="wave"]'), "::after").content`), '""', "the dot is drawn");
    assert.equal(await ev(`document.querySelector('.view-tabs [data-view="wave"]').getAttribute("aria-label")`), "파형 · 새 결과");
    await shot("phone-wave-tab-dot");
    await tapSelector('.view-tabs [data-view="wave"]');
    assert.deepEqual((await layout()).fresh, [], "opening 파형 clears the dot");
    const empty = await plotEmpty();
    assert.equal(empty.offer, true);
    assert.ok(await reachable("[data-suggest-probes]"), "the recommend button is tappable on the phone");
    await shot("phone-wave-offer");
    await tapSelector("[data-suggest-probes]");
    assert.deepEqual((await state()).probes.map((probe) => probe.label), ["V(R2.1)", "I(V1, 기준 1→2)"]);
    await until(`document.querySelectorAll("#wave-plot path.plot-line").length === 2`, "both traces");
    await shot("phone-wave-recommended");
  });

  test("phone: no GND → the advice and its button are reachable; one tap fixes the circuit", async () => {
    await phone("/");
    await openNoGroundProject();
    await until(`document.querySelector("#error-box [data-fix-ground]")`, "the ground advice");
    assert.ok((await rectOf("#error-box [data-fix-ground]")).h >= 44, "44 px touch target");
    await shot("phone-no-ground-advice");
    await tapSelector("#error-box [data-fix-ground]");
    assert.ok((await state()).circuit.components.some((part) => part.type === "GND"));
    await until(`${L}.getState().runState.status === "success"`, "the automatic run");
  });
});
