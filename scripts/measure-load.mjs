// Phone load-time measurement: headless Edge (throw-away profile, see tests/browser/harness.mjs) in 390x844 mobile
// emulation with DevTools network throttling and 4x CPU slowdown.
//
// For each run it opens a fresh browser context (empty cache, new connections) and records:
//   - FCP (first-contentful-paint)
//   - editor ready: the frame after the app published window.__CIRCUIT_LAB__ (palette drawn, handlers attached,
//     so the first part can be placed)
//   - first-screen requests / transferred bytes / waterfall depth (requests sent before editor ready)
//   - the first switch into each lazy workspace (전자기·신호·과정), tapped 2 s after the load event
// then reloads the same URL in the same context (revisit) and records the same numbers again.
//
// Waterfall depth counts sequential round trips: the document is 1, and every other request is one deeper than the
// deepest request (or the document) that had finished before it was sent.
//
// Usage:
//   node scripts/measure-load.mjs [--target local|pages|<https url>] [--root <dir>] [--runs 3]
//                                 [--profiles slow4g,fast4g] [--revalidate] [--json <file>] [--verbose]
// --target local (default) serves --root (default: this checkout) over HTTPS/HTTP2 with gzip, ETag and
//   Cache-Control: max-age=600 like GitHub Pages; --revalidate serves no-cache instead (revisit = 304 for every file).
// --target pages measures https://naver73444-droid.github.io/circuit-lab/ (read only).
// --verbose prints each first-screen request (sent -> finished, ms from navigation start) of every cold run.
// Note: DevTools throttling splits the bandwidth evenly between open requests and ignores HTTP/2 priorities.
import { spawnSync } from "node:child_process";
import { createHash, X509Certificate } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http2 from "node:http2";
import { tmpdir } from "node:os";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { Cdp, ctx, sleep, startBrowser, stopAll } from "../tests/browser/harness.mjs";

const PAGES_URL = "https://naver73444-droid.github.io/circuit-lab/";
const PROFILES = {
  slow4g: { label: "Slow 4G", latency: 400, downloadThroughput: 1.6e6 / 8, uploadThroughput: 750e3 / 8 },
  fast4g: { label: "Fast 4G", latency: 150, downloadThroughput: 9e6 / 8, uploadThroughput: 1.5e6 / 8 },
};
const CPU_RATE = 4;
const WORKSPACES = { em: ["전자기", "getEMState"], signals: ["신호", "getSignalsCourseState"], "circuit-course": ["과정", "getCircuitCourseState"] };

function parseArgs(argv) {
  const options = { verbose: false, target: "local", root: fileURLToPath(new URL("../", import.meta.url)), runs: 3, profiles: ["slow4g", "fast4g"], revalidate: false, json: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const [key, inline] = argv[i].split("=");
    const value = () => inline ?? argv[++i];
    if (key === "--target") options.target = value();
    else if (key === "--root") options.root = resolve(value());
    else if (key === "--runs") options.runs = Math.max(1, Number(value()) || 1);
    else if (key === "--profiles") options.profiles = value().split(",").filter((name) => PROFILES[name]);
    else if (key === "--revalidate") options.revalidate = true;
    else if (key === "--verbose") options.verbose = true;
    else if (key === "--json") options.json = resolve(value());
    else throw new Error(`unknown option ${argv[i]}`);
  }
  return options;
}

// ---- GitHub-Pages-like local server -----------------------------------------------------------------------------
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".webmanifest": "application/manifest+json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png" };

function findOpenssl() {
  const candidates = [process.env.OPENSSL, "openssl", "C:/Program Files/Git/mingw64/bin/openssl.exe", "C:/Program Files/Git/usr/bin/openssl.exe"].filter(Boolean);
  return candidates.find((command) => spawnSync(command, ["version"], { encoding: "utf8", windowsHide: true }).status === 0) ?? null;
}

