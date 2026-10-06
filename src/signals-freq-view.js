// 주파수 응답 H(ω) view: every pane comes from the model's frame (signals-panes-view draws it).
import { createPanesView } from './signals-panes-view.js';
import { freqFrame } from './signals-freq-model.js';

export function createFreqView({ doc, parent }) {
  const view = createPanesView({ doc, parent, label: '주파수 응답 그래프' });
  return { ...view, update: (state) => view.update(freqFrame(state.family, state.params)) };
}
