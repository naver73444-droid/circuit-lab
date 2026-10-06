/**
 * 편집기 키보드 단축키 → 동작 매핑 (DOM 없음). Esc는 상황(메뉴·인라인 편집)에 따라 달라 호출한 쪽이 직접 처리한다.
 *
 *   R / Shift+R        시계·반시계 회전          Delete / Backspace  삭제
 *   Ctrl+D             복제                      Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y   되돌리기·다시 하기
 *   Ctrl+C / X / V     복사 / 잘라내기 / 붙여넣기   Ctrl+A         모두 선택
 *   W / V              배선 / 선택 도구          방향키 (Shift = 5칸)   선택 항목 이동
 *   Y                  저항 3개 Y↔Δ 변환(선택한 저항 3개가 Y 또는 Δ일 때)
 *   Ctrl+S             JSON 저장                 Ctrl+Enter     해석 실행
 *
 * typing(글자를 입력하는 칸에 포커스)이면 Ctrl+S와 Ctrl+Enter만 동작한다(브라우저 "페이지 저장" 대화상자 대신 프로젝트 저장,
 * 입력 중이던 값은 실행 전에 확정). 체크박스·버튼·슬라이더처럼 글자를 받지 않는 요소가 포커스를 쥐고 있어도 단축키는 동작한다.
 * 한글 입력기가 켜져 있어도 동작하도록 영문자는 event.key가 라틴 문자가 아니면 event.code(KeyW 등)로 판별한다. IME 조합 중에는 Ctrl+S(저장)만 동작한다.
 * 페이지에 드래그해 선택한 글자가 있으면(textSelection) Ctrl+C·X·A는 브라우저 몫이다. Ctrl+V·Ctrl+D를 꾹 누른 반복(event.repeat)은 `ignore: true`로
 * 표시되어 호출한 쪽이 키만 막고 동작은 하지 않는다(붙여넣기·복제가 연달아 쌓이지 않도록).
 * 반환: {action, preventDefault?, …} | null
 */
export const NUDGE_STEPS = 1;
export const NUDGE_STEPS_SHIFT = 5;
/** Idle fallback of a held-arrow history group: longer than the usual OS key-repeat delay (~500 ms on Windows), so holding a key stays ONE undo step. Releasing the key closes the group earlier. */
export const NUDGE_IDLE_MS = 700;

function letterOf(event) {
  const key = String(event.key ?? "");
  if (key.length === 1 && /[a-z]/i.test(key)) return key.toLowerCase();
  const match = /^Key([A-Z])$/.exec(String(event.code ?? ""));
  return match ? match[1].toLowerCase() : "";
}

/** Actions that write history or replay it: an in-progress drag is committed first so its history entry comes before theirs. */
const DRAG_COMMITTING = new Set(["delete", "rotate", "clone", "undo", "redo", "cut", "paste", "yDelta"]);
export const commitsActiveDrag = (action) => DRAG_COMMITTING.has(action);

const TEXT_INPUT_TYPES = new Set(["text", "number", "search", "email", "url", "password", "tel", ""]);
const CURSOR_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"]);

/**
 * Does this focused element (and key) belong to the element rather than to the editor? Text-like inputs, textareas and
 * contenteditable always do. Range sliders and radio buttons only own the cursor keys (arrows, Home/End, Page keys); a <select> owns those
 * too plus every single printable character without Ctrl/Meta/Alt (type-ahead, Space opens it), so R or W typed on a focused list does not
 * turn the selection; checkboxes, buttons and the rest own nothing, so R / Delete / Ctrl+D … still reach the canvas while they keep focus.
 * `modifier` tells that Ctrl/Meta/Alt is held (Ctrl+Z on a focused list is still the editor's undo).
 */
export function isTypingTarget(element, key = "", { modifier = false } = {}) {
  if (!element) return false;
  const tag = String(element.tagName ?? "").toUpperCase();
  if (element.isContentEditable || tag === "TEXTAREA") return true;
  if (tag === "SELECT") return CURSOR_KEYS.has(key) || (!modifier && String(key).length === 1);
  if (tag !== "INPUT") return false;
  const type = String(element.type ?? "text").toLowerCase();
  if (TEXT_INPUT_TYPES.has(type)) return true;
  return (type === "range" || type === "radio") && CURSOR_KEYS.has(key);
}

