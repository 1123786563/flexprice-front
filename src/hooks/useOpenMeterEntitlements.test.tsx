import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	listV2: vi.fn(),
	getV2: vi.fn(),
	listGrants: vi.fn(),
	voidGrant: vi.fn(),
	valueV1: vi.fn(),
	customerValue: vi.fn(),
}));

vi.mock('@openmeter/sdk', () => ({
	OpenMeter: class {
		entitlements = {
			list: mocks.listV2,
			get: mocks.getV2,
			grants: { list: mocks.listGrants, void: mocks.voidGrant },
		};
		entitlementsV1 = { value: mocks.valueV1 };
		customers = { entitlements: { value: mocks.customerValue } };
		constructor(public clientConfig: unknown) {}
	},
}));

import {
	useOpenMeterCustomerEntitlementValue,
	useOpenMeterEntitlement,
	useOpenMeterEntitlementGrants,
	useOpenMeterEntitlements,
	useOpenMeterSubjectEntitlementValue,
	useVoidOpenMeterEntitlementGrant,
} from './useOpenMeterEntitlements';

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

describe('useOpenMeterEntitlements', () => {
	it('返回 v2 授权分页、单个授权与 grants 分页', async () => {
		const entitlement = { id: 'ent-1', featureKey: 'agent_runs', createdAt: new Date(), updatedAt: new Date() };
		mocks.listV2.mockResolvedValueOnce({ items: [entitlement], totalCount: 1 });
		mocks.getV2.mockResolvedValueOnce(entitlement);
		mocks.listGrants.mockResolvedValueOnce({ items: [], totalCount: 0 });

		const { result } = renderHook(() => useOpenMeterEntitlements(), { wrapper: setup().wrapper });
		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(result.current.data?.items).toEqual([entitlement]);

		const { result: one } = renderHook(() => useOpenMeterEntitlement('ent-1'), { wrapper: setup().wrapper });
		await waitFor(() => expect(one.current.isSuccess).toBe(true));
		expect(one.current.data).toEqual(entitlement);

		const { result: grants } = renderHook(() => useOpenMeterEntitlementGrants(), { wrapper: setup().wrapper });
		await waitFor(() => expect(grants.current.isSuccess).toBe(true));
		expect(grants.current.data).toEqual({ items: [], totalCount: 0 });
	});

	it('查询主体/客户在 feature 上的额度值', async () => {
		mocks.valueV1.mockResolvedValueOnce({ hasAccess: true, value: 100 });
		mocks.customerValue.mockResolvedValueOnce({ hasAccess: true, value: 50 });

		const { result: subject } = renderHook(() => useOpenMeterSubjectEntitlementValue('u-42', 'agent_runs'), {
			wrapper: setup().wrapper,
		});
		await waitFor(() => expect(subject.current.isSuccess).toBe(true));
		expect(subject.current.data).toEqual({ hasAccess: true, value: 100 });

		const { result: customer } = renderHook(() => useOpenMeterCustomerEntitlementValue('acme', 'agent_runs'), {
			wrapper: setup().wrapper,
		});
		await waitFor(() => expect(customer.current.isSuccess).toBe(true));
		expect(customer.current.data).toEqual({ hasAccess: true, value: 50 });
	});

	it('作废 grant 后失效 grants 列表', async () => {
		mocks.voidGrant.mockResolvedValueOnce(undefined);
		const { invalidateSpy, wrapper } = setup();
		const { result } = renderHook(() => useVoidOpenMeterEntitlementGrant(), { wrapper });
		result.current.mutate('grant-1');
		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(mocks.voidGrant).toHaveBeenCalledWith('grant-1');
		expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['openmeter', 'entitlements', 'grants'] });
	});
});
