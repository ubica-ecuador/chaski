import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { GrafanaTheme2, PanelProps } from '@grafana/data';
import { getAppEvents, getTemplateSrv, locationService } from '@grafana/runtime';
import { IconButton, Toggletip, useStyles2, useTheme2 } from '@grafana/ui';
import type { Logger } from '@uwdata/mosaic-core';
import { tableFromIPC } from 'apache-arrow';

import { type Clause, type DeclaredDataset, type FilterDeclaration, filterStates } from '../../engine/crossfilter';
import { quoteIdent } from '../../engine/sql';
import { DuckdbWasmActivityEvent } from '../../grafana/activity';
import { rawValue } from '../../grafana/interpolate';
import type { ChaskiEngineApi } from '../../grafana/publicApi';
import type { VariableLink } from '../../mosaic/bridge';
import { waitForEngine } from '../../mosaic/connector';
import type { VariableRead } from '../../mosaic/inbound';
import { crossfilterSource, filtersVariables, pickVariable, urlFirst, type ValueOf } from '../model';
import { countSql, timeCondition } from '../queries';
import { allOf, controlLinks, labelWidth, rangeSpec, type ValueFilter, valuesSpec } from '../specs';
import type { IntervalInteractor, ToggleInteractor } from '../sync';
import { loadMosaic } from '../runtime';
import {
  type ActivityState,
  nextWindow,
  play,
  type Player,
  type PlayMode,
  previousWindow,
  startWindow,
  stepOf,
  timelineFilter,
  timelineSpec,
  type Window,
  formatWindow,
} from '../timeline';
import { DEFAULT_OPTIONS, type FiltersOptions } from '../types';
import { pickedValues, rangeOf } from '../values';
import { clearing, writeVariables } from '../writes';
import { formatBin, formatCount, roundToAxis, SearchControl } from './controls';
import { getStyles, type Styles } from './styles';
import { Transport } from './Transport';

/** The dashboard's filters as they stand: the dataset, its filters' states, the variables' values. */
type Resolved =
  | { kind: 'message'; text: string }
  | { kind: 'error'; text: string }
  | { kind: 'resolved'; variable: string; dataset: DeclaredDataset; states: Clause[]; value: ValueOf };

/** A control drawn by Mosaic, with play when it is the timeline; or the search box the panel draws itself. */
type Control =
  | { kind: 'mosaic'; element: HTMLElement; player?: Player }
  | { kind: 'search'; set: (text: string) => void }
  | { kind: 'none' };

type Build =
  | { kind: 'starting' }
  | { kind: 'message'; text: string }
  | { kind: 'error'; text: string }
  | { kind: 'ready'; dataset: DeclaredDataset; controls: Map<string, Control>; timeline?: string };

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
const isCancel = (message: string) => /abort|cancel|^\s*cleared\b/i.test(message);

const currentValues = (): ValueOf =>
  urlFirst(new URLSearchParams(locationService.getLocation().search), (name) => rawValue(getTemplateSrv(), name));

/** The dashboard's filters variable, its dataset and its filters, read now; nothing is queried. */
export function resolveFilters(engine: ChaskiEngineApi, variableName: string): Resolved {
  const value = currentValues();
  try {
    const variables = filtersVariables(getTemplateSrv().getVariables() as unknown[]);
    const chosen = pickVariable(variables, variableName);
    if (!chosen) {
      return {
        kind: 'message',
        text: variables.length
          ? `Pick the filters variable to show: this dashboard has ${variables.map((v) => v.name).join(', ')}.`
          : 'This dashboard declares no filters. Add a Chaski variable of kind filters for a dataset.',
      };
    }
    const loaded = engine.datasets();
    const table = value(chosen.dataset);
    const state = loaded.find((d) => d.table === table);
    const source = crossfilterSource(variables, loaded, value);
    const dataset = state ? source.dataset(state.name) : undefined;
    if (!dataset) {
      return { kind: 'message', text: `Waiting for the dataset ${chosen.dataset} to load…` };
    }
    return { kind: 'resolved', variable: chosen.name, dataset, states: filterStates(dataset, source), value };
  } catch (error) {
    return { kind: 'error', text: messageOf(error) };
  }
}

/** The variables a filter reads, which the panel writes for it. */
const variablesOf = (filter: FilterDeclaration): string[] =>
  filter.type === 'range' ? [filter.from, filter.to] : filter.type === 'link' ? [] : [filter.variable];

/** Sidebar when the panel is tall enough for sections, pills when it is a strip. */
export const layoutFor = (layout: FiltersOptions['layout'], height: number) =>
  layout === 'auto' ? (height < 160 ? 'pills' : 'sidebar') : layout;

const POPOVER_WIDTH = 300;
/**
 * The timeline's bar of buttons and pills, above its histogram: one row, whose pills scroll sideways rather
 * than wrap, so the histogram never has to be drawn again as the bar's content changes.
 */
