import type { AssistantExtensionManifest } from '@grafana/assistant';

import { chaskiAssistantSkill, dashboardAuthoringSkill, mosaicAuthoringSkill } from './skills';

/**
 * What the app contributes to the Grafana Assistant: Chaski's skills, loaded
 * on demand, and starters for a fresh chat. Only an app can register them;
 * the datasource keeps the live page context (pageContext.ts).
 */
export const assistantManifest: AssistantExtensionManifest = {
  schemaVersion: 1,
  skills: [
    {
      id: 'chaski-sql',
      title: 'Chaski panel SQL',
      description:
        'Write SQL for panels on the Chaski datasource (DuckDB in the browser): datasets read as $name, macros, cross-filters with $__crossfilter. Use when a panel or dashboard reads Chaski datasets.',
      content: chaskiAssistantSkill,
    },
    {
      id: 'chaski-dashboards',
      title: 'Build a dashboard on Chaski',
      description:
        'The exact JSON of Chaski dataset variables and panel targets. Use when creating or editing a dashboard whose data loads into Chaski.',
      content: dashboardAuthoringSkill,
    },
    {
      id: 'chaski-mosaic',
      title: 'Mosaic panels on Chaski',
      description:
        'Add Mosaic (vgplot) linked views to a Chaski dashboard: the panel options, specs over datasets, brushes that write dashboard variables and variables that drive brushes, kepler maps included.',
      content: mosaicAuthoringSkill,
    },
  ],
  starters: [
    {
      label: 'A Chaski dashboard from a Parquet file',
      message:
        'Build a dashboard on Chaski over a Parquet file I give you the URL of: a dataset, a few stats and a table, with cross-filters.',
    },
    {
      label: 'Add Mosaic linked views',
      message:
        'Add Mosaic panels to a Chaski dashboard: histograms whose brushes filter each other and the dashboard’s other panels.',
    },
  ],
};
