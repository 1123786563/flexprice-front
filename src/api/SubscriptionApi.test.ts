import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/core/services/openmeter', () => ({
	getOpenMeterClient: vi.fn(),
	requireOpenMeterClient: vi.fn(),
}));

import { getOpenMeterClient, requireOpenMeterClient } from '@/core/services/openmeter';
import SubscriptionApi from '@/api/SubscriptionApi';
import { SUBSCRIPTION_STATUS } from '@/models';

const OM_SUB = {
	id: 'sub-1',
	name: 'Drill Plan',
	status: 'active',
	customerId: 'cust-1',
	plan: { id: 'plan-1', key: 'drill_plan_220', version: 1 },
	currency: 'USD',
	billingCadence: 'P1M',
	billingAnchor: '2026-08-30T11:51:18.095986Z',
	activeFrom: '2026-08-30T11:51:18.095986Z',
	createdAt: '2026-08-30T11:51:18.104009Z',
	updatedAt: '2026-08-30T11:51:18.104010Z',
};

const OM_CUSTOMER = {
	id: 'cust-1',
	key: 'tenant-a',
	name: 'Tenant A',
	createdAt: '2026-08-30T11:48:49.223127Z',
	updatedAt: '2026-08-30T11:48:49.223128Z',
	subscriptions: [OM_SUB],
};

function mockClient() {
	const client = {
		customers: {
			get: vi.fn().mockResolvedValue(OM_CUSTOMER),
			list: vi.fn().mockResolvedValue({ items: [OM_CUSTOMER], totalCount: 1, page: 1, pageSize: 100 }),
		},
		subscriptions: {
			get: vi.fn().mockResolvedValue(OM_SUB),
			create: vi.fn().mockResolvedValue(OM_SUB),
			cancel: vi.fn().mockResolvedValue({ ...OM_SUB, status: 'canceled' }),
		},
		plans: {
			get: vi.fn().mockResolvedValue({ id: 'plan-1', key: 'drill_plan_220', version: 1, name: 'Drill Plan' }),
		},
	};
	vi.mocked(getOpenMeterClient).mockReturnValue(client as never);
	vi.mocked(requireOpenMeterClient).mockReturnValue(client as never);
	return client;
}

describe('SubscriptionApi（OpenMeter 承载）', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('searchSubscriptions：customers 内嵌拍平 + 客户档案 + 状态/客户/计划过滤', async () => {
		mockClient();
		const res = await SubscriptionApi.searchSubscriptions({ customer_id: 'cust-1', limit: 10, offset: 0 });
		expect(res.items).toHaveLength(1);
		expect(res.items[0].customer.name).toBe('Tenant A');
		expect(res.items[0].subscription_status).toBe('active');
		expect(res.pagination.total).toBe(1);

		const byStatus = await SubscriptionApi.searchSubscriptions({ subscription_status: [SUBSCRIPTION_STATUS.CANCELLED] });
		expect(byStatus.items).toHaveLength(0);

		const byPlanKey = await SubscriptionApi.searchSubscriptions({ plan_id: 'drill_plan_220' });
		expect(byPlanKey.items).toHaveLength(1);
	});

	it('getSubscription：取订阅并回填真实客户', async () => {
		mockClient();
		const sub = await SubscriptionApi.getSubscription('sub-1');
		expect(sub.id).toBe('sub-1');
		expect(sub.customer.external_id).toBe('tenant-a');
		expect(sub.plan.lookup_key).toBe('drill_plan_220');
		expect(sub.billing_period).toBe('MONTHLY');
	});

	it('createSubscription：plan_id 先解析为 key 再创建（currency/billing_period 由 plan 决定）', async () => {
		const client = mockClient();
		const res = await SubscriptionApi.createSubscription({
			plan_id: 'plan-1',
			customer_id: 'cust-1',
			currency: 'USD',
			billing_period: 'MONTHLY',
		} as never);
		expect(client.plans.get).toHaveBeenCalledWith('plan-1');
		expect(client.subscriptions.create).toHaveBeenCalledWith(
			expect.objectContaining({ plan: { key: 'drill_plan_220', version: 1 }, customerId: 'cust-1' }),
		);
		expect(res.id).toBe('sub-1');
	});

	it('cancelSubscription：immediate→timing immediate；周期末→next_billing_cycle', async () => {
		const client = mockClient();
		await SubscriptionApi.cancelSubscription('sub-1', {
			cancellation_type: 'immediate' as never,
		});
		expect(client.subscriptions.cancel).toHaveBeenCalledWith('sub-1', { timing: 'immediate' });

		await SubscriptionApi.cancelSubscription('sub-1', { cancellation_type: 'end_of_period' as never });
		expect(client.subscriptions.cancel).toHaveBeenCalledWith('sub-1', { timing: 'next_billing_cycle' });
	});

	it('cancelSubscription：定时取消明确报错', async () => {
		mockClient();
		await expect(
			SubscriptionApi.cancelSubscription('sub-1', { cancellation_type: 'scheduled_date' as never, cancel_at: '2026-10-01' }),
		).rejects.toThrow(/定时取消/);
	});

	it('无 OM 通路的方法明确报错（不假成功）', async () => {
		mockClient();
		await expect(SubscriptionApi.executeSubscriptionModify('sub-1', {} as never)).rejects.toThrow(/暂不支持/);
		await expect(SubscriptionApi.executeSubscriptionChange('sub-1', {} as never)).rejects.toThrow(/暂不支持/);
		await expect(SubscriptionApi.updateSubscription('sub-1', {} as never)).rejects.toThrow(/暂不支持/);
		await expect(SubscriptionApi.createSubscriptionLineItem('sub-1', {} as never)).rejects.toThrow(/暂不支持/);
	});

	it('行项目/附加组件读接口空态', async () => {
		mockClient();
		const lineItems = await SubscriptionApi.searchSubscriptionLineItems({ limit: 10 } as never);
		expect(lineItems.items).toEqual([]);
		const addons = await SubscriptionApi.getActiveAddons('sub-1');
		expect(addons.items).toEqual([]);
	});

	it('后端禁用时搜索优雅降级为空', async () => {
		vi.mocked(getOpenMeterClient).mockReturnValue(null);
		const res = await SubscriptionApi.searchSubscriptions({});
		expect(res.items).toEqual([]);
	});
});
