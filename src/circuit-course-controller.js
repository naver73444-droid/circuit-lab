import { preserveCourseFocus } from './course-focus.js';
import { EXPERIMENTS, getExperiment, initialParameters, evaluateExperiment } from './circuit-course-registry.js';
import { parseProblemQuantity } from './circuit-course-problem.js';
import { createCircuitCourseView } from './circuit-course-view.js';
export function parseCourseNumber(text) {
  const trimmed = String(text).trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(trimmed)) throw new RangeError('유한한 숫자를 입력하세요. 예: -2.5, 3e-3');
  const n = Number(trimmed);
  if (!Number.isFinite(n) || (n === 0 && /[1-9]/.test(trimmed.split(/e/i)[0]))) throw new RangeError('숫자가 표현 범위를 벗어났습니다.');
  return n;
}
export function createCircuitCourseController(host) {
  if (!host || typeof host.querySelector !== 'function') throw new TypeError('AC 실험 패널 host가 필요합니다.');
  const view = createCircuitCourseView(host);
  let active = false, destroyed = false, id = EXPERIMENTS[0].id;
  const states = new Map();
  function newState(experiment) {
    const params = initialParameters(experiment);
    return { params, drafts: Object.fromEntries(experiment.parameters.map(p => [p.key, p.choices || p.text ? params[p.key] : params[p.key] === null ? '' : String(params[p.key] / p.displayScale)])), result: evaluateExperiment(experiment.id, params), dirty: false, validationFailed: false, origin: 'manual-conditions' };
  }
  for (const experiment of EXPERIMENTS) states.set(experiment.id, newState(experiment));
  const current = () => states.get(id);
  function displayParams() {
    const state = current(), result = { ...state.params };
    for (const p of getExperiment(id).parameters) if (p.choices || p.text) result[p.key] = state.drafts[p.key];
    return result;
  }
  function render() {
    const restoreFocus=preserveCourseFocus(host,['data-circuit-course-key','data-circuit-course-experiment','data-circuit-course-mode','data-circuit-course-reset','data-circuit-course-example']);
    const state = current();
    view.showForm(getExperiment(id), displayParams(), state.drafts);
    if (state.dirty && !state.validationFailed) view.dirty(); else view.showResult(state.result, id, state.params);
    restoreFocus();
  }
  function apply() {
    const state = current(), params = displayParams();
    state.validationFailed = false;
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
      if (errors.length) { state.validationFailed = true; state.result = {status:'invalid',reason:errors.join('\n')}; view.showResult(state.result,id,state.params); return; }
      state.result = evaluateExperiment(id, params);
      state.validationFailed = state.result.status !== 'valid' && state.result.status !== 'singular';
      if (state.result.solution) state.result.solution.inputOrigin = state.origin;
      // Invalid drafts stay editable and do not become the applied parameter snapshot.
      if (state.result.status === 'valid' || state.result.status === 'singular') { state.params = params; state.dirty = false; }
      view.showResult(state.result, id, state.params);
      if(state.result.status==='valid'&&state.result.symbolic)view.revealAnswer();
    } catch (e) {
      state.validationFailed = true;
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
    current().drafts[key] = target.value; current().dirty = true; current().validationFailed = false; current().origin = 'manual-conditions'; view.dirty();
    if (target.tagName === 'SELECT') render();
  }
  function onClick(event) {
    const target = event.target.closest?.('button');
    if (!target || !host.contains(target)) return;
    if (target.dataset.circuitCourseExperiment) { id = target.dataset.circuitCourseExperiment; render(); return; }
    if (id==='problem' && ['numeric','symbolic'].includes(target.dataset.circuitCourseMode)) {
      const state=current(),mode=target.dataset.circuitCourseMode;
      state.drafts.solutionMode=mode;state.dirty=true;state.validationFailed=false;render();
      if(mode==='symbolic')apply();
      else {
        const params=displayParams(),fields=getExperiment(id).parameters.filter(p=>!p.choices&&!p.text&&(!p.showIf||p.showIf(params)));
        const missing=fields.find(p=>!p.optionalIf?.(params)&&!String(state.drafts[p.key]??'').trim());
        view.status('原기호와 조건을 유지했습니다. 숫자를 입력한 뒤 문제 풀기를 누르세요.'.replace('原','원'),'draft');
        view.revealInput((missing??fields[0])?.key??'solutionMode');
      }
      return;
    }
    if (target.hasAttribute('data-circuit-course-apply')) { apply(); return; }
    if (target.hasAttribute('data-circuit-course-reset')) { states.set(id, newState(getExperiment(id))); render(); return; }
    if (target.hasAttribute('data-circuit-course-example')) {
      const experiment = getExperiment(id), example = experiment.examples[Number(target.dataset.circuitCourseExample)];
      if (!example) return;
      const state = current();
      for (const p of experiment.parameters) if (Object.hasOwn(example.values, p.key)) state.drafts[p.key] = p.choices || p.text ? example.values[p.key] : example.values[p.key] === null ? '' : String(example.values[p.key] / p.displayScale);
      state.dirty = true; state.validationFailed = false; state.origin = id === 'problem' ? 'fictional-check' : 'example'; render(); apply();
    }
  }
  function onSubmit(event) { if (event.target.matches('[data-circuit-course-form]')) { event.preventDefault(); apply(); } }
  host.addEventListener('input', onInput); host.addEventListener('click', onClick); host.addEventListener('submit', onSubmit);
  host.hidden = true; host.inert = true; render();
  return {
    activate() { if (destroyed) return; active = true; host.hidden = false; host.inert = false; },
    deactivate() { if (destroyed) return; active = false; host.hidden = true; host.inert = true; },
    inspect() {
      if (destroyed) return { active: false, destroyed: true, experimentId: id };
      const state = current();
      return { active, destroyed, experimentId: id, dirty: state.dirty, params: { ...state.params }, drafts: { ...state.drafts },
        status: state.validationFailed ? 'invalid' : state.dirty ? 'draft' : state.result.status,
        // Serializable read-only summary, without graph callback functions.
        result: JSON.parse(JSON.stringify(state.result, (key, value) => typeof value === 'function' ? undefined : value)) };
    },
    destroy() { if (destroyed) return; this.deactivate(); host.removeEventListener('input', onInput); host.removeEventListener('click', onClick); host.removeEventListener('submit', onSubmit); view.clear(); destroyed = true; states.clear(); }
  };
}
