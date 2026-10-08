import { passedDragSlop, viewForPinch } from "./interaction-math.js";

/** Touch-only routing on a stable SVG root. Mouse and keyboard keep their paths.
 * No synthetic click dispatch: tap targets are chosen from circuit geometry.
 * A second finger cancels the object gesture, then starts viewport-only pinch.
 * Holding one finger still for LONG_PRESS_MS calls api.longPress (pick up a part that was not selected yet).
 */
export const LONG_PRESS_MS = 380;

export function installCanvasTouch(svg, api) {
  const contacts = new Map();
  let first = null, pinch = null, multi = false, lastTouch = -Infinity, holdTimer = null;
  const stopHold = () => { if (holdTimer !== null) clearTimeout(holdTimer); holdTimer = null; };
  const xy = e => ({ x: e.clientX, y: e.clientY });
  const pair = () => {
    const [a, b] = [...contacts.values()];
    return a && b ? { midpoint: { x: (a.x+b.x)/2, y: (a.y+b.y)/2 }, distance: Math.hypot(a.x-b.x,a.y-b.y) } : null;
  };
  const release = id => { try { if (svg.hasPointerCapture(id)) svg.releasePointerCapture(id); } catch {} };
  const cancel = () => {
    stopHold();
    if (first) api.finish(first.id, "cancel");
    const ids = [...contacts.keys()]; contacts.clear(); first = null; pinch = null; multi = false;
    for (const id of ids) release(id);
  };
  svg.addEventListener("pointerdown", e => {
    if (e.pointerType !== "touch") return;
    e.preventDefault(); e.stopImmediatePropagation(); lastTouch = performance.now();
    if (!contacts.size && !api.canStart()) return;
    contacts.set(e.pointerId, xy(e));
    try { svg.setPointerCapture(e.pointerId); } catch {}
    if (contacts.size === 1) {
      const target = api.pick(xy(e));
      first = { id: e.pointerId, point: xy(e), target, moved: false };
      api.begin(e, target);
      if (api.longPress && target) {
        const held = first, event = e;
        holdTimer = setTimeout(() => { holdTimer = null; if (first === held && !held.moved && !multi) api.longPress(event, target); }, LONG_PRESS_MS);
      }
    } else {
      stopHold();
      multi = true;
      if (first) { const id = first.id; api.finish(id, "cancel"); try { svg.setPointerCapture(id); } catch {} }
      first = null;
      if (contacts.size === 2) {
        const p = pair(), matrix = svg.getScreenCTM(), r = svg.getBoundingClientRect();
        const anchor = api.world(p.midpoint);
        if (matrix && matrix.a > 0 && anchor && p.distance > 0) pinch = {
          ...p, anchor, scale: matrix.a, center: { x: r.x+r.width/2, y:r.y+r.height/2 }, view: api.view() };
      } else pinch = null; // Three or more contacts are ignored until fully released.
    }
  }, { capture: true, passive: false });
  svg.addEventListener("pointermove", e => {
    if (e.pointerType !== "touch" || !contacts.has(e.pointerId)) return;
    e.preventDefault(); e.stopImmediatePropagation(); contacts.set(e.pointerId, xy(e));
    if (pinch && contacts.size === 2) {
      const p = pair(), view = viewForPinch(pinch, p.midpoint, p.distance);
      if (view) api.setView(view);
    } else if (first && !multi && e.pointerId === first.id) {
      first.moved ||= passedDragSlop(first.point, xy(e), "touch");
      if (first.moved) { stopHold(); api.move(e); }
    }
  }, { capture: true, passive: false });
  const end = (e, reason) => {
    if (e.pointerType !== "touch" || !contacts.has(e.pointerId)) return;
    if (reason === "lost-capture" && multi) {
      // A stale loss after deliberate release+recapture is harmless; a real loss
      // must clear every contact or the next touch can stay permanently blocked.
      if (svg.hasPointerCapture(e.pointerId)) return;
      cancel(); return;
    }
    e.stopImmediatePropagation(); lastTouch = performance.now();
    if (first && e.pointerId === first.id) stopHold();
    if (first && !multi && e.pointerId === first.id) {
      first.moved ||= passedDragSlop(first.point, xy(e), "touch");
      if (reason === "commit" && first.moved) api.move(e);
      const target = first.target, tap = !first.moved && reason === "commit";
      api.finish(e.pointerId, reason);
      if (tap) api.tap(e, target);
      first = null;
    }
    contacts.delete(e.pointerId); release(e.pointerId);
    if (!contacts.size) { first = null; pinch = null; multi = false; }
    else if (multi) pinch = null; // No one-finger edits after a pinch.
  };
  svg.addEventListener("pointerup", e => end(e, "commit"), true);
  svg.addEventListener("pointercancel", e => end(e, "cancel"), true);
  svg.addEventListener("lostpointercapture", e => end(e, "lost-capture"), true);
  svg.addEventListener("click", e => {
    if (e.pointerType === "touch" || e.sourceCapabilities?.firesTouchEvents || (e.detail > 0 && performance.now()-lastTouch < 500)) {
      e.preventDefault(); e.stopImmediatePropagation();
    }
  }, true);
  window.addEventListener("blur", cancel);
  window.addEventListener("resize", cancel);
  document.addEventListener("visibilitychange", () => { if (document.hidden) cancel(); });
  return { cancel };
}
