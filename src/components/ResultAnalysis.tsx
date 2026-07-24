import { startTransition, useCallback, useMemo, useRef, useState } from 'react';

import DemandNetworkMap, {
  CandidateAvailabilityTimeline,
  RequestPatternLegend,
  RequestPatternPanel,
  type AcceptedNodeSelection,
  type CancellationAnalysisContext,
  type CancelledNodeSelection,
} from './DemandNetworkMap';
import CancellationContextMap from './CancellationContextMap';
import IntervalOperations from './IntervalOperations';
import RequestServiceJourneyMap from './RequestServiceJourneyMap';
import VehicleIntervalJourney from './VehicleIntervalJourney';
import VehicleOperationMap, { type OperationHeatStatus } from './VehicleOperationMap';
import { ResultVehiclePatterns } from './VehicleTemporalComparisonCharts';
import type {
  Passenger,
  ReplayDispatchDecision,
  ReplayPassengerEvent,
  VehiclePatternSelection,
} from '../types/simulation';
import { frameAtOrBefore } from '../utils/replay';
import { loadReplayFile, type LoadedReplay } from '../utils/replayFileLoader';
import { buildVehicleIntervalAnalysis } from '../utils/vehicleIntervalAnalysis';

const DEFAULT_STATUS_VISIBILITY: Record<OperationHeatStatus, boolean> = {
  picking_up: true,
  carrying: true,
};

type AnalysisMapMode = 'activity' | 'demand' | 'snapshot' | 'journey';
type PatternMode = 'vehicle' | 'request';
type RequestOutcomeFilter = 'all' | 'accepted' | 'cancelled';
type RequestAnalysisContext = CancellationAnalysisContext;

function replayVehicleIds(replay: LoadedReplay | null): number[] {
  return replay?.temporalIndex.vehicleIds ?? [];
}

function replayRequests(replay: LoadedReplay | null): Passenger[] {
  if (!replay) return [];
  const requestsById = new Map<number, Passenger>();
  for (const frame of replay.frames) {
    for (const passenger of frame.passengers) {
      requestsById.set(passenger.id, passenger);
    }
  }
  return [...requestsById.values()].sort(
    (left, right) => left.requestTime - right.requestTime || left.id - right.id,
  );
}

function dispatchDecisionLabel(decision: ReplayDispatchDecision): string {
  const actionLabel = decision.actionType === 'pickup'
    ? 'Pickup'
    : decision.actionType === 'dropoff'
      ? 'Drop-off'
      : 'Wait';
  return decision.requestId == null
    ? `V${decision.vehicleId} ${actionLabel}`
    : `V${decision.vehicleId} ${actionLabel} R${decision.requestId}`;
}

function PatternModeToggle({
  mode,
  onChange,
}: {
  mode: PatternMode;
  onChange: (mode: PatternMode) => void;
}) {
  return (
    <div className="result-analysis-pattern-toggle" role="group" aria-label="Pattern view">
      <button
        type="button"
        className={mode === 'vehicle' ? 'is-active' : ''}
        aria-pressed={mode === 'vehicle'}
        onClick={() => onChange('vehicle')}
      >
        Vehicle
      </button>
      <button
        type="button"
        className={mode === 'request' ? 'is-active' : ''}
        aria-pressed={mode === 'request'}
        onClick={() => onChange('request')}
      >
        Request
      </button>
    </div>
  );
}

