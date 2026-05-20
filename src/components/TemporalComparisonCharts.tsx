import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useMemo, useRef, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';

import {
  RESULT_A_COLOR,
  RESULT_B_COLOR,
} from '../config';
import type { SimulationState } from '../types/simulation';
import { useNonPassiveWheel } from '../hooks/useNonPassiveWheel';
import type { NonPassiveWheelEvent } from '../hooks/useNonPassiveWheel';
import { clampDomain, domainFromValues, zoomDomain } from '../utils/domain';
import type { NumericDomain } from '../utils/domain';
import { formatNumber } from '../utils/time';
import { frameAtOrBefore } from '../utils/replay';

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
  // aUtilization?: number;
  // bUtilization?: number;
  // aActiveVehicles?: number;
  // bActiveVehicles?: number;
  aAverageWaitTime?: number;
  bAverageWaitTime?: number;
  aAverageTravelTime?: number;
  bAverageTravelTime?: number;
}

interface TemporalMetricConfig {
  title: string;
  aKey: keyof TemporalComparisonPoint;
  bKey: keyof TemporalComparisonPoint;
  allowDecimals?: boolean;
  domain?: [number, number];
}

type ZoomDomain = NumericDomain;
type ZoomDomains = Record<string, ZoomDomain | null | undefined>;
type ChartWheelEvent = NonPassiveWheelEvent<HTMLDivElement>;

const TEMPORAL_METRICS: TemporalMetricConfig[] = [
  {
    title: 'Served Passengers',
    aKey: 'aServed',
    bKey: 'bServed',
    allowDecimals: false,
  },
  {
    title: 'Cancelled Passengers',
    aKey: 'aCancelled',
    bKey: 'bCancelled',
    allowDecimals: false,
  },
  {
    title: 'Waiting Passengers',
    aKey: 'aWaiting',
    bKey: 'bWaiting',
    allowDecimals: false,
  },
  {
    title: 'In-Vehicle Passengers',
    aKey: 'aInTransit',
    bKey: 'bInTransit',
    allowDecimals: false,
  },
  // {
  //   title: 'Vehicle Utilization (%)',
  //   aKey: 'aUtilization',
  //   bKey: 'bUtilization',
  //   domain: [0, 100],
  // },
  // {
  //   title: 'Active Vehicles',
  //   aKey: 'aActiveVehicles',
  //   bKey: 'bActiveVehicles',
  //   allowDecimals: false,
  // },
  {
    title: 'Average Wait Time',
    aKey: 'aAverageWaitTime',
    bKey: 'bAverageWaitTime',
  },
  {
    title: 'Average Travel Time',
    aKey: 'aAverageTravelTime',
    bKey: 'bAverageTravelTime',
  },
];

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
  // point[key('Utilization')] = metrics.vehicleUtilization;
  // point[key('ActiveVehicles')] = metrics.activeVehicles;
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

function TemporalChart({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="panel temporal-chart-panel">
      <div className="temporal-chart-head">
        <h3 className="panel-title">{title}</h3>
        {actions}
      </div>
      {children}
    </div>
  );
}

