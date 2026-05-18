import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { CHART_ANIMATION_DURATION_MS } from '../config';
import type { SimulationState, VehicleStatus } from '../types/simulation';

interface ReplayVehicleSource {
  frames: SimulationState[];
}

interface VehicleTemporalComparisonChartsProps {
  resultA: ReplayVehicleSource | null;
  resultB: ReplayVehicleSource | null;
  currentTime: number;
}

interface StatusSegment {
  startTime: number;
  endTime: number;
  status: VehicleStatus;
}

interface VehicleServicePoint {
  time: number;
  aServed?: number;
  bServed?: number;
  aCancelled?: number;
  bCancelled?: number;
}

const STATUS_META: Record<VehicleStatus, { label: string; shortLabel: string; color: string }> = {
  idle: { label: 'Idle', shortLabel: 'I', color: '#3b82f6' },
  picking_up: { label: 'Picking up', shortLabel: 'P', color: '#f59e0b' },
  carrying: { label: 'Carrying', shortLabel: 'C', color: '#10b981' },
  repositioning: { label: 'Repositioning', shortLabel: 'R', color: '#94a3b8' },
};

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

function vehicleIdsForSources(
  resultA: ReplayVehicleSource | null,
  resultB: ReplayVehicleSource | null,
): number[] {
  const ids = new Set<number>();
  for (const frame of resultA?.frames ?? []) {
    for (const vehicle of frame.vehicles) ids.add(vehicle.id);
  }
  for (const frame of resultB?.frames ?? []) {
    for (const vehicle of frame.vehicles) ids.add(vehicle.id);
  }
  return Array.from(ids).sort((a, b) => a - b);
}

function statusAt(
  source: ReplayVehicleSource | null,
  vehicleId: number,
  currentTime: number,
): VehicleStatus | null {
  const frame = source ? frameAtOrBefore(source.frames, currentTime) : null;
  return frame?.vehicles.find(vehicle => vehicle.id === vehicleId)?.status ?? null;
}

function countPassengers(
  frame: SimulationState | null,
  vehicleId: number,
  status: 'delivered' | 'cancelled',
): number | undefined {
  if (!frame) return undefined;
  return frame.passengers.filter(
    passenger =>
      passenger.assignedVehicleId === vehicleId &&
      passenger.status === status,
  ).length;
}

function buildStatusSegments(
  source: ReplayVehicleSource | null,
  vehicleId: number,
  currentTime: number,
): StatusSegment[] {
  const frames = (source?.frames ?? []).filter(frame => frame.metrics.currentTime <= currentTime);
  const segments: StatusSegment[] = [];
  let active: StatusSegment | null = null;

  for (const frame of frames) {
    const vehicle = frame.vehicles.find(v => v.id === vehicleId);
    if (!vehicle) continue;

    const t = frame.metrics.currentTime;
    if (!active || active.status !== vehicle.status) {
      if (active) active.endTime = t;
      active = { startTime: t, endTime: t, status: vehicle.status };
      segments.push(active);
    } else {
      active.endTime = t;
    }
  }

  if (active) {
    active.endTime = Math.max(active.endTime, currentTime, active.startTime + 1);
  }

  return segments;
}

function buildServiceData(
  resultA: ReplayVehicleSource | null,
  resultB: ReplayVehicleSource | null,
  vehicleId: number,
  currentTime: number,
): VehicleServicePoint[] {
  const times = new Set<number>();
  for (const frame of resultA?.frames ?? []) {
    if (frame.metrics.currentTime <= currentTime) times.add(frame.metrics.currentTime);
  }
  for (const frame of resultB?.frames ?? []) {
    if (frame.metrics.currentTime <= currentTime) times.add(frame.metrics.currentTime);
  }

  const sortedTimes = Array.from(times).sort((a, b) => a - b);
  const fallbackTimes =
    sortedTimes.length > 0
      ? sortedTimes
      : [
          resultA?.frames[0]?.metrics.currentTime,
          resultB?.frames[0]?.metrics.currentTime,
        ].filter((time): time is number => time != null);

  return fallbackTimes.map(time => {
    const frameA = resultA ? frameAtOrBefore(resultA.frames, time) : null;
    const frameB = resultB ? frameAtOrBefore(resultB.frames, time) : null;

    return {
      time,
      aServed: countPassengers(frameA, vehicleId, 'delivered'),
      bServed: countPassengers(frameB, vehicleId, 'delivered'),
      aCancelled: countPassengers(frameA, vehicleId, 'cancelled'),
      bCancelled: countPassengers(frameB, vehicleId, 'cancelled'),
    };
  });
}

function formatStatus(status: VehicleStatus | null): string {
  return status ? STATUS_META[status].label : '-';
}

