/**
 * Chart primitives, built to the dataviz method: thin marks with 2px
 * surface gaps, rounded data-ends anchored to the baseline, recessive
 * grid, mono axis labels in muted ink (never series color), legends for
 * >=2 series, per-mark hover tooltips, and reserved status colors for
 * state (verification outcomes, risk buckets) — never as "series 4".
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

const AXIS = 'var(--chart-axis)';
const GRID = 'var(--chart-grid)';

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(560);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 40) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, width };
}

interface TipState {
  x: number;
  y: number;
  content: ReactNode;
}

function useTooltip() {
  const [tip, setTip] = useState<TipState | null>(null);
  const show = (e: { clientX: number; clientY: number }, content: ReactNode) =>
    setTip({ x: e.clientX, y: e.clientY, content });
  const hide = () => setTip(null);
  const node = tip ? (
    <div
      className="chart-tip"
      style={{
        left: Math.min(tip.x + 14, window.innerWidth - 240),
        top: tip.y + 14,
      }}
    >
      {tip.content}
    </div>
  ) : null;
  return { show, hide, node };
}

export interface Series {
  name: string;
  color: string;
  values: number[];
}

/** Grouped column chart over ordered categories (e.g. days). */
export function ColumnChart({
  categories,
  series,
  height = 170,
  formatCategory = (c) => c,
  emptyLabel = 'NO ACTIVITY IN THIS WINDOW',
}: {
  categories: string[];
  series: Series[];
  height?: number;
  formatCategory?: (c: string) => string;
  emptyLabel?: string;
}) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const tooltip = useTooltip();

  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const pad = { l: 30, r: 6, t: 8, b: 22 };
  const plotW = Math.max(60, width - pad.l - pad.r);
  const plotH = height - pad.t - pad.b;
  const n = categories.length;
  const slot = plotW / Math.max(1, n);
  const groupGap = Math.min(10, slot * 0.25);
  const barGap = 2;
  const barW = Math.max(
    2,
    (slot - groupGap - barGap * (series.length - 1)) / Math.max(1, series.length)
  );
  const total = series.flatMap((s) => s.values).reduce((a, b) => a + b, 0);
  const gridLines = [0.5, 1];

  return (
    <div className="chart-block" ref={ref}>
      {series.length >= 2 && (
        <div className="chart-legend">
          {series.map((s) => (
            <span className="li" key={s.name}>
              <span className="sw" style={{ background: s.color }} />
              {s.name}
            </span>
          ))}
        </div>
      )}
      {total === 0 ? (
        <div className="mono-xs faint" style={{ padding: '28px 0', textAlign: 'center' }}>
          {emptyLabel}
        </div>
      ) : (
        <svg width={width} height={height} role="img" aria-label="column chart">
          {gridLines.map((g) => (
            <g key={g}>
              <line
                x1={pad.l}
                x2={pad.l + plotW}
                y1={pad.t + plotH * (1 - g)}
                y2={pad.t + plotH * (1 - g)}
                stroke={GRID}
                strokeWidth={1}
              />
              <text
                x={pad.l - 6}
                y={pad.t + plotH * (1 - g) + 3.5}
                textAnchor="end"
                fontSize={9.5}
                fontFamily="var(--font-mono)"
                fill={AXIS}
              >
                {Math.round(max * g)}
              </text>
            </g>
          ))}
          <line x1={pad.l} x2={pad.l + plotW} y1={pad.t + plotH} y2={pad.t + plotH} stroke="var(--line2)" strokeWidth={1} />
          {categories.map((cat, i) => (
            <g key={cat}>
              {series.map((s, si) => {
                const v = s.values[i] ?? 0;
                const h = v === 0 ? 0 : Math.max(2, (v / max) * plotH);
                const x = pad.l + i * slot + groupGap / 2 + si * (barW + barGap);
                const y = pad.t + plotH - h;
                return (
                  <rect
                    key={s.name}
                    x={x}
                    y={y}
                    width={barW}
                    height={h}
                    rx={Math.min(2, barW / 2)}
                    fill={s.color}
                    opacity={v === 0 ? 0 : 1}
                    onMouseMove={(e) =>
                      tooltip.show(e, (
                        <span>
                          {formatCategory(cat)}
                          <br />
                          {s.name}: <strong>{v}</strong>
                        </span>
                      ))
                    }
                    onMouseLeave={tooltip.hide}
                  />
                );
              })}
              {(n <= 8 || i % Math.ceil(n / 7) === 0) && (
                <text
                  x={pad.l + i * slot + slot / 2}
                  y={height - 6}
                  textAnchor="middle"
                  fontSize={9.5}
                  fontFamily="var(--font-mono)"
                  fill={AXIS}
                >
                  {formatCategory(cat)}
                </text>
              )}
            </g>
          ))}
        </svg>
      )}
      {tooltip.node}
    </div>
  );
}

/** Horizontal category bars with direct labels (identity via text, not color-alone). */
export function RowBars({
  rows,
  emptyLabel = 'NO DATA RECORDED',
}: {
  rows: { label: string; value: number; color: string; note?: string }[];
  emptyLabel?: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const total = rows.reduce((a, r) => a + r.value, 0);
  if (total === 0) {
    return (
      <div className="mono-xs faint" style={{ padding: '22px 0', textAlign: 'center' }}>
        {emptyLabel}
      </div>
    );
  }
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {rows.map((r) => (
        <div key={r.label} style={{ display: 'grid', gap: 4 }}>
          <div className="spread" style={{ gap: 8 }}>
            <span className="mono-xs dim">{r.label}</span>
            <span className="mono-xs" style={{ color: 'var(--ink)' }}>
              {r.value}
              {r.note ? <span className="faint"> {r.note}</span> : null}
            </span>
          </div>
          <div style={{ height: 8, background: 'var(--bg3)', borderRadius: 2, overflow: 'hidden' }}>
            <div
              style={{
                width: `${(r.value / max) * 100}%`,
                minWidth: r.value > 0 ? 3 : 0,
                height: '100%',
                background: r.color,
                borderRadius: 2,
                transition: 'width 400ms ease',
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Block activity strip: one bar per block, single hue (magnitude). */
export function BlockStrip({
  blocks,
}: {
  blocks: { blockNumber: number; txCount: number; timestamp: string }[];
}) {
  const tooltip = useTooltip();
  if (blocks.length === 0) {
    return <div className="mono-xs faint" style={{ padding: '22px 0', textAlign: 'center' }}>NO BLOCKS OBSERVED — IS THE CHAIN RUNNING?</div>;
  }
  const max = Math.max(1, ...blocks.map((b) => b.txCount));
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 88 }}>
        {blocks.map((b) => (
          <div
            key={b.blockNumber}
            style={{
              flex: 1,
              minWidth: 6,
              height: `${Math.max(6, (b.txCount / max) * 100)}%`,
              background: b.txCount > 0 ? 'var(--chart-1)' : 'var(--bg3)',
              borderRadius: 2,
              cursor: 'default',
            }}
            onMouseMove={(e) =>
              tooltip.show(e, (
                <span>
                  BLOCK #{b.blockNumber}
                  <br />
                  {b.txCount} transaction{b.txCount === 1 ? '' : 's'}
                </span>
              ))
            }
            onMouseLeave={tooltip.hide}
          />
        ))}
      </div>
      <div className="spread" style={{ marginTop: 6 }}>
        <span className="mono-xs faint">#{blocks[0]?.blockNumber}</span>
        <span className="mono-xs faint">#{blocks[blocks.length - 1]?.blockNumber}</span>
      </div>
      {tooltip.node}
    </div>
  );
}