function RequestOutcomeFilterControl({
  value,
  disabled = false,
  onChange,
}: {
  value: RequestOutcomeFilter;
  disabled?: boolean;
  onChange: (filter: RequestOutcomeFilter) => void;
}) {
  const options: { value: RequestOutcomeFilter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'accepted', label: 'Accepted' },
    { value: 'cancelled', label: 'Cancelled' },
  ];

  return (
    <div
      className="request-pattern-outcome-filter"
      role="group"
      aria-label="Filter requests by outcome"
    >
      {options.map(option => (
        <button
          key={option.value}
          type="button"
          className={`is-${option.value}${value === option.value ? ' is-active' : ''}`}
          aria-pressed={value === option.value}
          disabled={disabled}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function isCancelledRequest(passenger: Passenger): boolean {
  return passenger.status === 'cancelled' || passenger.cancellationTime != null;
}

function isDeliveredRequest(passenger: Passenger): boolean {
  return passenger.status === 'delivered' || passenger.deliveryTime != null;
}

function matchesRequestOutcome(
  passenger: Passenger,
  filter: RequestOutcomeFilter,
): boolean {
  if (filter === 'cancelled') return isCancelledRequest(passenger);
  if (filter === 'accepted') {
    return !isCancelledRequest(passenger) && passenger.assignedVehicleId != null;
  }
  return true;
}

function requestAnalysisContext(
  passenger: Passenger,
  fallbackEndTime: number,
): RequestAnalysisContext {
  const endTime = passenger.cancellationTime ?? passenger.deliveryTime ?? fallbackEndTime;
  return {
    requestId: passenger.id,
    startTime: passenger.requestTime,
    endTime: Math.max(passenger.requestTime, endTime),
  };
}

function requestsForSelectedEvents(
  passengers: Passenger[],
  selection: VehiclePatternSelection | null,
): Passenger[] {
  if (!selection) return passengers;
  const eventRequestIds = new Set(selection.eventRequestIds);
  return passengers.filter(passenger => eventRequestIds.has(passenger.id));
}

function formatElapsed(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '-';
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

interface PassengerRideInterval {
  passengerId: number;
  passengerCount: number;
  vehicleId: number;
  pickupTime: number | null;
  dropoffTime: number | null;
}

interface PassengerRideIndex {
  byPassengerId: Map<number, PassengerRideInterval>;
  byVehicleId: Map<number, PassengerRideInterval[]>;
}

interface DeliveredRequestMetrics {
  pickupWait: number | null;
  rideTime: number | null;
  detourRatio: number | null;
  averageCoRiders: number | null;
}

const EMPTY_DELIVERED_REQUEST_METRICS: DeliveredRequestMetrics = {
  pickupWait: null,
  rideTime: null,
  detourRatio: null,
  averageCoRiders: null,
};

function buildPassengerRideIndex(
  passengerEvents: readonly ReplayPassengerEvent[],
): PassengerRideIndex {
  const byPassengerId = new Map<number, PassengerRideInterval>();

  for (const event of passengerEvents) {
    let interval = byPassengerId.get(event.passengerId);
    if (!interval) {
      interval = {
        passengerId: event.passengerId,
        passengerCount: Math.max(1, event.passengerCount),
        vehicleId: event.vehicleId,
        pickupTime: null,
        dropoffTime: null,
      };
      byPassengerId.set(event.passengerId, interval);
    }

    interval.passengerCount = Math.max(interval.passengerCount, event.passengerCount);
    if (event.type === 'pickup') {
      interval.vehicleId = event.vehicleId;
      interval.pickupTime = interval.pickupTime == null
        ? event.time
        : Math.min(interval.pickupTime, event.time);
    } else {
      interval.dropoffTime = interval.dropoffTime == null
        ? event.time
        : Math.max(interval.dropoffTime, event.time);
    }
  }

  const byVehicleId = new Map<number, PassengerRideInterval[]>();
  for (const interval of byPassengerId.values()) {
    if (interval.pickupTime == null) continue;
    const vehicleIntervals = byVehicleId.get(interval.vehicleId) ?? [];
    vehicleIntervals.push(interval);
    byVehicleId.set(interval.vehicleId, vehicleIntervals);
  }

  return { byPassengerId, byVehicleId };
}

function averageCoRiders(
  passenger: Passenger,
  rideIndex: PassengerRideIndex,
): number | null {
  const targetRide = rideIndex.byPassengerId.get(passenger.id);
  if (
    !targetRide ||
    targetRide.pickupTime == null ||
    targetRide.dropoffTime == null ||
    targetRide.dropoffTime <= targetRide.pickupTime
  ) {
    return null;
  }

  const rideDuration = targetRide.dropoffTime - targetRide.pickupTime;
  let sharedPassengerTime = 0;
  const vehicleRides = rideIndex.byVehicleId.get(targetRide.vehicleId) ?? [];
  for (const otherRide of vehicleRides) {
    if (otherRide.passengerId === passenger.id || otherRide.pickupTime == null) continue;
    const overlapStart = Math.max(targetRide.pickupTime, otherRide.pickupTime);
    const overlapEnd = Math.min(
      targetRide.dropoffTime,
      otherRide.dropoffTime ?? targetRide.dropoffTime,
    );
    if (overlapStart >= overlapEnd) continue;
    sharedPassengerTime += (overlapEnd - overlapStart) * otherRide.passengerCount;
  }

  return sharedPassengerTime / rideDuration;
}

function deliveredRequestMetrics(
  passenger: Passenger,
  rideIndex: PassengerRideIndex,
): DeliveredRequestMetrics {
  const pickupWait = passenger.pickupTime == null
    ? null
    : Math.max(0, passenger.pickupTime - passenger.requestTime);
  const rideTime = passenger.pickupTime == null || passenger.deliveryTime == null
    ? null
    : Math.max(0, passenger.deliveryTime - passenger.pickupTime);
  const directTravelTime = passenger.directTravelTime ?? null;
  const detourRatio = rideTime != null && directTravelTime != null && directTravelTime > 0
    ? rideTime / directTravelTime
    : null;

  return {
    pickupWait,
    rideTime,
    detourRatio,
    averageCoRiders: averageCoRiders(passenger, rideIndex),
  };
}

function finiteSorted(values: Array<number | null>): number[] {
  return values
    .filter((value): value is number => value != null && Number.isFinite(value))
    .sort((left, right) => left - right);
}

function quantile(sorted: number[], probability: number): number {
  if (sorted.length === 1) return sorted[0];
  const index = Math.min(1, Math.max(0, probability)) * (sorted.length - 1);
  const lowerIndex = Math.floor(index);
  const upperIndex = Math.ceil(index);
  const fraction = index - lowerIndex;
  return sorted[lowerIndex] + (sorted[upperIndex] - sorted[lowerIndex]) * fraction;
}

function distributionPosition(value: number, minimum: number, maximum: number): number {
  if (maximum <= minimum) return 50;
  return Math.min(100, Math.max(0, ((value - minimum) / (maximum - minimum)) * 100));
}

function percentileRank(sorted: number[], value: number): number {
  if (sorted.length <= 1) return 50;
  const lowerCount = sorted.filter(candidate => candidate < value).length;
  const equalCount = sorted.filter(candidate => candidate === value).length;
  const averageRankIndex = lowerCount + Math.max(0, equalCount - 1) / 2;
  return Math.round((averageRankIndex / (sorted.length - 1)) * 100);
}

function formatDetourRatio(value: number | null): string {
  return value == null || !Number.isFinite(value) ? '-' : `${value.toFixed(2)}x`;
}

function formatAverageCoRiders(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '-';
  return value.toFixed(2);
}

function DeliveredMetricDistribution({
  label,
  selectedValue,
  distributionValues,
  formatValue,
}: {
  label: string;
  selectedValue: number | null;
  distributionValues: Array<number | null>;
  formatValue: (value: number | null) => string;
}) {
  const sorted = finiteSorted(distributionValues);
  if (selectedValue == null || !Number.isFinite(selectedValue) || sorted.length === 0) {
    return (
      <div className="delivered-request-distribution-metric is-empty">
        <div className="delivered-request-distribution-metric-head">
          <span>{label}</span>
          <strong>-</strong>
        </div>
      </div>
    );
  }

  const minimum = sorted[0];
  const maximum = sorted[sorted.length - 1];
  const firstQuartilePosition = distributionPosition(quantile(sorted, 0.25), minimum, maximum);
  const medianPosition = distributionPosition(quantile(sorted, 0.5), minimum, maximum);
  const thirdQuartilePosition = distributionPosition(quantile(sorted, 0.75), minimum, maximum);
  const selectedPosition = distributionPosition(selectedValue, minimum, maximum);
  const percentile = percentileRank(sorted, selectedValue);

  return (
    <div className="delivered-request-distribution-metric">
      <div className="delivered-request-distribution-metric-head">
        <span>{label}</span>
        <strong>P{percentile}</strong>
      </div>
      <div
        className="delivered-request-distribution-plot"
        aria-label={
          `${label}: selected ${formatValue(selectedValue)}, percentile ${percentile}, ` +
          `all delivered minimum ${formatValue(minimum)}, maximum ${formatValue(maximum)}`
        }
      >
        <i className="is-range" />
        <i
          className="is-iqr"
          style={{
            left: `${firstQuartilePosition}%`,
            width: `${Math.max(1, thirdQuartilePosition - firstQuartilePosition)}%`,
          }}
        />
        <i className="is-median" style={{ left: `${medianPosition}%` }} />
        <i className="is-selected" style={{ left: `${selectedPosition}%` }} />
      </div>
      <div className="delivered-request-distribution-scale">
        <span>{formatValue(minimum)}</span>
        <span>{formatValue(maximum)}</span>
      </div>
    </div>
  );
}

function DeliveredMetricGrid({
  metrics,
  ariaLabel,
  directTravelTime,
}: {
  metrics: DeliveredRequestMetrics;
  ariaLabel: string;
  directTravelTime?: number | null;
}) {
  return (
    <dl className="delivered-request-metrics" aria-label={ariaLabel}>
      <div><dt>Pickup wait</dt><dd>{formatElapsed(metrics.pickupWait)}</dd></div>
      <div><dt>In-vehicle time</dt><dd>{formatElapsed(metrics.rideTime)}</dd></div>
      <div>
        <dt>Detour ratio</dt>
        <dd>
          {formatDetourRatio(metrics.detourRatio)}
          {directTravelTime !== undefined
            ? ` (direct ${formatElapsed(directTravelTime)})`
            : null}
        </dd>
      </div>
      <div>
        <dt title="Time-weighted average number of passengers from other requests onboard">
          Average co-riders
        </dt>
        <dd>{formatAverageCoRiders(metrics.averageCoRiders)}</dd>
      </div>
    </dl>
  );
}

function DeliveredRequestSummary({
  passenger,
  metrics,
  distributionMetrics,
}: {
  passenger: Passenger;
  metrics: DeliveredRequestMetrics;
  distributionMetrics: DeliveredRequestMetrics[];
}) {
  const deliveryTime = passenger.deliveryTime ?? passenger.requestTime;
  const assignmentTime = passenger.assignmentTime;
  const pickupTime = passenger.pickupTime;
  const totalDuration = Math.max(1, deliveryTime - passenger.requestTime);
  const assignmentBoundary = Math.min(
    deliveryTime,
    Math.max(passenger.requestTime, assignmentTime ?? pickupTime ?? deliveryTime),
  );
  const pickupBoundary = Math.min(
    deliveryTime,
    Math.max(assignmentBoundary, pickupTime ?? deliveryTime),
  );
  const phaseWidths = {
    queued: ((assignmentBoundary - passenger.requestTime) / totalDuration) * 100,
    assigned: ((pickupBoundary - assignmentBoundary) / totalDuration) * 100,
    onboard: ((deliveryTime - pickupBoundary) / totalDuration) * 100,
  };
  const lifecycleTimes = [
    { event: 'Requested', time: passenger.requestTime },
    ...(assignmentTime == null ? [] : [{ event: 'Assigned', time: assignmentTime }]),
    ...(pickupTime == null ? [] : [{ event: 'Picked up', time: pickupTime }]),
    { event: 'Delivered', time: deliveryTime },
  ].reduce<Array<{ events: string[]; time: number; position: number }>>((points, boundary) => {
    const clampedTime = Math.min(
      deliveryTime,
      Math.max(passenger.requestTime, boundary.time),
    );
    const existing = points.find(point => point.time === clampedTime);
    if (existing) {
      existing.events.push(boundary.event);
      return points;
    }
    points.push({
      events: [boundary.event],
      time: clampedTime,
      position: ((clampedTime - passenger.requestTime) / totalDuration) * 100,
    });
    return points;
  }, []);
  const passengerCount = Math.max(1, passenger.numPassengers ?? 1);

  return (
    <section className="delivered-request-summary" aria-label={`Delivered request R${passenger.id} summary`}>
      <div className="delivered-request-meta">
        <strong>R{passenger.id}</strong>
        <span>
          V{passenger.assignedVehicleId ?? '?'} · N{passenger.originNodeId} to N{passenger.destinationNodeId}
          {' · '}{passengerCount} passenger{passengerCount === 1 ? '' : 's'}
        </span>
        <div className="delivered-request-lifecycle-legend">
          <span>
            <i className="is-queued" />
            <b>Queued</b>
          </span>
          <span>
            <i className="is-assigned" />
            <b>Assigned</b>
          </span>
          <span>
            <i className="is-onboard" />
            <b>Onboard</b>
          </span>
        </div>
      </div>

      <div className="delivered-request-lifecycle" aria-label="Delivered request lifecycle">
        <div className="delivered-request-lifecycle-track">
          <i className="is-queued" style={{ width: `${phaseWidths.queued}%` }} />
          <i className="is-assigned" style={{ width: `${phaseWidths.assigned}%` }} />
          <i className="is-onboard" style={{ width: `${phaseWidths.onboard}%` }} />
        </div>
        <div className="delivered-request-lifecycle-axis" aria-label="Lifecycle transition times">
          {lifecycleTimes.map(point => (
            <span
              key={`${point.time}-${point.events.join('-')}`}
              className={
                point.position <= 0
                  ? 'is-start'
                  : point.position >= 100
                    ? 'is-end'
                    : undefined
              }
              style={{ left: `${point.position}%` }}
              title={`${point.events.join(' / ')} at t=${formatElapsed(point.time)}`}
            >
              t={formatElapsed(point.time)}
            </span>
          ))}
        </div>
      </div>

      <DeliveredMetricGrid
        metrics={metrics}
        ariaLabel={`Delivered request R${passenger.id} metrics`}
        directTravelTime={passenger.directTravelTime ?? null}
      />

      <section className="delivered-request-distribution">
        <div className="delivered-request-distribution-head">
          <h4>Position in All Delivered</h4>
          <span>n={distributionMetrics.length}</span>
        </div>
        <div className="delivered-request-distribution-grid">
          <DeliveredMetricDistribution
            label="Pickup wait"
            selectedValue={metrics.pickupWait}
            distributionValues={distributionMetrics.map(metric => metric.pickupWait)}
            formatValue={formatElapsed}
          />
          <DeliveredMetricDistribution
            label="In-vehicle time"
            selectedValue={metrics.rideTime}
            distributionValues={distributionMetrics.map(metric => metric.rideTime)}
            formatValue={formatElapsed}
          />
          <DeliveredMetricDistribution
            label="Detour ratio"
            selectedValue={metrics.detourRatio}
            distributionValues={distributionMetrics.map(metric => metric.detourRatio)}
            formatValue={formatDetourRatio}
          />
          <DeliveredMetricDistribution
            label="Average co-riders"
            selectedValue={metrics.averageCoRiders}
            distributionValues={distributionMetrics.map(metric => metric.averageCoRiders)}
            formatValue={formatAverageCoRiders}
          />
        </div>
      </section>
    </section>
  );
}

export default function ResultAnalysis() {
  const [replay, setReplay] = useState<LoadedReplay | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [selectedSegment, setSelectedSegment] = useState<VehiclePatternSelection | null>(null);
  const [requestContext, setRequestContext] = useState<RequestAnalysisContext | null>(null);
  const [dispatchDecisionFocus, setDispatchDecisionFocus] = useState<ReplayDispatchDecision | null>(null);
  const [statusVisibility, setStatusVisibility] = useState(DEFAULT_STATUS_VISIBILITY);
  const [analysisMapMode, setAnalysisMapMode] = useState<AnalysisMapMode>('activity');
  const [patternMode, setPatternMode] = useState<PatternMode>('vehicle');
  const [requestOutcomeFilter, setRequestOutcomeFilter] = useState<RequestOutcomeFilter>('all');
  const [cancelledNodeSelection, setCancelledNodeSelection] = useState<CancelledNodeSelection | null>(null);
  const [acceptedNodeSelection, setAcceptedNodeSelection] = useState<AcceptedNodeSelection | null>(null);
  const [selectedRequestId, setSelectedRequestId] = useState<number | null>(null);
  const requestContextReturnTimeRef = useRef<number | null>(null);
  const nodeFilterReturnPatternModeRef = useRef<PatternMode | null>(null);
  const nodeFilterReturnOutcomeRef = useRef<RequestOutcomeFilter | null>(null);
  const fileLoadIdRef = useRef(0);

  const vehicleIds = useMemo(() => replayVehicleIds(replay), [replay]);
  const allRequests = useMemo(() => replayRequests(replay), [replay]);
  const deliveredMetricContext = useMemo(() => {
    const rideIndex = buildPassengerRideIndex(replay?.passengerEvents ?? []);
    const byRequestId = new Map<number, DeliveredRequestMetrics>();
    const allMetrics: DeliveredRequestMetrics[] = [];

    for (const passenger of allRequests) {
      if (!isDeliveredRequest(passenger)) continue;
      const metrics = deliveredRequestMetrics(passenger, rideIndex);
      byRequestId.set(passenger.id, metrics);
      allMetrics.push(metrics);
    }

    return {
      byRequestId,
      allMetrics,
    };
  }, [allRequests, replay]);
  const vehiclePatternSource = useMemo(() => replay ? {
    frames: replay.frames,
    passengerEvents: replay.passengerEvents,
    temporalIndex: replay.temporalIndex,
  } : null, [replay]);
  const selectedRequest = useMemo<Passenger | null>(() => (
    selectedRequestId == null
      ? null
      : allRequests.find(request => request.id === selectedRequestId) ?? null
  ), [allRequests, selectedRequestId]);
  const selectedCancelledPassenger = useMemo<Passenger | null>(() => {
    const passenger = cancelledNodeSelection
      ? cancelledNodeSelection.passengers.find(request => request.id === selectedRequestId) ??
        cancelledNodeSelection.passengers[0] ?? null
      : selectedRequest;
    return passenger && isCancelledRequest(passenger) ? passenger : null;
  }, [cancelledNodeSelection, selectedRequest, selectedRequestId]);
  const selectedDeliveredPassenger = useMemo<Passenger | null>(() => {
    if (cancelledNodeSelection || !selectedRequest) return null;
    return isDeliveredRequest(selectedRequest) ? selectedRequest : null;
  }, [cancelledNodeSelection, selectedRequest]);
  const selectedAcceptedPassenger = useMemo<Passenger | null>(() => {
    if (!selectedRequest || isCancelledRequest(selectedRequest)) return null;
    return selectedRequest.assignedVehicleId != null ? selectedRequest : null;
  }, [selectedRequest]);
  const cancellationTimeWindow = requestContext && selectedCancelledPassenger
    ? requestContext
    : null;
  const intervalStart = requestContext?.startTime ?? selectedSegment?.startTime;
  const intervalEnd = requestContext?.endTime ?? selectedSegment?.endTime;
  const displayTime = dispatchDecisionFocus?.time ??
    (cancellationTimeWindow ? currentTime : intervalEnd ?? currentTime);
  const frame = replay ? frameAtOrBefore(replay.frames, displayTime) : null;
  const demandReplayTime = requestContext
    ? requestContextReturnTimeRef.current ?? currentTime
    : currentTime;
  const demandFrame = replay ? frameAtOrBefore(replay.frames, demandReplayTime) : null;
  const sliderMin = cancellationTimeWindow?.startTime ?? replay?.timeMin ?? 0;
  const sliderMax = cancellationTimeWindow?.endTime ?? replay?.timeMax ?? 1;
  const sliderValue = Math.min(sliderMax, Math.max(sliderMin, currentTime));
  const selectedEventRequestPassengers = useMemo(
    () => requestsForSelectedEvents(allRequests, selectedSegment),
    [allRequests, selectedSegment],
  );
  const selectedIntervalAnalysis = useMemo(() => (
    replay && selectedSegment
      ? buildVehicleIntervalAnalysis({
        frames: replay.frames,
        movements: replay.vehicleMovements,
        passengerEvents: replay.passengerEvents,
        passengers: allRequests,
        vehicleId: selectedSegment.vehicleId,
        startTime: selectedSegment.startTime,
        endTime: selectedSegment.endTime,
      })
      : null
  ), [allRequests, replay, selectedSegment]);
  const requestPatternBasePassengers = acceptedNodeSelection?.passengers ??
    cancelledNodeSelection?.passengers ??
    (selectedSegment ? selectedEventRequestPassengers : allRequests);
  const activeRequestOutcomeFilter: RequestOutcomeFilter = selectedSegment
    ? 'all'
    : requestOutcomeFilter;
  const requestPatternPassengers = useMemo(
    () => requestPatternBasePassengers.filter(
      passenger => matchesRequestOutcome(passenger, activeRequestOutcomeFilter),
    ),
    [activeRequestOutcomeFilter, requestPatternBasePassengers],
  );
  const showAnalysisMapToggle =
    cancelledNodeSelection != null ||
    acceptedNodeSelection != null ||
    requestContext != null ||
    selectedAcceptedPassenger != null;

  const restorePatternModeAfterNodeFilter = useCallback(() => {
    const returnMode = nodeFilterReturnPatternModeRef.current;
    nodeFilterReturnPatternModeRef.current = null;
    if (returnMode != null) setPatternMode(returnMode);
  }, []);

  const restoreOutcomeFilterAfterNodeFilter = useCallback(() => {
    const returnFilter = nodeFilterReturnOutcomeRef.current;
    nodeFilterReturnOutcomeRef.current = null;
    if (returnFilter != null) setRequestOutcomeFilter(returnFilter);
  }, []);

  const handleFile = useCallback(async (file: File) => {
    const loadId = fileLoadIdRef.current + 1;
    fileLoadIdRef.current = loadId;
    setLoadError(null);
    try {
      const parsed = await loadReplayFile(file);
      if (loadId !== fileLoadIdRef.current) return;
      requestContextReturnTimeRef.current = null;
      nodeFilterReturnPatternModeRef.current = null;
      nodeFilterReturnOutcomeRef.current = null;
      startTransition(() => {
        setReplay(parsed);
        setCurrentTime(parsed.timeMax);
        setSelectedSegment(null);
        setRequestContext(null);
        setDispatchDecisionFocus(null);
        setAnalysisMapMode('activity');
        setPatternMode('vehicle');
        setRequestOutcomeFilter('all');
        setCancelledNodeSelection(null);
        setAcceptedNodeSelection(null);
        setSelectedRequestId(null);
      });
    } catch (error) {
      if (loadId !== fileLoadIdRef.current) return;
      setLoadError(error instanceof Error ? error.message : 'Failed to load replay file.');
    }
  }, []);

  const handleSelectSegment = useCallback((selection: VehiclePatternSelection) => {
    setRequestContext(null);
    setDispatchDecisionFocus(null);
    setCancelledNodeSelection(null);
    setAcceptedNodeSelection(null);
    setSelectedRequestId(null);
    setAnalysisMapMode('activity');
    requestContextReturnTimeRef.current = null;
    nodeFilterReturnPatternModeRef.current = null;
    restoreOutcomeFilterAfterNodeFilter();
    setRequestOutcomeFilter('all');
    setSelectedSegment(previous => {
      const isSame = previous?.vehicleId === selection.vehicleId &&
        previous.startTime === selection.startTime &&
        previous.endTime === selection.endTime &&
        previous.status === selection.status;
      return isSame ? null : selection;
    });
  }, [restoreOutcomeFilterAfterNodeFilter]);

  const handleTimeChange = (time: number) => {
    if (cancellationTimeWindow) {
      setCurrentTime(Math.min(
        cancellationTimeWindow.endTime,
        Math.max(cancellationTimeWindow.startTime, time),
      ));
      setDispatchDecisionFocus(null);
      return;
    }

    setCurrentTime(time);
    setSelectedSegment(null);
    setRequestContext(null);
    setDispatchDecisionFocus(null);
    setCancelledNodeSelection(null);
    setAcceptedNodeSelection(null);
    setSelectedRequestId(null);
    setAnalysisMapMode('activity');
    requestContextReturnTimeRef.current = null;
    restorePatternModeAfterNodeFilter();
    restoreOutcomeFilterAfterNodeFilter();
  };

  const openRequestContext = useCallback((context: RequestAnalysisContext) => {
    if (requestContext == null && requestContextReturnTimeRef.current == null) {
      requestContextReturnTimeRef.current = currentTime;
    }
    setRequestContext(context);
    setSelectedRequestId(context.requestId);
    setDispatchDecisionFocus(null);
    setCurrentTime(context.endTime);
    setAnalysisMapMode('snapshot');
  }, [currentTime, requestContext]);

  const closeRequestContext = useCallback(() => {
    const returnTime = requestContextReturnTimeRef.current;
    requestContextReturnTimeRef.current = null;
    setRequestContext(null);
    setDispatchDecisionFocus(null);
    if (returnTime != null) setCurrentTime(returnTime);
    setAnalysisMapMode(previous => previous === 'snapshot' ? 'demand' : previous);
    restorePatternModeAfterNodeFilter();
  }, [restorePatternModeAfterNodeFilter]);

  const openCancellationSelection = useCallback((
    selection: CancelledNodeSelection,
    initialRequest: Passenger | undefined = selection.passengers[0],
  ) => {
    setCancelledNodeSelection(selection);
    setAcceptedNodeSelection(null);
    if (cancelledNodeSelection == null && acceptedNodeSelection == null) {
      if (nodeFilterReturnPatternModeRef.current == null) {
        nodeFilterReturnPatternModeRef.current = patternMode;
      }
      if (nodeFilterReturnOutcomeRef.current == null) {
        nodeFilterReturnOutcomeRef.current = requestOutcomeFilter;
      }
    }
    setPatternMode('request');
    setRequestOutcomeFilter('cancelled');
    if (initialRequest) {
      openRequestContext(requestAnalysisContext(initialRequest, currentTime));
      return;
    }
    setAnalysisMapMode('demand');
  }, [
    acceptedNodeSelection,
    cancelledNodeSelection,
    currentTime,
    openRequestContext,
    patternMode,
    requestOutcomeFilter,
  ]);

  const handleCancelledNodeSelectionChange = useCallback((selection: CancelledNodeSelection | null) => {
    if (!selection) {
      setCancelledNodeSelection(null);
      setSelectedRequestId(null);
      setAnalysisMapMode('activity');
      restoreOutcomeFilterAfterNodeFilter();
      return;
    }
    openCancellationSelection(selection);
  }, [openCancellationSelection, restoreOutcomeFilterAfterNodeFilter]);

  const handleAcceptedNodeSelectionChange = useCallback((selection: AcceptedNodeSelection | null) => {
    if (!selection) {
      setAcceptedNodeSelection(null);
      setSelectedRequestId(null);
      setDispatchDecisionFocus(null);
      closeRequestContext();
      setAnalysisMapMode('activity');
      restoreOutcomeFilterAfterNodeFilter();
      return;
    }

    if (acceptedNodeSelection == null && cancelledNodeSelection == null) {
      if (nodeFilterReturnPatternModeRef.current == null) {
        nodeFilterReturnPatternModeRef.current = patternMode;
      }
      if (nodeFilterReturnOutcomeRef.current == null) {
        nodeFilterReturnOutcomeRef.current = requestOutcomeFilter;
      }
    }
    setCancelledNodeSelection(null);
    setAcceptedNodeSelection(selection);
    setPatternMode('request');
    setRequestOutcomeFilter('accepted');
    const initialRequest = selection.passengers[0];
    if (initialRequest) {
      const fallbackEndTime = requestContextReturnTimeRef.current ?? currentTime;
      openRequestContext(requestAnalysisContext(initialRequest, fallbackEndTime));
      setAnalysisMapMode('journey');
      return;
    }
    setSelectedRequestId(null);
    setAnalysisMapMode('demand');
  }, [
    acceptedNodeSelection,
    cancelledNodeSelection,
    closeRequestContext,
    currentTime,
    openRequestContext,
    patternMode,
    requestOutcomeFilter,
    restoreOutcomeFilterAfterNodeFilter,
  ]);

  const handlePatternModeChange = useCallback((nextMode: PatternMode) => {
    setPatternMode(nextMode);
  }, []);

  const handleDispatchDecisionFocus = useCallback((decision: ReplayDispatchDecision | null) => {
    setDispatchDecisionFocus(decision);
    if (decision) {
      if (cancellationTimeWindow) {
        setCurrentTime(Math.min(
          cancellationTimeWindow.endTime,
          Math.max(cancellationTimeWindow.startTime, decision.time),
        ));
      }
      setAnalysisMapMode('snapshot');
    }
  }, [cancellationTimeWindow]);

  const handleRequestPatternSelect = useCallback((passenger: Passenger) => {
    const isSameDirectCancellation =
      cancelledNodeSelection == null &&
      acceptedNodeSelection == null &&
      isCancelledRequest(passenger) &&
      requestContext?.requestId === passenger.id;
    const isSameAcceptedRequest =
      cancelledNodeSelection == null &&
      acceptedNodeSelection == null &&
      matchesRequestOutcome(passenger, 'accepted') &&
      selectedRequestId === passenger.id;
    if (isSameDirectCancellation || isSameAcceptedRequest) {
      setSelectedRequestId(null);
      setDispatchDecisionFocus(null);
      if (isSameDirectCancellation) closeRequestContext();
      setAnalysisMapMode('activity');
      return;
    }

    setSelectedRequestId(passenger.id);
    setDispatchDecisionFocus(null);
    if (cancelledNodeSelection || acceptedNodeSelection) {
      const fallbackEndTime = requestContextReturnTimeRef.current ?? currentTime;
      openRequestContext(requestAnalysisContext(passenger, fallbackEndTime));
      setAnalysisMapMode(
        isCancelledRequest(passenger) ? 'snapshot' : 'journey',
      );
      return;
    }
    if (isCancelledRequest(passenger)) {
      openRequestContext(requestAnalysisContext(passenger, currentTime));
      return;
    }
    if (requestContext) closeRequestContext();
    setAnalysisMapMode(
      matchesRequestOutcome(passenger, 'accepted') ? 'journey' : 'activity',
    );
  }, [
    acceptedNodeSelection,
    cancelledNodeSelection,
    closeRequestContext,
    currentTime,
    openRequestContext,
    requestContext,
    selectedRequestId,
  ]);

  const clearRequestAnalysis = useCallback(() => {
    setCancelledNodeSelection(null);
    setAcceptedNodeSelection(null);
    setSelectedRequestId(null);
    closeRequestContext();
    restoreOutcomeFilterAfterNodeFilter();
    setAnalysisMapMode('activity');
  }, [closeRequestContext, restoreOutcomeFilterAfterNodeFilter]);

  const demandNetworkMap = replay && demandFrame ? (
    <DemandNetworkMap
      embedded
      hideTitle
      appearance="paper"
      showNodeLabels={false}
      passengers={demandFrame.passengers}
      replayTime={demandReplayTime}
      dispatchDecisions={replay.dispatchDecisions}
      selectedDispatchDecision={dispatchDecisionFocus}
      selectedCancellationNodeId={cancelledNodeSelection?.nodeId ?? null}
      selectedAcceptedNodeId={acceptedNodeSelection?.nodeId ?? null}
      showCancellationDiagnostics={false}
      onCancelledNodeSelectionChange={handleCancelledNodeSelectionChange}
      onAcceptedNodeSelectionChange={handleAcceptedNodeSelectionChange}
      onSelectCancellationContext={openRequestContext}
      onSelectDispatchDecision={handleDispatchDecisionFocus}
      onCloseCancellationContext={closeRequestContext}
    />
  ) : null;

  return (
    <div className="result-analysis-layout">
      <header className="result-analysis-toolbar">
        <div className="result-analysis-file-control">
          <label className="compare-file-button" htmlFor="result-analysis-upload">Load JSON</label>
          <input
            id="result-analysis-upload"
            className="compare-file-input"
            type="file"
            accept="application/json,.json"
            onChange={event => {
              const file = event.currentTarget.files?.[0];
              if (file) void handleFile(file);
              event.currentTarget.value = '';
            }}
          />
          <span className="result-analysis-file-name">{replay?.name ?? 'No result loaded'}</span>
          {loadError ? <span className="compare-error">{loadError}</span> : null}
        </div>

        <div className="result-analysis-time-control">
          <span>t={Math.round(currentTime)}</span>
          <input
            className="slider replay-slider"
            type="range"
            min={sliderMin}
            max={sliderMax}
            step="1"
            value={sliderValue}
            disabled={!replay}
            onChange={event => handleTimeChange(Number(event.currentTarget.value))}
          />
        </div>

        <div className="result-analysis-interval">
          {requestContext ? (
            <>
              <span>
                R{requestContext.requestId} · t={requestContext.startTime}-{requestContext.endTime}
                {dispatchDecisionFocus
                  ? ` · ${dispatchDecisionLabel(dispatchDecisionFocus)} at t=${dispatchDecisionFocus.time}`
                  : ''}
              </span>
              <button type="button" onClick={clearRequestAnalysis}>Clear interval</button>
            </>
          ) : acceptedNodeSelection ? (
            <>
              <span>
                N{acceptedNodeSelection.nodeId} · {acceptedNodeSelection.passengers.length} accepted requests
              </span>
              <button
                type="button"
                onClick={() => handleAcceptedNodeSelectionChange(null)}
              >
                Clear interval
              </button>
            </>
          ) : selectedSegment ? (
            <>
              <span>V{selectedSegment.vehicleId} · t={selectedSegment.startTime}-{selectedSegment.endTime}</span>
              <button type="button" onClick={() => setSelectedSegment(null)}>Clear interval</button>
            </>
          ) : (
            <span>No interval selected</span>
          )}
        </div>
      </header>

      <main className="result-analysis-main">
        <section className="result-analysis-map-grid">
          <article
            className={`panel result-analysis-map-panel${showAnalysisMapToggle ? ' has-analysis-map-toggle' : ''}`}
          >
            <h3 className="result-analysis-map-title">
              {analysisMapMode === 'demand'
                ? 'Demand Network Map'
                : analysisMapMode === 'journey' && selectedAcceptedPassenger
                  ? 'Request Service Journey'
                : analysisMapMode === 'snapshot' && requestContext
                  ? 'Vehicle & Request Snapshot'
                  : selectedSegment
                    ? 'Vehicle Interval Journey'
                  : 'Vehicle Distance Flow'}
            </h3>
            {showAnalysisMapToggle ? (
              <div
                className="result-analysis-map-toggle is-panel-overlay"
                role="group"
                aria-label="Analysis map"
              >
                {selectedAcceptedPassenger ? (
                  <button
                    type="button"
                    className={analysisMapMode === 'journey' ? 'is-active' : ''}
                    aria-pressed={analysisMapMode === 'journey'}
                    onClick={() => setAnalysisMapMode('journey')}
                  >
                    Journey
                  </button>
                ) : null}
                {selectedAcceptedPassenger == null ? (
                  <button
                    type="button"
                    className={analysisMapMode === 'activity' ? 'is-active' : ''}
                    aria-pressed={analysisMapMode === 'activity'}
                    onClick={() => setAnalysisMapMode('activity')}
                  >
                    Distance Flow
                  </button>
                ) : null}
                <button
                  type="button"
                  className={analysisMapMode === 'demand' ? 'is-active' : ''}
                  aria-pressed={analysisMapMode === 'demand'}
                  onClick={() => setAnalysisMapMode('demand')}
                >
                  Demand Network
                </button>
                {requestContext && selectedCancelledPassenger ? (
                  <button
                    type="button"
                    className={analysisMapMode === 'snapshot' ? 'is-active' : ''}
                    aria-pressed={analysisMapMode === 'snapshot'}
                    onClick={() => setAnalysisMapMode('snapshot')}
                  >
                    Snapshot
                  </button>
                ) : null}
              </div>
            ) : null}
            <div className="result-analysis-map-body">
              {!replay ? (
                <div className="compare-empty-text">Load a replay JSON file.</div>
              ) : analysisMapMode === 'journey' && selectedAcceptedPassenger ? (
                <RequestServiceJourneyMap
                  passenger={selectedAcceptedPassenger}
                  vehicleMovements={replay.vehicleMovements}
                  passengerEvents={replay.passengerEvents}
                  currentTime={displayTime}
                />
              ) : analysisMapMode === 'snapshot' && requestContext && frame ? (
                <CancellationContextMap
                  appearance="paper"
                  frame={frame}
                  selectedRequestId={requestContext.requestId}
                  dispatchDecisions={replay?.dispatchDecisions}
                  dispatchDecisionFocus={dispatchDecisionFocus}
                />
              ) : analysisMapMode === 'demand' && demandNetworkMap ? (
                demandNetworkMap
              ) : selectedIntervalAnalysis ? (
                <VehicleIntervalJourney analysis={selectedIntervalAnalysis} />
              ) : (
                <VehicleOperationMap
                  embedded
                  hideTitle
                  appearance="paper"
                  showNodeLabels={false}
                  frames={replay.frames}
                  vehicleMovements={replay.vehicleMovements}
                  startTime={intervalStart}
                  currentTime={displayTime}
                  focusVehicleId={requestContext ? null : selectedSegment?.vehicleId ?? null}
                  statusVisibility={statusVisibility}
                  onStatusVisibilityChange={setStatusVisibility}
                  title="Vehicle Distance Flow"
                  defaultMode="distance-flow"
                  showModeControl={false}
                />
              )}
            </div>
          </article>

          <article className="panel result-analysis-map-panel">
            <h3>
              {selectedCancelledPassenger
                  ? 'Cancellation Vehicle Status'
                  : selectedDeliveredPassenger
                    ? 'Delivered Request Summary'
                    : selectedSegment
                      ? 'Interval Operations'
                    : 'Demand Network Map'}
            </h3>
            <div className="result-analysis-map-body">
              {selectedCancelledPassenger ? (
                <div className="result-analysis-cancellation-pattern-body">
                  <CandidateAvailabilityTimeline
                    passenger={selectedCancelledPassenger}
                    dispatchDecisions={replay?.dispatchDecisions ?? []}
                    selectedDispatchDecision={dispatchDecisionFocus}
                    onSelectDispatchDecision={handleDispatchDecisionFocus}
                    hideHeading
                  />
                </div>
              ) : selectedDeliveredPassenger ? (
                <DeliveredRequestSummary
                  passenger={selectedDeliveredPassenger}
                  metrics={
                    deliveredMetricContext.byRequestId.get(selectedDeliveredPassenger.id) ??
                    EMPTY_DELIVERED_REQUEST_METRICS
                  }
                  distributionMetrics={deliveredMetricContext.allMetrics}
                />
              ) : selectedIntervalAnalysis ? (
                <IntervalOperations analysis={selectedIntervalAnalysis} />
              ) : demandNetworkMap ? (
                demandNetworkMap
              ) : (
                <div className="compare-empty-text">Load a replay JSON file.</div>
              )}
            </div>
          </article>
        </section>

        <section className="result-analysis-temporal">
          {patternMode === 'request' ? (
            <section className="vehicle-pattern-section result-analysis-pattern-section">
              <article className="panel vehicle-pattern-result-card result-analysis-request-pattern-card">
                <div className="vehicle-pattern-result-head">
                  <div className="vehicle-pattern-result-title">
                    <h3>Request Pattern</h3>
                    <PatternModeToggle mode={patternMode} onChange={handlePatternModeChange} />
                  </div>
                  <div className="vehicle-pattern-result-summary">
                    <div className="vehicle-pattern-head-legend">
                      <RequestPatternLegend inline />
                    </div>
                    <RequestOutcomeFilterControl
                      value={activeRequestOutcomeFilter}
                      disabled={
                        selectedSegment != null ||
                        cancelledNodeSelection != null ||
                        acceptedNodeSelection != null
                      }
                      onChange={setRequestOutcomeFilter}
                    />
                    <span className="vehicle-pattern-result-count">
                      {requestPatternPassengers.length} requests
                    </span>
                  </div>
                </div>
                <div className="result-analysis-request-pattern-body">
                  <RequestPatternPanel
                    passengers={requestPatternPassengers}
                    replayTime={replay?.timeMax ?? currentTime}
                    selectedRequestId={selectedRequestId}
                    onSelectRequest={handleRequestPatternSelect}
                    showLegend={false}
                  />
                </div>
              </article>
            </section>
          ) : (
            <ResultVehiclePatterns
              source={vehiclePatternSource}
              vehicleIds={vehicleIds}
              currentTime={dispatchDecisionFocus?.time ?? currentTime}
              selectedSegment={selectedSegment}
              contextInterval={requestContext
                ? [requestContext.startTime, requestContext.endTime]
                : null}
              contextVehicleId={acceptedNodeSelection
                ? selectedRequest?.assignedVehicleId ?? null
                : undefined}
              dispatchDecisionFocus={dispatchDecisionFocus}
              headerControl={<PatternModeToggle mode={patternMode} onChange={handlePatternModeChange} />}
              onSelectSegment={handleSelectSegment}
            />
          )}
        </section>
      </main>
    </div>
  );
}
