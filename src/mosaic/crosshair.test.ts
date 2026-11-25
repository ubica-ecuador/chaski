import { DataHoverClearEvent, DataHoverEvent, EventBusSrv } from '@grafana/data';

import { drawCrosshair, linkCrosshair, timeAt, timePlots } from './crosshair';

const T0 = Date.UTC(2026, 10, 24);
const HOUR = 3600_000;

/** An Observable Plot figure, as far as the crosshair reads it: an svg with scale(). */
function plot(type = 'utc') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '200');
  svg.setAttribute('height', '100');
  // 48 hours over x 20..180; the frame from y 10 to 80.
  const x = {
    type,
    range: [20, 180],
    apply: (d: unknown) => 20 + ((Number(d) - T0) / (48 * HOUR)) * 160,
    invert: (px: number) => new Date(T0 + ((px - 20) / 160) * 48 * HOUR),
  };
  Object.assign(svg, {
    scale: (name: string) => {
      if (name === 'x') {
        return x;
      }
      if (name === 'y') {
        return { type: 'linear', range: [80, 10], apply: Number };
      }
      throw new Error(`no ${name} scale`);
    },
  });
  return svg;
}

const lineOf = (svg: Element) => svg.querySelector('line.chaski-crosshair');

describe('crosshair', () => {
  beforeAll(() => {
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return 1;
    });
  });

  it('finds the plots whose x axis is a time', () => {
    const root = document.createElement('div');
    root.append(plot(), plot('linear'), document.createElementNS('http://www.w3.org/2000/svg', 'svg'));
    expect(timePlots(root)).toHaveLength(1);
    expect(timePlots(root)[0]).toMatchObject({ top: 10, bottom: 80 });
  });

  it('draws a line at the time across the frame, and hides it outside the axis or with none', () => {
    const root = document.createElement('div');
    const svg = plot();
    root.append(svg);
    drawCrosshair(root, T0 + 24 * HOUR, '#ccc');
    const line = lineOf(svg)!;
    expect([line.getAttribute('x1'), line.getAttribute('y1'), line.getAttribute('y2')]).toEqual(['100', '10', '80']);
    expect(line.getAttribute('visibility')).toBe('visible');
    drawCrosshair(root, T0 + 72 * HOUR, '#ccc');
    expect(line.getAttribute('visibility')).toBe('hidden');
    drawCrosshair(root, T0, '#ccc');
    expect(svg.querySelectorAll('line.chaski-crosshair')).toHaveLength(1);
    drawCrosshair(root, undefined, '#ccc');
    expect(line.getAttribute('visibility')).toBe('hidden');
  });

  it('reads the time under the pointer, and none off the axis', () => {
    const root = document.createElement('div');
    const svg = plot();
    const inner = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    svg.append(inner);
    root.append(svg);
    expect(timeAt(root, inner, 100)).toBe(T0 + 24 * HOUR);
    expect(timeAt(root, inner, 5)).toBeUndefined();
    expect(timeAt(root, root, 100)).toBeUndefined();
  });

  it('follows the other panels and publishes its own, never answering itself', () => {
    const dashboard = new EventBusSrv();
    const mine = dashboard.newScopedBus('mosaic', { onlyLocal: false });
    const root = document.createElement('div');
    const svg = plot();
    root.append(svg);
    document.body.append(root);
    const heard: Array<DataHoverEvent | DataHoverClearEvent> = [];
    const watch = [
      dashboard.getStream(DataHoverEvent).subscribe((e) => heard.push(e)),
      dashboard.getStream(DataHoverClearEvent).subscribe((e) => heard.push(e)),
    ];
    const stop = linkCrosshair(root, mine, '#ccc');

    // A time series elsewhere (uPlot tags its events).
    dashboard.publish(new DataHoverEvent({ point: { time: T0 + 12 * HOUR } }).setTags(['uplot']));
    expect(lineOf(svg)?.getAttribute('x1')).toBe('60');
    dashboard.publish(new DataHoverClearEvent());
    expect(lineOf(svg)?.getAttribute('visibility')).toBe('hidden');

    // The pointer here: the line moves and the time goes out, once.
    heard.length = 0;
    svg.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 140 }));
    expect(lineOf(svg)?.getAttribute('x1')).toBe('140');
    expect(heard.filter((e) => e instanceof DataHoverEvent).map((e) => e.payload.point.time)).toEqual([T0 + 36 * HOUR]);
    expect(lineOf(svg)?.getAttribute('visibility')).toBe('visible');
    root.dispatchEvent(new MouseEvent('pointerleave'));
    expect(heard.some((e) => e instanceof DataHoverClearEvent)).toBe(true);

    stop();
    dashboard.publish(new DataHoverEvent({ point: { time: T0 + 12 * HOUR } }));
    expect(lineOf(svg)?.getAttribute('visibility')).toBe('hidden');
    watch.forEach((w) => w.unsubscribe());
    root.remove();
  });
});
