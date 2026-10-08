/**
 * Value fields (inspector, analysis settings, phone value sheet): the press that brings the focus into a field selects its whole text,
 * so a new value simply types over the old one (on a phone there is no easy way to select it by hand). Only that first press: a click
 * into a field that already has the focus puts the caret where the user pointed, and a press that drags out a part of the text keeps it.
 * Focus moved by code (a re-render restoring the caret) is left alone; Tab already selects the text natively.
 */
const TEXT_TYPES = new Set(["text", "search", "tel", "url", "number", ""]);

const isTextField = (element) => element?.tagName === "INPUT" && TEXT_TYPES.has(String(element.type ?? "").toLowerCase()) && !element.readOnly && !element.disabled;

function selectAll(field) {
  try { field.setSelectionRange(0, field.value.length); } catch { try { field.select(); } catch { /* not selectable */ } }
}

const collapsed = (field) => { try { return field.selectionStart === field.selectionEnd; } catch { return false; } };

/** Install the behaviour on every text field inside `root` (delegated, so re-rendered fields are covered). Returns an uninstall function. */
export function selectAllOnUserFocus(root, { doc = root?.ownerDocument ?? document, win = doc.defaultView ?? window } = {}) {
  if (!root) return () => {};
  let pressed = null; // the field a pointer press is focusing right now
  const onPointerDown = (event) => {
    const field = event.target;
    pressed = isTextField(field) && doc.activeElement !== field ? field : null;
  };
  const onFocusIn = (event) => {
    const field = event.target;
    if (field !== pressed) return;
    selectAll(field);
    // The browser may still place the caret after the focus (mouse-down handling, iOS tap): select again once it has.
    win.setTimeout(() => { if (doc.activeElement === field && pressed === field && collapsed(field)) selectAll(field); }, 0);
  };
  const onMouseUp = (event) => {
    const field = event.target;
    if (field !== pressed || doc.activeElement !== field) return;
    // Chrome/Safari collapse a focus-time selection on mouseup; a drag that selected a part of the text is left as it is.
    if (collapsed(field)) { selectAll(field); event.preventDefault(); }
  };
  const onClick = (event) => {
    const field = event.target;
    if (field === pressed && doc.activeElement === field && collapsed(field)) selectAll(field);
    pressed = null;
  };
  const onFocusOut = (event) => { if (event.target === pressed) pressed = null; };
  root.addEventListener("pointerdown", onPointerDown, true);
  root.addEventListener("focusin", onFocusIn);
  root.addEventListener("mouseup", onMouseUp, true);
  root.addEventListener("click", onClick, true);
  root.addEventListener("focusout", onFocusOut);
  return () => {
    root.removeEventListener("pointerdown", onPointerDown, true);
    root.removeEventListener("focusin", onFocusIn);
    root.removeEventListener("mouseup", onMouseUp, true);
    root.removeEventListener("click", onClick, true);
    root.removeEventListener("focusout", onFocusOut);
  };
}
