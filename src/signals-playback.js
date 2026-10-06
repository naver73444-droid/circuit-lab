// Pure elapsed-time mapping. Discrete time is never interpolated into a result.
// `domain.rate` (units per second) overrides the default sweep of the whole range in 12 s; `loop` wraps around.
export function playbackCursor(start, elapsedMs, domain, speed, discrete = false, loop = false) {
  const perSecond = domain.rate ?? (discrete ? 2 : (domain.max - domain.min) / 12);
  const amount = (Math.max(0, elapsedMs) / 1000) * speed * perSecond;
  const travelled = start + (discrete ? Math.floor(amount) : amount);
  if (loop) {
    const span = domain.max - domain.min;
    return span > 0 ? domain.min + ((((travelled - domain.min) % span) + span) % span) : domain.min;
  }
  return Math.min(domain.max, Math.max(domain.min, travelled));
}
