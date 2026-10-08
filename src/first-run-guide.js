// First-run guide on an empty canvas (desktop and phone): three steps and an "예제 열기" button inside #empty-hint.
// Once the user places a part on an empty canvas the guide is remembered as done (localStorage, best effort) and the plain
// "빈 회로" hint is shown instead from then on. #empty-hint itself stays visible exactly when the circuit is empty (canvas-renderer.js).
const STORAGE_KEY = "circuit-lab:first-run-done";
const PLAIN = `<b>빈 회로</b><span>부품을 고르고 캔버스를 눌러 배치하세요.</span>`;
const GUIDE = `<b>회로를 만들어 보세요</b>`
  + `<ol class="first-run-steps"><li><i>1</i><span>부품을 눌러 캔버스에 놓기</span></li><li><i>2</i><span>핀끼리 끌어 배선</span></li>`
  + `<li><i>3</i><span>자동 해석 → 파형 보기</span></li></ol>`
  + `<button type="button" data-first-run-example title="RC 충전 예제를 엽니다">예제 열기</button>`;

function readDone(storage) {
  try { return storage?.getItem(STORAGE_KEY) === "1"; } catch { return false; }
}

/**
 * element: #empty-hint. getState() → { empty, placing } of the editor right now. onOpenExample(): open the guide's example.
 * Call sync() after every canvas render; it only rewrites the hint when its mode changes.
 */
export function createFirstRunGuide({ element, getState, onOpenExample, storage = globalThis.localStorage }) {
  let done = readDone(storage);
  let mode = null;
  let wasEmpty = true;

  function markDone() {
    if (done) return;
    done = true;
    try { storage?.setItem(STORAGE_KEY, "1"); } catch { /* private mode or blocked storage: the guide simply shows again next time */ }
  }

  function sync() {
    if (!element) return;
    const { empty, placing } = getState();
    // The first part placed by hand on an empty canvas ends the guide for good (an example or a pasted fragment does not).
    if (wasEmpty && !empty && placing) markDone();
    wasEmpty = empty;
    const next = done ? "plain" : "guide";
    if (next !== mode) {
      element.innerHTML = next === "guide" ? GUIDE : PLAIN;
      element.classList.toggle("first-run", next === "guide");
      mode = next;
    }
    // While a part is armed for placing, the button must not catch the tap meant for the canvas.
    element.dataset.placing = placing ? "1" : "0";
  }

  element?.addEventListener("click", (event) => {
    if (!event.target.closest?.("[data-first-run-example]")) return;
    onOpenExample?.();
  });

  return { sync, markDone, inspect: () => ({ done, mode, shown: Boolean(element && !element.classList.contains("hidden")) }) };
}
