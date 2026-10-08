import { parseValue, pinCount } from "./circuit-engine.js";
import { endpointKey } from "./circuit-edit.js";
import {
  circuitGeometryVersion,
  localPin as geometryLocalPin,
  normalizePoints,
  orthogonalLeg,
  appendFixedWaypoint,
  pinPosition as geometryPinPosition,
  polylinePath,
  routeWirePoints,
  snapPoint,
} from "./circuit-geometry.js";
import { createRoutingContext, previewRoute } from "./wire-router.js";
import { currentArrowGeometry, currentDirectionDescriptor } from "./current-direction.js";
import { escapeHtml } from "./safe-dom.js";
import { traceColor } from "./trace-color.js";
import { sourceInlineDescriptor } from "./ui-model.js";
import { isSelected, selectedKeys } from "./selection-model.js";

const LABEL_LONG = 8;
const LABEL_DIGITS = 5;
const LABEL_PREFIX = new Map([[-12, "p"], [-9, "n"], [-6, "u"], [-3, "m"], [0, ""], [3, "k"], [6, "meg"], [9, "g"], [12, "t"]]);

/**
 * The value text drawn on the canvas. A stored value such as "3.66666666667k" (a converted resistance keeps 12 digits so the circuit stays
 * equivalent) is too long to read there, so a value string longer than 8 characters is shown with at most 5 significant digits:
 * "3.6667k"; a bare number gets an SI prefix ("0.000123456789" → "123.46u"). Short values, text that is no number ("PULSE" style labels are
 * built around the value, not part of it) and anything that cannot be shortened stay exactly as stored. The inspector keeps the raw text.
 */
export function formatCanvasValueLabel(raw) {
  const text = typeof raw === "string" ? raw : typeof raw === "number" ? String(raw) : "";
  if (text.length <= LABEL_LONG) return text;
  const match = text.trim().match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*([A-Za-zΩµμ]*)$/);
  if (!match) return text;
  let value;
  try { value = parseValue(text); } catch { return text; }
  if (!Number.isFinite(value) || value === 0) return text;
  const suffix = match[2];
  let shown;
  if (suffix === "") {
    const exponent = 3 * Math.floor(Math.log10(Math.abs(value)) / 3 + 1e-12);
    if (!LABEL_PREFIX.has(exponent)) return text;
    shown = `${Number((value / 10 ** exponent).toPrecision(LABEL_DIGITS))}${LABEL_PREFIX.get(exponent)}`;
  } else {
    shown = `${Number(Number(match[1]).toPrecision(LABEL_DIGITS))}${suffix}`;
  }
  return shown.length < text.length ? shown : text;
}

/** The value text of a coupled inductor ("L1 5H · L2 6H · M 3H", or "5H·6H·M3H" when that is too long) or ideal transformer ("1 : 2"); the inspector keeps the raw props. */
export function magneticValueLabel(component) {
  const p = component.props ?? {};
  if (component.type === "XFMR_IDEAL") return `1 : ${formatCanvasValueLabel(p.n ?? "2")}`;
  // A plain number (with or without an SI prefix) gets the henry unit; anything else (a unit already there, a name) is shown as typed.
  const henry = (raw) => { const text = formatCanvasValueLabel(raw ?? ""); return /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?[pnuµmkMG]?$/.test(text) ? `${text}H` : text; };
  const second = p.coupling === "M" ? { name: "M", value: henry(p.M) } : { name: "k", value: formatCanvasValueLabel(p.k ?? "") };
  const full = `L1 ${henry(p.L1)} · L2 ${henry(p.L2)} · ${second.name} ${second.value}`;
  return full.length <= 22 ? full : `${henry(p.L1)}·${henry(p.L2)}·${second.name}${second.value}`;
}

/**
 * Two vertical coils (winding 1 left, winding 2 right) with leads to the pins at (±40, ±20); the ideal transformer adds core lines.
 * Dots: pin 1a and pin 2a (top) when dots="same", pin 1a and pin 2b (bottom right) when dots="opposite".
 */
