import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { REQUEST_EVENT_COLORS, VEHICLE_STATUS_COLORS } from '../config';
import { nodes, undirectedLinks } from '../data/siouxFallsNetwork';
import type {
  Vehicle,
  Passenger,
  EdgeTraversal,
  VehiclePatternSelection,
  SimulationState,
  // NodeActivity,  // Activity ring – disabled
} from '../types/simulation';
import {
  normalizeEdgeKey,
  routeNodeIdsForVehicle,
  vehiclePosition,
} from '../utils/networkGeometry';

interface NetworkMapProps {
  vehicles: Vehicle[];
  passengers: Passenger[];
  title?: string;
  hideTitle?: boolean;
  embedded?: boolean;
  analysisVehicleId?: number | null;
  edgeTraversals?: EdgeTraversal[];
  selectedSegment?: VehiclePatternSelection | null;
  selectedSegmentFrames?: SimulationState[];
  onClearSelectedSegment?: () => void;
  // nodeActivity?: NodeActivity[];  // Activity ring – disabled
}

const PADDING = 10;
const MAP_WIDTH = 200;
const MAP_HEIGHT = 180;

const nodeById = new Map(nodes.map(n => [n.id, n]));

type TooltipPlacement = {
  horizontal: 'left' | 'right';
  vertical: 'top' | 'bottom';
};

type TooltipPosition = { x: number; y: number };

type TooltipDragState = {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
};

const TOOLTIP_MARGIN = 8;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function tooltipPlacementForNode(nodeId: number | null): TooltipPlacement {
  const node = nodeId != null ? nodeById.get(nodeId) : null;
  return {
    horizontal: node && node.x >= MAP_WIDTH / 2 ? 'left' : 'right',
    vertical: node && node.y > MAP_HEIGHT / 2 ? 'top' : 'bottom',
  };
}

function vehicleColor(status: string) {
  switch (status) {
    case 'idle': return '#3b82f6';
    case 'picking_up': return VEHICLE_STATUS_COLORS.picking_up;
    case 'carrying': return VEHICLE_STATUS_COLORS.carrying;
    default: return '#6b7280';
  }
}

function buildMovingLinkColors(vehicles: Vehicle[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const v of vehicles) {
    if (v.status !== 'picking_up' && v.status !== 'carrying') continue;
    if (v.targetNodeId == null) continue;
    const route = routeNodeIdsForVehicle(v);
    if (route.length < 2) continue;
    const col = vehicleColor(v.status);
    for (let i = 0; i < route.length - 1; i++) {
      const key = normalizeEdgeKey(route[i], route[i + 1]);
      const list = map.get(key) ?? [];
      list.push(col);
      map.set(key, list);
    }
  }
  return map;
}

function appendRouteNodes(target: number[], route: number[]) {
  if (route.length === 0) return;

  const tailStart = target.length - route.length;
  const routeAlreadyAtTail = tailStart >= 0 && route.every(
    (nodeId, index) => target[tailStart + index] === nodeId,
  );
  if (routeAlreadyAtTail) return;

  for (const nodeId of route) {
    if (target[target.length - 1] !== nodeId) target.push(nodeId);
  }
}

function buildSegmentMovingLinkColors(
  frames: SimulationState[],
  selection: VehiclePatternSelection,
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const frame of frames) {
    const vehicle = frame.vehicles.find(v => v.id === selection.vehicleId);
    if (!vehicle || (selection.status !== 'range' && vehicle.status !== selection.status)) continue;

    const route = routeNodeIdsForVehicle(vehicle);
    const color = vehicleColor(vehicle.status);
    for (let i = 0; i < route.length - 1; i++) {
      const key = normalizeEdgeKey(route[i], route[i + 1]);
      if (!map.has(key)) map.set(key, [color]);
    }
  }

  return map;
}

