import { useRef, useState } from 'react';
import type { MouseEvent } from 'react';

import {
  RESULT_A_COLOR,
  RESULT_B_COLOR,
} from '../config';
import type { SimulationState, VehiclePatternSelection, VehicleStatus } from '../types/simulation';
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
  currentTime: number;
  selectedSegment: VehiclePatternSelection | null;
  onSelectSegment: (selection: VehiclePatternSelection) => void;
}

interface StatusSegment {
  startTime: number;
  endTime: number;
  status: VehicleStatus;
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

function statusAt(
  source: ReplayVehicleSource | null,
  vehicleId: number,
  currentTime: number,
): VehicleStatus | null {
  const frame = source ? frameAtOrBefore(source.frames, currentTime) : null;
  return frame?.vehicles.find(vehicle => vehicle.id === vehicleId)?.status ?? null;
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

function formatStatus(status: VehicleStatus | null): string {
  return status ? STATUS_META[status].label : '-';
}

function StatusTimelineRow({
  segments,
  domain,
  isPanning,
  resultSide,
  resultLabel,
  vehicleId,
  selectedSegment,
  onSelectSegment,
  onWheel,
  onMouseDown,
  onMouseMove,
  onMouseUp,
}: {
  segments: StatusSegment[];
  domain: TimelineDomain;
  isPanning: boolean;
  resultSide: 'left' | 'right';
  resultLabel: string;
  vehicleId: number;
  selectedSegment: VehiclePatternSelection | null;
  onSelectSegment: (selection: VehiclePatternSelection) => void;
  onWheel: (event: TimelineWheelEvent) => void;
  onMouseDown: (event: MouseEvent<HTMLDivElement>) => void;
  onMouseMove: (event: MouseEvent<HTMLDivElement>) => void;
  onMouseUp: () => void;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [domainStart, domainEnd] = domain;
  const duration = Math.max(1, domainEnd - domainStart);

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
                className={`vehicle-pattern-segment${clickable ? ' clickable' : ''}${selected ? ' selected' : ''}`}
                style={{
                  left: `${clampedLeft}%`,
                  width: `${Math.min(width, 100 - clampedLeft)}%`,
                  background: meta.color,
                }}
                title={clickable ? `${resultLabel} V${vehicleId} ${meta.label}: t=${segment.startTime}-${segment.endTime}` : `${resultLabel} ${meta.label}: t=${segment.startTime}-${segment.endTime}`}
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
  const maxTime = Math.max(currentTime, minTime + 1);
  const fullDomain: TimelineDomain = [minTime, maxTime];
  const [zoomDomain, setZoomDomain] = useState<TimelineDomain | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef<{ x: number; domain: TimelineDomain } | null>(null);
  const frame = source ? frameAtOrBefore(source.frames, currentTime) : null;
  const status = statusAt(source, vehicleId, currentTime);
  const segments = buildStatusSegments(source, vehicleId, currentTime);
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
        isPanning={isPanning}
        resultSide={resultSide}
        resultLabel={resultLabel}
        vehicleId={vehicleId}
        selectedSegment={selectedSegment}
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
        <span>{source ? `${vehicleIds.length} vehicles` : 'No file'}</span>
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
  currentTime,
  selectedSegment,
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
      <div className="vehicle-pattern-legend">
        {(Object.entries(STATUS_META) as Array<[VehicleStatus, { label: string; color: string }]>).filter(
          ([status]) => status !== 'repositioning',
        ).map(([status, meta]) => (
          <span key={status}>
            <i
              style={{
                background: meta.color,
                borderColor: status === 'idle' ? 'rgba(148, 163, 184, 0.34)' : meta.color,
              }}
            />
            {meta.label}
          </span>
        ))}
      </div>
      <div className="vehicle-pattern-grid">
        <ResultVehicleCard
          side="left"
          title="Result A"
          color={RESULT_A_COLOR}
          source={resultA}
          vehicleIds={vehicleIds}
          currentTime={currentTime}
          selectedSegment={selectedSegment}
          onSelectSegment={onSelectSegment}
        />
        <ResultVehicleCard
          side="right"
          title="Result B"
          color={RESULT_B_COLOR}
          source={resultB}
          vehicleIds={vehicleIds}
          currentTime={currentTime}
          selectedSegment={selectedSegment}
          onSelectSegment={onSelectSegment}
        />
      </div>
    </section>
  );
}
