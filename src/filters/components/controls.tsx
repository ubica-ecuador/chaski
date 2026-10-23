import React, { useEffect, useMemo, useRef, useState } from 'react';
import { IconButton, Input } from '@grafana/ui';

import type { FilterDeclaration, RangeFilter } from '../../engine/crossfilter';
import type { Histogram, ValueCount } from '../load';
import type { Styles } from './styles';

/*
 * One control per declared filter. Each shows its own counts under the other
 * filters and calls back with the variables to write; the panel writes them.
 */

const integer = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
export const formatCount = (n: number) => integer.format(n);

/** An axis value: a date (and time when not midnight UTC) for times, 4 significant digits for numbers. */
export function formatValue(value: number, asTime: boolean): string {
  if (asTime) {
    const iso = new Date(value).toISOString();
    return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
  }
  if (value !== 0 && (Math.abs(value) >= 1e6 || Math.abs(value) < 1e-3)) {
    return value.toExponential(2);
  }
  return String(Number(value.toPrecision(4)));
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * A brushed end rounded to what one pixel of the axis can tell apart: to the
 * decimal of a pixel's width for numbers, to the minute, hour or day for
 * times, so the variables read 2.7, not 2.69999957085.
 */
export function roundToAxis(value: number, span: number, pixels: number, asTime: boolean): number {
  const pixel = span / Math.max(1, pixels);
  if (asTime) {
    const unit = pixel < HOUR ? MINUTE : pixel < DAY ? HOUR : DAY;
    return Math.round(value / unit) * unit;
  }
  const decimals = Math.min(10, Math.max(0, Math.ceil(-Math.log10(pixel || 1))));
  return Number(value.toFixed(decimals));
}

interface RangeProps {
  filter: RangeFilter;
  histogram: Histogram | undefined;
  range: [number | undefined, number | undefined];
  width: number;
  styles: Styles;
  onChange: (range: [number, number] | undefined) => void;
}

const HISTOGRAM_HEIGHT = 48;

/** A histogram of the column under the other filters; drag across it to pick a range, click to clear. */
export function RangeControl({ filter, histogram, range, width, styles, onChange }: RangeProps) {
  const asTime = filter.as === 'time';
  const [drag, setDrag] = useState<[number, number]>();
  const svg = useRef<SVGSVGElement>(null);
  if (!histogram) {
    return <div className={styles.note}>No values.</div>;
  }
  const { extent, n } = histogram;
  const span = extent.hi - extent.lo || 1;
  const w = Math.max(60, width);
  const toX = (v: number) => ((v - extent.lo) / span) * w;
  const toValue = (x: number) => extent.lo + (Math.min(Math.max(x, 0), w) / w) * span;
  const max = Math.max(1, ...n);
  const bar = w / n.length;
  const picked: [number, number] | undefined =
    drag ??
    (range[0] !== undefined || range[1] !== undefined ? [range[0] ?? extent.lo, range[1] ?? extent.hi] : undefined);
  const inside = (i: number) => {
    if (!picked) {
      return true;
    }
    const mid = extent.lo + ((i + 0.5) / n.length) * span;
    return mid >= Math.min(...picked) && mid <= Math.max(...picked);
  };
  const xOf = (event: React.PointerEvent) => event.clientX - (svg.current?.getBoundingClientRect().left ?? 0);

  return (
    <div>
      <svg
        ref={svg}
        className={styles.histogram}
        width={w}
        height={HISTOGRAM_HEIGHT}
        role="slider"
        aria-label={`${filter.label ?? filter.name}: drag to pick a range`}
        aria-valuemin={extent.lo}
        aria-valuemax={extent.hi}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          const v = toValue(xOf(event));
          setDrag([v, v]);
        }}
        onPointerMove={(event) => {
          if (drag) {
            setDrag([drag[0], toValue(xOf(event))]);
          }
        }}
        onPointerUp={() => {
          if (!drag) {
            return;
          }
          setDrag(undefined);
          const [a, b] = [Math.min(...drag), Math.max(...drag)];
          // A click, not a drag: clear the range.
          onChange(
            Math.abs(toX(b) - toX(a)) < 3
              ? undefined
              : [roundToAxis(a, span, w, asTime), roundToAxis(b, span, w, asTime)]
          );
        }}
      >
        {n.map((count, i) => {
          const h = count > 0 ? Math.max(1, (count / max) * (HISTOGRAM_HEIGHT - 2)) : 0;
          return (
            <rect
              key={i}
              className={inside(i) ? styles.barIn : styles.barOut}
              x={i * bar + 0.5}
              y={HISTOGRAM_HEIGHT - h}
              width={Math.max(1, bar - 1)}
              height={h}
            />
          );
        })}
        {picked && (
          <rect
            className={styles.brush}
            x={toX(Math.min(...picked))}
            y={0.5}
            width={Math.max(1, toX(Math.max(...picked)) - toX(Math.min(...picked)))}
            height={HISTOGRAM_HEIGHT - 1}
          />
        )}
      </svg>
      <div className={styles.axis}>
        <span>{formatValue(extent.lo, asTime)}</span>
        {picked && (
          <span className={styles.axisPicked}>
            {formatValue(Math.min(...picked), asTime)} – {formatValue(Math.max(...picked), asTime)}
          </span>
        )}
        <span>{formatValue(extent.hi, asTime)}</span>
      </div>
    </div>
  );
}

