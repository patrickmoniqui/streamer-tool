export const FOCUS_ROTATION_MS = 3_200;
export const FOCUS_HOLD_MS = 900;
export const FOCUS_RESUME_MS = 2_000;

function ease(progress: number): number {
  return progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
}

export function getGlobeFocusCameraDistance(baseDistance: number, elapsed: number, zoom: boolean): number {
  if (!zoom || elapsed <= 0) return baseDistance;
  const zoomDistance = Math.min(baseDistance, Math.max(1.5, baseDistance * 0.72));
  if (elapsed < FOCUS_ROTATION_MS) {
    return baseDistance + (zoomDistance - baseDistance) * ease(elapsed / FOCUS_ROTATION_MS);
  }
  if (elapsed <= FOCUS_ROTATION_MS + FOCUS_HOLD_MS) return zoomDistance;
  const progress = (elapsed - FOCUS_ROTATION_MS - FOCUS_HOLD_MS) / FOCUS_RESUME_MS;
  if (progress >= 1) return baseDistance;
  return zoomDistance + (baseDistance - zoomDistance) * ease(progress);
}
