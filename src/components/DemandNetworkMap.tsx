import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { nodeMap, nodes, undirectedLinks } from '../data/siouxFallsNetwork';
import {
  CANCELLATION_ANALYSIS_COLORS,
  REQUEST_OUTCOME_COLORS,
  VEHICLE_STATUS_COLORS,
} from '../config';
import type {
  CancellationFeasibilityPoint,
  Passenger,
  ReplayDispatchDecision,
} from '../types/simulation';

export interface CancellationAnalysisContext {
  requestId: number;
  startTime: number;
  endTime: number;
}

export interface DemandNodeSelection {
  nodeId: number;
  passengers: Passenger[];
}

export type AcceptedNodeSelection = DemandNodeSelection;
export type CancelledNodeSelection = DemandNodeSelection;

interface DemandNetworkMapProps {
  passengers: Passenger[];
  replayTime: number;
  comparisonPassengers?: Passenger[];
  comparisonReplayTime?: number;
  title?: string;
  embedded?: boolean;
  hideTitle?: boolean;
  showNodeLabels?: boolean;
  appearance?: 'dashboard' | 'paper';
  dispatchDecisions?: ReplayDispatchDecision[];
  selectedDispatchDecision?: ReplayDispatchDecision | null;
  onSelectCancellationContext?: (context: CancellationAnalysisContext) => void;
  onSelectDispatchDecision?: (decision: ReplayDispatchDecision | null) => void;
  onCloseCancellationContext?: () => void;
  selectedCancellationNodeId?: number | null;
  selectedAcceptedNodeId?: number | null;
  showCancellationDiagnostics?: boolean;
  onCancelledNodeSelectionChange?: (selection: CancelledNodeSelection | null) => void;
  onAcceptedNodeSelectionChange?: (selection: AcceptedNodeSelection | null) => void;
}

interface NodeDemand {
  nodeId: number;
  total: number;
  accepted: number;
  cancelled: number;
  pending: number;
}

interface DiagnosticsPosition {
  x: number;
  y: number;
}

interface DiagnosticsDragState {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
}

interface DemandNodeTooltipState {
  nodeId: number;
  highlightedOutcome: 'accepted' | 'cancelled' | null;
  x: number;
  y: number;
  horizontalPlacement: 'left' | 'right';
  verticalPlacement: 'above' | 'below';
}

const PADDING = 22;
const MAP_WIDTH = 200;
const MAP_HEIGHT = 180;
const CANDIDATE_TRACK_MIN_HEIGHT = 38;
const DECISION_MARKER_WIDTH = 34;
const DECISION_MARKER_HEIGHT = 23;
const DECISION_MARKER_STACK_STEP = 21;
const DECISION_MARKER_STACK_PADDING = 8;
// ColorBrewer Set1 outcomes do not reuse operational event hues.
const ACCEPT_COLOR = REQUEST_OUTCOME_COLORS.accepted;
const PENDING_COLOR = REQUEST_OUTCOME_COLORS.pending;
const CANCELLED_COLOR = REQUEST_OUTCOME_COLORS.cancelled;
const CANCELLATION_CATEGORY_META = {
  deferred: {
    label: 'Feasible but not selected',
    legendLabel: 'Not selected',
    color: '#fb6a4a',
  },
  infeasible: {
    label: 'No feasible vehicle',
    legendLabel: 'No feasible',
    color: '#cb181d',
  },
} as const;
// D3 categorical schemes: neutral gray marks vehicles already in service,
// while muted Set2 hues distinguish constraint and assignability states.
const FEASIBILITY_STATUS_META = [
  {
    key: 'unavailableVehicleCount',
    vehicleIdsKey: 'unavailableVehicleIds',
    label: 'In service',
    color: CANCELLATION_ANALYSIS_COLORS.feasibility.inService,
  },
  {
    key: 'capacityBlockedVehicles',
    vehicleIdsKey: 'capacityBlockedVehicleIds',
    label: 'No seats',
    color: CANCELLATION_ANALYSIS_COLORS.feasibility.constraintBlocked,
  },
  {
    key: 'pickupDeadlineBlockedVehicles',
    vehicleIdsKey: 'pickupDeadlineBlockedVehicleIds',
    label: 'Late pickup',
    color: CANCELLATION_ANALYSIS_COLORS.feasibility.constraintBlocked,
  },
  {
    key: 'serviceConstraintBlockedVehicles',
    vehicleIdsKey: 'serviceConstraintBlockedVehicleIds',
    label: 'Ride-time limit',
    color: CANCELLATION_ANALYSIS_COLORS.feasibility.constraintBlocked,
  },
  {
    key: 'feasibleVehicleCount',
    vehicleIdsKey: 'feasibleVehicleIds',
    label: 'Assignable',
    color: CANCELLATION_ANALYSIS_COLORS.feasibility.assignable,
  },
] as const;
const FEASIBILITY_LEGEND_META = [
  {
    key: 'constraint-blocked',
    label: 'Constraint blocked',
    color: CANCELLATION_ANALYSIS_COLORS.feasibility.constraintBlocked,
  },
  {
    key: 'assignable',
    label: 'Assignable',
    color: CANCELLATION_ANALYSIS_COLORS.feasibility.assignable,
  },
] as const;
const DISPATCH_ACTION_META: Record<
  ReplayDispatchDecision['actionType'],
  { label: string; color: string; textColor: string }
> = {
  pickup: {
    label: 'Pickup',
    color: CANCELLATION_ANALYSIS_COLORS.decision.pickup,
    textColor: '#111827',
  },
  dropoff: {
    label: 'Drop-off',
    color: CANCELLATION_ANALYSIS_COLORS.decision.dropoff,
    textColor: '#000000',
  },
  wait: {
    label: 'Wait',
    color: CANCELLATION_ANALYSIS_COLORS.decision.wait,
    textColor: '#000000',
  },
};

type CancellationCategory = keyof typeof CANCELLATION_CATEGORY_META;

