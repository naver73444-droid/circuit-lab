/** Fixed editor layout. Desktop: palette | canvas | properties-or-results, waveform below (the "파형 크게" button swaps the split).
 * Phone: one panel at a time under the canvas, chosen from a bottom tab bar.
 * Presentation only; nothing here is saved, and it never touches workspace visibility. */
const PANELS = { palette: 'palette-panel', inspector: 'inspector-panel', results: 'results-panel', wave: 'wave-panel' };
const RESULT_PANES = { phasor: 'phasor-panel', port: 'port-panel' };

export function createPanelController({ beforeChange = () => {}, onChange = () => {}, isActive = () => true } = {}) {
  const mobile = matchMedia('(max-width: 899px)');
  const workbench = document.getElementById('workbench');
  const side = document.getElementById('side-panel');
  const nodes = Object.fromEntries(Object.entries(PANELS).map(([name, id]) => [name, document.getElementById(id)]));
  const panes = Object.fromEntries(Object.entries(RESULT_PANES).map(([name, id]) => [name, document.getElementById(id)]));
  const viewButtons = [...document.querySelectorAll('[data-view]')];
  const resultButtons = [...document.querySelectorAll('[data-result-view]')];
  let sideView = 'inspector', phoneView = 'palette', resultView = 'phasor', frame = null;

  const sideShows = (name) => name === 'inspector' || name === 'results';
  function isOpen(name) {
    if (name in RESULT_PANES) return isOpen('results') && resultView === name;
    if (sideShows(name)) return mobile.matches ? phoneView === name : sideView === name;
    return mobile.matches ? phoneView === name : name in PANELS;
  }
  function notify() {
    if (frame !== null) return;
    frame = requestAnimationFrame(() => { frame = null; onChange(); });
  }
  function synchronize() {
    const active = Boolean(isActive());
    for (const name of Object.keys(PANELS)) {
      const open = isOpen(name);
      nodes[name].hidden = !open; nodes[name].inert = !open || !active;
    }
    const sideOpen = !mobile.matches || sideShows(phoneView);
    side.hidden = !sideOpen; side.inert = !sideOpen || !active;
    for (const name of Object.keys(RESULT_PANES)) { panes[name].hidden = resultView !== name; }
    for (const button of viewButtons) {
      const selected = mobile.matches ? phoneView === button.dataset.view : sideView === button.dataset.view;
      button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1;
      // The "new result" dot only means something on the phone tab bar, and only until that panel is looked at.
      if (button.dataset.fresh && (!mobile.matches || selected)) { delete button.dataset.fresh; button.setAttribute('aria-label', (button.textContent ?? '').trim()); }
    }
    for (const button of resultButtons) button.setAttribute('aria-pressed', String(resultView === button.dataset.resultView));
    notify();
  }
  function scrollTo(node) {
    if (!mobile.matches || !node) return;
    workbench.scrollTop = Math.max(0, node.offsetTop - 6);
  }
  /** name: palette | inspector | results | wave | phasor | port. */
  function show(name, { scroll = true } = {}) {
    if (!isActive() || !(name in PANELS || name in RESULT_PANES)) return;
    beforeChange();
    if (name in RESULT_PANES) { resultView = name; name = 'results'; }
    if (sideShows(name)) sideView = name;
    phoneView = name;
    synchronize();
    if (scroll) scrollTo(sideShows(name) ? side : nodes[name]);
  }
  /** Phone only: bring the canvas back into view, e.g. after choosing a part or a port pin. */
  function showCanvas() { if (mobile.matches) workbench.scrollTop = 0; }

  /**
   * A new result worth looking at in `name` (an AC or transient run finished). Never switches panels: the phone puts a dot on that tab
   * (until the tab is opened), the desktop briefly highlights the panel header, which is always on screen there.
   */
  let flashTimer = null;
  function notifyResult(name = 'wave') {
    if (!isActive() || !(name in PANELS)) return;
    if (mobile.matches) {
      if (isOpen(name)) return;
      for (const button of viewButtons) {
        if (button.dataset.view !== name || button.closest?.('.side-tabs')) continue;
        button.dataset.fresh = '1';
        button.setAttribute('aria-label', `${(button.textContent ?? '').trim()} · 새 결과`);
      }
      return;
    }
    const header = nodes[name]?.querySelector?.('.wave-header');
    if (!header?.classList) return;
    header.classList.remove('result-flash');
    void header.offsetWidth; // restart the animation when two results arrive close together
    header.classList.add('result-flash');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => header.classList.remove('result-flash'), 1800);
  }
  const freshViews = () => viewButtons.filter((button) => button.dataset.fresh).map((button) => button.dataset.view);

  for (const button of viewButtons) button.addEventListener('click', () => show(button.dataset.view));
  for (const button of resultButtons) button.addEventListener('click', () => show(button.dataset.resultView, { scroll: false }));
  for (const list of document.querySelectorAll('.side-tabs, .view-tabs')) {
    list.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const tabs = [...list.querySelectorAll('[data-view]')];
      const at = tabs.indexOf(document.activeElement);
      if (at < 0) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (at + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      show(tabs[next].dataset.view, { scroll: false });
      tabs[next].focus();
    });
  }
  // Desktop only: swap the canvas/waveform split. Pure presentation, so nothing is saved.
  const sizeButton = document.getElementById('wave-size-button');
  sizeButton?.addEventListener('click', () => {
    const large = workbench.dataset.wave !== 'large';
    if (large) workbench.dataset.wave = 'large'; else delete workbench.dataset.wave;
    sizeButton.setAttribute('aria-pressed', String(large));
    sizeButton.textContent = large ? '파형 작게' : '파형 크게';
    sizeButton.title = large ? '회로 영역을 다시 크게' : '파형 영역을 크게 (회로 영역은 작아집니다)';
  });
  mobile.addEventListener('change', () => { beforeChange(); synchronize(); });
  synchronize();
  return {
    show, showCanvas, isOpen, mobile, synchronize, notifyResult, cancelInteractions: beforeChange,
    inspect: () => ({ mobile: mobile.matches, side: sideView, view: phoneView, result: resultView, fresh: freshViews() }),
  };
}
