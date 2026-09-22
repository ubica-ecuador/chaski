/** @jest-environment node */
import { SchemaCache } from './schemaCache';

const entry = (name: string) => ({ columns: [{ name, type: 'INTEGER' }], shape: name, asserted: [] });

describe('SchemaCache', () => {
  it('keeps at most its limit, forgetting the least recently used first', () => {
    const cache = new SchemaCache(2);
    cache.set('a', entry('a'));
    cache.set('b', entry('b'));
    expect(cache.get('a')).toEqual(entry('a'));
    cache.set('c', entry('c'));
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toEqual(entry('a'));
    expect(cache.get('c')).toEqual(entry('c'));
  });
});
