// V probe on a part's body = the voltage across that part, in a real (headless) browser: a click (mouse) and a tap (iPad) on R1 of the
// divider add V(R1) = 5 V with + / − beside the leads; a tap near a pin still probes that node; undo removes it.
// Run with `node --test tests/browser/across-probe.test.mjs`.
import { describe, test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { L, ctx, ev, until, settle, navigate, click, center, clickAt, problems, startServer, startBrowser, stopAll, assertNoProblems, resetProblems } from "./harness.mjs";

const state = () => ev(`${L}.getState()`);
const chip = (label) => ev(`[...document.querySelectorAll("#probe-list [data-probe-key]")].map((e) => e.textContent.trim()).find((t) => t.startsWith(${JSON.stringify(label)})) ?? null`);
function dropLinuxManifestIcon() {
  if (process.platform !== "linux") return;
  for (let i = problems.length - 1; i >= 0; i -= 1) if (/Error while trying to use the following icon from the Manifest/.test(problems[i])) problems.splice(i, 1);
}
async function tap(x, y) {
  for (const type of ["touchStart", "touchEnd"]) await ctx.cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
  await settle();
}

describe("voltage across a part", { timeout: 300000 }, () => {
  before(async () => { await startServer(); await startBrowser(); });
  beforeEach(() => resetProblems());
  afterEach(async () => { dropLinuxManifestIcon(); await assertNoProblems("console/network"); await ctx.cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false, maxTouchPoints: 1 }); });
  after(async () => { await stopAll(); });

  test("mouse: V probe on R1's body adds V(R1) = 5 V (+ at pin 1); undo takes it away", async () => {
    await navigate("/?example=divider");
    await click('[data-tool="voltage-probe"]');
    const before = (await state()).probes.length;
    const p = await center('.component[data-id="R1"] .component-hit', { allowCovered: true });
    await clickAt(p.x, p.y);
    const probes = (await state()).probes;
    assert.equal(probes.length, before + 1);
    assert.deepEqual(probes.at(-1).key, "V:R1:across");
    assert.equal(probes.at(-1).label, "V(R1)");
    assert.equal(await ev(`document.querySelectorAll('.component[data-id="R1"] .across-mark text').length`), 2, "+ and − beside the leads");
    await click("#run-button");
    await until(`${L}.getState().runState.status === "success"`, "the DC run");
    assert.match(await chip("V(R1)"), /^V\(R1\)\s*5 V/);
    await click("#undo-button");
    assert.equal((await state()).probes.length, before, "one undo step");
  });

  test("iPad: a tap on the middle of R2 adds V(R2); a tap on a pin still adds that node's voltage", async () => {
    await ctx.cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await navigate("/?example=divider", { width: 1180, height: 740, mobile: true });
    await click('[data-tool="voltage-probe"]');
    const body = await center('.component[data-id="R2"] .component-hit', { allowCovered: true });
    await tap(body.x, body.y);
    assert.ok((await state()).probes.some((probe) => probe.key === "V:R2:across"), "across probe from a tap on the body");
    const pin = await center('.component[data-id="R1"] .pin[data-pin="0"]', { allowCovered: true });
    await tap(pin.x, pin.y);
    assert.ok((await state()).probes.some((probe) => probe.key === "V:R1:0"), "node probe from a tap on the pin");
  });
});
