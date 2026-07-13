import { useMemo, useState } from 'react';
import { links, nodeMap, nodes } from '../data/siouxFallsNetwork';
import type { SimulationState, Vehicle, VehicleStatus } from '../types/simulation';
import {
  densityQuartiles,
  estimateScottBandwidth,
  gaussianIntensity,
  kernelDisplayRadius,
  quartileHeatColor,
  type WeightedSpatialPoint,
} from '../utils/spatialKde';

interface VehicleOperationMapProps {
  title?: string;
  contextLabel?: string;
  frames: SimulationState[];
  startTime?: number;
  currentTime: number;
  comparisonFrames?: SimulationState[];
  comparisonStartTime?: number;
  comparisonCurrentTime?: number;
  comparisonFocusVehicleId?: number | null;
  statusVisibility?: Record<OperationHeatStatus, boolean>;
  onStatusVisibilityChange?: (visibility: Record<OperationHeatStatus, boolean>) => void;
  focusVehicleId?: number | null;
  embedded?: boolean;
  hideTitle?: boolean;
}

export type OperationHeatStatus = Extract<VehicleStatus, 'picking_up' | 'carrying'>;
type ActivityHeatStatus = Extract<VehicleStatus, 'idle' | 'picking_up' | 'carrying'>;

interface VehicleActivityCell {
  key: string;
  x: number;
  y: number;
  sampleCount: number;
  statusCounts: Record<ActivityHeatStatus, number>;
  vehicleIds: Set<number>;
}

const PADDING = 46;
const MAP_WIDTH = 200;
const MAP_HEIGHT = 180;
const GRID_SIZE = 12;

const FILTERABLE_STATUSES: OperationHeatStatus[] = ['picking_up', 'carrying'];

const STATUS_LABELS: Record<OperationHeatStatus, string> = {
  picking_up: 'Pickup',
  carrying: 'Carrying',
};

const ACTIVITY_STATUS_LABELS: Record<ActivityHeatStatus, string> = {
  idle: 'Idle',
  picking_up: 'Pickup',
  carrying: 'Carrying',
};

const adjacency = new Map<number, Set<number>>();
for (const link of links) {
  if (!adjacency.has(link.from)) adjacency.set(link.from, new Set());
  if (!adjacency.has(link.to)) adjacency.set(link.to, new Set());
  adjacency.get(link.from)!.add(link.to);
  adjacency.get(link.to)!.add(link.from);
}

function shortestPathOnGraph(from: number, to: number): number[] | null {
  if (from === to) return [from];

  const queue: number[][] = [[from]];
  const visited = new Set<number>([from]);
  while (queue.length > 0) {
    const path = queue.shift()!;
    const current = path[path.length - 1];
    for (const next of adjacency.get(current) ?? []) {
      if (visited.has(next)) continue;
      if (next === to) return [...path, next];
      visited.add(next);
      queue.push([...path, next]);
    }
  }
  return null;
}

function pointAlongPolyline(nodeIds: number[], t: number): { x: number; y: number } | null {
  if (nodeIds.length === 0) return null;
  if (nodeIds.length === 1) {
    const node = nodeMap.get(nodeIds[0]);
    return node ? { x: node.x, y: node.y } : null;
  }

  const clamped = Math.min(1, Math.max(0, t));
  let total = 0;
  const lengths: number[] = [];
  for (let index = 0; index < nodeIds.length - 1; index++) {
    const from = nodeMap.get(nodeIds[index]);
    const to = nodeMap.get(nodeIds[index + 1]);
    if (!from || !to) return null;
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    lengths.push(length);
    total += length;
  }

  if (total <= 0) {
    const node = nodeMap.get(nodeIds[0]);
    return node ? { x: node.x, y: node.y } : null;
  }

  let distance = clamped * total;
  for (let index = 0; index < nodeIds.length - 1; index++) {
    const length = lengths[index];
    const from = nodeMap.get(nodeIds[index])!;
    const to = nodeMap.get(nodeIds[index + 1])!;
    if (distance <= length) {
      const ratio = length > 0 ? distance / length : 0;
      return {
        x: from.x + (to.x - from.x) * ratio,
        y: from.y + (to.y - from.y) * ratio,
      };
    }
    distance -= length;
  }

  const last = nodeMap.get(nodeIds[nodeIds.length - 1]);
  return last ? { x: last.x, y: last.y } : null;
}