function buildNodeDemand(passengers: Passenger[], replayTime: number): NodeDemand[] {
  const demandByNode = new Map<number, NodeDemand>();
  for (const passenger of passengers) {
    if (passenger.requestTime > replayTime || !nodeMap.has(passenger.originNodeId)) continue;
    const demand = demandByNode.get(passenger.originNodeId) ?? {
      nodeId: passenger.originNodeId,
      total: 0,
      accepted: 0,
      cancelled: 0,
      pending: 0,
    };
    demand.total += 1;
    if (passenger.status === 'cancelled') demand.cancelled += 1;
    else if (passenger.assignedVehicleId != null) demand.accepted += 1;
    else demand.pending += 1;
    demandByNode.set(passenger.originNodeId, demand);
  }
  return [...demandByNode.values()];
}

function buildOutcomePassengersByNode(
  passengers: Passenger[],
  replayTime: number,
  outcome: 'accepted' | 'cancelled',
): Map<number, Passenger[]> {
  const byNode = new Map<number, Passenger[]>();
  for (const passenger of passengers) {
    if (passenger.requestTime > replayTime) continue;
    const matchesOutcome = outcome === 'cancelled'
      ? passenger.status === 'cancelled' &&
        (passenger.cancellationTime == null || passenger.cancellationTime <= replayTime)
      : passenger.status !== 'cancelled' && passenger.assignedVehicleId != null;
    if (!matchesOutcome) continue;

    const nodePassengers = byNode.get(passenger.originNodeId) ?? [];
    nodePassengers.push(passenger);
    byNode.set(passenger.originNodeId, nodePassengers);
  }

  for (const nodePassengers of byNode.values()) {
    nodePassengers.sort((a, b) => {
      const aTime = outcome === 'cancelled'
        ? a.cancellationTime ?? a.requestTime
        : a.assignmentTime ?? a.pickupTime ?? a.deliveryTime ?? a.requestTime;
      const bTime = outcome === 'cancelled'
        ? b.cancellationTime ?? b.requestTime
        : b.assignmentTime ?? b.pickupTime ?? b.deliveryTime ?? b.requestTime;
      return aTime - bTime || a.id - b.id;
    });
  }
  return byNode;
}

function demandRadius(total: number, sharedMaximum: number): number {
  if (total <= 0 || sharedMaximum <= 0) return 4.5;
  return Math.max(7, 15 * Math.sqrt(total / sharedMaximum));
}

function sectorPath(
  cx: number,
  cy: number,
  radius: number,
  startRatio: number,
  endRatio: number,
): string | null {
  const span = endRatio - startRatio;
  if (span <= 0) return null;
  if (span >= 0.999999) {
    return `M ${cx} ${cy - radius} A ${radius} ${radius} 0 1 1 ${cx - 0.001} ${cy - radius} Z`;
  }
  const startAngle = startRatio * Math.PI * 2 - Math.PI / 2;
  const endAngle = endRatio * Math.PI * 2 - Math.PI / 2;
  const startX = cx + Math.cos(startAngle) * radius;
  const startY = cy + Math.sin(startAngle) * radius;
  const endX = cx + Math.cos(endAngle) * radius;
  const endY = cy + Math.sin(endAngle) * radius;
  return [
    `M ${cx} ${cy}`,
    `L ${startX} ${startY}`,
    `A ${radius} ${radius} 0 ${span > 0.5 ? 1 : 0} 1 ${endX} ${endY}`,
    'Z',
  ].join(' ');
}

function cancellationCause(passenger: Passenger): string {
  const diagnostics = passenger.cancellationDiagnostics;
  if (passenger.cancellationReason === 'max_wait_after_assignment') {
    return 'Pickup timeout after assignment';
  }
  if (passenger.cancellationReason !== 'max_wait_unassigned' || !diagnostics) {
    return 'Reason not encoded';
  }
  if (diagnostics.feasibleButNotSelectedSteps > 0) {
    return 'Feasible vehicle was not selected';
  }
  if (diagnostics.availableVehicleCount === 0) {
    return 'No idle vehicle available';
  }

  const blockers: string[] = [];
  if (diagnostics.capacityBlockedVehicles > 0) blockers.push('capacity');
  if (diagnostics.pickupDeadlineBlockedVehicles > 0) blockers.push('pickup deadline');
  if (diagnostics.serviceConstraintBlockedVehicles > 0) blockers.push('service constraint');
  return blockers.length > 0
    ? `No feasible vehicle (${blockers.join(', ')})`
    : 'Wait limit exceeded';
}

function cancellationCategory(passenger: Passenger): CancellationCategory | null {
  if (
    passenger.cancellationReason === 'max_wait_unassigned' &&
    (passenger.cancellationDiagnostics?.feasibleButNotSelectedSteps ?? 0) > 0
  ) {
    return 'deferred';
  }
  if (passenger.cancellationReason === 'max_wait_unassigned') return 'infeasible';
  return null;
}

function sortedFeasibilityHistory(passenger: Passenger | null): CancellationFeasibilityPoint[] {
  return [...(passenger?.feasibilityHistory ?? [])].sort((a, b) => a.time - b.time);
}

function vehicleIdsFromFeasibilityHistory(
  history: CancellationFeasibilityPoint[],
): number[] {
  return [...new Set(history.flatMap(point =>
    FEASIBILITY_STATUS_META.flatMap(meta => point[meta.vehicleIdsKey] ?? []),
  ))].sort((a, b) => a - b);
}

function dispatchDecisionKey(decision: ReplayDispatchDecision): string {
  return `${decision.time}:${decision.decisionRound}:${decision.vehicleId}`;
}

function unitTimeTicks(startTime: number, endTime: number): number[] {
  const ticks = [startTime];
  for (let time = Math.ceil(startTime); time < endTime; time += 1) {
    if (time > startTime) ticks.push(time);
  }
  if (endTime > startTime && ticks[ticks.length - 1] !== endTime) {
    ticks.push(endTime);
  }
  return ticks;
}

