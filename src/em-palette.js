// Canvas colours come from the page's CSS variables (theme tokens), read once and again only when the theme changes.
// Canvases cannot use var(); drawing code asks this module for resolved colours instead of hard-coding any.

// token name in the palette -> CSS custom property
const TOKENS = {
  bg: '--canvas', text: '--text', muted: '--muted', grid: '--grid', line: '--line', accent: '--accent',
  sensor: '--warning', gauss: '--success', danger: '--danger',
  pos: '--em-pos', neg: '--em-neg',
};

/** "#rgb", "#rrggbb", "rgb(r g b)" or "rgba(r, g, b, a)" -> [r, g, b, a] (0-255, alpha 0-1). */
export function parseColor(text) {
  const value = String(text).trim();
  let match = value.match(/^#([0-9a-f]{3})$/i);
  if (match) return [...match[1]].map(c => parseInt(c + c, 16)).concat(1);
  match = value.match(/^#([0-9a-f]{6})$/i);
  if (match) return [0, 2, 4].map(i => parseInt(match[1].slice(i, i + 2), 16)).concat(1);
  match = value.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i);
  if (match) {
    const alpha = match[4] === undefined ? 1 : match[4].endsWith('%') ? parseFloat(match[4]) / 100 : Number(match[4]);
    return [Number(match[1]), Number(match[2]), Number(match[3]), alpha];
  }
  return [128, 128, 128, 1];
}

export const mixRgb = (a, b, t) => [0, 1, 2].map(i => Math.round(a[i] + (b[i] - a[i]) * t));
export const cssRgba = ([r, g, b], alpha = 1) => `rgba(${r}, ${g}, ${b}, ${alpha})`;
export const cssRgb = ([r, g, b]) => `rgb(${r}, ${g}, ${b})`;

/** Resolve every token against `element`. Returns { name: { css, rgb } }. */
export function readPalette(element) {
  const style = getComputedStyle(element), palette = {};
  for (const [name, property] of Object.entries(TOKENS)) {
    const css = style.getPropertyValue(property).trim() || '#808080';
    palette[name] = { css, rgb: parseColor(css).slice(0, 3) };
  }
  return palette;
}

/**
 * A palette that follows the theme: current() returns the cached colours, re-read when <html data-theme> changes
 * or the system colour scheme flips. onChange() runs after a re-read so the owner can redraw.
 */
export function createPalette(element, onChange = () => {}) {
  let cached = null;
  const invalidate = () => { cached = null; onChange(); };
  const observer = new MutationObserver(invalidate);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  const media = matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener('change', invalidate);
  return {
    current() { cached ??= readPalette(element); return cached; },
    invalidate() { cached = null; },
    destroy() { observer.disconnect(); media.removeEventListener('change', invalidate); },
  };
}

/**
 * prefers-reduced-motion for the playback of the plane wave and the time experiments. Nothing in the EM workspace starts
 * playing on its own (only the 재생 button does, and that is always allowed); when the preference turns on while something plays,
 * onReduce() stops it. `matches` is the current preference.
 */
export function watchReducedMotion(signal, onReduce = () => {}) {
  const media = matchMedia('(prefers-reduced-motion: reduce)');
  const changed = () => { if (media.matches) onReduce(); };
  media.addEventListener('change', changed, { signal });
  return { get matches() { return media.matches; } };
}
