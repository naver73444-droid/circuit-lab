// Browser-smoke harness: real server + headless Edge driven over the Chrome DevTools Protocol.
// Node only (global fetch/WebSocket, Node >= 22), no npm packages.
//
// Safety rules baked in:
//  - Edge always runs with a throw-away --user-data-dir. Cleanup finds the browser process tree by that
//    directory (never by image name), kills it even if the launcher process already exited, and verifies it is gone.
//  - CIRCUIT_LAB_ROOT points the server at another checkout (e.g. a mutated scratch copy); default is this repo.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(process.env.CIRCUIT_LAB_ROOT || fileURLToPath(new URL("../../", import.meta.url)));
export const L = "window.__CIRCUIT_LAB__";
export const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

// ---- process management ------------------------------------------------------------------------------------------
function findBrowser() {
  if (process.env.EDGE_PATH) {
    if (existsSync(process.env.EDGE_PATH)) return process.env.EDGE_PATH;
    throw new Error(`EDGE_PATH is set to ${process.env.EDGE_PATH}, but that file does not exist, so the browser smoke cannot run.`);
  }
  const candidates = [
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/usr/bin/microsoft-edge", "/usr/bin/microsoft-edge-stable",
  ];
  const found = candidates.find((path) => existsSync(path));
  if (!found) throw new Error(`Microsoft Edge was not found, so the browser smoke cannot run. Install Edge or set EDGE_PATH to the msedge executable. Looked in: ${candidates.join(", ")}`);
  return found;
}

/** Every live process whose command line mentions `dir` (our unique temp profile). Never matches by image name. */
function processIdsUsing(dir) {
  if (!dir) return [];
  let output = "";
  if (process.platform === "win32") {
    const script = "Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -and $_.CommandLine.Contains($env:SMOKE_PROFILE_DIR) } | ForEach-Object { $_.ProcessId }";
    output = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", windowsHide: true, env: { ...process.env, SMOKE_PROFILE_DIR: dir }, timeout: 20000 }).stdout ?? "";
  } else {
    output = spawnSync("pgrep", ["-f", "--", dir], { encoding: "utf8", timeout: 10000 }).stdout ?? "";
  }
  return output.split(/\s+/).map(Number).filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid);
}

function killPid(pid) {
  if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  else { try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ } }
}

export function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === "EPERM"; }
}

/** Kill the Edge tree (launcher child and anything carrying our profile) and wait until nothing is left. */
function killBrowserTree(child, dir) {
  const targets = new Set([...(child?.pid ? [child.pid] : []), ...processIdsUsing(dir)]);
  for (const pid of targets) killPid(pid);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const left = processIdsUsing(dir);
    if (!left.length) return [...targets];
    for (const pid of left) { targets.add(pid); killPid(pid); }
    spawnSync(process.execPath, ["-e", "setTimeout(()=>{},200)"]);
  }
  return [...targets];
}

function killServer(child) {
  if (child?.pid) killPid(child.pid);
}

