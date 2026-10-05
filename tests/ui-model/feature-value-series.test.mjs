import test from "node:test";
import assert from "node:assert/strict";
import { E12, formatSeriesValue, parseSeriesText, stepSeriesText } from "../../src/value-series.js";
import { parseValue } from "../../src/circuit-engine.js";

const up = (text) => stepSeriesText(text, 1)?.text ?? null;
const down = (text) => stepSeriesText(text, -1)?.text ?? null;

test("E12 계열은 12개, 오름차순", () => {
  assert.equal(E12.length, 12);
  assert.deepEqual([...E12], [...E12].sort((a, b) => a - b));
});

test("위로 한 칸: 1k → 1.2k → 1.5k → 1.8k → 2.2k … 8.2k → 10k → 12k", () => {
  const seen = ["1k"];
  for (let i = 0; i < 14; i += 1) seen.push(up(seen.at(-1)));
  assert.deepEqual(seen, ["1k", "1.2k", "1.5k", "1.8k", "2.2k", "2.7k", "3.3k", "3.9k", "4.7k", "5.6k", "6.8k", "8.2k", "10k", "12k", "15k"]);
});

test("아래로 한 칸은 위로 한 칸의 역", () => {
  const seen = ["10k"];
  for (let i = 0; i < 12; i += 1) seen.push(down(seen.at(-1)));
  assert.deepEqual(seen, ["10k", "8.2k", "6.8k", "5.6k", "4.7k", "3.9k", "3.3k", "2.7k", "2.2k", "1.8k", "1.5k", "1.2k", "1k"]);
  assert.equal(down("1k"), "820");
  assert.equal(up("820"), "1k");
});

test("접두사 경계: k↔meg, m↔u, 단위 접미사 유지", () => {
  assert.equal(up("8.2k"), "10k");
  assert.equal(up("820k"), "1meg");
  assert.equal(down("1meg"), "820k");
  assert.equal(up("8.2M"), "10M", "원래 M 표기를 유지");
  assert.equal(down("1M"), "820k");
  assert.equal(up("100n"), "120n");
  assert.equal(up("820n"), "1u");
  assert.equal(down("1u"), "820n");
  assert.equal(up("4.7uF"), "5.6uF");
  assert.equal(up("100nF"), "120nF");
  assert.equal(up("10mH"), "12mH");
  assert.equal(up("1kohm"), "1.2kohm");
  assert.equal(up("1kΩ"), "1.2kohm");
  assert.equal(up("100"), "120");
  assert.equal(up("1"), "1.2");
  assert.equal(down("1"), "820m");
});

test("계열 위에 없는 값은 가장 가까운 계열 값으로 붙는다", () => {
  assert.equal(up("1.1k"), "1.2k");
  assert.equal(down("1.1k"), "1k");
  assert.equal(up("1.3k"), "1.5k");
  assert.equal(down("1.3k"), "1.2k");
  assert.equal(up("9.5k"), "10k");
  assert.equal(down("9.5k"), "8.2k");
  assert.equal(up("1000"), "1.2k");
  assert.equal(up("1e3"), "1.2k");
  assert.equal(up("0.0047"), "5.6m");
});

test("결과 value가 parseValue로 다시 읽은 값과 같다(부동소수 오차 없음)", () => {
  for (const start of ["1", "10", "47", "100", "1k", "4.7k", "100k", "1meg", "1n", "4.7u", "100p", "1m"]) {
    let text = start;
    for (let i = 0; i < 30; i += 1) {
      const step = stepSeriesText(text, 1);
      assert.ok(step, `${text} 위로`);
      assert.equal(parseValue(step.text), step.value, `${text} -> ${step.text}`);
      assert.ok(step.value > parseValue(text));
      text = step.text;
    }
    for (let i = 0; i < 30; i += 1) {
      const step = stepSeriesText(text, -1);
      assert.ok(step, `${text} 아래로`);
      assert.equal(parseValue(step.text), step.value, `${text} -> ${step.text}`);
      assert.ok(step.value < parseValue(text));
      text = step.text;
    }
  }
});

test("해석 불가·0·음수·범위 밖·잘못된 방향은 null", () => {
  for (const bad of ["", "abc", "0", "-1k", "1 2", null, undefined, "k"]) assert.equal(stepSeriesText(bad, 1), null, String(bad));
  assert.equal(stepSeriesText("1k", 0), null);
  assert.equal(stepSeriesText("1k", 2), null);
  assert.equal(stepSeriesText("1f", -1), null, "1e-15 아래로는 가지 않는다");
  assert.equal(stepSeriesText("1e15", 1), null);
  assert.equal(stepSeriesText("8.2T", 1), null, "1e12(T) 위로는 가지 않는다");
  assert.equal(stepSeriesText("1T", 1)?.text, "1.2T");
});

test("parseSeriesText / formatSeriesValue", () => {
  assert.deepEqual(parseSeriesText("4.7 kohm"), { value: 4700, tail: "ohm", megStyle: "meg" });
  assert.equal(parseSeriesText("2.2meg").value, 2.2e6);
  assert.equal(parseSeriesText("1F").value, 1);
  assert.equal(parseSeriesText("1F").tail, "F");
  assert.equal(parseSeriesText("1m").value, 0.001);
  assert.equal(parseSeriesText("x"), null);
  assert.equal(formatSeriesValue(1.2, 5), "120k");
  assert.equal(formatSeriesValue(1, -9, { tail: "F" }), "1nF");
  assert.equal(formatSeriesValue(8.2, 0), "8.2");
});
