export function getWsUrl(): string {
  const fromEnv = import.meta.env.VITE_WS_URL;
  if (fromEnv) return fromEnv;
  if (typeof window !== 'undefined') {
    return window.location.origin;
  }
  return 'http://localhost:5001';
}

export const PLAYBACK_INTERVAL_MS = 1000;

export const CHART_ANIMATION_DURATION_MS = Math.round(PLAYBACK_INTERVAL_MS * 0.75);
