import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import type { UtilizationTimeSeriesPoint } from '../types/simulation';
import { CHART_ANIMATION_DURATION_MS } from '../config';

interface VehicleUtilChartProps {
  data: UtilizationTimeSeriesPoint[];
  replayTime?: number;
}

export default function VehicleUtilChart({ data, replayTime }: VehicleUtilChartProps) {
  return (
    <div className="panel chart-panel">
      <h3 className="panel-title">Vehicle Utilization (%)</h3>
      <div className="chart-container">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey="time" stroke="#94a3b8" fontSize={10} />
            <YAxis stroke="#94a3b8" fontSize={10} domain={[0, 100]} />
            <Tooltip
              contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
              labelStyle={{ color: '#e2e8f0' }}
              formatter={(value: number) => [`${value}%`, 'Utilization']}
            />
            {replayTime != null && (
              <ReferenceLine
                x={replayTime}
                stroke="#a78bfa"
                strokeDasharray="4 2"
                strokeWidth={1.5}
              />
            )}
            <Line
              type="monotone"
              dataKey="utilization"
              stroke="#ec4899"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: '#ec4899' }}
              isAnimationActive
              animationDuration={CHART_ANIMATION_DURATION_MS}
              animationEasing="ease-out"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
