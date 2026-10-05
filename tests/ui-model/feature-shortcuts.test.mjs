import test from "node:test";
import assert from "node:assert/strict";
import { commitsActiveDrag, shortcutFor } from "../../src/editor-shortcuts.js";

const key = (k, extra = {}) => ({ key: k, code: "", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, isComposing: false, repeat: false, ...extra });
const action = (event, options) => shortcutFor(event, options)?.action ?? null;

test("기존 단축키 유지: R, Delete, Ctrl+D, Ctrl+Z, Ctrl+Y, Ctrl+Shift+Z", () => {
  assert.deepEqual(shortcutFor(key("r")), { action: "rotate", direction: 1 });
  assert.deepEqual(shortcutFor(key("R", { shiftKey: true })), { action: "rotate", direction: -1 });
  assert.equal(action(key("Delete")), "delete");
  assert.equal(shortcutFor(key("d", { ctrlKey: true })).preventDefault, true);
  assert.equal(action(key("d", { ctrlKey: true })), "clone");
  assert.equal(action(key("z", { ctrlKey: true })), "undo");
  assert.equal(action(key("Z", { ctrlKey: true, shiftKey: true })), "redo");
  assert.equal(action(key("z", { metaKey: true })), "undo");
  assert.equal(action(key("y", { ctrlKey: true })), "redo");
});

test("새 단축키: Ctrl+S 저장, Ctrl+Enter 해석, W 배선, V 선택", () => {
  assert.deepEqual(shortcutFor(key("s", { ctrlKey: true })), { action: "save", preventDefault: true });
  assert.deepEqual(shortcutFor(key("Enter", { ctrlKey: true })), { action: "run", preventDefault: true });
  assert.deepEqual(shortcutFor(key("w")), { action: "tool", tool: "wire" });
  assert.deepEqual(shortcutFor(key("W", { shiftKey: true })), { action: "tool", tool: "wire" });
  assert.deepEqual(shortcutFor(key("v")), { action: "tool", tool: "select" });
});

test("방향키: 1칸, Shift는 5칸, 반복 키 표시", () => {
  assert.deepEqual(shortcutFor(key("ArrowLeft")), { action: "nudge", dx: -1, dy: 0, steps: 1, repeat: false });
  assert.deepEqual(shortcutFor(key("ArrowRight", { shiftKey: true })), { action: "nudge", dx: 1, dy: 0, steps: 5, repeat: false });
  assert.deepEqual(shortcutFor(key("ArrowUp", { repeat: true })), { action: "nudge", dx: 0, dy: -1, steps: 1, repeat: true });
  assert.deepEqual(shortcutFor(key("ArrowDown")), { action: "nudge", dx: 0, dy: 1, steps: 1, repeat: false });
  assert.equal(shortcutFor(key("ArrowLeft", { ctrlKey: true })), null);
  assert.equal(shortcutFor(key("ArrowLeft", { altKey: true })), null);
});

test("입력란에 포커스가 있으면 Ctrl+S만 동작", () => {
  const typing = { typing: true };
  assert.equal(action(key("s", { ctrlKey: true }), typing), "save");
  for (const event of [key("r"), key("w"), key("v"), key("Delete"), key("ArrowLeft"), key("Enter", { ctrlKey: true }), key("z", { ctrlKey: true }), key("d", { ctrlKey: true })]) {
    assert.equal(shortcutFor(event, typing), null, event.key);
  }
});

test("수식키 조합·IME 조합 중에는 일반 문자 단축키가 동작하지 않는다", () => {
  assert.equal(shortcutFor(key("r", { ctrlKey: true })), null, "Ctrl+R(새로고침)은 회전이 아님");
  assert.equal(shortcutFor(key("r", { altKey: true })), null);
  assert.equal(shortcutFor(key("w", { ctrlKey: true })), null, "Ctrl+W(탭 닫기)");
  assert.equal(shortcutFor(key("v", { ctrlKey: true })), null, "Ctrl+V 붙여넣기");
  assert.equal(shortcutFor(key("s", { ctrlKey: true, shiftKey: true })), null);
  assert.equal(shortcutFor(key("s", { ctrlKey: true, altKey: true })), null);
  assert.equal(shortcutFor(key("r", { isComposing: true })), null);
  assert.equal(shortcutFor(key("Enter")), null);
  assert.equal(shortcutFor(key("Enter", { ctrlKey: true, shiftKey: true })), null);
  assert.equal(shortcutFor(key("x")), null);
  assert.equal(shortcutFor(null), null);
});

test("한글 입력기가 켜져 있어도 event.code(KeyW/KeyR/KeyV)로 동작", () => {
  assert.deepEqual(shortcutFor(key("ㅈ", { code: "KeyW" })), { action: "tool", tool: "wire" });
  assert.deepEqual(shortcutFor(key("ㄱ", { code: "KeyR" })), { action: "rotate", direction: 1 });
  assert.deepEqual(shortcutFor(key("ㅃ", { code: "KeyR", shiftKey: true })), { action: "rotate", direction: -1 });
  assert.deepEqual(shortcutFor(key("ㅍ", { code: "KeyV" })), { action: "tool", tool: "select" });
  assert.equal(action(key("ㄴ", { code: "KeyS", ctrlKey: true })), "save");
});

test("드래그 중 키보드 편집: 기록을 남기거나 되돌리는 동작만 진행 중인 드래그를 먼저 확정한다", () => {
  for (const name of ["delete", "rotate", "clone", "undo", "redo"]) assert.equal(commitsActiveDrag(name), true, name);
  for (const name of ["save", "run", "tool", "nudge", undefined]) assert.equal(commitsActiveDrag(name), false, String(name));
  assert.equal(commitsActiveDrag(shortcutFor(key("r")).action), true);
  assert.equal(commitsActiveDrag(shortcutFor(key("z", { ctrlKey: true })).action), true);
  assert.equal(commitsActiveDrag(shortcutFor(key("w")).action), false);
});