const TIMELINE_BAR_HEIGHT = 32;
/** Between the bar and the histogram. */
const TIMELINE_GAP = 4;
/** A step of play outlasts the bridge's rest, or the URL it writes would pull the brush back a step. */
const MIN_STEP_MS = 400;

/** Chaski's busy and settled, from Grafana's event bus. */
const listenActivity = (listener: (state: ActivityState) => void) => {
  const subscription = getAppEvents().subscribe(DuckdbWasmActivityEvent, (event) => listener(event.payload.state));
  return () => subscription.unsubscribe();
};

/** Play, pause and a step either way, on the timeline's brush; each step draws the panel again. */
function usePlayback(player: Player | undefined, mode: PlayMode, ms: number) {
  const [playing, setPlaying] = useState(false);
  const [, setMoves] = useState(0);
  const abort = useRef<AbortController | undefined>(undefined);
  const pause = useCallback(() => {
    abort.current?.abort();
    abort.current = undefined;
    setPlaying(false);
  }, []);
  // A brush drawn again is another brush: play stops with the old one.
  useEffect(() => pause, [player, pause]);
  const moving = useCallback(
    (window: Window | undefined) => {
      if (player && window) {
        player.set(window);
        setMoves((n) => n + 1);
      }
    },
    [player]
  );
  const toggle = useCallback(() => {
    if (abort.current) {
      pause();
      return;
    }
    if (!player) {
      return;
    }
    const controller = new AbortController();
    abort.current = controller;
    setPlaying(true);
    play({ ...player, set: moving }, mode, Math.max(MIN_STEP_MS, ms), listenActivity, controller.signal)
      .catch((error: unknown) => console.warn('Chaski filters: play stopped', error))
      .finally(() => {
        if (abort.current === controller) {
          abort.current = undefined;
          setPlaying(false);
        }
      });
  }, [player, mode, ms, moving, pause]);
  const forward = useCallback(() => {
    if (!player) {
      return;
    }
    const held = player.held();
    const [domain, step] = [player.domain(), player.step()];
    moving(held ? nextWindow(domain, held, step, mode) : startWindow(domain, step, mode));
  }, [player, mode, moving]);
  const back = useCallback(() => {
    const held = player?.held();
    if (player && held) {
      moving(previousWindow(player.domain(), held, player.step(), mode));
    }
  }, [player, mode, moving]);
  return { playing, toggle, pause, forward, back };
}

function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

function quietLogger(onError: (message: string) => void): Logger {
  const quiet = () => {};
  return {
    debug: quiet,
    info: quiet,
    log: quiet,
    group: quiet,
    groupCollapsed: quiet,
    groupEnd: quiet,
    warn: (...args: unknown[]) => console.warn('Chaski filters:', ...args),
    error: (...args: unknown[]) => {
      const message = messageOf(args.find((arg) => arg instanceof Error) ?? args[0]);
      if (!isCancel(message)) {
        console.error('Chaski filters:', ...args);
        onError(message);
      }
    },
  };
}

/** Grafana's classic hues, one per filter in declaration order, so a chip and its control share a colour. */
const HUES = ['blue', 'orange', 'green', 'purple', 'yellow', 'red', 'light-blue', 'light-orange', 'light-green'];

export const filterColours = (theme: GrafanaTheme2, count: number): string[] =>
  Array.from({ length: count }, (_, i) => theme.visualization.getColorByName(HUES[i % HUES.length]));

const mutedOf = (theme: GrafanaTheme2) => (theme.isDark ? 'rgba(204, 204, 220, 0.16)' : 'rgba(36, 41, 46, 0.12)');

/** An id an SVG gradient can carry: React's ids hold colons. */
const gradientId = (base: string, index: number, axis: 'x' | 'y') => `${base.replace(/[^\w-]/g, '')}-${index}-${axis}`;

type Row = Record<string, unknown>;
const rowsOf = (ipc: Uint8Array): Row[] =>
  tableFromIPC(ipc)
    .toArray()
    .map((row) => row.toJSON() as Row);
const num = (value: unknown) => (typeof value === 'bigint' ? Number(value) : Number(value ?? 0));

