import test from "node:test";
import assert from "node:assert/strict";
import { preloadModules } from "../../src/workspace-tabs.js";

function fakeDocument() {
  const links = [];
  return { links, head: { append: (node) => links.push(node) }, createElement: (tag) => ({ tag }) };
}

test("preloadModules sets the fetch priority and resolves once every module arrived or failed (a shared module waits once)", async () => {
  const doc = fakeDocument();
  let settled = false;
  const first = preloadModules(["zz-p-one.js", "zz-p-two.js"], doc, { priority: "low" }).then(() => { settled = true; });
  assert.deepEqual(doc.links.map((link) => link.fetchPriority), ["low", "low"]);
  doc.links[0].onload();
  await Promise.resolve();
  assert.equal(settled, false, "one module is still on the wire");
  doc.links[1].onerror();
  await first;
  assert.equal(settled, true, "a failed module does not hold the queue");
  let second = false;
  const again = preloadModules(["zz-p-two.js", "zz-p-three.js"], doc, { priority: "high" }).then(() => { second = true; });
  assert.equal(doc.links.length, 3, "zz-p-two.js is not requested twice");
  assert.equal(doc.links[2].fetchPriority, "high");
  doc.links[2].onload();
  await again;
  assert.equal(second, true);
  assert.equal(preloadModules(["zz-p-four.js"], doc).constructor, Promise);
  assert.equal(doc.links[3].fetchPriority, undefined, "auto leaves the browser default");
  await preloadModules(["zz-p-five.js"], undefined); // no document: resolves at once
});
