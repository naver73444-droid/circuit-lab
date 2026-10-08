// The browser's back button inside the app (history.pushState / popstate). Two kinds of steps:
//  - each workspace switch is one history entry (address ?workspace=<name>; the circuit editor has none), so back returns to the
//    workspace before, and only the entry the app was opened with leaves the app;
//  - on a phone, while an overlay is open (value sheet, file menu, help card) one extra entry sits on top, so back closes it first.
// Overlays are watched, not owned: each one reports isOpen() and offers close(). Closed any other way (✕, an outside tap), its entry
// stays but is marked spent, and the next back press skips it (no history.back() of our own while the student is still tapping:
// a traversal racing the next tap is avoidable). Presentation only: nothing here is saved.
const KEY = "circuitLab";

/**
 * workspaces: { active(): name, activate(name) }; overlays: [{ isOpen(): boolean, close() }]; phone: a MediaQueryList.
 * Returns { overlaysChanged, inspect }: call overlaysChanged() whenever an overlay may have opened or closed.
 */
export function createBackNavigation({ workspaces, overlays = [], phone, win = window, doc = document }) {
  const history = win.history;
  let overlayStep = false; // the current entry is our overlay entry and an overlay is open
  let spent = false;       // the current entry was an overlay entry whose overlay was closed without the back button
  let restoring = false;   // a popstate is switching the workspace: do not record that switch again
  let pushes = 0;

  const entry = (overlay = false, extra = {}) => ({ [KEY]: { workspace: workspaces.active(), overlay, ...extra } });
  function urlFor(name) {
    const url = new URL(win.location.href);
    if (name === "circuit") url.searchParams.delete("workspace"); else url.searchParams.set("workspace", name);
    return url.pathname + url.search + url.hash;
  }
  const anyOpen = () => Boolean(phone?.matches) && overlays.some((overlay) => { try { return overlay.isOpen(); } catch { return false; } });

  function overlaysChanged() {
    const open = anyOpen();
    if (open && !overlayStep) {
      overlayStep = true;
      if (spent) { spent = false; history.replaceState(entry(true), "", win.location.href); } // reuse the spent step
      else { pushes += 1; history.pushState(entry(true), "", win.location.href); }
    } else if (!open && overlayStep) {
      overlayStep = false; spent = true;
      history.replaceState(entry(false, { spent: true }), "", win.location.href);
    }
  }

  function workspaceChanged(name) {
    if (!restoring) {
      // An overlay step (open, or spent) on top becomes the workspace step; otherwise the switch is a new step.
      if (overlayStep || spent) { overlayStep = false; spent = false; history.replaceState(entry(), "", urlFor(name)); }
      else { pushes += 1; history.pushState(entry(), "", urlFor(name)); }
    }
    // A circuit overlay left open (the help card) counts again once the editor is back.
    queueMicrotask(overlaysChanged);
  }

  win.addEventListener("popstate", (event) => {
    const target = event.state?.[KEY] ?? null;
    const leftSpent = spent;
    spent = false;
    if (overlayStep) {
      overlayStep = false;
      for (const overlay of overlays) { try { if (overlay.isOpen()) overlay.close(); } catch { /* keep going */ } }
    }
    const fromUrl = new URLSearchParams(win.location.search).get("workspace");
    const name = target?.workspace ?? fromUrl ?? "circuit";
    if (target?.overlay || target?.spent) spent = true; // forward into an overlay step whose overlay is closed
    if (name !== workspaces.active()) {
      restoring = true;
      try { workspaces.activate(name); } finally { restoring = false; }
    } else if (leftSpent) history.back(); // the step left was a closed overlay: this back press changed nothing yet, take the next step
  });
  doc.addEventListener("workspacechange", (event) => workspaceChanged(event.detail?.active ?? workspaces.active()));
  phone?.addEventListener?.("change", overlaysChanged);

  // The entry the app was opened with names its workspace too, so returning to it restores that workspace.
  history.replaceState(entry(), "", urlFor(workspaces.active()));
  overlaysChanged();

  return { overlaysChanged, inspect: () => ({ overlayStep, spent, pushes, length: history.length, state: history.state?.[KEY] ?? null }) };
}

/** Overlay adapter for a <details> popover (file menu, help card): open while [open], closed by removing it. */
export function detailsOverlay(details, isActive = () => true) {
  return { isOpen: () => Boolean(details && isActive() && details.open), close: () => { if (details) details.open = false; } };
}
