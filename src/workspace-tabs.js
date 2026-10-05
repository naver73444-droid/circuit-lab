export function createWorkspaceTabs({ onBeforeChange = () => {}, onChange = () => {} } = {}) {
  const tabs = [...document.querySelectorAll('[data-workspace-tab]')];
  const circuitRoots = [...document.querySelectorAll('.toolbar, #panel-shelf, #workbench, .top-status, .draft-notice, .cancel-analysis, .run-button')];
  let active = tabs.find(tab => tab.getAttribute('aria-selected') === 'true')?.dataset.workspaceTab ?? 'circuit';
  let prepared = null;
  function activate(name, focus = true) {
    if (!['circuit', 'em', 'signals'].includes(name) || name === active) return false;
    if (prepared?.from === active && prepared?.to === name) prepared = null;
    else onBeforeChange(active, name);
    active = name;
    document.body.dataset.workspace = name;
    tabs.forEach(tab => {
      const selected = tab.dataset.workspaceTab === name;
      tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1;
      if (selected && focus) tab.focus({ preventScroll: true });
    });
    for (const field of ['em', 'signals']) {
      const panel = document.getElementById(field + '-workspace');
      panel.hidden = name !== field; panel.inert = name !== field;
    }
    circuitRoots.forEach(root => { root.inert = name !== 'circuit'; });
    onChange(name);
    document.dispatchEvent(new CustomEvent('workspacechange', { detail: { active: name } }));
    return true;
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('pointerdown', () => {
      const name = tab.dataset.workspaceTab;
      if (name === active) return;
      prepared = { from: active, to: name };
      onBeforeChange(active, name);
      // Finish the switch before native focus moves and fires blur. Closing a
      // mobile sheet during this phase can cancel the later click event.
      activate(name, false);
    });
    tab.addEventListener('click', () => activate(tab.dataset.workspaceTab, false));
    tab.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      activate(tabs[next].dataset.workspaceTab);
    });
  });
  document.body.dataset.workspace = active;
  return { activate, get active() { return active; } };
}
