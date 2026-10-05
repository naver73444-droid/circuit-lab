import { CURRENT_GEOMETRY_VERSION, localPin } from "./circuit-geometry.js";

const OUTPUT_PN_TYPES = new Set(["VCVS", "VCCS", "CURRENT_SENSOR", "CCCS", "CCVS"]);
const OPAMP_TYPES = new Set(["OPAMP", "OPAMP_IDEAL"]);

export function currentDirectionDescriptor(component, geometryVersion = CURRENT_GEOMETRY_VERSION) {
  if (!component || component.type === "GND") return null;
  if (OPAMP_TYPES.has(component.type)) {
    const output = localPin(component.type, 2, geometryVersion);
    return {
      kind: "output-reference",
      label: component.type === "OPAMP_IDEAL" ? "출력→내부 기준 GND" : "출력→기준",
      from: output,
      to: { x: output.x * 0.3, y: output.y * 0.3 },
      fromPin: 2,
      toPin: null,
    };
  }
  return {
    kind: "pin-pair",
    label: OUTPUT_PN_TYPES.has(component.type) ? "p→n (pin 1→2)" : "pin 1→2",
    from: localPin(component.type, 0, geometryVersion),
    to: localPin(component.type, 1, geometryVersion),
    fromPin: 0,
    toPin: 1,
  };
}

export function currentProbeLabel(component, geometryVersion = CURRENT_GEOMETRY_VERSION) {
  const direction = currentDirectionDescriptor(component, geometryVersion);
  if (!direction) return "";
  return `I(${component.props?.ref ?? component.id}, ${direction.label})`;
}

export function currentArrowGeometry(direction) {
  if (!direction?.from || !direction?.to) return null;
  const dx = direction.to.x - direction.from.x;
  const dy = direction.to.y - direction.from.y;
  const length = Math.hypot(dx, dy);
  if (!Number.isFinite(length) || length < 1) return null;
  const ux = dx / length, uy = dy / length;
  const nx = -uy, ny = ux;
  const padding = direction.kind === "output-reference" ? 2 : 11;
  const offset = direction.kind === "output-reference" ? -15 : -23;
  const start = { x: direction.from.x + ux * padding + nx * offset, y: direction.from.y + uy * padding + ny * offset };
  const end = { x: direction.to.x - ux * padding + nx * offset, y: direction.to.y - uy * padding + ny * offset };
  const headLength = 7, headWidth = 5;
  return {
    start,
    end,
    head: [
      end,
      { x: end.x - ux * headLength + nx * headWidth, y: end.y - uy * headLength + ny * headWidth },
      { x: end.x - ux * headLength - nx * headWidth, y: end.y - uy * headLength - ny * headWidth },
    ],
  };
}

export function directionWorldEndpoints(component, geometryVersion = CURRENT_GEOMETRY_VERSION) {
  const direction = currentDirectionDescriptor(component, geometryVersion);
  if (!direction) return null;
  const angle = Number(component.rotation ?? 0) * Math.PI / 180;
  const transform = point => ({
    x: component.x + point.x * Math.cos(angle) - point.y * Math.sin(angle),
    y: component.y + point.x * Math.sin(angle) + point.y * Math.cos(angle),
  });
  return { from: transform(direction.from), to: transform(direction.to) };
}

export function currentDirectionGuide(analysis) {
  const base = "화살표는 양의 전류 기준 · 음수는 반대 방향 · 0 A는 방향 미확정";
  return analysis === "ac" ? `${base} · AC는 페이저 기준 방향` : base;
}
