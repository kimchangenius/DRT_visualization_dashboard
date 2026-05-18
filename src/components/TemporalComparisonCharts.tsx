import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ReactNode } from 'react';

import { CHART_ANIMATION_DURATION_MS } from '../config';
import type { SimulationState } from '../types/simulation';

interface ReplayTemporalSource {
  frames: SimulationState[];
}

interface TemporalComparisonChartsProps {
  resultA: ReplayTemporalSource | null;
  resultB: ReplayTemporalSource | null;
  currentTime: number;
}

interface TemporalComparisonPoint {
  time: number;
  aServed?: number;
  bServed?: number;
  aWaiting?: number;
  bWaiting?: number;
  aCancelled?: number;
  bCancelled?: number;
  aInTransit?: number;
  bInTransit?: number;
  aUtilization?: number;
  bUtilization?: number;
  aActiveVehicles?: number;
  bActiveVehicles?: number;
  aAverageWaitTime?: number;
  bAverageWaitTime?: number;
  aAverageTravelTime?: number;
  bAverageTravelTime?: number;
}

const RESULT_A_DASH = undefined;
const RESULT_B_DASH = '5 4';

function frameAtOrBefore(frames: SimulationState[], time: number): SimulationState | null {
  if (frames.length === 0 || time < frames[0].metrics.currentTime) return null;

  let selected = frames[0];
  for (const frame of frames) {
    if (frame.metrics.currentTime <= time) {
      selected = frame;
    } else {
      break;
    }
  }
  return selected;
}

function appendMetrics(
  point: TemporalComparisonPoint,
  prefix: 'a' | 'b',
  frame: SimulationState | null,
) {
  if (!frame) return;
  const key = <K extends string>(metric: K) => `${prefix}${metric}` as keyof TemporalComparisonPoint;
  const { metrics } = frame;

  point[key('Served')] = metrics.totalPassengersServed;
  point[key('Waiting')] = metrics.totalPassengersWaiting;
  point[key('Cancelled')] = metrics.cancelCount;
  point[key('InTransit')] = metrics.totalPassengersInTransit;
  point[key('Utilization')] = metrics.vehicleUtilization;
  point[key('ActiveVehicles')] = metrics.activeVehicles;
  point[key('AverageWaitTime')] = metrics.averageWaitTime;
  point[key('AverageTravelTime')] = metrics.averageTravelTime;
}

function buildTemporalComparisonData(
  resultA: ReplayTemporalSource | null,
  resultB: ReplayTemporalSource | null,
): TemporalComparisonPoint[] {
  const times = new Set<number>();
  for (const frame of resultA?.frames ?? []) times.add(frame.metrics.currentTime);
  for (const frame of resultB?.frames ?? []) times.add(frame.metrics.currentTime);

  return Array.from(times)
    .sort((a, b) => a - b)
    .map(time => {
      const point: TemporalComparisonPoint = { time };
      appendMetrics(point, 'a', resultA ? frameAtOrBefore(resultA.frames, time) : null);
      appendMetrics(point, 'b', resultB ? frameAtOrBefore(resultB.frames, time) : null);
      return point;
    });
}

function formatNumber(value: number | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return '-';
  return Number.isInteger(value) ? String(value) : value.toFixed(digits);
}

function deltaValue(a: number | undefined, b: number | undefined): number | undefined {
  if (a == null || b == null) return undefined;
  return Math.round((b - a) * 10) / 10;
}

function DeltaItem({
  label,
  value,
  unit = '',
  lowerIsBetter = false,
}: {
  label: string;
  value: number | undefined;
  unit?: string;
  lowerIsBetter?: boolean;
}) {
  const direction = value == null || value === 0 ? 'neutral' : value > 0 ? 'up' : 'down';
  const favorable =
    value == null || value === 0
      ? false
      : lowerIsBetter
        ? value < 0
        : value > 0;

  return (
    <div className={`temporal-delta-item ${direction}${favorable ? ' favorable' : ''}`}>
      <span className="temporal-delta-label">{label}</span>
      <span className="temporal-delta-value">
        {value == null ? '-' : `${value > 0 ? '+' : ''}${formatNumber(value)}${unit}`}
      </span>
    </div>
  );
}