export function FiltersPanel({ options: given, width, height, timeRange }: PanelProps<FiltersOptions>) {
  const options = { ...DEFAULT_OPTIONS, ...given };
  const styles = useStyles2(getStyles);
  const theme = useTheme2();
  const [build, setBuild] = useState<Build>({ kind: 'starting' });
  // The filters' states, read again whenever a variable changes: the chips and section titles.
  const [resolved, setResolved] = useState<Resolved>();
  // Rows left under every filter, live while a control moves; and in the time range.
  const [shown, setShown] = useState<number>();
  const [total, setTotal] = useState<number>();
  // Per active filter, the rows with it left out: one that takes none away is not shown as set.
  const [without, setWithout] = useState<Record<string, number>>({});
  const [problem, setProblem] = useState<string>();
  // The bin under the pointer in a histogram: shown where the filter's value goes, not over the bars.
  const [hover, setHover] = useState<{ name: string; text: string }>();
  const [rebuild, setRebuild] = useState(0);

  const layout = layoutFor(options.layout, height);
  const controlWidth = useDebounced(layout === 'pills' ? POPOVER_WIDTH - 16 : Math.max(120, width - 20), 150);
  // In the timeline layout only the timeline spans the panel: the other filters open in popovers.
  const popoverWidth = layout === 'timeline' ? POPOVER_WIDTH - 16 : controlWidth;
  // The timeline's histogram takes the panel's height under its bar; the other layouts keep theirs.
  const timelineHeight = useDebounced(layout === 'timeline' ? height - TIMELINE_BAR_HEIGHT - TIMELINE_GAP : 0, 150);
  const { filters: variableName, selection: selectionName, timeColumn, maxValues, bins } = options;
  const timelineName = layout === 'timeline' ? options.timeline : undefined;
  const from = timeRange.from.valueOf();
  const to = timeRange.to.valueOf();
  // The time range reaches the built controls as a clause, not as a rebuild.
  const timeNow = useRef({ from, to });
  const setTime = useRef<(range: { from: number; to: number }) => void>(undefined);
  useEffect(() => {
    timeNow.current = { from, to };
    setTime.current?.({ from, to });
  }, [from, to]);
  const muted = mutedOf(theme);
  const textColour = theme.colors.text.secondary;
  const gradients = useId();
  // The filters' count is only known once built; enough colours for any dashboard's filters.
  const colours = filterColours(theme, HUES.length);
  const colourKey = colours.join(',');

  // The chips, the section titles and the narrowing counts follow the URL.
  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let engine: ChaskiEngineApi | undefined;
    const read = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!engine) {
          return;
        }
        const next = resolveFilters(engine, variableName);
        setResolved(next);
        if (next.kind !== 'resolved') {
          return;
        }
        const sql = countSql(next.dataset.table, next.states, timeCondition(timeColumn, from, to));
        engine
          .queryIPC(sql, { consumer: 'panel', signal: abort.signal })
          .then((ipc) => {
            const [row = {}] = rowsOf(ipc);
            setTotal(num(row.total));
            setWithout(
              Object.fromEntries(
                next.states.filter((s) => s.sql !== undefined).map((s) => [s.name, num(row[`without_${s.name}`])])
              )
            );
          })
          .catch(() => {});
      }, 30);
    };
    const unlisten = locationService.getHistory().listen(read);
    let off: (() => void) | undefined;
    waitForEngine(abort.signal).then(
      (found) => {
        engine = found;
        off = found.onChange(read);
        read();
      },
      () => {}
    );
    return () => {
      abort.abort();
      clearTimeout(timer);
      unlisten();
      off?.();
    };
  }, [variableName, timeColumn, from, to]);

  // The controls: drawn by Mosaic, again when the panel's shape or the data change.
  useEffect(() => {
    const abort = new AbortController();
    const alive = () => !abort.signal.aborted;
    const cleanups: Array<() => void> = [];
    const defer = (cleanup: () => void) => (alive() ? cleanups.push(cleanup) : cleanup());
    let drawn = false;
    const reportError = (message: string) => {
      if (!alive()) {
        return;
      }
      if (drawn) {
        setProblem(message);
      } else {
        setBuild({ kind: 'error', text: message });
      }
    };

    const run = async () => {
      const [engine, mosaic] = await Promise.all([waitForEngine(abort.signal), loadMosaic()]);
      const {
        Coordinator,
        Selection,
        isSelection,
        makeClient,
        Query,
        count,
        astToDOM,
        parseSpec,
        createAPIContext,
        ChaskiConnector,
        unreadable,
        pageFor,
        dashboardKey,
        releaseClauses,
        PREAGG_SCHEMA,
        linkVariables,
        linkReads,
      } = mosaic;
      const { applyRange, applyValues, heldElsewhere, mirrorClauses, pixelOf, rangeMatches, searchClause } =
        mosaic.sync;
      const { spanOf, timeClause, valuesMatch, binAt, linkBrush, clearColumn } = mosaic.sync;
      const page = pageFor(dashboardKey(), engine);
      defer(page.subscribe(() => setRebuild((n) => n + 1)));
      let waiting = false;
      defer(
        engine.onChange((event) => {
          if (event.kind === 'dataset' && waiting) {
            setRebuild((n) => n + 1);
          }
        })
      );

      const state = resolveFilters(engine, variableName);
      if (state.kind !== 'resolved') {
        waiting = true;
        setBuild(state.kind === 'error' ? { kind: 'error', text: state.text } : { kind: 'message', text: state.text });
        return;
      }
      const { dataset } = state;
      if ((await unreadable(engine, [dataset.name], abort.signal)).length > 0) {
        waiting = true;
        setBuild({ kind: 'message', text: `Waiting for the dataset ${dataset.name} to load…` });
        return;
      }
      const timeline = timelineName === undefined ? undefined : timelineFilter(dataset.filters, timelineName);
      if (timelineName !== undefined && !timeline) {
        setBuild({
          kind: 'message',
          text: timelineName.trim()
            ? `The timeline draws a range filter: ${dataset.name} has none named ${timelineName.trim()}.`
            : `The timeline draws a range filter over times: ${dataset.name} has none. Name a range filter in Timeline filter.`,
        });
        return;
      }
      const selection = selectionName.trim() || state.variable;

      const coordinator = new Coordinator(new ChaskiConnector(engine, {}), {
        logger: quietLogger(reportError),
        // Off until the controls have read their columns: a brush elsewhere would otherwise pre-aggregate them
        // before a histogram knows its column is a time, and bin it as a number.
        preagg: { schema: PREAGG_SCHEMA, enabled: false },
      });
      const api = createAPIContext({ coordinator, namedPlots: page.namedPlots as never });
      page.namedPlots ??= api.context.namedPlots;
      defer(() => {
        releaseClauses(page, coordinator.clients);
        coordinator.clear();
      });

      const view = `datasets.${quoteIdent(dataset.name)}`;
      const query = async (sql: string) => rowsOf(await engine.queryIPC(sql, { signal: abort.signal }));
      const draw = async (spec: object) => {
        const before = new Set(coordinator.clients);
        const { element } = await astToDOM(parseSpec(spec as never), { api, params: page.params as never });
        const added = [...coordinator.clients].filter((c) => !before.has(c));
        const interactors = new Set<unknown>(
          added.flatMap((c) => (c as { plot?: { interactors?: unknown[] } }).plot?.interactors ?? [])
        );
        return { element: element as HTMLElement, interactors: [...interactors] };
      };
      const isObject = (i: unknown): i is object => typeof i === 'object' && i !== null;

      // The coloured layers filter on a mirror of the crossfilter Selection that keeps every clause.
      if (!page.params.has(allOf(selection))) {
        page.params.set(allOf(selection), Selection.intersect());
      }
      const widthOf = (filter: unknown) => (filter === timeline ? controlWidth : popoverWidth);
      const lookOf = (index: number, axis: 'x' | 'y', width: number) => {
        const colour = colourKey.split(',')[index % HUES.length];
        return {
          colour,
          paint: `url(#${gradientId(gradients, index, axis)})`,
          muted,
          text: textColour,
          width,
        };
      };
      const controls = new Map<string, Control>();
      const intervals = new Map<string, IntervalInteractor>();
      const toggles = new Map<string, ToggleInteractor[]>();
      const searches = new Map<string, { source: object; text: string }>();
      for (const [index, filter] of dataset.filters.entries()) {
        if (filter.type === 'range') {
          const look = lookOf(index, 'y', widthOf(filter));
          const { element, interactors } = await draw(
            filter === timeline
              ? timelineSpec(dataset.name, filter, selection, bins, look, timelineHeight)
              : rangeSpec(dataset.name, filter, selection, bins, look)
          );
          const interval = interactors.find((i) => isObject(i) && 'brush' in i) as IntervalInteractor | undefined;
          let player: Player | undefined;
          if (interval) {
            intervals.set(filter.name, interval);
            const asTime = filter.as === 'time';
            if (filter === timeline) {
              const ends = (values: unknown[] | undefined): Window | undefined => {
                const [a, b] = (values ?? []).map((v) => (v instanceof Date ? v.getTime() : Number(v)));
                return Number.isFinite(a) && Number.isFinite(b) ? [Math.min(a, b), Math.max(a, b)] : undefined;
              };
              const domain = () => ends(interval.scale?.domain) ?? [0, 0];
              player = {
                domain,
                step: () => stepOf(interval.mark, domain(), bins),
                held: () => ends(interval.value),
                // As a drag: the clause goes to the Selection, linked brushes follow, the bridge writes it.
                set: (window) => void applyRange(interval, window),
                settled: async () => {
                  await Promise.all([...coordinator.clients].map((c) => c.pending));
                },
              };
            }
            const read = (event: PointerEvent) => {
              const svg = element.querySelector('svg');
              const at = svg && interval.scale?.invert?.(event.clientX - svg.getBoundingClientRect().left);
              const bin = at === undefined || at === null ? undefined : binAt(interval.mark as never, Number(at));
              setHover(
                bin
                  ? { name: filter.name, text: `${formatBin(bin.lo, bin.hi, asTime)} · ${formatCount(bin.count)}` }
                  : undefined
              );
            };
            const leave = () => setHover(undefined);
            element.addEventListener('pointermove', read);
            element.addEventListener('pointerleave', leave);
            defer(() => {
              element.removeEventListener('pointermove', read);
              element.removeEventListener('pointerleave', leave);
            });
          }
          controls.set(filter.name, { kind: 'mosaic', element, player });
        } else if (filter.type === 'in' || filter.type === 'equals') {
          const top = await query(
            `SELECT CAST(${quoteIdent(filter.column)} AS VARCHAR) AS v FROM ${view} ` +
              `WHERE ${quoteIdent(filter.column)} IS NOT NULL GROUP BY 1 ORDER BY count(*) DESC LIMIT ${maxValues}`
          );
          const labels = top.map((r) => String(r.v));
          const spec = valuesSpec(
            dataset.name,
            filter as ValueFilter,
            selection,
            labels,
            labelWidth(labels, widthOf(filter)),
            lookOf(index, 'x', widthOf(filter))
          );
          const { element, interactors } = await draw(spec);
          toggles.set(
            filter.name,
            interactors.filter((i): i is ToggleInteractor => isObject(i) && 'fields' in i && 'listMatch' in i)
          );
          controls.set(filter.name, { kind: 'mosaic', element });
        } else if (filter.type === 'search') {
          const source = { filter: filter.name };
          searches.set(filter.name, { source, text: '' });
          controls.set(filter.name, {
            kind: 'search',
            set: (text) => {
              searches.set(filter.name, { source, text });
              (page.params.get(selection) as InstanceType<typeof Selection>).update(
                searchClause(source, filter.column, text)
              );
            },
          });
        } else {
          controls.set(filter.name, { kind: 'none' });
        }
        if (!alive()) {
          return;
        }
      }
      page.read([dataset.name], engine.datasets());

      const shared = page.params.get(selection);
      const all = page.params.get(allOf(selection));
      if (!shared || !isSelection(shared) || !all || !isSelection(all)) {
        throw new Error(`The filters panel's selection ${selection} is a param elsewhere on this dashboard`);
      }
      defer(mirrorClauses(shared, all));
      // Brushes on the same column elsewhere (a Mosaic panel's histogram) and these move together.
      for (const filter of dataset.filters) {
        const interval = filter.type === 'range' ? intervals.get(filter.name) : undefined;
        if (interval && filter.type === 'range') {
          defer(linkBrush(shared, interval, filter.column));
        }
      }

      // The rows left, live: a client of the Selection like the controls, but owning no clause.
      const counter = makeClient({
        coordinator,
        selection: shared,
        query: (filter) => Query.from(dataset.name).select({ n: count() }).where(filter),
        queryResult: (data) => {
          const [row] = (data as { toArray(): Row[] }).toArray();
          if (alive()) {
            setShown(num(row?.n));
          }
        },
      });
      defer(() => counter.destroy());

      // Areas drawn on a map come in from their variables.
      const reads: VariableRead[] = dataset.filters
        .filter((f): f is Extract<FilterDeclaration, { type: 'area' }> => f.type === 'area')
        .map((f) => ({ param: selection, column: [f.lng, f.lat], area: f.variable }));
      defer(linkReads(reads, page.params));

      // From the URL to the controls: now, and whenever a variable changes. A value another source on the
      // Selection already holds (another filters panel, a Mosaic panel's brush) is left to it.
      const own = new Set<unknown>([
        ...intervals.values(),
        ...[...toggles.values()].flat(),
        ...[...searches.values()].map((s) => s.source),
      ]);
      // Only a filter whose own variables changed in the URL is applied: another variable changing must not
      // undo a brush or a search still within its rest, not yet written.
      const seen = new Map<string, string>();
      const sync = () => {
        const value = currentValues();
        for (const filter of dataset.filters) {
          const key = JSON.stringify(variablesOf(filter).map((name) => value(name) ?? ''));
          if (seen.get(filter.name) === key) {
            continue;
          }
          seen.set(filter.name, key);
          if (filter.type === 'range') {
            const interval = intervals.get(filter.name);
            if (!interval) {
              continue;
            }
            const range = rangeOf(filter, value);
            const set = range[0] !== undefined || range[1] !== undefined;
            if (set && heldElsewhere(shared, own, filter.column, (v) => rangeMatches(v, range, spanOf(interval)))) {
              // Another brush on this column holds it: the linked brushes show it here.
              continue;
            }
            if (!set) {
              // Cleared in the URL: wherever its brush was drawn.
              clearColumn(shared, filter.column);
            }
            applyRange(interval, range);
          } else if (filter.type === 'in' || filter.type === 'equals') {
            const values = pickedValues(value, filter.variable);
            const elsewhere =
              values.length > 0 && heldElsewhere(shared, own, filter.column, (v) => valuesMatch(v, values));
            applyValues(toggles.get(filter.name) ?? [], elsewhere ? [] : values);
          } else if (filter.type === 'search') {
            const text = pickedValues(value, filter.variable)[0] ?? '';
            const held = searches.get(filter.name);
            const elsewhere =
              text !== '' &&
              heldElsewhere(shared, own, filter.column, (v) => String(v).toLowerCase() === text.toLowerCase());
            const wanted = elsewhere ? '' : text;
            if (held && held.text !== wanted) {
              searches.set(filter.name, { ...held, text: wanted });
              shared.update(searchClause(held.source, filter.column, wanted));
            }
          }
        }
      };
      // A brush needs its axis: let the controls draw before setting them.
      await Promise.all([...coordinator.clients].map((c) => c.pending)).catch(() => {});
      if (!alive()) {
        return;
      }
      coordinator.preaggregator.enabled = true;

      // The dashboard's time range, as a clause no control owns: set once the controls have their axes, and
      // replaced in place when the range changes, without drawing the controls again.
      if (timeColumn.trim()) {
        const source = { time: true };
        const set = (range: { from: number; to: number }) => {
          shared.update(timeClause(source, timeColumn.trim(), range.from, range.to));
        };
        set(timeNow.current);
        setTime.current = set;
        defer(() => {
          setTime.current = undefined;
          shared.reset(shared.clauses.filter((clause) => clause.source === source));
        });
      }
      sync();

      // From the controls to the variables, once they rest; a range's ends rounded to a pixel of its axis.
      const links: VariableLink[] = controlLinks(dataset.filters, selection).map((link) => {
        const filter = dataset.filters.find((f) => f.type === 'range' && f.column === link.column);
        const interval = filter ? intervals.get(filter.name) : undefined;
        if (!filter || filter.type !== 'range' || !interval) {
          return link;
        }
        const asTime = filter.as === 'time';
        return {
          ...link,
          round: (end: unknown) => {
            const ms = end instanceof Date ? end.getTime() : Number(end);
            const pixel = pixelOf(interval);
            const rounded = pixel > 0 ? roundToAxis(ms, pixel, 1, asTime) : ms;
            return end instanceof Date ? new Date(rounded) : rounded;
          },
        };
      });
      // This panel writes what its own controls did; a brush drawn in another panel is that panel's to write.
      const unlink = linkVariables(links, page.params, (clause) => own.has(clause.source));
      defer(() => unlink(false));
      defer(locationService.getHistory().listen(sync));

      drawn = true;
      setBuild({ kind: 'ready', dataset, controls, timeline: timeline?.name });
    };

    run().catch((error: unknown) => {
      const text = messageOf(error);
      if (alive() && !isCancel(text)) {
        setBuild({ kind: 'error', text });
      }
    });
    return () => {
      abort.abort();
      cleanups.forEach((cleanup) => cleanup());
      setProblem(undefined);
    };
  }, [
    variableName,
    selectionName,
    timeColumn,
    maxValues,
    bins,
    controlWidth,
    popoverWidth,
    timelineName,
    timelineHeight,
    muted,
    textColour,
    gradients,
    colourKey,
    rebuild,
  ]);

  if (build.kind === 'starting') {
    return <div className={styles.message}>Waiting for Chaski…</div>;
  }
  if (build.kind === 'message') {
    return <div className={styles.message}>{build.text}</div>;
  }
  if (build.kind === 'error') {
    return (
      <div className={styles.error} data-testid="filters-error">
        {build.text}
      </div>
    );
  }
  const view: ViewProps = {
    dataset: build.dataset,
    controls: build.controls,
    states: resolved?.kind === 'resolved' ? resolved.states : [],
    value: resolved?.kind === 'resolved' ? resolved.value : () => undefined,
    shown,
    total,
    without,
    options,
    styles,
    colours,
    hover,
    timeline: build.timeline,
  };
  return (
    <>
      <svg className={styles.defs} aria-hidden>
        <defs>
          {colours.map((colour, i) => (
            <React.Fragment key={i}>
              <linearGradient id={gradientId(gradients, i, 'y')} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={colour} stopOpacity={1} />
                <stop offset="1" stopColor={colour} stopOpacity={0.55} />
              </linearGradient>
              <linearGradient id={gradientId(gradients, i, 'x')} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor={colour} stopOpacity={0.55} />
                <stop offset="1" stopColor={colour} stopOpacity={1} />
              </linearGradient>
            </React.Fragment>
          ))}
        </defs>
      </svg>
      {problem && (
        <div className={styles.error} data-testid="filters-error">
          {problem}
        </div>
      )}
      {view.timeline !== undefined ? (
        <Timeline {...view} />
      ) : layout === 'pills' ? (
        <Pills {...view} />
      ) : (
        <Sidebar {...view} />
      )}
    </>
  );
}

