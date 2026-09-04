// src/hooks/usePageViewTracking.ts
import { useEffect } from 'react';
import { useLocation } from 'react-router';
import { useUsageTracking } from './useUsageTracking';

/**
 * Event type of the SPA navigation feed. OpenMeter stores it even without a meter;
 * declare a meter with this `eventType` (SUM aggregation) to aggregate page views.
 */
export const PAGE_VIEW_EVENT_TYPE = 'frontend_page_views';

/** Sends one OpenMeter event per SPA navigation. Mount inside the router layout (MainLayout). */
export function usePageViewTracking() {
	const { pathname } = useLocation();
	const { trackUsage } = useUsageTracking();

	useEffect(() => {
		trackUsage({ type: PAGE_VIEW_EVENT_TYPE, data: { path: pathname } });
	}, [pathname, trackUsage]);
}