function buildSegmentRouteNodeIds(
  frames: SimulationState[],
  selection: VehiclePatternSelection,
): number[] {
  const routeNodes: number[] = [];

  for (const frame of frames) {
    const vehicle = frame.vehicles.find(v => v.id === selection.vehicleId);
    if (!vehicle || (selection.status !== 'range' && vehicle.status !== selection.status)) continue;
    appendRouteNodes(routeNodes, routeNodeIdsForVehicle(vehicle));
  }

  return routeNodes;
}

function passengerMatchesSelection(
  passenger: Passenger,
  selection: VehiclePatternSelection,
): boolean {
  if (passenger.assignedVehicleId !== selection.vehicleId) return false;
  if (selection.status === 'range') {
    return passenger.status === 'waiting' || passenger.status === 'picked_up';
  }
  if (selection.status === 'picking_up') return passenger.status === 'waiting';
  return passenger.status === 'picked_up';
}

function collectSegmentPassengers(
  frames: SimulationState[],
  selection: VehiclePatternSelection,
): Passenger[] {
  const byId = new Map<number, Passenger>();

  for (const frame of frames) {
    for (const passenger of frame.passengers) {
      if (passengerMatchesSelection(passenger, selection)) {
        byId.set(passenger.id, passenger);
      }
    }
  }

  return Array.from(byId.values()).sort((a, b) => a.id - b.id);
}

// // Color by wait-time severity vs threshold (0..1) – disabled
// function waitSeverityColor(waitTime: number, threshold: number): string {
//   if (threshold <= 0) return '#f59e0b';
//   const r = Math.max(0, Math.min(1, waitTime / threshold));
//   if (r < 0.5) return '#10b981';
//   if (r < 0.85) return '#f59e0b';
//   return '#ef4444';
// }

const ROUTE_TRACE_COLOR = '#a78bfa';
const PICKUP_COLOR = REQUEST_EVENT_COLORS.pickup;
const DROPOFF_COLOR = REQUEST_EVENT_COLORS.dropoff;

