import { parseSpec } from '@uwdata/mosaic-spec';

import type { FilterDeclaration, RangeFilter } from '../engine/crossfilter';
import { datasetNames } from '../mosaic/spec';
import { controlLinks, labelWidth, pickParam, rangeSpec, valuesSpec } from './specs';

const look = { fill: '#3d71d9', text: '#ccc', width: 280 };
const mag: RangeFilter = { name: 'mag', type: 'range', column: 'mag', from: 'mag_lo', to: 'mag_hi' };

describe('rangeSpec', () => {
  const spec = rangeSpec('quakes', mag, 'quakeFilters', 40, look);

  it('is a histogram of the column under the other filters, brushed into the shared selection', () => {
    expect(() => parseSpec(spec as never)).not.toThrow();
    expect(datasetNames(spec)).toEqual(['quakes']);
    expect(spec.plot[0]).toMatchObject({
      mark: 'rectY',
      data: { filterBy: '$quakeFilters' },
      x: { bin: 'mag', steps: 40 },
    });
    expect(spec.plot[1]).toMatchObject({ select: 'intervalX', as: '$quakeFilters' });
    expect(spec.params).toEqual({ quakeFilters: { select: 'crossfilter' } });
  });

  it('keeps its x axis and fits its y axis to the rows left', () => {
    expect(spec.xDomain).toBe('Fixed');
    expect(spec).not.toHaveProperty('yDomain');
  });
});

describe('valuesSpec', () => {
  const kind = { name: 'kind', type: 'in', column: 'type', variable: 'kinds' } as const;
  const spec = valuesSpec('quakes', kind, 'quakeFilters', ['earthquake', 'explosion'], 70, look);

  it('lists the values given, toggled into the shared selection and into one that highlights them', () => {
    expect(() => parseSpec(spec as never)).not.toThrow();
    expect(spec.yDomain).toEqual(['earthquake', 'explosion']);
    const picks = pickParam('quakeFilters', 'kind');
    expect(spec.params).toEqual({ quakeFilters: { select: 'crossfilter' }, [picks]: { select: 'single' } });
    expect(spec.plot.filter((p) => 'select' in p).map((p) => p.as)).toEqual(['$quakeFilters', `$${picks}`, undefined]);
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
