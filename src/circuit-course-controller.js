import { preserveCourseFocus } from './course-focus.js';
import { EXPERIMENTS, getExperiment, initialParameters, evaluateExperiment, verifyExample, draftsOf, exampleDrafts, convertCoordinateDrafts, exampleChangeNote, changedParameterLabels } from './circuit-course-registry.js';
import { parseProblemQuantity } from './circuit-course-problem.js';
import { createCircuitCourseView, FOLD_OPEN_MAX } from './circuit-course-view.js';
import { NAV_STORAGE_KEY, currentItem, initialNav, parseNav, selectChapter, selectItem, serializeNav } from './circuit-course-nav.js';
import { createYDeltaTool } from './y-delta-tool-controller.js';
import { TOOLS } from './circuit-course-tools.js';
import { createCourseTool } from './circuit-course-tool-controller.js';
import { parseCourseNumber } from './circuit-course-format.js';
import { basisFactor } from './circuit-course-complex.js';
import { dataFields, isShown, labelOf } from './circuit-course-tool-common.js';
export { parseCourseNumber };
const draftNumber = n => String(Number(n.toPrecision(10)));
// Numeric experiments follow the course-wide amplitude toggle; the free problem keeps its own given-voltage basis.
const followsBasis = experiment => experiment.id !== 'problem';
// The last chapter and item (per chapter) are remembered across visits; storage may be blocked, then the choice lasts for this page only.
const loadNav = () => { try { return parseNav(localStorage.getItem(NAV_STORAGE_KEY)); } catch { return initialNav(); } };
const saveNav = nav => { try { localStorage.setItem(NAV_STORAGE_KEY, serializeNav(nav)); } catch { /* the choice is not kept */ } };
export function createCircuitCourseController(host) {
  if (!host || typeof host.querySelector !== 'function') throw new TypeError('AC 실험 패널 host가 필요합니다.');
  const view = createCircuitCourseView(host);
  let nav = loadNav();
  const start = currentItem(nav);
  // While a tool is open the experiment under it keeps its id (picking an experiment brings its form back).
  let active = false, destroyed = false, id = start.kind === 'experiment' ? start.id : EXPERIMENTS[0].id, tool = start.kind === 'tool' ? start.id : null, basis = 'rms';
  const yDelta = createYDeltaTool(view.toolPanel('y-delta'));
  const courseTools = new Map(TOOLS.map(def => [def.id, createCourseTool(view.toolPanel(def.id), def, { getBasis: () => basis, setBasis: switchBasis })]));
  const states = new Map();
  function newState(experiment) {
    const params = initialParameters(experiment);
    if (followsBasis(experiment)) {
      // Defaults are written as RMS numbers; show them in the current display basis.
      params.basis = basis;
      for (const p of experiment.parameters) if (p.amplitude) params[p.key] *= basisFactor(basis);
    }
    return { params, drafts: draftsOf(experiment, params),
      result: evaluateExperiment(experiment.id, params), dirty: false, validationFailed: false, origin: 'manual-conditions', activeExample: -1, lastExample: null };
  }
  for (const experiment of EXPERIMENTS) states.set(experiment.id, newState(experiment));
  const current = () => states.get(id);
  function displayParams() {
    const state = current(), result = { ...state.params };
    for (const p of getExperiment(id).parameters) if (p.choices || p.text) result[p.key] = state.drafts[p.key];
    return result;
  }
  const verification = () => { const state = current(); return state.activeExample >= 0 && !state.dirty && !state.validationFailed ? verifyExample(id, state.activeExample, state.result)?.rows ?? null : null; };
  function render() {
    const restoreFocus = preserveCourseFocus(host, ['data-circuit-course-key', 'data-circuit-course-experiment', 'data-circuit-course-mode', 'data-circuit-course-reset', 'data-circuit-course-example', 'data-circuit-course-basis']);
    const state = current();
    view.showBasis(basis);
    view.showChapter(nav.chapter);
    view.showForm(getExperiment(id), displayParams(), state.drafts, state.lastExample);
    view.showTool(tool);
    if (state.dirty && !state.validationFailed) view.dirty(); else view.showResult(state.result, id, state.params, verification());
    restoreFocus();
  }
  /** The amplitude toggle: numbers are rewritten in the new basis (the physical quantity stays the same), every experiment and tool follows. */
  function switchBasis(next) {
    if (next === basis || !['peak', 'rms'].includes(next)) return;
    const ratio = basisFactor(next) / basisFactor(basis);
    basis = next;
    for (const experiment of EXPERIMENTS) {
      if (!followsBasis(experiment)) continue;
      const state = states.get(experiment.id);
      state.params.basis = next; state.drafts.basis = next;
      for (const p of experiment.parameters) {
        if (!p.amplitude) continue;
        if (Number.isFinite(state.params[p.key])) state.params[p.key] *= ratio;
        const typed = String(state.drafts[p.key]).trim() === '' ? NaN : Number(state.drafts[p.key]);
        if (Number.isFinite(typed)) state.drafts[p.key] = draftNumber(typed * ratio);
      }
      state.result = evaluateExperiment(experiment.id, state.params);
    }
    for (const t of courseTools.values()) t.setBasis(next);
    render();
  }
  /** live: a typed value is applied at once; if it cannot be used the last valid result stays on screen and the reason goes to the status line. */
  function apply(live = false) {
    const state = current(), params = displayParams();
    state.validationFailed = false;
    const fail = reason => {
      state.validationFailed = true;
      if (live) { view.status(reason, 'error'); return; }
      state.result = { status: 'invalid', reason };
      view.showResult(state.result, id, state.params);
    };
    try {
      const errors = [];
      for (const p of getExperiment(id).parameters) {
        if (p.choices || p.text || (p.showIf && !p.showIf(params))) continue;
        try {
          if (p.optionalIf?.(params) && !state.drafts[p.key].trim()) { params[p.key] = null; continue; }
          if (!state.drafts[p.key].trim()) throw new RangeError('조건이 비어 있습니다. 문제에 주어진 값을 입력하세요.');
          params[p.key] = p.quantity ? parseProblemQuantity(state.drafts[p.key], p.quantity, p.unit) : parseCourseNumber(state.drafts[p.key]) * p.displayScale;
        } catch (error) { errors.push(p.label + ': ' + error.message); }
      }
      if (errors.length) { fail(errors.join('\n') + (live ? '\n마지막 유효 결과를 그대로 보여 줍니다.' : '')); return; }
      const result = evaluateExperiment(id, params);
      if (result.status !== 'valid' && result.status !== 'singular') { fail(result.reason ?? '계산할 수 없습니다.'); return; }
      state.result = result;
      if (state.result.solution) state.result.solution.inputOrigin = state.origin;
      state.params = params; state.dirty = false;
      view.showResult(state.result, id, state.params, verification());
      if (!live && state.result.status === 'valid' && state.result.symbolic) view.revealAnswer();
    } catch (e) {
      state.validationFailed = true;
      if (live) { view.status(e.message, 'error'); return; }
      state.result = { status: 'invalid', reason: e.message };
      view.showResult(state.result, id, state.params);
    }
  }
  function onInput(event) {
    const target = event.target;
    if (target.matches?.('[data-circuit-course-time]')) {
      if (!current().dirty) view.projection(current().result, Number(target.value));
      return;
    }
    const key = target.dataset?.circuitCourseKey;
    if (!key) return;
    const state = current(), live = id !== 'problem';
    state.drafts[key] = target.value; state.validationFailed = false;
    if (id === 'phasor-wave' && key === 'coordinate') state.drafts = convertCoordinateDrafts(state.drafts, target.value); state.origin = 'manual-conditions'; state.activeExample = -1;
    if (live) {
      if (target.tagName === 'SELECT') render();
      apply(true);
    } else { state.dirty = true; view.dirty(); if (target.tagName === 'SELECT') render(); }
  }
  /** Chapter or item chosen: show that item's screen (a chapter opens on the item last used in it) and remember the choice. */
  function go(next) {
    nav = next; saveNav(nav);
    const item = currentItem(nav);
    if (item.kind === 'tool') tool = item.id; else { id = item.id; tool = null; }
    render();
  }
  function onClick(event) {
    const target = event.target.closest?.('button');
    if (!target || !host.contains(target)) return;
    if (target.dataset.circuitCourseBasis) { switchBasis(target.dataset.circuitCourseBasis); return; }
    if (target.dataset.circuitCourseChapter) { if (target.dataset.circuitCourseChapter !== nav.chapter) go(selectChapter(nav, target.dataset.circuitCourseChapter)); return; }
    if (target.dataset.circuitCourseTool) { go(selectItem(nav, 'tool', target.dataset.circuitCourseTool)); return; }
    if (target.dataset.circuitCourseExperiment) { go(selectItem(nav, 'experiment', target.dataset.circuitCourseExperiment)); return; }
    if (id === 'problem' && ['numeric', 'symbolic'].includes(target.dataset.circuitCourseMode)) {
      const state = current(), mode = target.dataset.circuitCourseMode;
      state.drafts.solutionMode = mode; state.dirty = true; state.validationFailed = false; render();
      if (mode === 'symbolic') apply();
      else {
        const params = displayParams(), fields = getExperiment(id).parameters.filter(p => !p.choices && !p.text && (!p.showIf || p.showIf(params)));
        const missing = fields.find(p => !p.optionalIf?.(params) && !String(state.drafts[p.key] ?? '').trim());
        view.status('원기호와 조건을 유지했습니다. 숫자를 입력한 뒤 문제 풀기를 누르세요.', 'draft');
        view.revealInput((missing ?? fields[0])?.key ?? 'solutionMode');
      }
      return;
    }
    if (target.hasAttribute('data-circuit-course-apply')) { apply(); return; }
    if (target.hasAttribute('data-circuit-course-reset')) { states.set(id, newState(getExperiment(id))); render(); return; }
    if (target.hasAttribute('data-circuit-course-example')) {
      const experiment = getExperiment(id), index = Number(target.dataset.circuitCourseExample), example = experiment.examples[index];
      if (!example) return;
      // A lecture example is written in its own amplitude basis (peak for Ch.9–10, RMS later): the course toggle follows it.
      const beforeDrafts = { ...current().drafts }, basisBefore = beforeDrafts.basis ?? basis;
      if (followsBasis(experiment) && example.values.basis) switchBasis(example.values.basis);
      // The example becomes a complete state: defaults (in the basis just chosen) overwritten by the example's own values, never on top of earlier edits.
      const state = newState(experiment);
      states.set(id, state);
      state.drafts = exampleDrafts(experiment, example, state.drafts);
      state.dirty = true; state.validationFailed = false; state.origin = id === 'problem' ? 'fictional-check' : 'example';
      state.lastExample = example.label;
      render(); apply();
      state.activeExample = example.expect ? index : -1;
      if (state.activeExample >= 0 && !state.validationFailed) view.showResult(state.result, id, state.params, verification());
      if (!state.validationFailed) view.statusNote(exampleChangeNote({ basisBefore, basisAfter: state.drafts.basis ?? basis, labels: changedParameterLabels(experiment, beforeDrafts, state.drafts, displayParams()) }));
      if (experiment.examples.length > FOLD_OPEN_MAX) view.foldExamples(id);
    }
  }
  // Course tools: the preset button is handled inside the tool (its own listener, deeper in the DOM). A capture listener here records the state just before,
  // and the bubble listener after it reads the state again and writes the "example applied" note into that tool's status line.
  let presetBefore = null;
  const toolPresetOf = event => { const b = event.target.closest?.('[data-cc-preset]'), panel = b?.closest('[data-circuit-course-tool-panel]'); return b && panel && host.contains(panel) ? panel.dataset.circuitCourseToolPanel : null; };
  const onPresetCapture = event => {
    const toolId = toolPresetOf(event), t = toolId && courseTools.get(toolId);
    presetBefore = t ? { toolId, snapshot: t.inspect() } : null;
  };
  const onPresetNote = event => {
    const toolId = toolPresetOf(event), before = presetBefore;
    presetBefore = null;
    if (!before || before.toolId !== toolId) return;
    const def = TOOLS.find(d => d.id === toolId), after = courseTools.get(toolId).inspect();
    if (!def || after.destroyed || after.status !== 'valid') return;
    const differs = (x, y) => (typeof x === 'number' && typeof y === 'number' ? Math.abs(x - y) > 1e-9 * Math.max(1, Math.abs(x), Math.abs(y)) : x !== y);
    const labels = dataFields(def).filter(f => isShown(f, after.values) && differs(before.snapshot.values?.[f.key], after.values[f.key])).map(f => labelOf(f, after.values));
    view.statusNote(exampleChangeNote({ basisBefore: before.snapshot.basis, basisAfter: after.basis, labels }), toolId);
  };
  function onSubmit(event) { if (event.target.matches('[data-circuit-course-form]')) { event.preventDefault(); apply(id !== 'problem'); } }
  const onChange = event => { if (event.target.tagName === 'SELECT') onInput(event); };
  host.addEventListener('input', onInput); host.addEventListener('change', onChange); host.addEventListener('click', onClick); host.addEventListener('submit', onSubmit);
  host.addEventListener('click', onPresetCapture, true); host.addEventListener('click', onPresetNote);
  host.hidden = true; host.inert = true; render();
  return {
    activate() { if (destroyed) return; active = true; host.hidden = false; host.inert = false; },
    deactivate() { if (destroyed) return; active = false; host.hidden = true; host.inert = true; },
    inspect() {
      if (destroyed) return { active: false, destroyed: true, experimentId: id };
      const state = current();
      return { active, destroyed, experimentId: id, tool, chapter: nav.chapter, basis, yDelta: yDelta.inspect(), courseTools: Object.fromEntries([...courseTools].map(([key, t]) => [key, t.inspect()])), dirty: state.dirty, params: { ...state.params },
        drafts: { ...state.drafts },
        status: state.validationFailed ? 'invalid' : state.dirty ? 'draft' : state.result.status, activeExample: state.activeExample, lastExample: state.lastExample,
        // Serializable read-only summary, without graph callback functions.
        result: JSON.parse(JSON.stringify(state.result, (key, value) => typeof value === 'function' ? undefined : value)) };
    },
    destroy() {
      if (destroyed) return; this.deactivate(); yDelta.destroy(); for (const t of courseTools.values()) t.destroy();
      host.removeEventListener('input', onInput); host.removeEventListener('change', onChange); host.removeEventListener('click', onClick); host.removeEventListener('submit', onSubmit);
      host.removeEventListener('click', onPresetCapture, true); host.removeEventListener('click', onPresetNote); view.clear(); destroyed = true; states.clear();
    }
  };
}