function makeCertificate(dir) {
  const openssl = findOpenssl();
  if (!openssl) throw new Error("openssl was not found (set OPENSSL); the local HTTPS/HTTP2 server needs a throw-away certificate.");
  const key = join(dir, "key.pem"), cert = join(dir, "cert.pem");
  const result = spawnSync(openssl, ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes", "-keyout", key, "-out", cert,
    "-days", "2", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"], { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw new Error(`openssl failed: ${result.stderr}`);
  const pem = readFileSync(cert, "utf8");
  const spki = new X509Certificate(pem).publicKey.export({ type: "spki", format: "der" });
  return { key: readFileSync(key), cert: pem, spkiHash: createHash("sha256").update(spki).digest("base64") };
}

function startPagesLikeServer(root, tls, { revalidate }) {
  const cache = new Map();
  const realRoot = resolve(root);
  const server = http2.createSecureServer({ key: tls.key, cert: tls.cert, allowHTTP1: true }, (request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, "https://127.0.0.1").pathname);
    const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const allowed = ["index.html", "styles.css", "manifest.webmanifest"].includes(relative) || /^src\/[A-Za-z0-9_-]+\.js$/.test(relative) || /^icons\/[A-Za-z0-9_-]+\.(?:svg|png)$/.test(relative);
    const path = resolve(realRoot, relative);
    if (!allowed || !path.startsWith(realRoot + sep) || !existsSync(path)) { response.writeHead(404, { "content-type": "text/plain" }); response.end("not found"); return; }
    let entry = cache.get(path);
    if (!entry) {
      const body = readFileSync(path);
      const type = MIME[extname(path)] ?? "application/octet-stream";
      const gzip = /^(?:text|application\/manifest)/.test(type) ? gzipSync(body, { level: 9 }) : null;
      entry = { body, gzip, type, etag: `"${createHash("sha1").update(body).digest("hex").slice(0, 16)}"` };
      cache.set(path, entry);
    }
    const headers = { "content-type": entry.type, "cache-control": revalidate ? "no-cache" : "max-age=600", etag: entry.etag, vary: "Accept-Encoding" };
    if (request.headers["if-none-match"] === entry.etag) { response.writeHead(304, headers); response.end(); return; }
    const useGzip = entry.gzip && /\bgzip\b/.test(request.headers["accept-encoding"] ?? "");
    const body = useGzip ? entry.gzip : entry.body;
    response.writeHead(200, { ...headers, ...(useGzip ? { "content-encoding": "gzip" } : {}), "content-length": body.length });
    response.end(request.method === "HEAD" ? undefined : body);
  });
  return new Promise((resolveListen) => server.listen(0, "127.0.0.1", () => resolveListen({ server, url: `https://127.0.0.1:${server.address().port}/` })));
}

// ---- one measured page -------------------------------------------------------------------------------------------
const READY_MARKER = "__LOAD_PERF_READY__";
const PAGE_HOOK = `(() => {
  if (location.protocol === "about:") return;
  const perf = window.__LOAD_PERF__ = { hook: 0, ready: 0 };
  let value;
  Object.defineProperty(window, "__CIRCUIT_LAB__", { configurable: true, enumerable: true, get() { return value; }, set(next) {
    value = next;
    if (perf.hook) return;
    perf.hook = performance.now();
    requestAnimationFrame(() => setTimeout(() => { perf.ready = performance.now(); console.debug(${JSON.stringify(READY_MARKER)}); }, 0));
  } });
})();`;

async function browserSession() {
  const version = await (await fetch(`http://127.0.0.1:${ctx.debugPort}/json/version`)).json();
  const cdp = new Cdp(version.webSocketDebuggerUrl);
  await cdp.open();
  return cdp;
}

function eventWaiter(cdp, match, ms, what) {
  let off = () => {};
  const promise = new Promise((resolveEvent, reject) => {
    const timer = setTimeout(() => { off(); reject(new Error(`timed out (${ms} ms) waiting for ${what}`)); }, ms);
    off = cdp.on((message) => { if (match(message)) { clearTimeout(timer); off(); resolveEvent(message); } });
  });
  return promise;
}

async function evaluate(cdp, expression, timeout = 90000) {
  const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, timeout);
  if (result.exceptionDetails) throw new Error(`evaluate failed: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`);
  return result.result.value;
}

function switchExpression(name, getter) {
  return `(async () => {
    const L = window.__CIRCUIT_LAB__;
    const tab = document.querySelector('[data-workspace-tab="${name}"]');
    const t0 = performance.now();
    tab.dispatchEvent(new PointerEvent("pointerenter", { pointerType: "touch" }));
    tab.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "touch", isPrimary: true }));
    tab.click();
    await new Promise((done, fail) => {
      const limit = setTimeout(() => fail(new Error("workspace ${name} did not open")), 80000);
      const tick = () => {
        if (L.${getter}() && !document.querySelector("[data-workspace-loading]") && L.getWorkspace() === "${name}") { clearTimeout(limit); requestAnimationFrame(() => done()); }
        else requestAnimationFrame(tick);
      };
      tick();
    });
    return performance.now() - t0;
  })()`;
}