function routeNodeIdsForVehicle(vehicle: Vehicle): number[] {
  if (vehicle.path.length >= 2) {
    if (vehicle.path.length > 2) return vehicle.path;
    const route = shortestPathOnGraph(vehicle.path[0], vehicle.path[1]);
    return route && route.length >= 2 ? route : vehicle.path;
  }

  if (vehicle.targetNodeId != null) {
    return shortestPathOnGraph(vehicle.currentNodeId, vehicle.targetNodeId) ?? [
      vehicle.currentNodeId,
      vehicle.targetNodeId,
    ];
  }

  return [vehicle.currentNodeId];
}

function vehiclePosition(vehicle: Vehicle): { x: number; y: number } {
  if (vehicle.path.length >= 2) {
    const route = routeNodeIdsForVehicle(vehicle);
    const position = pointAlongPolyline(route, vehicle.pathProgress);
    if (position) return position;
  }

  const node = nodeMap.get(vehicle.currentNodeId);
  return node ? { x: node.x, y: node.y } : { x: 0, y: 0 };
}

function activityObservations(
  cells: VehicleActivityCell[],
  duration: number,
): WeightedSpatialPoint[] {
  return cells.map(cell => ({ x: cell.x, y: cell.y, weight: cell.sampleCount / duration }));
}

function emptyStatusCounts(): Record<ActivityHeatStatus, number> {
  return {
    idle: 0,
    picking_up: 0,
    carrying: 0,
  };
}

function isFilterableStatus(status: VehicleStatus): status is OperationHeatStatus {
  return status === 'picking_up' || status === 'carrying';
}

function isActivityStatus(status: VehicleStatus): status is ActivityHeatStatus {
  return status === 'idle' || isFilterableStatus(status);
}

function buildFilterStatusTotals(
  frames: SimulationState[],
  startTime: number,
  currentTime: number,
  focusVehicleId: number | null,
): Record<ActivityHeatStatus, number> {
  const totals = emptyStatusCounts();

  for (const frame of frames) {
    if (frame.metrics.currentTime < startTime || frame.metrics.currentTime > currentTime) continue;
    for (const vehicle of frame.vehicles) {
      if (focusVehicleId != null && vehicle.id !== focusVehicleId) continue;
      if (!isActivityStatus(vehicle.status)) continue;
      totals[vehicle.status] += 1;
    }
  }

  return totals;
}

function buildActivityCells(
  frames: SimulationState[],
  startTime: number,
  currentTime: number,
  focusVehicleId: number | null,
  selectedStatuses: Set<OperationHeatStatus>,
  includeIdle: boolean,
): VehicleActivityCell[] {
  const cellMap = new Map<string, VehicleActivityCell & { xSum: number; ySum: number }>();

  for (const frame of frames) {
    if (frame.metrics.currentTime < startTime || frame.metrics.currentTime > currentTime) continue;
    for (const vehicle of frame.vehicles) {
      if (focusVehicleId != null && vehicle.id !== focusVehicleId) continue;
      if (!isActivityStatus(vehicle.status)) continue;
      if (vehicle.status === 'idle' ? !includeIdle : !selectedStatuses.has(vehicle.status)) continue;

      const position = vehiclePosition(vehicle);
      const cellX = Math.round(position.x / GRID_SIZE);
      const cellY = Math.round(position.y / GRID_SIZE);
      const key = `${cellX}:${cellY}`;
      const existing = cellMap.get(key);
      const cell = existing ?? {
        key,
        x: position.x,
        y: position.y,
        xSum: 0,
        ySum: 0,
        sampleCount: 0,
        statusCounts: emptyStatusCounts(),
        vehicleIds: new Set<number>(),
      };
      cell.xSum += position.x;
      cell.ySum += position.y;
      cell.sampleCount += 1;
      cell.statusCounts[vehicle.status] += 1;
      cell.vehicleIds.add(vehicle.id);
      cell.x = cell.xSum / cell.sampleCount;
      cell.y = cell.ySum / cell.sampleCount;
      cellMap.set(key, cell);
    }
  }

  return [...cellMap.values()]
    .map(({ xSum: _xSum, ySum: _ySum, ...cell }) => cell)
    .sort((a, b) => b.sampleCount - a.sampleCount || a.x - b.x || a.y - b.y);
}

