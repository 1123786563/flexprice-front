// src/hooks/useOpenMeterEvents.ts
import { useQuery } from '@tanstack/react-query';
import { config } from '@/config/config';
import { getOpenMeterClient, OpenMeterClient } from '@/core/services/openmeter';

/** `GET /api/v1/events` 的查询参数（subject、ingestedAtFrom/To、id、limit…），随 SDK 类型走。 */
export type OpenMeterEventsFilter = NonNullable<Parameters<OpenMeterClient['events']['list']>[0]>;
/** `GET /api/v2/events` 的查询参数（在 v1 基础上增加 cursor/limit 游标分页）。 */
export type OpenMeterEventsV2Filter = NonNullable<Parameters<OpenMeterClient['events']['listV2']>[0]>;

export type OpenMeterIngestedEvent = NonNullable<Awaited<ReturnType<OpenMeterClient['events']['list']>>>[number];
export type OpenMeterIngestedEventsPage = NonNullable<Awaited<ReturnType<OpenMeterClient['events']['listV2']>>>;

export const openMeterEventsKeys = {
	list: (filter: OpenMeterEventsFilter) => ['openmeter', 'events', filter] as const,
	listV2: (filter: OpenMeterEventsV2Filter) => ['openmeter', 'events-v2', filter] as const,
};

/** 列出已摄取的原始事件——核查"什么真正落库了"（区别于聚合后的用量查询）。禁用时返回空数组。 */
export function useOpenMeterEvents(filter: OpenMeterEventsFilter = {}) {
	return useQuery<OpenMeterIngestedEvent[]>({
		queryKey: openMeterEventsKeys.list(filter),
		queryFn: async () => {
			const client = getOpenMeterClient();
			if (!client) return [];
			return (await client.events.list(filter)) ?? [];
		},
		enabled: config.openmeter.enabled,
	});
}

/** 游标分页变体（v2 端点）；翻页时把上一页 `nextCursor` 传回 `filter.cursor`。 */
export function useOpenMeterEventsV2(filter: OpenMeterEventsV2Filter = {}) {
	return useQuery<OpenMeterIngestedEventsPage>({
		queryKey: openMeterEventsKeys.listV2(filter),
		queryFn: async () => {
			const client = getOpenMeterClient();
			if (!client) return { items: [] };
			return (await client.events.listV2(filter)) ?? { items: [] };
		},
		enabled: config.openmeter.enabled,
	});
}
