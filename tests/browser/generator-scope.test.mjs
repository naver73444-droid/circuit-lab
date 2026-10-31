// Sources as a function generator and the waveform panel as an oscilloscope, in a real (headless) browser: [사인] shows only the sine's
// knobs (no DC or AC field) and Autoset sets five periods; the lab RC (1.5 kΩ · 47 nF, 5 Vpp 1 kHz) in 정상상태 starts at a rising
// edge and measures every probe on its own line; the AC run takes the sine's amplitude; the fields fit a 390 px phone.
// Run with `node --test tests/browser/generator-scope.test.mjs`.
import { describe, test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { L, ev, until, settle, navigate, click, clickPart, press, typeInto, component, state, problems, startServer, startBrowser, stopAll, assertNoProblems, resetProblems } from "./harness.mjs";

const field = (key) => `#inspector-content [data-prop="${key}"]`;
async function enter(key, value) { await typeInto(field(key), value); await press("Enter", "Enter", 13); await settle(); }
async function setPart(id, key, value) { await clickPart(id); await enter(key, value); }
const success = () => until(`${L}.getState().runState.status === "success" && !${L}.getState().stale`, "a fresh result", 20000);
function dropLinuxManifestIcon() {
  if (process.platform !== "linux") return;
  for (let i = problems.length - 1; i >= 0; i -= 1) if (/Error while trying to use the following icon from the Manifest/.test(problems[i])) problems.splice(i, 1);
}

describe("function generator and oscilloscope", { timeout: 300000 }, () => {
  before(async () => { await startServer(); await startBrowser(); });
  beforeEach(() => resetProblems());
  afterEach(async () => { dropLinuxManifestIcon(); await assertNoProblems("console/network"); await ev(`(() => { try { localStorage.removeItem("circuit-lab.scope-steady"); } catch {} })()`); });
  after(async () => { await stopAll(); });

  test("사인: only the sine's knobs, 5 Vpp 1 kHz cosine, five periods on screen; the lab RC in 정상상태 measures each probe from a rising edge", async () => {
    await navigate("/?example=rc-charge");
    await click('[data-tool="select"]');
    await clickPart("V1");
    await click('[data-wave="SIN"]');
    assert.deepEqual(await ev(`[...document.querySelectorAll("#inspector-content [data-prop]")].map((e) => e.dataset.prop)`), ["ref", "gen:vpp", "gen:frequency", "gen:offset", "gen:phase"],
      "no DC value, AC magnitude or mode select");
    const v1 = (await component("V1")).props;
    assert.deepEqual([v1.mode, v1.amplitude, v1.frequency, v1.phase], ["SIN", "2.5", "1k", "90"], "5 Vpp = 2.5 V peak, cos phase 0");
    assert.equal(await ev(`document.querySelector('.component[data-id="V1"] .value-label').textContent`), "사인 5 Vpp · 1 kHz");
    assert.deepEqual([(await state()).settings.end, (await state()).settings.step], ["0.005", "0.000001"], "Autoset: five periods");
    await setPart("R1", "value", "1.5k");
    await setPart("C1", "value", "47n");
    await clickPart("V1");
    await click('[data-wave="SQUARE"]');
    await success();
    await click("#steady-button");
    assert.equal(await ev(`document.getElementById("steady-button").getAttribute("aria-pressed")`), "true");
    await success();
    assert.match(await ev(`document.getElementById("result-summary").textContent`), /^정상상태 · V1 상승 = 0 s \(시작 후 1 ms\)/);
    const result = (await state()).result;
    assert.equal(result.xValues[0], 0, "t = 0 at the trigger");
    const lines = await ev(`[...document.querySelectorAll("#measure-summary .measure-line")].map((e) => e.textContent)`);
    assert.equal(lines.length, 2, "one line per probe");
    const vpp = Number(lines[0].match(/Vpp ([\d.]+) V/)[1]);
    assert.ok(Math.abs(vpp - 5 * Math.tanh(1e-3 / 4 / 70.5e-6)) < 0.02, `V(C) Vpp ${vpp} ≈ 5·tanh(T/4τ) = 4.996 V`);
    assert.match(lines[0], /주파수 1(\.000)? kHz|주파수 1000 Hz/);
  });

  test("AC: the sine's amplitude is the AC input; with no sine the first source is 1 V and the status says so", async () => {
    await navigate("/?example=rc-lowpass");
    await click('[data-tool="select"]');
    await clickPart("V1");
    assert.equal(await ev(`document.querySelector(${JSON.stringify(field("gen:vpp"))}).value`), "2", "the example's 1 V AC input is a 2 Vpp sine");
    await enter("gen:vpp", "4");
    await success();
    const result = (await state()).result;
    const node = result.topology.nodeIdByPin["V1:0"];
    const v = result.points[0].nodeVoltages[node];
    assert.ok(Math.abs(Math.hypot(v.re, v.im) - 2) < 1e-9, "the AC source node is 2 V peak");
    await click('[data-wave="DC"]');
    await success();
    assert.match(await ev(`document.getElementById("engine-status").textContent`), /사인 전원이 없어 V1을\(를\) 1 입력으로 계산/);
  });

  test("390 px phone: the generator buttons and fields are finger-sized, 16 px text, nothing overflows", async () => {
    await navigate("/?example=rc-charge", { width: 390, height: 844, mobile: true });
    await click('[data-tool="select"]');
    await clickPart("V1");
    await click('.view-tabs [data-view="inspector"]');
    await until(`document.querySelector('[data-wave="SIN"]')?.offsetParent`, "the generator buttons");
    const sizes = await ev(`[...document.querySelectorAll('#inspector-content [data-wave], #inspector-content input')].filter((e) => e.offsetParent).map((e) => { const r = e.getBoundingClientRect(); return { h: r.height, right: r.right, font: parseFloat(getComputedStyle(e).fontSize), input: e.tagName === "INPUT" }; })`);
    assert.ok(sizes.length >= 5);
    for (const size of sizes) {
      assert.ok(size.h >= 44, `44 px tall (${JSON.stringify(size)})`);
      assert.ok(size.right <= 390, "inside the screen");
      if (size.input) assert.ok(size.font >= 16, "16 px text");
    }
    assert.equal(await ev(`document.documentElement.scrollWidth <= innerWidth + 1`), true);
  });
});