function topStatusLabel(cell: VehicleActivityCell): string {
  const [status, count] = (Object.entries(cell.statusCounts) as Array<[ActivityHeatStatus, number]>)
    .sort((a, b) => b[1] - a[1])[0];
  return count > 0 ? ACTIVITY_STATUS_LABELS[status] : '-';
}

interface VehiclePathEdge {
  key: string;
  fromNodeId: number;
  toNodeId: number;
}

function buildVehiclePathEdges(
  frames: SimulationState[],
  startTime: number,
  currentTime: number,
  focusVehicleId: number | null,
): VehiclePathEdge[] {
  if (focusVehicleId == null) return [];
  const edgeMap = new Map<string, VehiclePathEdge>();
  for (const frame of frames) {
    if (frame.metrics.currentTime < startTime || frame.metrics.currentTime > currentTime) continue;
    const vehicle = frame.vehicles.find(candidate => candidate.id === focusVehicleId);
    if (!vehicle || !isActivityStatus(vehicle.status)) continue;
    const routeNodeIds = routeNodeIdsForVehicle(vehicle);
    for (let index = 0; index < routeNodeIds.length - 1; index += 1) {
      const fromNodeId = routeNodeIds[index];
      const toNodeId = routeNodeIds[index + 1];
      if (!adjacency.get(fromNodeId)?.has(toNodeId)) continue;
      const key = fromNodeId < toNodeId
        ? `${fromNodeId}-${toNodeId}`
        : `${toNodeId}-${fromNodeId}`;
      if (!edgeMap.has(key)) edgeMap.set(key, { key, fromNodeId, toNodeId });
    }
  }
  return [...edgeMap.values()];
}

