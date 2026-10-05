import { safeColor } from "./safe-dom.js";
import { contrastingTrace } from "./color-model.js";
const cache = new Map();
/** Normalize supported CSS colors for readable traces, retaining the saved color. */
export function traceColor(input) {
  const color = safeColor(input);
  const dark = document.documentElement.dataset.theme !== "light";
  const key = `${dark}:${color}`;
  if (cache.has(key)) return cache.get(key);
  let hexadecimal = color;
  if (!/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(color)) {
    const canvas = document.createElement("canvas"), context = canvas.getContext("2d");
    if (context) {
      context.fillStyle = "#8ac4ff"; context.fillStyle = color;
      hexadecimal = context.fillStyle;
      // Alpha or unresolved contextual colors get a visible neutral blue fallback.
      if (!hexadecimal.startsWith("#")) hexadecimal = "#8ac4ff";
    }
  }
  const result = contrastingTrace(hexadecimal, dark) ?? (dark ? "#8ac4ff" : "#175c9f");
  if (cache.size > 512) cache.clear();
  cache.set(key, result);
  return result;
}
