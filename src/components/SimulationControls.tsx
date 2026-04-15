import { useCallback } from 'react';
import type { Vehicle, Passenger } from '../types/simulation';

interface SimulationControlsProps {
  isRunning: boolean;
  speed: number;
  maxNumVehicles: number;
  vehCapacity: number;
  maxNumRequest: number;
  maxWaitTime: number;
  hiddenDim: number;
  batchSize: number;
  learningRate: number;
  onStart: () => void;
  onStop: () => void;
  onReset: () => void;
  canEnterAnalysis: boolean;
  inAnalysisMode: boolean;
  onEnterAnalysis: () => void;
  analysisVehicleId: number | null;
  analysisVehicleIds: number[];
  onSelectAnalysisVehicle: (id: number | null) => void;
  analysisCurrentVehicle?: Vehicle | null;
  analysisPassengers?: Passenger[];
  replayTime: number;
  onReplayTimeChange: (t: number) => void;
  isReplaying: boolean;
  onToggleReplay: () => void;
  timeRange: { min: number; max: number };
}

function fmtInt(n: number): string {
  return n > 0 ? String(n) : '—';
}

function fmtLearningRate(x: number): string {
  if (x === 0 || !Number.isFinite(x)) return '—';
  const str = x.toExponential();
  return str
    .replace(/^([+-]?)(\d)\.0(e[-+]\d+)$/, '$1$2$3')
    .replace(/e\+(?=\d)/, 'e');
}

function requestSummary(p: Passenger): string {
  return `#${p.id} ${p.originNodeId}→${p.destinationNodeId} · ${p.status} · req_t=${p.requestTime}`;
}

function VehicleStatusCard({ vehicle, passengers }: { vehicle: Vehicle; passengers: Passenger[] }) {
  const accepted = passengers.filter(
    p => p.assignedVehicleId === vehicle.id && (p.status === 'waiting' || p.status === 'picked_up'),
  );
  const onboard = passengers.find(p => p.id === vehicle.passengerId) ?? null;
  const lines: Passenger[] = [];
  const seen = new Set<number>();
  if (onboard) { lines.push(onboard); seen.add(onboard.id); }
  for (const p of accepted) {
    if (!seen.has(p.id)) { lines.push(p); seen.add(p.id); }
  }

  return (
    <div className="control-vehicle-status-card">
      <div className="control-vehicle-status-card-head">Vehicle {vehicle.id}</div>
      <dl className="control-vehicle-status-dl">
        <div className="control-vehicle-status-row">
          <dt>curr_node</dt>
          <dd>
            {vehicle.currentNodeId}
            {vehicle.targetNodeId != null && (
              <span className="control-vehicle-status-sub"> → target {vehicle.targetNodeId}</span>
            )}
          </dd>
        </div>
        <div className="control-vehicle-status-row">
          <dt>Action status</dt>
          <dd>{vehicle.status}</dd>
        </div>
        <div className="control-vehicle-status-row control-vehicle-status-row-block">
          <dt>Accepted request info</dt>
          <dd>
            {lines.length === 0 ? (
              <span className="control-vehicle-status-empty">—</span>
            ) : (
              <ul className="control-vehicle-request-list">
                {lines.map(p => <li key={p.id}>{requestSummary(p)}</li>)}
              </ul>
            )}
          </dd>
        </div>
      </dl>
    </div>
  );
}