function formatTimelineTime(time: number): string {
  return Number.isInteger(time) ? String(time) : time.toFixed(1);
}

function timelinePosition(
  time: number,
  startTime: number,
  duration: number,
): number {
  return Math.min(100, Math.max(0, ((time - startTime) / duration) * 100));
}

interface CandidateVehicleStatusInterval {
  startTime: number;
  endTime: number;
  status: (typeof FEASIBILITY_STATUS_META)[number] | undefined;
}

function candidateVehicleStatusIntervals(
  history: CancellationFeasibilityPoint[],
  vehicleId: number,
  candidateEndTime: number,
): CandidateVehicleStatusInterval[] {
  const intervals: CandidateVehicleStatusInterval[] = [];

  history.forEach((point, pointIndex) => {
    const endTime = Math.min(
      candidateEndTime,
      history[pointIndex + 1]?.time ?? candidateEndTime,
    );
    if (endTime <= point.time) return;

    const status = FEASIBILITY_STATUS_META.find(meta =>
      point[meta.vehicleIdsKey]?.includes(vehicleId),
    );
    const previous = intervals[intervals.length - 1];
    if (
      previous &&
      previous.endTime === point.time &&
      previous.status === status
    ) {
      previous.endTime = endTime;
      return;
    }
    intervals.push({
      startTime: point.time,
      endTime,
      status,
    });
  });

  return intervals;
}

function statusIntervalForDecision(
  intervals: CandidateVehicleStatusInterval[],
  decisionTime: number,
): CandidateVehicleStatusInterval | null {
  const containingInterval = intervals.find(interval =>
    decisionTime >= interval.startTime && decisionTime < interval.endTime,
  );
  if (containingInterval) return containingInterval;

  for (let index = intervals.length - 1; index >= 0; index -= 1) {
    if (decisionTime === intervals[index].endTime) return intervals[index];
  }
  return null;
}

function observedChoicesForPassenger(
  passenger: Passenger,
  dispatchDecisions: ReplayDispatchDecision[],
): ReplayDispatchDecision[] {
  const cancellationTime = passenger.cancellationTime ?? passenger.requestTime;
  return dispatchDecisions.filter(decision => {
    if (
      decision.time < passenger.requestTime ||
      decision.time >= cancellationTime
    ) {
      return false;
    }
    return decision.pickupCandidateRequestIds.includes(passenger.id);
  });
}

