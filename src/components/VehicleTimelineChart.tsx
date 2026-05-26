import type { VehicleAnalysisSummary, VehicleStatus, VehicleTimelineDatum } from '../types/simulation';

interface VehicleTimelineChartProps {
  data: VehicleTimelineDatum[];
  replayTime: number;
  statusShare?: Pick<VehicleAnalysisSummary, 'idlePct' | 'pickupPct' | 'carryingPct'>;
}

const STATUS_META: Record<VehicleStatus, { label: string; color: string }> = {
  idle: { label: 'Idle', color: 'transparent' },
  picking_up: { label: 'Picking up', color: '#f59e0b' },
  carrying: { label: 'Carrying', color: '#10b981' },
  repositioning: { label: 'Repositioning', color: '#94a3b8' },
};

function formatDuration(startTime: number, endTime: number): string {
  return `${startTime} - ${endTime}`;
}

export default function VehicleTimelineChart({ data, replayTime, statusShare }: VehicleTimelineChartProps) {
  const visibleSegments = data
    .filter(d => d.startTime <= replayTime)
    .map(d => ({
      ...d,
      endTime: Math.min(d.endTime, replayTime),
    }))
    .filter(d => d.endTime >= d.startTime);

  const minTime = 0;
  const maxTime = Math.max(
    replayTime,
    ...visibleSegments.map(d => d.endTime),
    minTime + 1,
  );
  const duration = Math.max(1, maxTime - minTime);

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
                    className={`vehicle-timeline-segment status-${segment.status}`}
                    style={{
                      left: `${left}%`,
                      width: `${Math.min(width, 100 - left)}%`,
                      background: meta.color,
                    }}
                    title={`${meta.label}: t=${formatDuration(segment.startTime, segment.endTime)}`}
                  />
                );
              })}
              <div
                className="vehicle-timeline-cursor"
                style={{ left: `${Math.min(100, Math.max(0, ((replayTime - minTime) / duration) * 100))}%` }}
                title={`Replay t=${replayTime}`}
              />
            </div>

            <div className="vehicle-timeline-axis">
              <span>t={minTime}</span>
              <span>t={replayTime}</span>
            </div>

            <div className="vehicle-timeline-legend">
              {(Object.entries(STATUS_META) as Array<[VehicleStatus, { label: string; color: string }]>).filter(
                ([status]) => status !== 'repositioning',
              ).map(([status, meta]) => (
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
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
