/** Fixed editor layout. Desktop: palette | canvas | properties-or-results, waveform below (the "파형 크게" button swaps the split).
 * Phone: one panel at a time under the canvas, chosen from a bottom tab bar (회로 · 속성 · 결과 · 파형). "회로" is the canvas with the
 * part list right under it: from another panel it scrolls back to the canvas, from the canvas it scrolls on to the part list. The
 * highlighted tab follows the scroll position: the open panel's tab while that panel fills the screen, 회로 while the canvas does.
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
  const tabBar = document.querySelector?.('.view-tabs') ?? null;
  // Layout boxes; a node without layout (a hidden one, or a test double) counts as an empty box at its offset.
  const box = (node) => node?.getBoundingClientRect?.() ?? { top: node?.offsetTop ?? 0, bottom: node?.offsetTop ?? 0, height: 0 };
  let sideView = 'inspector', phoneView = 'palette', resultView = 'phasor', frame = null;
  let current = 'palette'; // phone: the tab the scroll position belongs to

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
      const opened = mobile.matches ? phoneView === button.dataset.view : sideView === button.dataset.view;
      // The "new result" dot only means something on the phone tab bar, and only until that panel is looked at.
      if (button.dataset.fresh && (!mobile.matches || opened)) { delete button.dataset.fresh; button.setAttribute('aria-label', (button.textContent ?? '').trim()); }
    }
    current = measureCurrent();
    markTabs();
    for (const button of resultButtons) button.setAttribute('aria-pressed', String(resultView === button.dataset.resultView));
    notify();
  }
  function markTabs() {
    for (const button of viewButtons) {
      const onPhoneBar = mobile.matches && tabBar?.contains(button);
      const selected = onPhoneBar ? current === button.dataset.view : mobile.matches ? phoneView === button.dataset.view : sideView === button.dataset.view;
      button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1;
    }
  }
  /** Phone: the lowest screen line not covered by the fixed tab bar or the docked value sheet. */
  function visibleBottom() {
    let bottom = Math.min(box(workbench).bottom || Infinity, globalThis.innerHeight ?? Infinity);
    for (const element of [tabBar, document.getElementById('value-sheet')]) {
      if (!element || element.hidden) continue;
      const area = box(element);
      if (area.height > 0 && area.top < bottom) bottom = area.top;
    }
    return bottom;
  }
  const panelNode = (name) => (sideShows(name) ? side : nodes[name]);
  /** Phone: the open panel's tab while it fills (most of) the visible area, else 회로 (the canvas and part list above it). */
  function measureCurrent() {
    if (!mobile.matches || phoneView === 'palette') return phoneView;
    const panel = panelNode(phoneView);
    const top = box(workbench).top, bottom = visibleBottom(), area = box(panel);
    const seen = Math.max(0, Math.min(area.bottom, bottom) - Math.max(area.top, top));
    return seen >= Math.min(area.height * 0.9, (bottom - top) * 0.5) ? phoneView : 'palette';
  }
  function updateCurrent() {
    const next = measureCurrent();
    if (next !== current) { current = next; markTabs(); }
  }
  let scrollFrame = null;
  workbench.addEventListener('scroll', () => {
    if (scrollFrame !== null || !mobile.matches) return;
    scrollFrame = requestAnimationFrame(() => { scrollFrame = null; updateCurrent(); });
  }, { passive: true });

  /** Phone: the plot's value line must be readable, not under the tab bar or the value sheet: scroll on until it clears them, but
   * never past the top of the plot. Used when 파형 opens (after the panel top is brought up) and after a tap on the plot. */
  function revealReadout() {
    if (!mobile.matches || phoneView !== 'wave') return;
    const plot = document.querySelector?.('#wave-panel .plot-wrap'), readout = document.getElementById('cursor-readout');
    if (!plot?.getBoundingClientRect || !readout?.getBoundingClientRect) return;
    const overflow = box(readout).bottom - (visibleBottom() - 6);
    if (overflow <= 0) return;
    const room = box(plot).top - (box(workbench).top + 6);
    if (room > 0) workbench.scrollTop += Math.min(overflow, room);
  }
  function scrollTo(node) {
    if (!mobile.matches || !node) return;
    workbench.scrollTop = Math.max(0, node.offsetTop - 6);
    if (node === nodes.wave) revealReadout();
  }
  /** name: palette | inspector | results | wave | phasor | port. */
  function show(name, { scroll = true } = {}) {
    if (!isActive() || !(name in PANELS || name in RESULT_PANES)) return;
    beforeChange();
    // 회로 tab: back to the canvas from anywhere else; already at the canvas with the part list under it, on to the part list.
    const toCanvas = name === 'palette' && mobile.matches && !(phoneView === 'palette' && workbench.scrollTop < 8);
    if (name in RESULT_PANES) { resultView = name; name = 'results'; }
    if (sideShows(name)) sideView = name;
    phoneView = name;
    synchronize();
    if (scroll) { if (toCanvas) workbench.scrollTop = 0; else scrollTo(panelNode(name)); }
    updateCurrent();
  }
  /** Phone only: bring the canvas back into view, e.g. after choosing a part or a port pin. */
  function showCanvas() { if (mobile.matches) { workbench.scrollTop = 0; updateCurrent(); } }
  // The plot's own pointer handling pins the cursor (editor-input.js); this only watches, after it.
  document.getElementById('wave-plot')?.addEventListener('pointerup', () => requestAnimationFrame(revealReadout));

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
    inspect: () => ({ mobile: mobile.matches, side: sideView, view: phoneView, current, result: resultView, fresh: freshViews() }),
  };
}
