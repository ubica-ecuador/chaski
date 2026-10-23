import {
  type CrossfilterSource,
  type DeclaredDataset,
  type FilterDeclaration,
  normalizeFilters,
} from '../engine/crossfilter';

/*
 * What the filters panel reads of the dashboard: the filters variables, as
 * written in its JSON, and the variables' values. The datasource reads the
 * same declarations when it resolves a filters variable; the panel is a
 * bundle of its own, so it reads them again from the dashboard and checks
 * them with the same code.
 */

/** A filters variable: its name, the dataset variable it names, and its filters as authored. */
export interface FiltersVariable {
  name: string;
  dataset: string;
  authored: unknown;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** `$quakes` or `${quakes}` → quakes. */
const referenced = (text: unknown): string | undefined => {
  const match = typeof text === 'string' ? /^\$(?:\{(\w+)\}|(\w+))$/.exec(text.trim()) : null;
  return match ? (match[1] ?? match[2]) : undefined;
};

/** The dashboard's filters variables, from the variables the template service lists. */
export function filtersVariables(variables: unknown[]): FiltersVariable[] {
  const found: FiltersVariable[] = [];
  for (const variable of variables) {
    if (!isObject(variable) || typeof variable.name !== 'string') {
      continue;
    }
    const query = variable.query;
    if (!isObject(query) || query.kind !== 'filters') {
      continue;
    }
    const dataset = referenced(query.dataset);
    if (dataset) {
      found.push({ name: variable.name, dataset, authored: query.filters });
    }
  }
  return found;
}

/** A variable's raw value: one string, several, or undefined when the dashboard has none by that name. */
export type ValueOf = (variable: string) => string | string[] | undefined;

/**
 * The URL first, then the template service. A panel that writes a variable
 * reads it back at once, and the template service follows the URL a moment
 * later; a variable that never was in the URL is the template service's.
 */
export function urlFirst(search: URLSearchParams, fallback: ValueOf): ValueOf {
  return (variable) => {
    const key = `var-${variable}`;
    if (!search.has(key)) {
      return fallback(variable);
    }
    const values = search.getAll(key);
    return values.length === 1 ? values[0] : values;
  };
}

/** A loaded dataset as the engine lists it. */
export interface LoadedDataset {
  name: string;
  table: string;
  rows: number;
  loadedAt: number;
}

/**
 * The cross-filter source the macros take: each filters variable's dataset,
 * by the table its dataset variable holds now, with its filters checked.
 */
export function crossfilterSource(
  variables: FiltersVariable[],
  loaded: LoadedDataset[],
  value: ValueOf
): CrossfilterSource {
  const declared = new Map<string, DeclaredDataset>();
  const datasetOf = (variable: FiltersVariable): DeclaredDataset | undefined => {
    const table = value(variable.dataset);
    const state = loaded.find((d) => d.table === table);
    if (!state) {
      return undefined;
    }
    const cached = declared.get(state.name);
    if (cached) {
      return cached;
    }
    const filters: FilterDeclaration[] = normalizeFilters(state.name, variable.authored, value);
    const dataset = { name: state.name, table: state.table, filters };
    declared.set(state.name, dataset);
    return dataset;
  };
  return {
    dataset: (name) => {
      for (const variable of variables) {
        const dataset = datasetOf(variable);
        if (dataset?.name === name) {
          return dataset;
        }
      }
      return undefined;
    },
    value,
  };
}

/** The filters variable a panel shows: the one it names, or the dashboard's only one. */
export function pickVariable(variables: FiltersVariable[], name: string | undefined): FiltersVariable | undefined {
  const wanted = (name ?? '').replace(/^\$\{?|\}$/g, '').trim();
  if (wanted) {
    return variables.find((v) => v.name === wanted);
  }
  return variables.length === 1 ? variables[0] : undefined;
}
