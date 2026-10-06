// Advanced: the divergence / curl / flux / circulation probe. It follows the sandbox live: any change of charges,
// sensor or settings recomputes shortly after (never while a drag is still moving), and the result is three lines.
import { CALCULUS_DEFAULTS, calculusLines, evaluateCalculus } from './em-calculus.js';
import { drawCalculus } from './em-calculus-view.js';
import { parseEMNumber } from './em-source-edit.js';

const INPUTS = ['alpha', 'h', 'radius'];
const DELAY = 90;

export function createCalculusPanel({ root, editor, isSandbox, getPalette, signal, interaction = null }) {
  const $ = selector => root.querySelector(selector), pg = editor.state;
  const canvas = $('#em-c-visual'), result = $('#em-c-result'), details = root.querySelector('#em-advanced');
  let timer = null, lastKey = null, display = null, message = '';

  function settings() {
    return {
      mode: $('#em-c-field-mode').value, differentialMode: $('#em-c-differential-mode').value,
      alpha: parseEMNumber($('#em-c-alpha').value), h: parseEMNumber($('#em-c-h').value), radius: parseEMNumber($('#em-c-radius').value),
      normal: ['x', 'y', 'z'].map(axis => parseEMNumber($(`#em-c-normal-${axis}`).value)),
    };
  }

  function setSettings(value) {
    $('#em-c-field-mode').value = value.mode;
    $('#em-c-differential-mode').value = value.differentialMode;
    $('#em-c-alpha').value = value.alpha;
    $('#em-c-h').value = value.h;
    $('#em-c-radius').value = value.radius;
    ['x', 'y', 'z'].forEach((axis, i) => { $(`#em-c-normal-${axis}`).value = value.normal[i]; });
    lastKey = null;
    schedule();
  }

  function paint() {
    const lines = display ? calculusLines(display) : { lines: [message], titles: [] };
    result.replaceChildren(...lines.lines.map(text => Object.assign(document.createElement('p'), { textContent: text })));
    result.title = lines.titles.join('\n');
    drawCalculus(canvas, display, getPalette(), message);
  }

  function compute() {
    timer = null;
    if (!details.open) return;
    if (!isSandbox()) { display = null; message = '자유 배치에서만 계산합니다.'; lastKey = null; paint(); return; }
    let current;
    try { current = settings(); } catch (error) { display = null; message = `입력 오류: ${error.message}`; paint(); return; }
    const key = JSON.stringify([pg.sources, pg.probe, pg.plane, current]);
    if (key === lastKey) { paint(); return; }
    lastKey = key;
    const outcome = evaluateCalculus({ sources: pg.sources, probe: pg.probe, plane: pg.plane, settings: current });
    display = outcome.ok ? outcome.display : null;
    message = outcome.ok ? '' : outcome.error;
    paint();
  }

  function schedule() {
    if (timer !== null || !details.open) return;
    timer = setTimeout(compute, DELAY);
  }

  const watched = [
    '#em-c-field-mode', '#em-c-differential-mode', ...INPUTS.map(id => `#em-c-${id}`),
    '#em-c-normal-x', '#em-c-normal-y', '#em-c-normal-z',
  ];
  for (const selector of watched) {
    $(selector).addEventListener('input', schedule, { signal });
    $(selector).addEventListener('change', schedule, { signal });
  }
  details.addEventListener('toggle', schedule, { signal });
  signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
  // A pending computation is dropped the moment any interaction starts (it would run into the drag); the render that follows the
  // interaction's end asks for a fresh one through update().
  interaction?.onBegin(() => { clearTimeout(timer); timer = null; });

  return {
    settings, setSettings,
    defaults: () => structuredClone(CALCULUS_DEFAULTS),
    /** Ask for a fresh computation after the sandbox changed; `dragging` postpones it until the pointer is released. */
    update(dragging = false) { if (!dragging) schedule(); },
    redraw() { if (details.open) paint(); },
  };
}
