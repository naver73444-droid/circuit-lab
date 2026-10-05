/** Pure, versioned presentation preferences. Never part of a circuit file. */
export const PANEL_SPECS = Object.freeze([
  { id: 'palette', title: '부품', element: 'palette-panel', dock: 'left', visible: true, size: 440 },
  { id: 'inspector', title: '속성', element: 'inspector-panel', dock: 'right', visible: true, size: 255 },
  { id: 'analysis', title: '관찰 설정', element: 'analysis-panel', dock: 'bottom', visible: true, size: 300 },
  { id: 'wave', title: '파형·CSV', element: 'wave-panel', dock: 'right', visible: true, size: 410 },
  { id: 'port', title: '테브난·노턴', element: 'port-panel', dock: 'right', visible: false, size: 340 },
  { id: 'phasor', title: '페이저', element: 'phasor-panel', dock: 'right', visible: false, size: 520 },
]);
export const DOCKS = Object.freeze(['left', 'right', 'bottom']);
const finiteBound = (x, min, max, fallback) => typeof x === 'number' && Number.isFinite(x) ? Math.max(min, Math.min(max, x)) : fallback;
export function normalizeLayout(raw) {
  const value = raw?.version === 1 ? raw : {};
  const panels = {};
  for (const [i, spec] of PANEL_SPECS.entries()) {
    const old = Object.hasOwn(value.panels ?? {}, spec.id) ? value.panels[spec.id] : null;
    panels[spec.id] = { dock: DOCKS.includes(old?.dock) ? old.dock : spec.dock,
      visible: typeof old?.visible === 'boolean' ? old.visible : spec.visible,
      order: finiteBound(old?.order, 0, 100, i), size: finiteBound(old?.size, 180, 900, spec.size),
      mobileEdge: old?.mobileEdge === 'top' ? 'top' : 'bottom' };
  }
  return { version: 1, panels, sizes: {
    left: finiteBound(value.sizes?.left, 190, 430, 215), right: finiteBound(value.sizes?.right, 240, 650, 360),
    bottom: finiteBound(value.sizes?.bottom, 140, 560, 170), sheet: finiteBound(value.sizes?.sheet, 220, 900, 480),
  } };
}
export function orderedPanels(layout, dock, visibleOnly = false) {
  return PANEL_SPECS.map(x => x.id).filter(id => layout.panels[id].dock === dock && (!visibleOnly || layout.panels[id].visible))
    .sort((a, b) => layout.panels[a].order - layout.panels[b].order);
}
export function movePanel(layout, id, dock, delta = 0) {
  const next = normalizeLayout(layout);
  if (!Object.hasOwn(next.panels, id) || !DOCKS.includes(dock)) return next;
  const peers = orderedPanels(next, dock).filter(x => x !== id);
  const same = next.panels[id].dock === dock;
  const oldIndex = orderedPanels(next, dock).indexOf(id);
  const index = same ? Math.max(0, Math.min(peers.length, oldIndex + Math.sign(delta))) : peers.length;
  peers.splice(index, 0, id); next.panels[id].dock = dock;
  peers.forEach((name, order) => { next.panels[name].order = order; });
  return next;
}
export function dropDock(point, rect) {
  if (![point?.x, point?.y, rect?.x, rect?.y, rect?.width, rect?.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) return null;
  const x = (point.x - rect.x) / rect.width, y = (point.y - rect.y) / rect.height;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  if (y >= .72) return 'bottom';
  if (x <= .25) return 'left';
  if (x >= .75) return 'right';
  return null;
}
