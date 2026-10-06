// One shared "the user is interacting" state for the workspace: a plane drag, a 3D drag or camera turn, and the Gauss
// radius slider all count. Expensive follow-up work (the precise Gauss flux, the calculus probe) waits for it to be idle,
// is cancelled the moment an interaction starts, and checks the generation before it commits a result.
// Pure: no DOM.

export function createInteraction() {
  const holders = new Set(), cancelers = new Set();
  let generation = 0;
  return {
    /** True while any interaction (identified by a token string) is in progress. */
    get active() { return holders.size > 0; },
    /** Grows on every begin(); a callback that captured an older value belongs to an interaction that has since started. */
    get generation() { return generation; },
    /** Start (or keep) the interaction `token`: pending precise work is cancelled and its generation is outdated. */
    begin(token) {
      holders.add(token);
      generation += 1;
      for (const cancel of cancelers) cancel();
    },
    end(token) { return holders.delete(token); },
    endAll() { holders.clear(); },
    /** Register a function that cancels pending precise work (timers); called on every begin(). Returns an unsubscribe. */
    onBegin(cancel) { cancelers.add(cancel); return () => cancelers.delete(cancel); },
    /** Is a result computed for `captured` (a generation) still current, with nothing being dragged? */
    isCurrent(captured) { return captured === generation && holders.size === 0; },
  };
}
