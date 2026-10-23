'use client';

import { Table2 } from 'lucide-react';
import { useId, useState } from 'react';
import { Bar, BarChart, CartesianGrid, LabelList, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { cn } from '@/lib/utils';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/misc';

export interface TableSpec {
  columns: string[];
  rows: (string | number)[][];
}

/** Chart container with an accessible data-table view (identity is never colour-alone). */
export function ChartCard({ title, description, table, children, empty, className }: { title: string; description?: string; table: TableSpec; children: React.ReactNode; empty?: string | null; className?: string }) {
  const [showTable, setShowTable] = useState(false);
  const id = useId();
  return (
    <Card className={cn('flex flex-col', className)}>
      <CardHeader
        title={title}
        description={description}
        actions={
          !empty && (
            <button
              type="button"
              onClick={() => setShowTable((s) => !s)}
              aria-expanded={showTable}
              aria-controls={id}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-subtle hover:bg-surface-hover hover:text-foreground"
            >
              <Table2 className="size-3.5" aria-hidden /> {showTable ? 'Chart' : 'Table'}
            </button>
          )
        }
      />
      <div className="flex-1 p-4">
        {empty ? (
          <EmptyState title={empty} className="py-8" />
        ) : showTable ? (
          <div id={id} className="max-h-80 overflow-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-subtle">
                <tr>
                  {table.columns.map((c, i) => (
                    <th key={c} scope="col" className={cn('pb-2 font-medium', i > 0 && 'text-right')}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {table.rows.map((r, i) => (
                  <tr key={i}>
                    {r.map((cell, j) => (
                      <td key={j} className={cn('py-1.5', j > 0 && 'text-right tabular')}>
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div id={id} role="img" aria-label={`${title}. Use the Table button for the underlying values.`}>
            {children}
          </div>
        )}
      </div>
    </Card>
  );
}

function TooltipBox({ title, rows }: { title: string; rows: { label: string; value: string; color?: string }[] }) {
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-medium">{title}</p>
      {rows.map((r) => (
        <p key={r.label} className="flex items-center gap-2 text-muted">
          {r.color && <span className="size-2 rounded-sm" style={{ background: r.color }} aria-hidden />}
          <span className="flex-1">{r.label}</span>
          <span className="tabular text-foreground">{r.value}</span>
        </p>
      ))}
    </div>
  );
}

const axisTick = { fill: 'var(--subtle)', fontSize: 11 };

/** Horizontal bars for one series: magnitude per category, value at the tip (so no value axis or grid). */
export function BarList({ data, format = (v) => String(v), valueLabel = 'Count', height }: { data: { label: string; value: number }[]; format?: (v: number) => string; valueLabel?: string; height?: number }) {
  const h = height ?? Math.max(120, data.length * 30 + 20);
  return (
    <ResponsiveContainer width="100%" height={h}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 40, bottom: 0, left: 0 }} barCategoryGap={6}>
        <XAxis type="number" hide allowDecimals={false} />
        <YAxis type="category" dataKey="label" width={150} tick={axisTick} tickLine={false} axisLine={false} interval={0} />
        <Tooltip
          cursor={{ fill: 'var(--surface-hover)' }}
          content={({ active, payload }) =>
            active && payload?.length ? <TooltipBox title={String(payload[0].payload.label)} rows={[{ label: valueLabel, value: format(Number(payload[0].value)) }]} /> : null
          }
        />
        <Bar dataKey="value" fill="var(--series-1)" radius={[0, 4, 4, 0]} maxBarSize={18} isAnimationActive={false}>
          <LabelList dataKey="value" position="right" formatter={(v) => format(Number(v))} style={{ fill: 'var(--muted)', fontSize: 11 }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Columns over time; one series, or up to three stacked series with a legend. */
export function Columns({
  data,
  series,
  format = (v) => String(v),
  height = 220,
}: {
  data: Record<string, string | number>[];
  series: { key: string; label: string }[];
  format?: (v: number) => string;
  height?: number;
}) {
  const colors = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)'];
  const stacked = series.length > 1;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -12 }} barCategoryGap="30%">
        <CartesianGrid vertical={false} stroke="var(--grid)" />
        <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: 'var(--border)' }} minTickGap={12} />
        <YAxis tick={axisTick} tickLine={false} axisLine={false} allowDecimals={!data.every((d) => series.every((s) => Number.isInteger(d[s.key])))} tickFormatter={(v) => format(Number(v))} width={52} />
        <Tooltip
          cursor={{ fill: 'var(--surface-hover)' }}
          content={({ active, payload, label }) =>
            active && payload?.length ? (
              <TooltipBox title={String(label)} rows={series.map((s, i) => ({ label: s.label, value: format(Number(payload.find((p) => p.dataKey === s.key)?.value ?? 0)), color: colors[i] }))} />
            ) : null
          }
        />
        {stacked && (
          <Legend
            content={() => (
              <ul className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1 text-[11px] text-muted">
                {series.slice(0, 3).map((s, i) => (
                  <li key={s.key} className="inline-flex items-center gap-1.5">
                    <span className="size-2 rounded-[2px]" style={{ background: colors[i] }} aria-hidden />
                    {s.label}
                  </li>
                ))}
              </ul>
            )}
          />
        )}
        {series.slice(0, 3).map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.label}
            stackId={stacked ? 'a' : undefined}
            fill={colors[i]}
            stroke={stacked ? 'var(--surface)' : undefined}
            strokeWidth={stacked ? 2 : 0}
            radius={!stacked || i === Math.min(series.length, 3) - 1 ? [4, 4, 0, 0] : 0}
            maxBarSize={24}
            isAnimationActive={false}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function StatTile({ label, value, sub, href }: { label: string; value: string; sub?: React.ReactNode; href?: string }) {
  const body = (
    <>
      <p className="text-xs text-subtle">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-subtle">{sub}</p>}
    </>
  );
  return href ? (
    <a href={href} className="block rounded-lg border border-border bg-surface px-4 py-3 transition-colors hover:border-border-strong">
      {body}
    </a>
  ) : (
    <div className="rounded-lg border border-border bg-surface px-4 py-3">{body}</div>
  );
}
