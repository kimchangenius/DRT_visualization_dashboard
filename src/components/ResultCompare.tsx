import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import NetworkMap from './NetworkMap';
import MetricsPanel from './MetricsPanel';
import TemporalComparisonCharts from './TemporalComparisonCharts';
import VehicleTemporalComparisonCharts from './VehicleTemporalComparisonCharts';
import { PLAYBACK_INTERVAL_MS } from '../config';
import type { SimulationState } from '../types/simulation';

interface LoadedReplay {
  name: string;
  runName: string;
  frames: SimulationState[];
  timeMin: number;
  timeMax: number;
}

type ReplaySide = 'left' | 'right';

const SIDE_LABEL: Record<ReplaySide, string> = {
  left: 'Result A',
  right: 'Result B',
};

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

function frameAtTime(replay: LoadedReplay | null, time: number): SimulationState | null {
  if (!replay) return null;
  let selected = replay.frames[0];
  for (const frame of replay.frames) {
    if (frame.metrics.currentTime <= time) {
      selected = frame;
    } else {
      break;
    }
  }
  return selected;
}

function formatSimTime(t: number): string {
  const h = Math.floor(t / 60);
  const m = t % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
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
}: {
  side: ReplaySide;
  replay: LoadedReplay | null;
  frame: SimulationState | null;
}) {
  if (!replay || !frame) {
    return (
      <section className="compare-map-slot">
        <div className="panel compare-empty-panel">
          <h3 className="panel-title">{SIDE_LABEL[side]}</h3>
          <div className="compare-empty-text">Load a replay JSON file.</div>
        </div>
      </section>
    );
  }

  return (
    <section className="compare-map-slot">
      <NetworkMap
        title={SIDE_LABEL[side]}
        vehicles={frame.vehicles}
        passengers={frame.passengers}
        maxWaitTimeThreshold={frame.maxWaitTime}
      />
    </section>
  );
}

function ResultMetricsPanel({
  side,
  replay,
  frame,
}: {
  side: ReplaySide;
  replay: LoadedReplay | null;
  frame: SimulationState | null;
}) {
  return (
    <div className="panel compare-result-metrics-panel">
      <div className="compare-result-metrics-head">
        <h3 className="panel-title">{SIDE_LABEL[side]} Metrics</h3>
        {replay ? <span className="compare-metrics-source">{replay.name}</span> : null}
      </div>
      {frame ? (
        <MetricsPanel metrics={frame.metrics} />
      ) : (
        <div className="compare-empty-text compare-metrics-empty">Load a replay JSON file.</div>
      )}
    </div>
  );
}

export default function ResultCompare() {
  const [leftReplay, setLeftReplay] = useState<LoadedReplay | null>(null);
  const [rightReplay, setRightReplay] = useState<LoadedReplay | null>(null);
  const [leftError, setLeftError] = useState<string | null>(null);
  const [rightError, setRightError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [patternMode, setPatternMode] = useState<'system' | 'vehicle'>('system');
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadedReplays = useMemo(
    () => [leftReplay, rightReplay].filter((r): r is LoadedReplay => r !== null),
    [leftReplay, rightReplay],
  );

  const timeRange = useMemo(() => {
    if (loadedReplays.length === 0) return { min: 0, max: 0 };
    return {
      min: Math.min(...loadedReplays.map(replay => replay.timeMin)),
      max: Math.max(...loadedReplays.map(replay => replay.timeMax)),
    };
  }, [loadedReplays]);

  const leftFrame = useMemo(() => frameAtTime(leftReplay, currentTime), [leftReplay, currentTime]);
  const rightFrame = useMemo(() => frameAtTime(rightReplay, currentTime), [rightReplay, currentTime]);

  const loadFile = useCallback((side: ReplaySide, file: File) => {
    const reader = new FileReader();
    const setReplay = side === 'left' ? setLeftReplay : setRightReplay;
    const setError = side === 'left' ? setLeftError : setRightError;

    setError(null);
    reader.onload = () => {
      try {
        const text = typeof reader.result === 'string' ? reader.result : '';
        const parsed = parseReplayPayload(JSON.parse(text), file.name);
        setReplay(parsed);
        setCurrentTime(prev => {
          if (loadedReplays.length === 0) return parsed.timeMin;
          return Math.min(Math.max(prev, parsed.timeMin), Math.max(timeRange.max, parsed.timeMax));
        });
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
  }, [loadedReplays.length, timeRange.max]);

  useEffect(() => {
    setCurrentTime(prev => Math.min(Math.max(prev, timeRange.min), timeRange.max));
    if (loadedReplays.length === 0) setIsPlaying(false);
  }, [loadedReplays.length, timeRange.min, timeRange.max]);

  useEffect(() => {
    if (!isPlaying || loadedReplays.length === 0) return;
    intervalRef.current = setInterval(() => {
      setCurrentTime(prev => {
        if (prev >= timeRange.max) {
          setIsPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, PLAYBACK_INTERVAL_MS);

    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isPlaying, loadedReplays.length, timeRange.max]);

  const canReplay = loadedReplays.length > 0 && timeRange.max > timeRange.min;

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
            <h3 className="panel-title">Synchronized Replay</h3>
            <div className="replay-time-label">
              t = {formatSimTime(currentTime)}
            </div>
          </div>
          <div className="compare-replay-controls">
            <button
              type="button"
              className="btn replay-btn"
              onClick={() => setIsPlaying(prev => !prev)}
              disabled={!canReplay}
              title={isPlaying ? 'Pause replay' : 'Play replay'}
            >
              {isPlaying ? '||' : '▶'}
            </button>
            <input
              type="range"
              className="slider replay-slider"
              min={timeRange.min}
              max={timeRange.max}
              value={currentTime}
              disabled={!canReplay}
              onChange={event => setCurrentTime(Number(event.target.value))}
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

        <ResultMetricsPanel side="left" replay={leftReplay} frame={leftFrame} />
        <ResultMetricsPanel side="right" replay={rightReplay} frame={rightFrame} />
      </aside>

      <main className="compare-main">
        <div className="compare-map-grid">
          <ResultMapPanel side="left" replay={leftReplay} frame={leftFrame} />
          <ResultMapPanel side="right" replay={rightReplay} frame={rightFrame} />
        </div>
        {patternMode === 'vehicle' ? (
          <VehicleTemporalComparisonCharts
            resultA={leftReplay ? { frames: leftReplay.frames } : null}
            resultB={rightReplay ? { frames: rightReplay.frames } : null}
            currentTime={currentTime}
          />
        ) : (
          <TemporalComparisonCharts
            resultA={leftReplay ? { frames: leftReplay.frames } : null}
            resultB={rightReplay ? { frames: rightReplay.frames } : null}
            currentTime={currentTime}
          />
        )}
      </main>
    </div>
  );
}
