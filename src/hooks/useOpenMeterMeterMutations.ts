// src/hooks/useOpenMeterMeterMutations.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { OpenMeterClient, requireOpenMeterClient } from '@/core/services/openmeter';
import { openMeterQueryKeys } from './useOpenMeterQuery';

export type MeterCreateInput = Parameters<OpenMeterClient['meters']['create']>[0];
export type MeterUpdateInput = NonNullable<Parameters<OpenMeterClient['meters']['update']>[1]>;

/** 新建计量表；成功后失效列表缓存。 */
export function useCreateOpenMeterMeter() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (meter: MeterCreateInput) => (await requireOpenMeterClient().meters.create(meter)) ?? null,
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: openMeterQueryKeys.meters });
		},
	});
}

/** 修改计量表（名称/描述/metadata）；成功后失效列表 + 详情缓存。 */
export function useUpdateOpenMeterMeter() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async ({ idOrSlug, meter }: { idOrSlug: string; meter: MeterUpdateInput }) =>
			(await requireOpenMeterClient().meters.update(idOrSlug, meter)) ?? null,
		onSuccess: (_data, { idOrSlug }) => {
			void queryClient.invalidateQueries({ queryKey: openMeterQueryKeys.meters });
			void queryClient.invalidateQueries({ queryKey: openMeterQueryKeys.meter(idOrSlug) });
		},
	});
}

/** 删除计量表（按 ID 或 slug）；成功后失效列表 + 详情缓存。 */
export function useDeleteOpenMeterMeter() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (idOrSlug: string) => {
			await requireOpenMeterClient().meters.delete(idOrSlug);
			return idOrSlug;
		},
		onSuccess: (_data, idOrSlug) => {
			void queryClient.invalidateQueries({ queryKey: openMeterQueryKeys.meters });
			void queryClient.invalidateQueries({ queryKey: openMeterQueryKeys.meter(idOrSlug) });
		},
	});
}
