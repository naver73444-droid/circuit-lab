// Drag performance of the 전자기학 plane on a slow phone: real server + headless Edge (throw-away profile, see harness.mjs) at
// 390x844 with touch input and the CPU slowed down 4x (Emulation.setCPUThrottlingRate). For each set-up (2 / 4 / 8 charges, and
// 2 / 4 wires with a current loop in the magnetic mode) one finger drags the first source around a circle; the page records the
// frame times (requestAnimationFrame) and the User Timing entries of the EM renderer (globalThis.__EM_PERF__ turns them on), so
// one draw is broken down into grid sampling, colour painting, equipotentials, field-line tracing / stroking, arrows, overlay,
// sensor readout and side panels. While the finger is down the plane is drawn at draft quality; on release one final render follows.
//
// Run with `node --test tests/browser/em-perf.test.mjs`. Timing limits are deliberately loose (machines differ a lot); the numbers
// are printed, and with EM_PERF_OUT=<file.json> saved. EM_PERF_SHOTS=<dir> saves phone screenshots during and after a drag
// (file names start with EM_PERF_TAG, default "em"). CIRCUIT_LAB_ROOT=<checkout> measures another copy of the app.
import { describe, test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  L, ctx, ev, until, settle, navigate, sleep,
  startServer, startBrowser, stopAll, leftoverProcessIds, isAlive, assertNoProblems, resetProblems,
} from "./harness.mjs";

const SHOTS = process.env.EM_PERF_SHOTS || "";
const TAG = process.env.EM_PERF_TAG || "em";
const OUT = process.env.EM_PERF_OUT || "";
const THROTTLE = 4;

const charge = (id, q, x, y) => ({ id, type: "point", q, position: [x, y, 0], enabled: true, visible: true });
const wire = (id, current, x, y) => ({ id, type: "wire", current, position: [x, y, 0], direction: [0, 0, 1], enabled: true, visible: true });
const loop = (id, current, x, y, radius) => ({ id, type: "loop", current, position: [x, y, 0], radius, normal: [0, 1, 0], enabled: true, visible: true });
const ring = (n, radius) => Array.from({ length: n }, (_, k) => {
  const angle = (2 * Math.PI * k) / n + 0.3;
  return charge(`q${k + 1}`, (k % 2 ? -1 : 1) * (k % 3 === 2 ? 0.5e-9 : 1e-9), +(radius * Math.cos(angle)).toFixed(3), +(radius * Math.sin(angle)).toFixed(3));
});

const SETUPS = [
  { name: "전기 전하 2", field: "electric", charges: [charge("q1", 1e-9, -0.75, 0), charge("q2", -1e-9, 0.75, 0)] },
  { name: "전기 전하 4", field: "electric", charges: [charge("q1", 1e-9, -0.75, 0), charge("q2", -1e-9, 0.75, 0), charge("q3", 1e-9, 0, 0.8), charge("q4", -0.5e-9, 0, -0.8)] },
  { name: "전기 전하 8", field: "electric", charges: ring(8, 0.95) },
  { name: "자기 도선 2 + 루프", field: "magnetic", currents: [wire("W1", 10, -0.6, 0.3), wire("W2", -10, 0.6, 0.3), loop("L1", 5, 0, -0.6, 0.4)] },
  { name: "자기 도선 4 + 루프", field: "magnetic", currents: [wire("W1", 10, -0.6, 0.45), wire("W2", -10, 0.6, 0.45), wire("W3", 6, -0.9, -0.2), wire("W4", -6, 0.9, -0.2), loop("L1", 5, 0, -0.7, 0.4)] },
];

