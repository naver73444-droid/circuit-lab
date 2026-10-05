// Preserve keyboard position when a course form replaces its DOM nodes.
// Attribute names are fixed by callers; values are matched without CSS interpolation.
export function preserveCourseFocus(root, attributes) {
  const active = root.ownerDocument.activeElement;
  const attribute = root.contains(active) && attributes.find(key => active.hasAttribute(key));
  if (!attribute) return () => {};
  const value = active.getAttribute(attribute);
  const selection = typeof active.selectionStart === 'number'
    ? [active.selectionStart, active.selectionEnd, active.selectionDirection] : null;
  return () => {
    if (active.isConnected) return;
    const replacement = [...root.querySelectorAll(`[${attribute}]`)]
      .find(node => node.getAttribute(attribute) === value);
    if (!replacement || replacement.disabled) return;
    replacement.focus({ preventScroll: true });
    if (selection && typeof replacement.selectionStart === 'number') {
      replacement.setSelectionRange(...selection);
    }
  };
}
