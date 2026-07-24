import {
  useEffect,
  useMemo,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';

import { nodeMap, nodes, undirectedLinks } from '../data/siouxFallsNetwork';
import {
  CANCELLATION_ANALYSIS_COLORS,
} from '../config';
import type {
  Passenger,
  ReplayDispatchDecision,
  SimulationState,
  Vehicle,
} from '../types/simulation';
import { vehiclePosition } from '../utils/networkGeometry';
import { inferVehicleTimelineStatus } from '../utils/vehicleTemporal';

interface CancellationContextMapProps {
  frame: SimulationState;
  selectedRequestId: number;
  dispatchDecisions?: ReplayDispatchDecision[];
  dispatchDecisionFocus?: ReplayDispatchDecision | null;
  appearance?: 'dashboard' | 'paper';
}

interface WaitingRequestsTooltipState {
  nodeId: number;
  requests: Passenger[];
  x: number;
  y: number;
  horizontalPlacement: 'left' | 'right';
  verticalPlacement: 'above' | 'below';
}

const PADDING = 22;
const MAP_WIDTH = 200;
const MAP_HEIGHT = 180;
const REQUEST_MARKER_SIZE = 12;
const SELECTED_REQUEST_MARKER_SIZE = 15;
const DROPOFF_TARGET_WIDTH = 14;
const DROPOFF_TARGET_HEIGHT = 12;
const SELECTED_REQUEST_COLOR = CANCELLATION_ANALYSIS_COLORS.request.selected;
const OTHER_REQUEST_COLOR = CANCELLATION_ANALYSIS_COLORS.request.waiting;

function vehicleColor(status: Vehicle['status']): string {
  return CANCELLATION_ANALYSIS_COLORS.vehicle[status];
}

function waitingRequestsByOrigin(
  passengers: Passenger[],
  excludedRequestIds: Set<number>,
): Map<number, Passenger[]> {
  const requestsByNode = new Map<number, Passenger[]>();
  for (const passenger of passengers) {
    if (
      excludedRequestIds.has(passenger.id) ||
      passenger.status !== 'waiting' ||
      passenger.assignedVehicleId != null
    ) {
      continue;
    }
    const requests = requestsByNode.get(passenger.originNodeId) ?? [];
    requests.push(passenger);
    requestsByNode.set(passenger.originNodeId, requests);
  }
  return requestsByNode;
}

export default function CancellationContextMap({
  frame,
  selectedRequestId,
  dispatchDecisions = [],
  dispatchDecisionFocus = null,
  appearance = 'dashboard',
}: CancellationContextMapProps) {
  const [waitingRequestsTooltip, setWaitingRequestsTooltip] =
    useState<WaitingRequestsTooltipState | null>(null);
  const selectedRequest = frame.passengers.find(
    passenger => passenger.id === selectedRequestId,
  ) ?? null;
  const decisionRequest = dispatchDecisionFocus?.requestId == null
    ? null
    : frame.passengers.find(
      passenger => passenger.id === dispatchDecisionFocus.requestId,
    ) ?? null;
  const focusedPickupRequestId =
    dispatchDecisionFocus?.actionType === 'pickup'
      ? dispatchDecisionFocus.requestId
      : null;
  const priorRoundPickupRequestIds = useMemo(() => new Set(
    dispatchDecisionFocus == null
      ? []
      : dispatchDecisions.flatMap(decision => (
        decision.time === dispatchDecisionFocus.time &&
        decision.decisionRound < dispatchDecisionFocus.decisionRound &&
        decision.actionType === 'pickup' &&
        decision.requestId != null
          ? [decision.requestId]
          : []
      )),
  ), [dispatchDecisionFocus, dispatchDecisions]);
  const excludedRequestIds = useMemo(() => {
    return new Set([selectedRequestId, ...priorRoundPickupRequestIds]);
  }, [
    priorRoundPickupRequestIds,
    selectedRequestId,
  ]);
  const otherRequestsByNode = useMemo(
    () => waitingRequestsByOrigin(frame.passengers, excludedRequestIds),
    [excludedRequestIds, frame.passengers],
  );
  const decisionTargetNode =
    decisionRequest && dispatchDecisionFocus?.actionType === 'dropoff'
      ? nodeMap.get(decisionRequest.destinationNodeId) ?? null
    : null;

  useEffect(() => {
    setWaitingRequestsTooltip(null);
  }, [dispatchDecisionFocus, frame.metrics.currentTime, selectedRequestId]);

  const updateWaitingRequestsTooltip = (
    event: ReactMouseEvent<SVGRectElement>,
    nodeId: number,
    requests: Passenger[],
  ) => {
    const container = event.currentTarget.ownerSVGElement?.parentElement;
    if (!container) return;
    const bounds = container.getBoundingClientRect();
    const x = Math.min(bounds.width - 8, Math.max(8, event.clientX - bounds.left));
    const y = Math.min(bounds.height - 8, Math.max(8, event.clientY - bounds.top));
    setWaitingRequestsTooltip({
      nodeId,
      requests,
      x,
      y,
      horizontalPlacement: x > bounds.width / 2 ? 'left' : 'right',
      verticalPlacement: y > bounds.height / 2 ? 'above' : 'below',
    });
  };

  return (
    <div className={`cancellation-context-map${appearance === 'paper' ? ' is-paper' : ''}`}>
      <div className="cancellation-context-svg-wrap">
        <svg
          className="cancellation-context-svg"
          viewBox={`-${PADDING} -${PADDING} ${MAP_WIDTH + PADDING * 2} ${MAP_HEIGHT + PADDING * 2}`}
          preserveAspectRatio="xMidYMid meet"
          aria-label={`Vehicle and request positions at t=${frame.metrics.currentTime}`}
        >
          {undirectedLinks.map(link => {
            const from = nodeMap.get(link.from);
            const to = nodeMap.get(link.to);
            if (!from || !to) return null;
            return (
              <line
                key={link.id}
                className="cancellation-context-link"
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
              />
            );
          })}

          {nodes.map(node => (
            <circle
              key={node.id}
              className="cancellation-context-node"
              cx={node.x}
              cy={node.y}
              r={3.2}
            />
          ))}

          {[...otherRequestsByNode].map(([nodeId, requests]) => {
            const node = nodeMap.get(nodeId);
            if (!node) return null;
            const markerOffset = REQUEST_MARKER_SIZE / 2;
            const containsFocusedPickupRequest =
              focusedPickupRequestId != null &&
              requests.some(request => request.id === focusedPickupRequestId);
            return (
              <g key={`requests-${nodeId}`} className="cancellation-context-other-request">
                <rect
                  x={node.x - markerOffset}
                  y={node.y - markerOffset}
                  width={REQUEST_MARKER_SIZE}
                  height={REQUEST_MARKER_SIZE}
                  fill={
                    containsFocusedPickupRequest
                      ? CANCELLATION_ANALYSIS_COLORS.decision.pickup
                      : OTHER_REQUEST_COLOR
                  }
                  onMouseEnter={event => updateWaitingRequestsTooltip(event, nodeId, requests)}
                  onMouseMove={event => updateWaitingRequestsTooltip(event, nodeId, requests)}
                  onMouseLeave={() => setWaitingRequestsTooltip(null)}
                />
              </g>
            );
          })}

          {selectedRequest ? (() => {
            const origin = nodeMap.get(selectedRequest.originNodeId);
            if (!origin) return null;
            const markerOffset = SELECTED_REQUEST_MARKER_SIZE / 2;
            return (
              <g className="cancellation-context-selected-request">
                <rect
                  x={origin.x - markerOffset}
                  y={origin.y - markerOffset}
                  width={SELECTED_REQUEST_MARKER_SIZE}
                  height={SELECTED_REQUEST_MARKER_SIZE}
                  fill={SELECTED_REQUEST_COLOR}
                  transform={`rotate(45 ${origin.x} ${origin.y})`}
                />
              </g>
            );
          })() : null}

          {decisionTargetNode && decisionRequest && dispatchDecisionFocus?.actionType === 'dropoff' ? (
            <g
              className="cancellation-context-decision-target is-dropoff"
              style={{
                color: CANCELLATION_ANALYSIS_COLORS.decision.dropoff,
              }}
              role="img"
              aria-label={`Observed drop-off node N${decisionTargetNode.id}`}
            >
              <polygon
                points={[
                  `${decisionTargetNode.x - DROPOFF_TARGET_WIDTH / 2},${decisionTargetNode.y - DROPOFF_TARGET_HEIGHT}`,
                  `${decisionTargetNode.x + DROPOFF_TARGET_WIDTH / 2},${decisionTargetNode.y - DROPOFF_TARGET_HEIGHT}`,
                  `${decisionTargetNode.x},${decisionTargetNode.y}`,
                ].join(' ')}
              />
            </g>
          ) : null}

          {frame.vehicles.map(vehicle => {
            const position = vehiclePosition(vehicle);
            const isFocused = dispatchDecisionFocus?.vehicleId === vehicle.id;
            const effectiveStatus = inferVehicleTimelineStatus(
              frame,
              vehicle.id,
              vehicle.status,
            );
            const displayedStatus = isFocused && dispatchDecisionFocus?.actionType === 'pickup'
              ? 'picking_up'
              : isFocused && dispatchDecisionFocus?.actionType === 'dropoff'
                ? 'carrying'
                : effectiveStatus;
            const markerColor = isFocused
              ? vehicleColor(displayedStatus)
              : CANCELLATION_ANALYSIS_COLORS.feasibility.inService;
            return (
              <g
                key={vehicle.id}
                className={`cancellation-context-vehicle${isFocused ? ' is-decision-focus' : ''}`}
                pointerEvents="none"
              >
                <circle
                  className="cancellation-context-vehicle-marker"
                  cx={position.x}
                  cy={position.y}
                  r={6.5}
                  fill={markerColor}
                />
                <text
                  x={position.x}
                  y={position.y + 0.35}
                  fill="#111827"
                >
                  V{vehicle.id}
                </text>
              </g>
            );
          })}

        </svg>
        {waitingRequestsTooltip ? (
          <div
            className={`map-hover-tooltip cancellation-context-tooltip is-${waitingRequestsTooltip.horizontalPlacement} is-${waitingRequestsTooltip.verticalPlacement}`}
            style={{ left: waitingRequestsTooltip.x, top: waitingRequestsTooltip.y }}
            role="tooltip"
          >
            <div className="map-hover-tooltip-values">
              <div>
                <span>Node</span>
                <b>N{waitingRequestsTooltip.nodeId}</b>
              </div>
              <div>
                <span>Waiting</span>
                <b>{waitingRequestsTooltip.requests.length}</b>
              </div>
              <div>
                <span>Requests</span>
                <b>
                  {waitingRequestsTooltip.requests
                    .map(request => request.id)
                    .sort((left, right) => left - right)
                    .map(requestId => `R${requestId}`)
                    .join(', ')}
                </b>
              </div>
            </div>
          </div>
        ) : null}
      </div>
      <div className="cancellation-context-footer">
        {/* <span><i style={{ background: CANCELLATION_ANALYSIS_COLORS.feasibility.inService }} />Vehicle</span> */}
        <span><i style={{ background: CANCELLATION_ANALYSIS_COLORS.vehicle.picking_up }} />Picking up</span>
        <span><i style={{ background: CANCELLATION_ANALYSIS_COLORS.vehicle.carrying }} />Carrying</span>
        <span><i className="is-request" style={{ background: OTHER_REQUEST_COLOR }} />Waiting request</span>
        <span><i className="is-selected-request" style={{ background: SELECTED_REQUEST_COLOR }} />Selected request</span>
        {/* {dispatchDecisionFocus ? (
          <span><i className="is-focused-vehicle" />Focused vehicle</span>
        ) : null} */}
        {dispatchDecisionFocus?.requestId != null ? (
          <span>
            {dispatchDecisionFocus.actionType === 'pickup' ? (
              <>
                <i
                  className="is-request"
                  style={{ background: CANCELLATION_ANALYSIS_COLORS.decision.pickup }}
                />
                Observed pickup request
              </>
            ) : (
              <>
                <svg
                  className="cancellation-context-footer-target-icon"
                  viewBox="0 0 12 11"
                  style={{ color: CANCELLATION_ANALYSIS_COLORS.decision.dropoff }}
                  aria-hidden="true"
                >
                  <polygon points="1,1 11,1 6,10" />
                </svg>
                Observed drop-off destination
              </>
            )}
          </span>
        ) : null}
      </div>
    </div>
  );
}
