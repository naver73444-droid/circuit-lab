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
    // A rod that already sits at (or beyond) the end it moves towards has no time after t = 0 where the model holds: the range
    // is empty and the scrubber is disabled with the reason, instead of a made-up one-second range that is all unsupported.
    if (velocity !== 0 && !(max > 0)) {
      return {
        key: TIME_KEY, min: 0, max: 0, displayScale: parameter.displayScale || 1, unit: parameter.displayUnit ?? parameter.unit ?? 's',
        disabled: true, reason: '막대가 이미 레일 끝에 있어 t > 0은 지원하지 않습니다. x₀나 속도를 바꾸세요.',
      };
    }
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
  if (!(span > 0)) return spec.min;
  const next = time + seconds * span / SWEEP_SECONDS;
  return next > spec.max ? spec.min + (next - spec.min) % span : Math.max(spec.min, next);
}

/** A time inside the scrubber's range. */
export const clampTime = (spec, time) => Math.min(spec.max, Math.max(spec.min, time));

/**
 * `params` with the clock parameter moved into the scrubber range that these very params define (the range depends on the
 * frequency / omega / rail geometry). Returns the same object when nothing changes. Every computation that follows a
 * parameter change must use the result, so the displayed time and the evaluated time can never differ.
 */
export function normalizeTime(definition, params) {
  const spec = timeSpec(definition, params);
  if (!spec || !Number.isFinite(params[spec.key])) return params;
  const time = clampTime(spec, params[spec.key]);
  return time === params[spec.key] ? params : { ...params, [spec.key]: time };
}

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

// Where the experiment is defined along z: the transmission line only between its input (z = -length) and its load (z = 0).
// Outside it every sample would be skipped, so the span that sets the sample count is cut to this range.
const SUPPORT = { 'transmission-lossless': params => [-params.length, 0] };

/** The span of z where the experiment is defined (the transmission line only between its input and its load), or null. */
export const instantSupport = (definition, params) => SUPPORT[definition.id]?.(params) ?? null;

/**
 * What to draw for each profile of a profile picture. `profiles` are the experiment's amplitude envelopes (an unresolved one has
 * no points: the 513-point cap), `instant` the instantaneous curves at the current time (or null). Each entry:
 * { index, envelope, live, instantUnresolved } where `live` is the resolved instantaneous series (drawn alone when the
 * envelope is unresolved, with the dashed envelope behind it otherwise) and instantUnresolved says the instantaneous curve could
 * not be resolved (the picture then says so instead of drawing it). A profile with nothing resolvable is left out.
 */
export function profileLayers(profiles, instant) {
  const layers = [];
  (profiles || []).slice(0, 3).forEach((data, index) => {
    const envelope = Boolean(data.points?.length) && data.sampling?.status !== 'unresolved';
    const item = instant?.[index];
    const live = item && item.status !== 'unresolved' && item.points?.length > 1 ? item : null;
    const instantUnresolved = item?.status === 'unresolved';
    if (envelope || live) layers.push({ index, envelope, live, instantUnresolved: envelope && instantUnresolved });
  });
  return layers;
}

export const MIN_SAMPLES = 161;
export const SAMPLES_PER_WAVELENGTH = 16;
export const MAX_SAMPLES = 4000;
export const UNRESOLVED_TEXT = '미해상도 (파장이 너무 짧음)';

// The shortest wavelength shown over `domain`, read from the experiment's own 'wavelength' scalar at both ends of the domain
// (and on both sides of z = 0, where an interface changes the medium). null when the experiment does not report one.
function shortestWavelength(definition, params, domain) {
  const span = domain[1] - domain[0], tiny = 1e-9 * span;
  const probes = [domain[0], domain[1]];
  if (domain[0] < 0 && domain[1] > 0) probes.push(-tiny, tiny);
  let shortest = Infinity;
  for (const z of probes) {
    let result;
    try { result = definition.evaluate({ ...params }, [0, 0, z]); } catch { continue; }
    const value = result.scalars?.find(item => item.key === 'wavelength')?.value;
    if (Number.isFinite(value) && value > 0) shortest = Math.min(shortest, value);
  }
  return Number.isFinite(shortest) ? shortest : null;
}

/**
 * Instantaneous v(z, t) / E_x(z, t)-style curves over `domain` for the wave and transmission-line experiments:
 * [{ key, label, unit, points: [{ coordinate, value }] }], or null when the experiment has none.
 *
 * The sample count follows the display: at least SAMPLES_PER_WAVELENGTH samples per shortest wavelength (never fewer than
 * MIN_SAMPLES). When that needs more than MAX_SAMPLES the curve would alias into a misleading flat line, so each series is
 * returned with status 'unresolved', no points and the reason UNRESOLVED_TEXT instead of a wrong curve.
 *
 * Each series keeps every sample whose own quantity is finite. The experiment's overall status does not gate the
 * plot: a transmission line with an open load reports 'singular' (the input impedance has a pole) while v(z, t) and
 * i(z, t) are perfectly finite, and 'boundary' samples at the two terminals are valid limits too.
 */
export function instantProfiles(definition, params, requested, samples = null) {
  const spec = INSTANT[definition.id];
  if (!spec || !(requested[1] > requested[0])) return null;
  const support = SUPPORT[definition.id]?.(params);
  const domain = support ? [Math.max(requested[0], support[0]), Math.min(requested[1], support[1])] : requested;
  if (!(domain[1] > domain[0])) return null;
  const series = spec.map(({ key, label, unit }) => ({ key, label, unit, points: [], status: 'resolved' }));
  const wavelength = shortestWavelength(definition, params, domain);
  const needed = wavelength ? Math.ceil(SAMPLES_PER_WAVELENGTH * (domain[1] - domain[0]) / wavelength) + 1 : MIN_SAMPLES;
  if (samples === null && needed > MAX_SAMPLES) {
    return series.map(item => ({ ...item, status: 'unresolved', reason: UNRESOLVED_TEXT, requiredSamples: needed, wavelength }));
  }
  const count = samples ?? Math.max(MIN_SAMPLES, needed);
  for (let i = 0; i < count; i += 1) {
    const z = domain[0] + (domain[1] - domain[0]) * i / (count - 1);
    let result;
    try { result = definition.evaluate({ ...params }, [0, 0, z]); } catch { continue; }
    spec.forEach(({ read }, index) => {
      const value = read(result);
      if (Number.isFinite(value)) series[index].points.push({ coordinate: z, value });
    });
  }
  return series.every(item => item.points.length > 1) ? series : null;
}
