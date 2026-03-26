interface SimulationControlsProps {
  isRunning: boolean;
  speed: number;
  vehicleCount: number;
  onStart: () => void;
  onStop: () => void;
  onReset: () => void;
  onSpeedChange: (speed: number) => void;
  onVehicleCountChange: (count: number) => void;
}

export default function SimulationControls({
  isRunning,
  speed,
  vehicleCount,
  onStart,
  onStop,
  onReset,
  onSpeedChange,
  onVehicleCountChange,
}: SimulationControlsProps) {
  return (
    <div className="panel controls-panel">
      <h3 className="panel-title">Simulation Controls</h3>
      <div className="controls-grid">
        <div className="control-buttons">
          {isRunning ? (
            <button className="btn btn-warning" onClick={onStop}>
              ⏸ Pause
            </button>
          ) : (
            <button className="btn btn-primary" onClick={onStart}>
              ▶ Start
            </button>
          )}
          <button className="btn btn-danger" onClick={onReset}>
            ↺ Reset
          </button>
        </div>

        <div className="control-group">
          <label className="control-label">
            Speed: <strong>{speed}x</strong>
          </label>
          <input
            type="range"
            min={1}
            max={10}
            value={speed}
            onChange={(e) => onSpeedChange(Number(e.target.value))}
            className="slider"
          />
        </div>

        <div className="control-group">
          <label className="control-label">
            Vehicles: <strong>{vehicleCount}</strong>
          </label>
          <input
            type="range"
            min={1}
            max={20}
            value={vehicleCount}
            onChange={(e) => onVehicleCountChange(Number(e.target.value))}
            className="slider"
            disabled={isRunning}
          />
        </div>
      </div>
    </div>
  );
}
