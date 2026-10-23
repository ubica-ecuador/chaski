export interface FiltersOptions {
  /** The filters variable to show, by name; empty for the dashboard's only one. */
  filters: string;
  /**
   * The Mosaic Selection the controls share; empty for one named after the filters variable. Give it the
   * name a dashboard's Mosaic panels use, and they and the controls filter each other as they move.
   */
  selection: string;
  /** `auto` follows the panel's shape: a sidebar when tall, a row of pills when wide and low. */
  layout: 'auto' | 'sidebar' | 'pills';
  /** A time column: when set, every count keeps to the dashboard's time range. */
  timeColumn: string;
  /** What the rows are, for "N of M rows". */
  noun: string;
  /** The most frequent values a list shows. */
  maxValues: number;
  /** Bars in a range's histogram. */
  bins: number;
}

export const DEFAULT_OPTIONS: FiltersOptions = {
  filters: '',
  selection: '',
  layout: 'auto',
  timeColumn: '',
  noun: 'rows',
  maxValues: 8,
  bins: 40,
};
