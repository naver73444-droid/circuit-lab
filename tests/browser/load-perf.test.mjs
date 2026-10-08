// Loading path on a phone: real server + headless Edge (throw-away profile, see harness.mjs) in 390x844 mobile
// emulation with 150 ms request latency, so every sequential round trip is visible in the request timing.
// Checks: no console problems on the first screen, the first screen loads exactly the modules index.html preloads
// and needs at most 3 sequential round trips, the workspace prefetch (idle after load, or hover/focus intent) adds
// each workspace's whole module list at once, and every workspace still opens.
// Run with `node --test tests/browser/load-perf.test.mjs`. Timings: `node scripts/measure-load.mjs`.
import { describe, test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  L, ROOT, ctx, ev, until, navigate, moveTo, center, click,
  startServer, startBrowser, stopAll, leftoverProcessIds, isAlive, assertNoProblems, resetProblems,
} from "./harness.mjs";

const LATENCY = 150;
const MAX_FIRST_SCREEN_DEPTH = 3; // document, then everything it preloads (+1 slack for late extras like icons)
const preloadedInHtml = [...readFileSync(resolve(ROOT, "index.html"), "utf8").matchAll(/<link rel="modulepreload" href="src\/([^"]+)"\/>/g)].map((match) => match[1]);
const { WORKSPACE_MODULES } = await import(pathToFileURL(resolve(ROOT, "src/module-preload-map.js")).href);
const READY = { em: "getEMState", signals: "getSignalsCourseState", "circuit-course": "getCircuitCourseState" };
const srcFile = (url) => new URL(url).pathname.match(/\/src\/([^/?]+\.js)$/)?.[1] ?? null;

/** Load `path` on a throttled phone and return every request sent up to the load event. */
async function phoneLoad(path) {
  await ctx.cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await ctx.cdp.send("Network.emulateNetworkConditions", { offline: false, latency: LATENCY, downloadThroughput: -1, uploadThroughput: -1 });
  const requests = new Map();
  let loaded = false;
  const off = ctx.cdp.on(({ method, params }) => {
    if (method === "Page.loadEventFired") loaded = true;
    if (loaded) return;
    if (method === "Network.requestWillBeSent" && /^https?:/.test(params.request.url)) requests.set(params.requestId, { url: params.request.url, sent: params.timestamp, done: null, type: params.type });
    if (method === "Network.loadingFinished" && requests.has(params.requestId)) requests.get(params.requestId).done = params.timestamp;
  });
  try { await navigate(path, { width: 390, height: 844, mobile: true }); } finally { off(); }
  return { requests: [...requests.values()].sort((a, b) => a.sent - b.sent) };
}

/** Sequential round trips: the document is 1, every later request is one deeper than the deepest finished before it. */
function waterfallDepth(requests) {
  const [document, ...rest] = requests;
  const level = new Map([[document, 1]]);
  for (const request of rest) {
    let deepest = 1;
    for (const [other, depth] of level) if (other.done !== null && other.done <= request.sent && depth > deepest) deepest = depth;
    level.set(request, deepest + 1);
  }
  return { depth: Math.max(...level.values()), level };
}

const modulepreloadLinks = () => ev(`[...document.querySelectorAll('link[rel="modulepreload"]')].map((link) => link.href)`);
const hrefsFor = (files) => files.map((file) => new URL(`src/${file}`, ctx.base + "/").href);

