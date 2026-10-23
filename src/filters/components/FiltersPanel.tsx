import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { PanelProps } from '@grafana/data';
import { getTemplateSrv, locationService } from '@grafana/runtime';
import { IconButton, Toggletip, useStyles2 } from '@grafana/ui';
import { tableFromIPC } from 'apache-arrow';

import { type Clause, type DeclaredDataset, type FilterDeclaration, filterStates } from '../../engine/crossfilter';
import { rawValue } from '../../grafana/interpolate';
import type { ChaskiEngineApi } from '../../grafana/publicApi';
import { waitForEngine } from '../../mosaic/connector';
import { type ExtentCache, loadPanelData, type PanelData, pickedValues, rangeOf, type Run } from '../load';
import { crossfilterSource, filtersVariables, pickVariable, urlFirst, type ValueOf } from '../model';
import { timeCondition } from '../queries';
import { DEFAULT_OPTIONS, type FiltersOptions } from '../types';
import { clearing, rangeWrites, valuesWrites, writeVariables } from '../writes';
import { formatCount, RangeControl, SearchControl, ValuesControl } from './controls';
import { getStyles, type Styles } from './styles';

/** What the panel shows before counting: a message, or the dataset and its filters as they stand. */
type Resolved =
  | { kind: 'message'; text: string }
  | { kind: 'error'; text: string }
  | { kind: 'resolved'; dataset: DeclaredDataset; states: Clause[]; value: ValueOf };

type Loaded = { kind: 'ready'; data: PanelData; value: ValueOf } | { kind: 'error'; text: string };

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
const isCancel = (message: string) => /abort|cancel/i.test(message);

/** A filter is shown as narrowing when it is set and leaving it out would show more rows. */
const narrows = (data: PanelData, state: Clause) =>
  state.sql !== undefined && (data.without[state.name] === undefined || data.without[state.name] !== data.shown);

/** Sidebar when the panel is tall enough for sections, pills when it is a strip. */
export const layoutFor = (layout: FiltersOptions['layout'], height: number) =>
  layout === 'auto' ? (height < 160 ? 'pills' : 'sidebar') : layout;

/** The dashboard's filters variable, its dataset and its filters, read now; nothing is queried. */
export function resolveFilters(engine: ChaskiEngineApi, variableName: string): Resolved {
  const value = urlFirst(new URLSearchParams(locationService.getLocation().search), (name) =>
    rawValue(getTemplateSrv(), name)
  );
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
    const dataset = state ? crossfilterSource(variables, loaded, value).dataset(state.name) : undefined;
    if (!dataset) {
      return { kind: 'message', text: `Waiting for the dataset ${chosen.dataset} to load…` };
    }
    return {
      kind: 'resolved',
      dataset,
      states: filterStates(dataset, crossfilterSource(variables, loaded, value)),
      value,
    };
  } catch (error) {
    return { kind: 'error', text: messageOf(error) };
  }
}

export function FiltersPanel({ options: given, width, height, timeRange }: PanelProps<FiltersOptions>) {
  const options = { ...DEFAULT_OPTIONS, ...given };
  const styles = useStyles2(getStyles);
  const [engine, setEngine] = useState<ChaskiEngineApi>();
  // The dashboard's variables are not React state: they are read again whenever the URL changes (a variable
  // written) or a dataset reloads.
  const [resolved, setResolved] = useState<Resolved>();
  const [loaded, setLoaded] = useState<Loaded>();
  const extents = useRef<ExtentCache>(new Map());
  const { filters: variableName, timeColumn, maxValues, bins } = options;

  useEffect(() => {
    const abort = new AbortController();
    waitForEngine(abort.signal).then(setEngine, () => {});
    return () => abort.abort();
  }, []);

  useEffect(() => {
    if (!engine) {
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setResolved(resolveFilters(engine, variableName)), 30);
    };
    read();
    const unlisten = locationService.getHistory().listen(read);
    const off = engine.onChange(read);
    return () => {
      clearTimeout(timer);
      unlisten();
      off();
    };
  }, [engine, variableName]);

  const from = timeRange.from.valueOf();
  const to = timeRange.to.valueOf();

  useEffect(() => {
    if (!engine || resolved?.kind !== 'resolved') {
      return;
    }
    const abort = new AbortController();
    const run: Run = async (sql) => {
      const ipc = await engine.queryIPC(sql, { consumer: 'panel', signal: abort.signal });
      return tableFromIPC(ipc)
        .toArray()
        .map((row) => row.toJSON() as Record<string, unknown>);
    };
    const { dataset, states, value } = resolved;
    loadPanelData(
      run,
      dataset,
      states,
      value,
      timeCondition(timeColumn, from, to),
      { maxValues, bins },
      extents.current
    )
      .then((data) => !abort.signal.aborted && setLoaded({ kind: 'ready', data, value }))
      .catch((error) => {
        const text = messageOf(error);
        if (!abort.signal.aborted && !isCancel(text)) {
          setLoaded({ kind: 'error', text });
        }
      });
    return () => abort.abort();
  }, [engine, resolved, timeColumn, from, to, maxValues, bins]);

  if (!engine || !resolved) {
    return <div className={styles.message}>Waiting for Chaski…</div>;
  }
  if (resolved.kind === 'message') {
    return <div className={styles.message}>{resolved.text}</div>;
  }
  const failed = resolved.kind === 'error' ? resolved.text : loaded?.kind === 'error' ? loaded.text : undefined;
  if (failed !== undefined) {
    return (
      <div className={styles.error} data-testid="filters-error">
        {failed}
      </div>
    );
  }
  if (loaded?.kind !== 'ready') {
    return <div className={styles.message}>Counting…</div>;
  }
  // The counts shown are the last ones read; the next arrive in place, without a blank between.
  const view = { data: loaded.data, value: loaded.value, options, styles };
  return layoutFor(options.layout, height) === 'pills' ? <Pills {...view} /> : <Sidebar {...view} width={width} />;
}

