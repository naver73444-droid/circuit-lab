// Optional User Timing entries for the EM workspace. They are off unless a page sets globalThis.__EM_PERF__ = true (the
// browser performance test does), so normal use adds nothing to the performance timeline. perfMeasure returns `end`, so a
// caller can chain laps: mark = perfMeasure('em:grid', mark).
export function perfMeasure(name, start, end = performance.now()) {
  if (globalThis.__EM_PERF__ === true) performance.measure(name, { start, end });
  return end;
}
