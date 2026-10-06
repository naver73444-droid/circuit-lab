// Contour lines (equipotentials) of a scalar grid by marching squares. Pure: no DOM.
//
// A grid is row-major: values[row * cols + col]. Coordinates returned are in grid units
// (x = column, y = row, fractional), so the caller maps them to pixels with one scale.
// Cells with a missing corner (NaN, for example inside a model exclusion zone) are skipped.

// Edge ids of a cell: 0 top (tl-tr), 1 right (tr-br), 2 bottom (bl-br), 3 left (tl-bl).
// Segments are listed per marching-squares case; bit order tl=8, tr=4, br=2, bl=1.
const CASES = [
  [], [[3, 2]], [[2, 1]], [[3, 1]], [[0, 1]], null, [[0, 2]], [[0, 3]],
  [[0, 3]], [[0, 2]], null, [[0, 1]], [[3, 1]], [[2, 1]], [[3, 2]], [],
];
// Saddle cells (tr+bl high, or tl+br high) are split by the asymptotic decider: the value of the bilinear surface at its
// saddle point says whether the two high corners are joined (saddle >= level) or kept apart. The plain average of the four
// corners can pick the wrong pairing (corners [10, -4, -4, 1]: average 0.75 joins what the bilinear surface separates).
// An exact tie makes the level set two straight lines crossing at the saddle (top-bottom and left-right).
const SADDLE_5 = { high: [[0, 3], [2, 1]], low: [[0, 1], [3, 2]] };
const SADDLE_10 = { high: [[0, 1], [3, 2]], low: [[0, 3], [2, 1]] };
const SADDLE_CROSS = [[0, 2], [3, 1]];

/** 'high', 'low' or 'cross': how the bilinear surface through (tl, tr, bl, br) pairs up the corners of a saddle cell. */
export function saddleDecision(tl, tr, bl, br, level) {
  const denominator = tl + br - tr - bl;
  const saddle = denominator === 0 ? (tl + tr + bl + br) / 4 : (tl * br - tr * bl) / denominator;
  const tolerance = 1e-12 * Math.max(1, Math.abs(level), Math.abs(tl), Math.abs(tr), Math.abs(bl), Math.abs(br));
  if (Math.abs(saddle - level) <= tolerance) return 'cross';
  return saddle > level ? 'high' : 'low';
}

function edgePoint(edge, level, col, row, tl, tr, br, bl) {
  const lerp = (a, b) => (b === a ? 0.5 : (level - a) / (b - a));
  if (edge === 0) return [col + lerp(tl, tr), row];
  if (edge === 1) return [col + 1, row + lerp(tr, br)];
  if (edge === 2) return [col + lerp(bl, br), row + 1];
  return [col, row + lerp(tl, bl)];
}

/**
 * Line segments of the level set `level`. Returns a flat array [x1, y1, x2, y2, ...] in grid units.
 */
export function contourSegments(values, cols, rows, level) {
  const out = [];
  for (let row = 0; row < rows - 1; row += 1) {
    for (let col = 0; col < cols - 1; col += 1) {
      const i = row * cols + col;
      const tl = values[i], tr = values[i + 1], bl = values[i + cols], br = values[i + cols + 1];
      if (!(Number.isFinite(tl) && Number.isFinite(tr) && Number.isFinite(bl) && Number.isFinite(br))) continue;
      const index = (tl >= level ? 8 : 0) | (tr >= level ? 4 : 0) | (br >= level ? 2 : 0) | (bl >= level ? 1 : 0);
      let segments = CASES[index];
      if (segments === null) {
        const decision = saddleDecision(tl, tr, bl, br, level), saddle = index === 5 ? SADDLE_5 : SADDLE_10;
        segments = decision === 'cross' ? SADDLE_CROSS : saddle[decision];
      }
      for (const [a, b] of segments) {
        out.push(...edgePoint(a, level, col, row, tl, tr, br, bl), ...edgePoint(b, level, col, row, tl, tr, br, bl));
      }
    }
  }
  return out;
}

/** Contour segments for several levels: [{ level, segments }]. Empty levels are dropped. */
export function contourSet(values, cols, rows, levels) {
  const set = [];
  for (const level of levels) {
    const segments = contourSegments(values, cols, rows, level);
    if (segments.length) set.push({ level, segments });
  }
  return set;
}

/**
 * Signed compression used for both the colour map and the contour spacing.
 * A point charge's potential spans many decades, so the scale is asinh(v / reference):
 * linear near zero, logarithmic far out. Equal steps in this space give evenly spread contours.
 */
export const compress = (value, reference) => Math.asinh(value / reference);

/** Median of |value| over finite samples (strided so a large grid stays cheap); 0 when none are finite. */
export function typicalMagnitude(values, stride = 5) {
  const sample = [];
  for (let i = 0; i < values.length; i += stride) if (Number.isFinite(values[i])) sample.push(Math.abs(values[i]));
  if (!sample.length) return 0;
  sample.sort((a, b) => a - b);
  return sample[sample.length >> 1];
}

/**
 * Contour levels evenly spaced in compressed space, symmetric about zero (0 is included).
 * reference: the magnitude where compression turns logarithmic; clip: the largest |v| / reference drawn.
 */
export function compressedLevels(reference, { steps = 6, clip = 40 } = {}) {
  if (!(reference > 0) || !Number.isFinite(reference)) return [];
  const top = Math.asinh(clip), levels = [0];
  for (let k = 1; k <= steps; k += 1) {
    const level = reference * Math.sinh((k / steps) * top);
    levels.push(level, -level);
  }
  return levels.sort((a, b) => a - b);
}
