// End-to-end smoke: real server + headless Edge driven over the Chrome DevTools Protocol.
// Node only (global fetch/WebSocket), no npm packages. Run with `npm run test:browser`.
//
// It starts `node server.mjs 0`, launches Edge with a throw-away profile, and walks the main
// user paths. Any console error, uncaught exception or failed request fails the scenario.
// If Edge cannot be found the test FAILS (set EDGE_PATH to override); it is never skipped.
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const L = "window.__CIRCUIT_LAB__";

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
  if (!found) {
    throw new Error(`Microsoft Edge was not found, so the browser smoke cannot run. Install Edge or set EDGE_PATH to the msedge executable. Looked in: ${candidates.join(", ")}`);
  }
  return found;
}

function killTree(child) {
  if (!child || child.exitCode !== null || !child.pid) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  else child.kill("SIGKILL");
}

function request(port, { method = "GET", path = "/", headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path, headers }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    req.end();
  });
}

class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.nextId = 0;
    this.pending = new Map();
    this.listeners = [];
  }
  async open() {
    await new Promise((resolve, reject) => { this.ws.onopen = resolve; this.ws.onerror = () => reject(new Error("DevTools socket failed")); });
    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) { this.pending.get(message.id)(message); this.pending.delete(message.id); }
      else for (const listener of this.listeners) listener(message);
    };
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      this.pending.set(id, (message) => (message.error ? reject(new Error(`${method}: ${message.error.message}`)) : resolve(message.result)));
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  on(listener) { this.listeners.push(listener); }
  close() { try { this.ws.close(); } catch { /* already closed */ } }
}

let server, edge, cdp, profile, base, port;
const problems = [];

