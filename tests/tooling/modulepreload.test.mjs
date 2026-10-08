// The generated modulepreload lists must equal the real import graph: index.html preloads exactly the first-screen
// modules (src/app.js and everything it imports statically) and src/module-preload-map.js lists, per lazy workspace,
// the modules it adds beyond the first screen. The graph is recomputed here independently of the generator.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createLazyController, preloadModules } from "../../src/workspace-tabs.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (base, file) => readFileSync(resolve(base, "src", file), "utf8");

function closure(base, entry) {
  const seen = new Set([entry]);
  const queue = [entry];
  while (queue.length) {
    const file = queue.shift();
    for (const match of read(base, file).matchAll(/\b(?:from|import)\s*["']\.\/([^"']+)["']/g)) {
      if (!seen.has(match[1])) { seen.add(match[1]); queue.push(match[1]); }
    }
  }
  return seen;
}
const headPreloads = (base) => [...readFileSync(resolve(base, "index.html"), "utf8").matchAll(/<link rel="modulepreload" href="src\/([^"]+)"\/>/g)].map((match) => match[1]);

test("index.html preloads exactly the first-screen static import graph", () => {
  const listed = headPreloads(root);
  assert.equal(new Set(listed).size, listed.length, "no duplicates");
  assert.equal(listed[0], "app.js");
  assert.deepEqual(new Set(listed), closure(root, "app.js"));
  const html = readFileSync(resolve(root, "index.html"), "utf8");
  assert.ok(html.indexOf('rel="modulepreload"') < html.indexOf("</head>"), "the links live in <head>");
});

test("each lazy workspace preloads its own graph minus the first screen", async () => {
  const { WORKSPACE_MODULES } = await import(pathToFileURL(resolve(root, "src/module-preload-map.js")).href);
  const first = closure(root, "app.js");
  const entries = { em: "em-controller.js", signals: "signals-course-controller.js", "circuit-course": "circuit-course-controller.js" };
  assert.deepEqual(Object.keys(WORKSPACE_MODULES).sort(), Object.keys(entries).sort());
  for (const [name, entry] of Object.entries(entries)) {
    const expected = new Set([...closure(root, entry)].filter((file) => !first.has(file)));
    assert.equal(WORKSPACE_MODULES[name][0], entry, `${name} starts with its controller`);
    assert.deepEqual(new Set(WORKSPACE_MODULES[name]), expected, name);
  }
  const app = read(root, "app.js");
  for (const entry of Object.values(entries)) assert.ok(app.includes(`import("./${entry}"`), `app.js still loads ${entry} lazily`);
});

test("the editor's result side stays off the first screen and is preloaded as one list with the analysis worker's graph", async () => {
  const { LAZY_MODULES } = await import(pathToFileURL(resolve(root, "src/module-preload-map.js")).href);
  const first = closure(root, "app.js");
  for (const file of ["result-views.js", "analysis-runner.js", "scope-view.js", "phasor-view.js", "measure-view.js", "phasor-practice.js", "node-readout-model.js"]) {
    assert.ok(!first.has(file), `${file} is not imported statically by the first screen`);
  }
  assert.deepEqual(Object.keys(LAZY_MODULES), ["results"]);
  const expected = new Set([...closure(root, "result-views.js"), ...closure(root, "analysis-worker.js")].filter((file) => !first.has(file)));
  assert.equal(LAZY_MODULES.results[0], "result-views.js");
  assert.equal(new Set(LAZY_MODULES.results).size, LAZY_MODULES.results.length, "no duplicates");
  assert.deepEqual(new Set(LAZY_MODULES.results), expected);
  assert.ok(read(root, "app.js").includes('import("./result-views.js"'), "app.js loads the result side lazily");
  assert.ok(read(root, "analysis-worker-client.js").includes('new URL("./analysis-worker.js"'), "the worker the list preloads is the one the client starts");
});

test("the generator reports the real tree as up to date", () => {
  const result = spawnSync(process.execPath, [resolve(root, "scripts/gen-modulepreload.mjs"), "--check"], { encoding: "utf8", timeout: 20000 });
  assert.equal(result.status, 0, result.stderr);
});

test("a new import makes check-boundaries fail until the lists are regenerated", () => {
  const copy = mkdtempSync(join(tmpdir(), "circuit-preload-"));
  try {
    cpSync(resolve(root, "src"), resolve(copy, "src"), { recursive: true });
    cpSync(resolve(root, "index.html"), resolve(copy, "index.html"));
    for (const script of ["check-boundaries.mjs", "gen-modulepreload.mjs"]) cpSync(resolve(root, "scripts", script), resolve(copy, "scripts", script));
    writeFileSync(resolve(copy, "src/zz-added.js"), "export const added = 1;\n");
    writeFileSync(resolve(copy, "src/app.js"), `import "./zz-added.js";\n${read(copy, "app.js")}`);
    const boundaries = () => spawnSync(process.execPath, [resolve(copy, "scripts/check-boundaries.mjs")], { encoding: "utf8", timeout: 30000 });
    const stale = boundaries();
    assert.equal(stale.status, 1);
    assert.ok(JSON.parse(stale.stdout).errors.some((error) => error.startsWith("index.html: the modulepreload list")), stale.stdout);
    const generated = spawnSync(process.execPath, [resolve(copy, "scripts/gen-modulepreload.mjs")], { encoding: "utf8", timeout: 20000 });
    assert.equal(generated.status, 0, generated.stderr);
    assert.ok(headPreloads(copy).includes("zz-added.js"));
    const fresh = boundaries();
    assert.deepEqual(JSON.parse(fresh.stdout).errors, []);
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
});

function fakeDocument() {
  const links = [];
  return { links, head: { append: (node) => links.push(node) }, createElement: (tag) => ({ tag }) };
}

test("preloadModules adds one modulepreload link per module, resolved next to the src modules", () => {
  const doc = fakeDocument();
  preloadModules(["zz-one.js", "zz-two.js"], doc);
  preloadModules(["zz-two.js", "zz-three.js"], doc);
  assert.deepEqual(doc.links.map((link) => [link.tag, link.rel]), Array(3).fill(["link", "modulepreload"]));
  assert.deepEqual(doc.links.map((link) => link.href), ["zz-one.js", "zz-two.js", "zz-three.js"].map((file) => new URL(`../../src/${file}`, import.meta.url).href));
  assert.doesNotThrow(() => preloadModules(["zz-four.js"], undefined), "no document (tests, workers): nothing to do");
});

test("a lazy workspace preloads its modules before importing the controller", async () => {
  const doc = fakeDocument();
  const previous = globalThis.document;
  globalThis.document = doc;
  try {
    const order = [];
    const lazy = createLazyController({ host: {}, modules: ["zz-lazy-a.js", "zz-lazy-b.js"], load: async () => { order.push(doc.links.length); return {}; }, create: () => ({}) });
    lazy.prefetch();
    lazy.prefetch();
    await lazy.ensure();
    assert.deepEqual(order, [2], "both links exist when the import starts, and the module loads once");
  } finally {
    if (previous === undefined) delete globalThis.document; else globalThis.document = previous;
  }
});