/** Load the URL once in `cdp` (already throttled) and return the numbers for that load. */
async function measureLoad(cdp, url, { tabs }) {
  const requests = new Map();
  const problems = [];
  const off = cdp.on(({ method, params }) => {
    if (method === "Network.requestWillBeSent") {
      if (/^(?:data|blob|about):/.test(params.request.url)) return;
      requests.set(params.requestId, { url: params.request.url, ts: params.timestamp, wall: params.wallTime * 1000, bytes: 0, done: null, cache: false, status: 0 });
    }
    const entry = params?.requestId ? requests.get(params.requestId) : null;
    if (!entry) {
      if (method === "Runtime.exceptionThrown") problems.push(params.exceptionDetails.exception?.description ?? params.exceptionDetails.text);
      if (method === "Runtime.consoleAPICalled" && params.type === "error") problems.push(params.args.map((arg) => arg.value ?? arg.description).join(" "));
      return;
    }
    if (method === "Network.requestServedFromCache") entry.cache = true;
    if (method === "Network.responseReceived") { entry.status = params.response.status; entry.protocol = params.response.protocol; if (params.response.fromDiskCache || params.response.fromPrefetchCache) entry.cache = true; }
    if (method === "Network.loadingFinished") { entry.done = entry.wall + (params.timestamp - entry.ts) * 1000; entry.bytes = params.encodedDataLength; }
    if (method === "Network.loadingFailed") { entry.done = entry.wall + (params.timestamp - entry.ts) * 1000; entry.failed = params.errorText; }
  });
  try {
    const ready = eventWaiter(cdp, ({ method, params }) => method === "Runtime.consoleAPICalled" && params.args?.[0]?.value === READY_MARKER, 120000, "editor ready");
    const loaded = eventWaiter(cdp, ({ method }) => method === "Page.loadEventFired", 120000, "load event");
    await cdp.send("Page.navigate", { url });
    await ready; await loaded;
    const page = await evaluate(cdp, `({ origin: performance.timeOrigin, fcp: performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? null,
      ready: window.__LOAD_PERF__.ready, hook: window.__LOAD_PERF__.hook, palette: document.querySelectorAll("#palette-list > *").length,
      load: performance.getEntriesByType("navigation")[0]?.loadEventStart ?? null })`);
    if (!page.palette) problems.push("palette is empty at editor ready");
    const all = [...requests.values()].map((entry) => ({ ...entry, sent: entry.wall - page.origin, end: entry.done === null ? null : entry.done - page.origin }));
    const first = all.filter((entry) => entry.sent <= page.ready).sort((a, b) => a.sent - b.sent);
    const documentEntry = first.find((entry) => entry.url.split("#")[0] === url) ?? first[0];
    const level = new Map([[documentEntry, 1]]);
    // Cache hits are not round trips; only network requests add depth.
    for (const entry of first) {
      if (entry === documentEntry || entry.cache) continue;
      let deepest = 1;
      for (const [other, otherLevel] of level) if (other.end !== null && other.end <= entry.sent && otherLevel > deepest) deepest = otherLevel;
      level.set(entry, deepest + 1);
    }
    const network = first.filter((entry) => !entry.cache);
    const result = {
      fcp: page.fcp, ready: page.ready, load: page.load,
      requests: first.length, networkRequests: network.length,
      bytes: network.reduce((sum, entry) => sum + entry.bytes, 0),
      depth: Math.max(...level.values()), protocol: documentEntry?.protocol ?? "",
      lastByte: Math.max(0, ...first.filter((entry) => !entry.cache && entry.end !== null).map((entry) => entry.end)),
      scripts: first.filter((entry) => /\/src\/[^/]+\.js(?:\?|$)/.test(entry.url)).length,
      failed: first.filter((entry) => entry.failed).map((entry) => `${entry.failed} ${entry.url}`),
      tabs: {},
      timeline: first.map((entry) => ({ url: entry.url.replace(/^https?:\/\/[^/]+/, ""), sent: Math.round(entry.sent), end: entry.end === null ? null : Math.round(entry.end), cache: entry.cache })),
    };
    if (tabs) {
      await sleep(2000); // a user taps a tab a moment after the editor appears
      for (const [name, [, getter]] of Object.entries(WORKSPACES)) {
        result.tabs[name] = await evaluate(cdp, switchExpression(name, getter));
        await evaluate(cdp, `window.__CIRCUIT_LAB__.activateWorkspace("circuit")`);
        await sleep(300);
      }
    }
    result.problems = problems.splice(0);
    return result;
  } finally { off(); }
}

async function measureRun(browser, url, profile) {
  const { browserContextId } = await browser.send("Target.createBrowserContext", { disposeOnDetach: true });
  const { targetId } = await browser.send("Target.createTarget", { url: "about:blank", browserContextId });
  const cdp = new Cdp(`ws://127.0.0.1:${ctx.debugPort}/devtools/page/${targetId}`);
  await cdp.open();
  try {
    for (const domain of ["Page", "Runtime", "Network"]) await cdp.send(`${domain}.enable`);
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: profile.latency, downloadThroughput: profile.downloadThroughput, uploadThroughput: profile.uploadThroughput, connectionType: "cellular4g" });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_RATE });
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: PAGE_HOOK });
    const cold = await measureLoad(cdp, url, { tabs: true });
    await cdp.send("Page.navigate", { url: "about:blank" });
    await sleep(300);
    const warm = await measureLoad(cdp, url, { tabs: true });
    return { cold, warm };
  } finally {
    cdp.close();
    await browser.send("Target.closeTarget", { targetId }).catch(() => {});
    await browser.send("Target.disposeBrowserContext", { browserContextId }).catch(() => {});
  }
}

