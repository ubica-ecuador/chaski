import { datasetNames, fitToPanel, parseSpecText } from './spec';

describe('parseSpecText', () => {
  it('reads JSON and YAML alike', () => {
    expect(parseSpecText('{"plot": [{"mark": "dot"}]}')).toEqual({ plot: [{ mark: 'dot' }] });
    expect(parseSpecText('plot:\n  - mark: dot\n')).toEqual({ plot: [{ mark: 'dot' }] });
  });

  it('says what is wrong', () => {
    expect(() => parseSpecText('  ')).toThrow('empty');
    expect(() => parseSpecText('{"plot": ')).toThrow('does not parse');
    expect(() => parseSpecText('- a\n- b')).toThrow('must be an object');
  });
});

describe('datasetNames', () => {
  it('lists the bare tables the spec reads, once each', () => {
    const spec = {
      vconcat: [
        { plot: [{ mark: 'rectY', data: { from: 'quakes', filterBy: '$brush' } }] },
        { plot: [{ mark: 'dot', data: { from: 'quakes' } }] },
        { input: 'table', from: 'places' },
      ],
    };
    expect(datasetNames(spec)).toEqual(['quakes', 'places']);
  });

  it('leaves out the spec’s own data and qualified names', () => {
    const spec = {
      data: { local: { query: 'SELECT 1' } },
      hconcat: [
        { plot: [{ mark: 'dot', data: { from: 'local' } }] },
        { plot: [{ mark: 'dot', data: { from: 'explore.big' } }] },
      ],
    };
    expect(datasetNames(spec)).toEqual([]);
  });
});

describe('fitToPanel', () => {
  it('fills the panel with a single plot, unless it is sized', () => {
    expect(fitToPanel({ plot: [] }, 600, 300)).toEqual({ plot: [], width: 600, height: 300 });
    expect(fitToPanel({ plot: [], width: 200 }, 600, 300)).toEqual({ plot: [], width: 200, height: 300 });
  });

  it('shares a column between the plots and tables left unsized', () => {
    const fitted = fitToPanel(
      { vconcat: [{ plot: [] }, { plot: [], height: 100 }, { input: 'menu' }, { input: 'table' }] },
      600,
      500
    );
    const items = fitted.vconcat as Array<Record<string, unknown>>;
    // 500 - 100 fixed - 4 gaps of 8 = 368, shared by two.
    expect(items.map((item) => item.height)).toEqual([184, 100, undefined, 184]);
    expect(items.map((item) => item.width)).toEqual([592, 592, undefined, 592]);
  });

  it('shares a row across hconcat', () => {
    const fitted = fitToPanel({ hconcat: [{ plot: [] }, { plot: [] }] }, 400, 200);
    expect(fitted.hconcat).toEqual([
      { plot: [], width: 192, height: 192 },
      { plot: [], width: 192, height: 192 },
    ]);
  });

  it('keeps anything else as written', () => {
    const spec = { vconcat: [{ hconcat: [{ plot: [] }] }] };
    expect(fitToPanel(spec, 400, 200)).toEqual(spec);
  });
});
