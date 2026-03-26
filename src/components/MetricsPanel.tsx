import type { SimulationMetrics } from '../types/simulation';

interface MetricsPanelProps {
  metrics: SimulationMetrics;
}

interface MetricCardProps {
  label: string;
  value: string | number;
  unit?: string;
  color: string;
}

function MetricCard({ label, value, unit, color }: MetricCardProps) {
  return (
    <div className="metric-card">
      <div className="metric-value" style={{ color }}>
        {value}
        {unit && <span className="metric-unit">{unit}</span>}
      </div>
      <div className="metric-label">{label}</div>
    </div>
  );
}

export default function MetricsPanel({ metrics }: MetricsPanelProps) {
  return (
    <div className="metrics-panel">
      <MetricCard
        label="Active Vehicles"
        value={`${metrics.activeVehicles} / ${metrics.totalVehicles}`}
        color="#3b82f6"
      />
      <MetricCard
        label="Passengers Served"
        value={metrics.totalPassengersServed}
        color="#10b981"
      />
      <MetricCard
        label="Avg Wait Time"
        value={metrics.averageWaitTime}
        unit=" min"
        color="#f59e0b"
      />
      <MetricCard
        label="Avg Travel Time"
        value={metrics.averageTravelTime}
        unit=" min"
        color="#8b5cf6"
      />
      <MetricCard
        label="Cancel count"
        value={metrics.cancelCount ?? 0}
        color="#ec4899"
      />
      <MetricCard
        label="Waiting Passengers"
        value={metrics.totalPassengersWaiting}
        color="#ef4444"
      />
    </div>
  );
}
