import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type {
  VehicleAnalysisSummary,
  VehiclePassengerLoadDatum,
  VehicleStatus,
  VehicleTimelineDatum,
} from '../types/simulation';
import { CHART_ANIMATION_DURATION_MS, VEHICLE_STATUS_COLORS } from '../config';

interface VehicleTimelineChartProps {
  data: VehicleTimelineDatum[];
  replayTime: number;
  statusShare?: Pick<VehicleAnalysisSummary, 'idlePct' | 'pickupPct' | 'carryingPct'>;
  passengerLoadData?: VehiclePassengerLoadDatum[];
  vehicleCapacity?: number;
}

const STATUS_META: Record<VehicleStatus, { label: string; color: string }> = {
  idle: { label: 'Idle', color: VEHICLE_STATUS_COLORS.idle },
  picking_up: { label: 'Picking up', color: VEHICLE_STATUS_COLORS.picking_up },
  carrying: { label: 'Carrying', color: VEHICLE_STATUS_COLORS.carrying },
};

function formatDuration(startTime: number, endTime: number): string {
  return `${startTime} - ${endTime}`;
}

function OnboardTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ payload?: VehiclePassengerLoadDatum; value?: number }>;
  label?: string | number;
}) {
  if (!active) return null;

  const point = payload?.[0]?.payload;
  const total = point?.onboardPassengers ?? payload?.[0]?.value ?? 0;
  const passengerLabels = point?.onboardPassengerLabels ?? [];

  return (
    <div className="vehicle-timeline-load-tooltip">
      <div className="vehicle-timeline-load-tooltip-time">t={label}</div>
      <div className="vehicle-timeline-load-tooltip-total">Onboard {total}</div>
      <div className="vehicle-timeline-load-tooltip-list">
        {passengerLabels.length > 0 ? passengerLabels.join(', ') : 'No passengers'}
      </div>
    </div>
  );
}

