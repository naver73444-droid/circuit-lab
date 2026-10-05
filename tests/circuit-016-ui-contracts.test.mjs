import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { formatPortResult } from "../src/ui-model.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("CIRCUIT-016 UI exposes real endpoint/load actions, result directions and narrow access", () => {
  const html = read("../index.html"), app = read("../src/app.js"), css = read("../styles.css");
  for (const id of ["port-panel", "port-p-button", "port-n-button", "port-load-button", "port-run-button", "port-result"]) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /<details class="port-sign"><summary>부호 규약<\/summary>/);
  assert.match(html, /I<sub>into<\/sub>.*p에서 원망으로 유입/);
  assert.match(app, /async function runPortAnalysis\(\)/);
  assert.match(app, /analysisWorkerClient\.start\("port"/);
  assert.match(app, /state\.port\.mode === "pick-p"/);
  assert.match(app, /selectionSnapshot !== portSelectionSnapshot\(\)/);
  assert.match(css, /@media \(max-width: 899px\)[\s\S]*\.port-controls button/);
});

test("CIRCUIT-016 result formatter keeps zero, infinity and unknown distinct", () => {
  const formatted = formatPortResult({ classification: "mixed", equivalent: {
    vth: { kind: "undefined", value: null, reason: "open" }, rth: { kind: "infinite", value: null }, in: { kind: "finite", value: 0.002 },
  }, directions: { equation: "V=Vth+Rth·I_into" } });
  assert.equal(formatted.vth.text, "미정");
  assert.equal(formatted.rth.text, "∞ Ω");
  assert.match(formatted.in.text, /0\.002 A/);
  assert.equal(formatPortResult({ equivalent: { vth: { kind: "finite", value: 0 }, rth: { kind: "zero", value: 0 }, in: { kind: "undefined", value: null } } }).rth.text, "0 Ω");
});
