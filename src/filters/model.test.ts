import { crossfilterSource, filtersVariables, pickVariable, urlFirst } from './model';

const declared = {
  name: 'quakeFilters',
  query: {
    kind: 'filters',
    dataset: '$quakes',
    filters: [
      { name: 'mag', type: 'range', column: 'mag', from: '$mag_lo', to: '$mag_hi' },
      { name: 'kind', type: 'in', column: 'type', variable: '$kinds' },
    ],
  },
};

describe('filtersVariables', () => {
  it('keeps the filters variables, with the dataset variable they name', () => {
    const found = filtersVariables([
      { name: 'quakes', query: { kind: 'dataset', name: 'quakes' } },
      declared,
      { name: 'text', query: 'a,b' },
      null,
    ]);
    expect(found).toEqual([{ name: 'quakeFilters', dataset: 'quakes', authored: declared.query.filters }]);
  });

  it('skips one whose dataset is not a $reference', () => {
    expect(filtersVariables([{ name: 'f', query: { kind: 'filters', dataset: 'quakes', filters: [] } }])).toEqual([]);
  });
});

describe('pickVariable', () => {
  const one = filtersVariables([declared]);
  it('takes the only one when none is named', () => {
    expect(pickVariable(one, '')?.name).toBe('quakeFilters');
  });
  it('takes the one named, written bare or as $name', () => {
    expect(pickVariable(one, '$quakeFilters')?.name).toBe('quakeFilters');
    expect(pickVariable(one, '${quakeFilters}')?.name).toBe('quakeFilters');
    expect(pickVariable(one, 'other')).toBeUndefined();
  });
  it('takes none of several unless named', () => {
    expect(pickVariable([...one, { ...one[0], name: 'b' }], '')).toBeUndefined();
  });
});

describe('urlFirst', () => {
  const fallback = (name: string) => (name === 'kinds' ? ['x'] : name === 'mag_lo' ? '1' : undefined);
  it('reads the URL, one value or several, an empty one included', () => {
    const value = urlFirst(new URLSearchParams('var-kinds=a&var-kinds=b&var-mag_lo='), fallback);
    expect(value('kinds')).toEqual(['a', 'b']);
    expect(value('mag_lo')).toBe('');
  });
  it('falls back for a variable the URL does not hold', () => {
    const value = urlFirst(new URLSearchParams(''), fallback);
    expect(value('kinds')).toEqual(['x']);
    expect(value('nope')).toBeUndefined();
  });
});

describe('crossfilterSource', () => {
  const variables = filtersVariables([declared]);
  const loaded = [{ name: 'quakes', table: 't_quakes_1', rows: 10, loadedAt: 1 }];
  const value = (name: string) => ({ quakes: 't_quakes_1', mag_lo: '', mag_hi: '', kinds: [] })[name];

  it('declares the dataset whose table its dataset variable holds', () => {
    const dataset = crossfilterSource(variables, loaded, value).dataset('quakes');
    expect(dataset?.table).toBe('t_quakes_1');
    expect(dataset?.filters.map((f) => f.name)).toEqual(['mag', 'kind']);
    expect(dataset?.filters[0]).toMatchObject({ from: 'mag_lo', to: 'mag_hi' });
  });

  it('knows no dataset that is not loaded', () => {
    expect(crossfilterSource(variables, [], value).dataset('quakes')).toBeUndefined();
  });
});
