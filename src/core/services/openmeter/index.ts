// src/core/services/openmeter/index.ts
import { OpenMeter as OpenMeterClient } from '@openmeter/sdk';
import { config } from '@/config/config';

export interface UsageEventInput {
	/** Meter event type — must match an OpenMeter meter's `eventType` to aggregate (e.g. `mcp_calls`). */
	type: string;
	/** Usage subject (user / customer id). Defaults to the signed-in user, then `anonymous`. */
	subject?: string;
	/** Numeric usage written to `data.value` (meters read `$.value` by default). */
	value?: number;
	/** Extra dimensions merged into the event data. */
	data?: Record<string, unknown>;
}

interface UsageCloudEvent {
	specversion: '1.0';
	id: string;
	source: string;
	type: string;
	subject: string;
	/** SDK serializes `Date` to an RFC 3339 string on the wire. */
	time: Date;
	data: Record<string, unknown>;
}

let clientInstance: OpenMeterClient | null = null;

/** Shared singleton for the OpenMeter API (event ingest + meter queries). `null` when disabled. */
export function getOpenMeterClient(): OpenMeterClient | null {
	if (!config.openmeter.enabled) return null;
	if (!clientInstance) {
		clientInstance = new OpenMeterClient({
			baseUrl: config.openmeter.baseUrl,
			...(config.openmeter.apiKey ? { apiKey: config.openmeter.apiKey } : {}),
		});
	}
	return clientInstance;
}

/**
 * Resolves the usage subject from the persisted user — the same `user` key the
 * UserProvider writes, read-only here. Falls back to `anonymous` when logged out.
 */
export function resolveUsageSubject(): string {
	try {
		const raw = localStorage.getItem('user');
		if (raw) {
			const user = JSON.parse(raw) as { id?: string; email?: string; tenant?: { id?: string } };
			if (user?.id) return user.id;
			if (user?.email) return user.email;
			if (user?.tenant?.id) return user.tenant.id;
		}
	} catch {
		// corrupted payload — treat as anonymous
	}
	return 'anonymous';
}

/** Builds the CloudEvents 1.0 payload accepted by `POST /api/v1/events`. */
function toCloudEvent(input: UsageEventInput): UsageCloudEvent {
	return {
		specversion: '1.0',
		id: crypto.randomUUID(),
		source: typeof window !== 'undefined' ? window.location.origin : 'flexprice-frontend',
		type: input.type,
		subject: input.subject ?? resolveUsageSubject(),
		time: new Date(),
		data: { value: input.value ?? 1, ...input.data },
	};
}

/**
 * Ingests usage events into OpenMeter. Fire-and-forget telemetry: never throws, so
 * metering outages cannot break the calling feature. Safe outside React (e.g. from
 * `src/agent/webmcp.ts`); React components should prefer `useUsageTracking`.
 */
export async function ingestUsageEvents(inputs: UsageEventInput[], client: OpenMeterClient | null = getOpenMeterClient()): Promise<void> {
	if (!config.openmeter.enabled || inputs.length === 0 || !client) return;
	try {
		await client.events.ingest(inputs.map(toCloudEvent));
	} catch (err) {
		console.warn('[openmeter] failed to ingest usage events:', err);
	}
}

export type { OpenMeterClient };
export type OpenMeterMeter = NonNullable<Awaited<ReturnType<OpenMeterClient['meters']['list']>>>[number];
export type MeterQueryResult = Awaited<ReturnType<OpenMeterClient['meters']['query']>>;

/**
 * Mutation 用：拿不到客户端说明是配置问题而非可降级场景，显式抛错（读操作走 `getOpenMeterClient` 优雅降级）。
 */
export function requireOpenMeterClient(): OpenMeterClient {
	const client = getOpenMeterClient();
	if (!client) throw new Error('OpenMeter is disabled (VITE_OPENMETER_ENABLED=false)');
	return client;
}
