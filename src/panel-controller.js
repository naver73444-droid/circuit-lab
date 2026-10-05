import { PANEL_SPECS, DOCKS, normalizeLayout, orderedPanels, movePanel, dropDock } from './panel-layout.js';
import { installResizeHandle } from './split-view.js';

/** One owner for visibility, position, focus and size. Moves nodes, never clones
 * forms or serializes a circuit. Mobile visibility is separate from desktop. */
export function createPanelController({ beforeChange = () => {}, onChange = () => {}, isActive = () => true } = {}) {
  const mobile = matchMedia('(max-width: 760px)');
  const storageKey = 'circuit-lab.workspace.v1';
  let layout = normalizeLayout(null);
  try { layout = normalizeLayout(JSON.parse(localStorage.getItem(storageKey))); } catch { /* Private mode or corrupt preferences: safe defaults. */ }
  const main = document.getElementById('workbench');
  const backdrop = document.getElementById('panel-backdrop');
  const announcement = document.getElementById('layout-announcement');
  const panels = Object.fromEntries(PANEL_SPECS.map(s => [s.id, document.getElementById(s.element)]));
  const triggers = Object.fromEntries(PANEL_SPECS.map(s => [s.id, document.querySelector(`[data-panel-trigger="${s.id}"]`)]));
  const docks = Object.fromEntries(DOCKS.map(id => [id, document.getElementById('dock-' + id)]));
  const shell = [...document.querySelectorAll('.topbar, .toolbar, #panel-shelf, main, footer')];
  const host = document.createElement('div'); host.id = 'mobile-panel-host'; main.after(host);
  const returnFocus = new Map();
  let activeMobile = null, dragging = null, frame = null;
  const resizers = [];
  const isOpen = name => mobile.matches ? activeMobile === name : Boolean(layout.panels[name]?.visible);
  const persist = () => { try { localStorage.setItem(storageKey, JSON.stringify(layout)); } catch { /* Layout still works without persistence. */ } };
  const announce = text => { announcement.textContent = text; };
  const notify = () => {
    if (frame !== null) return;
    frame = requestAnimationFrame(() => { frame = null; onChange(); document.dispatchEvent(new CustomEvent('panelschange')); });
  };
  const viewport = () => ({ height: window.visualViewport?.height ?? innerHeight, top: window.visualViewport?.offsetTop ?? 0 });
  function dimensions() {
    const avail = Math.max(360, main.clientWidth - 32);
    let left = layout.sizes.left, right = layout.sizes.right;
    const shownL = orderedPanels(layout, 'left', true).length, shownR = orderedPanels(layout, 'right', true).length;
    if (shownL && shownR && left + right > avail - 300) {
      const factor = Math.max(.25, (avail - 300) / (left + right)); left *= factor; right *= factor;
    }
    main.style.setProperty('--dock-left-width', `${Math.max(160, left)}px`);
    main.style.setProperty('--dock-right-width', `${Math.max(210, right)}px`);
    main.style.setProperty('--dock-bottom-height', `${Math.min(layout.sizes.bottom, Math.max(140, main.clientHeight * .45))}px`);
    const v = viewport();
    document.documentElement.style.setProperty('--sheet-top', `${v.top + 8}px`);
    document.documentElement.style.setProperty('--sheet-bottom', `${Math.max(8, innerHeight - v.top - v.height + 8)}px`);
    document.documentElement.style.setProperty('--sheet-height', `${Math.max(120, Math.min(layout.sizes.sheet, v.height - 24))}px`);
    for (const spec of PANEL_SPECS) panels[spec.id].style.setProperty('--panel-card-size', `${layout.panels[spec.id].size}px`);
  }
  function synchronize() {
    const active = Boolean(isActive());
    if (mobile.matches) {
      for (const spec of PANEL_SPECS) if (panels[spec.id].parentElement !== host) host.append(panels[spec.id]);
    } else {
      for (const dock of DOCKS) {
        const ids = orderedPanels(layout, dock);
        for (let index = 0; index < ids.length; index++) {
          const node = panels[ids[index]];
          if (docks[dock].children[index] !== node) docks[dock].insertBefore(node, docks[dock].children[index] ?? null);
        }
      }
    }
    for (const spec of PANEL_SPECS) {
      const n = spec.id, panel = panels[n], open = isOpen(n), prefs = layout.panels[n];
      panel.hidden = !open; panel.inert = !open || !active; panel.classList.toggle('collapsed', !open);
      panel.dataset.dock = prefs.dock; panel.dataset.edge = prefs.mobileEdge;
      triggers[n].setAttribute('aria-expanded', String(open)); triggers[n].classList.toggle('active', open);
      const extra = document.getElementById(n + '-open');
      // Recovery remains on the shelf. No duplicate Properties control on canvas.
      if (extra) { extra.hidden = open; extra.setAttribute('aria-expanded', String(open)); }
      const picker = panel.querySelector('[data-panel-position]');
      picker.innerHTML = mobile.matches ? '<option value="top">화면 위</option><option value="bottom">화면 아래</option>' : '<option value="left">왼쪽</option><option value="right">오른쪽</option><option value="bottom">아래</option>';
      picker.value = mobile.matches ? prefs.mobileEdge : prefs.dock;
      panel.querySelectorAll('[data-order]').forEach(b => { b.hidden = mobile.matches; });
      const modal = active && mobile.matches && open;
      panel.setAttribute('role', modal ? 'dialog' : 'region');
      if (modal) panel.setAttribute('aria-modal', 'true'); else panel.removeAttribute('aria-modal');
    }
    for (const dock of DOCKS) {
      const closed = mobile.matches || !orderedPanels(layout, dock, true).length;
      docks[dock].hidden = closed; main.classList.toggle(`no-${dock}`, closed);
    }
    const modal = active && mobile.matches && activeMobile !== null;
    backdrop.hidden = !modal; shell.forEach(el => { el.inert = modal; });
    document.body.classList.toggle('sheet-open', modal);
    dimensions(); resizers.forEach(x => x.refresh()); notify();
  }
  function set(name, closed, restore = true, trigger = null) {
    if (!isActive() || !Object.hasOwn(panels, name)) return;
    beforeChange();
    const focusedInside = panels[name].contains(document.activeElement);
    if (!closed) {
      returnFocus.set(name, trigger ?? triggers[name]);
      if (mobile.matches) {
        const previous = activeMobile;
        activeMobile = name;
        if (previous && previous !== name) returnFocus.delete(previous);
      } else layout.panels[name].visible = true;
    } else {
      if (mobile.matches && activeMobile === name) activeMobile = null;
      if (!mobile.matches) layout.panels[name].visible = false;
    }
    synchronize(); persist();
    if (!closed && !mobile.matches) panels[name].scrollIntoView({block:"nearest", inline:"nearest"});
    if (!closed && mobile.matches) panels[name].querySelector('[data-panel-close]')?.focus({ preventScroll: true });
    if (closed && restore && (focusedInside || returnFocus.has(name))) {
      const destination = returnFocus.get(name) ?? triggers[name];
      (destination?.getClientRects().length ? destination : triggers[name]).focus({ preventScroll: true });
      returnFocus.delete(name);
    }
  }
  function closeMobile() { if (mobile.matches && activeMobile) set(activeMobile, true); }
  function move(name, dock, delta = 0) {
    beforeChange(); layout = movePanel(layout, name, dock, delta); synchronize(); persist();
    announce(`${PANEL_SPECS.find(s => s.id === name).title} 패널 위치를 변경했습니다.`);
  }
  function setEdge(name, edge) {
    if (!['top', 'bottom'].includes(edge)) return;
    beforeChange(); layout.panels[name].mobileEdge = edge; synchronize(); persist();
    announce(`${edge === 'top' ? '위쪽' : '아래쪽'}에 패널을 배치했습니다.`);
  }
  function cancelDrag() {
    if (!dragging) return;
    const old = dragging; dragging = null;
    main.classList.remove('show-drop-targets'); delete main.dataset.drop;
    old.grip.classList.remove('dragging');
    try { if (old.grip.hasPointerCapture(old.id)) old.grip.releasePointerCapture(old.id); } catch {}
  }
  for (const spec of PANEL_SPECS) {
    const name = spec.id, panel = panels[name]; panel.classList.add('dock-panel'); panel.dataset.panel = name;
    let header = panel.querySelector(':scope > .panel-heading');
    if (!header) { header = document.createElement('div'); header.className = 'panel-heading'; panel.prepend(header); }
    const close = header.querySelector('button') ?? document.createElement('button');
    close.type = 'button'; close.id = name + '-toggle'; close.dataset.panelClose = name; close.className = 'panel-toggle'; close.textContent = '닫기'; close.setAttribute('aria-label', spec.title + ' 패널 닫기');
    header.replaceChildren();
    const grip = document.createElement('button'); grip.type = 'button'; grip.className = 'panel-grip'; grip.textContent = '⠿'; grip.title = '드래그하여 위치 변경. 배치 메뉴로도 변경할 수 있습니다.'; grip.setAttribute('aria-label', spec.title + ' 이동');
    const title = document.createElement('strong'); title.textContent = spec.title; title.id = name + '-panel-title'; panel.setAttribute('aria-labelledby', title.id);
    const menu = document.createElement('details'); menu.className = 'panel-menu';
    menu.innerHTML = `<summary>배치</summary><div class="panel-menu-body"><label>위치<select data-panel-position aria-label="${spec.title} 패널 위치"></select></label><div class="panel-order"><button type="button" data-order="-1">앞으로</button><button type="button" data-order="1">뒤로</button></div><small>내용·회로 데이터는 유지됩니다.</small></div>`;
    header.append(grip, title, menu, close);
    const selection = panel.querySelector("#selection-label");
    if (selection) header.after(selection);
    menu.querySelector('select').addEventListener('change', e => {
      const next = e.target.value; menu.open = false;
      mobile.matches ? setEdge(name, next) : move(name, next);
      menu.querySelector('summary').focus({ preventScroll: true });
    });
    menu.querySelectorAll('[data-order]').forEach(b => b.addEventListener('click', () => { move(name, layout.panels[name].dock, Number(b.dataset.order)); }));
    close.addEventListener('click', () => set(name, true));
    triggers[name].setAttribute('aria-controls', spec.element);
    triggers[name].addEventListener('click', e => set(name, isOpen(name), true, e.currentTarget));
    document.getElementById(name + '-open')?.addEventListener('click', e => set(name, false, true, e.currentTarget));
    // A grip is deliberately separate from the scroll area and form controls.
    grip.addEventListener('pointerdown', e => {
      if (e.button !== 0 || dragging) return;
      e.preventDefault(); beforeChange();
      dragging = { name, grip, id: e.pointerId, start: { x: e.clientX, y: e.clientY }, moved: false, dock: null, edge: null };
      try { grip.setPointerCapture(e.pointerId); } catch {}
    });
    grip.addEventListener('pointermove', e => {
      if (!dragging || e.pointerId !== dragging.id) return;
      const d = dragging;
      if (Math.hypot(e.clientX - d.start.x, e.clientY - d.start.y) < 8 && !d.moved) return;
      e.preventDefault(); d.moved = true; grip.classList.add('dragging');
      if (mobile.matches) { d.edge = e.clientY < viewport().top + viewport().height / 2 ? 'top' : 'bottom'; }
      else { main.classList.add('show-drop-targets'); d.dock = dropDock({ x: e.clientX, y: e.clientY }, main.getBoundingClientRect()); main.dataset.drop = d.dock ?? ''; }
    });
    grip.addEventListener('pointerup', e => {
      if (!dragging || e.pointerId !== dragging.id) return;
      const d = dragging; cancelDrag();
      if (d.moved) { if (mobile.matches && d.edge) setEdge(name, d.edge); else if (d.dock) move(name, d.dock); }
      else { menu.open = !menu.open; if (menu.open) menu.querySelector('select').focus(); }
    });
    for (const event of ['pointercancel', 'lostpointercapture']) grip.addEventListener(event, cancelDrag);
    let handle = panel.querySelector('.panel-height-splitter');
    if (!handle) { handle = document.createElement('div'); handle.id = name + '-height-splitter'; handle.className = 'splitter panel-height-splitter'; handle.role = 'separator'; handle.tabIndex = 0; handle.setAttribute('aria-label', spec.title + ' 패널 높이 조절'); panel.append(handle); }
    handle.dataset.resizePanel = name;
    resizers.push(installResizeHandle(handle, () => ({ enabled: true, orientation: 'horizontal',
      direction: mobile.matches && layout.panels[name].mobileEdge === 'bottom' ? -1 : 1,
      bounds: mobile.matches ? [120, Math.max(120, viewport().height - 24)] : [180, 900],
      initial: mobile.matches ? 480 : spec.size,
      read: () => mobile.matches ? Math.min(layout.sizes.sheet, Math.max(120, viewport().height - 24)) : layout.panels[name].size,
      write: value => { if (mobile.matches) layout.sizes.sheet = value; else layout.panels[name].size = value; dimensions(); notify(); },
    }), { before: beforeChange, done: persist }));
  }
  for (const [dock, id, direction] of [['left', 'palette-splitter', 1], ['right', 'results-splitter', -1], ['bottom', 'analysis-splitter', -1]]) {
    resizers.push(installResizeHandle(document.getElementById(id), () => ({ enabled: !mobile.matches,
      orientation: dock === 'bottom' ? 'horizontal' : 'vertical', direction,
      bounds: dock === 'bottom' ? [140, Math.max(140, main.clientHeight * .45)] : dock === 'left' ? [190, 430] : [240, Math.max(240, Math.min(650, main.clientWidth - 340))],
      initial: normalizeLayout(null).sizes[dock], read: () => layout.sizes[dock],
      write: value => { layout.sizes[dock] = value; dimensions(); notify(); },
    }), { before: beforeChange, done: persist }));
  }
  // Old inspector splitter now resizes the card, rather than a duplicated rail.
  resizers.push(installResizeHandle(document.getElementById('inspector-splitter'), () => ({ enabled: !mobile.matches,
    orientation: 'horizontal', direction: 1, bounds: [180, 900], initial: 255,
    read: () => layout.panels.inspector.size, write: value => { layout.panels.inspector.size = value; dimensions(); notify(); },
  }), { before: beforeChange, done: persist }));
  for (const dock of DOCKS) { const hint = document.createElement('div'); hint.className = 'drop-target drop-' + dock; hint.setAttribute('aria-hidden', 'true'); hint.textContent = { left: '왼쪽에 배치', right: '오른쪽에 배치', bottom: '아래에 배치' }[dock]; main.append(hint); }
  backdrop.addEventListener('click', closeMobile);
  document.addEventListener('keydown', e => {
    if (!isActive()) return;
    if (e.key === 'Escape' && dragging) { cancelDrag(); e.preventDefault(); e.stopPropagation(); return; }
    if (!mobile.matches || !activeMobile) return;
    const panel = panels[activeMobile];
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMobile(); return; }
    if (e.key !== 'Tab') return;
    const focusable = [...panel.querySelectorAll('button,input,select,textarea,summary,[tabindex="0"]')].filter(el => !el.disabled && !el.closest('[hidden]') && el.getClientRects().length);
    const first = focusable[0], last = focusable.at(-1);
    if (e.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) { e.preventDefault(); last?.focus(); }
    else if (!e.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) { e.preventDefault(); first?.focus(); }
  });
  function resetSizes() { beforeChange(); const defaults = normalizeLayout(null); layout.sizes = defaults.sizes; for (const spec of PANEL_SPECS) layout.panels[spec.id].size = spec.size; synchronize(); persist(); announce('패널 크기만 초기화했습니다.'); }
  function reset() { beforeChange(); cancelDrag(); layout = normalizeLayout(null); activeMobile = null; returnFocus.clear(); synchronize(); persist(); announce('기본 배치로 복원했습니다. 회로와 입력은 그대로입니다.'); }
  document.getElementById('layout-reset-button').addEventListener('click', resetSizes);
  document.getElementById('workspace-reset').addEventListener('click', reset);
  // A modal must release the canvas when the user starts choosing a port pin.
  for (const id of ['port-p-button', 'port-n-button']) document.getElementById(id).addEventListener('click', closeMobile);
  const cancelAll = () => { cancelDrag(); resizers.forEach(r => r.cancel()); beforeChange(); };
  window.addEventListener('blur', cancelAll);
  window.addEventListener('resize', () => { cancelAll(); dimensions(); resizers.forEach(r => r.refresh()); notify(); });
  window.visualViewport?.addEventListener('resize', () => { cancelAll(); dimensions(); notify(); });
  window.visualViewport?.addEventListener('scroll', dimensions);
  mobile.addEventListener('change', () => { cancelAll(); activeMobile = null; returnFocus.clear(); synchronize(); });
  synchronize();
  return { set, isOpen, closeMobile, mobile, reset, resetSizes, move, synchronize, cancelInteractions: cancelAll, inspect: () => ({ ...structuredClone(layout), activeMobile }) };
}
