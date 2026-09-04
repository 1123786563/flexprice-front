import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	list: vi.fn(),
	get: vi.fn(),
	create: vi.fn(),
	delete: vi.fn(),
	publish: vi.fn(),
	archive: vi.fn(),
}));

vi.mock('@openmeter/sdk', () => ({
	OpenMeter: class {
		plans = { list: mocks.list, get: mocks.get, create: mocks.create, delete: mocks.delete, publish: mocks.publish, archive: mocks.archive };
		constructor(public clientConfig: unknown) {}
	},
}));

import {
	useArchiveOpenMeterPlan,
	useCreateOpenMeterPlan,
	useDeleteOpenMeterPlan,
	useOpenMeterPlan,
	useOpenMeterPlans,
	usePublishOpenMeterPlan,
} from './useOpenMeterPlans';

const plan = { id: 'plan-1', key: 'pro', name: 'Pro', createdAt: new Date(), updatedAt: new Date() };

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

describe('useOpenMeterPlans 读取', () => {
	it('返回 plans 分页数据与单个 plan', async () => {
		mocks.list.mockResolvedValueOnce({ items: [plan], totalCount: 1 });
		mocks.get.mockResolvedValueOnce(plan);
		const { result } = renderHook(() => useOpenMeterPlans(), { wrapper: setup().wrapper });
		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(result.current.data?.items).toEqual([plan]);

		const { result: one } = renderHook(() => useOpenMeterPlan('plan-1'), { wrapper: setup().wrapper });
		await waitFor(() => expect(one.current.isSuccess).toBe(true));
		expect(one.current.data).toEqual(plan);
	});
});

describe('useOpenMeterPlans 变更', () => {
	it('创建/发布/归档/删除走对应端点并失效缓存', async () => {
		mocks.create.mockResolvedValueOnce(plan);
		mocks.publish.mockResolvedValueOnce(plan);
		mocks.archive.mockResolvedValueOnce(plan);
		mocks.delete.mockResolvedValueOnce(undefined);
		const { invalidateSpy, wrapper } = setup();

		const input = { key: 'pro', name: 'Pro', currency: 'USD' } as unknown as Parameters<typeof mocks.create>[0];
		const { result: create } = renderHook(() => useCreateOpenMeterPlan(), { wrapper });
		create.current.mutate(input);
		await waitFor(() => expect(create.current.isSuccess).toBe(true));
		expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['openmeter', 'plans'] });

		const { result: publish } = renderHook(() => usePublishOpenMeterPlan(), { wrapper });
		publish.current.mutate('plan-1');
		await waitFor(() => expect(publish.current.isSuccess).toBe(true));

		const { result: archive } = renderHook(() => useArchiveOpenMeterPlan(), { wrapper });
		archive.current.mutate('plan-1');
		await waitFor(() => expect(archive.current.isSuccess).toBe(true));

		const { result: del } = renderHook(() => useDeleteOpenMeterPlan(), { wrapper });
		del.current.mutate('plan-1');
		await waitFor(() => expect(del.current.isSuccess).toBe(true));

		expect(mocks.publish).toHaveBeenCalledWith('plan-1');
		expect(mocks.archive).toHaveBeenCalledWith('plan-1');
		expect(mocks.delete).toHaveBeenCalledWith('plan-1');
		expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['openmeter', 'plan', 'plan-1'] });
	});
});
