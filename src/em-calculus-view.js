// Canvas of the divergence / curl probe: the field, the div and curl map around the sensor, and how the sphere and
// loop integrals build up. Colours come from the palette.
import { norm3 } from './em-physics.js';
import { planeAxes, planeNormal } from './em-plane-geometry.js';
import { cssRgba } from './em-palette.js';

const FONT = 'system-ui, "Malgun Gothic", sans-serif';

function arrow(ctx, x, y, dx, dy, head = 3.5) {
  const angle = Math.atan2(dy, dx);
  ctx.beginPath();
  ctx.moveTo(x, y); ctx.lineTo(x + dx, y + dy);
  ctx.lineTo(x + dx - head * Math.cos(angle - 0.55), y + dy - head * Math.sin(angle - 0.55));
  ctx.moveTo(x + dx, y + dy);
  ctx.lineTo(x + dx - head * Math.cos(angle + 0.55), y + dy - head * Math.sin(angle + 0.55));
  ctx.stroke();
}

function bars(ctx, values, area, label, color, palette) {
  ctx.fillStyle = palette.muted.css; ctx.font = `11px ${FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillText(label, area.x, area.y - 3);
  const mid = area.y + area.h / 2;
  ctx.strokeStyle = palette.line.css; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(area.x, mid); ctx.lineTo(area.x + area.w, mid); ctx.stroke();
  if (!values?.length) return;
  const max = Math.max(1e-30, ...values.map(Math.abs)), width = area.w / values.length;
  values.forEach((value, i) => {
    const height = value / max * area.h * 0.45;
    ctx.fillStyle = value >= 0 ? color : palette.neg.css;
    ctx.fillRect(area.x + i * width, mid - Math.max(0, height), Math.max(1, width - 1), Math.abs(height));
  });
}

/** Draw the probe's display (from evaluateCalculus) or a hint when there is none. */
export function drawCalculus(canvas, display, palette, message = '') {
  const dpr = Math.min(2, devicePixelRatio || 1), w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  const ctx = canvas.getContext('2d');
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = palette.bg.css; ctx.fillRect(0, 0, w, h);
  ctx.font = `12px ${FONT}`; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  if (!display) {
    ctx.fillStyle = palette.muted.css;
    ctx.fillText(message || '고급 칸을 열면 시험전하 자리에서 계산합니다.', 12, 24);
    return;
  }
  const [a, b] = planeAxes(display.plane), normal = planeNormal(display.plane);
  const top = h * 0.6, half = w / 2;
  const map = (point, side) => [side * half + ((point[a] - display.probe[a]) / 4 + 0.5) * half, (0.5 - (point[b] - display.probe[b]) / 4) * top];
  ctx.strokeStyle = palette.line.css; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(half, 0); ctx.lineTo(half, top); ctx.moveTo(0, top); ctx.lineTo(w, top); ctx.stroke();
  ctx.fillStyle = palette.text.css;
  ctx.fillText(display.mode === 'electric' ? '장 E (방향)' : '장 F (방향)', 8, 16);
  ctx.fillText('div (색) · curl (⊙ ⊗)', half + 8, 16);
  const unitSize = half / 10;
  for (const item of display.grid) {
    const result = display.field(item.point);
    if (result.status !== 'valid') continue;
    const vector = result.E, size = Math.hypot(vector[a], vector[b]);
    const [x, y] = map(item.point, 0);
    if (size) {
      ctx.strokeStyle = cssRgba(palette.text.rgb, 0.8); ctx.lineWidth = 1.2;
      arrow(ctx, x, y, vector[a] / size * 9, -vector[b] / size * 9);
    }
    const [ox, oy] = map(item.point, 1);
    const scale = display.mode === 'electric' ? 0.002 : Math.max(1e-12, 3 * Math.abs(display.alpha));
    const t = Math.max(-1, Math.min(1, item.divergence / scale));
    ctx.fillStyle = cssRgba((t >= 0 ? palette.pos : palette.neg).rgb, 0.12 + 0.6 * Math.abs(t));
    ctx.fillRect(ox - unitSize, oy - unitSize * 0.8, unitSize * 2, unitSize * 1.6);
    const out = item.curl[normal];
    if (Math.abs(out) > 1e-12) {
      ctx.fillStyle = palette.sensor.css; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(out > 0 ? '⊙' : '⊗', ox, oy);
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    }
  }
  // sphere cross-section (dashed) and the loop (solid) around the sensor, in the left panel
  const [cx, cy] = map(display.probe, 0), radius = display.radius / 4 * half;
  ctx.strokeStyle = palette.gauss.css; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
  ctx.beginPath(); ctx.arc(cx, cy, radius, 0, 2 * Math.PI); ctx.stroke(); ctx.setLineDash([]);
  const n = display.normal, along = n[normal] / (norm3(n) || 1);
  ctx.strokeStyle = palette.accent.css; ctx.lineWidth = 2;
  ctx.beginPath();
  if (Math.abs(along) > 0.5) ctx.ellipse(cx, cy, radius, radius * Math.abs(along), 0, 0, 2 * Math.PI);
  else { ctx.moveTo(cx - radius, cy); ctx.lineTo(cx + radius, cy); }
  ctx.stroke();
  ctx.fillStyle = palette.muted.css;
  ctx.fillText(`구 R=${display.radius} · 루프 n=(${n.map(v => Number(v.toPrecision(2))).join(', ')})`, 8, top - 6);
  const strip = (h - top - 16) / 2 - 10;
  const strips = [
    [display.flux.surfaceContributions, top + 22, '구면 방위각별 E·n dS 기여', palette.pos.css],
    [display.loop.pathContributions, top + 22 + strip + 22, '루프 경로별 F·dl 기여', palette.accent.css],
  ];
  for (const [values, y, label, color] of strips) bars(ctx, values, { x: 8, y, w: w - 16, h: strip }, label, color, palette);
}
