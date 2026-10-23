import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { GrafanaTheme2, PanelProps } from '@grafana/data';
import { getTemplateSrv, locationService } from '@grafana/runtime';
import { IconButton, Toggletip, useStyles2, useTheme2 } from '@grafana/ui';
import { Coordinator, isSelection, type Logger, makeClient, type Selection } from '@uwdata/mosaic-core';
import { count, Query } from '@uwdata/mosaic-sql';
import { astToDOM, parseSpec } from '@uwdata/mosaic-spec';
import { createAPIContext } from '@uwdata/vgplot';
import { tableFromIPC } from 'apache-arrow';

import { type Clause, type DeclaredDataset, type FilterDeclaration, filterStates } from '../../engine/crossfilter';
import { quoteIdent } from '../../engine/sql';
import { rawValue } from '../../grafana/interpolate';
import type { ChaskiEngineApi } from '../../grafana/publicApi';
import { linkVariables, type VariableLink } from '../../mosaic/bridge';
import { ChaskiConnector, unreadable, waitForEngine } from '../../mosaic/connector';
import { linkReads, type VariableRead } from '../../mosaic/inbound';
import { dashboardKey, pageFor, PREAGG_SCHEMA, releaseClauses } from '../../mosaic/page';
import { crossfilterSource, filtersVariables, pickVariable, urlFirst, type ValueOf } from '../model';
import { countSql, timeCondition } from '../queries';
import { controlLinks, labelWidth, rangeSpec, type ValueFilter, valuesSpec } from '../specs';
import {
  applyRange,
  applyValues,
  heldElsewhere,
  type IntervalInteractor,
  pixelOf,
  rangeMatches,
  searchClause,
  spanOf,
  timeClause,
  type ToggleInteractor,
  valuesMatch,
} from '../sync';
import { DEFAULT_OPTIONS, type FiltersOptions } from '../types';
import { pickedValues, rangeOf } from '../values';
import { clearing, writeVariables } from '../writes';
import { formatCount, roundToAxis, SearchControl } from './controls';
import { getStyles, type Styles } from './styles';

/** The dashboard's filters as they stand: the dataset, its filters' states, the variables' values. */
type Resolved =
  | { kind: 'message'; text: string }
  | { kind: 'error'; text: string }
  | { kind: 'resolved'; variable: string; dataset: DeclaredDataset; states: Clause[]; value: ValueOf };

/** A control drawn by Mosaic, or the search box the panel draws itself. */
type Control =
  { kind: 'mosaic'; element: HTMLElement } | { kind: 'search'; set: (text: string) => void } | { kind: 'none' };

type Build =
  | { kind: 'starting' }
  | { kind: 'message'; text: string }
  | { kind: 'error'; text: string }
  | { kind: 'ready'; dataset: DeclaredDataset; controls: Map<string, Control> };

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

/** Sidebar when the panel is tall enough for sections, pills when it is a strip. */
export const layoutFor = (layout: FiltersOptions['layout'], height: number) =>
  layout === 'auto' ? (height < 160 ? 'pills' : 'sidebar') : layout;

const POPOVER_WIDTH = 300;

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

