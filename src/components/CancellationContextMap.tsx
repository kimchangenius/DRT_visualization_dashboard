import { useMemo } from 'react';

import { nodeMap, nodes, undirectedLinks } from '../data/siouxFallsNetwork';
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

const PADDING = 22;
const MAP_WIDTH = 200;
const MAP_HEIGHT = 180;
const SELECTED_REQUEST_SIZE = 16;
const OTHER_REQUEST_SIZE = 12;
const SELECTED_REQUEST_COLOR = '#bb5566';
const OTHER_REQUEST_COLOR = '#56b4e9';

function vehicleColor(status: Vehicle['status']): string {
  if (status === 'picking_up') return '#e69f00';
  if (status === 'carrying') return '#009e73';
  if (status === 'repositioning') return '#7f7f7f';
  return '#0072b2';
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
  const selectedRequest = frame.passengers.find(
    passenger => passenger.id === selectedRequestId,
  ) ?? null;
  const decisionRequest = dispatchDecisionFocus?.requestId == null
    ? null
    : frame.passengers.find(
      passenger => passenger.id === dispatchDecisionFocus.requestId,
    ) ?? null;
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
    const ids = new Set([selectedRequestId, ...priorRoundPickupRequestIds]);
    if (
      dispatchDecisionFocus?.actionType === 'pickup' &&
      dispatchDecisionFocus.requestId != null
    ) {
      ids.add(dispatchDecisionFocus.requestId);
    }
    return ids;
  }, [
    dispatchDecisionFocus?.actionType,
    dispatchDecisionFocus?.requestId,
    priorRoundPickupRequestIds,
    selectedRequestId,
  ]);
  const otherRequestsByNode = useMemo(
    () => waitingRequestsByOrigin(frame.passengers, excludedRequestIds),
    [excludedRequestIds, frame.passengers],
  );
  const decisionTargetNode = decisionRequest && dispatchDecisionFocus
    ? nodeMap.get(
      dispatchDecisionFocus.actionType === 'dropoff'
        ? decisionRequest.destinationNodeId
        : decisionRequest.originNodeId,
    ) ?? null
    : null;

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

          {selectedRequest ? (() => {
            const origin = nodeMap.get(selectedRequest.originNodeId);
            if (!origin) return null;
            const markerOffset = SELECTED_REQUEST_SIZE / 2;
            return (
              <g className="cancellation-context-selected-request">
                <rect
                  x={origin.x - markerOffset}
                  y={origin.y - markerOffset}
                  width={SELECTED_REQUEST_SIZE}
                  height={SELECTED_REQUEST_SIZE}
                  transform={`rotate(45 ${origin.x} ${origin.y})`}
                >
                  <title>{`Selected R${selectedRequest.id}: origin N${selectedRequest.originNodeId}`}</title>
                </rect>
              </g>
            );
          })() : null}

          {[...otherRequestsByNode].map(([nodeId, requests]) => {
            const node = nodeMap.get(nodeId);
            if (!node) return null;
            const requestIds = requests.map(request => `R${request.id}`).join(', ');
            const markerOffset = OTHER_REQUEST_SIZE / 2;
            return (
              <g key={`requests-${nodeId}`} className="cancellation-context-other-request">
                <rect
                  x={node.x - markerOffset}
                  y={node.y - markerOffset}
                  width={OTHER_REQUEST_SIZE}
                  height={OTHER_REQUEST_SIZE}
                >
                  <title>{`${requestIds}: waiting at N${nodeId}`}</title>
                </rect>
              </g>
            );
          })}

          {decisionTargetNode && decisionRequest && dispatchDecisionFocus ? (
            <g className={`cancellation-context-decision-target is-${dispatchDecisionFocus.actionType}`}>
              <rect
                x={decisionTargetNode.x - 7}
                y={decisionTargetNode.y - 7}
                width="14"
                height="14"
              >
                <title>
                  {`${dispatchDecisionFocus.actionType === 'pickup' ? 'Pickup origin' : 'Drop-off destination'} for R${decisionRequest.id}`}
                </title>
              </rect>
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
            return (
              <g
                key={vehicle.id}
                className={`cancellation-context-vehicle${isFocused ? ' is-decision-focus' : ''}`}
              >
                {isFocused ? (
                  <circle
                    className="cancellation-context-vehicle-focus-ring"
                    cx={position.x}
                    cy={position.y}
                    r={9}
                  />
                ) : null}
                <circle
                  cx={position.x}
                  cy={position.y}
                  r={6.5}
                  fill={vehicleColor(displayedStatus)}
                >
                  <title>{`V${vehicle.id}: ${displayedStatus.replace('_', ' ')} at t=${frame.metrics.currentTime}`}</title>
                </circle>
                <text x={position.x} y={position.y + 0.35}>V{vehicle.id}</text>
              </g>
            );
          })}

          {[...otherRequestsByNode].map(([nodeId, requests]) => {
            const node = nodeMap.get(nodeId);
            if (!node) return null;
            const badgeX = node.x + 7;
            const badgeY = node.y - 7;
            return (
              <g key={`request-count-${nodeId}`} className="cancellation-context-request-count">
                <circle cx={badgeX} cy={badgeY} r={4.2} />
                <text x={badgeX} y={badgeY + 0.35}>{requests.length}</text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="cancellation-context-footer">
        <span><i style={{ background: '#0072b2' }} />Idle</span>
        <span><i style={{ background: '#e69f00' }} />Picking up</span>
        <span><i style={{ background: '#009e73' }} />Carrying</span>
        <span><i className="is-request" style={{ background: OTHER_REQUEST_COLOR }} />Other waiting requests</span>
        <span><i className="is-selected-request" style={{ background: SELECTED_REQUEST_COLOR }} />Selected request</span>
        {dispatchDecisionFocus ? (
          <span><i className="is-focused-vehicle" />Focused vehicle</span>
        ) : null}
        {dispatchDecisionFocus?.requestId != null ? (
          <span>
            <i className={`is-decision-target is-${dispatchDecisionFocus.actionType}`} />
            {dispatchDecisionFocus.actionType === 'pickup' ? 'Observed pickup target' : 'Observed drop-off target'}
          </span>
        ) : null}
      </div>
    </div>
  );
}
