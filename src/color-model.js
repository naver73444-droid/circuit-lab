/** sRGB contrast helpers. Presentation only: never write back into a project. */
export function luminance(rgb) {
  return rgb.map(value => { const c = value / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; })
    .reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
}
export function contrastRatio(first, second) {
  const a = luminance(first), b = luminance(second);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}
export function hexRgb(color) {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color);
  if (!match) return null;
  const hex = match[1].length === 3 ? [...match[1]].map(c => c + c).join("") : match[1];
  return [0, 2, 4].map(index => parseInt(hex.slice(index, index + 2), 16));
}
export function contrastingTrace(color, dark = true) {
  const rgb = hexRgb(color);
  if (!rgb) return null;
  const background = dark ? [24, 27, 32] : [244, 245, 248];
  const destination = dark ? 255 : 0;
  for (let i = 0; i <= 100; i++) {
    const candidate = rgb.map(channel => Math.round(channel + (destination - channel) * i / 100));
    if (contrastRatio(candidate, background) >= 4.5) return "#" + candidate.map(value => value.toString(16).padStart(2, "0")).join("");
  }
  return dark ? "#ffffff" : "#000000";
}
