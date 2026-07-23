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
import RequestHeatmap from './RequestHeatmap';
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

const DEFAULT_STATUS_VISIBILITY: Record<OperationHeatStatus, boolean> = {
  picking_up: true,
  carrying: true,
};

type AnalysisMapMode = 'activity' | 'demand' | 'snapshot';
type PatternMode = 'vehicle' | 'request';
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

function isCancelledRequest(passenger: Passenger): boolean {
  return passenger.status === 'cancelled' || passenger.cancellationTime != null;
}

function isDeliveredRequest(passenger: Passenger): boolean {
  return passenger.status === 'delivered' || passenger.deliveryTime != null;
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

function median(values: Array<number | null>): number | null {
  const sorted = values
    .filter((value): value is number => value != null && Number.isFinite(value))
    .sort((left, right) => left - right);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function medianDeliveredRequestMetrics(
  metrics: DeliveredRequestMetrics[],
): DeliveredRequestMetrics {
  return {
    pickupWait: median(metrics.map(metric => metric.pickupWait)),
    rideTime: median(metrics.map(metric => metric.rideTime)),
    detourRatio: median(metrics.map(metric => metric.detourRatio)),
    averageCoRiders: median(metrics.map(metric => metric.averageCoRiders)),
  };
}

function formatDetourRatio(value: number | null): string {
  return value == null || !Number.isFinite(value) ? '-' : `${value.toFixed(2)}x`;
}

function formatAverageCoRiders(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '-';
  return value.toFixed(2);
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
  medianMetrics,
  deliveredRequestCount,
}: {
  passenger: Passenger;
  metrics: DeliveredRequestMetrics;
  medianMetrics: DeliveredRequestMetrics;
  deliveredRequestCount: number;
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
  const passengerCount = Math.max(1, passenger.numPassengers ?? 1);

  return (
    <section className="delivered-request-summary" aria-label={`Delivered request R${passenger.id} summary`}>
      <div className="delivered-request-meta">
        <strong>R{passenger.id}</strong>
        <span>
          V{passenger.assignedVehicleId ?? '?'} · N{passenger.originNodeId} to N{passenger.destinationNodeId}
          {' · '}{passengerCount} passenger{passengerCount === 1 ? '' : 's'}
        </span>
      </div>

      <div className="delivered-request-lifecycle" aria-label="Delivered request lifecycle">
        <div className="delivered-request-lifecycle-track">
          <i className="is-queued" style={{ width: `${phaseWidths.queued}%` }} />
          <i className="is-assigned" style={{ width: `${phaseWidths.assigned}%` }} />
          <i className="is-onboard" style={{ width: `${phaseWidths.onboard}%` }} />
        </div>
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

      <DeliveredMetricGrid
        metrics={metrics}
        ariaLabel={`Delivered request R${passenger.id} metrics`}
        directTravelTime={passenger.directTravelTime ?? null}
      />

      <section className="delivered-request-benchmark">
        <div className="delivered-request-benchmark-head">
          <h4>All Delivered Median</h4>
          <span>n={deliveredRequestCount}</span>
        </div>
        <DeliveredMetricGrid
          metrics={medianMetrics}
          ariaLabel={`Median metrics across ${deliveredRequestCount} delivered requests`}
        />
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
  const [cancelledNodeSelection, setCancelledNodeSelection] = useState<CancelledNodeSelection | null>(null);
  const [acceptedNodeSelection, setAcceptedNodeSelection] = useState<AcceptedNodeSelection | null>(null);
  const [selectedRequestId, setSelectedRequestId] = useState<number | null>(null);
  const requestContextReturnTimeRef = useRef<number | null>(null);
  const nodeFilterReturnPatternModeRef = useRef<PatternMode | null>(null);
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
      medians: medianDeliveredRequestMetrics(allMetrics),
      deliveredRequestCount: allMetrics.length,
    };
  }, [allRequests, replay]);
  const intervalStart = requestContext?.startTime ?? selectedSegment?.startTime;
  const intervalEnd = requestContext?.endTime ?? selectedSegment?.endTime;
  const displayTime = dispatchDecisionFocus?.time ?? intervalEnd ?? currentTime;
  const frame = replay ? frameAtOrBefore(replay.frames, displayTime) : null;
  const demandReplayTime = requestContext
    ? requestContextReturnTimeRef.current ?? currentTime
    : currentTime;
  const demandFrame = replay ? frameAtOrBefore(replay.frames, demandReplayTime) : null;
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
  const requestPatternPassengers = acceptedNodeSelection?.passengers ??
    cancelledNodeSelection?.passengers ??
    allRequests;
  const showAnalysisMapToggle = cancelledNodeSelection != null || acceptedNodeSelection != null || requestContext != null;

  const restorePatternModeAfterNodeFilter = useCallback(() => {
    const returnMode = nodeFilterReturnPatternModeRef.current;
    nodeFilterReturnPatternModeRef.current = null;
    if (returnMode != null) setPatternMode(returnMode);
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
      startTransition(() => {
        setReplay(parsed);
        setCurrentTime(parsed.timeMax);
        setSelectedSegment(null);
        setRequestContext(null);
        setDispatchDecisionFocus(null);
        setAnalysisMapMode('activity');
        setPatternMode('vehicle');
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
    setSelectedSegment(previous => {
      const isSame = previous?.vehicleId === selection.vehicleId &&
        previous.startTime === selection.startTime &&
        previous.endTime === selection.endTime &&
        previous.status === selection.status;
      return isSame ? null : selection;
    });
  }, []);

  const handleTimeChange = (time: number) => {
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
  };

  const openRequestContext = useCallback((context: RequestAnalysisContext) => {
    if (requestContext == null && requestContextReturnTimeRef.current == null) {
      requestContextReturnTimeRef.current = currentTime;
    }
    setRequestContext(context);
    setSelectedRequestId(context.requestId);
    setDispatchDecisionFocus(null);
    setSelectedSegment(null);
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
    if (
      cancelledNodeSelection == null &&
      acceptedNodeSelection == null &&
      nodeFilterReturnPatternModeRef.current == null
    ) {
      nodeFilterReturnPatternModeRef.current = patternMode;
    }
    setPatternMode('request');
    if (initialRequest) {
      openRequestContext(requestAnalysisContext(initialRequest, currentTime));
      return;
    }
    setAnalysisMapMode('demand');
  }, [acceptedNodeSelection, cancelledNodeSelection, currentTime, openRequestContext, patternMode]);

  const handleCancelledNodeSelectionChange = useCallback((selection: CancelledNodeSelection | null) => {
    if (!selection) {
      setCancelledNodeSelection(null);
      setSelectedRequestId(null);
      setAnalysisMapMode('activity');
      return;
    }
    openCancellationSelection(selection);
  }, [openCancellationSelection]);

  const handleAcceptedNodeSelectionChange = useCallback((selection: AcceptedNodeSelection | null) => {
    if (!selection) {
      setAcceptedNodeSelection(null);
      setSelectedRequestId(null);
      setDispatchDecisionFocus(null);
      closeRequestContext();
      setAnalysisMapMode('activity');
      return;
    }

    if (
      acceptedNodeSelection == null &&
      cancelledNodeSelection == null &&
      nodeFilterReturnPatternModeRef.current == null
    ) {
      nodeFilterReturnPatternModeRef.current = patternMode;
    }
    setCancelledNodeSelection(null);
    setAcceptedNodeSelection(selection);
    setPatternMode('request');
    const initialRequest = selection.passengers[0];
    if (initialRequest) {
      const fallbackEndTime = requestContextReturnTimeRef.current ?? currentTime;
      openRequestContext(requestAnalysisContext(initialRequest, fallbackEndTime));
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
  ]);

  const handlePatternModeChange = useCallback((nextMode: PatternMode) => {
    setPatternMode(nextMode);
  }, []);

  const handleDispatchDecisionFocus = useCallback((decision: ReplayDispatchDecision | null) => {
    setDispatchDecisionFocus(decision);
    if (decision) setAnalysisMapMode('snapshot');
  }, []);

  const handleRequestPatternSelect = useCallback((passenger: Passenger) => {
    const isSameDirectCancellation =
      cancelledNodeSelection == null &&
      acceptedNodeSelection == null &&
      isCancelledRequest(passenger) &&
      requestContext?.requestId === passenger.id;
    const isSameDeliveredRequest =
      cancelledNodeSelection == null &&
      acceptedNodeSelection == null &&
      isDeliveredRequest(passenger) &&
      selectedRequestId === passenger.id;
    if (isSameDirectCancellation || isSameDeliveredRequest) {
      setSelectedRequestId(null);
      setSelectedSegment(null);
      setDispatchDecisionFocus(null);
      if (isSameDirectCancellation) closeRequestContext();
      setAnalysisMapMode('activity');
      return;
    }

    setSelectedRequestId(passenger.id);
    setSelectedSegment(null);
    setDispatchDecisionFocus(null);
    if (cancelledNodeSelection || acceptedNodeSelection) {
      const fallbackEndTime = requestContextReturnTimeRef.current ?? currentTime;
      openRequestContext(requestAnalysisContext(passenger, fallbackEndTime));
      return;
    }
    if (isCancelledRequest(passenger)) {
      openRequestContext(requestAnalysisContext(passenger, currentTime));
      return;
    }
    if (requestContext) closeRequestContext();
    setAnalysisMapMode('activity');
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
    setAnalysisMapMode('activity');
  }, [closeRequestContext]);

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
            min={replay?.timeMin ?? 0}
            max={replay?.timeMax ?? 1}
            step="1"
            value={currentTime}
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
                : analysisMapMode === 'snapshot' && requestContext
                  ? 'Vehicle & Request Snapshot'
                  : 'Vehicle Distance Flow'}
            </h3>
            {showAnalysisMapToggle ? (
              <div
                className="result-analysis-map-toggle is-panel-overlay"
                role="group"
                aria-label="Analysis map"
              >
                <button
                  type="button"
                  className={analysisMapMode === 'activity' ? 'is-active' : ''}
                  aria-pressed={analysisMapMode === 'activity'}
                  onClick={() => setAnalysisMapMode('activity')}
                >
                  Vehicle Distance Flow
                </button>
                <button
                  type="button"
                  className={analysisMapMode === 'demand' ? 'is-active' : ''}
                  aria-pressed={analysisMapMode === 'demand'}
                  onClick={() => setAnalysisMapMode('demand')}
                >
                  Demand Network
                </button>
                {requestContext ? (
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
              {selectedSegment
                ? 'Interval Demand Context'
                : selectedCancelledPassenger
                  ? 'Cancellation Vehicle Status'
                  : selectedDeliveredPassenger
                    ? 'Delivered Request Summary'
                  : 'Demand Network Map'}
            </h3>
            <div className="result-analysis-map-body">
              {frame && selectedSegment ? (
                <RequestHeatmap
                  embedded
                  hideTitle
                  appearance="paper"
                  showNodeLabels={false}
                  passengers={frame.passengers}
                  startTime={selectedSegment.startTime}
                  replayTime={selectedSegment.endTime}
                />
              ) : selectedCancelledPassenger ? (
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
                  medianMetrics={deliveredMetricContext.medians}
                  deliveredRequestCount={deliveredMetricContext.deliveredRequestCount}
                />
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
                    <span className="vehicle-pattern-result-count">
                      {requestPatternPassengers.length} requests
                      {acceptedNodeSelection
                        ? ` · N${acceptedNodeSelection.nodeId} Accepted`
                        : cancelledNodeSelection
                          ? ` · N${cancelledNodeSelection.nodeId} Cancelled`
                          : ''}
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
