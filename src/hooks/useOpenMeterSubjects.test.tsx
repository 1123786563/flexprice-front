import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '@/config/config';

const mocks = vi.hoisted(() => ({
	list: vi.fn(),
	get: vi.fn(),
	upsert: vi.fn(),
	delete: vi.fn(),
}));

const mockUser = vi.hoisted(() => ({ current: undefined as Record<string, unknown> | undefined }));

vi.mock('@openmeter/sdk', () => ({
	OpenMeter: class {
		subjects = { list: mocks.list, get: mocks.get, upsert: mocks.upsert, delete: mocks.delete };
		constructor(public clientConfig: unknown) {}
	},
}));

vi.mock('@/hooks/useUser', () => ({
	default: () => ({ user: mockUser.current, loading: false }),
}));

import {
	useDeleteOpenMeterSubject,
	useOpenMeterSubject,
	useOpenMeterSubjects,
	useRegisterUsageSubject,
	useUpsertOpenMeterSubjects,
} from './useOpenMeterSubjects';

const subject = {
	id: '01subj',
	key: 'u-42',
	displayName: 'Tester',
	metadata: {},
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
	[mocks.list, mocks.get, mocks.upsert, mocks.delete].forEach((m) => m.mockReset());
	mockUser.current = undefined;
});

describe('useOpenMeterSubjects / useOpenMeterSubject', () => {
	it('lists subjects from the backend', async () => {
		mocks.list.mockResolvedValueOnce([subject]);
		const { result } = renderHook(() => useOpenMeterSubjects(), { wrapper: createWrapper() });
		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(result.current.data).toEqual([subject]);
	});

	it('maps a missing subject to null instead of an error', async () => {
		mocks.get.mockResolvedValueOnce(undefined);
		const { result } = renderHook(() => useOpenMeterSubject('ghost'), { wrapper: createWrapper() });
		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(result.current.data).toBeNull();
	});
});

describe('useUpsertOpenMeterSubjects', () => {
	it('upserts a batch and invalidates the list', async () => {
		mocks.upsert.mockResolvedValueOnce([subject]);
		const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
		const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
		const wrapper = function Wrapper({ children }: { children: ReactNode }) {
			return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
		};

		const { result } = renderHook(() => useUpsertOpenMeterSubjects(), { wrapper });
		result.current.mutate([{ key: 'u-42', displayName: 'Tester' }]);
		await waitFor(() => expect(result.current.isSuccess).toBe(true));

		expect(mocks.upsert).toHaveBeenCalledWith([{ key: 'u-42', displayName: 'Tester' }]);
		expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['openmeter', 'subjects'] });
	});
});

describe('useRegisterUsageSubject', () => {
	// mutate() options stay in TanStack — the SDK call receives only the upsert payload.
	it('upserts the signed-in user as a subject on mount', async () => {
		mockUser.current = { id: 'u-42', name: 'Tester', email: 't@f.io' };
		renderHook(() => useRegisterUsageSubject(), { wrapper: createWrapper() });
		await waitFor(() => expect(mocks.upsert).toHaveBeenCalled());
		expect(mocks.upsert).toHaveBeenCalledWith({ key: 'u-42', displayName: 'Tester' });
	});

	it('prefers email over missing name for displayName', async () => {
		mockUser.current = { id: 'u-42', email: 't@f.io' };
		renderHook(() => useRegisterUsageSubject(), { wrapper: createWrapper() });
		await waitFor(() => expect(mocks.upsert).toHaveBeenCalled());
		expect(mocks.upsert).toHaveBeenCalledWith({ key: 'u-42', displayName: 't@f.io' });
	});

	it('does nothing when logged out', () => {
		renderHook(() => useRegisterUsageSubject(), { wrapper: createWrapper() });
		expect(mocks.upsert).not.toHaveBeenCalled();
	});

	it('does nothing when OpenMeter is disabled', () => {
		const original = config.openmeter.enabled;
		config.openmeter.enabled = false;
		try {
			mockUser.current = { id: 'u-42' };
			renderHook(() => useRegisterUsageSubject(), { wrapper: createWrapper() });
			expect(mocks.upsert).not.toHaveBeenCalled();
		} finally {
			config.openmeter.enabled = original;
		}
	});
});

describe('useDeleteOpenMeterSubject', () => {
	it('deletes by key and invalidates list + detail', async () => {
		mocks.delete.mockResolvedValueOnce(undefined);
		const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
		const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
		const wrapper = function Wrapper({ children }: { children: ReactNode }) {
			return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
		};

		const { result } = renderHook(() => useDeleteOpenMeterSubject(), { wrapper });
		result.current.mutate('u-42');
		await waitFor(() => expect(result.current.isSuccess).toBe(true));

		expect(mocks.delete).toHaveBeenCalledWith('u-42');
		expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['openmeter', 'subjects'] });
		expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['openmeter', 'subject', 'u-42'] });
	});
});
