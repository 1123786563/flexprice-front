import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '@/config/config';

const mocks = vi.hoisted(() => ({
	create: vi.fn(),
	update: vi.fn(),
	delete: vi.fn(),
}));

vi.mock('@openmeter/sdk', () => ({
	OpenMeter: class {
		meters = { create: mocks.create, update: mocks.update, delete: mocks.delete };
		constructor(public clientConfig: unknown) {}
	},
}));

import { useCreateOpenMeterMeter, useDeleteOpenMeterMeter, useUpdateOpenMeterMeter } from './useOpenMeterMeterMutations';

const createInput = {
	slug: 'test_meter',
	name: 'Test Meter',
	eventType: 'test_events',
	aggregation: 'SUM',
	valueProperty: '$.value',
} as const;

function setup() {
	const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
	const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
	const wrapper = function Wrapper({ children }: { children: ReactNode }) {
		return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
	};
	return { invalidateSpy, wrapper };
}

beforeEach(() => {
	[mocks.create, mocks.update, mocks.delete].forEach((m) => m.mockReset());
});

describe('useCreateOpenMeterMeter', () => {
	it('creates a meter and invalidates the meter list', async () => {
		mocks.create.mockResolvedValueOnce({ id: 'm-1', ...createInput });
		const { invalidateSpy, wrapper } = setup();

		const { result } = renderHook(() => useCreateOpenMeterMeter(), { wrapper });
		result.current.mutate(createInput);
		await waitFor(() => expect(result.current.isSuccess).toBe(true));

		expect(mocks.create).toHaveBeenCalledWith(createInput);
		expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['openmeter', 'meters'] });
	});

	it('surfaces a mutation error when OpenMeter is disabled', async () => {
		const original = config.openmeter.enabled;
		config.openmeter.enabled = false;
		try {
			const { wrapper } = setup();
			const { result } = renderHook(() => useCreateOpenMeterMeter(), { wrapper });
			result.current.mutate(createInput);
			await waitFor(() => expect(result.current.isError).toBe(true));
			expect(result.current.error).toMatchObject({ message: expect.stringContaining('VITE_OPENMETER_ENABLED') });
			expect(mocks.create).not.toHaveBeenCalled();
		} finally {
			config.openmeter.enabled = original;
		}
	});
});

describe('useUpdateOpenMeterMeter', () => {
	it('patches the meter and invalidates list + detail keys', async () => {
		mocks.update.mockResolvedValueOnce({ id: 'm-1', ...createInput });
		const { invalidateSpy, wrapper } = setup();

		const { result } = renderHook(() => useUpdateOpenMeterMeter(), { wrapper });
		result.current.mutate({ idOrSlug: 'test_meter', meter: { name: 'Renamed' } });
		await waitFor(() => expect(result.current.isSuccess).toBe(true));

		expect(mocks.update).toHaveBeenCalledWith('test_meter', { name: 'Renamed' });
		expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['openmeter', 'meters'] });
		expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['openmeter', 'meter', 'test_meter'] });
	});
});

describe('useDeleteOpenMeterMeter', () => {
	it('deletes by slug and invalidates list + detail keys', async () => {
		mocks.delete.mockResolvedValueOnce(undefined);
		const { invalidateSpy, wrapper } = setup();

		const { result } = renderHook(() => useDeleteOpenMeterMeter(), { wrapper });
		result.current.mutate('test_meter');
		await waitFor(() => expect(result.current.isSuccess).toBe(true));

		expect(mocks.delete).toHaveBeenCalledWith('test_meter');
		expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['openmeter', 'meter', 'test_meter'] });
	});
});
