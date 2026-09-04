import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	list: vi.fn(),
	get: vi.fn(),
	create: vi.fn(),
	update: vi.fn(),
	delete: vi.fn(),
}));

vi.mock('@openmeter/sdk', () => ({
	OpenMeter: class {
		billing = { profiles: { list: mocks.list, get: mocks.get, create: mocks.create, update: mocks.update, delete: mocks.delete } };
		constructor(public clientConfig: unknown) {}
	},
}));

import {
	useCreateOpenMeterBillingProfile,
	useDeleteOpenMeterBillingProfile,
	useOpenMeterBillingProfile,
	useOpenMeterBillingProfiles,
	useUpdateOpenMeterBillingProfile,
} from './useOpenMeterBillingProfiles';

const profile = { id: 'bp-1', name: 'Default', createdAt: new Date(), updatedAt: new Date() };

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

describe('useOpenMeterBillingProfiles', () => {
	it('返回账单主体分页与单个主体', async () => {
		mocks.list.mockResolvedValueOnce({ items: [profile], totalCount: 1 });
		mocks.get.mockResolvedValueOnce(profile);
		const { result } = renderHook(() => useOpenMeterBillingProfiles(), { wrapper: setup().wrapper });
		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(result.current.data?.items).toEqual([profile]);

		const { result: one } = renderHook(() => useOpenMeterBillingProfile('bp-1'), { wrapper: setup().wrapper });
		await waitFor(() => expect(one.current.isSuccess).toBe(true));
		expect(one.current.data).toEqual(profile);
	});

	it('创建/更新/删除走对应端点并失效缓存', async () => {
		mocks.create.mockResolvedValueOnce(profile);
		mocks.update.mockResolvedValueOnce(profile);
		mocks.delete.mockResolvedValueOnce(undefined);
		const { invalidateSpy, wrapper } = setup();

		const input = { name: 'Default' } as unknown as Parameters<typeof mocks.create>[0];
		const { result: create } = renderHook(() => useCreateOpenMeterBillingProfile(), { wrapper });
		create.current.mutate(input);
		await waitFor(() => expect(create.current.isSuccess).toBe(true));
		expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['openmeter', 'billing-profiles'] });

		const { result: update } = renderHook(() => useUpdateOpenMeterBillingProfile(), { wrapper });
		update.current.mutate({ id: 'bp-1', profile: { name: 'Renamed' } as never });
		await waitFor(() => expect(update.current.isSuccess).toBe(true));

		const { result: del } = renderHook(() => useDeleteOpenMeterBillingProfile(), { wrapper });
		del.current.mutate('bp-1');
		await waitFor(() => expect(del.current.isSuccess).toBe(true));
		expect(mocks.delete).toHaveBeenCalledWith('bp-1');
		expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['openmeter', 'billing-profile', 'bp-1'] });
	});
});
