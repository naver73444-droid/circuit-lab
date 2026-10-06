// One shared "the user is interacting" state for the workspace: a plane drag, a 3D drag or camera turn, the Gauss
// radius slider, and a burst of wheel / resize events all count. Expensive follow-up work (the precise Gauss flux, the
// calculus probe, the final-quality render) waits for it to be idle, is cancelled the moment an interaction starts, and
// checks the generation before it commits a result.
// Pure: no DOM (the timer functions are injectable so tests can drive time by hand).

export function createInteraction({ setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const holders = new Set(), cancelers = new Set(), pulses = new Map();
  let generation = 0;
  const stopPulse = token => {
    const pending = pulses.get(token);
    if (pending === undefined) return;
    clearTimer(pending);
    pulses.delete(token);
  };
  const api = {
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
    end(token) { stopPulse(token); return holders.delete(token); },
    endAll() { for (const token of [...pulses.keys()]) stopPulse(token); holders.clear(); },
    /**
     * An interaction without a release event (wheel turns, window resizes): begin(token) now and, `delay` ms after the LAST
     * call, end it and call `settled()`, so one burst of events costs one draft render per frame and one final render at the end.
     */
    pulse(token, delay, settled = () => {}) {
      stopPulse(token);
      api.begin(token);
      pulses.set(token, setTimer(() => {
        pulses.delete(token);
        holders.delete(token);
        settled();
      }, delay));
    },
    /** Register a function that cancels pending precise work (timers); called on every begin(). Returns an unsubscribe. */
    onBegin(cancel) { cancelers.add(cancel); return () => cancelers.delete(cancel); },
    /** Is a result computed for `captured` (a generation) still current, with nothing being dragged? */
    isCurrent(captured) { return captured === generation && holders.size === 0; },
  };
  return api;
}
