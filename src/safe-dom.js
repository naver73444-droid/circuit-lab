/** Escape untrusted text before inserting it in a quoted HTML/SVG attribute or text node. */
export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

// Only inert color tokens are accepted. Imported labels are NOT treated as markup.
export function isSafeColor(value) {
  return typeof value === "string" && /^(?:#[\da-f]{3}|#[\da-f]{4}|#[\da-f]{6}|#[\da-f]{8}|[a-z]{1,24}|rgba?\([\d.,%\s]+\)|hsla?\([\d.,%\s]+\))$/i.test(value);
}

export function safeColor(value, fallback = "#176baf") {
  return isSafeColor(value) ? value : fallback;
}
