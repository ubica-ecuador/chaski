import { parseNumber, parseTime, type RangeFilter } from '../engine/crossfilter';
import type { ValueOf } from './model';

/** The values a variable holds now, as a list: empty, All and blank values dropped. */
export function pickedValues(value: ValueOf, variable: string): string[] {
  const raw = value(variable);
  const list = (Array.isArray(raw) ? raw : raw === undefined ? [] : [raw]).map((v) => String(v).trim());
  return list.includes('$__all') ? [] : list.filter((v) => v !== '');
}

/** A range filter's ends as numbers (epoch milliseconds for times); undefined ends are open. */
export function rangeOf(filter: RangeFilter, value: ValueOf): [number | undefined, number | undefined] {
  const parse = filter.as === 'time' ? parseTime : parseNumber;
  return [parse(pickedValues(value, filter.from)[0] ?? ''), parse(pickedValues(value, filter.to)[0] ?? '')];
}
