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
	getAccess: vi.fn(),
}));

vi.mock('@openmeter/sdk', () => ({
	OpenMeter: class {
		customers = {
			list: mocks.list,
			get: mocks.get,
			create: mocks.create,
			update: mocks.update,
			delete: mocks.delete,
			getAccess: mocks.getAccess,
		};
		constructor(public clientConfig: unknown) {}
	},
}));

import {
	useCreateOpenMeterCustomer,
	useDeleteOpenMeterCustomer,
	useOpenMeterCustomer,
	useOpenMeterCustomerAccess,
	useOpenMeterCustomers,
	useUpdateOpenMeterCustomer,
} from './useOpenMeterCustomers';

const customer = { id: 'cust-1', key: 'acme', name: 'Acme', createdAt: new Date(), updatedAt: new Date() };

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

describe('useOpenMeterCustomers 读取', () => {
	it('返回客户分页、单个客户与访问摘要', async () => {
		mocks.list.mockResolvedValueOnce({ items: [customer], totalCount: 1 });
		mocks.get.mockResolvedValueOnce(customer);
		mocks.getAccess.mockResolvedValueOnce({ subscriptions: [] });

		const { result } = renderHook(() => useOpenMeterCustomers(), { wrapper: setup().wrapper });
		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(result.current.data?.items).toEqual([customer]);

		const { result: one } = renderHook(() => useOpenMeterCustomer('acme'), { wrapper: setup().wrapper });
		await waitFor(() => expect(one.current.isSuccess).toBe(true));
		expect(one.current.data).toEqual(customer);

		const { result: access } = renderHook(() => useOpenMeterCustomerAccess('acme'), { wrapper: setup().wrapper });
		await waitFor(() => expect(access.current.isSuccess).toBe(true));
		expect(access.current.data).toEqual({ subscriptions: [] });
	});
});

describe('useOpenMeterCustomers 变更', () => {
	it('创建/更新/删除走对应端点并失效缓存', async () => {
		mocks.create.mockResolvedValueOnce(customer);
		mocks.update.mockResolvedValueOnce(customer);
		mocks.delete.mockResolvedValueOnce(undefined);
		const { invalidateSpy, wrapper } = setup();

		const input = { key: 'acme', name: 'Acme', currency: 'USD' } as unknown as Parameters<typeof mocks.create>[0];
		const { result: create } = renderHook(() => useCreateOpenMeterCustomer(), { wrapper });
		create.current.mutate(input);
		await waitFor(() => expect(create.current.isSuccess).toBe(true));
		expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['openmeter', 'customers'] });

		const { result: update } = renderHook(() => useUpdateOpenMeterCustomer(), { wrapper });
		update.current.mutate({ idOrKey: 'acme', customer: { name: 'Acme Inc' } as never });
		await waitFor(() => expect(update.current.isSuccess).toBe(true));
		expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['openmeter', 'customer', 'acme'] });

		const { result: del } = renderHook(() => useDeleteOpenMeterCustomer(), { wrapper });
		del.current.mutate('acme');
		await waitFor(() => expect(del.current.isSuccess).toBe(true));
		expect(mocks.delete).toHaveBeenCalledWith('acme');
	});
});
