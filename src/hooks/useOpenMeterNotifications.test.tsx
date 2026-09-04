import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	listChannels: vi.fn(),
	listRules: vi.fn(),
	listEvents: vi.fn(),
	createChannel: vi.fn(),
	deleteChannel: vi.fn(),
}));

vi.mock('@openmeter/sdk', () => ({
	OpenMeter: class {
		notifications = {
			channels: { list: mocks.listChannels, create: mocks.createChannel, delete: mocks.deleteChannel },
			rules: { list: mocks.listRules },
			events: { list: mocks.listEvents },
		};
		constructor(public clientConfig: unknown) {}
	},
}));

import {
	useCreateOpenMeterNotificationChannel,
	useDeleteOpenMeterNotificationChannel,
	useOpenMeterNotificationChannels,
	useOpenMeterNotificationEvents,
	useOpenMeterNotificationRules,
} from './useOpenMeterNotifications';

const channel = { id: 'ch-1', type: 'webhook', createdAt: new Date(), updatedAt: new Date() };

function setup() {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
	const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
	const wrapper = function Wrapper({ children }: { children: ReactNode }) {
		return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
	};
	return { invalidateSpy, wrapper };
}

beforeEach(() => {
	Object.values(mocks).forEach((m) => m.mockReset());
});

describe('useOpenMeterNotifications', () => {
	it('返回渠道/规则/事件三张列表', async () => {
		mocks.listChannels.mockResolvedValueOnce({ items: [channel], totalCount: 1 });
		mocks.listRules.mockResolvedValueOnce({ items: [], totalCount: 0 });
		mocks.listEvents.mockResolvedValueOnce({ items: [], totalCount: 0 });

		const { result: channels } = renderHook(() => useOpenMeterNotificationChannels(), { wrapper: setup().wrapper });
		await waitFor(() => expect(channels.current.isSuccess).toBe(true));
		expect(channels.current.data?.items).toEqual([channel]);

		const { result: rules } = renderHook(() => useOpenMeterNotificationRules(), { wrapper: setup().wrapper });
		await waitFor(() => expect(rules.current.isSuccess).toBe(true));
		expect(rules.current.data).toEqual({ items: [], totalCount: 0 });

		const { result: events } = renderHook(() => useOpenMeterNotificationEvents(), { wrapper: setup().wrapper });
		await waitFor(() => expect(events.current.isSuccess).toBe(true));
		expect(events.current.data).toEqual({ items: [], totalCount: 0 });
	});

	it('创建/删除渠道后失效渠道列表', async () => {
		mocks.createChannel.mockResolvedValueOnce(channel);
		mocks.deleteChannel.mockResolvedValueOnce(undefined);
		const { invalidateSpy, wrapper } = setup();

		const input = { type: 'webhook' } as unknown as Parameters<typeof mocks.createChannel>[0];
		const { result: create } = renderHook(() => useCreateOpenMeterNotificationChannel(), { wrapper });
		create.current.mutate(input);
		await waitFor(() => expect(create.current.isSuccess).toBe(true));
		expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['openmeter', 'notifications', 'channels'] });

		const { result: del } = renderHook(() => useDeleteOpenMeterNotificationChannel(), { wrapper });
		del.current.mutate('ch-1');
		await waitFor(() => expect(del.current.isSuccess).toBe(true));
		expect(mocks.deleteChannel).toHaveBeenCalledWith('ch-1');
	});
});
