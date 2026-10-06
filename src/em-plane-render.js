// Draws the 2D plane view onto two stacked canvases. The expensive part (potential colours, equipotentials, field lines, field
// arrows) is a "base layer" painted onto the lower canvas (#em-plane-base) and repainted only when its inputs change; sources,
// Gauss circle, sensor and scale bar are drawn on the upper canvas every frame, so dragging the sensor or the Gauss surface
// costs almost nothing. The sampled scalar grid, the traced lines and the arrow samples are cached apart from the painting:
// they depend on the field, the view and the quality only, so toggling a chip or the theme repaints without evaluating the
// field again. All colours come from the palette (CSS tokens).
import { compress, compressedLevels, contourSet, typicalMagnitude } from './em-contour.js';
import { computePlaneLines, sampleScalarGrid, sampleVectorGrid } from './em-plane-field.js';
import { planeAxes, planeNormal, scaleBar, sectionRadius } from './em-plane-geometry.js';
import { cssRgb, cssRgba, mixRgb } from './em-palette.js';
import { sourceCenter } from './em-playground-state.js';
import { strengthText } from './em-source-edit.js';

const FONT = 'system-ui, "Malgun Gothic", sans-serif';
const CLIP = 25; // |v| / reference at which the colour map saturates
const ARROW_SPACING = 46;

function arrow(ctx, x1, y1, x2, y2, head) {
  const dx = x2 - x1, dy = y2 - y1, length = Math.hypot(dx, dy);
  if (length < 1) return;
  const ux = dx / length, uy = dy / length;
  ctx.beginPath();
  ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
  ctx.moveTo(x2, y2); ctx.lineTo(x2 - head * (ux + 0.5 * uy), y2 - head * (uy - 0.5 * ux));
  ctx.moveTo(x2, y2); ctx.lineTo(x2 - head * (ux - 0.5 * uy), y2 - head * (uy + 0.5 * ux));
  ctx.stroke();
}

function sizeCanvas(canvas, ctx, width, height, dpr) {
  const pixelWidth = Math.max(2, Math.round(width * dpr)), pixelHeight = Math.max(2, Math.round(height * dpr));
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) { canvas.width = pixelWidth; canvas.height = pixelHeight; }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// ---- base layer -------------------------------------------------------------------------------------------------

function paintPotential(ctx, tile, grid, ref, signed, colors, width, height) {
  const { cols, rows, values } = grid, image = new ImageData(cols, rows);
  const top = Math.asinh(CLIP);
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    const t = Math.max(-1, Math.min(1, compress(v, ref) / top));
    const rgb = signed
      ? mixRgb(colors.bg, t >= 0 ? colors.pos : colors.neg, 0.78 * Math.abs(t))
      : mixRgb(colors.bg, colors.accent, 0.78 * Math.max(0, t));
    image.data.set([rgb[0], rgb[1], rgb[2], 255], i * 4);
  }
  tile.width = cols; tile.height = rows;
  tile.getContext('2d').putImageData(image, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(tile, 0, 0, width, height);
}

function strokeContours(ctx, grid, levels, width, height, palette) {
  const sx = width / grid.cols, sy = height / grid.rows;
  for (const { level, segments } of contourSet(grid.values, grid.cols, grid.rows, levels)) {
    ctx.beginPath();
    for (let i = 0; i < segments.length; i += 4) {
      ctx.moveTo((segments[i] + 0.5) * sx, (segments[i + 1] + 0.5) * sy);
      ctx.lineTo((segments[i + 2] + 0.5) * sx, (segments[i + 3] + 0.5) * sy);
    }
    const zero = level === 0;
    ctx.strokeStyle = cssRgba(zero ? palette.text.rgb : palette.muted.rgb, zero ? 0.75 : 0.5);
    ctx.lineWidth = zero ? 1.6 : 1;
    ctx.stroke();
  }
}

