// Geometry of the 2D top-down view: world <-> canvas mapping, picking, scale bar. Pure: no DOM.
// The view shows one coordinate plane with equal scaling on both axes; `span` metres fit each side of the shorter edge.
import { sourceCenter } from './em-playground-state.js';
import { planeBasis, sheetLineDirection } from './em-current-field.js';
import { cross3, norm3 } from './em-physics.js';

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

const SHEET_HANDLE = 0.8; // metres from a sheet's base point to its rotate handle

// Handles of a current source (type wire / segment / loop / sheet): a loop also has a radius handle at the end of its in-plane
// radius, a sheet a rotate handle along its line in the view.
function currentHandles(source, plane) {
  if (source.type === 'loop') {
    const { a, n } = planeBasis(plane), across = cross3(source.normal, n), length = norm3(across);
    const direction = length > 1e-9 ? across.map(value => value / length) : a;
    return [
      { handle: 'body', position: source.position },
      { handle: 'radius', position: source.position.map((value, i) => value + direction[i] * source.radius) },
    ];
  }
  if (source.type === 'sheet') {
    const line = sheetLineDirection(source, plane);
    return [
      { handle: 'body', position: source.position },
      ...(line ? [{ handle: 'rotate', position: source.position.map((value, i) => value + line[i] * SHEET_HANDLE) }] : []),
    ];
  }
  return null;
}

/** Grab points of a source: [{ handle, position }] with 3D positions. */
export function handlesOf(source, plane = 'xy') {
  if (source.type === 'loop' || source.type === 'sheet') return currentHandles(source, plane);
  if (source.type === 'finite-line' || source.type === 'segment') {
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

// Two handles at the same pixel (a line perpendicular to the view plane projects its body and its direction tip onto one
// point) are a tie: pressing there moves the source, so 'body' wins. Other ties keep the first handle.
const TIE_PIXELS = 0.5;

/**
 * Nearest handle of a visible source within `radius` pixels of (x, y), or null. Within one source a tie (distances within
 * half a pixel) prefers the body handle; between sources ties prefer the later source (drawn on top).
 */
export function hitSource(sources, view, plane, x, y, radius = 22) {
  const axes = AXES[plane];
  let best = null;
  for (const source of sources) {
    if (source.visible === false) continue;
    let mine = null;
    for (const { handle, position } of handlesOf(source, plane)) {
      const [px, py] = view.toCanvas(position[axes[0]], position[axes[1]]);
      const distance = Math.hypot(px - x, py - y);
      if (distance > radius) continue;
      const closer = !mine || distance < mine.distance - TIE_PIXELS;
      const tiedBody = mine && Math.abs(distance - mine.distance) <= TIE_PIXELS && handle === 'body';
      if (closer || tiedBody) mine = { source, handle, position, distance };
    }
    if (mine && (!best || mine.distance <= best.distance)) best = mine;
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

/**
 * Where a pointer lands on the Ampere loop (a circle or an axis-aligned rectangle in the view plane, centre in 3D):
 * 'edge' (circle ring), 'edge-x' / 'edge-y' / 'corner' (rectangle sides), 'inside', else null.
 */
export function hitAmpere(view, plane, ampere, x, y, edgePx = 11) {
  const axes = AXES[plane], [cx, cy] = view.toCanvas(ampere.center[axes[0]], ampere.center[axes[1]]), dx = x - cx, dy = y - cy;
  if (ampere.shape === 'rect') {
    const hw = ampere.halfWidth * view.scale, hh = ampere.halfHeight * view.scale;
    const nearX = Math.abs(Math.abs(dx) - hw) <= edgePx && Math.abs(dy) <= hh + edgePx;
    const nearY = Math.abs(Math.abs(dy) - hh) <= edgePx && Math.abs(dx) <= hw + edgePx;
    if (nearX && nearY) return 'corner';
    if (nearX) return 'edge-x';
    if (nearY) return 'edge-y';
    return Math.abs(dx) < hw && Math.abs(dy) < hh ? 'inside' : null;
  }
  const distance = Math.hypot(dx, dy), ring = ampere.radius * view.scale;
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