async function startServer() {
  server = spawn(process.execPath, [join(ROOT, "server.mjs"), "0"], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let log = "";
  server.stdout.on("data", (chunk) => { log += chunk; });
  server.stderr.on("data", (chunk) => { log += chunk; });
  for (let n = 0; n < 100; n += 1) {
    const match = log.match(/http:\/\/127\.0\.0\.1:(\d+)/);
    if (match) { port = Number(match[1]); base = match[0]; return; }
    if (server.exitCode !== null) break;
    await sleep(100);
  }
  throw new Error(`server.mjs did not report a URL: ${log}`);
}

async function startBrowser() {
  const executable = findBrowser();
  profile = mkdtempSync(join(tmpdir(), "circuit-lab-smoke-"));
  edge = spawn(executable, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-extensions",
    "--disable-background-networking", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank",
  ], { stdio: "ignore", windowsHide: true });
  let debugPort = null;
  for (let n = 0; n < 150 && debugPort === null; n += 1) {
    const file = join(profile, "DevToolsActivePort");
    if (existsSync(file)) debugPort = Number(readFileSync(file, "utf8").split(/\r?\n/)[0]);
    else await sleep(100);
  }
  assert.ok(debugPort, "Edge did not open a DevTools port");
  let page;
  for (let n = 0; n < 100 && !page; n += 1) {
    try { page = (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find((target) => target.type === "page"); } catch { /* not ready */ }
    if (!page) await sleep(100);
  }
  assert.ok(page, "Edge did not expose a page target");
  cdp = new Cdp(page.webSocketDebuggerUrl);
  await cdp.open();
  cdp.on(({ method, params }) => {
    if (method === "Runtime.consoleAPICalled" && ["error", "warning", "assert"].includes(params.type)) problems.push(`console.${params.type}: ${params.args.map((arg) => arg.value ?? arg.description).join(" ").slice(0, 300)}`);
    if (method === "Runtime.exceptionThrown") problems.push(`exception: ${params.exceptionDetails.exception?.description ?? params.exceptionDetails.text}`.slice(0, 400));
    if (method === "Log.entryAdded" && params.entry.level === "error") problems.push(`log: ${params.entry.text} ${params.entry.url ?? ""}`.slice(0, 300));
    if (method === "Network.loadingFailed" && !params.canceled) problems.push(`network failure: ${params.errorText} ${params.requestId}`);
  });
  for (const domain of ["Page", "Runtime", "Log", "Network", "DOM"]) await cdp.send(`${domain}.enable`);
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
}

// ---- page helpers --------------------------------------------------------------------------------------------
async function ev(expression) {
  const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(`evaluate failed: ${(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text).slice(0, 400)}\n${expression.slice(0, 200)}`);
  return result.result.value;
}
async function until(expression, what, ms = 15000) {
  const started = Date.now();
  let last;
  while (Date.now() - started < ms) {
    try { last = await ev(expression); if (last) return last; } catch (error) { last = error.message; }
    await sleep(50);
  }
  assert.fail(`timed out waiting for ${what} (${String(last).slice(0, 200)})`);
}
async function navigate(path, { width = 1440, height = 900, mobile = false } = {}) {
  await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
  const loaded = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`page load timed out: ${path}`)), 30000);
    const listener = (message) => { if (message.method === "Page.loadEventFired") { clearTimeout(timer); cdp.listeners.splice(cdp.listeners.indexOf(listener), 1); resolve(); } };
    cdp.on(listener);
  });
  await cdp.send("Page.navigate", { url: base + path });
  await loaded;
  await until(`Boolean(${L})`, "the app to expose its debug hook");
  await sleep(150);
}
const state = () => ev(`${L}.getState()`);
async function clickPoint(x, y) {
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
  await sleep(100);
}
async function center(selector) {
  const point = await ev(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; e.scrollIntoView({ block: "nearest", inline: "nearest" }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height }; })()`);
  assert.ok(point && point.w > 0 && point.h > 0, `missing or hidden element: ${selector}`);
  return point;
}
async function click(selector) { await sleep(60); const point = await center(selector); await clickPoint(point.x, point.y); }
const pin = (id, index) => `.component[data-id="${id}"] .pin[data-pin="${index}"]`;
async function select(selector, value) {
  const applied = await ev(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event("change", { bubbles: true })); return e.value; })()`);
  assert.equal(applied, value, `${selector} should accept ${value}`);
}
async function press(key, code, vk, modifiers = 0) {
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: vk, modifiers });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk, modifiers });
  await sleep(60);
}
async function runAnalysis(kind) {
  await select("#analysis-intent", kind);
  await click("#run-button");
  await until(`${L}.getState().runState.status === "success" && ${L}.getState().result.analysis === ${JSON.stringify(kind)}`, `${kind} analysis to succeed`);
}
function nodeValue(result, pointIndex, componentId, pinIndex) {
  return result.points[pointIndex].nodeVoltages[result.topology.nodeIdByPin[`${componentId}:${pinIndex}`]];
}
function noProblems(label) {
  const found = problems.splice(0);
  assert.deepEqual(found, [], `${label}: console/network problems`);
}

