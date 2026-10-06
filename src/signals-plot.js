// Small retained-mode SVG toolkit for the signals views. Elements are created once; update() calls
// only rewrite attributes. 1 user unit = 1 CSS pixel (viewBox follows the container width).
import { formatNumber, niceTicks, r1 } from './signals-util.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
let paneCounter = 0;

export function svgEl(doc, tag, attrs = {}, parent = null, text) {
  const node = doc.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  if (text !== undefined) node.textContent = text;
  parent?.append(node);
  return node;
}

let surfaceCounter = 0;
const finite = (v) => Number.isFinite(v);

// The <svg> itself, resized from the container width. `label` is a short name (also the <title>). Only a view that
// handles keys passes `keys`: it becomes focusable and the key hints are exposed through aria-describedby.
// `setGrab(fn)` marks the draggable regions: a touch that starts inside them (fn(point) is true) is claimed
// (preventDefault on a non-passive touchstart); everywhere else the page keeps scrolling (CSS touch-action: pan-y).
export function createSurface(doc, parent, { label, keys = null, className = '' }) {
  const id = `sgdesc${++surfaceCounter}`;
  const svg = svgEl(doc, 'svg', {
    class: `sg-svg ${className}`.trim(), role: 'img', 'aria-label': label, focusable: keys ? 'true' : 'false',
    ...(keys ? { tabindex: 0, 'aria-describedby': id } : {}),
  }, parent);
  svgEl(doc, 'title', {}, svg, label);
  if (keys) svgEl(doc, 'desc', { id }, svg, keys);
  let grab = null;
  const surface = {
    svg, width: 0, height: 0,
    setGrab(fn) { grab = fn; },
    resize(width, height) {
      surface.width = width;
      surface.height = height;
      svg.setAttribute('viewBox', `0 0 ${r1(width)} ${r1(height)}`);
      svg.style.height = `${r1(height)}px`;
    },
    // Pointer position in user units (= CSS px of the svg).
    pointer(event) {
      const rect = svg.getBoundingClientRect();
      const scale = rect.width ? surface.width / rect.width : 1;
      return { x: (event.clientX - rect.left) * scale, y: (event.clientY - rect.top) * scale };
    },
  };
  svg.addEventListener('touchstart', (event) => {
    if (grab && event.touches.length === 1 && grab(surface.pointer(event.touches[0]))) event.preventDefault();
  }, { passive: false });
  return surface;
}

