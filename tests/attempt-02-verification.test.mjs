import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("CIRCUIT-008 attempt-02 계측은 별도 URL에서만 원 app을 감싼다", async () => {
  const [index, server, instrumentation] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../scripts/verification/attempt-02-server.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/verification/attempt-02-instrumentation.js", import.meta.url), "utf8"),
  ]);
  assert.match(index, /<script type="module" src="\/src\/app\.js"><\/script>/);
  assert.match(server, /original\.replace\(originalTag, verificationTag\)/);
  assert.match(instrumentation, /originalSetData\.apply\(this, args\)/);
  assert.match(instrumentation, /originalRender\.apply\(this, args\)/);
  assert.match(instrumentation, /originalRenderCursor\.apply\(this, args\)/);
  assert.match(instrumentation, /originalCreateObjectURL\(blob\)/);
  assert.doesNotMatch(instrumentation, /window\.__CIRCUIT_LAB__|getState\(/);
});