function TemporalChart({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="panel temporal-chart-panel">
      <h3 className="panel-title">{title}</h3>
      <div className="temporal-chart-container">{children}</div>
    </div>
  );
}

function renderComparisonLine({
  dataKey,
  name,
  color,
  dash,
  yAxisId = 'left',
}: {
  dataKey: keyof TemporalComparisonPoint;
  name: string;
  color: string;
  dash?: string;
  yAxisId?: string;
}) {
  return (
    <Line
      type="monotone"
      dataKey={dataKey}
      name={name}
      yAxisId={yAxisId}
      stroke={color}
      strokeWidth={1.8}
      strokeDasharray={dash}
      dot={false}
      activeDot={{ r: 3 }}
      connectNulls={false}
      isAnimationActive
      animationDuration={CHART_ANIMATION_DURATION_MS}
      animationEasing="ease-out"
    />
  );
}

function renderCommonTooltip() {
  return (
    <Tooltip
      contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
      labelStyle={{ color: '#e2e8f0' }}
      formatter={(value: number | string, name: string) => [
        typeof value === 'number' ? formatNumber(value) : value,
        name,
      ]}
      labelFormatter={label => `t = ${label}`}
    />
  );
}

function renderTimeCursor(currentTime: number) {
  return (
    <ReferenceLine
      x={currentTime}
      yAxisId="left"
      stroke="#a78bfa"
      strokeDasharray="4 2"
      strokeWidth={1.5}
    />
  );
}