/** How long after a Ctrl+C/X/V key press a native copy/cut/paste event still counts as belonging to it. */
export const CLIPBOARD_EVENT_WINDOW_MS = 500;

/**
 * Coordinates the two ways one Ctrl+C / Ctrl+X / Ctrl+V press can be carried out: the browser's native copy/cut/paste event (carries the system
 * clipboard without a permission prompt) and, when no such event comes, a key fallback that runs from a 0 ms timer. Every key press gets ONE token
 * ({done, claim()}); the command that really does the work calls claim(), so whichever path runs first wins and the other becomes a no-op — in
 * either order, even if the native event only arrives after the fallback timer fired. A key press belongs to at most ONE native event: the event
 * that picks up its token detaches it, so a later native event (another paste, a menu paste) gets a token of its own.
 */
export function createClipboardShortcutGate({ now = () => Date.now(), setTimer = (callback) => setTimeout(callback, 0), clearTimer = (handle) => clearTimeout(handle) } = {}) {
  let current = null; // { action, token, at, timer }
  const makeToken = () => {
    const token = { done: false, claim() { if (token.done) return false; token.done = true; return true; } };
    return token;
  };
  const cancelTimer = (entry) => { if (entry?.timer != null) { clearTimer(entry.timer); entry.timer = null; } };
  return {
    /** A Ctrl+C/X/V key press: arm the fallback `run(action, token)`. A native event that follows cancels it and uses the same token. */
    arm(action, run) {
      cancelTimer(current);
      const entry = { action, token: makeToken(), at: now(), timer: null };
      entry.timer = setTimer(() => { entry.timer = null; run(action, entry.token); });
      current = entry;
      return entry.token;
    },
    /** A native copy/cut/paste event: the token of the key press it belongs to (its fallback is cancelled), else a fresh one. */
    native(action) {
      const entry = current;
      current = null;
      cancelTimer(entry);
      return entry && entry.action === action && now() - entry.at <= CLIPBOARD_EVENT_WINDOW_MS ? entry.token : makeToken();
    },
    /** Forget the pending fallback (workspace switch, teardown). */
    cancel() { cancelTimer(current); current = null; },
  };
}

const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

export function shortcutFor(event, { typing = false, textSelection = false } = {}) {
  if (!event) return null;
  const mod = Boolean(event.ctrlKey || event.metaKey);
  const letter = letterOf(event);
  if (mod && !event.altKey && !event.shiftKey && letter === "s") return { action: "save", preventDefault: true };
  if (event.isComposing) return null;
  if (mod && !event.altKey && !event.shiftKey && event.key === "Enter") return { action: "run", preventDefault: true };
  if (typing) return null;
  if (mod && !event.altKey) {
    const again = event.repeat ? { ignore: true } : {};
    if (!event.shiftKey && letter === "c") return textSelection ? null : { action: "copy", preventDefault: true };
    if (!event.shiftKey && letter === "x") return textSelection ? null : { action: "cut", preventDefault: true, ...again };
    if (!event.shiftKey && letter === "v") return { action: "paste", preventDefault: true, ...again };
    if (!event.shiftKey && letter === "a") return textSelection ? null : { action: "selectAll", preventDefault: true };
    if (letter === "d") return { action: "clone", preventDefault: true, ...again };
    if (letter === "z") return { action: event.shiftKey ? "redo" : "undo", preventDefault: true };
    if (letter === "y") return { action: "redo", preventDefault: true };
    return null;
  }
  if (mod || event.altKey) return null;
  if (event.key === "Delete" || event.key === "Backspace") return { action: "delete" };
  if (Object.hasOwn(ARROWS, event.key)) {
    const [dx, dy] = ARROWS[event.key];
    return { action: "nudge", dx, dy, steps: event.shiftKey ? NUDGE_STEPS_SHIFT : NUDGE_STEPS, repeat: Boolean(event.repeat) };
  }
  if (letter === "r") return { action: "rotate", direction: event.shiftKey ? -1 : 1 };
  if (letter === "y") return { action: "yDelta", ...(event.repeat ? { ignore: true } : {}) }; // a held Y converts once, like Ctrl+D/V
  if (letter === "w") return { action: "tool", tool: "wire" };
  if (letter === "v") return { action: "tool", tool: "select" };
  return null;
}