const median = (values) => {
  const list = values.filter((value) => typeof value === "number" && Number.isFinite(value)).sort((a, b) => a - b);
  if (!list.length) return null;
  const mid = Math.floor(list.length / 2);
  return list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2;
};

function summarize(runs) {
  const pick = (key) => median(runs.map((run) => run[key]));
  const tabs = Object.fromEntries(Object.keys(WORKSPACES).map((name) => [name, median(runs.map((run) => run.tabs[name]))]));
  return { fcp: pick("fcp"), ready: pick("ready"), lastByte: pick("lastByte"), load: pick("load"), requests: pick("requests"), networkRequests: pick("networkRequests"), bytes: pick("bytes"), depth: pick("depth"), scripts: pick("scripts"), protocol: runs[0]?.protocol ?? "", tabs, problems: [...new Set(runs.flatMap((run) => [...run.problems, ...run.failed]))] };
}

const ms = (value) => (value === null ? "-" : `${Math.round(value)}`);
function printTable(label, rows) {
  console.log(`\n## ${label}`);
  console.log("| 조건 | 방문 | FCP ms | 편집기 조작 가능 ms | 마지막 바이트 ms | 요청(네트워크/전체) | 전송 KB | waterfall 깊이 | 전자기 ms | 신호 ms | 과정 ms |");
  console.log("|---|---|---|---|---|---|---|---|---|---|---|");
  for (const row of rows) {
    const s = row.summary;
    console.log(`| ${row.profile} (${s.protocol}) | ${row.visit} | ${ms(s.fcp)} | ${ms(s.ready)} | ${ms(s.lastByte)} | ${s.networkRequests}/${s.requests} | ${(s.bytes / 1024).toFixed(1)} | ${s.depth} | ${ms(s.tabs.em)} | ${ms(s.tabs.signals)} | ${ms(s.tabs["circuit-course"])} |`);
    if (s.problems.length) console.log(`|  | 문제 | ${s.problems.slice(0, 3).join(" / ").replace(/\|/g, "/")} |`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const tlsDir = mkdtempSync(join(tmpdir(), "circuit-lab-perf-tls-"));
  let local = null;
  try {
    let url = options.target === "pages" ? PAGES_URL : options.target;
    const args = [];
    if (options.target === "local") {
      const tls = makeCertificate(tlsDir);
      local = await startPagesLikeServer(options.root, tls, options);
      url = local.url;
      args.push(`--ignore-certificate-errors-spki-list=${tls.spkiHash}`);
    }
    await startBrowser({ args });
    const browser = await browserSession();
    const report = { url, root: options.target === "local" ? options.root : null, revalidate: options.revalidate, cpu: CPU_RATE, viewport: "390x844 mobile", rows: [] };
    for (const name of options.profiles) {
      const profile = PROFILES[name];
      const runs = [];
      for (let run = 0; run < options.runs; run += 1) {
        process.stderr.write(`${profile.label} run ${run + 1}/${options.runs} … `);
        runs.push(await measureRun(browser, url, profile));
        process.stderr.write(`ready ${Math.round(runs.at(-1).cold.ready)} ms\n`);
        if (options.verbose) for (const entry of runs.at(-1).cold.timeline) process.stderr.write(`  ${String(entry.sent).padStart(5)} -> ${String(entry.end).padStart(5)}  ${entry.url}\n`);
      }
      report.rows.push({ profile: profile.label, visit: "첫 방문(캐시 비움)", summary: summarize(runs.map((run) => run.cold)), runs: runs.map((run) => run.cold) });
      report.rows.push({ profile: profile.label, visit: options.revalidate ? "재방문(304 재검증)" : "재방문(캐시 유효)", summary: summarize(runs.map((run) => run.warm)), runs: runs.map((run) => run.warm) });
    }
    browser.close();
    printTable(`${url}${report.root ? ` (root ${report.root}${options.revalidate ? ", no-cache" : ", max-age=600"})` : ""} · CPU ${CPU_RATE}x · 390x844 · 중앙값 ${options.runs}회`, report.rows);
    if (options.json) writeFileSync(options.json, JSON.stringify(report, null, 2) + "\n");
  } finally {
    await stopAll();
    local?.server.close();
    rmSync(tlsDir, { recursive: true, force: true });
  }
}

await main();
