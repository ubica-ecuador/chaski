import { locationService } from '@grafana/runtime';

/*
 * The panel sets filters the way every other panel does: by writing the
 * variables they read, in the URL, where the template service follows.
 * Values are written in the shapes the filters parse back: numbers to 12
 * significant digits, times as UTC ISO strings.
 */

export type VariableWrites = Record<string, string | string[]>;

/** A range end: empty for an open end. */
export function formatEnd(value: number | undefined, asTime: boolean): string {
  if (value === undefined || !Number.isFinite(value)) {
    return '';
  }
  return asTime ? new Date(Math.round(value)).toISOString() : String(Number(value.toPrecision(12)));
}

export const clearing = (variables: string[]): VariableWrites => Object.fromEntries(variables.map((v) => [v, '']));

export function rangeWrites(
  from: string,
  to: string,
  range: [number, number] | undefined,
  asTime: boolean
): VariableWrites {
  return range ? { [from]: formatEnd(range[0], asTime), [to]: formatEnd(range[1], asTime) } : clearing([from, to]);
}

/** A multi-value variable: the picked values, or empty for none. */
export const valuesWrites = (variable: string, values: string[]): VariableWrites => ({
  [variable]: values.length ? values : '',
});

/** Writes the variables into the URL, replacing the entry: a filter change is not a page to go back to. */
export function writeVariables(writes: VariableWrites): void {
  const update = Object.fromEntries(Object.entries(writes).map(([name, value]) => [`var-${name}`, value]));
  locationService.partial(update, true);
}