export default function TemporalComparisonCharts({
  resultA,
  resultB,
  currentTime,
}: TemporalComparisonChartsProps) {
  const data = buildTemporalComparisonData(resultA, resultB);
  const visibleData = data.filter(point => point.time <= currentTime);
  const chartData = visibleData.length > 0 && data.length > 1
    ? visibleData
    : data.slice(0, Math.min(1, data.length));
  const hasData = data.length > 0;
  const currentA = resultA ? frameAtOrBefore(resultA.frames, currentTime)?.metrics : undefined;
  const currentB = resultB ? frameAtOrBefore(resultB.frames, currentTime)?.metrics : undefined;

  if (!hasData) {
    return (
      <section className="temporal-comparison-section">
        <div className="panel compare-empty-panel">
          <h3 className="panel-title">Temporal Patterns</h3>
          <div className="compare-empty-text">Load replay JSON files to inspect time-based patterns.</div>
        </div>
      </section>
    );
  }

  return (
    <section className="temporal-comparison-section">
      <div className="temporal-delta-strip">
        <DeltaItem
          label="Served B-A"
          value={deltaValue(currentA?.totalPassengersServed, currentB?.totalPassengersServed)}
        />
        <DeltaItem
          label="Cancel B-A"
          value={deltaValue(currentA?.cancelCount, currentB?.cancelCount)}
          lowerIsBetter
        />
        <DeltaItem
          label="Avg Wait B-A"
          value={deltaValue(currentA?.averageWaitTime, currentB?.averageWaitTime)}
          unit="m"
          lowerIsBetter
        />
        <DeltaItem
          label="Util B-A"
          value={deltaValue(currentA?.vehicleUtilization, currentB?.vehicleUtilization)}
          unit="%"
        />
      </div>

      <div className="temporal-chart-grid">
        <TemporalChart title="Passenger Outcomes">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 4, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="time" stroke="#94a3b8" fontSize={10} />
              <YAxis yAxisId="left" stroke="#94a3b8" fontSize={10} allowDecimals={false} />
              {renderCommonTooltip()}
              <Legend wrapperStyle={{ fontSize: 10 }} />
              {renderTimeCursor(currentTime)}
              {renderComparisonLine({ dataKey: 'aServed', name: 'A Served', color: '#10b981', dash: RESULT_A_DASH })}
              {renderComparisonLine({ dataKey: 'bServed', name: 'B Served', color: '#10b981', dash: RESULT_B_DASH })}
              {renderComparisonLine({ dataKey: 'aCancelled', name: 'A Cancelled', color: '#ef4444', dash: RESULT_A_DASH })}
              {renderComparisonLine({ dataKey: 'bCancelled', name: 'B Cancelled', color: '#ef4444', dash: RESULT_B_DASH })}
            </LineChart>
          </ResponsiveContainer>
        </TemporalChart>

        <TemporalChart title="Demand Pressure">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 4, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="time" stroke="#94a3b8" fontSize={10} />
              <YAxis yAxisId="left" stroke="#94a3b8" fontSize={10} allowDecimals={false} />
              {renderCommonTooltip()}
              <Legend wrapperStyle={{ fontSize: 10 }} />
              {renderTimeCursor(currentTime)}
              {renderComparisonLine({ dataKey: 'aWaiting', name: 'A Waiting', color: '#f59e0b', dash: RESULT_A_DASH })}
              {renderComparisonLine({ dataKey: 'bWaiting', name: 'B Waiting', color: '#f59e0b', dash: RESULT_B_DASH })}
              {renderComparisonLine({ dataKey: 'aInTransit', name: 'A In vehicle', color: '#3b82f6', dash: RESULT_A_DASH })}
              {renderComparisonLine({ dataKey: 'bInTransit', name: 'B In vehicle', color: '#3b82f6', dash: RESULT_B_DASH })}
            </LineChart>
          </ResponsiveContainer>
        </TemporalChart>

        <TemporalChart title="Vehicle Operations">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="time" stroke="#94a3b8" fontSize={10} />
              <YAxis yAxisId="left" stroke="#94a3b8" fontSize={10} domain={[0, 100]} />
              <YAxis yAxisId="right" orientation="right" stroke="#94a3b8" fontSize={10} allowDecimals={false} />
              {renderCommonTooltip()}
              <Legend wrapperStyle={{ fontSize: 10 }} />
              {renderTimeCursor(currentTime)}
              {renderComparisonLine({ dataKey: 'aUtilization', name: 'A Util %', color: '#8b5cf6', dash: RESULT_A_DASH })}
              {renderComparisonLine({ dataKey: 'bUtilization', name: 'B Util %', color: '#8b5cf6', dash: RESULT_B_DASH })}
              {renderComparisonLine({
                dataKey: 'aActiveVehicles',
                name: 'A Active',
                color: '#38bdf8',
                dash: RESULT_A_DASH,
                yAxisId: 'right',
              })}
              {renderComparisonLine({
                dataKey: 'bActiveVehicles',
                name: 'B Active',
                color: '#38bdf8',
                dash: RESULT_B_DASH,
                yAxisId: 'right',
              })}
            </LineChart>
          </ResponsiveContainer>
        </TemporalChart>

        <TemporalChart title="Service Quality">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 4, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="time" stroke="#94a3b8" fontSize={10} />
              <YAxis yAxisId="left" stroke="#94a3b8" fontSize={10} />
              {renderCommonTooltip()}
              <Legend wrapperStyle={{ fontSize: 10 }} />
              {renderTimeCursor(currentTime)}
              {renderComparisonLine({ dataKey: 'aAverageWaitTime', name: 'A Avg wait', color: '#f59e0b', dash: RESULT_A_DASH })}
              {renderComparisonLine({ dataKey: 'bAverageWaitTime', name: 'B Avg wait', color: '#f59e0b', dash: RESULT_B_DASH })}
              {renderComparisonLine({ dataKey: 'aAverageTravelTime', name: 'A Avg travel', color: '#ec4899', dash: RESULT_A_DASH })}
              {renderComparisonLine({ dataKey: 'bAverageTravelTime', name: 'B Avg travel', color: '#ec4899', dash: RESULT_B_DASH })}
            </LineChart>
          </ResponsiveContainer>
        </TemporalChart>
      </div>
    </section>
  );
}
