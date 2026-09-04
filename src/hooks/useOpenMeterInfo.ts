// src/hooks/useOpenMeterInfo.ts
import { useQuery } from '@tanstack/react-query';
import { config } from '@/config/config';
import { getOpenMeterClient, OpenMeterClient } from '@/core/services/openmeter';

export type OpenMeterCurrency = NonNullable<Awaited<ReturnType<OpenMeterClient['info']['listCurrencies']>>>[number];
export type OpenMeterProgress = NonNullable<Awaited<ReturnType<OpenMeterClient['info']['getProgress']>>>;

export const openMeterInfoKeys = {
	currencies: ['openmeter', 'currencies'] as const,
	progress: (id: string) => ['openmeter', 'progress', id] as const,
};

/** 币种静态目录，整个会话缓存不重取。 */
export function useOpenMeterCurrencies() {
	return useQuery<OpenMeterCurrency[]>({
		queryKey: openMeterInfoKeys.currencies,
		queryFn: async () => {
			const client = getOpenMeterClient();
			if (!client) return [];
			return (await client.info.listCurrencies()) ?? [];
		},
		enabled: config.openmeter.enabled,
		staleTime: Infinity,
	});
}

/** 轮询批量操作（如 subject 导入）的进度。 */
export function useOpenMeterProgress(id: string) {
	return useQuery<OpenMeterProgress | null>({
		queryKey: openMeterInfoKeys.progress(id),
		queryFn: async () => {
			const client = getOpenMeterClient();
			if (!client) return null;
			return (await client.info.getProgress(id)) ?? null;
		},
		enabled: config.openmeter.enabled && Boolean(id),
	});
}
