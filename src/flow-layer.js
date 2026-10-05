import { polylinePath } from "./circuit-geometry.js";
import { flowSampleIndex, flowSpeedClass, peakComponentCurrent, wireCurrents } from "./wire-current-model.js";

/**
 * "전류 흐름" overlay: dashes that creep along the wires in the direction of the current. Off by default, remembered per browser.
 *
 * The overlay is its own SVG layer (#flow-layer, between the wires and the parts, pointer-events none) so hit-testing, the partial
 * drag renderer and the wire/component layers are untouched. Motion is pure CSS (stroke-dashoffset keyframes, no per-frame JS):
 * wires are grouped by speed class and every wire's points are written in the direction of its current, so one animated <path> per
 * speed class (at most four) serves the whole circuit and all of them move "forward". It rebuilds only when the result, the sample
 * (DC point, scope cursor time or last sample), the geometry or the toggle changes, and hides while a part is being dragged.
 * With prefers-reduced-motion the dashes are replaced by one static arrow per wire (CSS switches between the two).
 */
const STORAGE_KEY = "circuit-lab.flow-view";
const MIN_ARROW_LENGTH = 30;
const AC_HINT = "AC는 페이저로 확인하세요";

export function createFlowLayer({ state, elements, scopeView, wireRoutes }) {
  const layer = elements["flow-layer"];
  const toggle = elements["flow-toggle"];
  const hint = elements["flow-hint"];
  let enabled = readPreference();
  let lastMarkup = "";
  let lastInfo = { enabled, status: "off", sample: null, wires: [] };
  let frame = null;
  const stats = { builds: 0, writes: 0 };

  function readPreference() {
    try { return globalThis.localStorage?.getItem(STORAGE_KEY) === "1"; } catch { return false; }
  }
  function writePreference(value) {
    try { globalThis.localStorage?.setItem(STORAGE_KEY, value ? "1" : "0"); } catch { /* The choice then lasts for this page only. */ }
  }

  const isStale = () => state.stale || state.runState.status === "stale";

  /** Point `distance` along a polyline, with the direction of the segment it falls on. */
  function pointAlong(points, distance) {
    for (let i = 1; i < points.length; i += 1) {
      const length = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
      if (distance <= length || i === points.length - 1) {
        const t = length > 0 ? Math.min(1, distance / length) : 0;
        return { x: points[i - 1].x + (points[i].x - points[i - 1].x) * t, y: points[i - 1].y + (points[i].y - points[i - 1].y) * t, dx: (points[i].x - points[i - 1].x) / (length || 1), dy: (points[i].y - points[i - 1].y) / (length || 1) };
      }
      distance -= length;
    }
    return null;
  }

  function arrowPath(points) {
    let total = 0;
    for (let i = 1; i < points.length; i += 1) total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    if (total < MIN_ARROW_LENGTH) return "";
    const at = pointAlong(points, total / 2);
    if (!at) return "";
    const round = (value) => Math.round(value * 10) / 10;
    const tip = { x: at.x + at.dx * 6, y: at.y + at.dy * 6 };
    const left = { x: at.x - at.dx * 5 - at.dy * 5, y: at.y - at.dy * 5 + at.dx * 5 };
    const right = { x: at.x - at.dx * 5 + at.dy * 5, y: at.y - at.dy * 5 - at.dx * 5 };
    return `M${round(tip.x)} ${round(tip.y)}L${round(left.x)} ${round(left.y)}L${round(right.x)} ${round(right.y)}Z`;
  }

  function setHint(text) {
    if (!hint) return;
    hint.textContent = text;
    hint.classList.toggle("hidden", !text);
  }

  function write(markup) {
    // Rewriting identical markup would restart every CSS animation, so an unchanged picture is left alone.
    if (markup !== lastMarkup) { layer.innerHTML = markup; lastMarkup = markup; stats.writes += 1; }
  }

  function build() {
    if (frame !== null) { cancelAnimationFrame(frame); frame = null; }
    layer.classList.remove("flow-suspended");
    if (toggle) toggle.checked = enabled;
    if (!enabled) { write(""); setHint(""); lastInfo = { enabled, status: "off", sample: null, wires: [] }; return; }
    stats.builds += 1;
    const result = state.result;
    if (!result) { write(""); setHint(""); lastInfo = { enabled, status: "no-result", sample: null, wires: [] }; return; }
    if (result.analysis === "ac") { write(""); setHint(AC_HINT); lastInfo = { enabled, status: "ac", sample: null, wires: [] }; return; }
    setHint("");
    if (isStale()) { write(""); lastInfo = { enabled, status: "stale", sample: null, wires: [] }; return; }
    const index = flowSampleIndex(result, scopeView?.cursorIndex);
    const point = index === null ? null : result.points[index];
    if (!point?.componentCurrents) { write(""); lastInfo = { enabled, status: "no-result", sample: index, wires: [] }; return; }

    const { byWire, maxAbs } = wireCurrents({ circuit: state.circuit, componentCurrents: point.componentCurrents });
    const scale = Math.max(maxAbs, peakComponentCurrent(result));
    const routes = wireRoutes();
    const groups = new Map(); // speed class -> { d: [], ids: [] }
    const arrows = [];
    const wires = [];
    for (const wire of state.circuit.wires) {
      const entry = byWire[wire.id];
      const route = routes.get(wire.id);
      if (!entry || !route) continue;
      const speed = entry.current === null ? 0 : flowSpeedClass(Math.abs(entry.current), scale);
      wires.push({ id: wire.id, state: entry.state, current: entry.current, speed, direction: entry.current === null || speed === 0 ? 0 : entry.current > 0 ? 1 : -1 });
      if (!speed) continue;
      const forward = entry.current > 0 ? route : [...route].reverse();
      if (!groups.has(speed)) groups.set(speed, { d: [], ids: [] });
      const group = groups.get(speed);
      group.d.push(polylinePath(forward));
      group.ids.push(wire.id);
      const arrow = arrowPath(forward);
      if (arrow) arrows.push(arrow);
    }
    const dashes = [...groups.keys()].sort().map((speed) => `<path class="flow-dash flow-s${speed}" data-wires="${groups.get(speed).ids.join(" ")}" d="${groups.get(speed).d.join("")}"/>`).join("");
    write(dashes ? `${dashes}<path class="flow-arrows" d="${arrows.join("")}"/>` : "");
    lastInfo = { enabled, status: dashes ? "flow" : "none", sample: index, wires };
  }

  /** Coalesced rebuild for high-frequency sources (scope cursor hover). */
  function schedule() {
    if (!enabled || frame !== null) return;
    frame = requestAnimationFrame(() => { frame = null; build(); });
  }

  /** A part is being dragged: the wires move under the dots, so hide the overlay until the next canvas render. */
  function suspend() {
    if (layer.firstChild) layer.classList.add("flow-suspended");
  }

  function setEnabled(value) {
    enabled = Boolean(value);
    writePreference(enabled);
    build();
  }

  toggle?.addEventListener("change", () => setEnabled(toggle.checked));
  if (scopeView) {
    const previous = scopeView.onCursor;
    scopeView.onCursor = (index) => { previous?.(index); if (enabled) schedule(); };
  }
  if (toggle) toggle.checked = enabled;

  return { refresh: build, schedule, suspend, setEnabled, isEnabled: () => enabled, inspect: () => ({ ...lastInfo, suspended: layer.classList.contains("flow-suspended"), stats: { ...stats } }) };
}