// ---- CDP --------------------------------------------------------------------------------------------------------------
export class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.nextId = 0;
    this.pending = new Map();
    this.listeners = new Set();
    this.failure = null;
  }
  async open() {
    await new Promise((resolveOpen, reject) => {
      this.ws.onopen = resolveOpen;
      this.ws.onerror = () => reject(new Error("DevTools socket failed to open"));
    });
    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      const entry = message.id ? this.pending.get(message.id) : null;
      if (entry) { this.pending.delete(message.id); clearTimeout(entry.timer); entry.settle(message); }
      else for (const listener of [...this.listeners]) listener(message);
    };
    this.ws.onclose = () => this.#fail(new Error("DevTools socket closed"));
    this.ws.onerror = () => this.#fail(new Error("DevTools socket error"));
  }
  #fail(error) {
    this.failure ??= error;
    for (const [id, entry] of this.pending) { this.pending.delete(id); clearTimeout(entry.timer); entry.reject(error); }
  }
  send(method, params = {}, timeoutMs = 15000) {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolveSend, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method}: no response within ${timeoutMs} ms`)); }, timeoutMs);
      const settle = (message) => (message.error ? reject(new Error(`${method}: ${message.error.message}`)) : resolveSend(message.result));
      this.pending.set(id, { settle, reject, timer });
      try { this.ws.send(JSON.stringify({ id, method, params })); } catch (error) { this.pending.delete(id); clearTimeout(timer); reject(error); }
    });
  }
  /** Subscribe to protocol events; returns the unsubscribe function. */
  on(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  close() { try { this.ws.close(); } catch { /* already closed */ } }
}

// ---- shared harness state ------------------------------------------------------------------------------------------
export const ctx = { server: null, edge: null, cdp: null, profile: null, base: "", port: 0, serverLog: "", debugPort: 0 };
export const problems = [];
let cleanedUp = false;

export function request(port, { method = "GET", path = "/", headers = {} } = {}) {
  return new Promise((resolveRequest, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path, headers }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolveRequest({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    req.end();
  });
}

export async function startServer() {
  ctx.server = spawn(process.execPath, [join(ROOT, "server.mjs"), "0"], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  ctx.server.stdout.on("data", (chunk) => { ctx.serverLog += chunk; });
  ctx.server.stderr.on("data", (chunk) => { ctx.serverLog += chunk; });
  for (let n = 0; n < 100; n += 1) {
    const match = ctx.serverLog.match(/http:\/\/127\.0\.0\.1:(\d+)/);
    if (match) { ctx.port = Number(match[1]); ctx.base = match[0]; return; }
    if (ctx.server.exitCode !== null) break;
    await sleep(100);
  }
  throw new Error(`server.mjs did not report a URL: ${ctx.serverLog}`);
}

/** `args`: extra Edge command-line switches (e.g. the load-time measurement trusts its local TLS certificate). */
export async function startBrowser({ args = [] } = {}) {
  const executable = findBrowser();
  ctx.profile = mkdtempSync(join(tmpdir(), "circuit-lab-smoke-"));
  ctx.edge = spawn(executable, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-extensions",
    "--disable-background-networking", "--remote-debugging-port=0", `--user-data-dir=${ctx.profile}`, ...args, "about:blank",
  ], { stdio: "ignore", windowsHide: true });
  let debugPort = 0;
  for (let n = 0; n < 200 && !debugPort; n += 1) {
    const file = join(ctx.profile, "DevToolsActivePort");
    if (existsSync(file)) {
      // The file is created before it is filled in: only accept a complete, numeric first line.
      const first = readFileSync(file, "utf8").split(/\r?\n/)[0].trim();
      if (/^\d+$/.test(first) && Number(first) > 0) debugPort = Number(first);
    }
    if (!debugPort) await sleep(100);
  }
  assert.ok(debugPort, "Edge did not open a DevTools port");
  let page;
  for (let n = 0; n < 100 && !page; n += 1) {
    try { page = (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find((target) => target.type === "page"); } catch { /* not ready */ }
    if (!page) await sleep(100);
  }
  assert.ok(page, "Edge did not expose a page target");
  ctx.debugPort = debugPort;
  ctx.cdp = new Cdp(page.webSocketDebuggerUrl);
  await ctx.cdp.open();
  watchProblems(ctx.cdp);
  await enableDomains(ctx.cdp);
}

/** Record console errors, uncaught exceptions and failed requests of one page into the shared problem list. */
function watchProblems(cdp) {
  cdp.on(({ method, params }) => {
    if (method === "Runtime.consoleAPICalled" && ["error", "warning", "assert"].includes(params.type)) problems.push(`console.${params.type}: ${params.args.map((arg) => arg.value ?? arg.description).join(" ").slice(0, 300)}`);
    if (method === "Runtime.exceptionThrown") problems.push(`exception: ${params.exceptionDetails.exception?.description ?? params.exceptionDetails.text}`.slice(0, 400));
    if (method === "Log.entryAdded" && params.entry.level === "error") problems.push(`log: ${params.entry.text} ${params.entry.url ?? ""}`.slice(0, 300));
    if (method === "Network.loadingFailed" && !params.canceled) problems.push(`network failure: ${params.errorText} ${params.requestId}`);
  });
}

async function enableDomains(cdp) {
  for (const domain of ["Page", "Runtime", "Log", "Network", "DOM"]) await cdp.send(`${domain}.enable`);
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
}

/**
 * A second page (tab) in the same browser context, so it shares localStorage with the first but has its own sessionStorage.
 * Drive it with the usual helpers inside `await tab.run(async () => { ... })`: they talk to whichever page is current.
 */
export async function openTab(url = "about:blank") {
  const target = await (await fetch(`http://127.0.0.1:${ctx.debugPort}/json/new?${encodeURIComponent(url)}`, { method: "PUT" })).json();
  const cdp = new Cdp(target.webSocketDebuggerUrl);
  await cdp.open();
  watchProblems(cdp);
  await enableDomains(cdp);
  return {
    cdp,
    async run(work) {
      const previous = ctx.cdp;
      ctx.cdp = cdp;
      try { return await work(); } finally { ctx.cdp = previous; }
    },
    async close() {
      cdp.close();
      try { await fetch(`http://127.0.0.1:${ctx.debugPort}/json/close/${target.id}`); } catch { /* the browser is going away anyway */ }
    },
  };
}