// ---- scenarios ---------------------------------------------------------------------------------------------
describe("browser smoke", { timeout: 240000 }, () => {
  before(async () => { await startServer(); await startBrowser(); });
  after(async () => {
    const started = [edge?.pid, server?.pid].filter(Boolean);
    cdp?.close();
    killTree(edge);
    killTree(server);
    server?.stdout?.destroy(); server?.stderr?.destroy();
    await sleep(500);
    if (profile) { try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* profile is in the OS temp directory */ } }
    for (const pid of started) assert.throws(() => process.kill(pid, 0), /ESRCH/, `process ${pid} should have been stopped`);
  });

  test("server serves only the app, with security headers", async () => {
    const index = await request(port);
    assert.equal(index.status, 200);
    assert.equal(index.headers["x-content-type-options"], "nosniff");
    assert.match(index.headers["content-security-policy"], /frame-ancestors 'none'/);
    assert.equal((await request(port, { path: "/src/app.js" })).status, 200);
    assert.equal((await request(port, { method: "HEAD" })).body.length, 0);
    assert.equal((await request(port, { method: "POST" })).status, 405);
    for (const path of ["/package.json", "/README.md", "/tests/fixtures/mixed-probe-units.json", "/%2e%2e/server.mjs", "/%zz"]) assert.equal((await request(port, { path })).status, 404, path);
    assert.equal((await request(port, { headers: { Host: "unrelated.example" } })).status, 403, "non-loopback Host is refused");
  });

  test("default editor loads without console errors", async () => {
    await navigate("/");
    const loaded = await state();
    assert.ok(Array.isArray(loaded.circuit.components));
    assert.equal(await ev(`document.documentElement.scrollWidth <= innerWidth + 1`), true, "no horizontal page overflow");
    assert.equal(await ev(`[${L}.getEMState(), ${L}.getCircuitCourseState(), ${L}.getSignalsCourseState()].every((value) => value === null)`), true, "heavy workspaces are not loaded yet");
    noProblems("default editor");
  });

  test("transient: RLC example runs and draws a probe trace that matches the closed form", async () => {
    await navigate("/?example=rlc");
    assert.equal((await state()).circuit.components.length, 5);
    await runAnalysis("transient");
    const { result, probes } = await state();
    assert.ok(probes.length >= 1, "the example ships a probe");
    // Series RLC step: v_C(t) = 1 - e^{-at}(cos wd t + (a/wd) sin wd t), a = R/2L, wd = sqrt(1/LC - a^2).
    const a = 100 / (2 * 0.01), wd = Math.sqrt(1 / (0.01 * 1e-6) - a * a);
    const index = result.xValues.reduce((best, value, i) => (Math.abs(value - 1e-4) < Math.abs(result.xValues[best] - 1e-4) ? i : best), 0);
    const t = result.xValues[index];
    const expected = 1 - Math.exp(-a * t) * (Math.cos(wd * t) + (a / wd) * Math.sin(wd * t));
    assert.ok(Math.abs(nodeValue(result, index, "C1", 0) - expected) < 0.01, `v_C(${t}) = ${nodeValue(result, index, "C1", 0)} vs ${expected}`);
    await until(`document.querySelectorAll("#wave-plot path.plot-line").length > 0`, "a waveform path");
    assert.equal(await ev(`!document.getElementById("csv-button").disabled`), true, "CSV export is enabled after a result");
    noProblems("transient");
  });

  test("ac: sweep succeeds and the result pane shows phasor vectors", async () => {
    await navigate("/?example=rc-lowpass");
    await runAnalysis("ac");
    const { result, settings } = await state();
    assert.equal(result.analysis, "ac");
    assert.ok(result.points.length > 10);
    await click("#results-tab");
    await until(`!document.getElementById("phasor-panel").hidden`, "the phasor panel");
    await until(`document.getElementById("phasor-validity").dataset.status === "ready"`, "phasor validity ready");
    await until(`document.querySelectorAll("#voltage-phasor-plot .phasor-arrow").length > 0`, "phasor arrows");
    // |V(C1)| = 1 / sqrt(1 + (2 pi f R C)^2) for the 1 V, 1 kOhm, 1 uF example, at the single phasor frequency.
    const { phasorResult } = await state();
    assert.equal(phasorResult.points.length, 1);
    const frequency = phasorResult.frequency;
    const output = nodeValue(phasorResult, 0, "C1", 0);
    const expected = 1 / Math.sqrt(1 + (2 * Math.PI * frequency * 1e3 * 1e-6) ** 2);
    assert.ok(Math.abs(Math.hypot(output.re, output.im) - expected) < 1e-9, `|V(C1)| at ${frequency} Hz`);
    assert.ok(Math.abs(Math.atan2(output.im, output.re) + Math.atan(2 * Math.PI * frequency * 1e-3)) < 1e-9, "phase lag");
    assert.ok(settings.analysis === "ac");
    noProblems("ac");
  });

  test("port: divider Thevenin equivalent is 5 V behind 500 ohm", async () => {
    await navigate("/?example=divider");
    await click("#results-tab");
    await click('[data-result-view="port"]');
    await until(`!document.getElementById("port-panel").hidden`, "the port panel");
    await click("#port-p-button");
    await click(pin("R2", 0));
    await click("#port-n-button");
    await click(pin("G1", 0));
    await until(`!document.getElementById("port-run-button").disabled`, "port run to be enabled");
    await click("#port-run-button");
    await until(`document.getElementById("port-result").innerText.includes("Vth")`, "the port result text");
    const { port } = await state();
    const equivalent = port.result.equivalent;
    assert.ok(Math.abs(equivalent.vth.value - 5) < 1e-9, `Vth ${equivalent.vth.value}`);
    assert.ok(Math.abs(equivalent.rth.value - 500) < 1e-6, `Rth ${equivalent.rth.value}`);
    noProblems("port");
  });

  test("editing: delete, undo, redo, keyboard shortcuts and the history cap", async () => {
    await navigate("/?example=divider");
    await click("[data-tool=\"select\"]");
    await click('.component[data-id="R1"] .component-hit, .component[data-id="R1"]');
    assert.equal((await state()).selected?.id, "R1");
    await click("#delete-button");
    assert.equal((await state()).circuit.components.some((c) => c.id === "R1"), false);
    await click("#undo-button");
    assert.equal((await state()).circuit.components.some((c) => c.id === "R1"), true, "undo restores the part");
    await click("#redo-button");
    assert.equal((await state()).circuit.components.some((c) => c.id === "R1"), false, "redo deletes it again");
    await press("z", "KeyZ", 90, 2);
    assert.equal((await state()).circuit.components.some((c) => c.id === "R1"), true, "Ctrl+Z undoes");
    await press("y", "KeyY", 89, 2);
    assert.equal((await state()).circuit.components.some((c) => c.id === "R1"), false, "Ctrl+Y redoes");
    await press("z", "KeyZ", 90, 2);
    await click('.component[data-id="R2"] .component-hit, .component[data-id="R2"]');
    assert.equal((await state()).selected?.id, "R2");
    const before = (await state()).circuit.components.find((c) => c.id === "R2").rotation;
    await press("r", "KeyR", 82);
    assert.notEqual((await state()).circuit.components.find((c) => c.id === "R2").rotation, before, "R rotates the selection");
    // 110 more rotations, dispatched as key events inside the page (real key presses above prove the shortcut itself).
    await ev(`(() => { for (let n = 0; n < 110; n += 1) window.dispatchEvent(new KeyboardEvent("keydown", { key: "r", code: "KeyR", bubbles: true })); })()`);
    assert.ok((await state()).historyDepth <= 100, "undo history is capped at 100 entries");
    noProblems("editing");
  });

  test("drafts: discard keeps the committed value; Tab commits and stays in the inspector", async () => {
    await navigate("/?example=divider");
    await click('.component[data-id="R2"] .component-hit, .component[data-id="R2"]');
    await click("#inspector-tab");
    const depth = (await state()).historyDepth;
    await ev(`(() => { const e = document.querySelector('#inspector-content [data-prop="value"]'); e.focus(); e.value = "1e"; e.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    await until(`!document.getElementById("discard-drafts-button").classList.contains("hidden") && !document.getElementById("discard-drafts-button").hidden`, "the discard button");
    await click("#discard-drafts-button");
    await sleep(200);
    const after = await state();
    assert.equal(after.circuit.components.find((c) => c.id === "R2").props.value, "1k", "discard must not commit the draft");
    assert.equal(after.historyDepth, depth, "discard must not add an undo entry");
    assert.deepEqual(after.drafts, []);

    await click('.component[data-id="R2"] .component-hit, .component[data-id="R2"]');
    await ev(`(() => { const e = document.querySelector('#inspector-content [data-prop="ref"]'); e.focus(); e.value = "Rb"; e.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    await press("Tab", "Tab", 9);
    await sleep(250);
    assert.equal((await state()).circuit.components.find((c) => c.id === "R2").props.ref, "Rb", "Tab commits the edited reference");
    assert.equal(await ev(`Boolean(document.activeElement?.closest("#inspector-content"))`), true, "focus stays inside the inspector after the re-render");
    noProblems("drafts");
  });

  test("save and reopen round-trip through the file input", async () => {
    await navigate("/?example=rlc");
    await ev(`window.__blobs = []; URL.createObjectURL = (blob) => { window.__blobs.push(blob); return "blob:smoke"; }; window.__downloads = []; HTMLAnchorElement.prototype.click = function () { window.__downloads.push(this.download); };`);
    await click("#save-button");
    await until(`window.__blobs.length === 1 && window.__downloads.length === 1`, "a download");
    assert.match(await ev(`window.__downloads[0]`), /\.json$/);
    const saved = join(profile, "saved.json");
    writeFileSync(saved, await ev(`window.__blobs[0].text()`));
    await click("#new-button");
    assert.equal((await state()).circuit.components.length, 0);
    const { root } = await cdp.send("DOM.getDocument");
    const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector: "#file-input" });
    await cdp.send("DOM.setFileInputFiles", { files: [saved], nodeId });
    await until(`${L}.getState().circuit.components.length === 5`, "the project to be restored");
    noProblems("save/open");
  });

  test("help card opens and closes with Escape; theme toggles", async () => {
    await navigate("/");
    await click("#interaction-help summary");
    assert.equal(await ev(`document.getElementById("interaction-help").open`), true);
    assert.ok(await ev(`document.querySelectorAll(".interaction-help-card li").length`) <= 8, "help stays short");
    await press("Escape", "Escape", 27);
    assert.equal(await ev(`document.getElementById("interaction-help").open`), false);
    await select("#appearance", "light");
    assert.equal(await ev(`document.documentElement.dataset.theme`), "light");
    await select("#appearance", "dark");
    noProblems("help/theme");
  });

  test("EM workspace loads lazily and draws", async () => {
    await navigate("/");
    await click("#em-workspace-tab");
    await until(`${L}.getEMState()?.active === true`, "the EM workspace to activate");
    assert.equal(await ev(`${L}.getWorkspace()`), "em");
    assert.equal(await ev(`!document.getElementById("em-workspace").hidden && document.getElementById("workbench").inert`), true);
    assert.equal(await ev(`document.getElementById("em-canvas").width > 0 && !document.querySelector("#em-workspace .workspace-loading")`), true);
    assert.equal(await ev(`${L}.ensureWorkspace("em").then((controller) => typeof controller.inspect)`), "function");
    // New line sources must expose separated handles in whichever plane is being edited.
    const axesOf = { xy: [0, 1], xz: [0, 2], yz: [1, 2] };
    for (const plane of ["xy", "xz", "yz"]) {
      await select("#em-pg-plane", plane);
      for (const kind of ["finite", "infinite"]) {
        await click(`#em-pg-add-${kind}`);
        const playground = await ev(`${L}.getEMState().playground`);
        const source = playground.sources.find((item) => item.id === playground.selectedId);
        assert.equal(source.type, `${kind}-line`);
        const spread = kind === "finite" ? axesOf[plane].some((axis) => source.start[axis] !== source.end[axis]) : axesOf[plane].some((axis) => source.direction[axis] !== 0);
        assert.ok(spread, `${kind} line added in ${plane} has distinct handles`);
      }
    }
    // The EM course is a second lazy layer: it opens on demand and returns to the playground.
    assert.equal(await ev(`${L}.getEMState().course === null`), true, "EM course is not loaded before it is opened");
    await click("#em-course-open");
    await until(`${L}.getEMState().course?.active === true && Boolean(document.querySelector("#em-course-select"))`, "the EM course");
    await click("#em-course-back");
    await until(`${L}.getEMState().courseActive === false`, "return to the playground");
    noProblems("em");
  });

  test("signals workspace renders the convolution lesson", async () => {
    await navigate("/");
    await click("#signals-workspace-tab");
    await until(`${L}.getSignalsCourseState()?.active === true`, "the signals workspace");
    await until(`document.querySelectorAll("[data-signals-lesson]").length > 0`, "lesson buttons");
    await click('[data-signals-lesson="convolution"]');
    await until(`${L}.getSignalsCourseState().lessonId === "convolution"`, "the convolution lesson");
    const lesson = await ev(`${L}.getSignalsCourseState()`);
    assert.equal(lesson.symbolic.status, "supported");
    assert.equal(await ev(`${L}.getEMState()?.active ?? false`), false, "leaving a workspace deactivates it");
    noProblems("signals");
  });

  test("circuit course opens and lists its experiments", async () => {
    await navigate("/");
    await click("#circuit-course-open");
    await until(`${L}.getCircuitCourseState()?.active === true && document.querySelectorAll("#circuit-course-host [data-circuit-course-experiment]").length > 0`, "the circuit course");
    assert.equal(await ev(`document.getElementById("workbench").hidden`), true);
    // Problem worksheet: 100 V across 3 ohm + j(2 pi 50 12.7324 mH = 4 ohm) is 100 / 5 = 20 A.
    await click('[data-circuit-course-experiment="problem"]');
    const field = (key) => `#circuit-course-host [data-circuit-course-key="${key}"]`;
    const set = (key, value) => ev(`(() => { const e = document.querySelector(${JSON.stringify(field(key))}); e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    const typeInto = async (key, text) => { await click(field(key)); await press("a", "KeyA", 65, 2); await cdp.send("Input.insertText", { text }); await sleep(50); };
    await set("elements", "RL");
    await set("singleGoal", "current");
    await set("solutionMode", "numeric");
    await click("#circuit-course-host [data-circuit-course-apply]");
    assert.equal(await ev(`${L}.getCircuitCourseState().result.status`), "invalid", "blank numeric conditions are rejected");
    await typeInto("voltage", "100 V");
    await typeInto("frequencyHz", "50 Hz");
    await typeInto("r", "3 Ω");
    await typeInto("l", "12.732395447351627 mH");
    await click("#circuit-course-host [data-circuit-course-apply]");
    const answer = await ev(`${L}.getCircuitCourseState().result.solution.answers[0].value`);
    assert.ok(Math.abs(answer - 20) < 1e-9, `numeric current ${answer}`);
    await click("#circuit-course-back");
    await until(`!document.getElementById("workbench").hidden && document.getElementById("circuit-course-shell").hidden`, "the editor to return");
    noProblems("circuit course");
  });

  test("phone layout (390x844): one panel at a time, transient and AC still run", async () => {
    await navigate("/?example=rc-charge", { width: 390, height: 844, mobile: true });
    assert.equal(await ev(`document.documentElement.scrollWidth <= innerWidth + 1`), true, "no horizontal page overflow");
    const visible = await ev(`["palette-panel", "inspector-panel", "results-panel", "wave-panel"].filter((id) => { const e = document.getElementById(id); return e && !e.hidden && !e.inert && e.getClientRects().length > 0; })`);
    assert.equal(visible.length, 1, `exactly one panel is shown on a phone, got ${visible}`);
    await runAnalysis("transient");
    await click('.view-tabs [data-view="wave"]');
    await until(`document.querySelectorAll("#wave-plot path.plot-line").length > 0`, "a waveform on the phone");
    await runAnalysis("ac");
    await click('.view-tabs [data-view="results"]');
    await until(`!document.getElementById("phasor-panel").hidden`, "the phasor pane on the phone");
    assert.equal(await ev(`document.documentElement.scrollWidth <= innerWidth + 1`), true, "still no overflow after results");
    noProblems("phone");
  });
});
