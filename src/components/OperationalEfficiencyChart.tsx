import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import type { EfficiencyDatum } from '../types/simulation';
import { CHART_ANIMATION_DURATION_MS } from '../config';

interface OperationalEfficiencyChartProps {
  data: EfficiencyDatum[];
}

export default function OperationalEfficiencyChart({ data }: OperationalEfficiencyChartProps) {
  return (
    <div className="panel chart-panel">
      <h3 className="panel-title">Operational Efficiency</h3>
      <div className="chart-container">
        {data.length === 0 ? (
          <p className="chart-empty-text">No efficiency data</p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="time" stroke="#94a3b8" fontSize={10} />
              <YAxis stroke="#94a3b8" fontSize={10} domain={[0, 100]} allowDataOverflow />
              <Tooltip
                contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
                labelStyle={{ color: '#e2e8f0' }}
                labelFormatter={(t) => `Time: ${t}`}
                formatter={(value: number, name: string) => [`${value}%`, name]}
              />
              <Area
                type="monotone"
                dataKey="idlePct"
                stroke="#3b82f6"
                strokeWidth={2}
                fillOpacity={0.15}
                fill="#3b82f6"
                name="Idle"
                isAnimationActive
                animationDuration={CHART_ANIMATION_DURATION_MS}
                animationEasing="ease-out"
              />
              <Area
                type="monotone"
                dataKey="pickupPct"
                stroke="#f59e0b"
                strokeWidth={2}
                fillOpacity={0.15}
                fill="#f59e0b"
                name="Picking up"
                isAnimationActive
                animationDuration={CHART_ANIMATION_DURATION_MS}
                animationEasing="ease-out"
              />
              <Area
                type="monotone"
                dataKey="carryingPct"
                stroke="#10b981"
                strokeWidth={2}
                fillOpacity={0.15}
                fill="#10b981"
                name="Carrying"
                isAnimationActive
                animationDuration={CHART_ANIMATION_DURATION_MS}
                animationEasing="ease-out"
              />
              <Legend
                verticalAlign="bottom"
                height={24}
                iconType="line"
                wrapperStyle={{ fontSize: 10, color: '#94a3b8' }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
