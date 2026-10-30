// 전기회로2 Ch.14 (주파수응답) in a real (headless) browser: the chapter row with six chapters, the Bode tool (typing H, a bad
// expression keeps the last figure, the log ω slider moves the cursor reading), resonance (segment, SI prefixes), every Ch.14
// example on phones 390 and 360 px wide without horizontal overflow. Run with `node --test tests/browser/course-ch14.test.mjs`.
import { describe, test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { L, ev, until, settle, navigate, click, problems, startServer, startBrowser, stopAll, assertNoProblems, resetProblems } from "./harness.mjs";

const CC_HOST = "#circuit-course-host";
const panel = (id) => `${CC_HOST} [data-circuit-course-tool-panel=${id}]`;
const tool = (id) => ev(`${L}.getCircuitCourseState().courseTools[${JSON.stringify(id)}]`);
const TOOLS = ["bode", "resonance", "filters", "scaling"];
/** Set a field's text (or a slider's position) and fire input the way typing does. */
const change = (selector, value) => ev(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.value = ${JSON.stringify(String(value))};
  e.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
const overflow = () => ev(`document.documentElement.scrollWidth <= innerWidth + 1 && document.querySelector(".circuit-course").scrollWidth <= innerWidth + 1`);
function dropLinuxManifestIcon() {
  if (process.platform !== "linux") return;
  for (let i = problems.length - 1; i >= 0; i -= 1) if (/Error while trying to use the following icon from the Manifest/.test(problems[i])) problems.splice(i, 1);
}
async function openCourse(view) {
  await navigate("/", view);
  await click("#circuit-course-workspace-tab");
  await until(`${L}.getCircuitCourseState()?.active === true`, "the circuit course");
  await settle();
}
async function openTool(id) {
  await click(`${CC_HOST} [data-circuit-course-chapter="ch14"]`);
  await click(`${CC_HOST} [data-circuit-course-tool="${id}"]`);
  await until(`${L}.getCircuitCourseState().tool === ${JSON.stringify(id)}`, id);
}

describe("circuit course Ch.14", { timeout: 300000 }, () => {
  before(async () => { await startServer(); await startBrowser(); });
  beforeEach(() => resetProblems());
  afterEach(async () => { dropLinuxManifestIcon(); await assertNoProblems("console/network"); });
  after(async () => { await stopAll(); });

  test("Bode tool: typed H redraws at once, a bad expression keeps the last figure with a reason, the log slider moves the cursor", async () => {
    await openCourse();
    await openTool("bode");
    assert.equal(await ev(`document.querySelectorAll("${panel("bode")} [data-cc-freq] svg").length`), 1, "one figure");
    await change(`${panel("bode")} [data-cc-key="expression"]`, "100jω/((1+jω)(1+jω/5)(1+jω/20))");
    await settle();
    let t = await tool("bode");
    assert.equal(t.status, "valid");
    assert.match(await ev(`document.querySelector("${panel("bode")} [data-cc-read]").textContent`), /100·jω \/ \[\(1 \+ jω\)\(1 \+ jω\/5\)\(1 \+ jω\/20\)\]/);
    const figure = await ev(`document.querySelector("${panel("bode")} [data-cc-freq]").outerHTML`);

    await change(`${panel("bode")} [data-cc-key="expression"]`, "(s+1");
    await settle();
    assert.match(await ev(`document.querySelector('${panel("bode")} [data-cc-error="expression"]').textContent`), /괄호/);
    assert.equal(await ev(`document.querySelector("${panel("bode")} [data-cc-freq]").outerHTML`), figure, "the last valid figure stays");
    await change(`${panel("bode")} [data-cc-key="expression"]`, "100jω/((1+jω)(1+jω/5)(1+jω/20))");
    await settle();

    // The ω slider is logarithmic: position 1 = 10 rad/s.
    await change(`${panel("bode")} [data-cc-slider="cursor"]`, 1);
    await settle();
    t = await tool("bode");
    assert.equal(t.values.cursor, 10);
    assert.equal(t.drafts.cursor, "10", "the number field follows the slider");
    assert.ok(Math.abs(t.outputs.exactDb - 31.998) < 0.01, "|H(j10)| " + t.outputs.exactDb);
    assert.equal(await ev(`document.querySelectorAll("${panel("bode")} [data-cc-cursor]").length`), 2, "cursor line in both panels");
    // SI prefixes in the ω field.
    await change(`${panel("bode")} [data-cc-key="cursor"]`, "0.2k");
    await settle();
    assert.equal((await tool("bode")).values.cursor, 200);
  });

  test("resonance tool: the parallel segment and SI-prefixed values update the result; example 14.7 passes", async () => {
    await openCourse();
    await openTool("resonance");
    await ev(`document.querySelector('${panel("resonance")} [data-circuit-course-examples-fold]').open = true`);
    await click(`${panel("resonance")} [data-cc-preset="0"]`);
    assert.match(await ev(`document.querySelector("${panel("resonance")} [data-circuit-course-verification] h3").textContent`), /모두 일치/);
    assert.equal(await ev(`${L}.getCircuitCourseState().basis`), "peak", "a peak example switches the course to peak");
    await change(`${panel("resonance")} [data-cc-key="C"]`, "0.1u");
    await settle();
    let t = await tool("resonance");
    assert.equal(t.values.C, 1e-7);
    assert.ok(Math.abs(t.outputs.w0 - 1e5) < 1e-6, "ω0 = 1/√(1 mH · 0.1 µF)");
    await click(`${panel("resonance")} [data-cc-segment="circuit"][data-cc-choice="parallel"]`);
    t = await tool("resonance");
    assert.ok(Math.abs(t.outputs.B - 1 / (2 * 1e-7)) < 1e-3, "parallel B = 1/(RC)");
    assert.match(await ev(`document.querySelector('${panel("resonance")} [data-cc-field="source"] [data-cc-label]').textContent`), /전원 전류 Im/);
  });

  for (const view of [{ width: 390, height: 844, mobile: true }, { width: 360, height: 780, mobile: true }]) {
    test(`phone ${view.width}px: six chapter buttons on one line with no clipped text, every Ch.14 example passes without horizontal overflow`, async () => {
      await openCourse(view);
      const chapters = await ev(`[...document.querySelectorAll("${CC_HOST} [data-circuit-course-chapter]")].map((b) => ({ id: b.dataset.circuitCourseChapter, top: Math.round(b.getBoundingClientRect().top),
        h: b.getBoundingClientRect().height, fits: b.scrollWidth <= b.clientWidth }))`);
      assert.deepEqual(chapters.map((c) => c.id), ["ch9-10", "ch11", "ch12", "ch13", "ch14", "mine"]);
      assert.equal(new Set(chapters.map((c) => c.top)).size, 1, "one line");
      for (const c of chapters) { assert.ok(c.fits, `${c.id}: text fits its button`); assert.ok(c.h >= 44, `${c.id}: ${c.h} px tall`); }
      for (const id of TOOLS) {
        await openTool(id);
        const sizes = await ev(`[...document.querySelectorAll('${panel(id)} input[type="text"], ${panel(id)} select')].filter((e) => e.offsetParent).map((e) => [parseFloat(getComputedStyle(e).fontSize), e.getBoundingClientRect().height])`);
        for (const [font, height] of sizes) { assert.ok(font >= 16, `${id}: input text ${font}px`); assert.ok(height >= 44, `${id}: input ${height}px tall`); }
        const sliders = await ev(`[...document.querySelectorAll('${panel(id)} input[type="range"]')].filter((e) => e.offsetParent).map((e) => e.getBoundingClientRect().height)`);
        for (const h of sliders) assert.ok(h >= 44, `${id}: slider ${h}px tall`);
        const count = await ev(`document.querySelectorAll("${panel(id)} [data-cc-preset]").length`);
        for (let i = 0; i < count; i += 1) {
          const shown = await ev(`(() => { document.querySelector('${panel(id)} [data-cc-preset="${i}"]').click();
            const box = document.querySelector("${panel(id)} [data-circuit-course-verification]"); return { fails: (box?.textContent.match(/FAIL/g) ?? []).length, passes: (box?.textContent.match(/PASS/g) ?? []).length }; })()`);
          await settle();
          assert.equal(shown.fails, 0, `${id}#${i}: no FAIL`);
          assert.ok(shown.passes > 0, `${id}#${i}: checked`);
          assert.equal(await overflow(), true, `${id}#${i}: no horizontal overflow`);
        }
      }
    });
  }
});