interface ViewProps {
  dataset: DeclaredDataset;
  controls: Map<string, Control>;
  states: Clause[];
  value: ValueOf;
  shown?: number;
  total?: number;
  without: Record<string, number>;
  options: FiltersOptions;
  styles: Styles;
  /** One per filter, in declaration order. */
  colours: string[];
  /** The bin under the pointer, by filter. */
  hover?: { name: string; text: string };
  /** The filter drawn as the timeline, in that layout. */
  timeline?: string;
}

/** A filter is shown as set when it is, and leaving it out would show more rows. */
const narrows = (view: ViewProps, state: Clause) =>
  state.sql !== undefined && (view.without[state.name] === undefined || view.without[state.name] !== view.shown);

/** A number that eases to each new value instead of jumping. */
function useEased(target: number | undefined, ms = 280): number | undefined {
  const [shownValue, setShownValue] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    if (target === undefined) {
      return;
    }
    const start = from.current ?? target;
    const began = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - began) / ms);
      const eased = 1 - Math.pow(1 - t, 3);
      const value = start + (target - start) * eased;
      from.current = value;
      setShownValue(value);
      if (t < 1) {
        frame = requestAnimationFrame(step);
      }
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, ms]);
  return shownValue;
}

function Count({ shown, total, options, styles, wide }: ViewProps & { wide?: boolean }) {
  // Room for the count at its largest, "50,000 of 50,000 rows 100%", so nothing beside it moves.
  const widest = `${formatCount(total ?? 0)} of ${formatCount(total ?? 0)} ${options.noun} 100%`.length;
  const eased = useEased(shown);
  const show = (n?: number) => (n === undefined ? '…' : formatCount(Math.round(n)));
  const share = shown === undefined || total === undefined ? undefined : total > 0 ? Math.min(1, shown / total) : 0;
  const percent =
    share === undefined
      ? ''
      : share === 1
        ? '100%'
        : share >= 0.1
          ? `${(share * 100).toFixed(0)}%`
          : `${(share * 100).toFixed(1)}%`;
  return (
    <span className={wide ? styles.countBlock : styles.countInline} style={wide ? undefined : { width: `${widest}ch` }}>
      <span className={styles.count}>
        {/* The exact count for tests and screen readers; the eased one is what the eye sees. */}
        <span className={styles.srOnly} data-testid="filters-count">
          {show(shown)} of {show(total)} {options.noun}
        </span>
        <span aria-hidden>
          <b>{show(eased)}</b> of {show(total)} {options.noun}
          {percent && <span className={styles.percent}>{percent}</span>}
        </span>
      </span>
      <span className={styles.share} aria-hidden>
        <span className={styles.shareFill} style={{ width: `${(share ?? 1) * 100}%` }} />
      </span>
    </span>
  );
}