export default function NetworkMap({
  vehicles,
  passengers,
  title,
  hideTitle = false,
  embedded = false,
  analysisVehicleId,
  edgeTraversals,
  selectedSegment,
  selectedSegmentFrames,
  onClearSelectedSegment,
  // nodeActivity,  // Activity ring – disabled
}: NetworkMapProps) {
  const inAnalysis = analysisVehicleId != null;
  const selectedVehicleId = selectedSegment?.vehicleId ?? null;
  const focusedVehicleId = analysisVehicleId ?? selectedVehicleId;
  const hasTimelineSelection = selectedSegment != null;
  const activeSegmentFrames = selectedSegment ? (selectedSegmentFrames ?? []) : [];
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const tooltipDragRef = useRef<TooltipDragState | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState<TooltipPosition | null>(null);

  const selectedSegmentRouteNodes = useMemo(() => {
    if (!selectedSegment || activeSegmentFrames.length === 0) return [];
    return buildSegmentRouteNodeIds(activeSegmentFrames, selectedSegment);
  }, [activeSegmentFrames, selectedSegment]);

  const selectedPassengers = useMemo(() => {
    if (!selectedSegment) return [];
    if (activeSegmentFrames.length > 0) {
      return collectSegmentPassengers(activeSegmentFrames, selectedSegment);
    }
    return passengers.filter(passenger =>
      passenger.assignedVehicleId === selectedSegment.vehicleId &&
      (passenger.status === 'waiting' || passenger.status === 'picked_up'),
    );
  }, [activeSegmentFrames, passengers, selectedSegment]);

  const selectedVehicleSource = activeSegmentFrames[0]?.vehicles ?? vehicles;
  const selectedVehicle = selectedSegment
    ? selectedVehicleSource.find(vehicle => vehicle.id === selectedSegment.vehicleId) ?? null
    : null;
  const selectedCurrentNodeId = selectedVehicle?.currentNodeId ?? null;
  const selectedCurrentNodeLabel = selectedCurrentNodeId != null ? 'N' + selectedCurrentNodeId : '-';
  const selectedNodeLabel = selectedSegmentRouteNodes.length > 0
    ? selectedSegmentRouteNodes.map(nodeId => 'N' + nodeId).join(' -> ')
    : selectedVehicle
      ? selectedCurrentNodeLabel + (selectedVehicle.targetNodeId != null ? ' -> N' + selectedVehicle.targetNodeId : '')
      : '-';
  const tooltipPlacement = useMemo(
    () => tooltipPlacementForNode(selectedCurrentNodeId),
    [selectedCurrentNodeId],
  );
  const tooltipClassName =
    'network-selection-tooltip is-' + tooltipPlacement.vertical + ' is-' + tooltipPlacement.horizontal +
    (tooltipPosition ? ' is-dragged' : '');
  const tooltipStyle: CSSProperties | undefined = tooltipPosition
    ? { left: tooltipPosition.x, top: tooltipPosition.y }
    : undefined;

  useEffect(() => {
    setTooltipPosition(null);
    tooltipDragRef.current = null;
  }, [
    selectedSegment?.resultSide,
    selectedSegment?.vehicleId,
    selectedSegment?.status,
    selectedSegment?.startTime,
    selectedSegment?.endTime,
    selectedCurrentNodeId,
  ]);

  const clampTooltipPosition = (x: number, y: number): TooltipPosition => {
    const container = mapContainerRef.current;
    const tooltip = tooltipRef.current;
    if (!container || !tooltip) return { x, y };

    const maxX = Math.max(TOOLTIP_MARGIN, container.clientWidth - tooltip.offsetWidth - TOOLTIP_MARGIN);
    const maxY = Math.max(TOOLTIP_MARGIN, container.clientHeight - tooltip.offsetHeight - TOOLTIP_MARGIN);
    return {
      x: clamp(x, TOOLTIP_MARGIN, maxX),
      y: clamp(y, TOOLTIP_MARGIN, maxY),
    };
  };

  const handleTooltipPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button')) return;

    const container = mapContainerRef.current;
    const tooltip = tooltipRef.current;
    if (!container || !tooltip) return;

    const containerRect = container.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const startX = tooltipRect.left - containerRect.left;
    const startY = tooltipRect.top - containerRect.top;
    tooltipDragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX,
      startY,
    };
    setTooltipPosition(clampTooltipPosition(startX, startY));
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const handleTooltipPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = tooltipDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    setTooltipPosition(clampTooltipPosition(
      drag.startX + event.clientX - drag.startClientX,
      drag.startY + event.clientY - drag.startClientY,
    ));
  };

  const handleTooltipPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = tooltipDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    tooltipDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const waitingByNode = new Map<number, number>();
  for (const p of passengers) {
    if (p.status === 'waiting') {
      waitingByNode.set(p.originNodeId, (waitingByNode.get(p.originNodeId) || 0) + 1);
    }
  }

  const movingLinkColors = useMemo(() => {
    if (selectedSegment && activeSegmentFrames.length > 0) {
      return buildSegmentMovingLinkColors(activeSegmentFrames, selectedSegment);
    }
    if (focusedVehicleId != null) {
      const selected = vehicles.filter(v => v.id === focusedVehicleId);
      return buildMovingLinkColors(selected);
    }
    return buildMovingLinkColors(vehicles);
  }, [activeSegmentFrames, vehicles, focusedVehicleId, selectedSegment]);

  // // Node activity lookup (Activity ring – disabled)
  // const nodeActivityById = useMemo(() => {
  //   const m = new Map<number, NodeActivity>();
  //   if (!nodeActivity) return m;
  //   for (const a of nodeActivity) m.set(a.nodeId, a);
  //   return m;
  // }, [nodeActivity]);
  //
  // const maxNodeActivity = useMemo(() => {
  //   if (!nodeActivity || nodeActivity.length === 0) return 0;
  //   return Math.max(
  //     ...nodeActivity.map(a => a.pickupCount + a.dropoffCount),
  //   );
  // }, [nodeActivity]);

  type PerPassengerMarker = {
    id: number;
    ox: number; oy: number;
    dx: number; dy: number;
  };
  const perPassengerMarkers = useMemo<PerPassengerMarker[]>(() => {
    if (focusedVehicleId == null) return [];
    const markers: PerPassengerMarker[] = [];
    const markerPassengers = hasTimelineSelection ? selectedPassengers : passengers;
    for (const p of markerPassengers) {
      const isUnaccepted = !hasTimelineSelection && inAnalysis && p.status === 'waiting' && p.assignedVehicleId == null;
      const isOperatingBySelectedVehicle =
        p.assignedVehicleId === focusedVehicleId &&
        (p.status === 'waiting' || p.status === 'picked_up');
      if (!isUnaccepted && !isOperatingBySelectedVehicle) continue;

      const oNode = nodeById.get(p.originNodeId);
      const dNode = nodeById.get(p.destinationNodeId);
      if (!oNode || !dNode) continue;

      if (p.status === 'waiting' || p.status === 'picked_up') {
        markers.push({
          id: p.id,
          ox: oNode.x, oy: oNode.y, dx: dNode.x, dy: dNode.y,
        });
      }
    }
    return markers;
  }, [hasTimelineSelection, inAnalysis, focusedVehicleId, passengers, selectedPassengers]);

  const panelClassName = embedded ? 'network-panel network-panel-embedded' : 'panel network-panel';

  return (
    <div className={panelClassName}>
      {!hideTitle ? (
        <h3 className="panel-title">
          {title ?? (inAnalysis ? `Analysis: Vehicle V${analysisVehicleId}` : 'Sioux Falls Network')}
        </h3>
      ) : null}
      <div className="network-map-container" ref={mapContainerRef}>
        <svg
          viewBox={`-${PADDING} -${PADDING} ${MAP_WIDTH + PADDING * 2} ${MAP_HEIGHT + PADDING * 2}`}
          preserveAspectRatio="xMidYMid meet"
          className="network-svg"
        >
          {/* Arrowhead marker for directional traversal */}
          <defs>
            <marker
              id="arrow-route"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="5"
              markerHeight="5"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill={ROUTE_TRACE_COLOR} />
            </marker>
          </defs>

          {/* Base links */}
          {undirectedLinks.map(link => {
            const from = nodeById.get(link.from);
            const to = nodeById.get(link.to);
            if (!from || !to) return null;
            const edgeKey = normalizeEdgeKey(link.from, link.to);

            const colorsOnEdge = movingLinkColors.get(edgeKey);
            const load = colorsOnEdge?.length ?? 0;
            const strokeColor =
              load === 0
                ? '#4b5563'
                : load === 1
                  ? colorsOnEdge![0]
                  : '#ffffff';
            const strokeWidth = load > 0 ? 1.5 + load * 0.8 : 0.8;
            return (
              <line
                key={`link-${link.id}`}
                x1={from.x} y1={from.y}
                x2={to.x} y2={to.y}
                stroke={strokeColor}
                strokeWidth={strokeWidth}
                strokeOpacity={0.6}
              />
            );
          })}

          {/* Direction arrows on traversed edges (analysis) */}
          {inAnalysis && edgeTraversals && edgeTraversals.map((e, idx) => {
            const from = nodeById.get(e.from);
            const to = nodeById.get(e.to);
            if (!from || !to) return null;
            const mx = from.x + (to.x - from.x) * 0.55;
            const my = from.y + (to.y - from.y) * 0.55;
            return (
              <line
                key={`arrow-${idx}`}
                x1={from.x + (to.x - from.x) * 0.45}
                y1={from.y + (to.y - from.y) * 0.45}
                x2={mx}
                y2={my}
                stroke="transparent"
                strokeWidth={0.1}
                markerEnd="url(#arrow-route)"
              />
            );
          })}

          {/* Nodes */}
          {nodes.map(node => {
            const wCount = waitingByNode.get(node.id) || 0;
            return (
              <g key={`node-${node.id}`}>
                {!inAnalysis && wCount > 0 && (
                  <circle
                    cx={node.x} cy={node.y}
                    r={8 + wCount * 2}
                    fill="#f59e0b"
                    fillOpacity={0.15}
                  />
                )}
                <circle
                  cx={node.x} cy={node.y} r={6}
                  fill="#1e293b" stroke="#64748b" strokeWidth={1}
                />
                <text
                  x={node.x} y={node.y + 0.5}
                  textAnchor="middle" dominantBaseline="middle"
                  fill="#e2e8f0" fontSize={5} fontWeight="bold"
                >
                  {node.label}
                </text>
                {!inAnalysis && wCount > 0 && (
                  <text
                    x={node.x + 8} y={node.y - 6}
                    fill="#f59e0b" fontSize={5} fontWeight="bold"
                  >
                    {wCount}
                  </text>
                )}
              </g>
            );
          })}

          {/* Per-passenger request markers (analysis) */}
          {(inAnalysis || hasTimelineSelection) && perPassengerMarkers.map(m => {
            const s = 4;
            return (
              <g key={`req-${m.id}`}>
                {/* Origin: waiting point */}
                <polygon
                  points={`${m.ox - 5},${m.oy - s - 3} ${m.ox + 5},${m.oy - s - 3} ${m.ox},${m.oy - 1}`}
                  fill={PICKUP_COLOR} fillOpacity={0.85}
                  stroke="#fff" strokeWidth={0.3}
                />
                <text
                  x={m.ox} y={m.oy - s - 5}
                  textAnchor="middle" fill={PICKUP_COLOR}
                  fontSize={3.5} fontWeight="bold"
                >
                  P{m.id}
                </text>
                {/* Destination: dropoff point */}
                <polygon
                  points={`${m.dx - 5},${m.dy + s + 1} ${m.dx + 5},${m.dy + s + 1} ${m.dx},${m.dy - s + 3}`}
                  fill={DROPOFF_COLOR} fillOpacity={0.85}
                  stroke="#fff" strokeWidth={0.3}
                />
                <text
                  x={m.dx} y={m.dy + s + 5}
                  textAnchor="middle" fill={DROPOFF_COLOR}
                  fontSize={3.5} fontWeight="bold"
                >
                  D{m.id}
                </text>
              </g>
            );
          })}

          {/* Vehicles */}
          {vehicles.map(v => {
            const pos = vehiclePosition(v);
            const hidden = inAnalysis && analysisVehicleId != null && v.id !== analysisVehicleId;
            const dimmed = inAnalysis && analysisVehicleId == null && false; // reserved
            const isFocusedVehicle = focusedVehicleId != null && v.id === focusedVehicleId;
            if (hidden) return null;
            return (
              <g key={`vehicle-${v.id}`} opacity={hasTimelineSelection && !isFocusedVehicle ? 0.42 : 1}>
                {isFocusedVehicle && (
                  <circle
                    cx={pos.x} cy={pos.y} r={8}
                    fill="none"
                    stroke="#fff"
                    strokeWidth={0.5}
                    strokeOpacity={0.6}
                  >
                    <animate
                      attributeName="r"
                      values="6;10;6"
                      dur="2s"
                      repeatCount="indefinite"
                    />
                    <animate
                      attributeName="stroke-opacity"
                      values="0.7;0.1;0.7"
                      dur="2s"
                      repeatCount="indefinite"
                    />
                  </circle>
                )}
                <circle
                  cx={pos.x} cy={pos.y} r={isFocusedVehicle ? 6 : 5}
                  fill={vehicleColor(v.status)}
                  stroke="#fff" strokeWidth={isFocusedVehicle ? 1.5 : 1.2}
                >
                  {!dimmed && (
                    <animate
                      attributeName="r"
                      values={isFocusedVehicle ? '6;7;6' : '5;6;5'}
                      dur="1.5s"
                      repeatCount="indefinite"
                    />
                  )}
                </circle>
                <text
                  x={pos.x} y={pos.y + 0.2}
                  textAnchor="middle" fill="#fff"
                  dominantBaseline="middle"
                  fontSize={isFocusedVehicle ? 4.2 : 3.8}
                  fontWeight="bold"
                  paintOrder="stroke"
                  stroke="rgba(15, 23, 42, 0.65)"
                  strokeWidth={0.35}
                >
                  V{v.id}
                </text>
              </g>
            );
          })}
        </svg>

        {selectedSegment && selectedVehicle && (
          <div
            className={tooltipClassName}
            ref={tooltipRef}
            style={tooltipStyle}
          >
            <div
              className="network-selection-head"
              onPointerDown={handleTooltipPointerDown}
              onPointerMove={handleTooltipPointerMove}
              onPointerUp={handleTooltipPointerUp}
              onPointerCancel={handleTooltipPointerUp}
            >
              <div className="network-selection-title">
                {selectedSegment.resultLabel} V{selectedSegment.vehicleId} {
                  selectedSegment.status === 'idle'
                    ? 'Idle'
                    : selectedSegment.status === 'range'
                      ? 'Selected range'
                    : selectedSegment.status === 'picking_up'
                      ? 'Picking up'
                      : 'Carrying'
                }
              </div>
              <button
                type="button"
                className="network-selection-close"
                aria-label="Close selected segment details"
                onClick={onClearSelectedSegment}
              >
                x
              </button>
            </div>
            <div className="network-selection-grid">
              <span>Time</span>
              <strong>t {selectedSegment.startTime}-{selectedSegment.endTime}</strong>
              <span>Current</span>
              <strong>{selectedCurrentNodeLabel}</strong>
              <span>Schedule</span>
              <strong className="network-selection-schedule">{selectedNodeLabel}</strong>
              <span>Passenger</span>
              <strong>{selectedPassengers.length > 0 ? selectedPassengers.map(p => `P${p.id}`).join(', ') : '-'}</strong>
            </div>
          </div>
        )}

        <div className="map-legend">
          {inAnalysis || hasTimelineSelection ? (
            <>
              <div className="legend-item">
                <span className="legend-dot" style={{ background: '#3b82f6' }} /> Idle
              </div>
              <div className="legend-item">
                <span className="legend-dot" style={{ background: VEHICLE_STATUS_COLORS.picking_up }} /> Picking up
              </div>
              <div className="legend-item">
                <span className="legend-dot" style={{ background: VEHICLE_STATUS_COLORS.carrying }} /> Carrying
              </div>
              <div className="legend-item">
                <span className="legend-triangle-down" style={{ borderTopColor: PICKUP_COLOR }} /> P: Waiting
              </div>
              <div className="legend-item">
                <span className="legend-triangle-up" style={{ borderBottomColor: DROPOFF_COLOR }} /> D: Dropoff
              </div>
            </>
          ) : (
            <>
              <div className="legend-item">
                <span className="legend-dot" style={{ background: '#3b82f6' }} /> Idle
              </div>
              <div className="legend-item">
                <span className="legend-dot" style={{ background: VEHICLE_STATUS_COLORS.picking_up }} /> Picking up
              </div>
              <div className="legend-item">
                <span className="legend-dot" style={{ background: VEHICLE_STATUS_COLORS.carrying }} /> Carrying
              </div>
              <div className="legend-item">
                <span className="legend-dot" style={{ background: REQUEST_EVENT_COLORS.pickup, opacity: 0.4 }} /> Waiting Passenger
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
