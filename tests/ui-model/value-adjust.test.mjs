import test from "node:test";
import assert from "node:assert/strict";
import { E12, E24, NICE, stepSeriesText } from "../../src/value-series.js";
import { createValueGesture, formatValue, prefixOf, primaryValueField, slideText, sliderToValue, splitValueText, stepValue, valueToSlider, withPrefix } from "../../src/value-adjust.js";
import { createEditorSession, createEditorState } from "../../src/editor-session.js";
import { parseValue } from "../../src/circuit-engine.js";
import { keyboardOpen } from "../../src/viewport-guard.js";

const walk = (start, direction, count, options) => {
  const seen = [start];
  for (let i = 0; i < count; i += 1) seen.push(stepValue(seen.at(-1), direction, options)?.text ?? null);
  return seen;
};

test("E24는 24개 오름차순이고 E12를 모두 포함한다", () => {
  assert.equal(E24.length, 24);
  assert.deepEqual([...E24], [...E24].sort((a, b) => a - b));
  for (const value of E12) assert.ok(E24.includes(value), `${value}`);
});

test("◀ ▶ E12/E24: 위·아래 한 칸, 계열 밖 값은 가까운 계열 값으로 붙는다, 기존 E12 휠 동작은 그대로", () => {
  assert.deepEqual(walk("1k", 1, 4, { series: "E24" }), ["1k", "1.1k", "1.2k", "1.3k", "1.5k"]);
  assert.deepEqual(walk("1k", -1, 3, { series: "E24" }), ["1k", "910", "820", "750"]);
  assert.deepEqual(walk("4.7k", 1, 2), ["4.7k", "5.6k", "6.8k"], "기본은 E12");
  assert.equal(stepValue("1.05k", 1, { series: "E24" }).text, "1.1k");
  assert.equal(stepValue("1.05k", -1, { series: "E24" }).text, "1k");
  assert.equal(stepValue("9.1u", 1, { series: "E24" }).text, "10u");
  assert.equal(stepSeriesText("8.2k", 1).text, "10k", "세 번째 인자 없이 부르는 휠 경로는 E12");
  assert.equal(stepValue("0", 1), null, "R/C/L은 0에서 걸음을 만들지 않는다");
  assert.equal(stepValue("abc", 1), null);
  for (const text of walk("1p", 1, 30, { series: "E24" })) assert.ok(parseValue(text) > 0, `${text}는 엔진이 읽는다`);
});

