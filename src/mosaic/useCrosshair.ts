import { useEffect } from 'react';
import { DashboardCursorSync } from '@grafana/data';
import { usePanelContext, useTheme2 } from '@grafana/ui';

import { linkCrosshair } from './crosshair';

/**
 * Grafana's shared crosshair on the time plots under root, when the dashboard shares it
 * (Graph tooltip: Shared crosshair or Shared tooltip), as a time series takes part in it.
 */
export function useCrosshair(root: Element | null) {
  const { eventBus, sync } = usePanelContext();
  const colour = useTheme2().colors.text.primary;
  const shared = (sync?.() ?? DashboardCursorSync.Off) !== DashboardCursorSync.Off;
  useEffect(
    () => (root && shared ? linkCrosshair(root, eventBus, colour) : undefined),
    [root, eventBus, shared, colour]
  );
}
