import { isSelection, Selection, type ClauseSource, type SelectionClause } from '@uwdata/mosaic-core';
import { column } from '@uwdata/mosaic-sql';

import { waitForEngine } from './connector';
import { areaPredicate } from './inbound';
import { dashboardKey, pageFor } from './page';

/*
 * For panels of other plugins (a kepler map) that take part in the
 * dashboard's Selections through this runtime, with no Mosaic of their own:
 * they write clauses as a brush would, as the pointer moves, and read the
 * others' clauses as they land. No variable and no URL in between.
 */

/**
 * The dashboard's Selection of this name, made a crossfilter one when no
 * panel has made it yet: a Mosaic spec that declares it later takes this one,
 * as it takes any param already on the page.
 *
 * Waits for Chaski's engine, which a Chaski dataset on the dashboard starts:
 * the page and its pre-aggregates belong to it.
 */
export async function sharedSelection(name: string, signal: AbortSignal): Promise<Selection> {
  const engine = await waitForEngine(signal);
  const page = pageFor(dashboardKey(), engine);
  const param = page.params.get(name) ?? Selection.crossfilter();
  if (!isSelection(param)) {
    throw new Error(`${name} is a Mosaic param on this dashboard, not a Selection`);
  }
  page.params.set(name, param);
  return param;
}

/**
 * A clause keeping the rows whose longitude and latitude fall in a WKT
 * polygon: a figure drawn on a kepler map. No value, or text that is no
 * polygon, makes a clause with no value, which takes the source's clause out.
 *
 * Its type is `area`, not `interval`: Mosaic pre-aggregates intervals and
 * points only, and a polygon is neither, so the panels query it as it is.
 */
export function clauseArea(
  fields: [string, string],
  wkt: string | null | undefined,
  { source }: { source: ClauseSource }
): SelectionClause {
  const [lng, lat] = fields;
  const made = wkt ? areaPredicate(lng, lat, wkt) : null;
  return {
    source,
    clients: undefined,
    fields: [column(lng), column(lat)],
    value: made?.value ?? null,
    predicate: made?.predicate ?? null,
    meta: { type: 'area' },
  } as SelectionClause;
}
