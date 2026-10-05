export const CURSOR_TAP_THRESHOLD_PX = 6;
export const CURSOR_BADGE_GAP = 22;

export function axisSide(quantity) {
  return ["A", "dBA"].includes(quantity) ? "right" : "left";
}

export function isTapGesture(maxDistance, threshold = CURSOR_TAP_THRESHOLD_PX) {
  return Number.isFinite(maxDistance) && maxDistance <= threshold;
}

export function advanceCursorPointerSession(session, clientPoint, point) {
  if (!session || !clientPoint || !Number.isFinite(clientPoint.x) || !Number.isFinite(clientPoint.y)) return session;
  const distance = Math.hypot(clientPoint.x - session.clientPoint.x, clientPoint.y - session.clientPoint.y);
  return {
    ...session,
    lastClientPoint: clientPoint,
    lastPoint: point ?? session.lastPoint,
    maxDistance: Math.max(session.maxDistance, distance),
  };
}

export function cursorIndexAfterKey(current, key, length) {
  if (!Number.isInteger(length) || length < 1) return null;
  if (key === "Home") return 0;
  if (key === "End") return length - 1;
  if (!["ArrowLeft", "ArrowRight"].includes(key)) return current;
  if (!Number.isInteger(current)) return 0;
  return Math.max(0, Math.min(length - 1, current + (key === "ArrowRight" ? 1 : -1)));
}

function axisFrom(axes, quantity) {
  return axes instanceof Map ? axes.get(quantity) : axes?.[quantity];
}

function placeGroup(entries, top, bottom, gap, selectedKey = null) {
  const capacity = Math.max(1, Math.floor((bottom - top) / gap) + 1);
  let visible = entries.slice(0, capacity);
  const selected = entries.find((entry) => entry.key === selectedKey);
  if (selected && !visible.includes(selected)) visible = [...visible.slice(0, Math.max(0, capacity - 1)), selected]
    .sort((left, right) => left.anchorY - right.anchorY || String(left.key).localeCompare(String(right.key)));
  const visibleKeys = new Set(visible.map((entry) => entry.key));
  const placed = [];
  for (const entry of visible) {
    const previous = placed.at(-1);
    placed.push({ ...entry, badgeY: Math.max(top, entry.anchorY, previous ? previous.badgeY + gap : top) });
  }
  if (placed.length && placed.at(-1).badgeY > bottom) {
    const shift = placed.at(-1).badgeY - bottom;
    for (const entry of placed) entry.badgeY -= shift;
  }
  if (placed.length && placed[0].badgeY < top) {
    const shift = top - placed[0].badgeY;
    for (const entry of placed) entry.badgeY += shift;
  }
  return { placed, hiddenKeys: entries.filter((entry) => !visibleKeys.has(entry.key)).map((entry) => entry.key) };
}

/** Pure raw-sample-to-axis-label layout. It never samples rendered paths. */
export function layoutCursorLabels({ series, index, axes, xAxis, xValue, geometry, logarithmic = false, selectedKeys = [] }) {
  const selected = new Set(selectedKeys);
  const transformedX = logarithmic ? Math.log10(xValue) : xValue;
  const xInside = Number.isFinite(transformedX) && transformedX >= xAxis.minimum && transformedX <= xAxis.maximum;
  const stable = [...series].sort((left, right) => String(left.key).localeCompare(String(right.key)));
  const entries = stable.map((item, ordinal) => {
    const value = item.values[index];
    const axis = axisFrom(axes, item.quantity);
    const valid = value !== null && Number.isFinite(value) && axis && axis.maximum > axis.minimum;
    const yInside = Boolean(valid && value >= axis.minimum && value <= axis.maximum);
    const anchorY = valid
      ? geometry.top + (1 - (value - axis.minimum) / (axis.maximum - axis.minimum)) * geometry.plotHeight
      : null;
    return {
      key: item.key,
      label: item.label,
      quantity: item.quantity,
      color: item.color,
      value,
      ordinal: ordinal + 1,
      side: axisSide(item.quantity),
      valid,
      anchorY,
      offscreen: !xInside || !yInside,
      selected: selected.has(item.key),
    };
  });

  const result = { entries, placed: [], hiddenCount: 0, xInside };
  const top = geometry.top + 10;
  const bottom = geometry.top + geometry.plotHeight - 10;
  for (const side of ["left", "right"]) {
    const candidates = entries
      .filter((entry) => entry.side === side && entry.valid && !entry.offscreen)
      .sort((left, right) => left.anchorY - right.anchorY || String(left.key).localeCompare(String(right.key)));
    const selectedKey = candidates.find((entry) => entry.selected)?.key ?? null;
    const group = placeGroup(candidates, top, bottom, CURSOR_BADGE_GAP, selectedKey);
    result.placed.push(...group.placed);
    result.hiddenCount += group.hiddenKeys.length;
    for (const key of group.hiddenKeys) entries.find((entry) => entry.key === key).hidden = true;
  }
  return result;
}
