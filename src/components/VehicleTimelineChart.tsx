import type { VehicleStatus, VehicleTimelineDatum } from '../types/simulation';

interface VehicleTimelineChartProps {
  data: VehicleTimelineDatum[];
  replayTime: number;
}

const STATUS_META: Record<VehicleStatus, { label: string; shortLabel: string; color: string }> = {
  idle: { label: 'I: Idle', shortLabel: 'I', color: '#3b82f6' },
  picking_up: { label: 'P: Picking up', shortLabel: 'P', color: '#f59e0b' },
  carrying: { label: 'C: Carrying', shortLabel: 'C', color: '#10b981' },
  repositioning: { label: 'R: Repositioning', shortLabel: 'R', color: '#94a3b8' },
};

function formatDuration(startTime: number, endTime: number): string {
  return `${startTime} - ${endTime}`;
}

export default function VehicleTimelineChart({ data, replayTime }: VehicleTimelineChartProps) {
  const visibleSegments = data
    .filter(d => d.startTime <= replayTime)
    .map(d => ({
      ...d,
      endTime: Math.min(d.endTime, replayTime),
    }))
    .filter(d => d.endTime >= d.startTime);

  const minTime = visibleSegments.length > 0 ? visibleSegments[0].startTime : 0;
  const maxTime = Math.max(
    replayTime,
    ...visibleSegments.map(d => d.endTime),
    minTime + 1,
  );
  const duration = Math.max(1, maxTime - minTime);

  return (
    <div className="panel chart-panel">
      <h3 className="panel-title">Vehicle Timeline</h3>
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
                    className="vehicle-timeline-segment"
                    style={{
                      left: `${left}%`,
                      width: `${Math.min(width, 100 - left)}%`,
                      background: meta.color,
                    }}
                    title={`${meta.label}: t=${formatDuration(segment.startTime, segment.endTime)}`}
                  >
                    <span>{meta.shortLabel}</span>
                  </div>
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
              {(Object.entries(STATUS_META) as Array<[VehicleStatus, { label: string; shortLabel: string; color: string }]>).map(
                ([status, meta]) => (
                  <span key={status} className="vehicle-timeline-legend-item">
                    <span className="vehicle-timeline-legend-dot" style={{ background: meta.color }} />
                    {meta.label}
                  </span>
                ),
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
