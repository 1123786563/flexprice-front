// src/hooks/useOpenMeterSubscriptions.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { config } from '@/config/config';
import { getOpenMeterClient, OpenMeterClient, requireOpenMeterClient } from '@/core/services/openmeter';

export type OpenMeterSubscription = NonNullable<Awaited<ReturnType<OpenMeterClient['subscriptions']['get']>>>;
export type SubscriptionCreateInput = Parameters<OpenMeterClient['subscriptions']['create']>[0];
export type SubscriptionCancelInput = NonNullable<Parameters<OpenMeterClient['subscriptions']['cancel']>[1]>;
export type OpenMeterSubscriptionAddonsList = NonNullable<Awaited<ReturnType<OpenMeterClient['subscriptionAddons']['list']>>>;

export const openMeterSubscriptionsKeys = {
	root: ['openmeter', 'subscriptions'] as const,
	detail: (id: string) => ['openmeter', 'subscription', id] as const,
	addons: (id: string) => ['openmeter', 'subscription', id, 'addons'] as const,
};

/** 按 ID 取单个订阅；不存在映射为 null。 */
export function useOpenMeterSubscription(id: string) {
	return useQuery<OpenMeterSubscription | null>({
		queryKey: openMeterSubscriptionsKeys.detail(id),
		queryFn: async () => {
			const client = getOpenMeterClient();
			if (!client) return null;
			return (await client.subscriptions.get(id)) ?? null;
		},
		enabled: config.openmeter.enabled && Boolean(id),
	});
}

/** 订阅的附加包列表。 */
export function useOpenMeterSubscriptionAddons(id: string) {
	return useQuery<OpenMeterSubscriptionAddonsList>({
		queryKey: openMeterSubscriptionsKeys.addons(id),
		queryFn: async () => {
			const client = getOpenMeterClient();
			if (!client) return [];
			return (await client.subscriptionAddons.list(id)) ?? [];
		},
		enabled: config.openmeter.enabled && Boolean(id),
	});
}

export function useCreateOpenMeterSubscription() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (input: SubscriptionCreateInput) => (await requireOpenMeterClient().subscriptions.create(input)) ?? null,
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: openMeterSubscriptionsKeys.root });
		},
	});
}

/** 取消订阅（可排期到周期末）；成功后失效详情缓存。 */
export function useCancelOpenMeterSubscription() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async ({ id, body }: { id: string; body: SubscriptionCancelInput }) =>
			(await requireOpenMeterClient().subscriptions.cancel(id, body)) ?? null,
		onSuccess: (_data, { id }) => {
			void queryClient.invalidateQueries({ queryKey: openMeterSubscriptionsKeys.root });
			void queryClient.invalidateQueries({ queryKey: openMeterSubscriptionsKeys.detail(id) });
		},
	});
}