export default function VehicleTimelineChart({
  data,
  replayTime,
  statusShare,
  passengerLoadData = [],
  vehicleCapacity,
}: VehicleTimelineChartProps) {
  const visibleSegments = data.filter(d => d.endTime > d.startTime);
  const hasPassengerLoadData = passengerLoadData.length > 0;

  const minTime = 0;
  const maxTime = Math.max(
    data.reduce((max, segment) => Math.max(max, segment.endTime), minTime + 1),
    passengerLoadData.reduce((max, point) => Math.max(max, point.time), minTime + 1),
    replayTime,
  );
  const duration = Math.max(1, maxTime - minTime);
  const replayPositionPct = Math.min(
    100,
    Math.max(0, ((replayTime - minTime) / duration) * 100),
  );
  const maxPassengerLoad = passengerLoadData.reduce(
    (max, point) => Math.max(max, point.onboardPassengers),
    0,
  );
  const passengerLoadYAxisMax = Math.max(1, vehicleCapacity ?? 0, maxPassengerLoad);

  return (
    <div className="panel chart-panel vehicle-timeline-panel">
      <h3 className="panel-title">Vehicle Timeline</h3>
      {statusShare ? (
        <div className="vehicle-timeline-status-share" aria-label="Vehicle status share">
          <div className="vehicle-timeline-status-title">Status Overview</div>
          <div className="vehicle-timeline-status-body">
            <div className="vehicle-timeline-status-bar">
              <div
                className="vehicle-timeline-status-seg is-idle"
                style={{ width: `${statusShare.idlePct}%` }}
                title={`Idle ${statusShare.idlePct}%`}
              />
              <div
                className="vehicle-timeline-status-seg is-pickup"
                style={{ width: `${statusShare.pickupPct}%` }}
                title={`Pickup ${statusShare.pickupPct}%`}
              />
              <div
                className="vehicle-timeline-status-seg is-carrying"
                style={{ width: `${statusShare.carryingPct}%` }}
                title={`Carrying ${statusShare.carryingPct}%`}
              />
            </div>
            <div className="vehicle-timeline-status-labels">
              <span>Idle {statusShare.idlePct}%</span>
              <span>Pickup {statusShare.pickupPct}%</span>
              <span>Carrying {statusShare.carryingPct}%</span>
            </div>
          </div>
        </div>
      ) : null}
      <div className="chart-container vehicle-timeline-container">
        {visibleSegments.length === 0 ? (
          <p className="chart-empty-text">No timeline data at this time</p>
        ) : (
          <div className="vehicle-timeline">
            <div className="vehicle-timeline-track" aria-label="Vehicle status timeline">
              {visibleSegments.map((segment, index) => {
                const meta = STATUS_META[segment.status];
                const left = ((segment.startTime - minTime) / duration) * 100;
                const width = Math.max(
                  1.5,
                  ((segment.endTime - segment.startTime) / duration) * 100,
                );

                return (
                  <div
                    key={`${segment.startTime}-${segment.status}-${index}`}
                    className={`vehicle-timeline-segment status-${segment.status}${segment.hasPassengerEvent ? ' has-passenger-event' : ''}`}
                    style={{
                      left: `${left}%`,
                      width: `${Math.min(width, 100 - left)}%`,
                      background: meta.color,
                    }}
                    title={`${meta.label}: t=${formatDuration(segment.startTime, segment.endTime)}${segment.hasPassengerEvent ? ' / passenger pickup-dropoff boundary' : ''}`}
                  />
                );
              })}
              <div
                className="vehicle-timeline-cursor"
                style={{ left: `${replayPositionPct}%` }}
                title={`Replay t=${replayTime}`}
              />
            </div>

            {hasPassengerLoadData ? (
              <div className="vehicle-timeline-load-chart" aria-label="Onboard passenger count over time">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={passengerLoadData}
                    margin={{ top: 8, right: 10, left: -18, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(51, 65, 85, 0.75)" vertical={false} />
                    <XAxis
                      dataKey="time"
                      type="number"
                      domain={[minTime, maxTime]}
                      stroke="#94a3b8"
                      fontSize={10}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      dataKey="onboardPassengers"
                      domain={[0, passengerLoadYAxisMax]}
                      stroke="#94a3b8"
                      fontSize={10}
                      allowDecimals={false}
                      tickLine={false}
                      axisLine={false}
                      width={32}
                    />
                    <Tooltip content={<OnboardTooltip />} />
                    <ReferenceLine
                      x={replayTime}
                      stroke="#f8fafc"
                      strokeDasharray="4 2"
                      strokeWidth={1.2}
                    />
                    <Line
                      type="stepAfter"
                      dataKey="onboardPassengers"
                      name="Onboard"
                      stroke="#38bdf8"
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4, fill: '#38bdf8' }}
                      isAnimationActive
                      animationDuration={CHART_ANIMATION_DURATION_MS}
                      animationEasing="ease-out"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : null}

            <div className="vehicle-timeline-axis">
              <span>t={minTime}</span>
              <span
                className="vehicle-timeline-axis-tick"
                style={{ left: `${replayPositionPct}%` }}
              >
                t={replayTime}
              </span>
              <span>t={maxTime}</span>
            </div>

            <div className="vehicle-timeline-legend">
              {(Object.entries(STATUS_META) as Array<[VehicleStatus, { label: string; color: string }]>).map(([status, meta]) => (
                <span key={status} className="vehicle-timeline-legend-item">
                  <span
                    className="vehicle-timeline-legend-dot"
                    style={{
                      background: meta.color,
                      border: status === 'idle' ? '1px solid rgba(148, 163, 184, 0.5)' : undefined,
                    }}
                  />
                  {meta.label}
                </span>
              ))}
              <span className="vehicle-timeline-legend-item">
                <span className="vehicle-timeline-legend-line" />
                Onboard
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
