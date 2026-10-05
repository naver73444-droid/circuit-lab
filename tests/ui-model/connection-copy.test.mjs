import test from "node:test";
import assert from "node:assert/strict";
import { CONNECTION_STATUS_META } from "../../src/circuit-status.js";

// The connection badges and the inspector card use these strings: short, Korean, and no leftover English jargon (reference, solver, MNA...).
test("connection status copy is short Korean text without English jargon", () => {
  assert.deepEqual(Object.keys(CONNECTION_STATUS_META).sort(), ["analysis-floating", "no-ground", "referenced", "solver-check", "unwired"]);
  for (const [status, meta] of Object.entries(CONNECTION_STATUS_META)) {
    for (const text of [meta.label, meta.short]) {
      assert.ok(text.length <= 32, `${status}: "${text}" should stay short`);
      const words = text.match(/[A-Za-z]{3,}/g) ?? [];
      assert.deepEqual(words.filter((word) => !["GND", "OP", "AMP"].includes(word)), [], `${status}: "${text}" mixes in English words`);
    }
  }
});
