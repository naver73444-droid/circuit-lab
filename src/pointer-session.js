export function beginPointerSession(active, pointerId, payload) {
  if (active || !Number.isInteger(pointerId)) return active;
  return { ...payload, pointerId, finished: false };
}

export function ownsPointer(session, pointerId) {
  return Boolean(session && !session.finished && session.pointerId === pointerId);
}

export function finishPointerSession(session, pointerId, reason = "commit") {
  if (!ownsPointer(session, pointerId)) return { session, finished: null };
  return { session: null, finished: { ...session, finished: true, reason } };
}
