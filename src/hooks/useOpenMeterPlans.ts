// src/hooks/useOpenMeterPlans.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { config } from '@/config/config';
import { getOpenMeterClient, OpenMeterClient, requireOpenMeterClient } from '@/core/services/openmeter';

export type OpenMeterPlansFilter = NonNullable<Parameters<OpenMeterClient['plans']['list']>[0]>;
export type OpenMeterPlansPage = NonNullable<Awaited<ReturnType<OpenMeterClient['plans']['list']>>>;
export type OpenMeterPlan = OpenMeterPlansPage['items'][number];
export type PlanCreateInput = Parameters<OpenMeterClient['plans']['create']>[0];

export const openMeterPlansKeys = {
	root: ['openmeter', 'plans'] as const,
	all: (filter: OpenMeterPlansFilter = {}) => ['openmeter', 'plans', filter] as const,
	detail: (id: string) => ['openmeter', 'plan', id] as const,
};

const EMPTY_PAGE: OpenMeterPlansPage = { items: [], totalCount: 0, page: 1, pageSize: 0 };

/** 列出计费计划（plans）。禁用时返回空页。 */
export function useOpenMeterPlans(filter: OpenMeterPlansFilter = {}) {
	return useQuery<OpenMeterPlansPage>({
		queryKey: openMeterPlansKeys.all(filter),
		queryFn: async () => {
			const client = getOpenMeterClient();
			if (!client) return EMPTY_PAGE;
			return (await client.plans.list(filter)) ?? EMPTY_PAGE;
		},
		enabled: config.openmeter.enabled,
	});
}

/** 按 ID 取单个 plan（可带 expand 参数）；不存在映射为 null。 */
export function useOpenMeterPlan(id: string) {
	return useQuery<OpenMeterPlan | null>({
		queryKey: openMeterPlansKeys.detail(id),
		queryFn: async () => {
			const client = getOpenMeterClient();
			if (!client) return null;
			return (await client.plans.get(id)) ?? null;
		},
		enabled: config.openmeter.enabled && Boolean(id),
	});
}

export function useCreateOpenMeterPlan() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (plan: PlanCreateInput) => (await requireOpenMeterClient().plans.create(plan)) ?? null,
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: openMeterPlansKeys.root });
		},
	});
}

export function useDeleteOpenMeterPlan() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (id: string) => {
			await requireOpenMeterClient().plans.delete(id);
			return id;
		},
		onSuccess: (_data, id) => {
			void queryClient.invalidateQueries({ queryKey: openMeterPlansKeys.root });
			void queryClient.invalidateQueries({ queryKey: openMeterPlansKeys.detail(id) });
		},
	});
}

/** plan 生命周期：draft → published → archived。 */
export function usePublishOpenMeterPlan() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (id: string) => (await requireOpenMeterClient().plans.publish(id)) ?? null,
		onSuccess: (_data, id) => {
			void queryClient.invalidateQueries({ queryKey: openMeterPlansKeys.root });
			void queryClient.invalidateQueries({ queryKey: openMeterPlansKeys.detail(id) });
		},
	});
}

export function useArchiveOpenMeterPlan() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (id: string) => (await requireOpenMeterClient().plans.archive(id)) ?? null,
		onSuccess: (_data, id) => {
			void queryClient.invalidateQueries({ queryKey: openMeterPlansKeys.root });
			void queryClient.invalidateQueries({ queryKey: openMeterPlansKeys.detail(id) });
		},
	});
}
