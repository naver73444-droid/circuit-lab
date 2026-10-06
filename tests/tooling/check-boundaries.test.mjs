import test from "node:test";
import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const script = fileURLToPath(new URL("../../scripts/check-boundaries.mjs", import.meta.url));
const realRoot = fileURLToPath(new URL("../../", import.meta.url));

function run(root, scriptPath = resolve(root, "scripts/check-boundaries.mjs")) {
  const result = spawnSync(process.execPath, [scriptPath], { encoding: "utf8", timeout: 20000 });
  return { status: result.status, report: JSON.parse(result.stdout) };
}

test("the real source tree has no boundary errors", () => {
  const { status, report } = run(realRoot, script);
  assert.deepEqual(report.errors, []);
  assert.equal(status, 0);
});

test("compressed one-liners are flagged by the line-length warning, normal files are not", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "circuit-boundaries-"));
  try {
    await mkdir(resolve(root, "scripts"));
    await mkdir(resolve(root, "src"));
    await copyFile(script, resolve(root, "scripts/check-boundaries.mjs"));
    await writeFile(resolve(root, "src/short.js"), "export const a = 1;\n");
    await writeFile(resolve(root, "src/squeezed.js"), `export const b = [${Array.from({ length: 80 }, (_, index) => index).join(", ")}];\nexport const c = 2;\n`);
    const { status, report } = run(root);
    assert.equal(status, 0, "a warning is not an error");
    assert.deepEqual(report.errors, []);
    assert.ok(report.warnings.some((warning) => warning.startsWith("squeezed.js: 1 line(s) longer than 240")), report.warnings.join("\n"));
    assert.equal(report.warnings.some((warning) => warning.startsWith("short.js")), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
