import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import type { WaitTimeDistribution } from '../types/simulation';

interface WaitTimeChartProps {
  data: WaitTimeDistribution[];
}

/** Bin centers on 0–10 (min) axis; 10+ sits at 10. */
const WAIT_BIN_ORDER = ['0-2', '3-5', '6-10', '10+'] as const;
const WAIT_BIN_X: Record<string, number> = {
  '0-2': 1,
  '3-5': 4,
  '6-10': 8,
  '10+': 10,
};

function buildWaitChartRows(source: WaitTimeDistribution[]) {
  const byRange = new Map(source.map(d => [d.range, d.count]));
  return WAIT_BIN_ORDER.map(range => ({
    range,
    x: WAIT_BIN_X[range],
    count: byRange.get(range) ?? 0,
  }));
}

export default function WaitTimeChart({ data }: WaitTimeChartProps) {
  const chartData = buildWaitChartRows(data);

  return (
    <div className="panel chart-panel">
      <h3 className="panel-title">Wait Time Distribution (min)</h3>
      <div className="chart-container">
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis
              type="number"
              dataKey="x"
              domain={[0, 10]}
              ticks={[0, 2, 4, 6, 8, 10]}
              stroke="#94a3b8"
              fontSize={10}
            />
            <YAxis stroke="#94a3b8" fontSize={10} allowDecimals={false} />
            <Tooltip
              contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
              labelStyle={{ color: '#e2e8f0' }}
              formatter={(value: number) => [value, 'count']}
              labelFormatter={(_, payload) =>
                (payload?.[0]?.payload as { range?: string } | undefined)?.range ?? ''
              }
            />
            <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} maxBarSize={36} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
