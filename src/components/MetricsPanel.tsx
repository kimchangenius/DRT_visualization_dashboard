import type { SimulationMetrics } from '../types/simulation';

interface MetricsPanelProps {
  metrics: SimulationMetrics;
  accentColor?: string;
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

export default function MetricsPanel({ metrics, accentColor }: MetricsPanelProps) {
  const cancelledCount = metrics.cancelCount ?? 0;
  const completedCount = metrics.totalPassengersServed + cancelledCount;
  const serviceRate = completedCount > 0
    ? Math.round((metrics.totalPassengersServed / completedCount) * 1000) / 10
    : 0;

  const colors = {
    activeVehicles: accentColor ?? '#3b82f6',
    served: accentColor ?? '#10b981',
    serviceRate: accentColor ?? '#22c55e',
    averageWait: accentColor ?? '#f59e0b',
    averageTravel: accentColor ?? '#8b5cf6',
    canceled: accentColor ?? '#ec4899',
    waiting: accentColor ?? '#ef4444',
  };

  return (
    <div className="metrics-panel">
      <MetricCard
        label="Active DRT Vehicles"
        value={`${metrics.activeVehicles} / ${metrics.totalVehicles}`}
        color={colors.activeVehicles}
      />
      <MetricCard
        label="Passengers Served"
        value={metrics.totalPassengersServed}
        color={colors.served}
      />
      <MetricCard
        label="Canceled Passengers"
        value={cancelledCount}
        color={colors.canceled}
      />
      <MetricCard
        label="Service Rate"
        value={serviceRate.toFixed(1)}
        unit="%"
        color={colors.serviceRate}
      />
      <MetricCard
        label="Average Wait Time"
        value={metrics.averageWaitTime}
        unit=" min"
        color={colors.averageWait}
      />
      <MetricCard
        label="Average Travel Time"
        value={metrics.averageTravelTime}
        unit=" min"
        color={colors.averageTravel}
      />
      <MetricCard
        label="Waiting Passengers"
        value={metrics.totalPassengersWaiting}
        color={colors.waiting}
      />
    </div>
  );
}
