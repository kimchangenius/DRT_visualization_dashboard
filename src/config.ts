import { schemeDark2, schemeSet2, schemeTableau10 } from 'd3-scale-chromatic';

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


export const RESULT_A_COLOR = '#f59e0b';
export const RESULT_B_COLOR = '#3b82f6';

// ColorBrewer Dark2: vehicle states define the semantic color source.
export const VEHICLE_STATUS_COLORS = {
  idle: 'transparent',
  picking_up: schemeDark2[1],
  carrying: schemeDark2[0],
} as const;

export const REQUEST_EVENT_COLORS = {
  pickup: VEHICLE_STATUS_COLORS.picking_up,
  dropoff: VEHICLE_STATUS_COLORS.carrying,
} as const;

// ColorBrewer Set1: outcomes remain distinct from pickup/drop-off event hues.
export const REQUEST_OUTCOME_COLORS = {
  accepted: '#377eb8',
  pending: '#999999',
  cancelled: '#e41a1c',
} as const;

// D3 categorical schemes: Tableau10 for map entities and ColorBrewer Set2
// for candidate-feasibility categories. Array positions are kept explicit so
// the same semantic category retains its hue across linked views.
export const CANCELLATION_ANALYSIS_COLORS = {
  vehicle: {
    idle: schemeTableau10[0],
    picking_up: VEHICLE_STATUS_COLORS.picking_up,
    carrying: VEHICLE_STATUS_COLORS.carrying,
  },
  request: {
    waiting: schemeTableau10[5],
    selected: schemeTableau10[2],
  },
  decision: {
    pickup: REQUEST_EVENT_COLORS.pickup,
    dropoff: REQUEST_EVENT_COLORS.dropoff,
    wait: schemeTableau10[8],
  },
  feasibility: {
    inService: schemeSet2[2],
    constraintBlocked: schemeSet2[1],
    assignable: schemeSet2[4],
  },
} as const;
