// LTI 시스템 응답 view: frames come from the model; the step-response examples (hasTimeMarker) have a draggable time marker.
import { createPanesView } from './signals-panes-view.js';
import { hasTimeMarker, ltiFrame } from './signals-lti-model.js';

const KEYS = '←/→ 시각 t 이동 (계단응답 예시), Shift는 10배, Home/End 처음·끝';

export function createLtiView({ doc, parent, emit }) {
  const view = createPanesView({ doc, parent, label: 'LTI 시스템 응답 그래프', keys: KEYS, className: 'sg-drag' });
  const { surface, panes } = view;
  let last = null;
  let dragging = false;

  const move = (event) => {
    if (!last || !hasTimeMarker(last.family)) return;
    emit({ cursor: Math.max(0, panes[0].fromPx(surface.pointer(event).x)) });
  };
  const inPane = (p) => panes.slice(0, 2).some((pane) => pane.contains(p.x, p.y));
  surface.svg.addEventListener('pointerdown', (event) => {
    if (event.button > 0 || !last || !hasTimeMarker(last.family)) return;
    if (!inPane(surface.pointer(event))) return;
    surface.svg.focus({ preventScroll: true });
    dragging = true;
    surface.svg.setPointerCapture?.(event.pointerId);
    move(event);
  });
  surface.svg.addEventListener('pointermove', (event) => { if (dragging) move(event); });
  for (const type of ['pointerup', 'pointercancel']) surface.svg.addEventListener(type, () => { dragging = false; });
  surface.setGrab((p) => Boolean(last) && hasTimeMarker(last.family) && inPane(p));

  return {
    ...view,
    update(state) {
      last = state;
      view.update(ltiFrame(state.family, state.params, state.cursor));
    },
  };
}
