import { DataHoverClearEvent, DataHoverEvent, type EventBus } from '@grafana/data';

/** What an Observable Plot figure tells of one of its scales (figure.scale(name)). */
export interface PlotScale {
  type?: string;
  range?: unknown[];
  apply: (value: unknown) => number;
  invert?: (pixel: number) => unknown;
}
type PlotFigure = Element & { scale?: (name: string) => PlotScale | undefined };

/** A plot whose x axis is a time: where the crosshair goes. */
export interface TimePlot {
  svg: SVGSVGElement;
  x: PlotScale;
  /** The plot's frame, top to bottom, in the svg's own units. */
  top: number;
  bottom: number;
}

const TIME_SCALES = new Set(['utc', 'time']);
const CLASS = 'chaski-crosshair';

const scaleOf = (figure: PlotFigure, name: string): PlotScale | undefined => {
  try {
    return figure.scale?.(name);
  } catch {
    // Plot throws for a scale the figure does not have.
    return undefined;
  }
};

/** The figure's plot itself: its largest svg (a legend's ramp is an svg too). */
const mainSvg = (figure: Element): SVGSVGElement | undefined => {
  if (figure instanceof SVGSVGElement) {
    return figure;
  }
  const area = (svg: SVGSVGElement) => Number(svg.getAttribute('width') ?? 0) * Number(svg.getAttribute('height') ?? 0);
  return [...figure.querySelectorAll<SVGSVGElement>(':scope > svg')].sort((a, b) => area(b) - area(a))[0];
};

/** The plot drawn by figure, when its x axis is a time. */
export function timePlotOf(figure: Element): TimePlot | undefined {
  const plot = figure as PlotFigure;
  if (typeof plot.scale !== 'function') {
    return undefined;
  }
  const x = scaleOf(plot, 'x');
  const svg = mainSvg(figure);
  if (!x || !svg || !TIME_SCALES.has(x.type ?? '')) {
    return undefined;
  }
  const height = Number(svg.getAttribute('height') ?? 0);
  const ys = (scaleOf(plot, 'y')?.range ?? []).map(Number).filter(Number.isFinite);
  return ys.length >= 2
    ? { svg, x, top: Math.min(...ys), bottom: Math.max(...ys) }
    : { svg, x, top: 0, bottom: height };
}

/** Every plot under root whose x axis is a time. */
export function timePlots(root: Element): TimePlot[] {
  const figures = [...root.querySelectorAll('svg, figure')].filter(
    (el) => typeof (el as PlotFigure).scale === 'function'
  );
  return figures.map(timePlotOf).filter((p): p is TimePlot => p !== undefined);
}

const between = (value: number, ends: unknown[] | undefined) => {
  const [a, b] = (ends ?? []).map(Number);
  return !Number.isFinite(a) || !Number.isFinite(b) || (value >= Math.min(a, b) - 0.5 && value <= Math.max(a, b) + 0.5);
};

/** The crosshair on every time plot under root at time (ms), or none with undefined. */
export function drawCrosshair(root: Element, time: number | undefined, colour: string) {
  for (const plot of timePlots(root)) {
    let line = plot.svg.querySelector<SVGLineElement>(`:scope > line.${CLASS}`);
    const x = time === undefined ? NaN : plot.x.apply(new Date(time));
    if (!Number.isFinite(x) || !between(x, plot.x.range)) {
      line?.setAttribute('visibility', 'hidden');
      continue;
    }
    if (!line) {
      line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('class', CLASS);
      line.setAttribute('stroke-width', '1');
      line.setAttribute('stroke-dasharray', '3 3');
      line.setAttribute('pointer-events', 'none');
      plot.svg.appendChild(line);
    }
    line.setAttribute('stroke', colour);
    line.setAttribute('x1', String(x));
    line.setAttribute('x2', String(x));
    line.setAttribute('y1', String(plot.top));
    line.setAttribute('y2', String(plot.bottom));
    line.setAttribute('visibility', 'visible');
  }
}

/** The time (ms) under the pointer in a time plot under root, if it is over one. */
export function timeAt(root: Element, target: EventTarget | null, clientX: number): number | undefined {
  if (!(target instanceof Element)) {
    return undefined;
  }
  for (let el: Element | null = target; el && root.contains(el); el = el.parentElement) {
    const plot = timePlotOf(el);
    if (!plot) {
      continue;
    }
    const box = plot.svg.getBoundingClientRect();
    const width = Number(plot.svg.getAttribute('width') ?? box.width);
    // CSS may draw the svg narrower than its own width.
    const pixel = (clientX - box.left) * (box.width > 0 ? width / box.width : 1);
    if (!between(pixel, plot.x.range)) {
      return undefined;
    }
    const at = plot.x.invert?.(pixel);
    const ms = at instanceof Date ? at.getTime() : Number(at);
    return Number.isFinite(ms) ? ms : undefined;
  }
  return undefined;
}

/**
 * Grafana's shared crosshair on the time plots under root: a dashed line at the time another panel
 * hovers (a time series, a map's cards), and the time under the pointer published for them. As the
 * time series panel does, it ignores the events it published itself. Returns the cleanup.
 */
export function linkCrosshair(root: Element, eventBus: EventBus, colour: string): () => void {
  let frame: number | undefined;
  let pending: number | undefined;
  const publish = () => {
    frame = undefined;
    if (pending !== undefined) {
      eventBus.publish(new DataHoverEvent({ point: { time: pending } }));
    }
  };
  const move = (event: Event) => {
    const time = timeAt(root, event.target, (event as PointerEvent).clientX);
    if (time === undefined) {
      return;
    }
    drawCrosshair(root, time, colour);
    pending = time;
    frame ??= requestAnimationFrame(publish);
  };
  const leave = () => {
    pending = undefined;
    drawCrosshair(root, undefined, colour);
    eventBus.publish(new DataHoverClearEvent());
  };
  root.addEventListener('pointermove', move);
  root.addEventListener('pointerleave', leave);
  const hovers = eventBus.getStream(DataHoverEvent).subscribe({
    next: (event) => {
      // A time series' events carry uPlot's tag: those are the ones to follow here.
      if (event.origin === eventBus) {
        return;
      }
      const time = Number(event.payload?.point?.time);
      drawCrosshair(root, Number.isFinite(time) ? time : undefined, colour);
    },
  });
  const clears = eventBus.getStream(DataHoverClearEvent).subscribe({
    next: (event) => {
      if (event.origin !== eventBus) {
        drawCrosshair(root, undefined, colour);
      }
    },
  });
  return () => {
    root.removeEventListener('pointermove', move);
    root.removeEventListener('pointerleave', leave);
    hovers.unsubscribe();
    clears.unsubscribe();
    if (frame !== undefined) {
      cancelAnimationFrame(frame);
    }
  };
}
