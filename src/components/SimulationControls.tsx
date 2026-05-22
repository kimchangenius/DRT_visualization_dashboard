import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DemandScenario, Vehicle, Passenger, VehicleAnalysisSummary } from '../types/simulation';
import { formatSimTime } from '../utils/time';

interface SimulationControlsProps {
  isRunning: boolean;
  maxNumVehicles: number;
  vehCapacity: number;
  maxNumRequest: number;
  maxWaitTime: number;
  hiddenDim: number;
  batchSize: number;
  learningRate: number;
  selectedScenario: DemandScenario;
  availableScenarios: DemandScenario[];
  scenarioSeed: number;
  modelWeightFile: string | null;
  scenarioSelectionLocked: boolean;
  onScenarioChange: (scenario: DemandScenario) => void;
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
  vehicles: Vehicle[];
  passengers: Passenger[];
  analysisSummary?: VehicleAnalysisSummary;
  maxWaitTimeThreshold?: number;
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

function waitSeverityColor(waitTime: number, threshold: number): string {
  if (threshold <= 0) return '#f59e0b';
  const r = Math.max(0, Math.min(1, waitTime / threshold));
  if (r < 0.5) return '#10b981';
  if (r < 0.85) return '#f59e0b';
  return '#ef4444';
}

const SCENARIO_TOOLTIPS: Record<DemandScenario, { title: string; body: string }> = {
  S1: {
    title: 'S1 · 중앙 집중 수요',
    body: '노드 10, 11, 14, 15에서 출발 수요가 높게 발생합니다. 중심부 고밀도 서비스 압박을 확인하기 좋습니다.',
  },
  S2: {
    title: 'S2 · 진입부 편향 수요',
    body: '노드 1, 3, 4에서 출발 수요가 높게 발생합니다. 네트워크 한쪽으로 몰리는 유입 패턴을 만듭니다.',
  },
  S3: {
    title: 'S3 · 다중 거점 수요',
    body: '노드 2, 5, 6, 13, 23, 24에서 출발 수요가 높게 발생합니다. 떨어진 여러 핫스팟을 동시에 테스트합니다.',
  },
  S4: {
    title: 'S4 · 균일 기준 수요',
    body: '특정 고수요 노드 없이 전체 네트워크에 수요가 고르게 분포합니다. 비교 기준 시나리오로 사용합니다.',
  },
};

const SCENARIO_TOOLTIP_DURATION_MS = 5000;

export default function SimulationControls({
  isRunning,
  maxNumVehicles,
  vehCapacity,
  maxWaitTime,
  hiddenDim,
  batchSize,
  learningRate,
  selectedScenario,
  availableScenarios,
  scenarioSeed,
  modelWeightFile,
  scenarioSelectionLocked,
  onScenarioChange,
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
  vehicles,
  passengers,
  analysisSummary,
  maxWaitTimeThreshold = 10,
}: SimulationControlsProps) {
  const [selectedVehicleIds, setSelectedVehicleIds] = useState<number[]>([]);
  const [hoveredScenario, setHoveredScenario] = useState<DemandScenario | null>(null);
  const scenarioTooltipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const clearScenarioTooltipTimer = useCallback(() => {
    if (scenarioTooltipTimerRef.current !== null) {
      clearTimeout(scenarioTooltipTimerRef.current);
      scenarioTooltipTimerRef.current = null;
    }
  }, []);

  const showScenarioTooltip = useCallback((scenario: DemandScenario) => {
    clearScenarioTooltipTimer();
    setHoveredScenario(scenario);
    scenarioTooltipTimerRef.current = setTimeout(() => {
      setHoveredScenario(null);
      scenarioTooltipTimerRef.current = null;
    }, SCENARIO_TOOLTIP_DURATION_MS);
  }, [clearScenarioTooltipTimer]);

  const hideScenarioTooltip = useCallback(() => {
    clearScenarioTooltipTimer();
    setHoveredScenario(null);
  }, [clearScenarioTooltipTimer]);

  useEffect(() => () => clearScenarioTooltipTimer(), [clearScenarioTooltipTimer]);

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

        <div className="scenario-control" aria-label="Demand scenario selection">
          <div className="scenario-control-head">
            <span>Demand Scenario</span>
          </div>
          <div className="scenario-options" role="group" aria-label="Demand scenarios">
            {availableScenarios.map(scenario => (
              <div
                key={scenario}
                className="scenario-option-wrap"
                onMouseEnter={() => showScenarioTooltip(scenario)}
                onMouseLeave={hideScenarioTooltip}
                onFocus={() => showScenarioTooltip(scenario)}
                onBlur={hideScenarioTooltip}
              >
                <button
                  type="button"
                  className={`scenario-option${selectedScenario === scenario ? ' is-active' : ''}`}
                  onClick={() => onScenarioChange(scenario)}
                  disabled={scenarioSelectionLocked || isRunning || selectedScenario === scenario}
                  aria-describedby={hoveredScenario === scenario ? 'scenario-tooltip' : undefined}
                >
                  {scenario}
                </button>
              </div>
            ))}
          </div>
          {hoveredScenario ? (
            <div id="scenario-tooltip" className="scenario-tooltip" role="tooltip">
              <strong>{SCENARIO_TOOLTIPS[hoveredScenario].title}</strong>
              <span>{SCENARIO_TOOLTIPS[hoveredScenario].body}</span>
            </div>
          ) : null}
        </div>

        <div className={`control-config${inAnalysisMode ? ' in-analysis' : ''}`}>
          {!inAnalysisMode && (
            <>
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
            </>
          )}

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

              {analysisVehicleId !== null && analysisSummary && (
                <div className="analysis-summary-card">
                  <div className="analysis-summary-title">Vehicle V{analysisVehicleId} Summary</div>

                  <div className="analysis-section">
                    <div className="analysis-section-title">Service Quality</div>
                    <div className="analysis-summary-grid">
                      <div className="stat-item">
                        <span className="stat-label">Service Rate</span>
                        <span className="stat-value">{analysisSummary.serviceRate.toFixed(1)}%</span>
                      </div>
                      <div className="stat-item">
                        <span className="stat-label">Avg Wait</span>
                        <span className="stat-value">{analysisSummary.avgWaitTime.toFixed(1)}</span>
                      </div>
                      <div className="stat-item">
                        <span className="stat-label">Max Wait</span>
                        <span
                          className="stat-value"
                          style={{
                            color: waitSeverityColor(analysisSummary.maxWaitTime, maxWaitTimeThreshold),
                          }}
                        >
                          {analysisSummary.maxWaitTime.toFixed(1)}
                        </span>
                      </div>
                      <div className="stat-item">
                        <span className="stat-label">Cancel Count</span>
                        <span
                          className="stat-value"
                          style={{ color: analysisSummary.cancelledPassengers > 0 ? '#ef4444' : undefined }}
                        >
                          {analysisSummary.cancelledPassengers}
                        </span>
                      </div>
                      <div className="stat-item">
                        <span className="stat-label">Avg Detour</span>
                        <span className="stat-value">×{analysisSummary.avgDetourFactor.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="analysis-section">
                    <div className="analysis-section-title">Vehicle Utilization</div>
                    <div className="analysis-summary-grid">
                      <div className="stat-item">
                        <span className="stat-label">Effective Util.</span>
                        <span className="stat-value" style={{ color: '#10b981' }}>
                          {analysisSummary.carryingPct}%
                        </span>
                      </div>
                      <div className="stat-item stat-item-wide">
                        <span className="stat-label">Status Share</span>
                        <div className="stat-bar">
                          <div
                            className="stat-bar-seg"
                            style={{ width: `${analysisSummary.idlePct}%`, background: '#3b82f6' }}
                            title={`Idle ${analysisSummary.idlePct}%`}
                          />
                          <div
                            className="stat-bar-seg"
                            style={{ width: `${analysisSummary.pickupPct}%`, background: '#f59e0b' }}
                            title={`Pickup ${analysisSummary.pickupPct}%`}
                          />
                          <div
                            className="stat-bar-seg"
                            style={{ width: `${analysisSummary.carryingPct}%`, background: '#10b981' }}
                            title={`Carrying ${analysisSummary.carryingPct}%`}
                          />
                        </div>
                        <div className="stat-bar-legend">
                          <span className="stat-bar-legend-item">
                            <span className="stat-bar-legend-dot" style={{ background: '#3b82f6' }} />
                            Idle {analysisSummary.idlePct}%
                          </span>
                          <span className="stat-bar-legend-item">
                            <span className="stat-bar-legend-dot" style={{ background: '#f59e0b' }} />
                            Pickup {analysisSummary.pickupPct}%
                          </span>
                          <span className="stat-bar-legend-item">
                            <span className="stat-bar-legend-dot" style={{ background: '#10b981' }} />
                            Carrying {analysisSummary.carryingPct}%
                          </span>
                        </div>
                      </div>
                    </div>
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
