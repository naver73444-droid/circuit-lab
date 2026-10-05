/**
 * 편집기 키보드 단축키 → 동작 매핑 (DOM 없음). Esc는 상황(메뉴·인라인 편집)에 따라 달라 호출한 쪽이 직접 처리한다.
 *
 *   R / Shift+R        시계·반시계 회전          Delete          삭제
 *   Ctrl+D             복제                      Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y   취소·다시
 *   Ctrl+C / X / V     복사 / 잘라내기 / 붙여넣기   Ctrl+A         모두 선택
 *   W / V              배선 / 선택 도구          방향키 (Shift = 5칸)   선택 항목 이동
 *   Ctrl+S             JSON 저장                 Ctrl+Enter     해석 실행
 *
 * typing(글자를 입력하는 칸에 포커스)이면 Ctrl+S와 Ctrl+Enter만 동작한다(브라우저 "페이지 저장" 대화상자 대신 프로젝트 저장,
 * 입력 중이던 값은 실행 전에 확정). 체크박스·버튼·슬라이더처럼 글자를 받지 않는 요소가 포커스를 쥐고 있어도 단축키는 동작한다.
 * 한글 입력기가 켜져 있어도 동작하도록 영문자는 event.key가 라틴 문자가 아니면 event.code(KeyW 등)로 판별한다.
 * 반환: {action, preventDefault?, …} | null
 */
export const NUDGE_STEPS = 1;
export const NUDGE_STEPS_SHIFT = 5;

function letterOf(event) {
  const key = String(event.key ?? "");
  if (key.length === 1 && /[a-z]/i.test(key)) return key.toLowerCase();
  const match = /^Key([A-Z])$/.exec(String(event.code ?? ""));
  return match ? match[1].toLowerCase() : "";
}

/** Actions that write history or replay it: an in-progress drag is committed first so its history entry comes before theirs. */
const DRAG_COMMITTING = new Set(["delete", "rotate", "clone", "undo", "redo", "cut", "paste"]);
export const commitsActiveDrag = (action) => DRAG_COMMITTING.has(action);

const TEXT_INPUT_TYPES = new Set(["text", "number", "search", "email", "url", "password", "tel", ""]);
const CURSOR_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"]);

/**
 * Does this focused element (and key) belong to the element rather than to the editor? Text-like inputs, textareas and
 * contenteditable always do. Range sliders, radio buttons and <select> only own the cursor keys (arrows, Home/End, Page keys);
 * checkboxes, buttons and the rest own nothing, so R / Delete / Ctrl+D … still reach the canvas while they keep focus.
 */
export function isTypingTarget(element, key = "") {
  if (!element) return false;
  const tag = String(element.tagName ?? "").toUpperCase();
  if (element.isContentEditable || tag === "TEXTAREA") return true;
  if (tag === "SELECT") return CURSOR_KEYS.has(key);
  if (tag !== "INPUT") return false;
  const type = String(element.type ?? "text").toLowerCase();
  if (TEXT_INPUT_TYPES.has(type)) return true;
  return (type === "range" || type === "radio") && CURSOR_KEYS.has(key);
}

const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

export function shortcutFor(event, { typing = false } = {}) {
  if (!event || event.isComposing) return null;
  const mod = Boolean(event.ctrlKey || event.metaKey);
  const letter = letterOf(event);
  if (mod && !event.altKey && !event.shiftKey && letter === "s") return { action: "save", preventDefault: true };
  if (mod && !event.altKey && !event.shiftKey && event.key === "Enter") return { action: "run", preventDefault: true };
  if (typing) return null;
  if (mod && !event.altKey) {
    if (!event.shiftKey && letter === "c") return { action: "copy", preventDefault: true };
    if (!event.shiftKey && letter === "x") return { action: "cut", preventDefault: true };
    if (!event.shiftKey && letter === "v") return { action: "paste", preventDefault: true };
    if (!event.shiftKey && letter === "a") return { action: "selectAll", preventDefault: true };
    if (letter === "d") return { action: "clone", preventDefault: true };
    if (letter === "z") return { action: event.shiftKey ? "redo" : "undo", preventDefault: true };
    if (letter === "y") return { action: "redo", preventDefault: true };
    return null;
  }
  if (mod || event.altKey) return null;
  if (event.key === "Delete") return { action: "delete" };
  if (Object.hasOwn(ARROWS, event.key)) {
    const [dx, dy] = ARROWS[event.key];
    return { action: "nudge", dx, dy, steps: event.shiftKey ? NUDGE_STEPS_SHIFT : NUDGE_STEPS, repeat: Boolean(event.repeat) };
  }
  if (letter === "r") return { action: "rotate", direction: event.shiftKey ? -1 : 1 };
  if (letter === "w") return { action: "tool", tool: "wire" };
  if (letter === "v") return { action: "tool", tool: "select" };
  return null;
}
