export function getWsUrl(): string {
  const fromEnv = import.meta.env.VITE_WS_URL;
  if (fromEnv) return fromEnv;
  if (typeof window !== 'undefined') {
    return window.location.origin;
  }
  return 'http://localhost:5001';
}

export const THROTTLE_MS = 100;

export const CHART_ANIMATION_DURATION_MS = 75;