const pathLength = pts => pts.reduce((sum, p, i) => (i ? sum + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);

function strokeFieldLines(ctx, lines, view, plane, palette) {
  const [a, b] = planeAxes(plane);
  ctx.strokeStyle = cssRgba(palette.text.rgb, 0.78);
  ctx.fillStyle = ctx.strokeStyle;
  ctx.lineWidth = 1.3;
  for (const line of lines) {
    const pts = line.points.map(p => view.toCanvas(p[a], p[b]));
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
    // One arrowhead near the middle, pointing along the field (lines of negative sources are stored source-first).
    if (pts.length < 4 || pathLength(pts) < 60) continue;
    const i = Math.max(1, Math.floor(pts.length * 0.45)), from = line.sign < 0 ? pts[i] : pts[i - 1], to = line.sign < 0 ? pts[i - 1] : pts[i];
    const dx = to[0] - from[0], dy = to[1] - from[1], n = Math.hypot(dx, dy);
    if (n < 1e-6) continue;
    const ux = dx / n, uy = dy / n, x = to[0], y = to[1];
    ctx.beginPath();
    ctx.moveTo(x + ux * 4, y + uy * 4);
    ctx.lineTo(x - ux * 4 - uy * 3.2, y - uy * 4 + ux * 3.2);
    ctx.lineTo(x - ux * 4 + uy * 3.2, y - uy * 4 - ux * 3.2);
    ctx.closePath();
    ctx.fill();
  }
}

function strokeFieldArrows(ctx, { samples, typical }, scene, palette) {
  if (!(typical > 0)) return;
  const top = Math.asinh(CLIP), alphaScale = scene.chips.lines ? 0.55 : 0.85;
  ctx.lineWidth = 1.2;
  for (const s of samples) {
    if (!(s.magnitude > 0)) continue;
    const strength = Math.min(1, Math.abs(compress(s.magnitude, typical)) / top + 0.15);
    const [x, y] = scene.view.toCanvas(s.a, s.b), ux = s.va / s.magnitude, uy = -s.vb / s.magnitude, half = 8;
    ctx.strokeStyle = cssRgba(palette.text.rgb, alphaScale * (0.25 + 0.65 * strength));
    arrow(ctx, x - ux * half, y - uy * half, x + ux * half, y + uy * half, 4);
  }
}

// ---- overlay ----------------------------------------------------------------------------------------------------

function sourceColor(source, palette) {
  const strength = source.type === 'point' ? source.q : source.lambda;
  return strength >= 0 ? palette.pos : palette.neg;
}

function drawSource(ctx, source, scene, palette, selected) {
  const [a, b] = planeAxes(scene.plane), { view } = scene;
  const color = sourceColor(source, palette).css, plus = (source.type === 'point' ? source.q : source.lambda) >= 0;
  const at = p => view.toCanvas(p[a], p[b]);
  ctx.globalAlpha = source.enabled === false ? 0.4 : 1;
  ctx.strokeStyle = color; ctx.fillStyle = color;
  if (source.type === 'finite-line') {
    const [x1, y1] = at(source.start), [x2, y2] = at(source.end);
    ctx.lineWidth = 5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.lineCap = 'butt';
    for (const [x, y] of [[x1, y1], [x2, y2]]) { ctx.beginPath(); ctx.arc(x, y, 7, 0, 2 * Math.PI); ctx.fill(); }
  } else if (source.type === 'infinite-line') {
    const [x, y] = at(source.position);
    const far = Math.max(view.width, view.height) * 2;
    let dx = source.direction[a], dy = -source.direction[b];
    const n = Math.hypot(dx, dy) || 1;
    dx /= n; dy /= n;
    ctx.lineWidth = 3; ctx.setLineDash([8, 6]);
    ctx.beginPath(); ctx.moveTo(x - dx * far, y - dy * far); ctx.lineTo(x + dx * far, y + dy * far); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(x, y, 8, 0, 2 * Math.PI); ctx.fill();
    const [tx, ty] = at(source.position.map((value, i) => value + source.direction[i] * source.displayLength / 2));
    ctx.save(); ctx.translate(tx, ty); ctx.rotate(Math.PI / 4);
    ctx.fillRect(-5, -5, 10, 10); ctx.restore();
  } else {
    const [x, y] = at(source.position), off = Math.abs(source.position[scene.normal] - scene.fixed) > 1e-9;
    ctx.globalAlpha *= off ? 0.55 : 1;
    ctx.beginPath(); ctx.arc(x, y, 13, 0, 2 * Math.PI); ctx.fill();
  }
  ctx.globalAlpha = 1;
  const [cx, cy] = at(sourceCenter(source));
  if (source.type === 'point') {
    const [x, y] = at(source.position);
    ctx.strokeStyle = cssRgb(palette.bg.rgb); ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(x - 6, y); ctx.lineTo(x + 6, y);
    if (plus) { ctx.moveTo(x, y - 6); ctx.lineTo(x, y + 6); }
    ctx.stroke();
  }
  if (selected) {
    ctx.strokeStyle = palette.accent.css; ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.arc(cx, cy, source.type === 'point' ? 19 : 14, 0, 2 * Math.PI); ctx.stroke();
    label(ctx, `${source.id}  ${strengthText(source)}`, cx + 22, cy - 20, palette, 'left');
  }
}

function label(ctx, text, x, y, palette, align = 'left') {
  ctx.font = `600 12px ${FONT}`; ctx.textAlign = align; ctx.textBaseline = 'middle';
  ctx.lineWidth = 3.5; ctx.strokeStyle = cssRgba(palette.bg.rgb, 0.9);
  ctx.strokeText(text, x, y);
  ctx.fillStyle = palette.text.css; ctx.fillText(text, x, y);
}

function drawGauss(ctx, scene, palette) {
  const { gauss, view, plane } = scene, [a, b] = planeAxes(plane);
  const radius = sectionRadius(gauss.center, gauss.radius, plane, scene.fixed);
  if (radius <= 0) return;
  const [cx, cy] = view.toCanvas(gauss.center[a], gauss.center[b]), pixels = radius * view.scale;
  ctx.fillStyle = cssRgba(palette.gauss.rgb, 0.08);
  ctx.strokeStyle = palette.gauss.css; ctx.lineWidth = 2; ctx.setLineDash([9, 6]);
  ctx.beginPath(); ctx.arc(cx, cy, pixels, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
  ctx.setLineDash([]);
  for (const id of scene.gaussEnclosed ?? []) {
    const source = scene.sources.find(item => item.id === id);
    if (!source) continue;
    const [x, y] = view.toCanvas(...[sourceCenter(source)[a], sourceCenter(source)[b]]);
    ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, source.type === 'point' ? 23 : 17, 0, 2 * Math.PI); ctx.stroke();
  }
  const hx = cx + pixels * Math.SQRT1_2, hy = cy - pixels * Math.SQRT1_2;
  ctx.fillStyle = palette.gauss.css;
  ctx.beginPath(); ctx.arc(hx, hy, 6, 0, 2 * Math.PI); ctx.fill();
  if (gauss.label) label(ctx, gauss.label, cx, cy + pixels + 14, palette, 'center');
}

function drawSensor(ctx, scene, palette) {
  const { sensor, view, plane } = scene, [a, b] = planeAxes(plane);
  const [x, y] = view.toCanvas(sensor.point[a], sensor.point[b]);
  ctx.strokeStyle = palette.sensor.css; ctx.fillStyle = palette.sensor.css; ctx.lineWidth = 2;
  if (sensor.vector) {
    const n = Math.hypot(sensor.vector[0], sensor.vector[1]);
    if (n > 0) { ctx.lineWidth = 2.6; arrow(ctx, x, y, x + sensor.vector[0] / n * 42, y - sensor.vector[1] / n * 42, 9); }
  }
  ctx.lineWidth = 2;
  ctx.fillStyle = cssRgba(palette.bg.rgb, 0.55);
  ctx.beginPath(); ctx.arc(x, y, 8, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x - 13, y); ctx.lineTo(x + 13, y); ctx.moveTo(x, y - 13); ctx.lineTo(x, y + 13); ctx.stroke();
  if (!sensor.text) return;
  ctx.font = `600 12px ${FONT}`;
  const width = ctx.measureText(sensor.text).width + 14, height = 22;
  let bx = x + 16, by = y + 14;
  if (bx + width > view.width - 4) bx = x - 16 - width;
  if (by + height > view.height - 4) by = y - 14 - height;
  ctx.fillStyle = cssRgba(palette.bg.rgb, 0.88);
  ctx.strokeStyle = palette.sensor.css; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect(bx, by, width, height, 6); ctx.fill(); ctx.stroke();
  ctx.fillStyle = palette.text.css; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(sensor.text, bx + 7, by + height / 2 + 0.5);
}

function drawScaleBar(ctx, view, palette, wavelengths) {
  const bar = scaleBar(view), x = 14, y = view.height - 16;
  if (wavelengths) bar.label = `${bar.meters} λ`;
  ctx.strokeStyle = palette.muted.css; ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y - 4); ctx.lineTo(x, y); ctx.lineTo(x + bar.pixels, y); ctx.lineTo(x + bar.pixels, y - 4);
  ctx.stroke();
  ctx.font = `12px ${FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
  ctx.fillStyle = palette.muted.css;
  ctx.fillText(bar.label, x + bar.pixels + 8, y + 2);
}

// ---- renderer ---------------------------------------------------------------------------------------------------

export function createPlaneRenderer(baseCanvas, canvas, getPalette) {
  const ctx = canvas.getContext('2d'), baseCtx = baseCanvas.getContext('2d'), tile = document.createElement('canvas');
  let baseKey = null, gridCache = null, linesCache = null, arrowCache = null;
  // gridBuilds counts how often the field was sampled for the colour map; a chip or theme change must not raise it.
  const stats = { baseMs: 0, baseCached: false, gridCached: false, gridBuilds: 0, overlayMs: 0, cols: 0, rows: 0, lines: 0, stages: {} };

  function sampleGrid(scene, draft, key) {
    if (gridCache?.key === key) return gridCache;
    const { view } = scene, cell = draft ? 16 : 7;
    const cols = Math.max(8, Math.min(260, Math.ceil(view.width / cell))), rows = Math.max(8, Math.min(200, Math.ceil(view.height / cell)));
    const { aMin, aMax, bMin, bMax } = view.area, da = (aMax - aMin) / (2 * cols), db = (bMax - bMin) / (2 * rows);
    const grid = sampleScalarGrid(
      scene.field, scene.plane, scene.fixed, { aMin: aMin + da, aMax: aMax - da, bMin: bMin + db, bMax: bMax - db }, cols, rows);
    stats.gridBuilds += 1;
    gridCache = { key, grid, ref: typicalMagnitude(grid.values), arrows: null };
    return gridCache;
  }

  // The base layer is painted straight onto the lower canvas and left alone until its inputs change.
  function drawBase(scene, palette, dpr, gridKey) {
    const { view } = scene, started = performance.now(), stages = {};
    let mark = started;
    const lap = name => { const now = performance.now(); stages[name] = now - mark; mark = now; };
    sizeCanvas(baseCanvas, baseCtx, view.width, view.height, dpr);
    baseCtx.fillStyle = palette.bg.css;
    baseCtx.fillRect(0, 0, view.width, view.height);
    const draft = scene.quality === 'draft';
    stats.gridCached = gridCache?.key === gridKey;
    const { grid, ref } = sampleGrid(scene, draft, gridKey);
    lap('sample');
    const signed = scene.field.scalarName === 'V';
    if (ref > 0) {
      const colors = { bg: palette.bg.rgb, pos: palette.pos.rgb, neg: palette.neg.rgb, accent: palette.accent.rgb };
      paintPotential(baseCtx, tile, grid, ref, signed, colors, view.width, view.height);
      lap('paint');
      if (scene.chips.contours) {
        const levels = signed ? compressedLevels(ref, { steps: 6, clip: CLIP })
          : [1, 2, 3, 4, 5, 6].map(k => ref * Math.sinh(k / 6 * Math.asinh(CLIP)));
        strokeContours(baseCtx, grid, levels, view.width, view.height, palette);
        lap('contours');
      }
    }
    let lines = [];
    if (scene.chips.lines) {
      if (linesCache?.key !== gridKey) {
        linesCache = { key: gridKey, lines: computePlaneLines(scene.field, {
          plane: scene.plane, fixed: scene.fixed, area: view.area, sources: scene.sources, model: scene.model, quality: scene.quality,
        }) };
      }
      lines = linesCache.lines;
      lap('traceLines');
      strokeFieldLines(baseCtx, lines, view, scene.plane, palette);
      lap('strokeLines');
    }
    if (!gridCache.arrows) {
      const spacing = draft ? 62 : ARROW_SPACING;
      const cols = Math.max(4, Math.floor(view.width / spacing)), rows = Math.max(3, Math.floor(view.height / spacing));
      const samples = sampleVectorGrid(scene.field, scene.plane, scene.fixed, view.area, cols, rows);
      gridCache.arrows = { samples, typical: typicalMagnitude(samples.map(item => item.magnitude), 1) };
    }
    strokeFieldArrows(baseCtx, gridCache.arrows, scene, palette);
    lap('arrows');
    Object.assign(stats, { baseMs: performance.now() - started, cols: grid.cols, rows: grid.rows, lines: lines.length, stages });
  }

  return {
    stats,
    invalidate() { baseKey = null; },
    render(scene) {
      const { view } = scene;
      if (!(view.width > 1 && view.height > 1)) return stats;
      const palette = getPalette(), dpr = Math.min(2, window.devicePixelRatio || 1);
      // What the sampled field depends on. Chips and colours are deliberately absent: they only change how it is painted.
      const gridKey = JSON.stringify([scene.fieldKey, view.width, view.height, view.span, view.offset, scene.plane, scene.fixed, scene.quality]);
      const key = JSON.stringify([
        gridKey, scene.chips.lines, scene.chips.contours, palette.bg.css, palette.pos.css, palette.neg.css, palette.accent.css, palette.text.css, dpr,
      ]);
      stats.baseCached = key === baseKey;
      if (!stats.baseCached) { drawBase(scene, palette, dpr, gridKey); baseKey = key; }
      const started = performance.now();
      sizeCanvas(canvas, ctx, view.width, view.height, dpr);
      ctx.clearRect(0, 0, view.width, view.height);
      const overlay = { ...scene, normal: planeNormal(scene.plane) };
      for (const source of scene.sources) {
        if (source.visible !== false) drawSource(ctx, source, overlay, palette, source.id === scene.selectedId);
      }
      if (scene.gauss) drawGauss(ctx, overlay, palette);
      if (scene.sensor) drawSensor(ctx, overlay, palette);
      drawScaleBar(ctx, view, palette, scene.field.kind === 'wave');
      stats.overlayMs = performance.now() - started;
      return stats;
    },
  };
}
