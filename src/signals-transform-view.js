// Lesson 4 view: time signal (left) and |X| with its phase (right), drawn from the model's frame on fixed axes so that
// narrowing the signal visibly widens the spectrum. Dragging in the time pane moves the signal (t0 / n0).
import { createPanesView } from './signals-panes-view.js';
import { clamp } from './signals-util.js';
import { transformFrame, transformMetrics } from './signals-transform-model.js';

const GRAB_PAD = 28; // px: a touch this close to the signal grabs it
const SHIFTABLE = new Set(['rect', 'tri', 'exp', 'twoexp', 'gauss', 'sinc', 'dt']);

export function createTransformView({ doc, parent, emit }) {
  const view = createPanesView({ doc, parent, label: '푸리에 변환 그래프 (시간 신호, 크기, 위상)', className: 'sg-drag' });
  const { surface, panes } = view;
  const timePane = panes[0];
  let last = null;
  let dragging = false;

  // Dragging in the time pane moves the signal.
  function shift(event) {
    if (!last || !SHIFTABLE.has(last.family)) return;
    const { family, params } = last;
    const x = timePane.fromPx(surface.pointer(event).x);
    if (family === 'dt') emit({ params: { n0: clamp(Math.round(x - (params.L - 1) / 2), -8, 8) } });
    else emit({ params: { t0: clamp(Math.round(x / 0.05) * 0.05, -2, 2) } });
  }
  surface.svg.addEventListener('pointerdown', (event) => {
    if (event.button > 0 || !last || !SHIFTABLE.has(last.family)) return;
    const p = surface.pointer(event);
    if (!timePane.contains(p.x, p.y)) return;
    dragging = true;
    surface.svg.setPointerCapture?.(event.pointerId);
    shift(event);
  });
  surface.svg.addEventListener('pointermove', (event) => { if (dragging) shift(event); });
  for (const type of ['pointerup', 'pointercancel']) surface.svg.addEventListener(type, () => { dragging = false; });
  // Touch: only a finger on (or next to) the signal claims the gesture; elsewhere the page scrolls.
  surface.setGrab((p) => {
    if (!last || !SHIFTABLE.has(last.family) || !timePane.contains(p.x, p.y)) return false;
    const [lo, hi] = transformMetrics(last.family, last.params).timeSpan;
    return p.x >= timePane.px(lo) - GRAB_PAD && p.x <= timePane.px(hi) + GRAB_PAD;
  });

  return {
    ...view,
    update(state) {
      last = state;
      view.update(transformFrame(state.family, state.params));
    },
  };
}
