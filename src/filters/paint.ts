import type { IntervalInteractor, ToggleInteractor } from './sync';

/*
 * The coloured layer of a control draws the same bars as its grey one, from
 * the same query, and is cut down here, in the page, to what the control's own
 * picks keep: a range clips it to the range its brush holds, a list hides the
 * bars of the values not picked. A query of its own would be one per brush
 * move, and Mosaic waits for each before the next, so the colour fell behind
 * the brush; a clip follows the pointer.
 *
 * Painting reads the control's state, so it runs whenever that or the drawing
 * changes: as a brush moves, after Mosaic draws the plot again (it replaces
 * the SVG), and when the Selection changes (the panel calls `paint`).
 */

/** The coloured layer: the bars the specs draw with no pointer events (Plot labels a rectY "rect", a barX "bar"). */
const COLOURED = 'g[aria-label="rect"][pointer-events="none"], g[aria-label="bar"][pointer-events="none"]';
const SVG_NS = 'http://www.w3.org/2000/svg';

let clips = 0;

/** A plot's SVG, with the scales Observable Plot attaches to it. */
type PlotSvg = SVGSVGElement & { scale?(name: string): { apply(value: unknown): number; domain?: unknown[] } };

interface Painter {
  /** Paints from the control's state. */
  paint(): void;
  /** Stops following the control. */
  stop(): void;
}

const plotOf = (element: HTMLElement) =>
  element.querySelector<PlotSvg>('svg[class*="plot"]') ?? element.querySelector<PlotSvg>('svg');

/** Paints again whenever Mosaic draws the plot again. */
function onRedraw(element: HTMLElement, paint: () => void): () => void {
  const observer = new MutationObserver(() => paint());
  observer.observe(element, { childList: true, subtree: true });
  return () => observer.disconnect();
}

/** The pixels a brush holds, from its value: undefined when it holds none. */
function heldPixels(interactor: IntervalInteractor): [number, number] | undefined {
  const { value, scale } = interactor;
  if (!value || value.length !== 2 || !scale) {
    return undefined;
  }
  const [a, b] = value.map((v) => scale.apply(v));
  return Number.isFinite(a) && Number.isFinite(b) ? [Math.min(a, b), Math.max(a, b)] : undefined;
}

/** A range control: its coloured bars clipped to the range its brush holds, or whole when it holds none. */
export function paintRange(element: HTMLElement, interactor: IntervalInteractor): Painter {
  const id = `chaski-paint-${++clips}`;
  const paint = (pixels = heldPixels(interactor)) => {
    const svg = plotOf(element);
    const layer = svg?.querySelector(COLOURED);
    if (!svg || !layer) {
      return;
    }
    if (!pixels) {
      layer.removeAttribute('clip-path');
      return;
    }
    let rect = svg.querySelector<SVGRectElement>(`#${id} rect`);
    if (!rect) {
      const clip = document.createElementNS(SVG_NS, 'clipPath');
      clip.setAttribute('id', id);
      rect = document.createElementNS(SVG_NS, 'rect');
      rect.setAttribute('y', '0');
      rect.setAttribute('height', '100%');
      clip.appendChild(rect);
      svg.appendChild(clip);
    }
    rect.setAttribute('x', String(pixels[0]));
    rect.setAttribute('width', String(Math.max(0, pixels[1] - pixels[0])));
    layer.setAttribute('clip-path', `url(#${id})`);
  };
  // As the brush moves, from the pixels it reports: after Mosaic's own listener, which keeps its value.
  const brush = interactor.brush as unknown as {
    on(type: string, listener: ((event: { selection: [number, number] | null }) => void) | null): unknown;
  };
  brush.on(`brush.${id} end.${id}`, ({ selection }) =>
    paint(selection ? [Math.min(...selection), Math.max(...selection)] : undefined)
  );
  const stopRedraw = onRedraw(element, () => paint());
  return {
    paint: () => paint(),
    stop: () => {
      brush.on(`brush.${id} end.${id}`, null);
      stopRedraw();
    },
  };
}

/** A list of values: the coloured bars of the values picked, or all of them when none is. */
export function paintValues(element: HTMLElement, toggles: ToggleInteractor[]): Painter {
  const paint = () => {
    const svg = plotOf(element);
    const layer = svg?.querySelector(COLOURED);
    const y = svg?.scale?.('y');
    if (!svg || !layer || !y?.domain) {
      return;
    }
    const picked = new Set(
      toggles.flatMap((t) => t.value ?? []).map((point) => String(Array.isArray(point) ? point[0] : point))
    );
    // A bar's value is the band it starts in: Plot draws one rect per row, at the band's top plus the inset.
    const bands = y.domain.map((v) => ({ value: String(v), at: y.apply(v) }));
    for (const rect of Array.from(layer.querySelectorAll('rect'))) {
      const top = Number(rect.getAttribute('y'));
      const band = bands.reduce((best, b) => (Math.abs(b.at - top) < Math.abs(best.at - top) ? b : best), bands[0]);
      const keep = picked.size === 0 || (band !== undefined && picked.has(band.value));
      if (keep) {
        rect.removeAttribute('display');
      } else {
        rect.setAttribute('display', 'none');
      }
    }
  };
  const stopRedraw = onRedraw(element, paint);
  return { paint, stop: stopRedraw };
}
