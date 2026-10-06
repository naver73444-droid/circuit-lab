/** Screen-space gesture math, pointer sessions and hit-test distances. Values are CSS pixels, never device pixels. */
/** Shared canvas zoom limits (viewBox width): wheel/button zoom and pinch must agree. */
export const CANVAS_VIEW_MIN_WIDTH = 220;
export const CANVAS_VIEW_MAX_WIDTH = 3040;

export function passedDragSlop(start, point, pointerType = "mouse") {
  if (![start?.x, start?.y, point?.x, point?.y].every(Number.isFinite)) return false;
  return Math.hypot(point.x - start.x, point.y - start.y) >= (pointerType === "touch" || pointerType === "pen" ? 8 : 4);
}

export function nearestScreenTarget(point, targets) {
  if (![point?.x, point?.y].every(Number.isFinite)) return null;
  let best = null, distance = Infinity;
  for (const target of targets) {
    const next = Math.hypot(point.x - target.x, point.y - target.y);
    if (Number.isFinite(next) && next <= target.radius && next < distance) {
      best = target; distance = next;
    }
  }
  return best;
}

export function viewForPinch(start, midpoint, distance) {
  if (!start || ![midpoint?.x, midpoint?.y, distance, start.scale, start.distance,
    start.view?.x, start.view?.y, start.view?.width, start.view?.height,
    start.anchor?.x, start.anchor?.y, start.center?.x, start.center?.y].every(Number.isFinite)
    || distance < 1 || start.distance < 1 || start.scale <= 0
    || start.view.width <= 0 || start.view.height <= 0) return null;
  const width = Math.max(CANVAS_VIEW_MIN_WIDTH, Math.min(CANVAS_VIEW_MAX_WIDTH, start.view.width * start.distance / distance));
  const factor = width / start.view.width, height = start.view.height * factor;
  const scale = start.scale / factor;
  return { width, height,
    x: start.anchor.x - (midpoint.x - start.center.x) / scale - width / 2,
    y: start.anchor.y - (midpoint.y - start.center.y) / scale - height / 2 };
}

// ---- pointer sessions: one pointer owns a gesture from press to commit/cancel
export function beginPointerSession(active, pointerId, payload) {
  if (active || !Number.isInteger(pointerId)) return active;
  return { ...payload, pointerId, finished: false };
}

export function ownsPointer(session, pointerId) {
  return Boolean(session && !session.finished && session.pointerId === pointerId);
}

export function finishPointerSession(session, pointerId, reason = "commit") {
  if (!ownsPointer(session, pointerId)) return { session, finished: null };
  return { session: null, finished: { ...session, finished: true, reason } };
}

// ---- hit testing
/** Hit-test distances in CSS pixels, independent of devicePixelRatio/zoom. */
export function distanceToSegment(point, a, b) {
  if (![point?.x, point?.y, a?.x, a?.y, b?.x, b?.y].every(Number.isFinite)) return Infinity;
  const dx = b.x - a.x, dy = b.y - a.y;
  const length2 = dx*dx + dy*dy;
  if (length2 === 0) return Math.hypot(point.x-a.x, point.y-a.y);
  const t = Math.max(0, Math.min(1, ((point.x-a.x)*dx + (point.y-a.y)*dy) / length2));
  return Math.hypot(point.x-a.x-t*dx, point.y-a.y-t*dy);
}
