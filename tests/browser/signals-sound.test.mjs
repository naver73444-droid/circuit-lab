// Sound-spectrum lesson in a real (headless) browser: theory table before any sound, loopback measurement of the square,
// triangle and pulse harmonics, sound stops when the lesson or the workspace is left, the microphone path with the browser's
// fake capture device, and the 3×3 phone tab grid. Run with `node --test tests/browser/signals-sound.test.mjs`.
// The switches let the headless browser start audio without a gesture and give it a fake microphone (a ~400 Hz beep).
import { describe, test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  L, ctx, ev, until, settle, navigate, sleep, problems,
  startServer, startBrowser, stopAll, leftoverProcessIds, isAlive, assertNoProblems, resetProblems,
} from "./harness.mjs";

const sg = () => ev(`${L}.getSignalsCourseState()`);
const change = (selector, value) => ev(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event("input", { bubbles: true })); e.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
const clickEl = async (selector) => { await ev(`document.querySelector(${JSON.stringify(selector)}).click()`); await settle(); };
const soundState = () => ev(`(() => { const r = document.querySelector("[data-signals-sound]"); return r ? { mode: r.dataset.signalsSound, context: r.dataset.signalsSoundContext, peak: r.dataset.signalsSoundPeakHz ?? "" } : null; })()`);
const cell = (k, kind) => ev(`document.querySelector('[data-signals-sound-table] tr[data-k="${k}"] td[data-${kind}-db]')?.dataset.${kind === "theory" ? "theoryDb" : "measuredDb"} ?? null`);
const measured = async (k) => { const v = await cell(k, "measured"); return v === "noise" || v === "" || v === null ? v : Number(v); };
// Wait until the running measurement has settled on the current tone (the analyser smooths over a few frames).
async function settledMeasurement(label) {
  await until(`document.querySelector("[data-signals-sound]")?.dataset.signalsSound === "running" && document.querySelector('[data-signals-sound-table] tr[data-k="1"] td[data-measured-db]').dataset.measuredDb === "0"`, label, 15000);
  await sleep(900);
}
function dropLinuxManifestIcon() {
  // Headless Chromium on Linux logs that it cannot use the SVG manifest icon; Edge on Windows does not. Only that message is dropped.
  if (process.platform !== "linux") return;
  for (let i = problems.length - 1; i >= 0; i -= 1) if (/Error while trying to use the following icon from the Manifest/.test(problems[i])) problems.splice(i, 1);
}
async function openSound({ mobile = false } = {}) {
  await ctx.cdp.send("Emulation.setTouchEmulationEnabled", { enabled: mobile, maxTouchPoints: mobile ? 5 : 1 });
  await navigate("/?workspace=signals", mobile ? { width: 390, height: 844, mobile: true } : {});
  await until(`${L}.getSignalsCourseState()?.active === true`, "the signals workspace");
  await clickEl('[data-signals-lesson="sound"]');
  await until(`${L}.getSignalsCourseState().lessonId === "sound" && Boolean(document.querySelector("[data-signals-sound]"))`, "the sound lesson");
}