interface ValuesProps {
  filter: Extract<FilterDeclaration, { type: 'in' | 'equals' }>;
  values: ValueCount[];
  picked: string[];
  maxValues: number;
  styles: Styles;
  onChange: (values: string[]) => void;
}

/** The column's values with their counts: `in` picks several, `equals` one. */
export function ValuesControl({ filter, values, picked, maxValues, styles, onChange }: ValuesProps) {
  const [open, setOpen] = useState(false);
  const [find, setFind] = useState('');
  const shown = useMemo(() => {
    const needle = find.trim().toLowerCase();
    const matching = needle ? values.filter((v) => v.value.toLowerCase().includes(needle)) : values;
    return open || needle ? matching : matching.slice(0, maxValues);
  }, [values, find, open, maxValues]);
  if (values.length === 0) {
    return <div className={styles.note}>No values.</div>;
  }
  const max = Math.max(1, ...values.map((v) => v.n));
  const toggle = (value: string) => {
    const on = picked.includes(value);
    if (filter.type === 'equals') {
      onChange(on ? [] : [value]);
    } else {
      onChange(on ? picked.filter((v) => v !== value) : [...picked, value]);
    }
  };
  return (
    <div className={styles.values}>
      {values.length > maxValues && (
        <Input
          placeholder="Find a value"
          value={find}
          onChange={(event) => setFind(event.currentTarget.value)}
          aria-label={`Find a value of ${filter.label ?? filter.name}`}
        />
      )}
      {shown.map((v) => {
        const on = picked.includes(v.value);
        return (
          <button
            key={v.value}
            type="button"
            className={`${styles.valueRow} ${v.n === 0 && !on ? styles.dim : ''}`}
            aria-pressed={on}
            onClick={() => toggle(v.value)}
          >
            <span className={styles.valueBar} style={{ width: `${(v.n / max) * 100}%` }} />
            <span className={`${styles.valueMark} ${on ? styles.valueMarkOn : ''}`} />
            <span className={styles.valueLabel} title={v.value}>
              {v.value}
            </span>
            <span className={styles.valueCount}>{formatCount(v.n)}</span>
          </button>
        );
      })}
      {!find && values.length > maxValues && (
        <button type="button" className={styles.more} onClick={() => setOpen(!open)}>
          {open ? 'Fewer' : `${values.length - maxValues} more`}
        </button>
      )}
    </div>
  );
}

interface SearchProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
}

/** A text box; it writes its variable once typing pauses. */
export function SearchControl({ label, value, onChange }: SearchProps) {
  const [text, setText] = useState(value);
  const last = useRef(value);
  // Follow the variable when something else sets it (a chip's ×, Clear all).
  useEffect(() => {
    if (value !== last.current) {
      last.current = value;
      setText(value);
    }
  }, [value]);
  useEffect(() => {
    if (text === last.current) {
      return;
    }
    const timer = setTimeout(() => {
      last.current = text;
      onChange(text);
    }, 400);
    return () => clearTimeout(timer);
  }, [text, onChange]);
  return (
    <Input
      placeholder="Contains…"
      value={text}
      aria-label={`Search ${label}`}
      onChange={(event) => setText(event.currentTarget.value)}
      suffix={
        text ? (
          <IconButton name="times" size="sm" aria-label={`Clear ${label}`} onClick={() => setText('')} />
        ) : undefined
      }
    />
  );
}
