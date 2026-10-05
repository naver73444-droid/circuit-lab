/** Reusable presentation-only resize helpers; no circuit/history mutation. */
export function clampSplit(value, min, max) {
  if (![value, min, max].every(Number.isFinite) || max < min) return null;
  return Math.min(max, Math.max(min, value));
}
export function splitKeyDelta(key, orientation, step = 12) {
  if (orientation === 'vertical') {
    if (key === 'ArrowLeft') return -step;
    if (key === 'ArrowRight') return step;
  } else {
    if (key === 'ArrowUp') return -step;
    if (key === 'ArrowDown') return step;
  }
  return null;
}
export function splitValueFromDelta(startValue, delta, direction, min, max) {
  return clampSplit(startValue + delta * direction, min, max);
}
/** Config is read at gesture start, so moving a sheet changes resize direction. */
export function installResizeHandle(handle, config, { before = () => {}, done = () => {} } = {}) {
  if (!handle) return { cancel() {}, refresh() {} };
  let active = null;
  const refresh = () => {
    const c = config(), [min, max] = c.bounds;
    handle.setAttribute('aria-orientation', c.orientation);
    handle.setAttribute('aria-valuemin', String(Math.round(min)));
    handle.setAttribute('aria-valuemax', String(Math.round(max)));
    handle.setAttribute('aria-valuenow', String(Math.round(c.read())));
  };
  const finish = (id, cancelled = false) => {
    if (!active || active.id !== id) return;
    const session = active; active = null;
    if (cancelled) session.c.write(session.startValue);
    handle.classList.remove('dragging');
    try { if (handle.hasPointerCapture(id)) handle.releasePointerCapture(id); } catch {}
    refresh(); done();
  };
  handle.addEventListener('pointerdown', e => {
    if (active || e.button !== 0) return;
    const c = config(); if (!c.enabled) return;
    e.preventDefault(); e.stopPropagation(); before();
    active = { id: e.pointerId, c, startValue: c.read(), start: c.orientation === 'vertical' ? e.clientX : e.clientY };
    handle.classList.add('dragging');
    try { handle.setPointerCapture(e.pointerId); } catch {}
  });
  handle.addEventListener('pointermove', e => {
    if (!active || active.id !== e.pointerId) return;
    e.preventDefault();
    const c = active.c, current = c.orientation === 'vertical' ? e.clientX : e.clientY;
    const next = splitValueFromDelta(active.startValue, current - active.start, c.direction, ...c.bounds);
    if (next !== null) c.write(next);
    refresh();
  });
  handle.addEventListener('pointerup', e => finish(e.pointerId));
  handle.addEventListener('pointercancel', e => finish(e.pointerId, true));
  handle.addEventListener('lostpointercapture', e => finish(e.pointerId, true));
  handle.addEventListener('keydown', e => {
    const c = config(); if (!c.enabled) return;
    const delta = splitKeyDelta(e.key, c.orientation, e.shiftKey ? 36 : 12);
    if (e.key !== 'Home' && delta === null) return;
    e.preventDefault(); before();
    c.write(e.key === 'Home' ? c.initial : splitValueFromDelta(c.read(), delta, c.direction, ...c.bounds));
    refresh(); done();
  });
  handle.addEventListener('dblclick', () => { const c = config(); if (c.enabled) { before(); c.write(c.initial); refresh(); done(); } });
  return { cancel: () => { if (active) finish(active.id, true); }, refresh };
}