function formatSimTime(t: number): string {
  const h = Math.floor(t / 60);
  const m = t % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export default function SimulationControls({
  isRunning,
  maxNumVehicles,
  vehCapacity,
  maxWaitTime,
  hiddenDim,
  batchSize,
  learningRate,
  onStart,
  onStop,
  onReset,
  canEnterAnalysis,
  inAnalysisMode,
  onEnterAnalysis,
  analysisVehicleId,
  analysisVehicleIds,
  onSelectAnalysisVehicle,
  analysisCurrentVehicle,
  analysisPassengers = [],
  replayTime,
  onReplayTimeChange,
  isReplaying,
  onToggleReplay,
  timeRange,
}: SimulationControlsProps) {
  const handleAnalysisVehicleClick = useCallback((id: number) => {
    onSelectAnalysisVehicle(analysisVehicleId === id ? null : id);
  }, [analysisVehicleId, onSelectAnalysisVehicle]);

  const showAnalysisVehicles = inAnalysisMode && analysisVehicleIds.length > 0;

  return (
    <div className="panel controls-panel">
      <h3 className="panel-title">Simulation Controls</h3>
      <div className="controls-grid">
        <div className="control-buttons">
          {isRunning ? (
            <button type="button" className="btn btn-warning" onClick={onStop}>
              ⏸ Pause
            </button>
          ) : (
            <button type="button" className="btn btn-primary" onClick={onStart}>
              ▶ Start
            </button>
          )}
          <button
            type="button"
            className="btn btn-analysis"
            onClick={onEnterAnalysis}
            disabled={!canEnterAnalysis}
            aria-label={inAnalysisMode ? 'Analysis mode active' : 'Enter analysis mode'}
          >
            Analysis
          </button>
          <button type="button" className="btn btn-danger" onClick={onReset}>
            ↺ Reset
          </button>
        </div>

        <div className="control-config">
          <div className="control-config-title">Environment</div>
          <dl className="control-config-rows">
            <div className="control-config-row">
              <dt>Vehicles</dt>
              <dd>
                <strong>{fmtInt(maxNumVehicles)}</strong>
              </dd>
            </div>
            <div className="control-config-row">
              <dt>Vehicle capacity</dt>
              <dd>
                <strong>{fmtInt(vehCapacity)}</strong>
              </dd>
            </div>
            <div className="control-config-row">
              <dt>Max wait time</dt>
              <dd>
                <strong>{fmtInt(maxWaitTime)}</strong> min
              </dd>
            </div>
          </dl>

          <div className="control-config-title">Policy network (trained)</div>
          <dl className="control-config-rows">
            <div className="control-config-row">
              <dt>Hidden dim</dt>
              <dd>
                <strong>{fmtInt(hiddenDim)}</strong>
              </dd>
            </div>
            <div className="control-config-row">
              <dt>Batch size</dt>
              <dd>
                <strong>{fmtInt(batchSize)}</strong>
              </dd>
            </div>
            <div className="control-config-row">
              <dt>Learning rate</dt>
              <dd>
                <strong>{fmtLearningRate(learningRate)}</strong>
              </dd>
            </div>
          </dl>

          {showAnalysisVehicles ? (
            <div className="control-vehicles">
              <div className="control-vehicles-title">Vehicle Analysis</div>
              <p className="control-vehicles-hint">
                Select a vehicle to analyze its operation log.
              </p>
              <div
                className="control-vehicle-buttons"
                role="group"
                aria-label="Vehicle analysis selection"
              >
                {analysisVehicleIds.map(id => {
                  const selected = analysisVehicleId === id;
                  const faded = analysisVehicleId !== null && !selected;
                  return (
                    <button
                      key={id}
                      type="button"
                      className={`control-vehicle-chip${selected ? ' is-analysis-selected' : ''}${faded ? ' is-analysis-faded' : ''}`}
                      onClick={() => handleAnalysisVehicleClick(id)}
                      title={selected ? 'Click to exit analysis' : 'Click to analyze this vehicle'}
                    >
                      V{id}
                    </button>
                  );
                })}
              </div>

              {analysisVehicleId !== null && analysisCurrentVehicle && (
                <div className="control-vehicle-status-list">
                  <VehicleStatusCard vehicle={analysisCurrentVehicle} passengers={analysisPassengers} />
                </div>
              )}

              {analysisVehicleId !== null && (
                <div className="replay-controls">
                  <div className="replay-header">
                    <span className="analysis-badge">
                      Analysis: Vehicle {analysisVehicleId}
                    </span>
                  </div>
                  <div className="replay-slider-row">
                    <button
                      type="button"
                      className="btn replay-btn"
                      onClick={onToggleReplay}
                      title={isReplaying ? 'Pause replay' : 'Play replay'}
                    >
                      {isReplaying ? '⏸' : '▶'}
                    </button>
                    <input
                      type="range"
                      className="slider replay-slider"
                      min={timeRange.min}
                      max={timeRange.max}
                      value={replayTime}
                      onChange={e => onReplayTimeChange(Number(e.target.value))}
                    />
                  </div>
                  <div className="replay-time-label">
                    t = {formatSimTime(replayTime)}
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
