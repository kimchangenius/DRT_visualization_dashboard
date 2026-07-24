import { useMemo, useState, type MouseEvent } from 'react';

import {
  REQUEST_EVENT_COLORS,
  VEHICLE_STATUS_COLORS,
} from '../config';
import { nodeMap, nodes, undirectedLinks } from '../data/siouxFallsNetwork';
import type {
  VehicleIntervalAnalysis,
  VehicleIntervalEventGroup,
  VehicleIntervalRouteSegment,
} from '../utils/vehicleIntervalAnalysis';

interface VehicleIntervalJourneyProps {
  analysis: VehicleIntervalAnalysis;
}

interface RouteGeometry {
  segment: VehicleIntervalRouteSegment;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface EventGeometry {
  event: VehicleIntervalEventGroup;
  x: number;
  y: number;
  nodeX: number;
  nodeY: number;
}

type TooltipDatum =
  | { kind: 'route'; route: RouteGeometry }
  | { kind: 'event'; event: VehicleIntervalEventGroup };

interface TooltipState {
  datum: TooltipDatum;
  x: number;
  y: number;
  horizontalPlacement: 'left' | 'right';
  verticalPlacement: 'above' | 'below';
}

const PADDING = 22;
const MAP_WIDTH = 200;
const MAP_HEIGHT = 180;
const ROUTE_OFFSET = 1.25;
const EVENT_OFFSET = 11;
const EVENT_OFFSET_STEP = 7;

function formatValue(value: number): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: value < 1 ? 2 : 1,
  });
}

