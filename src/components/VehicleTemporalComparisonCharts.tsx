import { useRef, useState } from 'react';
import type { MouseEvent } from 'react';

import {
  RESULT_A_COLOR,
  RESULT_B_COLOR,
} from '../config';
import type { Passenger, SimulationState, Vehicle, VehiclePassengerLoadDatum, VehiclePatternSelection, VehicleStatus } from '../types/simulation';
import { useNonPassiveWheel } from '../hooks/useNonPassiveWheel';
import type { NonPassiveWheelEvent } from '../hooks/useNonPassiveWheel';
import { clampDomain, zoomDomain as calculateZoomDomain } from '../utils/domain';
import type { NumericDomain } from '../utils/domain';
import { frameAtOrBefore } from '../utils/replay';

interface ReplayVehicleSource {
  frames: SimulationState[];
}

interface VehicleTemporalComparisonChartsProps {
  resultA: ReplayVehicleSource | null;
  resultB: ReplayVehicleSource | null;
  currentTimes: Record<'left' | 'right', number>;
  selectedSegments: Record<'left' | 'right', VehiclePatternSelection | null>;
  onSelectSegment: (selection: VehiclePatternSelection) => void;
}

interface StatusSegment {
  startTime: number;
  endTime: number;
  status: VehicleStatus;
  hasPassengerEvent?: boolean;
}

type TimelineDomain = NumericDomain;
type TimelineWheelEvent = NonPassiveWheelEvent<HTMLDivElement>;

const DEFAULT_VEHICLE_IDS = [1, 2, 3, 4];

const STATUS_META: Record<VehicleStatus, { label: string; color: string }> = {
  idle: { label: 'Idle', color: 'transparent' },
  picking_up: { label: 'Picking up', color: '#f59e0b' },
  carrying: { label: 'Carrying', color: '#10b981' },
  repositioning: { label: 'Repositioning', color: '#94a3b8' },
};

const TIMELINE_STATUS_LEGEND: VehicleStatus[] = ['idle', 'picking_up', 'carrying'];

