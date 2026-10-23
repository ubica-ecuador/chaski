import { PanelPlugin } from '@grafana/data';
import { getTemplateSrv } from '@grafana/runtime';

import { FiltersPanel } from '../../filters/components/FiltersPanel';
import { filtersVariables } from '../../filters/model';
import { DEFAULT_OPTIONS, type FiltersOptions } from '../../filters/types';

export const plugin = new PanelPlugin<FiltersOptions>(FiltersPanel).setPanelOptions((builder) =>
  builder
    .addSelect({
      path: 'filters',
      name: 'Filters variable',
      description: 'The Chaski filters variable whose filters this panel shows. Empty: the dashboard’s only one.',
      defaultValue: DEFAULT_OPTIONS.filters,
      settings: {
        allowCustomValue: true,
        isClearable: true,
        options: [],
        getOptions: async () =>
          filtersVariables(getTemplateSrv().getVariables() as unknown[]).map((v) => ({
            value: v.name,
            label: v.name,
            description: `Filters of $${v.dataset}`,
          })),
      },
    })
    .addTextInput({
      path: 'selection',
      name: 'Mosaic selection',
      description:
        'The Mosaic selection the controls share. Empty: one named after the filters variable. Use the name the dashboard’s Mosaic panels use, and they filter each other live.',
      defaultValue: DEFAULT_OPTIONS.selection,
    })
    .addRadio({
      path: 'layout',
      name: 'Layout',
      description:
        'Auto: a sidebar of sections when the panel is tall, a row of pills when it is a strip. Timeline: a time filter the width of the panel, with play, and the other filters as pills.',
      defaultValue: DEFAULT_OPTIONS.layout,
      settings: {
        options: [
          { value: 'auto', label: 'Auto' },
          { value: 'sidebar', label: 'Sidebar' },
          { value: 'pills', label: 'Pills' },
          { value: 'timeline', label: 'Timeline' },
        ],
      },
    })
    .addTextInput({
      path: 'timeline',
      name: 'Timeline filter',
      description: 'The range filter the timeline draws, by name. Empty: the first range filter over times.',
      defaultValue: DEFAULT_OPTIONS.timeline,
      showIf: (options) => options.layout === 'timeline',
    })
    .addRadio({
      path: 'playMode',
      name: 'Play',
      description: 'Slide: a window of fixed width moves along. Grow: the start stays and the end moves.',
      defaultValue: DEFAULT_OPTIONS.playMode,
      settings: {
        options: [
          { value: 'slide', label: 'Slide' },
          { value: 'grow', label: 'Grow' },
        ],
      },
      showIf: (options) => options.layout === 'timeline',
    })
    .addNumberInput({
      path: 'stepMs',
      name: 'Step duration (ms)',
      description:
        'The least time a step of play lasts; longer while the panels it set off still run. At least 400: each step’s variables are written a moment after it.',
      defaultValue: DEFAULT_OPTIONS.stepMs,
      settings: { min: 400, integer: true },
      showIf: (options) => options.layout === 'timeline',
    })
    .addTextInput({
      path: 'timeColumn',
      name: 'Time column',
      description: 'When set, every count keeps to the dashboard’s time range over this column.',
      defaultValue: DEFAULT_OPTIONS.timeColumn,
    })
    .addTextInput({
      path: 'noun',
      name: 'Rows are',
      description: 'For “N of M rows”.',
      defaultValue: DEFAULT_OPTIONS.noun,
    })
    .addNumberInput({
      path: 'maxValues',
      name: 'Values shown',
      description: 'How many of a column’s most frequent values a list shows.',
      defaultValue: DEFAULT_OPTIONS.maxValues,
      settings: { min: 3, integer: true },
    })
    .addNumberInput({
      path: 'bins',
      name: 'Histogram bars',
      defaultValue: DEFAULT_OPTIONS.bins,
      settings: { min: 5, max: 200, integer: true },
    })
);
