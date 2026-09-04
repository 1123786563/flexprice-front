// src/hooks/useOpenMeterAddons.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { config } from '@/config/config';
import { getOpenMeterClient, OpenMeterClient, requireOpenMeterClient } from '@/core/services/openmeter';

/** `GET /api/v1/addons` 的查询参数，随 SDK 类型走。 */
export type OpenMeterAddonsFilter = NonNullable<Parameters<OpenMeterClient['addons']['list']>[0]>;
export type OpenMeterAddonsPage = NonNullable<Awaited<ReturnType<OpenMeterClient['addons']['list']>>>;
export type OpenMeterAddon = OpenMeterAddonsPage['items'][number];
export type AddonCreateInput = Parameters<OpenMeterClient['addons']['create']>[0];
export type AddonUpdateInput = NonNullable<Parameters<OpenMeterClient['addons']['update']>[1]>;

export const openMeterAddonsKeys = {
	root: ['openmeter', 'addons'] as const,
	all: (filter: OpenMeterAddonsFilter = {}) => ['openmeter', 'addons', filter] as const,
	detail: (id: string) => ['openmeter', 'addon', id] as const,
};

const EMPTY_PAGE: OpenMeterAddonsPage = { items: [], totalCount: 0, page: 1, pageSize: 0 };

/** 列出计费附加包（addons）。禁用时返回空页。 */
export function useOpenMeterAddons(filter: OpenMeterAddonsFilter = {}) {
	return useQuery<OpenMeterAddonsPage>({
		queryKey: openMeterAddonsKeys.all(filter),
		queryFn: async () => {
			const client = getOpenMeterClient();
			if (!client) return EMPTY_PAGE;
			return (await client.addons.list(filter)) ?? EMPTY_PAGE;
		},
		enabled: config.openmeter.enabled,
	});
}

/** 按 ID 取单个 addon；不存在映射为 null。 */
export function useOpenMeterAddon(id: string) {
	return useQuery<OpenMeterAddon | null>({
		queryKey: openMeterAddonsKeys.detail(id),
		queryFn: async () => {
			const client = getOpenMeterClient();
			if (!client) return null;
			return (await client.addons.get(id)) ?? null;
		},
		enabled: config.openmeter.enabled && Boolean(id),
	});
}

export function useCreateOpenMeterAddon() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (addon: AddonCreateInput) => (await requireOpenMeterClient().addons.create(addon)) ?? null,
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: openMeterAddonsKeys.root });
		},
	});
}

export function useUpdateOpenMeterAddon() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async ({ id, addon }: { id: string; addon: AddonUpdateInput }) =>
			(await requireOpenMeterClient().addons.update(id, addon)) ?? null,
		onSuccess: (_data, { id }) => {
			void queryClient.invalidateQueries({ queryKey: openMeterAddonsKeys.root });
			void queryClient.invalidateQueries({ queryKey: openMeterAddonsKeys.detail(id) });
		},
	});
}

export function useDeleteOpenMeterAddon() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (id: string) => {
			await requireOpenMeterClient().addons.delete(id);
			return id;
		},
		onSuccess: (_data, id) => {
			void queryClient.invalidateQueries({ queryKey: openMeterAddonsKeys.root });
			void queryClient.invalidateQueries({ queryKey: openMeterAddonsKeys.detail(id) });
		},
	});
}

/** addon 生命周期：draft → published → archived。 */
export function usePublishOpenMeterAddon() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (id: string) => (await requireOpenMeterClient().addons.publish(id)) ?? null,
		onSuccess: (_data, id) => {
			void queryClient.invalidateQueries({ queryKey: openMeterAddonsKeys.root });
			void queryClient.invalidateQueries({ queryKey: openMeterAddonsKeys.detail(id) });
		},
	});
}

export function useArchiveOpenMeterAddon() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (id: string) => (await requireOpenMeterClient().addons.archive(id)) ?? null,
		onSuccess: (_data, id) => {
			void queryClient.invalidateQueries({ queryKey: openMeterAddonsKeys.root });
			void queryClient.invalidateQueries({ queryKey: openMeterAddonsKeys.detail(id) });
		},
	});
}
