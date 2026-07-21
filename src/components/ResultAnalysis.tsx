import { startTransition, useCallback, useMemo, useRef, useState } from 'react';

import DemandNetworkMap, {
  CandidateAvailabilityTimeline,
  RequestPatternLegend,
  RequestPatternPanel,
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

export default function ResultAnalysis() {
  const [replay, setReplay] = useState<LoadedReplay | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [selectedSegment, setSelectedSegment] = useState<VehiclePatternSelection | null>(null);
  const [cancellationContext, setCancellationContext] = useState<CancellationAnalysisContext | null>(null);
  const [dispatchDecisionFocus, setDispatchDecisionFocus] = useState<ReplayDispatchDecision | null>(null);
  const [statusVisibility, setStatusVisibility] = useState(DEFAULT_STATUS_VISIBILITY);
  const [analysisMapMode, setAnalysisMapMode] = useState<AnalysisMapMode>('activity');
  const [patternMode, setPatternMode] = useState<PatternMode>('vehicle');
  const [cancelledNodeSelection, setCancelledNodeSelection] = useState<CancelledNodeSelection | null>(null);
  const [selectedRequestId, setSelectedRequestId] = useState<number | null>(null);
  const cancellationReturnTimeRef = useRef<number | null>(null);
  const cancellationReturnPatternModeRef = useRef<PatternMode | null>(null);
  const fileLoadIdRef = useRef(0);

  const vehicleIds = useMemo(() => replayVehicleIds(replay), [replay]);
  const allRequests = useMemo(() => replayRequests(replay), [replay]);
  const intervalStart = cancellationContext?.startTime ?? selectedSegment?.startTime;
  const intervalEnd = cancellationContext?.endTime ?? selectedSegment?.endTime;
  const displayTime = dispatchDecisionFocus?.time ?? intervalEnd ?? currentTime;
  const frame = replay ? frameAtOrBefore(replay.frames, displayTime) : null;
  const demandReplayTime = cancellationContext
    ? cancellationReturnTimeRef.current ?? currentTime
    : currentTime;
  const demandFrame = replay ? frameAtOrBefore(replay.frames, demandReplayTime) : null;
  const vehiclePatternSource = useMemo(() => replay ? {
    frames: replay.frames,
    passengerEvents: replay.passengerEvents,
    temporalIndex: replay.temporalIndex,
  } : null, [replay]);
  const selectedCancelledPassenger = useMemo<Passenger | null>(() => {
    if (!cancelledNodeSelection) return null;
    return cancelledNodeSelection.passengers.find(
      passenger => passenger.id === selectedRequestId,
    ) ?? cancelledNodeSelection.passengers[0] ?? null;
  }, [cancelledNodeSelection, selectedRequestId]);
  const requestPatternPassengers = cancelledNodeSelection?.passengers ?? allRequests;

  const restorePatternModeAfterCancellation = useCallback(() => {
    const returnMode = cancellationReturnPatternModeRef.current;
    cancellationReturnPatternModeRef.current = null;
    if (returnMode != null) setPatternMode(returnMode);
  }, []);

  const handleFile = useCallback(async (file: File) => {
    const loadId = fileLoadIdRef.current + 1;
    fileLoadIdRef.current = loadId;
    setLoadError(null);
    try {
      const parsed = await loadReplayFile(file);
      if (loadId !== fileLoadIdRef.current) return;
      cancellationReturnTimeRef.current = null;
      cancellationReturnPatternModeRef.current = null;
      startTransition(() => {
        setReplay(parsed);
        setCurrentTime(parsed.timeMax);
        setSelectedSegment(null);
        setCancellationContext(null);
        setDispatchDecisionFocus(null);
        setAnalysisMapMode('activity');
        setPatternMode('vehicle');
        setCancelledNodeSelection(null);
        setSelectedRequestId(null);
      });
    } catch (error) {
      if (loadId !== fileLoadIdRef.current) return;
      setLoadError(error instanceof Error ? error.message : 'Failed to load replay file.');
    }
  }, []);

  const handleSelectSegment = useCallback((selection: VehiclePatternSelection) => {
    setCancellationContext(null);
    setDispatchDecisionFocus(null);
    setCancelledNodeSelection(null);
    setSelectedRequestId(null);
    setAnalysisMapMode('activity');
    cancellationReturnTimeRef.current = null;
    cancellationReturnPatternModeRef.current = null;
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
    setCancellationContext(null);
    setDispatchDecisionFocus(null);
    setCancelledNodeSelection(null);
    setSelectedRequestId(null);
    setAnalysisMapMode('activity');
    cancellationReturnTimeRef.current = null;
    restorePatternModeAfterCancellation();
  };

  const handleCancellationContext = useCallback((context: CancellationAnalysisContext) => {
    if (cancellationContext == null && cancellationReturnTimeRef.current == null) {
      cancellationReturnTimeRef.current = currentTime;
    }
    setCancellationContext(context);
    setSelectedRequestId(context.requestId);
    setDispatchDecisionFocus(null);
    setSelectedSegment(null);
    setCurrentTime(context.endTime);
    setAnalysisMapMode('snapshot');
  }, [cancellationContext, currentTime]);

  const closeCancellationContext = useCallback(() => {
    const returnTime = cancellationReturnTimeRef.current;
    cancellationReturnTimeRef.current = null;
    setCancellationContext(null);
    setDispatchDecisionFocus(null);
    if (returnTime != null) setCurrentTime(returnTime);
    setAnalysisMapMode(previous => previous === 'snapshot' ? 'demand' : previous);
    restorePatternModeAfterCancellation();
  }, [restorePatternModeAfterCancellation]);

  const handleCancelledNodeSelectionChange = useCallback((selection: CancelledNodeSelection | null) => {
    setCancelledNodeSelection(selection);
    if (!selection) {
      setSelectedRequestId(null);
      setAnalysisMapMode('activity');
      return;
    }
    if (cancelledNodeSelection == null && cancellationReturnPatternModeRef.current == null) {
      cancellationReturnPatternModeRef.current = patternMode;
    }
    setPatternMode('request');
    const firstRequest = selection.passengers[0];
    if (firstRequest) {
      setSelectedRequestId(firstRequest.id);
      handleCancellationContext({
        requestId: firstRequest.id,
        startTime: firstRequest.requestTime,
        endTime: firstRequest.cancellationTime ?? firstRequest.requestTime,
      });
      return;
    }
    setAnalysisMapMode('demand');
  }, [cancelledNodeSelection, handleCancellationContext, patternMode]);

  const handleDispatchDecisionFocus = useCallback((decision: ReplayDispatchDecision | null) => {
    setDispatchDecisionFocus(decision);
    if (decision) setAnalysisMapMode('snapshot');
  }, []);

  const handleRequestPatternSelect = useCallback((passenger: Passenger) => {
    setSelectedRequestId(passenger.id);
    if (!cancelledNodeSelection) return;
    handleCancellationContext({
      requestId: passenger.id,
      startTime: passenger.requestTime,
      endTime: passenger.cancellationTime ?? passenger.deliveryTime ?? passenger.requestTime,
    });
  }, [cancelledNodeSelection, handleCancellationContext]);

  const clearCancellationAnalysis = useCallback(() => {
    setCancelledNodeSelection(null);
    setSelectedRequestId(null);
    closeCancellationContext();
    setAnalysisMapMode('activity');
  }, [closeCancellationContext]);

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
      showCancellationDiagnostics={false}
      onCancelledNodeSelectionChange={handleCancelledNodeSelectionChange}
      onSelectCancellationContext={handleCancellationContext}
      onSelectDispatchDecision={handleDispatchDecisionFocus}
      onCloseCancellationContext={closeCancellationContext}
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
          {cancellationContext ? (
            <>
              <span>
                R{cancellationContext.requestId} · t={cancellationContext.startTime}-{cancellationContext.endTime}
                {dispatchDecisionFocus
                  ? ` · ${dispatchDecisionLabel(dispatchDecisionFocus)} at t=${dispatchDecisionFocus.time}`
                  : ''}
              </span>
              <button type="button" onClick={clearCancellationAnalysis}>Clear interval</button>
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
          <article className="panel result-analysis-map-panel">
            {cancelledNodeSelection ? (
              <div className="result-analysis-map-panel-head">
                <h3>
                  {analysisMapMode === 'demand'
                    ? 'Demand Network Map'
                    : analysisMapMode === 'snapshot' && cancellationContext
                      ? 'Vehicle & Request Snapshot'
                      : 'Vehicle Distance Flow'}
                </h3>
                <div className="result-analysis-map-toggle" role="group" aria-label="Analysis map">
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
                  {cancellationContext ? (
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
              </div>
            ) : (
              <h3>Vehicle Distance Flow</h3>
            )}
            <div className="result-analysis-map-body">
              {!replay ? (
                <div className="compare-empty-text">Load a replay JSON file.</div>
              ) : analysisMapMode === 'snapshot' && cancellationContext && frame ? (
                <CancellationContextMap
                  appearance="paper"
                  frame={frame}
                  selectedRequestId={cancellationContext.requestId}
                  dispatchDecisions={replay?.dispatchDecisions}
                  dispatchDecisionFocus={dispatchDecisionFocus}
                />
              ) : cancelledNodeSelection && analysisMapMode === 'demand' && demandNetworkMap ? (
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
                  focusVehicleId={cancellationContext ? null : selectedSegment?.vehicleId ?? null}
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
                : cancelledNodeSelection
                  ? 'Cancellation Vehicle Status'
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
              ) : cancelledNodeSelection ? (
                <div className="result-analysis-cancellation-pattern-body">
                  <CandidateAvailabilityTimeline
                    passenger={selectedCancelledPassenger}
                    dispatchDecisions={replay?.dispatchDecisions ?? []}
                    selectedDispatchDecision={dispatchDecisionFocus}
                    onSelectDispatchDecision={handleDispatchDecisionFocus}
                    hideHeading
                  />
                </div>
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
                  <h3>Request Pattern</h3>
                  <div className="vehicle-pattern-result-summary">
                    <PatternModeToggle mode={patternMode} onChange={setPatternMode} />
                    <div className="vehicle-pattern-head-legend">
                      <RequestPatternLegend inline />
                    </div>
                    <span className="vehicle-pattern-result-count">
                      {requestPatternPassengers.length} requests
                      {cancelledNodeSelection ? ` · N${cancelledNodeSelection.nodeId}` : ''}
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
              contextInterval={cancellationContext
                ? [cancellationContext.startTime, cancellationContext.endTime]
                : null}
              dispatchDecisionFocus={dispatchDecisionFocus}
              headerControl={<PatternModeToggle mode={patternMode} onChange={setPatternMode} />}
              onSelectSegment={handleSelectSegment}
            />
          )}
        </section>
      </main>
    </div>
  );
}
