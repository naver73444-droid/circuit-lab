import { norm3, scale3, sub3 } from './em-physics.js';

export function cameraEye(camera) {
  return [
    camera.distance * Math.cos(camera.pitch) * Math.cos(camera.yaw),
    camera.distance * Math.cos(camera.pitch) * Math.sin(camera.yaw),
    camera.distance * Math.sin(camera.pitch),
  ];
}

export function screenRay(rect, clientX, clientY, camera) {
  if (!rect?.width || !rect?.height) return null;
  const eye = cameraEye(camera);
  const forwardLength = Math.hypot(...eye);
  if (!Number.isFinite(forwardLength) || forwardLength === 0) return null;
  const forward = scale3(eye, -1 / forwardLength);
  // Must match em-view.lookAt(): with forward = -z, its screen-right basis is
  // x = [-z.y, z.x, 0] = [forward.y, -forward.x, 0].
  let right = [forward[1], -forward[0], 0];
  const rightLength = Math.hypot(...right);
  right = rightLength > 1e-12 ? scale3(right, 1 / rightLength) : [1, 0, 0];
  const up = [
    right[1] * forward[2] - right[2] * forward[1],
    right[2] * forward[0] - right[0] * forward[2],
    right[0] * forward[1] - right[1] * forward[0],
  ];
  const ndcX = 2 * (clientX - rect.left) / rect.width - 1;
  const ndcY = 1 - 2 * (clientY - rect.top) / rect.height;
  const tanHalfFov = Math.tan(Math.PI / 8);
  const direction = [
    forward[0] + right[0] * ndcX * tanHalfFov * rect.width / rect.height + up[0] * ndcY * tanHalfFov,
    forward[1] + right[1] * ndcX * tanHalfFov * rect.width / rect.height + up[1] * ndcY * tanHalfFov,
    forward[2] + right[2] * ndcX * tanHalfFov * rect.width / rect.height + up[2] * ndcY * tanHalfFov,
  ];
  const length = norm3(direction);
  return length > 1e-12 && Number.isFinite(length) ? { origin: eye, direction: scale3(direction, 1 / length) } : null;
}

export function intersectEditingPlane(ray, plane, fixedCoordinate) {
  if (!ray || !['xy', 'xz', 'yz'].includes(plane) || !Number.isFinite(fixedCoordinate)) return null;
  const axis = plane === 'xy' ? 2 : plane === 'xz' ? 1 : 0;
  const denominator = ray.direction[axis];
  if (!Number.isFinite(denominator) || Math.abs(denominator) < 1e-7) return null;
  const distance = (fixedCoordinate - ray.origin[axis]) / denominator;
  if (!Number.isFinite(distance) || distance <= 0) return null;
  const point = ray.origin.map((value, index) => value + distance * ray.direction[index]);
  return point.every(Number.isFinite) ? point : null;
}

export function projectedDistance(ray, point) {
  if (!ray) return Infinity;
  const delta = sub3(point, ray.origin);
  const along = delta[0] * ray.direction[0] + delta[1] * ray.direction[1] + delta[2] * ray.direction[2];
  if (along <= 0) return Infinity;
  const nearest = ray.origin.map((value, index) => value + along * ray.direction[index]);
  return norm3(sub3(point, nearest));
}

const NORMAL_AXIS = { xy: 2, xz: 1, yz: 0 };

/**
 * A grab of a handle in the editing plane, fixed at pointerdown. The plane passes through the grabbed handle (its normal
 * coordinate is `constant`), not through the source's centre, and the whole gesture keeps using it: a finite-line end point
 * that sits off the centre's plane would otherwise jump by the difference at the first move. Null when the ray misses.
 */
export function beginPlaneGrab(ray, plane, handlePosition) {
  const constant = handlePosition[NORMAL_AXIS[plane]], hit = intersectEditingPlane(ray, plane, constant);
  if (!hit) return null;
  return { plane, normal: NORMAL_AXIS[plane], constant, offset: handlePosition.map((value, i) => value - hit[i]) };
}

/** Where the grabbed handle goes for `ray`: the ray's hit on the grab's plane plus the pointerdown offset, or null. */
export function grabTarget(grab, ray) {
  const hit = grab ? intersectEditingPlane(ray, grab.plane, grab.constant) : null;
  return hit ? hit.map((value, i) => value + grab.offset[i]) : null;
}
