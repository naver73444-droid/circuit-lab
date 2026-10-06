// Generic stacked-panes view driven by a pure "frame" description from a lesson model:
//   frame = { panes: [{ title, x:[lo,hi], y:[lo,hi], xTicks?, yTicks?, showY?, lines, areas, stems, jumps, vlines, hlines, dots,
//                       texts, bands, segments }], legend: [{ cls, text }] }
// Every drawing item has a `cls` string ("c1", "c2 dash", ...). Elements are created lazily per (pane, type, cls) the first
// time a frame needs them and are only re-attributed afterwards (create-once / update); unused ones are hidden.
import { createPane, createSurface } from './signals-plot.js';

const TYPES = {
  lines: (pane, cls) => { const w = pane.line(cls); return { set: (item) => w.set(item.pts), hide: () => w.set([]) }; },
  areas: (pane, cls) => { const w = pane.area(cls); return { set: (item) => w.set(item.pts, item.base ?? 0), hide: () => w.set([]) }; },
  stems: (pane, cls) => {
    const w = pane.stems(cls, { radius: 3.5 });
    return { set: (item) => w.set(item.pts, item.base ?? 0, { hollowFrom: item.hollowFrom ?? null }), hide: () => w.set([]) };
  },
  jumps: (pane, cls) => { const w = pane.jumps(cls); return { set: (item) => w.set(item.list), hide: () => w.set([]) }; },
  vlines: (pane, cls) => { const w = pane.vline(cls); return { set: (item) => w.set(item.x, item.from ?? null, item.to ?? null), hide: () => w.hide() }; },
  hlines: (pane, cls) => { const w = pane.hline(cls); return { set: (item) => w.set(item.y), hide: () => w.hide() }; },
  dots: (pane, cls) => { const w = pane.dot(cls, 5.5); return { set: (item) => w.set(item.x, item.y), hide: () => w.hide() }; },
  texts: (pane, cls) => {
    const w = pane.text(`tint ${cls}`);
    return { set: (item) => w.setAt(item.x, item.y, item.text, item.anchor ?? 'middle', item.dy ?? 0), hide: () => w.hide() };
  },
  bands: (pane, cls) => { const w = pane.band(cls); return { set: (item) => w.set(item.from, item.to), hide: () => w.hide() }; },
  segments: (pane, cls) => {
    const w = pane.segment(cls, { arrow: true });
    return { set: (item) => w.set(item.x1, item.y1, item.x2, item.y2), hide: () => w.hide() };
  },
};

export function createPanesView({ doc, parent, label, keys = null, className = '', maxPanes = 3 }) {
  const root = doc.createElement('div');
  parent.append(root);
  const surface = createSurface(doc, root, { label, keys, className });
  const panes = Array.from({ length: maxPanes }, () => createPane(doc, surface.svg));
  const pools = panes.map(() => new Map());
  const legendBox = doc.createElement('div');
  legendBox.className = 'sg-legend';
  root.append(legendBox);
  const legendItems = [];
  let width = 0;
  let placedKey = '';
  let lastFrame = null;

  function acquire(index, type, cls) {
    const key = `${type}|${cls}`;
    let slot = pools[index].get(key);
    if (!slot) {
      slot = { type, items: [], used: 0 };
      pools[index].set(key, slot);
    }
    if (slot.used >= slot.items.length) slot.items.push(TYPES[type](panes[index], cls));
    return slot.items[slot.used++];
  }

  function place(frame) {
    const n = frame.panes.length;
    const compact = width < 640;
    if (frame.split && width >= 700 && n === 3) {
      // wide layout: pane 0 on the left, panes 1 and 2 stacked on the right
      const H = Math.max(230, Math.min(300, width * 0.3));
      const colW = (width - 46 - 40 - 14) / 2;
      const magH = Math.round(H * 0.64);
      surface.resize(width, 22 + H + 28);
      panes[0].setBox(46, 22, colW, H);
      panes[1].setBox(46 + colW + 40, 22, colW, magH);
      panes[2].setBox(46 + colW + 40, 22 + magH + 46, colW, H - magH - 46);
      return;
    }
    const heights = frame.panes.map((p) => (p.h ?? (n === 1 ? 280 : n === 2 ? 180 : 138)) * (compact ? (n === 1 ? 0.9 : 0.78) : 1));
    const gap = 42;
    const top = 22;
    const total = top + heights.reduce((a, b) => a + b, 0) + gap * (n - 1) + 30;
    surface.resize(width, total);
    let y = top;
    panes.forEach((pane, i) => {
      if (i < n) { pane.setBox(46, y, width - 46 - 14, heights[i]); y += heights[i] + gap; }
    });
  }

  function layout(w) {
    width = w;
    placedKey = '';
    if (lastFrame) update(lastFrame);
  }

  function setLegend(entries) {
    entries.forEach((entry, i) => {
      let item = legendItems[i];
      if (!item) {
        const node = doc.createElement('span');
        item = { node, label: doc.createTextNode(''), cls: '' };
        node.append(doc.createElement('i'), item.label);
        legendBox.append(node);
        legendItems[i] = item;
      }
      if (item.cls !== entry.cls) { item.cls = entry.cls; item.node.className = entry.cls; }
      if (item.label.data !== entry.text) item.label.data = entry.text;
      if (item.node.hidden) item.node.hidden = false;
    });
    for (let i = entries.length; i < legendItems.length; i++) if (!legendItems[i].node.hidden) legendItems[i].node.hidden = true;
  }

  function update(frame) {
    lastFrame = frame;
    if (!width) return;
    const key = `${width}|${frame.split ? 's' : ''}${frame.panes.length}|${frame.panes.map((p) => p.h ?? 0).join(',')}`;
    if (key !== placedKey) { placedKey = key; place(frame); }
    panes.forEach((pane, i) => {
      const spec = frame.panes[i];
      pane.root.setAttribute('visibility', spec ? 'visible' : 'hidden');
      for (const slot of pools[i].values()) slot.used = 0;
      if (!spec) {
        for (const slot of pools[i].values()) slot.items.forEach((item) => item.hide());
        pane.clearAxes();
        pane.setTitle('');
        return;
      }
      pane.setDomain(spec.x[0], spec.x[1], spec.y[0], spec.y[1]);
      pane.drawAxes({ xTicks: spec.xTicks, yTicks: spec.yTicks, showY: spec.showY !== false });
      pane.setTitle(spec.title ?? '', 'start', true);
      for (const type of Object.keys(TYPES)) {
        for (const item of spec[type] ?? []) acquire(i, type, item.cls).set(item);
      }
      for (const slot of pools[i].values()) for (let k = slot.used; k < slot.items.length; k++) slot.items[k].hide();
    });
    setLegend(frame.legend ?? []);
  }

  return {
    root, surface, panes, layout, update, destroy: () => root.remove(),
  };
}
