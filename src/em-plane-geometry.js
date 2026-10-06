// Geometry of the 2D top-down view: world <-> canvas mapping, picking, scale bar. Pure: no DOM.
// The view shows one coordinate plane with equal scaling on both axes; `span` metres fit each side of the shorter edge.
import { sourceCenter } from './em-playground-state.js';

const AXES = { xy: [0, 1], xz: [0, 2], yz: [1, 2] };
const NORMALS = { xy: 2, xz: 1, yz: 0 };

export const planeAxes = plane => AXES[plane];
export const planeNormal = plane => NORMALS[plane];
export const SPAN_RANGE = Object.freeze([0.8, 12]);

/** World (a, b) metres in the plane <-> canvas (x, y) pixels. y grows downward on the canvas. */
export function createPlaneView({ width, height, span, offset = [0, 0] }) {
  const scale = Math.min(width, height) / (2 * span);
  const toCanvas = (a, b) => [width / 2 + (a - offset[0]) * scale, height / 2 - (b - offset[1]) * scale];
  const toWorld = (x, y) => [offset[0] + (x - width / 2) / scale, offset[1] + (height / 2 - y) / scale];
  const [aMin, bMax] = toWorld(0, 0), [aMax, bMin] = toWorld(width, height);
  return { width, height, span, offset, scale, toCanvas, toWorld, area: { aMin, aMax, bMin, bMax } };
}

/** 3D point on the plane (normal coordinate = fixed) for a canvas position. */
export function pointOnPlane(view, plane, fixed, x, y) {
  const [a, b] = view.toWorld(x, y), axes = AXES[plane], p = [0, 0, 0];
  p[axes[0]] = a; p[axes[1]] = b; p[NORMALS[plane]] = fixed;
  return p;
}

/** Grab points of a source: [{ handle, position }] with 3D positions. */
export function handlesOf(source) {
  if (source.type === 'finite-line') {
    return [
      { handle: 'start', position: source.start }, { handle: 'end', position: source.end },
      { handle: 'body', position: sourceCenter(source) },
    ];
  }
  if (source.type === 'infinite-line') {
    const tip = source.position.map((value, i) => value + source.direction[i] * source.displayLength / 2);
    return [{ handle: 'body', position: source.position }, { handle: 'direction', position: tip }];
  }
  return [{ handle: 'body', position: source.position }];
}

/** Nearest handle of a visible source within `radius` pixels of (x, y), or null. Ties prefer later sources (drawn on top). */
export function hitSource(sources, view, plane, x, y, radius = 22) {
  const axes = AXES[plane];
  let best = null;
  for (const source of sources) {
    if (source.visible === false) continue;
    for (const { handle, position } of handlesOf(source)) {
      const [px, py] = view.toCanvas(position[axes[0]], position[axes[1]]);
      const distance = Math.hypot(px - x, py - y);
      if (distance <= radius && (!best || distance <= best.distance)) best = { source, handle, position, distance };
    }
  }
  return best;
}

/**
 * Radius (m) of a sphere's cross-section with the view plane, or 0 when the plane misses the sphere.
 * center3 is the sphere centre (3D); fixed is the plane's normal coordinate.
 */
export function sectionRadius(center3, radius, plane, fixed) {
  const offset = center3[NORMALS[plane]] - fixed;
  return Math.sqrt(Math.max(0, radius * radius - offset * offset));
}

/** Where a pointer lands on the Gauss circle: 'edge' near the ring, 'inside' within it, else null. */
export function hitGauss(view, plane, gauss, fixed, x, y, edgePx = 11) {
  const radius = sectionRadius(gauss.center, gauss.radius, plane, fixed);
  if (radius <= 0) return null;
  const axes = AXES[plane], [cx, cy] = view.toCanvas(gauss.center[axes[0]], gauss.center[axes[1]]);
  const distance = Math.hypot(x - cx, y - cy), ring = radius * view.scale;
  if (Math.abs(distance - ring) <= edgePx) return 'edge';
  return distance < ring ? 'inside' : null;
}

/** A round-number scale bar of about `targetPx` pixels: { meters, pixels, label }. */
export function scaleBar(view, targetPx = 96) {
  const raw = targetPx / view.scale, power = 10 ** Math.floor(Math.log10(raw));
  const meters = [1, 2, 5, 10].map(m => m * power).find(m => m >= raw * 0.7) ?? power * 10;
  const label = meters >= 1 ? `${meters} m` : meters >= 0.01 ? `${meters * 100} cm` : `${meters * 1000} mm`;
  return { meters, pixels: meters * view.scale, label };
}

/** Zoom keeping the world point under (x, y) fixed. Returns the new { span, offset }. */
export function zoomAbout(view, x, y, factor) {
  const span = Math.min(SPAN_RANGE[1], Math.max(SPAN_RANGE[0], view.span * factor));
  const [a, b] = view.toWorld(x, y), ratio = span / view.span;
  return { span, offset: [a - (a - view.offset[0]) * ratio, b - (b - view.offset[1]) * ratio] };
}
