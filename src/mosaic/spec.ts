import { parse as parseYaml } from 'yaml';

/** A Mosaic spec as its JSON reads; parseSpec checks it further. */
export type Spec = Record<string, unknown>;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A spec written as JSON or YAML. Throws with a message for the panel. */
export function parseSpecText(text: string): Spec {
  const source = text.trim();
  if (source === '') {
    throw new Error('The spec is empty.');
  }
  let value: unknown;
  try {
    value = source.startsWith('{') ? JSON.parse(source) : parseYaml(source);
  } catch (error) {
    throw new Error(`The spec does not parse: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isObject(value)) {
    throw new Error('The spec must be an object, such as one with `plot`, `vconcat` or `hconcat`.');
  }
  return value;
}

/**
 * The tables a spec reads by a bare name, which on Chaski's explorer
 * connections are the dashboard's datasets: every `from` that is not one of
 * the spec's own `data` definitions. A qualified name (`explore.t`) is not a
 * dataset; note that a spec quotes it whole, so it does not resolve anyway.
 */
export function datasetNames(spec: Spec): string[] {
  const own = new Set(isObject(spec.data) ? Object.keys(spec.data) : []);
  const names = new Set<string>();
  const walk = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(walk);
    } else if (isObject(node)) {
      for (const [key, value] of Object.entries(node)) {
        if (key === 'from' && typeof value === 'string' && /^[A-Za-z_]\w*$/.test(value) && !own.has(value)) {
          names.add(value);
        } else {
          walk(value);
        }
      }
    }
  };
  // The definitions under the top-level `data` are the spec's own tables, not reads.
  walk({ ...spec, data: undefined });
  return [...names];
}

/** Room the panel keeps around a stacked layout's items. */
const GAP = 8;

/** A plot or a table: what takes a size from the panel. */
const sized = (node: unknown): boolean => isObject(node) && ('plot' in node || node.input === 'table');

/**
 * The spec sized to the panel, where it leaves a size open: a single plot
 * fills the panel; in a top-level `vconcat` or `hconcat`, the plots and tables
 * without a height (or width) share what the sized ones leave, and take the
 * panel's other dimension whole. Anything deeper keeps its own sizes.
 */
export function fitToPanel(spec: Spec, width: number, height: number): Spec {
  const w = Math.max(80, Math.floor(width));
  const h = Math.max(60, Math.floor(height));
  if (sized(spec)) {
    return { ...spec, width: spec.width ?? w, height: spec.height ?? h };
  }
  for (const [layout, along, across] of [
    ['vconcat', 'height', 'width'],
    ['hconcat', 'width', 'height'],
  ] as const) {
    const items = spec[layout];
    if (!Array.isArray(items)) {
      continue;
    }
    const total = layout === 'vconcat' ? h : w;
    const other = layout === 'vconcat' ? w : h;
    const nodes = items as unknown[];
    const sizeOf = (item: unknown) =>
      isObject(item) && typeof item[along] === 'number' ? (item[along] as number) : undefined;
    const open = nodes.filter((item) => sized(item) && sizeOf(item) === undefined);
    const fixed = nodes.reduce<number>((sum, item) => sum + (sizeOf(item) ?? 0), 0);
    const share = open.length > 0 ? Math.max(40, Math.floor((total - fixed - GAP * nodes.length) / open.length)) : 0;
    return {
      ...spec,
      [layout]: nodes.map((item) =>
        sized(item) && isObject(item)
          ? { ...item, [along]: item[along] ?? share, [across]: item[across] ?? other - GAP }
          : item
      ),
    };
  }
  return spec;
}
