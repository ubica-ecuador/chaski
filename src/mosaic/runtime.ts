import {
  clauseInterval,
  clauseIntervals,
  clausePoints,
  Coordinator,
  isSelection,
  makeClient,
  Selection,
} from '@uwdata/mosaic-core';
import { count, Query } from '@uwdata/mosaic-sql';
import { astToDOM, parseSpec } from '@uwdata/mosaic-spec';
import { createAPIContext } from '@uwdata/vgplot';

import * as sync from '../filters/sync';
import { clauseColumns, linkVariables } from './bridge';
import { ChaskiConnector, unreadable } from './connector';
import { linkReads } from './inbound';
import { dashboardKey, markOutside, pageFor, PREAGG_SCHEMA, releaseClauses } from './page';
import { clauseArea, sharedSelection } from './shared';

/*
 * Mosaic as every panel of the app shares it. Each plugin is a bundle of its
 * own, and a second copy of Mosaic would keep its own Selections, its own
 * classes and its own page of shared params: the filters panel and the Mosaic
 * panels would never see each other's brushes. So the Mosaic panel's module
 * carries the one copy and hands it out on its plugin object; the filters
 * panel loads it through Grafana (src/filters/runtime.ts) and bundles none.
 *
 * Panels of other plugins load it the same way. What they use of it is a
 * contract: `sharedSelection`, the clause builders (`clauseArea` among them)
 * and `clauseColumns` keep
 * their shapes, or a kepler map linked to a Selection breaks with no error.
 * The builders note their clause's source as another plugin's, so a dataset
 * reloading keeps that clause (page.ts `outside`).
 */
/** A clause builder that notes the source in its options as another plugin's. */
function outsider<A extends unknown[], O extends { source?: unknown }, R>(
  build: (...args: [...A, O]) => R
): (...args: [...A, O]) => R {
  return (...args) => {
    markOutside((args[args.length - 1] as O | undefined)?.source);
    return build(...args);
  };
}

export const mosaicRuntime = {
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
  sync,
  sharedSelection,
  clauseInterval: outsider(clauseInterval),
  clauseIntervals: outsider(clauseIntervals),
  clausePoints: outsider(clausePoints),
  clauseArea: outsider(clauseArea),
  clauseColumns,
};

export type MosaicRuntime = typeof mosaicRuntime;