function projectFile(setup) {
  const charges = setup.charges ?? [charge("q1", 1e-9, -0.75, 0), charge("q2", -1e-9, 0.75, 0)];
  const currents = setup.currents ?? [];
  return {
    format: "circuit-lab-em-playground", version: 2,
    world: { sources: charges, probe: [0, 1.2, 0], plane: "xy", selectedId: charges[0]?.id ?? null, comparison: null },
    view: { camera: { yaw: 0.6, pitch: 0.4, distance: 6 }, vectorMode: "E" },
    calculus: { mode: "electric", differentialMode: "numeric", alpha: 1, h: 0.005, radius: 0.5, normal: [0, 0, 1] },
    legend: { mode: "auto" },
    field: setup.field,
    magnetic: { sources: currents, selectedId: currents[0]?.id ?? null, ampere: null, chips: { lines: true, contours: true, mcolor: true, arrows: true } },
  };
}

const touch = (type, touchPoints) => ctx.cdp.send("Input.dispatchTouchEvent", { type, touchPoints });
const em = () => ev(`${L}.getEMState()`);
async function shot(name) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  const { data } = await ctx.cdp.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(SHOTS, `${TAG}-${name}.png`), Buffer.from(data, "base64"));
}
/** Screen point of a world (a, b) position on the plane canvas (same mapping as em-plane-geometry.createPlaneView). */
async function emScreen(a, b) {
  const { view } = await em();
  const box = await ev(`(() => { const c = document.getElementById("em-plane"), r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: c.clientWidth, h: c.clientHeight }; })()`);
  const scale = Math.min(box.w, box.h) / (2 * view.span);
  return { x: box.x + box.w / 2 + (a - view.offset[0]) * scale, y: box.y + box.h / 2 - (b - view.offset[1]) * scale, scale };
}

let scratch = "";
async function loadSetup(setup) {
  const file = join(scratch, `${setup.field}-${setup.name.replace(/\W+/g, "-")}.json`);
  writeFileSync(file, JSON.stringify(projectFile(setup)));
  const { result } = await ctx.cdp.send("Runtime.evaluate", { expression: `document.getElementById("em-d-file")` });
  await ctx.cdp.send("DOM.setFileInputFiles", { files: [file], objectId: result.objectId });
  const count = (setup.charges ?? setup.currents).length, list = setup.field === "magnetic" ? "current.sources" : "playground.sources";
  await until(`${L}.getEMState().field === ${JSON.stringify(setup.field)} && ${L}.getEMState().${list}.length === ${count}`, `the ${setup.name} set-up to load`);
  await ev(`(() => { document.getElementById("em-plane").scrollIntoView({ block: "center" }); return true; })()`);
  await settle();
  await sleep(200);
  await settle();
}

const percentile = (values, p) => {
  if (!values.length) return NaN;
  const sorted = [...values].sort((x, y) => x - y);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
};
const mean = (values) => (values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : NaN);
const r1 = (value) => (Number.isFinite(value) ? Math.round(value * 10) / 10 : null);
const STAGES = ["sample", "paint", "contours", "traceLines", "strokeLines", "arrows", "base", "overlay", "readout", "chrome", "layout", "panels", "frame"];

/** Breakdown of the measures in [from, to): per stage the mean, and p50 / p95 of whole frames. */
function breakdown(measures, from, to) {
  const inside = measures.filter((m) => m.start >= from && m.start < to);
  const stages = {};
  for (const name of STAGES) stages[name] = r1(mean(inside.filter((m) => m.name === `em:${name}`).map((m) => m.duration)));
  const frames = inside.filter((m) => m.name === "em:frame").map((m) => m.duration);
  return { renders: frames.length, frameP50: r1(percentile(frames, 50)), frameP95: r1(percentile(frames, 95)), stages };
}

/**
 * One finger on the first source, around a circle of `radius` m and back, with `moves` touch moves `gap` ms apart.
 * `during` runs while the finger is still down (after the last move).
 */
