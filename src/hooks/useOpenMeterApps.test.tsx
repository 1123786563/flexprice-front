import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	list: vi.fn(),
	get: vi.fn(),
	uninstall: vi.fn(),
}));

vi.mock('@openmeter/sdk', () => ({
	OpenMeter: class {
		apps = { list: mocks.list, get: mocks.get, uninstall: mocks.uninstall };
		constructor(public clientConfig: unknown) {}
	},
}));

import { useOpenMeterApp, useOpenMeterApps, useUninstallOpenMeterApp } from './useOpenMeterApps';

const app = { id: 'app-1', type: 'stripe', name: 'Stripe', createdAt: new Date(), updatedAt: new Date() };

function setup() {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
	const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
	const wrapper = function Wrapper({ children }: { children: ReactNode }) {
		return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
	};
	return { invalidateSpy, wrapper };
}

beforeEach(() => {
	[mocks.list, mocks.get, mocks.uninstall].forEach((m) => m.mockReset());
});

describe('useOpenMeterApps', () => {
	it('返回 apps 分页与单个 app', async () => {
		mocks.list.mockResolvedValueOnce({ items: [app], totalCount: 1 });
		mocks.get.mockResolvedValueOnce(app);
		const { result } = renderHook(() => useOpenMeterApps(), { wrapper: setup().wrapper });
		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(result.current.data?.items).toEqual([app]);

		const { result: one } = renderHook(() => useOpenMeterApp('app-1'), { wrapper: setup().wrapper });
		await waitFor(() => expect(one.current.isSuccess).toBe(true));
		expect(one.current.data).toEqual(app);
	});

	it('卸载 app 后失效列表 + 详情', async () => {
		mocks.uninstall.mockResolvedValueOnce(undefined);
		const { invalidateSpy, wrapper } = setup();
		const { result } = renderHook(() => useUninstallOpenMeterApp(), { wrapper });
		result.current.mutate('app-1');
		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(mocks.uninstall).toHaveBeenCalledWith('app-1');
		expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['openmeter', 'apps'] });
		expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['openmeter', 'app', 'app-1'] });
	});
});
