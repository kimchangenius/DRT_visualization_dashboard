import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import type { WaitTimeBarDatum } from '../types/simulation';
import { CHART_ANIMATION_DURATION_MS } from '../config';

interface WaitTimeBarChartProps {
  data: WaitTimeBarDatum[];
  maxWaitTime: number;
  replayTime?: number;
}

export default function WaitTimeBarChart({ data, maxWaitTime, replayTime }: WaitTimeBarChartProps) {
  const visibleData = replayTime == null
    ? data
    : data.filter(d => d.pickupTime <= replayTime);

  return (
    <div className="panel chart-panel">
      <h3 className="panel-title">Passenger Wait Time</h3>
      <div className="chart-container">
        {visibleData.length === 0 ? (
          <p className="chart-empty-text">No picked-up passenger data at this time</p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={visibleData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis
                dataKey="passengerId"
                stroke="#94a3b8"
                fontSize={10}
                label={{ value: 'Passenger ID', position: 'insideBottom', offset: -2, fill: '#94a3b8', fontSize: 9 }}
              />
              <YAxis
                stroke="#94a3b8"
                fontSize={10}
                label={{ value: 'Wait (min)', angle: -90, position: 'insideLeft', offset: 15, fill: '#94a3b8', fontSize: 9 }}
              />
              <Tooltip
                contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
                labelStyle={{ color: '#e2e8f0' }}
                formatter={(value: number) => [`${value} min`, 'Wait Time']}
                labelFormatter={(id) => `Passenger #${id}`}
              />
              {maxWaitTime > 0 && (
                <ReferenceLine
                  y={maxWaitTime}
                  stroke="#ef4444"
                  strokeDasharray="4 2"
                  strokeWidth={1.5}
                  label={{ value: 'Max', fill: '#ef4444', fontSize: 9, position: 'right' }}
                />
              )}
              <Bar
                dataKey="waitTime"
                fill="#3b82f6"
                radius={[4, 4, 0, 0]}
                maxBarSize={36}
                isAnimationActive
                animationDuration={CHART_ANIMATION_DURATION_MS}
                animationEasing="ease-out"
              />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
