// src/hooks/useOpenMeterApps.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { config } from '@/config/config';
import { getOpenMeterClient, OpenMeterClient, requireOpenMeterClient } from '@/core/services/openmeter';

export type OpenMeterAppsFilter = NonNullable<Parameters<OpenMeterClient['apps']['list']>[0]>;
export type OpenMeterAppsPage = NonNullable<Awaited<ReturnType<OpenMeterClient['apps']['list']>>>;
export type OpenMeterApp = OpenMeterAppsPage['items'][number];

export const openMeterAppsKeys = {
	root: ['openmeter', 'apps'] as const,
	all: (filter: OpenMeterAppsFilter = {}) => ['openmeter', 'apps', filter] as const,
	detail: (id: string) => ['openmeter', 'app', id] as const,
};

const EMPTY_PAGE: OpenMeterAppsPage = { items: [], totalCount: 0, page: 1, pageSize: 0 };

/** 列出已安装的应用（apps）。禁用时返回空页。 */
export function useOpenMeterApps(filter: OpenMeterAppsFilter = {}) {
	return useQuery<OpenMeterAppsPage>({
		queryKey: openMeterAppsKeys.all(filter),
		queryFn: async () => {
			const client = getOpenMeterClient();
			if (!client) return EMPTY_PAGE;
			return (await client.apps.list(filter)) ?? EMPTY_PAGE;
		},
		enabled: config.openmeter.enabled,
	});
}

/** 按 ID 取单个 app；不存在映射为 null。 */
export function useOpenMeterApp(id: string) {
	return useQuery<OpenMeterApp | null>({
		queryKey: openMeterAppsKeys.detail(id),
		queryFn: async () => {
			const client = getOpenMeterClient();
			if (!client) return null;
			return (await client.apps.get(id)) ?? null;
		},
		enabled: config.openmeter.enabled && Boolean(id),
	});
}

/** 卸载应用；成功后失效列表 + 详情缓存。 */
export function useUninstallOpenMeterApp() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (id: string) => {
			await requireOpenMeterClient().apps.uninstall(id);
			return id;
		},
		onSuccess: (_data, id) => {
			void queryClient.invalidateQueries({ queryKey: openMeterAppsKeys.root });
			void queryClient.invalidateQueries({ queryKey: openMeterAppsKeys.detail(id) });
		},
	});
}
