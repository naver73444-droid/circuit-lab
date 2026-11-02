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

test("major text, accent, action and control-border tokens meet contrast targets in dark and light", () => {
  const source = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");
  const [dark, rest] = source.split(':root[data-theme="light"] {');
  const light = rest.slice(0, rest.indexOf("}"));
  for (const [mode, css] of [["dark", dark], ["light", light]]) {
    const token = (name) => hexRgb(new RegExp(`--${name}: (#[a-f0-9]+)`).exec(css)[1]);
    const ratio = (a, b) => contrastRatio(token(a), token(b));
    for (const surface of ["panel", "raised", "bg"]) {
      assert.ok(ratio("text", surface) >= 7, `${mode} text/${surface}`);
      assert.ok(ratio("muted", surface) >= 4.5, `${mode} muted/${surface}`);
      assert.ok(ratio("accent", surface) >= 4.5, `${mode} accent (selected text, focus ring)/${surface}`);
    }
    assert.ok(ratio("muted", "hover") >= 4.5, `${mode} muted on hover`);
    assert.ok(ratio("text", "selection") >= 7 && ratio("accent", "selection") >= 4.5, `${mode} selected state`);
    assert.ok(contrastRatio([255, 255, 255], token("action")) >= 4.5 && contrastRatio([255, 255, 255], token("action-hover")) >= 4.5, `${mode} button text`);
    assert.ok(ratio("line", "panel") >= 3 && ratio("line", "field") >= 3, `${mode} control borders (WCAG 1.4.11)`);
    for (const state of ["warning", "danger", "success"]) assert.ok(ratio(state, `${state}-bg`) >= 4.5, `${mode} ${state}`);
  }
});
