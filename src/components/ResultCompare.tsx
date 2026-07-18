import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import NetworkMap from './NetworkMap';
import CancellationContextMap from './CancellationContextMap';
import VehicleOperationMap, { type OperationHeatStatus } from './VehicleOperationMap';
import DemandNetworkMap, { type CancellationAnalysisContext } from './DemandNetworkMap';
import RequestHeatmap from './RequestHeatmap';
import TemporalComparisonCharts from './TemporalComparisonCharts';
import VehicleTemporalComparisonCharts from './VehicleTemporalComparisonCharts';
import { RESULT_A_COLOR, RESULT_B_COLOR } from '../config';
import type { SimulationMetrics, SimulationState, VehiclePatternSelection } from '../types/simulation';
import { formatSimTime } from '../utils/time';
import { frameAtOrBefore, framesBetween } from '../utils/replay';
import { loadReplayFile, type LoadedReplay } from '../utils/replayPayload';

type ReplaySide = 'left' | 'right';

type ReplayTimes = Record<ReplaySide, number>;

const SIDE_LABEL: Record<ReplaySide, string> = {
  left: 'Result A',
  right: 'Result B',
};

const SIDE_COLOR: Record<ReplaySide, string> = {
  left: RESULT_A_COLOR,
  right: RESULT_B_COLOR,
};

const VEHICLE_STATUS_LABEL: Record<VehiclePatternSelection['status'], string> = {
  idle: 'Idle',
  picking_up: 'Picking up',
  carrying: 'Carrying',
  range: 'Selected range',
};

interface ComparisonMetricRow {
  label: string;
  value: (metrics: SimulationMetrics) => string | number;
  unit?: string;
}

const COMPARISON_METRIC_ROWS: ComparisonMetricRow[] = [
  {
    label: 'Active DRT Vehicles',
    value: metrics => `${metrics.activeVehicles} / ${metrics.totalVehicles}`,
  },
  {
    label: 'Passengers Served',
    value: metrics => metrics.totalPassengersServed,
  },
  {
    label: 'Canceled Passengers',
    value: metrics => metrics.cancelCount ?? 0,
  },
  {
    label: 'Average Wait Time',
    value: metrics => metrics.averageWaitTime,
    unit: ' min',
  },
  {
    label: 'Average Travel Time',
    value: metrics => metrics.averageTravelTime,
    unit: ' min',
  },
  {
    label: 'Waiting Passengers',
    value: metrics => metrics.totalPassengersWaiting,
  },
];

function clampReplayTime(replay: LoadedReplay | null, time: number): number {
  if (!replay) return 0;
  return Math.min(Math.max(time, replay.timeMin), replay.timeMax);
}

function syncedReplayTimes(
  leftReplay: LoadedReplay | null,
  rightReplay: LoadedReplay | null,
  time: number,
): ReplayTimes {
  return {
    left: clampReplayTime(leftReplay, time),
    right: clampReplayTime(rightReplay, time),
  };
}

function framesForSegment(
  replay: LoadedReplay | null,
  selection: VehiclePatternSelection | null,
): SimulationState[] {
  if (!replay || !selection) return [];

  const frames = framesBetween(replay.frames, selection.startTime, selection.endTime);
  if (frames.length > 0) return frames;

  const fallback = frameAtOrBefore(replay.frames, selection.startTime);
  return fallback ? [fallback] : [];
}

function ReplayUpload({
  side,
  replay,
  error,
  onFile,
}: {
  side: ReplaySide;
  replay: LoadedReplay | null;
  error: string | null;
  onFile: (side: ReplaySide, file: File) => void;
}) {
  const inputId = `result-upload-${side}`;

  return (
    <div className="compare-upload-card">
      <div className="compare-upload-head">
        <span className="compare-upload-label">{SIDE_LABEL[side]}</span>
        {replay ? (
          <span className="compare-upload-time">
            t {replay.timeMin}-{replay.timeMax}
          </span>
        ) : null}
      </div>
      <label className="compare-file-button" htmlFor={inputId}>
        Load JSON
      </label>
      <input
        id={inputId}
        className="compare-file-input"
        type="file"
        accept="application/json,.json"
        onChange={event => {
          const file = event.target.files?.[0];
          if (file) onFile(side, file);
          event.currentTarget.value = '';
        }}
      />
      <div className="compare-file-name">
        {replay ? replay.name : 'No file loaded'}
      </div>
      {error ? <div className="compare-error">{error}</div> : null}
    </div>
  );
}

