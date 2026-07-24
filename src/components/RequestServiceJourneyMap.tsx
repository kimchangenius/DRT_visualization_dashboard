import { useMemo, useState, type MouseEvent as ReactMouseEvent } from 'react';

import { nodeMap, nodes, undirectedLinks } from '../data/siouxFallsNetwork';
import type {
  Passenger,
  ReplayPassengerEvent,
  ReplayVehicleMovement,
} from '../types/simulation';
import {
  buildRequestServiceJourney,
  type RequestJourneyEdge,
  type RequestJourneyPhase,
} from '../utils/requestServiceJourney';

interface RequestServiceJourneyMapProps {
  passenger: Passenger;
  vehicleMovements: ReplayVehicleMovement[];
  passengerEvents: ReplayPassengerEvent[];
  currentTime: number;
}

interface JourneyEdgeTooltipState {
  edge: RequestJourneyEdge;
  x: number;
  y: number;
  horizontalPlacement: 'left' | 'right';
  verticalPlacement: 'above' | 'below';
}

interface LineGeometry {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

const PADDING = 22;
const MAP_WIDTH = 200;
const MAP_HEIGHT = 180;
const ROUTE_OFFSET = 1.35;
const EVENT_MARKER_DISTANCE = 13;
const EVENT_MARKER_SPACING = 7;
const FULL_CIRCLE = Math.PI * 2;

function normalizeAngle(angle: number): number {
  return ((angle % FULL_CIRCLE) + FULL_CIRCLE) % FULL_CIRCLE;
}

function eventMarkerDirection(nodeId: number): number {
  const node = nodeMap.get(nodeId);
  if (!node) return -Math.PI / 2;

  const incidentAngles = undirectedLinks.flatMap(link => {
    if (link.from !== nodeId && link.to !== nodeId) return [];
    const adjacentNodeId = link.from === nodeId ? link.to : link.from;
    const adjacentNode = nodeMap.get(adjacentNodeId);
    if (!adjacentNode) return [];
    return [normalizeAngle(Math.atan2(
      adjacentNode.y - node.y,
      adjacentNode.x - node.x,
    ))];
  }).sort((left, right) => left - right);

  if (incidentAngles.length === 0) return -Math.PI / 2;

  let widestGap = -1;
  let widestGapStart = incidentAngles[0];
  incidentAngles.forEach((angle, index) => {
    const nextAngle = index === incidentAngles.length - 1
      ? incidentAngles[0] + FULL_CIRCLE
      : incidentAngles[index + 1];
    const gap = nextAngle - angle;
    if (gap > widestGap) {
      widestGap = gap;
      widestGapStart = angle;
    }
  });
  return normalizeAngle(widestGapStart + widestGap / 2);
}

const eventMarkerDirections = new Map(
  nodes.map(node => [node.id, eventMarkerDirection(node.id)]),
);

function formatValue(value: number): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: value < 1 ? 2 : 1,
  });
}

