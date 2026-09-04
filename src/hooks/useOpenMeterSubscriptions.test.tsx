import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	get: vi.fn(),
	create: vi.fn(),
	cancel: vi.fn(),
	listAddons: vi.fn(),
}));

vi.mock('@openmeter/sdk', () => ({
	OpenMeter: class {
		subscriptions = { get: mocks.get, create: mocks.create, cancel: mocks.cancel };
		subscriptionAddons = { list: mocks.listAddons };
		constructor(public clientConfig: unknown) {}
	},
}));

import {
	useCancelOpenMeterSubscription,
	useCreateOpenMeterSubscription,
	useOpenMeterSubscription,
	useOpenMeterSubscriptionAddons,
} from './useOpenMeterSubscriptions';

const subscription = { id: 'sub-1', status: 'active', createdAt: new Date(), updatedAt: new Date() };

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

describe('useOpenMeterSubscriptions', () => {
	it('返回单个订阅与其附加包', async () => {
		mocks.get.mockResolvedValueOnce(subscription);
		mocks.listAddons.mockResolvedValueOnce([]);
		const { result } = renderHook(() => useOpenMeterSubscription('sub-1'), { wrapper: setup().wrapper });
		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(result.current.data).toEqual(subscription);

		const { result: addons } = renderHook(() => useOpenMeterSubscriptionAddons('sub-1'), { wrapper: setup().wrapper });
		await waitFor(() => expect(addons.current.isSuccess).toBe(true));
		expect(addons.current.data).toEqual([]);
	});

	it('创建订阅失效列表；取消订阅失效列表 + 详情', async () => {
		mocks.create.mockResolvedValueOnce(subscription);
		mocks.cancel.mockResolvedValueOnce(subscription);
		const { invalidateSpy, wrapper } = setup();

		const input = { customerId: 'cust-1', planId: 'plan-1' } as unknown as Parameters<typeof mocks.create>[0];
		const { result: create } = renderHook(() => useCreateOpenMeterSubscription(), { wrapper });
		create.current.mutate(input);
		await waitFor(() => expect(create.current.isSuccess).toBe(true));
		expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['openmeter', 'subscriptions'] });

		const { result: cancel } = renderHook(() => useCancelOpenMeterSubscription(), { wrapper });
		cancel.current.mutate({ id: 'sub-1', body: {} as never });
		await waitFor(() => expect(cancel.current.isSuccess).toBe(true));
		expect(mocks.cancel).toHaveBeenCalledWith('sub-1', {});
		expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['openmeter', 'subscription', 'sub-1'] });
	});
});
