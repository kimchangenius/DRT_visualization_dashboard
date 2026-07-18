import { useCallback, useMemo, useRef, useState } from 'react';

import DemandNetworkMap, { type CancellationAnalysisContext } from './DemandNetworkMap';
import CancellationContextMap from './CancellationContextMap';
import RequestHeatmap from './RequestHeatmap';
import VehicleOperationMap, { type OperationHeatStatus } from './VehicleOperationMap';
import { ResultVehiclePatterns } from './VehicleTemporalComparisonCharts';
import type {
  ReplayDispatchDecision,
  VehiclePatternSelection,
} from '../types/simulation';
import { frameAtOrBefore } from '../utils/replay';
import { loadReplayFile, type LoadedReplay } from '../utils/replayPayload';

const DEFAULT_STATUS_VISIBILITY: Record<OperationHeatStatus, boolean> = {
  picking_up: true,
  carrying: true,
};

function replayVehicleIds(replay: LoadedReplay | null): number[] {
  const ids = new Set<number>();
  for (const frame of replay?.frames ?? []) {
    for (const vehicle of frame.vehicles) ids.add(vehicle.id);
  }
  return [...ids].sort((a, b) => a - b);
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

export default function ResultAnalysis() {
  const [replay, setReplay] = useState<LoadedReplay | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [selectedSegment, setSelectedSegment] = useState<VehiclePatternSelection | null>(null);
  const [cancellationContext, setCancellationContext] = useState<CancellationAnalysisContext | null>(null);
  const [dispatchDecisionFocus, setDispatchDecisionFocus] = useState<ReplayDispatchDecision | null>(null);
  const [statusVisibility, setStatusVisibility] = useState(DEFAULT_STATUS_VISIBILITY);
  const cancellationReturnTimeRef = useRef<number | null>(null);
  const fileLoadIdRef = useRef(0);

  const vehicleIds = useMemo(() => replayVehicleIds(replay), [replay]);
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
  } : null, [replay]);

  const handleFile = useCallback(async (file: File) => {
    const loadId = fileLoadIdRef.current + 1;
    fileLoadIdRef.current = loadId;
    setLoadError(null);
    try {
      const parsed = await loadReplayFile(file);
      if (loadId !== fileLoadIdRef.current) return;
      setReplay(parsed);
      setCurrentTime(parsed.timeMax);
      setSelectedSegment(null);
      setCancellationContext(null);
      setDispatchDecisionFocus(null);
      cancellationReturnTimeRef.current = null;
    } catch (error) {
      if (loadId !== fileLoadIdRef.current) return;
      setLoadError(error instanceof Error ? error.message : 'Failed to load replay file.');
    }
  }, []);

  const handleSelectSegment = useCallback((selection: VehiclePatternSelection) => {
    setCancellationContext(null);
    setDispatchDecisionFocus(null);
    cancellationReturnTimeRef.current = null;
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
    cancellationReturnTimeRef.current = null;
  };

  const handleCancellationContext = useCallback((context: CancellationAnalysisContext) => {
    if (cancellationContext == null && cancellationReturnTimeRef.current == null) {
      cancellationReturnTimeRef.current = currentTime;
    }
    setCancellationContext(context);
    setDispatchDecisionFocus(null);
    setSelectedSegment(null);
    setCurrentTime(context.endTime);
  }, [cancellationContext, currentTime]);

  const closeCancellationContext = useCallback(() => {
    const returnTime = cancellationReturnTimeRef.current;
    cancellationReturnTimeRef.current = null;
    setCancellationContext(null);
    setDispatchDecisionFocus(null);
    if (returnTime != null) setCurrentTime(returnTime);
  }, []);

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
              <button type="button" onClick={closeCancellationContext}>Clear interval</button>
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
            <h3>{cancellationContext ? 'Vehicle & Request Snapshot' : 'Vehicle Activity'}</h3>
            <div className="result-analysis-map-body">
              {cancellationContext && frame ? (
                <CancellationContextMap
                  appearance="paper"
                  frame={frame}
                  selectedRequestId={cancellationContext.requestId}
                  dispatchDecisions={replay?.dispatchDecisions}
                  dispatchDecisionFocus={dispatchDecisionFocus}
                />
              ) : replay ? (
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
                  defaultMode="distance-flow"
                  showModeControl
                />
              ) : <div className="compare-empty-text">Load a replay JSON file.</div>}
            </div>
          </article>

          <article className="panel result-analysis-map-panel">
            <h3>{selectedSegment ? 'Interval Demand Context' : 'Demand Network Map'}</h3>
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
              ) : demandFrame ? (
                <DemandNetworkMap
                  embedded
                  hideTitle
                  appearance="paper"
                  showNodeLabels={false}
                  passengers={demandFrame.passengers}
                  replayTime={demandReplayTime}
                  dispatchDecisions={replay?.dispatchDecisions}
                  selectedDispatchDecision={dispatchDecisionFocus}
                  onSelectCancellationContext={handleCancellationContext}
                  onSelectDispatchDecision={setDispatchDecisionFocus}
                  onCloseCancellationContext={closeCancellationContext}
                />
              ) : <div className="compare-empty-text">Load a replay JSON file.</div>}
            </div>
          </article>
        </section>

        <section className="result-analysis-temporal">
          <ResultVehiclePatterns
            source={vehiclePatternSource}
            vehicleIds={vehicleIds}
            currentTime={dispatchDecisionFocus?.time ?? currentTime}
            selectedSegment={selectedSegment}
            contextInterval={cancellationContext
              ? [cancellationContext.startTime, cancellationContext.endTime]
              : null}
            dispatchDecisionFocus={dispatchDecisionFocus}
            onSelectSegment={handleSelectSegment}
          />
        </section>
      </main>
    </div>
  );
}