test("전원 ◀ ▶: 1·1.2·1.5·2·2.5·3·4·5·6·7·8·9 (부호 유지, 0은 ±1)", () => {
  assert.deepEqual([...NICE], [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(walk("5", 1, 6, { kind: "signed" }), ["5", "6", "7", "8", "9", "10", "12"]);
  assert.deepEqual(walk("12", -1, 3, { kind: "signed" }), ["12", "10", "9", "8"]);
  assert.deepEqual(walk("-5", 1, 2, { kind: "signed" }), ["-5", "-4", "-3"], "음수에서 ▶는 0 쪽으로");
  assert.deepEqual(walk("-5", -1, 2, { kind: "signed" }), ["-5", "-6", "-7"]);
  assert.equal(stepValue("0", 1, { kind: "signed" }).text, "1");
  assert.equal(stepValue("0", -1, { kind: "signed" }).text, "-1");
  assert.equal(stepValue("500m", 1, { kind: "signed" }).text, "600m");
  assert.equal(stepValue("2.5V", 1, { kind: "signed" }).text, "3V", "단위 꼬리 유지");
});

test("접두사 칩: 숫자는 그대로, 접두사만 바꾼다 (µ는 u로 저장, M은 메가)", () => {
  assert.deepEqual(splitValueText("4.7kohm"), { number: "4.7", prefix: "k", tail: "ohm" });
  assert.deepEqual(splitValueText("10µF"), { number: "10", prefix: "u", tail: "F" });
  assert.deepEqual(splitValueText("2.2meg"), { number: "2.2", prefix: "meg", tail: "" });
  assert.deepEqual(splitValueText("1F"), { number: "1", prefix: "", tail: "F" }, "대문자 F는 패럿");
  assert.deepEqual(splitValueText("1f"), { number: "1", prefix: "f", tail: "" }, "소문자 f는 펨토");
  assert.equal(withPrefix("4.7", "k"), "4.7k");
  assert.equal(withPrefix("4.7k", "M"), "4.7M");
  assert.equal(withPrefix("2.2meg", ""), "2.2");
  assert.equal(withPrefix("100nF", "u"), "100uF");
  assert.equal(withPrefix("", "m"), "1m", "빈 칸에 칩을 누르면 1");
  assert.equal(withPrefix("-", "m"), "-1m");
  assert.equal(parseValue(withPrefix("4.7", "M")), 4.7e6, "M은 엔진에서도 메가");
  assert.equal(parseValue(withPrefix("47", "u")), 47e-6);
  assert.equal(prefixOf("1meg"), "M");
  assert.equal(prefixOf("10"), "");
});

test("로그 슬라이더: 기준값 ×10^위치 (−1…1), 유효숫자 3자리, 역함수와 단위 꼬리", () => {
  assert.equal(sliderToValue(1000, 0), 1000);
  assert.equal(sliderToValue(1000, 1), 10000);
  assert.equal(sliderToValue(1000, -1), 100);
  assert.equal(sliderToValue(1000, 0.5), 3160);
  assert.equal(sliderToValue(1000, 5), 10000, "범위 밖 위치는 끝으로");
  assert.equal(sliderToValue(0, 0.5), null);
  assert.ok(Math.abs(valueToSlider(1000, 3162.28) - 0.5) < 1e-4);
  assert.equal(valueToSlider(1000, 1e6), 1);
  assert.equal(valueToSlider(1000, -5), 0);
  assert.equal(slideText("1k", 0.5), "3.16k");
  assert.equal(slideText("4.7uF", 0.1), "5.92uF");
  assert.equal(slideText("100k", 1), "1M");
  assert.equal(slideText("100kohm", 1), "1Mohm");
  assert.equal(slideText("1meg", -0.5), "316k");
  assert.equal(slideText("-5", 0.3), "-9.98", "전원은 부호 유지");
  assert.equal(slideText("0", 0.5), null);
  assert.equal(formatValue(999.96), "1k", "반올림으로 1000이 되면 다음 접두사");
  assert.equal(formatValue(0.0000047), "4.7u");
  for (const position of [-1, -0.37, 0, 0.21, 1]) assert.ok(parseValue(slideText("2.2k", position)) > 0);
});

test("조절할 속성: R/C/L 값, 전원은 해석 종류·파형에 따라 (속성 패널의 강조 칸과 같은 규칙)", () => {
  assert.equal(primaryValueField({ type: "R", props: {} }).prop, "value");
  assert.equal(primaryValueField({ type: "C", props: {} }).unit, "F");
  assert.equal(primaryValueField({ type: "L", props: {} }).kind, "positive");
  assert.equal(primaryValueField({ type: "V", props: { mode: "DC" } }, "dc").prop, "dc");
  assert.equal(primaryValueField({ type: "V", props: { mode: "SIN" } }, "dc").prop, "dc", "DC 해석에서는 SIN 전원도 DC 값");
  assert.equal(primaryValueField({ type: "V", props: { mode: "SIN" } }, "transient").prop, "amplitude");
  assert.equal(primaryValueField({ type: "I", props: { mode: "PULSE" } }, "transient").prop, "pulseV2");
  assert.equal(primaryValueField({ type: "I", props: {} }, "ac").prop, "acMagnitude");
  assert.equal(primaryValueField({ type: "I", props: {} }, "dc").kind, "signed");
  assert.equal(primaryValueField({ type: "GND", props: {} }), null);
  assert.equal(primaryValueField({ type: "OPAMP", props: {} }), null);
  assert.equal(primaryValueField(null), null);
});

/** A real editor session with inert collaborators; only history is under test. */
function session() {
  const state = createEditorState();
  state.circuit = { version: 1, geometryVersion: state.circuit.geometryVersion, components: [{ id: "R1", type: "R", x: 100, y: 100, rotation: 0, props: { ref: "R1", value: "1k" } }], wires: [], junctions: [] };
  const noop = () => {};
  const editor = createEditorSession({
    state, inputDrafts: { retainComponents: noop }, synchronizeIntent: noop, markStale: noop, scheduleAutoRun: noop, renderAll: noop,
    resetProjectSession: noop, refreshProbeViews: noop, closeProbeContextMenu: noop, confirmDiscardDrafts: () => true,
  });
  const gesture = createValueGesture({ mutateGrouped: editor.mutateGrouped, closeEditGroup: editor.closeEditGroup });
  const set = (text) => gesture.apply(() => { state.circuit.components[0].props.value = text; });
  return { state, editor, gesture, set, value: () => state.circuit.components[0].props.value };
}

test("되돌리기: 슬라이더 한 번 끌기(많은 중간값)·▶ 누르고 있기 = 한 단계, 다음 동작은 새 단계", () => {
  const h = session();
  h.gesture.begin("R1");
  for (const position of [0.05, 0.1, 0.2, 0.35, 0.5]) h.set(slideText("1k", position));
  h.gesture.end();
  assert.equal(h.value(), "3.16k");
  assert.equal(h.state.history.length, 1, "드래그 하나 = 기록 하나");
  h.gesture.begin("R1");
  h.set("3.3k"); h.set("3.9k"); h.set("4.7k"); // 누르고 있는 동안의 반복
  h.gesture.end();
  assert.equal(h.state.history.length, 2);
  h.gesture.begin("R1"); h.set("5.6k"); h.gesture.end(); // 칩 한 번
  assert.equal(h.state.history.length, 3);
  h.editor.undo();
  assert.equal(h.value(), "4.7k");
  h.editor.undo();
  assert.equal(h.value(), "3.16k");
  h.editor.undo();
  assert.equal(h.value(), "1k");
});

test("되돌리기: 끌기 사이에 다른 편집이 끼면 그 뒤는 새 단계, 시작 안 한 동작은 거부", () => {
  const h = session();
  assert.throws(() => h.set("2k"), /not started/);
  h.gesture.begin("R1");
  h.set("1.5k");
  h.editor.mutate(() => { h.state.circuit.components[0].rotation = 90; });
  h.set("2.2k");
  h.gesture.end();
  assert.equal(h.state.history.length, 3, "끼어든 편집이 묶음을 닫는다");
  assert.equal(h.gesture.open, false);
});

test("키보드 판단: 글자를 입력 중이고 화면 높이가 120px 넘게 줄었을 때만", () => {
  assert.equal(keyboardOpen({ typing: true, fullHeight: 844, visualHeight: 500 }), true);
  assert.equal(keyboardOpen({ typing: false, fullHeight: 844, visualHeight: 500 }), false, "입력 중이 아니면 주소창 변화로 본다");
  assert.equal(keyboardOpen({ typing: true, fullHeight: 844, visualHeight: 790 }), false, "주소창 정도의 변화");
  assert.equal(keyboardOpen({ typing: true, fullHeight: NaN, visualHeight: 500 }), false);
});