describe("signals: sound-spectrum lesson", { timeout: 300000 }, () => {
  before(async () => {
    await startServer();
    await startBrowser({ args: ["--autoplay-policy=no-user-gesture-required", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
  });
  beforeEach(() => resetProblems());
  afterEach(async () => { dropLinuxManifestIcon(); await assertNoProblems("console/network"); });
  after(async () => {
    const startedPids = [ctx.edge?.pid, ctx.server?.pid].filter(Boolean);
    const stopped = await stopAll();
    for (const pid of new Set([...startedPids, ...stopped])) assert.equal(isAlive(pid), false, `process ${pid} should have been stopped`);
    assert.deepEqual(leftoverProcessIds(), [], "no process may still carry the throw-away browser profile");
  });

  test("loopback: theory before sound, measured square / triangle / pulse harmonics, and the sound stops on leaving", async () => {
    await openSound();
    const s = await sg();
    assert.equal(s.family, "square");
    assert.equal(s.params.input, 0, "loopback by default");
    assert.deepEqual(await soundState(), { mode: "off", context: "none", peak: "" }, "no audio before the first press");
    assert.equal(Number(await cell(3, "theory")).toFixed(2), "-9.54");
    assert.equal(await cell(2, "theory"), "none");
    assert.equal(await measured(3), "", "nothing measured yet");

    await clickEl("[data-signals-sound-toggle]");
    await settledMeasurement("the square measurement");
    const k3 = await measured(3);
    assert.ok(Math.abs(k3 - -9.54) <= 1.5, `square k=3 ≈ −9.5 dB (got ${k3})`);
    const k5 = await measured(5);
    assert.ok(Math.abs(k5 - -13.98) <= 1.5, `square k=5 ≈ −14 dB (got ${k5})`);
    for (const k of [2, 4]) {
      const v = await measured(k);
      assert.ok(v === "noise" || v < -40, `square k=${k} is missing (got ${v})`);
    }
    assert.equal(await ev(`document.querySelector("[data-signals-sound-toggle]").getAttribute("aria-pressed")`), "true");

    // While it sounds, switching the example changes the tone at once.
    await change("[data-signals-family]", "triangle");
    await settledMeasurement("the triangle measurement");
    const t3 = await measured(3);
    assert.ok(Math.abs(t3 - -19.08) <= 1.5, `triangle k=3 ≈ −19 dB (got ${t3})`);
    await change("[data-signals-family]", "pulse");
    await change('[data-signals-param="d"]', "0.25");
    await settledMeasurement("the pulse measurement");
    const p4 = await measured(4);
    assert.ok(p4 === "noise" || p4 < -35, `pulse d=0.25 has no 4th harmonic (got ${p4})`);
    const p2 = await measured(2);
    assert.ok(Math.abs(p2 - 20 * Math.log10(Math.abs(Math.sin(Math.PI * 0.5) / (Math.PI * 0.5)) / Math.abs(Math.sin(Math.PI * 0.25) / (Math.PI * 0.25)))) <= 1.5, `pulse k=2 (got ${p2})`);

    // Leaving the lesson stops the sound and lets the audio device sleep.
    await clickEl('[data-signals-lesson="series"]');
    await until(`document.querySelector("[data-signals-sound]").dataset.signalsSound === "off"`, "the sound to stop");
    await until(`document.querySelector("[data-signals-sound]").dataset.signalsSoundContext === "suspended"`, "the audio context to suspend", 5000);
    // Back again: still off (never restarts by itself), the last measurement is kept in the table.
    await clickEl('[data-signals-lesson="sound"]');
    assert.equal((await soundState()).mode, "off");
    assert.equal(await ev(`document.querySelector("[data-signals-sound-toggle]").textContent`), "소리 켜기");
    assert.notEqual(await measured(1), "", "the last measured rows stay until something changes");
    // Leaving the workspace stops a running sound too.
    await clickEl("[data-signals-sound-toggle]");
    await until(`document.querySelector("[data-signals-sound]").dataset.signalsSound === "running"`, "running again");
    await ev(`document.querySelector('[data-workspace-tab="circuit"]').click()`);
    await until(`document.querySelector("[data-signals-sound]").dataset.signalsSound === "off"`, "the sound to stop with the workspace");
  });

  test("microphone only: the fake capture device's beep shows as the strongest component; no table", async () => {
    await openSound();
    await change('[data-signals-param="input"]', "2");
    await settle();
    assert.match(await ev(`document.querySelector("[data-signals-read]").textContent`), /마이크만/);
    await clickEl("[data-signals-sound-toggle]");
    await until(`document.querySelector("[data-signals-sound]").dataset.signalsSound === "running" && Number(document.querySelector("[data-signals-sound]").dataset.signalsSoundPeakHz) > 0`, "a microphone peak", 15000);
    const peak = Number((await soundState()).peak);
    assert.ok(peak > 300 && peak < 500, `the fake device beeps near 400 Hz (got ${peak})`);
    assert.equal(await ev(`document.querySelector("[data-signals-sound-table]").hidden`), true, "no harmonic table without a test tone");
    await clickEl("[data-signals-sound-toggle]");
    await until(`document.querySelector("[data-signals-sound]").dataset.signalsSound === "off"`, "stopped");
    await change('[data-signals-param="input"]', "0");
  });

  test("phone 390 px: nine tabs in a 3×3 grid, a 44 px sound button, and no sideways scroll", async () => {
    await openSound({ mobile: true });
    const rows = await ev(`(() => { const tops = [...document.querySelectorAll(".sg-tabs button")].map((b) => Math.round(b.getBoundingClientRect().top)); return [...new Set(tops)].map((t) => tops.filter((x) => x === t).length); })()`);
    assert.deepEqual(rows, [3, 3, 3], "3 × 3 tabs");
    const button = await ev(`document.querySelector("[data-signals-sound-toggle]").getBoundingClientRect().height`);
    assert.ok(button >= 43.5, `sound button height ${button}`);
    assert.equal(await ev(`document.documentElement.scrollWidth <= innerWidth`), true, "no sideways scroll");
    const wide = await ev(`[...document.querySelectorAll(".sg-tabs button")].filter((b) => b.scrollWidth > b.clientWidth + 1).map((b) => b.textContent)`);
    assert.deepEqual(wide, [], "tab labels fit");
  });
});
