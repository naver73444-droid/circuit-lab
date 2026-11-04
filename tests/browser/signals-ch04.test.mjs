// 신호 Ch04 4·5절 추가분을 실제(헤드리스) 브라우저에서 확인한다: 푸리에 변환의 세 성질 증명 보기(증명 줄·a=0 정리·적분의 δ 면적과 축),
// 푸리에 급수의 TFS 막대와 계수 표(복습 값·행 숨김·부호), LTI의 2차 계단응답(복습 p9 초기값 독립성, Ex 2.19 시간 표식),
// 탭 기억·재적재·다시 붙이기, 폰 390·360 폭 배치, SVG 노드 수 불변과 소리 수명주기.
// 실행: `node --test tests/browser/signals-ch04.test.mjs` (다른 브라우저 시험 파일과 동시에 돌리지 않는다).
import { describe, test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  L, ctx, ev, until, settle, navigate, sleep, press, problems,
  startServer, startBrowser, stopAll, leftoverProcessIds, isAlive, assertNoProblems, resetProblems,
} from "./harness.mjs";

const sg = () => ev(`${L}.getSignalsCourseState()`);
const change = (selector, value) => ev(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.value = ${JSON.stringify(String(value))}; e.dispatchEvent(new Event("input", { bubbles: true })); e.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
const setParam = async (key, value) => { await change(`[data-signals-param="${key}"]`, value); await settle(); };
const setFamily = async (family) => { await change("[data-signals-family]", family); await settle(); };
const clickEl = async (selector) => { await ev(`document.querySelector(${JSON.stringify(selector)}).click()`); await settle(); };
const text = (selector) => ev(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`);
const shown = (selector) => ev(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); return Boolean(e) && !e.hidden && e.getClientRects().length > 0; })()`);
const mouse = (type, x, y, buttons = 0) => ctx.cdp.send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left", buttons, clickCount: type === "mouseMoved" ? 0 : 1 });
const touch = (type, touchPoints) => ctx.cdp.send("Input.dispatchTouchEvent", { type, touchPoints });
const flushSessions = () => ev(`new Promise((done) => setTimeout(done, 400))`); // the tab memory saves 250 ms after the last change
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b} (±${tol})`);

// The plot of the lesson on screen (other lessons keep their hidden SVGs).
const SVG = `[...document.querySelectorAll("#signals-workspace .sg-stage svg")].find((s) => s.getClientRects().length > 0)`;
const PANE = (i) => `${SVG}.querySelectorAll(".sg-pane")[${i}]`;
const visibleIn = (i, selector) => `[...${PANE(i)}.querySelectorAll(${JSON.stringify(selector)})].filter((e) => e.getAttribute("visibility") !== "hidden")`;
const pathsD = (i, selector = "path.ln") => ev(`${visibleIn(i, selector)}.map((p) => p.getAttribute("d") ?? "").filter(Boolean)`);
const svgSnapshot = () => ev(`[...${SVG}.querySelectorAll("path, line, circle")].map((e) => [e.getAttribute("d"), e.getAttribute("x1"), e.getAttribute("y1"), e.getAttribute("x2"), e.getAttribute("y2"), e.getAttribute("cx"), e.getAttribute("cy"), e.getAttribute("visibility")].join(",")).join("|")`);
const svgNodeCount = () => ev(`${SVG}.querySelectorAll("*").length`);
const paneBox = (i) => ev(`(() => { const r = ${SVG}.getBoundingClientRect(); const c = ${PANE(i)}.querySelector("clipPath rect"); const n = (k) => Number(c.getAttribute(k)); return { left: r.left + n("x"), top: r.top + n("y"), width: n("width"), height: n("height") }; })()`);
const formulaLines = () => ev(`[...document.querySelectorAll("[data-signals-formula] .course-math-line math")].map((m) => m.getAttribute("aria-label"))`);
const formulaFallbacks = () => ev(`document.querySelectorAll("[data-signals-formula] .course-math-fallback").length`);
const openFormula = async () => { await ev(`document.querySelector("[data-signals-formula-box]").open = true`); await settle(); await settle(); };
const live = () => text("[data-signals-live]");
const readLine = () => text("[data-signals-read]");
const cellValue = (k, key) => ev(`Number(document.querySelector('[data-signals-coefficient-row="${k}"] td[data-key="${key}"]').dataset.value)`);
const cellText = (k, key) => ev(`document.querySelector('[data-signals-coefficient-row="${k}"] td[data-key="${key}"]').textContent`);
const visibleRows = () => ev(`[...document.querySelectorAll("[data-signals-coefficient-row]")].filter((r) => !r.hidden).length`);
const noBadText = async (what) => {
  const blob = await ev(`[document.querySelector("[data-signals-live]")?.textContent, document.querySelector("[data-signals-read]")?.textContent, document.querySelector("[data-signals-formula]")?.textContent, document.querySelector("[data-signals-status]")?.textContent, [...${SVG}.querySelectorAll("*")].map((e) => [...e.attributes].map((a) => a.value).join(" ") + " " + (e.children.length ? "" : e.textContent)).join(" ")].join(" || ")`);
  assert.doesNotMatch(blob, /NaN|undefined|Infinity/, `${what}: no NaN / undefined / Infinity on screen`);
  assert.equal(await text("[data-signals-status]"), "", `${what}: no error status`);
};

async function reload() {
  let off = () => {};
  const loaded = new Promise((done) => { off = ctx.cdp.on((message) => { if (message.method === "Page.loadEventFired") done(); }); });
  try { await ctx.cdp.send("Page.reload", {}); await loaded; } finally { off(); }
  await until(`Boolean(${L}) && document.readyState === "complete"`, "the reloaded app");
  await until(`${L}.getSignalsCourseState()?.active === true`, "the signals workspace after the reload");
  await settle();
}
async function openSignals({ width = 1440, height = 900, mobile = false } = {}) {
  await ctx.cdp.send("Emulation.setTouchEmulationEnabled", { enabled: mobile, maxTouchPoints: mobile ? 5 : 1 });
  await navigate("/?workspace=signals", { width, height, mobile });
  await until(`${L}.getSignalsCourseState()?.active === true`, "the signals workspace");
}
async function openLesson(id) {
  await clickEl(`[data-signals-lesson="${id}"]`);
  await until(`${L}.getSignalsCourseState().lessonId === ${JSON.stringify(id)}`, `the ${id} lesson`);
  // The convolution / series lessons may auto-play; the checks below want a still picture.
  await ev(`(() => { const b = document.querySelector("[data-signals-play]"); if (${L}.getSignalsCourseState().playing && b && b.getClientRects().length) b.click(); return true; })()`);
  await settle();
}
// Headless Chromium on Linux logs that it cannot use the SVG manifest icon; Edge on Windows does not. Only that message is dropped.
function dropLinuxManifestIcon() {
  if (process.platform !== "linux") return;
  for (let i = problems.length - 1; i >= 0; i -= 1) if (/Error while trying to use the following icon from the Manifest/.test(problems[i])) problems.splice(i, 1);
}

describe("signals: Ch04 4·5절 (FT 성질 증명 · 계수 표 · 2차 계단응답)", { timeout: 600000 }, () => {
  before(async () => {
    await startServer();
    await startBrowser({ args: ["--autoplay-policy=no-user-gesture-required"] });
  });
  beforeEach(() => resetProblems());
  afterEach(async () => { dropLinuxManifestIcon(); await assertNoProblems("console/network"); });
  after(async () => {
    const startedPids = [ctx.edge?.pid, ctx.server?.pid].filter(Boolean);
    const stopped = await stopAll();
    for (const pid of new Set([...startedPids, ...stopped])) assert.equal(isAlive(pid), false, `process ${pid} should have been stopped`);
    assert.deepEqual(leftoverProcessIds(), [], "no process may still carry the throw-away browser profile");
  });

  test("FT 세 증명: 증명 줄 1→4→1은 식·설명만 바꾸고 그래프는 그대로, a=0은 건너뛰고 화살표 키로 양쪽 통과", async () => {
    await openSignals();
    await openLesson("fourier");
    const families = await ev(`[...document.querySelectorAll("[data-signals-family] option")].map((o) => o.value)`);
    assert.deepEqual(families.slice(-3), ["proof-scale", "proof-sin", "proof-integral"], "the three proofs close the free example list");
    await openFormula();
    for (const family of ["proof-scale", "proof-sin", "proof-integral"]) {
      await setFamily(family);
      let s = await sg();
      assert.equal(s.family, family);
      assert.equal(s.params.line, 1, `${family}: the proof starts at line 1`);
      assert.equal(await ev(`${SVG}.getAttribute("aria-label")`), "FT 성질 증명 · 시간 신호·실수부·허수부", `${family}: the plot's accessible name`);
      // A proof line may hold two formulas joined by ";" (they show as two formula lines).
      const lines = (await ev(`import("/src/signals-transform-proofs.js").then((m) => m.proofLines(${JSON.stringify(family)}, ${L}.getSignalsCourseState().params).map((l) => l.formula))`))
        .map((line) => line.split(/[;\n]/u).map((part) => part.trim()).filter(Boolean));
      assert.equal(lines.length, 4);
      const picture = await svgSnapshot();
      const counts = [];
      for (const n of [1, 2, 3, 4, 3, 2, 1]) {
        await setParam("line", n);
        s = await sg();
        assert.equal(s.params.line, n);
        const shownLines = await formulaLines();
        for (let i = 0; i < 4; i += 1) {
          const present = i < n ? lines[i].every((part) => shownLines.includes(part)) : !lines[i].some((part) => shownLines.includes(part));
          assert.ok(present, `${family} line=${n}: proof line ${i + 1} ${i < n ? "shown" : "hidden"}`);
        }
        assert.equal(await formulaFallbacks(), 0, `${family} line=${n}: every formula line parses`);
        assert.match(await live(), new RegExp(`줄 ${n}/4`), `${family} line=${n}: the read-out names the step`);
        assert.equal(await svgSnapshot(), picture, `${family} line=${n}: the picture does not change with the proof line`);
        await noBadText(`${family} line=${n}`);
        counts.push(shownLines.length);
      }
      assert.equal(counts[3] - counts[0], lines[1].length + lines[2].length + lines[3].length, `${family}: line 4 shows the formulas of lines 2–4 on top of line 1`);
      assert.deepEqual(counts.slice(4), counts.slice(0, 3).reverse(), `${family}: going back removes the later lines`);
    }

    // a = 0 is left out with a note: coming from below (−2) it becomes +0.25; −2 brings the design example back.
    await setFamily("proof-scale");
    await setParam("a", 0);
    let s = await sg();
    assert.equal(s.params.a, 0.25, "a = 0 from −2 becomes 0.25");
    assert.match(s.note, /a=0은 제외합니다\. 0\.25로 표시합니다\./);
    const sliderA = () => ev(`document.querySelector('[data-signals-param="a"]').value`);
    assert.equal(await sliderA(), "0.25", "the slider shows 0.25");
    await noBadText("a = 0");
    // Real arrow keys on the focused slider (step 0.25) cross 0 both ways instead of sticking at 0.25.
    const arrow = async (key) => { await ev(`document.querySelector('[data-signals-param="a"]').focus()`); await press(key, key, key === "ArrowLeft" ? 37 : 39); };
    await arrow("ArrowLeft");
    s = await sg();
    assert.equal(s.params.a, -0.25, "← from 0.25 skips 0 to −0.25");
    assert.match(s.note, /a=0은 제외합니다\. −0\.25로 표시합니다\./);
    assert.equal(await sliderA(), "-0.25", "the slider shows −0.25");
    await arrow("ArrowLeft");
    assert.equal((await sg()).params.a, -0.5, "← again: −0.5");
    assert.equal((await sg()).note, "", "no note away from 0");
    await arrow("ArrowRight");
    await arrow("ArrowRight");
    assert.equal((await sg()).params.a, 0.25, "→ from −0.25 skips 0 to 0.25");
    assert.equal(await sliderA(), "0.25");
    await noBadText("a across 0");
    await setParam("a", -2);
    s = await sg();
    assert.equal(s.params.a, -2);
    assert.equal(s.note, "", "the note goes away");
    assert.match(await live(), /Y=0\.25\+j0\.25/, "a = −2: Y(2 rad/s) = 1/4 + j/4");
    // The substituted value names its frequency on the chosen axis: ω = 2 rad/s is f = 2/(2π) = 1/π Hz (not f = 2 Hz).
    assert.ok((await formulaLines()).includes("Y(ω=2)=0.25+j0.25"), "ω axis: Y(ω=2)");
    await setParam("axis", 0);
    assert.ok((await formulaLines()).includes("Y(f=1/π)=0.25+j0.25"), "f axis: Y(f=1/π)");
    assert.ok(!(await formulaLines()).some((l) => l.startsWith("Y(2)")), "no bare Y(2)");
    await setParam("axis", 1);
    await setFamily("proof-sin");
    assert.match(await live(), /Y\(\+\)=−j1, Y\(−\)=j1/, "sin: Y(+f₀) = −j, Y(−f₀) = +j");
    assert.match(await live(), /±ω₀ 판독값의 크기가 1/, "ω axis: the note names ±ω₀");
    await setParam("f0", 0.6);
    assert.match(await live(), /크기가 1이 아님/, "f₀ = 0.6: the other lobe adds, so the magnitude is not 1");
  });

  test("적분과 δ: ω축은 면적 π, f축은 면적 1/2, 같은 물리 주파수의 판독값과 시간 결과는 축과 무관", async () => {
    await openSignals();
    await openLesson("fourier");
    await setFamily("proof-integral");
    await setParam("axis", 1);
    const labels = () => ev(`[...${SVG}.querySelectorAll("text")].filter((t) => t.getAttribute("visibility") !== "hidden").map((t) => t.textContent)`);
    let all = await labels();
    assert.ok(all.includes("면적 π"), `ω axis: δ area π (${all.filter((t) => t.startsWith("면적"))})`);
    assert.ok(all.some((t) => t.includes("원점 발산 · 가운데 구간 생략")), "the origin gap is labelled");
    const omegaRead = await live();
    assert.match(omegaRead, /ω=π rad\/s: 정규 부분 −j0\.2026/, "ω = π: −j·2/π²");
    const time = await pathsD(0);
    const im = await pathsD(2);
    assert.ok(im.length >= 1 && im.every((d) => (d.match(/M/g) ?? []).length >= 2), "the Im regular part is cut at the origin (no point drawn there)");
    await setParam("axis", 0);
    all = await labels();
    assert.ok(all.includes("면적 1/2"), `f axis: δ area 1/2 (${all.filter((t) => t.startsWith("면적"))})`);
    assert.ok(!all.includes("면적 π"));
    const fRead = await live();
    assert.match(fRead, /f=0\.5 Hz: 정규 부분 −j0\.2026/, "f = 0.5 Hz reads the same value as ω = π");
    assert.match(fRead, /면적 0\.5/);
    assert.deepEqual(await pathsD(0), time, "the time-domain integral does not change with the axis");
    await noBadText("integral f axis");
  });

  test("TFS 막대·계수 표: 복습 값, DC 예외, k=3의 —, k=4의 음수 a·π, 부호 대조, 행 숨김, T₀는 축만 바꿈", async () => {
    await openSignals();
    await openLesson("series");
    await setFamily("pulse");
    assert.equal(await shown("[data-signals-coefficients]"), false, "no table outside the TFS mode");
    await setParam("spec", 3);
    assert.equal(await shown("[data-signals-coefficients]"), true, "the folded table appears in the TFS mode");
    assert.equal(await ev(`document.querySelector("[data-signals-coefficients]").open`), false, "folded at first");
    assert.equal(await ev(`getComputedStyle(document.querySelector("[data-signals-coefficients] > summary")).display`), "list-item", "the summary stays a list item, so its ▸ marker shows");
    const head = await ev(`[...document.querySelectorAll("[data-signals-coefficients] th")].map((t) => t.textContent)`);
    assert.ok(head.includes("∠cₖ [rad]") && head.includes("φₖ [rad]"), `the phase columns name their unit (${head})`);
    await ev(`document.querySelector("[data-signals-coefficients]").open = true`);
    await settle();
    assert.equal(await shown("[data-signals-coefficient-preset]"), true, "the review button on the centred pulse train");
    await setParam("N", 4);
    await clickEl("[data-signals-coefficient-preset]");
    let s = await sg();
    assert.deepEqual([s.params.N, s.params.T0, s.params.spec], [10, 3, 3], "review p19~21: N = 10, T₀ = 3, TFS");
    near(s.params.D, 1 / 3, 1e-12, "d = 1/3");
    assert.equal(await visibleRows(), 11, "k = 0..10");
    assert.equal(await cellText(0, "b"), "—", "DC row: no b₀");
    assert.equal(await cellText(0, "phi"), "—", "DC row: no φ₀");
    near(await cellValue(0, "a"), 1 / 3, 1e-12, "a₀ = c₀ = 1/3 (not doubled)");
    near(await cellValue(0, "d"), 1 / 3, 1e-12, "d₀ = 1/3");
    near(await cellValue(1, "a"), Math.sqrt(3) / Math.PI, 1e-12, "a₁ = 2c₁ = √3/π");
    assert.equal(await cellText(3, "phase"), "—", "k = 3: c₃ = 0, phase undefined");
    assert.equal(await cellText(3, "phi"), "—");
    assert.ok((await cellValue(4, "a")) < 0, "k = 4: a₄ < 0");
    near(await cellValue(4, "d"), Math.abs(2 * Math.sin((4 * Math.PI) / 3) / (4 * Math.PI)), 1e-12, "k = 4: d₄ = |a₄| > 0");
    assert.equal(await cellText(4, "phi"), "π", "k = 4: φ₄ = π");
    near(await cellValue(4, "phi"), Math.PI, 1e-12, "k = 4: φ₄ = +π");

    // Shifted pulse train (Ex 4.1·4.6): b₁ = 3/(2π) > 0, φ₁ = −π/3. Odd square (Ex 4.4): a₁ = 0, b₁ = 4/π, φ₁ = −π/2.
    await setFamily("pulse0");
    await setParam("spec", 3);
    await setParam("D", 1 / 3);
    await setParam("N", 10);
    assert.equal(await shown("[data-signals-coefficient-preset]"), false, "no review button on other waves");
    near(await cellValue(1, "b"), 3 / (2 * Math.PI), 1e-12, "shifted pulse: b₁ = 3/(2π)");
    near(await cellValue(1, "phi"), -Math.PI / 3, 1e-12, "shifted pulse: φ₁ = −π/3");
    assert.equal(await cellText(1, "phi"), "−π/3");
    await setFamily("odd");
    await setParam("spec", 3);
    near(await cellValue(1, "a"), 0, 1e-12, "odd square: a₁ = 0");
    near(await cellValue(1, "b"), 4 / Math.PI, 1e-12, "odd square: b₁ = 4/π");
    near(await cellValue(1, "phi"), -Math.PI / 2, 1e-12, "odd square: φ₁ = −π/2");
    assert.equal(await cellText(2, "phi"), "—", "odd square: even k has no phase");

    // N hides and restores rows; T₀ changes only the frequency ticks.
    await setFamily("pulse");
    await setParam("spec", 3);
    await setParam("N", 1);
    assert.equal(await visibleRows(), 2, "N = 1: rows k = 0, 1");
    await setParam("N", 25);
    assert.equal(await visibleRows(), 11, "N = 25: the table stops at k = 10");
    const values = await ev(`[...document.querySelectorAll("[data-signals-coefficient-row] td")].map((c) => c.dataset.value).join(",")`);
    const ticks = await ev(`[...${PANE(2)}.querySelectorAll("text.sg-tick")].filter((t) => t.getAttribute("visibility") !== "hidden").map((t) => t.textContent).join(",")`);
    await setParam("T0", 6);
    assert.equal(await ev(`[...document.querySelectorAll("[data-signals-coefficient-row] td")].map((c) => c.dataset.value).join(",")`), values, "T₀ does not change the coefficients");
    assert.notEqual(await ev(`[...${PANE(2)}.querySelectorAll("text.sg-tick")].filter((t) => t.getAttribute("visibility") !== "hidden").map((t) => t.textContent).join(",")`), ticks, "the frequency ticks follow T₀");
    // Bars: a_k (c1) and b_k (c2) both drawn, with no end dots.
    const bars = await ev(`({ a: ${visibleIn(2, "line.st.c1")}.length, b: ${visibleIn(2, "line.st.c2")}.length, dots: ${visibleIn(2, "circle.dt")}.filter((c) => Number(c.getAttribute("r")) > 0).length })`);
    assert.equal(bars.a, 26, "a₀..a₂₅ bars (N > 10 is not cut by the table limit)");
    assert.equal(bars.b, 25, "b₁..b₂₅ bars");
    assert.equal(bars.dots, 0, "TFS bars have no end dots");
    const legend = await ev(`[...document.querySelectorAll("#signals-workspace .sg-legend > span")].filter((e) => e.getClientRects().length > 0).map((e) => e.textContent)`);
    assert.ok(legend.some((t) => t.startsWith("aₖ 막대")) && legend.some((t) => t.startsWith("bₖ 막대")), `the a_k / b_k legend (${legend})`);
    await noBadText("TFS");
  });

  test("복습 p9: 초기값을 바꾸면 y와 계수만 바뀌고 h·yₚ는 그대로, 초기값은 예시별로 기억", async () => {
    await openSignals();
    await openLesson("lti");
    await setFamily("ode2-review");
    let s = await sg();
    assert.deepEqual([s.params.y0, s.params.dy0, s.cursor], [3, 0, 1], "p9: y(0) = 3, y′(0) = 0, t = 1 s");
    assert.match(await live(), /y=2\.0011/, "y(1) = 2.0011");
    await openFormula();
    assert.ok((await formulaLines()).some((l) => l.includes("c₁+c₂=3−0.5=2.5")), "p9 coefficient line");
    assert.ok((await formulaLines()).some((l) => l.includes("c₁=5,c₂=−2.5")));
    assert.equal(await formulaFallbacks(), 0);
    const h = await pathsD(1, "path.ln.c2");
    const y = await pathsD(0, "path.ln.c1");
    const frame = (family) => ev(`import("/src/signals-lti-model.js").then((m) => { const s = ${L}.getSignalsCourseState(); return m.ltiFrame(${JSON.stringify(family)}, s.params, s.cursor); })`);
    const steady = (await frame("ode2-review")).panes[0].hlines.map((l) => l.y);
    assert.equal(await ev(`${visibleIn(0, "line.ref.c5")}.length`), 1, "one y_p line");
    assert.equal(h.length, 1);
    await setParam("y0", -2);
    await setParam("dy0", 4);
    s = await sg();
    assert.deepEqual([s.params.y0, s.params.dy0], [-2, 4]);
    assert.deepEqual(await pathsD(1, "path.ln.c2"), h, "h path is the same");
    assert.notDeepEqual(await pathsD(0, "path.ln.c1"), y, "y path changes");
    assert.deepEqual((await frame("ode2-review")).panes[0].hlines.map((l) => l.y), steady, "yₚ is the same");
    assert.deepEqual(steady, [0.5], "yₚ = b₀/a₀ = 1/2");
    assert.doesNotMatch(await live(), /c₁=5, c₂=−2\.5/, "the coefficients follow the initial values");
    assert.equal((await pathsD(0, "path.ln.cm")).length, 1, "the zero-state step response s(t) is drawn for non-zero initial values");
    await noBadText("p9 changed");
    // Each example keeps its own initial values.
    await setFamily("ode2-rlc");
    s = await sg();
    assert.deepEqual([s.params.y0, s.params.dy0], [0, 0], "Ex 2.19 starts from rest");
    await setParam("y0", 1.5);
    await setFamily("ode2-review");
    s = await sg();
    assert.deepEqual([s.params.y0, s.params.dy0], [-2, 4], "p9 kept its values");
    await setFamily("ode2-rlc");
    assert.equal((await sg()).params.y0, 1.5, "Ex 2.19 kept its value");
  });

  test("Ex 2.19: 위·아래 칸 끌기와 ←/→·Shift·Home/End로 시각 표식·접선·h 점이 함께 움직이고 접선은 s 위", async () => {
    await openSignals();
    await openLesson("lti");
    await setFamily("ode2-rlc");
    await openFormula();
    const f = await formulaLines();
    assert.ok(f.some((l) => l.includes("d₁=y(0)−yₚ=−1, d₂=(y′(0)−σd₁)/β=−0.2")), "Ex 2.19: d₁ = −1, d₂ = −0.2");
    assert.equal(f.filter((l) => l.startsWith("d₁=")).length, 1, "the d₁·d₂ values are written once");
    assert.equal(await formulaFallbacks(), 0, "every Ex 2.19 formula line parses");
    assert.ok(f.some((l) => l.includes("h(t)=ds/dt=5.2e^(−t)sin(5t)")), "h(t) = 5.2e^(−t) sin 5t");
    near((await sg()).cursor, 0.3, 1e-9, "the marker starts at 0.3 s");
    const together = async (what) => {
      const m = await ev(`({ top: ${visibleIn(0, "circle.dt.c4")}.map((c) => Number(c.getAttribute("cx"))), bottom: ${visibleIn(1, "circle.dt.c4")}.map((c) => Number(c.getAttribute("cx"))), line: ${visibleIn(1, "line.ref.c4")}.map((l) => Number(l.getAttribute("x1"))), seg: ${visibleIn(0, "line.ref.c4")}.map((l) => [Number(l.getAttribute("x1")), Number(l.getAttribute("x2"))]) })`);
      assert.equal(m.top.length, 1, `${what}: one point on s`);
      assert.equal(m.bottom.length, 1, `${what}: one point on h`);
      near(m.top[0], m.bottom[0], 0.6, `${what}: the s and h points share t`);
      near(m.line[0], m.bottom[0], 0.6, `${what}: the h marker line`);
      assert.ok(m.seg.length === 1 && m.seg[0][1] - m.seg[0][0] > 5, `${what}: the tangent keeps its length`);
    };
    await together("start");
    // Drag in the top pane, then in the bottom pane (x range [0, 5] s).
    for (const [index, from, to] of [[0, 0.3, 2], [1, 2, 3]]) {
      const pane = await paneBox(index);
      const toX = (t) => pane.left + (t / 5) * pane.width;
      const yAt = pane.top + pane.height * 0.5;
      await mouse("mouseMoved", toX(from), yAt);
      await mouse("mousePressed", toX(from), yAt, 1);
      for (const t of [from + (to - from) / 3, from + (2 * (to - from)) / 3, to]) { await mouse("mouseMoved", toX(t), yAt, 1); await sleep(20); }
      await mouse("mouseReleased", toX(to), yAt);
      await settle();
      near((await sg()).cursor, to, 0.06, `dragging pane ${index + 1} moves t to ${to}`);
      await together(`after the pane ${index + 1} drag`);
    }
    const key = async (k, shiftKey = false) => { await ev(`(() => { const svg = ${SVG}; svg.focus(); svg.dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(k)}, shiftKey: ${shiftKey}, bubbles: true, cancelable: true })); return true; })()`); await settle(); };
    let t = (await sg()).cursor;
    await key("ArrowRight");
    near((await sg()).cursor, t + 0.01, 1e-9, "→ moves 0.01 s");
    t = (await sg()).cursor;
    await key("ArrowLeft", true);
    near((await sg()).cursor, t - 0.1, 1e-9, "Shift+← moves 0.1 s");
    await key("End");
    near((await sg()).cursor, 5, 1e-9, "End = 5 s");
    await together("End");
    await key("Home");
    assert.equal((await sg()).cursor, 0, "Home = 0 s");
    assert.match(await live(), /h=0(?![.\d])/, "t = 0: h = 0");
    await together("Home");
    // The tangent sits on s: changing the initial values leaves it where it is.
    await key("ArrowRight", true);
    // s(t) = 1 − e^(−t)[cos 5t + 0.2 sin 5t], h(t) = 5.2 e^(−t) sin 5t (Ex 2.19, written out here).
    const sEx = (x) => 1 - Math.exp(-x) * (Math.cos(5 * x) + 0.2 * Math.sin(5 * x));
    const hEx = (x) => 5.2 * Math.exp(-x) * Math.sin(5 * x);
    const onS = async (what) => {
      const st = await sg();
      const fr = await ev(`import("/src/signals-lti-model.js").then((m) => m.ltiFrame("ode2-rlc", ${L}.getSignalsCourseState().params, ${L}.getSignalsCourseState().cursor))`);
      const seg = fr.panes[0].segments[0];
      const dot = fr.panes[0].dots[0];
      near(dot.y, sEx(st.cursor), 1e-9, `${what}: the point sits on s(t)`);
      near((seg.y2 - seg.y1) / (seg.x2 - seg.x1), hEx(st.cursor), 1e-9, `${what}: the tangent slope is h(t)`);
      near(seg.y1 + (st.cursor - seg.x1) * hEx(st.cursor), sEx(st.cursor), 1e-9, `${what}: the tangent passes through s(t)`);
    };
    await onS("zero initial values");
    await setParam("y0", 2);
    await setParam("dy0", -3);
    await onS("y(0) = 2, y′(0) = −3");
    assert.equal(await ev(`${visibleIn(0, "line.ref.c4")}.length`), 1, "one tangent on screen");
    await noBadText("Ex 2.19");
  });

  test("보기·탭·복원: proof·TFS·2차 응답 값이 레슨 이동·재적재·다시 붙이기에 남고, 따라가기에서 돌아오면 proof", async () => {
    await openSignals();
    await openLesson("fourier");
    await setFamily("proof-scale");
    await setParam("line", 3);
    await setParam("a", -1.5);
    await setParam("axis", 0);
    await openLesson("series");
    await setFamily("pulse");
    await setParam("spec", 3);
    await setParam("N", 12);
    await openLesson("lti");
    await setFamily("ode2-rlc");
    await setParam("y0", 1.5);
    await openLesson("fourier");
    let s = await sg();
    assert.deepEqual([s.family, s.params.line, s.params.a, s.params.axis], ["proof-scale", 3, -1.5, 0], "lesson switch keeps the proof");
    await flushSessions();
    await reload();
    await openLesson("fourier");
    s = await sg();
    assert.deepEqual([s.family, s.params.line, s.params.a, s.params.axis], ["proof-scale", 3, -1.5, 0], "reload keeps the proof");
    await openLesson("series");
    s = await sg();
    assert.deepEqual([s.family, s.params.spec, s.params.N], ["pulse", 3, 12], "reload keeps TFS and N");
    assert.equal(await shown("[data-signals-coefficients]"), true);
    await openLesson("lti");
    s = await sg();
    assert.deepEqual([s.family, s.params.y0], ["ode2-rlc", 1.5], "reload keeps the Ex 2.19 initial value");
    await flushSessions();
    const remounted = await ev(`import("/src/signals-course-controller.js").then((m) => { const host = document.createElement("section"); document.body.append(host); const c = m.createSignalsCourseController(host); const s = c.inspect(); c.destroy(); host.remove(); return s; })`);
    assert.deepEqual([remounted.lessonId, remounted.family, remounted.params.y0], ["lti", "ode2-rlc", 1.5], "remount: the same state");
    // proof → 따라가기 → 보기: back to the proof, the guide still has five steps.
    await openLesson("fourier");
    await change("[data-signals-mode]", "guide");
    await settle();
    assert.equal((await sg()).mode, "guide");
    assert.equal(await ev(`document.querySelectorAll("[data-signals-step]").length`), 5, "the guide keeps its five steps");
    await change("[data-signals-mode]", "free");
    await settle();
    s = await sg();
    assert.deepEqual([s.mode, s.family, s.params.line], ["free", "proof-scale", 3], "the free mode comes back to the proof");
    assert.equal(await ev(`${SVG}.getAttribute("aria-label")`), "FT 성질 증명 · 시간 신호·실수부·허수부");
    await setFamily("rect");
    assert.notEqual(await ev(`${SVG}.getAttribute("aria-label")`), "FT 성질 증명 · 시간 신호·실수부·허수부", "an ordinary example gets its own name back");
  });

  for (const [width, height] of [[390, 844], [360, 800]]) {
    test(`폰 ${width}px: 새 예시·TFS 표를 열어도 가로 넘침 없음, 44px 대상·16px 입력, 라벨이 옆으로 잘리지 않음, 막대 간격`, async () => {
      await openSignals({ width, height, mobile: true });
      const overflow = (what) => ev(`(() => { const d = document.documentElement, w = document.getElementById("signals-workspace"); return { doc: d.scrollWidth - d.clientWidth, ws: w.scrollWidth - w.clientWidth, what: ${JSON.stringify(what)} }; })()`);
      // `only`: check just the pane titles starting with it (the series lesson keeps older titles that may be cut on a phone).
      const checkLayout = async (what, only = "") => {
        const o = await overflow(what);
        assert.ok(o.doc <= 1 && o.ws <= 1, `${what}: no sideways scroll (${JSON.stringify(o)})`);
        const small = await ev(`[...document.querySelectorAll("#signals-workspace :is([data-signals-param], [data-signals-family], [data-signals-mode], [data-signals-lesson], [data-signals-formula-box] > summary, [data-signals-coefficients] > summary, [data-signals-coefficient-preset])")].filter((e) => e.getClientRects().length > 0 && e.getBoundingClientRect().height < 43.5).map((e) => e.outerHTML.slice(0, 80))`);
        assert.deepEqual(small, [], `${what}: 44 px targets`);
        const tiny = await ev(`[...document.querySelectorAll("#signals-workspace :is(select, input:not([type=range]))")].filter((e) => e.getClientRects().length > 0 && parseFloat(getComputedStyle(e).fontSize) < 16).map((e) => e.outerHTML.slice(0, 80))`);
        assert.deepEqual(tiny, [], `${what}: 16 px selects and inputs`);
        const cut = await ev(`(() => { const r = ${SVG}.getBoundingClientRect(); return [...${SVG}.querySelectorAll("text")].filter((t) => t.getAttribute("visibility") !== "hidden" && t.textContent.trim()).filter((t) => { const b = t.getBoundingClientRect(); return b.width > 0 && (b.left < r.left - 1 || b.right > r.right + 1); }).map((t) => t.textContent); })()`);
        assert.deepEqual(cut, [], `${what}: plot labels stay inside the plot`);
        // setTitle shortens a title that does not fit with "…", so the box check above cannot see a cut title; the text can.
        const titles = await ev(`[...${SVG}.querySelectorAll("text.sg-title")].filter((t) => t.getAttribute("visibility") !== "hidden" && t.textContent.trim()).map((t) => t.textContent).filter((t) => t.startsWith(${JSON.stringify(only)}))`);
        assert.ok(titles.length > 0, `${what}: pane titles found`);
        assert.deepEqual(titles.filter((t) => t.endsWith("…")), [], `${what}: pane titles are not cut short`);
      };
      await openLesson("fourier");
      for (const family of ["proof-scale", "proof-sin", "proof-integral"]) {
        await setFamily(family);
        await openFormula();
        await checkLayout(family);
      }
      // A vertical swipe over a proof plot scrolls the page (no drag there).
      await ev(`document.getElementById("signals-workspace").scrollTop = 0`);
      await settle();
      const plot = await ev(`(() => { const r = ${SVG}.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
      const before = await sg();
      const top = await ev(`document.getElementById("signals-workspace").scrollTop + document.scrollingElement.scrollTop`);
      const fx = plot.x + plot.w * 0.6;
      const fy = plot.y + Math.min(plot.h * 0.7, 600);
      await touch("touchStart", [{ x: fx, y: fy }]);
      for (let i = 1; i <= 10; i += 1) { await touch("touchMove", [{ x: fx, y: fy - 22 * i }]); await sleep(16); }
      await touch("touchEnd", []);
      await settle();
      await sleep(250);
      assert.ok((await ev(`document.getElementById("signals-workspace").scrollTop + document.scrollingElement.scrollTop`)) > top + 20, "the vertical swipe over the proof plot scrolls the page");
      assert.deepEqual((await sg()).params, before.params, "and changes nothing");

      await openLesson("lti");
      for (const family of ["ode2-review", "ode2-rlc"]) {
        await setFamily(family);
        await openFormula();
        await checkLayout(family);
      }
      // F3: a tap on the plot moves the time marker like the RC step response.
      assert.equal(await text("[data-signals-hint]"), "● 점을 끌거나 ←/→", "the phone drag hint for the second-order examples");
      await ev(`${SVG}.scrollIntoView({ block: "center" })`);
      await settle();
      const pane = await paneBox(1);
      const startT = (await sg()).cursor;
      await touch("touchStart", [{ x: pane.left + pane.width * 0.8, y: pane.top + pane.height * 0.5 }]);
      await sleep(40);
      await touch("touchEnd", []);
      await settle();
      near((await sg()).cursor, 4, 0.15, `a tap at 80 % of the h pane moves t there (from ${startT})`);

      await openLesson("series");
      await setFamily("pulse");
      await setParam("spec", 3);
      await ev(`document.querySelector("[data-signals-coefficients]").open = true`);
      await settle();
      await clickEl("[data-signals-coefficient-preset]");
      await openFormula();
      await checkLayout("TFS table", "TFS ");
      const table = await ev(`(() => { const t = document.querySelector("[data-signals-coefficients] table"); const s = document.querySelector(".sg-coefficient-scroll"); return { font: parseFloat(getComputedStyle(t).fontSize), inside: s.getBoundingClientRect().right <= document.documentElement.clientWidth + 1, scrolls: getComputedStyle(s).overflowX }; })()`);
      assert.ok(table.font >= 14, `table text ≥ 14 px (${table.font})`);
      assert.equal(table.inside, true, "the table box stays inside the screen");
      assert.equal(table.scrolls, "auto", "the table scrolls inside its own box");
      // a_k and b_k bars of the same k stay at least 3 px apart.
      const gap = await ev(`(() => { const a = ${visibleIn(2, "line.st.c1")}.map((l) => Number(l.getAttribute("x1"))); const b = ${visibleIn(2, "line.st.c2")}.map((l) => Number(l.getAttribute("x1"))); return Math.min(...a.flatMap((x) => b.map((y) => Math.abs(x - y)))); })()`);
      assert.ok(gap >= 3, `a_k / b_k bars ${gap} px apart`);
    });
  }

  test("노드 수·포커스·소리: 같은 예시 안의 반복 조작은 SVG 노드를 늘리지 않고, 표는 11행을 재사용, 소리는 레슨을 떠나면 멈춤", async () => {
    await openSignals();
    // Warm the pools: every new family once, the TFS mode with N = 25.
    await openLesson("fourier");
    for (const family of ["proof-scale", "proof-sin", "proof-integral"]) { await setFamily(family); for (const n of [1, 4]) await setParam("line", n); await setParam("axis", 0); await setParam("axis", 1); }
    await setFamily("proof-scale");
    let count = await svgNodeCount();
    for (let i = 0; i < 60; i += 1) { await change('[data-signals-param="a"]', [-3, -2, -0.25, 0.25, 1, 3][i % 6]); await change('[data-signals-param="line"]', (i % 4) + 1); }
    await settle();
    assert.equal(await svgNodeCount(), count, "proof-scale: 60 slider changes keep the SVG node count");
    await setFamily("proof-sin");
    count = await svgNodeCount();
    for (let i = 0; i < 60; i += 1) await change('[data-signals-param="f0"]', (0.5 + (i % 26) * 0.1).toFixed(1));
    await settle();
    assert.equal(await svgNodeCount(), count, "proof-sin: 60 slider changes keep the SVG node count");

    await openLesson("lti");
    for (const family of ["ode2-review", "ode2-rlc"]) { await setFamily(family); await setParam("y0", 1); await setParam("y0", 0); }
    count = await svgNodeCount();
    for (let i = 0; i < 60; i += 1) { await change('[data-signals-param="y0"]', -5 + (i % 21) * 0.5); await change('[data-signals-param="dy0"]', 5 - (i % 21) * 0.5); }
    await settle();
    assert.equal(await svgNodeCount(), count, "ode2-rlc: 60 slider changes keep the SVG node count");

    await openLesson("series");
    await setFamily("pulse");
    await setParam("spec", 3);
    await setParam("N", 1);
    await setParam("N", 25);
    await ev(`document.querySelector("[data-signals-coefficients]").open = true`);
    await settle();
    count = await svgNodeCount();
    await ev(`[...document.querySelectorAll("[data-signals-coefficient-row]")].forEach((r, i) => { r.__probe = i; })`);
    await ev(`document.querySelector(".sg-coefficient-scroll").focus()`);
    for (let i = 0; i < 60; i += 1) { await change('[data-signals-param="D"]', ((3 + (i % 50)) / 60).toString()); if (i % 10 === 0) await change('[data-signals-param="N"]', 1 + (i % 25)); }
    await setParam("N", 25);
    assert.equal(await svgNodeCount(), count, "TFS: 60 changes keep the SVG node count");
    assert.equal(await ev(`document.querySelectorAll("[data-signals-coefficient-row]").length`), 11, "still 11 rows");
    assert.equal(await ev(`[...document.querySelectorAll("[data-signals-coefficient-row]")].every((r, i) => r.__probe === i)`), true, "the same 11 row elements are reused");
    assert.equal(await ev(`document.activeElement === document.querySelector(".sg-coefficient-scroll")`), true, "the table keeps the focus");

    // Sound: start the tone, leave for the new LTI example → it stops; again for the proofs.
    for (const [lesson, family] of [["lti", "ode2-rlc"], ["fourier", "proof-sin"]]) {
      await openLesson("sound");
      await until(`Boolean(document.querySelector("[data-signals-sound]"))`, "the sound lesson");
      await clickEl("[data-signals-sound-toggle]");
      await until(`document.querySelector("[data-signals-sound]").dataset.signalsSound === "running"`, "the sound to start", 15000);
      await openLesson(lesson);
      await until(`document.querySelector("[data-signals-sound]").dataset.signalsSound === "off"`, `the sound to stop on ${lesson}`);
      assert.equal((await sg()).family, family, `${lesson} kept ${family}`);
    }
  });
});