function ResultMapPanel({
  side,
  replay,
  frame,
  selectedSegment,
  isExpanded,
  onToggleExpanded,
  onClearSelectedSegment,
}: {
  side: ReplaySide;
  replay: LoadedReplay | null;
  frame: SimulationState | null;
  selectedSegment: VehiclePatternSelection | null;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  onClearSelectedSegment: () => void;
}) {
  const activeSelectedSegment = selectedSegment?.resultSide === side ? selectedSegment : null;
  const selectedSegmentFrames = framesForSegment(replay, activeSelectedSegment);
  const displayFrame = selectedSegmentFrames[0] ?? frame;
  const bodyId = `compare-network-map-${side}`;

  return (
    <section className={"compare-map-slot" + (isExpanded ? " is-expanded" : " is-collapsed")}>
      <div className="panel compare-map-accordion">
        <button
          type="button"
          className="compare-map-accordion-head"
          aria-expanded={isExpanded}
          aria-controls={bodyId}
          aria-label={(isExpanded ? 'Collapse ' : 'Expand ') + SIDE_LABEL[side] + ' network map'}
          onClick={onToggleExpanded}
        >
          <span className="compare-map-accordion-title" style={{ color: SIDE_COLOR[side] }}>
            {SIDE_LABEL[side]} Network Map
          </span>
          <span className="compare-map-accordion-icon" aria-hidden="true" />
        </button>
        {isExpanded ? (
          <div id={bodyId} className="compare-map-accordion-body">
            {!replay || !displayFrame ? (
              <div className="compare-empty-text">Load a replay JSON file.</div>
            ) : (
              <NetworkMap
                embedded
                hideTitle
                title={SIDE_LABEL[side]}
                vehicles={displayFrame.vehicles}
                passengers={displayFrame.passengers}
                selectedSegment={activeSelectedSegment}
                selectedSegmentFrames={selectedSegmentFrames}
                onClearSelectedSegment={onClearSelectedSegment}
              />
            )}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function ResultDemandNetworkPanel({
  side,
  replay,
  frame,
  replayTime,
  comparisonReplay,
  comparisonFrame,
  comparisonReplayTime,
  selectedSegment,
  comparisonSelectedSegment,
  onSelectCancellationContext,
  onCloseCancellationContext,
  isExpanded,
  onToggleExpanded,
}: {
  side: ReplaySide;
  replay: LoadedReplay | null;
  frame: SimulationState | null;
  replayTime: number;
  comparisonReplay: LoadedReplay | null;
  comparisonFrame: SimulationState | null;
  comparisonReplayTime: number;
  selectedSegment: VehiclePatternSelection | null;
  comparisonSelectedSegment: VehiclePatternSelection | null;
  onSelectCancellationContext: (context: CancellationAnalysisContext) => void;
  onCloseCancellationContext: () => void;
  isExpanded: boolean;
  onToggleExpanded: () => void;
}) {
  const bodyId = `compare-demand-network-${side}`;
  const intervalStart = selectedSegment?.startTime;
  const intervalEnd = selectedSegment?.endTime;
  const intervalFrame = intervalEnd == null || !replay
    ? frame
    : frameAtOrBefore(replay.frames, intervalEnd);
  const comparisonIntervalStart = comparisonSelectedSegment?.startTime;
  const comparisonIntervalEnd = comparisonSelectedSegment?.endTime;
  const comparisonIntervalFrame = comparisonIntervalEnd == null || !comparisonReplay
    ? comparisonFrame
    : frameAtOrBefore(comparisonReplay.frames, comparisonIntervalEnd);
  const isIntervalContext = intervalStart != null && intervalEnd != null;
  const hasComparableContext = isIntervalContext &&
    comparisonIntervalStart != null && comparisonIntervalEnd != null;
  const hasComparableOverview = !isIntervalContext && comparisonSelectedSegment == null;
  const panelTitle = isIntervalContext ? 'Interval Demand Context' : 'Demand Network Map';

  return (
    <section className={"compare-map-slot compare-heatmap-slot" + (isExpanded ? " is-expanded" : " is-collapsed")}>
      <div className="panel compare-map-accordion compare-heatmap-accordion">
        <button
          type="button"
          className="compare-map-accordion-head"
          aria-expanded={isExpanded}
          aria-controls={bodyId}
          aria-label={(isExpanded ? 'Collapse ' : 'Expand ') + SIDE_LABEL[side] + ' ' + panelTitle.toLowerCase()}
          onClick={onToggleExpanded}
        >
          <span className="compare-map-accordion-labels">
            <span className="compare-map-accordion-title" style={{ color: SIDE_COLOR[side] }}>
              {SIDE_LABEL[side]} {panelTitle}
            </span>
          </span>
          <span className="compare-map-accordion-icon" aria-hidden="true" />
        </button>
        {isExpanded ? (
          <div id={bodyId} className="compare-map-accordion-body compare-heatmap-accordion-body">
            {!replay || !intervalFrame ? (
              <div className="compare-empty-text">Load a replay JSON file.</div>
            ) : isIntervalContext ? (
              <RequestHeatmap
                embedded
                hideTitle
                title={`${SIDE_LABEL[side]} Interval Demand Context`}
                passengers={intervalFrame.passengers}
                startTime={intervalStart}
                replayTime={intervalEnd}
                comparisonPassengers={hasComparableContext ? comparisonIntervalFrame?.passengers : undefined}
                comparisonStartTime={comparisonIntervalStart}
                comparisonReplayTime={hasComparableContext ? comparisonIntervalEnd : undefined}
              />
            ) : (
              <DemandNetworkMap
                embedded
                hideTitle
                title={`${SIDE_LABEL[side]} Demand Network Map`}
                passengers={intervalFrame.passengers}
                replayTime={replayTime}
                onSelectCancellationContext={onSelectCancellationContext}
                onCloseCancellationContext={onCloseCancellationContext}
                comparisonPassengers={hasComparableOverview ? comparisonFrame?.passengers : undefined}
                comparisonReplayTime={hasComparableOverview && comparisonFrame ? comparisonReplayTime : undefined}
              />
            )}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function ResultVehicleOperationPanel({
  side,
  replay,
  frame,
  replayTime,
  selectedSegment,
  cancellationContext,
  comparisonReplay,
  comparisonReplayTime,
  comparisonSelectedSegment,
  comparisonCancellationContext,
  statusVisibility,
  onStatusVisibilityChange,
  isExpanded,
  onToggleExpanded,
}: {
  side: ReplaySide;
  replay: LoadedReplay | null;
  frame: SimulationState | null;
  replayTime: number;
  selectedSegment: VehiclePatternSelection | null;
  cancellationContext: CancellationAnalysisContext | null;
  comparisonReplay: LoadedReplay | null;
  comparisonReplayTime: number;
  comparisonSelectedSegment: VehiclePatternSelection | null;
  comparisonCancellationContext: CancellationAnalysisContext | null;
  statusVisibility: Record<OperationHeatStatus, boolean>;
  onStatusVisibilityChange: (visibility: Record<OperationHeatStatus, boolean>) => void;
  isExpanded: boolean;
  onToggleExpanded: () => void;
}) {
  const bodyId = `compare-vehicle-operation-map-${side}`;
  const focusVehicleId = cancellationContext ? null : selectedSegment?.vehicleId ?? null;
  const intervalStart = cancellationContext?.startTime ?? selectedSegment?.startTime;
  const intervalEnd = cancellationContext?.endTime ?? selectedSegment?.endTime;
  const displayTime = intervalEnd ?? replayTime;
  const comparisonIntervalStart = comparisonCancellationContext?.startTime ??
    comparisonSelectedSegment?.startTime;
  const comparisonDisplayTime = comparisonCancellationContext?.endTime ??
    comparisonSelectedSegment?.endTime ??
    comparisonReplayTime;
  const hasComparableContext = (selectedSegment != null || cancellationContext != null) &&
    (comparisonSelectedSegment != null || comparisonCancellationContext != null);
  const hasComparableOverview = selectedSegment == null &&
    cancellationContext == null &&
    comparisonSelectedSegment == null &&
    comparisonCancellationContext == null;
  const comparisonSource = hasComparableContext || hasComparableOverview ? comparisonReplay : null;
  const contextLabel = cancellationContext
    ? `R${cancellationContext.requestId} · t=${formatSimTime(intervalStart ?? replayTime)}-${formatSimTime(displayTime)}`
    : focusVehicleId == null
      ? `t=${formatSimTime(replayTime)}`
    : `V${focusVehicleId} · t=${formatSimTime(intervalStart ?? replayTime)}-${formatSimTime(displayTime)}`;

  return (
    <section className={"compare-map-slot compare-operation-slot" + (isExpanded ? " is-expanded" : " is-collapsed")}>
      <div className="panel compare-map-accordion compare-operation-accordion">
        <button
          type="button"
          className="compare-map-accordion-head"
          aria-expanded={isExpanded}
          aria-controls={bodyId}
          aria-label={(isExpanded ? 'Collapse ' : 'Expand ') + SIDE_LABEL[side] +
            (cancellationContext ? ' vehicle and request snapshot' : ' vehicle activity heatmap')}
          onClick={onToggleExpanded}
        >
          <span className="compare-map-accordion-labels">
            <span className="compare-map-accordion-title" style={{ color: SIDE_COLOR[side] }}>
              {SIDE_LABEL[side]} {cancellationContext ? 'Vehicle & Request Snapshot' : 'Vehicle Activity'}
            </span>
          </span>
          <span className="compare-map-accordion-icon" aria-hidden="true" />
        </button>
        {isExpanded ? (
          <div id={bodyId} className="compare-map-accordion-body compare-operation-accordion-body">
            {!replay || !frame ? (
              <div className="compare-empty-text">Load a replay JSON file.</div>
            ) : cancellationContext ? (
              <CancellationContextMap
                frame={frame}
                selectedRequestId={cancellationContext.requestId}
              />
            ) : (
              <VehicleOperationMap
                embedded
                hideTitle
                title={`${SIDE_LABEL[side]} Vehicle Activity Heatmap`}
                contextLabel={contextLabel}
                focusVehicleId={focusVehicleId}
                frames={replay.frames}
                startTime={intervalStart}
                currentTime={displayTime}
                comparisonFrames={comparisonSource?.frames}
                comparisonStartTime={comparisonIntervalStart}
                comparisonCurrentTime={comparisonSource ? comparisonDisplayTime : undefined}
                comparisonFocusVehicleId={
                  comparisonCancellationContext
                    ? null
                    : comparisonSelectedSegment?.vehicleId ?? null
                }
                statusVisibility={statusVisibility}
                onStatusVisibilityChange={onStatusVisibilityChange}
              />
            )}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function metricDisplayValue(
  row: ComparisonMetricRow,
  frame: SimulationState | null,
): string {
  if (!frame) return '-';
  return `${row.value(frame.metrics)}${row.unit ?? ''}`;
}

function ComparisonMetricsPanel({
  leftFrame,
  rightFrame,
}: {
  leftFrame: SimulationState | null;
  rightFrame: SimulationState | null;
}) {
  return (
    <div className="panel compare-metrics-comparison-panel">
      <div className="compare-metrics-table">
        <div className="compare-metrics-table-head compare-metrics-label-head">Metric</div>
        <div className="compare-metrics-table-head compare-metrics-result-head" style={{ color: SIDE_COLOR.left }}>
          Result A
        </div>
        <div className="compare-metrics-table-head compare-metrics-result-head" style={{ color: SIDE_COLOR.right }}>
          Result B
        </div>
        {COMPARISON_METRIC_ROWS.map(row => (
          <div className="compare-metrics-row" key={row.label}>
            <div className="compare-metrics-row-label">{row.label}</div>
            <div className="compare-metrics-row-value" style={{ color: SIDE_COLOR.left }}>
              {metricDisplayValue(row, leftFrame)}
            </div>
            <div className="compare-metrics-row-value" style={{ color: SIDE_COLOR.right }}>
              {metricDisplayValue(row, rightFrame)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ResultReplaySlider({
  side,
  replay,
  time,
  onTimeChange,
}: {
  side: ReplaySide;
  replay: LoadedReplay | null;
  time: number;
  onTimeChange: (side: ReplaySide, time: number) => void;
}) {
  const disabled = !replay || replay.timeMax <= replay.timeMin;

  return (
    <div className="compare-result-slider-row">
      <div className="compare-result-slider-meta">
        <span className="compare-result-slider-label" style={{ color: SIDE_COLOR[side] }}>
          {SIDE_LABEL[side]}
        </span>
        <span className="compare-result-slider-time">
          t = {formatSimTime(replay ? time : 0)}
        </span>
      </div>
      <input
        type="range"
        className={"slider replay-slider compare-result-range is-" + side}
        min={replay?.timeMin ?? 0}
        max={replay?.timeMax ?? 0}
        value={replay ? time : 0}
        disabled={disabled}
        onChange={event => onTimeChange(side, Number(event.target.value))}
      />
    </div>
  );
}

export default function ResultCompare() {
  const [leftReplay, setLeftReplay] = useState<LoadedReplay | null>(null);
  const [rightReplay, setRightReplay] = useState<LoadedReplay | null>(null);
  const [leftError, setLeftError] = useState<string | null>(null);
  const [rightError, setRightError] = useState<string | null>(null);
  const [replayTimes, setReplayTimes] = useState<ReplayTimes>({ left: 0, right: 0 });
  const [isReplayTimeSynced, setIsReplayTimeSynced] = useState(false);
  const [expandedNetworkMaps, setExpandedNetworkMaps] = useState<Record<ReplaySide, boolean>>({ left: false, right: false });
  const [expandedOperationMaps, setExpandedOperationMaps] = useState<Record<ReplaySide, boolean>>({ left: false, right: false });
  const [expandedHeatmaps, setExpandedHeatmaps] = useState<Record<ReplaySide, boolean>>({ left: false, right: false });
  const [patternMode, setPatternMode] = useState<'system' | 'vehicle'>('vehicle');
  const [operationStatusVisibility, setOperationStatusVisibility] = useState<Record<OperationHeatStatus, boolean>>({
    picking_up: true,
    carrying: true,
  });
  const [selectedVehicleSegments, setSelectedVehicleSegments] = useState<Record<ReplaySide, VehiclePatternSelection | null>>({
    left: null,
    right: null,
  });
  const [cancellationContexts, setCancellationContexts] = useState<Record<ReplaySide, CancellationAnalysisContext | null>>({
    left: null,
    right: null,
  });
  const cancellationReturnTimesRef = useRef<Record<ReplaySide, number | null>>({
    left: null,
    right: null,
  });
  const fileLoadIdsRef = useRef<Record<ReplaySide, number>>({
    left: 0,
    right: 0,
  });

  const loadedReplays = useMemo(
    () => [leftReplay, rightReplay].filter((r): r is LoadedReplay => r !== null),
    [leftReplay, rightReplay],
  );

  const canSyncReplayTimes = loadedReplays.length > 1;
  const hasExpandedNetworkMap = expandedNetworkMaps.left || expandedNetworkMaps.right;
  const hasExpandedOperationMap = expandedOperationMaps.left || expandedOperationMaps.right;
  const hasExpandedHeatmap = expandedHeatmaps.left || expandedHeatmaps.right;

  const leftFrame = useMemo(() => leftReplay ? frameAtOrBefore(leftReplay.frames, replayTimes.left) : null, [leftReplay, replayTimes.left]);
  const rightFrame = useMemo(() => rightReplay ? frameAtOrBefore(rightReplay.frames, replayTimes.right) : null, [rightReplay, replayTimes.right]);
  const leftDemandReplayTime = cancellationContexts.left
    ? cancellationReturnTimesRef.current.left ?? replayTimes.left
    : replayTimes.left;
  const rightDemandReplayTime = cancellationContexts.right
    ? cancellationReturnTimesRef.current.right ?? replayTimes.right
    : replayTimes.right;
  const leftDemandFrame = useMemo(
    () => leftReplay ? frameAtOrBefore(leftReplay.frames, leftDemandReplayTime) : null,
    [leftDemandReplayTime, leftReplay],
  );
  const rightDemandFrame = useMemo(
    () => rightReplay ? frameAtOrBefore(rightReplay.frames, rightDemandReplayTime) : null,
    [rightDemandReplayTime, rightReplay],
  );
  const leftTemporalSource = useMemo(() => leftReplay ? {
    frames: leftReplay.frames,
    passengerEvents: leftReplay.passengerEvents,
  } : null, [leftReplay]);
  const rightTemporalSource = useMemo(() => rightReplay ? {
    frames: rightReplay.frames,
    passengerEvents: rightReplay.passengerEvents,
  } : null, [rightReplay]);

  const loadFile = useCallback(async (side: ReplaySide, file: File) => {
    const loadId = fileLoadIdsRef.current[side] + 1;
    fileLoadIdsRef.current[side] = loadId;
    const setReplay = side === 'left' ? setLeftReplay : setRightReplay;
    const setError = side === 'left' ? setLeftError : setRightError;

    setError(null);
    try {
      const parsed = await loadReplayFile(file);
      if (loadId !== fileLoadIdsRef.current[side]) return;
      setReplay(parsed);
      setSelectedVehicleSegments(previous => ({ ...previous, [side]: null }));
      setCancellationContexts(previous => ({ ...previous, [side]: null }));
      cancellationReturnTimesRef.current[side] = null;
      const nextLeftReplay = side === 'left' ? parsed : leftReplay;
      const nextRightReplay = side === 'right' ? parsed : rightReplay;
      setReplayTimes(prev => ({
        ...(isReplayTimeSynced
          ? syncedReplayTimes(nextLeftReplay, nextRightReplay, parsed.timeMax)
          : {
            left: side === 'left' ? parsed.timeMax : leftReplay?.timeMax ?? prev.left,
            right: side === 'right' ? parsed.timeMax : rightReplay?.timeMax ?? prev.right,
          }),
      }));
    } catch (error) {
      if (loadId !== fileLoadIdsRef.current[side]) return;
      setError(error instanceof Error ? error.message : 'Failed to load replay file.');
    }
  }, [isReplayTimeSynced, leftReplay, rightReplay]);

  useEffect(() => {
    if (!canSyncReplayTimes) setIsReplayTimeSynced(false);
  }, [canSyncReplayTimes]);

  useEffect(() => {
    setReplayTimes(prev => ({
      ...prev,
      left: clampReplayTime(leftReplay, prev.left),
    }));
  }, [leftReplay]);

  useEffect(() => {
    setReplayTimes(prev => ({
      ...prev,
      right: clampReplayTime(rightReplay, prev.right),
    }));
  }, [rightReplay]);

  const handleReplayTimeChange = useCallback((side: ReplaySide, time: number) => {
    if (isReplayTimeSynced) {
      setReplayTimes(syncedReplayTimes(leftReplay, rightReplay, time));
      setSelectedVehicleSegments({ left: null, right: null });
      setCancellationContexts({ left: null, right: null });
      cancellationReturnTimesRef.current = { left: null, right: null };
      return;
    }

    setReplayTimes(prev => ({ ...prev, [side]: time }));
    setSelectedVehicleSegments(previous => ({ ...previous, [side]: null }));
    setCancellationContexts(previous => ({ ...previous, [side]: null }));
    cancellationReturnTimesRef.current[side] = null;
  }, [isReplayTimeSynced, leftReplay, rightReplay]);

  const handleReplaySyncToggle = useCallback((enabled: boolean) => {
    setIsReplayTimeSynced(enabled);
    if (!enabled) return;

    const syncTime = leftReplay ? replayTimes.left : replayTimes.right;
    setReplayTimes(syncedReplayTimes(leftReplay, rightReplay, syncTime));
    setSelectedVehicleSegments({ left: null, right: null });
    setCancellationContexts({ left: null, right: null });
    cancellationReturnTimesRef.current = { left: null, right: null };
  }, [leftReplay, replayTimes.left, replayTimes.right, rightReplay]);

  const handleSelectVehicleSegment = useCallback((selection: VehiclePatternSelection) => {
    setCancellationContexts(previous => ({ ...previous, [selection.resultSide]: null }));
    cancellationReturnTimesRef.current[selection.resultSide] = null;
    setSelectedVehicleSegments(previous => {
      const current = previous[selection.resultSide];
      const isSameSelection =
        current?.vehicleId === selection.vehicleId &&
        current.startTime === selection.startTime &&
        current.endTime === selection.endTime &&
        current.status === selection.status;
      return {
        ...previous,
        [selection.resultSide]: isSameSelection ? null : selection,
      };
    });
    setExpandedOperationMaps(previous => ({ ...previous, [selection.resultSide]: true }));
    setExpandedHeatmaps(previous => ({ ...previous, [selection.resultSide]: true }));
  }, []);

  const clearVehicleSegment = useCallback((side: ReplaySide) => {
    setSelectedVehicleSegments(previous => ({ ...previous, [side]: null }));
  }, []);

  const handleCancellationContext = useCallback((
    side: ReplaySide,
    context: CancellationAnalysisContext,
  ) => {
    if (cancellationContexts[side] == null && cancellationReturnTimesRef.current[side] == null) {
      cancellationReturnTimesRef.current[side] = replayTimes[side];
    }
    setCancellationContexts(previous => ({ ...previous, [side]: context }));
    setSelectedVehicleSegments(previous => ({ ...previous, [side]: null }));
    setReplayTimes(previous => ({ ...previous, [side]: context.endTime }));
    setExpandedOperationMaps(previous => ({ ...previous, [side]: true }));
    setPatternMode('vehicle');
  }, [cancellationContexts, replayTimes]);

  const clearCancellationContext = useCallback((side: ReplaySide) => {
    const returnTime = cancellationReturnTimesRef.current[side];
    cancellationReturnTimesRef.current[side] = null;
    setCancellationContexts(previous => ({ ...previous, [side]: null }));
    if (returnTime != null) {
      setReplayTimes(previous => ({ ...previous, [side]: returnTime }));
    }
  }, []);

  const toggleNetworkMap = useCallback((side: ReplaySide) => {
    setExpandedNetworkMaps(prev => ({ ...prev, [side]: !prev[side] }));
  }, []);

  const toggleOperationMap = useCallback((side: ReplaySide) => {
    setExpandedOperationMaps(prev => ({ ...prev, [side]: !prev[side] }));
  }, []);

  const toggleHeatmap = useCallback((side: ReplaySide) => {
    setExpandedHeatmaps(prev => ({ ...prev, [side]: !prev[side] }));
  }, []);

  return (
    <div className="compare-layout">
      <aside className="compare-sidebar">
        <div className="panel compare-controls-panel">
          <h3 className="panel-title">Result Files</h3>
          <div className="compare-upload-grid">
            <ReplayUpload side="left" replay={leftReplay} error={leftError} onFile={loadFile} />
            <ReplayUpload side="right" replay={rightReplay} error={rightError} onFile={loadFile} />
          </div>
        </div>

        <div className="panel compare-controls-panel compare-replay-panel">
          <div className="compare-replay-head">
            <h3 className="panel-title">Replay Time</h3>
            <label className={"compare-switch-toggle" + (!canSyncReplayTimes ? " is-disabled" : "")}>
              <input
                type="checkbox"
                checked={isReplayTimeSynced}
                disabled={!canSyncReplayTimes}
                onChange={event => handleReplaySyncToggle(event.currentTarget.checked)}
              />
              <span className="compare-switch-track" aria-hidden="true" />
              <span className="compare-switch-label">Sync</span>
            </label>
          </div>
          <div className="compare-result-sliders">
            <ResultReplaySlider
              side="left"
              replay={leftReplay}
              time={replayTimes.left}
              onTimeChange={handleReplayTimeChange}
            />
            <ResultReplaySlider
              side="right"
              replay={rightReplay}
              time={replayTimes.right}
              onTimeChange={handleReplayTimeChange}
            />
          </div>
          <button
            type="button"
            className="btn compare-mode-toggle"
            onClick={() => setPatternMode(mode => (mode === 'system' ? 'vehicle' : 'system'))}
            disabled={loadedReplays.length === 0}
          >
            {patternMode === 'system' ? 'Vehicle Patterns' : 'System Patterns'}
          </button>
        </div>

        <ComparisonMetricsPanel
          leftFrame={leftFrame}
          rightFrame={rightFrame}
        />

      </aside>

      <main className="compare-main">
        <div className={"compare-map-grid" + (hasExpandedNetworkMap ? " has-expanded" : "")}>
          <ResultMapPanel
            side="left"
            replay={leftReplay}
            frame={leftFrame}
            selectedSegment={selectedVehicleSegments.left}
            isExpanded={expandedNetworkMaps.left}
            onToggleExpanded={() => toggleNetworkMap('left')}
            onClearSelectedSegment={() => clearVehicleSegment('left')}
          />
          <ResultMapPanel
            side="right"
            replay={rightReplay}
            frame={rightFrame}
            selectedSegment={selectedVehicleSegments.right}
            isExpanded={expandedNetworkMaps.right}
            onToggleExpanded={() => toggleNetworkMap('right')}
            onClearSelectedSegment={() => clearVehicleSegment('right')}
          />
        </div>
        <div className={"compare-map-grid compare-operation-grid" + (hasExpandedOperationMap ? " has-expanded" : "")}>
          <ResultVehicleOperationPanel
            side="left"
            replay={leftReplay}
            frame={leftFrame}
            replayTime={replayTimes.left}
            selectedSegment={selectedVehicleSegments.left}
            cancellationContext={cancellationContexts.left}
            comparisonReplay={rightReplay}
            comparisonReplayTime={replayTimes.right}
            comparisonSelectedSegment={selectedVehicleSegments.right}
            comparisonCancellationContext={cancellationContexts.right}
            statusVisibility={operationStatusVisibility}
            onStatusVisibilityChange={setOperationStatusVisibility}
            isExpanded={expandedOperationMaps.left}
            onToggleExpanded={() => toggleOperationMap('left')}
          />
          <ResultVehicleOperationPanel
            side="right"
            replay={rightReplay}
            frame={rightFrame}
            replayTime={replayTimes.right}
            selectedSegment={selectedVehicleSegments.right}
            cancellationContext={cancellationContexts.right}
            comparisonReplay={leftReplay}
            comparisonReplayTime={replayTimes.left}
            comparisonSelectedSegment={selectedVehicleSegments.left}
            comparisonCancellationContext={cancellationContexts.left}
            statusVisibility={operationStatusVisibility}
            onStatusVisibilityChange={setOperationStatusVisibility}
            isExpanded={expandedOperationMaps.right}
            onToggleExpanded={() => toggleOperationMap('right')}
          />
        </div>
        <div className={"compare-map-grid compare-heatmap-grid" + (hasExpandedHeatmap ? " has-expanded" : "")}>
          <ResultDemandNetworkPanel
            side="left"
            replay={leftReplay}
            frame={leftDemandFrame}
            replayTime={leftDemandReplayTime}
            comparisonReplay={rightReplay}
            comparisonFrame={rightDemandFrame}
            comparisonReplayTime={rightDemandReplayTime}
            selectedSegment={selectedVehicleSegments.left}
            comparisonSelectedSegment={selectedVehicleSegments.right}
            onSelectCancellationContext={context => handleCancellationContext('left', context)}
            onCloseCancellationContext={() => clearCancellationContext('left')}
            isExpanded={expandedHeatmaps.left}
            onToggleExpanded={() => toggleHeatmap('left')}
          />
          <ResultDemandNetworkPanel
            side="right"
            replay={rightReplay}
            frame={rightDemandFrame}
            replayTime={rightDemandReplayTime}
            comparisonReplay={leftReplay}
            comparisonFrame={leftDemandFrame}
            comparisonReplayTime={leftDemandReplayTime}
            selectedSegment={selectedVehicleSegments.right}
            comparisonSelectedSegment={selectedVehicleSegments.left}
            onSelectCancellationContext={context => handleCancellationContext('right', context)}
            onCloseCancellationContext={() => clearCancellationContext('right')}
            isExpanded={expandedHeatmaps.right}
            onToggleExpanded={() => toggleHeatmap('right')}
          />
        </div>
        {selectedVehicleSegments.left ||
        selectedVehicleSegments.right ||
        cancellationContexts.left ||
        cancellationContexts.right ? (
          <div className="compare-selection-context" role="status">
            {(['left', 'right'] as ReplaySide[]).map(side => {
              const cancellationContext = cancellationContexts[side];
              if (cancellationContext) {
                return (
                  <div className="compare-selection-context-item" key={side}>
                    <span>
                      {SIDE_LABEL[side]} · R{cancellationContext.requestId} · {' '}
                      t={formatSimTime(cancellationContext.startTime)}-{formatSimTime(cancellationContext.endTime)}
                    </span>
                    <button
                      type="button"
                      className="compare-selection-clear"
                      aria-label={`Clear ${SIDE_LABEL[side]} cancellation request interval`}
                      title={`Clear ${SIDE_LABEL[side]} cancellation interval`}
                      onClick={() => clearCancellationContext(side)}
                    >
                      <span aria-hidden="true" />
                    </button>
                  </div>
                );
              }
              const selection = selectedVehicleSegments[side];
              if (!selection) return null;
              return (
                <div className="compare-selection-context-item" key={side}>
                  <span>
                    {selection.resultLabel} · V{selection.vehicleId} · {VEHICLE_STATUS_LABEL[selection.status]} · {' '}
                    t={formatSimTime(selection.startTime)}-{formatSimTime(selection.endTime)}
                  </span>
                  <button
                    type="button"
                    className="compare-selection-clear"
                    aria-label={`Clear ${selection.resultLabel} selected vehicle interval`}
                    title={`Clear ${selection.resultLabel} selected interval`}
                    onClick={() => clearVehicleSegment(side)}
                  >
                    <span aria-hidden="true" />
                  </button>
                </div>
              );
            })}
          </div>
        ) : null}
        {patternMode === 'vehicle' ? (
          <VehicleTemporalComparisonCharts
            resultA={leftTemporalSource}
            resultB={rightTemporalSource}
            currentTimes={replayTimes}
            selectedSegments={selectedVehicleSegments}
            contextIntervals={{
              left: cancellationContexts.left
                ? [cancellationContexts.left.startTime, cancellationContexts.left.endTime]
                : null,
              right: cancellationContexts.right
                ? [cancellationContexts.right.startTime, cancellationContexts.right.endTime]
                : null,
            }}
            onSelectSegment={handleSelectVehicleSegment}
          />
        ) : (
          <TemporalComparisonCharts
            resultA={leftTemporalSource}
            resultB={rightTemporalSource}
            currentTimes={replayTimes}
          />
        )}
      </main>
    </div>
  );
}
