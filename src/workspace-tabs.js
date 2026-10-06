// Loads a workspace controller module on demand. Keeps one cached module promise
// and one controller instance, shows a lightweight status in the workspace host
// while loading, and offers a retry button if the import fails.
// Browsers remember a failed module fetch for the life of the page, so a retry
// calls load('?retry=N') and the loader must append that suffix to the URL.
export function createLazyController({ host, load, create }) {
  let modulePromise = null, building = null, controller = null, statusNode = null, failures = 0;
  function loadModule() {
    if (!modulePromise) {
      const promise = Promise.resolve().then(() => load(failures ? '?retry=' + failures : ''));
      modulePromise = promise;
      promise.catch(() => { if (modulePromise === promise) { modulePromise = null; failures += 1; } });
    }
    return modulePromise;
  }
  function clearStatus() {
    statusNode?.remove(); statusNode = null;
    delete host.dataset.workspaceLoading;
  }
  function showStatus(failed) {
    statusNode?.remove();
    const node = document.createElement('div');
    node.className = 'workspace-loading';
    node.setAttribute('role', failed ? 'alert' : 'status');
    const text = document.createElement('p');
    text.textContent = failed ? '화면을 불러오지 못했습니다. 연결을 확인한 뒤 다시 시도하세요. 계속 실패하면 작업을 저장하고 페이지를 새로고침하세요.' : '불러오는 중…';
    node.append(text);
    if (failed) {
      const button = document.createElement('button');
      button.type = 'button'; button.textContent = '다시 시도';
      button.addEventListener('click', () => { showStatus(false); retry?.(); });
      node.append(button);
    }
    host.dataset.workspaceLoading = failed ? 'error' : 'loading';
    host.prepend(node); statusNode = node;
  }
  let retry = null;
  function ensure() {
    if (controller) return Promise.resolve(controller);
    if (!building) {
      const promise = loadModule().then(module => { if (!controller) controller = create(module, host); return controller; });
      building = promise;
      promise.then(() => {}, () => { if (building === promise) building = null; });
    }
    return building;
  }
  // Runs run(controller) as soon as the controller exists. Callers guard run()
  // with their own switch token so stale requests do nothing.
  function whenReady(run) {
    if (controller) { run(controller); return true; }
    retry = () => whenReady(run);
    if (!statusNode) showStatus(false);
    ensure().then(
      ready => { clearStatus(); run(ready); },
      () => showStatus(true),
    );
    return false;
  }
  return {
    get controller() { return controller; },
    prefetch() { loadModule().catch(() => {}); },
    ensure,
    whenReady,
  };
}

/** Top-level workspaces; each non-circuit one owns a panel with id "<name>-workspace". */
export const WORKSPACES = ['circuit', 'em', 'signals', 'circuit-course'];

export function createWorkspaceTabs({ onBeforeChange = () => {}, onChange = () => {}, onIntent = () => {} } = {}) {
  const tabs = [...document.querySelectorAll('[data-workspace-tab]')];
  const circuitRoots = [document.getElementById('workbench')];
  let active = tabs.find(tab => tab.getAttribute('aria-selected') === 'true')?.dataset.workspaceTab ?? 'circuit';
  let prepared = null;
  function activate(name, focus = true) {
    if (!WORKSPACES.includes(name) || name === active) return false;
    if (prepared?.from === active && prepared?.to === name) prepared = null;
    else onBeforeChange(active, name);
    active = name;
    document.body.dataset.workspace = name;
    tabs.forEach(tab => {
      const selected = tab.dataset.workspaceTab === name;
      tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1;
      if (selected && focus) tab.focus({ preventScroll: true });
    });
    for (const field of WORKSPACES.filter(item => item !== 'circuit')) {
      const panel = document.getElementById(field + '-workspace');
      panel.hidden = name !== field; panel.inert = name !== field;
    }
    circuitRoots.forEach(root => { root.inert = name !== 'circuit'; root.hidden = name !== 'circuit'; });
    onChange(name);
    document.dispatchEvent(new CustomEvent('workspacechange', { detail: { active: name } }));
    return true;
  }
  tabs.forEach((tab, index) => {
    // Warm the module for a tab the user is about to open.
    const intent = () => onIntent(tab.dataset.workspaceTab);
    tab.addEventListener('pointerenter', intent);
    tab.addEventListener('focus', intent);
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
