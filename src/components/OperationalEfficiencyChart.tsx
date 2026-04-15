import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
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
              <defs>
                <linearGradient id="idleGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="pickupGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="carryGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="time" stroke="#94a3b8" fontSize={10} />
              <YAxis stroke="#94a3b8" fontSize={10} domain={[0, 100]} />
              <Tooltip
                contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
                labelStyle={{ color: '#e2e8f0' }}
                formatter={(value: number) => [`${value}%`]}
              />
              <Area
                type="monotone"
                dataKey="idlePct"
                stackId="1"
                stroke="#3b82f6"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#idleGrad)"
                name="Idle"
                isAnimationActive
                animationDuration={CHART_ANIMATION_DURATION_MS}
                animationEasing="ease-out"
              />
              <Area
                type="monotone"
                dataKey="pickupPct"
                stackId="1"
                stroke="#f59e0b"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#pickupGrad)"
                name="Picking up"
                isAnimationActive
                animationDuration={CHART_ANIMATION_DURATION_MS}
                animationEasing="ease-out"
              />
              <Area
                type="monotone"
                dataKey="carryingPct"
                stackId="1"
                stroke="#10b981"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#carryGrad)"
                name="Carrying"
                isAnimationActive
                animationDuration={CHART_ANIMATION_DURATION_MS}
                animationEasing="ease-out"
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