/** Idempotent. Returns the PIDs that were stopped so the caller can assert they are gone. */
export async function stopAll() {
  if (cleanedUp) return [];
  cleanedUp = true;
  ctx.cdp?.close();
  const stopped = killBrowserTree(ctx.edge, ctx.profile);
  if (ctx.server?.pid) stopped.push(ctx.server.pid);
  killServer(ctx.server);
  ctx.server?.stdout?.destroy(); ctx.server?.stderr?.destroy();
  await sleep(300);
  if (ctx.profile) { try { rmSync(ctx.profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* lives in the OS temp directory */ } }
  return stopped;
}

// Last line of defence if the test process dies before after() ran (Ctrl+C, crash, runner timeout).
function exitCleanup() {
  if (cleanedUp) return;
  cleanedUp = true;
  killBrowserTree(ctx.edge, ctx.profile);
  killServer(ctx.server);
  if (ctx.profile) { try { rmSync(ctx.profile, { recursive: true, force: true }); } catch { /* best effort */ } }
}
process.on("exit", exitCleanup);
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { exitCleanup(); process.exit(130); });

/** Resolve the profile-scoped leftovers check for after(): nothing may still carry our profile directory. */
export const leftoverProcessIds = () => processIdsUsing(ctx.profile);

// ---- page helpers --------------------------------------------------------------------------------------------------
export async function ev(expression) {
  const result = await ctx.cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(`evaluate failed: ${(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text).slice(0, 400)}\n${expression.slice(0, 200)}`);
  return result.result.value;
}

/** Poll a page expression until it is truthy. */
export async function until(expression, what, ms = 15000) {
  const started = Date.now();
  let last;
  while (Date.now() - started < ms) {
    try { last = await ev(expression); if (last) return last; } catch (error) { last = error.message; }
    await sleep(40);
  }
  assert.fail(`timed out waiting for ${what} (${String(last).slice(0, 200)})`);
}

/** Poll a Node-side predicate (it may call the helpers above). */
export async function waitFor(predicate, what, ms = 15000) {
  const started = Date.now();
  let last;
  while (Date.now() - started < ms) {
    try { last = await predicate(); if (last) return last; } catch (error) { last = error.message; }
    await sleep(40);
  }
  assert.fail(`timed out waiting for ${what} (${String(last).slice(0, 200)})`);
}

/** Let queued events and the next two frames run, so the app has handled whatever was just dispatched. */
export const settle = () => ev(`new Promise((done) => { const t = setTimeout(done, 120); requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(t); done(); })); })`);

/** Flush protocol events then fail if the page logged anything since the last reset. */
export async function assertNoProblems(label = "page") {
  if (ctx.cdp && !ctx.cdp.failure) { try { await ev("0"); } catch { /* reported below by the test itself */ } }
  assert.deepEqual(problems.splice(0), [], `${label}: console/network problems`);
}
export const resetProblems = () => { problems.length = 0; };

export async function navigate(path, { width = 1440, height = 900, mobile = false } = {}) {
  const { cdp } = ctx;
  await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
  let off = () => {};
  const loaded = new Promise((resolveLoad, reject) => {
    const timer = setTimeout(() => reject(new Error(`page load timed out: ${path}`)), 30000);
    off = cdp.on((message) => { if (message.method === "Page.loadEventFired") { clearTimeout(timer); resolveLoad(); } });
  });
  try {
    await cdp.send("Page.navigate", { url: ctx.base + path });
    await loaded;
  } finally { off(); }
  await until(`Boolean(${L}) && document.readyState === "complete"`, "the app to expose its debug hook");
  if (/[?&]example=/.test(path)) await until(`${L}.getState().circuit.components.length > 0`, "the example to load");
  await settle();
}

export const state = () => ev(`${L}.getState()`);
export const component = async (id) => (await state()).circuit.components.find((item) => item.id === id);
export const pin = (id, index) => `.component[data-id="${id}"] .pin[data-pin="${index}"]`;
export const partSel = (id) => `.component[data-id="${id}"] .component-hit`;

const mouse = (type, x, y, extra = {}) => ctx.cdp.send("Input.dispatchMouseEvent", { type, x, y, ...extra });

