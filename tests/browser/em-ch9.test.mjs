// 전자기학 Hayt Ch.9 (7주차) in a real (headless) browser: the subject select (Ch.9 group first, 12 subjects, 47 experiments), the
// rotating loop (three panels, typed phase, α₀, reset, canvas drag, arrow keys, a cursor past an end keeps the last valid point),
// the homopolar disc (radius, r₀, polarity), the capacitor (whole and enclosed current, invalid combinations keep the last valid
// state), theme and per-experiment memory, phones 390 and 360 px wide. Run with `node --test tests/browser/em-ch9.test.mjs`.
import { describe, test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  L, ctx, ev, until, settle, navigate, sleep, click, select, typeInto, press, dragBetween, touchDrag, problems,
  startServer, startBrowser, stopAll, assertNoProblems, resetProblems,
} from "./harness.mjs";

const DEG = Math.PI / 180;
const IDS = ["emf-rotating-loop", "emf-homopolar", "maxwell-displacement"];
const TOPIC = { "emf-rotating-loop": "자기유도", "emf-homopolar": "자기유도", "maxwell-displacement": "변위전류·Maxwell" };
const EPS0 = 8.8541878188e-12;
// capacitor preset: I = ωC V_m = 2000π · ε₀π(0.05)²/0.001 · 100 ≈ 43.69367 μA; H(a) = I/(2πa)
const I_CAP = 2000 * Math.PI * EPS0 * Math.PI * 0.0025 / 0.001 * 100, H_EDGE = I_CAP / (2 * Math.PI * 0.05);

const course = () => ev(`${L}.getEMState().course`);
const rec = async (id) => (await course()).records[id];
const val = (record, key) => record.result.scalars.find((item) => item.key === key)?.value;
const text = (selector) => ev(`document.querySelector(${JSON.stringify(selector)}).textContent.trim()`);
const shown = (selector) => ev(`!document.querySelector(${JSON.stringify(selector)}).hidden`);
/** |actual − expected| ≤ abs + rel·|expected| (the spec's tolerances). */
function near(actual, expected, abs, rel, what) {
  assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= abs + rel * Math.abs(expected), `${what}: ${actual} vs ${expected}`);
}
const canvasHash = () => ev(`(() => { let h = 2166136261 >>> 0; const c = document.getElementById("em-course-canvas"), d = c.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data;
  for (let i = 0; i < d.length; i += 1) { h ^= d[i]; h = Math.imul(h, 16777619) >>> 0; } return h; })()`);
const colorCount = () => ev(`(() => { const c = document.getElementById("em-course-canvas"), d = c.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data; const seen = new Set(); for (let i = 0; i < d.length; i += 4) { seen.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]); if (seen.size > 50) break; } return seen.size; })()`);
function dropLinuxManifestIcon() {
  if (process.platform !== "linux") return;
  for (let i = problems.length - 1; i >= 0; i -= 1) if (/Error while trying to use the following icon from the Manifest/.test(problems[i])) problems.splice(i, 1);
}

