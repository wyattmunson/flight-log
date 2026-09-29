import { useState, type ReactNode } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useChartTheme } from '../lib/useChartTheme';
import { formatInt } from '../lib/format';

export function ChartCard({
  title,
  subtitle,
  empty,
  children,
  table,
  className = '',
}: {
  title: string;
  subtitle?: string;
  empty: boolean;
  children: ReactNode;
  /** Accessible table alternative for the chart. */
  table?: ReactNode;
  className?: string;
}) {
  const [showTable, setShowTable] = useState(false);
  return (
    <section className={`card ${className}`} aria-label={title}>
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold">{title}</h3>
          {subtitle && <p className="text-xs muted">{subtitle}</p>}
        </div>
        {table && !empty && (
          <button
            type="button"
            className="btn-secondary px-2 py-1 text-xs"
            aria-pressed={showTable}
            onClick={() => setShowTable((s) => !s)}
          >
            {showTable ? 'Chart' : 'Table'}
          </button>
        )}
      </div>
      {empty ? (
        <p className="py-8 text-center text-sm muted">No data for these filters yet.</p>
      ) : showTable ? (
        <div className="max-h-80 overflow-auto">{table}</div>
      ) : (
        children
      )}
    </section>
  );
}

function TooltipBox({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="rounded-md border border-stone-200 bg-white px-2.5 py-1.5 text-xs shadow-md dark:border-stone-700 dark:bg-stone-900">
      <div className="font-medium text-stone-900 dark:text-stone-100">{label}</div>
      <div className="text-stone-600 dark:text-stone-300">{value}</div>
    </div>
  );
}

/** Single-series horizontal bars (ranked categories). Long labels stay readable on the y-axis. */
export function HBarChart<T extends object>({
  data,
  labelKey,
  valueKey,
  valueLabel,
  format = formatInt,
}: {
  data: T[];
  labelKey: keyof T & string;
  valueKey: keyof T & string;
  valueLabel: string;
  format?: (n: number) => string;
}) {
  const t = useChartTheme();
  const height = Math.max(120, data.length * 30 + 30);
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data as object[]}
          layout="vertical"
          margin={{ top: 0, right: 16, bottom: 0, left: 0 }}
          barCategoryGap={4}
        >
          <CartesianGrid horizontal={false} stroke={t.grid} />
          <XAxis
            type="number"
            tick={{ fill: t.muted, fontSize: 11 }}
            stroke={t.grid}
            allowDecimals={false}
            tickFormatter={(v: number) => format(v)}
          />
          <YAxis
            type="category"
            dataKey={labelKey}
            width={120}
            tick={{ fill: t.text, fontSize: 12 }}
            stroke={t.grid}
            tickFormatter={(v: string) => (v.length > 18 ? `${v.slice(0, 17)}…` : v)}
          />
          <Tooltip
            cursor={{ fill: t.grid, opacity: 0.5 }}
            content={({ active, payload }) =>
              active && payload?.[0] ? (
                <TooltipBox
                  label={String((payload[0].payload as T)[labelKey])}
                  value={`${format(Number(payload[0].value))} ${valueLabel}`}
                />
              ) : null
            }
          />
          <Bar
            dataKey={valueKey}
            fill={t.series1}
            radius={[0, 4, 4, 0]}
            maxBarSize={22}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Single-series vertical columns (e.g. flights per year). */
export function ColumnChart<T extends object>({
  data,
  xKey,
  valueKey,
  valueLabel,
  xFormat = String,
}: {
  data: T[];
  xKey: keyof T & string;
  valueKey: keyof T & string;
  valueLabel: string;
  xFormat?: (v: unknown) => string;
}) {
  const t = useChartTheme();
  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data as object[]}
          margin={{ top: 8, right: 8, bottom: 0, left: -16 }}
          barCategoryGap="20%"
        >
          <CartesianGrid vertical={false} stroke={t.grid} />
          <XAxis
            dataKey={xKey}
            tick={{ fill: t.muted, fontSize: 11 }}
            stroke={t.grid}
            tickFormatter={xFormat}
          />
          <YAxis allowDecimals={false} tick={{ fill: t.muted, fontSize: 11 }} stroke={t.grid} />
          <Tooltip
            cursor={{ fill: t.grid, opacity: 0.5 }}
            content={({ active, payload }) =>
              active && payload?.[0] ? (
                <TooltipBox
                  label={xFormat((payload[0].payload as T)[xKey])}
                  value={`${formatInt(Number(payload[0].value))} ${valueLabel}`}
                />
              ) : null
            }
          />
          <Bar
            dataKey={valueKey}
            fill={t.series1}
            radius={[4, 4, 0, 0]}
            maxBarSize={48}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Single-series line over time with a crosshair tooltip. */
export function TimeLine<T extends object>({
  data,
  xKey,
  valueKey,
  valueLabel,
  xFormat = String,
}: {
  data: T[];
  xKey: keyof T & string;
  valueKey: keyof T & string;
  valueLabel: string;
  xFormat?: (v: unknown) => string;
}) {
  const t = useChartTheme();
  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data as object[]} margin={{ top: 8, right: 12, bottom: 0, left: -16 }}>
          <CartesianGrid vertical={false} stroke={t.grid} />
          <XAxis
            dataKey={xKey}
            tick={{ fill: t.muted, fontSize: 11 }}
            stroke={t.grid}
            tickFormatter={xFormat}
            minTickGap={24}
          />
          <YAxis allowDecimals={false} tick={{ fill: t.muted, fontSize: 11 }} stroke={t.grid} />
          <Tooltip
            cursor={{ stroke: t.muted, strokeDasharray: '3 3' }}
            content={({ active, payload }) =>
              active && payload?.[0] ? (
                <TooltipBox
                  label={xFormat((payload[0].payload as T)[xKey])}
                  value={`${formatInt(Number(payload[0].value))} ${valueLabel}`}
                />
              ) : null
            }
          />
          <Line
            type="linear"
            dataKey={valueKey}
            stroke={t.series1}
            strokeWidth={2}
            dot={
              data.length <= 24
                ? { r: 3, fill: t.series1, stroke: t.surface, strokeWidth: 2 }
                : false
            }
            activeDot={{ r: 5, stroke: t.surface, strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
