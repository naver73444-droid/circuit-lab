import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { formatPortResult } from "../src/ui-model.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("CIRCUIT-016 attempt-02 shows ideal voltage/current reasons and trial failures in final panel data", () => {
  const voltage = formatPortResult({
    classification: "ideal-voltage",
    equivalent: {
      vth: { kind: "finite", value: 5 },
      rth: { kind: "zero", value: 0 },
      in: { kind: "undefined", value: null, reason: "단락 전류가 유일하지 않습니다." },
    },
    trials: { short: { status: "error", error: { code: "IDEAL_CONSTRAINT_CONFLICT", message: "5 V 전압원과 0 V 단락이 모순입니다." } } },
  });
  assert.deepEqual([voltage.vth.text, voltage.rth.text, voltage.in.text], ["5 V", "0 Ω", "미정"]);
  assert.match(voltage.details.join("\n"), /이상 전압원형/);
  assert.match(voltage.details.join("\n"), /단락전류 미정/);
  assert.match(voltage.details.join("\n"), /단락 시험 불가 \(IDEAL_CONSTRAINT_CONFLICT\)/);

  const current = formatPortResult({
    classification: "ideal-current",
    equivalent: {
      vth: { kind: "undefined", value: null, reason: "이상 전류원형 포트의 개방 전압은 정해지지 않습니다." },
      rth: { kind: "infinite", value: null },
      in: { kind: "finite", value: .002 },
    },
    trials: { open: { status: "error", error: { code: "SINGULAR", message: "개방 포트 전압이 정해지지 않습니다." } } },
  });
  assert.deepEqual([current.vth.text, current.rth.text, current.in.text], ["미정", "∞ Ω", "0.002 A"]);
  assert.match(current.details.join("\n"), /이상 전류원형/);
  assert.match(current.details.join("\n"), /개방전압 미정/);
  assert.match(current.details.join("\n"), /개방 시험 불가 \(SINGULAR\)/);

  const app = read("../src/app.js");
  assert.match(app, /formatted\.details\.map\(\(detail\) => `<li>\$\{escapeHtml\(detail\)\}<\/li>`\)/);
  assert.match(app, /class="port-details"/);
});

test("CIRCUIT-016 attempt-02 stale transition refreshes only the port panel and preserves draft input DOM", () => {
  const app = read("../src/app.js");
  const staleBody = app.match(/function markPortStale\(\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
  assert.match(staleBody, /state\.port\.stale = true;/);
  assert.match(staleBody, /renderPortPanel\(\);/);
  assert.doesNotMatch(staleBody, /renderInspector|renderAll|inputDrafts|focus\(/);
  const dirtyBody = app.match(/function markInputDirty\(\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
  assert.match(dirtyBody, /markStale\(\)/);
  assert.match(dirtyBody, /markPortStale\(\)/);
  assert.match(app, /inputDrafts\.set\("prop"[\s\S]*?markInputDirty\(\);/);
});