function formatTime(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function phaseLabel(
  phase: VehicleIntervalRouteSegment['phase'],
): string {
  return phase === 'picking_up' ? 'Pickup travel' : 'Carrying travel';
}

function routeGeometry(
  segment: VehicleIntervalRouteSegment,
): RouteGeometry | null {
  const from = nodeMap.get(segment.fromNodeId);
  const to = nodeMap.get(segment.toNodeId);
  if (!from || !to) return null;

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  const offsetDirection = segment.phase === 'picking_up' ? -1 : 1;
  const offsetX = length > 0
    ? (-dy / length) * ROUTE_OFFSET * offsetDirection
    : 0;
  const offsetY = length > 0
    ? (dx / length) * ROUTE_OFFSET * offsetDirection
    : 0;

  return {
    segment,
    x1: from.x + dx * segment.startFraction + offsetX,
    y1: from.y + dy * segment.startFraction + offsetY,
    x2: from.x + dx * segment.endFraction + offsetX,
    y2: from.y + dy * segment.endFraction + offsetY,
  };
}

function eventGeometries(
  events: readonly VehicleIntervalEventGroup[],
): EventGeometry[] {
  const nodeEventCounts = new Map<number, number>();
  return events.flatMap(event => {
    const node = nodeMap.get(event.nodeId);
    if (!node) return [];
    const nodeEventIndex = nodeEventCounts.get(event.nodeId) ?? 0;
    nodeEventCounts.set(event.nodeId, nodeEventIndex + 1);
    const angle = -Math.PI / 2 + (nodeEventIndex % 6) * (Math.PI / 3);
    const radius = EVENT_OFFSET +
      Math.floor(nodeEventIndex / 6) * EVENT_OFFSET_STEP;
    return [{
      event,
      x: node.x + Math.cos(angle) * radius,
      y: node.y + Math.sin(angle) * radius,
      nodeX: node.x,
      nodeY: node.y,
    }];
  });
}

function requestList(requestIds: readonly number[]): string {
  return requestIds.map(requestId => `R${requestId}`).join(', ');
}

export default function VehicleIntervalJourney({
  analysis,
}: VehicleIntervalJourneyProps) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const routeGeometries = useMemo(
    () => analysis.routeSegments.flatMap(segment => {
      const geometry = routeGeometry(segment);
      return geometry ? [geometry] : [];
    }),
    [analysis.routeSegments],
  );
  const intervalEventGeometries = useMemo(
    () => eventGeometries(analysis.eventGroups),
    [analysis.eventGroups],
  );

  const updateTooltip = (
    event: MouseEvent<SVGElement>,
    datum: TooltipDatum,
  ) => {
    const container = event.currentTarget.ownerSVGElement?.parentElement;
    if (!container) return;
    const bounds = container.getBoundingClientRect();
    const x = Math.min(bounds.width - 8, Math.max(8, event.clientX - bounds.left));
    const y = Math.min(bounds.height - 8, Math.max(8, event.clientY - bounds.top));
    setTooltip({
      datum,
      x,
      y,
      horizontalPlacement: x > bounds.width / 2 ? 'left' : 'right',
      verticalPlacement: y > bounds.height / 2 ? 'above' : 'below',
    });
  };

  return (
    <div className="vehicle-interval-journey">
      <div className="vehicle-interval-journey-map">
        <svg
          className="vehicle-interval-journey-svg"
          viewBox={`-${PADDING} -${PADDING} ${MAP_WIDTH + PADDING * 2} ${MAP_HEIGHT + PADDING * 2}`}
          preserveAspectRatio="xMidYMid meet"
          aria-label={`Vehicle V${analysis.vehicleId} journey from t=${analysis.startTime} to t=${analysis.endTime}`}
        >
          {undirectedLinks.map(link => {
            const from = nodeMap.get(link.from);
            const to = nodeMap.get(link.to);
            if (!from || !to) return null;
            return (
              <line
                key={`interval-base-${link.id}`}
                className="vehicle-interval-journey-base-link"
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
              />
            );
          })}

          {nodes.map(node => (
            <circle
              key={`interval-node-${node.id}`}
              className="vehicle-interval-journey-node"
              cx={node.x}
              cy={node.y}
              r={3.2}
            />
          ))}

          {routeGeometries.map(route => {
            const isPickup = route.segment.phase === 'picking_up';
            const stroke = isPickup
              ? VEHICLE_STATUS_COLORS.picking_up
              : VEHICLE_STATUS_COLORS.carrying;
            return (
              <g
                key={`${route.segment.id}-${route.segment.sequence}`}
                className={`vehicle-interval-journey-route is-${route.segment.phase}`}
              >
                <line
                  className="vehicle-interval-journey-route-visible"
                  x1={route.x1}
                  y1={route.y1}
                  x2={route.x2}
                  y2={route.y2}
                  stroke={stroke}
                />
                <line
                  className="vehicle-interval-journey-route-hit"
                  x1={route.x1}
                  y1={route.y1}
                  x2={route.x2}
                  y2={route.y2}
                  onMouseEnter={event => updateTooltip(event, { kind: 'route', route })}
                  onMouseMove={event => updateTooltip(event, { kind: 'route', route })}
                  onMouseLeave={() => setTooltip(null)}
                />
              </g>
            );
          })}

          {intervalEventGeometries.map(({ event, x, y, nodeX, nodeY }) => (
            <g
              key={`interval-event-${event.order}`}
              className={`vehicle-interval-journey-event is-${event.type}`}
              onMouseEnter={mouseEvent => updateTooltip(
                mouseEvent,
                { kind: 'event', event },
              )}
              onMouseMove={mouseEvent => updateTooltip(
                mouseEvent,
                { kind: 'event', event },
              )}
              onMouseLeave={() => setTooltip(null)}
            >
              <line
                className="vehicle-interval-journey-event-link"
                x1={nodeX}
                y1={nodeY}
                x2={x}
                y2={y}
              />
              {event.type === 'pickup' ? (
                <path
                  d={`M${x - 5.4},${y - 3.2} L${x + 5.4},${y - 3.2} L${x},${y + 5.4} Z`}
                  fill={REQUEST_EVENT_COLORS.pickup}
                />
              ) : (
                <path
                  d={`M${x - 5.4},${y - 3.2} L${x + 5.4},${y - 3.2} L${x},${y + 5.4} Z`}
                  fill="#fff"
                  stroke={REQUEST_EVENT_COLORS.dropoff}
                />
              )}
              <text x={x} y={y + 1.35}>{event.order}</text>
            </g>
          ))}

          {analysis.startPoint ? (
            <g className="vehicle-interval-journey-boundary is-start">
              <circle
                cx={analysis.startPoint.x}
                cy={analysis.startPoint.y}
                r={6.4}
              />
              <text
                x={analysis.startPoint.x}
                y={analysis.startPoint.y + 1.4}
              >
                S
              </text>
            </g>
          ) : null}

          {analysis.endPoint ? (
            <g className="vehicle-interval-journey-boundary is-end">
              <circle
                cx={analysis.endPoint.x}
                cy={analysis.endPoint.y}
                r={6.4}
              />
              <text
                x={analysis.endPoint.x}
                y={analysis.endPoint.y + 1.4}
              >
                E
              </text>
            </g>
          ) : null}
        </svg>

        {tooltip ? (
          <div
            className={`map-hover-tooltip vehicle-interval-journey-tooltip is-${tooltip.horizontalPlacement} is-${tooltip.verticalPlacement}`}
            style={{ left: tooltip.x, top: tooltip.y }}
            role="tooltip"
          >
            {tooltip.datum.kind === 'route' ? (
              <div className="map-hover-tooltip-values">
                <div>
                  <span>Phase</span>
                  <b>{phaseLabel(tooltip.datum.route.segment.phase)}</b>
                </div>
                <div>
                  <span>Request</span>
                  <b>R{tooltip.datum.route.segment.requestId}</b>
                </div>
                <div>
                  <span>Edge</span>
                  <b>
                    N{tooltip.datum.route.segment.fromNodeId}
                    {' → '}
                    N{tooltip.datum.route.segment.toNodeId}
                  </b>
                </div>
                <div>
                  <span>Time</span>
                  <b>
                    t={formatTime(tooltip.datum.route.segment.startTime)}
                    {'–'}
                    {formatTime(tooltip.datum.route.segment.endTime)}
                  </b>
                </div>
                <div>
                  <span>Weighted distance</span>
                  <b>{formatValue(tooltip.datum.route.segment.distance)}</b>
                </div>
              </div>
            ) : (
              <div className="map-hover-tooltip-values">
                <div>
                  <span>Event</span>
                  <b>{tooltip.datum.event.type === 'pickup' ? 'Pickup' : 'Drop-off'}</b>
                </div>
                <div>
                  <span>Request</span>
                  <b>{requestList(tooltip.datum.event.requestIds)}</b>
                </div>
                <div>
                  <span>Time</span>
                  <b>t={formatTime(tooltip.datum.event.time)}</b>
                </div>
                <div>
                  <span>Node</span>
                  <b>N{tooltip.datum.event.nodeId}</b>
                </div>
              </div>
            )}
          </div>
        ) : null}

        {routeGeometries.length === 0 ? (
          <p className="vehicle-interval-journey-empty">
            No vehicle movement occurred in this interval.
          </p>
        ) : null}
      </div>
      <div className="vehicle-interval-journey-legend" aria-label="Vehicle interval journey legend">
        <div className="vehicle-interval-journey-legend-group">
          <span><i className="is-start" />Start</span>
          <span><i className="is-end" />End</span>
        </div>
        <div className="vehicle-interval-journey-legend-group">
          <span><i className="is-pickup-event" />Pickup</span>
          <span><i className="is-dropoff-event" />Drop-off</span>
        </div>
      </div>
    </div>
  );
}
