// Inject a course stylesheet once per document (keyed), instead of once per render.
export function ensureCourseStyle(node, key, css) {
  const doc = node.ownerDocument;
  if (doc.querySelector(`style[data-course-style="${key}"]`)) return;
  const style = doc.createElement('style');
  style.dataset.courseStyle = key;
  style.textContent = css;
  (doc.head || doc.documentElement || node).append(style);
}
