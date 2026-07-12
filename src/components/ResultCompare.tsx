import { useCallback, useEffect, useMemo, useState } from 'react';
import NetworkMap from './NetworkMap';
import VehicleOperationMap from './VehicleOperationMap';
import RequestHeatmap from './RequestHeatmap';
import TemporalComparisonCharts from './TemporalComparisonCharts';
import VehicleTemporalComparisonCharts from './VehicleTemporalComparisonCharts';
import { RESULT_A_COLOR, RESULT_B_COLOR } from '../config';
import type { SimulationMetrics, SimulationState, VehiclePatternSelection } from '../types/simulation';
import { formatSimTime } from '../utils/time';
import { frameAtOrBefore, framesBetween } from '../utils/replay';

interface LoadedReplay {
  name: string;
  runName: string;
  frames: SimulationState[];
  timeMin: number;
  timeMax: number;
}

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
    label: 'Canceled Count',
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function hasNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isSimulationState(value: unknown): value is SimulationState {
  if (!isRecord(value)) return false;
  if (!isRecord(value.metrics)) return false;
  return (
    hasNumber(value.metrics.currentTime) &&
    Array.isArray(value.vehicles) &&
    Array.isArray(value.passengers) &&
    Array.isArray(value.utilizationHistory) &&
    Array.isArray(value.passengerHistory) &&
    Array.isArray(value.requestStatusData)
  );
}

function parseReplayPayload(payload: unknown, fileName: string): LoadedReplay {
  if (!isRecord(payload)) {
    throw new Error('The file must contain a replay JSON object.');
  }
  if (payload.version !== 1) {
    throw new Error('Unsupported replay file version.');
  }
  if (!Array.isArray(payload.frames) || payload.frames.length === 0) {
    throw new Error('Replay file must include at least one frame.');
  }
  if (!payload.frames.every(isSimulationState)) {
    throw new Error('Replay frames do not match the dashboard state format.');
  }

  const frames = [...payload.frames].sort(
    (a, b) => a.metrics.currentTime - b.metrics.currentTime,
  );
  const times = frames.map(frame => frame.metrics.currentTime);
  const runName = typeof payload.runName === 'string' && payload.runName.trim()
    ? payload.runName
    : fileName;

  return {
    name: fileName,
    runName,
    frames,
    timeMin: Math.min(...times),
    timeMax: Math.max(...times),
  };
}

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

