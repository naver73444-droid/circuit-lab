// Pure elapsed-time mapping. Discrete time is never interpolated into a result.
export function playbackCursor(start,elapsedMs,domain,speed,discrete=false){
  const amount=Math.max(0,elapsedMs)/1000*speed*(discrete?2:(domain.max-domain.min)/12);
  return Math.min(domain.max,Math.max(domain.min,start+(discrete?Math.floor(amount):amount)));
}
