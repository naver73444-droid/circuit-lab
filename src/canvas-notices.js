/**
 * Slim, dismissible notices stacked at the top of the canvas (restore offer, share-link result, copy fallback).
 * Text always goes in through textContent. Buttons run onClick and then dismiss the notice unless onClick returns false.
 */
const MAX_NOTICES = 3;

export function createCanvasNotices(container) {
  function show({ text, kind = "info", actions = [], input = null, autoHideMs = 0, dismissLabel = "닫기" } = {}) {
    const element = document.createElement("div");
    element.className = "canvas-notice";
    element.dataset.kind = kind;
    element.setAttribute("role", kind === "error" ? "alert" : "status");
    const label = document.createElement("span");
    label.className = "canvas-notice-text";
    label.textContent = text;
    element.append(label);
    let field = null;
    if (input !== null) {
      field = document.createElement("input");
      field.className = "canvas-notice-input";
      field.readOnly = true;
      field.value = input;
      field.setAttribute("aria-label", "공유 링크");
      field.addEventListener("focus", () => field.select());
      element.append(field);
    }
    let timer = null;
    const dismiss = () => {
      if (timer !== null) { clearTimeout(timer); timer = null; }
      element.remove();
    };
    const buttons = actions.length ? actions : [{ label: dismissLabel }];
    for (const action of buttons) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = action.label;
      if (action.primary) button.classList.add("primary");
      button.addEventListener("click", () => {
        const keep = action.onClick?.() === false;
        if (!keep) dismiss();
      });
      element.append(button);
    }
    container.append(element);
    while (container.children.length > MAX_NOTICES) container.firstElementChild.remove();
    if (autoHideMs > 0) timer = setTimeout(dismiss, autoHideMs);
    return { element, input: field, dismiss };
  }

  function clear() {
    container.replaceChildren();
  }

  return { show, clear };
}