describe("phone loading path", { timeout: 300000 }, () => {
  before(async () => { await startServer(); await startBrowser(); });
  beforeEach(() => resetProblems());
  afterEach(async () => { await assertNoProblems("console/network"); });
  after(async () => {
    const startedPids = [ctx.edge?.pid, ctx.server?.pid].filter(Boolean);
    const stopped = await stopAll();
    for (const pid of new Set([...startedPids, ...stopped])) assert.equal(isAlive(pid), false, `process ${pid} should have been stopped`);
    assert.deepEqual(leftoverProcessIds(), [], "no process may still carry the throw-away Edge profile");
  });

  test("the first screen loads exactly the preloaded modules in a flat waterfall, without console problems", async () => {
    const { requests } = await phoneLoad("/");
    assert.ok(await ev(`document.querySelectorAll("#palette-list > *").length > 0 && typeof ${L}.getState === "function"`), "the editor is ready (palette drawn)");
    const scripts = requests.map((request) => srcFile(request.url)).filter(Boolean);
    assert.equal(new Set(scripts).size, scripts.length, "each module is requested once");
    assert.deepEqual(new Set(scripts), new Set(preloadedInHtml), "modules fetched for the first screen = index.html modulepreload list");
    const { depth, level } = waterfallDepth(requests);
    const deep = [...level].filter(([, value]) => value > 2).map(([request, value]) => `${value} ${request.url}`);
    assert.ok(depth <= MAX_FIRST_SCREEN_DEPTH, `first-screen waterfall depth ${depth} > ${MAX_FIRST_SCREEN_DEPTH}:\n${deep.join("\n")}`);
    for (const request of requests) if (srcFile(request.url)) assert.equal(level.get(request), 2, `${request.url} is requested right after the document`);
  });

  test("on Save-Data nothing is prefetched in the background, and hovering a tab preloads that workspace's whole list", async () => {
    // Save-Data switches the idle prefetch off, so whatever is preloaded afterwards comes from the hover intent.
    const { identifier } = await ctx.cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: "Object.defineProperty(navigator, 'connection', { value: { saveData: true }, configurable: true });" });
    try { await phoneLoad("/"); } finally { await ctx.cdp.send("Page.removeScriptToEvaluateOnNewDocument", { identifier }); }
    await ev("new Promise((done) => setTimeout(done, 2500))");
    const firstScreen = hrefsFor(preloadedInHtml);
    assert.deepEqual((await modulepreloadLinks()).filter((href) => !firstScreen.includes(href)), [], "no workspace modules without an intent");
    const tab = await center('[data-workspace-tab="signals"]');
    await moveTo(tab.x, tab.y);
    const links = await modulepreloadLinks();
    for (const href of hrefsFor(WORKSPACE_MODULES.signals)) assert.ok(links.includes(href), `hover preloads ${href}`);
    assert.ok(!links.includes(hrefsFor(WORKSPACE_MODULES.em)[0]), "other workspaces are left alone");
  });

  test("after load the idle prefetch preloads every workspace, and every workspace opens", async () => {
    await phoneLoad("/");
    const expected = hrefsFor(Object.values(WORKSPACE_MODULES).flat());
    await until(`(() => { const have = new Set([...document.querySelectorAll('link[rel="modulepreload"]')].map((link) => link.href)); return ${JSON.stringify(expected)}.every((href) => have.has(href)); })()`, "the idle workspace prefetch", 20000);
    for (const name of Object.keys(READY)) {
      await click(`[data-workspace-tab="${name}"]`);
      await until(`${L}.${READY[name]}() !== null && !document.querySelector("[data-workspace-loading]") && ${L}.getWorkspace() === ${JSON.stringify(name)}`, `the ${name} workspace`);
      const panel = name === "circuit-course" ? "circuit-course-workspace" : `${name}-workspace`;
      assert.equal(await ev(`document.getElementById(${JSON.stringify(panel)}).hidden`), false, `${name} panel is shown`);
      await click('[data-workspace-tab="circuit"]');
      assert.equal(await ev(`${L}.getWorkspace()`), "circuit");
    }
  });

  test("a direct link into a workspace still opens it", async () => {
    for (const name of Object.keys(READY)) {
      await phoneLoad(`/?workspace=${name}`);
      await until(`${L}.${READY[name]}() !== null && !document.querySelector("[data-workspace-loading]")`, `the ${name} workspace from ?workspace=`);
    }
  });
});
