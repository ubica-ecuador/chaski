import { PanelPlugin } from '@grafana/data';

import { patchEmptyGrids } from '../../mosaic/patches';

import { CodeOption } from '../../mosaic/components/CodeOption';
import { MosaicPanel } from '../../mosaic/components/MosaicPanel';
import type { MosaicOptions } from '../../mosaic/types';

patchEmptyGrids();

export const plugin = new PanelPlugin<MosaicOptions>(MosaicPanel).setPanelOptions((builder) =>
  builder
    .addCustomEditor({
      id: 'spec',
      path: 'spec',
      name: 'Spec',
      description:
        'A Mosaic spec in YAML or JSON (idl.uw.edu/mosaic). Tables are the dashboard’s Chaski datasets, by name. Params and selections are shared by name with the other Mosaic panels of the dashboard.',
      editor: CodeOption,
      defaultValue: '',
      settings: { height: 420 },
    })
    .addCustomEditor({
      id: 'variables',
      path: 'variables',
      name: 'Write to variables',
      description:
        'A list: `param` (a selection or param of the spec), `column` to pick a selection’s clause, then `from` and `to` for an interval or `variable` for points, text, a 2-D brush (as WKT) or a param’s value.',
      editor: CodeOption,
      defaultValue: '',
      settings: { height: 160 },
    })
    .addCustomEditor({
      id: 'reads',
      path: 'reads',
      name: 'Read from variables',
      description:
        'A list: `param` (a selection of the spec), `column`, then `from` and `to` for a range (a kepler viewport’s edges), `area` for a WKT polygon over `[longitude, latitude]` (a kepler drawn area), or `values` for a multi-value variable. The Mosaic panels follow those variables. Declare each read in one panel.',
      editor: CodeOption,
      defaultValue: '',
      settings: { height: 160 },
    })
    .addBooleanSwitch({
      path: 'preaggregate',
      name: 'Pre-aggregate',
      description: 'Build small tables when a brush starts, so it answers fast on large data.',
      defaultValue: true,
    })
);