/** A fresh page (storage cleared, so the course opens on its first experiment), the EM tab and the course by real clicks. */
async function openCourse(view) {
  await navigate("/", view);
  await ev(`localStorage.clear(); sessionStorage.clear()`);
  await navigate("/", view);
  if (view?.mobile) await ev(`document.getElementById("em-workspace-tab").click()`); else await click("#em-workspace-tab");
  await until(`${L}.getEMState()?.active === true && document.getElementById("em-plane").clientWidth > 100`, "the EM workspace");
  if (view?.mobile) await ev(`document.getElementById("em-course-open").click()`); else await click("#em-course-open");
  await until(`${L}.getEMState().course?.active === true && document.getElementById("em-course-canvas").clientWidth > 100`, "the EM course");
  await settle();
}
async function choose(id) {
  await select("#em-course-topic", TOPIC[id]);
  if ((await course()).selectedId !== id) await select("#em-course-select", id);
  await until(`${L}.getEMState().course.selectedId === ${JSON.stringify(id)} && ${L}.getEMState().course.records[${JSON.stringify(id)}]?.result?.status === "valid"`, id);
  await until(`document.getElementById("em-course-canvas").dataset.profileSeries !== "0"`, `${id} to draw`);
  await settle();
}
/** Type the sweep coordinate (display units: ° for ωt, plain ratio otherwise) and wait for the probe to follow. */
async function sweep(id, typed, si) {
  await typeInto("#em-course-sweep-input", String(typed));
  await until(`Math.abs(${L}.getEMState().course.records[${JSON.stringify(id)}].point[2] - ${si}) < 1e-9`, `${id} sweep ${typed}`);
}
/** Type a parameter (display units) and wait for the stored SI value. */
async function param(id, key, typed, si) {
  await typeInto(`[data-em-course-parameter="${key}"]`, String(typed));
  await until(`Math.abs(${L}.getEMState().course.records[${JSON.stringify(id)}].params[${JSON.stringify(key)}] - ${si}) <= 1e-9 * Math.max(1e-12, Math.abs(${si}))`, `${id}.${key} = ${typed}`);
}
async function checksPass(id) {
  await until(`(() => { const r = ${L}.getEMState().course.records[${JSON.stringify(id)}]; return r.checked && Array.isArray(r.checks) && r.checks.length > 0; })()`, `${id} checks`);
  const record = await rec(id);
  assert.ok(record.checks.length >= 2 && record.checks.every((row) => row.status === "pass"), `${id}: ${record.checks.map((row) => `${row.label} ${row.status}`).join(" | ")}`);
}
/** Screen x of a sweep coordinate on the profile canvas (the view maps [lo, hi] onto [left 58, width − 14]). */
const canvasBox = () => ev(`(() => { const c = document.getElementById("em-course-canvas"); c.scrollIntoView({ block: "center" }); const r = c.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height, lo: Number(c.dataset.profileXMin), hi: Number(c.dataset.profileXMax) }; })()`);
const xOf = (box, coordinate) => box.x + 58 + (coordinate - box.lo) / (box.hi - box.lo) * (box.w - 72);

