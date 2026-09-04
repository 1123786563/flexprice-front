// src/hooks/useOpenMeterNotifications.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { config } from '@/config/config';
import { getOpenMeterClient, OpenMeterClient, requireOpenMeterClient } from '@/core/services/openmeter';

export type OpenMeterNotificationChannelsPage = NonNullable<
	Awaited<ReturnType<OpenMeterClient['notifications']['channels']['list']>>
>;
export type OpenMeterNotificationChannel = OpenMeterNotificationChannelsPage['items'][number];
export type OpenMeterNotificationRulesPage = NonNullable<Awaited<ReturnType<OpenMeterClient['notifications']['rules']['list']>>>;
export type OpenMeterNotificationEventsPage = NonNullable<Awaited<ReturnType<OpenMeterClient['notifications']['events']['list']>>>;
export type NotificationChannelCreateInput = Parameters<OpenMeterClient['notifications']['channels']['create']>[0];

export const openMeterNotificationsKeys = {
	root: ['openmeter', 'notifications'] as const,
	channels: ['openmeter', 'notifications', 'channels'] as const,
	rules: ['openmeter', 'notifications', 'rules'] as const,
	events: ['openmeter', 'notifications', 'events'] as const,
};

const EMPTY_CHANNELS: OpenMeterNotificationChannelsPage = { items: [], totalCount: 0, page: 1, pageSize: 0 };
const EMPTY_RULES: OpenMeterNotificationRulesPage = { items: [], totalCount: 0, page: 1, pageSize: 0 };
const EMPTY_EVENTS: OpenMeterNotificationEventsPage = { items: [], totalCount: 0, page: 1, pageSize: 0 };

/** 列出通知渠道（webhook 等）。禁用时返回空页。 */
export function useOpenMeterNotificationChannels() {
	return useQuery<OpenMeterNotificationChannelsPage>({
		queryKey: openMeterNotificationsKeys.channels,
		queryFn: async () => {
			const client = getOpenMeterClient();
			if (!client) return EMPTY_CHANNELS;
			return (await client.notifications.channels.list()) ?? EMPTY_CHANNELS;
		},
		enabled: config.openmeter.enabled,
	});
}

/** 列出通知规则（计量事件触达条件）。 */
export function useOpenMeterNotificationRules() {
	return useQuery<OpenMeterNotificationRulesPage>({
		queryKey: openMeterNotificationsKeys.rules,
		queryFn: async () => {
			const client = getOpenMeterClient();
			if (!client) return EMPTY_RULES;
			return (await client.notifications.rules.list()) ?? EMPTY_RULES;
		},
		enabled: config.openmeter.enabled,
	});
}

/** 列出已发出的通知事件（送达情况审计）。 */
export function useOpenMeterNotificationEvents() {
	return useQuery<OpenMeterNotificationEventsPage>({
		queryKey: openMeterNotificationsKeys.events,
		queryFn: async () => {
			const client = getOpenMeterClient();
			if (!client) return EMPTY_EVENTS;
			return (await client.notifications.events.list()) ?? EMPTY_EVENTS;
		},
		enabled: config.openmeter.enabled,
	});
}

export function useCreateOpenMeterNotificationChannel() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (channel: NotificationChannelCreateInput) =>
			(await requireOpenMeterClient().notifications.channels.create(channel)) ?? null,
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: openMeterNotificationsKeys.channels });
		},
	});
}

export function useDeleteOpenMeterNotificationChannel() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (id: string) => {
			await requireOpenMeterClient().notifications.channels.delete(id);
			return id;
		},
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: openMeterNotificationsKeys.channels });
		},
	});
}
