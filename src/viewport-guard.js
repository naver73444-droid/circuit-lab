/**
 * Keeps the app glued to the visible screen on phones. The layout itself is CSS (screen-high body, inner scrollers, a fixed bottom tab bar);
 * this only covers what CSS cannot see:
 *  - --app-height: the window height in px, for browsers without dvh units (CSS uses it only under @supports not (height: 100dvh)).
 *  - --kb-inset: how far the on-screen keyboard (visualViewport) reaches above the layout bottom, so the value sheet can sit on the keyboard.
 *  - data-keyboard on <html> while a text field is being typed into with the keyboard up: the bottom tab bar steps aside then.
 *  - The document itself never scrolls in this app. iOS (and some Android browsers) still shift it to reveal a focused field and may leave
 *    it shifted after the keyboard closes, which cuts off the bottom with the tab bar. Any such leftover offset is put back to 0.
 */
const TEXT_TYPES = new Set(["", "text", "search", "email", "number", "tel", "url", "password"]);
const KEYBOARD_MIN_PX = 120;

export function isTextEntry(element) {
  if (!element) return false;
  if (element.isContentEditable || element.tagName === "TEXTAREA") return true;
  return element.tagName === "INPUT" && TEXT_TYPES.has(String(element.getAttribute("type") ?? "").toLowerCase());
}

/** Pure decision: is the keyboard up? `fullHeight` is the tallest window height seen while nobody was typing. */
export function keyboardOpen({ typing, fullHeight, visualHeight }) {
  return Boolean(typing) && Number.isFinite(fullHeight) && Number.isFinite(visualHeight) && fullHeight - visualHeight > KEYBOARD_MIN_PX;
}

export function installViewportGuard(win = window, doc = document) {
  const root = doc.documentElement;
  const viewport = win.visualViewport ?? null;
  const needsHeight = !(win.CSS?.supports?.("height", "100dvh"));
  let fullHeight = win.innerHeight;
  let width = win.innerWidth;
  let frame = null;

  function unshift() {
    const scroller = doc.scrollingElement ?? root;
    if (scroller.scrollTop !== 0 || scroller.scrollLeft !== 0 || win.scrollY !== 0) win.scrollTo(0, 0);
  }

  function update() {
    frame = null;
    const typing = isTextEntry(doc.activeElement);
    if (win.innerWidth !== width) { width = win.innerWidth; fullHeight = win.innerHeight; } // rotation: start over
    if (!typing) fullHeight = win.innerHeight;
    else fullHeight = Math.max(fullHeight, win.innerHeight);
    if (needsHeight) root.style.setProperty("--app-height", `${win.innerHeight}px`);
    const visualHeight = viewport ? viewport.height : win.innerHeight;
    const inset = viewport ? Math.max(0, Math.round(win.innerHeight - viewport.height - viewport.offsetTop)) : 0;
    root.style.setProperty("--kb-inset", `${inset}px`);
    const open = keyboardOpen({ typing, fullHeight, visualHeight });
    const wasOpen = root.hasAttribute("data-keyboard");
    if (open) root.setAttribute("data-keyboard", "open"); else root.removeAttribute("data-keyboard");
    // Keyboard just came up: keep the field in view inside its own scroller (browsers do this for the document, not always for inner scrollers).
    if (open && !wasOpen) doc.activeElement?.scrollIntoView?.({ block: "nearest" });
    if (!typing) unshift(); // while typing, the browser may be revealing the field; the offset is undone once the field is left
  }
  const schedule = () => { if (frame === null) frame = win.requestAnimationFrame(update); };

  win.addEventListener("resize", schedule);
  win.addEventListener("orientationchange", schedule);
  viewport?.addEventListener("resize", schedule);
  viewport?.addEventListener("scroll", schedule);
  // A stray document scroll is undone right away unless a field is being typed into (then the browser may be revealing it).
  win.addEventListener("scroll", () => { if (!isTextEntry(doc.activeElement)) unshift(); }, { passive: true });
  doc.addEventListener("focusin", schedule);
  doc.addEventListener("focusout", () => win.setTimeout(schedule, 60));
  update();
  return { update, inspect: () => ({ fullHeight, keyboard: root.hasAttribute("data-keyboard"), inset: root.style.getPropertyValue("--kb-inset") }) };
}
