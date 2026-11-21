import { useEffect, useMemo, useRef, useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { MonitorSeries, Range } from '../api/types';
import { chartTick, formatDateTime, formatMs } from '../lib/format';

/** Distinct, colour-blind-friendly line colours, assigned to monitors in creation order. */
const PALETTE = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#65a30d', '#ea580c', '#4f46e5'];
const STORAGE_KEY = 'uptimehq.dashboard.hiddenMonitors';

function loadHidden(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

interface TooltipProps {
  active?: boolean;
  label?: string;
  payload?: { dataKey: string; value: number | null; color: string; name: string }[];
}

function ChartTooltip({ active, label, payload }: TooltipProps) {
  if (!active || !payload?.length || !label) return null;
  const rows = payload.filter((p) => p.value != null).sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-time">{formatDateTime(label)}</div>
      {rows.length === 0 ? (
        <div className="muted">No successful checks</div>
      ) : (
        rows.map((p) => (
          <div key={p.dataKey} className="chart-tooltip-row">
            <span className="swatch" style={{ background: p.color }} aria-hidden="true" />
            <span className="chart-tooltip-name">{p.name}</span>
            <strong>{formatMs(p.value)}</strong>
          </div>
        ))
      )}
    </div>
  );
}

/** Response time per monitor, one coloured line each, with a picker for which monitors to show. */
export function MonitorResponseChart({ data, range }: { data: MonitorSeries; range: Range }) {
  // Stored as "hidden" so monitors added later show up by default.
  const [hidden, setHidden] = useState<Set<string>>(loadHidden);
  const [open, setOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...hidden]));
    } catch {
      /* storage unavailable: selection just isn't remembered */
    }
  }, [hidden]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const colors = useMemo(() => new Map(data.monitors.map((m, i) => [m.id, PALETTE[i % PALETTE.length]])), [data.monitors]);
  const selected = data.monitors.filter((m) => !hidden.has(m.id));

  // Start at the first bucket where any selected monitor has data.
  const points = useMemo(() => {
    const ids = selected.map((m) => m.id);
    const first = data.points.findIndex((p) => ids.some((id) => p[id] != null));
    return first > 0 ? data.points.slice(first) : first === -1 ? [] : data.points;
  }, [data.points, selected]);

  const pointCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of selected) counts.set(m.id, points.filter((p) => p[m.id] != null).length);
    return counts;
  }, [points, selected]);

  const toggle = (id: string) =>
    setHidden((h) => {
      const next = new Set(h);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const label =
    selected.length === data.monitors.length ? `All monitors (${data.monitors.length})` : selected.length === 0 ? 'No monitors' : `${selected.length} of ${data.monitors.length} monitors`;

  return (
    <div className="mchart">
      <div className="mchart-toolbar">
        <div className="picker" ref={pickerRef}>
          <button type="button" className="btn btn-secondary btn-sm picker-button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            {label}
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
          {open && (
            <div className="picker-menu" role="listbox" aria-multiselectable="true" aria-label="Monitors to show">
              <div className="picker-actions">
                <button type="button" className="link" onClick={() => setHidden(new Set())}>
                  Select all
                </button>
                <button type="button" className="link" onClick={() => setHidden(new Set(data.monitors.map((m) => m.id)))}>
                  Clear
                </button>
              </div>
              <ul>
                {data.monitors.map((m) => (
                  <li key={m.id}>
                    <label className="picker-option">
                      <input type="checkbox" checked={!hidden.has(m.id)} onChange={() => toggle(m.id)} />
                      <span className="swatch" style={{ background: colors.get(m.id) }} aria-hidden="true" />
                      <span className="picker-name">{m.name}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <ul className="mchart-legend" aria-label="Legend">
          {selected.map((m) => (
            <li key={m.id}>
              <span className="swatch" style={{ background: colors.get(m.id) }} aria-hidden="true" />
              {m.name}
            </li>
          ))}
        </ul>
      </div>

      {selected.length === 0 ? (
        <div className="chart-empty chart-box">Select one or more monitors to show their response times.</div>
      ) : points.length === 0 ? (
        <div className="chart-empty chart-box">No successful checks recorded for the selected monitors in this period yet.</div>
      ) : (
        <div className="chart-box">
          <ResponsiveContainer>
            <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="var(--grid)" vertical={false} />
              <XAxis
                dataKey="timestamp"
                tickFormatter={(v: string) => chartTick(v, range)}
                tick={{ fill: 'var(--text-muted)', fontSize: 12 }}
                axisLine={false}
                tickLine={false}
                minTickGap={28}
              />
              <YAxis tickFormatter={(v: number) => `${v} ms`} tick={{ fill: 'var(--text-muted)', fontSize: 12 }} axisLine={false} tickLine={false} width={64} />
              <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'var(--border-strong)' }} />
              {selected.map((m) => (
                <Line
                  key={m.id}
                  type="monotone"
                  dataKey={m.id}
                  name={m.name}
                  stroke={colors.get(m.id)}
                  strokeWidth={2}
                  connectNulls
                  isAnimationActive={false}
                  // A single point cannot form a line, so show it as a marker.
                  dot={(pointCounts.get(m.id) ?? 0) <= 1 ? { r: 3, fill: colors.get(m.id), strokeWidth: 0 } : false}
                  activeDot={{ r: 4 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
