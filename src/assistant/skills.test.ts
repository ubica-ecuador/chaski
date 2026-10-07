import { readFileSync } from 'fs';
import { join } from 'path';

import { expandMacros } from '../engine/macros';
import { chaskiAssistantSkill, dashboardAuthoringSkill, exampleDatasetVariable, examplePanelTarget } from './skills';

/** A call of each macro Chaski expands; the skills may name only these. */
const calls: Record<string, string> = {
  timeFilter: '$__timeFilter(t)',
  timeFrom: '$__timeFrom()',
  timeTo: '$__timeTo()',
  timeGroup: '$__timeGroup(t, 1h)',
  proxy: "$__proxy('a.parquet')",
};
const ctx = { from: 0, to: 3600_000, proxyBase: 'http://g/api/datasources/proxy/uid/x/_plain' };

describe.each([
  ['chaskiAssistantSkill', chaskiAssistantSkill],
  ['dashboardAuthoringSkill', dashboardAuthoringSkill],
])('%s', (_, skill) => {
  it('names only macros Chaski expands', () => {
    const named = new Set([...skill.matchAll(/\$__(\w+)/g)].map((m) => m[1]));
    for (const name of named) {
      expect(Object.keys(calls)).toContain(name);
      expect(expandMacros(calls[name], ctx)).not.toBe(calls[name]);
    }
  });
});

describe('chaskiAssistantSkill', () => {
  it('names every macro', () => {
    for (const name of Object.keys(calls)) {
      expect(chaskiAssistantSkill).toContain(`$__${name}`);
    }
  });

  it('says the Assistant cannot run Chaski queries', () => {
    expect(chaskiAssistantSkill).toMatch(/cannot run Chaski queries/);
  });
});

describe('the authoring example', () => {
  const provisioned = JSON.parse(readFileSync(join(__dirname, '../../provisioning/dashboards/e2e.json'), 'utf8'));
  const dataset = provisioned.templating.list.find((v: { query?: { kind?: string } }) => v.query?.kind === 'dataset');

  it('has the shape of a provisioned dataset variable', () => {
    expect(Object.keys(exampleDatasetVariable)).toEqual(
      expect.arrayContaining(['datasource', 'hide', 'name', 'query', 'refresh', 'skipUrlSync', 'type'])
    );
    expect(Object.keys(exampleDatasetVariable.query).sort()).toEqual(Object.keys(dataset.query).sort());
    expect(exampleDatasetVariable.type).toBe(dataset.type);
    expect(exampleDatasetVariable.hide).toBe(dataset.hide);
    expect(exampleDatasetVariable.datasource.type).toBe(dataset.datasource.type);
    expect(exampleDatasetVariable.query.name).toBe(exampleDatasetVariable.name);
  });

  it('reads the dataset by its $name in panel SQL, and the skill embeds both', () => {
    expect(examplePanelTarget.rawSql).toContain(`$${exampleDatasetVariable.name}`);
    expect(dashboardAuthoringSkill).toContain(JSON.stringify(exampleDatasetVariable));
    expect(dashboardAuthoringSkill).toContain(JSON.stringify(examplePanelTarget));
  });
});
