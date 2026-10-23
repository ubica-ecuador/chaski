import React from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';

interface TransportProps {
  playing: boolean;
  /** Whether a step back, or forward, has anywhere to go. */
  canBack: boolean;
  canForward: boolean;
  onToggle: () => void;
  onBack: () => void;
  onForward: () => void;
  /** The window the brush holds, as text; empty when none. */
  readout: string;
  /** The filter's colour: the play button's. */
  colour: string;
}

/* Grafana's icon set has no play or pause: these are drawn on a 12-unit grid. */
const ICONS = {
  play: 'M3 1.5v9l7.5-4.5z',
  pause: 'M2.5 1.5h2.5v9h-2.5zM7 1.5h2.5v9h-2.5z',
  back: 'M2 1.5h1.5v9h-1.5zM10.5 1.5v9l-6.5-4.5z',
  forward: 'M8.5 1.5h1.5v9h-1.5zM1.5 1.5v9l6.5-4.5z',
};

const Glyph = ({ path }: { path: string }) => (
  <svg width={12} height={12} viewBox="0 0 12 12" aria-hidden>
    <path d={path} fill="currentColor" />
  </svg>
);

/** Step back, play or pause, step forward, and the window held. */
export function Transport(props: TransportProps) {
  const styles = useStyles2(getStyles);
  const { playing, canBack, canForward, readout, colour } = props;
  return (
    <div className={styles.bar} data-testid="filters-transport">
      <button type="button" className={styles.button} aria-label="Step back" disabled={!canBack} onClick={props.onBack}>
        <Glyph path={ICONS.back} />
      </button>
      <button
        type="button"
        className={`${styles.button} ${styles.play}`}
        style={{ background: colour }}
        aria-label={playing ? 'Pause' : 'Play'}
        aria-pressed={playing}
        onClick={props.onToggle}
      >
        <Glyph path={playing ? ICONS.pause : ICONS.play} />
      </button>
      <button
        type="button"
        className={styles.button}
        aria-label="Step forward"
        disabled={!canForward}
        onClick={props.onForward}
      >
        <Glyph path={ICONS.forward} />
      </button>
      <span className={styles.readout} data-testid="filters-window">
        {readout}
      </span>
    </div>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  bar: css({ display: 'inline-flex', alignItems: 'center', gap: theme.spacing(0.5), flex: 'none' }),
  button: css({
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: theme.spacing(3),
    height: theme.spacing(3),
    padding: 0,
    border: 'none',
    borderRadius: theme.shape.radius.circle,
    background: 'none',
    color: theme.colors.text.secondary,
    cursor: 'pointer',
    '&:hover:not(:disabled)': { color: theme.colors.text.primary, background: theme.colors.action.hover },
    '&:disabled': { color: theme.colors.text.disabled, cursor: 'default' },
    '&:focus-visible': { outline: `2px solid ${theme.colors.primary.main}`, outlineOffset: 1 },
  }),
  play: css({
    color: theme.colors.background.primary,
    '&:hover:not(:disabled)': { color: theme.colors.background.primary, filter: 'brightness(1.1)' },
  }),
  // As wide as the longest window, "2026-09-04 12:00 – 2026-09-07 12:00": the pills after it never move.
  readout: css({
    width: '36ch',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    marginLeft: theme.spacing(0.5),
    color: theme.colors.text.secondary,
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
  }),
});
