import { Coordinator, isSelection, makeClient, Selection } from '@uwdata/mosaic-core';
import { count, Query } from '@uwdata/mosaic-sql';
import { astToDOM, parseSpec } from '@uwdata/mosaic-spec';
import { createAPIContext } from '@uwdata/vgplot';

import * as sync from '../filters/sync';
import { linkVariables } from './bridge';
import { ChaskiConnector, unreadable } from './connector';
import { linkReads } from './inbound';
import { dashboardKey, pageFor, PREAGG_SCHEMA, releaseClauses } from './page';

/*
 * Mosaic as every panel of the app shares it. Each plugin is a bundle of its
 * own, and a second copy of Mosaic would keep its own Selections, its own
 * classes and its own page of shared params: the filters panel and the Mosaic
 * panels would never see each other's brushes. So the Mosaic panel's module
 * carries the one copy and hands it out on its plugin object; the filters
 * panel loads it through Grafana (src/filters/runtime.ts) and bundles none.
 */
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
};

export type MosaicRuntime = typeof mosaicRuntime;
