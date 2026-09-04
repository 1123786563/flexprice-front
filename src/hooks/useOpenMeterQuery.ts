// src/hooks/useOpenMeterQuery.ts
import { useQuery } from '@tanstack/react-query';
import { config } from '@/config/config';
import { getOpenMeterClient, OpenMeterClient, OpenMeterMeter, MeterQueryResult } from '@/core/services/openmeter';

export interface MeterUsageParams {
	/** RFC 3339 start (inclusive). Defaults to 30 days ago. */
	from?: string;
	/** RFC 3339 end (inclusive). */
	to?: string;
	/** Time bucket size; omitted = a single total for the period. */
	windowSize?: 'MINUTE' | 'HOUR' | 'DAY';
}

export const openMeterQueryKeys = {
	meters: ['openmeter', 'meters'] as const,
	meter: (idOrSlug: string) => ['openmeter', 'meter', idOrSlug] as const,
	usage: (meterSlug: string, params: MeterUsageParams) => ['openmeter', 'usage', meterSlug, params] as const,
	usagePost: (meterSlug: string, body: MeterQueryPostBody) => ['openmeter', 'usage-post', meterSlug, body] as const,
};

/** `POST /api/v1/meters/{slug}/query` 的请求体（from/to、groupBy、filters…），随 SDK 类型走。 */
export type MeterQueryPostBody = NonNullable<Parameters<OpenMeterClient['meters']['queryPost']>[1]>;

const DEFAULT_FROM_MS = 30 * 24 * 60 * 60 * 1000;

/** Lists every meter defined in the connected OpenMeter backend. Empty (not error) when disabled. */
export function useOpenMeterMeters() {
	return useQuery<OpenMeterMeter[]>({
		queryKey: openMeterQueryKeys.meters,
		queryFn: async () => {
			const client = getOpenMeterClient();
			if (!client) return [];
			return (await client.meters.list()) ?? [];
		},
		enabled: config.openmeter.enabled,
	});
}

/** 按 ID 或 slug 取单个计量表（GET /api/v1/meters/{idOrSlug}）。禁用时为 null。 */
export function useOpenMeterMeter(idOrSlug: string) {
	return useQuery<OpenMeterMeter | null>({
		queryKey: openMeterQueryKeys.meter(idOrSlug),
		queryFn: async () => {
			const client = getOpenMeterClient();
			if (!client) return null;
			return (await client.meters.get(idOrSlug)) ?? null;
		},
		enabled: config.openmeter.enabled && Boolean(idOrSlug),
	});
}

/** 复杂用量查询走 POST（条件过多超出 URL 长度时）。SDK 的返回类型含 text/csv 的 string 分支，前端只消费 JSON 行。 */
export function useOpenMeterUsagePost(idOrSlug: string, body: MeterQueryPostBody = {}) {
	return useQuery<MeterQueryResult>({
		queryKey: openMeterQueryKeys.usagePost(idOrSlug, body),
		queryFn: async (): Promise<MeterQueryResult> => {
			const client = getOpenMeterClient();
			if (!client) return { data: [] };
			return ((await client.meters.queryPost(idOrSlug, body)) ?? { data: [] }) as MeterQueryResult;
		},
		enabled: config.openmeter.enabled && Boolean(idOrSlug),
	});
}

/** Queries aggregated usage for one meter through the OpenMeter admin API. */
export function useOpenMeterUsage(meterSlug: string, params: MeterUsageParams = {}) {
	return useQuery<MeterQueryResult>({
		queryKey: openMeterQueryKeys.usage(meterSlug, params),
		queryFn: async () => {
			const client = getOpenMeterClient();
			if (!client) return { data: [] };
			const from = params.from ?? new Date(Date.now() - DEFAULT_FROM_MS).toISOString();
			return client.meters.query(meterSlug, { from, to: params.to, windowSize: params.windowSize });
		},
		enabled: config.openmeter.enabled && Boolean(meterSlug),
	});
}