function ResultRequestHeatmapPanel({
  side,
  replay,
  frame,
  replayTime,
  selectedSegment,
  isExpanded,
  onToggleExpanded,
}: {
  side: ReplaySide;
  replay: LoadedReplay | null;
  frame: SimulationState | null;
  replayTime: number;
  selectedSegment: VehiclePatternSelection | null;
  isExpanded: boolean;
  onToggleExpanded: () => void;
}) {
  const activeSelectedSegment = selectedSegment?.resultSide === side ? selectedSegment : null;
  const bodyId = `compare-request-heatmap-${side}`;
  const focusVehicleId = activeSelectedSegment?.vehicleId ?? null;
  const contextLabel = focusVehicleId == null
    ? `t=${formatSimTime(replayTime)}`
    : `V${focusVehicleId} · t=${formatSimTime(replayTime)}`;

  return (
    <section className={"compare-map-slot compare-heatmap-slot" + (isExpanded ? " is-expanded" : " is-collapsed")}>
      <div className="panel compare-map-accordion compare-heatmap-accordion">
        <button
          type="button"
          className="compare-map-accordion-head"
          aria-expanded={isExpanded}
          aria-controls={bodyId}
          aria-label={(isExpanded ? 'Collapse ' : 'Expand ') + SIDE_LABEL[side] + ' request heatmap'}
          onClick={onToggleExpanded}
        >
          <span className="compare-map-accordion-labels">
            <span className="compare-map-accordion-title" style={{ color: SIDE_COLOR[side] }}>
              {SIDE_LABEL[side]} Request Heatmap
            </span>
          </span>
          <span className="compare-map-accordion-icon" aria-hidden="true" />
        </button>
        {isExpanded ? (
          <div id={bodyId} className="compare-map-accordion-body compare-heatmap-accordion-body">
            {!replay || !frame ? (
              <div className="compare-empty-text">Load a replay JSON file.</div>
            ) : (
              <RequestHeatmap
                embedded
                hideTitle
                title={`${SIDE_LABEL[side]} Request Heatmap`}
                contextLabel={contextLabel}
                vehicleId={focusVehicleId}
                passengers={frame.passengers}
                replayTime={replayTime}
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
  isExpanded,
  onToggleExpanded,
}: {
  side: ReplaySide;
  replay: LoadedReplay | null;
  frame: SimulationState | null;
  replayTime: number;
  selectedSegment: VehiclePatternSelection | null;
  isExpanded: boolean;
  onToggleExpanded: () => void;
}) {
  const activeSelectedSegment = selectedSegment?.resultSide === side ? selectedSegment : null;
  const bodyId = `compare-vehicle-operation-map-${side}`;
  const focusVehicleId = activeSelectedSegment?.vehicleId ?? null;
  const contextLabel = focusVehicleId == null
    ? `t=${formatSimTime(replayTime)}`
    : `V${focusVehicleId} · t=${formatSimTime(replayTime)}`;

  return (
    <section className={"compare-map-slot compare-operation-slot" + (isExpanded ? " is-expanded" : " is-collapsed")}>
      <div className="panel compare-map-accordion compare-operation-accordion">
        <button
          type="button"
          className="compare-map-accordion-head"
          aria-expanded={isExpanded}
          aria-controls={bodyId}
          aria-label={(isExpanded ? 'Collapse ' : 'Expand ') + SIDE_LABEL[side] + ' vehicle activity heatmap'}
          onClick={onToggleExpanded}
        >
          <span className="compare-map-accordion-labels">
            <span className="compare-map-accordion-title" style={{ color: SIDE_COLOR[side] }}>
              {SIDE_LABEL[side]} Vehicle Activity
            </span>
          </span>
          <span className="compare-map-accordion-icon" aria-hidden="true" />
        </button>
        {isExpanded ? (
          <div id={bodyId} className="compare-map-accordion-body compare-operation-accordion-body">
            {!replay || !frame ? (
              <div className="compare-empty-text">Load a replay JSON file.</div>
            ) : (
              <VehicleOperationMap
                embedded
                hideTitle
                title={`${SIDE_LABEL[side]} Vehicle Activity Heatmap`}
                contextLabel={contextLabel}
                focusVehicleId={focusVehicleId}
                frames={replay.frames}
                currentTime={replayTime}
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
  const [selectedVehicleSegments, setSelectedVehicleSegments] = useState<Record<ReplaySide, VehiclePatternSelection | null>>({
    left: null,
    right: null,
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

  const loadFile = useCallback((side: ReplaySide, file: File) => {
    const reader = new FileReader();
    const setReplay = side === 'left' ? setLeftReplay : setRightReplay;
    const setError = side === 'left' ? setLeftError : setRightError;

    setError(null);
    setSelectedVehicleSegments(prev => ({ ...prev, [side]: null }));
    reader.onload = () => {
      try {
        const text = typeof reader.result === 'string' ? reader.result : '';
        const parsed = parseReplayPayload(JSON.parse(text), file.name);
        setReplay(parsed);
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
        setReplay(null);
        setError(error instanceof Error ? error.message : 'Failed to load replay file.');
      }
    };
    reader.onerror = () => {
      setReplay(null);
      setError('Failed to read replay file.');
    };
    reader.readAsText(file);
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
      return;
    }

    setReplayTimes(prev => ({ ...prev, [side]: time }));
    setSelectedVehicleSegments(prev => ({ ...prev, [side]: null }));
  }, [isReplayTimeSynced, leftReplay, rightReplay]);

  const handleReplaySyncToggle = useCallback((enabled: boolean) => {
    setIsReplayTimeSynced(enabled);
    if (!enabled) return;

    const syncTime = leftReplay ? replayTimes.left : replayTimes.right;
    setReplayTimes(syncedReplayTimes(leftReplay, rightReplay, syncTime));
    setSelectedVehicleSegments({ left: null, right: null });
  }, [leftReplay, replayTimes.left, replayTimes.right, rightReplay]);

  const handleSelectVehicleSegment = useCallback((selection: VehiclePatternSelection) => {
    setSelectedVehicleSegments(prev => {
      const current = prev[selection.resultSide];
      const isSameSelection =
        current?.vehicleId === selection.vehicleId &&
        current.startTime === selection.startTime &&
        current.endTime === selection.endTime &&
        current.status === selection.status;

      return {
        ...prev,
        [selection.resultSide]: isSameSelection ? null : selection,
      };
    });
  }, []);

  const clearVehicleSegment = useCallback((side: ReplaySide) => {
    setSelectedVehicleSegments(prev => ({ ...prev, [side]: null }));
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
            isExpanded={expandedOperationMaps.left}
            onToggleExpanded={() => toggleOperationMap('left')}
          />
          <ResultVehicleOperationPanel
            side="right"
            replay={rightReplay}
            frame={rightFrame}
            replayTime={replayTimes.right}
            selectedSegment={selectedVehicleSegments.right}
            isExpanded={expandedOperationMaps.right}
            onToggleExpanded={() => toggleOperationMap('right')}
          />
        </div>
        <div className={"compare-map-grid compare-heatmap-grid" + (hasExpandedHeatmap ? " has-expanded" : "")}>
          <ResultRequestHeatmapPanel
            side="left"
            replay={leftReplay}
            frame={leftFrame}
            replayTime={replayTimes.left}
            selectedSegment={selectedVehicleSegments.left}
            isExpanded={expandedHeatmaps.left}
            onToggleExpanded={() => toggleHeatmap('left')}
          />
          <ResultRequestHeatmapPanel
            side="right"
            replay={rightReplay}
            frame={rightFrame}
            replayTime={replayTimes.right}
            selectedSegment={selectedVehicleSegments.right}
            isExpanded={expandedHeatmaps.right}
            onToggleExpanded={() => toggleHeatmap('right')}
          />
        </div>
        {patternMode === 'vehicle' ? (
          <VehicleTemporalComparisonCharts
            resultA={leftReplay ? { frames: leftReplay.frames } : null}
            resultB={rightReplay ? { frames: rightReplay.frames } : null}
            currentTimes={replayTimes}
            selectedSegments={selectedVehicleSegments}
            onSelectSegment={handleSelectVehicleSegment}
          />
        ) : (
          <TemporalComparisonCharts
            resultA={leftReplay ? { frames: leftReplay.frames } : null}
            resultB={rightReplay ? { frames: rightReplay.frames } : null}
            currentTimes={replayTimes}
          />
        )}
      </main>
    </div>
  );
}
