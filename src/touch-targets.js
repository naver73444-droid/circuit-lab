/** Hit-test distances in CSS pixels, independent of devicePixelRatio/zoom. */
export function distanceToSegment(point, a, b) {
  if (![point?.x, point?.y, a?.x, a?.y, b?.x, b?.y].every(Number.isFinite)) return Infinity;
  const dx = b.x - a.x, dy = b.y - a.y;
  const length2 = dx*dx + dy*dy;
  if (length2 === 0) return Math.hypot(point.x-a.x, point.y-a.y);
  const t = Math.max(0, Math.min(1, ((point.x-a.x)*dx + (point.y-a.y)*dy) / length2));
  return Math.hypot(point.x-a.x-t*dx, point.y-a.y-t*dy);
}