const barColours = (theme: GrafanaTheme2) => ({
  fill: theme.colors.primary.main,
  text: theme.colors.text.secondary,
});

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
  const [rebuild, setRebuild] = useState(0);

  const layout = layoutFor(options.layout, height);
  const controlWidth = useDebounced(layout === 'pills' ? POPOVER_WIDTH - 16 : Math.max(120, width - 20), 150);
  const { filters: variableName, selection: selectionName, timeColumn, maxValues, bins } = options;
  const from = timeRange.from.valueOf();
  const to = timeRange.to.valueOf();
  const { fill, text: textColour } = barColours(theme);

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
      const engine = await waitForEngine(abort.signal);
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
      const selection = selectionName.trim() || state.variable;

      const coordinator = new Coordinator(new ChaskiConnector(engine, {}), {
        logger: quietLogger(reportError),
        preagg: { schema: PREAGG_SCHEMA, enabled: true },
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

      const look = { fill, text: textColour, width: controlWidth };
      const controls = new Map<string, Control>();
      const intervals = new Map<string, IntervalInteractor>();
      const toggles = new Map<string, ToggleInteractor[]>();
      const searches = new Map<string, { source: object; text: string }>();
      for (const filter of dataset.filters) {
        if (filter.type === 'range') {
          const { element, interactors } = await draw(rangeSpec(dataset.name, filter, selection, bins, look));
          const interval = interactors.find((i) => isObject(i) && 'brush' in i);
          if (interval) {
            intervals.set(filter.name, interval as IntervalInteractor);
          }
          controls.set(filter.name, { kind: 'mosaic', element });
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
            labelWidth(labels, controlWidth),
            look
          );
          const { element, interactors } = await draw(spec);
          toggles.set(
            filter.name,
            interactors.filter((i): i is ToggleInteractor => isObject(i) && 'fields' in i && !('brush' in i))
          );
          controls.set(filter.name, { kind: 'mosaic', element });
        } else if (filter.type === 'search') {
          const source = { filter: filter.name };
          searches.set(filter.name, { source, text: '' });
          controls.set(filter.name, {
            kind: 'search',
            set: (text) => {
              searches.set(filter.name, { source, text });
              (page.params.get(selection) as Selection).update(searchClause(source, filter.column, text));
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
      if (!shared || !isSelection(shared)) {
        throw new Error(`The filters panel's selection ${selection} is a param elsewhere on this dashboard`);
      }

      // The dashboard's time range, as a clause no control owns.
      if (timeColumn.trim()) {
        const clause = timeClause({ time: true }, timeColumn.trim(), from, to);
        shared.update(clause);
        defer(() => shared.reset([clause]));
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
      const sync = () => {
        const value = currentValues();
        for (const filter of dataset.filters) {
          if (filter.type === 'range') {
            const interval = intervals.get(filter.name);
            if (!interval) {
              continue;
            }
            const range = rangeOf(filter, value);
            const set = range[0] !== undefined || range[1] !== undefined;
            if (set && heldElsewhere(shared, own, filter.column, (v) => rangeMatches(v, range, spanOf(interval)))) {
              applyRange(interval, [undefined, undefined]);
            } else {
              applyRange(interval, range);
            }
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
      const unlink = linkVariables(links, page.params);
      defer(() => unlink(false));
      defer(locationService.getHistory().listen(sync));

      drawn = true;
      setBuild({ kind: 'ready', dataset, controls });
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
  }, [variableName, selectionName, timeColumn, from, to, maxValues, bins, controlWidth, fill, textColour, rebuild]);

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
  };
  return (
    <>
      {problem && (
        <div className={styles.error} data-testid="filters-error">
          {problem}
        </div>
      )}
      {layout === 'pills' ? <Pills {...view} /> : <Sidebar {...view} />}
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
}

/** A filter is shown as set when it is, and leaving it out would show more rows. */
const narrows = (view: ViewProps, state: Clause) =>
  state.sql !== undefined && (view.without[state.name] === undefined || view.without[state.name] !== view.shown);

function Count({ shown, total, options, styles }: ViewProps) {
  const show = (n?: number) => (n === undefined ? '…' : formatCount(n));
  return (
    <span className={styles.count} data-testid="filters-count">
      <b>{show(shown)}</b> of {show(total)} {options.noun}
    </span>
  );
}

function ClearAll(view: ViewProps) {
  const set = view.states.filter((s) => narrows(view, s) && s.variables.length > 0);
  if (set.length === 0) {
    return null;
  }
  return (
    <button
      type="button"
      className={view.styles.clearAll}
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
        <Count {...view} />
        {on.length === 0 && <span className={styles.hint}>No filter yet.</span>}
        <ClearAll {...view} />
      </div>
      {dataset.filters.map((filter) => {
        const state = states.find((s) => s.name === filter.name);
        const open = !closed.has(filter.name);
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
                <span>{filter.label ?? filter.name}</span>
                {set && <span className={styles.sectionValue}>{state.text}</span>}
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

function Pills(view: ViewProps) {
  const { dataset, states, styles } = view;
  return (
    <div className={styles.pillsRoot} data-testid="filters-panel">
      <Count {...view} />
      {dataset.filters.map((filter) => {
        const state = states.find((s) => s.name === filter.name);
        const set = state !== undefined && narrows(view, state);
        const label = filter.label ?? filter.name;
        return (
          <span key={filter.name} className={`${styles.pill} ${set ? styles.pillOn : ''}`}>
            <Toggletip
              placement="bottom-start"
              closeButton={false}
              content={
                <div className={styles.popover}>
                  <ControlView filter={filter} view={view} />
                </div>
              }
            >
              <button type="button" className={styles.pillButton}>
                <span>{set ? `${label}: ${state.text}` : label}</span>
                {!set && <span>▾</span>}
              </button>
            </Toggletip>
            {set && state.variables.length > 0 && <ClearOne state={state} />}
          </span>
        );
      })}
      <ClearAll {...view} />
    </div>
  );
}
