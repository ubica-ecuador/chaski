import React, { useEffect, useRef, useState } from 'react';
import type { PanelProps } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';
import { Coordinator, type Logger } from '@uwdata/mosaic-core';
import { astToDOM, parseSpec } from '@uwdata/mosaic-spec';
import { createAPIContext } from '@uwdata/vgplot';

import { linkVariables, parseLinks } from '../bridge';
import { ChaskiConnector, unreadable, waitForEngine } from '../connector';
import { dashboardKey, pageFor, PREAGG_SCHEMA, releaseClauses } from '../page';
import { datasetNames, fitToPanel, parseSpecText } from '../spec';
import type { MosaicOptions } from '../types';
import { getStyles } from './styles';

type Status =
  | { kind: 'starting' }
  | { kind: 'empty'; datasets: string[] }
  | { kind: 'waiting'; missing: string[]; datasets: string[] }
  | { kind: 'error'; message: string }
  | { kind: 'ready' };

function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Cancelled queries are how a rebuild stops the old one, not a failure to show. */
const isCancel = (message: string) => /abort|cancel|^\s*cleared\b/i.test(message);

function panelLogger(onError: (message: string) => void): Logger {
  const quiet = () => {};
  return {
    debug: quiet,
    info: quiet,
    log: quiet,
    group: quiet,
    groupCollapsed: quiet,
    groupEnd: quiet,
    warn: (...args: unknown[]) => console.warn('Mosaic:', ...args),
    error: (...args: unknown[]) => {
      const message = messageOf(args.find((arg) => arg instanceof Error) ?? args[0]);
      if (!isCancel(message)) {
        console.error('Mosaic:', ...args);
        onError(message);
      }
    },
  };
}

export function MosaicPanel({ options, width, height }: PanelProps<MosaicOptions>) {
  const styles = useStyles2(getStyles);
  const host = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>({ kind: 'starting' });
  // Bumped when the dashboard's datasets reload, or a dataset this panel waits for arrives.
  const [rebuild, setRebuild] = useState(0);
  const w = useDebounced(width, 150);
  const h = useDebounced(height, 150);
  const { spec: specText = '', variables = '', preaggregate = true } = options;

  useEffect(() => {
    const abort = new AbortController();
    const alive = () => !abort.signal.aborted;
    // Run in the order added: a panel's brushes are released before its
    // variable links stop, so the links can still publish that release.
    const cleanups: Array<() => void> = [];
    const defer = (cleanup: () => void) => (alive() ? cleanups.push(cleanup) : cleanup());

    const build = async () => {
      const engine = await waitForEngine(abort.signal);
      const page = pageFor(dashboardKey(), engine);
      defer(page.subscribe(() => setRebuild((n) => n + 1)));
      // A panel that lists or waits for datasets builds again when one
      // arrives. It listens before it looks, so one arriving meanwhile counts.
      let awaits: ((name: string) => boolean) | undefined;
      let arrived = false;
      defer(
        engine.onChange((event) => {
          if (event.kind !== 'dataset') {
            return;
          }
          if (awaits === undefined) {
            arrived = true;
          } else if (awaits(event.name)) {
            setRebuild((n) => n + 1);
          }
        })
      );
      const infos = engine.datasets();
      const datasets = infos.map((d) => d.name);

      if (specText.trim() === '') {
        awaits = () => true;
        setStatus({ kind: 'empty', datasets });
        return;
      }
      const spec = parseSpecText(specText);
      const links = parseLinks(variables);
      const names = datasetNames(spec);
      // Listed is not yet readable: a dataset's view comes a moment after its load.
      const missing = await unreadable(engine, names, abort.signal);
      if (missing.length > 0) {
        if (arrived) {
          setRebuild((n) => n + 1);
        } else {
          awaits = (name) => missing.includes(name);
          setStatus({ kind: 'waiting', missing, datasets });
        }
        return;
      }
      awaits = () => false;

      const coordinator = new Coordinator(new ChaskiConnector(engine), {
        logger: panelLogger((message) => alive() && setStatus({ kind: 'error', message })),
        preagg: { schema: PREAGG_SCHEMA, enabled: preaggregate },
      });
      const api = createAPIContext({ coordinator, namedPlots: page.namedPlots as never });
      page.namedPlots ??= api.context.namedPlots;
      defer(() => {
        releaseClauses(page, coordinator.clients);
        coordinator.clear();
      });

      const { element } = await astToDOM(parseSpec(fitToPanel(spec, w, h) as never), {
        api,
        params: page.params as never,
      });
      if (!alive()) {
        return;
      }
      page.read(names, infos);
      host.current?.replaceChildren(element);
      defer(() => host.current?.replaceChildren());
      const unlink = linkVariables(links, page.params);
      defer(() => unlink(dashboardKey() === page.key));
      setStatus({ kind: 'ready' });
    };

    build().catch((error: unknown) => {
      if (alive()) {
        setStatus({ kind: 'error', message: messageOf(error) });
      }
    });
    return () => {
      abort.abort();
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [specText, variables, preaggregate, w, h, rebuild]);

  return (
    <div className={styles.root} data-testid="mosaic-panel">
      {status.kind !== 'ready' && <Message status={status} className={styles.message} errorClass={styles.error} />}
      <div ref={host} />
    </div>
  );
}

function Message({ status, className, errorClass }: { status: Status; className: string; errorClass: string }) {
  const list = (names: string[]) => (names.length > 0 ? names.map((n) => `\`${n}\``).join(', ') : 'none yet');
  switch (status.kind) {
    case 'starting':
      return (
        <div className={className}>
          Waiting for Chaski. A Chaski dataset on this dashboard starts its engine; this panel reads from it.
        </div>
      );
    case 'empty':
      return (
        <div className={className}>
          <div>
            Write a Mosaic spec in this panel&apos;s options. Its tables are the dashboard&apos;s Chaski datasets.
          </div>
          <div>Datasets: {list(status.datasets)}</div>
        </div>
      );
    case 'waiting':
      return (
        <div className={className}>
          <div>Waiting for {list(status.missing)}, which the spec reads.</div>
          <div>Datasets on this dashboard: {list(status.datasets)}</div>
        </div>
      );
    case 'error':
      return (
        <div className={className}>
          <div className={errorClass} data-testid="mosaic-error">
            {status.message}
          </div>
        </div>
      );
    default:
      return null;
  }
}