describe("EM course Hayt Ch.9", { timeout: 600000 }, () => {
  before(async () => { await startServer(); await startBrowser(); });
  beforeEach(() => resetProblems());
  afterEach(async () => { dropLinuxManifestIcon(); await assertNoProblems("console/network"); });
  after(async () => { await stopAll(); });

  test("subjects: first force-lorentz, the Ch.9 group first, 12 subjects with 47 distinct experiments, 자기유도 opens on faraday-loop", async () => {
    await openCourse();
    assert.equal((await course()).selectedId, "force-lorentz", "the first experiment is unchanged");
    const groups = await ev(`[...document.querySelectorAll("#em-course-topic optgroup")].map((g) => [g.label, [...g.children].map((o) => o.value)])`);
    assert.deepEqual(groups[0], ["Hayt Ch.9 (7주차)", ["자기유도", "변위전류·Maxwell"]]);
    assert.equal(groups[1][0], "Hayt Ch.8 (6주차)");
    const topics = groups.flatMap(([, names]) => names);
    assert.equal(topics.length, 12);
    assert.equal(new Set(topics).size, 12, "each subject once");
    const ids = new Set();
    for (const topic of topics) {
      await select("#em-course-topic", topic);
      for (const id of await ev(`[...document.querySelectorAll("#em-course-select option")].map((o) => o.value)`)) ids.add(id);
    }
    assert.equal(ids.size, 47);
    await select("#em-course-topic", "자기유도");
    await until(`${L}.getEMState().course.selectedId === "faraday-loop"`, "the first induction experiment");
    assert.deepEqual(await ev(`[...document.querySelectorAll("#em-course-select option")].map((o) => o.value)`), ["faraday-loop", "motional-rod", "emf-rotating-loop", "emf-homopolar"]);
    for (const [id, section] of [["emf-rotating-loop", "Hayt §9.1"], ["emf-homopolar", "Hayt §9.1"], ["maxwell-displacement", "Hayt §9.2, 9.3, 9.4"]]) {
      await choose(id);
      assert.ok((await text("#em-course-kind")).startsWith(section), `${id}: ${await text("#em-course-kind")}`);
      await checksPass(id);
    }
  });

  test("rotating loop: three panels at −0.5 V; typed 45° and 90°, α₀ = 30° change the answer and the curves; 초기화 restores", async () => {
    await openCourse();
    const id = "emf-rotating-loop";
    await choose(id);
    assert.equal(await ev(`document.getElementById("em-course-canvas").dataset.profileSeries`), "3");
    let r = await rec(id);
    near(val(r, "emf"), -0.5, 1e-12, 1e-11, "preset ℰ = −K cos60°");
    near(val(r, "transformerEmf"), -0.75, 1e-12, 1e-11, "ℰ_T");
    near(val(r, "motionalEmf"), 0.25, 1e-12, 1e-11, "ℰ_M");
    assert.ok(r.result.notes.some((n) => n.includes("세로축 눈금을 함께 보세요")), "the separate-axes note");
    assert.equal(await text("#em-course-sweep-unit"), "°");
    assert.equal(await ev(`document.getElementById("em-course-sweep-input").value`), "30", "ωt is shown in degrees");
    assert.equal(await shown("#em-course-time"), false, "no clock row");
    assert.equal(await shown("#em-course-trace"), false, "no emf(t) trace");

    await sweep(id, 45, 45 * DEG);
    r = await rec(id);
    near(val(r, "transformerEmf"), -0.5, 1e-12, 1e-11, "45°: ℰ_T = −cos²45°");
    near(val(r, "motionalEmf"), 0.5, 1e-12, 1e-11, "45°: ℰ_M = sin²45°");
    near(val(r, "emf"), 0, 1e-12, 0, "45°: ℰ = −cos90°");
    assert.match(await text("#em-course-answer"), /= ?0 V$/, "the residue reads 0 V");
    assert.ok(r.result.notes.some((n) => n.includes("합계 ℰ_ab 방향 없음")));
    await sweep(id, 90, 90 * DEG);
    near(val(await rec(id), "emf"), 1, 1e-12, 1e-11, "90°: ℰ = −cos180°");

    const before = await canvasHash();
    await param(id, "alpha0", 30, 30 * DEG);
    await settle();
    r = await rec(id);
    near(val(r, "emf"), -Math.cos(2 * 90 * DEG + 30 * DEG), 1e-12, 1e-11, "α₀ = 30°, θ = 90°: −K cos(2θ + α₀)");
    assert.notEqual(await canvasHash(), before, "the curves follow α₀");
    await checksPass(id);

    await click("#em-course-reset");
    await until(`${L}.getEMState().course.records["emf-rotating-loop"]?.params.alpha0 === 0`, "the reset");
    r = await rec(id);
    near(r.point[2], 30 * DEG, 1e-12, 0, "θ back to 30°");
    near(val(r, "emf"), -0.5, 1e-12, 1e-11, "−0.5 V again");
  });

  test("rotating loop: canvas drag and ←/→ move the phase; the numeric/symbolic switch keeps the canvas and the cursor; past an end the last valid point stays", async () => {
    await openCourse();
    const id = "emf-rotating-loop";
    await choose(id);
    let box = await canvasBox();
    const y = box.y + box.h * 0.55;
    assert.equal(await ev(`document.elementFromPoint(${xOf(box, Math.PI / 2)}, ${y})?.id`), "em-course-canvas");
    await dragBetween({ x: xOf(box, Math.PI / 6), y }, { x: xOf(box, (2 * Math.PI) / 3), y });
    let r = await rec(id);
    assert.ok(Math.abs(r.point[2] - (2 * Math.PI) / 3) < 2 * DEG, `the drag moved ωt to ≈ 120° (${r.point[2] / DEG}°)`);
    near(val(r, "emf"), -Math.cos(2 * r.point[2]), 1e-12, 1e-9, "the answer belongs to the dragged phase");

    await ev(`document.getElementById("em-course-canvas").focus()`);
    const start = (await rec(id)).point[2];
    await press("ArrowRight", "ArrowRight", 39);
    r = await rec(id);
    near(r.point[2], start + 0.025 * 2 * Math.PI, 1e-9, 0, "→ moves one step (2.5 % of the sweep)");
    near(val(r, "emf"), -Math.cos(2 * r.point[2]), 1e-12, 1e-9, "→ updates the answer");
    await press("ArrowLeft", "ArrowLeft", 37);
    near((await rec(id)).point[2], start, 1e-9, 0, "← moves back");

    // numeric ↔ symbolic: the same canvas node and the same cursor
    await ev(`document.getElementById("em-course-canvas").dataset.ch9Marker = "kept"`);
    const point = (await rec(id)).point;
    await click('[data-em-answer-mode="symbolic"]');
    assert.ok((await text("#em-course-symbolic")).length > 20, "the symbolic solution is shown");
    await click('[data-em-answer-mode="numeric"]');
    assert.equal(await ev(`document.getElementById("em-course-canvas").dataset.ch9Marker`), "kept", "the canvas was not rebuilt");
    assert.deepEqual((await rec(id)).point, point, "the cursor stayed");

    // past the end: a typed 360° then → is refused with a reason, the point and the answer stay
    await sweep(id, 360, 2 * Math.PI);
    const atEnd = await rec(id);
    await ev(`document.getElementById("em-course-canvas").focus()`);
    await press("ArrowRight", "ArrowRight", 39);
    r = await rec(id);
    assert.equal(r.point[2], 2 * Math.PI, "the point stays at 360°");
    assert.equal(val(r, "emf"), val(atEnd, "emf"), "the answer stays");
    assert.equal(await shown("#em-course-error"), true, "the reason is shown");
    assert.match(await text("#em-course-error"), /360/);
    // a drag beyond the right edge stops at the last valid candidate
    box = await canvasBox();
    await dragBetween({ x: xOf(box, 300 * DEG), y }, { x: box.x + box.w + 40, y }, { steps: 8 });
    r = await rec(id);
    assert.ok(r.point[2] >= 300 * DEG && r.point[2] <= 2 * Math.PI, `the drag kept a valid phase (${r.point[2] / DEG}°)`);
    assert.equal(r.result.status, "valid");
    near(val(r, "emf"), -Math.cos(2 * r.point[2]), 1e-12, 1e-9, "the answer belongs to the kept phase");
    // a valid move clears the reason
    await ev(`document.getElementById("em-course-canvas").focus()`);
    await press("ArrowLeft", "ArrowLeft", 37);
    assert.equal(await shown("#em-course-error"), false, "a valid point clears the reason");
  });

  test("homopolar disc: +0.25 V, half radius 0.0625 V, r₀ = 20 cm keeps the ratio, ω = −100 flips the polarity, ω = 0 has none; 초기화", async () => {
    await openCourse();
    const id = "emf-homopolar";
    await choose(id);
    assert.equal(await ev(`document.getElementById("em-course-canvas").dataset.profileSeries`), "2");
    // V_ba = Bωr²/2 = 0.5·100·0.1²/2 = 0.25 V, E_m = Bωr = 5 V/m
    let r = await rec(id);
    near(val(r, "voltageBA"), 0.25, 1e-12, 1e-11, "rim voltage");
    near(val(r, "motionalE"), 5, 1e-11, 1e-11, "E_m at the rim");
    await sweep(id, 0.5, 0.5);
    r = await rec(id);
    near(val(r, "voltageBA"), 0.0625, 1e-12, 1e-11, "η = 1/2: a quarter of the voltage");
    near(val(r, "motionalE"), 2.5, 1e-11, 1e-11, "η = 1/2: half of E_m");
    await param(id, "r0", 20, 0.2);
    r = await rec(id);
    assert.equal(r.point[2], 0.5, "the ratio stays");
    near(val(r, "voltageBA"), 0.25, 1e-12, 1e-11, "r = 0.1 m again: 0.25 V");
    await param(id, "omega", -100, -100);
    r = await rec(id);
    near(val(r, "voltageBA"), -0.25, 1e-12, 1e-11, "ω < 0: negative V_ba");
    assert.ok(r.result.notes.some((n) => n.includes("a + / b −")), "the axle is positive");
    await param(id, "omega", 0, 0);
    r = await rec(id);
    assert.equal(val(r, "voltageBA"), 0);
    assert.ok(r.result.notes.some((n) => n.includes("극성 없음")), "no polarity");
    await checksPass(id);
    await click("#em-course-reset");
    await until(`${L}.getEMState().course.records["emf-homopolar"]?.params.omega === 100`, "the reset");
    r = await rec(id);
    assert.equal(r.params.r0, 0.1);
    assert.equal(r.point[2], 1);
    near(val(r, "voltageBA"), 0.25, 1e-12, 1e-11, "back to 0.25 V");
  });

  test("capacitor: whole 43.69367 μA, enclosed ¼ at ρ = a/2, whole at 2a with half the H, 0 on the axis; d = 2 mm halves, ωt = 90° stops the current", async () => {
    await openCourse();
    const id = "maxwell-displacement";
    await choose(id);
    assert.equal(await ev(`document.getElementById("em-course-canvas").dataset.profileSeries`), "2");
    let r = await rec(id);
    near(val(r, "freeCurrent"), I_CAP, 1e-14, 1e-11, "I_f");
    near(I_CAP, 43.69367e-6, 0, 1e-5, "the spec's rounded number");
    near(val(r, "enclosedDisplacementCurrent"), I_CAP, 1e-14, 1e-11, "s = 1 encloses all of it");
    near(val(r, "Hphi"), H_EDGE, 1e-12, 1e-11, "H(a)");
    await sweep(id, 0.5, 0.5);
    r = await rec(id);
    near(val(r, "enclosedDisplacementCurrent"), I_CAP / 4, 1e-14, 1e-11, "s = 1/2: a quarter");
    near(val(r, "freeCurrent"), I_CAP, 1e-14, 1e-11, "the whole current stays");
    near(val(r, "Hphi"), H_EDGE / 2, 1e-12, 1e-11, "H = J_d a/4");
    await sweep(id, 2, 2);
    r = await rec(id);
    near(val(r, "enclosedDisplacementCurrent"), I_CAP, 1e-14, 1e-11, "s = 2: the whole current");
    near(val(r, "Hphi"), H_EDGE / 2, 1e-12, 1e-11, "s = 2: half of H(a)");
    await sweep(id, 0, 0);
    r = await rec(id);
    assert.equal(val(r, "Hphi"), 0, "H on the axis");
    assert.equal(val(r, "enclosedDisplacementCurrent"), 0);
    await sweep(id, 1, 1);
    await param(id, "d", 2, 0.002);
    near(val(await rec(id), "freeCurrent"), I_CAP / 2, 1e-14, 1e-11, "d = 2 mm: half");
    await param(id, "phase", 90, 90 * DEG);
    r = await rec(id);
    near(val(r, "freeCurrent"), 0, 1e-14, 0, "ωt = 90°: no current");
    near(val(r, "voltage"), 100, 1e-12, 1e-11, "V = V_m");
    assert.ok(r.result.notes.some((n) => n.includes("방향 없음")));
    assert.doesNotMatch(await text("#em-course-answer"), /e-1\d/, "no floating-point residue on screen");
    await checksPass(id);
  });

  test("capacitor: d = 0 and a = 1 cm with d = 2 mm are refused with a reason and nothing is corrected; a valid value updates at once", async () => {
    await openCourse();
    const id = "maxwell-displacement";
    await choose(id);
    const snapshot = async () => { const r = await rec(id); return JSON.stringify({ params: r.params, result: r.result, profiles: r.profiles }); };
    const start = await snapshot();
    await typeInto('[data-em-course-parameter="d"]', "0");
    assert.equal(await shown("#em-course-error"), true, "d = 0: a reason");
    assert.equal(await snapshot(), start, "d = 0: nothing changed");
    await param(id, "d", 2, 0.002);
    const valid = await snapshot();
    await typeInto('[data-em-course-parameter="a"]', "1");
    await until(`!document.getElementById("em-course-error").hidden`, "the d/a reason");
    assert.match(await text("#em-course-error"), /d\/a/);
    assert.equal(await snapshot(), valid, "a = 1 cm, d = 2 mm: the last valid params, result and profiles stay");
    assert.equal((await rec(id)).params.a, 0.05, "a was not corrected");
    await param(id, "a", 5, 0.05);
    await param(id, "d", 1, 0.001);
    assert.equal(await shown("#em-course-error"), false, "the reason goes");
    near(val(await rec(id), "freeCurrent"), I_CAP, 1e-14, 1e-11, "back to the preset at once");
  });

  test("theme and memory: the three experiments draw in dark and light with their sections open; each keeps its own state; 초기화 resets only the shown one", async () => {
    await openCourse();
    for (const id of IDS) {
      await choose(id);
      await ev(`document.querySelectorAll("#em-course-root details, .em-course-shell details").forEach((d) => { d.open = true; })`);
      await click('[data-em-answer-mode="symbolic"]');
      assert.ok((await text("#em-course-symbolic")).length > 20, `${id}: symbolic solution`);
      await click('[data-em-answer-mode="numeric"]');
      assert.ok((await text("#em-course-notes")).length > 20, `${id}: notes`);
      assert.ok((await text("#em-course-values")).length > 20, `${id}: values`);
      await select("#appearance", "dark");
      await settle();
      const dark = await canvasHash();
      assert.ok(await colorCount() > 10, `${id}: drawn in dark`);
      await select("#appearance", "light");
      await until(`document.documentElement.dataset.theme === "light"`, "the light theme");
      await settle();
      assert.notEqual(await canvasHash(), dark, `${id}: repainted in light`);
      assert.ok(await colorCount() > 10, `${id}: drawn in light`);
    }
    await choose("emf-rotating-loop");
    await sweep("emf-rotating-loop", 90, 90 * DEG);
    await choose("emf-homopolar");
    await param("emf-homopolar", "omega", -100, -100);
    await choose("maxwell-displacement");
    await sweep("maxwell-displacement", 0.5, 0.5);
    await choose("emf-rotating-loop");
    near((await rec("emf-rotating-loop")).point[2], 90 * DEG, 1e-12, 0, "the loop kept its phase");
    assert.equal(await ev(`document.getElementById("em-course-sweep-input").value`), "90");
    await choose("emf-homopolar");
    assert.equal((await rec("emf-homopolar")).params.omega, -100, "the disc kept ω");
    await choose("maxwell-displacement");
    assert.equal((await rec("maxwell-displacement")).point[2], 0.5, "the capacitor kept its radius ratio");
    await click("#em-course-reset");
    await until(`${L}.getEMState().course.records["maxwell-displacement"]?.point[2] === 1`, "the capacitor reset");
    await choose("emf-rotating-loop");
    near((await rec("emf-rotating-loop")).point[2], 90 * DEG, 1e-12, 0, "the loop was not reset");
    await choose("emf-homopolar");
    assert.equal((await rec("emf-homopolar")).params.omega, -100, "the disc was not reset");
  });

  // ---- phones ------------------------------------------------------------------------------------------------------------
  const audit = () => ev(`(() => {
    const root = document.getElementById("em-workspace");
    const shownEl = (e) => { if (!e.getClientRects().length) return false; const s = getComputedStyle(e), r = e.getBoundingClientRect(); return s.visibility !== "hidden" && r.width > 0 && r.height > 0; };
    const name = (e) => e.tagName.toLowerCase() + (e.id ? "#" + e.id : "") + ' "' + (e.textContent || e.getAttribute("aria-label") || "").trim().slice(0, 16) + '"';
    const small = [], font = [], wide = [];
    for (const e of [...root.querySelectorAll("button, select, input:not([type=hidden]):not([type=file]), textarea, summary")].filter(shownEl)) {
      const box = (e.type === "checkbox" || e.type === "radio") && e.closest("label") ? e.closest("label") : e, r = box.getBoundingClientRect();
      if (Math.min(r.width, r.height) < 43.5) small.push(name(e) + " " + Math.round(r.width) + "x" + Math.round(r.height));
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.tagName) && !["range", "checkbox", "radio"].includes(e.type) && parseFloat(getComputedStyle(e).fontSize) < 16) font.push(name(e) + " " + getComputedStyle(e).fontSize);
    }
    for (const card of [...root.querySelectorAll(".em-card")].filter(shownEl)) if (card.scrollWidth > card.clientWidth + 1) wide.push((card.id || card.className) + " " + card.scrollWidth + ">" + card.clientWidth);
    return { small, font, wide, sideways: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 || root.scrollWidth > root.clientWidth + 1 };
  })()`);

  for (const [width, height] of [[390, 844], [360, 780]]) {
    test(`${width}x${height}: the three experiments with every section open fit without sideways scroll, 16 px fields, 44 px targets; a finger moves the cursor, the side strip scrolls, the typed field keeps focus`, async () => {
      await ctx.cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
      try {
        await openCourse({ width, height, mobile: true });
        for (const id of IDS) {
          await choose(id);
          for (const mode of ["symbolic", "numeric"]) {
            await ev(`document.querySelector('[data-em-answer-mode="${mode}"]').click()`);
            await ev(`(() => { document.querySelectorAll(".em-course-shell details").forEach((d) => { d.open = true; }); const more = document.getElementById("em-course-desc-more"); if (!more.hidden && more.textContent === "더 보기") more.click(); return true; })()`);
            await settle();
            const result = await audit();
            assert.deepEqual(result.small, [], `${id} ${mode}: 44 px targets`);
            assert.deepEqual(result.font, [], `${id} ${mode}: 16 px fields`);
            assert.deepEqual(result.wide, [], `${id} ${mode}: no card is cut`);
            assert.equal(result.sideways, false, `${id} ${mode}: no sideways scroll`);
          }
          // a finger on the picture moves the cursor
          const at = await canvasBox();
          await settle();
          const before = (await rec(id)).point[2];
          await touchDrag({ x: at.x + at.w * 0.35, y: at.y + at.h * 0.5 }, { x: at.x + at.w * 0.7, y: at.y + at.h * 0.5 });
          const r = await rec(id);
          assert.notEqual(r.point[2], before, `${id}: the finger moved the cursor`);
          assert.equal(r.result.status, "valid");
        }
        // the side strip of the picture belongs to the page: a vertical finger drag there scrolls
        await ev(`document.getElementById("em-workspace").scrollTop = 0`);
        const box = await canvasBox();
        await settle();
        const top = await ev(`document.getElementById("em-workspace").scrollTop`), point = (await rec("maxwell-displacement")).point;
        await touchDrag({ x: box.x + 6, y: box.y + box.h * 0.7 }, { x: box.x + 6, y: box.y + box.h * 0.2 }, { steps: 10 });
        await sleep(250);
        assert.ok((await ev(`document.getElementById("em-workspace").scrollTop`)) > top + 20, "a drag beside the picture scrolls the page");
        assert.deepEqual((await rec("maxwell-displacement")).point, point, "and leaves the cursor alone");
        // typing keeps the same field node and its focus; Tab leaves the canvas
        await ev(`document.getElementById("em-course-sweep-input").dataset.ch9Marker = "kept"`);
        await sweep("maxwell-displacement", 0.5, 0.5);
        assert.equal(await ev(`document.activeElement.id === "em-course-sweep-input" && document.activeElement.dataset.ch9Marker === "kept"`), true, "the field kept its node and focus");
        await ev(`document.getElementById("em-course-canvas").focus()`);
        await press("Tab", "Tab", 9);
        assert.notEqual(await ev(`document.activeElement?.id`), "em-course-canvas", "Tab moves out of the canvas");
      } finally {
        await ctx.cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false });
      }
    });
  }
});
