// 주파수 응답 H(ω) view: every pane comes from the model's frame (signals-panes-view draws it).
// RC / RLC examples: the input-frequency dot on the |H| and angle-H plots can be dragged (or moved with the arrow keys).
import { createPanesView } from './signals-panes-view.js';
import { freqFrame, freqLesson, inputFromPlot } from './signals-freq-model.js';

const KEYS = '←/→ 입력 주파수 f 이동 (RC·RLC 예시), Shift는 10배, Home/End 최소·최대';
const isResponse = (family) => family === 'rc' || family === 'rlc';

export function createFreqView({ doc, parent, emit }) {
  const view = createPanesView({ doc, parent, label: '주파수 응답 그래프', keys: KEYS, className: 'sg-drag' });
  const { surface, panes } = view;
  let last = null;
  let dragging = false;

  const move = (event) => {
    if (!last || !isResponse(last.family)) return;
    const fin = inputFromPlot(last.family, last.params, panes[0].fromPx(surface.pointer(event).x));
    if (fin !== null) emit({ params: { fin } });
  };
  const inPane = (p) => panes.slice(0, 2).some((pane) => pane.contains(p.x, p.y));
  surface.svg.addEventListener('pointerdown', (event) => {
    if (event.button > 0 || !last || !isResponse(last.family)) return;
    if (!inPane(surface.pointer(event))) return;
    surface.svg.focus({ preventScroll: true });
    dragging = true;
    surface.svg.setPointerCapture?.(event.pointerId);
    move(event);
    event.preventDefault();
  });
  surface.svg.addEventListener('pointermove', (event) => { if (dragging) move(event); });
  for (const type of ['pointerup', 'pointercancel']) surface.svg.addEventListener(type, () => { dragging = false; });
  surface.setGrab((p) => Boolean(last) && isResponse(last.family) && inPane(p));

  return {
    ...view,
    // keyboard: the arrow keys step the input frequency by one slider step (Shift: ten steps)
    onKey(event, state) {
      if (!isResponse(state.family)) return null;
      const spec = freqLesson.controls(state.family, state.params).find((c) => c.key === 'fin');
      const unit = (event.shiftKey ? 10 : 1) * spec.step;
      if (event.key === 'ArrowLeft') return { params: { fin: state.params.fin - unit } };
      if (event.key === 'ArrowRight') return { params: { fin: state.params.fin + unit } };
      if (event.key === 'Home') return { params: { fin: spec.min } };
      if (event.key === 'End') return { params: { fin: spec.max } };
      return null;
    },
    update(state) {
      last = state;
      view.update(freqFrame(state.family, state.params));
    },
  };
}
