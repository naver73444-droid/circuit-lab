// Inline inspector for the selected source: a strength slider (+ exact number), position fields, copy / delete.
// Every change applies live through editor.updateSource(); one slider drag or one typed number is one undo step.
import { escapeHtml } from './safe-dom.js';
import { inspectorFields, patchFromField, sliderFromStrength, sourceTitle, strengthFromSlider } from './em-source-edit.js';

const show = value => String(Number(Number(value).toPrecision(6)));

export function createInspector({ host, editor, request, getPlane, signal }) {
  const pg = editor.state;
  let structure = null;

  const selected = () => pg.sources.find(source => source.id === pg.selectedId) ?? null;
  const input = id => host.querySelector(`[data-em-field="${id}"]`);

  function build(source, plane) {
    const fields = inspectorFields(source, plane);
    const strength = fields[0], rest = fields.slice(1);
    const sliderRow = `<label class="em-slider-row">${escapeHtml(strength.label)}
      <input aria-label="${escapeHtml(strength.label)} 슬라이더" data-em-field="strength-slider"
        max="1" min="-1" step="0.002" type="range" value="0">
      <span class="em-number"><input aria-label="${escapeHtml(strength.label)} (${strength.unit})"
        data-em-field="strength" inputmode="decimal"><i>${strength.unit}</i></span></label>`;
    const others = rest.map(field => `<label>${escapeHtml(field.label)}
      <span class="em-number"><input data-em-field="${field.id}" inputmode="decimal"><i>${field.unit}</i></span></label>`).join('');
    host.innerHTML = `<div class="em-side-head"><strong>${escapeHtml(sourceTitle(source))}</strong>
      <span class="em-inspector-actions"><button data-em-act="clone" type="button">복제</button>
        <button data-em-act="delete" type="button">삭제</button></span></div>
      <label class="em-check"><input data-em-enabled type="checkbox"> 계산에 포함</label>
      ${sliderRow}<div class="em-field-grid">${others}</div>`;
  }

  function fill(source, plane) {
    for (const field of inspectorFields(source, plane)) {
      const element = input(field.id);
      if (element && element !== document.activeElement) element.value = show(field.value);
      if (field.id === 'strength') {
        const slider = input('strength-slider');
        if (slider !== document.activeElement) slider.value = String(sliderFromStrength(field.value));
      }
    }
    host.querySelector('[data-em-enabled]').checked = source.enabled !== false;
  }

  function sync() {
    const source = selected(), plane = getPlane();
    if (!source) {
      structure = null;
      host.innerHTML = '<p class="em-note">전하를 누르면 여기서 세기와 위치를 바꿀 수 있습니다.</p>';
      return;
    }
    const key = `${source.id}:${source.type}:${plane}`;
    if (key !== structure) { build(source, plane); structure = key; }
    fill(source, plane);
  }

  function applyField(id, value) {
    const source = selected();
    if (!source) return;
    const patch = patchFromField(source, getPlane(), id, value);
    const element = input(id === 'strength-slider' ? 'strength' : id);
    if (!patch) { element?.setAttribute('aria-invalid', 'true'); return; }
    const ok = editor.updateSource(source.id, patch);
    if (ok) host.querySelectorAll('[aria-invalid]').forEach(node => node.removeAttribute('aria-invalid'));
    else element?.setAttribute('aria-invalid', 'true');
    request();
  }

  host.addEventListener('input', event => {
    const field = event.target.dataset.emField;
    if (!field) return;
    if (field === 'strength-slider') {
      const nc = strengthFromSlider(Number(event.target.value));
      const text = input('strength');
      text.value = show(nc);
      applyField('strength', nc);
      return;
    }
    const text = event.target.value.trim();
    applyField(field, text === '' ? NaN : Number(text));
    if (field === 'strength' && text !== '' && Number.isFinite(Number(text))) {
      input('strength-slider').value = String(sliderFromStrength(Number(text)));
    }
  }, { signal });
  // A finished edit (slider released, field left) closes the undo step.
  host.addEventListener('change', event => {
    if (event.target.dataset.emEnabled !== undefined) {
      const source = selected();
      if (source) { editor.setEnabled(source.id, event.target.checked); request(); }
      return;
    }
    editor.endEdit();
    request();
  }, { signal });
  host.addEventListener('click', event => {
    const action = event.target.closest('[data-em-act]')?.dataset.emAct;
    if (action === 'clone') editor.cloneSelected();
    else if (action === 'delete') editor.removeSelected();
    else return;
    request();
  }, { signal });

  return { sync };
}
