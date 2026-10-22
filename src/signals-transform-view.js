// Lesson 4 view: time signal (left) and |X| with its phase (right), drawn from the model's frame on fixed axes so that
// narrowing the signal visibly widens the spectrum. Dragging in the time pane moves the signal (t0 / n0).
// The guided steps ("guide:<step>") draw the guide's frames in the same panes; only the shift step can be dragged.
import { createPanesView } from './signals-panes-view.js';
import { clamp } from './signals-util.js';
import { guideStepOf, transformFrame, transformMetrics } from './signals-transform-model.js';
import { SHIFTED, guideDragKey, guideFrame } from './signals-transform-guide.js';

const GRAB_PAD = 28; // px: a touch this close to the signal grabs it
const SHIFTABLE = new Set(['rect', 'tri', 'exp', 'twoexp', 'gauss', 'sinc', 'dt']);

const draggable = (state) => {
  const step = guideStepOf(state.family);
  return step ? guideDragKey(step) === 't0' : SHIFTABLE.has(state.family);
};
// Time span [lo, hi] the signal occupies (what a touch may grab).
function grabSpan(state) {
  if (guideStepOf(state.family)) return [state.params.t0 - SHIFTED.tau / 2, state.params.t0 + SHIFTED.tau / 2];
  return transformMetrics(state.family, state.params).timeSpan;
}

export function createTransformView({ doc, parent, emit }) {
  const view = createPanesView({ doc, parent, label: '푸리에 변환 그래프 (시간 신호, 크기, 위상)', className: 'sg-drag' });
  const { surface, panes } = view;
  const timePane = panes[0];
  let last = null;
  let dragging = false;

  // Dragging in the time pane moves the signal.
  function shift(event) {
    if (!last || !draggable(last)) return;
    const { family, params } = last;
    const x = timePane.fromPx(surface.pointer(event).x);
    if (family === 'dt') emit({ params: { n0: clamp(Math.round(x - (params.L - 1) / 2), -8, 8) } });
    else emit({ params: { t0: clamp(Math.round(x / 0.05) * 0.05, -2, 2) } });
  }
  surface.svg.addEventListener('pointerdown', (event) => {
    if (event.button > 0 || !last || !draggable(last)) return;
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
    if (!last || !draggable(last) || !timePane.contains(p.x, p.y)) return false;
    const [lo, hi] = grabSpan(last);
    return p.x >= timePane.px(lo) - GRAB_PAD && p.x <= timePane.px(hi) + GRAB_PAD;
  });

  return {
    ...view,
    update(state) {
      last = state;
      const step = guideStepOf(state.family);
      view.update(step ? guideFrame(step, state.params) : transformFrame(state.family, state.params));
    },
  };
}
