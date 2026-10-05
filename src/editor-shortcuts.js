/**
 * 편집기 키보드 단축키 → 동작 매핑 (DOM 없음). Esc는 상황(메뉴·인라인 편집)에 따라 달라 호출한 쪽이 직접 처리한다.
 *
 *   R / Shift+R        시계·반시계 회전          Delete          삭제
 *   Ctrl+D             복제                      Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y   취소·다시
 *   W / V              배선 / 선택 도구          방향키 (Shift = 5칸)   선택 부품 이동
 *   Ctrl+S             JSON 저장                 Ctrl+Enter     해석 실행
 *
 * typing(입력란에 포커스)이면 Ctrl+S만 동작한다(브라우저 "페이지 저장" 대화상자 대신 프로젝트 저장).
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
const DRAG_COMMITTING = new Set(["delete", "rotate", "clone", "undo", "redo"]);
export const commitsActiveDrag = (action) => DRAG_COMMITTING.has(action);

const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

export function shortcutFor(event, { typing = false } = {}) {
  if (!event || event.isComposing) return null;
  const mod = Boolean(event.ctrlKey || event.metaKey);
  const letter = letterOf(event);
  if (mod && !event.altKey && !event.shiftKey && letter === "s") return { action: "save", preventDefault: true };
  if (typing) return null;
  if (mod && !event.altKey) {
    if (event.key === "Enter" && !event.shiftKey) return { action: "run", preventDefault: true };
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
