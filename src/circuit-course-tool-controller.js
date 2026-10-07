/**
 * One live course tool: every input updates the result at once (no apply button). A value that cannot be used keeps the last valid values and
 * result on screen and says why next to the field. Pure rules: circuit-course-tool-common.js and the tool definition; DOM: circuit-course-tool-view.js.
 */
import { FIELD_KEPT, dataFields, draftText, evaluateTool, isShown, initialValues, presetValues, reviewDrafts, toDisplay, validateField, verifyExpectations } from './circuit-course-tool-common.js';
import { createCourseToolView } from './circuit-course-tool-view.js';

export function createCourseTool(host, def, env) {
  const view = createCourseToolView(host, def);
  const fields = new Map(dataFields(def).map(f => [f.key, f]));
  let basis = env.getBasis(), values = initialValues(def), drafts = {}, errors = {}, evalErrors = {}, active = -1, destroyed = false, result;

  function makeDrafts() { for (const f of fields.values()) if (f.kind === 'number') drafts[f.key] = draftText(toDisplay(f, values[f.key], basis)); }
  function verification() {
    if (active < 0) return null;
    const preset = def.presets[active], shown = evaluateTool(def, values, preset.basis ?? 'rms');
    return shown.status === 'valid' ? verifyExpectations(shown, preset.expect).map(r => ({ ...r, refBasis: preset.basis ?? 'rms' })) : null;
  }
  function render() {
    view.syncForm(values, basis, drafts, errors);
    view.showPresetState(active);
    if (result.status === 'valid') {
      if (Object.keys(errors).length) view.status('입력 오류가 있어 결과를 갱신하지 않았습니다. 마지막으로 계산한 결과를 보여 줍니다. 표시된 칸을 고치세요.', 'error');
      else view.status('입력한 값으로 바로 계산한 결과입니다.');
      view.showResult(result, verification(), basis);
    }
    else { view.status(result.reason ?? '계산할 수 없습니다.', 'error'); view.showResult({ read: '현재 값으로는 결과가 없습니다. 입력을 확인하세요.' }, null, basis); }
  }
  /**
   * One input changed (key; a select/text brings its new value). Every shown number is first re-read from its on-screen text: if any field is
   * unusable the result is not refreshed and each bad field keeps its own message. Otherwise the whole tool is evaluated; a failure is blamed on
   * the changed field and the last valid state stays on screen.
   */
  function update(key, picked) {
    const f = fields.get(key), reviewed = reviewDrafts(def, values, drafts, basis), candidate = reviewed.candidate, found = reviewed.errors;
    delete evalErrors[key];
    if (f.kind !== 'number') candidate[key] = picked;
    if (f.kind === 'select' && def.onSelect) Object.assign(candidate, def.onSelect(candidate, key) ?? {});
    // A select may hide fields (a view switch): a bad draft in a field that is no longer shown must not block the new screen.
    if (f.kind !== 'number') for (const bad of Object.keys(found)) if (!isShown(fields.get(bad), candidate)) delete found[bad];
    if (Object.keys(found).length) {
      try { validateField(f, candidate[key]); if (!found[key]) values = { ...values, [key]: candidate[key] }; } catch (e) { found[key] = e.message + FIELD_KEPT; }
      errors = { ...evalErrors, ...found };
      return false;
    }
    const next = evaluateTool(def, candidate, basis);
    if (next.status === 'valid') { values = candidate; result = next; errors = {}; evalErrors = {}; active = -1; return true; }
    // The combination fails. If an earlier field already holds an unusable combination, that field keeps the message and this (usable) value is just stored.
    if (Object.keys(evalErrors).length) values = { ...values, [key]: candidate[key] };
    else evalErrors[key] = next.reason + FIELD_KEPT;
    errors = { ...evalErrors };
    return false;
  }
  function onInput(event) {
    const target = event.target, slider = target.dataset?.ccSlider, key = slider ?? target.dataset?.ccKey;
    if (!key || !fields.has(key)) return;
    const f = fields.get(key);
    if (f.kind === 'number') { drafts[key] = slider ? draftText(Number(target.value)) : target.value; update(key); }
    else update(key, target.value);
    if (f.kind === 'select' && !Object.keys(errors).length) makeDrafts();
    render();
  }
  /** A segment button (a select drawn as buttons): same path as picking that option in a select; the current option does nothing. */
  function choose(key, value) {
    if (!fields.has(key) || values[key] === value) return;
    update(key, value);
    if (!Object.keys(errors).length) makeDrafts();
    render();
  }
  function onClick(event) {
    const segment = event.target.closest?.('[data-cc-segment]');
    if (segment && host.contains(segment)) { choose(segment.dataset.ccSegment, segment.dataset.ccChoice); return; }
    const button = event.target.closest?.('[data-cc-preset]');
    if (!button || !host.contains(button)) return;
    applyPreset(Number(button.dataset.ccPreset));
  }
  function applyPreset(index) {
    const preset = def.presets[index];
    if (!preset) return;
    env.setBasis(preset.basis ?? 'rms');
    values = presetValues(def, preset); errors = {}; evalErrors = {}; makeDrafts();
    result = evaluateTool(def, values, basis); active = index;
    render(); view.foldPresets();
  }
  const onSubmit = event => event.preventDefault();
  // Browsers fire input for a select too; some automation only fires change. Handling both is harmless (same value twice).
  const onChange = event => { if (event.target.tagName === 'SELECT') onInput(event); };
  host.addEventListener('input', onInput); host.addEventListener('change', onChange); host.addEventListener('click', onClick); host.addEventListener('submit', onSubmit);
  makeDrafts(); result = evaluateTool(def, values, basis); render();

  return {
    /** The course-wide amplitude toggle changed: numbers are rewritten in the new basis (values themselves are RMS and stay). */
    setBasis(next) { if (destroyed || next === basis) return; basis = next; errors = {}; evalErrors = {}; makeDrafts(); result = evaluateTool(def, values, basis); render(); },
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
