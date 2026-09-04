import { useQuery } from '@tanstack/react-query';
import NotificationApi from '@/api/NotificationApi';
import { refetchQueries } from '@/core/services/tanstack/ReactQueryProvider';

export const notificationsQueryKeys = {
	channels: ['notifications', 'channels'] as const,
	rules: ['notifications', 'rules'] as const,
	events: ['notifications', 'events'] as const,
};

const LIST_PAGE = { page: 1, pageSize: 100 } as const;

/** Refetches all three collections — used after writes whose backend effects span them. */
export function refetchAllNotifications(): Promise<void> {
	return Promise.all(Object.values(notificationsQueryKeys).map((key) => refetchQueries([...key]))).then(() => undefined);
}

export function useNotificationChannels() {
	const query = useQuery({
		queryKey: notificationsQueryKeys.channels,
		queryFn: () => NotificationApi.listChannels(LIST_PAGE),
		refetchOnMount: 'always',
	});
	return { ...query, channels: query.data?.items ?? [] };
}

export function useNotificationRules() {
	const query = useQuery({
		queryKey: notificationsQueryKeys.rules,
		queryFn: () => NotificationApi.listRules(LIST_PAGE),
		refetchOnMount: 'always',
	});
	return { ...query, rules: query.data?.items ?? [] };
}

export function useNotificationEvents() {
	const query = useQuery({
		queryKey: notificationsQueryKeys.events,
		queryFn: () => NotificationApi.listEvents(LIST_PAGE),
		refetchOnMount: 'always',
	});
	return { ...query, events: query.data?.items ?? [] };
}