/** Centre of the first match, scrolled into view; the element at that point must be the target or inside it. */
export async function center(selector, { allowCovered = false } = {}) {
  const point = await ev(`(() => {
    const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null;
    e.scrollIntoView({ block: "nearest", inline: "nearest" });
    const r = e.getBoundingClientRect(); const x = r.x + r.width / 2, y = r.y + r.height / 2;
    const hit = document.elementFromPoint(x, y);
    const describe = (n) => n ? (n.tagName.toLowerCase() + (n.id ? "#" + n.id : "") + (typeof n.className === "string" && n.className ? "." + n.className.trim().split(/\\s+/).join(".") : "")) : "nothing";
    return { x, y, w: r.width, h: r.height, reachable: Boolean(hit && e.contains(hit)), hit: describe(hit) };
  })()`);
  assert.ok(point && (point.w > 0 || point.h > 0), `missing or hidden element: ${selector}`);
  assert.ok(allowCovered || point.reachable, `a click on ${selector} would land on <${point.hit}>, not on the element`);
  return point;
}

/** Modifier bits for Input.dispatch*Event: Alt 1, Ctrl 2, Meta 4, Shift 8. */
export const MOD = { alt: 1, ctrl: 2, meta: 4, shift: 8 };

export async function clickAt(x, y, { clickCount = 1, modifiers = 0 } = {}) {
  await mouse("mouseMoved", x, y, { modifiers });
  await mouse("mousePressed", x, y, { button: "left", buttons: 1, clickCount, modifiers });
  await mouse("mouseReleased", x, y, { button: "left", buttons: 0, clickCount, modifiers });
}
/** Move the real mouse (no buttons) and let the app handle the resulting events. */
export async function moveTo(x, y) { await mouse("mouseMoved", x, y); await settle(); }
/** One real wheel notch at a point (negative deltaY = away from the user). The pointer is moved there first. */
export async function wheelAt(x, y, deltaY, modifiers = 0) {
  await mouse("mouseMoved", x, y);
  await ctx.cdp.send("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: 0, deltaY, modifiers });
}
export async function click(selector, options) { const p = await center(selector, options); await clickAt(p.x, p.y); await settle(); }
/** Two real clicks in a row; the second carries clickCount 2 so the browser raises dblclick. */
export async function dblclick(selector, options) {
  const p = await center(selector, options);
  await clickAt(p.x, p.y, { clickCount: 1 });
  await clickAt(p.x, p.y, { clickCount: 2 });
  await settle();
}
/** A point on a part's body: the middle of its hit line, which must really belong to that part (not a pin or label). */
export async function partPoint(id) {
  const point = await ev(`(() => {
    const e = document.querySelector(${JSON.stringify(partSel(id))}); if (!e) return null;
    e.scrollIntoView({ block: "nearest", inline: "nearest" });
    const r = e.getBoundingClientRect(); const x = r.x + r.width / 2, y = r.y + r.height / 2;
    const hit = document.elementFromPoint(x, y);
    const owner = hit?.closest(".component");
    const bad = hit?.closest(".pin, .pin-hit, .value-label, .component-delete");
    return { x, y, ok: owner?.dataset.id === ${JSON.stringify(id)} && !bad, hit: hit ? hit.tagName + "." + (hit.getAttribute("class") ?? "") : "nothing" };
  })()`);
  assert.ok(point, `missing part ${id}`);
  assert.ok(point.ok, `the middle of ${id} is covered by <${point.hit}>`);
  return point;
}
export async function clickPart(id) { const p = await partPoint(id); await clickAt(p.x, p.y); await settle(); }
/** Real mouse drag of a part with intermediate moves; returns after the release. */
export async function dragPart(id, dx, dy, { steps = 4 } = {}) {
  const p = await partPoint(id);
  await mouse("mouseMoved", p.x, p.y);
  await mouse("mousePressed", p.x, p.y, { button: "left", buttons: 1, clickCount: 1 });
  for (let step = 1; step <= steps; step += 1) await mouse("mouseMoved", p.x + (dx * step) / steps, p.y + (dy * step) / steps, { buttons: 1 });
  await mouse("mouseReleased", p.x + dx, p.y + dy, { button: "left", buttons: 0, clickCount: 1 });
  await settle();
}
export async function press(key, code, vk, modifiers = 0) {
  await ctx.cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: vk, modifiers });
  await ctx.cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk, modifiers });
  await settle();
}
/** Focus a field with a real click, select its text and type over it with real text input. */
export async function typeInto(selector, text) {
  await click(selector);
  await press("a", "KeyA", 65, 2);
  await ctx.cdp.send("Input.insertText", { text });
  await settle();
}
export async function select(selector, value) {
  const applied = await ev(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event("change", { bubbles: true })); return e.value; })()`);
  assert.equal(applied, value, `${selector} should accept ${value}`);
  await settle();
}
export async function runAnalysis(kind) {
  await select("#analysis-intent", kind);
  await click("#run-button");
  await until(`${L}.getState().runState.status === "success" && ${L}.getState().result.analysis === ${JSON.stringify(kind)}`, `${kind} analysis to succeed`);
}
export function nodeValue(result, pointIndex, componentId, pinIndex) {
  return result.points[pointIndex].nodeVoltages[result.topology.nodeIdByPin[`${componentId}:${pinIndex}`]];
}

// ---- extra helpers for the feature scenarios ------------------------------------------------------------------------
/** Screen point inside the waveform plot area, as fractions (0..1) of the plot width/height. Needs a result on screen. */
export async function plotPoint(fx, fy = 0.5) {
  const point = await ev(`(() => {
    const svg = document.getElementById("wave-plot"); const g = ${L}.getState().scope.geometry; const m = svg.getScreenCTM();
    if (!g || !m) return null;
    const p = new DOMPoint(g.left + g.plotWidth * ${fx}, g.top + g.plotHeight * ${fy}).matrixTransform(m);
    return { x: p.x, y: p.y };
  })()`);
  assert.ok(point, "the waveform plot has no geometry yet (no result on screen?)");
  return point;
}

/** An empty spot of the circuit canvas (the element under it is the background rect). Searched from the lower right corner, or from the upper left one with { from: "top-left" }. */
export async function bgPoint({ from = "bottom-right" } = {}) {
  const point = await ev(`(() => {
    const r = document.getElementById("circuit-canvas").getBoundingClientRect(); const topLeft = ${JSON.stringify(from)} === "top-left";
    for (let row = 0; row < 12; row += 1) for (let col = 0; col < 16; col += 1) {
      const dx = 14 + col * (r.width - 28) / 16, dy = 10 + row * (r.height - 20) / 12;
      const x = topLeft ? r.left + dx : r.right - dx, y = topLeft ? r.top + dy : r.bottom - dy;
      if (document.elementFromPoint(x, y)?.classList.contains("canvas-bg")) return { x, y };
    }
    return null;
  })()`);
  assert.ok(point, "no empty canvas background point is visible");
  return point;
}

/** The pin dot of a part; the element under that point must be that very pin (or its hit disc). */
export async function pinTip(id, index) {
  const point = await ev(`(() => {
    const e = document.querySelector(${JSON.stringify(pin(id, index))}); if (!e) return null;
    const r = e.getBoundingClientRect(); const x = r.x + r.width / 2, y = r.y + r.height / 2;
    const hit = document.elementFromPoint(x, y)?.closest(".pin, .pin-hit");
    return { x, y, ok: Boolean(hit && hit.closest(".component")?.dataset.id === ${JSON.stringify(id)} && Number(hit.dataset.pin) === ${index}) };
  })()`);
  assert.ok(point, `missing pin ${id}:${index}`);
  assert.ok(point.ok, `the tip of pin ${id}:${index} is covered by something else`);
  return point;
}

/**
 * Real mouse drag between two screen points (optionally with modifier keys held). `beforeRelease` runs after the last move and before the
 * button goes up, so a test can look at what the app shows mid-gesture (a marquee box, a wire preview).
 */
export async function dragBetween(from, to, { steps = 6, modifiers = 0, beforeRelease = null } = {}) {
  await mouse("mouseMoved", from.x, from.y, { modifiers });
  await mouse("mousePressed", from.x, from.y, { button: "left", buttons: 1, clickCount: 1, modifiers });
  for (let step = 1; step <= steps; step += 1) await mouse("mouseMoved", from.x + ((to.x - from.x) * step) / steps, from.y + ((to.y - from.y) * step) / steps, { buttons: 1, modifiers });
  await settle();
  if (beforeRelease) await beforeRelease();
  await mouse("mouseReleased", to.x, to.y, { button: "left", buttons: 0, clickCount: 1, modifiers });
  await settle();
}

/** One-finger touch drag with real Input.dispatchTouchEvent input (pointerType "touch" in the page). */
export async function touchDrag(from, to, { steps = 6 } = {}) {
  const touch = (type, touchPoints) => ctx.cdp.send("Input.dispatchTouchEvent", { type, touchPoints });
  await touch("touchStart", [{ x: from.x, y: from.y }]);
  for (let step = 1; step <= steps; step += 1) await touch("touchMove", [{ x: from.x + ((to.x - from.x) * step) / steps, y: from.y + ((to.y - from.y) * step) / steps }]);
  await settle();
  await touch("touchEnd", []);
  await settle();
}
