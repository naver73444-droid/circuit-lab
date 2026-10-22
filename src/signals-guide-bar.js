// Guided-mode strip of a signals lesson (DOM only): the step bar, the step's explanation and the quick presets ("해 보기").
// The controller owns the state; this module only mirrors it into the three containers it was given. Buttons are created
// once per step list / step and afterwards only re-attributed (create-once / update), so focus survives a repaint.
// guide = { steps: [{ id, title, short, tiny? }], chips(stepId) -> [{ label, params }], body(stepId, params) -> text }.
// A step with `tiny` carries both labels; the stylesheet shows `short` on a wide screen and `tiny` on a phone (the hidden one
// is display:none, so it is not part of the button's accessible name). The full title stays in the title attribute.

const sameParams = (preset, params) => Object.entries(preset).every(([key, value]) => Math.abs((params[key] ?? NaN) - value) < 1e-9);

export function createGuideBar({ doc, steps, body, chips }) {
  let stepsOf = null; // the guide whose step buttons are built
  let chipsOf = '';   // the step whose presets are built

  function button(parent, attrs, text) {
    const node = doc.createElement('button');
    node.type = 'button';
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    node.textContent = text;
    parent.append(node);
    return node;
  }

  return {
    // `step` is the step on screen, or null (free mode, or a lesson without a guide): then all three containers hide.
    sync(guide, step, params) {
      for (const node of [steps, body, chips]) if (node.hidden !== !step) node.hidden = !step;
      if (!guide || !step) return;
      if (stepsOf !== guide) {
        steps.replaceChildren();
        for (const s of guide.steps) {
          const node = button(steps, { 'data-signals-step': s.id, title: s.title }, s.tiny ? '' : s.short);
          if (s.tiny) {
            for (const [cls, text] of [['sg-step-full', s.short], ['sg-step-tiny', s.tiny]]) {
              const span = doc.createElement('span');
              span.className = cls;
              span.textContent = text;
              node.append(span);
            }
          }
        }
        stepsOf = guide;
      }
      for (const node of steps.querySelectorAll('[data-signals-step]')) {
        if (node.dataset.signalsStep === step) { if (node.getAttribute('aria-current') !== 'step') node.setAttribute('aria-current', 'step'); }
        else if (node.hasAttribute('aria-current')) node.removeAttribute('aria-current');
      }
      const text = guide.body(step, params);
      if (body.textContent !== text) body.textContent = text;
      const presets = guide.chips(step);
      if (chipsOf !== step) {
        chips.replaceChildren();
        const name = doc.createElement('span');
        name.className = 'sg-name';
        name.textContent = '해 보기';
        chips.append(name);
        presets.forEach((preset, i) => button(chips, { 'data-signals-chip': String(i), 'aria-pressed': 'false' }, preset.label));
        chipsOf = step;
      }
      // A preset shows as pressed while the sliders still hold exactly its values.
      chips.querySelectorAll('[data-signals-chip]').forEach((node, i) => {
        const pressed = String(Boolean(presets[i]) && sameParams(presets[i].params, params));
        if (node.getAttribute('aria-pressed') !== pressed) node.setAttribute('aria-pressed', pressed);
      });
    },
  };
}
