import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '@/config/config';

const mocks = vi.hoisted(() => ({
	list: vi.fn(),
	listV2: vi.fn(),
}));

vi.mock('@openmeter/sdk', () => ({
	OpenMeter: class {
		events = { list: mocks.list, listV2: mocks.listV2 };
		constructor(public clientConfig: unknown) {}
	},
}));

import { useOpenMeterEvents, useOpenMeterEventsV2 } from './useOpenMeterEvents';

function createWrapper() {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return function Wrapper({ children }: { children: ReactNode }) {
		return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
	};
}

describe('useOpenMeterEvents', () => {
	beforeEach(() => {
		mocks.list.mockReset();
		mocks.listV2.mockReset();
	});

	it('returns ingested events from the admin API', async () => {
		const ingested = {
			event: { id: 'evt-1', type: 'frontend_page_views' },
			ingestedAt: new Date('2026-09-04T00:00:00Z'),
			storedAt: new Date('2026-09-04T00:00:00Z'),
		};
		mocks.list.mockResolvedValueOnce([ingested]);

		const { result } = renderHook(() => useOpenMeterEvents({ subject: 'u-42' }), { wrapper: createWrapper() });

		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(mocks.list).toHaveBeenCalledWith({ subject: 'u-42' });
		expect(result.current.data).toEqual([ingested]);
	});

	it('stays idle and never calls the API when OpenMeter is disabled', () => {
		const original = config.openmeter.enabled;
		config.openmeter.enabled = false;
		try {
			const { result } = renderHook(() => useOpenMeterEvents(), { wrapper: createWrapper() });
			expect(result.current.data).toBeUndefined();
			expect(mocks.list).not.toHaveBeenCalled();
		} finally {
			config.openmeter.enabled = original;
		}
	});
});

describe('useOpenMeterEventsV2', () => {
	beforeEach(() => {
		mocks.list.mockReset();
		mocks.listV2.mockReset();
	});

	it('passes the cursor through and exposes nextCursor for pagination', async () => {
		const page = { items: [{ event: { id: 'evt-2' } }], nextCursor: 'cursor-2' };
		mocks.listV2.mockResolvedValueOnce(page);

		const { result } = renderHook(() => useOpenMeterEventsV2({ cursor: 'cursor-1' }), { wrapper: createWrapper() });

		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(mocks.listV2).toHaveBeenCalledWith({ cursor: 'cursor-1' });
		expect(result.current.data).toEqual(page);
	});

	it('returns an empty page instead of failing when OpenMeter is disabled', () => {
		const original = config.openmeter.enabled;
		config.openmeter.enabled = false;
		try {
			const { result } = renderHook(() => useOpenMeterEventsV2(), { wrapper: createWrapper() });
			expect(result.current.data).toBeUndefined();
			expect(mocks.listV2).not.toHaveBeenCalled();
		} finally {
			config.openmeter.enabled = original;
		}
	});
});
