import test from "node:test";
import assert from "node:assert/strict";
import { cursorPin, repinnedIndex } from "../../src/scope-model.js";

const transient = (xs) => ({ analysis: "transient", xValues: xs });

test("a pin remembers the analysis, the x range and its x value; DC and out-of-range indexes are no pin", () => {
  assert.deepEqual(cursorPin(transient([0, 1, 2, 3]), 2), { analysis: "transient", first: 0, last: 3, x: 2 });
  assert.equal(cursorPin(transient([0, 1]), null), null);
  assert.equal(cursorPin(transient([0, 1]), 5), null);
  assert.equal(cursorPin({ analysis: "dc", xValues: [0] }, 0), null);
  assert.equal(cursorPin(null, 0), null);
});

test("a re-run over the same x range keeps the pinned x on the nearest new sample, also with a different sample count", () => {
  const pin = cursorPin(transient([0, 1e-3, 2e-3, 3e-3, 4e-3, 5e-3]), 2);
  assert.equal(repinnedIndex(pin, transient([0, 1e-3, 2e-3, 3e-3, 4e-3, 5e-3])), 2, "same grid: same index");
  assert.equal(repinnedIndex(pin, transient([0, 0.9e-3, 2.1e-3, 3e-3, 5e-3])), 2, "adaptive steps: nearest to 2 ms");
  const ac = { analysis: "ac", xValues: [10, 100, 1000, 10000] };
  assert.equal(repinnedIndex(cursorPin(ac, 1), { analysis: "ac", xValues: [10, 100, 1000, 10000] }), 1);
});

test("another analysis kind, another x range or no result releases the pin", () => {
  const pin = cursorPin(transient([0, 1, 2, 3]), 1);
  assert.equal(repinnedIndex(pin, { analysis: "ac", xValues: [0, 1, 2, 3] }), null);
  assert.equal(repinnedIndex(pin, transient([0, 1, 2, 6])), null, "the end time changed");
  assert.equal(repinnedIndex(pin, transient([0.5, 1, 2, 3])), null, "the start changed");
  assert.equal(repinnedIndex(pin, null), null);
  assert.equal(repinnedIndex(null, transient([0, 1, 2, 3])), null);
});
