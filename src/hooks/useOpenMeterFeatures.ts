// src/hooks/useOpenMeterFeatures.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { config } from '@/config/config';
import { getOpenMeterClient, OpenMeterClient, requireOpenMeterClient } from '@/core/services/openmeter';

export type OpenMeterFeature = Awaited<ReturnType<OpenMeterClient['features']['list']>>[number];
export type FeatureCreateInput = Parameters<OpenMeterClient['features']['create']>[0];

export const openMeterFeaturesKeys = {
	all: ['openmeter', 'features'] as const,
	detail: (id: string) => ['openmeter', 'feature', id] as const,
};

/** 列出 OpenMeter 中定义的 feature。禁用时为空数组。 */
export function useOpenMeterFeatures() {
	return useQuery<OpenMeterFeature[]>({
		queryKey: openMeterFeaturesKeys.all,
		queryFn: async () => {
			const client = getOpenMeterClient();
			if (!client) return [];
			return (await client.features.list()) ?? [];
		},
		enabled: config.openmeter.enabled,
	});
}

/** 按 ID 取单个 feature；不存在映射为 null。 */
export function useOpenMeterFeature(id: string) {
	return useQuery<OpenMeterFeature | null>({
		queryKey: openMeterFeaturesKeys.detail(id),
		queryFn: async () => {
			const client = getOpenMeterClient();
			if (!client) return null;
			return (await client.features.get(id)) ?? null;
		},
		enabled: config.openmeter.enabled && Boolean(id),
	});
}

export function useCreateOpenMeterFeature() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (feature: FeatureCreateInput) => (await requireOpenMeterClient().features.create(feature)) ?? null,
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: openMeterFeaturesKeys.all });
		},
	});
}

export function useDeleteOpenMeterFeature() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (id: string) => {
			await requireOpenMeterClient().features.delete(id);
			return id;
		},
		onSuccess: (_data, id) => {
			void queryClient.invalidateQueries({ queryKey: openMeterFeaturesKeys.all });
			void queryClient.invalidateQueries({ queryKey: openMeterFeaturesKeys.detail(id) });
		},
	});
}
