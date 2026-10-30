import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';

/*
 * Mosaic in Grafana's colours. Observable Plot draws axes and text in
 * currentColor and reads --plot-background for tips; Mosaic's inputs come
 * unstyled, so these rules follow its widget stylesheet with theme tokens.
 */
export const getStyles = (theme: GrafanaTheme2) => ({
  root: css({
    position: 'relative',
    width: '100%',
    height: '100%',
    overflow: 'auto',
    // A spec's style cannot lift a plot out of its panel: with paint containment a position: fixed
    // drawing is placed and clipped inside the panel, not laid over Grafana.
    contain: 'paint',
    color: theme.colors.text.primary,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.bodySmall.fontSize,

    '[class^="plot-"], [class*=" plot-"]': {
      '--plot-background': theme.colors.background.primary,
    },
    svg: { overflow: 'visible' },

    '.input': {
      display: 'inline-flex',
      alignItems: 'center',
      gap: theme.spacing(1),
      marginRight: theme.spacing(2),
    },
    'select, input[type="text"], input[type="search"]': {
      maxWidth: '14em',
      height: theme.spacing(theme.components.height.sm),
      padding: theme.spacing(0, 1),
      color: theme.colors.text.primary,
      background: theme.components.input.background,
      border: `1px solid ${theme.components.input.borderColor}`,
      borderRadius: theme.shape.radius.default,
    },
    'input[type="range"]': { accentColor: theme.colors.primary.main },

    table: {
      position: 'relative',
      tableLayout: 'fixed',
      borderCollapse: 'separate',
      borderSpacing: 0,
      fontVariantNumeric: 'tabular-nums',
      width: '100%',
      margin: 0,
    },
    'thead tr th': {
      position: 'sticky',
      top: 0,
      background: theme.colors.background.primary,
      color: theme.colors.text.primary,
      fontWeight: theme.typography.fontWeightMedium,
      textAlign: 'left',
      cursor: 'ns-resize',
      borderBottom: `1px solid ${theme.colors.border.medium}`,
    },
    'td, th': {
      whiteSpace: 'nowrap',
      textOverflow: 'ellipsis',
      overflow: 'hidden',
      padding: theme.spacing(0.5, 1, 0.5, 0),
    },
    td: {
      color: theme.colors.text.secondary,
      verticalAlign: 'top',
      borderBottom: `1px solid ${theme.colors.border.weak}`,
    },
    'tbody tr:hover': { background: theme.colors.action.hover },
  }),
  loading: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    color: theme.colors.text.secondary,
  }),
  message: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
    justifyContent: 'center',
    height: '100%',
    padding: theme.spacing(2),
    color: theme.colors.text.secondary,
    code: { color: theme.colors.text.primary },
  }),
  error: css({
    color: theme.colors.error.text,
    whiteSpace: 'pre-wrap',
    overflow: 'auto',
  }),
  problem: css({
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1,
    maxHeight: '40%',
    overflow: 'auto',
    padding: theme.spacing(0.5, 1),
    color: theme.colors.error.text,
    background: theme.colors.background.primary,
    borderBottom: `1px solid ${theme.colors.error.border}`,
    fontSize: theme.typography.bodySmall.fontSize,
    whiteSpace: 'pre-wrap',
  }),
});
