// Time axis of the time-dependent experiments: which parameter is the clock, how far the scrubber runs, how it
// advances while playing and the emf(t) trace. Pure: no DOM. Evaluation is the experiment's own evaluate().

const TIME_KEY = 'time';
// One full sweep of the scrubber takes this many seconds of playback.
export const SWEEP_SECONDS = 4;
export const TIME_EXPERIMENTS = Object.freeze(['faraday-loop', 'motional-rod', 'wave-medium', 'wave-interface-normal', 'transmission-lossless']);
// Experiments whose emf(t) is worth a small trace under the picture.
const TRACED = new Set(['faraday-loop', 'motional-rod']);

/**
 * The scrubber of an experiment, or null when it is not time dependent.
 * Returns { key, min, max, displayScale, unit }: faraday runs two periods of B(t), the moving rod until it reaches
 * the end of the rail, a wave or a transmission line two periods of the source frequency.
 */
export function timeSpec(definition, params) {
  const parameter = definition.parameters?.find(p => p.key === TIME_KEY);
  if (!parameter || !TIME_EXPERIMENTS.includes(definition.id)) return null;
  let max;
  if (definition.id === 'faraday-loop') max = params.omega > 0 ? 2 * (2 * Math.PI / params.omega) : 1;
  else if (definition.id === 'motional-rod') {
    const { velocity, x0, railLength } = params;
    max = velocity === 0 ? 1 : (velocity > 0 ? railLength - x0 : x0) / Math.abs(velocity) * 0.985;
  } else max = 2 / params.frequency;
  if (!(max > 0) || !Number.isFinite(max)) max = 1;
  return {
    key: TIME_KEY, min: 0, max: Math.min(max, parameter.max),
    displayScale: parameter.displayScale || 1, unit: parameter.displayUnit ?? parameter.unit ?? 's',
  };
}

/** Clock position after `seconds` of playback, wrapping at the end of the sweep. */
export function advanceTime(spec, time, seconds) {
  const span = spec.max - spec.min;
  const next = time + seconds * span / SWEEP_SECONDS;
  return next > spec.max ? spec.min + (next - spec.min) % span : Math.max(spec.min, next);
}

/** A time inside the scrubber's range. */
export const clampTime = (spec, time) => Math.min(spec.max, Math.max(spec.min, time));

/**
 * emf(t) over the sweep for the traced experiments: { points: [{ t, value }], unit } or null.
 * Samples where the experiment is not valid are skipped.
 */
export function timeTrace(definition, params, spec, samples = 120) {
  if (!TRACED.has(definition.id)) return null;
  const points = [];
  let unit = 'V';
  for (let i = 0; i < samples; i += 1) {
    const t = spec.min + (spec.max - spec.min) * i / (samples - 1);
    let result;
    try { result = definition.evaluate({ ...params, [spec.key]: t }, definition.probeDefault); } catch { continue; }
    const emf = result.status === 'valid' ? result.scalars.find(item => item.key === 'emf') : null;
    if (emf && Number.isFinite(emf.value)) { points.push({ t, value: emf.value }); unit = emf.unit || unit; }
  }
  return points.length > 1 ? { points, unit } : null;
}

// Instantaneous quantity along z at the current time for the wave and transmission-line experiments, read from the
// experiment's own evaluate(): [{ key, label, unit, points: [{ coordinate, value }] }], one per profile envelope.
const INSTANT = {
  'wave-medium': [
    { key: 'Ex', label: 'E_x(z, t)', unit: 'V/m', read: r => r.vectors?.E?.[0] },
    { key: 'Hy', label: 'H_y(z, t)', unit: 'A/m', read: r => r.vectors?.H?.[1] },
  ],
  'wave-interface-normal': [
    { key: 'Ex', label: 'E_x(z, t)', unit: 'V/m', read: r => r.vectors?.E?.[0] },
    { key: 'Hy', label: 'H_y(z, t)', unit: 'A/m', read: r => r.vectors?.H?.[1] },
  ],
  'transmission-lossless': [
    { key: 'v', label: 'v(z, t)', unit: 'V', read: r => r.scalars?.find(s => s.key === 'voltage')?.value },
    { key: 'i', label: 'i(z, t)', unit: 'A', read: r => r.scalars?.find(s => s.key === 'current')?.value },
  ],
};

export function instantProfiles(definition, params, domain, samples = 161) {
  const spec = INSTANT[definition.id];
  if (!spec || !(domain[1] > domain[0])) return null;
  const series = spec.map(({ key, label, unit }) => ({ key, label, unit, points: [] }));
  for (let i = 0; i < samples; i += 1) {
    const z = domain[0] + (domain[1] - domain[0]) * i / (samples - 1);
    let result;
    try { result = definition.evaluate({ ...params }, [0, 0, z]); } catch { continue; }
    if (result.status !== 'valid') continue;
    spec.forEach(({ read }, index) => {
      const value = read(result);
      if (Number.isFinite(value)) series[index].points.push({ coordinate: z, value });
    });
  }
  return series.every(s => s.points.length > 1) ? series : null;
}