/** Clear all; with nothing set it keeps its room, hidden, so what sits beside it does not move. */
function ClearAll(view: ViewProps) {
  const set = view.states.filter((s) => narrows(view, s) && s.variables.length > 0);
  return (
    <button
      type="button"
      className={view.styles.clearAll}
      style={set.length === 0 ? { visibility: 'hidden' } : undefined}
      aria-hidden={set.length === 0}
      tabIndex={set.length === 0 ? -1 : undefined}
      onClick={() => writeVariables(clearing(view.states.flatMap((s) => s.variables)))}
    >
      Clear all
    </button>
  );
}

function ClearOne({ state }: { state: Clause }) {
  return (
    <IconButton
      name="times"
      size="sm"
      aria-label={`Clear ${state.label}`}
      tooltip={`Clear ${state.label}`}
      onClick={() => writeVariables(clearing(state.variables))}
    />
  );
}

/** Puts a control Mosaic drew where React renders this; the element outlives the place. */
function Host({ element }: { element: HTMLElement }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = host.current;
    node?.replaceChildren(element);
    return () => {
      if (node && element.parentNode === node) {
        node.removeChild(element);
      }
    };
  }, [element]);
  return <div ref={host} />;
}

function ControlView({ filter, view }: { filter: FilterDeclaration; view: ViewProps }) {
  const control = view.controls.get(filter.name);
  if (control?.kind === 'mosaic') {
    return <Host element={control.element} />;
  }
  if (control?.kind === 'search' && filter.type === 'search') {
    return (
      <SearchControl
        label={filter.label ?? filter.name}
        value={pickedValues(view.value, filter.variable)[0] ?? ''}
        onChange={control.set}
      />
    );
  }
  if (filter.type === 'area') {
    return <div className={view.styles.note}>Drawn on a map.</div>;
  }
  if (filter.type === 'link') {
    return <div className={view.styles.note}>Follows the filters of {filter.dataset}.</div>;
  }
  return null;
}