function vehicleIdsForSources(
  resultA: ReplayVehicleSource | null,
  resultB: ReplayVehicleSource | null,
): number[] {
  const ids = new Set<number>(DEFAULT_VEHICLE_IDS);
  for (const frame of resultA?.frames ?? []) {
    for (const vehicle of frame.vehicles) ids.add(vehicle.id);
  }
  for (const frame of resultB?.frames ?? []) {
    for (const vehicle of frame.vehicles) ids.add(vehicle.id);
  }
  return Array.from(ids).sort((a, b) => a - b);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function passengerUnitCount(passenger: Passenger): number {
  return isFiniteNumber(passenger.numPassengers) && passenger.numPassengers > 0
    ? passenger.numPassengers
    : 1;
}

function onboardPassengersForVehicle(frame: SimulationState, vehicleId: number): Passenger[] {
  const time = frame.metrics.currentTime;
  return frame.passengers.filter(passenger => {
    if (passenger.assignedVehicleId !== vehicleId) return false;
    if (passenger.status === 'cancelled') return false;
    if (passenger.pickupTime == null || passenger.pickupTime > time) return false;
    if (passenger.deliveryTime != null && passenger.deliveryTime <= time) return false;
    return true;
  });
}

function vehicleOnboardPassengerCount(
  vehicle: Vehicle | undefined,
  onboardPassengers: Passenger[],
): number {
  if (isFiniteNumber(vehicle?.numPassengers)) {
    return Math.max(0, vehicle.numPassengers);
  }

  return onboardPassengers.reduce((count, passenger) => count + passengerUnitCount(passenger), 0);
}

function onboardPassengerLabels(passengers: Passenger[]): string[] {
  return passengers.map(passenger => {
    const count = passengerUnitCount(passenger);
    return count > 1 ? 'P' + passenger.id + ' x' + count : 'P' + passenger.id;
  });
}

function onboardPassengerSignature(passengers: Passenger[]): string {
  return passengers
    .map(passenger => passenger.id + ':' + passengerUnitCount(passenger))
    .sort()
    .join('|');
}

function buildPassengerLoadData(
  source: ReplayVehicleSource | null,
  vehicleId: number,
): VehiclePassengerLoadDatum[] {
  const frames = source?.frames ?? [];
  const data: VehiclePassengerLoadDatum[] = [];
  let prevTime = -1;

  for (const frame of frames) {
    const time = frame.metrics.currentTime;
    if (time === prevTime) continue;
    prevTime = time;
    const vehicle = frame.vehicles.find(v => v.id === vehicleId);
    if (!vehicle) continue;
    const onboardPassengers = onboardPassengersForVehicle(frame, vehicleId);
    data.push({
      time,
      onboardPassengers: vehicleOnboardPassengerCount(vehicle, onboardPassengers),
      onboardPassengerIds: onboardPassengers.map(passenger => passenger.id),
      onboardPassengerLabels: onboardPassengerLabels(onboardPassengers),
    });
  }

  return data;
}

function inferVehicleTimelineStatus(
  frame: SimulationState,
  vehicleId: number,
  fallbackStatus: VehicleStatus,
): VehicleStatus {
  if (fallbackStatus !== 'idle' && fallbackStatus !== 'repositioning') {
    return fallbackStatus;
  }

  const time = frame.metrics.currentTime;
  const assignedPassengers = frame.passengers.filter(
    passenger => passenger.assignedVehicleId === vehicleId,
  );
  const hasOnboardPassenger = assignedPassengers.some(
    passenger =>
      passenger.status !== 'cancelled' &&
      passenger.pickupTime != null &&
      passenger.pickupTime <= time &&
      (passenger.deliveryTime == null || passenger.deliveryTime > time),
  );
  if (hasOnboardPassenger) return 'carrying';

  const hasPickupTarget = assignedPassengers.some(
    passenger =>
      passenger.status === 'waiting' &&
      passenger.requestTime <= time &&
      (passenger.pickupTime == null || passenger.pickupTime > time),
  );
  if (hasPickupTarget) return 'picking_up';

  return fallbackStatus;
}

function statusAt(
  source: ReplayVehicleSource | null,
  vehicleId: number,
  currentTime: number,
): VehicleStatus | null {
  const frame = source ? frameAtOrBefore(source.frames, currentTime) : null;
  const vehicle = frame?.vehicles.find(v => v.id === vehicleId);
  return frame && vehicle ? inferVehicleTimelineStatus(frame, vehicleId, vehicle.status) : null;
}

function countServedPassengers(
  frame: SimulationState | null,
  vehicleId: number,
): number | undefined {
  if (!frame) return undefined;
  return frame.passengers.filter(
    passenger =>
      passenger.assignedVehicleId === vehicleId &&
      passenger.status === 'delivered',
  ).length;
}

function buildStatusSegments(
  source: ReplayVehicleSource | null,
  vehicleId: number,
): StatusSegment[] {
  const frames = source?.frames ?? [];
  const segments: StatusSegment[] = [];
  let active: StatusSegment | null = null;
  let activePassengerSignature = '';

  for (const frame of frames) {
    const vehicle = frame.vehicles.find(v => v.id === vehicleId);
    if (!vehicle) continue;

    const t = frame.metrics.currentTime;
    const status = inferVehicleTimelineStatus(frame, vehicleId, vehicle.status);
    const passengerSignature = onboardPassengerSignature(onboardPassengersForVehicle(frame, vehicleId));
    if (!active) {
      activePassengerSignature = passengerSignature;
      active = { startTime: t, endTime: t, status };
      segments.push(active);
    } else {
      const hasPassengerEvent = activePassengerSignature !== passengerSignature;
      if (active.status !== status || hasPassengerEvent) {
        active.endTime = t;
        active = { startTime: t, endTime: t, status, hasPassengerEvent };
        activePassengerSignature = passengerSignature;
        segments.push(active);
      } else {
        active.endTime = t;
      }
    }
  }

  if (active) {
    const maxTime = frames[frames.length - 1]?.metrics.currentTime ?? active.endTime;
    active.endTime = Math.max(active.endTime, maxTime, active.startTime + 1);
  }

  return segments;
}

function formatStatus(status: VehicleStatus | null): string {
  return status ? STATUS_META[status].label : '-';
}

function passengerLoadPolyline(
  data: VehiclePassengerLoadDatum[],
  domain: TimelineDomain,
  maxLoad: number,
): string {
  const [domainStart, domainEnd] = domain;
  const duration = Math.max(1, domainEnd - domainStart);
  const visible = data.filter(point => point.time >= domainStart && point.time <= domainEnd);
  if (visible.length === 0) return '';

  return visible.map(point => {
    const x = ((point.time - domainStart) / duration) * 100;
    const y = 30 - (Math.max(0, point.onboardPassengers) / maxLoad) * 24;
    return Math.min(100, Math.max(0, x)).toFixed(2) + ',' + Math.min(30, Math.max(6, y)).toFixed(2);
  }).join(' ');
}

function VehiclePatternPassengerLoadChart({
  data,
  domain,
  currentTime,
  onWheel,
}: {
  data: VehiclePassengerLoadDatum[];
  domain: TimelineDomain;
  currentTime: number;
  onWheel: (event: TimelineWheelEvent) => void;
}) {
  const chartRef = useRef<HTMLDivElement | null>(null);
  const [hoveredPoint, setHoveredPoint] = useState<{ point: VehiclePassengerLoadDatum; xPct: number } | null>(null);
  const [domainStart, domainEnd] = domain;
  const duration = Math.max(1, domainEnd - domainStart);
  const visibleData = data.filter(point => point.time >= domainStart && point.time <= domainEnd);
  const maxLoad = Math.max(1, ...data.map(point => point.onboardPassengers));
  const points = passengerLoadPolyline(data, domain, maxLoad);
  const currentTimePct = Math.min(100, Math.max(0, ((currentTime - domainStart) / duration) * 100));
  const showCurrentTimeTick = currentTime >= domainStart && currentTime <= domainEnd;

  useNonPassiveWheel(chartRef, onWheel);

  const handleMouseMove = (event: MouseEvent<HTMLDivElement>) => {
    if (visibleData.length === 0) {
      setHoveredPoint(null);
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = rect.width > 0
      ? Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
      : 0;
    const targetTime = domainStart + ratio * duration;
    const point = visibleData.reduce((nearest, candidate) => (
      Math.abs(candidate.time - targetTime) < Math.abs(nearest.time - targetTime) ? candidate : nearest
    ), visibleData[0]);
    const xPct = Math.min(100, Math.max(0, ((point.time - domainStart) / duration) * 100));
    setHoveredPoint({ point, xPct });
  };

  if (!points) {
    return <div className="vehicle-pattern-load-empty">No onboard data</div>;
  }

  const passengerLabels = hoveredPoint?.point.onboardPassengerLabels ?? [];
  const tooltipEdgeClass = hoveredPoint
    ? hoveredPoint.xPct < 18
      ? ' is-left-edge'
      : hoveredPoint.xPct > 82
        ? ' is-right-edge'
        : ''
    : '';

  return (
    <div
      ref={chartRef}
      className="vehicle-pattern-load-chart"
      aria-label="Onboard passenger count over time"
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setHoveredPoint(null)}
    >
      <svg viewBox="0 0 100 36" preserveAspectRatio="none" aria-hidden="true">
        <line className="vehicle-pattern-load-grid" x1="0" y1="30" x2="100" y2="30" />
        <line className="vehicle-pattern-load-grid" x1="0" y1="18" x2="100" y2="18" />
        <line className="vehicle-pattern-load-grid" x1="0" y1="6" x2="100" y2="6" />
        <polyline className="vehicle-pattern-load-line" points={points} />
        {showCurrentTimeTick ? (
          <line
            className="vehicle-pattern-load-current"
            x1={currentTimePct}
            y1="4"
            x2={currentTimePct}
            y2="32"
          />
        ) : null}
        {hoveredPoint ? (
          <line
            className="vehicle-pattern-load-hover-line"
            x1={hoveredPoint.xPct}
            y1="4"
            x2={hoveredPoint.xPct}
            y2="32"
          />
        ) : null}
      </svg>
      <span className="vehicle-pattern-load-label">Onboard</span>
      {hoveredPoint ? (
        <div
          className={"vehicle-pattern-load-tooltip" + tooltipEdgeClass}
          style={{ left: hoveredPoint.xPct + '%' }}
        >
          <div className="vehicle-pattern-load-tooltip-time">t={hoveredPoint.point.time}</div>
          <div className="vehicle-pattern-load-tooltip-total">Onboard {hoveredPoint.point.onboardPassengers}</div>
          <div className="vehicle-pattern-load-tooltip-list">
            {passengerLabels.length > 0 ? passengerLabels.join(', ') : 'No passengers'}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function StatusTimelineRow({
  segments,
  domain,
  currentTime,
  isPanning,
  resultSide,
  resultLabel,
  vehicleId,
  selectedSegment,
  passengerLoadData,
  onSelectSegment,
  onWheel,
  onMouseDown,
  onMouseMove,
  onMouseUp,
}: {
  segments: StatusSegment[];
  domain: TimelineDomain;
  currentTime: number;
  isPanning: boolean;
  resultSide: 'left' | 'right';
  resultLabel: string;
  vehicleId: number;
  selectedSegment: VehiclePatternSelection | null;
  passengerLoadData: VehiclePassengerLoadDatum[];
  onSelectSegment: (selection: VehiclePatternSelection) => void;
  onWheel: (event: TimelineWheelEvent) => void;
  onMouseDown: (event: MouseEvent<HTMLDivElement>) => void;
  onMouseMove: (event: MouseEvent<HTMLDivElement>) => void;
  onMouseUp: () => void;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [domainStart, domainEnd] = domain;
  const duration = Math.max(1, domainEnd - domainStart);
  const currentTimePct = Math.min(100, Math.max(0, ((currentTime - domainStart) / duration) * 100));
  const showCurrentTimeTick = currentTime >= domainStart && currentTime <= domainEnd;

  useNonPassiveWheel(trackRef, onWheel);

  const handleMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onMouseDown(event);
  };

  const handleMouseMove = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onMouseMove(event);
  };

  const handleMouseUp = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onMouseUp();
  };

  const handleDragStart = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <div className="vehicle-pattern-timeline-row">
      <div
        ref={trackRef}
        className={`vehicle-pattern-track${isPanning ? ' panning' : ''}`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onDragStart={handleDragStart}
      >
        {segments.length === 0 ? (
          <span className="vehicle-pattern-empty">No vehicle data</span>
        ) : (
          segments.map((segment, index) => {
            const meta = STATUS_META[segment.status];
            const segmentEnd = Math.max(segment.endTime, segment.startTime + 1);
            const start = Math.max(domainStart, segment.startTime);
            const end = Math.min(segmentEnd, domainEnd);
            if (end <= start) return null;

            const left = ((start - domainStart) / duration) * 100;
            const clampedLeft = Math.min(100, Math.max(0, left));
            const width = Math.max(2, ((end - start) / duration) * 100);
            const clickable = segment.status === 'picking_up' || segment.status === 'carrying';
            const selected =
              selectedSegment?.resultSide === resultSide &&
              selectedSegment.vehicleId === vehicleId &&
              selectedSegment.startTime === segment.startTime &&
              selectedSegment.endTime === segment.endTime &&
              selectedSegment.status === segment.status;

            return (
              <button
                key={`${resultLabel}-${segment.startTime}-${segment.status}-${index}`}
                type="button"
                className={`vehicle-pattern-segment${clickable ? ' clickable' : ''}${selected ? ' selected' : ''}${segment.hasPassengerEvent ? ' has-passenger-event' : ''}`}
                style={{
                  left: `${clampedLeft}%`,
                  width: `${Math.min(width, 100 - clampedLeft)}%`,
                  background: meta.color,
                }}
                title={clickable ? `${resultLabel} V${vehicleId} ${meta.label}: t=${segment.startTime}-${segment.endTime}${segment.hasPassengerEvent ? ' / passenger pickup-dropoff boundary' : ''}` : `${resultLabel} ${meta.label}: t=${segment.startTime}-${segment.endTime}${segment.hasPassengerEvent ? ' / passenger pickup-dropoff boundary' : ''}`}
                aria-label={clickable ? `Inspect ${resultLabel} V${vehicleId} ${meta.label} from ${segment.startTime} to ${segment.endTime}` : undefined}
                onClick={clickable ? event => {
                  event.stopPropagation();
                  onSelectSegment({
                    resultSide,
                    resultLabel,
                    vehicleId,
                    status: segment.status as VehiclePatternSelection['status'],
                    startTime: segment.startTime,
                    endTime: segment.endTime,
                  });
                } : undefined}
                disabled={!clickable}
              />
            );
          })
        )}
        {showCurrentTimeTick ? (
          <span
            className="vehicle-pattern-current-time-tick"
            style={{ left: currentTimePct + '%' }}
            aria-hidden="true"
          />
        ) : null}
      </div>
      {passengerLoadData.length > 0 ? (
        <VehiclePatternPassengerLoadChart
          data={passengerLoadData}
          domain={domain}
          currentTime={currentTime}
          onWheel={onWheel}
        />
      ) : null}
      <div className="vehicle-pattern-axis">
        <span>t={Math.round(domainStart)}</span>
        {showCurrentTimeTick ? (
          <span
            className="vehicle-pattern-axis-tick"
            style={{ left: currentTimePct + '%' }}
          >
            t={Math.round(currentTime)}
          </span>
        ) : null}
        <span>t={Math.round(domainEnd)}</span>
      </div>
    </div>
  );
}

function VehiclePatternRow({
  vehicleId,
  resultSide,
  resultLabel,
  resultColor,
  source,
  currentTime,
  selectedSegment,
  onSelectSegment,
}: {
  vehicleId: number;
  resultSide: 'left' | 'right';
  resultLabel: string;
  resultColor: string;
  source: ReplayVehicleSource | null;
  currentTime: number;
  selectedSegment: VehiclePatternSelection | null;
  onSelectSegment: (selection: VehiclePatternSelection) => void;
}) {
  const minTime = source?.frames[0]?.metrics.currentTime ?? currentTime;
  const sourceMaxTime = source?.frames[source.frames.length - 1]?.metrics.currentTime ?? currentTime;
  const maxTime = Math.max(sourceMaxTime, minTime + 1);
  const fullDomain: TimelineDomain = [minTime, maxTime];
  const [zoomDomain, setZoomDomain] = useState<TimelineDomain | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef<{ x: number; domain: TimelineDomain } | null>(null);
  const frame = source ? frameAtOrBefore(source.frames, currentTime) : null;
  const status = statusAt(source, vehicleId, currentTime);
  const segments = buildStatusSegments(source, vehicleId);
  const passengerLoadData = buildPassengerLoadData(source, vehicleId);
  const canInteract = segments.length > 0 && fullDomain[1] > fullDomain[0];
  const activeDomain = clampDomain(zoomDomain ?? fullDomain, fullDomain);

  const zoomTimeline = (factor: number, anchorRatio = 0.5) => {
    if (!canInteract) return;
    setZoomDomain(prev => calculateZoomDomain(prev, fullDomain, factor, anchorRatio));
  };

  const handleWheel = (event: TimelineWheelEvent) => {
    if (!canInteract) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = rect.width > 0
      ? Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
      : 0.5;
    zoomTimeline(event.deltaY > 0 ? 1.18 : 0.82, ratio);
  };

  const handleMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (!canInteract || zoomDomain == null || event.button !== 0) return;
    panStartRef.current = { x: event.clientX, domain: activeDomain };
    setIsPanning(true);
  };

  const handleMouseMove = (event: MouseEvent<HTMLDivElement>) => {
    if (!canInteract || !panStartRef.current) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const panStart = panStartRef.current;
    const range = panStart.domain[1] - panStart.domain[0];
    const shift = -((event.clientX - panStart.x) / width) * range;
    setZoomDomain(clampDomain([
      panStart.domain[0] + shift,
      panStart.domain[1] + shift,
    ], fullDomain));
  };

  const stopPanning = () => {
    panStartRef.current = null;
    setIsPanning(false);
  };

  return (
    <div className="vehicle-pattern-row">
      <div className="vehicle-pattern-row-head">
        <span className="vehicle-pattern-vehicle-id">V{vehicleId}</span>
        <span className="vehicle-pattern-row-status">{formatStatus(status)}</span>
        <div className="vehicle-pattern-timeline-actions" aria-label={`${resultLabel} V${vehicleId} timeline zoom controls`}>
          <button
            type="button"
            className="vehicle-timeline-zoom-btn"
            onClick={() => zoomTimeline(0.7)}
            disabled={!canInteract}
          >
            +
          </button>
          <button
            type="button"
            className="vehicle-timeline-zoom-btn"
            onClick={() => zoomTimeline(1.35)}
            disabled={!canInteract || zoomDomain == null}
          >
            -
          </button>
          <button
            type="button"
            className="vehicle-timeline-zoom-btn"
            onClick={() => setZoomDomain(null)}
            disabled={zoomDomain == null}
          >
            Reset
          </button>
        </div>
        <span className="vehicle-pattern-row-served" style={{ color: resultColor }}>
          Served {countServedPassengers(frame, vehicleId) ?? '-'}
        </span>
      </div>
      <StatusTimelineRow
        segments={segments}
        domain={activeDomain}
        currentTime={currentTime}
        isPanning={isPanning}
        resultSide={resultSide}
        resultLabel={resultLabel}
        vehicleId={vehicleId}
        selectedSegment={selectedSegment}
        passengerLoadData={passengerLoadData}
        onSelectSegment={onSelectSegment}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={stopPanning}
      />
    </div>
  );
}

function ResultVehicleCard({
  side,
  title,
  color,
  source,
  vehicleIds,
  currentTime,
  selectedSegment,
  onSelectSegment,
}: {
  side: 'left' | 'right';
  title: string;
  color: string;
  source: ReplayVehicleSource | null;
  vehicleIds: number[];
  currentTime: number;
  selectedSegment: VehiclePatternSelection | null;
  onSelectSegment: (selection: VehiclePatternSelection) => void;
}) {
  return (
    <article className="panel vehicle-pattern-result-card">
      <div className="vehicle-pattern-result-head">
        <h3 style={{ color }}>{title}</h3>
        <div className="vehicle-pattern-result-summary">
          <div className="vehicle-pattern-head-legend" aria-label={`${title} timeline status legend`}>
            <div className="vehicle-pattern-legend vehicle-pattern-legend-inline">
              {TIMELINE_STATUS_LEGEND.map(status => (
                <span key={status}>
                  <i
                    style={{
                      background: STATUS_META[status].color,
                      borderColor: status === 'idle' ? 'rgba(148, 163, 184, 0.42)' : STATUS_META[status].color,
                    }}
                  />
                  {STATUS_META[status].label}
                </span>
              ))}
            </div>
          </div>
          <span className="vehicle-pattern-result-count">{source ? `${vehicleIds.length} vehicles` : 'No file'}</span>
        </div>
      </div>
      <div className="vehicle-pattern-row-list">
        {vehicleIds.map(vehicleId => (
          <VehiclePatternRow
            key={`${title}-${vehicleId}`}
            vehicleId={vehicleId}
            resultSide={side}
            resultLabel={title}
            resultColor={color}
            source={source}
            currentTime={currentTime}
            selectedSegment={selectedSegment}
            onSelectSegment={onSelectSegment}
          />
        ))}
      </div>
    </article>
  );
}

export default function VehicleTemporalComparisonCharts({
  resultA,
  resultB,
  currentTimes,
  selectedSegments,
  onSelectSegment,
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
      <div className="vehicle-pattern-grid">
        <ResultVehicleCard
          side="left"
          title="Result A"
          color={RESULT_A_COLOR}
          source={resultA}
          vehicleIds={vehicleIds}
          currentTime={currentTimes.left}
          selectedSegment={selectedSegments.left}
          onSelectSegment={onSelectSegment}
        />
        <ResultVehicleCard
          side="right"
          title="Result B"
          color={RESULT_B_COLOR}
          source={resultB}
          vehicleIds={vehicleIds}
          currentTime={currentTimes.right}
          selectedSegment={selectedSegments.right}
          onSelectSegment={onSelectSegment}
        />
      </div>
    </section>
  );
}
