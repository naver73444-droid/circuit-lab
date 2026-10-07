import test from "node:test";
import assert from "node:assert/strict";
import { CHAPTERS, chapterOf, currentItem, initialNav, itemKey, parseNav, selectChapter, selectItem, serializeNav } from "../../src/circuit-course-nav.js";
import { EXPERIMENTS } from "../../src/circuit-course-registry.js";
import { TOOL_TABS, examplesSummary, FOLD_OPEN_MAX } from "../../src/circuit-course-view.js";

test("every experiment and tool tab sits under exactly one textbook chapter, and the table names nothing else", () => {
  const known = [...EXPERIMENTS.map((e) => itemKey("experiment", e.id)), ...TOOL_TABS.map((t) => itemKey("tool", t.id))].sort();
  const filed = CHAPTERS.flatMap((c) => c.items.map((i) => itemKey(i.kind, i.id))).sort();
  assert.deepEqual(filed, known);
  assert.equal(new Set(filed).size, filed.length, "no item in two chapters");
});

test("the chapter row stays on one phone line and every chapter's tab row too", () => {
  assert.ok(CHAPTERS.length <= 5, "at most five chapter buttons");
  assert.deepEqual(CHAPTERS.map((c) => c.short), ["Ch9–10", "Ch11", "Ch12", "Ch13", "내 문제"]);
  for (const chapter of CHAPTERS) {
    assert.ok(chapter.items.length >= 1 && chapter.items.length <= 4, `${chapter.id}: up to four tabs`);
    for (const item of chapter.items) assert.ok([...item.label].length <= 6, `${item.id}: short label fits a quarter of 390 px (${item.label})`);
  }
});

test("chapter assignment follows the textbook: Y–Δ and the complex calculator with Ch.9–10, power tools with Ch.11, 3-phase with Ch.12, coupled coils and transformer with Ch.13", () => {
  const of = (kind, id) => chapterOf(kind, id).id;
  assert.equal(of("experiment", "phasor-wave"), "ch9-10");
  assert.equal(of("experiment", "impedance"), "ch9-10");
  assert.equal(of("tool", "complex"), "ch9-10");
  assert.equal(of("tool", "y-delta"), "ch9-10");
  for (const id of ["power", "correction"]) assert.equal(of("experiment", id), "ch11");
  for (const id of ["loads", "max-power"]) assert.equal(of("tool", id), "ch11");
  assert.equal(of("experiment", "three-phase"), "ch12");
  assert.equal(of("tool", "three-phase-ext"), "ch12");
  for (const id of ["coupled", "transformer"]) assert.equal(of("tool", id), "ch13");
  assert.equal(of("experiment", "problem"), "mine");
  assert.equal(chapterOf("tool", "nope"), null);
});

test("the start state is the first experiment; picking an item makes its chapter current and a chapter reopens on the item used last in it", () => {
  let nav = initialNav();
  assert.deepEqual(currentItem(nav), CHAPTERS[0].items[0]);
  assert.equal(currentItem(nav).id, "phasor-wave");
  nav = selectItem(nav, "tool", "loads");
  assert.equal(nav.chapter, "ch11");
  assert.equal(currentItem(nav).id, "loads");
  nav = selectChapter(nav, "ch13");
  assert.equal(currentItem(nav).id, "coupled", "a chapter never used opens on its first item");
  nav = selectItem(nav, "tool", "transformer");
  nav = selectChapter(nav, "ch11");
  assert.equal(currentItem(nav).id, "loads", "back in Ch.11: the item chosen there before");
  nav = selectChapter(nav, "ch13");
  assert.equal(currentItem(nav).id, "transformer");
  assert.equal(selectChapter(nav, "ch99"), nav, "unknown chapter: unchanged");
  assert.equal(selectItem(nav, "tool", "nope"), nav, "unknown item: unchanged");
  assert.equal(selectItem(initialNav(), "tool", "nope").chapter, "ch9-10");
});

test("the remembered selection round-trips and every bad stored value falls back to the defaults without throwing", () => {
  const nav = selectItem(selectItem(initialNav(), "experiment", "correction"), "tool", "y-delta");
  assert.deepEqual(parseNav(serializeNav(nav)), nav);
  assert.equal(parseNav(serializeNav(nav)).chapter, "ch9-10");
  assert.equal(currentItem(parseNav(serializeNav(nav))).id, "y-delta");
  assert.equal(currentItem(selectChapter(parseNav(serializeNav(nav)), "ch11")).id, "correction");
  const fresh = initialNav();
  for (const bad of [null, undefined, "", "{", "null", "7", "[]", '"ch11"', "{}", '{"chapter":5}', '{"chapter":"zz","last":7}', '{"chapter":"ch11","last":[1]}']) {
    const parsed = parseNav(bad);
    assert.ok(CHAPTERS.some((c) => c.id === parsed.chapter), `a real chapter for ${bad}`);
    assert.equal(typeof currentItem(parsed).id, "string");
    if (bad !== '{"chapter":"ch11","last":[1]}') assert.deepEqual(parsed, fresh, `defaults for ${bad}`);
  }
  // A kept chapter with a stale or misfiled item keeps the chapter and drops only that item.
  const stale = parseNav('{"chapter":"ch12","last":{"ch12":"tool:gone","ch11":"tool:coupled","ch13":"tool:transformer"}}');
  assert.equal(stale.chapter, "ch12");
  assert.deepEqual(stale.last, { ch13: "tool:transformer" });
  assert.equal(currentItem(stale).id, "three-phase");
});

test("the example-list summary names the count and the last applied example, and a short list starts open", () => {
  assert.equal(examplesSummary(5, null), "예제 5개");
  assert.equal(examplesSummary(5, "예제 12.3 Y 전원"), "예제 5개 · 마지막 적용: 예제 12.3 Y 전원");
  const long = examplesSummary(7, "연습 11.52 A 2 kW 0.8 lag · B 3 kVA 0.4 lead · C 1 kW+0.5 kvar (병렬로 가정)");
  assert.ok(long.startsWith("예제 7개 · 마지막 적용: 연습 11.52") && long.endsWith("…") && long.length < 60, long);
  assert.equal(FOLD_OPEN_MAX, 3);
});