export function magneticSymbolMarkup(component) {
  const opposite = component.props?.dots === "opposite";
  const bumps = (sweep) => `a5 5 0 0 ${sweep} 0 10`.repeat(4);
  const core = component.type === "XFMR_IDEAL" ? `<path class="symbol-line" d="M-3-20V20M3-20V20"/>` : `<text class="controlled-pin-label" x="0" y="4" style="text-anchor:middle">M</text>`;
  return `<path class="lead" d="M-40-20H-14M-40 20H-14M14-20H40M14 20H40"/><path class="symbol-line" d="M-14-20${bumps(0)}M14-20${bumps(1)}"/>${core}<circle class="ideal-mark" cx="-31" cy="-12" r="2.8"/><circle class="ideal-mark" cx="31" cy="${opposite ? 12 : -12}" r="2.8"/>`;
}

/**
 * SVG drawing of the circuit canvas. Reads the editor state and never changes it. Pointer/keyboard handling is delegated
 * on the layer roots by editor-input (bound once), so a render only writes markup and never re-binds listeners.
 * A component drag takes a cheaper path (updateMoved): move that part's <g transform> and the `d` of the wires attached to it.
 */
export function createCanvasRenderer(deps) {
  const { state, elements, workspace, currentConnections, afterCanvasRender, onDragFrame } = deps;
  let overlayFrame = null;
  let dragFrame = null;
  let pendingDrag = null;
  // Render counters (debug hook): full rebuilds vs cheap drag updates.
  const stats = { full: 0, overlay: 0, drag: 0, dragFallback: 0, selection: 0 };

  // Pin and junction hit discs are sized in screen pixels from the current zoom (see styles.css --pin-hit-*-r / --junction-hit-r).
  const svgSize = { width: 0, height: 0 };
  let hitScale = 0;
  const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
  function syncHitSizes(force = false) {
    const svg = elements["circuit-canvas"];
    if (force || !svgSize.width) { svgSize.width = svg.clientWidth; svgSize.height = svg.clientHeight; }
    const v = state.canvasView;
    const scale = Math.min(svgSize.width / v.width, svgSize.height / v.height);
    if (!(scale > 0) || (!force && Math.abs(scale - hitScale) < hitScale * 0.004)) return;
    hitScale = scale;
    // A part's pins sit 40 units from its centre. In the select tool the disc stays well inside that distance so the middle of the
    // part still selects it; while wiring there is no body to protect, so the disc is larger. Radii are screen px turned into user units.
    const near = 40 * scale;
    const units = (screenRadius) => `${(screenRadius / scale).toFixed(2)}px`;
    svg.style.setProperty("--pin-hit-select-r", units(clamp(near * 0.4, 6.5, 18)));
    svg.style.setProperty("--pin-hit-wire-r", units(clamp(near * 0.6, 11, 22)));
    svg.style.setProperty("--junction-hit-r", units(13));
  }
  if (typeof ResizeObserver === "function") {
    new ResizeObserver(() => syncHitSizes(true)).observe(elements["circuit-canvas"]);
  }

  function updateCanvasView() {
    const v = state.canvasView;
    elements["circuit-canvas"].setAttribute("viewBox", `${v.x} ${v.y} ${v.width} ${v.height}`);
    syncHitSizes();
  }

  function scheduleOverlayRender() {
    if (overlayFrame === null) overlayFrame = requestAnimationFrame(() => { overlayFrame = null; if (workspace.circuitActive) renderOverlay(); });
  }

  /**
   * Frame-batched drag update: only the moved items' groups and the wires attached to them change. Falls back to a full render if the
   * DOM is not there. `id` is one id, or for kind "group" an object {components: [...], junctions: [...]}.
   */
  function scheduleDragUpdate(kind, id) {
    pendingDrag = kind === "group" ? { components: id.components, junctions: id.junctions } : { components: kind === "component" ? [id] : [], junctions: kind === "junction" ? [id] : [] };
    if (dragFrame !== null) return;
    dragFrame = requestAnimationFrame(() => {
      dragFrame = null;
      const job = pendingDrag;
      pendingDrag = null;
      // The gesture may have ended since this frame was requested (drop, cancel, project change): its final render already drew everything.
      if (!job || !workspace.circuitActive || !isMoveDrag()) return;
      if (!updateMoved(job)) { stats.dragFallback += 1; renderCanvas(); }
    });
  }

  /** A part, junction or group is being carried (the only gesture the cheap drag path serves). */
  const isMoveDrag = () => Boolean(state.drag && state.drag.moved && (state.drag.kind === "component" || state.drag.kind === "junction"));

  /** Drop any drag update still waiting for its frame (the gesture ended, or a full render has just redrawn everything). */
  function cancelDragUpdate() {
    if (dragFrame !== null) { try { cancelAnimationFrame(dragFrame); } catch { /* the frame is guarded anyway */ } dragFrame = null; }
    pendingDrag = null;
  }

  function localPin(type, pin) {
    return geometryLocalPin(type, pin, circuitGeometryVersion(state.circuit));
  }

  function pinPosition(component, pin) {
    return geometryPinPosition(component, pin, circuitGeometryVersion(state.circuit));
  }

  function deleteButtonMarkup(component) {
    const ref = escapeHtml(component.props?.ref ?? component.id);
    const badgeRotation = -Number(component.rotation ?? 0);
    return `<g class="component-delete" data-delete-component="${escapeHtml(component.id)}" role="button" tabindex="0" aria-label="${ref} 삭제" transform="translate(35 -34) rotate(${badgeRotation})"><title>부품 삭제 · Ctrl+Z로 복원</title><rect x="-15" y="-15" width="30" height="30" rx="3"/><text y="4">×</text></g>`;
  }

  const componentTransform = (component) => `translate(${component.x} ${component.y}) rotate(${component.rotation ?? 0})`;

  function componentMarkup(component, connection) {
    const ref = escapeHtml(component.props?.ref ?? component.id);
    const sourceDescriptor = ["V", "I", "VCVS", "VCCS", "CCCS", "CCVS"].includes(component.type) ? sourceInlineDescriptor(component, state.settings.analysis) : null;
    const magnetic = component.type === "COUPLED_L" || component.type === "XFMR_IDEAL";
    const valueLabel = magnetic ? magneticValueLabel(component) : formatCanvasValueLabel(sourceDescriptor?.value ?? component.props?.value ?? component.props?.gain ?? "");
    const value = escapeHtml(sourceDescriptor ? `${sourceDescriptor.label} ${valueLabel} ${sourceDescriptor.unit}` : valueLabel);
    const editProp = magnetic
      ? (component.type === "XFMR_IDEAL" ? "n" : component.props?.coupling === "M" ? "M" : "k")
      : sourceDescriptor?.prop ?? (component.props?.value !== undefined ? "value" : component.props?.gain !== undefined ? "gain" : "");
    const geometryVersion = circuitGeometryVersion(state.circuit);
    const mode = component.props?.mode ?? "DC";
    let symbol = "";
    if (component.type === "R") symbol = `<path class="lead" d="M-40 0H-27M27 0H40"/><path class="body" d="M-27 0l6-11 9 22 9-22 9 22 9-22 6 11"/>`;
    if (component.type === "C") symbol = `<path class="lead" d="M-40 0H-8M8 0H40"/><path class="body" d="M-8-18V18M8-18V18"/>`;
    if (component.type === "L") symbol = `<path class="lead" d="M-40 0H-28M28 0H40"/><path class="body" d="M-28 0c0-14 14-14 14 0 0-14 14-14 14 0 0-14 14-14 14 0 0-14 14-14 14 0"/>`;
    const waveformSymbol = mode === "SIN"
      ? `<path class="symbol-line" d="M-13 0C-9-12-4-12 0 0S9 12 13 0"/>`
      : mode === "PULSE"
        ? `<path class="symbol-line" d="M-13 7H-5V-7H6V7H13"/>`
        : null;
    if (component.type === "V") symbol = `<path class="lead" d="M-40 0H-19M19 0H40"/><circle class="body" cx="0" cy="0" r="19"/>${waveformSymbol ?? `<path class="symbol-line" d="M-12 0h8M-8-4v8M5 0h8"/>`}`;
    if (component.type === "I") symbol = `<path class="lead" d="M-40 0H-19M19 0H40"/><circle class="body" cx="0" cy="0" r="19"/>${waveformSymbol ?? `<path class="symbol-line" d="M-10 0H10M4-6l6 6-6 6"/>`}`;
    if (component.type === "D") symbol = `<path class="lead" d="M-40 0H-18M18 0H40"/><path class="body" d="M-18-16V16L12 0Z"/><path class="symbol-line" d="M14-17V17"/>`;
    if (component.type === "GND") symbol = geometryVersion === 1
      ? `<path class="lead" d="M0-28V-8"/><path class="body" d="M-20-8H20M-13-1H13M-6 6H6"/>`
      : `<path class="lead" d="M0-40V-12"/><path class="body" d="M-20-12H20M-13-5H13M-6 2H6"/>`;
    if (component.type === "OPAMP" || component.type === "OPAMP_IDEAL") symbol = geometryVersion === 1
      ? `<path class="lead" d="M-45-18H-29M-45 18H-29M29 0H45"/><path class="body" d="M-29-35V35L29 0Z"/><path class="symbol-line" d="M-23-18h10M-18-23v10M-23 18h10"/>${component.type === "OPAMP_IDEAL" ? `<text class="ideal-mark" x="2" y="6">∞</text>` : ""}`
      : `<path class="lead" d="M-40-20H-26M-40 20H-26M26 0H40"/><path class="body" d="M-26-36V36L26 0Z"/><path class="symbol-line" d="M-22-20h10M-17-25v10M-22 20h10"/>${component.type === "OPAMP_IDEAL" ? `<text class="ideal-mark" x="2" y="6">∞</text>` : ""}`;
    if (component.type === "VCVS" || component.type === "VCCS") symbol = `<path class="lead" d="M-40 0H-24M24 0H40M0-40V-24M0 24V40"/><path class="body" d="M-24 0L0-24 24 0 0 24Z"/>${component.type === "VCVS" ? `<path class="symbol-line" d="M-14 0h8M-10-4v8M6 0h8"/>` : `<path class="symbol-line" d="M-11 0H11M5-6l6 6-6 6"/>`}<text class="controlled-pin-label" x="-35" y="-7">p</text><text class="controlled-pin-label" x="28" y="-7">n</text><text class="controlled-pin-label" x="6" y="-28">cp</text><text class="controlled-pin-label" x="6" y="35">cn</text>`;
    if (component.type === "CURRENT_SENSOR") symbol = `<path class="lead" d="M-40 0H-19M19 0H40"/><circle class="body" cx="0" cy="0" r="19"/><path class="symbol-line" d="M-11 0H11M5-6l6 6-6 6"/><text class="controlled-pin-label" x="-35" y="-7">p</text><text class="controlled-pin-label" x="28" y="-7">n</text>`;
    if (component.type === "CCCS" || component.type === "CCVS") symbol = `<path class="lead" d="M-40 0H-24M24 0H40"/><path class="body" d="M-24 0L0-24 24 0 0 24Z"/>${component.type === "CCCS" ? `<path class="symbol-line" d="M-11 0H11M5-6l6 6-6 6"/>` : `<path class="symbol-line" d="M-14 0h8M-10-4v8M6 0h8"/>`}<text class="controlled-pin-label" x="-35" y="-7">p</text><text class="controlled-pin-label" x="28" y="-7">n</text>`;
    if (magnetic) symbol = magneticSymbolMarkup(component);
    const pins = Array.from({ length: pinCount(component.type) }, (_, pin) => {
      const pos = localPin(component.type, pin);
      const pending = state.pendingPin?.componentId === component.id && state.pendingPin?.pin === pin ? " pending" : "";
      const target = state.pendingPin && !pending ? " target" : "";
      const probe = state.probes.find((item) => item.kind === "voltage" && item.componentId === component.id && item.pin === pin);
      const portP = state.port.p?.componentId === component.id && state.port.p?.pin === pin ? " port-p" : "";
      const portN = state.port.n?.componentId === component.id && state.port.n?.pin === pin ? " port-n" : "";
      const probed = probe ? " probed" : "";
      const color = probe ? ` style="--probe-color:${traceColor(probe.color)}"` : "";
      return `<circle class="pin-hit" data-pin="${pin}" cx="${pos.x}" cy="${pos.y}" r="4"/><circle class="pin${pending}${target}${probed}${portP}${portN}" data-pin="${pin}" cx="${pos.x}" cy="${pos.y}" r="4"${color}/><text class="pin-number" x="${pos.x + 6}" y="${pos.y - 6}">${pin + 1}</text>`;
    }).join("");
    const selected = isSelected(state, "component", component.id) ? " selected" : "";
    // A magnetic part can carry one current probe per winding; every other part has at most one.
    const currentProbes = state.probes.filter((item) => item.kind === "current" && item.componentId === component.id);
    const probe = currentProbes[0];
    const probed = probe ? " probed" : "";
    const color = probe ? ` style="--probe-color:${traceColor(probe.color)}"` : "";
    const directionMarkup = currentProbes.map((item) => {
      const direction = currentDirectionDescriptor(component, geometryVersion, item.winding);
      const arrow = currentArrowGeometry(direction);
      return arrow
        ? `<g class="current-direction" aria-hidden="true"><title>${escapeHtml(direction.label)} · 양수 기준</title><line x1="${arrow.start.x}" y1="${arrow.start.y}" x2="${arrow.end.x}" y2="${arrow.end.y}"/><path d="M${arrow.head.map(point => `${point.x} ${point.y}`).join("L")}Z"/></g>`
        : "";
    }).join("");
    const connectionStatus = connection?.status ?? "solver-check";
    const badgeRotation = -Number(component.rotation ?? 0);
    const connectionMarkup = connectionStatus !== "referenced" ? `<rect class="connection-halo status-${escapeHtml(connectionStatus)}" x="-47" y="-47" width="94" height="94" rx="3"/><g class="connection-badge status-${escapeHtml(connectionStatus)}" data-show-connection="${escapeHtml(component.id)}" role="button" tabindex="0" aria-label="${ref} 연결 상태 보기" transform="translate(-35 -34) rotate(${badgeRotation})"><title>${escapeHtml(connection?.label ?? "연결 상태 보기")} · 클릭하여 설명</title><circle r="11"/><text y="4">${escapeHtml(connection?.badge ?? "?")}</text></g>` : "";
    // The delete badge belongs to a single selected part; with several selected the inspector offers the group actions.
    const deleteMarkup = selected && selectedKeys(state).size === 1 ? deleteButtonMarkup(component) : "";
    const upright = -Number(component.rotation ?? 0);
    const vertical = Math.abs(Math.sin(Number(component.rotation ?? 0) * Math.PI / 180)) > .7;
    const labelX = vertical ? 30 : 0;
    const labelY = vertical ? -7 : -29;
    const valueY = vertical ? 12 : 35;
    const anchor = vertical ? "start" : "middle";
    const modeMarkup = ["V", "I"].includes(component.type) && !sourceDescriptor ? `<text class="source-mode-label" x="${labelX}" y="${valueY + 16}" style="text-anchor:${anchor}">${escapeHtml(mode)}</text>` : "";
    const labels = `<g class="upright-labels" transform="rotate(${upright})"><text class="label" x="${labelX}" y="${labelY}" style="text-anchor:${anchor}">${ref}</text>${value ? `<text class="value-label" data-edit-prop="${escapeHtml(editProp)}" x="${labelX}" y="${valueY}" style="text-anchor:${anchor}">${value}</text>` : ""}${modeMarkup}</g>`;
    return `<g class="component${selected}${probed}" data-id="${escapeHtml(component.id)}" data-connection-status="${escapeHtml(connectionStatus)}" aria-label="${ref}: ${escapeHtml(connection?.label ?? "상태 확인 필요")}" transform="${componentTransform(component)}"${color}>${connectionMarkup}<path class="component-hit" d="M-30 0H30"/>${symbol}${pins}${directionMarkup}${labels}${deleteMarkup}</g>`;
  }

  /**
   * Where a wire endpoint sits. Callers that resolve many endpoints pass the id lookups they built once (`componentById`, `junctionById`);
   * a single lookup without them scans the circuit instead of building maps for one answer.
   */
  function endpointPosition(endpoint, componentById = null, junctionById = null) {
    if (endpoint?.junctionId !== undefined) {
      const junction = junctionById ? junctionById.get(endpoint.junctionId) : (state.circuit.junctions ?? []).find((item) => item.id === endpoint.junctionId);
      return junction ? { x: junction.x, y: junction.y } : null;
    }
    const component = componentById ? componentById.get(endpoint?.componentId) : state.circuit.components.find((item) => item.id === endpoint?.componentId);
    return component ? pinPosition(component, endpoint.pin) : null;
  }

  const junctionLookup = () => new Map((state.circuit.junctions ?? []).map((junction) => [junction.id, junction]));

  function wireRoute(wire, a, b) {
    return routeWirePoints(wire, a, b, circuitGeometryVersion(state.circuit));
  }

  /** Clicked bend points joined by plain L legs (how a wire was drawn before automatic routing; still used off the grid). */
  function legacyLegs(start, anchors) {
    let points = [];
    for (const anchor of anchors) points = appendFixedWaypoint(start, points, anchor);
    return points;
  }

  // What the preview route keeps clear of, built once per half-drawn wire (the circuit does not change while a wire is pending).
  let routingCache = null;
  function previewContext() {
    const key = [state.pendingPin, state.circuit, state.circuit.components.length, state.circuit.wires.length, (state.circuit.junctions ?? []).length];
    if (!routingCache || routingCache.key.some((value, index) => value !== key[index])) routingCache = { key, context: createRoutingContext(state.circuit) };
    return routingCache.context;
  }

  function renderOverlay(componentById = new Map(state.circuit.components.map((component) => [component.id, component]))) {
    if (overlayFrame !== null) { cancelAnimationFrame(overlayFrame); overlayFrame = null; }
    const endpointCounts = new Map();
    const endpointByKey = new Map();
    for (const wire of state.circuit.wires) {
      for (const end of [wire.a, wire.b]) {
        const key = endpointKey(end);
        endpointCounts.set(key, (endpointCounts.get(key) ?? 0) + 1);
        endpointByKey.set(key, end);
      }
    }
    const junctions = [];
    for (const [key, count] of endpointCounts) {
      const end = endpointByKey.get(key);
      if (count < 2 || end.junctionId !== undefined) continue;
      const { componentId, pin } = end;
      const component = componentById.get(componentId);
      if (!component) continue;
      const position = pinPosition(component, Number(pin));
      junctions.push(`<circle class="junction" data-jp="${escapeHtml(componentId)}:${escapeHtml(pin)}" cx="${position.x}" cy="${position.y}" r="5"/>`);
    }
    for (const junction of state.circuit.junctions ?? []) {
      const selected = isSelected(state, "junction", junction.id) ? " selected" : "";
      const pending = state.pendingPin && state.pendingPin.junctionId !== junction.id ? " target" : "";
      const portP = state.port.p?.junctionId === junction.id ? " port-p" : "";
      const portN = state.port.n?.junctionId === junction.id ? " port-n" : "";
      junctions.push(`<g data-junction-id="${escapeHtml(junction.id)}"><circle class="junction-hit" cx="${junction.x}" cy="${junction.y}" r="5"/><circle class="junction${selected}${pending}${portP}${portN}" cx="${junction.x}" cy="${junction.y}" r="6"/></g>`);
    }
    if (state.pendingPin && state.pointer) {
      const start = endpointPosition(state.pendingPin, componentById, junctionLookup());
      if (start) {
        const target = snapPoint(state.pointer);
        // The route the finished wire will get (wire-router), live under the pointer: solid up to the last clicked point, then dashed.
        // An off-grid drawing (old geometry) cannot be routed and shows the clicked points joined by plain L legs as before.
        const routed = previewRoute(state.circuit, state.pendingPin, state.pendingWaypoints, target, previewContext());
        const fixed = routed ? routed.fixed : normalizePoints([start, ...legacyLegs(start, state.pendingWaypoints)]);
        if (fixed.length > 1) junctions.push(`<path class="wire-preview-fixed" d="${polylinePath(fixed)}"/>`);
        const current = fixed.at(-1) ?? start;
        const live = routed ? routed.live : [current, ...orthogonalLeg(current, target)];
        junctions.push(`<path class="wire-preview" d="${polylinePath(live)}"/>`);
      }
    }
    elements["overlay-layer"].innerHTML = junctions.join("");
    stats.overlay += 1;
  }

  function renderCanvas() {
    if (!workspace.circuitActive) { workspace.renderDeferred = true; return; }
    cancelDragUpdate(); // a full render supersedes a queued cheap update
    const componentById = new Map(state.circuit.components.map((component) => [component.id, component]));
    let connection, connectionError = false;
    try { connection = currentConnections(); }
    catch { connectionError = true; connection = { byComponent: {}, counts: {} }; }
    const junctionById = junctionLookup();
    elements["wire-layer"].innerHTML = state.circuit.wires.map((wire) => {
      const a = endpointPosition(wire.a, componentById, junctionById);
      const b = endpointPosition(wire.b, componentById, junctionById);
      if (!a || !b) return "";
      const points = wireRoute(wire, a, b);
      const path = polylinePath(points);
      const selected = isSelected(state, "wire", wire.id) ? " selected" : "";
      const probe = state.probes.find((item) => item.kind === "voltage" && item.wireId === wire.id);
      const probed = probe ? " probed" : "";
      const color = probe ? ` style="--probe-color:${traceColor(probe.color)}"` : "";
      return `<g data-wire-id="${escapeHtml(wire.id)}"><path class="wire${selected}${probed}" d="${path}"${color}/><path class="wire-hit" d="${path}"/></g>`;
    }).join("");
    elements["component-layer"].innerHTML = state.circuit.components.map((component) => componentMarkup(component, connection.byComponent[component.id])).join("");
    renderOverlay(componentById);
    elements["circuit-canvas"].setAttribute("viewBox", `${state.canvasView.x} ${state.canvasView.y} ${state.canvasView.width} ${state.canvasView.height}`);
    elements["circuit-canvas"].dataset.canvasTool = state.tool.startsWith("place:") ? "place" : state.tool;
    elements["circuit-canvas"].dataset.wiring = state.pendingPin || state.port.mode ? "1" : "0";
    syncHitSizes();
    elements["empty-hint"].classList.toggle("hidden", state.circuit.components.length > 0);
    elements["circuit-count"].textContent = `부품 ${state.circuit.components.length} · 배선 ${state.circuit.wires.length}`;
    const warningCount = (connection.counts.unwired ?? 0) + (connection.counts["no-ground"] ?? 0) + (connection.counts["analysis-floating"] ?? 0) + (connection.counts["solver-check"] ?? 0);
    // Connection state only; the run state lives in the single status chip and never shows another analysis type.
    elements["connection-summary"].textContent = state.circuit.components.length === 0
      ? ""
      : connectionError ? "연결 검사 실패 · 제어 참조와 회로 입력을 확인하세요"
      : warningCount
        ? `접속 주의 ${warningCount}`
        : "✓ GND 기준 경로";
    elements["connection-summary"].classList.toggle("has-warning", warningCount > 0 || connectionError);
    elements["connection-summary"].classList.toggle("has-error", state.runState.status === "error");
    elements["connection-summary"].classList.toggle("has-stale", state.runState.status === "stale");
    elements["canvas-title"].textContent = state.title;
    elements["canvas-subtitle"].textContent = state.subtitle;
    stats.full += 1;
    afterCanvasRender?.();
  }

  const wireGroup = (id) => elements["wire-layer"].querySelector(`[data-wire-id="${CSS.escape(id)}"]`);

  /**
   * Cheap drag frame for any set of moved parts/junctions. Returns false when the expected DOM is missing so the caller can do a
   * full render instead. Writes exactly the attributes a full render would write for the same state.
   */
  function updateMoved({ components: componentIds = [], junctions: junctionIds = [] }) {
    const movedComponents = new Set(componentIds), movedJunctions = new Set(junctionIds);
    const componentById = new Map(state.circuit.components.map((component) => [component.id, component]));
    const junctionById = junctionLookup();
    for (const id of movedComponents) {
      const component = componentById.get(id);
      const group = elements["component-layer"].querySelector(`.component[data-id="${CSS.escape(id)}"]`);
      if (!component || !group) return false;
      group.setAttribute("transform", componentTransform(component));
      for (let pin = 0; pin < pinCount(component.type); pin += 1) {
        const dot = elements["overlay-layer"].querySelector(`[data-jp="${CSS.escape(id)}:${pin}"]`);
        if (!dot) continue;
        const position = pinPosition(component, pin);
        dot.setAttribute("cx", position.x);
        dot.setAttribute("cy", position.y);
      }
    }
    for (const id of movedJunctions) {
      const junction = junctionById.get(id);
      const group = elements["overlay-layer"].querySelector(`[data-junction-id="${CSS.escape(id)}"]`);
      if (!junction || !group) return false;
      for (const circle of group.querySelectorAll("circle")) { circle.setAttribute("cx", junction.x); circle.setAttribute("cy", junction.y); }
    }
    const touches = (end) => (end?.junctionId !== undefined ? movedJunctions.has(end.junctionId) : movedComponents.has(end?.componentId));
    for (const wire of state.circuit.wires) {
      if (!touches(wire.a) && !touches(wire.b)) continue;
      const group = wireGroup(wire.id);
      const a = endpointPosition(wire.a, componentById, junctionById);
      const b = endpointPosition(wire.b, componentById, junctionById);
      if (!group || !a || !b) return false;
      const path = polylinePath(wireRoute(wire, a, b));
      for (const line of group.querySelectorAll("path")) line.setAttribute("d", path);
    }
    stats.drag += 1;
    onDragFrame?.();
    return true;
  }

  /** Marquee rectangle while a Shift+drag box selection is in progress (rect in world coordinates); null hides it. */
  function setMarquee(rect) {
    const node = elements["marquee-rect"];
    if (!node) return;
    node.classList.toggle("hidden", !rect);
    if (!rect) return;
    node.setAttribute("x", rect.x0); node.setAttribute("y", rect.y0);
    node.setAttribute("width", rect.x1 - rect.x0); node.setAttribute("height", rect.y1 - rect.y0);
  }

  /** Selection change without a rebuild: toggle `selected` classes and the delete button of a single selected part. */
  function applySelection() {
    stats.selection += 1;
    const keys = selectedKeys(state);
    const single = keys.size === 1;
    for (const group of elements["component-layer"].querySelectorAll(".component")) {
      const on = keys.has(`component:${group.dataset.id}`);
      const probed = group.classList.contains("probed") ? " probed" : "";
      group.setAttribute("class", `component${on ? " selected" : ""}${probed}`);
      const button = group.querySelector(".component-delete");
      const wantButton = on && single;
      if (wantButton && !button) {
        const component = state.circuit.components.find((item) => item.id === group.dataset.id);
        if (component) group.insertAdjacentHTML("beforeend", deleteButtonMarkup(component));
      } else if (!wantButton && button) button.remove();
    }
    for (const group of elements["wire-layer"].querySelectorAll("[data-wire-id]")) {
      const line = group.querySelector(".wire");
      if (!line) continue;
      const on = keys.has(`wire:${group.dataset.wireId}`);
      line.setAttribute("class", `wire${on ? " selected" : ""}${line.classList.contains("probed") ? " probed" : ""}`);
    }
    // Junction dots carry several state classes; their markup is small, so rebuild just that layer when one is involved.
    if ([...keys].some((key) => key.startsWith("junction:")) || elements["overlay-layer"].querySelector(".junction.selected")) renderOverlay();
  }

  function routeForWireId(wireId) {
    const wire = state.circuit.wires.find((item) => item.id === wireId);
    if (!wire) return [];
    const a = endpointPosition(wire.a);
    const b = endpointPosition(wire.b);
    return a && b ? wireRoute(wire, a, b) : [];
  }

  /** Route points of every drawable wire, by wire id (used by the current-flow overlay). */
  function wireRoutes() {
    const componentById = new Map(state.circuit.components.map((component) => [component.id, component]));
    const junctionById = junctionLookup();
    const routes = new Map();
    for (const wire of state.circuit.wires) {
      const a = endpointPosition(wire.a, componentById, junctionById);
      const b = endpointPosition(wire.b, componentById, junctionById);
      if (a && b) routes.set(wire.id, wireRoute(wire, a, b));
    }
    return routes;
  }

  return { updateCanvasView, scheduleOverlayRender, scheduleDragUpdate, cancelDragUpdate, setMarquee, applySelection, renderCanvas, renderOverlay, endpointPosition, pinPosition, routeForWireId, wireRoutes, stats };
}
