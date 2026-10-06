// Divergence / curl / flux / circulation probe: evaluates the sandbox field (or a mathematical test field) at the
// sensor and formats three readout lines. Pure: no DOM. Reuses em-playground-calculus.js for the numerics.
import { norm3 } from './em-physics.js';
import { createPointChargeEvaluator } from './em-playground-physics.js';
import { differential3D, loopCirculation, mathField, sphereFlux } from './em-playground-calculus.js';
import { noiseAwareText, noiseAwareVectorText, siText, siVector } from './em-format.js';
import { planeAxes, planeNormal } from './em-plane-geometry.js';

export const CALCULUS_DEFAULTS = Object.freeze({
  mode: 'electric', differentialMode: 'analytic', alpha: 1, h: 0.005, radius: 1, normal: [0, 0, 1],
});

function validate({ h, radius, normal }, probe) {
  if (!(h >= 0.0002 && h <= 0.1)) return '미분 h는 0.0002…0.1 m여야 합니다.';
  if (!(radius >= 0.05 && radius <= 5)) return '구/루프 반지름은 0.05…5 m여야 합니다.';
  if (!norm3(normal)) return '루프 법선은 0일 수 없습니다.';
  if (probe.some(value => Math.abs(value) + Math.max(h, radius) > 20)) return '검사 기하가 좌표 ±20 m 범위를 벗어납니다.';
  return null;
}

/**
 * Evaluate at `probe` for the sources. settings: { mode, differentialMode, alpha, h, radius, normal }.
 * Returns { ok: true, display } or { ok: false, error }.
 */
export function evaluateCalculus({ sources, probe, plane, settings }) {
  const error = validate(settings, probe);
  if (error) return { ok: false, error };
  const { mode, differentialMode, alpha, h, radius, normal } = settings;
  const electric = mode === 'electric', field = electric ? createPointChargeEvaluator(sources) : mathField(mode, alpha);
  const stencilSources = electric ? sources : [], analytic = electric && differentialMode === 'analytic';
  const numeric = differential3D(field, probe, h, stencilSources);
  const half = analytic ? null : differential3D(field, probe, h / 2, stencilSources);
  const differential = analytic && numeric.status === 'valid' ? { ...numeric, divergence: 0, curl: [0, 0, 0], analytic: true } : numeric;
  const flux = sphereFlux(field, probe, radius, stencilSources), loop = loopCirculation(field, probe, radius, normal, stencilSources);
  const [a, b] = planeAxes(plane), n = planeNormal(plane), grid = [];
  for (let row = 0; row < 5; row++) {
    for (let column = 0; column < 5; column++) {
      const point = [...probe];
      point[a] = probe[a] - 1.6 + 0.8 * column;
      point[b] = probe[b] + 1.6 - 0.8 * row;
      point[n] = probe[n];
      const value = differential3D(field, point, h, stencilSources);
      if (value.status === 'valid') grid.push({ point, divergence: analytic ? 0 : value.divergence, curl: analytic ? [0, 0, 0] : value.curl });
    }
  }
  return {
    ok: true,
    display: { mode, differentialMode, alpha, h, radius, normal: [...normal], plane, probe: [...probe], differential, half, flux, loop, grid, field },
  };
}

const sci = (value, unit) => siText(value, unit, 4);

/**
 * Three readout lines for a display from evaluateCalculus().
 * Returns { lines: [divCurl, flux, circulation], titles: string[] } (titles hold the raw values behind "≈ 0" text).
 */
export function calculusLines(display) {
  const electric = display.mode === 'electric';
  const units = electric ? { d: 'V/m²', phi: 'V·m', circ: 'V' } : { d: 'arb./m', phi: 'arb.·m²', circ: 'arb.·m' };
  const titles = [];
  const noisy = (result, label) => { if (result.noise) titles.push(`${label}: ${result.title}`); return result.text; };
  const { differential: d, half, flux, loop } = display;
  let first;
  if (d.status !== 'valid') first = `미분 제외: ${d.reason}`;
  else if (d.analytic) first = '∇·E = 0 · ∇×E = 0  (source 밖 해석값)';
  else {
    const div = noisy(noiseAwareText(d.divergence, d.noiseScale, v => sci(v, units.d)), '∇·F');
    const curl = noisy(noiseAwareVectorText(d.curl, d.noiseScale, v => (v ? siVector(v, units.d) : '미정')), '∇×F');
    const refine = half?.status === 'valid' ? ` · h/2와 Δ ${sci(Math.abs(d.divergence - half.divergence), units.d)}` : '';
    first = `∇·F = ${div} · ∇×F = ${curl}${refine}`;
  }
  const convergence = result => (result.converged ? '수렴' : '미수렴');
  const second = flux.status === 'valid'
    ? `Φ(R) = ${noisy(noiseAwareText(flux.flux, flux.noiseScale, v => sci(v, units.phi)), 'Φ')} · ${convergence(flux)} (${flux.samples})`
    : `Φ(R): ${flux.reason}`;
  const third = loop.status === 'valid'
    ? `∮F·dl = ${noisy(noiseAwareText(loop.circulation, loop.noiseScale, v => sci(v, units.circ)), '∮F·dl')}`
      + ` · ${convergence(loop)} (${loop.samples})`
    : `∮F·dl: ${loop.reason}`;
  return { lines: [first, second, third], titles };
}