function StatusTimelineRow({
  label,
  segments,
  minTime,
  maxTime,
}: {
  label: string;
  segments: StatusSegment[];
  minTime: number;
  maxTime: number;
}) {
  const duration = Math.max(1, maxTime - minTime);

  return (
    <div className="vehicle-pattern-timeline-row">
      <span className="vehicle-pattern-row-label">{label}</span>
      <div className="vehicle-pattern-track">
        {segments.length === 0 ? (
          <span className="vehicle-pattern-empty">No vehicle data</span>
        ) : (
          segments.map((segment, index) => {
            const meta = STATUS_META[segment.status];
            const start = Math.max(minTime, segment.startTime);
            const end = Math.min(Math.max(segment.endTime, segment.startTime + 1), Math.max(maxTime, start + 1));
            const left = ((start - minTime) / duration) * 100;
            const clampedLeft = Math.min(100, Math.max(0, left));
            const width = Math.max(2, ((end - start) / duration) * 100);

            return (
              <div
                key={`${label}-${segment.startTime}-${segment.status}-${index}`}
                className="vehicle-pattern-segment"
                style={{
                  left: `${clampedLeft}%`,
                  width: `${Math.min(width, 100 - clampedLeft)}%`,
                  background: meta.color,
                }}
                title={`${label} ${meta.label}: t=${segment.startTime}-${segment.endTime}`}
              >
                {meta.shortLabel}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function VehiclePatternCard({
  vehicleId,
  resultA,
  resultB,
  currentTime,
}: {
  vehicleId: number;
  resultA: ReplayVehicleSource | null;
  resultB: ReplayVehicleSource | null;
  currentTime: number;
}) {
  const minTime = Math.min(
    resultA?.frames[0]?.metrics.currentTime ?? currentTime,
    resultB?.frames[0]?.metrics.currentTime ?? currentTime,
  );
  const maxTime = Math.max(currentTime, minTime + 1);
  const frameA = resultA ? frameAtOrBefore(resultA.frames, currentTime) : null;
  const frameB = resultB ? frameAtOrBefore(resultB.frames, currentTime) : null;
  const statusA = statusAt(resultA, vehicleId, currentTime);
  const statusB = statusAt(resultB, vehicleId, currentTime);
  const serviceData = buildServiceData(resultA, resultB, vehicleId, currentTime);

  return (
    <article className="panel vehicle-pattern-card">
      <div className="vehicle-pattern-card-head">
        <h3 className="panel-title">Vehicle V{vehicleId}</h3>
        <div className="vehicle-pattern-status-pills">
          <span>A {formatStatus(statusA)}</span>
          <span>B {formatStatus(statusB)}</span>
        </div>
      </div>

      <div className="vehicle-pattern-summary">
        <div>
          <span>A Served</span>
          <strong>{countPassengers(frameA, vehicleId, 'delivered') ?? '-'}</strong>
        </div>
        <div>
          <span>B Served</span>
          <strong>{countPassengers(frameB, vehicleId, 'delivered') ?? '-'}</strong>
        </div>
        <div>
          <span>A Cancel</span>
          <strong>{countPassengers(frameA, vehicleId, 'cancelled') ?? '-'}</strong>
        </div>
        <div>
          <span>B Cancel</span>
          <strong>{countPassengers(frameB, vehicleId, 'cancelled') ?? '-'}</strong>
        </div>
      </div>

      <div className="vehicle-pattern-timelines">
        <StatusTimelineRow
          label="A"
          segments={buildStatusSegments(resultA, vehicleId, currentTime)}
          minTime={minTime}
          maxTime={maxTime}
        />
        <StatusTimelineRow
          label="B"
          segments={buildStatusSegments(resultB, vehicleId, currentTime)}
          minTime={minTime}
          maxTime={maxTime}
        />
      </div>

      <div className="vehicle-pattern-chart">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={serviceData} margin={{ top: 4, right: 10, left: -12, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey="time" stroke="#94a3b8" fontSize={10} />
            <YAxis stroke="#94a3b8" fontSize={10} allowDecimals={false} />
            <Tooltip
              contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
              labelStyle={{ color: '#e2e8f0' }}
              labelFormatter={label => `t = ${label}`}
            />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Line
              type="monotone"
              dataKey="aServed"
              name="A Served"
              stroke="#10b981"
              strokeWidth={1.8}
              dot={{ r: 1.5 }}
              activeDot={{ r: 3 }}
              isAnimationActive
              animationDuration={CHART_ANIMATION_DURATION_MS}
            />
            <Line
              type="monotone"
              dataKey="bServed"
              name="B Served"
              stroke="#10b981"
              strokeDasharray="5 4"
              strokeWidth={1.8}
              dot={{ r: 1.5 }}
              activeDot={{ r: 3 }}
              isAnimationActive
              animationDuration={CHART_ANIMATION_DURATION_MS}
            />
            <Line
              type="monotone"
              dataKey="aCancelled"
              name="A Cancel"
              stroke="#ef4444"
              strokeWidth={1.8}
              dot={{ r: 1.5 }}
              activeDot={{ r: 3 }}
              isAnimationActive
              animationDuration={CHART_ANIMATION_DURATION_MS}
            />
            <Line
              type="monotone"
              dataKey="bCancelled"
              name="B Cancel"
              stroke="#ef4444"
              strokeDasharray="5 4"
              strokeWidth={1.8}
              dot={{ r: 1.5 }}
              activeDot={{ r: 3 }}
              isAnimationActive
              animationDuration={CHART_ANIMATION_DURATION_MS}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </article>
  );
}

export default function VehicleTemporalComparisonCharts({
  resultA,
  resultB,
  currentTime,
}: VehicleTemporalComparisonChartsProps) {
  const vehicleIds = vehicleIdsForSources(resultA, resultB);

  if (vehicleIds.length === 0) {
    return (
      <section className="vehicle-pattern-section">
        <div className="panel compare-empty-panel">
          <h3 className="panel-title">Vehicle Patterns</h3>
          <div className="compare-empty-text">Load replay JSON files to inspect per-vehicle patterns.</div>
        </div>
      </section>
    );
  }

  return (
    <section className="vehicle-pattern-section">
      <div className="vehicle-pattern-legend">
        {(Object.entries(STATUS_META) as Array<[VehicleStatus, { label: string; color: string }]>).map(
          ([status, meta]) => (
            <span key={status}>
              <i style={{ background: meta.color }} />
              {meta.label}
            </span>
          ),
        )}
      </div>
      <div className="vehicle-pattern-grid">
        {vehicleIds.map(vehicleId => (
          <VehiclePatternCard
            key={vehicleId}
            vehicleId={vehicleId}
            resultA={resultA}
            resultB={resultB}
            currentTime={currentTime}
          />
        ))}
      </div>
    </section>
  );
}
