import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hexRgb, contrastingTrace, contrastRatio } from "../../src/trace-color.js";

test("waveform colors meet 4.5:1 against each supported canvas", () => {
  for (const dark of [true, false]) for (const input of ["#176baf", "#b85d0b", "#fff", "#000", "#333333", "#ff0000", "#80bfff", "#f5bc79"]) {
    const output = contrastingTrace(input, dark);
    assert.ok(contrastRatio(hexRgb(output), dark ? [24, 27, 32] : [244, 245, 248]) >= 4.5, `${input} -> ${output}`);
  }
});

test("major dark text tokens meet contrast targets", () => {
  const css = readFileSync(new URL("../../styles.css", import.meta.url), "utf8").split(':root[data-theme="light"]')[0];
  const token = name => hexRgb(new RegExp(`--${name}: (#[a-f0-9]+)`).exec(css)[1]);
  assert.ok(contrastRatio(token("text"), token("panel")) >= 7);
  assert.ok(contrastRatio(token("muted"), token("panel")) >= 4.5);
  assert.ok(contrastRatio([255, 255, 255], token("action")) >= 4.5);
});
