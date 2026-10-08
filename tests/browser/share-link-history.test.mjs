// A #p= share link is opened once: going back/forward through the app's own history (workspace steps) never opens it again
// over later work. Real server + headless Edge (throw-away profile, see harness.mjs).
// Run with `node --test tests/browser/share-link-history.test.mjs`.
import { describe, test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  L, ctx, ev, until, settle, navigate, state, click, clickAt, bgPoint, sleep,
  startServer, startBrowser, stopAll, leftoverProcessIds, isAlive, assertNoProblems, resetProblems,
} from "./harness.mjs";

const back = async () => { await ev(`history.back()`); await sleep(300); await settle(); };
const forward = async () => { await ev(`history.forward()`); await sleep(300); await settle(); };
const count = async () => (await state()).circuit.components.length;

async function shareHashOf(exampleId) {
  await navigate(`/?example=${exampleId}`);
  return ev(`(async () => {
    const share = await import("/src/share-url.js");
    const examples = await import("/src/examples.js");
    const e = examples.cloneExample(${JSON.stringify(exampleId)});
    const out = await share.encodeProjectToHash({ title: e.name, subtitle: e.description, circuit: e.circuit, settings: e.settings, probes: [] }, { baseHref: location.href.split("#")[0], compress: true });
    return out.hash;
  })()`);
}

async function openLinkFromBlank(hash) {
  await ctx.cdp.send("Page.navigate", { url: "about:blank" });
  await sleep(200);
  await navigate(`/?from=link${hash}`);
  await until(`document.getElementById("canvas-notices").textContent.includes("공유 링크에서 불러왔습니다")`, "the share link to be opened");
  await ev(`window.__mark = 1`);
}

async function addResistor() {
  await click('.palette-item[data-type="R"]');
  const spot = await bgPoint();
  await clickAt(spot.x, spot.y);
  await settle();
}

describe("share link and the back button", { timeout: 300000 }, () => {
  before(async () => { await startServer(); await startBrowser(); });
  beforeEach(() => resetProblems());
  afterEach(async () => { await assertNoProblems("console/network"); });
  after(async () => {
    const pids = [ctx.edge?.pid, ctx.server?.pid].filter(Boolean);
    const stopped = await stopAll();
    for (const pid of new Set([...pids, ...stopped])) assert.equal(isAlive(pid), false, `process ${pid} should have been stopped`);
    assert.deepEqual(leftoverProcessIds(), [], "no process may still carry the throw-away Edge profile");
  });

  test("the link leaves the address bar right after it is opened", async () => {
    const hash = await shareHashOf("divider");
    await openLinkFromBlank(hash);
    assert.equal(await ev(`location.hash`), "", "#p= is removed once the link is opened");
  });

  test("open link → add a part → other workspace → back → back: the edited circuit is kept", async () => {
    const hash = await shareHashOf("divider");
    await openLinkFromBlank(hash);
    const linked = await count();
    await addResistor();
    assert.equal(await count(), linked + 1, "one part added");
    await click("#em-workspace-tab");
    await until(`${L}.getWorkspace() === "em"`, "the EM workspace");
    await back();
    await until(`${L}.getWorkspace() === "circuit"`, "back to the circuit editor");
    await sleep(500);
    assert.equal(await count(), linked + 1, "back to the editor keeps the added part");
    // The second back leaves the app (the link entry was the first one): it must not land on the link reopened in place.
    await ev(`history.back()`).catch(() => {});
    await until(`location.href === "about:blank"`, "the second back leaves the app instead of reopening the link");
  });

  test("open link → other workspace → back → add a part → forward → back: the link is not reopened over the edit", async () => {
    const hash = await shareHashOf("divider");
    await openLinkFromBlank(hash);
    const linked = await count();
    await click("#em-workspace-tab");
    await until(`${L}.getWorkspace() === "em"`, "the EM workspace");
    assert.equal(await ev(`location.hash`), "", "the workspace entry does not carry the link");
    await back();
    await until(`${L}.getWorkspace() === "circuit"`, "back to the circuit editor");
    await addResistor();
    assert.equal(await count(), linked + 1, "one part added");
    await forward();
    await until(`${L}.getWorkspace() === "em"`, "forward to EM");
    await back();
    await until(`${L}.getWorkspace() === "circuit"`, "back to the circuit editor again");
    await sleep(800);
    assert.equal(await ev(`window.__mark === 1`), true, "same page");
    assert.equal(await count(), linked + 1, "the added part survives back/forward");
    assert.equal(await ev(`location.hash`), "");
  });

  test("a stale #p= entry reached with back/forward is not reopened", async () => {
    const hash = await shareHashOf("divider");
    await openLinkFromBlank(hash);
    const linked = await count();
    // An app entry that still carries the link (e.g. pushed while the link was still decoding).
    await ev(`history.pushState(history.state, "", location.pathname + location.search + ${JSON.stringify(hash)})`);
    await ev(`history.pushState(history.state, "", location.pathname + location.search)`);
    await addResistor();
    await back();
    await sleep(800);
    assert.equal(await count(), linked + 1, "back onto a stale #p= entry keeps the current work");
  });
});
