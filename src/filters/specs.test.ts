import { parseSpec } from '@uwdata/mosaic-spec';

import type { FilterDeclaration, RangeFilter } from '../engine/crossfilter';
import { datasetNames } from '../mosaic/spec';
import { allOf, controlLinks, labelWidth, rangeSpec, valuesSpec } from './specs';

const look = { colour: '#3d71d9', paint: 'url(#g)', muted: '#444', text: '#ccc', width: 280 };
const mag: RangeFilter = { name: 'mag', type: 'range', column: 'mag', from: 'mag_lo', to: 'mag_hi' };

describe('rangeSpec', () => {
  const spec = rangeSpec('quakes', mag, 'quakeFilters', 40, look);

  it('draws the bins the other filters leave in grey, and in colour those its own brush keeps too', () => {
    expect(() => parseSpec(spec as never)).not.toThrow();
    expect(datasetNames(spec)).toEqual(['quakes']);
    const [grey, brush, colour] = spec.plot;
    expect(grey).toMatchObject({
      mark: 'rectY',
      data: { filterBy: '$quakeFilters' },
      fill: '#444',
    });
    expect(grey).not.toHaveProperty('tip');
    expect(brush).toMatchObject({ select: 'intervalX', as: '$quakeFilters' });
    expect(colour).toMatchObject({
      data: { filterBy: `$${allOf('quakeFilters')}` },
      fill: 'url(#g)',
      pointerEvents: 'none',
    });
    expect(spec.params).toEqual({
      quakeFilters: { select: 'crossfilter' },
      quakeFilters__all: { select: 'intersect' },
    });
  });

  it('keeps its x axis and fits its y axis to the rows left', () => {
    expect(spec.xDomain).toBe('Fixed');
    expect(spec).not.toHaveProperty('yDomain');
  });
});

describe('valuesSpec', () => {
  const kind = { name: 'kind', type: 'in', column: 'type', variable: 'kinds' } as const;
  const spec = valuesSpec('quakes', kind, 'quakeFilters', ['earthquake', 'explosion'], 70, look);

  it('lists the values given, grey under the others, in colour those picked, with counts', () => {
    expect(() => parseSpec(spec as never)).not.toThrow();
    expect(spec.yDomain).toEqual(['earthquake', 'explosion']);
    expect(spec.plot.map((p) => ('mark' in p ? p.mark : p.select))).toEqual(['barX', 'toggleY', 'barX', 'text']);
    expect(spec.plot[2]).toMatchObject({ data: { filterBy: '$quakeFilters__all' }, pointerEvents: 'none' });
    expect(spec.plot[3]).toMatchObject({ data: { filterBy: '$quakeFilters' }, text: { count: null } });
    expect(spec.height).toBe(2 * 20 + 8);
  });
});

describe('labelWidth', () => {
  it('fits the longest value, within a third of the width', () => {
    expect(labelWidth(['ab'], 300)).toBe(32);
    expect(labelWidth(['quarry blast'], 300)).toBe(86);
    expect(labelWidth(['x'.repeat(200)], 300)).toBe(100);
  });
});

describe('controlLinks', () => {
  it('writes a range’s ends, a list’s and a search’s variable, and nothing for an area or a link', () => {
    const filters: FilterDeclaration[] = [
      mag,
      { name: 'kind', type: 'in', column: 'type', variable: 'kinds' },
      { name: 'net', type: 'equals', column: 'net', variable: 'net' },
      { name: 'place', type: 'search', column: 'place', variable: 'q' },
      { name: 'drawn', type: 'area', variable: 'area', lat: 'lat', lng: 'lng' },
    ];
    expect(controlLinks(filters, 's')).toEqual([
      { param: 's', column: 'mag', from: 'mag_lo', to: 'mag_hi' },
      { param: 's', column: 'type', variable: 'kinds' },
      { param: 's', column: 'net', variable: 'net' },
      { param: 's', column: 'place', variable: 'q' },
    ]);
  });
});
