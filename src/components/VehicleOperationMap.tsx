import { useMemo, useState } from 'react';
import { nodeMap, nodes, undirectedLinks } from '../data/siouxFallsNetwork';
import type {
  ReplayVehicleMovement,
  SimulationState,
  VehicleStatus,
} from '../types/simulation';
import {
  areNetworkNeighbors,
  normalizeEdgeKey,
  routeNodeIdsForVehicle,
  vehiclePosition,
} from '../utils/networkGeometry';
import {
  buildSharedSpatialKde,
  kernelDisplayRadius,
  paperQuartileHeatColor,
  quartileHeatColor,
  type WeightedSpatialPoint,
} from '../utils/spatialKde';
import {
  buildVehicleDistanceFlow,
  type VehicleDistanceFlowEdge,
} from '../utils/vehicleDistanceFlow';

interface VehicleOperationMapProps {
  title?: string;
  contextLabel?: string;
  frames: SimulationState[];
  vehicleMovements?: ReplayVehicleMovement[];
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
  appearance?: 'dashboard' | 'paper';
  showNodeLabels?: boolean;
  mode?: VehicleOperationMode;
  defaultMode?: VehicleOperationMode;
  showModeControl?: boolean;
  onModeChange?: (mode: VehicleOperationMode) => void;
}

export type OperationHeatStatus = Extract<VehicleStatus, 'picking_up' | 'carrying'>;
export type VehicleOperationMode = 'time-presence' | 'distance-flow';
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
const MIN_DISTANCE_STROKE_WIDTH = 1.15;
const DISTANCE_STROKE_RANGE = 5.1;
const EDGE_USAGE_LEGEND_LEVELS = [
  { label: 'Low', ratio: 0.1 },
  { label: 'Medium', ratio: 0.5 },
  { label: 'High', ratio: 1 },
] as const;

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

function formatNetworkDistance(distance: number): string {
  return distance.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: distance < 1 ? 2 : 1,
  });
}

function niceDistanceScaleMaximum(maximum: number): number {
  if (!Number.isFinite(maximum) || maximum <= 0) return 0;
  const magnitude = 10 ** Math.floor(Math.log10(maximum));
  const normalized = maximum / magnitude;
  const multiplier = normalized <= 1
    ? 1
    : normalized <= 2
      ? 2
      : normalized <= 2.5
        ? 2.5
        : normalized <= 5
          ? 5
          : 10;
  return multiplier * magnitude;
}

function distanceStrokeWidth(distance: number, scaleMaximum: number): number {
  if (distance <= 0 || scaleMaximum <= 0) return 0;
  return MIN_DISTANCE_STROKE_WIDTH +
    Math.sqrt(Math.min(1, distance / scaleMaximum)) * DISTANCE_STROKE_RANGE;
}

function offsetLine(
  from: { x: number; y: number },
  to: { x: number; y: number },
  offset: number,
) {
  if (offset === 0) {
    return { x1: from.x, y1: from.y, x2: to.x, y2: to.y };
  }
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) {
    return { x1: from.x, y1: from.y, x2: to.x, y2: to.y };
  }
  const offsetX = (-dy / length) * offset;
  const offsetY = (dx / length) * offset;
  return {
    x1: from.x + offsetX,
    y1: from.y + offsetY,
    x2: to.x + offsetX,
    y2: to.y + offsetY,
  };
}

function distanceEdgeTitle(
  edge: VehicleDistanceFlowEdge,
  status: OperationHeatStatus,
): string {
  const directions = edge.directions
    .filter(direction => direction.status === status)
    .map(direction =>
      `${direction.fromNodeId}→${direction.toNodeId} ${formatNetworkDistance(direction.distance)} (${direction.movementCount})`,
    )
    .join(' · ');
  return [
    STATUS_LABELS[status],
    `${edge.fromNodeId}↔${edge.toNodeId}`,
    `${formatNetworkDistance(edge.statusDistances[status])} weighted edge usage`,
    `${edge.statusMovementCounts[status]} edge traversals`,
    `${edge.statusVehicleIds[status].size} vehicles`,
    directions ? `direction ${directions}` : null,
  ].filter(Boolean).join(' · ');
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
      if (!areNetworkNeighbors(fromNodeId, toNodeId)) continue;
      const key = normalizeEdgeKey(fromNodeId, toNodeId);
      if (!edgeMap.has(key)) edgeMap.set(key, { key, fromNodeId, toNodeId });
    }
  }
  return [...edgeMap.values()];
}

