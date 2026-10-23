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
    .addRadio({
      path: 'layout',
      name: 'Layout',
      description: 'Auto: a sidebar of sections when the panel is tall, a row of pills when it is a strip.',
      defaultValue: DEFAULT_OPTIONS.layout,
      settings: {
        options: [
          { value: 'auto', label: 'Auto' },
          { value: 'sidebar', label: 'Sidebar' },
          { value: 'pills', label: 'Pills' },
        ],
      },
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
      description: 'How many values a list shows before “more”.',
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