function renderComparisonLine({
  dataKey,
  name,
  color,
}: {
  dataKey: keyof TemporalComparisonPoint;
  name: string;
  color: string;
}) {
  return (
    <Line
      type="monotone"
      dataKey={dataKey}
      name={name}
      yAxisId="left"
      stroke={color}
      strokeWidth={2}
      dot={false}
      activeDot={false}
      connectNulls={false}
      isAnimationActive={false}
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

function MetricTemporalChart({
  metric,
  chartData,
  currentTime,
  xDomain,
  isZoomed,
  isPanning,
  canInteract,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  onWheel,
  onMouseDown,
  onMouseMove,
  onMouseUp,
}: {
  metric: TemporalMetricConfig;
  chartData: TemporalComparisonPoint[];
  currentTime: number;
  xDomain: ZoomDomain;
  isZoomed: boolean;
  isPanning: boolean;
  canInteract: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  onWheel: (event: ChartWheelEvent) => void;
  onMouseDown: (event: MouseEvent<HTMLDivElement>) => void;
  onMouseMove: (event: MouseEvent<HTMLDivElement>) => void;
  onMouseUp: () => void;
}) {
  const chartRef = useRef<HTMLDivElement | null>(null);
  useNonPassiveWheel(chartRef, onWheel);

  const handleChartMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onMouseDown(event);
  };

  const handleChartMouseMove = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onMouseMove(event);
  };

  const handleChartMouseUp = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onMouseUp();
  };

  const handleChartDragStart = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const actions = (
    <div className="temporal-chart-actions" aria-label={`${metric.title} zoom controls`}>
      <button
        type="button"
        className="temporal-zoom-btn"
        onClick={onZoomIn}
        disabled={!canInteract}
      >
        +
      </button>
      <button
        type="button"
        className="temporal-zoom-btn"
        onClick={onZoomOut}
        disabled={!canInteract || !isZoomed}
      >
        -
      </button>
      <button
        type="button"
        className="temporal-zoom-btn"
        onClick={onResetZoom}
        disabled={!isZoomed}
      >
        Reset
      </button>
    </div>
  );

  return (
    <TemporalChart title={metric.title} actions={actions}>
      <div
        ref={chartRef}
        className={`temporal-chart-container temporal-chart-interaction${isPanning ? ' panning' : ''}`}
        onMouseDown={handleChartMouseDown}
        onMouseMove={handleChartMouseMove}
        onMouseUp={handleChartMouseUp}
        onMouseLeave={handleChartMouseUp}
        onDragStart={handleChartDragStart}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 4, right: 10, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis
              dataKey="time"
              type="number"
              domain={xDomain}
              allowDataOverflow
              stroke="#94a3b8"
              fontSize={10}
            />
            <YAxis
              yAxisId="left"
              stroke="#94a3b8"
              fontSize={10}
              allowDecimals={metric.allowDecimals ?? true}
              domain={metric.domain}
            />
            {renderCommonTooltip()}
            {renderTimeCursor(currentTime)}
            {renderComparisonLine({
              dataKey: metric.aKey,
              name: 'Result A',
              color: RESULT_A_COLOR,
            })}
            {renderComparisonLine({
              dataKey: metric.bKey,
              name: 'Result B',
              color: RESULT_B_COLOR,
            })}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </TemporalChart>
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
  const fullDomain = useMemo(() => domainFromValues(chartData.map(point => point.time)), [chartData]);
  const [zoomDomains, setZoomDomains] = useState<ZoomDomains>({});
  const [panningMetric, setPanningMetric] = useState<string | null>(null);
  const panStartRef = useRef<{ metricTitle: string; x: number; domain: ZoomDomain } | null>(null);
  const canInteract = chartData.length > 1 && fullDomain[1] > fullDomain[0];

  const domainForMetric = (metricTitle: string) => (
    clampDomain(zoomDomains[metricTitle] ?? fullDomain, fullDomain)
  );

  const zoomMetric = (metricTitle: string, factor: number, anchorRatio = 0.5) => {
    if (!canInteract) return;
    setZoomDomains(prev => ({
      ...prev,
      [metricTitle]: zoomDomain(prev[metricTitle], fullDomain, factor, anchorRatio),
    }));
  };

  const resetMetricZoom = (metricTitle: string) => {
    setZoomDomains(prev => ({ ...prev, [metricTitle]: null }));
  };

  const handleWheel = (metricTitle: string) => (event: ChartWheelEvent) => {
    if (!canInteract) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = rect.width > 0
      ? Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
      : 0.5;
    zoomMetric(metricTitle, event.deltaY > 0 ? 1.18 : 0.82, ratio);
  };

  const handleMouseDown = (metricTitle: string) => (event: MouseEvent<HTMLDivElement>) => {
    if (!canInteract || zoomDomains[metricTitle] == null || event.button !== 0) return;
    event.preventDefault();
    panStartRef.current = { metricTitle, x: event.clientX, domain: domainForMetric(metricTitle) };
    setPanningMetric(metricTitle);
  };

  const handleMouseMove = (event: MouseEvent<HTMLDivElement>) => {
    if (!canInteract || !panStartRef.current) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const panStart = panStartRef.current;
    const range = panStart.domain[1] - panStart.domain[0];
    const shift = -((event.clientX - panStart.x) / width) * range;
    setZoomDomains(prev => ({
      ...prev,
      [panStart.metricTitle]: clampDomain([
        panStart.domain[0] + shift,
        panStart.domain[1] + shift,
      ], fullDomain),
    }));
  };

  const stopPanning = () => {
    panStartRef.current = null;
    setPanningMetric(null);
  };

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
      <div className="temporal-chart-grid">
        {TEMPORAL_METRICS.map(metric => (
          <MetricTemporalChart
            key={metric.title}
            metric={metric}
            chartData={chartData}
            currentTime={currentTime}
            xDomain={domainForMetric(metric.title)}
            isZoomed={zoomDomains[metric.title] != null}
            isPanning={panningMetric === metric.title}
            canInteract={canInteract}
            onZoomIn={() => zoomMetric(metric.title, 0.7)}
            onZoomOut={() => zoomMetric(metric.title, 1.35)}
            onResetZoom={() => resetMetricZoom(metric.title)}
            onWheel={handleWheel(metric.title)}
            onMouseDown={handleMouseDown(metric.title)}
            onMouseMove={handleMouseMove}
            onMouseUp={stopPanning}
          />
        ))}
      </div>
    </section>
  );
}
