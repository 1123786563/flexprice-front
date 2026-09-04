import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	listCurrencies: vi.fn(),
	getProgress: vi.fn(),
}));

vi.mock('@openmeter/sdk', () => ({
	OpenMeter: class {
		info = { listCurrencies: mocks.listCurrencies, getProgress: mocks.getProgress };
		constructor(public clientConfig: unknown) {}
	},
}));

import { useOpenMeterCurrencies, useOpenMeterProgress } from './useOpenMeterInfo';

function createWrapper() {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return function Wrapper({ children }: { children: ReactNode }) {
		return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
	};
}

beforeEach(() => {
	mocks.listCurrencies.mockReset();
	mocks.getProgress.mockReset();
});

describe('useOpenMeterCurrencies', () => {
	it('lists the currency catalog', async () => {
		const currencies = [{ code: 'USD', name: 'US Dollar', symbol: '$', subunits: 100 }];
		mocks.listCurrencies.mockResolvedValueOnce(currencies);
		const { result } = renderHook(() => useOpenMeterCurrencies(), { wrapper: createWrapper() });
		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(result.current.data).toEqual(currencies);
	});
});

describe('useOpenMeterProgress', () => {
	it('polls progress for a bulk operation id', async () => {
		const progress = { success: 3, failed: 0, total: 5, updatedAt: new Date('2026-09-04T00:00:00Z') };
		mocks.getProgress.mockResolvedValueOnce(progress);
		const { result } = renderHook(() => useOpenMeterProgress('job-1'), { wrapper: createWrapper() });
		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(mocks.getProgress).toHaveBeenCalledWith('job-1');
		expect(result.current.data).toEqual(progress);
	});

	it('is disabled for an empty id', () => {
		const { result } = renderHook(() => useOpenMeterProgress(''), { wrapper: createWrapper() });
		expect(result.current.data).toBeUndefined();
		expect(mocks.getProgress).not.toHaveBeenCalled();
	});
});
