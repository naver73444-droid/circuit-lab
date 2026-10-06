// 신호 연산 view: all drawing is described by the model's frame (signals-panes-view draws it).
import { createPanesView } from './signals-panes-view.js';
import { opsFrame } from './signals-ops-model.js';

export function createOpsView({ doc, parent }) {
  const view = createPanesView({ doc, parent, label: '신호 연산 그래프' });
  return { ...view, update: (state) => view.update(opsFrame(state.family, state.params)) };
}
