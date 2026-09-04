import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '@/config/config';

const mocks = vi.hoisted(() => ({
	list: vi.fn(),
	get: vi.fn(),
	query: vi.fn(),
	queryPost: vi.fn(),
}));

vi.mock('@openmeter/sdk', () => ({
	OpenMeter: class {
		meters = { list: mocks.list, get: mocks.get, query: mocks.query, queryPost: mocks.queryPost };
		constructor(public clientConfig: unknown) {}
	},
}));

import { useOpenMeterMeter, useOpenMeterMeters, useOpenMeterUsage, useOpenMeterUsagePost } from './useOpenMeterQuery';

function createWrapper() {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return function Wrapper({ children }: { children: ReactNode }) {
		return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
	};
}

const meter = {
	id: '01meter',
	slug: 'agent_runs',
	name: 'agent_runs',
	eventType: 'agent_runs',
	aggregation: 'SUM' as const,
	valueProperty: '$.value',
	createdAt: new Date('2026-08-30T11:45:12Z'),
	updatedAt: new Date('2026-08-30T11:45:12Z'),
};

beforeEach(() => {
	[mocks.list, mocks.get, mocks.query, mocks.queryPost].forEach((m) => m.mockReset());
});

describe('useOpenMeterMeter', () => {
	it('fetches a single meter by slug', async () => {
		mocks.get.mockResolvedValueOnce(meter);

		const { result } = renderHook(() => useOpenMeterMeter('agent_runs'), { wrapper: createWrapper() });

		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(mocks.get).toHaveBeenCalledWith('agent_runs');
		expect(result.current.data).toEqual(meter);
	});

	it('is disabled for an empty slug', () => {
		const { result } = renderHook(() => useOpenMeterMeter(''), { wrapper: createWrapper() });
		expect(result.current.data).toBeUndefined();
		expect(mocks.get).not.toHaveBeenCalled();
	});
});

describe('useOpenMeterUsagePost', () => {
	it('queries usage through the POST endpoint and returns the rows', async () => {
		const rows = { from: '2026-09-03T00:00:00Z', data: [{ value: 8, groupBy: {} }] };
		mocks.queryPost.mockResolvedValueOnce(rows);

		const body = { from: new Date('2026-09-03T00:00:00Z'), groupBy: ['subject'] };
		const { result } = renderHook(() => useOpenMeterUsagePost('agent_runs', body), { wrapper: createWrapper() });

		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(mocks.queryPost).toHaveBeenCalledWith('agent_runs', body);
		expect(result.current.data).toEqual(rows);
	});
});

describe('既有 meters 读接口回归', () => {
	it('useOpenMeterMeters lists meters and usage hook stays idle when disabled', async () => {
		mocks.list.mockResolvedValueOnce([meter]);
		const enabled = renderHook(() => useOpenMeterMeters(), { wrapper: createWrapper() });
		await waitFor(() => expect(enabled.result.current.isSuccess).toBe(true));
		expect(enabled.result.current.data).toEqual([meter]);

		const original = config.openmeter.enabled;
		config.openmeter.enabled = false;
		try {
			const disabled = renderHook(() => useOpenMeterUsage('agent_runs'), { wrapper: createWrapper() });
			expect(disabled.result.current.data).toBeUndefined();
		} finally {
			config.openmeter.enabled = original;
		}
	});
});
