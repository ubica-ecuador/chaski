import React, { useEffect, useRef, useState } from 'react';
import { IconButton, Input } from '@grafana/ui';

const integer = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
export const formatCount = (n: number) => integer.format(n);

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

const DAY_MS = 24 * 60 * 60 * 1000;

/** A bin's ends for the hover readout: dates, a time within a day, or numbers to 3 significant digits. */
export function formatBin(lo: number, hi: number, asTime: boolean): string {
  if (asTime) {
    const iso = (ms: number) => new Date(ms).toISOString();
    if (hi - lo < DAY_MS) {
      return `${iso(lo).slice(0, 10)} ${iso(lo).slice(11, 16)}–${iso(hi).slice(11, 16)}`;
    }
    return `${iso(lo).slice(0, 10)} – ${iso(hi).slice(0, 10)}`;
  }
  const short = (v: number) => String(Number(v.toPrecision(3)));
  return `${short(lo)}–${short(hi)}`;
}

interface SearchProps {
  label: string;
  value: string;
  /** Called as the text changes, a beat after each keystroke. */
  onChange: (value: string) => void;
}

/** A text box: the controls follow it as it is typed; the variable is written once it rests. */
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
    }, 120);
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
