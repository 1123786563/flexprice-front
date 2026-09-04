// src/core/services/openmeter/OpenMeterProvider.tsx
import { ReactNode, useMemo } from 'react';
import { OpenMeter as PortalClient, OpenMeterProvider as SdkOpenMeterProvider } from '@openmeter/sdk/react';
import { config } from '@/config/config';

interface Props {
	children: ReactNode;
}

/**
 * Bridges the app into `@openmeter/sdk/react`. The SDK context carries the consumer
 * portal query client — `useOpenMeter()` returns it for metered-usage reads. The
 * self-hosted OpenMeter build ships the portal as a noop adapter (token creation
 * returns 501), so without `VITE_OPENMETER_PORTAL_TOKEN` the value stays `null`;
 * consumers must handle the null return and fall back to `useOpenMeterUsage`,
 * which queries the admin API instead.
 */
export default function OpenMeterProvider({ children }: Props) {
	const portalClient = useMemo(() => {
		if (!config.openmeter.enabled || !config.openmeter.portalToken) return null;
		return new PortalClient({
			baseUrl: config.openmeter.baseUrl,
			portalToken: config.openmeter.portalToken,
		});
	}, []);

	return <SdkOpenMeterProvider value={portalClient}>{children}</SdkOpenMeterProvider>;
}
