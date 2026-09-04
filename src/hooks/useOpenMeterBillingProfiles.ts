// src/hooks/useOpenMeterBillingProfiles.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { config } from '@/config/config';
import { getOpenMeterClient, OpenMeterClient, requireOpenMeterClient } from '@/core/services/openmeter';

export type OpenMeterBillingProfilesFilter = NonNullable<Parameters<OpenMeterClient['billing']['profiles']['list']>[0]>;
export type OpenMeterBillingProfilesPage = NonNullable<Awaited<ReturnType<OpenMeterClient['billing']['profiles']['list']>>>;
export type OpenMeterBillingProfile = OpenMeterBillingProfilesPage['items'][number];
export type BillingProfileCreateInput = Parameters<OpenMeterClient['billing']['profiles']['create']>[0];
export type BillingProfileUpdateInput = NonNullable<Parameters<OpenMeterClient['billing']['profiles']['update']>[1]>;

export const openMeterBillingProfilesKeys = {
	root: ['openmeter', 'billing-profiles'] as const,
	all: (filter: OpenMeterBillingProfilesFilter = {}) => ['openmeter', 'billing-profiles', filter] as const,
	detail: (id: string) => ['openmeter', 'billing-profile', id] as const,
};

const EMPTY_PAGE: OpenMeterBillingProfilesPage = { items: [], totalCount: 0, page: 1, pageSize: 0 };

/** 列出账单主体（billing profiles）。禁用时返回空页。 */
export function useOpenMeterBillingProfiles(filter: OpenMeterBillingProfilesFilter = {}) {
	return useQuery<OpenMeterBillingProfilesPage>({
		queryKey: openMeterBillingProfilesKeys.all(filter),
		queryFn: async () => {
			const client = getOpenMeterClient();
			if (!client) return EMPTY_PAGE;
			return (await client.billing.profiles.list(filter)) ?? EMPTY_PAGE;
		},
		enabled: config.openmeter.enabled,
	});
}

/** 按 ID 取单个账单主体；不存在映射为 null。 */
export function useOpenMeterBillingProfile(id: string) {
	return useQuery<OpenMeterBillingProfile | null>({
		queryKey: openMeterBillingProfilesKeys.detail(id),
		queryFn: async () => {
			const client = getOpenMeterClient();
			if (!client) return null;
			return (await client.billing.profiles.get(id)) ?? null;
		},
		enabled: config.openmeter.enabled && Boolean(id),
	});
}

export function useCreateOpenMeterBillingProfile() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (profile: BillingProfileCreateInput) =>
			(await requireOpenMeterClient().billing.profiles.create(profile)) ?? null,
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: openMeterBillingProfilesKeys.root });
		},
	});
}

export function useUpdateOpenMeterBillingProfile() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async ({ id, profile }: { id: string; profile: BillingProfileUpdateInput }) =>
			(await requireOpenMeterClient().billing.profiles.update(id, profile)) ?? null,
		onSuccess: (_data, { id }) => {
			void queryClient.invalidateQueries({ queryKey: openMeterBillingProfilesKeys.root });
			void queryClient.invalidateQueries({ queryKey: openMeterBillingProfilesKeys.detail(id) });
		},
	});
}

export function useDeleteOpenMeterBillingProfile() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (id: string) => {
			await requireOpenMeterClient().billing.profiles.delete(id);
			return id;
		},
		onSuccess: (_data, id) => {
			void queryClient.invalidateQueries({ queryKey: openMeterBillingProfilesKeys.root });
			void queryClient.invalidateQueries({ queryKey: openMeterBillingProfilesKeys.detail(id) });
		},
	});
}