export default function VehicleOperationMap({
  title = 'Vehicle Activity Heatmap',
  contextLabel,
  frames,
  startTime,
  currentTime,
  comparisonFrames,
  comparisonStartTime,
  comparisonCurrentTime,
  comparisonFocusVehicleId = null,
  statusVisibility,
  onStatusVisibilityChange,
  focusVehicleId = null,
  embedded = false,
  hideTitle = false,
}: VehicleOperationMapProps) {
  const [localStatusVisibility, setLocalStatusVisibility] = useState<Record<OperationHeatStatus, boolean>>({
    picking_up: true,
    carrying: true,
  });
  const visibleStatuses = statusVisibility ?? localStatusVisibility;
  const hasSelectedInterval = startTime != null;
  const rangeStart = startTime ?? Number.NEGATIVE_INFINITY;
  const comparisonRangeStart = comparisonStartTime ?? Number.NEGATIVE_INFINITY;
  const selectedStatuses = useMemo(
    () => new Set(FILTERABLE_STATUSES.filter(status => visibleStatuses[status])),
    [visibleStatuses],
  );
  const cells = useMemo(
    () => buildActivityCells(
      frames,
      rangeStart,
      currentTime,
      focusVehicleId,
      selectedStatuses,
      hasSelectedInterval,
    ),
    [frames, rangeStart, currentTime, focusVehicleId, selectedStatuses, hasSelectedInterval],
  );
  const comparisonCells = useMemo(
    () => comparisonFrames && comparisonCurrentTime != null
      ? buildActivityCells(
        comparisonFrames,
        comparisonRangeStart,
        comparisonCurrentTime,
        comparisonFocusVehicleId,
        selectedStatuses,
        hasSelectedInterval,
      )
      : [],
    [comparisonFrames, comparisonRangeStart, comparisonCurrentTime, comparisonFocusVehicleId, selectedStatuses, hasSelectedInterval],
  );
  const statusTotals = useMemo(
    () => buildFilterStatusTotals(frames, rangeStart, currentTime, focusVehicleId),
    [frames, rangeStart, currentTime, focusVehicleId],
  );
  const pathEdges = useMemo(
    () => buildVehiclePathEdges(frames, rangeStart, currentTime, focusVehicleId),
    [frames, rangeStart, currentTime, focusVehicleId],
  );
  const kde = useMemo(() => {
    const duration = hasSelectedInterval ? Math.max(1, currentTime - rangeStart) : 1;
    const comparisonDuration = hasSelectedInterval && comparisonCurrentTime != null
      ? Math.max(1, comparisonCurrentTime - comparisonRangeStart)
      : 1;
    const observations = activityObservations(cells, duration);
    const comparisonObservations = activityObservations(comparisonCells, comparisonDuration);
    const bandwidth = estimateScottBandwidth([
      ...activityObservations(cells, 1),
      ...activityObservations(comparisonCells, 1),
    ]);
    const densities = new Map(cells.map(cell => [
      cell.key,
      gaussianIntensity(cell, observations, bandwidth),
    ]));
    const comparisonDensities = comparisonCells.map(cell =>
      gaussianIntensity(cell, comparisonObservations, bandwidth),
    );
    const sharedDensities = [...densities.values(), ...comparisonDensities];
    return {
      bandwidth,
      densities,
      maxDensity: Math.max(0, ...sharedDensities),
      quartiles: densityQuartiles(sharedDensities),
    };
  }, [cells, comparisonCells, hasSelectedInterval, currentTime, rangeStart, comparisonCurrentTime, comparisonRangeStart]);
  const panelClassName = embedded ? 'vehicle-operation-panel vehicle-operation-panel-embedded' : 'panel chart-panel vehicle-operation-panel';
  const displayContext = contextLabel ?? (focusVehicleId == null ? `t=${currentTime}` : `V${focusVehicleId} · t=${currentTime}`);
  const emptyText = !hasSelectedInterval && selectedStatuses.size === 0
    ? "Select Pickup or Carrying to show vehicle activity"
    : "No selected vehicle activity during this interval";
  const handleStatusFilterChange = (status: OperationHeatStatus, checked: boolean) => {
    if (!checked && FILTERABLE_STATUSES.every(candidate => candidate === status || !visibleStatuses[candidate])) {
      return;
    }
    const nextVisibility = { ...visibleStatuses, [status]: checked };
    if (onStatusVisibilityChange) {
      onStatusVisibilityChange(nextVisibility);
    } else {
      setLocalStatusVisibility(nextVisibility);
    }
  };

  return (
    <div className={panelClassName}>
      {!hideTitle ? (
        <div className="vehicle-operation-head">
          <h3 className="panel-title">{title}</h3>
          <span className="vehicle-operation-context">{displayContext}</span>
        </div>
      ) : null}
      <div className="vehicle-operation-container">
        <div className="vehicle-operation-svg-wrap">
          <svg
            viewBox={`-${PADDING} -${PADDING} ${MAP_WIDTH + PADDING * 2} ${MAP_HEIGHT + PADDING * 2}`}
            preserveAspectRatio="xMidYMid meet"
            className="vehicle-operation-svg"
            aria-label={`${title} at ${displayContext}`}
          >
            <defs>
              <filter id="vehicle-operation-blur" x="-35%" y="-35%" width="170%" height="170%">
                <feGaussianBlur stdDeviation="5.5" />
              </filter>
            </defs>

            {links.filter((_, index) => index % 2 === 0).map(link => {
              const from = nodeMap.get(link.from);
              const to = nodeMap.get(link.to);
              if (!from || !to) return null;
              return (
                <line
                  key={`vehicle-operation-base-link-${link.id}`}
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  className="vehicle-operation-base-link"
                />
              );
            })}

            <g filter="url(#vehicle-operation-blur)">
              {cells.map(cell => {
                if (kde.maxDensity <= 0) return null;
                const density = kde.densities.get(cell.key) ?? 0;
                const ratio = density / kde.maxDensity;
                const color = quartileHeatColor(density, kde.quartiles);
                return (
                  <circle
                    key={`vehicle-activity-field-${cell.key}`}
                    cx={cell.x}
                    cy={cell.y}
                    r={kernelDisplayRadius(kde.bandwidth)}
                    fill={color}
                    fillOpacity={0.16 + ratio * 0.34}
                    className="vehicle-operation-field"
                  >
                    <title>
                      {`${cell.sampleCount} active vehicle samples · ${cell.vehicleIds.size} vehicles · KDE ${density.toFixed(4)} · top status ${topStatusLabel(cell)}`}
                    </title>
                  </circle>
                );
              })}
            </g>

            {pathEdges.map(edge => {
              const from = nodeMap.get(edge.fromNodeId);
              const to = nodeMap.get(edge.toNodeId);
              if (!from || !to) return null;
              return (
                <line
                  key={`vehicle-operation-selected-path-${edge.key}`}
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  className="vehicle-operation-selected-path"
                />
              );
            })}

            {nodes.map(node => (
              <g key={`vehicle-operation-node-${node.id}`} className="vehicle-operation-node">
                <circle cx={node.x} cy={node.y} r={4.5} />
                <text x={node.x} y={node.y + 0.4} textAnchor="middle" dominantBaseline="middle">
                  {node.label}
                </text>
              </g>
            ))}

            {cells.slice(0, 8).map(cell => {
              const density = kde.densities.get(cell.key) ?? 0;
              return (
                <g key={`vehicle-activity-hotspot-${cell.key}`} transform={`translate(${cell.x} ${cell.y})`}>
                  <circle
                    r={6.8}
                    fill={quartileHeatColor(density, kde.quartiles)}
                    fillOpacity={0.92}
                    stroke="#f8fafc"
                    strokeWidth={0.7}
                    className="vehicle-operation-hotspot"
                  >
                    <title>
                      {`${cell.sampleCount} active vehicle samples · KDE ${density.toFixed(4)} · vehicles ${[...cell.vehicleIds].map(id => `V${id}`).join(', ')} · Idle ${cell.statusCounts.idle}, ${STATUS_LABELS.picking_up} ${cell.statusCounts.picking_up}, ${STATUS_LABELS.carrying} ${cell.statusCounts.carrying}`}
                    </title>
                  </circle>
                  <text
                    textAnchor="middle"
                    dominantBaseline="middle"
                    className="vehicle-operation-hotspot-label"
                    style={{ fill: density >= kde.quartiles[2] ? '#f8fafc' : '#111827' }}
                  >
                    {cell.sampleCount}
                  </text>
                </g>
              );
            })}
          </svg>
          {cells.length === 0 ? (
            <p className="vehicle-operation-empty">{emptyText}</p>
          ) : null}
        </div>
        <div className="vehicle-operation-footer">
          <div className="vehicle-operation-status-mix" aria-label="Vehicle activity status filters">
            {hasSelectedInterval ? <span>Idle {statusTotals.idle}</span> : null}
            <label className="vehicle-operation-status-filter is-pickup">
              <input
                type="checkbox"
                checked={visibleStatuses.picking_up}
                onClick={event => event.stopPropagation()}
                onChange={event => handleStatusFilterChange('picking_up', event.currentTarget.checked)}
              />
              <span>Pickup {statusTotals.picking_up}</span>
            </label>
            <label className="vehicle-operation-status-filter is-carrying">
              <input
                type="checkbox"
                checked={visibleStatuses.carrying}
                onClick={event => event.stopPropagation()}
                onChange={event => handleStatusFilterChange('carrying', event.currentTarget.checked)}
              />
              <span>Carrying {statusTotals.carrying}</span>
            </label>
          </div>
          <div className="vehicle-operation-scale" aria-label="Vehicle activity concentration scale">
            <span>Low</span>
            <span className="vehicle-operation-scale-bar" />
            <span>High</span>
          </div>
        </div>
      </div>
    </div>
  );
}
