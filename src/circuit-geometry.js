export const GRID_SIZE = 20;
export const CURRENT_GEOMETRY_VERSION = 2;

export function circuitGeometryVersion(circuit) {
  return circuit?.geometryVersion === CURRENT_GEOMETRY_VERSION ? CURRENT_GEOMETRY_VERSION : 1;
}

export function snapCoordinate(value, spacing = GRID_SIZE) {
  return Math.round(Number(value) / spacing) * spacing;
}

export function snapPoint(point, spacing = GRID_SIZE) {
  return { x: snapCoordinate(point.x, spacing), y: snapCoordinate(point.y, spacing) };
}

export function pointsEqual(first, second, tolerance = 1e-9) {
  return Boolean(first && second) && Math.abs(first.x - second.x) <= tolerance && Math.abs(first.y - second.y) <= tolerance;
}

export function normalizePoints(points) {
  const normalized = [];
  for (const point of points) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    const copy = { x: point.x, y: point.y };
    if (!pointsEqual(normalized.at(-1), copy)) normalized.push(copy);
  }
  return normalized;
}

export function localPin(type, pin, geometryVersion = CURRENT_GEOMETRY_VERSION) {
  if (type === "VCVS" || type === "VCCS") return [{ x: -40, y: 0 }, { x: 40, y: 0 }, { x: 0, y: -40 }, { x: 0, y: 40 }][pin];
  if (["CURRENT_SENSOR", "CCCS", "CCVS"].includes(type)) return pin === 0 ? { x: -40, y: 0 } : { x: 40, y: 0 };
  if (geometryVersion === 1) {
    if (type === "GND") return { x: 0, y: -28 };
    if (type === "OPAMP" || type === "OPAMP_IDEAL") return [{ x: -45, y: -18 }, { x: -45, y: 18 }, { x: 45, y: 0 }][pin];
  } else {
    if (type === "GND") return { x: 0, y: -40 };
    if (type === "OPAMP" || type === "OPAMP_IDEAL") return [{ x: -40, y: -20 }, { x: -40, y: 20 }, { x: 40, y: 0 }][pin];
  }
  return pin === 0 ? { x: -40, y: 0 } : { x: 40, y: 0 };
}

export function pinPosition(component, pin, geometryVersion = CURRENT_GEOMETRY_VERSION) {
  const local = localPin(component.type, pin, geometryVersion);
  const angle = ((component.rotation ?? 0) * Math.PI) / 180;
  return {
    x: component.x + local.x * Math.cos(angle) - local.y * Math.sin(angle),
    y: component.y + local.x * Math.sin(angle) + local.y * Math.cos(angle),
  };
}

export function orthogonalLeg(from, to) {
  if (pointsEqual(from, to)) return [];
  if (Math.abs(from.x - to.x) <= 1e-9 || Math.abs(from.y - to.y) <= 1e-9) return [{ x: to.x, y: to.y }];
  return normalizePoints([{ x: to.x, y: from.y }, { x: to.x, y: to.y }]);
}

export function appendFixedWaypoint(start, waypoints, target) {
  const current = waypoints.at(-1) ?? start;
  return normalizePoints([...waypoints, ...orthogonalLeg(current, target)]);
}

function automaticRoute(a, b, spacing) {
  if (Math.abs(a.x - b.x) < 2 || Math.abs(a.y - b.y) < 2) return normalizePoints([a, b]);
  const middleX = snapCoordinate((a.x + b.x) / 2, spacing);
  return normalizePoints([a, { x: middleX, y: a.y }, { x: middleX, y: b.y }, b]);
}

export function routeWirePoints(wire, a, b, geometryVersion = CURRENT_GEOMETRY_VERSION) {
  const fixed = Array.isArray(wire?.waypoints) ? normalizePoints(wire.waypoints) : [];
  if (!fixed.length) {
    const spacing = geometryVersion === 1 && wire?.waypoints === undefined ? 10 : GRID_SIZE;
    return automaticRoute(a, b, spacing);
  }
  return normalizePoints([
    a,
    ...orthogonalLeg(a, fixed[0]),
    ...fixed.slice(1),
    ...orthogonalLeg(fixed.at(-1), b),
  ]);
}

export function polylinePath(points) {
  const normalized = normalizePoints(points);
  if (!normalized.length) return "";
  return normalized.map((point, index) => `${index ? "L" : "M"}${point.x} ${point.y}`).join("");
}

export function closestSegmentIndex(points, target) {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < points.length - 1; index += 1) {
    const a = points[index];
    const b = points[index + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    const fraction = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((target.x - a.x) * dx + (target.y - a.y) * dy) / lengthSquared));
    const x = a.x + fraction * dx;
    const y = a.y + fraction * dy;
    const distance = Math.hypot(target.x - x, target.y - y);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return bestIndex;
}

export function splitRouteWaypoints(points, target) {
  const normalized = normalizePoints(points);
  const index = closestSegmentIndex(normalized, target);
  return {
    segmentIndex: index,
    first: normalizePoints(normalized.slice(1, index + 1)),
    second: normalizePoints(normalized.slice(index + 1, -1)),
  };
}

export function projectSplitPoint(points, target, geometryVersion = CURRENT_GEOMETRY_VERSION) {
  const normalized = normalizePoints(points);
  if (normalized.length < 2 || !Number.isFinite(target?.x) || !Number.isFinite(target?.y)) throw new RangeError("분할할 유효한 배선 경로가 없습니다.");
  const segmentIndex = closestSegmentIndex(normalized, target);
  const a = normalized[segmentIndex];
  const b = normalized[segmentIndex + 1];
  const clamp = (value, first, second) => Math.max(Math.min(first, second), Math.min(Math.max(first, second), value));
  let point;
  if (Math.abs(a.y - b.y) <= 1e-9) point = { x: clamp(snapCoordinate(target.x), a.x, b.x), y: a.y };
  else if (Math.abs(a.x - b.x) <= 1e-9) point = { x: a.x, y: clamp(snapCoordinate(target.y), a.y, b.y) };
  else point = snapPoint(target);
  if (geometryVersion === CURRENT_GEOMETRY_VERSION) point = snapPoint(point);
  return { point, segmentIndex };
}
