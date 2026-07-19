import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent } from 'react';

import {
  RESULT_A_COLOR,
  RESULT_B_COLOR,
} from '../config';
import type {
  ReplayDispatchDecision,
  ReplayPassengerEvent,
  SimulationState,
  VehiclePassengerLoadDatum,
  VehiclePatternSelection,
  VehicleStatus,
} from '../types/simulation';
import { useNonPassiveWheel } from '../hooks/useNonPassiveWheel';
import type { NonPassiveWheelEvent } from '../hooks/useNonPassiveWheel';
import { clampDomain, zoomDomain as calculateZoomDomain } from '../utils/domain';
import type { NumericDomain } from '../utils/domain';
import { frameAtOrBefore } from '../utils/replay';
import {
  buildVehiclePassengerLoadData,
  buildVehicleTimelineData,
  inferVehicleTimelineStatus,
  passengerUnitCount,
  type ReplayVehicleTemporalIndex,
} from '../utils/vehicleTemporal';

export interface ReplayVehicleSource {
  frames: SimulationState[];
  passengerEvents?: ReplayPassengerEvent[];
  temporalIndex?: ReplayVehicleTemporalIndex;
}

interface VehicleTemporalComparisonChartsProps {
  resultA: ReplayVehicleSource | null;
  resultB: ReplayVehicleSource | null;
  currentTimes: Record<'left' | 'right', number>;
  selectedSegments: Record<'left' | 'right', VehiclePatternSelection | null>;
  contextIntervals?: Record<'left' | 'right', NumericDomain | null>;
  onSelectSegment: (selection: VehiclePatternSelection) => void;
}

interface StatusSegment {
  startTime: number;
  endTime: number;
  status: VehicleStatus;
  hasPassengerEvent?: boolean;
}

interface PassengerEventDatum {
  time: number;
  pickupPassengers: number;
  dropoffPassengers: number;
  events: PassengerSequenceEvent[];
}

interface PassengerSequenceEvent {
  key: string;
  type: 'pickup' | 'dropoff';
  passengerId: number;
  passengerCount: number;
}

type TimelineDomain = NumericDomain;
type TimelineWheelEvent = NonPassiveWheelEvent<HTMLDivElement>;
type TimelineInteractionMode = 'pan' | 'select';

const DEFAULT_VEHICLE_IDS = [1, 2, 3, 4];
const CONTEXT_INTERVAL_ZOOM_FACTOR = 1.4;

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
  for (const source of [resultA, resultB]) {
    if (source?.temporalIndex) {
      for (const vehicleId of source.temporalIndex.vehicleIds) ids.add(vehicleId);
      continue;
    }
    for (const frame of source?.frames ?? []) {
      for (const vehicle of frame.vehicles) ids.add(vehicle.id);
    }
  }
  return Array.from(ids).sort((a, b) => a - b);
}

function buildPassengerEventData(
  source: ReplayVehicleSource | null,
  vehicleId: number,
): PassengerEventDatum[] {
  const vehicleEvents = source?.temporalIndex?.byVehicleId[vehicleId]?.passengerEvents ??
    (source?.passengerEvents ?? []).filter(
      event => event.vehicleId === vehicleId,
    );
  const eventsByTime = new Map<number, PassengerEventDatum>();
  const eventAt = (time: number) => {
    const existing = eventsByTime.get(time);
    if (existing) return existing;
    const event: PassengerEventDatum = {
      time,
      pickupPassengers: 0,
      dropoffPassengers: 0,
      events: [],
    };
    eventsByTime.set(time, event);
    return event;
  };

  for (const encodedEvent of vehicleEvents) {
    const event = eventAt(encodedEvent.time);
    if (encodedEvent.type === 'pickup') {
      event.pickupPassengers += encodedEvent.passengerCount;
    } else {
      event.dropoffPassengers += encodedEvent.passengerCount;
    }
    event.events.push({
      key: `${encodedEvent.type}-${encodedEvent.passengerId}-${encodedEvent.time}`,
      type: encodedEvent.type,
      passengerId: encodedEvent.passengerId,
      passengerCount: encodedEvent.passengerCount,
    });
  }

  return [...eventsByTime.values()].sort((a, b) => a.time - b.time);
}

function passengerEventGroupCount(
  source: ReplayVehicleSource | null,
  vehicleId: number,
): number {
  const indexedCount = source?.temporalIndex?.byVehicleId[vehicleId]?.eventGroupCount;
  if (indexedCount != null) return indexedCount;

  return new Set(
    (source?.passengerEvents ?? [])
      .filter(event => event.vehicleId === vehicleId)
      .map(event => event.time),
  ).size;
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
  return frame.passengers.reduce(
    (total, passenger) =>
      passenger.assignedVehicleId === vehicleId &&
      passenger.status === 'delivered'
        ? total + passengerUnitCount(passenger)
        : total,
    0,
  );
}

function formatStatus(status: VehicleStatus | null): string {
  return status ? STATUS_META[status].label : '-';
}

function dispatchDecisionLabel(decision: ReplayDispatchDecision): string {
  const actionLabel = decision.actionType === 'pickup'
    ? 'Pickup'
    : decision.actionType === 'dropoff'
      ? 'Drop-off'
      : 'Wait';
  return decision.requestId == null
    ? `${actionLabel} at t=${decision.time}`
    : `${actionLabel} R${decision.requestId} at t=${decision.time}`;
}

