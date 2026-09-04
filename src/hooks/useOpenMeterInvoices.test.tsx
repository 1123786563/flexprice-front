import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	list: vi.fn(),
	get: vi.fn(),
	advance: vi.fn(),
	approve: vi.fn(),
	retry: vi.fn(),
	void: vi.fn(),
}));

vi.mock('@openmeter/sdk', () => ({
	OpenMeter: class {
		billing = {
			invoices: { list: mocks.list, get: mocks.get, advance: mocks.advance, approve: mocks.approve, retry: mocks.retry, void: mocks.void },
		};
		constructor(public clientConfig: unknown) {}
	},
}));

import {
	useAdvanceOpenMeterInvoice,
	useApproveOpenMeterInvoice,
	useOpenMeterInvoice,
	useOpenMeterInvoices,
	useRetryOpenMeterInvoice,
	useVoidOpenMeterInvoice,
} from './useOpenMeterInvoices';

const invoice = { id: 'inv-1', currency: 'USD', status: 'draft_waiting_approval', createdAt: new Date(), updatedAt: new Date() };

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

describe('useOpenMeterInvoices 读取', () => {
	it('返回发票分页与单张发票', async () => {
		mocks.list.mockResolvedValueOnce({ items: [invoice], totalCount: 1 });
		mocks.get.mockResolvedValueOnce(invoice);
		const { result } = renderHook(() => useOpenMeterInvoices(), { wrapper: setup().wrapper });
		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(result.current.data?.items).toEqual([invoice]);

		const { result: one } = renderHook(() => useOpenMeterInvoice('inv-1'), { wrapper: setup().wrapper });
		await waitFor(() => expect(one.current.isSuccess).toBe(true));
		expect(one.current.data).toEqual(invoice);
	});
});

describe('发票状态机动作', () => {
	it('advance/approve/retry/void 走对应端点并失效缓存', async () => {
		mocks.advance.mockResolvedValueOnce(invoice);
		mocks.approve.mockResolvedValueOnce(invoice);
		mocks.retry.mockResolvedValueOnce(invoice);
		mocks.void.mockResolvedValueOnce(invoice);
		const { invalidateSpy, wrapper } = setup();

		const { result: advance } = renderHook(() => useAdvanceOpenMeterInvoice(), { wrapper });
		advance.current.mutate('inv-1');
		await waitFor(() => expect(advance.current.isSuccess).toBe(true));

		const { result: approve } = renderHook(() => useApproveOpenMeterInvoice(), { wrapper });
		approve.current.mutate('inv-1');
		await waitFor(() => expect(approve.current.isSuccess).toBe(true));

		const { result: retry } = renderHook(() => useRetryOpenMeterInvoice(), { wrapper });
		retry.current.mutate('inv-1');
		await waitFor(() => expect(retry.current.isSuccess).toBe(true));

		const { result: voidMutation } = renderHook(() => useVoidOpenMeterInvoice(), { wrapper });
		voidMutation.current.mutate({ id: 'inv-1', body: { reason: 'mistake' } as never });
		await waitFor(() => expect(voidMutation.current.isSuccess).toBe(true));

		expect(mocks.advance).toHaveBeenCalledWith('inv-1');
		expect(mocks.approve).toHaveBeenCalledWith('inv-1');
		expect(mocks.retry).toHaveBeenCalledWith('inv-1');
		expect(mocks.void).toHaveBeenCalledWith('inv-1', { reason: 'mistake' });
		expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['openmeter', 'invoice', 'inv-1'] });
	});
});
