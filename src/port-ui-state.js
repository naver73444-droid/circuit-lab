/** Isolated port result invalidation; no DOM, worker or solver dependency. */
export function refreshInvalidatedPortPanel(job, portState, renderPanel) {
  if (job?.kind !== "port") return false;
  portState.error = null;
  if (portState.result) portState.stale = true;
  renderPanel();
  return true;
}

