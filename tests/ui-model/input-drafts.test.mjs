import test from "node:test";
import assert from "node:assert/strict";
import { InputDrafts } from "../../src/input-drafts.js";
import { classifyNumericInput } from "../../src/circuit-edit.js";

test("drafts retain identity and invalid strings across selection changes", () => {
  const drafts = new InputDrafts();
  drafts.set("prop", "R1", "value", "1e", "1k");
  drafts.set("prop", "R2", "value", "banana", "1k");
  assert.equal(drafts.get("prop", "R1", "value"), "1e");
  assert.equal(drafts.size, 2); drafts.delete("prop", "R2", "value");
  assert.equal(drafts.size, 1); assert.equal(drafts.get("prop", "R1", "value"), "1e");
});

test("draft key construction has no separator collision", () => {
  const drafts = new InputDrafts();
  drafts.set("prop", "a:b", "c", "first", ""); drafts.set("prop", "a", "b:c", "second", "");
  assert.equal(drafts.get("prop", "a:b", "c"), "first");
  assert.equal(drafts.get("prop", "a", "b:c"), "second");
});

test("removed components discard only their drafts", () => {
  const drafts = new InputDrafts(); drafts.set("prop", "R1", "value", "bad", "1k");
  drafts.set("setting", "", "step", "1e", "1u"); drafts.retainComponents(new Set());
  assert.equal(drafts.size, 1); assert.equal(drafts.get("setting", "", "step"), "1e");
  drafts.set("setting", "", "step", "1u", "1u"); assert.equal(drafts.size, 0);
});

for (const origin of ["inspector", "inline"]) for (const value of ["banana", "", "Infinity"]) test(`${origin} ${JSON.stringify(value)} draft is component-owned and blocks commit`, () => {
  const drafts = new InputDrafts();
  drafts.set("prop", "R1", "value", value, "1k");
  assert.equal(drafts.get("prop", "R1", "value"), value);
  assert.equal(drafts.get("prop", "R2", "value"), undefined);
  assert.notEqual(classifyNumericInput(value, { positive: true }).status, "valid");
  assert.deepEqual(drafts.entries(), [{ kind: "prop", id: "R1", property: "value", value }]);
  drafts.delete("prop", "R1", "value");
  assert.equal(drafts.size, 0);
});
