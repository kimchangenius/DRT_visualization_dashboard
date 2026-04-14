import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Passenger, Vehicle } from '../types/simulation';

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
  vehicles: Vehicle[];
  passengers: Passenger[];
  onStart: () => void;
  onStop: () => void;
  onReset: () => void;
  canEnterAnalysis: boolean;
  inAnalysisMode: boolean;
  onEnterAnalysis: () => void;
  analysisVehicleId: number | null;
  analysisVehicleIds: number[];
  onSelectAnalysisVehicle: (id: number | null) => void;
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

function acceptedRequestsForVehicle(vehicleId: number, passengers: Passenger[]): Passenger[] {
  return passengers.filter(
    p =>
      p.assignedVehicleId === vehicleId &&
      (p.status === 'waiting' || p.status === 'picked_up'),
  );
}

function passengerById(passengers: Passenger[], id: number | null): Passenger | undefined {
  if (id == null) return undefined;
  return passengers.find(p => p.id === id);
}

function requestSummary(p: Passenger): string {
  return `#${p.id} ${p.originNodeId}→${p.destinationNodeId} · ${p.status} · req_t=${p.requestTime}`;
}

function VehicleStatusCard({ vehicle, passengers }: { vehicle: Vehicle; passengers: Passenger[] }) {
  const accepted = acceptedRequestsForVehicle(vehicle.id, passengers);
  const onboard = passengerById(passengers, vehicle.passengerId);
  const lines: Passenger[] = [];
  const seen = new Set<number>();
  if (onboard) {
    lines.push(onboard);
    seen.add(onboard.id);
  }
  for (const p of accepted) {
    if (!seen.has(p.id)) {
      lines.push(p);
      seen.add(p.id);
    }
  }

  return (
    <div className="control-vehicle-status-card">
      <div className="control-vehicle-status-card-head">Vehicle {vehicle.id}</div>
      <dl className="control-vehicle-status-dl">
        <div className="control-vehicle-status-row">
          <dt>curr_node</dt>
          <dd>
            {vehicle.currentNodeId}
            {vehicle.targetNodeId != null ? (
              <span className="control-vehicle-status-sub"> → target {vehicle.targetNodeId}</span>
            ) : null}
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
                {lines.map(p => (
                  <li key={p.id}>{requestSummary(p)}</li>
                ))}
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
  vehicles,
  passengers,
  onStart,
  onStop,
  onReset,
  canEnterAnalysis,
  inAnalysisMode,
  onEnterAnalysis,
  analysisVehicleId,
  analysisVehicleIds,
  onSelectAnalysisVehicle,
  replayTime,
  onReplayTimeChange,
  isReplaying,
  onToggleReplay,
  timeRange,
}: SimulationControlsProps) {
  const [selectedVehicleIds, setSelectedVehicleIds] = useState<number[]>([]);

  const toggleVehicleSelection = useCallback((id: number) => {
    setSelectedVehicleIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  }, []);

  const vehicleById = useMemo(() => {
    const m = new Map<number, Vehicle>();
    for (const v of vehicles) m.set(v.id, v);
    return m;
  }, [vehicles]);

  useEffect(() => {
    const ids = new Set(vehicles.map(v => v.id));
    setSelectedVehicleIds(prev => prev.filter(id => ids.has(id)));
  }, [vehicles]);

  const selectedPanels = useMemo(
    () => selectedVehicleIds.map(id => ({ id, vehicle: vehicleById.get(id) })),
    [selectedVehicleIds, vehicleById],
  );

  const vehicleButtonsDisabled = vehicles.length === 0;

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
          ) : canEnterAnalysis ? (
            <button type="button" className="btn btn-analysis" onClick={onEnterAnalysis}>
              Analysis Mode
            </button>
          ) : inAnalysisMode ? (
            <button type="button" className="btn btn-analysis" disabled aria-label="Analysis mode active">
              Analysis Mode
            </button>
          ) : (
            <button type="button" className="btn btn-primary" onClick={onStart}>
              ▶ Start
            </button>
          )}
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
                  return (
                    <button
                      key={id}
                      type="button"
                      className={`control-vehicle-chip${selected ? ' is-analysis-selected' : ''}`}
                      onClick={() => handleAnalysisVehicleClick(id)}
                      title={selected ? 'Click to exit analysis' : 'Click to analyze this vehicle'}
                    >
                      V{id}
                    </button>
                  );
                })}
              </div>

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
          ) : (
            <div className="control-vehicles">
              <div className="control-vehicles-title">Vehicles Information</div>
              {vehicles.length === 0 ? (
                <p className="control-vehicles-hint">The list of vehicles running in the simulation is displayed here.</p>
              ) : (
                <div
                  className="control-vehicle-buttons"
                  role="group"
                  aria-label="Vehicle status panels"
                >
                  {vehicles.map(v => {
                    const selected = selectedVehicleIds.includes(v.id);
                    return (
                      <button
                        key={v.id}
                        type="button"
                        className={`control-vehicle-chip${selected ? ' is-selected' : ''}`}
                        onClick={() => toggleVehicleSelection(v.id)}
                        disabled={vehicleButtonsDisabled}
                        title={
                          vehicleButtonsDisabled
                            ? 'No vehicle data'
                            : selected
                              ? 'Click to close panel'
                              : 'Click to add status panel'
                        }
                      >
                        V{v.id}
                      </button>
                    );
                  })}
                </div>
              )}
              {selectedPanels.length > 0 ? (
                <div className="control-vehicle-status-list">
                  {selectedPanels.map(({ id, vehicle }) =>
                    vehicle && <VehicleStatusCard key={id} vehicle={vehicle} passengers={passengers} />
                  )}
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
