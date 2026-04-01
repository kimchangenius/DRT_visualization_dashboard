import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import type { RequestStatusData } from '../types/simulation';
import { CHART_ANIMATION_DURATION_MS } from '../config';

interface RequestStatusChartProps {
  data: RequestStatusData[];
}

export default function RequestStatusChart({ data }: RequestStatusChartProps) {
  const total = data.reduce((sum, d) => sum + d.value, 0);

  return (
    <div className="panel chart-panel">
      <h3 className="panel-title">Request Status Overview</h3>
      <div className="chart-container">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={total > 0 ? data : [{ name: 'No Data', value: 1, color: '#334155' }]}
              cx="50%"
              cy="50%"
              innerRadius={35}
              outerRadius={60}
              paddingAngle={2}
              dataKey="value"
              isAnimationActive
              animationDuration={CHART_ANIMATION_DURATION_MS}
              animationEasing="ease-out"
            >
              {(total > 0 ? data : [{ name: 'No Data', value: 1, color: '#334155' }]).map(
                (entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                )
              )}
            </Pie>
            <Tooltip
              contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
              labelStyle={{ color: '#e2e8f0' }}
            />
            {total > 0 && (
              <Legend
                wrapperStyle={{ fontSize: 11, color: '#94a3b8' }}
                formatter={(value: string) => <span style={{ color: '#94a3b8' }}>{value}</span>}
              />
            )}
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
