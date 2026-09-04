import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	list: vi.fn(),
	get: vi.fn(),
	create: vi.fn(),
	delete: vi.fn(),
}));

vi.mock('@openmeter/sdk', () => ({
	OpenMeter: class {
		features = { list: mocks.list, get: mocks.get, create: mocks.create, delete: mocks.delete };
		constructor(public clientConfig: unknown) {}
	},
}));

import { useCreateOpenMeterFeature, useDeleteOpenMeterFeature, useOpenMeterFeature, useOpenMeterFeatures } from './useOpenMeterFeatures';

const feature = {
	id: 'f-1',
	key: 'agent_runs',
	name: 'Agent Runs',
	createdAt: new Date('2026-09-04T00:00:00Z'),
	updatedAt: new Date('2026-09-04T00:00:00Z'),
};

function createWrapper() {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
	return function Wrapper({ children }: { children: ReactNode }) {
		return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
	};
}

beforeEach(() => {
	[mocks.list, mocks.get, mocks.create, mocks.delete].forEach((m) => m.mockReset());
});

describe('useOpenMeterFeatures / useOpenMeterFeature', () => {
	it('lists features from the backend', async () => {
		mocks.list.mockResolvedValueOnce([feature]);
		const { result } = renderHook(() => useOpenMeterFeatures(), { wrapper: createWrapper() });
		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(result.current.data).toEqual([feature]);
	});

	it('maps a missing feature to null', async () => {
		mocks.get.mockResolvedValueOnce(undefined);
		const { result } = renderHook(() => useOpenMeterFeature('ghost'), { wrapper: createWrapper() });
		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(result.current.data).toBeNull();
	});
});

describe('useCreateOpenMeterFeature', () => {
	it('creates a feature and invalidates the list', async () => {
		mocks.create.mockResolvedValueOnce(feature);
		const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
		const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
		const wrapper = function Wrapper({ children }: { children: ReactNode }) {
			return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
		};

		const { result } = renderHook(() => useCreateOpenMeterFeature(), { wrapper });
		result.current.mutate({ key: 'agent_runs', name: 'Agent Runs' });
		await waitFor(() => expect(result.current.isSuccess).toBe(true));

		expect(mocks.create).toHaveBeenCalledWith({ key: 'agent_runs', name: 'Agent Runs' });
		expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['openmeter', 'features'] });
	});
});

describe('useDeleteOpenMeterFeature', () => {
	it('deletes by id and invalidates list + detail', async () => {
		mocks.delete.mockResolvedValueOnce(undefined);
		const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
		const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
		const wrapper = function Wrapper({ children }: { children: ReactNode }) {
			return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
		};

		const { result } = renderHook(() => useDeleteOpenMeterFeature(), { wrapper });
		result.current.mutate('f-1');
		await waitFor(() => expect(result.current.isSuccess).toBe(true));

		expect(mocks.delete).toHaveBeenCalledWith('f-1');
		expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['openmeter', 'feature', 'f-1'] });
	});
});
