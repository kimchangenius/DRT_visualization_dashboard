import type { SimulationState } from '../types/simulation';

export function compactReplayFrame(frame: SimulationState): SimulationState {
  return {
    ...frame,
    vehicleMovementEvents: [],
    dispatchDecisionEvents: [],
    utilizationHistory: [],
    passengerHistory: [],
    requestStatusData: [],
  };
}

export function frameAtOrBefore(frames: SimulationState[], time: number): SimulationState | null {
  if (
    frames.length === 0 ||
    !Number.isFinite(time) ||
    time < frames[0].metrics.currentTime
  ) {
    return null;
  }

  let low = 0;
  let high = frames.length - 1;
  let selectedIndex = 0;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (frames[middle].metrics.currentTime <= time) {
      selectedIndex = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return frames[selectedIndex];
}

export function framesBetween(frames: SimulationState[], startTime: number, endTime: number): SimulationState[] {
  if (
    frames.length === 0 ||
    !Number.isFinite(startTime) ||
    !Number.isFinite(endTime) ||
    endTime < startTime
  ) {
    return [];
  }

  let low = 0;
  let high = frames.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (frames[middle].metrics.currentTime < startTime) low = middle + 1;
    else high = middle;
  }
  const startIndex = low;

  low = startIndex;
  high = frames.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (frames[middle].metrics.currentTime <= endTime) low = middle + 1;
    else high = middle;
  }
  return frames.slice(startIndex, low);
}
