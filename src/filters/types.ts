export interface FiltersOptions {
  /** The filters variable to show, by name; empty for the dashboard's only one. */
  filters: string;
  /** `auto` follows the panel's shape: a sidebar when tall, a row of pills when wide and low. */
  layout: 'auto' | 'sidebar' | 'pills';
  /** A time column: when set, every count keeps to the dashboard's time range. */
  timeColumn: string;
  /** What the rows are, for "N of M rows". */
  noun: string;
  /** Values a list shows before "more". */
  maxValues: number;
  /** Bars in a range's histogram. */
  bins: number;
}

export const DEFAULT_OPTIONS: FiltersOptions = {
  filters: '',
  layout: 'auto',
  timeColumn: '',
  noun: 'rows',
  maxValues: 8,
  bins: 40,
};