function Sidebar(view: ViewProps) {
  const { dataset, states, styles } = view;
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const toggle = useCallback(
    (name: string) =>
      setClosed((prev) => {
        const next = new Set(prev);
        if (next.has(name)) {
          next.delete(name);
        } else {
          next.add(name);
        }
        return next;
      }),
    []
  );
  const on = states.filter((s) => narrows(view, s));
  return (
    <div className={styles.root} data-testid="filters-panel">
      <div className={styles.header}>
        <Count {...view} wide />
        {on.length === 0 && <span className={styles.hint}>No filter yet.</span>}
        <ClearAll {...view} />
      </div>
      {dataset.filters.map((filter, index) => {
        const state = states.find((s) => s.name === filter.name);
        const open = !closed.has(filter.name);
        const colour = view.colours[index % view.colours.length];
        const set = state !== undefined && narrows(view, state);
        return (
          <div key={filter.name} className={styles.section}>
            <div className={styles.sectionHead}>
              <button
                type="button"
                className={styles.sectionTitle}
                aria-expanded={open}
                onClick={() => toggle(filter.name)}
              >
                <span>{open ? '▾' : '▸'}</span>
                <span className={styles.dot} style={{ background: colour }} />
                <span>{filter.label ?? filter.name}</span>
                {view.hover?.name === filter.name ? (
                  <span className={`${styles.sectionValue} ${styles.hover}`}>{view.hover.text}</span>
                ) : (
                  set && <span className={styles.sectionValue}>{state.text}</span>
                )}
              </button>
              {set && state.variables.length > 0 && <ClearOne state={state} />}
            </div>
            {/* Hidden, not unmounted: a closed section keeps its brush. */}
            <div className={styles.sectionBody} style={open ? undefined : { display: 'none' }}>
              <ControlView filter={filter} view={view} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** A pill per filter, but the one left out, each opening its control. */
function PillList({ view, except, strip }: { view: ViewProps; except?: string; strip?: boolean }) {
  const { dataset, states, styles } = view;
  return (
    <div className={strip ? styles.pillsStrip : styles.pills}>
      {dataset.filters.map((filter, index) => {
        if (filter.name === except) {
          return null;
        }
        const state = states.find((s) => s.name === filter.name);
        const set = state !== undefined && narrows(view, state);
        const label = filter.label ?? filter.name;
        const colour = view.colours[index % view.colours.length];
        return (
          <span
            key={filter.name}
            className={styles.pill}
            style={
              set ? { borderColor: colour, background: `color-mix(in srgb, ${colour} 16%, transparent)` } : undefined
            }
          >
            <Toggletip
              placement="bottom-start"
              closeButton={false}
              content={
                <div className={styles.popover}>
                  <ControlView filter={filter} view={view} />
                  {filter.type === 'range' && (
                    <div className={styles.readout}>
                      {view.hover?.name === filter.name ? view.hover.text : set ? state.text : ''}
                    </div>
                  )}
                </div>
              }
            >
              <button type="button" className={styles.pillButton}>
                <span className={styles.dot} style={{ background: colour }} />
                <span>{set ? `${label}: ${state.text}` : label}</span>
                {!set && <span>▾</span>}
              </button>
            </Toggletip>
            {set && state.variables.length > 0 && <ClearOne state={state} />}
          </span>
        );
      })}
    </div>
  );
}

function Pills(view: ViewProps) {
  const { styles } = view;
  return (
    <div className={styles.pillsRoot} data-testid="filters-panel">
      <PillList view={view} />
      {/* At the end, at a width that holds the largest count: the pills never move as it changes. */}
      <div className={styles.pillsEnd}>
        <Count {...view} />
        <ClearAll {...view} />
      </div>
    </div>
  );
}

/**
 * One range filter the width of the panel, with play; the other filters as
 * pills beside its buttons. A drag on it pauses play.
 */
function Timeline(view: ViewProps) {
  const { dataset, states, styles, options } = view;
  const index = dataset.filters.findIndex((f) => f.name === view.timeline);
  const filter = dataset.filters[index];
  const control = view.controls.get(filter.name);
  const player = control?.kind === 'mosaic' ? control.player : undefined;
  const { playing, toggle, pause, forward, back } = usePlayback(player, options.playMode, options.stepMs);
  const state = states.find((s) => s.name === filter.name);
  const held = player?.held();
  const domain = player?.domain();
  const step = player?.step() ?? 0;
  const asTime = filter.type === 'range' && filter.as === 'time';
  const readout =
    view.hover?.name === filter.name
      ? view.hover.text
      : held
        ? formatWindow(held, asTime)
        : state && narrows(view, state)
          ? state.text
          : '';
  return (
    <div className={styles.timelineRoot} data-testid="filters-panel">
      <div className={styles.timelineBar} style={{ height: TIMELINE_BAR_HEIGHT }}>
        <span className={styles.timelineLabel}>
          <span className={styles.dot} style={{ background: view.colours[index % view.colours.length] }} />
          {filter.label ?? filter.name}
        </span>
        <Transport
          playing={playing}
          canBack={Boolean(domain && held && previousWindow(domain, held, step, options.playMode))}
          canForward={Boolean(domain && (!held || nextWindow(domain, held, step, options.playMode)))}
          onToggle={toggle}
          onBack={back}
          onForward={forward}
          readout={readout}
          colour={view.colours[index % view.colours.length]}
        />
        {state && narrows(view, state) && state.variables.length > 0 && <ClearOne state={state} />}
        <PillList view={view} except={filter.name} strip />
        <div className={styles.pillsEnd}>
          <Count {...view} />
          <ClearAll {...view} />
        </div>
      </div>
      <div onPointerDownCapture={pause}>
        <ControlView filter={filter} view={view} />
      </div>
    </div>
  );
}
