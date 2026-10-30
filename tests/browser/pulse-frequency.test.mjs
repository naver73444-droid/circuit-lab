// PULSE timing typed as 주파수·듀티, in a real (headless) browser: the series RLC example's V1 shows 250 Hz · 50 %; typing 1k keeps
// 50 % (period 1 m, width 500 u) in one undo step; a duty of 20 sets the width; 150 % is refused and changes nothing; a frequency left
// as a draft is applied by the run like any other field; nothing named 주파수·듀티 is stored on the part; the fields fit a 390 px phone.
// Run with `node --test tests/browser/pulse-frequency.test.mjs`.
import { describe, test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { L, ev, until, navigate, click, clickPart, press, typeInto, component, state, problems, startServer, startBrowser, stopAll, assertNoProblems, resetProblems } from "./harness.mjs";

const field = (key) => `#inspector-content [data-prop="${key}"]`;
const shown = (key) => ev(`document.querySelector(${JSON.stringify(field(key))})?.value ?? null`);
const timing = async () => { const p = (await component("V1")).props; return { period: p.pulsePeriod, width: p.pulseWidth, stored: ["pulseFrequency", "pulseDuty"].filter((key) => key in p) }; };
async function enter(key, text) { await typeInto(field(key), text); await press("Enter", "Enter", 13); }
function dropLinuxManifestIcon() {
  if (process.platform !== "linux") return;
  for (let i = problems.length - 1; i >= 0; i -= 1) if (/Error while trying to use the following icon from the Manifest/.test(problems[i])) problems.splice(i, 1);
}

describe("PULSE frequency and duty", { timeout: 300000 }, () => {
  before(async () => { await startServer(); await startBrowser(); });
  beforeEach(() => resetProblems());
  afterEach(async () => { dropLinuxManifestIcon(); await assertNoProblems("console/network"); });
  after(async () => { await stopAll(); });

  test("desktop: 주파수 and 듀티 edit period and width, keep the duty, refuse 150 %, and undo in one step", async () => {
    await navigate("/?example=rlc");
    await click('[data-tool="select"]');
    await clickPart("V1");
    assert.equal(await shown("pulseFrequency"), "250");
    assert.equal(await shown("pulseDuty"), "50");

    const depth = (await state()).historyDepth;
    await enter("pulseFrequency", "1k");
    assert.deepEqual(await timing(), { period: "1m", width: "500u", stored: [] }, "1 kHz at 50 %, nothing extra stored");
    assert.equal((await state()).historyDepth, depth + 1, "one undo step");
    assert.equal(await shown("pulsePeriod"), "1m", "the period field follows");
    assert.equal(await shown("pulseWidth"), "500u");

    await enter("pulseDuty", "20");
    assert.deepEqual(await timing(), { period: "1m", width: "200u", stored: [] });
    assert.equal(await shown("pulseFrequency"), "1k");

    await enter("pulseDuty", "150");
    assert.deepEqual(await timing(), { period: "1m", width: "200u", stored: [] }, "150 % changes nothing");
    assert.equal(await ev(`document.querySelector(${JSON.stringify(field("pulseDuty"))}).classList.contains("input-invalid")`), true);
    assert.match(await ev(`document.getElementById("engine-status").textContent`), /듀티는 0과 100 사이/);
    await enter("pulseDuty", "20");

    await click("#undo-button");
    await click("#undo-button");
    assert.deepEqual(await timing(), { period: "4m", width: "2m", stored: [] }, "two edits, two undo steps");
  });

  test("a frequency left as a draft is applied by the run; 390 px phone fits the fields", async () => {
    await navigate("/?example=rlc", { width: 390, height: 844, mobile: true });
    await ev(`${L}.getState()`);
    await click('[data-tool="select"]');
    await clickPart("V1");
    await click('.view-tabs [data-view="inspector"]').catch(() => {});
    await until(`document.querySelector(${JSON.stringify(field("pulseFrequency"))})?.offsetParent`, "the frequency field");
    assert.equal(await ev(`(() => { const e = document.querySelector(${JSON.stringify(field("pulseFrequency"))}); const r = e.getBoundingClientRect(); return r.right <= innerWidth && parseFloat(getComputedStyle(e).fontSize) >= 16; })()`), true, "inside the screen, 16 px text");
    await ev(`(() => { const e = document.querySelector(${JSON.stringify(field("pulseFrequency"))}); e.value = "2k"; e.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    assert.ok((await state()).drafts.some((d) => d.property === "pulseFrequency"), "a draft while typing");
    await ev(`${L}.runAnalysis()`);
    await until(`${L}.getState().runState.status === "success"`, "the run");
    assert.deepEqual(await timing(), { period: "500u", width: "250u", stored: [] });
    assert.deepEqual((await state()).drafts, []);
    assert.equal(await ev(`document.documentElement.scrollWidth <= innerWidth + 1`), true, "no sideways overflow");
  });
});
