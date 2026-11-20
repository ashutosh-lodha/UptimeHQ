import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Range, SeriesPoint } from '../api/types';
import { chartTick, formatDateTime, formatMs, formatPercent } from '../lib/format';

interface TooltipProps {
  active?: boolean;
  payload?: { payload: SeriesPoint }[];
}

function ChartTooltip({ active, payload }: TooltipProps) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-time">{formatDateTime(p.timestamp)}</div>
      <div>
        Avg response: <strong>{formatMs(p.avgResponseMs)}</strong>
      </div>
      <div>
        Uptime: <strong>{formatPercent(p.uptime)}</strong> · {p.total} checks
      </div>
    </div>
  );
}

export function ResponseChart({ series, range }: { series: SeriesPoint[]; range: Range }) {
  // Start the chart at the first bucket with data, so a monitor with only recent
  // history uses the full width instead of a sliver at the right edge.
  const firstIdx = series.findIndex((p) => p.avgResponseMs != null);
  if (firstIdx > 0) series = series.slice(firstIdx);
  const pointCount = series.filter((p) => p.avgResponseMs != null).length;
  const hasData = pointCount > 0;
  if (!hasData) {
    return (
      <div className="chart-empty chart-box">
        No successful checks recorded in this period yet.
      </div>
    );
  }
  return (
    <div className="chart-box">
      <ResponsiveContainer>
        <AreaChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="rtFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.22} />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--grid)" vertical={false} />
          <XAxis
            dataKey="timestamp"
            tickFormatter={(v: string) => chartTick(v, range)}
            tick={{ fill: 'var(--text-muted)', fontSize: 12 }}
            axisLine={false}
            tickLine={false}
            minTickGap={28}
          />
          <YAxis
            tickFormatter={(v: number) => `${v} ms`}
            tick={{ fill: 'var(--text-muted)', fontSize: 12 }}
            axisLine={false}
            tickLine={false}
            width={64}
          />
          <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'var(--border-strong)' }} />
          <Area
            type="monotone"
            dataKey="avgResponseMs"
            stroke="var(--accent)"
            strokeWidth={2}
            fill="url(#rtFill)"
            // Draw one continuous line through periods without checks.
            connectNulls
            isAnimationActive={false}
            // A single data point cannot form a line, so show it as a marker.
            dot={pointCount <= 1 ? { r: 3, fill: 'var(--accent)', strokeWidth: 0 } : false}
            activeDot={{ r: 4 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