// One plotting rectangle with its own data domain, axes, and clipped drawing layer.
export function createPane(doc, svg, { frame = true } = {}) {
  const id = `sgclip${++paneCounter}`;
  const root = svgEl(doc, 'g', { class: 'sg-pane' }, svg);
  const clipRect = svgEl(doc, 'rect', {}, svgEl(doc, 'clipPath', { id }, svgEl(doc, 'defs', {}, root)));
  const back = svgEl(doc, 'g', {}, root); // grid, bands, axes
  const layer = svgEl(doc, 'g', { 'clip-path': `url(#${id})` }, root);
  const front = svgEl(doc, 'g', {}, root); // labels that must not be clipped
  const frameRect = frame ? svgEl(doc, 'rect', { class: 'sg-frame' }, back) : null;
  const title = svgEl(doc, 'text', { class: 'sg-title' }, front);
  const pane = { box: { x: 0, y: 0, w: 1, h: 1 }, x0: 0, x1: 1, y0: 0, y1: 1 };
  pane.px = (v) => pane.box.x + ((v - pane.x0) / (pane.x1 - pane.x0)) * pane.box.w;
  pane.py = (v) => pane.box.y + pane.box.h - ((v - pane.y0) / (pane.y1 - pane.y0)) * pane.box.h;
  pane.fromPx = (px) => pane.x0 + ((px - pane.box.x) / pane.box.w) * (pane.x1 - pane.x0);
  pane.fromPy = (py) => pane.y0 + ((pane.box.y + pane.box.h - py) / pane.box.h) * (pane.y1 - pane.y0);
  pane.contains = (px, py) => px >= pane.box.x && px <= pane.box.x + pane.box.w && py >= pane.box.y && py <= pane.box.y + pane.box.h;
  pane.root = root;

  pane.setBox = (x, y, w, h) => {
    pane.box = { x, y, w, h };
    for (const node of [clipRect, frameRect]) {
      if (!node) continue;
      node.setAttribute('x', r1(x)); node.setAttribute('y', r1(y));
      node.setAttribute('width', r1(w)); node.setAttribute('height', r1(h));
    }
  };
  pane.setDomain = (x0, x1, y0, y1) => Object.assign(pane, { x0, x1, y0, y1 });
  // above=true puts the title in the margin over the frame instead of inside it.
  pane.setTitle = (text, align = 'start', above = false) => {
    title.textContent = text;
    title.setAttribute('x', r1(align === 'end' ? pane.box.x + pane.box.w - 6 : pane.box.x + 6));
    title.setAttribute('y', r1(above ? pane.box.y - 7 : pane.box.y + 14));
    title.setAttribute('text-anchor', align);
  };

  // ---- axes: pooled tick elements -----------------------------------------------------------
  const ticks = { x: [], y: [] };
  const axisLine = svgEl(doc, 'line', { class: 'sg-axis' }, back);
  const axisLineV = svgEl(doc, 'line', { class: 'sg-axis' }, back);
  const tick = (list, i) => {
    if (!list[i]) {
      list[i] = {
        grid: svgEl(doc, 'line', { class: 'sg-grid' }, back),
        text: svgEl(doc, 'text', { class: 'sg-tick' }, front),
      };
    }
    return list[i];
  };
  const hideFrom = (list, from) => {
    for (let i = from; i < list.length; i++) {
      list[i].grid.setAttribute('visibility', 'hidden');
      list[i].text.setAttribute('visibility', 'hidden');
    }
  };
  // xTicks / yTicks: arrays of numbers or {value, label}.
  pane.drawAxes = ({ xTicks, yTicks, xLabelFn = formatNumber, yLabelFn = formatNumber, showY = true } = {}) => {
    const { x, y, w, h } = pane.box;
    const xs = xTicks ?? niceTicks(pane.x0, pane.x1, Math.max(3, Math.floor(w / 90)));
    const ys = yTicks ?? niceTicks(pane.y0, pane.y1, Math.max(2, Math.floor(h / 45)));
    xs.forEach((t, i) => {
      const value = typeof t === 'object' ? t.value : t;
      const label = typeof t === 'object' ? t.label : xLabelFn(value);
      const node = tick(ticks.x, i);
      const px = pane.px(value);
      node.grid.setAttribute('visibility', 'visible'); node.text.setAttribute('visibility', 'visible');
      node.grid.setAttribute('x1', r1(px)); node.grid.setAttribute('x2', r1(px));
      node.grid.setAttribute('y1', r1(y)); node.grid.setAttribute('y2', r1(y + h));
      node.text.setAttribute('x', r1(px)); node.text.setAttribute('y', r1(y + h + 14));
      node.text.setAttribute('text-anchor', 'middle');
      node.text.textContent = label;
    });
    hideFrom(ticks.x, xs.length);
    // y ticks reuse the second pool; their grid lines are horizontal.
    ys.forEach((t, i) => {
      const value = typeof t === 'object' ? t.value : t;
      const label = typeof t === 'object' ? t.label : yLabelFn(value);
      const node = tick(ticks.y, i);
      const py = pane.py(value);
      const visible = showY ? 'visible' : 'hidden';
      node.grid.setAttribute('visibility', 'visible'); node.text.setAttribute('visibility', visible);
      node.grid.setAttribute('x1', r1(x)); node.grid.setAttribute('x2', r1(x + w));
      node.grid.setAttribute('y1', r1(py)); node.grid.setAttribute('y2', r1(py));
      node.text.setAttribute('x', r1(x - 5)); node.text.setAttribute('y', r1(py + 4));
      node.text.setAttribute('text-anchor', 'end');
      node.text.textContent = label;
    });
    hideFrom(ticks.y, ys.length);
    const zeroY = pane.y0 <= 0 && pane.y1 >= 0;
    axisLine.setAttribute('visibility', zeroY ? 'visible' : 'hidden');
    axisLine.setAttribute('x1', r1(x)); axisLine.setAttribute('x2', r1(x + w));
    axisLine.setAttribute('y1', r1(pane.py(0))); axisLine.setAttribute('y2', r1(pane.py(0)));
    const zeroX = pane.x0 <= 0 && pane.x1 >= 0;
    axisLineV.setAttribute('visibility', zeroX ? 'visible' : 'hidden');
    axisLineV.setAttribute('x1', r1(pane.px(0))); axisLineV.setAttribute('x2', r1(pane.px(0)));
    axisLineV.setAttribute('y1', r1(y)); axisLineV.setAttribute('y2', r1(y + h));
  };

  // ---- drawing primitives (data coordinates) ---------------------------------------------------
  const path = (cls, host = layer) => svgEl(doc, 'path', { class: cls }, host);

  pane.line = (cls) => {
    const node = path(`ln ${cls}`);
    return {
      node,
      set(points) {
        let d = '';
        let pen = false;
        for (const [x, y] of points) {
          if (!finite(y)) { pen = false; continue; }
          d += `${pen ? 'L' : 'M'}${r1(pane.px(x))},${r1(pane.py(y))}`;
          pen = true;
        }
        node.setAttribute('d', d);
      },
    };
  };

  // Filled region between the curve and `base`.
  pane.area = (cls) => {
    const node = path(`fl ${cls}`);
    return {
      node,
      set(points, base = 0) {
        if (!points.length) { node.setAttribute('d', ''); return; }
        let d = `M${r1(pane.px(points[0][0]))},${r1(pane.py(base))}`;
        for (const [x, y] of points) d += `L${r1(pane.px(x))},${r1(pane.py(y))}`;
        d += `L${r1(pane.px(points.at(-1)[0]))},${r1(pane.py(base))}Z`;
        node.setAttribute('d', d);
      },
    };
  };

  // Lollipops from y = 0 (or `base`) to each point.
  pane.stems = (cls, { radius = 3.5, hollow = false } = {}) => {
    const items = [];
    return {
      set(points, base = 0, { hollowFrom = null } = {}) {
        points.forEach(([x, y], i) => {
          if (!items[i]) items[i] = { line: svgEl(doc, 'line', { class: `st ${cls}` }, layer), dot: svgEl(doc, 'circle', { class: `dt ${cls}`, r: radius }, layer) };
          const { line, dot } = items[i];
          const px = r1(pane.px(x));
          line.setAttribute('visibility', 'visible'); dot.setAttribute('visibility', 'visible');
          line.setAttribute('x1', px); line.setAttribute('x2', px);
          line.setAttribute('y1', r1(pane.py(base))); line.setAttribute('y2', r1(pane.py(y)));
          dot.setAttribute('cx', px); dot.setAttribute('cy', r1(pane.py(y)));
          dot.classList.toggle('hollow', hollow || (hollowFrom !== null && x > hollowFrom));
          line.classList.toggle('faint', hollowFrom !== null && x > hollowFrom);
        });
        for (let i = points.length; i < items.length; i++) {
          items[i].line.setAttribute('visibility', 'hidden');
          items[i].dot.setAttribute('visibility', 'hidden');
        }
      },
    };
  };

  pane.dot = (cls, radius = 5) => {
    const node = svgEl(doc, 'circle', { class: `dt ring ${cls}`, r: radius, visibility: 'hidden' }, layer);
    return {
      node,
      set(x, y) {
        node.setAttribute('visibility', 'visible');
        node.setAttribute('cx', r1(pane.px(x))); node.setAttribute('cy', r1(pane.py(y)));
      },
      hide: () => node.setAttribute('visibility', 'hidden'),
    };
  };

  pane.vline = (cls) => {
    const node = svgEl(doc, 'line', { class: `ref ${cls}`, visibility: 'hidden' }, layer);
    return {
      node,
      set(x, from = null, to = null) {
        const px = r1(pane.px(x));
        node.setAttribute('visibility', 'visible');
        node.setAttribute('x1', px); node.setAttribute('x2', px);
        node.setAttribute('y1', r1(from === null ? pane.box.y : pane.py(from)));
        node.setAttribute('y2', r1(to === null ? pane.box.y + pane.box.h : pane.py(to)));
      },
      hide: () => node.setAttribute('visibility', 'hidden'),
    };
  };

  pane.hline = (cls) => {
    const node = svgEl(doc, 'line', { class: `ref ${cls}`, visibility: 'hidden' }, layer);
    return {
      node,
      set(y) {
        const py = r1(pane.py(y));
        node.setAttribute('visibility', 'visible');
        node.setAttribute('x1', r1(pane.box.x)); node.setAttribute('x2', r1(pane.box.x + pane.box.w));
        node.setAttribute('y1', py); node.setAttribute('y2', py);
      },
      hide: () => node.setAttribute('visibility', 'hidden'),
    };
  };

  // Straight segment between two data points (optionally with an arrow head at the end).
  pane.segment = (cls, { arrow = false } = {}) => {
    const node = svgEl(doc, 'line', { class: `ref ${cls}`, visibility: 'hidden' }, layer);
    const head = arrow ? svgEl(doc, 'path', { class: `fl solid ${cls}`, visibility: 'hidden' }, layer) : null;
    return {
      node,
      set(x1, y1, x2, y2) {
        const ax = pane.px(x1); const ay = pane.py(y1); const bx = pane.px(x2); const by = pane.py(y2);
        node.setAttribute('visibility', 'visible');
        node.setAttribute('x1', r1(ax)); node.setAttribute('y1', r1(ay));
        node.setAttribute('x2', r1(bx)); node.setAttribute('y2', r1(by));
        if (head) {
          const length = Math.hypot(bx - ax, by - ay);
          head.setAttribute('visibility', length > 14 ? 'visible' : 'hidden');
          const ux = (bx - ax) / (length || 1); const uy = (by - ay) / (length || 1);
          const tip = [bx, by]; const base = [bx - ux * 9, by - uy * 9];
          head.setAttribute('d', `M${r1(tip[0])},${r1(tip[1])}L${r1(base[0] - uy * 4)},${r1(base[1] + ux * 4)}L${r1(base[0] + uy * 4)},${r1(base[1] - ux * 4)}Z`);
        }
      },
      hide() { node.setAttribute('visibility', 'hidden'); head?.setAttribute('visibility', 'hidden'); },
    };
  };

  // Circle with its center in data coordinates and radius in data units of the x axis.
  pane.circle = (cls) => {
    const node = svgEl(doc, 'circle', { class: `ln ${cls}`, visibility: 'hidden' }, layer);
    return {
      node,
      set(cx, cy, radius) {
        node.setAttribute('visibility', 'visible');
        node.setAttribute('cx', r1(pane.px(cx))); node.setAttribute('cy', r1(pane.py(cy)));
        node.setAttribute('r', r1(Math.abs(radius * pane.box.w / (pane.x1 - pane.x0))));
      },
      hide: () => node.setAttribute('visibility', 'hidden'),
    };
  };

  // Vertical band between two data x values.
  pane.band = (cls) => {
    const node = svgEl(doc, 'rect', { class: `fl ${cls}`, visibility: 'hidden' }, layer);
    return {
      node,
      set(xa, xb) {
        const a = pane.px(Math.min(xa, xb)); const b = pane.px(Math.max(xa, xb));
        node.setAttribute('visibility', 'visible');
        node.setAttribute('x', r1(a)); node.setAttribute('width', r1(Math.max(0, b - a)));
        node.setAttribute('y', r1(pane.box.y)); node.setAttribute('height', r1(pane.box.h));
      },
      hide: () => node.setAttribute('visibility', 'hidden'),
    };
  };

  // Text at a pixel position inside the pane (not clipped).
  pane.text = (cls = '') => {
    const node = svgEl(doc, 'text', { class: `sg-note ${cls}`.trim(), visibility: 'hidden' }, front);
    return {
      node,
      set(x, y, text, anchor = 'middle') {
        node.setAttribute('visibility', 'visible');
        node.setAttribute('x', r1(x)); node.setAttribute('y', r1(y));
        node.setAttribute('text-anchor', anchor);
        node.textContent = text;
      },
      // anchored to data coordinates
      setAt(x, y, text, anchor = 'middle', dy = 0) { this.set(pane.px(x), pane.py(y) + dy, text, anchor); },
      hide: () => node.setAttribute('visibility', 'hidden'),
    };
  };

  pane.layer = layer;
  pane.front = front;
  return pane;
}

// Key row under a plot: items are {cls, text}. `cls` is a color ('c1'..'c5', 'cm') plus an optional non-color cue
// ('dash', 'dot', 'ring', 'band') so the entries stay distinguishable without color vision.
// legend.set([...texts]) rewrites the wording per example; null hides an entry.
export function createLegend(doc, parent, items) {
  const box = doc.createElement('div');
  box.className = 'sg-legend';
  const entries = items.map(({ cls, text }) => {
    const entry = doc.createElement('span');
    const label = doc.createTextNode(text);
    entry.className = cls;
    entry.append(doc.createElement('i'), label);
    box.append(entry);
    return { entry, label };
  });
  parent.append(box);
  return {
    box,
    set(texts) {
      entries.forEach(({ entry, label }, i) => {
        const text = texts[i] ?? null;
        if (entry.hidden !== (text === null)) entry.hidden = text === null;
        if (text !== null && label.data !== text) label.data = text;
      });
    },
  };
}
