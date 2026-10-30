// The waveform's time axis follows the run, in a real (headless) browser: a 3 ms run fills the ten divisions (300 µs/div, no blank 40 %),
// and after a manual zoom a run over a longer time comes back to the whole run instead of showing the old window.
// Run with `node --test tests/browser/scope-fit.test.mjs`.
import { describe, test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { L, ev, until, settle, navigate, click, problems, startServer, startBrowser, stopAll, assertNoProblems, resetProblems } from "./harness.mjs";

const xAxis = () => ev(`${L}.getState().scope.x`);
const close = (actual, expected, what) => assert.ok(Math.abs(actual - expected) <= 1e-9 * Math.abs(expected) + 1e-15, `${what}: ${actual} vs ${expected}`);
function dropLinuxManifestIcon() {
  if (process.platform !== "linux") return;
  for (let i = problems.length - 1; i >= 0; i -= 1) if (/Error while trying to use the following icon from the Manifest/.test(problems[i])) problems.splice(i, 1);
}
async function setEnd(value) {
  if (!(await ev(`document.getElementById("advanced-analysis").open`))) await click("#advanced-analysis summary");
  await ev(`(() => { const e = document.querySelector('#analysis-settings [data-setting="end"]'); e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event("input", { bubbles: true })); e.dispatchEvent(new Event("change", { bubbles: true })); e.blur(); return true; })()`);
  await settle();
}
async function run() {
  await click("#run-button");
  await until(`${L}.getState().runState.status === "success"`, "the run");
  await settle();
}

describe("waveform time axis", { timeout: 300000 }, () => {
  before(async () => { await startServer(); await startBrowser(); });
  beforeEach(() => resetProblems());
  afterEach(async () => { dropLinuxManifestIcon(); await assertNoProblems("console/network"); });
  after(async () => { await stopAll(); });

  test("a run fills the ten divisions, and a longer run after a manual zoom shows the whole longer run", async () => {
    await navigate("/?example=rlc");
    await setEnd("3m");
    await run();
    let x = await xAxis();
    close(x.minimum, 0, "start"); close(x.maximum, 3e-3, "end of the run = right edge"); close(x.division, 3e-4, "300 µs/div");
    // A manual zoom on the time axis …
    await click('[data-scale-axis="x"][data-scale-step="-1"]');
    x = await xAxis();
    assert.equal(x.automatic, false);
    assert.ok(x.maximum - x.minimum < 3e-3, "zoomed in");
    // … then a run over 6 ms: the axis comes back to the whole run.
    await setEnd("6m");
    await run();
    x = await xAxis();
    close(x.maximum, 6e-3, "the whole longer run"); assert.equal(x.automatic, true);
    // The same range again (a value tweak) keeps a zoom the student made.
    await click('[data-scale-axis="x"][data-scale-step="-1"]');
    const zoomed = await xAxis();
    await run();
    assert.deepEqual(await xAxis(), zoomed, "same range: the zoom stays");
  });

  test("직렬 RLC 응답: a wider time/div (+) past the end of the run lengthens the run, so the waveform fills the wider window", async () => {
    await navigate("/?example=rlc");
    await run();
    const before = await xAxis(), end = before.maximum;
    assert.ok(Math.abs(end - (await ev(`${L}.getState().result.xValues.at(-1)`))) < end * 1e-9, "the axis ends at the run's end");
    await click('[data-scale-axis="x"][data-scale-step="1"]');
    await until(`${L}.getState().runState.status === "success" && ${L}.getState().result.xValues.at(-1) > ${end} * 1.5`, "the longer run");
    await settle();
    const x = await xAxis(), last = await ev(`${L}.getState().result.xValues.at(-1)`);
    assert.ok(x.division > before.division, "a wider time/div");
    close(x.minimum, 0, "the window still starts at 0");
    assert.ok(Math.abs(last - x.maximum) <= x.division * 1e-3, `the run reaches the right edge (${last} vs ${x.maximum})`);
    assert.equal(x.automatic, false, "the chosen time/div stays after the longer run");
    assert.ok(Number(await ev(`${L}.getState().result.xValues.length`)) <= 20001);
    // One undo step brings the old end time back.
    await click("#undo-button");
    assert.notEqual((await ev(`${L}.getState().settings.end`)), String(x.maximum));
  });
});
