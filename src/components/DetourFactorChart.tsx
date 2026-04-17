import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import type { DetourFactorDatum } from '../types/simulation';
import { CHART_ANIMATION_DURATION_MS } from '../config';

interface DetourFactorChartProps {
  data: DetourFactorDatum[];
}

export default function DetourFactorChart({ data }: DetourFactorChartProps) {
  return (
    <div className="panel chart-panel">
      <h3 className="panel-title">Detour Factor</h3>
      <div className="chart-container">
        {data.length === 0 ? (
          <p className="chart-empty-text">No delivered passenger data</p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis
                dataKey="passengerId"
                stroke="#94a3b8"
                fontSize={10}
                label={{ value: 'Passenger', position: 'insideBottom', offset: -2, fill: '#94a3b8', fontSize: 9 }}
              />
              <YAxis
                stroke="#94a3b8"
                fontSize={10}
                domain={[0, 'auto']}
                label={{ value: 'Factor', angle: -90, position: 'insideLeft', offset: 15, fill: '#94a3b8', fontSize: 9 }}
              />
              <Tooltip
                contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
                labelStyle={{ color: '#e2e8f0' }}
                formatter={(value: number, _name: string, entry: { payload?: DetourFactorDatum }) => {
                  const d = entry.payload;
                  if (!d) return [`${value}x`, 'Detour'];
                  return [
                    `${value}x (actual: ${d.actualTravelTime}, direct: ${d.directTravelTime})`,
                    'Detour',
                  ];
                }}
                labelFormatter={(id) => `Passenger #${id}`}
              />
              <ReferenceLine
                y={1}
                stroke="#10b981"
                strokeDasharray="4 2"
                strokeWidth={1.5}
                label={{ value: 'Direct', fill: '#10b981', fontSize: 9, position: 'right' }}
              />
              <Bar
                dataKey="detourFactor"
                fill="#8b5cf6"
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
