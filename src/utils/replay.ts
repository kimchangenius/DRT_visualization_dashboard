import type { SimulationState } from '../types/simulation';

export function frameAtOrBefore(frames: SimulationState[], time: number): SimulationState | null {
  if (frames.length === 0 || time < frames[0].metrics.currentTime) return null;

  let selected = frames[0];
  for (const frame of frames) {
    if (frame.metrics.currentTime <= time) {
      selected = frame;
    } else {
      break;
    }
  }
  return selected;
}

export function framesBetween(frames: SimulationState[], startTime: number, endTime: number): SimulationState[] {
  return frames.filter(frame => {
    const time = frame.metrics.currentTime;
    return time >= startTime && time <= endTime;
  });
}