export function CandidateAvailabilityTimeline({
  passenger,
  dispatchDecisions,
  selectedDispatchDecision,
  onSelectDispatchDecision,
  hideHeading = false,
}: {
  passenger: Passenger | null;
  dispatchDecisions: ReplayDispatchDecision[];
  selectedDispatchDecision: ReplayDispatchDecision | null;
  onSelectDispatchDecision?: (decision: ReplayDispatchDecision | null) => void;
  hideHeading?: boolean;
}) {
  if (!passenger) {
    return <div className="demand-cancellation-visual-empty">Select a request.</div>;
  }

  const history = sortedFeasibilityHistory(passenger);
  const hasVehicleIds = history.length > 0 && history.every(point =>
    FEASIBILITY_STATUS_META.every(meta => Array.isArray(point[meta.vehicleIdsKey])),
  );
  const vehicleIds = hasVehicleIds ? vehicleIdsFromFeasibilityHistory(history) : [];
  const startTime = passenger.requestTime;
  const cancellationTime = passenger.cancellationTime ?? startTime;
  const duration = Math.max(1, cancellationTime - startTime);
  const timeTicks = unitTimeTicks(startTime, cancellationTime);
  const assignmentTime = passenger.assignmentTime ?? null;
  const candidateEndTime = assignmentTime ?? cancellationTime;
  const observedChoices = observedChoicesForPassenger(
    passenger,
    dispatchDecisions,
  );
  const choicesByVehicle = new Map<number, ReplayDispatchDecision[]>();
  for (const decision of observedChoices) {
    const decisions = choicesByVehicle.get(decision.vehicleId) ?? [];
    decisions.push(decision);
    choicesByVehicle.set(decision.vehicleId, decisions);
  }
  const selectedDecisionKey = selectedDispatchDecision
    ? dispatchDecisionKey(selectedDispatchDecision)
    : null;

  return (
    <section className="demand-cancellation-request-visual">
      <div className="demand-cancellation-request-meta">
        <strong>R{passenger.id}</strong>
        <span>N{passenger.originNodeId} to N{passenger.destinationNodeId}</span>
        <span>Wait {Math.max(0, cancellationTime - startTime)}</span>
        <span>{cancellationCause(passenger)}</span>
      </div>
      {!hideHeading ? <h4>Candidate Vehicle Pattern</h4> : null}
      {history.length > 0 && hasVehicleIds ? (
        <div
          className="demand-cancellation-vehicle-timeline"
          aria-label={`Candidate vehicle status from t=${startTime} to t=${cancellationTime}`}
        >
          {vehicleIds.map(vehicleId => {
            const vehicleChoices = choicesByVehicle.get(vehicleId) ?? [];
            const statusIntervals = candidateVehicleStatusIntervals(
              history,
              vehicleId,
              candidateEndTime,
            );
            const markerLayouts = vehicleChoices.map(decision => {
              const statusInterval = statusIntervalForDecision(
                statusIntervals,
                decision.time,
              );
              const markerTime = statusInterval
                ? (statusInterval.startTime + statusInterval.endTime) / 2
                : decision.time;
              return {
                decision,
                placementKey: statusInterval
                  ? `${statusInterval.startTime}:${statusInterval.endTime}`
                  : `time:${decision.time}`,
                left: timelinePosition(markerTime, startTime, duration),
              };
            });
            const stackCountByPlacement = new Map<string, number>();
            const stackIndexByDecision = new Map<string, number>();
            let maximumStack = 1;
            for (const markerLayout of markerLayouts) {
              const stackIndex =
                stackCountByPlacement.get(markerLayout.placementKey) ?? 0;
              stackIndexByDecision.set(
                dispatchDecisionKey(markerLayout.decision),
                stackIndex,
              );
              stackCountByPlacement.set(markerLayout.placementKey, stackIndex + 1);
              maximumStack = Math.max(maximumStack, stackIndex + 1);
            }
            const markerStackHeight =
              DECISION_MARKER_HEIGHT + (maximumStack - 1) * DECISION_MARKER_STACK_STEP;
            const trackHeight = Math.max(
              CANDIDATE_TRACK_MIN_HEIGHT,
              markerStackHeight + DECISION_MARKER_STACK_PADDING,
            );
            const markerStackTop = (trackHeight - markerStackHeight) / 2;

            return (
              <div className="demand-cancellation-vehicle-row" key={vehicleId}>
                <strong>V{vehicleId}</strong>
                <div
                  className="demand-cancellation-vehicle-track"
                  style={{
                    height: `${trackHeight}px`,
                  }}
                >
                  {statusIntervals.map(interval => {
                    const intervalLeft = timelinePosition(
                      interval.startTime,
                      startTime,
                      duration,
                    );
                    const intervalRight = timelinePosition(
                      interval.endTime,
                      startTime,
                      duration,
                    );
                    return (
                      <span
                        key={`${vehicleId}-${interval.startTime}`}
                        className="demand-cancellation-vehicle-interval"
                        style={{
                          left: `${intervalLeft}%`,
                          width: `calc(${intervalRight - intervalLeft}% + 1px)`,
                          background: interval.status?.color,
                        }}
                        title={interval.status?.label ?? 'Status unavailable'}
                      />
                    );
                  })}
                  {timeTicks.slice(1, -1).map(time => (
                    <i
                      key={`grid-${vehicleId}-${time}`}
                      className="demand-cancellation-time-gridline"
                      style={{
                        left: `${timelinePosition(time, startTime, duration)}%`,
                      }}
                      aria-hidden="true"
                    />
                  ))}
                  {markerLayouts.map(({ decision, left }) => {
                    const actionMeta = DISPATCH_ACTION_META[decision.actionType];
                    const decisionKey = dispatchDecisionKey(decision);
                    const stackIndex = stackIndexByDecision.get(decisionKey) ?? 0;
                    const targetLabel = decision.requestId == null
                      ? 'Wait'
                      : `${actionMeta.label} R${decision.requestId}`;
                    return (
                      <button
                        key={decisionKey}
                        type="button"
                        className={`demand-cancellation-decision-marker is-${decision.actionType}${selectedDecisionKey === decisionKey ? ' is-selected' : ''}`}
                        style={{
                          top: `${markerStackTop + stackIndex * DECISION_MARKER_STACK_STEP}px`,
                          left: `clamp(${DECISION_MARKER_WIDTH / 2}px, ${left}%, calc(100% - ${DECISION_MARKER_WIDTH / 2}px))`,
                          width: `${DECISION_MARKER_WIDTH}px`,
                          height: `${DECISION_MARKER_HEIGHT}px`,
                          background: actionMeta.color,
                          color: actionMeta.textColor,
                          transform: 'translateX(-50%)',
                        }}
                        title={`t=${decision.time} · round ${decision.decisionRound + 1} · V${vehicleId} could serve R${passenger.id} · selected ${targetLabel}`}
                        aria-label={`At time ${decision.time}, round ${decision.decisionRound + 1}, vehicle ${vehicleId} selected ${targetLabel}`}
                        aria-pressed={selectedDecisionKey === decisionKey}
                        onClick={() => onSelectDispatchDecision?.(
                          selectedDecisionKey === decisionKey ? null : decision,
                        )}
                      >
                        {decision.requestId ?? 'W'}
                      </button>
                    );
                  })}
                  <i
                    className="demand-cancellation-end-boundary"
                    style={{
                      background: CANCELLATION_ANALYSIS_COLORS.request.selected,
                    }}
                    aria-hidden="true"
                  />
                </div>
              </div>
            );
          })}
          <div className="demand-cancellation-vehicle-axis">
            <span />
            <div>
              {timeTicks.map((time, index) => {
                const isFirst = index === 0;
                const isLast = index === timeTicks.length - 1 && !isFirst;
                return (
                  <b
                    key={time}
                    className={isFirst ? 'is-start' : isLast ? 'is-end' : undefined}
                    style={{
                      left: `${timelinePosition(time, startTime, duration)}%`,
                    }}
                  >
                    t={formatTimelineTime(time)}
                  </b>
                );
              })}
            </div>
          </div>
          <div className="demand-cancellation-status-legend">
            {FEASIBILITY_LEGEND_META.map(meta => (
              <span key={meta.key}><i style={{ background: meta.color }} />{meta.label}</span>
            ))}
          </div>
        </div>
      ) : (
        <p className="demand-cancellation-legacy-note">
          Generate a new replay to visualize vehicle-level candidate history.
        </p>
      )}
    </section>
  );
}

type RequestPatternPhase = 'queued' | 'assigned' | 'onboard';

const REQUEST_PATTERN_PHASE_META: Record<
  RequestPatternPhase,
  { label: string; color: string }
> = {
  queued: { label: 'Queued', color: REQUEST_OUTCOME_COLORS.pending },
  assigned: { label: 'Assigned', color: REQUEST_OUTCOME_COLORS.accepted },
  onboard: { label: 'Onboard', color: VEHICLE_STATUS_COLORS.carrying },
};

export function RequestPatternLegend({ inline = false }: { inline?: boolean }) {
  return (
    <div
      className={`request-pattern-legend${inline ? ' request-pattern-legend-inline' : ''}`}
      aria-label="Request lifecycle legend"
    >
      {(Object.keys(REQUEST_PATTERN_PHASE_META) as RequestPatternPhase[]).map(phase => (
        <span key={phase}>
          <i style={{ background: REQUEST_PATTERN_PHASE_META[phase].color }} />
          {REQUEST_PATTERN_PHASE_META[phase].label}
        </span>
      ))}
      <span><i className="is-cancelled" />Cancelled</span>
    </div>
  );
}