function segmentMatchesDispatchDecision(
  segment: StatusSegment,
  decision: ReplayDispatchDecision,
): boolean {
  if (decision.actionType === 'wait') return false;
  const expectedStatus = decision.actionType === 'pickup' ? 'picking_up' : 'carrying';
  if (segment.status !== expectedStatus) return false;
  return (
    (segment.startTime <= decision.time && segment.endTime >= decision.time) ||
    (
      segment.startTime > decision.time &&
      segment.startTime <= decision.time + 1
    )
  );
}

function passengerLoadStepPath(
  data: VehiclePassengerLoadDatum[],
  domain: TimelineDomain,
  maxLoad: number,
): string {
  const [domainStart, domainEnd] = domain;
  const duration = Math.max(1, domainEnd - domainStart);
  const visible = data.filter(point => point.time >= domainStart && point.time <= domainEnd);
  if (visible.length === 0) return '';

  const coordinates = visible.map(point => {
    const x = ((point.time - domainStart) / duration) * 100;
    const y = 28 - (Math.max(0, point.onboardPassengers) / maxLoad) * 22;
    return {
      x: Math.min(100, Math.max(0, x)),
      y: Math.min(28, Math.max(6, y)),
    };
  });

  return coordinates.reduce((path, point, index) => {
    if (index === 0) return `M ${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
    const previous = coordinates[index - 1];
    return path +
      ` L ${point.x.toFixed(2)} ${previous.y.toFixed(2)}` +
      ` L ${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
  }, '');
}

function VehiclePatternPassengerLoadChart({
  data,
  passengerEvents,
  domain,
  currentTime,
  selectedInterval,
  interactionMode,
  onWheel,
  onInteractionMouseDown,
  onInteractionMouseMove,
  onInteractionMouseUp,
}: {
  data: VehiclePassengerLoadDatum[];
  passengerEvents: PassengerEventDatum[];
  domain: TimelineDomain;
  currentTime: number;
  selectedInterval: [number, number] | null;
  interactionMode: TimelineInteractionMode;
  onWheel: (event: TimelineWheelEvent) => void;
  onInteractionMouseDown: (event: MouseEvent<HTMLDivElement>) => void;
  onInteractionMouseMove: (event: MouseEvent<HTMLDivElement>) => void;
  onInteractionMouseUp: (event: MouseEvent<HTMLDivElement>) => void;
}) {
  const chartRef = useRef<HTMLDivElement | null>(null);
  const [hoveredPoint, setHoveredPoint] = useState<{ point: VehiclePassengerLoadDatum; xPct: number } | null>(null);
  const [domainStart, domainEnd] = domain;
  const duration = Math.max(1, domainEnd - domainStart);
  const visibleData = data.filter(point => point.time >= domainStart && point.time <= domainEnd);
  const visiblePassengerEvents = passengerEvents.filter(
    event => event.time >= domainStart && event.time <= domainEnd,
  );
  const maxLoad = Math.max(1, ...data.map(point => point.onboardPassengers));
  const stepPath = passengerLoadStepPath(data, domain, maxLoad);
  const maxPassengerEvent = Math.max(
    1,
    ...passengerEvents.map(event => Math.max(event.pickupPassengers, event.dropoffPassengers)),
  );
  const currentTimePct = Math.min(100, Math.max(0, ((currentTime - domainStart) / duration) * 100));
  const showCurrentTimeTick = currentTime >= domainStart && currentTime <= domainEnd;
  const selectedRangeStart = selectedInterval == null
    ? null
    : Math.max(domainStart, selectedInterval[0]);
  const selectedRangeEnd = selectedInterval == null
    ? null
    : Math.min(domainEnd, selectedInterval[1]);

  useNonPassiveWheel(chartRef, onWheel);

  const handleMouseMove = (event: MouseEvent<HTMLDivElement>) => {
    onInteractionMouseMove(event);
    if (interactionMode === 'select' && event.buttons === 1) {
      setHoveredPoint(null);
      return;
    }
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

  if (!stepPath) {
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
      className={`vehicle-pattern-load-chart is-${interactionMode}`}
      aria-label="Onboard passenger count over time"
      onMouseDown={onInteractionMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={onInteractionMouseUp}
      onMouseLeave={event => {
        setHoveredPoint(null);
        onInteractionMouseUp(event);
      }}
    >
      <svg viewBox="0 0 100 60" preserveAspectRatio="none" aria-hidden="true">
        {selectedRangeStart != null && selectedRangeEnd != null && selectedRangeEnd > selectedRangeStart ? (
          <rect
            className="vehicle-pattern-selected-interval"
            x={((selectedRangeStart - domainStart) / duration) * 100}
            y="4"
            width={((selectedRangeEnd - selectedRangeStart) / duration) * 100}
            height="53"
          />
        ) : null}
        {[6, 10.4, 14.8, 19.2, 23.6, 28].map(y => (
          <line
            key={'onboard-grid-' + y}
            className="vehicle-pattern-load-grid"
            x1="0"
            y1={y}
            x2="100"
            y2={y}
          />
        ))}
        <path className="vehicle-pattern-load-line" d={stepPath} />
        <line className="vehicle-pattern-passenger-event-center" x1="0" y1="44" x2="100" y2="44" />
        {visiblePassengerEvents.map(event => {
          const x = Math.min(100, Math.max(0, ((event.time - domainStart) / duration) * 100));
          const pickupHeight = (event.pickupPassengers / maxPassengerEvent) * 11;
          const dropoffHeight = (event.dropoffPassengers / maxPassengerEvent) * 11;
          return (
            <g key={'passenger-events-' + event.time}>
              {pickupHeight > 0 ? (
                <rect
                  className="vehicle-pattern-passenger-event-pickup"
                  x={Math.max(0, x - 0.8)}
                  y={44 - pickupHeight}
                  width="1.6"
                  height={pickupHeight}
                />
              ) : null}
              {dropoffHeight > 0 ? (
                <rect
                  className="vehicle-pattern-passenger-event-dropoff"
                  x={Math.max(0, x - 0.8)}
                  y="44"
                  width="1.6"
                  height={dropoffHeight}
                />
              ) : null}
            </g>
          );
        })}
        {showCurrentTimeTick ? (
          <line
            className="vehicle-pattern-load-current"
            x1={currentTimePct}
            y1="4"
            x2={currentTimePct}
            y2="57"
          />
        ) : null}
        {hoveredPoint ? (
          <line
            className="vehicle-pattern-load-hover-line"
            x1={hoveredPoint.xPct}
            y1="4"
            x2={hoveredPoint.xPct}
            y2="57"
          />
        ) : null}
      </svg>
      <span className="vehicle-pattern-load-label">Onboard</span>
      <span className="vehicle-pattern-event-label is-pickup">Pickup</span>
      <span className="vehicle-pattern-event-label is-dropoff">Drop-off</span>
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

function EventSequenceBar({
  passengerEvents,
  hasEncodedEvents,
  maxEventGroupCount,
  eventBoxWidth,
  scrollLeft,
  onScrollLeftChange,
  onTrackTopChange,
  selectedInterval,
  isDraftSelection,
  selectedEventTime,
  dispatchDecisionFocus,
  onSelectEventTime,
}: {
  passengerEvents: PassengerEventDatum[];
  hasEncodedEvents: boolean;
  maxEventGroupCount: number;
  eventBoxWidth: number;
  scrollLeft: number;
  onScrollLeftChange: (scrollLeft: number) => void;
  onTrackTopChange: (top: number) => void;
  selectedInterval: [number, number] | null;
  isDraftSelection: boolean;
  selectedEventTime: number | null;
  dispatchDecisionFocus: ReplayDispatchDecision | null;
  onSelectEventTime: (time: number | null) => void;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const visibleEvents = passengerEvents;
  const maxStack = Math.max(1, ...visibleEvents.map(event => event.events.length));
  const selectedEventIndices = selectedInterval == null
    ? []
    : visibleEvents.flatMap((event, index) => (
      event.time >= selectedInterval[0] && event.time <= selectedInterval[1] ? [index] : []
    ));
  const selectedGridStart = selectedEventIndices.length > 0 ? selectedEventIndices[0] + 1 : null;
  const selectedGridEnd = selectedEventIndices.length > 0
    ? selectedEventIndices[selectedEventIndices.length - 1] + 2
    : null;
  const visibleEventTimeSignature = visibleEvents.map(event => event.time).join('|');
  const focusedEventIndex = dispatchDecisionFocus?.requestId == null ||
    dispatchDecisionFocus.actionType === 'wait'
    ? -1
    : visibleEvents.findIndex(eventGroup => eventGroup.events.some(event =>
      event.passengerId === dispatchDecisionFocus.requestId &&
      event.type === dispatchDecisionFocus.actionType
    ));
  const eventGridStyle = {
    gridTemplateColumns: `repeat(${Math.max(1, maxEventGroupCount)}, ${eventBoxWidth}px)`,
    width: `${Math.max(1, maxEventGroupCount) * eventBoxWidth}px`,
  };

  useEffect(() => {
    const track = trackRef.current;
    if (track && Math.abs(track.scrollLeft - scrollLeft) > 0.5) {
      track.scrollLeft = scrollLeft;
    }
  }, [scrollLeft]);

  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track || selectedInterval == null || visibleEvents.length === 0) return;

    const alignToSelectedInterval = () => {
      const intervalMidpoint = (selectedInterval[0] + selectedInterval[1]) / 2;
      const nearestIndex = visibleEvents.reduce((nearest, event, index) => (
        Math.abs(event.time - intervalMidpoint) <
        Math.abs(visibleEvents[nearest].time - intervalMidpoint)
          ? index
          : nearest
      ), 0);
      const firstIndex = selectedEventIndices[0] ?? nearestIndex;
      const lastIndex = selectedEventIndices[selectedEventIndices.length - 1] ?? nearestIndex;
      const rangeLeft = firstIndex * eventBoxWidth;
      const rangeRight = (lastIndex + 1) * eventBoxWidth;
      const rangeWidth = rangeRight - rangeLeft;
      const maxScrollLeft = Math.max(0, track.scrollWidth - track.clientWidth);
      const targetScrollLeft = rangeWidth >= track.clientWidth
        ? rangeLeft
        : (rangeLeft + rangeRight - track.clientWidth) / 2;
      const nextScrollLeft = Math.max(0, Math.min(maxScrollLeft, targetScrollLeft));

      track.scrollLeft = nextScrollLeft;
      onScrollLeftChange(nextScrollLeft);
    };

    alignToSelectedInterval();
    const animationFrame = window.requestAnimationFrame(alignToSelectedInterval);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [
    dispatchDecisionFocus?.decisionRound,
    dispatchDecisionFocus?.time,
    dispatchDecisionFocus?.vehicleId,
    eventBoxWidth,
    isDraftSelection,
    onScrollLeftChange,
    selectedInterval?.[0],
    selectedInterval?.[1],
    visibleEventTimeSignature,
  ]);

  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track || focusedEventIndex < 0) return;
    const eventCenter = (focusedEventIndex + 0.5) * eventBoxWidth;
    const maxScrollLeft = Math.max(0, track.scrollWidth - track.clientWidth);
    const nextScrollLeft = Math.max(
      0,
      Math.min(maxScrollLeft, eventCenter - track.clientWidth / 2),
    );
    track.scrollLeft = nextScrollLeft;
    onScrollLeftChange(nextScrollLeft);
  }, [
    dispatchDecisionFocus?.actionType,
    dispatchDecisionFocus?.decisionRound,
    dispatchDecisionFocus?.requestId,
    dispatchDecisionFocus?.time,
    eventBoxWidth,
    focusedEventIndex,
    onScrollLeftChange,
  ]);

  useLayoutEffect(() => {
    const updateTrackTop = () => {
      if (trackRef.current) onTrackTopChange(trackRef.current.offsetTop);
    };
    updateTrackTop();
    window.addEventListener('resize', updateTrackTop);
    return () => window.removeEventListener('resize', updateTrackTop);
  }, [maxStack, onTrackTopChange, visibleEvents.length]);

  useNonPassiveWheel(trackRef, event => {
    const track = trackRef.current;
    if (!track || track.scrollWidth <= track.clientWidth) return;
    event.preventDefault();
    event.stopPropagation();
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    onScrollLeftChange(Math.max(0, Math.min(track.scrollWidth - track.clientWidth, track.scrollLeft + delta)));
  });

  return (
    <div className="vehicle-event-sequence" aria-label={`${visibleEvents.length} request event times`}>
      <div className="vehicle-event-sequence-head">
        <span>Event Sequence</span>
        <span className="vehicle-event-sequence-legend">
          <i className="is-pickup" /> Pickup
          <i className="is-dropoff" /> Drop-off
        </span>
      </div>
      {visibleEvents.length === 0 ? (
        <div className="vehicle-event-sequence-empty">
          {hasEncodedEvents ? 'No request events' : 'Replay has no encoded passenger events'}
        </div>
      ) : (
        <div
          ref={trackRef}
          className="vehicle-event-sequence-track"
          style={{ height: `${Math.min(maxStack, 4) * 20 + 6}px` }}
          onScroll={event => onScrollLeftChange(event.currentTarget.scrollLeft)}
        >
          <div className="vehicle-event-sequence-grid" style={eventGridStyle}>
            {selectedGridStart != null && selectedGridEnd != null ? (
              <span
                className="vehicle-event-sequence-selected-range"
                style={{ gridColumn: `${selectedGridStart} / ${selectedGridEnd}` }}
                aria-hidden="true"
              />
            ) : null}
            {visibleEvents.map((eventGroup, eventIndex) => {
              const inSelection = selectedInterval != null &&
                eventGroup.time >= selectedInterval[0] &&
                eventGroup.time <= selectedInterval[1];
              const isSelected = selectedEventTime === eventGroup.time;
              return (
                <div
                  key={`event-group-${eventGroup.time}`}
                  className={`vehicle-event-sequence-group${inSelection ? ' is-selected-interval' : ''}${isSelected ? ' is-selected' : ''}`}
                  style={{ gridColumn: eventIndex + 1 }}
                >
                  {eventGroup.events.map(event => {
                    const passengerLabel = `P${event.passengerId}`;
                    const eventLabel = event.type === 'pickup' ? 'Pickup' : 'Drop-off';
                    const isDecisionFocus =
                      dispatchDecisionFocus?.requestId === event.passengerId &&
                      dispatchDecisionFocus.actionType === event.type;
                    return (
                      <button
                        key={event.key}
                        type="button"
                        className={`vehicle-event-sequence-box is-${event.type}${isDecisionFocus ? ' is-decision-focus' : ''}`}
                        aria-pressed={isSelected}
                      title={`${eventLabel} ${passengerLabel}${event.passengerCount > 1 ? ` (${event.passengerCount} passengers)` : ''} at t=${eventGroup.time}`}
                      onClick={() => onSelectEventTime(isSelected ? null : eventGroup.time)}
                    >
                        <span>{event.passengerId}</span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function StatusTimelineRow({
  segments,
  domain,
  currentTime,
  isPanning,
  interactionMode,
  resultSide,
  resultLabel,
  vehicleId,
  selectedSegment,
  contextInterval,
  draftInterval,
  passengerLoadData,
  passengerEventData,
  hasEncodedEvents,
  maxEventGroupCount,
  eventBoxWidth,
  eventSequenceScrollLeft,
  onEventSequenceScrollLeftChange,
  selectedEventTime,
  dispatchDecisionFocus,
  onSelectEventTime,
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
  interactionMode: TimelineInteractionMode;
  resultSide: 'left' | 'right';
  resultLabel: string;
  vehicleId: number;
  selectedSegment: VehiclePatternSelection | null;
  contextInterval: TimelineDomain | null;
  draftInterval: [number, number] | null;
  passengerLoadData: VehiclePassengerLoadDatum[];
  passengerEventData: PassengerEventDatum[];
  hasEncodedEvents: boolean;
  maxEventGroupCount: number;
  eventBoxWidth: number;
  eventSequenceScrollLeft: number;
  onEventSequenceScrollLeftChange: (scrollLeft: number) => void;
  selectedEventTime: number | null;
  dispatchDecisionFocus: ReplayDispatchDecision | null;
  onSelectEventTime: (time: number | null) => void;
  onSelectSegment: (selection: VehiclePatternSelection) => void;
  onWheel: (event: TimelineWheelEvent) => void;
  onMouseDown: (event: MouseEvent<HTMLDivElement>) => void;
  onMouseMove: (event: MouseEvent<HTMLDivElement>) => void;
  onMouseUp: (event: MouseEvent<HTMLDivElement>) => void;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const axisRef = useRef<HTMLDivElement | null>(null);
  const [eventSequenceTrackTop, setEventSequenceTrackTop] = useState(0);
  const [axisCenterY, setAxisCenterY] = useState(0);
  const [domainStart, domainEnd] = domain;
  const duration = Math.max(1, domainEnd - domainStart);
  const currentTimePct = Math.min(100, Math.max(0, ((currentTime - domainStart) / duration) * 100));
  const showCurrentTimeTick = currentTime >= domainStart && currentTime <= domainEnd;
  const selectedInterval: [number, number] | null = draftInterval ?? contextInterval ?? (
    selectedSegment?.vehicleId === vehicleId
      ? [selectedSegment.startTime, selectedSegment.endTime]
      : null
  );
  const selectedRangeStart = selectedInterval == null ? null : Math.max(domainStart, selectedInterval[0]);
  const selectedRangeEnd = selectedInterval == null ? null : Math.min(domainEnd, selectedInterval[1]);
  const selectedEventRawPct = selectedEventTime == null
    ? null
    : ((selectedEventTime - domainStart) / duration) * 100;
  const selectedEventPct = selectedEventRawPct == null
    ? null
    : Math.min(100, Math.max(0, selectedEventRawPct));
  const visibleEventGroups = passengerEventData;
  const selectedEventIndex = selectedEventTime == null
    ? -1
    : visibleEventGroups.findIndex(event => event.time === selectedEventTime);
  const showSelectedEvent = selectedEventPct != null && selectedEventIndex >= 0;
  const selectedSequencePct = selectedEventIndex < 0
    ? null
    : ((selectedEventIndex + 0.5) / Math.max(1, maxEventGroupCount)) * 100;
  const selectedSequenceXPx = selectedEventIndex < 0
    ? null
    : (selectedEventIndex + 0.5) * eventBoxWidth - eventSequenceScrollLeft;
  const connectorBendY = axisCenterY > 0
    ? axisCenterY
    : Math.max(0, eventSequenceTrackTop - 10);
  const decisionTimePct = dispatchDecisionFocus == null
    ? null
    : ((dispatchDecisionFocus.time - domainStart) / duration) * 100;
  const showDecisionTime = decisionTimePct != null &&
    decisionTimePct >= 0 &&
    decisionTimePct <= 100;

  useNonPassiveWheel(trackRef, onWheel);

  useLayoutEffect(() => {
    const updateAxisCenter = () => {
      const axis = axisRef.current;
      if (!axis) return;
      const nextAxisCenter = axis.offsetTop + axis.clientHeight / 2;
      setAxisCenterY(previous => (
        Math.abs(previous - nextAxisCenter) > 0.5 ? nextAxisCenter : previous
      ));
    };

    updateAxisCenter();
    window.addEventListener('resize', updateAxisCenter);
    return () => window.removeEventListener('resize', updateAxisCenter);
  }, [eventSequenceTrackTop, passengerLoadData.length]);

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
    onMouseUp(event);
  };

  const handleDragStart = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <div className="vehicle-pattern-timeline-row">
      {showSelectedEvent && eventSequenceTrackTop > 0 ? (
        <svg
          className="vehicle-pattern-event-connector"
          aria-hidden="true"
        >
          <line
            x1={`${selectedEventPct}%`}
            y1="0"
            x2={`${selectedEventPct}%`}
            y2={`${connectorBendY}px`}
          />
          <line
            x1={`${selectedEventPct}%`}
            y1={`${connectorBendY}px`}
            x2={selectedSequenceXPx == null ? `${selectedSequencePct ?? selectedEventPct}%` : `${selectedSequenceXPx}px`}
            y2={`${eventSequenceTrackTop}px`}
          />
        </svg>
      ) : null}
      <div
        ref={trackRef}
        className={`vehicle-pattern-track is-${interactionMode}${isPanning ? ' panning' : ''}`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onDragStart={handleDragStart}
      >
        {selectedRangeStart != null && selectedRangeEnd != null && selectedRangeEnd > selectedRangeStart ? (
          <span
            className="vehicle-pattern-track-selected-interval"
            style={{
              left: `${((selectedRangeStart - domainStart) / duration) * 100}%`,
              width: `${((selectedRangeEnd - selectedRangeStart) / duration) * 100}%`,
            }}
            aria-hidden="true"
          />
        ) : null}
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
            const clickable = interactionMode === 'pan' &&
              (segment.status === 'idle' || segment.status === 'picking_up' || segment.status === 'carrying');
            const selected =
              selectedSegment?.resultSide === resultSide &&
              selectedSegment.vehicleId === vehicleId &&
              selectedSegment.startTime === segment.startTime &&
              selectedSegment.endTime === segment.endTime &&
              selectedSegment.status === segment.status;
            const isDecisionAction = dispatchDecisionFocus != null &&
              segmentMatchesDispatchDecision(segment, dispatchDecisionFocus);

            return (
              <button
                key={`${resultLabel}-${segment.startTime}-${segment.status}-${index}`}
                type="button"
                className={`vehicle-pattern-segment${clickable ? ' clickable' : ''}${selected ? ' selected' : ''}${segment.hasPassengerEvent ? ' has-passenger-event' : ''}${isDecisionAction ? ' is-decision-action' : ''}`}
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
        {showCurrentTimeTick && dispatchDecisionFocus == null ? (
          <span
            className="vehicle-pattern-current-time-tick"
            style={{ left: currentTimePct + '%' }}
            aria-hidden="true"
          />
        ) : null}
        {showDecisionTime ? (
          <span
            className="vehicle-pattern-decision-time-line"
            style={{ left: `${decisionTimePct}%` }}
            aria-hidden="true"
          />
        ) : null}
      </div>
      {passengerLoadData.length > 0 ? (
        <VehiclePatternPassengerLoadChart
          data={passengerLoadData}
          passengerEvents={passengerEventData}
          domain={domain}
          currentTime={currentTime}
          selectedInterval={selectedInterval}
          interactionMode={interactionMode}
          onWheel={onWheel}
          onInteractionMouseDown={handleMouseDown}
          onInteractionMouseMove={handleMouseMove}
          onInteractionMouseUp={handleMouseUp}
        />
      ) : null}
      <div ref={axisRef} className="vehicle-pattern-axis">
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
      <EventSequenceBar
        passengerEvents={passengerEventData}
        hasEncodedEvents={hasEncodedEvents}
        maxEventGroupCount={maxEventGroupCount}
        eventBoxWidth={eventBoxWidth}
        scrollLeft={eventSequenceScrollLeft}
        onScrollLeftChange={onEventSequenceScrollLeftChange}
        onTrackTopChange={setEventSequenceTrackTop}
        selectedInterval={selectedInterval}
        isDraftSelection={draftInterval != null}
        selectedEventTime={selectedEventTime}
        dispatchDecisionFocus={dispatchDecisionFocus}
        onSelectEventTime={onSelectEventTime}
      />
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
  contextInterval,
  interactionMode,
  maxEventGroupCount,
  eventBoxWidth,
  dispatchDecisionFocus,
  onSelectSegment,
}: {
  vehicleId: number;
  resultSide: 'left' | 'right';
  resultLabel: string;
  resultColor: string;
  source: ReplayVehicleSource | null;
  currentTime: number;
  selectedSegment: VehiclePatternSelection | null;
  contextInterval: TimelineDomain | null;
  interactionMode: TimelineInteractionMode;
  maxEventGroupCount: number;
  eventBoxWidth: number;
  dispatchDecisionFocus: ReplayDispatchDecision | null;
  onSelectSegment: (selection: VehiclePatternSelection) => void;
}) {
  const minTime = source?.frames[0]?.metrics.currentTime ?? currentTime;
  const sourceMaxTime = source?.frames[source.frames.length - 1]?.metrics.currentTime ?? currentTime;
  const maxTime = Math.max(sourceMaxTime, minTime + 1);
  const fullDomain: TimelineDomain = [minTime, maxTime];
  const [zoomDomain, setZoomDomain] = useState<TimelineDomain | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [draftInterval, setDraftInterval] = useState<[number, number] | null>(null);
  const [selectedEventTime, setSelectedEventTime] = useState<number | null>(null);
  const [eventSequenceScrollLeft, setEventSequenceScrollLeft] = useState(0);
  const panStartRef = useRef<{ x: number; domain: TimelineDomain } | null>(null);
  const selectionStartRef = useRef<number | null>(null);
  const temporalData = source?.temporalIndex?.byVehicleId[vehicleId];
  const frame = useMemo(
    () => source ? frameAtOrBefore(source.frames, currentTime) : null,
    [currentTime, source],
  );
  const status = useMemo(
    () => statusAt(source, vehicleId, currentTime),
    [currentTime, source, vehicleId],
  );
  const segments = useMemo(
    () => temporalData?.timelineData ??
      buildVehicleTimelineData(source?.frames ?? [], vehicleId),
    [source, temporalData, vehicleId],
  );
  const passengerLoadData = useMemo(
    () => temporalData?.passengerLoadData ??
      buildVehiclePassengerLoadData(
        source?.frames ?? [],
        vehicleId,
        source?.passengerEvents,
      ),
    [source, temporalData, vehicleId],
  );
  const passengerEventData = useMemo(
    () => buildPassengerEventData(source, vehicleId),
    [source, vehicleId],
  );
  const canInteract = segments.length > 0 && fullDomain[1] > fullDomain[0];
  const activeDomain = clampDomain(zoomDomain ?? fullDomain, fullDomain);
  const replayFrameTimes = useMemo(
    () => source?.temporalIndex?.frameTimes ??
      Array.from(new Set(
        (source?.frames ?? []).map(sourceFrame => sourceFrame.metrics.currentTime),
      )).sort((a, b) => a - b),
    [source],
  );
  const selectableFrameTimes = useMemo(
    () => replayFrameTimes.filter(
      time => time >= activeDomain[0] && time <= activeDomain[1],
    ),
    [activeDomain[0], activeDomain[1], replayFrameTimes],
  );
  const activeDispatchDecision = dispatchDecisionFocus?.vehicleId === vehicleId
    ? dispatchDecisionFocus
    : null;

  useEffect(() => {
    selectionStartRef.current = null;
    setDraftInterval(null);
    setIsPanning(false);
    panStartRef.current = null;
  }, [interactionMode]);

  useEffect(() => {
    setSelectedEventTime(null);
    setEventSequenceScrollLeft(0);
  }, [source, vehicleId]);

  useEffect(() => {
    if (contextInterval == null) {
      setZoomDomain(null);
      return;
    }
    setZoomDomain(calculateZoomDomain(
      contextInterval,
      fullDomain,
      CONTEXT_INTERVAL_ZOOM_FACTOR,
      0.5,
      0,
    ));
  }, [
    contextInterval?.[0],
    contextInterval?.[1],
    fullDomain[0],
    fullDomain[1],
  ]);

  const timeAtPointer = (event: MouseEvent<HTMLDivElement>): number => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = rect.width > 0
      ? Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
      : 0;
    return activeDomain[0] + ratio * (activeDomain[1] - activeDomain[0]);
  };

  const snapToReplayFrame = (time: number): number => {
    const candidates = selectableFrameTimes.length > 0 ? selectableFrameTimes : replayFrameTimes;
    if (candidates.length === 0) return Math.round(time);
    return candidates.reduce((nearest, candidate) =>
      Math.abs(candidate - time) < Math.abs(nearest - time) ? candidate : nearest,
    candidates[0]);
  };

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
    if (!canInteract || event.button !== 0) return;
    if (interactionMode === 'select') {
      event.preventDefault();
      event.stopPropagation();
      const startTime = snapToReplayFrame(timeAtPointer(event));
      selectionStartRef.current = startTime;
      setDraftInterval([startTime, startTime]);
      return;
    }
    if (zoomDomain == null) return;
    panStartRef.current = { x: event.clientX, domain: activeDomain };
    setIsPanning(true);
  };

  const handleMouseMove = (event: MouseEvent<HTMLDivElement>) => {
    if (interactionMode === 'select' && selectionStartRef.current != null) {
      event.preventDefault();
      event.stopPropagation();
      const currentTimeAtPointer = snapToReplayFrame(timeAtPointer(event));
      setDraftInterval([
        Math.min(selectionStartRef.current, currentTimeAtPointer),
        Math.max(selectionStartRef.current, currentTimeAtPointer),
      ]);
      return;
    }
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

  const handleMouseUp = (event: MouseEvent<HTMLDivElement>) => {
    if (interactionMode === 'select' && selectionStartRef.current != null) {
      event.preventDefault();
      event.stopPropagation();
      const startTime = selectionStartRef.current;
      let endTime = snapToReplayFrame(timeAtPointer(event));
      const candidates = selectableFrameTimes.length > 1 ? selectableFrameTimes : replayFrameTimes;
      if (endTime === startTime && candidates.length > 1) {
        const frameIndex = candidates.indexOf(startTime);
        endTime = candidates[Math.min(candidates.length - 1, frameIndex + 1)] ?? startTime;
        if (endTime === startTime && frameIndex > 0) endTime = candidates[frameIndex - 1];
      }
      selectionStartRef.current = null;
      setDraftInterval(null);
      const rangeStart = Math.min(startTime, endTime);
      const rangeEnd = Math.max(startTime, endTime);
      if (rangeEnd > rangeStart) {
        onSelectSegment({
          resultSide,
          resultLabel,
          vehicleId,
          status: 'range',
          startTime: rangeStart,
          endTime: rangeEnd,
        });
      }
      return;
    }
    panStartRef.current = null;
    setIsPanning(false);
  };

  return (
    <div
      className={`vehicle-pattern-row${activeDispatchDecision ? ' is-decision-focus' : ''}`}
      data-vehicle-id={vehicleId}
    >
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
        {activeDispatchDecision ? (
          <span className="vehicle-pattern-decision-label">
            {dispatchDecisionLabel(activeDispatchDecision)}
          </span>
        ) : null}
      </div>
      <StatusTimelineRow
        segments={segments}
        domain={activeDomain}
        currentTime={currentTime}
        isPanning={isPanning}
        interactionMode={interactionMode}
        resultSide={resultSide}
        resultLabel={resultLabel}
        vehicleId={vehicleId}
        selectedSegment={selectedSegment}
        contextInterval={contextInterval}
        draftInterval={draftInterval}
        passengerLoadData={passengerLoadData}
        passengerEventData={passengerEventData}
        hasEncodedEvents={source?.passengerEvents != null}
        maxEventGroupCount={maxEventGroupCount}
        eventBoxWidth={eventBoxWidth}
        eventSequenceScrollLeft={eventSequenceScrollLeft}
        onEventSequenceScrollLeftChange={setEventSequenceScrollLeft}
        selectedEventTime={selectedEventTime}
        dispatchDecisionFocus={activeDispatchDecision}
        onSelectEventTime={setSelectedEventTime}
        onSelectSegment={onSelectSegment}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
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
  contextInterval,
  maxEventGroupCount,
  dispatchDecisionFocus,
  onSelectSegment,
}: {
  side: 'left' | 'right';
  title: string;
  color: string;
  source: ReplayVehicleSource | null;
  vehicleIds: number[];
  currentTime: number;
  selectedSegment: VehiclePatternSelection | null;
  contextInterval: TimelineDomain | null;
  maxEventGroupCount: number;
  dispatchDecisionFocus: ReplayDispatchDecision | null;
  onSelectSegment: (selection: VehiclePatternSelection) => void;
}) {
  const [interactionMode, setInteractionMode] = useState<TimelineInteractionMode>('pan');
  const rowListRef = useRef<HTMLDivElement | null>(null);
  const focusReturnScrollTopRef = useRef<number | null>(null);
  const previousDecisionFocusRef = useRef<ReplayDispatchDecision | null>(null);
  const maxRequestIdDigits = useMemo(
    () => source?.temporalIndex?.maxRequestIdDigits ??
      Math.max(
        1,
        ...(source?.passengerEvents ?? []).map(event => String(event.passengerId).length),
      ),
    [source],
  );
  const eventBoxWidth = Math.max(36, Math.min(64, 18 + maxRequestIdDigits * 7));

  useLayoutEffect(() => {
    const rowList = rowListRef.current;
    const previousFocus = previousDecisionFocusRef.current;
    if (!rowList) return;

    if (dispatchDecisionFocus) {
      if (previousFocus == null) {
        focusReturnScrollTopRef.current = rowList.scrollTop;
      }
      const row = rowList.querySelector<HTMLElement>(
        `[data-vehicle-id="${dispatchDecisionFocus.vehicleId}"]`,
      );
      if (row) {
        const listRect = rowList.getBoundingClientRect();
        const rowRect = row.getBoundingClientRect();
        const centeredTop = rowList.scrollTop +
          rowRect.top - listRect.top -
          Math.max(0, (rowList.clientHeight - rowRect.height) / 2);
        rowList.scrollTo({
          top: Math.max(0, centeredTop),
          behavior: 'smooth',
        });
      }
    } else if (previousFocus != null && focusReturnScrollTopRef.current != null) {
      rowList.scrollTop = focusReturnScrollTopRef.current;
      focusReturnScrollTopRef.current = null;
    }
    previousDecisionFocusRef.current = dispatchDecisionFocus;
  }, [
    dispatchDecisionFocus?.decisionRound,
    dispatchDecisionFocus?.time,
    dispatchDecisionFocus?.vehicleId,
  ]);

  return (
    <article className="panel vehicle-pattern-result-card">
      <div className="vehicle-pattern-result-head">
        <h3 style={{ color }}>{title}</h3>
        <div className="vehicle-pattern-result-summary">
          <div className="vehicle-pattern-interaction-mode" aria-label={`${title} timeline interaction mode`}>
            <button
              type="button"
              className={interactionMode === 'pan' ? 'is-active' : ''}
              aria-pressed={interactionMode === 'pan'}
              onClick={() => setInteractionMode('pan')}
            >
              Pan
            </button>
            <button
              type="button"
              className={interactionMode === 'select' ? 'is-active' : ''}
              aria-pressed={interactionMode === 'select'}
              onClick={() => setInteractionMode('select')}
            >
              Select
            </button>
          </div>
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
      <div ref={rowListRef} className="vehicle-pattern-row-list">
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
            contextInterval={contextInterval}
            interactionMode={interactionMode}
            maxEventGroupCount={maxEventGroupCount}
            eventBoxWidth={eventBoxWidth}
            dispatchDecisionFocus={dispatchDecisionFocus}
            onSelectSegment={onSelectSegment}
          />
        ))}
      </div>
    </article>
  );
}

export function ResultVehiclePatterns({
  source,
  vehicleIds,
  currentTime,
  selectedSegment,
  contextInterval = null,
  dispatchDecisionFocus = null,
  onSelectSegment,
}: {
  source: ReplayVehicleSource | null;
  vehicleIds: number[];
  currentTime: number;
  selectedSegment: VehiclePatternSelection | null;
  contextInterval?: TimelineDomain | null;
  dispatchDecisionFocus?: ReplayDispatchDecision | null;
  onSelectSegment: (selection: VehiclePatternSelection) => void;
}) {
  const maxEventGroupCount = useMemo(
    () => Math.max(
      1,
      ...vehicleIds.map(vehicleId => passengerEventGroupCount(source, vehicleId)),
    ),
    [source, vehicleIds],
  );

  return (
    <section className="vehicle-pattern-section result-analysis-pattern-section">
      <ResultVehicleCard
        side="left"
        title="Vehicle Pattern"
        color={RESULT_A_COLOR}
        source={source}
        vehicleIds={vehicleIds}
        currentTime={currentTime}
        selectedSegment={selectedSegment}
        contextInterval={contextInterval}
        dispatchDecisionFocus={dispatchDecisionFocus}
        maxEventGroupCount={maxEventGroupCount}
        onSelectSegment={onSelectSegment}
      />
    </section>
  );
}

export default function VehicleTemporalComparisonCharts({
  resultA,
  resultB,
  currentTimes,
  selectedSegments,
  contextIntervals = { left: null, right: null },
  onSelectSegment,
}: VehicleTemporalComparisonChartsProps) {
  const vehicleIds = useMemo(
    () => vehicleIdsForSources(resultA, resultB),
    [resultA, resultB],
  );
  const maxEventGroupCount = useMemo(
    () => Math.max(
      1,
      ...[resultA, resultB].flatMap(source =>
        vehicleIds.map(vehicleId => passengerEventGroupCount(source, vehicleId)),
      ),
    ),
    [resultA, resultB, vehicleIds],
  );
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
          contextInterval={contextIntervals.left}
          dispatchDecisionFocus={null}
          maxEventGroupCount={maxEventGroupCount}
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
          contextInterval={contextIntervals.right}
          dispatchDecisionFocus={null}
          maxEventGroupCount={maxEventGroupCount}
          onSelectSegment={onSelectSegment}
        />
      </div>
    </section>
  );
}
