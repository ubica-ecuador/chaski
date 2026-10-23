import { ASSISTANT_EXTENSION_POINT, getAssistantExtensionConfig } from '@grafana/assistant';
import { readFileSync } from 'fs';
import { join } from 'path';

import { parseLinks } from '../mosaic/bridge';
import { parseReads } from '../mosaic/inbound';
import { datasetNames, parseSpecText } from '../mosaic/spec';
import type { MosaicOptions } from '../mosaic/types';
import { plugin } from '../module';
import { assistantManifest } from './manifest';
import { exampleMosaicPanel, mosaicAuthoringSkill } from './skills';

const read = (path: string) => JSON.parse(readFileSync(join(__dirname, '..', path), 'utf8'));

describe('assistantManifest', () => {
  // The Assistant drops a whole entry that breaks any of its bounds.
  it('keeps within the bounds the Assistant enforces', () => {
    const { skills = [], starters = [] } = assistantManifest;
    expect(skills.length).toBeLessThanOrEqual(5);
    expect(new Set(skills.map((s) => s.id)).size).toBe(skills.length);
    for (const skill of skills) {
      expect(skill.id).toMatch(/^[a-z][a-z0-9-]{0,63}$/);
      expect(skill.title.length).toBeLessThanOrEqual(80);
      expect(skill.description.length).toBeLessThanOrEqual(500);
      expect(new TextEncoder().encode(skill.content).length).toBeLessThanOrEqual(32768);
    }
    expect(starters.length).toBeLessThanOrEqual(3);
    for (const starter of starters) {
      expect((starter.label ?? '').length).toBeLessThanOrEqual(80);
      expect(starter.message.length).toBeLessThanOrEqual(500);
    }
  });

  it('is what the app registers', () => {
    expect(plugin.addedFunctionConfigs.map((c) => c.targets)).toEqual([[ASSISTANT_EXTENSION_POINT]]);
    expect((plugin.addedFunctionConfigs[0].fn as () => unknown)()).toBe(assistantManifest);
  });

  // Grafana ignores an added function plugin.json does not declare.
  it('is declared in the app’s plugin.json as the SDK registers it', () => {
    const config = getAssistantExtensionConfig(assistantManifest);
    expect(read('plugin.json').extensions.addedFunctions).toContainEqual({
      targets: [ASSISTANT_EXTENSION_POINT],
      title: config.title,
      description: config.description,
    });
  });
});

describe('the Mosaic example panel', () => {
  const options: MosaicOptions = exampleMosaicPanel.options;

  it('is the panel the app includes, with its options', () => {
    expect(exampleMosaicPanel.type).toBe(read('plugins/mosaic/plugin.json').id);
    const source = readFileSync(join(__dirname, '../plugins/mosaic/module.ts'), 'utf8');
    for (const key of Object.keys(options)) {
      expect(source).toContain(`path: '${key}'`);
    }
  });

  it('parses as the panel parses it, over a dataset by bare name', () => {
    const spec = parseSpecText(options.spec);
    expect(datasetNames(spec)).toEqual(['quakes']);
    expect(parseLinks(options.variables)).toHaveLength(1);
    expect(parseReads(options.reads)).toEqual([]);
  });

  it('is embedded in the skill', () => {
    expect(mosaicAuthoringSkill).toContain(JSON.stringify(exampleMosaicPanel));
  });
});

describe('docs/grafana-assistant.md', () => {
  const doc = readFileSync(join(__dirname, '../../docs/grafana-assistant.md'), 'utf8');

  it.each(assistantManifest.skills!.map((s) => [s.id, s] as const))(
    'quotes the %s skill as registered',
    (id, skill) => {
      expect(doc).toContain(`plugin:ubica-chaski-app:${id}`);
      expect(doc).toContain(skill.content);
    }
  );
});