export default function VehicleOperationMap({
  title = 'Vehicle Activity',
  contextLabel,
  frames,
  vehicleMovements = [],
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
  appearance = 'dashboard',
  showNodeLabels = true,
  mode,
  defaultMode = 'time-presence',
  showModeControl = false,
  onModeChange,
}: VehicleOperationMapProps) {
  const heatColor = appearance === 'paper' ? paperQuartileHeatColor : quartileHeatColor;
  const mapPadding = appearance === 'paper' ? 22 : PADDING;
  const [localStatusVisibility, setLocalStatusVisibility] = useState<Record<OperationHeatStatus, boolean>>({
    picking_up: true,
    carrying: true,
  });
  const [localMode, setLocalMode] = useState<VehicleOperationMode>(defaultMode);
  const activeMode = mode ?? localMode;
  const visibleStatuses = statusVisibility ?? localStatusVisibility;
  const hasSelectedInterval = startTime != null;
  const rangeStart = startTime ?? Number.NEGATIVE_INFINITY;
  const comparisonRangeStart = comparisonStartTime ?? Number.NEGATIVE_INFINITY;
  const selectedStatuses = useMemo(
    () => new Set(FILTERABLE_STATUSES.filter(status => visibleStatuses[status])),
    [visibleStatuses],
  );
  const cells = useMemo(
    () => activeMode === 'time-presence'
      ? buildActivityCells(
        frames,
        rangeStart,
        currentTime,
        focusVehicleId,
        selectedStatuses,
        hasSelectedInterval,
      )
      : [],
    [
      activeMode,
      frames,
      rangeStart,
      currentTime,
      focusVehicleId,
      selectedStatuses,
      hasSelectedInterval,
    ],
  );
  const comparisonCells = useMemo(
    () => activeMode === 'time-presence' && comparisonFrames && comparisonCurrentTime != null
      ? buildActivityCells(
        comparisonFrames,
        comparisonRangeStart,
        comparisonCurrentTime,
        comparisonFocusVehicleId,
        selectedStatuses,
        hasSelectedInterval,
      )
      : [],
    [
      activeMode,
      comparisonFrames,
      comparisonRangeStart,
      comparisonCurrentTime,
      comparisonFocusVehicleId,
      selectedStatuses,
      hasSelectedInterval,
    ],
  );
  const statusTotals = useMemo(
    () => buildFilterStatusTotals(frames, rangeStart, currentTime, focusVehicleId),
    [frames, rangeStart, currentTime, focusVehicleId],
  );
  const pathEdges = useMemo(
    () => activeMode === 'time-presence'
      ? buildVehiclePathEdges(frames, rangeStart, currentTime, focusVehicleId)
      : [],
    [activeMode, frames, rangeStart, currentTime, focusVehicleId],
  );
  const distanceFlow = useMemo(
    () => activeMode === 'distance-flow'
      ? buildVehicleDistanceFlow(
        vehicleMovements,
        rangeStart,
        currentTime,
        focusVehicleId,
      )
      : {
        edges: [],
        statusDistances: { picking_up: 0, carrying: 0 },
        totalDistance: 0,
      },
    [activeMode, vehicleMovements, rangeStart, currentTime, focusVehicleId],
  );
  const visibleDistanceEdges = useMemo(
    () => distanceFlow.edges.filter(edge =>
      FILTERABLE_STATUSES.some(status =>
        visibleStatuses[status] && edge.statusDistances[status] > 0,
      ),
    ),
    [distanceFlow.edges, visibleStatuses],
  );
  const overlappingDistanceEdgeKeys = useMemo(() => {
    if (
      activeMode !== 'distance-flow' ||
      !visibleStatuses.picking_up ||
      !visibleStatuses.carrying
    ) {
      return new Set<string>();
    }
    return new Set(
      distanceFlow.edges
        .filter(edge =>
          edge.statusDistances.picking_up > 0 &&
          edge.statusDistances.carrying > 0,
        )
        .map(edge => edge.key),
    );
  }, [activeMode, distanceFlow.edges, visibleStatuses]);
  const distanceScaleMaximum = useMemo(
    () => niceDistanceScaleMaximum(Math.max(
      0,
      ...distanceFlow.edges.flatMap(edge =>
        FILTERABLE_STATUSES.map(status => edge.statusDistances[status]),
      ),
    )),
    [distanceFlow.edges],
  );
  const kde = useMemo(() => {
    if (activeMode !== 'time-presence') {
      return buildSharedSpatialKde([], [], [], [], []);
    }
    const duration = hasSelectedInterval ? Math.max(1, currentTime - rangeStart) : 1;
    const comparisonDuration = hasSelectedInterval && comparisonCurrentTime != null
      ? Math.max(1, comparisonCurrentTime - comparisonRangeStart)
      : 1;
    const observations = activityObservations(cells, duration);
    const comparisonObservations = activityObservations(comparisonCells, comparisonDuration);
    return buildSharedSpatialKde(
      cells,
      observations,
      comparisonCells,
      comparisonObservations,
      [
        ...activityObservations(cells, 1),
        ...activityObservations(comparisonCells, 1),
      ],
    );
  }, [
    activeMode,
    cells,
    comparisonCells,
    hasSelectedInterval,
    currentTime,
    rangeStart,
    comparisonCurrentTime,
    comparisonRangeStart,
  ]);
  const panelClassName = embedded ? 'vehicle-operation-panel vehicle-operation-panel-embedded' : 'panel chart-panel vehicle-operation-panel';
  const displayContext = contextLabel ?? (focusVehicleId == null ? `t=${currentTime}` : `V${focusVehicleId} · t=${currentTime}`);
  const emptyText = activeMode === 'distance-flow'
    ? vehicleMovements.length === 0
      ? 'Replay has no vehicle movement data'
      : 'No weighted edge usage during this interval'
    : !hasSelectedInterval && selectedStatuses.size === 0
      ? 'Select Pickup or Carrying to show vehicle activity'
      : 'No selected vehicle activity during this interval';
  const hasVisibleMapData = activeMode === 'distance-flow'
    ? visibleDistanceEdges.length > 0
    : cells.length > 0;
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
  const handleModeChange = (nextMode: VehicleOperationMode) => {
    if (mode === undefined) setLocalMode(nextMode);
    onModeChange?.(nextMode);
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
          {showModeControl ? (
            <div className="vehicle-operation-mode-row">
              <div
                className="vehicle-operation-mode-toggle"
                role="group"
                aria-label="Vehicle activity measure"
              >
                <button
                  type="button"
                  className={activeMode === 'distance-flow' ? 'is-active' : ''}
                  aria-pressed={activeMode === 'distance-flow'}
                  onClick={() => handleModeChange('distance-flow')}
                >
                  Distance Flow
                </button>
                <button
                  type="button"
                  className={activeMode === 'time-presence' ? 'is-active' : ''}
                  aria-pressed={activeMode === 'time-presence'}
                  onClick={() => handleModeChange('time-presence')}
                >
                  Activity Heatmap
                </button>
              </div>
            </div>
          ) : null}
          <svg
            viewBox={`-${mapPadding} -${mapPadding} ${MAP_WIDTH + mapPadding * 2} ${MAP_HEIGHT + mapPadding * 2}`}
            preserveAspectRatio="xMidYMid meet"
            className="vehicle-operation-svg"
            aria-label={`${title} ${activeMode === 'distance-flow' ? 'distance flow' : 'time presence'} at ${displayContext}`}
          >
            <defs>
              <filter id="vehicle-operation-blur" x="-35%" y="-35%" width="170%" height="170%">
                <feGaussianBlur stdDeviation="5.5" />
              </filter>
            </defs>

            {undirectedLinks.map(link => {
              const from = nodeMap.get(link.from);
              const to = nodeMap.get(link.to);
              if (!from || !to) return null;
              if (overlappingDistanceEdgeKeys.has(normalizeEdgeKey(link.from, link.to))) {
                return null;
              }
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

            {activeMode === 'distance-flow' ? (
              <g className="vehicle-operation-distance-flow">
                {visibleDistanceEdges.flatMap(edge => {
                  const from = nodeMap.get(edge.fromNodeId);
                  const to = nodeMap.get(edge.toNodeId);
                  if (!from || !to || distanceScaleMaximum <= 0) return [];
                  const hasBothStatuses = FILTERABLE_STATUSES.every(status =>
                    visibleStatuses[status] && edge.statusDistances[status] > 0,
                  );

                  return FILTERABLE_STATUSES.flatMap(status => {
                    const distance = edge.statusDistances[status];
                    if (!visibleStatuses[status] || distance <= 0) return [];
                    const offset = hasBothStatuses
                      ? status === 'picking_up' ? -1.7 : 1.7
                      : 0;
                    const coordinates = offsetLine(from, to, offset);
                    const strokeWidth = distanceStrokeWidth(
                      distance,
                      distanceScaleMaximum,
                    );
                    return [
                      <line
                        key={`vehicle-distance-${edge.key}-${status}`}
                        {...coordinates}
                        strokeWidth={strokeWidth}
                        className={`vehicle-operation-distance-edge is-${status === 'picking_up' ? 'pickup' : 'carrying'}`}
                      >
                        <title>{distanceEdgeTitle(edge, status)}</title>
                      </line>,
                    ];
                  });
                })}
              </g>
            ) : (
              <g filter="url(#vehicle-operation-blur)">
                {cells.map(cell => {
                  if (kde.maxDensity <= 0) return null;
                  const density = kde.densities.get(cell.key) ?? 0;
                  const ratio = density / kde.maxDensity;
                  const color = heatColor(density, kde.quartiles);
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
            )}

            {activeMode === 'time-presence' ? pathEdges.map(edge => {
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
            }) : null}

            {nodes.map(node => (
              <g key={`vehicle-operation-node-${node.id}`} className="vehicle-operation-node">
                <circle cx={node.x} cy={node.y} r={4.5} />
                {showNodeLabels ? (
                  <text x={node.x} y={node.y + 0.4} textAnchor="middle" dominantBaseline="middle">
                    {node.label}
                  </text>
                ) : null}
              </g>
            ))}

            {activeMode === 'time-presence' ? cells.slice(0, 8).map(cell => {
              const density = kde.densities.get(cell.key) ?? 0;
              return (
                <g key={`vehicle-activity-hotspot-${cell.key}`} transform={`translate(${cell.x} ${cell.y})`}>
                  <circle
                    r={6.8}
                    fill={heatColor(density, kde.quartiles)}
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
            }) : null}
          </svg>
          {!hasVisibleMapData ? (
            <p className="vehicle-operation-empty">{emptyText}</p>
          ) : null}
        </div>
        <div className="vehicle-operation-footer">
          <div className="vehicle-operation-status-mix" aria-label="Vehicle activity status filters">
            {activeMode === 'time-presence' && hasSelectedInterval
              ? <span>Idle {statusTotals.idle}</span>
              : null}
            <label className="vehicle-operation-status-filter is-pickup">
              <input
                type="checkbox"
                checked={visibleStatuses.picking_up}
                onClick={event => event.stopPropagation()}
                onChange={event => handleStatusFilterChange('picking_up', event.currentTarget.checked)}
              />
              <span
                title={activeMode === 'distance-flow'
                  ? 'Total pickup weighted edge usage'
                  : undefined}
              >
                Pickup {activeMode === 'distance-flow'
                  ? formatNetworkDistance(distanceFlow.statusDistances.picking_up)
                  : statusTotals.picking_up}
              </span>
            </label>
            <label className="vehicle-operation-status-filter is-carrying">
              <input
                type="checkbox"
                checked={visibleStatuses.carrying}
                onClick={event => event.stopPropagation()}
                onChange={event => handleStatusFilterChange('carrying', event.currentTarget.checked)}
              />
              <span
                title={activeMode === 'distance-flow'
                  ? 'Total carrying weighted edge usage'
                  : undefined}
              >
                Carrying {activeMode === 'distance-flow'
                  ? formatNetworkDistance(distanceFlow.statusDistances.carrying)
                  : statusTotals.carrying}
              </span>
            </label>
          </div>
          {activeMode === 'distance-flow' ? (
            <div
              className="vehicle-operation-distance-legend"
              aria-label="Weighted Edge Usage line-width scale: thicker edges indicate greater accumulated weighted usage"
              title="Thicker edges indicate greater accumulated weighted usage"
            >
              <span className="vehicle-operation-distance-legend-title">
                Weighted Edge Usage
              </span>
              <span className="vehicle-operation-distance-legend-samples">
                {distanceScaleMaximum > 0
                  ? EDGE_USAGE_LEGEND_LEVELS.map(level => (
                    <span
                      key={level.label}
                      className="vehicle-operation-distance-legend-sample"
                    >
                      <i
                        aria-hidden="true"
                        style={{
                          height: `${distanceStrokeWidth(
                            distanceScaleMaximum * level.ratio,
                            distanceScaleMaximum,
                          )}px`,
                        }}
                      />
                      <span>{level.label}</span>
                    </span>
                  ))
                  : <span>No usage</span>}
              </span>
            </div>
          ) : (
            <div className="vehicle-operation-scale" aria-label="Vehicle activity concentration scale">
              <span>Low</span>
              <span className="vehicle-operation-scale-bar" />
              <span>High</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