function formatTime(value: number | null): string {
  if (value == null) return '-';
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function edgeLine(edge: RequestJourneyEdge): LineGeometry | null {
  const from = nodeMap.get(edge.fromNodeId);
  const to = nodeMap.get(edge.toNodeId);
  if (!from || !to) return null;

  const canonicalFrom = edge.fromNodeId < edge.toNodeId ? from : to;
  const canonicalTo = edge.fromNodeId < edge.toNodeId ? to : from;
  const dx = canonicalTo.x - canonicalFrom.x;
  const dy = canonicalTo.y - canonicalFrom.y;
  const length = Math.hypot(dx, dy);
  const phaseDirection = edge.phase === 'approach' ? -1 : 1;
  const offsetX = length > 0 ? (-dy / length) * ROUTE_OFFSET * phaseDirection : 0;
  const offsetY = length > 0 ? (dx / length) * ROUTE_OFFSET * phaseDirection : 0;

  return {
    x1: from.x + offsetX,
    y1: from.y + offsetY,
    x2: to.x + offsetX,
    y2: to.y + offsetY,
  };
}

function travelledLine(edge: RequestJourneyEdge, line: LineGeometry): LineGeometry {
  const progress = edge.distance > 0
    ? Math.min(1, Math.max(0, edge.distanceTravelled / edge.distance))
    : 0;
  return {
    ...line,
    x2: line.x1 + (line.x2 - line.x1) * progress,
    y2: line.y1 + (line.y2 - line.y1) * progress,
  };
}

function latestTravelPoint(edges: RequestJourneyEdge[]): { x: number; y: number } | null {
  const lastTravelledEdge = [...edges]
    .reverse()
    .find(edge => edge.distanceTravelled > 0);
  if (!lastTravelledEdge) return null;
  const from = nodeMap.get(lastTravelledEdge.fromNodeId);
  const to = nodeMap.get(lastTravelledEdge.toNodeId);
  if (!from || !to) return null;
  const progress = Math.min(
    1,
    Math.max(0, lastTravelledEdge.distanceTravelled / lastTravelledEdge.distance),
  );
  return {
    x: from.x + (to.x - from.x) * progress,
    y: from.y + (to.y - from.y) * progress,
  };
}

function phaseLabel(phase: RequestJourneyPhase): string {
  return phase === 'approach' ? 'Pickup' : 'Drop-off';
}

export default function RequestServiceJourneyMap({
  passenger,
  vehicleMovements,
  passengerEvents,
  currentTime,
}: RequestServiceJourneyMapProps) {
  const [edgeTooltip, setEdgeTooltip] = useState<JourneyEdgeTooltipState | null>(null);
  const journey = useMemo(
    () => buildRequestServiceJourney(
      passenger,
      vehicleMovements,
      passengerEvents,
      currentTime,
    ),
    [currentTime, passenger, passengerEvents, vehicleMovements],
  );
  const routeEdges = useMemo(
    () => [...journey.approachEdges, ...journey.onboardEdges],
    [journey.approachEdges, journey.onboardEdges],
  );
  const origin = nodeMap.get(passenger.originNodeId) ?? null;
  const destination = nodeMap.get(passenger.destinationNodeId) ?? null;
  const assignmentNode = journey.assignmentNodeId == null
    ? null
    : nodeMap.get(journey.assignmentNodeId) ?? null;
  const assignmentOverlapsEndpoint =
    journey.assignmentNodeId === passenger.originNodeId ||
    journey.assignmentNodeId === passenger.destinationNodeId;
  const currentVehiclePoint = passenger.deliveryTime == null
    ? latestTravelPoint(routeEdges)
    : null;
  const currentVehicleOverlapsEndpoint = currentVehiclePoint != null && (
    (origin != null && Math.hypot(
      currentVehiclePoint.x - origin.x,
      currentVehiclePoint.y - origin.y,
    ) < 0.1) ||
    (destination != null && Math.hypot(
      currentVehiclePoint.x - destination.x,
      currentVehiclePoint.y - destination.y,
    ) < 0.1)
  );
  const stopOffsets = useMemo(() => {
    const offsets = new Map<string, { x: number; y: number }>();
    const byNode = new Map<number, typeof journey.coRiderStops>();
    for (const stop of journey.coRiderStops) {
      const nodeStops = byNode.get(stop.nodeId) ?? [];
      nodeStops.push(stop);
      byNode.set(stop.nodeId, nodeStops);
    }
    for (const [nodeId, nodeStops] of byNode) {
      const angle = eventMarkerDirections.get(nodeId) ?? -Math.PI / 2;
      const directionX = Math.cos(angle);
      const directionY = Math.sin(angle);
      const tangentX = -directionY;
      const tangentY = directionX;
      nodeStops.forEach((stop, index) => {
        const tangentOffset = (index - (nodeStops.length - 1) / 2) *
          EVENT_MARKER_SPACING;
        offsets.set(stop.id, {
          x: directionX * EVENT_MARKER_DISTANCE + tangentX * tangentOffset,
          y: directionY * EVENT_MARKER_DISTANCE + tangentY * tangentOffset,
        });
      });
    }
    return offsets;
  }, [journey.coRiderStops]);
  const hasRoute = routeEdges.some(edge => edge.distanceTravelled > 0);

  const updateEdgeTooltip = (
    event: ReactMouseEvent<SVGLineElement>,
    edge: RequestJourneyEdge,
  ) => {
    const container = event.currentTarget.ownerSVGElement?.parentElement;
    if (!container) return;
    const bounds = container.getBoundingClientRect();
    const x = Math.min(bounds.width - 8, Math.max(8, event.clientX - bounds.left));
    const y = Math.min(bounds.height - 8, Math.max(8, event.clientY - bounds.top));
    setEdgeTooltip({
      edge,
      x,
      y,
      horizontalPlacement: x > bounds.width / 2 ? 'left' : 'right',
      verticalPlacement: y > bounds.height / 2 ? 'above' : 'below',
    });
  };

  return (
    <div className="request-service-journey">
      <div className="request-service-journey-svg-wrap">
        <svg
          className="request-service-journey-svg"
          viewBox={`-${PADDING} -${PADDING} ${MAP_WIDTH + PADDING * 2} ${MAP_HEIGHT + PADDING * 2}`}
          preserveAspectRatio="xMidYMid meet"
          aria-label={`Service journey for request R${passenger.id}`}
        >
          {undirectedLinks.map(link => {
            const from = nodeMap.get(link.from);
            const to = nodeMap.get(link.to);
            if (!from || !to) return null;
            return (
              <line
                key={`request-journey-base-${link.id}`}
                className="request-service-journey-base-link"
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
              />
            );
          })}

          {nodes.map(node => (
            <circle
              key={`request-journey-node-${node.id}`}
              className="request-service-journey-node"
              cx={node.x}
              cy={node.y}
              r={3.2}
            />
          ))}

          {journey.coRiderStops.map(stop => {
            const node = nodeMap.get(stop.nodeId);
            const offset = stopOffsets.get(stop.id);
            if (!node || !offset) return null;
            const length = Math.hypot(offset.x, offset.y);
            if (length <= 0) return null;
            const directionX = offset.x / length;
            const directionY = offset.y / length;
            return (
              <line
                key={`request-journey-stop-link-${stop.id}`}
                className="request-service-journey-stop-link"
                x1={node.x + directionX * 4}
                y1={node.y + directionY * 4}
                x2={node.x + offset.x - directionX * 4}
                y2={node.y + offset.y - directionY * 4}
              />
            );
          })}

          {routeEdges.map(edge => {
            const line = edgeLine(edge);
            if (!line || edge.distanceTravelled <= 0) return null;
            const actual = travelledLine(edge, line);
            return (
              <g
                key={edge.id}
                className={`request-service-journey-edge is-${edge.phase}`}
              >
                <line
                  {...actual}
                  className="request-service-journey-edge-actual"
                />
                <line
                  {...actual}
                  className="request-service-journey-edge-hit"
                  onMouseEnter={event => updateEdgeTooltip(event, edge)}
                  onMouseMove={event => updateEdgeTooltip(event, edge)}
                  onMouseLeave={() => setEdgeTooltip(null)}
                />
              </g>
            );
          })}

          {journey.coRiderStops.map(stop => {
            const node = nodeMap.get(stop.nodeId);
            if (!node) return null;
            const offset = stopOffsets.get(stop.id) ?? { x: 0, y: -8 };
            const x = node.x + offset.x;
            const y = node.y + offset.y;
            const requestLabels = stop.requestIds.map(requestId => `R${requestId}`).join(', ');
            return (
              <g
                key={stop.id}
                className={`request-service-journey-stop is-${stop.type}`}
              >
                <rect x={x - 3.2} y={y - 3.2} width={6.4} height={6.4} />
                <title>
                  {`${stop.type === 'pickup' ? 'Pickup' : 'Drop-off'} ${requestLabels} at N${stop.nodeId}, t=${formatTime(stop.time)}`}
                </title>
              </g>
            );
          })}

          {assignmentNode && journey.vehicleId != null ? (
            <g className={`request-service-journey-assignment-vehicle${assignmentOverlapsEndpoint ? ' is-endpoint-overlap' : ''}`}>
              <circle
                cx={assignmentNode.x}
                cy={assignmentNode.y}
                r={assignmentOverlapsEndpoint ? 8.4 : 6.1}
              >
                <title>
                  {`V${journey.vehicleId} at assignment, N${journey.assignmentNodeId}, t=${formatTime(journey.assignmentTime)}`}
                </title>
              </circle>
              {!assignmentOverlapsEndpoint ? (
                <text x={assignmentNode.x} y={assignmentNode.y + 0.35}>
                  V{journey.vehicleId}
                </text>
              ) : null}
            </g>
          ) : null}

          {currentVehiclePoint && journey.vehicleId != null ? (
            <g className={`request-service-journey-current-vehicle${currentVehicleOverlapsEndpoint ? ' is-endpoint-overlap' : ''}`}>
              <circle
                cx={currentVehiclePoint.x}
                cy={currentVehiclePoint.y}
                r={currentVehicleOverlapsEndpoint ? 8.4 : 6.1}
              >
                <title>{`Current V${journey.vehicleId} position at t=${formatTime(currentTime)}`}</title>
              </circle>
              {!currentVehicleOverlapsEndpoint ? (
                <text x={currentVehiclePoint.x} y={currentVehiclePoint.y + 0.35}>
                  V{journey.vehicleId}
                </text>
              ) : null}
            </g>
          ) : null}

          {origin ? (
            <g className="request-service-journey-endpoint is-pickup">
              <rect
                x={origin.x - 5.8}
                y={origin.y - 5.8}
                width={11.6}
                height={11.6}
              >
                <title>{`Selected R${passenger.id} pickup at N${passenger.originNodeId}`}</title>
              </rect>
            </g>
          ) : null}

          {destination ? (
            <g className="request-service-journey-endpoint is-dropoff">
              <rect
                x={destination.x - 5.8}
                y={destination.y - 5.8}
                width={11.6}
                height={11.6}
              >
                <title>{`Selected R${passenger.id} drop-off at N${passenger.destinationNodeId}`}</title>
              </rect>
            </g>
          ) : null}
        </svg>

        {edgeTooltip ? (
          <div
            className={`map-hover-tooltip request-service-journey-tooltip is-${edgeTooltip.horizontalPlacement} is-${edgeTooltip.verticalPlacement}`}
            style={{ left: edgeTooltip.x, top: edgeTooltip.y }}
            role="tooltip"
          >
            <div className="map-hover-tooltip-values">
              <div>
                <span>Phase</span>
                <b>{phaseLabel(edgeTooltip.edge.phase)}</b>
              </div>
              <div>
                <span>Edge</span>
                <b>N{edgeTooltip.edge.fromNodeId} → N{edgeTooltip.edge.toNodeId}</b>
              </div>
              <div>
                <span>Time</span>
                <b>
                  t={formatTime(edgeTooltip.edge.edgeStartTime)}-{formatTime(edgeTooltip.edge.edgeEndTime)}
                </b>
              </div>
              <div>
                <span>Edge time</span>
                <b>{formatValue(edgeTooltip.edge.travelTime)}</b>
              </div>
              <div>
                <span>Distance</span>
                <b>{formatValue(edgeTooltip.edge.distanceTravelled)}</b>
              </div>
            </div>
          </div>
        ) : null}

        {!hasRoute ? (
          <p className="request-service-journey-empty">
            No travelled movement is available for this request.
          </p>
        ) : null}
      </div>

      <div className="request-service-journey-footer">
        <div className="request-service-journey-legend" aria-label="Request journey legend">
          <span><i className="is-approach" />Pickup</span>
          <span><i className="is-onboard" />Drop-off</span>
          <span><i className="is-vehicle-symbol" />Vehicle</span>
          <span><i className="is-selected-request-symbol" />Selected request</span>
          <span><i className="is-other-request-symbol" />Other request event</span>
        </div>
      </div>
    </div>
  );
}