async function dragFirstSource(setup, { moves = 72, gap = 8, radius = 0.35, during = null } = {}) {
  const state = await em(), sources = setup.field === "magnetic" ? state.current.sources : state.playground.sources;
  const first = sources[0], at = first.position, start = await emScreen(at[0], at[1]);
  const path = (k) => ({ x: start.x + radius * start.scale * (Math.cos((2 * Math.PI * k) / moves) - 1), y: start.y - radius * start.scale * Math.sin((2 * Math.PI * k) / moves) });
  await touch("touchStart", [{ x: start.x, y: start.y }]);
  for (let k = 1; k <= moves; k += 1) { await touch("touchMove", [path(k)]); if (gap) await sleep(gap); }
  // Let the last move render before anything reads the page.
  await ev(`new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))`);
  const seen = during ? await during() : null;
  await touch("touchEnd", []);
  return { first, seen };
}

describe("EM plane drag performance (phone, CPU 4x slower)", { timeout: 900000 }, () => {
  const report = [];
  before(async () => {
    scratch = mkdtempSync(join(tmpdir(), "circuit-lab-em-perf-"));
    await startServer();
    await startBrowser();
    await ctx.cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await navigate("/?workspace=em", { width: 390, height: 844, mobile: true });
    await until(`${L}.getEMState()?.active && document.getElementById("em-plane").clientWidth > 100`, "the EM plane");
  });
  beforeEach(() => resetProblems());
  afterEach(async () => { await ctx.cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 }).catch(() => {}); await assertNoProblems("console/network"); });
  after(async () => {
    if (report.length) {
      console.log(`\nEM drag at ${THROTTLE}x CPU slowdown, 390x844 (ms):`);
      for (const row of report) {
        console.log(`${row.setup.padEnd(14)} frame interval p50 ${row.interval.p50} p95 ${row.interval.p95} | draft draw p50 ${row.drag.frameP50} p95 ${row.drag.frameP95} (${row.drag.renders} draws) | final draw ${row.final.frameP50}`);
        console.log(`${"".padEnd(14)} draft stages ${JSON.stringify(row.drag.stages)}`);
        console.log(`${"".padEnd(14)} final stages ${JSON.stringify(row.final.stages)}`);
      }
      if (OUT) writeFileSync(OUT, JSON.stringify({ throttle: THROTTLE, viewport: [390, 844], rows: report }, null, 2));
    }
    const startedPids = [ctx.edge?.pid, ctx.server?.pid].filter(Boolean);
    const stopped = await stopAll();
    for (const pid of new Set([...startedPids, ...stopped])) assert.equal(isAlive(pid), false, `process ${pid} should have been stopped`);
    assert.deepEqual(leftoverProcessIds(), [], "no process may still carry the throw-away Edge profile");
    try { rmSync(scratch, { recursive: true, force: true }); } catch { /* lives in the OS temp directory */ }
  });

  for (const setup of SETUPS) {
    test(`${setup.name}: dragging draws drafts, releasing draws the final picture once; frame times are recorded`, async () => {
      await loadSetup(setup);
      const finalCols = (await em()).diagnostics.plane.cols;
      // A short unmeasured drag first, so the measured one does not include the JIT warming up for this set-up.
      await dragFirstSource(setup, { moves: 24, radius: 0.2 });
      await until(`${L}.getEMState().quality === "final"`, "the final render after the warm-up drag");
      await settle();
      await ctx.cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
      await ev(`(() => {
        performance.clearMeasures();
        globalThis.__EM_PERF__ = true;
        const rec = window.__emRec = { on: true, frames: [] };
        const tick = (t) => { if (!rec.on) return; rec.frames.push(t); requestAnimationFrame(tick); };
        requestAnimationFrame(tick);
        return true;
      })()`);
      const parts0 = (await em()).diagnostics.plane, t0 = await ev(`performance.now()`);
      const { seen } = await dragFirstSource(setup, {
        during: () => ev(`(() => { const s = ${L}.getEMState(); return { quality: s.quality, cols: s.diagnostics.plane.cols, plane: s.diagnostics.plane, t: performance.now() }; })()`),
      });
      const t1 = seen.t;
      await until(`${L}.getEMState().quality === "final" && ${L}.getEMState().diagnostics.plane.cols === ${finalCols}`, "the final render after the release", 60000);
      await ev(`new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))`);
      const data = await ev(`(() => {
        window.__emRec.on = false;
        globalThis.__EM_PERF__ = false;
        const measures = performance.getEntriesByType("measure").filter((m) => m.name.startsWith("em:")).map((m) => ({ name: m.name, start: m.startTime, duration: m.duration }));
        performance.clearMeasures();
        return { frames: window.__emRec.frames, measures, end: performance.now() };
      })()`);
      await ctx.cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
      const stamps = data.frames.filter((t) => t >= t0 && t <= t1), intervals = stamps.slice(1).map((t, i) => t - stamps[i]);
      const row = {
        setup: setup.name,
        interval: { p50: r1(percentile(intervals, 50)), p95: r1(percentile(intervals, 95)), frames: intervals.length },
        drag: breakdown(data.measures, t0, t1),
        final: breakdown(data.measures, t1, data.end + 1),
        cols: { draft: seen.cols, final: finalCols },
        // Raw draft-frame times (whole frame and field-line tracing), for a closer look in EM_PERF_OUT.
        raw: Object.fromEntries(["frame", "traceLines", "sample"].map((name) => [name, data.measures
          .filter((m) => m.name === `em:${name}` && m.start >= t0 && m.start < t1).map((m) => r1(m.duration))])),
      };
      report.push(row);
      assert.equal(seen.quality, "draft", "the plane is drawn at draft quality while the finger is down");
      assert.ok(seen.cols < finalCols, `the draft grid is coarser (${seen.cols} vs ${finalCols} cells across)`);
      assert.ok(row.drag.renders >= 5, `the drag re-drew the plane (${row.drag.renders} draws)`);
      assert.ok(row.final.renders >= 1, "the release drew the final picture");
      // The per-source cache: each draft frame samples the colour and arrow grids for the dragged source only.
      const sources = (setup.charges ?? setup.currents).length, frames = seen.plane.gridBuilds - parts0.gridBuilds;
      const evaluated = seen.plane.partsEvaluated - parts0.partsEvaluated, reused = seen.plane.partsReused - parts0.partsReused;
      row.parts = { frames, evaluated, reused };
      assert.ok(frames >= 5 && evaluated <= 2 * frames + 2, `only the dragged source is sampled again (${evaluated} contributions in ${frames} frames)`);
      assert.ok(reused >= 2 * (sources - 1) * (frames - 1), `the other ${sources - 1} sources come from the cache (${reused} reused in ${frames} frames)`);
      // Loose ceilings only: a slowed-down CI machine must not fail on noise, but a 3x regression should.
      assert.ok(row.drag.frameP95 < 150, `draft draw p95 ${row.drag.frameP95} ms at ${THROTTLE}x slowdown`);
      assert.ok(row.final.frameP50 < 1500, `final draw ${row.final.frameP50} ms at ${THROTTLE}x slowdown`);
    });
  }

  test("screenshots: 4 charges and 4 wires + loop while dragging (draft) and after the release (final)", async () => {
    for (const setup of [SETUPS[1], SETUPS[4]]) {
      await loadSetup(setup);
      const label = setup.field === "magnetic" ? "magnetic-4" : "electric-4";
      const seen = await dragFirstSource(setup, { moves: 18, gap: 16, radius: 0.3, during: async () => { const q = (await em()).quality; await shot(`${label}-dragging`); return q; } });
      assert.equal(seen.seen, "draft");
      await until(`${L}.getEMState().quality === "final"`, "the final render");
      await settle();
      await shot(`${label}-released`);
      const picture = await ev(`(() => { const c = document.getElementById("em-plane-base"), g = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; const seen = new Set(); for (let i = 0; i < g.length; i += 4 * 97) seen.add(g[i] + "," + g[i + 1] + "," + g[i + 2]); return seen.size; })()`);
      assert.ok(picture > 10, `the final picture is really drawn (${picture} colours)`);
    }
  });
});
