import test from "node:test";
import assert from "node:assert/strict";
import { pulseDerivedValues, pulseEdit, siValueText } from "../../src/pulse-timing.js";
import { parseValue } from "../../src/circuit-engine.js";

test("siValueText writes values the editor reads back", () => {
  for (const [value, text] of [[1000, "1k"], [1e-3, "1m"], [5e-4, "500u"], [1 / 3000, "333.333u"], [2.5e6, "2.5M"], [0.5, "500m"], [50, "50"], [0, "0"]]) {
    assert.equal(siValueText(value), text);
    assert.ok(Math.abs(parseValue(text) - value) <= Math.abs(value) * 1e-5, text);
  }
});

test("pulse frequency and duty: shown from period/width, and an edit becomes period/width", () => {
  assert.deepEqual(pulseDerivedValues({ pulseWidth: "1", pulsePeriod: "2" }), { pulseFrequency: "500m", pulseDuty: "50" });
  assert.deepEqual(pulseDerivedValues({}), { pulseFrequency: "500m", pulseDuty: "50" }, "the editor defaults");
  assert.deepEqual(pulseDerivedValues({ pulseWidth: "2m", pulsePeriod: "4m" }), { pulseFrequency: "250", pulseDuty: "50" });
  // Lab sheet: 1 kHz square wave from the default source keeps 50 %.
  assert.deepEqual(pulseEdit({ pulseWidth: "1", pulsePeriod: "2" }, "pulseFrequency", "1k"), { pulsePeriod: "1m", pulseWidth: "500u" });
  assert.deepEqual(pulseEdit({ pulseWidth: "250u", pulsePeriod: "1m" }, "pulseFrequency", "10k"), { pulsePeriod: "100u", pulseWidth: "25u" }, "25 % kept");
  assert.deepEqual(pulseEdit({ pulseWidth: "500u", pulsePeriod: "1m" }, "pulseDuty", "20"), { pulseWidth: "200u" });
  for (const [key, text] of [["pulseFrequency", "0"], ["pulseFrequency", "-1k"], ["pulseDuty", "0"], ["pulseDuty", "100"], ["pulseDuty", "150"], ["pulseDuty", "abc"]]) {
    assert.equal(pulseEdit({ pulseWidth: "500u", pulsePeriod: "1m" }, key, text), null, `${key} ${text}`);
  }
  assert.equal(pulseEdit({ pulseWidth: "500u", pulsePeriod: "x" }, "pulseDuty", "20"), null, "an unreadable period gives nothing to scale");
  assert.deepEqual(pulseDerivedValues({ pulsePeriod: "x" }), { pulseFrequency: "", pulseDuty: "" });
});