function requestPatternStatusLabel(passenger: Passenger): string {
  if (passenger.status === 'cancelled' || passenger.cancellationTime != null) return 'Cancelled';
  if (passenger.status === 'delivered' || passenger.deliveryTime != null) return 'Delivered';
  if (passenger.status === 'picked_up' || passenger.pickupTime != null) return 'Onboard';
  if (passenger.assignmentTime != null || passenger.assignedVehicleId != null) return 'Assigned';
  return 'Queued';
}

export function RequestPatternPanel({
  passengers,
  replayTime,
  selectedRequestId,
  onSelectRequest,
  onClose,
  showLegend = true,
}: {
  passengers: Passenger[];
  replayTime: number;
  selectedRequestId: number | null;
  onSelectRequest: (passenger: Passenger) => void;
  onClose?: () => void;
  showLegend?: boolean;
}) {
  if (passengers.length === 0) {
    return <div className="request-pattern-empty">No requests available.</div>;
  }

  const domainStart = Math.min(...passengers.map(passenger => passenger.requestTime));
  const domainEnd = Math.max(
    domainStart + 1,
    ...passengers.map(passenger =>
      passenger.cancellationTime ?? passenger.deliveryTime ?? replayTime,
    ),
  );
  const duration = Math.max(1, domainEnd - domainStart);
  const phaseStyle = (start: number, end: number) => ({
    left: `${((Math.max(domainStart, start) - domainStart) / duration) * 100}%`,
    width: `${((Math.max(start, Math.min(domainEnd, end)) - Math.max(domainStart, start)) / duration) * 100}%`,
  });

  return (
    <section className="request-pattern-panel" aria-label="Request lifecycle patterns">
      {showLegend || onClose ? <div className="request-pattern-toolbar">
        {showLegend ? <RequestPatternLegend /> : null}
        {onClose ? (
          <button
            type="button"
            className="request-pattern-close"
            aria-label="Close request pattern"
            title="Close request pattern"
            onClick={onClose}
          >
            <span aria-hidden="true" />
          </button>
        ) : null}
      </div> : null}
      <div className="request-pattern-rows">
        {passengers.map(passenger => {
          const endTime = passenger.cancellationTime ?? passenger.deliveryTime ?? replayTime;
          const assignmentTime = passenger.assignmentTime == null
            ? null
            : Math.min(endTime, Math.max(passenger.requestTime, passenger.assignmentTime));
          const pickupTime = passenger.pickupTime == null
            ? null
            : Math.min(endTime, Math.max(passenger.requestTime, passenger.pickupTime));
          const queuedEnd = assignmentTime ?? pickupTime ?? endTime;
          const assignedEnd = pickupTime ?? endTime;
          const passengerCount = typeof passenger.numPassengers === 'number' && passenger.numPassengers > 0
            ? passenger.numPassengers
            : 1;
          const isSelected = passenger.id === selectedRequestId;
          const isCancelled = passenger.status === 'cancelled' || passenger.cancellationTime != null;
          const isDelivered = !isCancelled &&
            (passenger.status === 'delivered' || passenger.deliveryTime != null);
          const outcomeClass = isCancelled
            ? ' is-cancelled'
            : isDelivered
              ? ' is-delivered'
              : '';
          const endpointLeft = Math.min(
            100,
            Math.max(0, ((endTime - domainStart) / duration) * 100),
          );

          return (
            <button
              key={passenger.id}
              type="button"
              className={`request-pattern-row${outcomeClass}${isSelected ? ' is-selected' : ''}`}
              aria-pressed={isSelected}
              onClick={() => onSelectRequest(passenger)}
            >
              <span className="request-pattern-row-label">
                <strong>R{passenger.id}</strong>
                <span>N{passenger.originNodeId} to N{passenger.destinationNodeId}</span>
                <small>
                  {passengerCount} passenger{passengerCount === 1 ? '' : 's'} · {requestPatternStatusLabel(passenger)}
                </small>
              </span>
              <span className="request-pattern-track">
                {queuedEnd > passenger.requestTime ? (
                  <i
                    className="is-queued"
                    style={phaseStyle(passenger.requestTime, queuedEnd)}
                    title={`Queued: t=${passenger.requestTime}-${queuedEnd}`}
                  />
                ) : null}
                {assignmentTime != null && assignedEnd > assignmentTime ? (
                  <i
                    className="is-assigned"
                    style={phaseStyle(assignmentTime, assignedEnd)}
                    title={`Assigned to V${passenger.assignedVehicleId ?? '?'}: t=${assignmentTime}-${assignedEnd}`}
                  />
                ) : null}
                {pickupTime != null && endTime > pickupTime ? (
                  <i
                    className="is-onboard"
                    style={phaseStyle(pickupTime, endTime)}
                    title={`Onboard: t=${pickupTime}-${endTime}`}
                  />
                ) : null}
                {isCancelled ? (
                  <b
                    className="request-pattern-cancel-marker"
                    style={{ left: `${endpointLeft}%` }}
                    title={`Cancelled at t=${endTime}`}
                  />
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
      <div className="request-pattern-axis">
        <span />
        <div><b>t={domainStart}</b><b>t={domainEnd}</b></div>
      </div>
    </section>
  );
}

export default function DemandNetworkMap({
  passengers,
  replayTime,
  comparisonPassengers,
  comparisonReplayTime,
  title = 'Demand Network Map',
  embedded = false,
  hideTitle = false,
  showNodeLabels = true,
  appearance = 'dashboard',
  dispatchDecisions = [],
  selectedDispatchDecision = null,
  onSelectCancellationContext,
  onSelectDispatchDecision,
  onCloseCancellationContext,
  selectedCancellationNodeId,
  selectedAcceptedNodeId = null,
  showCancellationDiagnostics = true,
  onCancelledNodeSelectionChange,
  onAcceptedNodeSelectionChange,
}: DemandNetworkMapProps) {
  const [uncontrolledCancelledNodeId, setUncontrolledCancelledNodeId] = useState<number | null>(null);
  const selectedCancelledNodeId = selectedCancellationNodeId === undefined
    ? uncontrolledCancelledNodeId
    : selectedCancellationNodeId;
  const [selectedCancelledRequestId, setSelectedCancelledRequestId] = useState<number | null>(null);
  const [nodeTooltip, setNodeTooltip] = useState<DemandNodeTooltipState | null>(null);
  const [diagnosticsPosition, setDiagnosticsPosition] = useState<DiagnosticsPosition | null>(null);
  const diagnosticsRef = useRef<HTMLElement | null>(null);
  const diagnosticsDragRef = useRef<DiagnosticsDragState | null>(null);
  const demand = useMemo(
    () => buildNodeDemand(passengers, replayTime),
    [passengers, replayTime],
  );
  const comparisonDemand = useMemo(
    () => comparisonPassengers && comparisonReplayTime != null
      ? buildNodeDemand(comparisonPassengers, comparisonReplayTime)
      : [],
    [comparisonPassengers, comparisonReplayTime],
  );
  const demandByNode = useMemo(
    () => new Map(demand.map(nodeDemand => [nodeDemand.nodeId, nodeDemand])),
    [demand],
  );
  const cancelledByNode = useMemo(
    () => buildOutcomePassengersByNode(passengers, replayTime, 'cancelled'),
    [passengers, replayTime],
  );
  const acceptedByNode = useMemo(
    () => buildOutcomePassengersByNode(passengers, replayTime, 'accepted'),
    [passengers, replayTime],
  );
  const selectedCancelledPassengers = selectedCancelledNodeId == null
    ? []
    : (cancelledByNode.get(selectedCancelledNodeId) ?? []);
  const selectedCancelledPassenger = selectedCancelledPassengers.find(
    passenger => passenger.id === selectedCancelledRequestId,
  ) ?? null;
  const hoveredNodeDemand = nodeTooltip == null
    ? null
    : demandByNode.get(nodeTooltip.nodeId) ?? null;

  useEffect(() => {
    if (selectedCancelledNodeId != null && !cancelledByNode.has(selectedCancelledNodeId)) {
      if (selectedCancellationNodeId === undefined) setUncontrolledCancelledNodeId(null);
      onCancelledNodeSelectionChange?.(null);
      onCloseCancellationContext?.();
    }
  }, [
    cancelledByNode,
    onCancelledNodeSelectionChange,
    onCloseCancellationContext,
    selectedCancellationNodeId,
    selectedCancelledNodeId,
  ]);

  useEffect(() => {
    if (selectedAcceptedNodeId != null && !acceptedByNode.has(selectedAcceptedNodeId)) {
      onAcceptedNodeSelectionChange?.(null);
    }
  }, [acceptedByNode, onAcceptedNodeSelectionChange, selectedAcceptedNodeId]);

  useEffect(() => {
    if (selectedCancelledNodeId == null || selectedCancelledPassengers.length === 0) {
      setSelectedCancelledRequestId(null);
      return;
    }
    if (!selectedCancelledPassengers.some(passenger => passenger.id === selectedCancelledRequestId)) {
      setSelectedCancelledRequestId(selectedCancelledPassengers[0].id);
    }
  }, [selectedCancelledNodeId, selectedCancelledPassengers, selectedCancelledRequestId]);

  useEffect(() => {
    setDiagnosticsPosition(null);
    diagnosticsDragRef.current = null;
  }, [selectedCancelledNodeId]);

  useEffect(() => {
    if (selectedCancelledNodeId == null) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (selectedCancellationNodeId === undefined) setUncontrolledCancelledNodeId(null);
        onCancelledNodeSelectionChange?.(null);
        onCloseCancellationContext?.();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    onCancelledNodeSelectionChange,
    onCloseCancellationContext,
    selectedCancellationNodeId,
    selectedCancelledNodeId,
  ]);

  const clampDiagnosticsPosition = (x: number, y: number): DiagnosticsPosition => {
    const popup = diagnosticsRef.current;
    if (!popup) return { x, y };
    const margin = 10;
    return {
      x: Math.min(
        Math.max(margin, x),
        Math.max(margin, window.innerWidth - popup.offsetWidth - margin),
      ),
      y: Math.min(
        Math.max(margin, y),
        Math.max(margin, window.innerHeight - popup.offsetHeight - margin),
      ),
    };
  };

  const handleDiagnosticsPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button')) return;
    const popup = diagnosticsRef.current;
    if (!popup) return;
    const rect = popup.getBoundingClientRect();
    diagnosticsDragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: rect.left,
      startY: rect.top,
    };
    setDiagnosticsPosition(clampDiagnosticsPosition(rect.left, rect.top));
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const handleDiagnosticsPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = diagnosticsDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setDiagnosticsPosition(clampDiagnosticsPosition(
      drag.startX + event.clientX - drag.startClientX,
      drag.startY + event.clientY - drag.startClientY,
    ));
  };

  const handleDiagnosticsPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = diagnosticsDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    diagnosticsDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const diagnosticsStyle: CSSProperties | undefined = diagnosticsPosition
    ? { left: diagnosticsPosition.x, top: diagnosticsPosition.y }
    : undefined;
  const selectCancelledRequest = (passenger: Passenger | undefined) => {
    if (!passenger) return;
    setSelectedCancelledRequestId(passenger.id);
    onSelectCancellationContext?.({
      requestId: passenger.id,
      startTime: passenger.requestTime,
      endTime: passenger.cancellationTime ?? passenger.requestTime,
    });
  };
  const toggleCancelledNode = (nodeId: number) => {
    if (selectedCancelledNodeId === nodeId) {
      if (selectedCancellationNodeId === undefined) setUncontrolledCancelledNodeId(null);
      onCancelledNodeSelectionChange?.(null);
      onCloseCancellationContext?.();
      return;
    }
    const nodePassengers = cancelledByNode.get(nodeId) ?? [];
    if (selectedCancellationNodeId === undefined) setUncontrolledCancelledNodeId(nodeId);
    onCancelledNodeSelectionChange?.({ nodeId, passengers: nodePassengers });
    if (showCancellationDiagnostics) selectCancelledRequest(nodePassengers[0]);
  };
  const toggleAcceptedNode = (nodeId: number) => {
    if (!onAcceptedNodeSelectionChange) return;
    if (selectedAcceptedNodeId === nodeId) {
      onAcceptedNodeSelectionChange(null);
      return;
    }
    onAcceptedNodeSelectionChange({
      nodeId,
      passengers: acceptedByNode.get(nodeId) ?? [],
    });
  };
  const updateNodeTooltip = (
    event: ReactMouseEvent<SVGGElement>,
    nodeId: number,
  ) => {
    const container = event.currentTarget.ownerSVGElement?.parentElement;
    if (!container) return;

    const bounds = container.getBoundingClientRect();
    const x = Math.min(bounds.width - 8, Math.max(8, event.clientX - bounds.left));
    const y = Math.min(bounds.height - 8, Math.max(8, event.clientY - bounds.top));
    const target = event.target as SVGElement;
    const highlightedOutcome = target.classList.contains('demand-network-accepted-sector')
      ? 'accepted'
      : target.classList.contains('demand-network-cancelled-sector')
        ? 'cancelled'
        : null;
    setNodeTooltip({
      nodeId,
      highlightedOutcome,
      x,
      y,
      horizontalPlacement: x > bounds.width / 2 ? 'left' : 'right',
      verticalPlacement: y > bounds.height / 2 ? 'above' : 'below',
    });
  };
  const sharedMaximum = Math.max(
    0,
    ...demand.map(nodeDemand => nodeDemand.total),
    ...comparisonDemand.map(nodeDemand => nodeDemand.total),
  );
  const totals = demand.reduce(
    (sum, nodeDemand) => ({
      total: sum.total + nodeDemand.total,
      accepted: sum.accepted + nodeDemand.accepted,
      cancelled: sum.cancelled + nodeDemand.cancelled,
      pending: sum.pending + nodeDemand.pending,
    }),
    { total: 0, accepted: 0, cancelled: 0, pending: 0 },
  );
  const panelClassName = embedded
    ? 'demand-network-panel demand-network-panel-embedded'
    : 'panel chart-panel demand-network-panel';

  return (
    <div className={panelClassName}>
      {!hideTitle ? <h3 className="panel-title">{title}</h3> : null}
      <div className="demand-network-container">
        <div className="demand-network-svg-wrap">
          <svg
            viewBox={`-${PADDING} -${PADDING} ${MAP_WIDTH + PADDING * 2} ${MAP_HEIGHT + PADDING * 2}`}
            preserveAspectRatio="xMidYMid meet"
            className="demand-network-svg"
            aria-label={`${title} at t=${replayTime}`}
          >
            {undirectedLinks.map(link => {
              const from = nodeMap.get(link.from);
              const to = nodeMap.get(link.to);
              if (!from || !to) return null;
              return (
                <line
                  key={`demand-link-${link.id}`}
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  className="demand-network-link"
                />
              );
            })}
            {nodes.map(node => {
              const nodeDemand = demandByNode.get(node.id);
              const total = nodeDemand?.total ?? 0;
              const radius = demandRadius(total, sharedMaximum);
              const acceptedRatio = total > 0 ? (nodeDemand?.accepted ?? 0) / total : 0;
              const cancelledRatio = total > 0 ? (nodeDemand?.cancelled ?? 0) / total : 0;
              const acceptedPath = sectorPath(node.x, node.y, radius, 0, acceptedRatio);
              const cancelledPath = sectorPath(
                node.x,
                node.y,
                radius,
                acceptedRatio,
                acceptedRatio + cancelledRatio,
              );
              return (
                <g
                  key={`demand-node-${node.id}`}
                  className="demand-network-node"
                  onMouseEnter={event => updateNodeTooltip(event, node.id)}
                  onMouseMove={event => updateNodeTooltip(event, node.id)}
                  onMouseLeave={() => setNodeTooltip(null)}
                >
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={radius}
                    fill={total > 0 ? PENDING_COLOR : '#ffffff'}
                    stroke={total > 0 ? '#f8fafc' : '#64748b'}
                    strokeWidth={total > 0 ? 0.9 : 0.7}
                    aria-label={`N${node.id}: ${total} requests, ${nodeDemand?.accepted ?? 0} accepted, ${nodeDemand?.pending ?? 0} pending, ${nodeDemand?.cancelled ?? 0} cancelled`}
                  />
                  {acceptedPath ? (
                    <path
                      d={acceptedPath}
                      fill={ACCEPT_COLOR}
                      className={`demand-network-accepted-sector${onAcceptedNodeSelectionChange ? ' is-interactive' : ''}${selectedAcceptedNodeId === node.id ? ' is-selected' : ''}`}
                      role={onAcceptedNodeSelectionChange ? 'button' : undefined}
                      tabIndex={onAcceptedNodeSelectionChange ? 0 : undefined}
                      aria-label={onAcceptedNodeSelectionChange
                        ? `Show ${nodeDemand?.accepted ?? 0} accepted requests at node ${node.id}`
                        : undefined}
                      aria-pressed={onAcceptedNodeSelectionChange
                        ? selectedAcceptedNodeId === node.id
                        : undefined}
                      onClick={onAcceptedNodeSelectionChange
                        ? () => toggleAcceptedNode(node.id)
                        : undefined}
                      onKeyDown={onAcceptedNodeSelectionChange
                        ? event => {
                          if (event.key !== 'Enter' && event.key !== ' ') return;
                          event.preventDefault();
                          toggleAcceptedNode(node.id);
                        }
                        : undefined}
                    />
                  ) : null}
                  {cancelledPath ? (
                    <path
                      d={cancelledPath}
                      fill={CANCELLED_COLOR}
                      className={`demand-network-cancelled-sector${selectedCancelledNodeId === node.id ? ' is-selected' : ''}`}
                      role="button"
                      tabIndex={0}
                      aria-label={`Show ${nodeDemand?.cancelled ?? 0} cancelled requests at node ${node.id}`}
                      aria-pressed={selectedCancelledNodeId === node.id}
                      onClick={() => toggleCancelledNode(node.id)}
                      onKeyDown={event => {
                        if (event.key !== 'Enter' && event.key !== ' ') return;
                        event.preventDefault();
                        toggleCancelledNode(node.id);
                      }}
                    />
                  ) : null}
                  {showNodeLabels ? (
                    <text
                      x={node.x}
                      y={node.y + 0.4}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      className="demand-network-node-label"
                    >
                      {node.label}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </svg>
          {nodeTooltip ? (
            <div
              className={`map-hover-tooltip is-${nodeTooltip.horizontalPlacement} is-${nodeTooltip.verticalPlacement}`}
              style={{ left: nodeTooltip.x, top: nodeTooltip.y }}
              role="tooltip"
            >
              <div className="map-hover-tooltip-values">
                <div>
                  <span>Node</span>
                  <b>N{nodeTooltip.nodeId}</b>
                </div>
                <div>
                  <span>Requests</span>
                  <b>{hoveredNodeDemand?.total ?? 0}</b>
                </div>
                <div
                  className={`demand-network-tooltip-metric is-accepted${nodeTooltip.highlightedOutcome === 'accepted' ? ' is-highlighted' : ''}`}
                >
                  <span>Accepted</span>
                  <b>{hoveredNodeDemand?.accepted ?? 0}</b>
                </div>
                <div>
                  <span>Pending</span>
                  <b>{hoveredNodeDemand?.pending ?? 0}</b>
                </div>
                <div
                  className={`demand-network-tooltip-metric is-cancelled${nodeTooltip.highlightedOutcome === 'cancelled' ? ' is-highlighted' : ''}`}
                >
                  <span>Cancelled</span>
                  <b>{hoveredNodeDemand?.cancelled ?? 0}</b>
                </div>
              </div>
            </div>
          ) : null}
        </div>
        <div className="demand-network-footer">
          <div className="demand-network-totals">
            <span>Requests {totals.total}</span>
            <span>Accepted {totals.accepted}</span>
            <span>Pending {totals.pending}</span>
            <span>Cancelled {totals.cancelled}</span>
          </div>
          <div className="demand-network-legend" aria-label="Demand outcome legend">
            <span><i style={{ background: ACCEPT_COLOR }} />Accepted</span>
            <span><i style={{ background: PENDING_COLOR }} />Pending</span>
            <span><i style={{ background: CANCELLED_COLOR }} />Cancelled</span>
          </div>
        </div>
        {showCancellationDiagnostics && selectedCancelledNodeId != null ? createPortal(
          <section
            ref={diagnosticsRef}
            className={`demand-cancellation-diagnostics${appearance === 'paper' ? ' is-paper' : ''}${diagnosticsPosition ? ' is-dragged' : ''}`}
            style={diagnosticsStyle}
            aria-label={`Request patterns for node ${selectedCancelledNodeId}`}
          >
            <div
              className="demand-cancellation-diagnostics-head"
              onPointerDown={handleDiagnosticsPointerDown}
              onPointerMove={handleDiagnosticsPointerMove}
              onPointerUp={handleDiagnosticsPointerUp}
              onPointerCancel={handleDiagnosticsPointerUp}
            >
              <div>
                <strong>Request Pattern Details - N{selectedCancelledNodeId}</strong>
                <span>{selectedCancelledPassengers.length} cancelled requests</span>
              </div>
              <button
                type="button"
                className="demand-cancellation-close"
                aria-label="Close request pattern details"
                onClick={() => {
                  if (selectedCancellationNodeId === undefined) setUncontrolledCancelledNodeId(null);
                  onCancelledNodeSelectionChange?.(null);
                  onCloseCancellationContext?.();
                }}
              >
                <span aria-hidden="true" />
              </button>
            </div>
            <div className="demand-cancellation-analysis-body">
              <aside className="demand-cancellation-request-list" aria-label="Cancelled requests">
                <div className="demand-cancellation-request-list-head">
                  <h4>Requests</h4>
                  <div className="demand-cancellation-cause-legend" aria-label="Cancellation cause legend">
                    {(Object.keys(CANCELLATION_CATEGORY_META) as CancellationCategory[]).map(category => {
                      const meta = CANCELLATION_CATEGORY_META[category];
                      return (
                        <span key={category} title={meta.label}>
                          <i style={{ background: meta.color }} />
                          {meta.legendLabel}
                        </span>
                      );
                    })}
                  </div>
                </div>
                <div>
                  {selectedCancelledPassengers.map(passenger => {
                    const category = cancellationCategory(passenger);
                    const meta = category == null ? null : CANCELLATION_CATEGORY_META[category];
                    return (
                      <button
                        key={passenger.id}
                        type="button"
                        className={passenger.id === selectedCancelledRequestId ? 'is-selected' : ''}
                        aria-pressed={passenger.id === selectedCancelledRequestId}
                        title={meta ? `${meta.label}: ${cancellationCause(passenger)}` : cancellationCause(passenger)}
                        onClick={() => selectCancelledRequest(passenger)}
                      >
                        <i className={meta ? '' : 'is-empty'} style={meta ? { background: meta.color } : undefined} />
                        <strong>R{passenger.id}</strong>
                        <span>t={passenger.cancellationTime ?? replayTime}</span>
                      </button>
                    );
                  })}
                </div>
              </aside>
              <CandidateAvailabilityTimeline
                passenger={selectedCancelledPassenger}
                dispatchDecisions={dispatchDecisions}
                selectedDispatchDecision={selectedDispatchDecision}
                onSelectDispatchDecision={onSelectDispatchDecision}
              />
            </div>
          </section>,
          document.body,
        ) : null}
      </div>
    </div>
  );
}