interface ViewProps {
  data: PanelData;
  value: ValueOf;
  options: FiltersOptions;
  styles: Styles;
}

function Count({ data, options, styles }: ViewProps) {
  return (
    <span className={styles.count} data-testid="filters-count">
      <b>{formatCount(data.shown)}</b> of {formatCount(data.total)} {options.noun}
    </span>
  );
}

function ClearAll({ data, styles }: ViewProps) {
  const set = data.states.filter((s) => narrows(data, s) && s.variables.length > 0);
  if (set.length === 0) {
    return null;
  }
  return (
    <button
      type="button"
      className={styles.clearAll}
      onClick={() => writeVariables(clearing(data.states.flatMap((s) => s.variables)))}
    >
      Clear all
    </button>
  );
}

/** The control for one declared filter, or a line saying where it is set. */
function Control({ filter, view, width }: { filter: FilterDeclaration; view: ViewProps; width: number }) {
  const { data, value, options, styles } = view;
  switch (filter.type) {
    case 'range':
      return (
        <RangeControl
          filter={filter}
          histogram={data.histograms[filter.name]}
          range={rangeOf(filter, value)}
          width={width}
          styles={styles}
          onChange={(range) => writeVariables(rangeWrites(filter.from, filter.to, range, filter.as === 'time'))}
        />
      );
    case 'in':
    case 'equals':
      return (
        <ValuesControl
          filter={filter}
          values={data.values[filter.name] ?? []}
          picked={pickedValues(value, filter.variable)}
          maxValues={options.maxValues}
          styles={styles}
          onChange={(values) => writeVariables(valuesWrites(filter.variable, values))}
        />
      );
    case 'search':
      return (
        <SearchControl
          label={filter.label ?? filter.name}
          value={pickedValues(value, filter.variable)[0] ?? ''}
          onChange={(text) => writeVariables({ [filter.variable]: text })}
        />
      );
    case 'area':
      return <div className={styles.note}>Drawn on a map.</div>;
    case 'link':
      return <div className={styles.note}>Follows the filters of {filter.dataset}.</div>;
  }
}

function ClearOne({ state, styles }: { state: Clause; styles: Styles }) {
  return (
    <IconButton
      name="times"
      size="sm"
      aria-label={`Clear ${state.label}`}
      tooltip={`Clear ${state.label}`}
      onClick={(event) => {
        event.stopPropagation();
        writeVariables(clearing(state.variables));
      }}
    />
  );
}

function Sidebar(view: ViewProps & { width: number }) {
  const { data, styles } = view;
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const toggle = useCallback(
    (name: string) =>
      setClosed((prev) => {
        const next = new Set(prev);
        next.has(name) ? next.delete(name) : next.add(name);
        return next;
      }),
    []
  );
  const on = data.states.filter((s) => narrows(data, s));
  return (
    <div className={styles.root} data-testid="filters-panel">
      <div className={styles.header}>
        <Count {...view} />
        {on.length === 0 && <span className={styles.hint}>No filter yet.</span>}
        <ClearAll {...view} />
      </div>
      {data.dataset.filters.map((filter) => {
        const state = data.states.find((s) => s.name === filter.name);
        const open = !closed.has(filter.name);
        const set = state && narrows(data, state);
        return (
          <div key={filter.name} className={styles.section}>
            <button
              type="button"
              className={styles.sectionTitle}
              aria-expanded={open}
              onClick={() => toggle(filter.name)}
            >
              <span>{open ? '▾' : '▸'}</span>
              <span>{filter.label ?? filter.name}</span>
              {set && <span className={styles.sectionValue}>{state.text}</span>}
              {set && state.variables.length > 0 && <ClearOne state={state} styles={styles} />}
            </button>
            {open && (
              <div className={styles.sectionBody}>
                <Control filter={filter} view={view} width={view.width - 16} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Pills(view: ViewProps) {
  const { data, styles } = view;
  return (
    <div className={styles.pillsRoot} data-testid="filters-panel">
      <Count {...view} />
      {data.dataset.filters.map((filter) => {
        const state = data.states.find((s) => s.name === filter.name);
        const set = state !== undefined && narrows(data, state);
        const label = filter.label ?? filter.name;
        return (
          <Toggletip
            key={filter.name}
            placement="bottom-start"
            closeButton={false}
            content={
              <div className={styles.popover}>
                <Control filter={filter} view={view} width={280} />
              </div>
            }
          >
            <button type="button" className={`${styles.pill} ${set ? styles.pillOn : ''}`}>
              <span>{set ? `${label}: ${state.text}` : label}</span>
              {set && state.variables.length > 0 ? <ClearOne state={state} styles={styles} /> : <span>▾</span>}
            </button>
          </Toggletip>
        );
      })}
      <ClearAll {...view} />
    </div>
  );
}

export const _forTests = { narrows };
