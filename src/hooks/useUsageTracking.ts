// src/hooks/useUsageTracking.ts
import { useCallback } from 'react';
import { config } from '@/config/config';
import { ingestUsageEvents, UsageEventInput } from '@/core/services/openmeter';

/** Tracks a product-usage event into OpenMeter from React code. No-op when disabled. */
export function useUsageTracking() {
	const trackUsage = useCallback((input: UsageEventInput) => {
		if (!config.openmeter.enabled) return;
		void ingestUsageEvents([input]);
	}, []);
	return { trackUsage };
}
