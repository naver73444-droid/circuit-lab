// Per-tab memory of a study workspace (전자기 · 신호 · 회로 과정): what the learner was looking at and typing survives a reload,
// back / forward, and the workspace being built again in the same page. It lives in sessionStorage under
// `circuit-lab.session.<workspace>` (this tab only, gone when the tab closes); the circuit editor's own autosave (localStorage)
// is never touched. A plain new visit (typed address, bookmark, a link from another site) starts fresh: a reload, a history step,
// a link followed inside the app (same-origin referrer), or a second build of the same workspace in this page reads it back. Storage may be blocked or full: every access is guarded and the
// workspace then simply starts from its defaults.
export const SESSION_PREFIX = 'circuit-lab.session.';
const SAVE_DELAY_MS = 250;
const built = new Set(); // workspaces already built in this page: a second build is a remount and restores

/** 'navigate' | 'reload' | 'back_forward' | 'prerender' of the current page (unknown: 'navigate'). */
export function navigationType(win = globalThis) {
  try { return win.performance?.getEntriesByType?.('navigation')?.[0]?.type ?? 'navigate'; } catch { return 'navigate'; }
}

/** A page opened by following a link inside the app itself (same origin and path): the tab keeps its study state. */
function fromThisApp(win) {
  try {
    if (!win.document?.referrer) return false;
    const from = new URL(win.document.referrer), here = win.location;
    return from.origin === here.origin && from.pathname === here.pathname;
  } catch { return false; }
}

/**
 * name: the workspace ('em' | 'signals' | 'circuit-course'). snapshot(): a JSON-able object of the current state (called lazily,
 * at most once per save). Returns { initial, save(), flush(), dispose() }: `initial` is the stored object to restore from (null:
 * start fresh), save() writes a little later (repeated calls coalesce), flush() writes now (page hidden, workspace left).
 */
export function createWorkspaceSession(name, snapshot, { win = globalThis, delay = SAVE_DELAY_MS } = {}) {
  const key = SESSION_PREFIX + name;
  const restoring = built.has(name) || ['reload', 'back_forward'].includes(navigationType(win)) || fromThisApp(win);
  built.add(name);
  const storage = () => { try { return win.sessionStorage ?? null; } catch { return null; } };
  let initial = null;
  if (restoring) {
    try { const text = storage()?.getItem(key); initial = text ? JSON.parse(text) : null; } catch { initial = null; }
    if (!initial || typeof initial !== 'object' || Array.isArray(initial)) initial = null;
  } else {
    // A fresh visit: an older tab state must not come back on the next reload before anything was changed here.
    try { storage()?.removeItem(key); } catch { /* storage blocked */ }
  }
  let timer = 0, disposed = false;
  function flush() {
    if (timer) { win.clearTimeout(timer); timer = 0; }
    if (disposed) return;
    let text;
    try { text = JSON.stringify(snapshot()); } catch { return; } // a state that cannot be captured is skipped, never half-written
    try { storage()?.setItem(key, text); } catch { /* full or blocked: this tab just forgets */ }
  }
  const save = () => {
    if (disposed) return;
    if (timer) win.clearTimeout(timer);
    timer = win.setTimeout(flush, delay);
  };
  const onHide = () => { if (timer) flush(); };
  const onVisibility = () => { if (win.document?.hidden) onHide(); };
  win.addEventListener?.('pagehide', onHide);
  win.document?.addEventListener?.('visibilitychange', onVisibility);
  return {
    initial,
    save,
    flush,
    dispose() {
      flush();
      disposed = true;
      win.removeEventListener?.('pagehide', onHide);
      win.document?.removeEventListener?.('visibilitychange', onVisibility);
    },
  };
}

/** A finite number from stored data, or `fallback`. */
export const storedNumber = (value, fallback) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
/** A plain object from stored data (not an array), or null. */
export const storedObject = value => (value && typeof value === 'object' && !Array.isArray(value) ? value : null);
