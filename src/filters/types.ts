import type { PlayMode } from './timeline';

export interface FiltersOptions {
  /** The filters variable to show, by name; empty for the dashboard's only one. */
  filters: string;
  /**
   * The Mosaic Selection the controls share; empty for one named after the filters variable. Give it the
   * name a dashboard's Mosaic panels use, and they and the controls filter each other as they move.
   */
  selection: string;
  /**
   * `auto` follows the panel's shape: a sidebar when tall, a row of pills when wide and low. `timeline` draws a
   * range filter over times the width of the panel, with play, and the other filters as pills above it.
   */
  layout: 'auto' | 'sidebar' | 'pills' | 'timeline';
  /** The range filter a timeline draws, by name; empty for the first one over times. */
  timeline: string;
  /** How play moves the timeline's brush: a window of fixed width, or one whose end moves. */
  playMode: PlayMode;
  /** The least time a step of play lasts, in milliseconds; longer while the panels it set off still run. */
  stepMs: number;
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
  timeline: '',
  playMode: 'slide',
  stepMs: 800,
  timeColumn: '',
  noun: 'rows',
  maxValues: 8,
  bins: 40,
};
