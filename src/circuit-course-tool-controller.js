/**
 * One live course tool: every input updates the result at once (no apply button). A value that cannot be used keeps the last valid values and
 * result on screen and says why next to the field. Pure rules: circuit-course-tool-common.js and the tool definition; DOM: circuit-course-tool-view.js.
 */
import { parseCourseNumber } from './circuit-course-format.js';
import { dataFields, evaluateTool, fromDisplay, initialValues, presetValues, toDisplay, validateField, verifyExpectations } from './circuit-course-tool-common.js';
import { createCourseToolView, draftText } from './circuit-course-tool-view.js';

export function createCourseTool(host, def, env) {
  const view = createCourseToolView(host, def);
  const fields = new Map(dataFields(def).map(f => [f.key, f]));
  let basis = env.getBasis(), values = initialValues(def), drafts = {}, errors = {}, active = -1, destroyed = false, result;

  function makeDrafts() { for (const f of fields.values()) if (f.kind === 'number') drafts[f.key] = draftText(toDisplay(f, values[f.key], basis)); }
  function verification() {
    if (active < 0) return null;
    const preset = def.presets[active], shown = evaluateTool(def, values, preset.basis ?? 'rms');
    return shown.status === 'valid' ? verifyExpectations(shown, preset.expect) : null;
  }
  function render() {
    view.syncForm(values, basis, drafts, errors);
    view.showPresetState(active);
    if (result.status === 'valid') { view.status('입력한 값으로 바로 계산한 결과입니다.'); view.showResult(result, verification(), basis); }
    else { view.status(result.reason ?? '계산할 수 없습니다.', 'error'); view.showResult({ read: '현재 값으로는 결과가 없습니다. 입력을 확인하세요.' }, null, basis); }
  }
  /** Try one changed value: keep it only if the whole tool still evaluates; otherwise keep the last valid state and explain at the field. */
  function change(key, value, message) {
    const candidate = { ...values, [key]: value }, next = evaluateTool(def, candidate, basis);
    if (next.status === 'valid') { values = candidate; result = next; errors = {}; active = -1; return true; }
    errors = { [key]: (message ?? next.reason) + ' 마지막 유효 값을 쓰고 있습니다.' };
    return false;
  }
  function onInput(event) {
    const target = event.target, slider = target.dataset?.ccSlider, key = slider ?? target.dataset?.ccKey;
    if (!key || !fields.has(key)) return;
    const f = fields.get(key);
    if (f.kind === 'select' || f.kind === 'text') change(key, target.value);
    else {
      let parsed;
      try { parsed = parseCourseNumber(target.value); } catch (e) { drafts[key] = target.value; errors = { [key]: e.message + ' 마지막 유효 값을 쓰고 있습니다.' }; render(); return; }
      drafts[key] = slider ? draftText(parsed) : target.value;
      const internal = fromDisplay(f, parsed, basis);
      try { validateField(f, internal); } catch (e) { errors = { [key]: e.message + ' 마지막 유효 값을 쓰고 있습니다.' }; render(); return; }
      change(key, internal);
    }
    if (f.kind === 'select') makeDrafts();
    render();
  }
  function onClick(event) {
    const button = event.target.closest?.('[data-cc-preset]');
    if (!button || !host.contains(button)) return;
    applyPreset(Number(button.dataset.ccPreset));
  }
  function applyPreset(index) {
    const preset = def.presets[index];
    if (!preset) return;
    env.setBasis(preset.basis ?? 'rms');
    values = presetValues(def, preset); errors = {}; makeDrafts();
    result = evaluateTool(def, values, basis); active = index;
    render();
  }
  const onSubmit = event => event.preventDefault();
  // Browsers fire input for a select too; some automation only fires change. Handling both is harmless (same value twice).
  const onChange = event => { if (event.target.tagName === 'SELECT') onInput(event); };
  host.addEventListener('input', onInput); host.addEventListener('change', onChange); host.addEventListener('click', onClick); host.addEventListener('submit', onSubmit);
  makeDrafts(); result = evaluateTool(def, values, basis); render();

  return {
    /** The course-wide amplitude toggle changed: numbers are rewritten in the new basis (values themselves are RMS and stay). */
    setBasis(next) { if (destroyed || next === basis) return; basis = next; makeDrafts(); result = evaluateTool(def, values, basis); render(); },
    applyPreset,
    inspect() {
      if (destroyed) return { destroyed: true };
      const numbers = {};
      if (result.status === 'valid') for (const [k, v] of Object.entries(result.values)) if (Number.isFinite(v)) numbers[k] = v;
      return { id: def.id, status: result.status, reason: result.reason ?? null, basis, values: { ...values }, drafts: { ...drafts }, errors: { ...errors }, activePreset: active, outputs: numbers,
        verification: verification()?.map(r => ({ label: r.label, pass: r.pass })) ?? null };
    },
    destroy() {
      if (destroyed) return;
      host.removeEventListener('input', onInput); host.removeEventListener('change', onChange); host.removeEventListener('click', onClick); host.removeEventListener('submit', onSubmit);
      view.clear(); destroyed = true;
    }
  };
}
